// accounts/voucher-search.js — "Search Tour Expense Vouchers" toggle.
// Read-only: filters + two balance-bucket lists + a Checked-only total.
// Has its own inner Expense/Advance toggle — same filters (Employee,
// Department, Date range, Place) apply to both, but Purpose/Type/Status
// only make sense for Expense Vouchers (accounts.tour_vouchers), not a
// plain Advance payment record (accounts.tour_advances).

let tvsSearchMode = "expense"; // "expense" | "advance"
let tvsCachedCompanies = [];

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
});

async function initializeVoucherSearchPanel() {
  tvsSearchMode = "expense";
  const panel = document.getElementById("te-panel-search");
  panel.innerHTML = `
    <div id="tvs-balance-buckets" style="display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap;"></div>

    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <button class="nav-btn-styled" id="tvs-mode-expense" onclick="tvsSetSearchMode('expense')" style="padding:8px 16px;">Expense Vouchers</button>
      <button class="nav-btn-styled" id="tvs-mode-advance" onclick="tvsSetSearchMode('advance')" style="padding:8px 16px; background:#e2e8f0; color:#334155;">Advance Vouchers</button>
    </div>

    <div style="background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
      <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:end;">
        <div><label class="field-label">Employee</label>
          <select id="tvs-f-employee" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:160px;"><option value="">All</option></select></div>
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
    if (empData.success) {
      document.getElementById("tvs-f-employee").innerHTML += empData.employees.map(e => `<option value="${e.employeeId}">${escapeHtml(e.employeeName)}</option>`).join("");
    }
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
  runTourVoucherSearch();
}

function tvsBuildSearchLabel() {
  const esc = (s) => (s || "").toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const val = (s) => `<span style="color:var(--brand);">${esc(s || 'All')}</span>`;
  const empSel = document.getElementById("tvs-f-employee");
  const employeeLabel = empSel.value ? empSel.options[empSel.selectedIndex].textContent : "All";
  const deptLabel = document.getElementById("tvs-f-dept").value || "All";
  const from = document.getElementById("tvs-f-from").value;
  const to = document.getElementById("tvs-f-to").value;
  const dateRangeLabel = (from || to) ? `${from ? formatDateDMY(from) : '…'} to ${to ? formatDateDMY(to) : '…'}` : "All";
  let html = `<span style="color:#000;">Searching for</span><br><span style="color:#000;">Mode:</span> ${val(tvsSearchMode === "expense" ? "Expense Vouchers" : "Advance Vouchers")}` +
    `<br><span style="color:#000;">Employee:</span> ${val(employeeLabel)}<br><span style="color:#000;">Department:</span> ${val(deptLabel)}`;
  if (tvsSearchMode === "expense") {
    const purposeLabel = document.getElementById("tvs-f-purpose").value || "All";
    const typeLabel = document.getElementById("tvs-f-type").value || "All";
    const statusLabel = document.getElementById("tvs-f-status").value || "All";
    html += `<br><span style="color:#000;">Purpose:</span> ${val(purposeLabel)}<br><span style="color:#000;">Type:</span> ${val(typeLabel)}<br><span style="color:#000;">Status:</span> ${val(statusLabel)}`;
  }
  const placeLabel = document.getElementById("tvs-f-place").value || "All";
  html += `<br><span style="color:#000;">Place:</span> ${val(placeLabel)}<br><span style="color:#000;">Date Range:</span> ${val(dateRangeLabel)}`;
  return html;
}

async function runTourVoucherSearch() {
  const lbl = document.getElementById("tvs-search-label");
  lbl.style.display = "block";
  lbl.innerHTML = tvsBuildSearchLabel();

  const resultsEl = document.getElementById("tvs-results");
  resultsEl.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Searching...</div>`;

  // Balance buckets are global (not affected by filters) — refreshed on
  // every search regardless of mode, same as before.
  try {
    const filters = {
      employeeId: document.getElementById("tvs-f-employee").value || null,
      departmentName: document.getElementById("tvs-f-dept").value || null,
      placeOfVisit: document.getElementById("tvs-f-place").value || null,
      dateFrom: document.getElementById("tvs-f-from").value || null,
      dateTo: document.getElementById("tvs-f-to").value || null,
    };

    if (tvsSearchMode === "advance") {
      const data = await acFetch("searchTourAdvances", filters);
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
          ${escapeHtml(a.placeOfVisit || '—')} · Start ${formatDateDMY(a.startDate)}${a.estimatedDays ? ` · ${a.estimatedDays} day(s)` : ''} ·
          Paid ${formatDateDMY(a.paidDate)}${a.createdBy ? ' by ' + escapeHtml(a.createdBy) : ''}
        </div>
      </div>
    </div>`;
}

function tvsRenderCard(v) {
  const lines = v.lines || [];
  const rows = lines.map(l => {
    const bills = (l.bills && l.bills.length > 0) ? l.bills : (l.billUrl ? [{ fileName: l.billFileName, url: l.billUrl }] : []);
    const billCell = bills.length > 0
      ? bills.map(b => `<a href="${driveLink(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.fileName || 'View')}</a>`).join("<br>")
      : "—";
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px;">${l.srNo}</td><td style="padding:6px;">${formatDateDMY(l.expenseDate)}</td>
      <td style="padding:6px;">${escapeHtml(l.expenseType)}${l.conveyanceMode ? ' (' + escapeHtml(l.conveyanceMode) + ')' : ''}</td>
      <td style="padding:6px; text-align:right;">${formatINRComma(l.amount)}</td>
      <td style="padding:6px; text-align:right;">${l.actualAmount !== null && l.actualAmount !== undefined ? formatINRComma(l.actualAmount) : '—'}</td>
      <td style="padding:6px;">${billCell}</td>
    </tr>`;
  }).join("");
  const statusColor = v.status === 'Checked' ? '#15803d' : '#b45309';
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
            Claimed ${formatINRComma(v.totalAmount)}${v.totalActualAmount !== null ? ' · Actual ' + formatINRComma(v.totalActualAmount) : ''}
          </div>
        </div>
      </div>
      <div style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:10px; overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
          <thead><tr style="background:var(--highlight-bg); text-align:left;">
            <th style="padding:6px;">Sr No</th><th style="padding:6px;">Date</th><th style="padding:6px;">Type</th>
            <th style="padding:6px; text-align:right;">Amount</th><th style="padding:6px; text-align:right;">Actual</th><th style="padding:6px;">Bill</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
