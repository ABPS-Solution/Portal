// ═══════════════════════════════════════════════════════════════════════
// lib/pdfshift.js — HTML -> PDF via PDFShift, ported from code.js's
// convertHTMLToPDFViaPDFShift_.
//
// Keys come from env vars PDFSHIFT_API_KEY_1..5 (blanks skipped). Each is
// a free-tier key with a monthly quota, so we do NOT round-robin — we
// stay on one key until it reports quota exhaustion (402) or rate
// limiting (429), then advance to the next and remember that choice in
// purchase.pdfshift_state. Without that persistence, every document
// would re-try the already-exhausted earlier keys first, wasting a
// failed round trip per key per PDF.
// ═══════════════════════════════════════════════════════════════════════
const { pool } = require('../db');

function loadKeys() {
  const keys = [];
  for (let i = 1; i <= 5; i++) {
    const k = process.env[`PDFSHIFT_API_KEY_${i}`];
    if (k && k.trim()) keys.push({ index: i, key: k.trim() });
  }
  return keys;
}

async function readPointer(keyCount) {
  try {
    const { rows: [row] } = await pool.query(`SELECT current_key FROM purchase.pdfshift_state WHERE id = 1`);
    const ptr = Number(row?.current_key) || 1;
    // Pointer is 1-based and stored as the key's env index; clamp if a
    // key was removed from the deploy since it was last written.
    return (ptr >= 1 && ptr <= keyCount) ? ptr : 1;
  } catch (_) {
    return 1; // table missing or unreadable — degrade to starting at key 1
  }
}

async function savePointer(keyIndex) {
  try {
    await pool.query(
      `INSERT INTO purchase.pdfshift_state (id, current_key, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET current_key = $1, updated_at = now()`,
      [keyIndex]
    );
  } catch (err) {
    console.error('pdfshift: could not persist key pointer (non-fatal):', err.message);
  }
}

async function convertHTMLToPDF(html) {
  const keys = loadKeys();
  if (keys.length === 0) throw new Error('No PDFShift API keys configured (set PDFSHIFT_API_KEY_1).');

  const startPtr = await readPointer(keys.length);
  const startIdx = keys.findIndex(k => k.index === startPtr);
  const offset = startIdx === -1 ? 0 : startIdx;

  let lastError = '';
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyObj = keys[(offset + attempt) % keys.length];
    const authHeader = 'Basic ' + Buffer.from('api:' + keyObj.key).toString('base64');

    let resp;
    try {
      resp = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          source: html,
          landscape: false,
          use_print: true,
          format: 'A4',
          margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
        }),
      });
    } catch (netErr) {
      // Network/DNS failure isn't a key problem — don't burn the rotation.
      throw new Error('PDFShift network error: ' + netErr.message);
    }

    if (resp.ok) {
      if (keyObj.index !== startPtr) await savePointer(keyObj.index);
      return Buffer.from(await resp.arrayBuffer());
    }

    if (resp.status === 402 || resp.status === 429) {
      lastError = `Key #${keyObj.index} quota/rate issue (HTTP ${resp.status})`;
      console.error(`PDFShift: ${lastError} — rotating to next key.`);
      continue;
    }

    const body = (await resp.text()).substring(0, 300);
    throw new Error(`PDFShift HTTP ${resp.status} on key #${keyObj.index}: ${body}`);
  }

  throw new Error('All PDFShift keys exhausted or rate-limited. Last: ' + lastError);
}

module.exports = { convertHTMLToPDF };