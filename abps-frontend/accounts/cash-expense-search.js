// accounts/cash-expense-search.js — "Search Cash Expense Vouchers" toggle.
// Read-only: filters + a Total Voucher Amount for the current filter,
// results as a plain table (there's little enough per-row detail here
// that an expand-to-see-more wrapper was just extra clicks for nothing).

let cesCachedEmployees = [];
let cesSelectedEmployeeId = null;
let cesSelectedEmployeeName = "";

// Same typeahead pattern as advance-vouchers.js / voucher-search.js's
// Employee Name field — replacing the old plain <select> (30 Aug 2026).
function cesHandleEmployeeSearch(query) {
  const dd = document.getElementById("ces-emp-dropdown");
  cesSelectedEmployeeId = null;
  cesSelectedEmployeeName = query;
  const q = (query || "").trim().toLowerCase();
  if (!q) { dd.style.display = "none"; return; }
  const matches = cesCachedEmployees.filter(e => e.employeeName.toLowerCase().includes(q)).slice(0, 15);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(e => `
    <div onmousedown="event.preventDefault(); cesSelectEmployee(${e.employeeId})"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${escapeHtml(e.employeeName)} <span style="color:var(--muted); font-size:0.75rem;">${e.empCode ? '· ' + escapeHtml(e.empCode) : ''}</span>
    </div>`).join("");
  const input = document.getElementById("ces-f-employee");
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + "px"; dd.style.left = rect.left + "px"; dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function cesSelectEmployee(employeeId) {
  const emp = cesCachedEmployees.find(e => e.employeeId === employeeId);
  if (!emp) return;
  cesSelectedEmployeeId = employeeId;
  cesSelectedEmployeeName = emp.employeeName;
  document.getElementById("ces-f-employee").value = emp.employeeName;
  document.getElementById("ces-emp-dropdown").style.display = "none";
}

document.addEventListener("click", (e) => {
  const dd = document.getElementById("ces-emp-dropdown");
  if (dd && !e.target.closest("#ces-emp-dropdown") && e.target.id !== "ces-f-employee") dd.style.display = "none";
});

async function initializeCashExpenseSearchPanel() {
  cesSelectedEmployeeId = null;
  cesSelectedEmployeeName = "";
  const panel = document.getElementById("ce-panel-search");
  panel.innerHTML = `
    <div style="background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
      <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:end;">
        <div style="position:relative;"><label class="field-label">Employee</label>
          <input type="text" id="ces-f-employee" placeholder="All (type to search)" autocomplete="off"
            style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:160px;"
            oninput="cesHandleEmployeeSearch(this.value)">
          <div id="ces-emp-dropdown" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div></div>
        <div><label class="field-label">Department</label>
          <select id="ces-f-dept" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;"><option value="">All</option></select></div>
        <div><label class="field-label">Type of Expense</label>
          <select id="ces-f-type" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:160px;">
            <option value="">All</option>${CASH_EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}</select></div>
        <div><label class="field-label">Payment Mode</label>
          <select id="ces-f-mode" style="padding:8px; border:1px solid var(--border); border-radius:6px;">
            <option value="">All</option><option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Online">Online</option></select></div>
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
    cesCachedEmployees = empData.success ? empData.employees : [];
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
  const employeeLabel = cesSelectedEmployeeId ? cesSelectedEmployeeName : "All";
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
    employeeId: cesSelectedEmployeeId || null,
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
      const modeColor = x.paymentMode === 'Cash' ? '#b45309' : x.paymentMode === 'UPI' ? '#0369a1' : '#7c3aed';
      // Actual Amount is editable only once closed (isOpen === false) —
      // reviseCashExpenseActualAmount requires actual_amount IS NOT NULL,
      // same guard as the backend. A still-open advance is closed via
      // Daily Expense Vouchers instead, not from here.
      const editBtn = !x.isOpen
        ? `<button class="nav-btn-styled" style="padding:2px 8px; font-size:0.72rem; margin-left:8px;" onclick="cesEditActual(${x.expenseId}, ${Number(x.amount) || 0})">Edit</button>` : '';
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:7px;">${formatDateDMY(x.createdDate)}</td>
        <td style="padding:7px;">${escapeHtml(x.employeeName)}</td>
        <td style="padding:7px;">${escapeHtml(x.departmentName || '—')}</td>
        <td style="padding:7px;">${typeLabel}</td>
        <td style="padding:7px;"><span style="background:${modeColor}; color:#fff; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:3px;">${x.paymentMode}</span></td>
        <td style="padding:7px; text-align:right; font-weight:700;">${formatINRComma(x.amount)}${x.isOpen ? ' <span style="font-weight:400; color:var(--muted); font-size:0.75rem;">(open)</span>' : editBtn}</td>
      </tr>`;
    }).join("");
    resultsEl.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
          <thead><tr style="background:var(--highlight-bg); text-align:left;">
            <th style="padding:8px;">Date</th><th style="padding:8px;">Employee</th><th style="padding:8px;">Department</th>
            <th style="padding:8px;">Type</th><th style="padding:8px;">Payment Mode</th><th style="padding:8px; text-align:right;">Actual Amount</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (e) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

// Actual Amount correction for an already-closed voucher (30 Aug 2026) —
// prompt()-based, same lightweight-inline-edit convention as
// voucher-search.js's tvsEditActual. Calls reviseCashExpenseActualAmount,
// which re-applies the pool-balance delta (skipped for Online).
async function cesEditActual(expenseId, currentActual) {
  const input = prompt("New Actual Amount for this voucher:", trimNum(currentActual));
  if (input === null) return;
  const newActualAmount = Number(input);
  if (isNaN(newActualAmount) || newActualAmount < 0) return alert("Enter a valid non-negative amount.");

  showBlockingOverlay("Revising Actual Amount...");
  try {
    const data = await acFetch("reviseCashExpenseActualAmount", { expenseId, newActualAmount });
    hideBlockingOverlay();
    if (!data.success) return alert(data.error);
    alert(data.newBalance !== null ? `Revised. New ${data.paymentMode} balance: ${formatINRComma(data.newBalance)}.` : "Revised (Online — no pool balance affected).");
    runCashExpenseSearch();
  } catch (e) { hideBlockingOverlay(); alert("Network error: " + e.message); }
}
