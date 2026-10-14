// marketing/morning-meeting.js — Morning Meeting Discussion (15 Oct 2026).
// Every lead created in the period with the date of each step, per-employee
// funnel counts (click a count to filter the table), overdue steps in red,
// days in the current stage and rows changed since the last meeting.
// Backend: lib/morningMeeting.js (route fetchMorningMeeting).

const MM_STATUSES = ["New Lead", "Technical Discussion", "Inquire Received", "Offer Sent", "Order Received",
  "Order Dispatched", "Product Commissioned", "Order not Received"];

const MM_COUNTS = [
  { key: "leads", label: "Leads" },
  { key: "profileNotSent", label: "Company Profile not Sent" },
  { key: "visitNotDone", label: "Visit not Done" },
  { key: "enquiryNotReceived", label: "Enquiry not Received" },
  { key: "offerNotSent", label: "Offer not Sent" },
  { key: "orderNotClosed", label: "Order not Closed" },
  { key: "orderClosed", label: "Order Closed" },
  { key: "orderLost", label: "Order Lost" },
];

// Mirrors FUNNEL_TESTS in lib/morningMeeting.js.
const MM_TESTS = {
  leads: () => true,
  profileNotSent: r => !r.profileDate,
  visitNotDone: r => !r.visitedDate,
  enquiryNotReceived: r => !r.enquiryDate,
  offerNotSent: r => !r.firstOfferDate,
  orderNotClosed: r => r.firstOfferDate && !r.orderDate && r.status !== "Order not Received",
  orderClosed: r => !!r.orderDate,
  orderLost: r => r.status === "Order not Received",
};

let mmData = null;
let mmCellFilter = null; // { engineerKey|null, countKey }
let mmRunTimer = null;

// Every filter change reloads the table (no Show button).
function mmScheduleRun() {
  clearTimeout(mmRunTimer);
  mmRunTimer = setTimeout(runMorningMeeting, 350);
}

function mmInit() {
  const eng = document.getElementById("mm-eng-pills");
  if (eng) {
    eng.innerHTML = (cachedEngineers || []).map(e => {
      const id = "mm_eng_" + e.personKey.replace(/[^a-zA-Z0-9]/g, "_");
      return `<input type="checkbox" name="mmEngineerFilter" value="${escapeHtml(e.personKey)}" id="${id}" onchange="mmScheduleRun()"><label for="${id}">${escapeHtml(e.name)}</label>`;
    }).join("");
  }
  const st = document.getElementById("mm-status-pills");
  if (st) {
    st.innerHTML = MM_STATUSES.map((s, i) =>
      `<input type="checkbox" name="mmStatusFilter" value="${escapeHtml(s)}" id="mm_st_${i}" onchange="mmScheduleRun()"><label for="mm_st_${i}">${escapeHtml(s)}</label>`).join("");
  }
  mmQuickRange("month");
}

function mmQuickRange(kind) {
  const fromEl = document.getElementById("mm-from"), toEl = document.getElementById("mm-to");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const d = new Date(today + "T00:00:00Z");
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  let from = today, to = today;
  if (kind === "all") { from = ""; to = ""; }
  else if (kind === "yesterday") { from = to = new Date(d.getTime() - 86400000).toISOString().slice(0, 10); }
  else if (kind === "week") { const dow = d.getUTCDay(); from = new Date(d.getTime() - (dow === 0 ? 6 : dow - 1) * 86400000).toISOString().slice(0, 10); }
  else if (kind === "month") { from = today.slice(0, 8) + "01"; }
  else if (kind === "quarter") { from = today.slice(0, 5) + String(m - ((m - 1) % 3)).padStart(2, "0") + "-01"; }
  else if (kind === "year") { from = (m >= 4 ? y : y - 1) + "-04-01"; } // financial year
  fromEl.value = from; toEl.value = to;
  [fromEl, toEl].forEach(el => el.dispatchEvent(new Event("input", { bubbles: true })));
  document.querySelectorAll(".mm-quick-btn").forEach(b => b.classList.toggle("active", b.dataset.range === kind));
  mmScheduleRun();
}

function mmDateChanged() {
  document.querySelectorAll(".mm-quick-btn").forEach(b => b.classList.remove("active"));
  const f = mmReadFilters();
  if (f.startDate && f.endDate) mmScheduleRun();
}

