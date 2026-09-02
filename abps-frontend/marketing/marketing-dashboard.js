function mdSetPeriod(btn) {
  document.querySelectorAll("#md-period-btns .dd-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const p = btn.dataset.period;
  mdCurrentPeriod = p;
  const customZone = document.getElementById("md-custom-zone");
  if (p === "custom") { customZone.style.display = "flex"; requestAnimationFrame(syncDashboardCanvasTopPadding); return; }
  customZone.style.display = "none";
  requestAnimationFrame(syncDashboardCanvasTopPadding);
  mdLoadDashboard();
}

function mdCustomTypeChange() {
  const type = document.getElementById("md-custom-type").value;
  mdCurrentCustomType = type;
  const valInput = document.getElementById("md-custom-val");
  if (type === "customday")     { valInput.type = "date";  valInput.placeholder = ""; }
  else if (type === "customweek")  { valInput.type = "date";  valInput.placeholder = "Pick any day in the week"; }
  else if (type === "custommonth") { valInput.type = "month"; }
  else if (type === "customquarter") { valInput.type = "text"; valInput.placeholder = "e.g. 2025-Q2"; }
  else if (type === "customyear")  { valInput.type = "number"; valInput.placeholder = "e.g. 2025"; }
}

function mdLoadCustom() {
  const val = document.getElementById("md-custom-val").value.trim();
  if (!val) return alert("Please enter a value for the custom period.");
  mdCurrentPeriod = mdCurrentCustomType;
  mdLoadDashboard(val);
}

async function mdLoadDashboard(customVal) {
  const body = document.getElementById("md-body");
  if (!body) return;
  ["md-s-newleads","md-s-inprogress","md-s-winrate","md-s-avgdays",
   "md-s-emailleads","md-s-opentasks","md-s-zerofollowup","md-s-pouploads","md-s-offerssent","md-s-coldemails"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });

  try {
    const data = await apFetch({
      action:      "fetchMarketingDashboardData",
      periodType:  mdCurrentPeriod,
      periodValue: customVal || ""
    });
    if (!data.success) { alert("Dashboard load failed: " + data.error); return; }
    mdRenderDashboard(data);
  } catch(e) {
    alert("Dashboard error: " + e.message);
  }
}

