// ═══════════════════════════════════════════════════════════════════════
// server.js — replaces doPost() as the API gateway. Cloud Run entrypoint.
//
// Frontend change needed: index.html's apFetch() currently posts to
// GAS_URL with { action, ...payload, sessionToken }. That shape is
// preserved here via a single /api/dispatch route below, so the
// frontend migration is a ONE-LINE change (swap GAS_URL), not a rewrite
// of every call site. Cleaner per-action REST routes (as used inside
// design.js) exist underneath for new code going forward.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const cors = require('cors');
const { router: authRoutes, requireSession } = require('./auth');

const designRoutes = require('./routes/design');
const projectsRoutes = require('./routes/projects');
const purchaseRoutes = require('./routes/purchase');
const marketingRoutes = require('./routes/marketing');
const inventoryRoutes = require('./routes/store');
const productionRoutes = require('./routes/production');
const gmailAuthRoutes = require('./routes/gmailAuth');
const internalRoutes = require('./routes/internal');
const utilityRoutes = require('./routes/utility');
const dashboardsRoutes = require('./routes/dashboards');
const accountsRoutes = require('./routes/accounts');

const app = express();
app.use(cors());

// Piggyback the sheet-change poll on real incoming requests, rather than
// a background setInterval — Cloud Run only allocates CPU while a
// request is being handled (without --no-cpu-throttling / min-instances,
// which we've deliberately not enabled), so a timer between requests
// silently never fires. This fires at most once every 3s regardless of
// request volume, non-blocking (never awaited), and piggybacks on
// anything hitting the app — including the existing Cloud Scheduler
// partial/scheduled sync jobs, which guarantees a poll tick at least
// every 5-10 minutes even with zero human traffic.
const { pollSheetChangeLog } = require('./lib/sheetChangePoller');
let lastPollAttempt = 0;
app.use((req, res, next) => {
  const now = Date.now();
  if (now - lastPollAttempt > 3000) {
    lastPollAttempt = now;
    pollSheetChangeLog().catch(err => console.error('Piggybacked poll failed:', err.message));
  }
  next();
});
app.use(express.json({ limit: '10mb', type: () => true })); // BOQ material_rows / drawing metadata can be large-ish JSON
// type: () => true forces JSON parsing on every request body regardless of
// Content-Type header — the frontend's fetch() calls don't set that header,
// which the old Apps Script backend never required but Express does by default.

app.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0' }); // mirrors doGet()
});

// Unauthenticated actions (login, personnel directory) live in authRoutes
// and are exempted inside requireSession by action name — mounted before
// the guard so they're reachable, matching doPost()'s early-return shape.
app.use('/api', authRoutes);

// gmailAuth and internal routes MUST be mounted before the requireSession-
// protected routers below. Express's app.use('/api', requireSession, ...)
// runs requireSession for EVERY request matching '/api/*', regardless of
// whether that specific router has a matching route — if requireSession
// rejects (401) it never calls next(), so a later-mounted router never
// gets a chance to match, even for paths it owns. Mounting these first
// means they get first crack at their own specific paths.
app.use('/api', gmailAuthRoutes);
app.use('/api', internalRoutes);
app.use('/api', require('./routes/sheetsSyncInternal'));
// driveFiles authenticates via its own ?token= query param (a plain <a
// href> navigation can't send requireSession's JSON body/header), so it
// must be mounted here too, same reasoning as gmailAuth/internal above.
app.use('/api', require('./routes/driveFiles'));

app.use('/api', requireSession, designRoutes);
app.use('/api', requireSession, projectsRoutes);
app.use('/api', requireSession, purchaseRoutes);
app.use('/api', requireSession, marketingRoutes);
app.use('/api', requireSession, inventoryRoutes);
app.use('/api', requireSession, productionRoutes);
app.use('/api', requireSession, utilityRoutes);
app.use('/api', requireSession, dashboardsRoutes);
app.use('/api', requireSession, accountsRoutes);

// Fail loudly on duplicate route registration — silent shadowing caused
// several wrong-behaviour bugs (repair QA, reassign, drawings, tickets).
{
  const seen = new Set();
  (app._router?.stack || []).filter(l => l.route).forEach(l => {
    const key = `${Object.keys(l.route.methods)[0]} ${l.route.path}`;
    if (seen.has(key)) console.warn(`[DUPLICATE ROUTE] ${key} — later registration is dead code.`);
    seen.add(key);
  });
}

// ── Legacy-shape dispatcher ──────────────────────────────────────────
// Routes an incoming { action: "createBOQDraft", ... } POST to the
// matching Express route above, so index.html's existing action-based
// calling convention keeps working without a full frontend rewrite.
// This is a bridge, not the long-term pattern — new modules should be
// called with real REST paths from the frontend once each module is
// verified stable.
app.post('/exec', requireSession, (req, res, next) => {
  const action = req.body?.action;
  if (!action) return res.status(400).json({ success: false, error: 'Missing action.' });
  req.url = `/api/${action}`;
  app.handle(req, res, next);
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Central router breakdown: ' + err.message });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`ABPS Portal backend listening on ${PORT}`));