function mmReadFilters() {
  return {
    startDate: document.getElementById("mm-from").value,
    endDate: document.getElementById("mm-to").value,
    engineers: Array.from(document.querySelectorAll('input[name="mmEngineerFilter"]:checked')).map(i => i.value),
    statuses: Array.from(document.querySelectorAll('input[name="mmStatusFilter"]:checked')).map(i => i.value),
  };
}

async function runMorningMeeting() {
  const f = mmReadFilters();
  if ((f.startDate && !f.endDate) || (!f.startDate && f.endDate)) return;
  const out = document.getElementById("mm-output");
  out.innerHTML = `<div style="color:var(--muted); padding:10px 0;">Loading leads...</div>`;
  try {
    const data = await apFetch({ action: "fetchMorningMeeting", ...f });
    if (!data.success) { out.innerHTML = `<div style="color:var(--warn); font-weight:700;">${escapeHtml(data.error || "Could not load.")}</div>`; return; }
    mmData = data; mmCellFilter = null;
    mmRender();
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") out.innerHTML = `<div style="color:var(--warn); font-weight:700;">${escapeHtml(e.message)}</div>`;
  }
}

function mmSetCellFilter(engineerKey, countKey) {
  const same = mmCellFilter && mmCellFilter.engineerKey === engineerKey && mmCellFilter.countKey === countKey;
  mmCellFilter = same ? null : { engineerKey, countKey };
  mmRender();
}

function mmRangeText() {
  const f = mmReadFilters();
  if (!f.startDate) return "All time";
  if (f.startDate === f.endDate) return formatOrdinalDate(f.startDate);
  return formatOrdinalDate(f.startDate) + " to " + formatOrdinalDate(f.endDate);
}

function mmCountsTableHtml(data) {
  const cell = (engKey, c, n) => {
    const active = mmCellFilter && mmCellFilter.engineerKey === engKey && mmCellFilter.countKey === c.key;
    const bad = ["profileNotSent", "visitNotDone", "enquiryNotReceived", "offerNotSent", "orderNotClosed", "orderLost"].includes(c.key);
    return `<td class="mm-count${active ? " mm-count-active" : ""}${bad && n ? " mm-count-bad" : ""}${c.key === "orderClosed" && n ? " mm-count-good" : ""}"
      onclick="mmSetCellFilter(${jsArg(engKey)}, ${jsArg(c.key)})" title="Show these leads">${n}</td>`;
  };
  const rows = data.byEngineer.map(e => `<tr><th class="mm-eng-name">${escapeHtml(e.name)}</th>${MM_COUNTS.map(c => cell(e.engineerKey, c, e[c.key])).join("")}</tr>`).join("");
  const total = `<tr class="mm-total"><th>Total</th>${MM_COUNTS.map(c => cell("__ALL__", c, data.totals[c.key])).join("")}</tr>`;
  return `<div style="overflow-x:auto; margin:12px 0 16px;">
    <table class="nlr-table mm-counts">
      <thead><tr><th>ABPS Engineer</th>${MM_COUNTS.map(c => `<th class="nlr-center">${c.label}</th>`).join("")}</tr></thead>
      <tbody>${rows}${total}</tbody>
    </table></div>`;
}

const MM_STEP_LABELS = [
  ["profileDate", "Company profile"], ["talkedDate", "Talked"], ["visitedDate", "Visited"],
  ["enquiryDate", "Enquiry"], ["firstOfferDate", "1st offer"], ["orderDate", "Order"],
];

function mmProgressHtml(r) {
  return '<div class="mm-steps">' + MM_STEP_LABELS.map(([k, label]) => {
    const late = !r[k] && (r.overdue || []).includes(k);
    const val = r[k] ? escapeHtml(formatOrdinalDate(r[k])) : (late ? "Overdue" : "-");
    return `<div class="mm-step${r[k] ? " mm-step-done" : ""}${late ? " mm-step-late" : ""}"><span>${label}</span><strong>${val}</strong></div>`;
  }).join("") + "</div>";
}

function mmDateCell(r, key) {
  if (r[key]) return `<td class="mm-date">${escapeHtml(formatOrdinalDate(r[key]))}</td>`;
  if ((r.overdue || []).includes(key)) return `<td class="mm-date mm-overdue">Overdue</td>`;
  return `<td class="mm-date mm-blank">-</td>`;
}

