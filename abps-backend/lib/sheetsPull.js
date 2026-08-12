// ═══════════════════════════════════════════════════════════════════════
// lib/sheetsPull.js — Sheet → DB direction.
//
// Existing sync (liveSync.js/sheetsSync.js) only ever goes DB → Sheet.
// This file is the other direction: a human edits a cell (or adds a new
// row) in Google Sheets, and on the next scheduled run, that edit gets
// written into Postgres.
//
// Editable tables (this pass): Users, Projects, Item Codes,
// Material Buffer %, Vendor Information. All five allow BOTH editing
// existing rows AND creating new rows by typing a new key into the
// sheet, per explicit decision.
//
// Tour Expense Tracker's pilot two-way sync has been REMOVED — that
// sheet (Employees/Advances/Vouchers) is no longer pulled from. Voucher
// checking still only happens through the app, same as before.
//
// Conflict handling: last-write-wins, same as the original pilot. If a
// Sheet edit and a live app write land in the same cycle, whichever
// this run reads last is what ends up in the DB. Acceptable given edits
// are expected to be rare relative to app traffic.
//
// KNOWN RISK, READ THIS: Item Codes' primary key (item_code, e.g.
// "IC-042") is normally generated from a real Postgres sequence
// (design.item_code_seq) inside createItemCode. A brand-new row typed
// into the sheet has no way to consume that sequence via a typed value
// -- so pullItemCodes deliberately IGNORES whatever the sheet's "Item
// Code" column contains for NEW rows and always allocates a fresh code
// from the same sequence createItemCode uses. This means: type a new
// Material Name with a blank/unrecognized Item Code to create one, but
// the ID that actually lands in the DB (and gets written back to the
// sheet in the next sync) may not match anything you typed in that
// cell. Existing item codes are matched and updated by their real
// value as normal. No such issue exists for the other four tables --
// their keys (email, project_id, type_of_material, vendor_name) are
// natural business keys the app never auto-increments.
// ═══════════════════════════════════════════════════════════════════════
const { pool } = require('../db');
const { getSheetsClient } = require('./sheetsSync');
const { SPREADSHEET_IDS } = require('./sheetsRegistry');

