// ═══════════════════════════════════════════════════════════════════════
// ABPS Portal — instant Sheet→DB pull trigger (standalone script)
// One script, watching all editable-via-Sheet tables across every
// spreadsheet. To add a new sheet/table in future: add one entry to
// SPREADSHEET_CONFIG below, then re-run setup() once — no other changes.
//
// Calls the backend DIRECTLY and synchronously on each edit (no
// debounce/time-trigger layer) for ~1-2s latency instead of the 10-15s+
// Apps Script's time-based trigger scheduling adds. Trade-off: a burst
// of separate rapid edits fires one call each (a single paste across
// many cells still only fires once, since onEdit covers the whole
// pasted range in one event) -- acceptable for rare, manual edits.
// ═══════════════════════════════════════════════════════════════════════

const BACKEND_URL = 'https://abps-backend-244281871074.asia-south1.run.app';

// spreadsheetId -> { "Tab Name": "table_key" }
// table_key values must match PULLABLE_TABLES in lib/sheetsPull.js.
const SPREADSHEET_CONFIG = {
  '172kBWsjJXTrwJbfNqowY2W0T_j-eFmo9cSpYT1RS6M4': { // ADMIN
    'Users': 'users',
  },
  '15cnjkkio55HAbJyvlglah7Mg42QkmUe9swX_cp-e-Ds': { // PROJECT
    'Projects': 'projects',
  },
  '194otofrkFgnAGZ04XFbyg_wA8no47smIiSn1La5UOG4': { // DESIGN
    'Item Codes': 'item_codes',
  },
  '1ASG04bDYmCnUYfl5vVxJ9XXapBYr3S2XUZCJW4iO2Bk': { // PURCHASE
    'Material Buffer %': 'material_buffer_percentage',
    'Vendor Information': 'vendor_information',
  },
  '1hvZaKCsoIbs9Ekc4FUruD0NzyylDx2hGndMy6ttzeyg': { // INVENTORY — TEMPORARY, testing only
    'Raw Material Store': 'raw_material_store',
    'Spare Store': 'spare_store',
  },
};

// ── Trigger handler — fires on ANY edit to ANY watched spreadsheet ─────
// Now sends WHICH cells changed (row key + column headers), not just
// which tab — pullUsers uses this to update only the specific columns
// that were actually edited, instead of re-syncing the whole row from
// current sheet state (which was silently clobbering unrelated
// permissions any time they'd drifted from the sheet, e.g. after a raw
// SQL edit that hadn't been pushed back to the sheet yet).
function onEditInstalled(e) {
  const spreadsheetId = e.source.getId();
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const tableKey = (SPREADSHEET_CONFIG[spreadsheetId] || {})[sheetName];
  if (!tableKey) return; // edit was in a tab we don't sync — ignore

  const startRow = e.range.getRow();
  const numRows = e.range.getNumRows();
  const startCol = e.range.getColumn();
  const numCols = e.range.getNumColumns();

  let rowsChanged = null; // null -> fall back to old full-table behavior
  if (startRow > 1) { // row 1 is the header row — a header edit gets no targeted sync, falls through as full
    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const changedHeaders = [];
    for (let c = startCol; c < startCol + numCols; c++) {
      const h = (headerRow[c - 1] || '').toString().trim();
      if (h) changedHeaders.push(h);
    }
    if (changedHeaders.length > 0) {
      rowsChanged = [];
      for (let r = startRow; r < startRow + numRows; r++) {
        const rowKey = sheet.getRange(r, 1).getValue().toString().trim(); // column A = key (Email for Users)
        if (rowKey) rowsChanged.push({ rowKey, changedHeaders });
      }
    }
  }

  const secret = PropertiesService.getScriptProperties().getProperty('INTERNAL_SECRET');
  try {
    const payload = { table: tableKey };
    if (rowsChanged && rowsChanged.length > 0) payload.rowsChanged = rowsChanged;
    const response = UrlFetchApp.fetch(BACKEND_URL + '/api/internal/pullSheetsToDb', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-internal-secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const body = response.getContentText();
    if (response.getResponseCode() !== 200) {
      console.error('Pull failed for ' + tableKey + ': ' + body);
    } else {
      console.log('Pull succeeded for ' + tableKey + ': ' + body);
    }
  } catch (err) {
    console.error('Pull request failed for ' + tableKey + ': ' + err.message);
  }
}

// ── Setup — run ONCE manually after pasting/editing this script ───────
// Installs one onEdit trigger per spreadsheet in SPREADSHEET_CONFIG.
// Re-run any time you add a new spreadsheet to the config — it clears
// old triggers first, so it's safe to run again after edits.
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'onEditInstalled' || t.getHandlerFunction() === 'firePendingPull') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Object.keys(SPREADSHEET_CONFIG).forEach(spreadsheetId => {
    ScriptApp.newTrigger('onEditInstalled')
      .forSpreadsheet(spreadsheetId)
      .onEdit()
      .create();
  });
  console.log('Installed triggers on ' + Object.keys(SPREADSHEET_CONFIG).length + ' spreadsheet(s).');
}