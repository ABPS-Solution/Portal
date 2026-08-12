======================================================================================================================================================
001_add_boq_pdf_url.sql
======================================================================================================================================================

-- Run this against your existing Cloud SQL instance â€” adds the one
-- column bill_of_quantity was missing for the new PDF generation
-- feature. purchase_request_notes and raw_material_purchase_orders
-- already had pdf_url / drive_file_url columns from the original schema.
ALTER TABLE design.bill_of_quantity ADD COLUMN IF NOT EXISTS pdf_url TEXT;


======================================================================================================================================================
002_add_po_original_document_url.sql
======================================================================================================================================================

-- Adds a column to hold the vendor's original uploaded PO/invoice scan,
-- distinct from drive_file_url which holds our own auto-generated PO PDF.
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS original_document_url TEXT;


======================================================================================================================================================
003_add_gmail_connections.sql
======================================================================================================================================================

-- Stores one refresh token per connected Gmail account (personal or
-- Workspace) â€” replaces the env-var-per-account approach, which doesn't
-- scale past a couple of accounts and can't be self-served by whoever
-- is connecting a new inbox.
CREATE TABLE IF NOT EXISTS admin_db.gmail_connections (
  email             TEXT PRIMARY KEY,
  refresh_token     TEXT NOT NULL,
  connected_by      TEXT REFERENCES admin_db.users(email),
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Revoked', 'Error'))
);


======================================================================================================================================================
004_add_project_po_delivery_columns.sql
======================================================================================================================================================

-- Projects sheet in code.js tracked PO Number and Delivery Date directly
-- on each project row â€” used for (a) the duplicate-PO guard when a new
-- PO is uploaded via Marketing, and (b) the Manufacturing Clearance
-- screen's delivery date column. Missing from the original schema pass.
ALTER TABLE design.projects ADD COLUMN IF NOT EXISTS po_number TEXT;
ALTER TABLE design.projects ADD COLUMN IF NOT EXISTS delivery_date DATE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_po_number ON design.projects(po_number) WHERE po_number IS NOT NULL;


======================================================================================================================================================
005_add_boq_update_requests.sql
======================================================================================================================================================

-- design.boq_update_requests â€” Engineering Change Management. Amendments
-- are proposed here, isolated from the live authorized bill_of_quantity
-- row, which stays locked and untouched until an admin signs off. Only
-- on approval does the master row get updated (new values + version bump).
CREATE TABLE IF NOT EXISTS design.boq_update_requests (
  update_id           BIGSERIAL PRIMARY KEY,
  boq_id                TEXT NOT NULL REFERENCES design.bill_of_quantity(boq_id),
  requested_by             TEXT REFERENCES admin_db.users(email),
  justification              TEXT NOT NULL,
  old_material_rows            JSONB NOT NULL,
  new_material_rows              JSONB NOT NULL,
  old_order_quantity                NUMERIC(14,3),
  new_order_quantity                  NUMERIC(14,3),
  status                                 TEXT NOT NULL DEFAULT 'Pending Authorization Update'
                                            CHECK (status IN ('Pending Authorization Update','Authorized','Rejected')),
  authorized_by                            TEXT REFERENCES admin_db.users(email),
  created_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_at                                TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_boqupdates_boq ON design.boq_update_requests(boq_id);
CREATE INDEX IF NOT EXISTS idx_boqupdates_status ON design.boq_update_requests(status);


======================================================================================================================================================
006_expand_store_tickets_status.sql
======================================================================================================================================================

-- The Job Card Increase approval workflow uses two statuses not in the
-- original store_tickets CHECK constraint: 'Rejected by Admin' (admin
-- declines the increase) and 'Approved & Released' (admin approves,
-- follow-up release ticket created). Widening the constraint to match.
ALTER TABLE inventory.store_tickets DROP CONSTRAINT IF EXISTS store_tickets_status_check;
ALTER TABLE inventory.store_tickets ADD CONSTRAINT store_tickets_status_check
  CHECK (status IN ('Pending','Approved','Rejected','Pending BOQ Increase Review','Fulfilled',
                     'Rejected by Admin','Approved & Released'));


======================================================================================================================================================
007_add_repair_status.sql
======================================================================================================================================================

ALTER TABLE inventory.rejected_material_tracking DROP CONSTRAINT IF EXISTS rejected_material_tracking_status_check;
ALTER TABLE inventory.rejected_material_tracking ADD CONSTRAINT rejected_material_tracking_status_check
  CHECK (status IN ('Open','Under Review','Resolved','At ABPS - Under Repair'));


======================================================================================================================================================
008_add_gemini_ratelimit_and_ledger_pono.sql
======================================================================================================================================================

-- Per-user Gemini call log, used by lib/gemini.js's checkGeminiRateLimit.
-- A DB table (not in-memory) because Cloud Run can run multiple
-- instances â€” an in-memory counter would only cap calls per-instance.
CREATE TABLE IF NOT EXISTS admin_db.gemini_call_log (
  id            BIGSERIAL PRIMARY KEY,
  user_email      TEXT NOT NULL,
  action_name       TEXT NOT NULL,
  called_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geminicalllog_user_time ON admin_db.gemini_call_log(user_email, called_at);

-- Prune old rows periodically (optional cleanup â€” this table only needs
-- the last ~60 seconds of data to function; run manually or via a
-- scheduled job if the table grows large over time).
-- DELETE FROM admin_db.gemini_call_log WHERE called_at < now() - interval '1 day';

-- po_no on inbound_store_ledger: links a Gate Entry / GRN row back to the
-- Purchase Order that generated the demand, needed for PPS Tracking to
-- auto-update actual_delivery_date / actual_received_quantity when
-- material physically arrives (see routes/inventory.js commitStoreQAPipelineStep).
ALTER TABLE inventory.inbound_store_ledger ADD COLUMN IF NOT EXISTS po_no TEXT;
CREATE INDEX IF NOT EXISTS idx_inboundledger_pono ON inventory.inbound_store_ledger(po_no);


======================================================================================================================================================
009_add_boq_no_cost_pdf_url.sql
======================================================================================================================================================

ALTER TABLE design.bill_of_quantity ADD COLUMN IF NOT EXISTS pdf_url_no_cost TEXT;


======================================================================================================================================================
010_add_marketing_doc_urls.sql
======================================================================================================================================================

-- Stores the actual uploaded file URL for each document type on
-- uploaded_document_information, routed to the correct Drive folder
-- per code.js's original folderIds mapping (PO_FOLDER_ID, DISPATCH_FOLDER_ID,
-- COMMISSION_FOLDER_ID).
ALTER TABLE marketing.uploaded_document_information ADD COLUMN IF NOT EXISTS po_document_url TEXT;
ALTER TABLE marketing.uploaded_document_information ADD COLUMN IF NOT EXISTS dispatch_document_url TEXT;
ALTER TABLE marketing.uploaded_document_information ADD COLUMN IF NOT EXISTS commission_document_url TEXT;


======================================================================================================================================================
011_add_stock_assignment_prn_and_docs.sql
======================================================================================================================================================

-- stock_assignments needs prn_id: the "Assign Current Stock" screen and
-- reassignStockBetweenPRNs both operate at PRN granularity (moving stock
-- between specific PRN line items), not just BOQ granularity, which the
-- original schema pass missed.
ALTER TABLE inventory.stock_assignments ADD COLUMN IF NOT EXISTS prn_id TEXT REFERENCES purchase.purchase_request_notes(prn_id);
CREATE INDEX IF NOT EXISTS idx_stockassign_prn ON inventory.stock_assignments(prn_id);


======================================================================================================================================================
012_relax_gmail_connections_fk.sql
======================================================================================================================================================

-- connected_by tracks who initiated a Gmail/Drive OAuth connection, but
-- that person doesn't need to be an existing portal user (e.g. the GCP
-- project owner authorizing an account for email polling isn't
-- necessarily in admin_db.users). Drop the FK, keep it as plain text.
ALTER TABLE admin_db.gmail_connections DROP CONSTRAINT IF EXISTS gmail_connections_connected_by_fkey;


======================================================================================================================================================
013_relax_processed_emails_fk.sql
======================================================================================================================================================

-- creator_of_note is set to 'scheduler@internal' when the scheduled
-- poller (not a logged-in user) saves a processed email â€” that's not a
-- real admin_db.users row, so the FK always fails for scheduler-triggered
-- inserts. Same fix as gmail_connections.connected_by: drop the FK,
-- keep it as plain text (still populated with a real user's email when
-- a human triggers the manual "check inbox" button).
ALTER TABLE marketing.processed_emails DROP CONSTRAINT IF EXISTS processed_emails_creator_of_note_fkey;


======================================================================================================================================================
014_split_dispatch_commission_po_permissions.sql
======================================================================================================================================================