// Reads every row of a tab, including the hidden column A (Sheets API
// still returns hidden-column values — "hidden" is a display property
// only, not a data exclusion).
async function readTabRows(spreadsheetId, tabName) {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:Z` });
  const [headerRow, ...rows] = data.values || [];
  if (!headerRow) return [];
  return rows
    .filter((r) => r.some((cell) => cell !== undefined && cell !== ''))
    .map((r) => Object.fromEntries(headerRow.map((h, i) => [h, r[i] !== undefined ? r[i] : ''])));
}

// Parses a Sheet cell into a number, or undefined if invalid (non-blank,
// non-numeric text typed into a numeric column) — undefined signals
// "skip this row, don't guess," same convention the Tour Expense pilot used.
function parseNumericCell(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = Number(String(val).replace(/,/g, '').trim());
  return isNaN(n) ? undefined : n;
}

function parseBooleanCell(val) {
  return /^(true|yes|1)$/i.test(String(val ?? '').trim());
}

// ── Generic engine ────────────────────────────────────────────────────
// Handles the common case: one sheet tab, one DB table, a natural-key
// column, a flat header->column mapping. Item Codes does NOT use this
// (see the sequence-safety note above) — it has its own function below.
//
// config:
//   table, pkColumn, pkHeader, sheetGroup, tabName  — where data lives
//   columns: { "Sheet Header": "db_column", ... }   — plain text/columns
//   booleanColumns: Set of db_column names to parse as true/false
//   numericColumns: Set of db_column names to parse as numbers
//   resolvers: { "Sheet Header": { column: "db_column", fn: async (cellValue) => dbValue } }
//              — for columns that need a lookup (e.g. Department name -> department_id)
//   allowCreate: boolean — if false, unmatched keys are skipped, not inserted
async function pullEditableTable(report, config) {
  const { table, pkColumn, pkHeader, sheetGroup, tabName, columns,
          booleanColumns = new Set(), numericColumns = new Set(), resolvers = {}, allowCreate = true } = config;

  const rows = await readTabRows(SPREADSHEET_IDS[sheetGroup], tabName);
  for (const row of rows) {
    const pkVal = (row[pkHeader] || '').toString().trim();
    if (!pkVal) continue; // blank key = blank sheet row, not an error

    try {
      const values = {};
      let invalidNumeric = null;
      for (const [header, column] of Object.entries(columns)) {
        const raw = row[header];
        if (booleanColumns.has(column)) {
          values[column] = parseBooleanCell(raw);
        } else if (numericColumns.has(column)) {
          const n = parseNumericCell(raw);
          if (n === undefined) { invalidNumeric = header; break; }
          values[column] = n;
        } else {
          values[column] = (raw === '' || raw === undefined) ? null : raw;
        }
      }
      if (invalidNumeric) {
        report.skipped.push({ tab: tabName, reason: `Non-numeric "${invalidNumeric}"`, pkVal });
        continue;
      }
      for (const [header, resolver] of Object.entries(resolvers)) {
        values[resolver.column] = await resolver.fn(row[header]);
      }

      const { rows: [existing] } = await pool.query(`SELECT 1 FROM ${table} WHERE ${pkColumn} = $1`, [pkVal]);
      const cols = Object.keys(values);

      if (!existing) {
        if (!allowCreate) {
          report.skipped.push({ tab: tabName, reason: 'Not found in DB, creation disabled for this table', pkVal });
          continue;
        }
        const allCols = [pkColumn, ...cols];
        const allVals = [pkVal, ...cols.map((c) => values[c])];
        const placeholders = allVals.map((_, i) => `$${i + 1}`);
        await pool.query(`INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${placeholders.join(', ')})`, allVals);
        report.created.push({ tab: tabName, pkVal });
      } else {
        const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
        await pool.query(`UPDATE ${table} SET ${setClause} WHERE ${pkColumn} = $1`, [pkVal, ...cols.map((c) => values[c])]);
        report.updated.push({ tab: tabName, pkVal });
      }
    } catch (err) {
      report.errors.push({ tab: tabName, pkVal, error: err.message });
    }
  }
}

// ── Projects ──────────────────────────────────────────────────────────
async function pullProjects(report) {
  await pullEditableTable(report, {
    table: 'project.projects', pkColumn: 'project_id', pkHeader: 'Project ID',
    sheetGroup: 'PROJECT', tabName: 'Projects',
    columns: {
      'Project Status': 'project_status',
      'Company Name': 'company_name',
      'PO Number': 'po_number',
      'Delivery Date': 'delivery_date',
    },
  });
}

// ── Item Codes (bespoke — sequence safety, see note at top of file) ───
async function pullItemCodes(report) {
  const rows = await readTabRows(SPREADSHEET_IDS.DESIGN, 'Item Codes');
  for (const row of rows) {
    const materialName = (row['Material Name'] || '').trim();
    const typedItemCode = (row['Item Code'] || '').trim();
    if (!materialName) continue; // blank row

    const values = {
      material_name: materialName,
      rating: row['Rating'] || null,
      type_of_material: row['Type of Material'] || null,
      unit: row['Unit'] || null,
    };

    try {
      if (typedItemCode) {
        const { rows: [existing] } = await pool.query(`SELECT 1 FROM design.item_codes WHERE item_code = $1`, [typedItemCode]);
        if (existing) {
          await pool.query(
            `UPDATE design.item_codes SET material_name = $1, rating = $2, type_of_material = $3, unit = $4 WHERE item_code = $5`,
            [values.material_name, values.rating, values.type_of_material, values.unit, typedItemCode]
          );
          report.updated.push({ tab: 'Item Codes', pkVal: typedItemCode });
          continue;
        }
        // Typed code doesn't exist in DB — treated as a new row below,
        // but per the top-of-file note, we do NOT trust the typed code
        // itself as the new primary key. Flagged so it's visible, not silent.
        report.skipped.push({ tab: 'Item Codes', reason: 'Typed Item Code not found — creating a fresh code instead (see sheetsPull.js note)', typedItemCode, materialName });
      }

      // New row: allocate a real code from the same sequence createItemCode uses.
      const { rows: [seq] } = await pool.query(`SELECT nextval('design.item_code_seq') AS n`);
      const newItemCode = `ABPS${String(seq.n).padStart(5, '0')}`;
      await pool.query(
        `INSERT INTO design.item_codes (item_code, material_name, rating, type_of_material, unit, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newItemCode, values.material_name, values.rating, values.type_of_material, values.unit, null]
      );
      report.created.push({ tab: 'Item Codes', pkVal: newItemCode, note: typedItemCode ? `sheet had "${typedItemCode}"` : undefined });
    } catch (err) {
      report.errors.push({ tab: 'Item Codes', pkVal: typedItemCode || materialName, error: err.message });
    }
  }
}

