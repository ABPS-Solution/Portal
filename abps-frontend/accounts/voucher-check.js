// accounts/voucher-check.js — "Employee Tour Expense Vouchers" toggle:
// the checking queue Accounts works through. Vouchers were submitted on
// the public page; nothing here is editable except Actual Amount and
// Bill Checked. Balance only moves when a voucher is Checked (never at
// submission) — see routes/accounts.js checkTourVoucher.

async function initializeVoucherCheckPanel() {
  const panel = document.getElementById("te-panel-check");
  panel.innerHTML = `<div id="tvc-feed"></div>`;
  await loadVoucherCheckQueue();
}

async function loadVoucherCheckQueue() {
  const feed = document.getElementById("tvc-feed");
  feed.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading queue...</div>`;
  try {
    const data = await acFetch("fetchPendingTourVoucherQueue", {});
    if (!data.success) { feed.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
    if (data.vouchers.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No pending vouchers waiting to be checked.</div>`;
      return;
    }
    feed.innerHTML = data.vouchers.map(v => tvcRenderCard(v)).join("");
  } catch (e) { feed.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

function tvcRenderCard(v) {
  const lines = v.lines || [];
  const rows = lines.map(l => {
    const bills = (l.bills && l.bills.length > 0) ? l.bills : (l.billUrl ? [{ fileName: l.billFileName, url: l.billUrl }] : []);
    const billCell = bills.length > 0
      ? bills.map(b => `<a href="${driveLink(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.fileName || 'View')}</a>`).join("<br>")
      : `<span style="color:var(--muted);">— no bill required —</span>`;
    const typeLabel = l.expenseType === 'Local Conveyance' && l.conveyanceMode ? `Local Conveyance (${escapeHtml(l.conveyanceMode)})`
      : l.expenseType === 'Others' && l.otherText ? `Others (${escapeHtml(l.otherText)})` : escapeHtml(l.expenseType);
    return `<tr style="border-bottom:1px solid var(--border);" data-line-id="${l.lineId}">
      <td style="padding:7px;">${l.srNo}</td>
      <td style="padding:7px;">${formatDateDMY(l.expenseDate)}</td>
      <td style="padding:7px;">${typeLabel}</td>
      <td style="padding:7px;">${billCell}</td>
      <td style="padding:7px; text-align:right;">${formatINRComma(l.amount)}</td>
      <td style="padding:7px;"><input type="number" class="tvc-actual-input" data-line-id="${l.lineId}" value="${trimNum(l.amount)}" min="0"
            style="width:100px; padding:5px; border:1px solid var(--border); border-radius:4px; text-align:right;"
            oninput="tvcRecalcTotals(${v.voucherId})"></td>
      <td style="padding:7px; text-align:center;"><input type="checkbox" class="tvc-checked-input" data-line-id="${l.lineId}"></td>
    </tr>`;
  }).join("");

  // Daily Total Food flag — a same-day sanity check for the checker
  // (multiple Food lines on one date summed together), one line per
  // unique date that actually has a Food line, in date order.
  const foodTotalsByDate = {};
  lines.filter(l => l.expenseType === 'Food').forEach(l => {
    foodTotalsByDate[l.expenseDate] = (foodTotalsByDate[l.expenseDate] || 0) + (Number(l.amount) || 0);
  });
  const dailyFoodTotalsLine = Object.keys(foodTotalsByDate).sort().map(date =>
    `<div>Daily Total Food for ${formatDateDMY(date)}: <strong>${formatINRComma(foodTotalsByDate[date])}</strong></div>`
  ).join("");

  const peopleLine = (v.additionalPeople || []).length
    ? `<div style="font-size:0.8rem; color:var(--muted); margin-top:4px;">With: ${v.additionalPeople.map(escapeHtml).join(", ")}</div>` : "";
  const serviceReportLine = v.serviceReportUrl
    ? `<div style="font-size:0.8rem; margin-top:4px;">Service Report: <a href="${driveLink(v.serviceReportUrl)}" target="_blank" rel="noopener">${escapeHtml(v.serviceReportFileName || 'View')}</a></div>` : "";

  return `
    <div class="contact-summary-card-parent" id="tvc-card-${v.voucherId}">
      <div class="contact-summary-header-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='block'?'none':'block'" style="cursor:pointer; width:100%;">
        <div class="contact-summary-title-info" style="width:100%;">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <span style="background:var(--brand); color:#fff; padding:3px 8px; font-weight:700;">${escapeHtml(v.voucherNumber)}</span>
              <span style="margin-left:8px; font-weight:700;">${escapeHtml(v.employeeName)}</span>
              <span style="color:var(--muted); font-size:0.8rem; margin-left:6px;">${escapeHtml(v.departmentName || '—')}</span>
            </div>
            <span style="background:#cbd5e1; color:#1e293b; font-weight:700; font-size:0.8rem; padding:3px 8px;">Submitted: ${formatDateDMY(v.submittedDate)}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--muted); margin-top:6px;">
            ${escapeHtml(v.purposeOfVisit === 'Others' ? v.purposeOtherText : v.purposeOfVisit)} · ${escapeHtml(v.placeOfVisit)} ·
            ${formatDateDMY(v.visitStartDate)} to ${formatDateDMY(v.visitEndDate)} · Total Claimed: ${formatINRComma(v.totalAmount)}
          </div>
          ${peopleLine}${serviceReportLine}
        </div>
      </div>
      <div style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;">
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
            <thead><tr style="background:var(--highlight-bg); text-align:left;">
              <th style="padding:7px;">Sr No</th><th style="padding:7px;">Date</th><th style="padding:7px;">Type</th>
              <th style="padding:7px;">Uploaded Bill</th><th style="padding:7px; text-align:right;">Amount</th>
              <th style="padding:7px;">Actual Amount</th><th style="padding:7px;">Bill Checked?</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${dailyFoodTotalsLine ? `<div style="margin-top:12px; font-size:0.85rem; color:var(--muted);">${dailyFoodTotalsLine}</div>` : ""}
        <div style="display:flex; justify-content:flex-end; gap:24px; margin-top:14px; align-items:center; flex-wrap:wrap;">
          <div style="font-weight:700;">Total Voucher Actual Amount: <span id="tvc-actual-total-${v.voucherId}">${formatINRComma(v.totalAmount)}</span></div>
          <div style="font-weight:700;">Total Voucher Amount Difference: <span id="tvc-diff-${v.voucherId}">0</span></div>
          <button class="nav-btn-styled" onclick="submitTourVoucherCheck(${v.voucherId})">Submit</button>
        </div>
      </div>
    </div>`;
}

function tvcRecalcTotals(voucherId) {
  const card = document.getElementById(`tvc-card-${voucherId}`);
  if (!card) return;
  let claimedTotal = 0, actualTotal = 0;
  card.querySelectorAll("tbody tr").forEach(tr => {
    // Amount cell now renders comma-grouped (formatINRComma) — strip
    // commas before parsing, or "16,000" reads as NaN/16.
    const claimedCell = tr.children[4].textContent.replace(/,/g, '');
    claimedTotal += Number(claimedCell) || 0;
    const actualInput = tr.querySelector(".tvc-actual-input");
    actualTotal += Number(actualInput.value) || 0;
  });
  document.getElementById(`tvc-actual-total-${voucherId}`).textContent = formatINRComma(actualTotal);
  document.getElementById(`tvc-diff-${voucherId}`).textContent = formatINRComma(claimedTotal - actualTotal);
}

async function submitTourVoucherCheck(voucherId) {
  const card = document.getElementById(`tvc-card-${voucherId}`);
  const rows = [...card.querySelectorAll("tbody tr")];
  const lines = rows.map(tr => ({
    lineId: Number(tr.dataset.lineId),
    actualAmount: parseFloat(tr.querySelector(".tvc-actual-input").value),
    billChecked: tr.querySelector(".tvc-checked-input").checked,
  }));
  if (lines.some(l => !l.billChecked)) {
    return showTourFeedback("Every line's Bill Checked box must be ticked before you can submit.", "error");
  }
  if (lines.some(l => isNaN(l.actualAmount) || l.actualAmount < 0)) {
    return showTourFeedback("Every line needs a valid non-negative Actual Amount.", "error");
  }

  showBlockingOverlay("Submitting check...");
  try {
    const data = await acFetch("checkTourVoucher", { voucherId, lines });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("tvc-feed").innerHTML = `
        <div style="background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:20px; border-radius:var(--radius);">
          <strong>Voucher checked successfully.</strong><br/>
          Employee's new balance: <strong style="font-size:1.05rem;">${formatINRComma(data.newBalance)}</strong>
          <div style="margin-top:12px;">
            <button class="nav-btn-styled" onclick="loadVoucherCheckQueue()">+ Check New Tour Expense Vouchers</button>
          </div>
        </div>`;
    } else {
      showTourFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}
