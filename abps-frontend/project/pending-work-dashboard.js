// ═══════════════════════════════════════════════════════════════════════
// project/pending-work-dashboard.js — Pending Work Dashboard (Admin).
// One card per backlog tile from the department dashboards, same name and
// same number (the server reads each figure from that department's own
// dashboard route). Live, no period. One screen, no scrolling: a 4 x 2
// grid of department boxes. Data: fetchPendingWorkDashboardData.
// ═══════════════════════════════════════════════════════════════════════
const PWK_DEPT_ACCENT = {
  Marketing: "#2563eb", Design: "#0891b2", Purchase: "#7c3aed", Store: "#b45309",
  QA: "#be123c", Production: "#15803d", Accounts: "#475569",
};

function openPendingWorkDashboard() {
  window.scrollTo(0, 0);
  document.getElementById("dashboard-view").style.display = "none";
  const mwc = document.getElementById("module-workspace-container");
  if (mwc) mwc.style.display = "none";
  document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none");
  if (typeof ddShowAllWorkspaceEnclosures === "function") ddShowAllWorkspaceEnclosures();
  document.getElementById("canvas-module-pending-work").style.display = "block";
  showDashboardGlobalToolbar("Pending Work Dashboard", "pwk-period-btns", exitPendingWorkDashboard);
  loadPendingWorkDashboard();
}

function exitPendingWorkDashboard() {
  document.getElementById("canvas-module-pending-work").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

async function loadPendingWorkDashboard() {
  const body = document.getElementById("pwk-body");
  body.innerHTML = `<div style="grid-column:1 / -1; padding:20px; color:var(--muted); text-align:center;">Loading pending work...</div>`;
  try {
    const data = await apFetch({ action: "fetchPendingWorkDashboardData", _timeoutMs: 55000 });
    if (!data.success) throw new Error(data.error || "Could not load the pending work.");
    body.innerHTML = data.groups.map(g => {
      const accent = PWK_DEPT_ACCENT[g.dept] || "var(--brand)";
      return `<div class="dd-card" style="display:flex; flex-direction:column; gap:8px; min-height:0; border-top:4px solid ${accent};">
        <div style="font-weight:800; color:${accent};">${escapeHtml(g.dept)}${g.error ? ' <span style="color:#b91c1c; font-size:0.78rem; font-weight:600;">(could not load)</span>' : ""}</div>
        ${g.cards.map(c => `<div class="dd-stat-card stat-live" style="flex:1; min-height:0;">
          <div class="dd-stat-label">${escapeHtml(c.label)}</div>
          <div class="dd-stat-val" style="color:${Number(c.value) > 0 ? "#b91c1c" : "var(--text)"};">${c.value === null ? "—" : escapeHtml(String(c.value))}</div>
        </div>`).join("")}
      </div>`;
    }).join("");
  } catch (e) {
    if (e.message === "SESSION_EXPIRED") return;
    body.innerHTML = `<div style="grid-column:1 / -1; padding:20px; color:#b91c1c; text-align:center;">Could not load the pending work. ${escapeHtml(friendlyErr(e))}</div>`;
  }
}
