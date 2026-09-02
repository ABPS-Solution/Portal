// accounts/cash-expense-vouchers.js — "Daily Expense Vouchers" toggle.
// Lists every Daily Advance not yet reconciled (actual_amount IS NULL on
// accounts.cash_expenses). Expanding one shows the full detail row plus
// an Actual Amount input; submitting it calls closeCashExpenseVoucher,
// which books the real spend and returns the difference to (or pulls the
// shortfall from) the pool balance — see routes/cashExpenses.js for the
// exact math. Closed vouchers drop out of this list immediately.

let cevOpenVouchers = [];
let cevExpandedId = null;

async function initializeCashExpenseVouchersPanel() {
  const panel = document.getElementById("ce-panel-vouchers");
  panel.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading vouchers...</div>`;
  cevExpandedId = null;
  try {
    const data = await acFetch("fetchOpenCashExpenseVouchers", {});
    if (!data.success) { panel.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
    cevOpenVouchers = data.vouchers || [];
    cevRender();
  } catch (e) {
    panel.innerHTML = `<p style="color:var(--warn);">Network error: ${escapeHtml(e.message)}</p>`;
  }
}

function cevTypeLabel(v) {
  if (v.expenseType === 'Food & Snacks' && v.subType) return `Food & Snacks (${escapeHtml(v.subType)})`;
  if (v.expenseType === 'Others' && v.otherText) return `Others (${escapeHtml(v.otherText)})`;
  return escapeHtml(v.expenseType);
}

function cevRender() {
  const panel = document.getElementById("ce-panel-vouchers");
  if (cevOpenVouchers.length === 0) {
    panel.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">
      No Daily Advance vouchers are waiting to be closed.
    </div>`;
    return;
  }
  panel.innerHTML = `
    <div style="font-weight:700; margin-bottom:14px; color:var(--text);">${cevOpenVouchers.length} voucher${cevOpenVouchers.length === 1 ? '' : 's'} waiting to be closed</div>
    ${cevOpenVouchers.map(cevRenderCard).join("")}`;
}

function cevRenderCard(v) {
  const expanded = cevExpandedId === v.expenseId;
  const modeColor = v.paymentMode === 'Cash' ? '#b45309' : '#0369a1';
  return `
    <div style="border:1px solid var(--border); border-radius:var(--radius); margin-bottom:12px; overflow:hidden;">
      <div onclick="cevToggle(${v.expenseId})" style="padding:11px 14px; background:var(--highlight-bg); display:flex; align-items:center; flex-wrap:wrap; gap:10px; cursor:pointer;">
        <span style="font-family:monospace; color:var(--muted); font-size:0.8rem;">${formatOrdinalDate(v.createdDate)}</span>
        <strong style="color:#111827;">${escapeHtml(v.employeeName)}</strong>
        <span style="color:var(--muted); font-size:0.85rem;">${escapeHtml(v.departmentName || '—')}</span>
        <span style="font-size:0.85rem;">${cevTypeLabel(v)}</span>
        <span style="background:${modeColor}; color:#fff; font-weight:700; font-size:0.72rem; padding:3px 8px; border-radius:3px;">${v.paymentMode}</span>
        <span style="font-weight:700; font-family:monospace;">Advance: ${formatINRComma(v.advanceAmount)}</span>
        <span style="margin-left:auto; font-weight:700; color:var(--muted);">${expanded ? '▾' : '▸'}</span>
      </div>
      ${expanded ? `
      <div style="padding:16px; border-top:1px dashed var(--border);">
        <div style="overflow-x:auto; margin-bottom:14px;">
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            <thead><tr style="background:#f1f5f9; text-align:left;">
              <th style="padding:8px;">Date</th><th style="padding:8px;">Employee</th><th style="padding:8px;">Department</th>
              <th style="padding:8px;">Type</th><th style="padding:8px;">Payment Mode</th><th style="padding:8px; text-align:right;">Advance Amount</th>
            </tr></thead>
            <tbody><tr>
              <td style="padding:8px;">${formatOrdinalDate(v.createdDate)}</td>
              <td style="padding:8px;">${escapeHtml(v.employeeName)}</td>
              <td style="padding:8px;">${escapeHtml(v.departmentName || '—')}</td>
              <td style="padding:8px;">${cevTypeLabel(v)}</td>
              <td style="padding:8px;"><span style="background:${modeColor}; color:#fff; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:3px;">${v.paymentMode}</span></td>
              <td style="padding:8px; text-align:right; font-weight:700;">${formatINRComma(v.advanceAmount)}</td>
            </tr></tbody>
          </table>
        </div>
        <div style="max-width:320px;">
          <label class="field-label">Actual Amount Spent *</label>
          <input type="number" id="cev-actual-${v.expenseId}" min="0" placeholder="e.g. ${trimNum(v.advanceAmount)}"
            style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
          <div style="font-size:0.76rem; color:var(--muted); margin-top:5px;">Less than the advance comes back into the balance; more is pulled from it.</div>
          <button class="nav-btn-styled" style="margin-top:10px;" onclick="cevCloseVoucher(${v.expenseId})">Submit &amp; Close Voucher</button>
        </div>
      </div>` : ''}
    </div>`;
}

function cevToggle(expenseId) {
  cevExpandedId = cevExpandedId === expenseId ? null : expenseId;
  cevRender();
}

async function cevCloseVoucher(expenseId) {
  const input = document.getElementById(`cev-actual-${expenseId}`);
  const actualAmount = input ? input.value : "";
  if (actualAmount === "" || Number(actualAmount) < 0 || Number.isNaN(Number(actualAmount))) {
    return showCashExpenseFeedback("Enter a valid Actual Amount (0 or more).", "error");
  }
  showBlockingOverlay("Closing voucher...");
  try {
    const data = await acFetch("closeCashExpenseVoucher", { expenseId, actualAmount: Number(actualAmount) });
    hideBlockingOverlay();
    if (!data.success) { showCashExpenseFeedback(data.error, "error"); return; }
    cevOpenVouchers = cevOpenVouchers.filter(v => v.expenseId !== expenseId);
    cevExpandedId = null;
    cevRender();
    if (typeof loadCashExpenseShellRangeFlag === "function") loadCashExpenseShellRangeFlag();
    document.getElementById("ce-feedback").style.display = "none"; // clear any prior error banner
  } catch (e) {
    hideBlockingOverlay();
    showCashExpenseFeedback("Network error: " + e.message, "error");
  }
}
