# ABPS PORTAL — SYSTEM OVERVIEW & HANDOFF

**Last updated:** 11 August 2026
**Purpose:** Single source of truth for anyone (human or AI) picking up work on this codebase.
Read this fully before touching anything.

---

## 0. READ THIS FIRST — WORKING RULES

These are non-negotiable conventions for this project. Violating them has caused real
production bugs in the past.

1. **Never guess at current file contents.** Files change outside any given session.
   Before emitting a find/replace edit, actually read the file. In Claude Code, use
   `Read`/`Grep` on the real file — do not reconstruct code from memory or from an
   older part of the conversation.
2. **Never output or rewrite a full file.** Emit only targeted, modified functional
   blocks. Give a "find this exact block" and "replace with this block" pair, and name
   the file the change belongs to.
3. **Minimal comments in emitted code.** The codebase already has heavy explanatory
   comments; don't add more noise. Do keep existing comments that explain *why*.
4. **Frontend number formatting:** never render trailing decimal zeros. `5` not `5.00`,
   `5.2` not `5.20`. Helpers already exist (`trimNum`, `fmtQty`, `formatQtyTrimmed`).
5. **Ask before generating a full document or file.** (User preference.)
6. **Concurrency is real.** 20–30 internal users across Marketing, Design, Purchase,
   Store, Production hit this simultaneously. Guard against data collisions, missing
   rollbacks, and race conditions. Any multi-table write goes inside `withTransaction`
   with `FOR UPDATE` row locks on anything read-then-written.
7. **Dead code is flagged, not deleted, unless explicitly asked.** See §12.

---

## 1. WHAT THIS SYSTEM IS

ABPS Portal is an internal ERP/workflow system for a manufacturing business that builds
electrical equipment (capacitor banks, reactors, APFC panels, etc.) to customer order.

It covers the full lifecycle:

```
Marketing lead → Customer PO → Project → BOQ (design) → PRN (purchase request)
  → RM PO (purchase order) → Gate Entry → GRN → QA Check → Raw Material Store
  → Store Ticket (material issue) → Job Card (production) → Finished Goods
  → Project Invoice → Project Complete
```

**Users:** ~20–30 internal engineers and store workers, concurrent, across 5 departments
plus Admin and Accounts.

### History (important context)
The system was **originally a ~9,000-line Google Apps Script `Code.gs` backend** with
5 Google Sheet workbooks as the database. It has been **fully migrated** to
Node/Express on Cloud Run + Cloud SQL Postgres.

- `code.js` (in some archives/project history) is the **frozen historical Apps Script
  original**. It is **NOT live, NOT deployed, and must NEVER be edited.** It exists only
  as a reference for original business rules when something's intent is unclear.
  Beware: search results often surface `code.js` — always confirm you're looking at the
  live Node file (`routes/*.js`, `lib/*.js`) before acting.
- Google Sheets are now a **read-mostly reporting/mirror layer** fed from Postgres, with
  a few deliberate write-back exceptions (§7.3).

---