-- 014_split_dispatch_commission_po_permissions.sql
-- Splits perm_dispatch_or_commission_or_po into 3 independently-controllable
-- permissions, matching the original Sheets source columns (see run.js line
-- ~28-29, which OR'd 3 source checkboxes into this one column during migration).
-- Old column is kept (not dropped) so nothing else silently breaks; it's just
-- no longer read by application code after this pass.

ALTER TABLE admin_db.users
  ADD COLUMN IF NOT EXISTS perm_dispatch_bill        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perm_commissioning_report  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perm_purchase_order        BOOLEAN NOT NULL DEFAULT false;

-- Backfill: anyone who had the combined permission gets all 3 to start.
-- Adjust individual users manually afterward if they should only have some.
UPDATE admin_db.users
SET perm_dispatch_bill = perm_dispatch_or_commission_or_po,
    perm_commissioning_report = perm_dispatch_or_commission_or_po,
    perm_purchase_order = perm_dispatch_or_commission_or_po
WHERE perm_dispatch_or_commission_or_po = true;


======================================================================================================================================================
015_add_tour_expense_tracker.sql
======================================================================================================================================================

-- 015_add_tour_expense_tracker.sql
-- New "Tour Expense Tracker" module under Accounts.
-- Employees here are a standalone list for this module only (not portal
-- users, no login) â€” department stored as plain text, not FK, per design
-- discussion. Balance stored as lowercase `balance`, displayed as
-- "Balance" via query aliases (same pattern as every other column in
-- this app) rather than a quoted mixed-case column name.
-- No created_by/checked_by/paid_by columns â€” accountability for these
-- actions is captured via the existing writeAuditLog() audit trail
-- instead (see lib/audit.js), same as other modules.

CREATE SCHEMA IF NOT EXISTS accounts;

CREATE TABLE IF NOT EXISTS accounts.tour_employees (
  employee_id     SERIAL PRIMARY KEY,
  employee_name   TEXT NOT NULL,
  department_name TEXT,
  balance         NUMERIC NOT NULL DEFAULT 0,   -- can go negative, by design
  status          TEXT NOT NULL DEFAULT 'Active',
  created_date    TIMESTAMP NOT NULL DEFAULT now()
);

-- Ledger of every advance paid â€” kept separate from the running balance
-- column so there's a full history, not just a running total.
CREATE TABLE IF NOT EXISTS accounts.tour_advances (
  advance_id  SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES accounts.tour_employees(employee_id),
  amount      NUMERIC NOT NULL,
  paid_date   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts.tour_vouchers (
  voucher_id       SERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES accounts.tour_employees(employee_id),
  customer_name    TEXT NOT NULL,
  purpose_of_visit TEXT,
  voucher_amount   NUMERIC NOT NULL,
  checked_amount   NUMERIC,               -- null until checked
  status           TEXT NOT NULL DEFAULT 'Unchecked' CHECK (status IN ('Unchecked', 'Checked')),
  created_date     TIMESTAMP NOT NULL DEFAULT now(),
  checked_date     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tour_advances_employee ON accounts.tour_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_tour_vouchers_employee ON accounts.tour_vouchers(employee_id);
CREATE INDEX IF NOT EXISTS idx_tour_vouchers_status ON accounts.tour_vouchers(status);

-- New permission gating the whole module (single-permission design, per
-- decision: view + pay advance + add/check vouchers all under one flag).
ALTER TABLE admin_db.users
  ADD COLUMN IF NOT EXISTS perm_tour_expense BOOLEAN NOT NULL DEFAULT false;


======================================================================================================================================================
016_rename_enquiries_to_leads.sql
======================================================================================================================================================

-- 016_rename_enquiries_to_leads.sql
-- Renames marketing.enquiries -> marketing.leads, enquiry_id -> lead_id
-- everywhere it appears (including the 5 child tables with FKs to it),
-- relabels every existing ENQ-xxxx ID to LEAD-xxxx, and updates the
-- column default so new rows auto-generate LEAD- ids going forward.
--
-- Confirmed FK list (from a live information_schema query, not assumed):
--   follow_ups, tasks, uploaded_document_information,
--   purchase_order_information, offers_sent â€” all via enquiry_id.
--
-- Everything below is one transaction: if any single step fails, the
-- whole migration rolls back and nothing is left half-renamed.

BEGIN;

-- 1. Drop the 5 known FK constraints so we're free to rename/update
--    without ordering constraints getting in the way.
ALTER TABLE marketing.follow_ups DROP CONSTRAINT follow_ups_enquiry_id_fkey;
ALTER TABLE marketing.tasks DROP CONSTRAINT tasks_enquiry_id_fkey;
ALTER TABLE marketing.uploaded_document_information DROP CONSTRAINT uploaded_document_information_enquiry_id_fkey;
ALTER TABLE marketing.purchase_order_information DROP CONSTRAINT purchase_order_information_enquiry_id_fkey;
ALTER TABLE marketing.offers_sent DROP CONSTRAINT offers_sent_enquiry_id_fkey;

-- 2. Rename the table and every enquiry_id column to lead_id.
ALTER TABLE marketing.enquiries RENAME TO leads;
ALTER TABLE marketing.leads RENAME COLUMN enquiry_id TO lead_id;
ALTER TABLE marketing.follow_ups RENAME COLUMN enquiry_id TO lead_id;
ALTER TABLE marketing.tasks RENAME COLUMN enquiry_id TO lead_id;
ALTER TABLE marketing.uploaded_document_information RENAME COLUMN enquiry_id TO lead_id;
ALTER TABLE marketing.purchase_order_information RENAME COLUMN enquiry_id TO lead_id;
ALTER TABLE marketing.offers_sent RENAME COLUMN enquiry_id TO lead_id;

-- 3. Drop the old default (it embeds the literal 'ENQ-' prefix and the
--    old sequence name) before touching data or the sequence.
ALTER TABLE marketing.leads ALTER COLUMN lead_id DROP DEFAULT;

-- 4. Rename the underlying sequence to match.
ALTER SEQUENCE marketing.enquiry_id_seq RENAME TO lead_id_seq;

-- 5. Relabel every existing ID's prefix, parent first (no FK constraints
--    active right now, so no ordering risk). Numeric suffix is preserved
--    exactly â€” 'ENQ-9001' becomes 'LEAD-9001', not renumbered.
UPDATE marketing.leads SET lead_id = 'LEAD-' || substring(lead_id from 5) WHERE lead_id LIKE 'ENQ-%';
UPDATE marketing.follow_ups SET lead_id = 'LEAD-' || substring(lead_id from 5) WHERE lead_id LIKE 'ENQ-%';
UPDATE marketing.tasks SET lead_id = 'LEAD-' || substring(lead_id from 5) WHERE lead_id LIKE 'ENQ-%';
UPDATE marketing.uploaded_document_information SET lead_id = 'LEAD-' || substring(lead_id from 5) WHERE lead_id LIKE 'ENQ-%';
UPDATE marketing.purchase_order_information SET lead_id = 'LEAD-' || substring(lead_id from 5) WHERE lead_id LIKE 'ENQ-%';
UPDATE marketing.offers_sent SET lead_id = 'LEAD-' || substring(lead_id from 5) WHERE lead_id LIKE 'ENQ-%';

-- 6. Set the new default so new rows auto-generate LEAD-xxxx ids.
ALTER TABLE marketing.leads ALTER COLUMN lead_id SET DEFAULT ('LEAD-'::text || nextval('marketing.lead_id_seq'::regclass));

-- 7. Recreate the 5 FK constraints, pointed at the renamed table/column.
ALTER TABLE marketing.follow_ups ADD CONSTRAINT follow_ups_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES marketing.leads(lead_id);
ALTER TABLE marketing.tasks ADD CONSTRAINT tasks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES marketing.leads(lead_id);
ALTER TABLE marketing.uploaded_document_information ADD CONSTRAINT uploaded_document_information_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES marketing.leads(lead_id);
ALTER TABLE marketing.purchase_order_information ADD CONSTRAINT purchase_order_information_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES marketing.leads(lead_id);
ALTER TABLE marketing.offers_sent ADD CONSTRAINT offers_sent_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES marketing.leads(lead_id);

COMMIT;

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- OPTIONAL cleanup (run separately, AFTER confirming the above worked) â€”
-- cosmetic only: renames the primary key and the unrelated engineer_name
-- FK constraint so their names match the new table name too. Not required
-- for anything to function; skip if you'd rather not risk a name-mismatch
-- error (Postgres doesn't auto-rename constraints when a table is
-- renamed, so these still say "enquiries_..." internally right now).
--
-- ALTER TABLE marketing.leads RENAME CONSTRAINT enquiries_pkey TO leads_pkey;
-- ALTER TABLE marketing.leads RENAME CONSTRAINT enquiries_engineer_name_fkey TO leads_engineer_name_fkey;
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- VERIFY:
-- SELECT count(*) FROM marketing.leads WHERE lead_id LIKE 'LEAD-%';
-- SELECT count(*) FROM marketing.leads WHERE lead_id LIKE 'ENQ-%';  -- should be 0
-- SELECT lead_id FROM marketing.leads LIMIT 3;


======================================================================================================================================================
017_lead_issue_fields_to_text.sql
======================================================================================================================================================

-- 017_lead_issue_fields_to_text.sql
-- Converts 8 columns on marketing.leads from boolean to free text, since
-- the frontend form actually collects real text ("Describe, if any" /
-- "Name of End User") or a 3-option choice (send_offer), not a plain
-- yes/no â€” the boolean columns were silently discarding that content.
--
-- HONEST CAVEAT on existing data: these columns were always boolean, so
-- there is no original free text to recover for existing rows â€” the
-- migration below preserves only the yes/no signal that already existed
-- ('Reported' / NULL), not the specific wording, for any pre-existing
-- rows. Only new submissions going forward will have real text.
-- send_offer existing TRUE rows can't be split back into which of the
-- two offer types was picked â€” they're mapped to 'Send Techno-Commercial
-- Offer' as a reasonable default; check/correct manually if you know
-- otherwise for specific existing leads.

BEGIN;

ALTER TABLE marketing.leads
  ALTER COLUMN low_power_factor_issue TYPE TEXT
    USING (CASE WHEN low_power_factor_issue THEN 'Reported' ELSE NULL END),
  ALTER COLUMN high_electricity_bill_issue TYPE TEXT
    USING (CASE WHEN high_electricity_bill_issue THEN 'Reported' ELSE NULL END),
  ALTER COLUMN harmonics_issue TYPE TEXT
    USING (CASE WHEN harmonics_issue THEN 'Reported' ELSE NULL END),
  ALTER COLUMN transformer_heating_issue TYPE TEXT
    USING (CASE WHEN transformer_heating_issue THEN 'Reported' ELSE NULL END),
  ALTER COLUMN grid_stability_issue TYPE TEXT
    USING (CASE WHEN grid_stability_issue THEN 'Reported' ELSE NULL END),
  ALTER COLUMN purchase_inquire TYPE TEXT
    USING (CASE WHEN purchase_inquire THEN 'Reported' ELSE NULL END),
  ALTER COLUMN tender_inquire TYPE TEXT
    USING (CASE WHEN tender_inquire THEN 'Reported' ELSE NULL END),
  ALTER COLUMN send_offer TYPE TEXT
    USING (CASE WHEN send_offer THEN 'Send Techno-Commercial Offer' ELSE 'No' END);

COMMIT;

-- VERIFY:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'marketing' AND table_name = 'leads'
--   AND column_name IN ('low_power_factor_issue','high_electricity_bill_issue','harmonics_issue',
--     'transformer_heating_issue','grid_stability_issue','purchase_inquire','tender_inquire','send_offer');
-- All 8 should show data_type = 'text'.


======================================================================================================================================================
018_add_revision_placeholder_permissions.sql
======================================================================================================================================================

-- 018_add_revision_placeholder_permissions.sql
-- Adds 6 new permission columns for placeholder "coming soon" sections:
-- PRN authorize/revise/authorize-revision, RM PO revise/authorize-revision,
-- QA Check revise. No backend routes exist for these yet -- frontend shows
-- a "Coming Soon" panel. Safe to add functionality later without a further migration.

ALTER TABLE admin_db.users
  ADD COLUMN IF NOT EXISTS perm_authorize_prn           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perm_revise_prn               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perm_authorize_prn_revision   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perm_revise_rm_po             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perm_authorize_rm_po_revision BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perm_revise_qa_check          BOOLEAN NOT NULL DEFAULT false;

======================================================================================================================================================
019_drop_dispatch_product_code.sql
======================================================================================================================================================

-- 019_drop_dispatch_product_code.sql
-- Removes the Dispatch Product Code concept entirely, per decision to use
-- Item Code everywhere instead. finished_goods_inventory.item_or_dispatch_code
-- column is KEPT (still holds historical + future Item Codes) -- only the
-- separate dispatch-code catalog table/sequence and permission are dropped.

DROP TABLE IF EXISTS production.dispatch_product_code_number CASCADE;
DROP SEQUENCE IF EXISTS production.dispatch_code_seq;

ALTER TABLE admin_db.users DROP COLUMN IF EXISTS perm_dispatch_product_code;

======================================================================================================================================================
020_move_projects_to_project_schema.sql
======================================================================================================================================================

-- 020_move_projects_to_project_schema.sql
-- Creates the new `project` schema and moves the Projects table there
-- from `design`. SET SCHEMA preserves the table's data, indexes,
-- sequences, and any FK constraints from other tables pointing at it â€”
-- nothing else in the DB needs to change.

CREATE SCHEMA IF NOT EXISTS project;
ALTER TABLE design.projects SET SCHEMA project;

======================================================================================================================================================
021_drop_unused_project_columns.sql
======================================================================================================================================================

-- 021_drop_unused_project_columns.sql
-- Removes company_id, total_material_cost_inr, and drive_folder_url from
-- project.projects. company_id was an FK to marketing.companies (only
-- ever set at creation, never read back elsewhere) -- dropping it
-- removes that link entirely. drive_folder_url is no longer stored;
-- routes/projects.js still creates the Drive folder, just returns the
-- URL in the response instead of persisting it.
ALTER TABLE project.projects
  DROP COLUMN IF EXISTS company_id,
  DROP COLUMN IF EXISTS total_material_cost_inr,
  DROP COLUMN IF EXISTS drive_folder_url;

======================================================================================================================================================
022_item_code_format_abps.sql
======================================================================================================================================================

-- 022_item_code_format_abps.sql
-- Switches Item Code generation from "IC-N" to "ABPS00001" (5-digit,
-- zero-padded, matching the pre-existing convention). Reuses the same
-- design.item_code_seq sequence -- only the string format changes.
ALTER TABLE design.item_codes
  ALTER COLUMN item_code SET DEFAULT ('ABPS' || lpad(nextval('design.item_code_seq')::text, 5, '0'));

======================================================================================================================================================
023_drop_email_fk_on_display_name_columns.sql
======================================================================================================================================================

-- 023_drop_email_fk_on_display_name_columns.sql
-- These 12 columns now store the logged-in operator's display NAME (not
-- email), per this session's "use login name, not email, everywhere"
-- change. Each still had a leftover FK to admin_db.users(email) from
-- when they held emails -- a FK to email can never match a name value,
-- so every write to these columns has been failing (or would fail the
-- moment real data hit them) since that change shipped. Dropping all of
-- them at once; these become plain text going forward.
--
-- Found via:
--   SELECT tc.table_schema, tc.table_name, kcu.column_name, ...
--   WHERE ccu.table_schema = 'admin_db' AND ccu.table_name = 'users' AND ccu.column_name = 'email'
--     AND kcu.column_name IN ('prepared_by','authorized_by','prod_person','qa_person','uploaded_by','created_by');

ALTER TABLE marketing.companies                    DROP CONSTRAINT IF EXISTS companies_created_by_fkey;
ALTER TABLE design.item_codes                       DROP CONSTRAINT IF EXISTS item_codes_created_by_fkey;
ALTER TABLE design.bill_of_quantity                 DROP CONSTRAINT IF EXISTS bill_of_quantity_prepared_by_fkey;
ALTER TABLE design.bill_of_quantity                 DROP CONSTRAINT IF EXISTS bill_of_quantity_authorized_by_fkey;
ALTER TABLE design.boq_drafts                       DROP CONSTRAINT IF EXISTS boq_drafts_prepared_by_fkey;
ALTER TABLE design.boq_drafts                       DROP CONSTRAINT IF EXISTS boq_drafts_authorized_by_fkey;
ALTER TABLE design.boq_update_requests              DROP CONSTRAINT IF EXISTS boq_update_requests_authorized_by_fkey;
ALTER TABLE purchase.raw_material_purchase_orders   DROP CONSTRAINT IF EXISTS raw_material_purchase_orders_prepared_by_fkey;
ALTER TABLE purchase.raw_material_purchase_orders   DROP CONSTRAINT IF EXISTS raw_material_purchase_orders_authorized_by_fkey;
ALTER TABLE inventory.inbound_store_ledger          DROP CONSTRAINT IF EXISTS inbound_store_ledger_qa_person_fkey;
ALTER TABLE inventory.outbound_store_ledger         DROP CONSTRAINT IF EXISTS outbound_store_ledger_authorized_by_fkey;
ALTER TABLE production.finished_goods_inventory     DROP CONSTRAINT IF EXISTS finished_goods_inventory_qa_person_fkey;

======================================================================================================================================================
024_swap_boq_tables_and_new_id_format.sql
======================================================================================================================================================

-- 024_swap_boq_tables_and_new_id_format.sql
-- The two BOQ-related tables were named backwards relative to their
-- actual structure: `bill_of_quantity` was really one-row-per-BOQ (the
-- "BOQDrafts" concept), and `boq_drafts` was really one-row-per-material
-- (the "BillOfQuantity" concept). Swapping the names to match reality,
-- dropping Used/Remaining Product Quantity (never wired to anything live),
-- and removing boq_id's old auto-sequence default since the app now
-- builds the ID itself (format: BOQ_<FY>_<Month>_<Company>_<Product>_<Rating>_<seq>).
--
-- Both tables were already truncated before this migration -- no data
-- migration needed, this is a pure structural change.

BEGIN;

-- Swap the two table names (3-step swap via a temp name, standard pattern)
ALTER TABLE design.bill_of_quantity RENAME TO __boq_swap_tmp__;
ALTER TABLE design.boq_drafts RENAME TO bill_of_quantity;
ALTER TABLE design.__boq_swap_tmp__ RENAME TO boq_drafts;

-- design.boq_drafts is now the one-row-per-BOQ table (ex-bill_of_quantity).
-- Its boq_id used to auto-generate via a sequence-backed DEFAULT -- the
-- app now computes and passes the full new-format ID explicitly.
ALTER TABLE design.boq_drafts ALTER COLUMN boq_id DROP DEFAULT;

-- design.bill_of_quantity is now the one-row-per-material-line table
-- (ex-boq_drafts). Drop the two never-wired-up tracking columns.
ALTER TABLE design.bill_of_quantity DROP COLUMN IF EXISTS used_product_quantity;
ALTER TABLE design.bill_of_quantity DROP COLUMN IF EXISTS remaining_product_quantity;

COMMIT;

======================================================================================================================================================
025_fix_boq_update_requests_fk.sql
======================================================================================================================================================

-- 025_fix_boq_update_requests_fk.sql
-- boq_update_requests.boq_id was defined (migration 005, pre-swap) with
-- REFERENCES design.bill_of_quantity(boq_id). After migration 024
-- swapped the two tables, the one-row-per-BOQ table with a unique boq_id
-- is design.boq_drafts â€” bill_of_quantity is now one-row-per-material-line
-- (boq_id NOT unique there), so the FK points at the wrong table.
-- Repoint it at boq_drafts. Idempotent: only acts if the wrong FK exists.

BEGIN;

DO $$
DECLARE
  fk_name text;
  fk_target regclass;
BEGIN
  SELECT conname, confrelid::regclass INTO fk_name, fk_target
  FROM pg_constraint
  WHERE conrelid = 'design.boq_update_requests'::regclass
    AND contype = 'f'
    AND (
      SELECT attname FROM pg_attribute
      WHERE attrelid = conrelid AND attnum = conkey[1]
    ) = 'boq_id';

  IF fk_name IS NOT NULL AND fk_target::text <> 'design.boq_drafts' THEN
    EXECUTE format('ALTER TABLE design.boq_update_requests DROP CONSTRAINT %I', fk_name);
    ALTER TABLE design.boq_update_requests
      ADD CONSTRAINT boq_update_requests_boq_id_fkey
      FOREIGN KEY (boq_id) REFERENCES design.boq_drafts(boq_id);
  END IF;
END $$;

-- Partial unique index: at most ONE open (pending) update request per BOQ.
-- Authorized/Rejected rows are excluded, so a BOQ can accumulate history
-- but never two competing OPEN requests at once (Fix 4's DB backstop).
CREATE UNIQUE INDEX IF NOT EXISTS uq_boqupdate_one_open_per_boq
  ON design.boq_update_requests (boq_id)
  WHERE status = 'Pending Authorization Update';

COMMIT;

======================================================================================================================================================
026_drop_boq_update_justification_requirement.sql
======================================================================================================================================================

-- 026_drop_boq_update_justification_requirement.sql
-- Justification is no longer part of the BOQ revision workflow.
-- Relax the NOT NULL constraint rather than drop the column, so any
-- already-authorized revisions keep their historical justification text.
ALTER TABLE design.boq_update_requests ALTER COLUMN justification DROP NOT NULL;

======================================================================================================================================================
027_allow_excess_orphaned_job_card_status.sql
======================================================================================================================================================

-- 027_allow_excess_orphaned_job_card_status.sql
-- production.job_cards.status may have a CHECK constraint restricting
-- allowed values (unknown â€” job_cards predates the migration files).
-- Rather than guess the full existing value list and risk excluding one,
-- defensively drop any CHECK constraint on this column entirely, so
-- 'Excess/Orphaned' (and any future status) is never blocked at the DB
-- level. No-op if no such constraint exists.
DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  WHERE c.conrelid = 'production.job_cards'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE production.job_cards DROP CONSTRAINT %I', conname);
  END IF;
END $$;

======================================================================================================================================================
028_prn_authorization_workflow.sql
======================================================================================================================================================

-- 028_prn_authorization_workflow.sql
-- PRN gains a two-step create -> authorize workflow, mirroring BOQ:
-- creation writes only the header row (with the proposed line items held
-- as JSONB), and prn_line_items is populated only on authorization.

-- Draft line items live here between create and authorize.
ALTER TABLE purchase.purchase_request_notes
  ADD COLUMN IF NOT EXISTS draft_line_items JSONB;

-- Who authorized/rejected, and when.
ALTER TABLE purchase.purchase_request_notes
  ADD COLUMN IF NOT EXISTS authorized_by TEXT;
ALTER TABLE purchase.purchase_request_notes
  ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ;

-- status may have a CHECK constraint restricting values (this table
-- predates the migration files, so its constraints aren't visible in
-- source). Defensively drop any CHECK on status rather than guess the
-- full existing value list and risk excluding one â€” same approach as
-- migration 027 for production.job_cards. No-op if none exists.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT c.conname INTO cname
  FROM pg_constraint c
  WHERE c.conrelid = 'purchase.purchase_request_notes'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE purchase.purchase_request_notes DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- At most ONE pending PRN per BOQ (Option A's block, enforced at the DB
-- level as a race backstop, same pattern as boq_update_requests).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prn_one_pending_per_boq
  ON purchase.purchase_request_notes (boq_id)
  WHERE status = 'Pending Authorization';

======================================================================================================================================================
029_add_authorize_prn_permission.sql
======================================================================================================================================================

-- 029_add_authorize_prn_permission.sql
-- PRN authorization gets its own permission, separate from PRN creation,
-- so the same person can't both raise and approve a PRN (matching how
-- perm_authorize_rm_po is separate from perm_create_rm_po).
ALTER TABLE admin_db.users ADD COLUMN IF NOT EXISTS perm_authorize_prn BOOLEAN DEFAULT FALSE;

======================================================================================================================================================
030_add_po_tax_and_charges.sql
======================================================================================================================================================

-- 030_add_po_tax_and_charges.sql
-- The Create PO screen has always captured CGST/SGST/IGST, packing,
-- freight, other and round-off, but commitPurchaseOrderDraft silently
-- dropped them â€” so every PO to date has been stored (and rendered)
-- with no tax component at all. Add the columns so the data the user
-- already enters can actually be persisted and printed.
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS cgst_percent NUMERIC DEFAULT 0;
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS sgst_percent NUMERIC DEFAULT 0;
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS igst_percent NUMERIC DEFAULT 0;
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS packing_amount NUMERIC DEFAULT 0;
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS freight_amount NUMERIC DEFAULT 0;
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS other_amount NUMERIC DEFAULT 0;
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS round_off NUMERIC DEFAULT 0;
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS supplier_ref TEXT;

======================================================================================================================================================
031_add_pdfshift_key_pointer.sql
======================================================================================================================================================

-- 031_add_pdfshift_key_pointer.sql
-- Persists which PDFShift key is currently in use, so an exhausted key
-- isn't retried on every subsequent document. Cloud Run instances are
-- ephemeral, so this can't live in process memory.
CREATE TABLE IF NOT EXISTS purchase.pdfshift_state (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  current_key  INTEGER NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT pdfshift_state_singleton CHECK (id = 1)
);
INSERT INTO purchase.pdfshift_state (id, current_key) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;

======================================================================================================================================================
032_add_snapshot_column.sql
======================================================================================================================================================

ALTER TABLE purchase.purchase_request_notes
  ADD COLUMN IF NOT EXISTS previous_snapshot JSONB;

======================================================================================================================================================
033_store_person_now_holds_name.sql
======================================================================================================================================================

ALTER TABLE purchase.purchase_request_notes
  DROP CONSTRAINT IF EXISTS purchase_request_notes_store_person_fkey;

======================================================================================================================================================
034_prn_line_items_checked_by_store_person_fkey_constraint_dropped.sql
======================================================================================================================================================

ALTER TABLE purchase.prn_line_items
  DROP CONSTRAINT IF EXISTS prn_line_items_checked_by_store_person_fkey;

======================================================================================================================================================
035_prn_po_allocation_and_revision.sql
======================================================================================================================================================

-- 035_prn_po_allocation_and_revision.sql
BEGIN;

ALTER TABLE purchase.raw_material_po_line_items
  ADD COLUMN IF NOT EXISTS delivery_date DATE;

ALTER TABLE purchase.prn_line_items
  ADD COLUMN IF NOT EXISTS awaiting_po_revision BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS received_quantity NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE purchase.raw_material_purchase_orders
  ADD COLUMN IF NOT EXISTS reconciled_prn_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE purchase.pps_tracking
  ADD CONSTRAINT pps_tracking_prn_item_po_uniq UNIQUE (prn_id, item_code, po_no);

CREATE TABLE IF NOT EXISTS purchase.po_revision_requests (
  request_id              SERIAL PRIMARY KEY,
  po_no                   TEXT NOT NULL REFERENCES purchase.raw_material_purchase_orders(po_no),
  status                  TEXT NOT NULL DEFAULT 'Pending Authorization'
                            CHECK (status IN ('Pending Authorization','Authorized','Rejected')),
  revision_kind           TEXT NOT NULL DEFAULT 'PRN Driven'
                            CHECK (revision_kind IN ('PRN Driven','Standalone','Cancellation')),
  revised_line_items      JSONB NOT NULL,
  allocations             JSONB NOT NULL DEFAULT '[]'::jsonb,
  drafted_prn_versions    JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by            TEXT,
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_by           TEXT,
  authorized_at           TIMESTAMPTZ,
  rejection_reason        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS po_revision_requests_one_pending
  ON purchase.po_revision_requests (po_no)
  WHERE status = 'Pending Authorization';

COMMIT;

======================================================================================================================================================
036_prn_boq_version_tracking.sql
======================================================================================================================================================

-- 036_prn_boq_version_tracking.sql
-- PRN `version` counts PRN revisions (including store/purchase re-splits
-- that involve no BOQ change), so it cannot double as "which BOQ version
-- has been applied". Track that explicitly, or a Revise PRN would mask an
-- unapplied BOQ revision from the needs-a-PRN queue.
ALTER TABLE purchase.purchase_request_notes
  ADD COLUMN IF NOT EXISTS boq_version_applied INTEGER;

-- Backfill: every existing PRN currently tracks its BOQ 1:1.
UPDATE purchase.purchase_request_notes p
SET boq_version_applied = COALESCE(p.version, 1)
WHERE p.boq_version_applied IS NULL;

======================================================================================================================================================
037_add_prn_line_items_unit_type.sql
======================================================================================================================================================

-- 037_add_prn_line_items_unit_type.sql
-- prn_line_items never had a unit column, but every quantity calculation
-- (NOS rounding, the revise-PRN screen, the PDF) needs it stored per line
-- â€” a removed material has no design.bill_of_quantity row left to derive
-- it from, so it can't be looked up live once that happens.
ALTER TABLE purchase.prn_line_items
  ADD COLUMN IF NOT EXISTS unit_type TEXT;

======================================================================================================================================================
038_universal_sheet_change_log.sql
======================================================================================================================================================

-- 038_universal_sheet_change_log.sql
-- Every table write â€” through the app OR raw SQL â€” logs into
-- sheet_change_log via a generic trigger. A background poller in the
-- Node app drains this queue and pushes each changed row to Sheets. This
-- is the only mechanism that can catch a raw SQL change, since triggers
-- fire on the write itself regardless of what performed it, whereas the
-- app-level syncLiveRow() calls only fire when a specific route happens
-- to call them (three separate real bugs in this build were exactly
-- that â€” a route missing its call, or a registry/table-name mismatch).
--
-- Primary keys are discovered from information_schema rather than typed
-- in by hand â€” the same mistake (guessing a column name that turns out
-- wrong) has cost real debugging time repeatedly in this project.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_db.sheet_change_log (
  change_id    BIGSERIAL PRIMARY KEY,
  schema_name  TEXT NOT NULL,
  table_name   TEXT NOT NULL,
  key_value    TEXT,
  operation    TEXT NOT NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION admin_db.log_sheet_change() RETURNS trigger AS $$
DECLARE
  key_col TEXT := TG_ARGV[0];
  key_val TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    key_val := (to_jsonb(OLD) ->> key_col);
  ELSE
    key_val := (to_jsonb(NEW) ->> key_col);
  END IF;
  INSERT INTO admin_db.sheet_change_log (schema_name, table_name, key_value, operation)
  VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, key_val, TG_OP);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attaches the trigger to every table below, using each table's REAL
-- primary key column looked up from information_schema. Any table with
-- no true PRIMARY KEY constraint is skipped with a NOTICE, not guessed â€”
-- check the output after running this and tell me which ones printed a
-- skip message, since those need a manual keyColumn decision (e.g. a
-- table keyed on a UNIQUE business column rather than a serial PK).
DO $$
DECLARE
  tables TEXT[][] := ARRAY[
    ['admin_db','users'], ['admin_db','gmail_connections'],
    ['marketing','companies'], ['marketing','leads'], ['marketing','follow_ups'], ['marketing','tasks'],
    ['marketing','purchase_order_information'], ['marketing','offers_sent'],
    ['marketing','cold_introductory_emails_sent'], ['marketing','uploaded_document_information'],
    ['marketing','processed_emails'],
    ['project','projects'],
    ['design','item_codes'], ['design','boq_drafts'], ['design','bill_of_quantity'], ['design','boq_update_requests'],
    ['purchase','vendor_information'], ['purchase','purchase_request_notes'],
    ['purchase','raw_material_purchase_orders'], ['purchase','pps_tracking'],
    ['purchase','vendor_performance'], ['purchase','material_buffer_percentage'],
    ['purchase','prn_line_items'], ['purchase','raw_material_po_line_items'],
    ['purchase','po_revision_requests'],
    ['inventory','master_inventory'], ['inventory','spare_inventory'],
    ['inventory','inbound_store_ledger'], ['inventory','outbound_store_ledger'],
    ['inventory','store_tickets'], ['inventory','rejected_material_tracking'],
    ['inventory','stock_assignments'],
    ['production','finished_goods_inventory'], ['production','job_card_materials'], ['production','job_cards'],
    ['accounts','tour_employees'], ['accounts','tour_advances'], ['accounts','tour_vouchers']
  ];
  s TEXT; tb TEXT; pk_col TEXT;
BEGIN
  FOR i IN 1..array_length(tables,1) LOOP
    s := tables[i][1]; tb := tables[i][2];

    SELECT kcu.column_name INTO pk_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = s AND tc.table_name = tb
    LIMIT 1;

    IF pk_col IS NULL THEN
      RAISE NOTICE 'SKIPPED %.% â€” no primary key found. Needs a manual trigger with an explicit key column.', s, tb;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = s AND table_name = tb) THEN
      RAISE NOTICE 'SKIPPED %.% â€” table does not exist.', s, tb;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_sheet_sync ON %I.%I', s, tb);
    EXECUTE format(
      'CREATE TRIGGER trg_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON %I.%I
       FOR EACH ROW EXECUTE FUNCTION admin_db.log_sheet_change(%L)',
      s, tb, pk_col
    );
    RAISE NOTICE 'Trigger attached: %.% (key: %)', s, tb, pk_col;
  END LOOP;
END $$;

COMMIT;

======================================================================================================================================================
039_master_inventory_cleanup.sql
======================================================================================================================================================

-- 039_master_inventory_cleanup.sql
BEGIN;

ALTER TABLE inventory.master_inventory
  RENAME COLUMN rate_per_quantity TO latest_rate_per_quantity;

ALTER TABLE inventory.master_inventory
  DROP COLUMN IF EXISTS boq_active,
  DROP COLUMN IF EXISTS total_basic_amount,
  DROP COLUMN IF EXISTS total_invoice_amount_incl_gst;

-- Backfill type_of_material for every row that predates this fix.
UPDATE inventory.master_inventory mi
SET type_of_material = ic.type_of_material
FROM design.item_codes ic
WHERE ic.item_code = mi.item_code AND mi.type_of_material IS NULL;

COMMIT;

======================================================================================================================================================
040_add_project_drawings.sql
======================================================================================================================================================

-- 040_add_project_drawings.sql
-- uploadDrawingDocument has always uploaded to Drive successfully but
-- never recorded that it happened anywhere â€” "Already Uploaded
-- Documents" had nothing to read from, and fetchDrawingDocumentsList
-- was never a real route. This is the missing persistence layer.
CREATE TABLE IF NOT EXISTS design.project_drawings (
  drawing_id   BIGSERIAL PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES project.projects(project_id),
  file_name    TEXT NOT NULL,
  drive_url    TEXT NOT NULL,
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_drawings_project_idx ON design.project_drawings (project_id);

======================================================================================================================================================
041_spare_stock_reservation_and_split_tracking.sql
======================================================================================================================================================

-- 041_spare_stock_reservation_and_split_tracking.sql
ALTER TABLE inventory.spare_inventory
  ADD COLUMN IF NOT EXISTS reserved_stock NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE purchase.prn_line_items
  ADD COLUMN IF NOT EXISTS store_qty_from_spare NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS store_qty_from_raw NUMERIC NOT NULL DEFAULT 0;

======================================================================================================================================================
042_add_spare_inventory_trigger.sql
======================================================================================================================================================

-- 042_add_spare_inventory_trigger.sql
-- migration 038's trigger-attachment only recognized true PRIMARY KEY
-- constraints; spare_inventory's item_code uniqueness was apparently
-- enforced as UNIQUE rather than PRIMARY KEY, so it was silently
-- skipped and never got a trigger at all.
DROP TRIGGER IF EXISTS trg_sheet_sync ON inventory.spare_inventory;
CREATE TRIGGER trg_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON inventory.spare_inventory
  FOR EACH ROW EXECUTE FUNCTION admin_db.log_sheet_change('item_code');

======================================================================================================================================================
043_rename_store_person_to_created_by.sql
======================================================================================================================================================

-- Both columns already hold a display name (not an email) per migrations
-- 033/034, which dropped their FKs to admin_db.users(email) for exactly
-- that reason. "created_by" reflects what they actually store â€” the name
-- of whoever raised the PRN â€” better than the old store-specific naming.
ALTER TABLE purchase.purchase_request_notes RENAME COLUMN store_person TO created_by;
ALTER TABLE purchase.prn_line_items RENAME COLUMN checked_by_store_person TO created_by;

======================================================================================================================================================
044_po_column_cleanup.sql
======================================================================================================================================================

-- Genuinely unused legacy columns (never written by live code, only by
-- the original one-off run.js migration).
ALTER TABLE purchase.raw_material_purchase_orders DROP COLUMN IF EXISTS grand_total_in_words;
ALTER TABLE purchase.raw_material_purchase_orders DROP COLUMN IF EXISTS original_document_url;

-- supplier_ref (live, has real data) and supplier_ref_offer_no (legacy,
-- empty) were duplicates of the same field. Drop the empty legacy one,
-- then rename the live column to that name â€” end state is one column
-- named supplier_ref_offer_no holding the real data, not two columns
-- with one of them silently discarded.
ALTER TABLE purchase.raw_material_purchase_orders DROP COLUMN IF EXISTS supplier_ref_offer_no;
ALTER TABLE purchase.raw_material_purchase_orders RENAME COLUMN supplier_ref TO supplier_ref_offer_no;

-- authorized_at was load-bearing for the per-PO Drive folder naming
-- (regeneratePODocument needs a date that's set once at first
-- authorization and never touched again, so the folder name stays
-- stable across every later revision). Giving that job its own
-- dedicated column instead, so authorized_at can be dropped cleanly â€”
-- backfill first so already-authorized POs keep their existing folder
-- name instead of it changing on their next revision.
ALTER TABLE purchase.raw_material_purchase_orders ADD COLUMN IF NOT EXISTS folder_dated_at TIMESTAMPTZ;
UPDATE purchase.raw_material_purchase_orders SET folder_dated_at = authorized_at WHERE authorized_at IS NOT NULL AND folder_dated_at IS NULL;
ALTER TABLE purchase.raw_material_purchase_orders DROP COLUMN IF EXISTS authorized_at;

-- sr_no is superseded by a per-PO ROW_NUMBER() computed live in the
-- sheet registry query (see sheetsRegistry.js) rather than stored â€”
-- ordering elsewhere in the app now uses line_id (the surrogate PK),
-- which increases in insertion order exactly like sr_no did.
ALTER TABLE purchase.raw_material_po_line_items DROP COLUMN IF EXISTS sr_no;

======================================================================================================================================================
045_po_revision_header_changes.sql
======================================================================================================================================================

-- PO revisions previously only ever revised line items (quantity, rate,
-- discount, allocations). This adds the ability to also revise the PO
-- header itself â€” Supplier Offer No, Delivery Date, Taxes & Charges,
-- Terms â€” as a single JSONB blob captured at draft time and applied to
-- raw_material_purchase_orders at authorize time, same pattern as
-- revised_line_items already uses for line-level changes.
ALTER TABLE purchase.po_revision_requests ADD COLUMN IF NOT EXISTS header_changes JSONB;

======================================================================================================================================================
046_add_search_rm_po_permission.sql
======================================================================================================================================================

-- 046_add_search_rm_po_permission.sql
-- Adds a dedicated permission for the new "Search by Raw Material Purchase
-- Order" dashboard section (Purchase dept). Kept separate from
-- perm_authorize_rm_po deliberately -- this is a read-only search/lookup
-- capability, not tied to who can authorize POs.

ALTER TABLE admin_db.users
  ADD COLUMN IF NOT EXISTS perm_search_rm_po BOOLEAN DEFAULT FALSE;

======================================================================================================================================================
047_fix_missing_updated_at_and_duplicate_triggers.sql
======================================================================================================================================================

-- 047_fix_missing_updated_at_and_duplicate_triggers.sql
-- Two issues found while debugging the "record NEW has no field
-- updated_at" crash:
--
-- 1. boq_drafts (and possibly job_card_materials / master_inventory)
--    have a trg_*_updated_at trigger calling set_updated_at(), but the
--    column that trigger writes to doesn't actually exist on the table.
--    ADD COLUMN IF NOT EXISTS is safe regardless of which ones were
--    actually missing it.
--
-- 2. trg_sheet_sync shows up 3x on every affected table (bill_of_quantity,
--    boq_drafts, job_card_materials, master_inventory, prn_line_items,
--    spare_inventory) â€” created multiple times without DROP TRIGGER IF
--    EXISTS first, so every write is firing the same trigger 3 times and
--    inserting 3 duplicate rows into sheet_change_log per change. This
--    doesn't corrupt data (the poller just does 3x redundant work and
--    the Sheet ends up correct either way) but it's real wasted load â€”
--    de-duplicating down to one trigger per table.

BEGIN;

ALTER TABLE design.boq_drafts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE production.job_card_materials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE inventory.master_inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- De-duplicate trg_sheet_sync â€” since Postgres allows multiple triggers
-- with the SAME name only if they were created with different internal
-- OIDs (which DROP TRIGGER IF EXISTS ... CREATE TRIGGER normally
-- prevents), the fact that 3 copies exist means a raw CREATE TRIGGER
-- (without the IF EXISTS drop first) got run 3 separate times. Postgres
-- doesn't actually allow true duplicate trigger names on the same table
-- normally â€” if this section errors, tell me the exact error and we'll
-- adjust; it likely means the "duplicates" are firing via 3 differently-
-- named triggers that only display the same action_statement, which
-- changes the fix.
DROP TRIGGER IF EXISTS trg_sheet_sync ON design.bill_of_quantity;
CREATE TRIGGER trg_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON design.bill_of_quantity
  FOR EACH ROW EXECUTE FUNCTION admin_db.log_sheet_change('draft_row_id');

DROP TRIGGER IF EXISTS trg_sheet_sync ON design.boq_drafts;
CREATE TRIGGER trg_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON design.boq_drafts
  FOR EACH ROW EXECUTE FUNCTION admin_db.log_sheet_change('boq_id');

DROP TRIGGER IF EXISTS trg_sheet_sync ON production.job_card_materials;
CREATE TRIGGER trg_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON production.job_card_materials
  FOR EACH ROW EXECUTE FUNCTION admin_db.log_sheet_change('row_id');

DROP TRIGGER IF EXISTS trg_sheet_sync ON inventory.master_inventory;
CREATE TRIGGER trg_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON inventory.master_inventory
  FOR EACH ROW EXECUTE FUNCTION admin_db.log_sheet_change('item_code');

DROP TRIGGER IF EXISTS trg_sheet_sync ON purchase.prn_line_items;
CREATE TRIGGER trg_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON purchase.prn_line_items
  FOR EACH ROW EXECUTE FUNCTION admin_db.log_sheet_change('line_id');

DROP TRIGGER IF EXISTS trg_sheet_sync ON inventory.spare_inventory;
CREATE TRIGGER trg_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON inventory.spare_inventory
  FOR EACH ROW EXECUTE FUNCTION admin_db.log_sheet_change('item_code');

COMMIT;

======================================================================================================================================================
048_backfill_combined_material_names.sql
======================================================================================================================================================

-- 048_backfill_combined_material_names.sql
-- One-time correction: every write path that creates a BOQ material row
-- already stores "Material Name + Rating" correctly (selectBOQRowMaterial
-- on the frontend, confirmed by tracing bill_of_quantity -> PRN line items
-- -> Master/Spare Inventory, which all inherit from there). This backfill
-- only exists to fix rows written BEFORE that convention was applied
-- consistently. Matched by item_code against design.item_codes; rows with
-- no item_code, or no matching item_code, are left untouched.

BEGIN;

-- bill_of_quantity.description_of_material
UPDATE design.bill_of_quantity b
SET description_of_material = ic.combined
FROM (
  SELECT item_code,
         material_name || CASE WHEN rating IS NOT NULL AND TRIM(rating) <> '' THEN ' ' || TRIM(rating) ELSE '' END AS combined
  FROM design.item_codes
) ic
WHERE b.item_code = ic.item_code AND b.item_code IS NOT NULL AND b.item_code <> ''
  AND b.description_of_material IS DISTINCT FROM ic.combined;

-- boq_drafts.material_rows â€” JSONB array, rewrite each element's
-- descriptionOfMaterial in place, matched per-element by its own itemCode.
UPDATE design.boq_drafts bd
SET material_rows = sub.new_rows
FROM (
  SELECT bd2.boq_id,
         jsonb_agg(
           CASE
             WHEN (elem->>'itemCode') IS NOT NULL AND (elem->>'itemCode') <> '' AND ic.combined IS NOT NULL
               THEN jsonb_set(elem, '{descriptionOfMaterial}', to_jsonb(ic.combined))
             ELSE elem
           END
           ORDER BY ord
         ) AS new_rows
  FROM design.boq_drafts bd2
  CROSS JOIN LATERAL jsonb_array_elements(bd2.material_rows) WITH ORDINALITY AS t(elem, ord)
  LEFT JOIN (
    SELECT item_code,
           material_name || CASE WHEN rating IS NOT NULL AND TRIM(rating) <> '' THEN ' ' || TRIM(rating) ELSE '' END AS combined
    FROM design.item_codes
  ) ic ON ic.item_code = elem->>'itemCode'
  WHERE bd2.material_rows IS NOT NULL
  GROUP BY bd2.boq_id
) sub
WHERE bd.boq_id = sub.boq_id;

-- prn_line_items.material_name
UPDATE purchase.prn_line_items p
SET material_name = ic.combined
FROM (
  SELECT item_code,
         material_name || CASE WHEN rating IS NOT NULL AND TRIM(rating) <> '' THEN ' ' || TRIM(rating) ELSE '' END AS combined
  FROM design.item_codes
) ic
WHERE p.item_code = ic.item_code AND p.item_code IS NOT NULL AND p.item_code <> ''
  AND p.material_name IS DISTINCT FROM ic.combined;

-- master_inventory.material_name
UPDATE inventory.master_inventory m
SET material_name = ic.combined
FROM (
  SELECT item_code,
         material_name || CASE WHEN rating IS NOT NULL AND TRIM(rating) <> '' THEN ' ' || TRIM(rating) ELSE '' END AS combined
  FROM design.item_codes
) ic
WHERE m.item_code = ic.item_code
  AND m.material_name IS DISTINCT FROM ic.combined;

-- spare_inventory.material_name
UPDATE inventory.spare_inventory s
SET material_name = ic.combined
FROM (
  SELECT item_code,
         material_name || CASE WHEN rating IS NOT NULL AND TRIM(rating) <> '' THEN ' ' || TRIM(rating) ELSE '' END AS combined
  FROM design.item_codes
) ic
WHERE s.item_code = ic.item_code
  AND s.material_name IS DISTINCT FROM ic.combined;

-- job_card_materials.material_name â€” same source pattern (ensureMaterialsInInventory
-- inherits from the same BOQ material_rows), included for completeness even
-- though not explicitly listed.
UPDATE production.job_card_materials j
SET material_name = ic.combined
FROM (
  SELECT item_code,
         material_name || CASE WHEN rating IS NOT NULL AND TRIM(rating) <> '' THEN ' ' || TRIM(rating) ELSE '' END AS combined
  FROM design.item_codes
) ic
WHERE j.item_code = ic.item_code AND j.item_code IS NOT NULL AND j.item_code <> ''
  AND j.material_name IS DISTINCT FROM ic.combined;

COMMIT;

======================================================================================================================================================
049_add_invoice_description_column.sql
======================================================================================================================================================

-- 049_add_invoice_description_column.sql
-- Store Entry and Q/A Check both have an "Invoice Description" column
-- that's been permanently blank â€” inbound_store_ledger never had a
-- column for the raw, unedited invoice text (only material_name, which
-- is the RESOLVED/standardized name, not what was actually printed on
-- the invoice). gemini.js already extracts this per line item as
-- rawDescriptionLine; it just had nowhere to be saved.
ALTER TABLE inventory.inbound_store_ledger
  ADD COLUMN IF NOT EXISTS invoice_description TEXT;

======================================================================================================================================================
050_drop_person_email_fks.sql
======================================================================================================================================================

-- 050_drop_person_email_fks.sql
-- gate_entry_person / grn_person / set_by_store / purchase_reviewed_by
-- were FK-constrained against admin_db.users(email), which directly
-- conflicts with the requirement that these fields always show the
-- person's name, never their email â€” a name string can't satisfy an
-- FK keyed on email. qa_person was never constrained this way, which is
-- why it was the only one already showing correctly. Dropping all four
-- so every *_person / *_by column behaves consistently.
ALTER TABLE inventory.inbound_store_ledger DROP CONSTRAINT IF EXISTS inbound_store_ledger_gate_entry_person_fkey;
ALTER TABLE inventory.inbound_store_ledger DROP CONSTRAINT IF EXISTS inbound_store_ledger_grn_person_fkey;
ALTER TABLE inventory.rejected_material_tracking DROP CONSTRAINT IF EXISTS rejected_material_tracking_set_by_store_fkey;
ALTER TABLE inventory.rejected_material_tracking DROP CONSTRAINT IF EXISTS rejected_material_tracking_purchase_reviewed_by_fkey;

======================================================================================================================================================
051_drop_boq_update_requests_sheet_sync.sql
======================================================================================================================================================

-- 051_drop_boq_update_requests_sheet_sync.sql
-- boq_update_requests no longer has a Sheet â€” removed from
-- sheetsRegistry.js. Dropping its trg_sheet_sync trigger too, otherwise
-- every insert/update on this table keeps queuing rows into
-- admin_db.sheet_change_log for a sync that will never run.
DROP TRIGGER IF EXISTS trg_sheet_sync ON design.boq_update_requests;

======================================================================================================================================================
052_add_vendor_tax_percentages.sql
======================================================================================================================================================

ALTER TABLE purchase.vendor_information
  ADD COLUMN cgst_percent numeric NOT NULL DEFAULT 9,
  ADD COLUMN sgst_percent numeric NOT NULL DEFAULT 9,
  ADD COLUMN igst_percent numeric NOT NULL DEFAULT 0;

======================================================================================================================================================
053_add_purchase_fk_cascades.sql
======================================================================================================================================================

-- 052_add_purchase_fk_cascades.sql
-- Adds ON DELETE behavior to every FK referencing the purchase tables,
-- so a manual cleanup (or any future delete) cascades correctly instead
-- of throwing a foreign key violation partway through, as it just did
-- for pps_tracking. Constraint names aren't assumed (several were
-- auto-generated outside the visible numbered migrations) â€” each block
-- looks up whatever the real current name is before dropping it.
BEGIN;

