# HANDOFF — session ending 12 Aug 2026

State of the repo, what changed, what's verified, and what's still open.
Read `CLAUDE.md` first for working rules, then this for current context.

---

## 1. WHERE THINGS STAND RIGHT NOW

Everything below is **committed, pushed, and deployed live**. Nothing is
half-finished or sitting uncommitted.

| Component | State |
|---|---|
| Frontend | Live at `https://abps-solution.github.io/Portal/`, serving the new split structure from repo root |
| Backend | Cloud Run revision `abps-backend-00277-9ht`, 100% traffic, health check OK, clean boot logs |
| DB | Cloud SQL `abps-erp-db`. Public IP currently **open**, authorized to `34.177.102.82/32` (a Cloud Shell IP) — see §5 |
| Git | `main` @ `0007e39`, working tree clean |

Last two commits:
- `344d323` — backend security/data fixes + Drive proxy + frontend split created
- `0007e39` — cut the live site over to the split structure

---

## 2. THE FRONTEND SPLIT (the big change)

`index.html` went from ~24,000 lines (one inline `<script>`) to **3,240 lines of
markup + 41 JS files** across 8 folders. Same behavior, no build step, plain
`<script src>` tags sharing global scope.

| Folder | Files | Notable |
|---|---|---|
| `shared/` | 5 | `apFetch.js` (517), `navigation.js` (687), `typeahead.js` (377), `format.js` (128), `ui.js` (81) |
| `marketing/` | 6 | `leads.js` is the big one (2,247) |
| `design/` | 6 | `update-boq.js` (729), `authorize-boq.js` (603) |
| `store/` | 11 | `live-stock.js` (1,808), `tickets.js` (1,602), `create-prn.js` (1,296), `qa.js` (867) |
| `purchase/` | 5 | `po.js` (1,594), `revise-po.js` (969) |
| `production/` | 5 | `finished-goods.js` (574), `job-cards.js` (519) |
| `project/` | 2 | Manufacturing Clearance + Project Status |
| `accounts/` | 1 | `tour-expense.js` (246) |

**Naming decisions made during the split** (differ from the original plan):
- `store/create-prn.js`, not `prn.js` — `PRN` is a reserved Windows device name
  and `git.exe` physically cannot index a file called `prn.js`.
- PRN files live under `store/`, not `purchase/` (per explicit instruction).
- A `project/` folder was added that wasn't in the original plan — the UI has a
  real "Project Department" menu section (Manufacturing Clearance, Project Status)
  that didn't fit cleanly in `design/`.
- `store/store-history.js` and `production/job-card-sheet.js` are the renamed
  `history-matrix` / `job-card-letterhead`.
- RM PO Upload is **dead code** (panel + routing case exist, no menu card reaches
  it). Kept, folded into `purchase/po.js`, flagged with a comment. Didn't get its
  own file.

### Verification performed (all passed)
1. **Content preservation** — reassembled all split files and compared line
   multisets against the original inline script: identical, except one leading
   blank line with zero code content. Nothing lost, added, or altered.
2. **Inventory completeness** — all 572 functions, 113 top-level globals, and 57
   `workspace-panel` element ids exist exactly once. Zero missing, zero duplicated.
3. **Load-order safety** — parsed each file's immediately-executing top-level code
   and checked every identifier against what's defined by that point in load order.
   Zero real forward-references. (The one genuine cross-file top-level reference,
   `parentShowAppView = showAppView` in `store/live-stock.js`, resolves to
   `shared/apFetch.js` loaded 26 files earlier — safe.)
4. **Syntax** — `node -c` passes on all 41 files individually and on the full set
   concatenated in browser load order.
5. **Deploy match** — fetched the live GitHub Pages files and diffed against local:
   identical (modulo CRLF/LF representation).

### What was NOT done
**The app has never been clicked through in a browser since the split.** All
verification above is static analysis. It's strong evidence — but a runtime smoke
test of a few screens per department is still the honest next step before trusting
it under real users.

---

## 3. BUGS FIXED THIS SESSION (don't re-fix)

### Backend
1. **SQL injection** in `commitMarketingOperationsDocument` (`routes/marketing.js`)
   — client-supplied `fields` keys were interpolated straight into the SET/INSERT
   column list. Added `UPLOADED_DOC_UPDATABLE` whitelist built from the live schema.
2. **Users sheet→DB pull was 100% broken on every full sync** — `sheetsPull.js`
   referenced `perm_revise_qa_check`, a column that doesn't exist in the live DB,
   so the combined per-user UPDATE aborted for *every* user. Removed.
3. **`finished_goods_inventory` sheet sync broken since ~9 Aug** — `sheetsRegistry.js`
   still selected `fg_store_incharge_person`, dropped by migration 075. Removed.
   (There was a stuck row in `admin_db.sheet_change_log` proving it had been
   failing on every poll cycle; it should self-clear now.)