## 2. ARCHITECTURE & STACK

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND: index.html (single file, ~24k lines)              │
│ Vanilla JS + inline CSS. Served from GitHub Pages.          │
│ https://abps-solution.github.io/Portal/                     │
└───────────────────────────┬─────────────────────────────────┘
                            │ POST { action, ...payload, sessionToken }
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ BACKEND: Node 20 / Express on Google Cloud Run              │
│ Service: abps-backend   Region: asia-south1                 │
│ https://abps-backend-244281871074.asia-south1.run.app       │
└───────────────────────────┬─────────────────────────────────┘
                            │ pg pool
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ DATABASE: Cloud SQL Postgres                                │
│ Schemas: admin_db, marketing, project, design, purchase,    │
│          store, production, accounts                        │
└───────────────────────────┬─────────────────────────────────┘
                            │ trigger + poller + scheduled snapshot
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ MIRROR: 8 Google Sheet workbooks (reporting layer)          │
└─────────────────────────────────────────────────────────────┘
```

Also integrated: **Google Drive** (documents), **Gmail API** (inbound lead email polling,
outbound offer detection), **Gemini** (AI parsing of invoices, POs, business cards),
**PDFShift** (HTML→PDF for Purchase Orders), **pdf-lib** (native PDF generation for
BOQ/PRN/Job Card/Invoice).

### 2.1 The `/exec` bridge (important quirk)

The frontend still speaks the **old Apps Script calling convention**: every call is a
POST to a single URL with `{ action: "someAction", ...payload, sessionToken }`.

`server.js` provides a bridge:

```js
app.post('/exec', requireSession, (req, res, next) => {
  const action = req.body?.action;
  req.url = `/api/${action}`;
  app.handle(req, res, next);
});
```

So `action: "createBOQDraft"` is rewritten to `POST /api/createBOQDraft` and handled by
whichever router owns that path. **Consequence: adding a new backend route requires no
frontend routing change** — just `router.post('/myNewAction', ...)` in any mounted
router, and the frontend can call `apFetch({ action: "myNewAction", ... })`.

The frontend constant is `GAS_URL` in `index.html` (legacy name, now points at Cloud Run).

### 2.2 Router mounting order (`server.js`) — do not reorder casually

```js
app.use('/api', authRoutes);              // unauthenticated actions exempted by name
app.use('/api', gmailAuthRoutes);         // MUST be before requireSession routers
app.use('/api', internalRoutes);
app.use('/api', require('./routes/sheetsSyncInternal'));
app.use('/api', requireSession, designRoutes);
app.use('/api', requireSession, projectsRoutes);
app.use('/api', requireSession, purchaseRoutes);
app.use('/api', requireSession, marketingRoutes);
app.use('/api', requireSession, inventoryRoutes);   // = routes/store.js
app.use('/api', requireSession, productionRoutes);
app.use('/api', requireSession, utilityRoutes);
app.use('/api', requireSession, dashboardsRoutes);
app.use('/api', requireSession, accountsRoutes);
```

Reason: `app.use('/api', requireSession, ...)` runs `requireSession` for **every**
`/api/*` request whether or not that router owns the path. If it 401s it never calls
`next()`, so later routers never get a chance. Unauthenticated/internal routers must be
mounted first.

`server.js` also logs `[DUPLICATE ROUTE]` warnings at boot — silent route shadowing has
caused real bugs (repair QA, reassign, drawings, tickets). **Check boot logs after adding
routes.**

### 2.3 Sheet-change poller piggyback (Cloud Run quirk)

Cloud Run only allocates CPU while handling a request, so `setInterval` background timers
silently never fire. Instead, `server.js` piggybacks `pollSheetChangeLog()` on incoming
requests, throttled to once per 3 seconds, never awaited. Cloud Scheduler jobs hitting
the sync endpoints guarantee a tick every 5–10 min even with zero human traffic.

---

## 3. REPOSITORY LAYOUT

```
ABPS Portal/
│   .gitignore
│   index.html                  ← ENTIRE frontend (~24k lines), GitHub Pages
│   ABPS_SYSTEM_OVERVIEW.md     ← this file
│
└───abps-backend/
    │   ABPS Sheet to Database Pull.js   ← standalone/legacy helper, not in server
    │   auth.js                  ← session middleware + login routes
    │   db.js                    ← pg Pool + withTransaction()
    │   Dockerfile
    │   package.json
    │   server.js                ← Express entrypoint, router mounting, /exec bridge
    │
    ├───lib/
    │       audit.js             ← writeAuditLog()
    │       backup.js            ← daily .xlsx workbook backup to Drive
    │       displayName.js       ← displayName(req) → "First Last" of logged-in user
    │       drive.js             ← Drive folder/file helpers (uploadFile, ensureNestedFolderPath…)
    │       gemini.js            ← all AI parsing calls
    │       gmail.js             ← Gmail read/send
    │       liveSync.js          ← syncLiveRow() / removeLiveRow() — push one row to Sheets
    │       mailer.js            ← nodemailer
    │       pdf.js               ← pdf-lib document builders (BOQ, PRN, PO, JobCard, Invoice)
    │       pdfshift.js          ← HTML→PDF w/ multi-key quota rotation
    │       permMap.js           ← DB perm_* columns → frontend camelCase permission object
    │       poTemplate.js        ← Purchase Order HTML template
    │       prnSync.js           ← ★ CORE stock/PRN engine (see §9)
    │       sheetChangePoller.js ← reads admin_db.sheet_change_log, pushes changed rows
    │       sheetsPull.js        ← Sheets → DB write-back (editable tables only)
    │       sheetsRegistry.js    ← ★ table → spreadsheet/tab/tier/query registry
    │       sheetsSync.js        ← low-level Sheets API write (snapshot + upsert)
    │       storage.js           ← GCS upload
    │
    ├───migrate/                 ← ONE-TIME Sheets→Postgres migration tool. Frozen.
    │       engine.js               Not part of the running server. Do not edit.
    │       run.js                  Uses older `inventory.` schema names — ignore.
    │
    ├───migrations/
    │       Combined_SQL_migration_queries.sql   ← ★ append-only migration history
    │
    └───routes/
            accounts.js          ← Tour Expense tracker
            dashboards.js        ← 5 department dashboards (read-only aggregates)
            design.js            ← Item Codes, BOQ create/authorize/revise, Drawings
            gmailAuth.js         ← Gmail OAuth connect/revoke
            internal.js          ← Cloud Scheduler triggers (email polling, digest)
            marketing.js         ← Leads, companies, follow-ups, tasks, documents
            production.js        ← Job Cards, Finished Goods, JC letterhead
            projects.js          ← Projects, Manufacturing Clearance, Project Status,
            │                      Project Invoice Generation
            purchase.js          ← PRN, RM PO, revisions, PPS tracking, stock reservation edits
            sheetsSyncInternal.js← Cloud Scheduler sync/backup endpoints
            store.js             ← ★ largest. Gate Entry, GRN, QA, tickets, stock,
            │                      BOQ Increase approvals, sweeps
            utility.js           ← dropdown feeders, session permissions
```

**Naming trap:** `routes/store.js` is imported in `server.js` as `inventoryRoutes`.
The DB schema was also renamed `inventory` → `store` partway through history, so old
migrations say `inventory.master_inventory` while live code says
`store.raw_material_store`. Both refer to the same table.

---

## 4. DEPLOYMENT & ENVIRONMENT

- **Backend:** Cloud Run service `abps-backend`, region `asia-south1`.
  Deploy = build Dockerfile & deploy to that service.
- **Frontend:** `index.html` pushed to the GitHub Pages repo (`abps-solution/Portal`).
- **DB:** Cloud SQL Postgres. Note: the DB has a **scheduled ~12-hour uptime window**
  (session TTL is set to 12h to match).
- **Logs:** `gcloud run services logs read abps-backend --region asia-south1 --limit 50`
  — this is the fastest way to get a real stack trace; the UI only shows the message.

### Environment variables (non-exhaustive)
```
GOOGLE_CLIENT_ID                 OAuth client for Google Sign-In
DB_USER / DB_PASSWORD / DB_NAME / DB_HOST / DB_PORT
INTERNAL_TRIGGER_SECRET          guards /api/internal/* (x-internal-secret header)
PDFSHIFT_API_KEY_1..5            rotated on quota exhaustion
PRODUCTION_DRIVE_FOLDER_ID       Job Card documents root
PROJECT_INVOICE_FOLDER_ID        Project Invoice output folder
INVOICE_FOLDER_ID                vendor invoice images (gate entry)
CHALLAN_FOLDER_ID                vendor challan images
VISITING_CARDS_FOLDER_ID
SECURE_ADMIN_SHEET_ID / MARKETING_SHEET_ID / DESIGN_SHEET_ID /
PURCHASE_SHEET_ID / INVENTORY_SHEET_ID / PRODUCTION_SHEET_ID   (migrate tool only)
```

### Cloud Scheduler jobs (hit `/api/internal/*` with `x-internal-secret`)
| Endpoint | Purpose | Cadence |
|---|---|---|
| `/internal/syncSheetsPartial` | snapshot-sync `tier: 'partial'` tables | ~5 min |
| `/internal/syncSheetsScheduled` | snapshot-sync `tier: 'scheduled'` tables | ~10 min |
| `/internal/pullSheetsToDb` | Sheets → DB write-back for editable tables | periodic |
| `/internal/dailyBackup` | export workbooks to .xlsx into Drive | daily |
| `/internal/pollInboundEmails` | Gmail lead ingestion | periodic |
| `/internal/pollOutboundOffers` | detect sent offers | periodic |
| `/internal/sendWeeklyDigest` | admin digest email | weekly |
| `/internal/initLiveSheetTabs` | manual: pre-create tabs for empty live tables | on demand |

---

## 5. AUTH & PERMISSIONS

### 5.1 Login flow
Google Sign-In → `POST /api/googleLogin` (`auth.js`) → verifies Google ID token →
looks up `admin_db.users` by email → issues a random `session_token` stored on the user
row with a `token_expiry` 12h out → frontend stores it and sends it on every subsequent
request.

`requireSession` middleware loads the full user row (all `perm_*` columns) into `req.user`.
`UNAUTHENTICATED_ACTIONS` = `googleLogin`, `pullGlobalPersonnelDirectory`.

401 responses carry `code: 'SESSION_EXPIRED'` so the frontend can force a re-login.

### 5.2 Permission model
Every feature is gated by a boolean column `perm_<something>` on `admin_db.users`.
Backend guard:
```js
router.post('/someAction', requirePermission('perm_something'), async (req,res)=>{...})
// array form = OR:
requirePermission(['perm_pps_tracking', 'perm_project_status'])
```

Frontend gets a camelCase object via `lib/permMap.js`:
```js
perm_project_invoice_generation  →  projectInvoiceGeneration
```
and gates menu cards with e.g.
```js
const canProjectInvoiceGeneration = userPermissionsObject.projectInvoiceGeneration === true;
```

### 5.3 ★ THE 5-PLACE RULE — adding or renaming a permission

A permission touches **five** places. Miss one and it fails **silently**.

| # | File / place | What to change |
|---|---|---|
| 1 | migration SQL | `ALTER TABLE admin_db.users ADD COLUMN IF NOT EXISTS perm_x BOOLEAN NOT NULL DEFAULT false;` |
| 2 | `auth.js` | add `perm_x` to the big `SELECT` in `requireSession` |
| 3 | `lib/permMap.js` | add `camelName: !!dbUser.perm_x` |
| 4 | `lib/sheetsRegistry.js` | add `perm_x AS "Human Label"` to the `users` query |
| 5 | `lib/sheetsPull.js` | add `'Human Label': 'perm_x'` to `USER_PERM_HEADERS` |
| 6 | **Google Sheet (manual)** | add/rename the column header in the **Users** tab, text matching #4/#5 **exactly** |

If the Sheet header and the code label disagree, the Sheet→DB permission pull silently
stops reading that column and everyone's value freezes at its last synced state.
**Deploy code and rename the Sheet header together.**

### 5.4 Admin
`perm_admin` is separate. Frontend stores `localStorage.isUserAdminGlobal === "true"`
and uses it to show/hide Delete buttons on marketing cards, follow-ups, tasks, email leads.
(Verified correct as of this writing — non-admins get no Delete button rendered at all.)

---

## 6. DATABASE SCHEMA MAP

Full DDL history lives in `migrations/Combined_SQL_migration_queries.sql` (append-only —
see §13 for the required format). Below is the practical map.

### `admin_db`
| Table | Notes |
|---|---|
| `users` | email PK, first_name, last_name, `department_id` (smallint FK), status, `session_token`, `token_expiry`, ~50 `perm_*` booleans |
| `departments` | `department_id` (serial), `name`. Currently: Marketing, Design, Purchase, Store, Production, Admin (+ Quality Assurance if added) |
| `audit_log` | written by `writeAuditLog()` |
| `sheet_change_log` | populated by the `trg_sheet_sync` trigger; drained by the poller |
| `gmail_connections`, `gemini_call_log` | integrations/ratelimits |

**Note:** `users.department_id` is a **single smallint FK**, not a list — even though the
frontend receives `departmentsList` (an array). The backend wraps the one resolved
department name in a 1-element array.

### `marketing`
`companies`, `leads` (was `enquiries`; `lead_id` like `LEAD-42`), `follow_ups`, `tasks`,
`offers_sent`, `purchase_order_information`, `uploaded_document_information`,
`processed_emails`, `cold_introductory_emails_sent`.

- `leads.engineer_name` **stores an email address**, FK-ish to `admin_db.users.email`.
  Display name is resolved via join. Filters search by email. (See §11 — this was a
  real data bug.)
- `companies.type_of_customer` is a **comma-joined string** e.g. `"Industry, Consultant"`.

### `project`
| Table | Columns |
|---|---|
| `projects` | `project_id` (PK, e.g. `ABPS_26-27_JUL_Test Company 1_PO-001-TEST`), `project_status`, `company_name`, `created_at`, `po_number`, `delivery_date`, `invoice_url`, `invoice_revision` |

`project_status` values seen: `Active`, `Inactive`, `Complete`.
⚠️ It is **`Complete`**, not `Completed` — the Manufacturing Clearance UI pill says
"Completed" and the backend normalizes it.

### `design`
| Table | Notes |
|---|---|
| `item_codes` | `item_code` (e.g. `ABPS00219`), material name, rating, `type_of_material`, unit |
| `boq_drafts` | ★ **this is the LIVE/authorized BOQ table** |
| `bill_of_quantity` | ★ this is the **drafts** table |
| `boq_update_requests` | BOQ revision requests |
| `project_drawings` | uploaded drawing docs |

⚠️ **The two BOQ tables were swapped by a migration** (`bill_of_quantity` ⇄ `boq_drafts`).
The names are now the opposite of what they sound like. Live/authorized BOQ header data
is queried from **`design.boq_drafts`** in most current code (`project_id`, `boq_id`,
`product_name`, `product_rating`, `order_quantity`, `customer_name`, `department`,
`status`, `version`, `pdf_url`, `pdf_url_no_cost`). Always check which one a given query
uses rather than assuming from the name.

`order_quantity` = **number of Sets** the BOQ covers (i.e. number of Job Cards).

### `purchase`
| Table | Notes |
|---|---|
| `purchase_request_notes` | `prn_id`, `boq_id`, `project_id`, `status`, `version`, `created_by` |
| `prn_line_items` | ★ per-item quantities & the live reservation pools (see §9) |
| `raw_material_purchase_orders` | `po_no`, vendor, taxes, totals, `pdf_url` |
| `raw_material_po_line_items` | |
| `po_revision_requests` | |
| `pps_tracking` | per-PO-line receipt tracking: `purchased_quantity`, `actual_received_quantity` |
| `vendor_information`, `vendor_performance` | |
| `pdfshift_state` | single row, current API key pointer |

**PRN statuses:** `Pending Authorization` → `PRN Generated` → `Completed`, plus `Rejected`.
(The user colloquially calls these "Pending"/"Completed".)

`prn_line_items` key columns:
```
boq_required_quantity        raw BOQ need
buffer_percent               buffer % applied
buffered_purchase_quantity   need + buffer
current_unassigned_store_quantity   free stock at PRN time
purchase_quantity            what actually must be bought
still_to_order_quantity      not yet placed on a PO
received_quantity            received via GRN/QA
store_qty_from_spare / store_qty_from_raw   IMMUTABLE snapshot at authorization
spare_pool_remaining / raw_pool_remaining   ★ LIVE reservation pools
awaiting_po_revision         blocks completion
```

### `store` (was `inventory`)
| Table | Notes |
|---|---|
| `raw_material_store` | (was `master_inventory`) `item_code` PK, `total_stock`, `reserved_stock`, **`available_stock` GENERATED** = `total_stock - reserved_stock` |
| `spare_store` | (was `spare_inventory`) `total_stock`, `reserved_stock`, `unusable_stock`, **`available_stock` GENERATED** = `total_stock - unusable_stock - reserved_stock` |
| `stock_reservations` | (was `stock_assignments`) **append-only audit log** of claim events |
| `store_tickets` | material request/return tickets |
| `inbound_store_ledger` | gate entry → GRN |
| `outbound_store_ledger` | issues |
| `receipt_attributions` | per-QA-event attribution log (see below) |
| `rejected_missing_material_tracking` | QA rejections |
| `spare_blocked_allocations` | spare qty blocked against a Job Card |
| `stock_sweeps` | manual stock correction events |

**★ `available_stock` is a GENERATED COLUMN on both stores.** Any `INSERT` that lists it,
or any `UPDATE` that assigns it, throws
`cannot insert a non-DEFAULT value into column "available_stock"`.
Write `total_stock` / `reserved_stock` / `unusable_stock` only; the rest computes itself.
Several older code paths violated this and were fixed — see §11.

**`store.receipt_attributions`** — one row per attribution event, never aggregated:
```
attribution_id, event_type ('QA'|'REPAIR_QA'), ledger_id, rejection_id, sweep_id,
grn_number, item_code, po_no, prn_id (NULL = free stock),
kind ('po_credit'|'auto_assign'|'free_stock'), quantity, assignment_id,
reversed, reversed_at, created_at, created_by
```
Exists so **QA Revision** can precisely reverse a receipt. `pps_tracking` and
`prn_line_items` only hold cumulative totals, so without this there'd be no way to know
how much of a PRN's `received_quantity` came from one specific QA submission.
`checkReceiptReversible` reads it back to decide if an event can still be cleanly undone;
`reverseReceiptAttributions` replays these rows rather than recomputing.

**`store_tickets`**
```
ticket_id, request_or_return ('Request'|'Return'), type_of_store, project_id,
job_card_number, department, requested_returned_by, backorder_quantity,
date_created, date_actioned, actioned_by, status, items (jsonb),
parent_ticket_id, justification_notes
```
`status` CHECK: `Pending`, `Approved`, `Rejected`, `Pending BOQ Increase Review`,
`Fulfilled`, `Rejected by Admin`, `Approved & Released`.

⚠️ **There is no separate "BOQ Increase" table.** A Job Card Increase request is just a
`store_tickets` row with `status = 'Pending BOQ Increase Review'`.

### `production`
| Table | Notes |
|---|---|
| `job_cards` | `job_card_number`, `project_id`, `customer_name`, `product_name`, `product_rating`, `boq_id`, `set_number` (int), `date_created`, `status`, `drive_image_url` |
| `job_card_materials` | `row_id`, `job_card_number`, `boq_id`, `item_code`, `allotted_quantity`, `used_quantity`, `remaining_quantity`, `increase_approved_quantity`, `type_of_store` |
| `finished_goods_inventory` | `fg_id`, `job_card_number`, `product_serial_number`, `finished_good_use`, `qa_person`, `qa_done`, doc URLs, `status` |

- Job Card numbers look like `JC_Set-1_26-27_AUG_<Company>_PO-001-TEST_<Product>`.
  `set_number` is a real int column; UI displays `JC_Set1`, `JC_Set2`…
- `job_card_materials.pending_quantity` was **DROPPED** — anything referencing it breaks.
- `finished_goods_inventory.finished_good_use` values are exactly:
  **`'Use in other Product'`** and **`'Keep in FG Store'`**.
  UI maps these to "Used in other Product" / "Ready for Dispatch".
- `fg_store_incharge_person` was dropped (redundant with the logged-in user).

### `accounts`
`tour_employees`, `tour_advances`, `tour_vouchers` — Tour Expense tracker, gated by the
single `perm_tour_expense`. Every balance write uses `FOR UPDATE` inside a transaction.

---

## 7. GOOGLE SHEETS SYNC ARCHITECTURE

Postgres is the source of truth. Sheets are a mirror, for humans who want to read/filter
data outside the app.

### 7.1 The registry
`lib/sheetsRegistry.js` holds `SPREADSHEET_IDS` (8 workbooks: ADMIN, MARKETING, DESIGN,
PURCHASE, INVENTORY, PRODUCTION, ACCOUNTS, PROJECT) and `TABLE_REGISTRY`:

```js
tableKey: {
  sheet: 'INVENTORY',           // which workbook
  tab: 'Stock Reservations',    // tab name — must match the real tab EXACTLY
  tier: 'live'|'partial'|'scheduled',
  keyColumn: 'Assignment ID',   // column A, used to match rows on upsert
  hideKeyColumn: true,          // optional: hide col A from view
  query: `SELECT x AS "Header Name", ...`   // aliases become the sheet header row
}
```

### 7.2 The three tiers
| Tier | How it syncs | When |
|---|---|---|
| `live` | `syncLiveRow(tableKey, keyValue)` called explicitly from route code after a write; upserts one row | immediately, best-effort, never awaited |
| `partial` | full snapshot via Cloud Scheduler | ~5 min |
| `scheduled` | full snapshot via Cloud Scheduler | ~10 min |

**★ Live-tier tables only reach the Sheet if code explicitly calls `syncLiveRow`.**
Forgetting the call means the Sheet silently goes stale forever. This was a real bug in
the Project Invoice feature (fixed). When you write to a live-tier table, add the call.

There is also a DB trigger `trg_sheet_sync` on several tables writing into
`admin_db.sheet_change_log`, drained by `lib/sheetChangePoller.js` — this covers changes
made **outside** the app (direct SQL, Sheet edits).

`syncFullSnapshot` deliberately **writes fresh data first, then trims trailing rows**
(not clear-then-write) so a mid-write failure leaves stale rows rather than a blank tab.

### 7.3 Sheets → DB write-back (`lib/sheetsPull.js`)
Only a small allowlist is writable from the Sheet:
- **Users** — permissions & status (`pullUsers`)
- **Projects**, **Item Codes**, **Material Buffer %**, **Vendor Information**
- **Master Inventory / Spare Inventory** — ⚠️ marked **TEMPORARY, testing only**:
  lets a tester overwrite `total_stock` / `reserved_stock` / `unusable_stock` directly
  from the Sheet. Note it maps **only** those columns — `available_stock` is generated
  and correctly absent.

If you rename a Sheet **tab** or **column header**, you must update `sheetsRegistry.js`
(tab/aliases) and `sheetsPull.js` (header→column map) to match exactly.

---

## 8. BUSINESS FLOW — END TO END

### 8.1 Marketing
Business-card scan (Gemini) or inbound email (Gmail poll) → **Lead**. Leads belong to a
**Company**. Follow-ups and Tasks hang off leads. Uploaded docs: customer PO, dispatch
bill, commissioning report.

Search screens: by Company, by Status, by Engineer, by Type of Customer, by City/State,
Tasks matrix.

### 8.2 Project creation & Manufacturing Clearance
A customer PO creates a **Project** (`ABPS_<FY>_<MON>_<Customer>_<PONo>`), initially
`Inactive`. **Manufacturing Clearance** (`perm_manufacturing_clearance`) activates it →
`Active`, making it visible to all departments. The same screen has an **Inactive /
Active / Completed** pill filter; Completed projects offer **Reactivate**.

### 8.3 Design — BOQ
- **Item Codes** (`ABPS00219` etc.) are the master material catalog. New materials must
  get an item code first (Create BOQ links out to it when no product matches).
- **Create BOQ** → draft with header (project, product name/rating, department,
  Order Qty in Sets) + material rows (qty per 1 Set).
- **Authorize BOQ** → becomes live, generates two PDFs (with & without costing) into
  Drive, and calls `ensureMaterialsInInventory` to create `raw_material_store` /
  `spare_store` rows for any new item codes.
- **Revise BOQ** / **Authorize BOQ Revision** → versioned updates (Rev-N PDF naming).

### 8.4 Purchase — PRN and PO
- **Create PRN**: for an authorized BOQ, computes per item:
  `boq_required_quantity` → apply buffer % → `buffered_purchase_quantity`
  → subtract free store stock → `purchase_quantity`.
  Free stock consumed at this point is **claimed/reserved** for that PRN.
- **Authorize PRN** → `PRN Generated`, PDF to Drive, reservation split recorded
  (`store_qty_from_spare` / `store_qty_from_raw` snapshot, plus the live
  `spare_pool_remaining` / `raw_pool_remaining` pools).
- **Revise PRN** / **Authorize PRN Revision** → delta PRNs.
- **Create RM PO** (optionally AI-parsed from a vendor PO file), **Authorize**, **Revise**.
- **PPS Tracking**: per-PRN procurement progress + action plans.
- A PRN auto-completes when **every** line has
  `received_quantity >= purchase_quantity` and no line is `awaiting_po_revision`
  (`refreshPRNCompletion` in `lib/prnSync.js`).

### 8.5 Store — inbound
1. **Gate Entry** — vendor invoice/challan photographed, AI-parsed (Gemini), PO matched.
2. **Store Entry & GRN** — GRN number generated, item codes matched (AI-assisted).
3. **Raw Materials Q/A Check** — per line: OK qty / Not-OK qty / reason / action for
   rejected (return to vendor, repair at ABPS…). On submit:
   - OK qty is credited to the PO's PRN lines FIFO (`distributeReceiptFIFO` against
     `pps_tracking` capacity), any excess goes through generic `autoAssignStock`, and
     anything still unclaimed becomes free stock.
   - Every allocation is logged in `receipt_attributions`.
   - Not-OK qty creates a `rejected_missing_material_tracking` row.
4. **QA Revision** — reverses a prior QA event exactly, using the attribution log.
5. **Store Inward Rejected Material** — vendor replacement/repair workflow.

### 8.6 Store — outbound & production
- **Job Cards** are created per BOQ per Set (`set_number`), each with a
  `job_card_materials` allotment = BOQ per-set qty.
- **Create Store Ticket** (engineer): request material against a Job Card, from
  Raw Materials Store or Spare Store. Requesting more than the Job Card's
  `remaining_quantity` flags the item and routes the ticket to
  **`Pending BOQ Increase Review`** instead of normal approval.
- **Approve Store Tickets**: approve/partially approve/reject. On
  **Approved & Released**, for each item:
  - `job_card_materials.used_quantity += releaseQty`, `remaining_quantity -= releaseQty`
  - store `total_stock -= releaseQty`, `reserved_stock -= reserved amount`
  - the BOQ's `raw_pool_remaining` / `spare_pool_remaining` are drawn down
  - unused reservation (reserved but not actually issued) is released back
- **Approve Job Card Increase Requests** (`perm_approve_job_card_increase`): reviewer sets
  an absolute **Final Ticket Qty** per item (no Reject action by design), then approval
  raises `increase_approved_quantity` and proceeds. Shortfalls can trigger
  `findAndBorrowForShortfall` (§9.4).
- **Add to Finished Goods Store**: validates the Job Card's material consumption matches
  the BOQ (`validateJobCardBOQConsumption`), captures serial number, `finished_good_use`,
  QA done flag, and up to 6 document uploads. QA Person = the logged-in user.

### 8.7 Project Invoice Generation (Production) — NEW, see §10
Marks the whole project done, releases everything, produces the invoice PDF.

---

## 9. ★ THE STOCK RESERVATION ENGINE (`lib/prnSync.js`)

This is the most subtle and highest-risk part of the system. Read this section before
touching anything that moves stock.

### 9.1 The three numbers, and which one is real

| Where | Meaning | Moves when? |
|---|---|---|
| `raw_material_store.reserved_stock` | **aggregate** reserved across all BOQs for that item | claim, release, ticket release |
| `prn_line_items.raw_pool_remaining` | ★ **per-BOQ live reservation** — the real per-project number | claim, release, ticket release |
| `stock_reservations.assigned_quantity` | **gross, all-time claim events** — append-only audit history | claim only; **never decreases** |

**`stock_reservations` is an audit log, NOT a live balance.** There's a comment in
`store.js` saying exactly this. A screen that sums `assigned_quantity` will show a number
much larger than `reserved_stock` for any item that's had ticket consumption. This caused
a real bug (§11). `utilized_quantity` exists on that table but is **not written to** by
the raw-material path — do not rely on it.

**Use `prn_line_items.raw_pool_remaining` for "how much is this BOQ still holding".**

⚠️ **Pre-migration-068 caveat:** PRNs claimed before migration 068 never had
`raw_pool_remaining` / `spare_pool_remaining` backfilled and sit at `0` regardless of
real activity. Old test PRNs will look wrong. This is known and accepted; the fix is the
data wipe, not code.

`store_qty_from_raw` / `store_qty_from_spare` are **immutable snapshots taken at PRN
authorization** — ticket activity must never modify them.

### 9.2 Core functions in `lib/prnSync.js`
```
computePRNDeltaRows(client, boqId)          build PRN/delta line items from BOQ
applyPRNRows(client, prnId, rows, person)   write them
applyStoreReservationSplit()                apply signed reservation deltas to both pools
splitStoreClaim() / splitStoreRelease()     decide spare-vs-raw split of a qty
refreshPRNCompletion(client, prnId)         ★ the ONLY place PRN status flips
regeneratePRNDocument(prnId, client)        rebuild PRN PDF from current state
applySilentPRNDecrease(client, boqId, actor)
distributeReceiptFIFO(client, poNo, itemCode, okQty)  ★ GRN receipt → PRN credit
claimStoreForPRN(...)                       ★ the ONE funnel for claiming stock
claimRawOnlyForPRN(...)                     raw-only variant
findAndBorrowForShortfall({...})            ★ cross-BOQ borrowing (§9.4)
releaseStoreClaimFromPRN(...)               ★ the ONE funnel for releasing stock
autoAssignStock(...)                        generic FIFO assign of free stock
completeDeferredUnwinds(client, prnId)
recordReceiptAttributions(client, ctx, entries)
checkReceiptReversible(client, attributions)
reverseReceiptAttributions(client, attributions)
earmarkClaimForTicket / restoreEarmarkedClaim   ← RETIRED, still exported, harmless
```

**Rule: all claiming goes through `claimStoreForPRN`, all releasing through
`releaseStoreClaimFromPRN`.** They keep the aggregate and per-PRN numbers in step and
call `refreshPRNCompletion`. Don't hand-roll a stock UPDATE.

### 9.3 `refreshPRNCompletion` — the completion rule
```js
complete = every line: !awaiting_po_revision && received_quantity >= purchase_quantity
status   = complete ? 'Completed' : 'PRN Generated'
UPDATE ... WHERE prn_id = $1 AND status IN ('PRN Generated','Completed')
```
⚠️ The `WHERE ... status IN (...)` guard means a PRN stuck at **`Pending Authorization`
will never be flipped by this function.** Any "force complete" logic must handle that
case separately.

"Completed" means **procurement is done**, not that production consumed the material.
A store-only line (purchase 0) is complete immediately. Reservations stay held until
physical issue.

### 9.4 Cross-BOQ borrowing (`findAndBorrowForShortfall`)
When a ticket needs more than the Job Card's BOQ has reserved, the system automatically
looks for donor reservations: **same-BOQ donors first, then cross-BOQ**, ranked by
historical Set velocity (i.e. take from the BOQ least likely to need it soon).
This is why the manual Reserve Store Stock screen is a convenience/override tool, not the
mechanism that makes sharing possible.

### 9.5 Reserve Store Stock screen (Store)
Permission `perm_reserve_store_stock`. Lets an operator search a material and edit the
per-BOQ reserved quantity directly.
- Reads `prn_line_items.raw_pool_remaining` per PRN (joined to BOQ + `order_quantity`
  for the "Number of Job Cards" column).
- Increases call `claimStoreForPRN`; decreases call `releaseStoreClaimFromPRN`.
- The live summary recalculates as
  `projectedReserved = reservedStock - sumOfOriginalVisibleRows + sumOfNewVisibleRows`
  — this preserves reserved stock held by PRNs whose `prn_id` went NULL (their PRN was
  deleted; `stock_reservations.prn_id` is `ON DELETE SET NULL`), which the editable table
  can't show.
- **Raw material store only.** Spare and FG are untouched by this screen.

### 9.6 Concurrency
`db.js` exposes `withTransaction(fn)`. Every stock/balance mutation must:
1. run inside `withTransaction`
2. `SELECT ... FOR UPDATE` the rows it will modify, before computing deltas
3. never trust a client-side check (re-validate server-side — two tickets can be approved
   in the gap between page load and click)

---

## 10. RECENTLY BUILT — PROJECT INVOICE GENERATION

New Production module, permission `perm_project_invoice_generation`, menu card
`mod-project-invoice` after "Add to Finished Goods Store".

### Eligibility (`fetchInvoiceEligibleProjects`, `routes/projects.js`)
A project appears in the dropdown only if:
- `project_status = 'Active'`, AND
- it has ≥1 BOQ, AND
- **every** BOQ has ≥1 Job Card (a zero-JC BOQ blocks — "production never started"), AND
- **every** Job Card number appears in `production.finished_goods_inventory` (any status)

### On selecting a project (`fetchProjectInvoiceDetail`)
Returns BOQs, Job Cards (with `finished_good_use`), and two blocker counts from
`store_tickets` joined on this project's job card numbers:
- `pendingTicketsCount` — statuses `Pending` / `Approved`
- `pendingBoqIncreaseCount` — status `Pending BOQ Increase Review`

If either > 0 → show the blocker message(s), show the BOQ/JC table for information, and
**hide** the Generate button. (Future "Invoice Question boxes" must be hidden here too.)

### Generate (`generateProjectInvoiceAndComplete`) — one transaction
1. Re-check blockers server-side; throw if any exist.
2. For each non-Completed PRN under this project's BOQs:
   - if `status = 'Pending Authorization'` → set `Rejected`, skip (never authorized)
   - else set `purchase_quantity = received_quantity`, `still_to_order_quantity = 0`
     on short lines, then call `refreshPRNCompletion`
3. Release every remaining `raw_pool_remaining` / `spare_pool_remaining` via
   `releaseStoreClaimFromPRN` → becomes free `available_stock`.
   **No re-cascade** — freed stock just sits available for the next PRN/ticket that asks.
4. `project_status = 'Complete'`, store `invoice_url` + `invoice_revision`.
5. Build PDF (`buildProjectInvoicePdfBuffer` in `lib/pdf.js`, using the shared
   `buildDocument`), upload to `PROJECT_INVOICE_FOLDER_ID`.
   Filename: `Project_Invoice_<ProjectID>.pdf`, then `Project_Invoice_Rev2_<ProjectID>.pdf`,
   `Rev3`… (there is deliberately no `Rev1`).
6. `syncLiveRow('projects', projectId)` + `writeAuditLog`.

**Guard:** the frontend requires the user to **type the Project ID** into a centered
confirm modal; the backend also re-checks `confirmProjectId === projectId`.

### Reactivate (`reactivateCompletedProject`)
From Manufacturing Clearance → Completed pill → Reactivate button
(`mcReactivateProject`). Flips `Complete` → `Active` **only**. BOQs unchanged, PRNs stay
Completed, force-closed tickets stay closed, freed stock stays freed. **Resuming
production requires a fresh Job Card Increase or new PRN** — by design, to avoid
reintroducing stale quantities.

### Delivered PO arriving after force-close
Verified safe: `distributeReceiptFIFO` allocates purely on `pps_tracking` capacity and
**never checks PRN status**, so a late delivery still credits correctly and any surplus
falls through `autoAssignStock` → free stock. No code change needed.

---

## 11. KNOWN ISSUES & WHAT'S LEFT TO DO

### 11.1 OPEN — needs finishing
| # | Item | Detail |
|---|---|---|
| 1 | **Project-ID typeahead rollout incomplete** | A shared typeahead (`ensureSharedProjectTypeaheadData`, `handleSharedProjectTypeaheadInput`, `selectSharedProjectTypeahead`) replaced `<select>` project pickers with "Project ID or Customer Name" search inputs (ids `<oldId>-ta-input` / `-ta-dropdown`). **HTML swapped on all 8 screens. JS updated on only 4:** Create BOQ, Update/Revise BOQ, Upload Drawings, Revise PRN. **Still referencing dead `<select>` ids in JS:** Create Ticket (`ticket-project-id-dropdown`), Create PRN (`prn-project-select`), PPS Tracking (`pps-project-select`), Add to FG Store (`fg-add-project`). Those 4 screens are currently **broken** — their init still tries to `.innerHTML` a non-existent select and their read sites use the old id. **Fix: point every `getElementById("<oldId>")` at `"<oldId>-ta-input"`, and replace the option-population block with setting `window.sharedActiveProjectCodes` / `window.sharedProjectMeta`.** |
| 2 | **Date fields** (Next Follow-Up Date, Task Target Date) | User reported "not working properly"; never diagnosed. There's a real overlay system (`formatDMYFromISO`, `enhanceOneDateInputForDMY`) that polls every 400ms to show `dd/mm/yyyy` on native date inputs — an empty field showing grey `dd/mm/yyyy` is **correct**. Needs a concrete repro: does the picker open? does a picked date stick? does it persist after save? |
| 3 | **"Logging Follow-up" / "Creating Task" centred label** | Spec agreed: when the Log Follow-Up / Add Task form is expanded, show a centred label in the button row; hide on Cancel/Save. Edits were drafted for `.fup-status-label` / `.task-status-label` + toggles in open/close/edit/save handlers. **Verify whether applied.** |
| 4 | **Taller View Details / Delete Record buttons** | One CSS rule on `.directory-btn-actions-block .nav-btn-styled { padding-top:11px; padding-bottom:11px; }`. **Verify whether applied.** |
| 5 | **Search Store Tickets** project picker | Never located/renamed. Check whether it has a project selector needing the same treatment. |
| 6 | **Search by RM PO** | Confirmed it already uses a free-text input (`srchpo-project-input`) — **no change needed**, listed here so nobody re-opens it. |
| 7 | **Live FG Stock screen** | May still render a `storeIncharge` column that no longer exists (column dropped). Visual check needed. |
| 8 | **`fg_store_incharge_person` in `sheetsRegistry.js`** | If the `finished_goods_inventory` registry query still selects it, Sheet sync breaks the moment the column is dropped. **Grep before running that migration.** |
| 9 | **Job Card Increase end-to-end test** | Still the biggest untested flow. Was the original blocking item and remains only partially exercised. |
| 10 | **QA Person A not appearing** | A `Quality Assurance` department + user was added, but the dropdown never showed them. Root cause never found (dropdown has since been removed from the FG screen, so this is moot there — but `getStoreOperatorsList`'s department mapping may still be wrong for other screens). |

### 11.2 FIXED THIS SESSION (for context — don't re-fix)
- **Assign Current Stock → Reserve Store Stock**: full rename (menu, panel, permission
  column `perm_assign_current_stock` → `perm_reserve_store_stock`, table
  `store.stock_assignments` → `store.stock_reservations`, Sheet tab → `Stock Reservations`),
  plus a complete UI redesign (Total/Reserved/Available summary, per-BOQ editable table,
  live recalc, Submit Reservation, success + "Reserve Another" reset).
- **Reserve Store Stock was reading the wrong table** (gross `stock_reservations.assigned_quantity`
  instead of live `prn_line_items.raw_pool_remaining`) → now reads the correct source.
- **`spare_store.available_stock` generated-column violations** — 3 INSERTs and ~6 UPDATEs
  across `design.js`, `store.js`, `prnSync.js` were writing to a generated column. Fixed.
  A stale comment claiming *"unlike raw_material_store, this column is NOT generated"* was
  wrong and has been corrected.
- **`existingRej is not defined`** in `commitStoreQAPipelineStep` — missing
  `SELECT ... FROM store.rejected_missing_material_tracking ... FOR UPDATE` lookup added.
- **`column reference "prn_id" is ambiguous`** in `handleBOQIncreaseDecision` — qualified
  as `li.prn_id`.
- **Authorize BOQ success message** showed the pre-edit Order Qty — now uses the submitted
  `orderQty`.
- **Authorize BOQ product search** had no "Create Item Code first →" link (Create BOQ did)
  — added.
- **Marketing `searchCompanyData`** — the Node port had dropped `contactName` filtering
  and `nameMatchFound`; zero-match now returns `success:false` so the existing
  `#missing-trigger-notice-block` ("No Lead Record exists for company." + Create New Entry)
  works again.
- **Type of Customer filter** was `= ANY(...)` (whole-string equality, OR semantics) →
  now `string_to_array(c.type_of_customer, ', ') @> $1::text[]` (**AND** containment).
- **`marketing.leads.engineer_name`** held display names instead of emails for 5 test
  users, breaking Search Leads by Engineer. Corrected by data UPDATE.
  (`marketing.tasks` was already clean.)
- **Missing `syncLiveRow('projects', ...)`** in the invoice/reactivate routes.
- **Project Invoice PDF** was missing the `finished_goods_inventory` join, so the "Use"
  column would have been blank in the saved PDF.
- **`fetchProjectsByStatus`** normalizes the UI's `Completed` → DB's `Complete`.
- **`<span>` zero-width-character corruption** in a menu card (rendered as literal text) —
  fixed by retyping. ⚠️ **Beware copying HTML out of chat transcripts.**

---

## 12. LANDMINES & DEAD CODE

Flagged deliberately, not deleted. Don't "fix" these — delete or leave them, per instruction.

| Item | Where | Status |
|---|---|---|
| `code.js` | archives / project history | **Frozen Apps Script original. Never live, never edit.** Search results surface it constantly — always verify you're in a `routes/`/`lib/` file. |
| `migrate/run.js`, `migrate/engine.js` | `abps-backend/migrate/` | One-time Sheets→Postgres tool, already executed. Uses obsolete `inventory.` schema names. Frozen. |
| `submitStockAssignment`, `unassignStock`, `reassignStockBetweenPRNs` | `routes/purchase.js` | Dead after the Reserve Store Stock redesign. `unassignStock` also has the old `utilized_quantity`-dropping bug — do not resurrect without fixing. |
| `fetchAssignCurrentStockData` (modes `grn-queue`/`unassigned-browse`/`item-detail`) | `routes/store.js` | Dead — belonged to the removed legacy panel. |
| `checkStockCoverageForTicket` + its frontend modal consumers | `routes/store.js` | Dead. |
| `resolveTicketShortfall` | `routes/store.js` | Likely dead — grep the frontend before removing. |
| `earmarkClaimForTicket` / `restoreEarmarkedClaim` | `lib/prnSync.js` | Retired but still exported. Harmless clutter. |
| `submitFinishedGoodsAddEntry` / `fg-store-${canvasId}` | `index.html` | Parameterized FG-add variant, unreachable from the live panel. Still references the dropped Store Incharge field. |
| Two dead Spare→Raw transfer route pairs | `routes/store.js` | Have **unguarded stock decrements**. Recommendation: delete, don't fix. |
| `raw_pool_remaining` / `spare_pool_remaining` = 0 on pre-migration-068 PRNs | data | Expected, not a bug. Resolved by the data wipe. |
| Corrupted decimals on pre-restructure test inventory rows | data | Not formula-fixable; handled by wipe / manual correction tool. |
| Stuck ticket `TK-BOQ-RELEASED-368818` | data | **Reject it, don't try to approve.** |
| `job_card_materials.pending_quantity` | schema | **Dropped.** Any reference breaks. |
| No live Total Stock feedback while typing on the BOQ Increase screen | UI | Accepted, not a bug. |

---

## 13. HOW TO MAKE CHANGES

### 13.1 Migrations
Append to `abps-backend/migrations/Combined_SQL_migration_queries.sql` in **exactly** this
format (banner line is 150 `=`):

```sql
======================================================================================================================================================
076_short_description.sql
======================================================================================================================================================

ALTER TABLE ...;
```

Rules:
- Never edit an existing migration block — always append a new numbered one.
- Use `IF EXISTS` / `IF NOT EXISTS` so re-runs are safe.
- When renaming a table, don't hardcode constraint/index names — look them up dynamically
  in a `DO $$ ... $$` block (see `072_rename_reserve_store_stock.sql` for the pattern).
  Postgres preserves triggers/FKs/indexes across a rename but not their generated names.
- Latest applied appear to be `074_project_invoice_generation.sql` and
  `075_drop_fg_store_incharge_person.sql` — **verify against the live DB before assuming.**

### 13.2 Deploy order for a schema change
1. Grep for every code reference to the affected column/table (backend **and** `index.html`).
2. Apply the migration.
3. Deploy the backend.
4. Deploy the frontend.
5. Rename the Sheet tab / column header if applicable.

Keep 2–5 close together; there's a window where old code and new schema disagree.

### 13.3 Adding a new screen — checklist
1. Migration for any new permission (§5.3, all 6 places).
2. Backend route(s) in the appropriate `routes/*.js` (mounted routers need no registration).
3. Menu card in `index.html` + `enforceDynamicModuleRoleGateways` visibility line.
4. `<div id="canvas-module-x" class="workspace-panel">` panel HTML.
5. Add the panel id to **every** hide-all-panels list (there are several — grep for a
   sibling panel's id to find them all).
6. Routing case in `switchActiveDashboardModule` / `navigateToStoreWorkspacePanel`.
7. `syncLiveRow` calls for any live-tier table you write.
8. `writeAuditLog` for any consequential action.

### 13.4 Verifying before editing (in Claude Code)
The old workflow used Windows `findstr`. In Claude Code, prefer `Grep`/`Read`.
Useful invariants to check after edits:
- `node -c routes/purchase.js` (syntax check without running)
- Grep for `available_stock = available_stock` → should return **zero** hits on
  `spare_store` or `raw_material_store` (generated columns).
- Grep for `stock_assignments` → should return zero hits outside `migrate/` and
  historical migration text.
- Grep for `pending_quantity` → should return zero hits on `job_card_materials`.
- Check Cloud Run boot logs for `[DUPLICATE ROUTE]`.

---

## 14. FRONTEND NOTES (`index.html`)

Single ~24k-line file. No build step. Conventions:

- **API calls:** `await apFetch({ action: "routeName", ...payload })`. Session token is
  attached automatically. Errors surface as `data.success === false` + `data.error`.
- **Panels:** `<div id="canvas-module-*" class="workspace-panel">`, all hidden by default,
  shown one at a time by `switchActiveDashboardModule(...)` /
  `navigateToStoreWorkspacePanel(...)`.
- **Feedback banners:** `showBOQBanner(elementId, message, "success"|"error")`,
  `showPurchaseFeedback(...)`.
- **Blocking overlay:** `showBlockingOverlay("Doing thing...")` / `hideBlockingOverlay()`.
- **Number formatting:** `trimNum`, `fmtQty`, `formatQtyTrimmed` — no trailing zeros.
- **Dates:** `formatDateDMY`, `formatDateTimeDMY`, `fmtPstatDateTime`.
  Date inputs get a `dd/mm/yyyy` display overlay (see §11.1 #2).
- **Operator identity:** `appActiveOperatorIdentityString` — the logged-in person's
  display name, sent as `operatorName` on writes for audit purposes.
- **Admin gate:** `localStorage.getItem("isUserAdminGlobal") === "true"`.
- **Global number-input guard:** blocks `e`/`E`/`+`/`-` in `<input type="number">`.
- **Typeahead pattern** (Project Status is the reference implementation, and the new
  shared version generalizes it): text input + absolutely-positioned dropdown div +
  a document-level click handler to dismiss.

⚠️ **When copying HTML from a chat transcript into the file, retype tags by hand or
verify no zero-width characters got embedded** — this has produced literal `<span…>` text
rendering on the dashboard before.

---

## 15. QUICK REFERENCE — WHERE DOES X LIVE?

| I want to… | Go to |
|---|---|
| Change how PRN quantities are computed | `lib/prnSync.js` → `computePRNDeltaRows` |
| Change when a PRN is "Completed" | `lib/prnSync.js` → `refreshPRNCompletion` |
| Change how received stock is credited | `lib/prnSync.js` → `distributeReceiptFIFO` |
| Claim / release reserved stock | `lib/prnSync.js` → `claimStoreForPRN` / `releaseStoreClaimFromPRN` |
| Change cross-BOQ borrowing | `lib/prnSync.js` → `findAndBorrowForShortfall` |
| Change ticket approval / release | `routes/store.js` → `actionTicketReleaseApproval` |
| Change Job Card Increase approval | `routes/store.js` → `handleBOQIncreaseDecision` |
| Change QA receipt handling | `routes/store.js` → `commitStoreQAPipelineStep` |
| Change QA reversal | `lib/prnSync.js` → `reverseReceiptAttributions` |
| Change BOQ authorization | `routes/design.js` → `submitBOQAuthorize` |
| Change what goes in a PDF | `lib/pdf.js` (`buildDocument` is the shared table builder) |
| Change the PO PDF layout | `lib/poTemplate.js` (HTML) + `lib/pdfshift.js` |
| Add a Sheet mirror for a table | `lib/sheetsRegistry.js` (+ `syncLiveRow` calls if `tier:'live'`) |
| Let the Sheet write back to the DB | `lib/sheetsPull.js` |
| Add/rename a permission | §5.3 — six places |
| Change project completion | `routes/projects.js` → `generateProjectInvoiceAndComplete` |
| Change an AI prompt | `lib/gemini.js` |
| Add a Drive folder path | `lib/drive.js` → `ensureNestedFolderPath` |

---

## 16. IMMEDIATE NEXT STEPS (suggested order)

1. **Fix the 4 broken typeahead screens** (§11.1 #1) — Create Ticket, Create PRN,
   PPS Tracking, Add to FG Store are currently non-functional for project selection.
   This is the highest-priority regression.
2. **Verify §11.1 #3, #4, #8** were applied (small, cheap to confirm).
3. **Get a concrete repro for the date-field issue** (§11.1 #2).
4. **Run the full end-to-end test**: Project activation → BOQ → PRN → PO → Gate Entry →
   GRN → QA → Job Card → Store Ticket (incl. a **Job Card Increase**) → Add to FG →
   Project Invoice Generation → Reactivate.
   During it, check these four invariants by hand at each stage:
   - after PO delivery: does `raw_material_store.reserved_stock` equal the **sum** of all
     BOQs' `raw_pool_remaining` for that item?
   - after a ticket consumes material: did `reserved_stock` and **that BOQ's**
     `raw_pool_remaining` both drop by the same amount (and not another BOQ's)?
   - after a borrowing event: does the sum still reconcile?
   - at project completion: does `available_stock` rise by exactly what was still pooled?
5. **Then** consider the §12 dead-code cleanup pass.

---

## 17. HONEST CAVEATS

- Nobody has read 100% of this codebase. `routes/store.js` alone is ~2,600 lines. The
  reservation engine has already produced two real bugs of the "reads the wrong column"
  class; assume more may exist in paths not yet exercised.
- Comments in the code are mostly accurate and genuinely useful, **but at least one was
  actively wrong** (the `spare_store.available_stock` "NOT generated here" comment).
  Trust the schema over the comment: check `information_schema.columns` /
  `pg_get_constraintdef` for ground truth.
- Migration files are history, not current state. The live DB has drifted (tables
  renamed, columns generated). **Query the live DB to confirm schema facts.**
- Test data currently in the system predates several restructures and contains known
  inconsistencies. Don't diagnose a code bug from old test rows without checking whether
  the row predates the relevant migration.