-- purchase.pps_tracking.prn_id -> purchase_request_notes(prn_id)
-- CASCADE: a pps_tracking row has no meaning once its PRN is gone.
DO $$
DECLARE cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'purchase' AND tc.table_name = 'pps_tracking'
    AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'prn_id';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE purchase.pps_tracking DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE purchase.pps_tracking
    ADD CONSTRAINT pps_tracking_prn_id_fkey
    FOREIGN KEY (prn_id) REFERENCES purchase.purchase_request_notes(prn_id) ON DELETE CASCADE;
END $$;

-- inventory.stock_assignments.prn_id -> purchase_request_notes(prn_id)
-- SET NULL, not CASCADE: a stock assignment is real inventory history
-- that shouldn't vanish just because the PRN it was once tied to did â€”
-- it just stops pointing at a PRN.
DO $$
DECLARE cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'inventory' AND tc.table_name = 'stock_assignments'
    AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'prn_id';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE inventory.stock_assignments DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE inventory.stock_assignments
    ADD CONSTRAINT stock_assignments_prn_id_fkey
    FOREIGN KEY (prn_id) REFERENCES purchase.purchase_request_notes(prn_id) ON DELETE SET NULL;
END $$;

-- purchase.prn_line_items.prn_id -> purchase_request_notes(prn_id)
-- CASCADE: a line item cannot exist without its parent PRN header.
DO $$
DECLARE cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'purchase' AND tc.table_name = 'prn_line_items'
    AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'prn_id';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE purchase.prn_line_items DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE purchase.prn_line_items
    ADD CONSTRAINT prn_line_items_prn_id_fkey
    FOREIGN KEY (prn_id) REFERENCES purchase.purchase_request_notes(prn_id) ON DELETE CASCADE;