4. **5-place permission rule violated** — added `Search RM Purchase Order`,
   `Job Card Letterhead`, `Tour Expense` to the `users` query in `sheetsRegistry.js`
   so they're actually Sheet-editable. Header lists now diff clean against `sheetsPull.js`.
5. **Dashboard routes had zero access control** — all 5 `fetch*DashboardData` routes
   were unguarded; any authenticated user could pull any department's data. Added
   `requirePermission('perm_*_dashboard')`.
6. **Deleted 4 dead Spare→Raw transfer routes** — unreachable from the frontend, and
   one contained a write to the generated `available_stock` column that would always throw.
7. **Drive files are no longer public** — `uploadFile()` no longer sets
   `role:reader/type:anyone`. Added `routes/driveFiles.js`, an authenticated proxy
   (`GET /api/driveFile/:fileId?token=`). Frontend wraps every document link in `driveLink()`.

### Frontend
8. **PPS Tracking "Save Action Plans" silently saved nothing** — duplicate
   `savePPSActionPlans` declaration; the surviving copy sent `poNumber` where the
   backend reads `poNo`, so the WHERE matched zero rows and the route returned
   `success:true` anyway. Removed the dead duplicate, fixed the field name.
9. **Business-card photo on the manual New Lead form never saved** — called
   `uploadVisitingCardToDrive`, a backend action that doesn't exist, and passed the
   result as `imageUrl` which `/submit` never reads. Rewired to the working
   `base64Image` path.
10. **4 screens had broken project selection** (Create Ticket, Create PRN, PPS
    Tracking, Add to FG Store) — JS still read pre-typeahead element ids that no
    longer exist. Fixed init functions + all downstream `.value` reads.
11. **Typeahead "search by Customer Name" never worked on any screen** — the shared
    handler read `meta[p].customerName`, but the only backend source populating it
    returns `companyName`. One-line fix in `shared/typeahead.js`, fixes all 8 screens.

---

## 4. STILL OPEN

**High value, not started:**
- **Runtime smoke test of the split** (see §2). Highest priority before heavy new
  feature work lands on top of it.
- **Old Drive documents are still publicly shared.** The fix stopped *new* uploads
  from being public; every file uploaded before it still has a live
  `type:anyone` permission. Bulk-revoking means iterating Drive files via API
  against production data — deliberately not attempted without a decision.

**Known, deliberately deferred:**
- **Migration `073` is missing** from `Combined_SQL_migration_queries.sql` (jumps
  072 → 074). Either applied directly to the DB and never recorded, or skipped.
  Unresolved — the file is not a trustworthy complete history until this is known.
- **External I/O inside DB transactions.** PDF generation and Drive uploads happen
  inside `withTransaction` while holding `FOR UPDATE` row locks, on a 10-connection
  pool. Deliberate (guarantees no "authorized but undocumented" state), but a slow
  Drive call can hold locks + a pool slot. Plausible pool-exhaustion path under load.
  Flagged, not changed.
- `perm_revise_qa_check` exists in the migration SQL but not in the live DB and is
  referenced nowhere in code. Dead concept — either wire it up or drop it from the SQL.
- Everything in `ABPS_SYSTEM_OVERVIEW.md` §11.1 that wasn't listed as fixed above
  (date-field repro, centred form labels, taller buttons, Live FG storeIncharge
  column, Job Card Increase end-to-end test).

---

## 5. THINGS TO CLEAN UP / BE AWARE OF

- **Cloud SQL public IP is currently OPEN**, authorized to `34.177.102.82/32`.
  Close it when you don't need DB access:
  `gcloud sql instances patch abps-erp-db --no-assign-ip`
- The DB password was shared in chat during this session. If that's a concern,
  rotate it — note that whatever holds it for Cloud Run (env var or Secret Manager)
  must be updated in the same change or the backend breaks.
- `ABPS_SYSTEM_OVERVIEW.md` still describes the frontend as "index.html (single
  file, ~24k lines)" in §2/§3. **That's now wrong** — it predates the split. Worth
  a pass to bring it in line with `CLAUDE.md`.

---

## 6. STARTING THE NEXT SESSION

Good opening move:

> Read CLAUDE.md and HANDOFF.md. We're adding <feature>. Before writing anything,
> grep for the functions/screens involved and tell me which files you'd touch.

For a new screen, the checklist is: migration for any new permission (6 places) →
backend route → menu card in `index.html` → panel div → add the panel id to the
hide-all lists → routing case in `shared/navigation.js` → `syncLiveRow` for any
live-tier table written → `writeAuditLog` for consequential actions.
