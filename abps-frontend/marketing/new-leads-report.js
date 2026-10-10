// marketing/new-leads-report.js — "New Leads Report" view on Search Leads by
// ABPS Engineer Name and Status (10 Oct 2026). Lists leads by the date they
// were CREATED (not leads in 'New Lead' status); with no dates it lists all
// leads for the chosen engineers / statuses. Engineer / Status pills are
// shared with the Lead Cards view. Backend: lib/newLeadsReport.js.

function nlrIstToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function switchLeadMatrixView(view) {
  const isReport = view === 'report';
  const on = (b) => { b.style.color = "var(--brand)"; b.style.borderBottomColor = "var(--brand)"; b.style.fontWeight = "800"; };
  const off = (b) => { b.style.color = "var(--muted)"; b.style.borderBottomColor = "transparent"; b.style.fontWeight = "700"; };
  const c = document.getElementById("lms-tab-cards"), r = document.getElementById("lms-tab-report");
  if (c && r) isReport ? (on(r), off(c)) : (on(c), off(r));
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
    const from = document.getElementById("nlr-from");
    if (from && !from.value && !window._nlrAllTime) nlrQuickRange('week');
  } else {
    document.getElementById("nlr-output").innerHTML = "";
  }
}

function nlrQuickRange(kind) {
  const fromEl = document.getElementById("nlr-from"), toEl = document.getElementById("nlr-to");
  window._nlrAllTime = kind === 'all';
  if (kind === 'all') {
    fromEl.value = ""; toEl.value = "";
  } else {
    const today = nlrIstToday();
    const d = new Date(today + "T00:00:00Z");
    let from = today;
    if (kind === 'week') {
      const dow = d.getUTCDay(); // Sunday = 0; week starts Monday
      from = new Date(d.getTime() - (dow === 0 ? 6 : dow - 1) * 86400000).toISOString().slice(0, 10);
    } else if (kind === 'month') {
      from = today.slice(0, 8) + "01";
    } else if (kind === 'yesterday') {
      from = new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
    }
    fromEl.value = from;
    toEl.value = kind === 'yesterday' ? from : today;
  }
  // Programmatic .value doesn't fire change; refresh the DD/MM overlay.
  [fromEl, toEl].forEach(el => el.dispatchEvent(new Event("input", { bubbles: true })));
  nlrMarkQuick(kind);
}

