// accounts/tour-shell.js — toggle bar + shared feedback banner for the
// rebuilt Tour Expense Tracker (4 toggles: Advance Vouchers, Employee
// Tour Expense Vouchers, Search Vouchers, Employee Details).
// Each toggle's own render/submit logic lives in its own sibling file
// (accounts/advance-vouchers.js, voucher-check.js, voucher-search.js,
// employee-details.js) — this file only owns switching between them.

const TOUR_TOGGLES = ["advance", "check", "search", "employees"];

// Mirrors the constants in abps-backend/routes/tourVoucherPublic.js —
// kept here too since the portal's Search filter and voucher-check
// display need the same option lists without a round trip.
const TOUR_EXPENSE_TYPES = ["Travel", "Hotel", "Food", "Local Conveyance", "Material Purchase", "Others"];
const TOUR_PURPOSES = ["Marketing", "Service", "QA", "Others"];

function initializeTourExpensePanel() {
  document.getElementById("te-feedback").style.display = "none";
  document.getElementById("te-success").style.display = "none";
  switchTourExpenseToggle("advance");
}

// Trimmed + comma-grouped (Indian digit grouping) — "16000" -> "16,000".
function formatINRComma(n) {
  return Number(trimNum(n)).toLocaleString('en-IN');
}

function switchTourExpenseToggle(toggle) {
  document.getElementById("te-feedback").style.display = "none";
  document.getElementById("te-success").style.display = "none";
  document.getElementById("te-toggle-bar").style.display = "flex";
  TOUR_TOGGLES.forEach(t => {
    const panel = document.getElementById(`te-panel-${t}`);
    const btn = document.getElementById(`te-toggle-${t}`);
    if (panel) panel.style.display = (t === toggle) ? "block" : "none";
    if (btn) { btn.style.background = (t === toggle) ? "var(--brand)" : "#e2e8f0"; btn.style.color = (t === toggle) ? "#fff" : "#334155"; }
  });
  if (toggle === "advance" && typeof initializeAdvanceVoucherPanel === "function") initializeAdvanceVoucherPanel();
  if (toggle === "check" && typeof initializeVoucherCheckPanel === "function") initializeVoucherCheckPanel();
  if (toggle === "search" && typeof initializeVoucherSearchPanel === "function") initializeVoucherSearchPanel();
  if (toggle === "employees" && typeof initializeEmployeeDetailsPanel === "function") initializeEmployeeDetailsPanel();
}

// Shared feedback banner — ERROR ONLY. Success never renders here (it used
// to, sharing the same red/green div as errors, which meant a resolved
// error's banner and a fresh success message were indistinguishable at a
// glance) — see showTourSuccess below for the real success path.
function showTourFeedback(message, type) {
  const el = document.getElementById("te-feedback");
  if (!el) return;
  if (type !== "error") { el.style.display = "none"; return; }
  el.style.display = "block";
  el.style.background = "#fee2e2";
  el.style.borderLeftColor = "#b91c1c";
  el.style.color = "#b91c1c";
  el.textContent = message;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// One consistent "action succeeded" moment for the whole Tour Expense
// Tracker — message + a "+ Do Another" button, never sharing the error
// banner. Always clears any stale error first, same reasoning as
// showSuccessWithReset (shared/ui.js) which this wraps.
function showTourSuccess(message, resetLabel, resetFnCall) {
  document.getElementById("te-feedback").style.display = "none";
  const el = document.getElementById("te-success");
  if (!el) return;
  // Hide the toggle bar and every panel while the success banner is up —
  // resetFnCall is expected to call switchTourExpenseToggle(...), which
  // restores both, so nothing else (toggle buttons, other panels' stale
  // state) is visible until the user explicitly asks to do another.
  document.getElementById("te-toggle-bar").style.display = "none";
  TOUR_TOGGLES.forEach(t => { const panel = document.getElementById(`te-panel-${t}`); if (panel) panel.style.display = "none"; });
  el.style.display = "block";
  showSuccessWithReset("te-success", message, resetLabel, resetFnCall);
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}