function mdRenderDashboard(data) {
  const { stats, statusCounts, verticalCounts, potentialCounts, staleLeads, recentWins } = data;

  document.getElementById("md-s-newleads").textContent       = stats.newLeads;
  document.getElementById("md-s-inprogress").textContent     = stats.inProgress;
  document.getElementById("md-s-winrate").textContent        = stats.winRatePct !== null ? stats.winRatePct + "%" : "—";
  document.getElementById("md-s-avgdays").textContent        = stats.avgConversionDays !== null ? stats.avgConversionDays : "—";
  document.getElementById("md-s-emailleads").textContent     = stats.emailLeadsAwaitingAction;
  document.getElementById("md-s-opentasks").textContent      = stats.openTasks;
  document.getElementById("md-s-zerofollowup").textContent   = stats.zeroFollowUpLeads;
  document.getElementById("md-s-pouploads").textContent      = stats.poUploads;
  document.getElementById("md-s-offerssent").textContent     = stats.distinctOffersSent;
  document.getElementById("md-s-coldemails").textContent     = stats.coldEmailsSent;

  // Chart 1 — Lead Status Funnel (horizontal bar). Live pipeline snapshot
  // (period-independent — see routes/dashboards.js), always all 9
  // statuses in pipeline order, zero-filled — never GROUP BY's "whatever
  // happened to have a row" order/set.
  if (mdChartFunnel) mdChartFunnel.destroy();
  const funnelLabels = Object.keys(statusCounts);
  const ctxFunnel = document.getElementById("md-chart-funnel").getContext("2d");
  mdChartFunnel = new Chart(ctxFunnel, {
    type: "bar",
    data: {
      labels: funnelLabels,
      datasets: [{ label:"Leads", data: funnelLabels.map(k => statusCounts[k]),
        backgroundColor: "rgba(37,99,235,0.7)", borderRadius: 4 }]
    },
    options: { indexAxis:"y", responsive:true, plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ color:"#f1f5f9" }, ticks:{ stepSize:1 } }, y:{ grid:{ display:false }, ticks:{ font:{ size:9 } } } } }
  });

  // Chart 2 — Approx Business Potential (vertical bar). Live snapshot
  // of the currently OPEN pipeline only (terminal-status leads are
  // already covered by the funnel above and Recent Wins/Stale Leads).
  if (mdChartPotential) mdChartPotential.destroy();
  const potentialLabels = Object.keys(potentialCounts);
  const ctxPotential = document.getElementById("md-chart-potential").getContext("2d");
  mdChartPotential = new Chart(ctxPotential, {
    type: "bar",
    data: {
      labels: potentialLabels,
      datasets: [{ label:"Open Leads", data: potentialLabels.map(k => potentialCounts[k]),
        backgroundColor: "rgba(124,58,237,0.7)", borderRadius: 4 }]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } },
      scales:{ y:{ grid:{ color:"#f1f5f9" }, ticks:{ stepSize:1 } }, x:{ grid:{ display:false }, ticks:{ font:{ size:9 } } } } }
  });

  // Chart 3 — Business Vertical (horizontal bar, not a donut — angle/area
  // comparisons in a 6-category donut are hard to read at this tile size;
  // a bar keeps the same legible shape as the other two charts here).
  // Same OPEN-pipeline scope as the potential chart above.
  if (mdChartVertical) mdChartVertical.destroy();
  const verticalLabels = Object.keys(verticalCounts);
  const ctxVertical = document.getElementById("md-chart-vertical").getContext("2d");
  mdChartVertical = new Chart(ctxVertical, {
    type: "bar",
    data: {
      labels: verticalLabels,
      datasets: [{ label:"Open Leads", data: verticalLabels.map(k => verticalCounts[k]),
        backgroundColor: "rgba(21,128,61,0.7)", borderRadius: 4 }]
    },
    options: { indexAxis:"y", responsive:true, plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ color:"#f1f5f9" }, ticks:{ stepSize:1 } }, y:{ grid:{ display:false }, ticks:{ font:{ size:9 } } } } }
  });

  // Stale Leads table
  const staleTbody = document.getElementById("md-stale-tbody");
  staleTbody.innerHTML = staleLeads.length === 0
    ? `<tr><td colspan="4" style="color:var(--muted); padding:6px;">No stale leads — nice work.</td></tr>`
    : staleLeads.map(l => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:4px;">${l.company}</td>
          <td style="padding:4px;">${l.engineer}</td>
          <td style="padding:4px;">${l.status}</td>
          <td style="padding:4px; text-align:right; color:#b91c1c; font-weight:700;">${l.daysSince}d</td>
        </tr>`).join("");

  // Recent Wins table
  const winsTbody = document.getElementById("md-wins-tbody");
  winsTbody.innerHTML = recentWins.length === 0
    ? `<tr><td colspan="3" style="color:var(--muted); padding:6px;">No orders received in this period.</td></tr>`
    : recentWins.map(w => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:4px;">${w.company}</td>
          <td style="padding:4px;">${w.engineer}</td>
          <td style="padding:4px; text-align:right;">${formatDateDMY(w.date)}</td>
        </tr>`).join("");
}

function exitMarketingDashboardBackToMenu() {
  document.getElementById("canvas-module-marketing-dashboard").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";

  // Reset period selector back to "Today" so the next visit starts fresh instead of
  // silently resuming whatever period was last viewed.
  mdCurrentPeriod = "today";
  document.querySelectorAll("#md-period-btns .dd-period-btn").forEach(b => b.classList.remove("active"));
  const todayBtn = document.querySelector('#md-period-btns .dd-period-btn[data-period="today"]');
  if (todayBtn) todayBtn.classList.add("active");
  const customZoneReset = document.getElementById("md-custom-zone");
  if (customZoneReset) customZoneReset.style.display = "none";
}

// Dashboard canvases are NOT reliably nested under their "own"
// department's enclosure panel — live DOM inspection showed
// canvas-module-design-dashboard actually sits inside
// module-purchase-workspace-enclosure-panel, not the design one. Rather
// than guess per-department, show every enclosure panel unconditionally;
// each one's own .workspace-panel children are already forced to
// display:none right below, so this can't leak stale content, it just
// guarantees whichever ancestor actually contains the target canvas is
// no longer display:none.
// Despite the name (kept for compatibility with every navigateTo*Dashboard
// call site — not worth touching 5 call sites for a rename), this no
// longer shows every enclosure panel. All 5 dashboard canvases were
// confirmed (18 Aug 2026, via DOM ancestor trace) to live inside the SAME
// one — module-purchase-workspace-enclosure-panel — regardless of which
// department's dashboard is open. Showing every OTHER enclosure panel too
// was pure dead weight: each one renders its own 12px 10px padding box
// even with zero visible content inside, and those empty boxes stacked up
// BEFORE the real content in DOM order, silently pushing every dashboard's
// row 1 down by ~24px per empty panel shown. This was the real cause of
// the "huge gap below the toolbar" bug — not the toolbar-height padding
// math (lib/ipAccess-style tuning of that already happened and was
// correct on its own; it just wasn't the whole gap).
function ddShowAllWorkspaceEnclosures() {
  const panel = document.getElementById('module-purchase-workspace-enclosure-panel');
  if (panel) panel.style.display = "block";
}

