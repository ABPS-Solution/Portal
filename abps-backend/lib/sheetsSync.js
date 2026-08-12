// ═══════════════════════════════════════════════════════════════════════
// lib/sheetsSync.js — Postgres → Google Sheets sync engine.
//
// Uses the same connected-account OAuth pattern as Gmail/Drive
// (admin_db.gmail_connections), authorized via SHEETS_OWNER_EMAIL.
//
// Formatting is applied ONCE per tab (on first creation), to a generous
// pre-sized range — not re-applied on every write. This keeps write
// operations fast/cheap and avoids burning extra Sheets API quota on
// formatting calls we don't need to repeat.
// ═══════════════════════════════════════════════════════════════════════
const { google } = require('googleapis');
const { pool } = require('../db');

const FORMATTED_RANGE_ROWS = 3000; // pre-format this many rows so new data always looks right

async function getSheetsClient() {
  const ownerEmail = process.env.SHEETS_OWNER_EMAIL || process.env.DRIVE_OWNER_EMAIL;
  if (!ownerEmail) throw new Error('SHEETS_OWNER_EMAIL (or DRIVE_OWNER_EMAIL) environment variable is not set.');

  const { rows } = await pool.query(
    `SELECT refresh_token FROM admin_db.gmail_connections WHERE email = $1 AND status = 'Active'`,
    [ownerEmail]
  );
  if (rows.length === 0) {
    throw new Error(`No active connection for ${ownerEmail}. Visit /api/gmailAuth/connect first (with spreadsheets scope).`);
  }

  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_OAUTH_CLIENT_ID, process.env.GMAIL_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: rows[0].refresh_token });
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

// Heuristic column width, since hand-configuring width for every column
// across ~34 tables isn't practical. Narrow for IDs/dates/status/numbers,
// wide for free-text fields like summaries/descriptions/notes, medium
// for everything else. This matches the explicit ask: "good space for AI
// summary column, not too much for Date."
function widthForColumn(headerName) {
  const h = headerName.toLowerCase();
  const narrowPatterns = ['id', 'date', 'code', 'status', 'qty', 'quantity', 'percent', 'no.', 'number', 'sr', 'version', 'time', 'gst', 'rate'];
  const widePatterns = ['summary', 'description', 'notes', 'remarks', 'address', 'reason', 'objection', 'detail', 'action', 'name of materials', 'material rows', 'items', 'scope', 'terms'];

  if (widePatterns.some(p => h.includes(p))) return 320;
  if (narrowPatterns.some(p => h.includes(p))) return 100;
  return 170;
}

async function getOrCreateSheetId(sheets, spreadsheetId, tabName) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = data.sheets.find(s => s.properties.title === tabName);
  if (existing) return existing.properties.sheetId;

  const { data: created } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  return created.replies[0].addSheet.properties.sheetId;
}

// ensureTabFormatted — creates the tab if missing, writes headers, and
// applies ALL the formatting requested: bold header, black borders,
// frozen header row, center-aligned + wrapped text, auto row height,
// heuristic column widths. Applied once to a generous 3000-row range.
async function ensureTabFormatted(spreadsheetId, tabName, headers, hideFirstColumn = false) {
  const sheets = await getSheetsClient();
  const sheetId = await getOrCreateSheetId(sheets, spreadsheetId, tabName);

  // Write header row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });

  const numCols = headers.length;
  const requests = [
    // Bold header
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: numCols },
        cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // Freeze header row
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    // Center + wrap + auto row height for the whole pre-formatted range (data rows)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: FORMATTED_RANGE_ROWS, startColumnIndex: 0, endColumnIndex: numCols },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // Black borders, whole pre-formatted range including header
    {
      updateBorders: {
        range: { sheetId, startRowIndex: 0, endRowIndex: FORMATTED_RANGE_ROWS, startColumnIndex: 0, endColumnIndex: numCols },
        top: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
        bottom: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
        left: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
        right: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
        innerVertical: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
      },
    },
    // Auto-resize row heights (based on wrapped content)
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: FORMATTED_RANGE_ROWS } } },
  ];

  // Per-column widths, heuristic based on header name
  headers.forEach((h, idx) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
        properties: { pixelSize: widthForColumn(h) },
        fields: 'pixelSize',
      },
    });
  });

  // Optionally hide column A — used when the sync engine needs a stable
  // key for upsert matching, but the ID itself isn't meant for viewing.
  if (hideFirstColumn) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  return sheetId;
}

