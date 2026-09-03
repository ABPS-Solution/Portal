// accounts/cash-expense-entry.js — "Daily Advance" toggle. Hands an
// advance to an employee, deducted immediately from the picked Cash/UPI
// pool balance — there's no review/check step like Tour Expense
// Vouchers. The advance stays an open voucher (see
// cash-expense-vouchers.js) until Daily Expense Vouchers records what
// was actually spent and reconciles the difference back into the balance.

let ceCachedEmployees = [];
let ceSelectedEmployeeId = null;

async function initializeCashExpenseEntryPanel() {
  const panel = document.getElementById("ce-panel-expenses");
  panel.innerHTML = `
    <div style="background:var(--highlight-bg); padding:18px; border-radius:var(--radius); max-width:520px;">
      <div style="margin-bottom:12px;">
        <label class="field-label">Type of Expense *</label>
        <select id="ce-type" onchange="ceHandleTypeChange()" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
          <option value="">Select...</option>
          ${CASH_EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
        </select>
      </div>
      <div id="ce-subtype-wrap" style="display:none; margin-bottom:12px;">
        <label class="field-label">Food &amp; Snacks Type *</label>
        <select id="ce-subtype" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
          <option value="">Select...</option>
          ${CASH_FOOD_SNACKS_SUB_TYPES.map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
      </div>
      <div id="ce-other-wrap" style="display:none; margin-bottom:12px;">
        <label class="field-label">Please specify *</label>
        <input type="text" id="ce-other-text" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
      </div>
      <div style="margin-bottom:12px; position:relative;">
        <label class="field-label">Employee Name *</label>
        <input type="text" id="ce-emp-search" placeholder="Type to search employee..." autocomplete="off"
          style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"
          oninput="ceHandleEmployeeSearch(this.value)">
        <div id="ce-emp-dropdown" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:12px;">
        <div style="flex:1;"><label class="field-label">EMP ID</label>
          <input type="text" id="ce-emp-code" readonly style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px; background:#f1f5f9;"></div>
        <div style="flex:1;"><label class="field-label">Department</label>
          <input type="text" id="ce-emp-dept" readonly style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px; background:#f1f5f9;"></div>
      </div>
      <div style="margin-bottom:12px;">
        <label class="field-label">Advance Amount *</label>
        <input type="number" id="ce-amount" min="0" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
      </div>
      <div style="margin-bottom:16px;">
        <label class="field-label">Payment Mode *</label>
        <div style="display:flex; gap:16px; margin-top:4px;">
          <label style="display:flex; align-items:center; gap:6px; font-weight:600; cursor:pointer;"><input type="radio" name="ce-mode" value="Cash"> Cash</label>
          <label style="display:flex; align-items:center; gap:6px; font-weight:600; cursor:pointer;"><input type="radio" name="ce-mode" value="UPI"> UPI</label>
          <label style="display:flex; align-items:center; gap:6px; font-weight:600; cursor:pointer;"><input type="radio" name="ce-mode" value="Online"> Online</label>
        </div>
      </div>
      <button class="nav-btn-styled" id="ce-submit-btn" onclick="submitCashExpense()">Submit</button>
    </div>`;

  ceSelectedEmployeeId = null;
  try {
    const data = await acFetch("searchCashExpenseEmployees", {});
    ceCachedEmployees = data.success ? data.employees : [];
  } catch (e) { console.error("Cash expense employee load failed:", e.message); }
}

function ceHandleTypeChange() {
  const type = document.getElementById("ce-type").value;
  document.getElementById("ce-subtype-wrap").style.display = type === "Food & Snacks" ? "block" : "none";
  document.getElementById("ce-other-wrap").style.display = type === "Others" ? "block" : "none";
}

function ceHandleEmployeeSearch(query) {
  const dd = document.getElementById("ce-emp-dropdown");
  ceSelectedEmployeeId = null;
  document.getElementById("ce-emp-code").value = "";
  document.getElementById("ce-emp-dept").value = "";
  const q = (query || "").trim().toLowerCase();
  if (!q) { dd.style.display = "none"; return; }
  const matches = ceCachedEmployees.filter(e => e.employeeName.toLowerCase().includes(q)).slice(0, 15);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(e => `
    <div onmousedown="event.preventDefault(); ceSelectEmployee(${e.employeeId})"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${escapeHtml(e.employeeName)} <span style="color:var(--muted); font-size:0.75rem;">${e.empCode ? '· ' + escapeHtml(e.empCode) : ''}</span>
    </div>`).join("");
  const input = document.getElementById("ce-emp-search");
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + "px"; dd.style.left = rect.left + "px"; dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function ceSelectEmployee(employeeId) {
  const emp = ceCachedEmployees.find(e => e.employeeId === employeeId);
  if (!emp) return;
  ceSelectedEmployeeId = employeeId;
  document.getElementById("ce-emp-search").value = emp.employeeName;
  document.getElementById("ce-emp-code").value = emp.empCode || "";
  document.getElementById("ce-emp-dept").value = emp.departmentName || "";
  document.getElementById("ce-emp-dropdown").style.display = "none";
}

document.addEventListener("click", (e) => {
  const dd = document.getElementById("ce-emp-dropdown");
  if (dd && !e.target.closest("#ce-emp-search") && !e.target.closest("#ce-emp-dropdown")) dd.style.display = "none";
});

async function submitCashExpense() {
  const expenseType = document.getElementById("ce-type").value;
  const subType = document.getElementById("ce-subtype")?.value || "";
  const otherText = document.getElementById("ce-other-text")?.value.trim() || "";
  const amount = parseFloat(document.getElementById("ce-amount").value);
  const paymentMode = document.querySelector('input[name="ce-mode"]:checked')?.value;

  if (!expenseType) return showCashExpenseFeedback("Type of Expense is required.", "error");
  if (expenseType === "Food & Snacks" && !subType) return showCashExpenseFeedback("Select a Food & Snacks sub-type.", "error");
  if (expenseType === "Others" && !otherText) return showCashExpenseFeedback('Type "Others" requires the free-text description.', "error");
  if (!ceSelectedEmployeeId) return showCashExpenseFeedback("Select an employee from the dropdown.", "error");
  if (!amount || amount <= 0) return showCashExpenseFeedback("A positive Advance Amount is required.", "error");
  if (!paymentMode) return showCashExpenseFeedback("Select Cash, UPI or Online.", "error");

  showBlockingOverlay("Recording expense...");
  try {
    const data = await acFetch("submitCashExpense", {
      expenseType, subType, otherText, employeeId: ceSelectedEmployeeId, amount, paymentMode,
    });
    hideBlockingOverlay();
    if (data.success) {
      const balanceLine = data.paymentMode === "Online"
        ? "Online — no pool balance affected."
        : `New ${data.paymentMode} balance: <strong style="font-size:1.05rem;">${formatINRComma(data.newBalance)}</strong>`;
      document.getElementById("ce-panel-expenses").innerHTML = `
        <div style="background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:20px; border-radius:var(--radius); max-width:520px;">
          <strong>Advance recorded${data.employeeName ? ' for ' + escapeHtml(data.employeeName) : ''}.</strong> Close it out later in Daily Expense Vouchers once the actual spend is known.<br/>
          ${balanceLine}
          <div style="margin-top:12px;">
            <button class="nav-btn-styled" onclick="initializeCashExpenseEntryPanel()">+ Give New Advance</button>
          </div>
        </div>`;
    } else {
      showCashExpenseFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showCashExpenseFeedback("Network error: " + e.message, "error"); }
}