END $$;

-- purchase.raw_material_po_line_items.po_no -> raw_material_purchase_orders(po_no)
-- CASCADE: same reasoning as prn_line_items above.
DO $$
DECLARE cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'purchase' AND tc.table_name = 'raw_material_po_line_items'
    AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'po_no';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE purchase.raw_material_po_line_items DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE purchase.raw_material_po_line_items
    ADD CONSTRAINT raw_material_po_line_items_po_no_fkey
    FOREIGN KEY (po_no) REFERENCES purchase.raw_material_purchase_orders(po_no) ON DELETE CASCADE;
END $$;

-- purchase.po_revision_requests.po_no -> raw_material_purchase_orders(po_no)
-- CASCADE: a revision request has no meaning without the PO it's for.
DO $$
DECLARE cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'purchase' AND tc.table_name = 'po_revision_requests'
    AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'po_no';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE purchase.po_revision_requests DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE purchase.po_revision_requests
    ADD CONSTRAINT po_revision_requests_po_no_fkey
    FOREIGN KEY (po_no) REFERENCES purchase.raw_material_purchase_orders(po_no) ON DELETE CASCADE;
END $$;

COMMIT;

======================================================================================================================================================
054_add_awaiting_vendor_action_status.sql
======================================================================================================================================================

ALTER TABLE inventory.rejected_material_tracking DROP CONSTRAINT IF EXISTS rejected_material_tracking_status_check;
ALTER TABLE inventory.rejected_material_tracking ADD CONSTRAINT rejected_material_tracking_status_check
  CHECK (status IN ('Open','Under Review','Resolved','At ABPS - Under Repair','Awaiting Vendor Action'));

