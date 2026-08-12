# CLAUDE.md — ABPS Portal

Working rules and architecture map for this repo. Read `ABPS_SYSTEM_OVERVIEW.md`
too — it's the deeper business-logic reference (stock engine, PRN lifecycle,
schema traps). This file is the practical "how to work here" layer.

---

## 0. NON-NEGOTIABLE WORKING RULES

1. **Never guess at file contents.** Always `Read`/`Grep` the real file before
   editing. Files change outside any given session.
2. **Never rewrite a whole file.** Emit targeted edits only.
3. **Minimal comments in new code.** The codebase is already heavily commented.
   Keep existing comments that explain *why*.
4. **No trailing decimal zeros in the UI.** `5` not `5.00`. Helpers exist:
   `trimNum`, `fmtQty`, `formatQtyTrimmed` (in `shared/format.js`).
5. **Concurrency is real.** 20–30 concurrent users. Any multi-table write goes
   inside `withTransaction` with `SELECT ... FOR UPDATE` on rows you read-then-write.
6. **Dead code is flagged, not deleted**, unless explicitly asked.
7. **Ask before generating a full new document/file.**

---

## 1. REPO LAYOUT

```
ABPS Portal/
├── abps-frontend/          ← THE ENTIRE FRONTEND. This folder IS the deployed site root.
│   ├── index.html          ← shell (HTML/CSS + 41 <script src> tags). No inline JS.
│   ├── shared/             ← cross-department JS (loads FIRST, order matters)
│   └── marketing/ design/ purchase/ store/ production/ project/ accounts/
│                           ← department JS, plain <script>, shared global scope
├── abps-backend/           ← Node 20 / Express on Cloud Run
├── .github/workflows/      ← deploy-frontend.yml (publishes abps-frontend/ to Pages)
├── CLAUDE.md  HANDOFF.md
└── ABPS_SYSTEM_OVERVIEW.md ← business logic + schema deep-dive
```

**Everything inside `abps-frontend/` is served as the site root.** A path like
`shared/apFetch.js` in `index.html` resolves to
`https://abps-solution.github.io/Portal/shared/apFetch.js` — the `abps-frontend/`
prefix does not appear in URLs. Keep all frontend script paths relative; never
add an `abps-frontend/` prefix inside `index.html`.

### Frontend (as of the Aug 2026 split)
The old ~24k-line monolithic `index.html` is **gone**. It's now 3,240 lines of
markup + 41 JS files. **All new frontend work goes in the department files
under `abps-frontend/`.**

Files are **plain classic `<script>` tags sharing one global scope** — no
bundler, no `import`/`export`, no build step. Consequences:
- A `function foo()` in any file is callable from any other file.
- **A `let`/`const` with the same name in two files is a fatal
  `SyntaxError: Identifier has already been declared`** — the whole app dies.
  Before adding a top-level `let`/`const`, grep the repo for that name.
- Load order in `index.html` matters only for code that *executes at load time*.
  Function declarations hoist within their file and are available to any file
  loaded later, so ordinary function-to-function calls are fine.

Load order is: `shared/` → `project/` → `marketing/` → `design/` → `store/` →
`purchase/` → `production/` → `accounts/`.

### `shared/` — what lives where
| File | Contents |
|---|---|
| `apFetch.js` | `GAS_URL`, `apFetch`, `acFetch`, `driveLink`, session bootstrap, `window.onload`, logout, global error handlers, core globals |
| `format.js` | `trimNum`, `fmtQty`, `formatQtyTrimmed`, `formatDateDMY`, `formatDMYFromISO`, date-input DD/MM/YYYY enhancer |
| `ui.js` | `showBlockingOverlay`/`hideBlockingOverlay`, `showBOQBanner`, `showPurchaseFeedback`, number-input guard |
| `typeahead.js` | Shared project typeahead (`ensureSharedProjectTypeaheadData`, `handleSharedProjectTypeaheadInput`, `selectSharedProjectTypeahead`) + `window.sharedActiveProjectCodes` / `sharedProjectMeta` |
| `navigation.js` | `switchActiveDashboardModule`, `navigateToStoreWorkspacePanel`, `navigateToModule`, `returnToDashboard`, `enforceDynamicModuleRoleGateways` |

**`shared/navigation.js` is the one file that legitimately references every
department's panel ids.** Adding a screen means touching it.

### Caveat on file placement
The split was automated (classified by which backend action each chunk calls +
DOM id prefixes). Placement is correct at the department level, but an
individual helper may sit in a sibling file rather than the most obvious one.
**Always `grep -rn "functionName" --include=*.js .` rather than assuming a path.**
Moving a function between files is a zero-risk edit if you find one misplaced.

---

## 2. FRONTEND ↔ BACKEND CONTRACT

- Every call: `await apFetch({ action: "someAction", ...payload })`.
  `sessionToken` is attached automatically from `localStorage`.
- Errors surface as `data.success === false` + `data.error`.
  A 401 with `code: 'SESSION_EXPIRED'` clears storage and forces re-login;
  it throws `Error("SESSION_EXPIRED")`, which is swallowed by name everywhere —
  don't "fix" those catch blocks.