// ── Material Buffer % ────────────────────────────────────────────────
async function pullMaterialBufferPercentage(report) {
  await pullEditableTable(report, {
    table: 'purchase.material_buffer_percentage', pkColumn: 'type_of_material', pkHeader: 'Type of Material',
    sheetGroup: 'PURCHASE', tabName: 'Material Buffer %',
    columns: { 'Buffer %': 'buffer_percent' },
    numericColumns: new Set(['buffer_percent']),
  });
}

// ── Master Inventory (TEMPORARY — testing only, remove before go-live) ──
// Lets a tester directly overwrite stock quantities from the Sheet without
// going through GRN/QA. update-only (allowCreate:false) — item_code rows
// must already exist via the normal Item Codes -> GRN flow.
async function pullMasterInventory(report) {
  await pullEditableTable(report, {
    table: 'store.raw_material_store', pkColumn: 'item_code', pkHeader: 'Item Code',
    sheetGroup: 'INVENTORY', tabName: 'Raw Material Store',
    columns: {
      'Total Stock': 'total_stock',
      'Reserved Stock': 'reserved_stock',
    },
    numericColumns: new Set(['total_stock', 'reserved_stock']),
    allowCreate: false,
  });
}

// ── Spare Inventory (TEMPORARY — testing only, remove before go-live) ──
async function pullSpareInventory(report) {
  await pullEditableTable(report, {
    table: 'store.spare_store', pkColumn: 'item_code', pkHeader: 'Item Code',
    sheetGroup: 'INVENTORY', tabName: 'Spare Store',
    columns: {
      'Total Stock': 'total_stock',
      'Unusable Stock': 'unusable_stock',
      'Reserved Stock': 'reserved_stock',
    },
    numericColumns: new Set(['total_stock', 'unusable_stock', 'reserved_stock']),
    allowCreate: false,
  });
}

// ── Vendor Information ───────────────────────────────────────────────
async function pullVendorInformation(report) {
  await pullEditableTable(report, {
    table: 'purchase.vendor_information', pkColumn: 'vendor_name', pkHeader: 'Vendor Name',
    sheetGroup: 'PURCHASE', tabName: 'Vendor Information',
    columns: {
      'GSTIN/UIN': 'gstin_uin',
      'Type of Vendor': 'type_of_vendor',
      'Contact Person': 'contact_person',
      'Phone': 'phone_number',
      'Email': 'email',
      'City': 'city',
      'State': 'state',
      'State Code': 'state_code',
      'CGST %': 'cgst_percent',
      'SGST %': 'sgst_percent',
      'IGST %': 'igst_percent',
      'Address': 'address',
      'Status': 'status',
    },
    numericColumns: new Set(['cgst_percent', 'sgst_percent', 'igst_percent']),
  });
}

