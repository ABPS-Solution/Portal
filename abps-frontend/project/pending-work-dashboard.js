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
      const waiting = g.cards.reduce((n, c) => n + (Number(c.value) || 0), 0);
      return `<div style="background:var(--card); border:1px solid var(--border); border-left:5px solid ${accent}; border-radius:var(--radius); padding:10px 12px 12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
          <span style="font-size:1.05rem; font-weight:800; letter-spacing:0.3px; color:${accent};">${escapeHtml(g.dept)}</span>
          ${g.error
            ? '<span style="font-size:0.75rem; font-weight:700; color:#b91c1c;">Could not load</span>'
            : `<span style="font-size:0.75rem; font-weight:700; padding:2px 10px; border-radius:999px; background:${waiting > 0 ? "#fee2e2" : "#dcfce7"}; color:${waiting > 0 ? "#b91c1c" : "#15803d"};">${waiting > 0 ? waiting + " waiting" : "All clear"}</span>`}
        </div>
        <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;">
          ${g.cards.map(c => `<div class="dd-stat-card stat-live" style="height:96px; min-height:96px; justify-content:flex-start;">
            <div class="dd-stat-label">${escapeHtml(c.label)}</div>
            <div class="dd-stat-val" style="margin-top:auto; color:${Number(c.value) > 0 ? "#b91c1c" : "var(--text)"};">${c.value === null ? "—" : escapeHtml(String(c.value))}</div>
          </div>`).join("")}
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    if (e.message === "SESSION_EXPIRED") return;
    body.innerHTML = `<div style="grid-column:1 / -1; padding:20px; color:#b91c1c; text-align:center;">Could not load the pending work. ${escapeHtml(friendlyErr(e))}</div>`;
  }
}
