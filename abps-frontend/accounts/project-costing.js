// accounts/project-costing.js — Project Costing (Accounts, 15 Oct 2026).
// Backend: lib/projectCosting.js (routes fetchProjectCosting /
// fetchProjectCostingBreakdown). MSR = material cost / PO value (basic) x 100.

let pcostRows = [];
let pcostStatus = "Active";
let pcostDesignOnly = false;
const pcostOpen = new Set();

function pcostCall(action, payload) {
  return acFetch(action, payload);
}

function pcostMoney(v) {
  if (v === null || v === undefined) return "";
  return "₹" + Math.round(Number(v)).toLocaleString("en-IN");
}
function pcostPct(v) { return v === null || v === undefined ? "" : trimNum(Number(v).toFixed(1)) + "%"; }

function initializeProjectCostingPanel() {
  pcostStatus = "Active";
  pcostOpen.clear();
  const s = document.getElementById("pcost-search"); if (s) s.value = "";
  const t = document.getElementById("pcost-period-type"); if (t) t.value = "";
  pcostPeriodTypeChange();
  pcostRenderStatusPills();
  pcostLoad();
}

function pcostRenderStatusPills() {
  const box = document.getElementById("pcost-status-pills");
  if (!box) return;
  box.innerHTML = ["Active", "Completed", "All"].map(s =>
    `<button class="pcost-pill${s === pcostStatus ? " active" : ""}" onclick="pcostSetStatus(${jsArg(s)})">${s}</button>`).join("") +
    `<button class="pcost-pill${pcostDesignOnly ? " active" : ""}" style="margin-left:12px;" onclick="pcostToggleDesignOnly()">Only projects with Design MSR %</button>`;
}
function pcostToggleDesignOnly() { pcostDesignOnly = !pcostDesignOnly; pcostRenderStatusPills(); pcostRender(); }
function pcostMsrShade(r) {
  const m = Math.max(Number(r.designMsr) || 0, Number(r.actualMsr) || 0);
  return m > 100 ? "background:#fca5a5;" : m > 80 ? "background:#fee2e2;" : "";
}
function pcostSetStatus(s) { pcostStatus = s; pcostRenderStatusPills(); pcostLoad(); }

function pcostFyOptions() {
  const now = new Date(); const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  let out = "";
  for (let y = fyStart; y >= 2026; y--) out += `<option value="${y}">FY ${y}-${String(y + 1).slice(2)}</option>`;
  return out;
}

function pcostPeriodTypeChange() {
  const type = (document.getElementById("pcost-period-type") || {}).value || "";
  const box = document.getElementById("pcost-period-values");
  if (!box) return;
  const now = new Date();
  if (type === "month") {
    let months = "";
    APP_MONTH_NAMES.forEach((m, i) => { months += `<option value="${i + 1}"${i === now.getMonth() ? " selected" : ""}>${m}</option>`; });
    let years = ""; for (let y = now.getFullYear(); y >= 2026; y--) years += `<option value="${y}">${y}</option>`;
    box.innerHTML = `<select id="pcost-month" onchange="pcostLoad()">${months}</select><select id="pcost-year" onchange="pcostLoad()">${years}</select>`;
  } else if (type === "quarter") {
    box.innerHTML = `<select id="pcost-quarter" onchange="pcostLoad()"><option value="1">Q1 (Apr-Jun)</option><option value="2">Q2 (Jul-Sept)</option><option value="3">Q3 (Oct-Dec)</option><option value="4">Q4 (Jan-Mar)</option></select><select id="pcost-fy" onchange="pcostLoad()">${pcostFyOptions()}</select>`;
  } else if (type === "year") {
    box.innerHTML = `<select id="pcost-fy" onchange="pcostLoad()">${pcostFyOptions()}</select>`;
  } else {
    box.innerHTML = "";
  }
}