// Single dispatcher for the shared toolbar's ONE Return button — set by
// whichever navigateTo*Dashboard() is currently active, so the toolbar
// doesn't need 5 separate buttons or to know which dashboard it's for.
let activeDashboardReturnFn = null;
function dashboardGlobalReturnClick() {
  document.getElementById("dashboard-global-toolbar").style.display = "none";
  const appHeader = document.querySelector('header');
  if (appHeader) appHeader.style.display = "";
  // Restore each enclosure panel's own header row (Return button included)
  // that showDashboardGlobalToolbar hid — without this, leaving a
  // dashboard and later visiting any other panel in that department
  // (e.g. Store Gate Entry) left it with no way back to the main menu.
  document.querySelectorAll('[id$="-workspace-enclosure-panel"] > .navigation-action-header-row').forEach(h => h.style.removeProperty("display"));
  // Hide every enclosure panel unconditionally here too, rather than
  // trusting whichever dashboard's own exit function to know to do it —
  // every dashboard canvas turned out to be nested inside
  // module-purchase-workspace-enclosure-panel regardless of which
  // department it belongs to, and Marketing/Production's own exit
  // functions were never written expecting that.
  document.querySelectorAll('[id$="-workspace-enclosure-panel"]').forEach(p => p.style.display = "none");
  document.querySelectorAll('.workspace-panel[id^="canvas-module-"][id*="dashboard"]').forEach(c => c.style.paddingTop = "");
  if (activeDashboardReturnFn) activeDashboardReturnFn();
  activeDashboardReturnFn = null;
}

// Recomputes the visible dashboard canvas's top padding from the shared
// toolbar's REAL current height, every time that height can change (the
// toolbar grows ~40px when a dashboard's own Custom row opens/closes) —
// called on open AND from every *SetPeriod function, not just once, so it
// never goes stale.
//
// Fixed 24 Aug 2026: the previous version computed padding as
// `toolbar.offsetHeight - ENCLOSURE_PANEL_TOP_PADDING(hardcoded 12) +
// GAP_BELOW_TOOLBAR(10)` — a hardcoded assumption about the enclosure
// panel's own top padding baked into the formula. Any drift between that
// assumed 12px and the enclosure panel's REAL top padding (a separate,
// independently-edited CSS rule) leaks 1:1 into the visible gap above row
// 1, with no way to tell from the formula alone that it had drifted — this
// is what produced a much-larger-than-intended gap in practice. Replaced
// with a self-correcting measurement: reset the canvas's own top padding,
// measure where its content naturally starts, then add exactly enough
// padding to land it GAP_BELOW_TOOLBAR px under the toolbar's real bottom
// edge. This can never drift, because it never assumes any ancestor's
// padding value — it measures the actual rendered position instead.
function syncDashboardCanvasTopPadding() {
  const toolbar = document.getElementById("dashboard-global-toolbar");
  if (!toolbar || toolbar.style.display === "none") return;
  const GAP_BELOW_TOOLBAR = 10;
  const toolbarBottom = toolbar.getBoundingClientRect().bottom;
  document.querySelectorAll('.workspace-panel[id^="canvas-module-"][id*="dashboard"]').forEach(c => {
    if (c.style.display !== "block") return;
    c.style.paddingTop = "0px";
    const naturalTop = c.getBoundingClientRect().top;
    const needed = Math.max(0, toolbarBottom + GAP_BELOW_TOOLBAR - naturalTop);
    c.style.paddingTop = needed + "px";
  });
}

