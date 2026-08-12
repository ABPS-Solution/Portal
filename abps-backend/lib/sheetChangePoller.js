// ═══════════════════════════════════════════════════════════════════════
// lib/sheetChangePoller.js — drains admin_db.sheet_change_log (populated
// by DB triggers on every write, app or raw SQL) and pushes each changed
// row to its sheet via syncLiveRow's re-query mechanism. This is the
// authoritative sync path for every triggered table; the tier-based
// partial/scheduled cron jobs remain purely as a backstop for the window
// this instance is scaled to zero (per explicit decision — not worth
// --min-instances for a tool this size).
//
// Retry-safe: a log entry is only deleted after its sync ACTUALLY
// succeeds (awaited, not fire-and-forget). A failed Sheets API call
// (rate limit, expired token, network blip) leaves the entry in place
// for the next poll instead of silently losing that change forever.
// ═══════════════════════════════════════════════════════════════════════
const { pool } = require('../db');
const { syncLiveRow, removeLiveRow } = require('./liveSync');

const REAL_TABLE_TO_REGISTRY_KEY = {
  'admin_db.users': 'users',
  'admin_db.gmail_connections': 'gmail_connections',
  'marketing.companies': 'companies',
  'marketing.leads': 'leads',
  'marketing.follow_ups': 'follow_ups',
  'marketing.tasks': 'tasks',
  'marketing.purchase_order_information': 'purchase_order_information',
  'marketing.offers_sent': 'offers_sent',
  'marketing.cold_introductory_emails_sent': 'cold_introductory_emails_sent',
  'marketing.uploaded_document_information': 'uploaded_document_information',
  'marketing.processed_emails': 'processed_emails',
  'project.projects': 'projects',
  'design.item_codes': 'item_codes',
  'design.boq_drafts': 'boq_drafts',
  'design.bill_of_quantity': 'bill_of_quantity',
  'design.boq_update_requests': 'boq_update_requests',
  'purchase.vendor_information': 'vendor_information',
  'purchase.purchase_request_notes': 'purchase_request_notes',
  'purchase.raw_material_purchase_orders': 'raw_material_purchase_orders',
  'purchase.pps_tracking': 'pps_tracking',
  'purchase.vendor_performance': 'vendor_performance',
  'purchase.material_buffer_percentage': 'material_buffer_percentage',
  'purchase.prn_line_items': 'prn_line_items',
  'purchase.raw_material_po_line_items': 'raw_material_po_line_items',
  'store.raw_material_store': 'raw_material_store',
  'store.spare_store': 'spare_store',
  'store.inbound_store_ledger': 'inbound_store_ledger',
  'store.outbound_store_ledger': 'outbound_store_ledger',
  'store.store_tickets': 'store_tickets',
  'store.stock_sweeps': 'stock_sweeps',
  'store.rejected_missing_material_tracking': 'rejected_missing_material_tracking',
  'store.stock_reservations': 'stock_reservations',
  'production.finished_goods_inventory': 'finished_goods_inventory',
  'production.job_card_materials': 'job_card_materials',
  'production.job_cards': 'job_card_number',
  'accounts.tour_employees': 'tour_employees',
  'accounts.tour_advances': 'tour_advances',
  'accounts.tour_vouchers': 'tour_vouchers',
};

let polling = false;

async function pollSheetChangeLog() {
  if (polling) return;
  polling = true;
  try {
    const { rows } = await pool.query(
      `SELECT change_id, schema_name, table_name, key_value, operation
       FROM admin_db.sheet_change_log ORDER BY change_id ASC LIMIT 300`
    );
    if (rows.length === 0) return;

    // Group ALL change_ids for the same (table, key) together, keeping
    // only the latest operation — but every change_id in the group still
    // needs deleting once that latest state is synced.
    const grouped = new Map();
    for (const r of rows) {
      const mapKey = `${r.schema_name}.${r.table_name}:${r.key_value}`;
      const existing = grouped.get(mapKey);
      if (existing) {
        existing.changeIds.push(r.change_id);
        existing.operation = r.operation; // rows arrive in change_id ASC order, so this ends up latest
      } else {
        grouped.set(mapKey, {
          changeIds: [r.change_id],
          registryKey: REAL_TABLE_TO_REGISTRY_KEY[`${r.schema_name}.${r.table_name}`],
          keyValue: r.key_value,
          operation: r.operation,
        });
      }
    }

    const succeededIds = [];

    for (const { changeIds, registryKey, keyValue, operation } of grouped.values()) {
      if (!registryKey || keyValue === null) {
        succeededIds.push(...changeIds); // no sheet mapping — nothing to retry
        continue;
      }
      try {
        if (operation === 'DELETE') {
          await removeLiveRow(registryKey, keyValue, true, true);
        } else {
          await syncLiveRow(registryKey, keyValue, true, true);
        }
        succeededIds.push(...changeIds);
      } catch (err) {
        console.error(`Sheet sync failed, will retry: ${registryKey}/${keyValue}:`, err.message);
        // Deliberately NOT added to succeededIds — stays queued for retry.
      }
    }

    if (succeededIds.length > 0) {
      await pool.query(`DELETE FROM admin_db.sheet_change_log WHERE change_id = ANY($1)`, [succeededIds]);
    }
  } catch (err) {
    console.error('pollSheetChangeLog failed:', err.message);
  } finally {
    polling = false;
  }
}

module.exports = { pollSheetChangeLog };