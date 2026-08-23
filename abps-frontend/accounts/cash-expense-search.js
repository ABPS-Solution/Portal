// accounts/cash-expense-search.js — "Search Cash Expense Vouchers" toggle.
// Read-only: filters + a Total Voucher Amount for the current filter.

async function initializeCashExpenseSearchPanel() {
  const panel = document.getElementById("ce-panel-search");
  panel.innerHTML = `
    <div style="background:var(--highlight-bg); padding:14px; border-radius:var(--radius); margin-bottom:16px; display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
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
      <button class="nav-btn-styled" onclick="runCashExpenseSearch()">Search</button>
    </div>
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

async function runCashExpenseSearch() {
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

    document.getElementById("ces-total").textContent = `Total Voucher Amount: ${trimNum(data.totalAmount)}`;

    if (data.expenses.length === 0) {
      resultsEl.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No expenses match this filter.</div>`;
      return;
    }
    resultsEl.innerHTML = data.expenses.map(x => cesRenderCard(x)).join("");
  } catch (e) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

function cesRenderCard(x) {
  const typeLabel = x.expenseType === 'Food & Snacks' && x.subType ? `Food & Snacks (${escapeHtml(x.subType)})`
    : x.expenseType === 'Others' && x.otherText ? `Others (${escapeHtml(x.otherText)})` : escapeHtml(x.expenseType);
  const modeColor = x.paymentMode === 'Cash' ? '#b45309' : '#0369a1';
  return `
    <div class="contact-summary-card-parent">
      <div class="contact-summary-header-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='block'?'none':'block'" style="cursor:pointer; width:100%;">
        <div class="contact-summary-title-info" style="width:100%;">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <span style="font-weight:700;">${escapeHtml(x.employeeName)}</span>
              <span style="color:var(--muted); font-size:0.8rem; margin-left:6px;">${escapeHtml(x.departmentName || '—')}</span>
            </div>
            <span style="background:${modeColor}; color:#fff; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:3px;">${x.paymentMode}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--muted); margin-top:6px;">${typeLabel} · ${formatDateDMY(x.createdDate)}</div>
        </div>
      </div>
      <div style="display:none; padding-top:10px; border-top:1px dashed var(--border); margin-top:10px; font-size:0.9rem;">
        <div><strong>Amount:</strong> ${trimNum(x.amount)}</div>
        <div><strong>Type:</strong> ${typeLabel}</div>
        <div><strong>Payment Mode:</strong> ${x.paymentMode}</div>
        <div><strong>Date:</strong> ${formatDateDMY(x.createdDate)}</div>
      </div>
    </div>`;
}
