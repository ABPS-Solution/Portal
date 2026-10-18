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
        <option value="Active,Inactive" selected>Active + Inactive</option>
        <option value="Active">Active</option>
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
  const statuses = (document.getElementById("cpb-status")?.value || "Active,Inactive").split(",");
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

function cpbCellHtml(cell) {
  if (!cell) return `<td class="cpb-cell cpb-na"></td>`;
  const text = cell.text != null ? cell.text : (cell.date ? formatOrdinalDate(cell.date) : (cell.state === "pending" ? "Pending" : ""));
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
  const costCols = data.withCosting ? [
    ["poValue", "PO Value (Basic)", cpbMoney], ["designCosting", "Design Costing", cpbMoney],
    ["currentCosting", "Current Costing", cpbMoney], ["designMsr", "Design MSR", cpbPct],
    ["currentMsr", "Current MSR", cpbPct], ["paymentReceived", "Payment Received", cpbMoney],
  ] : [];
  const stageHead = data.columns.map(c => `<th class="cpb-stage${c.stage}" title="Stage ${c.stage}">${escapeHtml(c.label)}</th>`).join("");
  const costHead = costCols.map(c => `<th class="cpb-cost">${escapeHtml(c[1])}</th>`).join("");
  const body = rows.map(r => {
    const idCell = canOpen
      ? `<a href="javascript:void(0)" onclick="cpbOpenTimeline(${jsArg(r.projectId)})" title="Open Project Timeline">${escapeHtml(r.projectId)}</a>`
      : escapeHtml(r.projectId);
    const cells = data.columns.map(c => cpbCellHtml(r.cells[c.key])).join("");
    const cost = costCols.map(c => {
      const v = r.costing ? r.costing[c[0]] : null;
      const tip = c[0] === "designCosting" && v == null && r.costing && r.costing.designSoFar
        ? `Not every BOQ is authorized yet. So far: ${cpbMoney(r.costing.designSoFar)}` : "";
      return `<td class="cpb-cost" title="${escapeHtml(tip)}">${escapeHtml(c[2](v))}</td>`;
    }).join("");
    return `<tr><th class="cpb-first"><div class="cpb-pid">${idCell} <span class="cpb-status cpb-st-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></div><div class="cpb-co">${escapeHtml(r.companyName || "")}</div></th>${cells}${cost}</tr>`;
  }).join("");
  wrap.innerHTML = `<table class="cpb-table"><thead><tr><th class="cpb-first">Project</th>${stageHead}${costHead}</tr></thead><tbody>${body}</tbody></table>`;
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
