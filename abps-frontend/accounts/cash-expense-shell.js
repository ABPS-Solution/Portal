// accounts/cash-expense-shell.js — toggle bar + shared feedback banner
// for Daily Cash / UPI Expenses (5 toggles: Daily Advance, Daily Expense
// Vouchers, Add to Cash Box, Search Cash Expense Vouchers, Employee
// Details). Each toggle's own render/submit logic lives in its own
// sibling file. "Expenses" (now "Daily Advance") hands money to an
// employee immediately; "Daily Expense Vouchers" closes that advance out
// once the actual spend is known — see cash-expense-vouchers.js.

const CASH_EXPENSE_TOGGLES = ["expenses", "vouchers", "balance", "search", "employees"];

// Mirrors abps-backend/routes/cashExpenses.js's EXPENSE_TYPES /
// FOOD_SNACKS_SUB_TYPES constants.
const CASH_EXPENSE_TYPES = ['Stationary', 'Repair & Maintenance', 'House Keeping', 'Pantry', 'Food & Snacks',
  'Guest Hospitality', 'URD Purchase', 'Local Material Transport', 'Local Conveyance', 'Vehicle Expenses', 'Others'];
const CASH_FOOD_SNACKS_SUB_TYPES = ['Snacks for OT', 'Staff Snacks'];

function initializeCashExpensesPanel() {
  document.getElementById("ce-feedback").style.display = "none";
  document.getElementById("ce-success").style.display = "none";
  switchCashExpenseToggle("expenses");
  loadCashExpenseShellRangeFlag();
}

// A persistent copy of the combined-balance out-of-range banner
// (renderCashBoxRangeFlag, cash-balance.js), shown above the toggle bar so
// it's visible no matter which of the 4 toggles is open — not just the
// "Add to Cash Box" panel. Fetched once on load and refreshed whenever
// cash-balance.js's own load/topup flow re-fetches the balance.
async function loadCashExpenseShellRangeFlag() {
  try {
    const data = await acFetch("fetchCashUpiBalance", {});
    if (data.success) refreshCashExpenseShellRangeFlag(data.cashBalance, data.upiBalance);
  } catch (e) { console.error("loadCashExpenseShellRangeFlag failed:", e.message); }
}

function refreshCashExpenseShellRangeFlag(cashBalance, upiBalance) {
  const el = document.getElementById("ce-shell-range-flag");
  if (el && typeof renderCashBoxRangeFlag === "function") renderCashBoxRangeFlag(el, cashBalance, upiBalance);
}

function switchCashExpenseToggle(toggle) {
  document.getElementById("ce-feedback").style.display = "none";
  document.getElementById("ce-success").style.display = "none";
  document.getElementById("ce-toggle-bar").style.display = "flex";
  CASH_EXPENSE_TOGGLES.forEach(t => {
    const panel = document.getElementById(`ce-panel-${t}`);
    const btn = document.getElementById(`ce-toggle-${t}`);
    if (panel) panel.style.display = (t === toggle) ? "block" : "none";
    if (btn) { btn.style.background = (t === toggle) ? "var(--brand)" : "#e2e8f0"; btn.style.color = (t === toggle) ? "#fff" : "#334155"; }
  });
  if (toggle === "expenses" && typeof initializeCashExpenseEntryPanel === "function") initializeCashExpenseEntryPanel();
  if (toggle === "vouchers" && typeof initializeCashExpenseVouchersPanel === "function") initializeCashExpenseVouchersPanel();
  if (toggle === "balance" && typeof initializeCashBalancePanel === "function") initializeCashBalancePanel();
  if (toggle === "search" && typeof initializeCashExpenseSearchPanel === "function") initializeCashExpenseSearchPanel();
  if (toggle === "employees" && typeof initializeCashExpenseEmployeesPanel === "function") initializeCashExpenseEmployeesPanel();
}

// ERROR ONLY — success has its own mount (#ce-success, showCashExpenseSuccess
// below), same reasoning as Tour Expense Tracker's showTourFeedback.
function showCashExpenseFeedback(message, type) {
  const el = document.getElementById("ce-feedback");
  if (!el) return;
  if (type !== "error") { el.style.display = "none"; return; }
  el.style.display = "block";
  el.style.background = "#fee2e2";
  el.style.borderLeftColor = "#b91c1c";
  el.style.color = "#b91c1c";
  el.textContent = message;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showCashExpenseSuccess(message, resetLabel, resetFnCall) {
  document.getElementById("ce-feedback").style.display = "none";
  const el = document.getElementById("ce-success");
  if (!el) return;
  // Same "hide everything but the success banner until +Do Another" pattern
  // as Tour Expense Tracker's showTourSuccess — resetFnCall is expected to
  // call switchCashExpenseToggle(...), which restores both.
  document.getElementById("ce-toggle-bar").style.display = "none";
  CASH_EXPENSE_TOGGLES.forEach(t => { const panel = document.getElementById(`ce-panel-${t}`); if (panel) panel.style.display = "none"; });
  el.style.display = "block";
  showSuccessWithReset("ce-success", message, resetLabel, resetFnCall);
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Trimmed + comma-grouped (Indian digit grouping) — "16000" -> "16,000".
function formatINRComma(n) {
  return Number(trimNum(n)).toLocaleString('en-IN');
}