function pcostIso(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function pcostPeriod() {
  const type = (document.getElementById("pcost-period-type") || {}).value || "";
  const v = id => Number((document.getElementById(id) || {}).value);
  if (type === "month") {
    const m = v("pcost-month"), y = v("pcost-year");
    return { periodStart: pcostIso(y, m, 1), periodEnd: pcostIso(y, m, new Date(y, m, 0).getDate()) };
  }
  if (type === "quarter") {
    const q = v("pcost-quarter"), fy = v("pcost-fy");
    const startM = [4, 7, 10, 1][q - 1], y = q === 4 ? fy + 1 : fy;
    const endM = startM + 2;
    return { periodStart: pcostIso(y, startM, 1), periodEnd: pcostIso(y, endM, new Date(y, endM, 0).getDate()) };
  }
  if (type === "year") {
    const fy = v("pcost-fy");
    return { periodStart: pcostIso(fy, 4, 1), periodEnd: pcostIso(fy + 1, 3, 31) };
  }
  return { periodStart: null, periodEnd: null };
}

async function pcostLoad() {
  const body = document.getElementById("pcost-table-wrap");
  if (!body) return;
  body.innerHTML = `<div style="padding:16px; color:var(--muted);">Loading...</div>`;
  try {
    const data = await pcostCall("fetchProjectCosting", { status: pcostStatus, ...pcostPeriod() });
    if (!data.success) throw new Error(data.error || "Could not load project costing.");
    pcostRows = data.rows || [];
    pcostRender();
  } catch (err) {
    if (err && err.message === "SESSION_EXPIRED") return;
    body.innerHTML = `<div style="padding:16px; color:#b91c1c;">${escapeHtml(err.message || String(err))}</div>`;
  }
}

function pcostRender() {
  const wrap = document.getElementById("pcost-table-wrap");
  if (!wrap) return;
  const q = ((document.getElementById("pcost-search") || {}).value || "").trim().toLowerCase();
  const rows = pcostRows.filter(r => (!q || (r.projectId + " " + (r.companyName || "")).toLowerCase().includes(q)) && (!pcostDesignOnly || r.designMsr != null));
  if (!rows.length) { wrap.innerHTML = `<div style="padding:16px; color:var(--muted);">No projects for these filters.</div>`; return; }

  const sum = k => rows.reduce((a, r) => a + (r[k] == null ? 0 : Number(r[k])), 0);
  const designRows = rows.filter(r => r.designCosting != null);
  const doneRows = rows.filter(r => r.actualMsr != null);
  const tot = {
    po: sum("poValue"), rm: sum("rmPoCosting"), memo: sum("memoCosting"), tr: sum("transportCosting"), cur: sum("currentCosting"),
    design: designRows.reduce((a, r) => a + r.designCosting, 0),
    designPo: designRows.reduce((a, r) => a + r.poValue, 0),
    diff: designRows.reduce((a, r) => a + r.difference, 0),
    recv: sum("paymentReceived"), poGst: sum("poTotalWithGst"),
    actCost: doneRows.reduce((a, r) => a + r.currentCosting, 0), actPo: doneRows.reduce((a, r) => a + r.poValue, 0),
  };
  const ratio = (a, b) => b > 0 ? (a / b) * 100 : null;

  let html = `<div class="pcost-box"><table class="prn-view-table pcost-table"><colgroup>
      <col style="width:4%"><col style="width:15%"><col style="width:8%"><col style="width:9%"><col style="width:6%">
      <col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:11%"><col style="width:9%">
    </colgroup><thead><tr>
      <th>Sr No</th><th>Project</th><th>PO Value (Basic)</th><th>Design Estimated Costing</th><th>Design MSR %</th>
      <th>Current RM PO Costing</th><th>Current Production Memo Costing</th><th>Current Transport Costing</th><th>Total Current Costing</th>
      <th>Payment Received</th><th>Actual MSR %</th></tr></thead><tbody>`;
  rows.forEach((r, i) => {
    const open = pcostOpen.has(r.projectId);
    const design = r.designCosting != null ? pcostMoney(r.designCosting)
      : r.boqTotal === 0 ? `<span class="pcost-muted">No BOQs yet</span>`
      : `${r.designSoFar > 0 ? `<span class="pcost-muted">${pcostMoney(r.designSoFar)} so far</span><br>` : ""}<span class="pcost-flag">${r.boqPending} BOQ${r.boqPending === 1 ? "" : "s"} pending (${r.boqAuthorized}/${r.boqTotal} authorized)</span>`;
    const diff = r.difference == null ? "" :
      `<span style="color:${r.difference > 0 ? "#b91c1c" : "#15803d"}; font-weight:600;">${r.difference > 0 ? "+" : ""}${pcostMoney(r.difference).replace("₹-", "-₹")}</span>`;
    const pay = `${pcostMoney(r.paymentReceived)}${r.paymentPct != null ? `<div class="pcost-muted">${pcostPct(r.paymentPct)} of ${pcostMoney(r.poTotalWithGst)}</div>` : ""}`;
    const actual = r.status === "Complete" ? `<strong>${pcostPct(r.actualMsr)}</strong>${r.dispatchDate ? `<div class="pcost-muted">${formatOrdinalDate(r.dispatchDate)}</div>` : ""}` : `<span class="pcost-muted">Not dispatched</span>`;
    html += `<tr class="${r.status === "Complete" ? "pcost-done" : ""}" style="${pcostMsrShade(r)}">
      <td style="text-align:center;"><button class="pcost-sr" onclick="pcostToggle(${jsArg(r.projectId)})">${open ? "▾" : "▸"} ${i + 1}</button></td>
      <td class="pcost-left"><div style="font-weight:600;">${escapeHtml(r.companyName || "")}</div><div class="pcost-muted" style="word-break:break-all;">${escapeHtml(r.projectId)}</div></td>
      <td>${pcostMoney(r.poValue)}</td><td>${design}</td><td>${pcostPct(r.designMsr)}</td>
      <td>${pcostMoney(r.rmPoCosting)}</td><td>${pcostMoney(r.memoCosting)}</td><td>${pcostMoney(r.transportCosting)}</td><td><strong>${pcostMoney(r.currentCosting)}</strong>${r.poValue > 0 ? `<div class="pcost-muted">${pcostPct(ratio(r.currentCosting, r.poValue))} of PO</div>` : ""}</td>
      <td>${pay}</td><td>${actual}</td></tr>`;
    if (open) html += `<tr><td colspan="11" id="pcost-bd-${CSS.escape(r.projectId)}" style="background:#f8fafc;">Loading BOQs...</td></tr>`;
  });
  html += `<tr class="pcost-total"><td></td><td>Total (${rows.length})</td><td>${pcostMoney(tot.po)}</td>
    <td>${pcostMoney(tot.design)}</td><td>${pcostPct(ratio(tot.design, tot.designPo))}</td>
    <td>${pcostMoney(tot.rm)}</td><td>${pcostMoney(tot.memo)}</td><td>${pcostMoney(tot.tr)}</td><td>${pcostMoney(tot.cur)}</td>
    <td>${pcostMoney(tot.recv)}<div class="pcost-muted">${pcostPct(ratio(tot.recv, tot.poGst))}</div></td>
    <td>${pcostPct(ratio(tot.actCost, tot.actPo))}</td></tr></tbody></table></div>`;
  wrap.innerHTML = html;
  rows.filter(r => pcostOpen.has(r.projectId)).forEach(r => pcostLoadBreakdown(r.projectId));
}

function pcostToggle(projectId) {
  if (pcostOpen.has(projectId)) pcostOpen.delete(projectId); else pcostOpen.add(projectId);
  pcostRender();
}

async function pcostLoadBreakdown(projectId) {
  const cell = document.getElementById("pcost-bd-" + CSS.escape(projectId));
  if (!cell) return;
  try {
    const data = await pcostCall("fetchProjectCostingBreakdown", { projectId });
    if (!data.success) throw new Error(data.error || "Could not load BOQs.");
    const boqs = data.boqs || [];
    if (!boqs.length && !(data.pending || []).length) { cell.innerHTML = `<span class="pcost-muted">No BOQs yet.</span>`; return; }
    const pending = data.pending || [];
    const pendHtml = pending.length ? `<div style="margin-bottom:8px; text-align:left;"><span class="pcost-flag">Pending BOQs</span> ` +
      pending.map(p => `${escapeHtml(p.name || p.itemCode)}${p.isFg ? " (Finished Goods)" : ""}`).join(", ") + `</div>` : "";
    cell.innerHTML = pendHtml + `<div class="pcost-box"><table class="prn-view-table pcost-table" style="font-size:12px;">
      <thead><tr><th style="width:40%">BOQ</th><th>Status</th><th>Design Costing</th><th>RM PO Costing</th><th>Production Memo Costing</th><th>Total Current</th><th>Current vs Design</th></tr></thead><tbody>` +
      boqs.map(b => {
        const d = b.currentCosting - b.designCosting;
        const fg = b.isFg ? `<div class="pcost-muted">Finished Goods BOQ: its cost is already inside the main BOQ, so it is not added to Design Estimated Costing</div>` : "";
        return `<tr><td class="pcost-left" style="word-break:break-all;">${escapeHtml(b.boqId)}${fg}</td><td>${escapeHtml(b.status)}</td>
          <td${b.isFg ? ' style="color:var(--muted);"' : ""}>${pcostMoney(b.designCosting)}</td><td>${pcostMoney(b.rmPoCosting)}</td><td>${pcostMoney(b.memoCosting)}</td>
          <td>${pcostMoney(b.currentCosting)}</td>
          <td style="color:${d > 0 ? "#b91c1c" : "#15803d"};">${d > 0 ? "+" : ""}${pcostMoney(d).replace("₹-", "-₹")}</td></tr>`;
      }).join("") + `</tbody></table></div>`;
  } catch (err) {
    if (err && err.message === "SESSION_EXPIRED") return;
    cell.innerHTML = `<span style="color:#b91c1c;">${escapeHtml(err.message || String(err))}</span>`;
  }
}
