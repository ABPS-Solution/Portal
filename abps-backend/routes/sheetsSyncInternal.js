// ═══════════════════════════════════════════════════════════════════════
// routes/sheetsSyncInternal.js — Cloud Scheduler-triggered snapshot sync
// for Partial (5min) and Scheduled (10min) tier tables. Live tier tables
// are NOT here — those sync inline on write (separate, upcoming pass).
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool } = require('../db');
const { syncFullSnapshot } = require('../lib/sheetsSync');
const { SPREADSHEET_IDS, TABLE_REGISTRY } = require('../lib/sheetsRegistry');
const { pullEditableSheetsToDb } = require('../lib/sheetsPull');
const { runDailyBackup } = require('../lib/backup');

const router = express.Router();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requireInternalSecret(req, res, next) {
  const provided = req.headers['x-internal-secret'];
  if (!process.env.INTERNAL_TRIGGER_SECRET || provided !== process.env.INTERNAL_TRIGGER_SECRET) {
    return res.status(403).json({ success: false, error: 'Invalid or missing internal trigger secret.' });
  }
  next();
}

async function syncTier(tier) {
  const results = [];
  for (const [tableName, config] of Object.entries(TABLE_REGISTRY)) {
    if (config.tier !== tier) continue;
    await sleep(1500); // stay under Sheets API's ~60 writes/min quota
    try {
      const result = await pool.query(config.query);
      const rows = result.rows;
      // Postgres still reports column names via result.fields even when
      // the query returns 0 rows — using that (instead of only
      // Object.keys(rows[0])) means empty tables still get their tab
      // created with the right headers, not skipped entirely.
      const headers = rows.length > 0 ? Object.keys(rows[0]) : result.fields.map(f => f.name);
      const spreadsheetId = SPREADSHEET_IDS[config.sheet];
      if (headers.length > 0) {
        await syncFullSnapshot(spreadsheetId, config.tab, headers, rows, !!config.hideKeyColumn);
      }
      results.push({ table: tableName, rows: rows.length, status: 'ok' });
    } catch (err) {
      console.error(`Sheets sync failed for ${tableName}:`, err.message);
      results.push({ table: tableName, status: 'error', error: err.message });
    }
  }
  return results;
}

router.post('/internal/syncSheetsPartial', requireInternalSecret, async (req, res) => {
  try {
    const results = await syncTier('partial');
    console.log('Partial sheets sync:', results);
    res.json({ success: true, results });
  } catch (err) {
    console.error('syncSheetsPartial failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/internal/syncSheetsScheduled', requireInternalSecret, async (req, res) => {
  try {
    const results = await syncTier('scheduled');
    console.log('Scheduled sheets sync:', results);
    res.json({ success: true, results });
  } catch (err) {
    console.error('syncSheetsScheduled failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Daily backup — exports each workbook to .xlsx and saves it into its
// Drive backup folder. Replaces the old Apps Script dailyPortalBackup.js.
router.post('/internal/dailyBackup', requireInternalSecret, async (req, res) => {
  try {
    const report = await runDailyBackup();
    console.log('Daily backup:', report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('dailyBackup failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// One-time (or occasional manual) trigger to pre-create tabs for Live
// tier tables that have never had a row written yet — Live tables
// normally only get their tab on the first real app write (syncLiveRow),
// so a brand-new empty Live table has no tab at all until then. This
// runs the same query + empty-table-safe header logic as syncTier below,
// just scoped to tier === 'live' and using syncFullSnapshot once instead
// of waiting for organic writes.
router.post('/internal/initLiveSheetTabs', requireInternalSecret, async (req, res) => {
  const results = [];
  for (const [tableName, config] of Object.entries(TABLE_REGISTRY)) {
    if (config.tier !== 'live') continue;
    await sleep(1500); // stay under Sheets API's ~60 writes/min quota
    try {
      const result = await pool.query(config.query);
      const rows = result.rows;
      const headers = rows.length > 0 ? Object.keys(rows[0]) : result.fields.map(f => f.name);
      if (headers.length > 0) {
        await syncFullSnapshot(SPREADSHEET_IDS[config.sheet], config.tab, headers, rows, !!config.hideKeyColumn);
      }
      results.push({ table: tableName, rows: rows.length, status: 'ok' });
    } catch (err) {
      results.push({ table: tableName, status: 'error', error: err.message });
    }
  }
  res.json({ success: true, results });
});

// Sheet → DB pull — Users, Projects, Item Codes, Material Buffer %,
// Vendor Information. See lib/sheetsPull.js for per-table specifics
// (Item Codes in particular has a sequence-safety caveat, read it).
router.post('/internal/pullSheetsToDb', requireInternalSecret, async (req, res) => {
  try {
    // Optional { table, rowsChanged } — rowsChanged (from the onEdit
    // trigger) scopes the sync to just the specific row(s)/column(s)
    // that were actually edited, instead of resyncing the whole tab.
    // Omitted table -> pulls all five (scheduled job); table without
    // rowsChanged -> full resync of that one tab (manual/bulk-edit case).
    const report = await pullEditableSheetsToDb(req.body?.table, req.body?.rowsChanged);
    console.log('Sheets-to-DB pull:', req.body?.table || 'ALL', req.body?.rowsChanged ? `(targeted: ${req.body.rowsChanged.length} row(s))` : '(full)', report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('pullSheetsToDb failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
