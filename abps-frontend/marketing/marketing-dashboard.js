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
  ["md-s-newleads","md-s-inprogress","md-s-ordersreceived","md-s-failed","md-s-avgdays",
   "md-s-followupsdue","md-s-opentasks","md-s-zerofollowup","md-s-pouploads","md-s-offerssent"].forEach(id => {
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
  const { stats, statusCounts, trendData, staleLeads, recentWins } = data;

  document.getElementById("md-s-newleads").textContent       = stats.newLeads;
  document.getElementById("md-s-inprogress").textContent     = stats.inProgress;
  document.getElementById("md-s-ordersreceived").textContent = stats.ordersReceived;
  document.getElementById("md-s-failed").textContent         = stats.leadsFailed;
  document.getElementById("md-s-avgdays").textContent        = stats.avgConversionDays !== null ? stats.avgConversionDays : "—";
  document.getElementById("md-s-followupsdue").textContent   = stats.followUpsDueOverdue;
  document.getElementById("md-s-opentasks").textContent      = stats.openTasks;
  document.getElementById("md-s-zerofollowup").textContent   = stats.zeroFollowUpLeads;
  document.getElementById("md-s-pouploads").textContent      = stats.poUploads;
  document.getElementById("md-s-offerssent").textContent     = stats.distinctOffersSent;

  // Chart 1 — Lead Status Funnel (bar)
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
      scales:{ x:{ grid:{ color:"#f1f5f9" }, ticks:{ stepSize:1 } }, y:{ grid:{ display:false } } } }
  });

  // Chart 2 — New Leads vs Orders Received (dual line)
  if (mdChartTrend) mdChartTrend.destroy();
  const ctxTrend = document.getElementById("md-chart-trend").getContext("2d");
  mdChartTrend = new Chart(ctxTrend, {
    type: "line",
    data: {
      labels: trendData.map(t => t.label),
      datasets: [
        { label:"New Leads",       data: trendData.map(t => t.newLeads),       borderColor:"rgba(37,99,235,0.9)",  backgroundColor:"rgba(37,99,235,0.15)", tension:0.3, fill:true },
        { label:"Orders Received", data: trendData.map(t => t.ordersReceived), borderColor:"rgba(21,128,61,0.9)",  backgroundColor:"rgba(21,128,61,0.15)", tension:0.3, fill:true }
      ]
    },
    options: { responsive:true, plugins:{ legend:{ display:true, labels:{ font:{ size:9 } } } },
      scales:{ y:{ ticks:{ stepSize:1 }, grid:{ color:"#f1f5f9" } }, x:{ grid:{ display:false }, ticks:{ font:{ size:9 } } } } }
  });

  // Chart 3 — Lead Status Distribution (donut)
  if (mdChartDonut) mdChartDonut.destroy();
  const donutLabels = Object.keys(statusCounts);
  const donutColors = ["#2563eb","#15803d","#b45309","#b91c1c","#7c3aed","#0891b2","#c026d3","#65a30d","#dc2626"];
  const ctxDonut = document.getElementById("md-chart-donut").getContext("2d");
  mdChartDonut = new Chart(ctxDonut, {
    type: "doughnut",
    data: {
      labels: donutLabels,
      datasets: [{ data: donutLabels.map(k => statusCounts[k]), backgroundColor: donutLabels.map((_,i) => donutColors[i % donutColors.length]) }]
    },
    options: { responsive:true, plugins:{ legend:{ display:true, position:"bottom", labels:{ font:{ size:8 }, boxWidth:8 } } } }
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
// never goes stale. Flush against the toolbar (no extra buffer) — the
// *-body div's own small bottom/side padding is what's left providing any
// breathing room; its own top padding was removed so there's exactly one
// thing controlling top spacing, not two paddings whose sum was hard to
// reason about.
function syncDashboardCanvasTopPadding() {
  const toolbar = document.getElementById("dashboard-global-toolbar");
  if (!toolbar || toolbar.style.display === "none") return;
  const h = toolbar.offsetHeight;
  document.querySelectorAll('.workspace-panel[id^="canvas-module-"][id*="dashboard"]').forEach(c => {
    if (c.style.display === "block") c.style.paddingTop = h + "px";
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
  ["dd-period-btns","pd-period-btns","sd-period-btns","md-period-btns","pd2-period-btns"].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = (id === periodBtnsId) ? "flex" : "none";
  });
  ["dd-custom-zone","pd-custom-zone","sd-custom-zone","md-custom-zone","pd2-custom-zone"].forEach(id => {
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