// Shows the shared toolbar, sets its title, and reveals only the one
// period-button-group/custom-zone pair that belongs to the dashboard
// being opened (the other 4 pairs live in the same toolbar but stay
// hidden). Also proactively hides each *-workspace-enclosure-panel's
// OWN separate header row — those are a different element from this
// toolbar entirely, and were the second source of duplicate "Return to
// Main Dashboard" buttons once ddShowAllWorkspaceEnclosures() started
// revealing whole enclosure panels (header row included) to fix the
// canvas-nested-in-wrong-enclosure bug.
function showDashboardGlobalToolbar(title, periodBtnsId, returnFn) {
  activeDashboardReturnFn = returnFn;
  const toolbar = document.getElementById("dashboard-global-toolbar");
  toolbar.style.display = "block";
  // The main app <header> is ALSO position:sticky at top:0 — it stays in
  // normal document flow (sticky elements still occupy space, they just
  // don't scroll away), so it kept rendering right below this fixed
  // toolbar instead of being replaced by it. Hiding it outright while a
  // dashboard is open, matching how every dashboard screen looked before
  // this toolbar consolidation (none of them ever showed the app header
  // alongside their own top bar).
  const appHeader = document.querySelector('header');
  if (appHeader) appHeader.style.display = "none";
  // Fixed positioning takes the toolbar out of normal flow, so the visible
  // canvas needs top padding equal to the toolbar's real height or its
  // content starts underneath the floating bar.
  requestAnimationFrame(syncDashboardCanvasTopPadding);
  document.getElementById("dash-global-title").textContent = title;
  ["dd-period-btns","pd-period-btns","sd-period-btns","md-period-btns","pd2-period-btns","ad-period-btns"].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = (id === periodBtnsId) ? "flex" : "none";
  });
  ["dd-custom-zone","pd-custom-zone","sd-custom-zone","md-custom-zone","pd2-custom-zone","ad-custom-zone"].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = "none";
  });
  document.querySelectorAll('[id$="-workspace-enclosure-panel"] > .navigation-action-header-row').forEach(h => h.style.display = "none");
}

function navigateToDesignDashboard() {
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none");
  // Dashboard canvases aren't reliably nested under their "own"
  // department's enclosure panel — canvas-module-design-dashboard
  // actually lives inside module-purchase-workspace-enclosure-panel,
  // confirmed via live DOM inspection. Show every enclosure panel
  // unconditionally rather than guessing per-department.
  ddShowAllWorkspaceEnclosures();
  const c = document.getElementById("canvas-module-design-dashboard");
  if (c) c.style.display = "block";
  showDashboardGlobalToolbar("Design Dashboard", "dd-period-btns", exitDesignWorkspacePanelBackToMenu);
  if (typeof ddLoadDashboard === "function") ddLoadDashboard();
}

function navigateToPurchaseDashboard() {
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none");
  // Same fix as Design/Store — the dashboard canvas isn't reliably nested
  // under its own department's enclosure panel, so show all of them.
  ddShowAllWorkspaceEnclosures();
  const c = document.getElementById("canvas-module-purchase-dashboard");
  if (c) c.style.display = "block";
  showDashboardGlobalToolbar("Purchase Dashboard", "pd-period-btns", pdReturnToMain);
  if (typeof pdLoadDashboard === "function") pdLoadDashboard();
}

function navigateToStoreDashboard() {
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none");
  // Same fix as Design — the dashboard canvas isn't reliably nested under
  // its own department's enclosure panel, so show all of them.
  ddShowAllWorkspaceEnclosures();
  const c = document.getElementById("canvas-module-store-dashboard");
  if (c) c.style.display = "block";
  showDashboardGlobalToolbar("Store Dashboard", "sd-period-btns", sdReturnToMain);
  if (typeof sdLoadDashboard === "function") sdLoadDashboard();
}

function sdReturnToMain() {
  const c = document.getElementById("canvas-module-store-dashboard");
  if (c) c.style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function navigateToAccountsDashboard() {
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none");
  // Same fix as every other dashboard — the canvas isn't reliably nested
  // under its own department's enclosure panel, so show all of them.
  ddShowAllWorkspaceEnclosures();
  const c = document.getElementById("canvas-module-accounts-dashboard");
  if (c) c.style.display = "block";
  showDashboardGlobalToolbar("Accounts Dashboard", "ad-period-btns", adReturnToMain);
  if (typeof adLoadDashboard === "function") adLoadDashboard();
}

function pd2ReturnToMain() {
  const c = document.getElementById("canvas-module-production-dashboard");
  if (c) c.style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

// ═══════════════════════════════════════════════════════
// STORE DASHBOARD ENGINE
// ═══════════════════════════════════════════════════════
let sdCurrentPeriod     = "today";
let sdCurrentCustomType = "customday";
let sdChartDept = null, sdChartTrend = null, sdChartGrnType = null;

// NOTE: pd2ChartDept/pd2ChartTrend/pd2ChartCompletion belong to the Production
// Dashboard Engine (used further down) but are declared here since this was the
// surviving declaration site after a prior duplicate-fix. Left in place intentionally.
let pd2ChartDept = null, pd2ChartTrend = null, pd2ChartCompletion = null;

let sdHealthData = [], sdHealthFiltered = [], sdHealthCurrentPage = 1;
const SD_HEALTH_PAGE_SIZE = 5;

