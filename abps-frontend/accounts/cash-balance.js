// accounts/cash-balance.js — "Add to Account Balance" toggle. Shows the
// current Cash and UPI pool balances and lets Accounts top either one up.

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
    <div style="background:var(--highlight-bg); padding:18px; border-radius:var(--radius); max-width:420px;">
      <div style="margin-bottom:12px;">
        <label class="field-label">Add Balance To *</label>
        <div style="display:flex; gap:16px; margin-top:4px;">
          <label style="display:flex; align-items:center; gap:6px; font-weight:600; cursor:pointer;"><input type="radio" name="cb-mode" value="Cash"> Cash</label>
          <label style="display:flex; align-items:center; gap:6px; font-weight:600; cursor:pointer;"><input type="radio" name="cb-mode" value="UPI"> UPI</label>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label class="field-label">Amount *</label>
        <input type="number" id="cb-amount" min="0" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
      </div>
      <button class="nav-btn-styled" onclick="submitCashUpiTopup()">Add to Balance</button>
    </div>`;
  await loadCashUpiBalance();
}

async function loadCashUpiBalance() {
  try {
    const data = await acFetch("fetchCashUpiBalance", {});
    if (data.success) {
      document.getElementById("cb-cash-balance").textContent = formatINRComma(data.cashBalance);
      document.getElementById("cb-upi-balance").textContent = formatINRComma(data.upiBalance);
    }
  } catch (e) { console.error("fetchCashUpiBalance failed:", e.message); }
}

async function submitCashUpiTopup() {
  const paymentMode = document.querySelector('input[name="cb-mode"]:checked')?.value;
  const amount = parseFloat(document.getElementById("cb-amount").value);
  if (!paymentMode) return showCashExpenseFeedback("Select Cash or UPI.", "error");
  if (!amount || amount <= 0) return showCashExpenseFeedback("A positive Amount is required.", "error");

  showBlockingOverlay("Adding to balance...");
  try {
    const data = await acFetch("addCashUpiTopup", { paymentMode, amount });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("cb-amount").value = "";
      document.querySelectorAll('input[name="cb-mode"]').forEach(r => r.checked = false);
      loadCashUpiBalance();
      showCashExpenseSuccess(`Added ${formatINRComma(amount)} to ${paymentMode} balance.`, "Add Another Top-Up", "document.getElementById('ce-success').style.display='none';");
    } else {
      showCashExpenseFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showCashExpenseFeedback("Network error: " + e.message, "error"); }
}
