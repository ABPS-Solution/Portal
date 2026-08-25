// accounts/cash-expense-search.js — "Search Cash Expense Vouchers" toggle.
// Read-only: filters + a Total Voucher Amount for the current filter,
// results as a plain table (there's little enough per-row detail here
// that an expand-to-see-more wrapper was just extra clicks for nothing).

async function initializeCashExpenseSearchPanel() {
  const panel = document.getElementById("ce-panel-search");
  panel.innerHTML = `
    <div style="background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
      <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:end;">
        <div><label class="field-label">Employee</label>
          <select id="ces-f-employee" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:160px;"><option value="">All</option></select></div>
        <div><label class="field-label">Department</label>
          <select id="ces-f-dept" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;"><option value="">All</option></select></div>
        <div><label class="field-label">Type of Expense</label>
          <select id="ces-f-type" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:160px;">
            <option value="">All</option>${CASH_EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}</select></div>
        <div><label class="field-label">Payment Mode</label>
          <select id="ces-f-mode" style="padding:8px; border:1px solid var(--border); border-radius:6px;">
            <option value="">All</option><option value="Cash">Cash</option><option value="UPI">UPI</option></select></div>
        <div><label class="field-label">Date From</label>
          <input type="date" id="ces-f-from" style="padding:8px; border:1px solid var(--border); border-radius:6px;"></div>
        <div><label class="field-label">Date To</label>
          <input type="date" id="ces-f-to" style="padding:8px; border:1px solid var(--border); border-radius:6px;"></div>
        <button class="nav-btn-styled" style="margin-left:auto;" onclick="runCashExpenseSearch()">Search</button>
      </div>
    </div>
    <div id="ces-search-label" style="display:none; font-weight:700; color:var(--brand); margin-bottom:10px; font-size:0.9rem; line-height:1.7;"></div>
    <div id="ces-total" style="font-weight:700; margin-bottom:14px;"></div>
    <div id="ces-results"></div>`;

  try {
    const [empData, deptData] = await Promise.all([acFetch("searchCashExpenseEmployees", {}), acFetch("listCashExpenseDepartments", {})]);
    if (empData.success) {
      document.getElementById("ces-f-employee").innerHTML += empData.employees.map(e => `<option value="${e.employeeId}">${escapeHtml(e.employeeName)}</option>`).join("");
    }
    if (deptData.success) {
      document.getElementById("ces-f-dept").innerHTML += deptData.departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
    }
  } catch (e) { console.error("Cash expense search filter bootstrap failed:", e.message); }

  enhanceAllDateInputsForDMY();
  runCashExpenseSearch();
}

function cesBuildSearchLabel() {
  const esc = (s) => (s || "").toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const val = (s) => `<span style="color:var(--brand);">${esc(s || 'All')}</span>`;
  const empSel = document.getElementById("ces-f-employee");
  const employeeLabel = empSel.value ? empSel.options[empSel.selectedIndex].textContent : "All";
  const deptLabel = document.getElementById("ces-f-dept").value || "All";
  const typeLabel = document.getElementById("ces-f-type").value || "All";
  const modeLabel = document.getElementById("ces-f-mode").value || "All";
  const from = document.getElementById("ces-f-from").value;
  const to = document.getElementById("ces-f-to").value;
  const dateRangeLabel = (from || to) ? `${from ? formatDateDMY(from) : '…'} to ${to ? formatDateDMY(to) : '…'}` : "All";
  return `<span style="color:#000;">Searching for</span>` +
    `<br><span style="color:#000;">Employee:</span> ${val(employeeLabel)} &nbsp; <span style="color:#000;">Department:</span> ${val(deptLabel)}` +
    `<br><span style="color:#000;">Type of Expense:</span> ${val(typeLabel)} &nbsp; <span style="color:#000;">Payment Mode:</span> ${val(modeLabel)}` +
    `<br><span style="color:#000;">Date Range:</span> ${val(dateRangeLabel)}`;
}

async function runCashExpenseSearch() {
  const lbl = document.getElementById("ces-search-label");
  lbl.style.display = "block";
  lbl.innerHTML = cesBuildSearchLabel();

  const resultsElEarly = document.getElementById("ces-results");
  const fromVal = document.getElementById("ces-f-from").value;
  const toVal = document.getElementById("ces-f-to").value;
  if (fromVal && toVal && toVal < fromVal) {
    resultsElEarly.innerHTML = `<p style="color:var(--warn);">Date To can't be before Date From.</p>`;
    document.getElementById("ces-total").textContent = "";
    return;
  }

  const filters = {
    employeeId: document.getElementById("ces-f-employee").value || null,
    departmentName: document.getElementById("ces-f-dept").value || null,
    expenseType: document.getElementById("ces-f-type").value || null,
    paymentMode: document.getElementById("ces-f-mode").value || null,
    dateFrom: document.getElementById("ces-f-from").value || null,
    dateTo: document.getElementById("ces-f-to").value || null,
  };
  const resultsEl = document.getElementById("ces-results");
  resultsEl.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Searching...</div>`;

  try {
    const data = await acFetch("searchCashExpenses", filters);
    if (!data.success) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }

    document.getElementById("ces-total").textContent = `Total Voucher Amount: ${formatINRComma(data.totalAmount)}`;

    if (data.expenses.length === 0) {
      resultsEl.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No expenses match this filter.</div>`;
      return;
    }
    const rows = data.expenses.map(x => {
      const typeLabel = x.expenseType === 'Food & Snacks' && x.subType ? `Food & Snacks (${escapeHtml(x.subType)})`
        : x.expenseType === 'Others' && x.otherText ? `Others (${escapeHtml(x.otherText)})` : escapeHtml(x.expenseType);
      const modeColor = x.paymentMode === 'Cash' ? '#b45309' : '#0369a1';
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:7px;">${formatDateDMY(x.createdDate)}</td>
        <td style="padding:7px;">${escapeHtml(x.employeeName)}</td>
        <td style="padding:7px;">${escapeHtml(x.departmentName || '—')}</td>
        <td style="padding:7px;">${typeLabel}</td>
        <td style="padding:7px;"><span style="background:${modeColor}; color:#fff; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:3px;">${x.paymentMode}</span></td>
        <td style="padding:7px; text-align:right; font-weight:700;">${formatINRComma(x.amount)}</td>
      </tr>`;
    }).join("");
    resultsEl.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
          <thead><tr style="background:var(--highlight-bg); text-align:left;">
            <th style="padding:8px;">Date</th><th style="padding:8px;">Employee</th><th style="padding:8px;">Department</th>
            <th style="padding:8px;">Type</th><th style="padding:8px;">Payment Mode</th><th style="padding:8px; text-align:right;">Amount</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (e) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}
