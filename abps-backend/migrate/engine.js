// ═══════════════════════════════════════════════════════════════════════
// migrate/engine.js — shared machinery for the Sheets → Postgres
// migration. Run standalone (node migrate/run.js), NOT part of the
// Cloud Run backend — this is a one-time (or re-runnable) operator tool.
//
// Design choices:
//  1. Reads via the Sheets API (read-only scope) — doesn't touch your
//     live Apps Script deployment at all, purely additive.
//  2. Original IDs from the sheets are PRESERVED, not regenerated —
//     Company ID, PRN ID, PO No. etc. carry over exactly as-is. This
//     keeps cross-references between rows (which point to each other by
//     these IDs) intact without needing an ID-remapping pass.
//  3. Idempotent: every insert uses ON CONFLICT DO NOTHING, so re-running
//     the whole script after fixing one table's mapping is always safe.
//  4. Best-effort per row: a bad row logs and continues rather than
//     aborting the entire migration — you get a full error report at the
//     end to review, instead of one bad row blocking everything else.
//  5. After all inserts, every sequence (marketing.company_id_seq etc.)
//     is reset past the highest imported ID, so NEW rows created going
//     forward in the live app don't collide with migrated ones.
// ═══════════════════════════════════════════════════════════════════════
const { google } = require('googleapis');
const { Pool } = require('pg');

const SHEET_IDS = {
  ADMIN:      process.env.SECURE_ADMIN_SHEET_ID,
  MARKETING:  process.env.MARKETING_SHEET_ID,
  DESIGN:     process.env.DESIGN_SHEET_ID,
  PURCHASE:   process.env.PURCHASE_SHEET_ID,
  INVENTORY:  process.env.INVENTORY_SHEET_ID,
  PRODUCTION: process.env.PRODUCTION_SHEET_ID,
};

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'postgres',
  host: process.env.DB_HOST || '127.0.0.1', // run this via Cloud SQL Auth Proxy locally
  port: process.env.DB_PORT || 5432,
});

const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });

// Reads a full tab as an array of {header: value} row objects. Headers
// are normalized the same way code.js did (lowercase, spaces stripped)
// so mapping functions can reference them consistently.
async function readSheetTab(sheetGroup, tabName) {
  const spreadsheetId = SHEET_IDS[sheetGroup];
  if (!spreadsheetId) throw new Error(`No sheet ID configured for ${sheetGroup} — check your env vars.`);

  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: tabName,
  });
  const [headerRow, ...rows] = data.values || [];
  if (!headerRow) return [];

  const headers = headerRow.map(h => h.toString().trim());
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

// ── Value coercion helpers — Sheets returns everything as strings ──────
const num = (v) => { const n = parseFloat((v || '').toString().replace(/,/g, '')); return isNaN(n) ? null : n; };
const int = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
const bool = (v) => ['yes', 'true', '1'].includes((v || '').toString().trim().toLowerCase());
const str = (v) => { const s = (v || '').toString().trim(); return s === '' ? null : s; };
const date = (v) => { const s = str(v); if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); };
const json = (v) => { try { return JSON.stringify(JSON.parse(v || '[]')); } catch { return '[]'; } };

// Runs one table's migration: reads the sheet tab, maps each row via
// `mapRow`, inserts via the given SQL template. `mapRow` returns null to
// skip a row (e.g. blank trailing rows).
async function migrateTable({ label, sheetGroup, tabName, mapRow, insertSql }) {
  console.log(`\n── ${label} ──`);
  let rows;
  try {
    rows = await module.exports.readSheetTab(sheetGroup, tabName);
  } catch (err) {
    console.error(`  FAILED to read sheet tab: ${err.message}`);
    return { label, total: 0, inserted: 0, skipped: 0, errors: [{ error: 'sheet read failed: ' + err.message }] };
  }

  let inserted = 0, skipped = 0;
  const errors = [];

  for (const [idx, row] of rows.entries()) {
    let values;
    try {
      values = mapRow(row);
      if (values === null) { skipped++; continue; }
    } catch (err) {
      errors.push({ row: idx + 2, error: 'mapping failed: ' + err.message }); // +2 = 1-indexed + header row
      continue;
    }
    try {
      await pool.query(insertSql, values);
      inserted++;
    } catch (err) {
      errors.push({ row: idx + 2, error: err.message, values });
    }
  }

  console.log(`  ${rows.length} rows read | ${inserted} inserted | ${skipped} skipped | ${errors.length} errors`);
  if (errors.length > 0) {
    console.log(`  First few errors:`, errors.slice(0, 3));
  }
  return { label, total: rows.length, inserted, skipped, errors };
}

// Resets a sequence past the max numeric suffix found in an existing
// text-ID column (e.g. 'COMP-42' -> extracts 42, sets sequence to 43+).
// Run this AFTER all inserts for that table, so new rows created by the
// live app don't collide with migrated IDs.
async function resyncSequence(sequenceName, tableName, idColumn, prefix) {
  const { rows } = await pool.query(
    `SELECT MAX(NULLIF(regexp_replace(${idColumn}, '^${prefix}', ''), '')::bigint) AS max_num
     FROM ${tableName} WHERE ${idColumn} LIKE '${prefix}%'`
  );
  const maxNum = rows[0].max_num || 0;
  await pool.query(`SELECT setval('${sequenceName}', $1, true)`, [maxNum + 1]);
  console.log(`  Resynced ${sequenceName} to ${maxNum + 1}`);
}

module.exports = { pool, readSheetTab, migrateTable, resyncSequence, num, int, bool, str, date, json };
