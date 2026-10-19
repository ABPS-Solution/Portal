// shared/current-projects.js — Current Projects board (header button).
// One row per project, one coloured cell per Project Timeline step.
// Data: fetchCurrentProjectsBoard (routes/currentProjects.js). Not shown on
// phones or device-restricted sessions (server refuses those too).

let cpbBoardData = null;
let cpbShowCosting = false;

function cpbIsPhone() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(ua) || /Android.*Mobile/i.test(ua)) return true;
  return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
}

function openCurrentProjectsBoard() {
  if (cpbIsPhone()) return;
  switchActiveDashboardModule("current-projects");
}

function exitCurrentProjectsBackToMenu() {
  document.getElementById("canvas-module-current-projects").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function initializeCurrentProjectsPanel() {
  const mount = document.getElementById("cpb-mount");
  if (!mount) return;
  cpbShowCosting = false;
  mount.innerHTML = `
    <div class="cpb-toolbar">
      <input type="text" id="cpb-search" placeholder="Search by company or Project ID..." oninput="cpbRenderTable()" autocomplete="off" />
      <select id="cpb-status" onchange="cpbLoadBoard()">
        <option value="Active" selected>Active</option>
        <option value="Active,Inactive">Active + Inactive</option>
        <option value="Inactive">Inactive</option>
        <option value="Complete">Complete</option>
        <option value="Active,Inactive,Complete">All</option>
      </select>
      <label id="cpb-costing-wrap" class="cpb-costing-toggle" style="display:none;">
        <input type="checkbox" id="cpb-costing" onchange="cpbToggleCosting(this.checked)" /> Show Costing
      </label>
      <div class="cpb-legend">
        <span><i class="cpb-sw cpb-done"></i>Done</span>
        <span><i class="cpb-sw cpb-partial"></i>Partly done</span>
        <span><i class="cpb-sw cpb-pending"></i>Pending</span>
        <span><i class="cpb-sw cpb-na"></i>Not needed / not due</span>
      </div>
    </div>
    <div id="cpb-summary" class="cpb-summary"></div>
    <div id="cpb-table-wrap" class="cpb-table-wrap"><div class="cpb-msg">Loading projects...</div></div>`;
  cpbLoadBoard();
}

function cpbToggleCosting(on) {
  cpbShowCosting = !!on;
  cpbLoadBoard();
}

async function cpbLoadBoard() {
  const wrap = document.getElementById("cpb-table-wrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="cpb-msg">Loading projects...</div>`;
  const statuses = (document.getElementById("cpb-status")?.value || "Active").split(",");
  try {
    const data = await apFetch({ action: "fetchCurrentProjectsBoard", statuses, showCosting: cpbShowCosting, _timeoutMs: 55000 });
    if (!data.success) {
      wrap.innerHTML = `<div class="cpb-msg cpb-err">${escapeHtml(data.error || "Could not load projects.")}</div>`;
      return;
    }
    cpbBoardData = data;
    const tw = document.getElementById("cpb-costing-wrap");
    if (tw) tw.style.display = data.canSeeCosting ? "" : "none";
    cpbRenderTable();
  } catch (e) {
    if (e && e.message === "SESSION_EXPIRED") return;
    wrap.innerHTML = `<div class="cpb-msg cpb-err">${escapeHtml(e.message)}</div>`;
  }
}

function cpbMoney(v) {
  if (v == null) return "-";
  return "₹" + Math.round(Number(v)).toLocaleString("en-IN");
}

function cpbPct(v) {
  return v == null ? "-" : trimNum(v) + "%";
}

const CPB_STATE_WORDS = { done: "Completed", partial: "Partially", pending: "Pending" };

function cpbCellHtml(cell, key) {
  if (!cell) return `<td class="cpb-cell cpb-na"></td>`;
  let text = CPB_STATE_WORDS[cell.state] || cell.text || "Not needed";
  if (/^\d+\/\d+$/.test(cell.text || "")) text = cell.text;
  if (key === "delivery") text = cell.date ? formatOrdinalDate(cell.date) : (cell.text || "Not set");
  const tip = [cell.tip, cell.date ? formatOrdinalDate(cell.date) : ""].filter(Boolean).join(". ");
  return `<td class="cpb-cell cpb-${escapeHtml(cell.state)}" title="${escapeHtml(tip)}">${escapeHtml(text)}</td>`;
}

function cpbRenderTable() {
  const wrap = document.getElementById("cpb-table-wrap");
  const data = cpbBoardData;
  if (!wrap || !data) return;
  const q = (document.getElementById("cpb-search")?.value || "").trim().toLowerCase();
  const rows = data.rows.filter(r => !q || (r.projectId || "").toLowerCase().includes(q) || (r.companyName || "").toLowerCase().includes(q));
  const summary = document.getElementById("cpb-summary");
  if (summary) summary.textContent = `${rows.length} of ${data.rows.length} project${data.rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    wrap.innerHTML = `<div class="cpb-msg">No projects match.</div>`;
    return;
  }
  const canOpen = typeof userPermissions !== "undefined" && userPermissions && userPermissions.projectTimeline === true;
  const COST = { poValue: ["PO Value (Basic)", cpbMoney], designCosting: ["Design Costing", cpbMoney],
    designMsr: ["Design MSR", cpbPct], currentCosting: ["Current Costing", cpbMoney] };
  const order = [];
  data.columns.forEach(c => {
    if (data.withCosting && c.key === "production") order.push({ cost: "currentCosting" });
    order.push({ step: c });
    if (data.withCosting && c.key === "po") order.push({ cost: "poValue" });
    if (data.withCosting && c.key === "boqs") order.push({ cost: "designCosting" }, { cost: "designMsr" });
  });
  const head = order.map(o => o.step
    ? `<th class="cpb-stage${o.step.stage}" title="Stage ${o.step.stage}">${escapeHtml(o.step.label)}</th>`
    : `<th class="cpb-cost">${escapeHtml(COST[o.cost][0])}</th>`).join("");
  const body = rows.map(r => {
    const idCell = canOpen
      ? `<a href="javascript:void(0)" onclick="cpbOpenTimeline(${jsArg(r.projectId)})" title="Open Project Timeline">${escapeHtml(r.projectId)}</a>`
      : escapeHtml(r.projectId);
    const cells = order.map(o => {
      if (o.step) return cpbCellHtml(r.cells[o.step.key], o.step.key);
      const v = r.costing ? r.costing[o.cost] : null;
      const tip = o.cost === "designCosting" && v == null && r.costing && r.costing.designSoFar
        ? `Not every BOQ is authorized yet. So far: ${cpbMoney(r.costing.designSoFar)}` : "";
      return `<td class="cpb-cost" title="${escapeHtml(tip)}">${escapeHtml(COST[o.cost][1](v))}</td>`;
    }).join("");
    return `<tr><th class="cpb-first" title="${escapeHtml(r.companyName || "")}"><div class="cpb-pid">${idCell} <span class="cpb-status cpb-st-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></div></th>${cells}</tr>`;
  }).join("");
  enableTableCrosshair(wrap);
  wrap.innerHTML = `<table class="cpb-table"><thead><tr><th class="cpb-first">Project</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function cpbOpenTimeline(projectId) {
  switchActiveDashboardModule("project-timeline");
  let tries = 0;
  const wait = setInterval(() => {
    tries++;
    if (document.getElementById("ptl-project-input") && document.getElementById("ptl-body")) {
      clearInterval(wait);
      selectPtlProject(projectId);
    } else if (tries > 50) clearInterval(wait);
  }, 100);
}
