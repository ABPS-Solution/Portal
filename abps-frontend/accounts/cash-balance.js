// accounts/cash-balance.js — "Add to Cash Box" toggle (renamed from "Add
// to Account Balance"). Shows the current Cash and UPI pool balances,
// lets Accounts top one up by picking a real Source (3 Sep 2026 — was a
// bare Cash/UPI radio; Payment Mode is now DERIVED from Source, see
// routes/cashExpenses.js's addCashUpiTopup), and lists every past top-up
// below for a real audit trail. The out-of-range banner itself is
// rendered only once, in cash-expense-shell.js above the toggle bar (so
// it stays visible regardless of which toggle is active) — this panel
// used to also render its own copy here, which just double-printed the
// same banner whenever this toggle was the active one.

const CB_TOPUP_SOURCES = ['BOI: 0209', 'HDFC: 1735', 'HDFC: 2800', 'ICICI', 'Cash'];

async function initializeCashBalancePanel() {
  const panel = document.getElementById("ce-panel-balance");
  panel.innerHTML = `
    <div style="display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap;">
      <div style="flex:1; min-width:200px; background:var(--highlight-bg); padding:16px; border-radius:var(--radius);">
        <div style="font-size:0.8rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Current Cash Balance</div>
        <div id="cb-cash-balance" style="font-size:1.6rem; font-weight:800; color:var(--brand);">—</div>
      </div>
      <div style="flex:1; min-width:200px; background:var(--highlight-bg); padding:16px; border-radius:var(--radius);">
        <div style="font-size:0.8rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Current UPI Balance</div>
        <div id="cb-upi-balance" style="font-size:1.6rem; font-weight:800; color:var(--brand);">—</div>
      </div>
    </div>
    <div style="background:var(--highlight-bg); padding:18px; border-radius:var(--radius); max-width:420px; margin-bottom:28px;">
      <div style="margin-bottom:12px;">
        <label class="field-label">Source *</label>
        <select id="cb-source" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
          <option value="">Select Source</option>
          ${CB_TOPUP_SOURCES.map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
      </div>
      <div style="margin-bottom:16px;">
        <label class="field-label">Amount *</label>
        <input type="number" id="cb-amount" min="0" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
      </div>
      <button class="nav-btn-styled" onclick="submitCashUpiTopup()">Add to Cash Box</button>
    </div>
    <h3 style="margin:0 0 12px;">Cash Box Top-Up History</h3>
    <div id="cb-topup-history-wrap" style="overflow-x:auto;"></div>`;
  await loadCashUpiBalance();
  await loadCashUpiTopupHistory();
}

// Renders (or clears) the amber out-of-range banner into any container
// element passed in — same visual pattern as store/qa.js's
// checkVendorOpenRejections banner (amber background, left border).
function renderCashBoxRangeFlag(container, cashBalance, upiBalance) {
  if (!container) return;
  const combined = Number(cashBalance) + Number(upiBalance);
  if (combined >= 3000 && combined <= 10000) { container.innerHTML = ""; return; }
  container.innerHTML = `
    <div style="display:block; margin-bottom:16px; background:#fffbeb; border-left:4px solid #d97706; padding:14px; border-radius:var(--radius);">
      <div style="font-weight:700; color:#92400e;">⚠ Combined Cash + UPI balance is out of range</div>
      <div style="font-size:0.85rem; color:#92400e; margin-top:4px;">
        Combined balance is ${formatINRComma(combined)}, outside the target range of ₹3,000–₹10,000. This will keep showing until it's brought back into range.
      </div>
    </div>`;
}

async function loadCashUpiBalance() {
  try {
    const data = await acFetch("fetchCashUpiBalance", {});
    if (data.success) {
      document.getElementById("cb-cash-balance").textContent = formatINRComma(data.cashBalance);
      document.getElementById("cb-upi-balance").textContent = formatINRComma(data.upiBalance);
      refreshCashExpenseShellRangeFlag(data.cashBalance, data.upiBalance);
    }
  } catch (e) { console.error("fetchCashUpiBalance failed:", e.message); }
}

// Same bordered/wrapping table shape used across Accounts (Search
// Vouchers, Search Cash Expense Vouchers, Employee Details) — left
// border between columns, everything centered both ways.
async function loadCashUpiTopupHistory() {
  const wrap = document.getElementById("cb-topup-history-wrap");
  wrap.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading...</div>`;
  try {
    const data = await acFetch("listCashUpiTopups", {});
    if (!data.success) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
    if (data.topups.length === 0) {
      wrap.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No top-ups yet.</div>`;
      return;
    }
    const cb = "border-left:2px solid var(--border);";
    const cell = "padding:8px 6px; font-size:0.85rem; color:#000; text-align:center; vertical-align:middle;";
    const th = "padding:8px 6px; text-align:center; font-size:0.72rem; text-transform:uppercase; color:var(--muted); vertical-align:middle;";
    const modeColor = (m) => m === 'Cash' ? '#b45309' : '#0369a1';
    const rows = data.topups.map(t => `
      <tr style="border-bottom:2px solid var(--border);">
        <td style="${cell}">${formatOrdinalDate(t.createdDate)}</td>
        <td style="${cell} ${cb}">${escapeHtml(t.source || '—')}</td>
        <td style="${cell} ${cb}"><span style="background:${modeColor(t.paymentMode)}; color:#fff; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:3px;">${escapeHtml(t.paymentMode)}</span></td>
        <td style="${cell} ${cb}; font-weight:700;">${formatINRComma(t.amount)}</td>
        <td style="${cell} ${cb}">${escapeHtml(t.createdBy || '—')}</td>
      </tr>`).join("");
    wrap.innerHTML = `
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
        <thead><tr style="background:var(--highlight-bg); border-bottom:2px solid var(--border);">
          <th style="${th}">Date</th><th style="${th} ${cb}">Source</th><th style="${th} ${cb}">Payment Mode</th>
          <th style="${th} ${cb}">Amount</th><th style="${th} ${cb}">Added By</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

async function submitCashUpiTopup() {
  const source = document.getElementById("cb-source").value;
  const amount = parseFloat(document.getElementById("cb-amount").value);
  if (!source) return showCashExpenseFeedback("Select a Source.", "error");
  if (!amount || amount <= 0) return showCashExpenseFeedback("A positive Amount is required.", "error");

  showBlockingOverlay("Adding to balance...");
  try {
    const data = await acFetch("addCashUpiTopup", { source, amount });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("cb-amount").value = "";
      document.getElementById("cb-source").value = "";
      loadCashUpiBalance();
      loadCashUpiTopupHistory();
      showCashExpenseSuccess(`Added ${formatINRComma(amount)} from ${source}.`, "Add Another Top-Up", "switchCashExpenseToggle('balance')");
    } else {
      showCashExpenseFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showCashExpenseFeedback("Network error: " + e.message, "error"); }
}