- `GAS_URL` (legacy name) points at Cloud Run's `/exec` bridge, which rewrites
  `{action:"x"}` → `POST /api/x`. **Adding a backend route needs no frontend
  routing change** — just `router.post('/myAction', ...)` in any mounted router.
- Accounts module only uses `acFetch(path, payload)` → real REST `/api/accounts/*`.
- Document links must be wrapped: `driveLink(url)`. Drive files are **private**;
  they're served through the authenticated proxy `GET /api/driveFile/:fileId?token=`.
  A bare Drive URL will 401.

---

## 3. BACKEND

Node 20 / Express on Cloud Run (`abps-backend`, region `asia-south1`).
`server.js` mounts routers; **order matters** — unauthenticated/self-authenticating
routers (`auth`, `gmailAuth`, `internal`, `sheetsSyncInternal`, `driveFiles`) must
be mounted *before* the `requireSession`-guarded ones, because
`app.use('/api', requireSession, r)` runs the guard for every `/api/*` request
regardless of whether `r` owns the path.

Permissions: every route is gated `requirePermission('perm_x')`.
**Adding/renaming a permission touches 6 places** — see `ABPS_SYSTEM_OVERVIEW.md` §5.3.
Miss one and it fails silently. (This rule was violated and repaired in Aug 2026;
`sheetsRegistry.js` and `sheetsPull.js` header lists must stay in sync — there's a
script pattern for diffing them in the handoff doc.)

---

## 4. DEPLOY

**Frontend:** `git push origin main` → the `.github/workflows/deploy-frontend.yml`
Actions workflow publishes **`abps-frontend/`** to GitHub Pages (~1–2 min).
Live at `https://abps-solution.github.io/Portal/`. No build step; the workflow
just uploads the folder as-is.

- Pages source is set to **"GitHub Actions"** (Settings → Pages), *not*
  "Deploy from a branch". This is required: branch-based Pages can only serve a
  branch's root or `/docs`, never a subfolder like `abps-frontend/`.
- The workflow only fires on changes under `abps-frontend/**` (or to the workflow
  itself). A backend-only commit correctly deploys nothing.
- Check a deploy: repo → **Actions** tab. Re-run by hand via *Run workflow*
  (`workflow_dispatch` is enabled).
- **Do not move `index.html` or the department folders back to the repo root** —
  the workflow's `path: abps-frontend` expects them there.

**Backend:**
```bash
gcloud run deploy abps-backend --source ./abps-backend --region asia-south1
```
Don't pass `--set-env-vars` unless intentionally changing config — omitting it
preserves existing env/secrets.

**DB access** (Cloud SQL `abps-erp-db`, private IP by default). To open temporarily:
```bash
MY_IP=$(curl -s -4 https://api.ipify.org)
gcloud sql instances patch abps-erp-db --assign-ip --authorized-networks=${MY_IP}/32
```
Close it after: `gcloud sql instances patch abps-erp-db --no-assign-ip`
Connect: `psql "host=<public-ip> port=5432 dbname=postgres user=postgres sslmode=require"`

**Logs:** `gcloud run services logs read abps-backend --region asia-south1 --limit 50`

---

## 5. VERIFICATION HABITS THAT CAUGHT REAL BUGS

Run these after frontend changes:

```bash
cd abps-frontend

# 1. No duplicate top-level let/const across files (fatal at load)
grep -rhoE "^(let|const) [a-zA-Z0-9_$]+" --include=*.js . \
  | awk '{print $2}' | sort | uniq -d

# 2. Every apFetch action resolves to a real backend route
#    (compare action names against router.post paths in abps-backend/routes/)

# 3. Syntax check every file
for f in $(find . -name "*.js"); do node -c "$f" || echo "FAIL $f"; done

# 4. Every <script src> actually exists
grep -oP '(?<=<script src=")[^"h][^"]*(?=")' index.html | while read f; do
  [ -f "$f" ] || echo "MISSING: $f"; done
```

Windows gotcha: **never name a file `prn.js`, `con.js`, `aux.js`, `nul.js`,
`com1-9.js`, `lpt1-9.js`** — reserved device names, `git` can't index them.
(That's why it's `store/create-prn.js`.)

---

## 6. KNOWN LANDMINES (short list — full detail in the OVERVIEW)

- `design.boq_drafts` is the **live/authorized** BOQ table; `design.bill_of_quantity`
  is the per-material-line table. The names are the opposite of what they sound like.
- `available_stock` is a **GENERATED column** on both `raw_material_store` and
  `spare_store`. Writing to it throws. Write `total_stock`/`reserved_stock`/`unusable_stock` only.
- `stock_reservations` is an append-only **audit log**, not a live balance.
  Use `prn_line_items.raw_pool_remaining` for "what does this BOQ still hold".
- `project_status` is `'Complete'`, not `'Completed'`.
- `job_card_materials.pending_quantity` was dropped — any reference breaks.
- Migration files are history, not current state. **Query the live DB to confirm schema.**