======================================================================================================================================================
055_stock_assignments_split_tracking.sql
======================================================================================================================================================

ALTER TABLE inventory.stock_assignments
  ADD COLUMN IF NOT EXISTS from_spare NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS from_raw NUMERIC NOT NULL DEFAULT 0;

======================================================================================================================================================
056_rename_rejected_material_outstanding_to_pending.sql
======================================================================================================================================================

ALTER TABLE inventory.rejected_material_tracking
  RENAME COLUMN outstanding_quantity TO pending_quantity;

======================================================================================================================================================
057_add_receipt_attributions.sql
======================================================================================================================================================

-- Per-event record of where every QA-received unit was attributed.
-- pps_tracking/prn_line_items only hold cumulative totals, so without
-- this there's no way to know how much of a PRN's current
-- received_quantity came from one specific QA submission â€” which is
-- exactly what QA Revision needs in order to reverse precisely.
CREATE TABLE IF NOT EXISTS inventory.receipt_attributions (
  attribution_id   BIGSERIAL PRIMARY KEY,
  event_type       TEXT NOT NULL,              -- 'QA' | 'REPAIR_QA'
  ledger_id        BIGINT,                     -- inbound_store_ledger row, when event_type='QA'
  rejection_id     BIGINT,                     -- rejected_material_tracking row, when 'REPAIR_QA'
  grn_number       TEXT NOT NULL,
  item_code        TEXT NOT NULL,
  po_no            TEXT,
  prn_id           TEXT,                       -- NULL = credited to no PRN (pure free stock)
  kind             TEXT NOT NULL,              -- 'po_credit' | 'auto_assign' | 'free_stock'
  quantity         NUMERIC NOT NULL,
  assignment_id    BIGINT,                     -- stock_assignments row, when kind='auto_assign'
  reversed         BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT
);

