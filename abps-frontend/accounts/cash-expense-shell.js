// accounts/cash-expense-shell.js — toggle bar + shared feedback banner
// for Daily Cash / UPI Expenses (4 toggles: Expenses, Add to Account
// Balance, Search Cash Expense Vouchers, Employee Details). Each
// toggle's own render/submit logic lives in its own sibling file.

const CASH_EXPENSE_TOGGLES = ["expenses", "balance", "search", "employees"];

// Mirrors abps-backend/routes/cashExpenses.js's EXPENSE_TYPES /
// FOOD_SNACKS_SUB_TYPES constants.
const CASH_EXPENSE_TYPES = ['Stationary', 'Repair & Maintenance', 'House Keeping', 'Pantry', 'Food & Snacks',
  'Guest Hospitality', 'URD Purchase', 'Local Material Transport', 'Local Conveyance', 'Vehicle Expenses', 'Others'];
const CASH_FOOD_SNACKS_SUB_TYPES = ['Snacks for OT', 'Staff Snacks'];

function initializeCashExpensesPanel() {
  document.getElementById("ce-feedback").style.display = "none";
  switchCashExpenseToggle("expenses");
}

function switchCashExpenseToggle(toggle) {
  CASH_EXPENSE_TOGGLES.forEach(t => {
    const panel = document.getElementById(`ce-panel-${t}`);
    const btn = document.getElementById(`ce-toggle-${t}`);
    if (panel) panel.style.display = (t === toggle) ? "block" : "none";
    if (btn) { btn.style.background = (t === toggle) ? "var(--brand)" : "#e2e8f0"; btn.style.color = (t === toggle) ? "#fff" : "#334155"; }
  });
  if (toggle === "expenses" && typeof initializeCashExpenseEntryPanel === "function") initializeCashExpenseEntryPanel();
  if (toggle === "balance" && typeof initializeCashBalancePanel === "function") initializeCashBalancePanel();
  if (toggle === "search" && typeof initializeCashExpenseSearchPanel === "function") initializeCashExpenseSearchPanel();
  if (toggle === "employees" && typeof initializeCashExpenseEmployeesPanel === "function") initializeCashExpenseEmployeesPanel();
}

function showCashExpenseFeedback(message, type) {
  const el = document.getElementById("ce-feedback");
  if (!el) return;
  const isError = type === "error";
  el.style.display = "block";
  el.style.background = isError ? "#fee2e2" : "#dcfce7";
  el.style.borderLeftColor = isError ? "#b91c1c" : "#15803d";
  el.style.color = isError ? "#b91c1c" : "#15803d";
  el.textContent = message;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}
