// accounts/voucher-search.js — "Search Vouchers" toggle (renamed from
// "Search Tour Expense Vouchers" 25 Aug 2026).
// Read-only: filters + two balance-bucket lists + a Checked-only total.
// Has its own inner Expense/Advance toggle — same filters (Employee,
// Department, Date range, Place) apply to both, but Purpose/Type/Status
// only make sense for Expense Vouchers (accounts.tour_vouchers), not a
// plain Advance payment record (accounts.tour_advances).

let tvsSearchMode = "expense"; // "expense" | "advance"
let tvsCachedCompanies = [];
let tvsCachedEmployees = [];
let tvsSelectedEmployeeId = null;
let tvsSelectedEmployeeName = "";

// Employee Name filter — same clipped-dropdown-safe typeahead pattern as
// advance-vouchers.js's Employee Name field (CLAUDE.md's "Clipped-dropdown
// fix pattern"), replacing the old plain <select> (30 Aug 2026).
function tvsHandleEmployeeSearch(query) {
  const dd = document.getElementById("tvs-emp-dropdown");
  tvsSelectedEmployeeId = null;
  tvsSelectedEmployeeName = query;
  const q = (query || "").trim().toLowerCase();
  if (!q) { dd.style.display = "none"; return; }
  const matches = tvsCachedEmployees.filter(e => e.employeeName.toLowerCase().includes(q)).slice(0, 15);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(e => `
    <div onmousedown="event.preventDefault(); tvsSelectEmployee(${e.employeeId})"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${escapeHtml(e.employeeName)} <span style="color:var(--muted); font-size:0.75rem;">${e.empCode ? '· ' + escapeHtml(e.empCode) : ''}</span>
    </div>`).join("");
  const input = document.getElementById("tvs-f-employee");
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + "px"; dd.style.left = rect.left + "px"; dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function tvsSelectEmployee(employeeId) {
  const emp = tvsCachedEmployees.find(e => e.employeeId === employeeId);
  if (!emp) return;
  tvsSelectedEmployeeId = employeeId;
  tvsSelectedEmployeeName = emp.employeeName;
  document.getElementById("tvs-f-employee").value = emp.employeeName;
  document.getElementById("tvs-emp-dropdown").style.display = "none";
}

function tvsClearEmployeeFilter() {
  tvsSelectedEmployeeId = null;
  tvsSelectedEmployeeName = "";
  const input = document.getElementById("tvs-f-employee");
  if (input) input.value = "";
}

// Same typeahead pattern as advance-vouchers.js's Company of Visit field,
// minus the "add new" branch — this is a search filter, not data entry,
// so only existing companies are ever offered.
function tvsHandlePlaceSearch(query) {
  const dd = document.getElementById("tvs-place-dropdown");
  const q = (query || "").trim().toLowerCase();
  if (!q) { dd.style.display = "none"; return; }
  const matches = tvsCachedCompanies.filter(c => c.companyName.toLowerCase().includes(q)).slice(0, 15);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(c => `
    <div onmousedown="event.preventDefault(); tvsSelectPlace('${c.companyName.replace(/'/g, "\\'")}')"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${escapeHtml(c.companyName)}</div>`).join("");
  const input = document.getElementById("tvs-f-place");
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + "px"; dd.style.left = rect.left + "px"; dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function tvsSelectPlace(companyName) {
  document.getElementById("tvs-f-place").value = companyName;
  document.getElementById("tvs-place-dropdown").style.display = "none";
}

document.addEventListener("click", (e) => {
  const dd = document.getElementById("tvs-place-dropdown");
  if (dd && !e.target.closest("#tvs-place-dropdown") && e.target.id !== "tvs-f-place") dd.style.display = "none";
  const empDd = document.getElementById("tvs-emp-dropdown");
  if (empDd && !e.target.closest("#tvs-emp-dropdown") && e.target.id !== "tvs-f-employee") empDd.style.display = "none";
});

async function initializeVoucherSearchPanel() {
  tvsSearchMode = "expense";
  tvsSelectedEmployeeId = null;
  tvsSelectedEmployeeName = "";
  const panel = document.getElementById("te-panel-search");
  panel.innerHTML = `
    <div id="tvs-balance-buckets" style="display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap;"></div>

    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <button class="nav-btn-styled" id="tvs-mode-expense" onclick="tvsSetSearchMode('expense')" style="padding:8px 16px;">Expense Vouchers</button>
      <button class="nav-btn-styled" id="tvs-mode-advance" onclick="tvsSetSearchMode('advance')" style="padding:8px 16px; background:#e2e8f0; color:#334155;">Advance Vouchers</button>
    </div>

    <div style="background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
      <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:end;">
        <div style="position:relative;"><label class="field-label">Employee</label>
          <input type="text" id="tvs-f-employee" placeholder="All (type to search)" autocomplete="off"
            style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:160px;"
            oninput="tvsHandleEmployeeSearch(this.value)">
          <div id="tvs-emp-dropdown" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div></div>
        <div><label class="field-label">Department</label>
          <select id="tvs-f-dept" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;"><option value="">All</option></select></div>
        <div id="tvs-expense-only-filters" style="display:contents;">
          <div><label class="field-label">Purpose of Visit</label>
            <select id="tvs-f-purpose" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;">
              <option value="">All</option>${TOUR_PURPOSES.map(p => `<option value="${p}">${p}</option>`).join("")}</select></div>
          <div><label class="field-label">Type</label>
            <select id="tvs-f-type" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;">
              <option value="">All</option>${TOUR_EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}</select></div>
          <div><label class="field-label">Status</label>
            <select id="tvs-f-status" style="padding:8px; border:1px solid var(--border); border-radius:6px;">
              <option value="">All</option><option value="Unchecked">Unchecked</option><option value="Checked">Checked</option></select></div>
        </div>
        <div id="tvs-advance-only-filters" style="display:none;">
          <div><label class="field-label">Purpose of Visit</label>
            <select id="tvs-f-adv-purpose" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;">
              <option value="">All</option>${TOUR_PURPOSES.map(p => `<option value="${p}">${p}</option>`).join("")}</select></div>
        </div>
        <div style="position:relative;"><label class="field-label">Place of Visit</label>
          <input type="text" id="tvs-f-place" placeholder="Type to search..." autocomplete="off"
            style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;"
            oninput="tvsHandlePlaceSearch(this.value)">
          <div id="tvs-place-dropdown" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div></div>
        <div><label class="field-label">Date From</label>
          <input type="date" id="tvs-f-from" style="padding:8px; border:1px solid var(--border); border-radius:6px;"></div>
        <div><label class="field-label">Date To</label>
          <input type="date" id="tvs-f-to" style="padding:8px; border:1px solid var(--border); border-radius:6px;"></div>
        <button class="nav-btn-styled" style="margin-left:auto;" onclick="runTourVoucherSearch()">Search</button>
      </div>
    </div>

    <div id="tvs-search-label" style="display:none; font-weight:700; color:var(--brand); margin-bottom:10px; font-size:0.9rem; line-height:1.7;"></div>
    <div id="tvs-total" style="font-weight:700; margin-bottom:14px;"></div>
    <div id="tvs-results"></div>`;

  try {
    const [empData, deptData, companyData] = await Promise.all([
      acFetch("searchTourEmployees", {}), acFetch("listTourDepartments", {}), acFetch("listTourCompanies", {}),
    ]);
    tvsCachedEmployees = empData.success ? empData.employees : [];
    if (deptData.success) {
      document.getElementById("tvs-f-dept").innerHTML += deptData.departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
    }
    tvsCachedCompanies = companyData.success ? companyData.companies : [];
  } catch (e) { console.error("Search filter bootstrap failed:", e.message); }

  enhanceAllDateInputsForDMY();
  runTourVoucherSearch();
}

function tvsSetSearchMode(mode) {
  tvsSearchMode = mode;
  document.getElementById("tvs-mode-expense").style.background = mode === "expense" ? "var(--brand)" : "#e2e8f0";
  document.getElementById("tvs-mode-expense").style.color = mode === "expense" ? "#fff" : "#334155";
  document.getElementById("tvs-mode-advance").style.background = mode === "advance" ? "var(--brand)" : "#e2e8f0";
  document.getElementById("tvs-mode-advance").style.color = mode === "advance" ? "#fff" : "#334155";
  document.getElementById("tvs-expense-only-filters").style.display = mode === "expense" ? "contents" : "none";
  document.getElementById("tvs-advance-only-filters").style.display = mode === "advance" ? "contents" : "none";
  runTourVoucherSearch();
}

function tvsBuildSearchLabel() {
  const esc = (s) => (s || "").toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const val = (s) => `<span style="color:var(--brand);">${esc(s || 'All')}</span>`;
  const employeeLabel = tvsSelectedEmployeeId ? tvsSelectedEmployeeName : "All";
  const deptLabel = document.getElementById("tvs-f-dept").value || "All";
  const from = document.getElementById("tvs-f-from").value;
  const to = document.getElementById("tvs-f-to").value;
  const dateRangeLabel = (from || to) ? `${from ? formatDateDMY(from) : '…'} to ${to ? formatDateDMY(to) : '…'}` : "All";
  let html = `<span style="color:#000;">Searching for</span>` +
    `<br><span style="color:#000;">Mode:</span> ${val(tvsSearchMode === "expense" ? "Expense Vouchers" : "Advance Vouchers")}`;
  if (tvsSearchMode === "expense") {
    const purposeLabel = document.getElementById("tvs-f-purpose").value || "All";
    const typeLabel = document.getElementById("tvs-f-type").value || "All";
    const statusLabel = document.getElementById("tvs-f-status").value || "All";
    const placeLabel = document.getElementById("tvs-f-place").value || "All";
    html += `<br><span style="color:#000;">Employee:</span> ${val(employeeLabel)} &nbsp; <span style="color:#000;">Department:</span> ${val(deptLabel)}` +
      `<br><span style="color:#000;">Purpose:</span> ${val(purposeLabel)} &nbsp; <span style="color:#000;">Type:</span> ${val(typeLabel)} &nbsp; <span style="color:#000;">Status:</span> ${val(statusLabel)} &nbsp; <span style="color:#000;">Place:</span> ${val(placeLabel)}`;
  } else {
    const placeLabel = document.getElementById("tvs-f-place").value || "All";
    const advPurposeLabel = document.getElementById("tvs-f-adv-purpose").value || "All";
    html += `<br><span style="color:#000;">Employee:</span> ${val(employeeLabel)} &nbsp; <span style="color:#000;">Department:</span> ${val(deptLabel)} &nbsp; <span style="color:#000;">Place:</span> ${val(placeLabel)} &nbsp; <span style="color:#000;">Purpose:</span> ${val(advPurposeLabel)}`;
  }
  html += `<br><span style="color:#000;">Date Range:</span> ${val(dateRangeLabel)}`;
  return html;
}

async function runTourVoucherSearch() {
  const lbl = document.getElementById("tvs-search-label");
  lbl.style.display = "block";
  lbl.innerHTML = tvsBuildSearchLabel();

  const resultsEl = document.getElementById("tvs-results");

  const fromVal = document.getElementById("tvs-f-from").value;
  const toVal = document.getElementById("tvs-f-to").value;
  if (fromVal && toVal && toVal < fromVal) {
    resultsEl.innerHTML = `<p style="color:var(--warn);">Date To can't be before Date From.</p>`;
    document.getElementById("tvs-total").textContent = "";
    return;
  }

  resultsEl.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Searching...</div>`;

  // Balance buckets are global (not affected by filters) — refreshed on
  // every search regardless of mode, same as before.
  try {
    const filters = {
      employeeId: tvsSelectedEmployeeId || null,
      departmentName: document.getElementById("tvs-f-dept").value || null,
      placeOfVisit: document.getElementById("tvs-f-place").value || null,
      dateFrom: document.getElementById("tvs-f-from").value || null,
      dateTo: document.getElementById("tvs-f-to").value || null,
    };

    if (tvsSearchMode === "advance") {
      const advanceFilters = {
        ...filters,
        purposeOfVisit: document.getElementById("tvs-f-adv-purpose").value || null,
      };
      const data = await acFetch("searchTourAdvances", advanceFilters);
      if (!data.success) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
      document.getElementById("tvs-balance-buckets").innerHTML = "";
      document.getElementById("tvs-total").textContent = `Total Advance Amount: ${formatINRComma(data.totalAmount)}`;
      if (data.advances.length === 0) {
        resultsEl.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No advances match this filter.</div>`;
        return;
      }
      resultsEl.innerHTML = data.advances.map(a => tvsRenderAdvanceCard(a)).join("");
      await tvsRefreshBalanceBuckets();
      return;
    }

    const expenseFilters = {
      ...filters,
      purposeOfVisit: document.getElementById("tvs-f-purpose").value || null,
      expenseType: document.getElementById("tvs-f-type").value || null,
      status: document.getElementById("tvs-f-status").value || null,
    };
    const data = await acFetch("searchTourVouchers", expenseFilters);
    if (!data.success) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }

    document.getElementById("tvs-balance-buckets").innerHTML = `
      ${tvsRenderBucket("Balance over ₹10,000", data.employeesOver10k, "#b91c1c")}
      ${tvsRenderBucket("Balance -₹10,000 or under", data.employeesUnder10k, "#15803d")}`;

    document.getElementById("tvs-total").textContent = `Total Voucher Amount (Checked, Actual): ${formatINRComma(data.totalCheckedActual)}`;

    if (data.vouchers.length === 0) {
      resultsEl.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No vouchers match this filter.</div>`;
      return;
    }
    resultsEl.innerHTML = data.vouchers.map(v => tvsRenderCard(v)).join("");
  } catch (e) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

// Advance mode doesn't call searchTourVouchers (which is what normally
// refreshes the buckets) — refetch them directly so the buckets stay
// populated no matter which mode is active.
async function tvsRefreshBalanceBuckets() {
  try {
    const data = await acFetch("searchTourVouchers", {});
    if (!data.success) return;
    document.getElementById("tvs-balance-buckets").innerHTML = `
      ${tvsRenderBucket("Balance over ₹10,000", data.employeesOver10k, "#b91c1c")}
      ${tvsRenderBucket("Balance -₹10,000 or under", data.employeesUnder10k, "#15803d")}`;
  } catch (e) { /* non-fatal — buckets just stay empty */ }
}

function tvsRenderBucket(title, employees, color) {
  const rows = employees.length
    ? employees.map(e => `<div style="display:flex; justify-content:space-between; padding:5px 0; font-size:0.88rem;">
        <span>${escapeHtml(e.employeeName)}</span><span style="font-weight:700; font-size:1.05rem; color:${color};">${formatINRComma(e.balance)}</span></div>`).join("")
    : `<div style="color:var(--muted); font-size:0.8rem;">None.</div>`;
  return `<div style="flex:1; min-width:220px; background:var(--highlight-bg); padding:12px 14px; border-radius:var(--radius);">
    <div style="font-weight:700; margin-bottom:6px; font-size:0.85rem;">${title}</div>${rows}</div>`;
}

function tvsRenderAdvanceCard(a) {
  return `
    <div class="contact-summary-card-parent">
      <div class="contact-summary-title-info" style="width:100%;">
        <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <span style="font-weight:700;">${escapeHtml(a.employeeName)}</span>
            <span style="color:var(--muted); font-size:0.8rem; margin-left:6px;">${escapeHtml(a.departmentName || '—')}</span>
          </div>
          <span style="background:var(--brand); color:#fff; font-weight:700; font-size:0.85rem; padding:3px 10px; border-radius:3px;">${formatINRComma(a.amount)}</span>
        </div>
        <div style="font-size:0.85rem; color:var(--muted); margin-top:6px;">
          ${escapeHtml(a.placeOfVisit || '—')}${a.purposeOfVisit ? ' · ' + escapeHtml(a.purposeOfVisit) : ''} ·
          Start ${formatDateDMY(a.startDate)}${a.estimatedDays ? ` · ${a.estimatedDays} day(s)` : ''} ·
          Paid ${formatDateDMY(a.paidDate)}${a.createdBy ? ' by ' + escapeHtml(a.createdBy) : ''}
        </div>
        ${a.remarks ? `<div style="font-size:0.8rem; color:var(--muted); margin-top:4px;">Remarks: ${escapeHtml(a.remarks)}</div>` : ''}
      </div>
    </div>`;
}

function tvsRenderCard(v) {
  const lines = v.lines || [];
  const rows = lines.map(l => {
    const bills = (l.bills && l.bills.length > 0) ? l.bills : (l.billUrl ? [{ fileName: l.billFileName, url: l.billUrl }] : []);
    const billCell = bills.length > 0
      ? bills.map(b => `<a href="${driveLink(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.fileName || 'View')}</a>`).join("<br>")
      : l.noBillReason ? `<span style="font-style:italic;">Reason: ${escapeHtml(l.noBillReason)}</span>` : "—";
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px;">${l.srNo}</td><td style="padding:6px;">${formatDateDMY(l.expenseDate)}</td>
      <td style="padding:6px;">${escapeHtml(l.expenseType)}${l.conveyanceMode ? ' (' + escapeHtml(l.conveyanceMode) + ')' : ''}</td>
      <td style="padding:6px; text-align:right;">${formatINRComma(l.amount)}</td>
      <td style="padding:6px; color:var(--muted);">${l.description ? escapeHtml(l.description) : '—'}</td>
      <td style="padding:6px; text-align:right;">${l.actualAmount !== null && l.actualAmount !== undefined ? formatINRComma(l.actualAmount) : '—'}</td>
      <td style="padding:6px;">${billCell}</td>
    </tr>`;
  }).join("");
  const statusColor = v.status === 'Checked' ? '#15803d' : '#b45309';
  // Claimed/Actual summary sums straight off `lines` rather than
  // v.totalAmount/v.totalActualAmount — when a Type filter is active the
  // backend already trims `lines` down to just the matching type, so this
  // keeps the card header consistent with what the expanded table shows
  // (a mixed-type voucher's header no longer says "Claimed 50,000" while
  // the table underneath only lists a 10,000 Travel line).
  const cardClaimed = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const anyActualSet = lines.some(l => l.actualAmount !== null && l.actualAmount !== undefined);
  const cardActual = lines.reduce((s, l) => s + (Number(l.actualAmount) || 0), 0);
  // Actual Amount is editable only once a voucher is Checked (total_actual_amount
  // exists) — Search's reviseTourVoucherActualAmount route only accepts a
  // Checked voucher, same guard as the backend. Simple prompt()-based edit,
  // consistent with this codebase's existing lightweight inline-edit style.
  const editActualBtn = v.status === 'Checked'
    ? `<button class="nav-btn-styled" style="padding:2px 8px; font-size:0.72rem; margin-left:8px;" onclick="event.stopPropagation(); tvsEditActual(${v.voucherId}, ${Number(v.totalActualAmount) || 0})">Edit Actual</button>`
    : '';
  const pdfLine = v.pdfUrl
    ? `<div style="font-size:0.78rem; margin-top:4px;">Voucher PDF (v${v.pdfVersion || 1}): <a href="${driveLink(v.pdfUrl)}" target="_blank" rel="noopener">Download</a></div>` : '';
  return `
    <div class="contact-summary-card-parent">
      <div class="contact-summary-header-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='block'?'none':'block'" style="cursor:pointer; width:100%;">
        <div class="contact-summary-title-info" style="width:100%;">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <span style="background:var(--brand); color:#fff; padding:3px 8px; font-weight:700;">${escapeHtml(v.voucherNumber)}</span>
              <span style="margin-left:8px; font-weight:700;">${escapeHtml(v.employeeName)}</span>
            </div>
            <span style="background:${statusColor}; color:#fff; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:3px;">${v.status}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--muted); margin-top:6px;">
            ${escapeHtml(v.departmentName || '—')} · ${escapeHtml(v.purposeOfVisit)} · ${escapeHtml(v.placeOfVisit)} ·
            ${formatDateDMY(v.visitStartDate)}–${formatDateDMY(v.visitEndDate)} ·
            Claimed ${formatINRComma(cardClaimed)}${anyActualSet ? ' · Actual ' + formatINRComma(cardActual) : ''}${editActualBtn}
          </div>
          ${pdfLine}
        </div>
      </div>
      <div style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:10px; overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
          <thead><tr style="background:var(--highlight-bg); text-align:left;">
            <th style="padding:6px;">Sr No</th><th style="padding:6px;">Date</th><th style="padding:6px;">Type</th>
            <th style="padding:6px; text-align:right;">Amount</th><th style="padding:6px;">Description</th><th style="padding:6px; text-align:right;">Actual</th><th style="padding:6px;">Bill</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// Voucher-level Actual Amount correction (Search Vouchers, 30 Aug 2026) —
// prompt()-based, matches this codebase's "simple modal/prompt is fine
// for inline-editable table cells" convention. Calls
// reviseTourVoucherActualAmount, which re-applies the balance delta and
// regenerates the voucher PDF at the next version.
async function tvsEditActual(voucherId, currentActual) {
  const input = prompt("New Actual Amount for this voucher:", trimNum(currentActual));
  if (input === null) return;
  const newActualAmount = Number(input);
  if (isNaN(newActualAmount) || newActualAmount < 0) return alert("Enter a valid non-negative amount.");

  showBlockingOverlay("Revising Actual Amount...");
  try {
    const data = await acFetch("reviseTourVoucherActualAmount", { voucherId, newActualAmount });
    hideBlockingOverlay();
    if (!data.success) return alert(data.error);
    alert(`Revised. ${data.employeeName ? data.employeeName + "'s n" : "N"}ew balance: ${formatINRComma(data.newBalance)}.` +
      (data.pdfUrl ? ` Updated voucher PDF (v${data.pdfVersion}) is ready.` : ''));
    runTourVoucherSearch();
  } catch (e) { hideBlockingOverlay(); alert("Network error: " + e.message); }
}
