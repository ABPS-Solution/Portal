// accounts/tour-shell.js — toggle bar + shared feedback banner for the
// rebuilt Tour Expense Tracker (4 toggles: Advance Vouchers, Employee
// Tour Expense Vouchers, Search Tour Expense Vouchers, Employee Details).
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
  switchTourExpenseToggle("advance");
}

function switchTourExpenseToggle(toggle) {
  TOUR_TOGGLES.forEach(t => {
    const panel = document.getElementById(`te-panel-${t}`);
    const btn = document.getElementById(`te-toggle-${t}`);
    if (panel) panel.style.display = (t === toggle) ? "block" : "none";
    if (btn) { btn.style.background = (t === toggle) ? "var(--brand)" : ""; btn.style.color = (t === toggle) ? "#fff" : ""; }
  });
  if (toggle === "advance" && typeof initializeAdvanceVoucherPanel === "function") initializeAdvanceVoucherPanel();
  if (toggle === "check" && typeof initializeVoucherCheckPanel === "function") initializeVoucherCheckPanel();
  if (toggle === "search" && typeof initializeVoucherSearchPanel === "function") initializeVoucherSearchPanel();
  if (toggle === "employees" && typeof initializeEmployeeDetailsPanel === "function") initializeEmployeeDetailsPanel();
}

// Shared feedback banner, same visual pattern used across the portal
// (see showBOQBanner) — kept local to this module since #te-feedback is
// this panel's own element, not a shared id.
function showTourFeedback(message, type) {
  const el = document.getElementById("te-feedback");
  if (!el) return;
  const isError = type === "error";
  el.style.display = "block";
  el.style.background = isError ? "#fee2e2" : "#dcfce7";
  el.style.borderLeftColor = isError ? "#b91c1c" : "#15803d";
  el.style.color = isError ? "#b91c1c" : "#15803d";
  el.textContent = message;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}