// ── Users (bespoke — Department is a lookup, not a plain column) ──────
// Full perm_* column set, kept in sync with permMap.js and this table's
// DB->Sheet query in sheetsRegistry.js — if a permission is added there,
// add it here too or it won't be Sheet-editable.
const USER_PERM_HEADERS = {
  'Admin': 'perm_admin',
  'Card Details': 'perm_card_details', 'Email Leads': 'perm_email_leads',
  'Upload Dispatch Bill': 'perm_dispatch_bill', 'Upload Commissioning Report': 'perm_commissioning_report', 'Upload Purchase Order': 'perm_purchase_order',
  'Search Company': 'perm_search_company', 'Search Tasks': 'perm_search_tasks', 'Search Status': 'perm_search_status',
  'Search Qualification': 'perm_search_qualification', 'Search City/State': 'perm_search_city_state',
  'Marketing Dashboard': 'perm_marketing_dashboard',
  'Create BOQ': 'perm_create_boq', 'Authorize BOQ': 'perm_authorize_boq', 'Update BOQ': 'perm_update_boq',
  'Authorize BOQ Update': 'perm_authorize_boq_update', 'Upload Drawings': 'perm_upload_drawings',
  'Design Dashboard': 'perm_design_dashboard',
  'Purchase Request Note': 'perm_purchase_request_note', 'Material List For Purchase': 'perm_material_list_purchase',
  'Reserve Store Stock': 'perm_reserve_store_stock', 'Expected Deliveries': 'perm_expected_deliveries',
  'Manufacturing Clearance': 'perm_manufacturing_clearance', 'Project Status': 'perm_project_status', 'Rejected Material': 'perm_store_inward_rejected',
  'Project Invoice Generation': 'perm_project_invoice_generation',
  'Create RM Purchase Order': 'perm_create_rm_po', 'Authorize RM Purchase Order': 'perm_authorize_rm_po',
  'Search RM Purchase Order': 'perm_search_rm_po',
  'PPS Tracking': 'perm_pps_tracking', 'Purchase Dashboard': 'perm_purchase_dashboard',
  'Gate Entry': 'perm_gate_entry', 'Store Entry and GRN': 'perm_store_entry_and_grn', 'QA Check': 'perm_qa_check',
  'Approve JC Increase': 'perm_approve_job_card_increase', 'Item Code Access': 'perm_item_code_access',
  'Live Spare Store Stock': 'perm_live_spare_stock', 'Live RM Store Stock': 'perm_live_rm_stock', 'Live FG Store Stock': 'perm_live_fg_stock',
  'Create Store Ticket': 'perm_create_store_ticket', 'Approve Store Tickets': 'perm_approve_store_tickets',
  'Store Admin Matrix': 'perm_search_store_tickets', 'Store Dashboard': 'perm_store_dashboard',
  'Add Finished Goods Store': 'perm_add_finished_goods_store', 'Production Dashboard': 'perm_production_dashboard',
  'Job Card Letterhead': 'perm_job_card_letterhead', 'Tour Expense': 'perm_tour_expense',
  'Authorize PRN': 'perm_authorize_prn', 'Revise PRN': 'perm_revise_prn', 'Authorize PRN Revision': 'perm_authorize_prn_revision',
  'Revise RM Purchase Order': 'perm_revise_rm_po', 'Authorize RM Purchase Order Revision': 'perm_authorize_rm_po_revision',
};