function nlrMarkQuick(kind) {
  if (kind === null) window._nlrAllTime = false;
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

function nlrRangeText(f) {
  if (!f.startDate && !f.endDate) return "All time";
  if (f.startDate === f.endDate) return formatOrdinalDate(f.startDate);
  return `${formatOrdinalDate(f.startDate)} to ${formatOrdinalDate(f.endDate)}`;
}

function nlrFilterText(f) {
  const parts = ["Created: " + nlrRangeText(f)];
  if (f.engineers.length) parts.push("Engineers: " + engineerEmailsToNames(f.engineers).join(", "));
  if (f.statuses.length) parts.push("Status: " + f.statuses.join(", "));
  return parts.join(" | ");
}

async function runNewLeadsReport() {
  const f = nlrReadFilters();
  if (!!f.startDate !== !!f.endDate) { alert("Please choose both a From and a To date, or click All Time."); return; }
  if (!f.startDate && !f.engineers.length && !f.statuses.length) {
    alert("For All Time, please select at least one Engineer or Status.");
    return;
  }
  const btn = document.getElementById("nlr-run-btn");
  const out = document.getElementById("nlr-output");
  btn.classList.add("loading"); btn.textContent = "Loading...";
  out.innerHTML = `<div class="nlr-filtering">Filtering for → ${escapeHtml(nlrFilterText(f))}</div><div style="color:var(--muted); padding:10px 0;">Loading leads...</div>`;
  try {
    const data = await apFetch({ action: "fetchNewLeadsReport", ...f });
    if (!data.success) {
      out.innerHTML = `<div class="nlr-filtering">Filtering for → ${escapeHtml(nlrFilterText(f))}</div><div style="color:var(--warn); font-weight:700;">${escapeHtml(data.error || "Could not load the report.")}</div>`;
      return;
    }
    window._nlrLastFilters = f;
    out.innerHTML = nlrRenderReport(data, f);
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") out.innerHTML = `<div style="color:var(--warn); font-weight:700;">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.classList.remove("loading"); btn.textContent = "Run Leads Search";
  }
}

const NLR_STATE_META = {
  done:      { label: "Done",    cls: "nlr-st-done" },
  overdue:   { label: "Overdue", cls: "nlr-st-overdue" },
  open:      { label: "Due",     cls: "nlr-st-open" },
  'no task': { label: "No task", cls: "nlr-st-none" },
};

function nlrPlanHtml(plan) {
  if (!plan.length) return '<span class="nlr-none">None</span>';
  return plan.map(a => {
    const m = NLR_STATE_META[a.state] || NLR_STATE_META['no task'];
    const when = a.state === 'overdue' ? `since ${formatOrdinalDate(a.due)}`
      : (a.state === 'open' && a.due ? formatOrdinalDate(a.due) : "");
    return `<div class="nlr-plan-item ${m.cls}">
      <div class="nlr-plan-name">${escapeHtml(a.action)}</div>
      <div class="nlr-plan-state"><span class="nlr-plan-badge">${m.label}</span>${when ? `<span class="nlr-plan-when">${escapeHtml(when)}</span>` : ""}</div>
    </div>`;
  }).join("");
}

function nlrActivityHtml(r) {
  const row = (label, n) => `<div class="nlr-act-row"><span>${label}</span><strong>${n}</strong></div>`;
  return `<div class="nlr-act">
    ${row("Follow-ups", r.followUpCount)}${row("Tasks", r.taskCount)}${row("Offers sent", r.offersSent)}
    ${r.lastActivity ? `<div class="nlr-act-last">Last activity: ${escapeHtml(formatOrdinalDate(r.lastActivity))}</div>` : ""}
  </div>`;
}

function nlrContactName(v) {
  const t = (v || "").trim();
  return (!t || /^tbd$/i.test(t)) ? "" : t;
}

function nlrRenderReport(data, f) {
  const t = data.totals;
  const filtering = `<div class="nlr-filtering">Filtering for → ${escapeHtml(nlrFilterText(f))}</div>`;
  if (!data.rows.length) {
    return filtering + `<div style="color:var(--warn); font-weight:700; padding:10px 0;">No leads found for these filters.</div>`;
  }
  const engChips = t.byEngineer.map(e =>
    `<span class="nlr-eng-chip"><span>${escapeHtml(e.name)}</span><strong>${e.count}</strong></span>`).join("");
  const strip = `
    <div class="nlr-strip">
      <div class="nlr-stat">
        <div class="nlr-stat-label">New leads, ${escapeHtml(nlrRangeText(f))}</div>
        <div class="nlr-stat-value">${t.leads}</div>
      </div>
      <div class="nlr-stat nlr-stat-warn">
        <div class="nlr-stat-label">No Action Plan</div>
        <div class="nlr-stat-value">${t.actionPlanPending}</div>
      </div>
      <div class="nlr-stat nlr-stat-eng">
        <div class="nlr-stat-label">ABPS Engineer</div>
        <div class="nlr-eng-chips">${engChips}</div>
      </div>
      <button type="button" class="nlr-download" id="nlr-download-btn" onclick="downloadNewLeadsReport()">Download Excel</button>
    </div>`;
  const rows = data.rows.map(r => {
    const contact = nlrContactName(r.contactPerson);
    const id = escapeHtml(r.leadId);
    return `
    <tr class="nlr-row" id="nlr-row-${id}" onclick="nlrToggleLead(${jsArg(r.leadId)})" title="Click to open this lead">
      <td>${escapeHtml(formatOrdinalDate(r.createdDate))}</td>
      <td><span class="nlr-status">${escapeHtml(r.status)}</span></td>
      <td><strong>${escapeHtml(r.companyName)}</strong>${r.city || r.state ? `<div class="nlr-sub">${escapeHtml([r.city, r.state].filter(Boolean).join(", "))}</div>` : ""}</td>
      <td>${contact ? escapeHtml(contact) : '<span class="nlr-none">None</span>'}${contact && r.position ? `<div class="nlr-sub">${escapeHtml(r.position)}</div>` : ""}${contact && r.phone ? `<div class="nlr-sub">${escapeHtml(r.phone)}</div>` : ""}</td>
      <td>${escapeHtml(r.engineerName) || '<span class="nlr-none">None</span>'}</td>
      <td>${nlrPlanHtml(r.actionPlan)}</td>
      <td>${nlrActivityHtml(r)}</td>
      <td class="nlr-summary">${escapeHtml(r.summary) || '<span class="nlr-none">No details entered</span>'}</td>
      <td class="nlr-exp"><span id="nlr-exp-${id}">▾</span></td>
    </tr>
    <tr id="nlr-lead-row-${id}" style="display:none;"><td colspan="9" class="nlr-lead-cell"><div id="nlr-lead-box-${id}"></div></td></tr>`;
  }).join("");
  return filtering + strip + `
    <div style="overflow-x:auto;">
      <table class="nlr-table">
        <colgroup><col style="width:9%"><col style="width:8%"><col style="width:13%"><col style="width:11%"><col style="width:9%"><col style="width:17%"><col style="width:11%"><col style="width:19%"><col style="width:3%"></colgroup>
        <thead><tr>
          <th>Created Date</th><th>Status</th><th>Company Name</th><th>Contact Person</th>
          <th>ABPS Engineer</th><th>Action Plan</th><th>Activity</th><th>Summary</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Opens the lead's full View Details right under its row. The row itself is
// the header, so the lead card's own header is hidden (its Merge / Delete
// buttons are kept, at the top of the opened area).
async function nlrToggleLead(leadId) {
  const row = document.getElementById(`nlr-lead-row-${leadId}`);
  const box = document.getElementById(`nlr-lead-box-${leadId}`);
  if (!row || !box) return;
  const wasOpen = row.style.display !== "none";
  document.querySelectorAll('[id^="nlr-lead-row-"]').forEach(el => { el.style.display = "none"; });
  document.querySelectorAll('[id^="nlr-lead-box-"]').forEach(el => { el.innerHTML = ""; });
  document.querySelectorAll('[id^="nlr-exp-"]').forEach(el => { el.textContent = "▾"; });
  document.querySelectorAll('.nlr-row.open').forEach(el => el.classList.remove("open"));
  if (wasOpen) return;
  row.style.display = "";
  document.getElementById(`nlr-row-${leadId}`)?.classList.add("open");
  const exp = document.getElementById(`nlr-exp-${leadId}`);
  if (exp) exp.textContent = "▴";
  box.innerHTML = `<div style="color:var(--muted); padding:10px;">Loading lead...</div>`;
  try {
    const data = await apFetch({ action: "fetchLeadCardById", leadId });
    if (!data.success || !data.leads?.length) { box.innerHTML = `<div style="color:var(--warn); font-weight:700; padding:10px;">Lead not found.</div>`; return; }
    globalFollowUpsCacheMap = data.followups;
    globalTasksCacheMap = data.tasks;
    // Lead cards use fixed element ids; clear the Lead Cards results first.
    const mc = document.getElementById("multi-contact-records-container");
    if (mc) mc.innerHTML = "";
    box.innerHTML = `<div id="nlr-lead-cards-${escapeHtml(leadId)}"></div>`;
    buildMultiContactDirectoryInterface(data.leads, "", `nlr-lead-cards-${leadId}`);
    const lead = data.leads[0];
    const ref = lead["Lead ID"];
    const wrapper = document.getElementById(`contact-parent-wrapper-${ref}`);
    const header = wrapper?.querySelector(".contact-summary-header-row");
    if (header) {
      const actions = header.querySelector(".directory-btn-actions-block");
      document.getElementById(`expand-trigger-${ref}`)?.remove();
      header.style.display = "none";
      if (actions && actions.children.length) {
        actions.style.justifyContent = "flex-end";
        actions.style.marginBottom = "8px";
        wrapper.insertBefore(actions, header);
      }
    }
    toggleContactExpansionView(ref, encodeURIComponent(JSON.stringify(lead)));
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") box.innerHTML = `<div style="color:var(--warn); font-weight:700; padding:10px;">${escapeHtml(e.message)}</div>`;
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
