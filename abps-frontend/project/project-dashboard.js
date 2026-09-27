// ===========================================================================
// project/project-dashboard.js -- Project Department Dashboard (28 Sep 2026).
// Same shape as every other department dashboard: Row 1 live figures, Row 2
// figures for the selected period, Row 3 charts, Row 4 tables. Created
// empty on purpose; tiles are added as they are decided.
// ===========================================================================
let pjdCurrentPeriod     = "today";
let pjdCurrentCustomType = "customday";
function navigateToProjectDashboard() {
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none");
  ddShowAllWorkspaceEnclosures();
  const c = document.getElementById("canvas-module-project-dashboard");
  if (c) c.style.display = "block";
  showDashboardGlobalToolbar("Project Dashboard", "pjd-period-btns", pjdReturnToMain);
  if (typeof pjdLoadDashboard === "function") pjdLoadDashboard();
}

function pjdReturnToMain() {
  const c = document.getElementById("canvas-module-project-dashboard");
  if (c) c.style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function pjdSetPeriod(btn) {
  document.querySelectorAll("#pjd-period-btns .dd-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  pjdCurrentPeriod = btn.dataset.period;
  const customZone = document.getElementById("pjd-custom-zone");
  if (pjdCurrentPeriod === "custom") { customZone.style.display = "flex"; requestAnimationFrame(syncDashboardCanvasTopPadding); return; }
  customZone.style.display = "none";
  requestAnimationFrame(syncDashboardCanvasTopPadding);
  pjdLoadDashboard();
}

function pjdCustomTypeChange() {
  pjdCurrentCustomType = dashCustomTypeChange("pjd");
}

function pjdLoadCustom() {
  const val = dashReadCustomVal("pjd");
  if (!val) return alert("Please enter a value for the custom period.");
  pjdCurrentPeriod = pjdCurrentCustomType;
  pjdLoadDashboard(val);
}

async function pjdLoadDashboard(customVal) {
  try {
    const data = await apFetch({
      action:      "fetchProjectDashboardData",
      periodType:  pjdCurrentPeriod,
      periodValue: customVal || "",
      todayOverride: localStorage.getItem("ptlTodayOverride") || ""
    });
    if (!data.success) { alert("Project Dashboard load failed: " + data.error); return; }
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") alert("Project Dashboard error: " + e.message);
  }
}
