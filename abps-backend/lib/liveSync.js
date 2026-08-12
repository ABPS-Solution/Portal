// ═══════════════════════════════════════════════════════════════════════
// lib/liveSync.js — sync helper for Live-tier tables, and the underlying
// mechanism the trigger-driven sheetChangePoller uses for EVERY table.
// Default call shape stays fire-and-forget (never awaited in a way that
// blocks a route's response) for every existing app-level call site.
// The poller passes awaitable=true to get a real Promise it can await
// and retry on failure, instead of losing a change silently.
// ═══════════════════════════════════════════════════════════════════════
const { pool } = require('../db');
const { upsertRow, deleteRow } = require('./sheetsSync');
const { SPREADSHEET_IDS, TABLE_REGISTRY } = require('./sheetsRegistry');

function syncLiveRow(tableName, keyValue, force = false, awaitable = false) {
  const config = TABLE_REGISTRY[tableName];
  // force=true bypasses the tier gate — used only by the trigger-driven
  // poller, which is authoritative for ALL tables now (DB-level, catches
  // raw SQL too). Every existing app-level call site is unaffected:
  // force defaults false, so non-live tables still aren't touched by a
  // stray in-app call, exactly as before.
  if (!config || (!force && config.tier !== 'live')) return awaitable ? Promise.resolve() : undefined;

  // Re-query just this one row using the registry's existing query as a
  // base (wrapped as a subquery, filtered by the key column) — reuses
  // the same column aliases so headers always match what's already on
  // the sheet, without needing a second hand-written query per table.
  const work = (async () => {
    const { rows } = await pool.query(
      `SELECT * FROM (${config.query}) sub WHERE sub."${config.keyColumn}" = $1`,
      [keyValue]
    );
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    await upsertRow(SPREADSHEET_IDS[config.sheet], config.tab, headers, config.keyColumn, rows[0], !!config.hideKeyColumn);

    // A computed per-group Sr No (bill_of_quantity/prn_line_items/
    // raw_material_po_line_items) shifts for every sibling whenever one
    // row in the group is added — re-push all of them, not just this row.
    if (config.groupColumn) {
      const groupValue = rows[0][config.groupColumn];
      const { rows: siblings } = await pool.query(
        `SELECT * FROM (${config.query}) sub WHERE sub."${config.groupColumn}" = $1 AND sub."${config.keyColumn}" != $2`,
        [groupValue, keyValue]
      );
      for (const sib of siblings) {
        await upsertRow(SPREADSHEET_IDS[config.sheet], config.tab, headers, config.keyColumn, sib, !!config.hideKeyColumn);
      }
    }
  })();

  if (awaitable) return work; // caller (the poller) awaits and retries on failure

  work.catch(err => console.error(`liveSync failed for ${tableName}/${keyValue}:`, err.message));
}

// removeLiveRow — delete counterpart. No re-query needed (the row is
// already gone from the DB by the time this runs) — just the registry's
// keyColumn/tab/sheet and the key value that identified the deleted row.
function removeLiveRow(tableName, keyValue, force = false, awaitable = false) {
  const config = TABLE_REGISTRY[tableName];
  if (!config || (!force && config.tier !== 'live')) return awaitable ? Promise.resolve() : undefined;

  const work = (async () => {
    const groupValue = await deleteRow(SPREADSHEET_IDS[config.sheet], config.tab, config.keyColumn, keyValue, config.groupColumn);
    if (config.groupColumn && groupValue != null) {
      const { rows: siblings } = await pool.query(
        `SELECT * FROM (${config.query}) sub WHERE sub."${config.groupColumn}" = $1`,
        [groupValue]
      );
      if (siblings.length > 0) {
        const headers = Object.keys(siblings[0]);
        for (const sib of siblings) {
          await upsertRow(SPREADSHEET_IDS[config.sheet], config.tab, headers, config.keyColumn, sib, !!config.hideKeyColumn);
        }
      }
    }
  })();

  if (awaitable) return work;

  work.catch(err => console.error(`removeLiveRow failed for ${tableName}/${keyValue}:`, err.message));
}

module.exports = { syncLiveRow, removeLiveRow };