// marketing/new-leads-report.js — "New Leads Report" view on Search Leads by
// ABPS Engineer Name and Status (10 Oct 2026). Lists every lead CREATED in a
// date range (not leads in 'New Lead' status). Engineer / Status pills are
// shared with the Lead Cards view. Backend: lib/newLeadsReport.js.

function nlrIstToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function switchLeadMatrixView(view) {
  const isReport = view === 'report';
  const on = (b) => { b.style.color = "var(--brand)"; b.style.borderBottomColor = "var(--brand)"; b.style.fontWeight = "800"; };
  const off = (b) => { b.style.color = "var(--muted)"; b.style.borderBottomColor = "transparent"; b.style.fontWeight = "700"; };
  const c = document.getElementById("lms-tab-cards"), r = document.getElementById("lms-tab-report");
  isReport ? (on(r), off(c)) : (on(c), off(r));
  document.getElementById("lms-report-filters").style.display = isReport ? "" : "none";
  document.getElementById("nlr-run-btn").style.display = isReport ? "" : "none";
  document.getElementById("lead-matrix-search-submit-btn").style.display = isReport ? "none" : "";
  document.getElementById("nlr-output").style.display = isReport ? "" : "none";
  const fd = document.getElementById("lead-matrix-active-filters-display");
  if (fd) fd.style.display = "none";
  // The Lead Cards results live in the shared canvas; hide them in report view.
  const canvas = document.getElementById("step2-inline-interaction-canvas");
  if (canvas && canvas.parentElement && canvas.parentElement.id === "workspace-searchStatus") {
    canvas.style.display = "none";
    const mc = document.getElementById("multi-contact-records-container");
    if (mc) mc.innerHTML = "";
  }
  if (isReport) {
    const from = document.getElementById("nlr-from"), to = document.getElementById("nlr-to");
    if (from && !from.value) nlrQuickRange('week');
  } else {
    document.getElementById("nlr-output").innerHTML = "";
  }
}

function nlrQuickRange(kind) {
  const today = nlrIstToday();
  const d = new Date(today + "T00:00:00Z");
  let from = today;
  if (kind === 'week') {
    const dow = d.getUTCDay(); // Sunday = 0; week starts Monday
    const back = dow === 0 ? 6 : dow - 1;
    from = new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
  } else if (kind === 'month') {
    from = today.slice(0, 8) + "01";
  } else if (kind === 'yesterday') {
    from = new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
  }
  const to = kind === 'yesterday' ? from : today;
  document.getElementById("nlr-from").value = from;
  document.getElementById("nlr-to").value = to;
  // Programmatic .value doesn't fire change; refresh the DD/MM overlay.
  ["nlr-from", "nlr-to"].forEach(id => document.getElementById(id).dispatchEvent(new Event("input", { bubbles: true })));
  nlrMarkQuick(kind);
}

function nlrMarkQuick(kind) {
  document.querySelectorAll(".nlr-quick-btn").forEach(b => b.classList.toggle("active", b.dataset.range === kind));
}

function nlrReadFilters() {
  return {
    startDate: document.getElementById("nlr-from").value,
    endDate: document.getElementById("nlr-to").value,
    engineers: Array.from(document.querySelectorAll('input[name="leadMatrixEngineerFilter"]:checked')).map(i => i.value),
    statuses: Array.from(document.querySelectorAll('input[name="leadMatrixStatusFilter"]:checked')).map(i => i.value),
  };
}

function nlrPlanHtml(plan) {
  if (!plan.length) return '<span style="color:var(--muted);">None ticked</span>';
  const color = { done: '#15803d', overdue: '#b91c1c', open: '#b45309', 'no task': 'var(--muted)' };
  return plan.map(a => `<div style="color:${color[a.state] || 'inherit'}; font-weight:600; margin-bottom:3px;">${escapeHtml(a.text)}</div>`).join("");
}