CREATE INDEX IF NOT EXISTS idx_receipt_attr_ledger ON inventory.receipt_attributions (ledger_id) WHERE reversed = FALSE;
CREATE INDEX IF NOT EXISTS idx_receipt_attr_grn ON inventory.receipt_attributions (grn_number, item_code);
CREATE INDEX IF NOT EXISTS idx_receipt_attr_assignment ON inventory.receipt_attributions (assignment_id) WHERE assignment_id IS NOT NULL;

======================================================================================================================================================
058_add_revise_qa_permission.sql
======================================================================================================================================================

ALTER TABLE admin_db.users ADD COLUMN IF NOT EXISTS perm_revise_qa_check BOOLEAN NOT NULL DEFAULT FALSE;

======================================================================================================================================================
059_add_stock_sweeps.sql
======================================================================================================================================================

-- Per-item record of every stock sweep. commitStockSweep previously left
-- no trace beyond a summary audit line with no item codes or quantities,
-- so a mistyped sweep was invisible and unreversible after submit.
CREATE TABLE IF NOT EXISTS inventory.stock_sweeps (
  sweep_id        BIGSERIAL PRIMARY KEY,
  batch_id        TEXT NOT NULL,              -- groups one submission's items
  item_code       TEXT NOT NULL,
  material_name   TEXT,
  quantity        NUMERIC NOT NULL CHECK (quantity > 0),
  sweep_type      TEXT NOT NULL,              -- 'Production Return' | 'Count Correction' | 'Found Stock'
  job_card_number TEXT,
  project_id      TEXT,
  reason          TEXT,
  assigned_qty    NUMERIC NOT NULL DEFAULT 0, -- how much auto-assigned to PRNs
  swept_by        TEXT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_sweeps_batch ON inventory.stock_sweeps (batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_sweeps_item ON inventory.stock_sweeps (item_code, ts DESC);
CREATE INDEX IF NOT EXISTS idx_stock_sweeps_ts ON inventory.stock_sweeps (ts DESC);

======================================================================================================================================================
060_receipt_attributions_sweep_support.sql
======================================================================================================================================================

ALTER TABLE inventory.receipt_attributions
  ADD COLUMN IF NOT EXISTS sweep_id BIGINT;
ALTER TABLE inventory.receipt_attributions
  ALTER COLUMN grn_number DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipt_attr_sweep ON inventory.receipt_attributions (sweep_id) WHERE sweep_id IS NOT NULL;

======================================================================================================================================================
061_stock_sweeps_simplify.sql
======================================================================================================================================================

ALTER TABLE inventory.stock_sweeps
  DROP COLUMN IF EXISTS job_card_number,
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS reason;

======================================================================================================================================================
062_stock_assignments_assigned_by_name.sql
======================================================================================================================================================

-- assigned_by should hold the operator's display name, never their login
-- email. The FK to the users table forced an email in, so it goes.
ALTER TABLE inventory.stock_assignments
  DROP CONSTRAINT IF EXISTS stock_assignments_assigned_by_fkey;

-- Backfill any rows that stored an email under the old constraint.
UPDATE inventory.stock_assignments sa
SET assigned_by = TRIM(CONCAT(u.first_name, ' ', u.last_name))
FROM admin_db.users u
WHERE sa.assigned_by = u.email
  AND TRIM(CONCAT(u.first_name, ' ', u.last_name)) <> '';

======================================================================================================================================================
063_drop_user_email_fks.sql
======================================================================================================================================================

-- These columns record "who did this" for humans to read. They stored
-- login emails only because an FK forced it. Names go in; the FKs go.
ALTER TABLE marketing.leads DROP CONSTRAINT IF EXISTS enquiries_engineer_name_fkey;
ALTER TABLE marketing.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_engineer_name_fkey;
ALTER TABLE marketing.tasks DROP CONSTRAINT IF EXISTS tasks_engineer_name_fkey;
ALTER TABLE marketing.tasks DROP CONSTRAINT IF EXISTS tasks_assigning_engineer_fkey;
ALTER TABLE marketing.offers_sent DROP CONSTRAINT IF EXISTS offers_sent_engineer_name_fkey;
ALTER TABLE marketing.cold_introductory_emails_sent DROP CONSTRAINT IF EXISTS cold_introductory_emails_sent_sent_by_fkey;
ALTER TABLE inventory.outbound_store_ledger DROP CONSTRAINT IF EXISTS outbound_store_ledger_requested_by_fkey;
ALTER TABLE inventory.store_tickets DROP CONSTRAINT IF EXISTS store_tickets_requested_returned_by_fkey;
ALTER TABLE inventory.store_tickets DROP CONSTRAINT IF EXISTS store_tickets_actioned_by_fkey;
ALTER TABLE production.finished_goods_inventory DROP CONSTRAINT IF EXISTS finished_goods_inventory_production_responsible_person_fkey;
ALTER TABLE production.finished_goods_inventory DROP CONSTRAINT IF EXISTS finished_goods_inventory_fg_store_incharge_person_fkey;
ALTER TABLE design.boq_update_requests DROP CONSTRAINT IF EXISTS boq_update_requests_requested_by_fkey;

-- Backfill existing email values to display names.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('marketing.leads','engineer_name'), ('marketing.follow_ups','engineer_name'),
    ('marketing.tasks','engineer_name'), ('marketing.tasks','assigning_engineer'),
    ('marketing.offers_sent','engineer_name'), ('marketing.cold_introductory_emails_sent','sent_by'),
    ('inventory.outbound_store_ledger','requested_by'),
    ('inventory.store_tickets','requested_returned_by'), ('inventory.store_tickets','actioned_by'),
    ('production.finished_goods_inventory','production_responsible_person'),
    ('production.finished_goods_inventory','fg_store_incharge_person'),
    ('design.boq_update_requests','requested_by')
  ) AS v(tbl, col) LOOP
    EXECUTE format(
      'UPDATE %s x SET %I = TRIM(CONCAT(u.first_name, '' '', u.last_name))
       FROM admin_db.users u WHERE x.%I = u.email
         AND TRIM(CONCAT(u.first_name, '' '', u.last_name)) <> ''''',
      t.tbl, t.col, t.col);
  END LOOP;
END $$;

======================================================================================================================================================
064_fg_warranty_and_other_docs.sql
======================================================================================================================================================

ALTER TABLE production.finished_goods_inventory
  ADD COLUMN IF NOT EXISTS warranty_card_url TEXT,
  ADD COLUMN IF NOT EXISTS other_documents_url TEXT;

======================================================================================================================================================
065_rename_rejected_material_to_rejected_missing.sql
======================================================================================================================================================

ALTER TABLE inventory.rejected_material_tracking RENAME TO rejected_missing_material_tracking;

ALTER TABLE inventory.rejected_missing_material_tracking
  ADD COLUMN IF NOT EXISTS missing_quantity NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE inventory.rejected_missing_material_tracking
  ALTER COLUMN not_ok_quantity DROP NOT NULL;

ALTER TABLE inventory.rejected_missing_material_tracking
  ALTER COLUMN not_ok_quantity SET DEFAULT 0;

======================================================================================================================================================
066_finished_goods_ticket_linking.sql
======================================================================================================================================================

ALTER TABLE production.finished_goods_inventory
  ADD COLUMN IF NOT EXISTS ticket_id TEXT,
  ADD COLUMN IF NOT EXISTS consumed_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fg_item_status ON production.finished_goods_inventory(item_or_dispatch_code, status);
CREATE INDEX IF NOT EXISTS idx_fg_ticket_id ON production.finished_goods_inventory(ticket_id);

======================================================================================================================================================
067_drop_job_card_materials_pending_quantity.sql
======================================================================================================================================================

-- pending_quantity was written as a hardcoded 0 at row creation and never
-- updated or read by any logic — allotted/used/remaining cover everything
-- the ticket flow actually tracks. Dropping rather than leaving a column
-- of zeros that reads like real data on the Job Card Materials sheet.
ALTER TABLE production.job_card_materials DROP COLUMN IF EXISTS pending_quantity;

======================================================================================================================================================
068_spare_store_restructure.sql
======================================================================================================================================================

-- ── spare_inventory: unusable_stock (Blocked) + generated available_stock ──
-- available_stock was a plain, hand-maintained column — exactly what let it
-- drift out of sync with total_stock/reserved_stock. Making it generated
-- (like master_inventory already is) makes that class of bug impossible.
ALTER TABLE inventory.spare_inventory
  ADD COLUMN IF NOT EXISTS unusable_stock NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE inventory.spare_inventory DROP COLUMN IF EXISTS available_stock;

ALTER TABLE inventory.spare_inventory
  ADD COLUMN available_stock NUMERIC GENERATED ALWAYS AS (total_stock - unusable_stock - reserved_stock) STORED;

-- ── Blocked allocations — per-JC record of what's trapped and why ──
-- unusable_stock on the parent row is the sum of this table's un-freed rows
-- for that item_code; app code keeps them consistent (see routes changes).
CREATE TABLE IF NOT EXISTS inventory.spare_blocked_allocations (
  allocation_id BIGSERIAL PRIMARY KEY,
  item_code TEXT NOT NULL,
  material_name TEXT,
  job_card_number TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  freed_date TIMESTAMPTZ,
  freed_to TEXT,           -- 'Restricted' or 'RM Store' once freed via Stock Sweep
  freed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_spare_blocked_item ON inventory.spare_blocked_allocations(item_code);
CREATE INDEX IF NOT EXISTS idx_spare_blocked_jc ON inventory.spare_blocked_allocations(job_card_number);
CREATE INDEX IF NOT EXISTS idx_spare_blocked_unfreed ON inventory.spare_blocked_allocations(item_code) WHERE freed_date IS NULL;

-- ── prn_line_items: BOQ-line-level running pool balances ──
-- Seeded from the immutable store_qty_from_spare/store_qty_from_raw
-- snapshot at PRN authorization; drawn down by ticket approvals across
-- every Job Card under that BOQ line. store_qty_from_spare/raw themselves
-- are never touched by ticket activity — these are the live counters.
ALTER TABLE purchase.prn_line_items
  ADD COLUMN IF NOT EXISTS spare_pool_remaining NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_pool_remaining NUMERIC NOT NULL DEFAULT 0;

======================================================================================================================================================
069_rename_inventory_schema_to_store.sql
======================================================================================================================================================

ALTER SCHEMA inventory RENAME TO store;
ALTER TABLE store.master_inventory RENAME TO raw_material_store;
ALTER TABLE store.spare_inventory RENAME TO spare_store;

======================================================================================================================================================
070_store_tickets_justification_notes.sql
======================================================================================================================================================

ALTER TABLE store.store_tickets ADD COLUMN IF NOT EXISTS justification_notes TEXT;

======================================================================================================================================================
071_add_project_status_permission.sql
======================================================================================================================================================

ALTER TABLE admin_db.users ADD COLUMN IF NOT EXISTS perm_project_status BOOLEAN NOT NULL DEFAULT false;

======================================================================================================================================================
072_rename_reserve_store_stock.sql
======================================================================================================================================================

ALTER TABLE admin_db.users RENAME COLUMN perm_assign_current_stock TO perm_reserve_store_stock;

ALTER TABLE store.stock_assignments RENAME TO stock_reservations;

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'store.stock_reservations'::regclass AND contype = 'f';
  IF cname IS NOT NULL AND cname <> 'stock_reservations_prn_id_fkey' THEN
    EXECUTE format('ALTER TABLE store.stock_reservations RENAME CONSTRAINT %I TO stock_reservations_prn_id_fkey', cname);
  END IF;
END $$;

DO $$
DECLARE iname text;
BEGIN
  SELECT indexname INTO iname FROM pg_indexes
  WHERE schemaname = 'store' AND tablename = 'stock_reservations' AND indexname LIKE '%prn%';
  IF iname IS NOT NULL AND iname <> 'idx_stockreserv_prn' THEN
    EXECUTE format('ALTER INDEX store.%I RENAME TO idx_stockreserv_prn', iname);
  END IF;
END $$;

======================================================================================================================================================
074_project_invoice_generation.sql
======================================================================================================================================================

ALTER TABLE admin_db.users ADD COLUMN IF NOT EXISTS perm_project_invoice_generation BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE project.projects ADD COLUMN IF NOT EXISTS invoice_url TEXT;
ALTER TABLE project.projects ADD COLUMN IF NOT EXISTS invoice_revision INTEGER NOT NULL DEFAULT 0;

======================================================================================================================================================
075_drop_fg_store_incharge_person.sql
======================================================================================================================================================

ALTER TABLE production.finished_goods_inventory DROP COLUMN IF EXISTS fg_store_incharge_person;