function mmRender() {
  const out = document.getElementById("mm-output");
  const data = mmData;
  if (!data) return;
  let rows = data.rows;
  if (mmCellFilter) {
    const test = MM_TESTS[mmCellFilter.countKey];
    rows = rows.filter(r => (mmCellFilter.engineerKey === "__ALL__" || r.engineerKey === mmCellFilter.engineerKey) && test(r));
  }
  const changed = data.rows.filter(r => r.changedSinceLastMeeting).length;
  const filterNote = mmCellFilter
    ? `<div class="nlr-filtering">Showing: ${escapeHtml(MM_COUNTS.find(c => c.key === mmCellFilter.countKey).label)}${mmCellFilter.engineerKey !== "__ALL__"
        ? " · " + escapeHtml((data.byEngineer.find(e => e.engineerKey === mmCellFilter.engineerKey) || {}).name || "") : ""} (${rows.length})
        <button type="button" class="mm-clear" onclick="mmSetCellFilter(${jsArg(mmCellFilter.engineerKey)}, ${jsArg(mmCellFilter.countKey)})">Show all</button></div>`
    : "";
  const body = rows.map((r, i) => { const id = escapeHtml(r.leadId); return `
    <tr class="nlr-row${r.changedSinceLastMeeting ? " mm-changed" : ""}${r.orderDate ? " mm-ordered" : ""}" id="mm-row-${id}">
      <td style="text-align:center;"><button type="button" class="nlr-exp-btn" id="mm-exp-${id}" title="Open / close this lead" onclick="nlrToggleLead(${jsArg(r.leadId)}, 'mm')">${i + 1} ▾</button>${r.changedSinceLastMeeting ? '<div class="mm-new" title="Changed since the last meeting">NEW</div>' : ""}</td>
      <td style="text-align:center;"><span class="nlr-status">${escapeHtml(r.status)}</span><div class="nlr-sub">Created ${escapeHtml(formatOrdinalDate(r.createdDate))}</div></td>
      <td>${escapeHtml(r.engineerName) || '<span class="nlr-none">None</span>'}</td>
      <td><strong>${escapeHtml(r.companyName)}</strong>${r.contactPerson && !/^tbd$/i.test(r.contactPerson) ? `<div>${escapeHtml(r.contactPerson)}</div>` : ""}${r.leadName ? `<div class="nlr-sub">${escapeHtml(r.leadName)}</div>` : ""}${r.city || r.state ? `<div class="nlr-sub">${escapeHtml([r.city, r.state].filter(Boolean).join(", "))}</div>` : ""}${r.businessVertical ? `<div class="nlr-sub">${escapeHtml(r.businessVertical)}</div>` : ""}</td>
      <td class="nlr-summary">${escapeHtml(r.summary) || '<span class="nlr-none">No details entered</span>'}</td>
      <td>${mmProgressHtml(r)}</td>
      <td style="text-align:center;"><div style="font-weight:700;">${r.daysInStage} day${r.daysInStage === 1 ? "" : "s"}</div><div class="nlr-sub">${escapeHtml(r.stage)}</div></td>
      <td>${escapeHtml(r.lostReason) || ""}</td>
    </tr>
    <tr id="mm-lead-row-${id}" style="display:none;"><td colspan="8" class="nlr-lead-cell"><div id="mm-lead-box-${id}"></div></td></tr>`; }).join("");
  out.innerHTML = `
    <div class="nlr-filtering">Leads created: ${escapeHtml(mmRangeText())} · Last meeting: ${escapeHtml(formatOrdinalDateTime(data.lastMeeting))} · ${changed} changed since then</div>
    ${mmCountsTableHtml(data)}
    ${filterNote}
    ${rows.length ? `<div style="overflow-x:auto;">
      <table class="nlr-table mm-table">
        <colgroup><col style="width:6%"><col style="width:10%"><col style="width:9%"><col style="width:16%"><col style="width:24%"><col style="width:19%"><col style="width:7%"><col style="width:9%"></colgroup>
        <thead><tr>
          <th class="nlr-center">Sr No</th><th class="nlr-center">Lead Status</th><th>ABPS Engineer</th>
          <th>Customer Name</th><th>Information Summary</th><th>Progress</th>
          <th class="nlr-center">Days in Stage</th><th>Reason for Order Lost</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table></div>` : `<div style="color:var(--warn); font-weight:700; padding:10px 0;">No leads for these filters.</div>`}`;
}