// syncFullSnapshot — used by scheduled/partial jobs. Clears existing data
// (keeping header + formatting) and writes a fresh full snapshot.
async function syncFullSnapshot(spreadsheetId, tabName, headers, rows, hideFirstColumn = false) {
  const sheets = await getSheetsClient();
  await ensureTabFormatted(spreadsheetId, tabName, headers, hideFirstColumn);

  // Write fresh data FIRST, then trim leftover trailing rows below it.
  // Deliberately NOT clear-then-write: if the write below fails partway
  // (quota, network blip -- exactly what happened 2026-07-20), a
  // clear-first ordering leaves the sheet blank until the next
  // successful cycle. Write-first means a failure here just leaves
  // stale trailing rows from the previous sync, never an empty tab.
  if (rows.length > 0) {
    const values = rows.map(row => headers.map(h => formatCell(row[h])));
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  }

  const startRow = rows.length + 2; // +2: header row, then 1-indexed
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tabName}!A${startRow}:${colLetter(headers.length)}${FORMATTED_RANGE_ROWS}` });
}

// upsertRow — used for Live (real-time) tables. Finds an existing row by
// matching keyColumn's value in column A, updates it in place; appends
// a new row if not found. Best-effort: callers should never await this
// in a way that blocks the primary DB write's response.
async function upsertRow(spreadsheetId, tabName, headers, keyColumn, rowData, hideFirstColumn = false) {
  const sheets = await getSheetsClient();
  await ensureTabFormatted(spreadsheetId, tabName, headers, hideFirstColumn); // no-op (except hide) after first call, tab already exists

  const keyIdx = headers.indexOf(keyColumn);
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:A` });
  const existingRows = data.values || [];
  const rowIndex = existingRows.findIndex((r, i) => i > 0 && r[0] === String(rowData[keyColumn]));

  const rowValues = headers.map(h => formatCell(rowData[h]));
  if (rowIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowValues] },
    });
  } else {
    // New row goes in at row 2 (right after the header), not appended
    // to the bottom — every "live" table (PRN/PO/BOQ header rows etc.)
    // is expected to show newest-first, and unlike partial/scheduled
    // tables, a live table's incremental sync is the ONLY thing that
    // ever touches its row order — there's no periodic full resync to
    // fall back on to re-sort it later.
    const sheetId = await getOrCreateSheetId(sheets, spreadsheetId, tabName);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
            inheritFromBefore: false,
          },
        }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowValues] },
    });
  }
}

// deleteRow — removes the matching row entirely (shifts everything below
// it up), rather than clearing its contents, so a deleted DB row doesn't
// leave a blank gap in the sheet. Same column-A lookup as upsertRow.

async function deleteRow(spreadsheetId, tabName, keyColumn, keyValue, groupColumn) {
  const sheets = await getSheetsClient();
  const sheetId = await getOrCreateSheetId(sheets, spreadsheetId, tabName);

  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:Z` });
  const existingRows = data.values || [];
  const headerRow = existingRows[0] || [];
  const keyIdx = headerRow.indexOf(keyColumn);
  const rowIndex = existingRows.findIndex((r, i) => i > 0 && r[keyIdx] === String(keyValue));
  if (rowIndex <= 0) return null;

  // Captured before deletion — the group this row belonged to (e.g. its
  // PRN/BOQ/PO ID), so the caller can re-sync its now-stale siblings'
  // Sr No after this row is gone. Returns null if the table has no
  // groupColumn (nothing further to re-sync).
  const groupIdx = groupColumn ? headerRow.indexOf(groupColumn) : -1;
  const groupValue = groupIdx >= 0 ? existingRows[rowIndex][groupIdx] : null;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
        },
      }],
    },
  });
  return groupValue;
}

function formatCell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'YES' : 'NO';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number') return val; // already numeric — let Sheets format it natively
  if (typeof val === 'object') return JSON.stringify(val);
  // Postgres NUMERIC/DECIMAL columns arrive as padded strings ("5.000",
  // "1726.40") to avoid float precision loss on the DB side — that's
  // correct there, but writing that literal string to a sheet cell means
  // Sheets displays it as-typed instead of applying its own number
  // format. Converting genuine numeric strings to real numbers here lets
  // Sheets' default General format strip the padding (5.000 -> 5,
  // 4.300 -> 4.3) across every table, since every sheet write — live and
  // batch — passes through this one function.
  if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())) {
    return Number(val);
  }
  return String(val);
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

module.exports = { ensureTabFormatted, syncFullSnapshot, upsertRow, deleteRow, getSheetsClient };