async function pullUsers(report, rowsChanged) {
  // rowsChanged (from the onEdit trigger): [{ rowKey: email, changedHeaders: [...] }]
  // When present, ONLY the listed rows are touched, and ONLY the specific
  // permission columns whose headers were actually edited get written —
  // every other perm_* column is left completely alone, instead of being
  // re-set to whatever the sheet currently shows (which is what silently
  // clobbered unrelated permissions before this fix, any time the DB and
  // sheet had drifted apart, e.g. after a direct SQL edit).
  const targetEmails = rowsChanged ? new Set(rowsChanged.map(r => r.rowKey.trim().toLowerCase())) : null;
  const headersByEmail = rowsChanged
    ? Object.fromEntries(rowsChanged.map(r => [r.rowKey.trim().toLowerCase(), r.changedHeaders]))
    : null;

  const rows = await readTabRows(SPREADSHEET_IDS.ADMIN, 'Users');
  for (const row of rows) {
    const email = (row['Email'] || '').trim().toLowerCase();
    if (!email) continue;
    if (targetEmails && !targetEmails.has(email)) continue; // not one of the edited rows — skip entirely

    const values = {};
    // Core (non-permission) fields only update if they were the actual
    // edited column, or if this is a full/untargeted sync.
    const editedHeaders = headersByEmail ? headersByEmail[email] : null;
    const touchesHeader = (h) => !editedHeaders || editedHeaders.includes(h);
    if (touchesHeader('First Name')) values.first_name = row['First Name'] || null;
    if (touchesHeader('Last Name')) values.last_name = row['Last Name'] || null;
    if (touchesHeader('Status')) values.status = row['Status'] || 'Active';

    for (const [header, column] of Object.entries(USER_PERM_HEADERS)) {
      if (!touchesHeader(header)) continue; // targeted sync: skip every permission column that wasn't edited
      values[column] = parseBooleanCell(row[header]);
    }

    try {
      // Department is a name in the sheet but department_id in the DB —
      // unresolvable names are logged and left unset rather than guessed.
      // Only looked up if it's part of this sync (untargeted, or the
      // Department column was the one actually edited).
      let departmentId = undefined;
      if (touchesHeader('Department')) {
        const deptName = (row['Department'] || '').trim();
        if (deptName) {
          const { rows: [dept] } = await pool.query(`SELECT department_id FROM admin_db.departments WHERE name = $1`, [deptName]);
          if (dept) departmentId = dept.department_id;
          else report.skipped.push({ tab: 'Users', reason: `Unknown Department "${deptName}" — left unchanged`, email });
        }
      }

      const { rows: [existing] } = await pool.query(`SELECT 1 FROM admin_db.users WHERE email = $1`, [email]);
      const cols = Object.keys(values);
      if (departmentId !== undefined) cols.push('department_id');
      const colValues = { ...values, ...(departmentId !== undefined ? { department_id: departmentId } : {}) };

      if (cols.length === 0) { report.skipped.push({ tab: 'Users', reason: 'No mapped columns in edited range', email }); continue; }

      if (!existing) {
        const allCols = ['email', ...cols];
        const allVals = [email, ...cols.map((c) => colValues[c])];
        const placeholders = allVals.map((_, i) => `$${i + 1}`);
        await pool.query(`INSERT INTO admin_db.users (${allCols.join(', ')}) VALUES (${placeholders.join(', ')})`, allVals);
        report.created.push({ tab: 'Users', pkVal: email });
      } else {
        const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
        await pool.query(`UPDATE admin_db.users SET ${setClause} WHERE email = $1`, [email, ...cols.map((c) => colValues[c])]);
        report.updated.push({ tab: 'Users', pkVal: email });
      }
    } catch (err) {
      report.errors.push({ tab: 'Users', pkVal: email, error: err.message });
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────
// tableKey: optional — one of PULLABLE_TABLES' keys below. Passed by the
// onEdit-triggered Apps Script so a single cell edit only re-pulls the
// ONE tab it happened in, not all five (keeps this fast enough to feel
// instant, and keeps Sheets API read volume sane on a busy paste).
// Omit tableKey (or call from the scheduled route with none) to pull
// everything, same as before.
const PULLABLE_TABLES = {
  users: pullUsers,
  projects: pullProjects,
  item_codes: pullItemCodes,
  material_buffer_percentage: pullMaterialBufferPercentage,
  vendor_information: pullVendorInformation,
  raw_material_store: pullMasterInventory,
  spare_store: pullSpareInventory,
};

async function pullEditableSheetsToDb(tableKey, rowsChanged) {
  const report = { created: [], updated: [], skipped: [], errors: [] };
  if (tableKey) {
    const fn = PULLABLE_TABLES[tableKey];
    if (!fn) { report.errors.push({ error: `Unknown table key "${tableKey}"` }); return report; }
    await fn(report, rowsChanged);
    return report;
  }
  for (const fn of Object.values(PULLABLE_TABLES)) await fn(report);
  return report;
}

module.exports = { pullEditableSheetsToDb, PULLABLE_TABLES: Object.keys(PULLABLE_TABLES) };