async function runNewLeadsReport() {
  const f = nlrReadFilters();
  if (!f.startDate || !f.endDate) { alert("Please choose a From and To date."); return; }
  const btn = document.getElementById("nlr-run-btn");
  const out = document.getElementById("nlr-output");
  btn.classList.add("loading"); btn.textContent = "Loading...";
  out.innerHTML = `<div style="color:var(--muted); padding:10px 0;">Loading new leads...</div>`;
  try {
    const data = await apFetch({ action: "fetchNewLeadsReport", ...f });
    if (!data.success) { out.innerHTML = `<div style="color:var(--warn); font-weight:700;">${escapeHtml(data.error || "Could not load the report.")}</div>`; return; }
    window._nlrLastFilters = f;
    out.innerHTML = nlrRenderReport(data, f);
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") out.innerHTML = `<div style="color:var(--warn); font-weight:700;">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.classList.remove("loading"); btn.textContent = "Run New Leads Report";
  }
}

function nlrRenderReport(data, f) {
  const t = data.totals;
  const range = `${formatOrdinalDate(f.startDate)} to ${formatOrdinalDate(f.endDate)}`;
  if (!data.rows.length) {
    return `<div style="color:var(--warn); font-weight:700; padding:10px 0;">No leads were created ${escapeHtml(range)} for these filters.</div>`;
  }
  const engChips = t.byEngineer.map(e => `<span style="display:inline-block; background:#fff; border:1px solid var(--border); border-radius:999px; padding:3px 10px; margin:3px 4px 0 0; font-size:0.78rem;">${escapeHtml(e.name)}: <strong>${e.count}</strong></span>`).join("");
  const strip = `
    <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:stretch; margin:14px 0 10px;">
      <div style="background:var(--highlight-bg); border:1px solid var(--border); border-radius:8px; padding:10px 14px; min-width:150px;">
        <div style="font-size:0.75rem; color:var(--muted); font-weight:700;">New leads, ${escapeHtml(range)}</div>
        <div style="font-size:1.5rem; font-weight:800; color:var(--brand);">${t.leads}</div>
      </div>
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px 14px; min-width:150px;">
        <div style="font-size:0.75rem; color:#991b1b; font-weight:700;">Action plan not started</div>
        <div style="font-size:1.5rem; font-weight:800; color:#b91c1c;">${t.actionPlanPending}</div>
      </div>
      <div style="flex:1; min-width:220px; background:var(--highlight-bg); border:1px solid var(--border); border-radius:8px; padding:10px 14px;">
        <div style="font-size:0.75rem; color:var(--muted); font-weight:700;">By ABPS Engineer</div>
        <div>${engChips}</div>
      </div>
      <div style="display:flex; align-items:center;">
        <button class="btn" style="width:auto; background:#15803d; padding:10px 16px;" id="nlr-download-btn" onclick="downloadNewLeadsReport()">Download Excel</button>
      </div>
    </div>`;
  const td = 'padding:8px; border:1px solid var(--border); vertical-align:top;';
  const rows = data.rows.map(r => `
    <tr style="cursor:pointer;" onclick="nlrToggleLead(${jsArg(r.leadId)})" title="Click to open this lead">
      <td style="${td} white-space:nowrap;">${escapeHtml(formatOrdinalDate(r.createdDate))}<div style="color:var(--muted); font-size:0.75rem;">${escapeHtml(r.leadId)}</div></td>
      <td style="${td}"><strong>${escapeHtml(r.companyName)}</strong>${r.city || r.state ? `<div style="color:var(--muted); font-size:0.75rem;">${escapeHtml([r.city, r.state].filter(Boolean).join(", "))}</div>` : ""}</td>
      <td style="${td}">${escapeHtml(r.contactPerson)}${r.position ? `<div style="color:var(--muted); font-size:0.75rem;">${escapeHtml(r.position)}</div>` : ""}${r.phone ? `<div style="font-size:0.75rem;">${escapeHtml(r.phone)}</div>` : ""}</td>
      <td style="${td}">${escapeHtml(r.engineerName)}</td>
      <td style="${td}">${escapeHtml(r.status)}</td>
      <td style="${td}">${nlrPlanHtml(r.actionPlan)}</td>
      <td style="${td} font-size:0.8rem;">Follow-ups: <strong>${r.followUpCount}</strong><br>Tasks: <strong>${r.taskCount}</strong><br>Offers sent: <strong>${r.offersSent}</strong>${r.lastActivity ? `<div style="color:var(--muted); margin-top:3px;">Last: ${escapeHtml(formatOrdinalDate(r.lastActivity))}</div>` : ""}</td>
      <td style="${td} font-size:0.8rem;">${escapeHtml(r.summary) || '<span style="color:var(--muted);">No details entered</span>'}</td>
    </tr>
    <tr id="nlr-lead-row-${escapeHtml(r.leadId)}" style="display:none;"><td colspan="8" style="padding:0; border:1px solid var(--border);"><div id="nlr-lead-box-${escapeHtml(r.leadId)}" style="padding:10px; background:var(--highlight-bg);"></div></td></tr>`).join("");
  const th = 'padding:8px; border:1px solid var(--border); background:#e2e8f0; text-align:left; font-size:0.8rem;';
  return strip + `
    <div style="overflow-x:auto;">
      <table style="width:100%; min-width:1100px; border-collapse:collapse; font-size:0.85rem;">
        <colgroup><col style="width:9%"><col style="width:13%"><col style="width:12%"><col style="width:10%"><col style="width:9%"><col style="width:17%"><col style="width:10%"><col style="width:20%"></colgroup>
        <thead><tr>
          <th style="${th}">Created</th><th style="${th}">Company</th><th style="${th}">Contact Person</th>
          <th style="${th}">ABPS Engineer</th><th style="${th}">Status</th><th style="${th}">Action Plan</th>
          <th style="${th}">Activity</th><th style="${th}">Summary</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function nlrToggleLead(leadId) {
  const row = document.getElementById(`nlr-lead-row-${leadId}`);
  const box = document.getElementById(`nlr-lead-box-${leadId}`);
  if (!row || !box) return;
  if (row.style.display !== "none") { row.style.display = "none"; box.innerHTML = ""; return; }
  // Only one open at a time: lead cards use fixed element ids.
  document.querySelectorAll('[id^="nlr-lead-row-"]').forEach(el => { el.style.display = "none"; });
  document.querySelectorAll('[id^="nlr-lead-box-"]').forEach(el => { el.innerHTML = ""; });
  row.style.display = "";
  box.innerHTML = `<div style="color:var(--muted);">Loading lead...</div>`;
  try {
    const data = await apFetch({ action: "fetchLeadCardById", leadId });
    if (!data.success || !data.leads?.length) { box.innerHTML = `<div style="color:var(--warn); font-weight:700;">Lead not found.</div>`; return; }
    globalFollowUpsCacheMap = data.followups;
    globalTasksCacheMap = data.tasks;
    box.innerHTML = `<div id="nlr-lead-cards-${escapeHtml(leadId)}"></div>`;
    buildMultiContactDirectoryInterface(data.leads, "", `nlr-lead-cards-${leadId}`);
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") box.innerHTML = `<div style="color:var(--warn); font-weight:700;">${escapeHtml(e.message)}</div>`;
  }
}

async function downloadNewLeadsReport() {
  const f = window._nlrLastFilters;
  if (!f) return;
  const btn = document.getElementById("nlr-download-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }
  try {
    const data = await apFetch({ action: "downloadNewLeadsReport", ...f });
    if (!data.success) { alert(data.error || "Download failed."); return; }
    const link = document.createElement("a");
    link.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + data.base64;
    link.download = data.fileName;
    document.body.appendChild(link); link.click(); link.remove();
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") alert(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Download Excel"; }
  }
}
