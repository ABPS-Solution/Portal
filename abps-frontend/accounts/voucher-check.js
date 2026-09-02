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
      : l.noBillReason
        ? `<span style="color:var(--muted); font-style:italic;">Reason: ${escapeHtml(l.noBillReason)}</span>`
        : `<span style="color:var(--muted);">— no bill required —</span>`;
    const typeLabel = l.expenseType === 'Local Conveyance' && l.conveyanceMode ? `Local Conveyance (${escapeHtml(l.conveyanceMode)})`
      : l.expenseType === 'Others' && l.otherText ? `Others (${escapeHtml(l.otherText)})` : escapeHtml(l.expenseType);
    return `<tr style="border-bottom:1px solid var(--border);" data-line-id="${l.lineId}">
      <td style="padding:7px;">${l.srNo}</td>
      <td style="padding:7px;">${formatDateDMY(l.expenseDate)}</td>
      <td style="padding:7px;">${typeLabel}</td>
      <td style="padding:7px; width:14%; overflow-wrap:anywhere;">${billCell}</td>
      <td style="padding:7px; text-align:right;">${formatINRComma(l.amount)}</td>
      <td style="padding:7px 7px 7px 20px; width:26%; color:var(--muted);">${l.description ? escapeHtml(l.description) : '—'}</td>
      <td style="padding:7px;">
        <input type="number" class="tvc-actual-input" data-line-id="${l.lineId}"
              data-cap="${l.capAmount != null ? l.capAmount : l.amount}"
              value="${trimNum(l.capAmount != null ? l.capAmount : l.amount)}" min="0"
              style="width:100px; padding:5px; border:1px solid var(--border); border-radius:4px; text-align:right;"
              oninput="tvcRecalcTotals(${v.voucherId}); tvcCheckOverLimit(${l.lineId})">
        ${l.overLimitFlag ? `<div class="tvc-overlimit-badge" style="color:#b91c1c; font-size:0.7rem; font-weight:700; margin-top:2px;">Over daily limit by ${formatINRComma(l.overLimitAmount)}</div>` : ''}
        <textarea class="tvc-reason-input" data-line-id="${l.lineId}" placeholder="Reason for exceeding limit"
              style="display:none; width:140px; margin-top:4px; font-size:0.72rem; padding:4px; border:1px solid var(--border); border-radius:4px;"></textarea>
      </td>
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

  // Same pattern, for Local Conveyance.
  const conveyanceTotalsByDate = {};
  lines.filter(l => l.expenseType === 'Local Conveyance').forEach(l => {
    conveyanceTotalsByDate[l.expenseDate] = (conveyanceTotalsByDate[l.expenseDate] || 0) + (Number(l.amount) || 0);
  });
  const dailyConveyanceTotalsLine = Object.keys(conveyanceTotalsByDate).sort().map(date =>
    `<div>Daily Total Local Conveyance for ${formatDateDMY(date)}: <strong>${formatINRComma(conveyanceTotalsByDate[date])}</strong></div>`
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
        ${tvcRenderTicketPicker(v)}
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
            <thead><tr style="background:var(--highlight-bg); text-align:left;">
              <th style="padding:7px;">Sr No</th><th style="padding:7px;">Date</th><th style="padding:7px;">Type</th>
              <th style="padding:7px; width:14%;">Uploaded Bill</th><th style="padding:7px; text-align:right;">Amount</th>
              <th style="padding:7px 7px 7px 20px; width:26%;">Description</th>
              <th style="padding:7px;">Actual Amount</th><th style="padding:7px;">Bill Checked?</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${(dailyFoodTotalsLine || dailyConveyanceTotalsLine) ? `<div style="margin-top:12px; font-size:0.85rem; color:var(--muted);">${dailyFoodTotalsLine}${dailyConveyanceTotalsLine}</div>` : ""}
        <div style="display:flex; justify-content:flex-end; gap:24px; margin-top:14px; align-items:center; flex-wrap:wrap;">
          <div style="font-weight:700;">Total Voucher Actual Amount: <span id="tvc-actual-total-${v.voucherId}">${formatINRComma(v.totalAmount)}</span></div>
          <div style="font-weight:700;">Total Voucher Amount Difference: <span id="tvc-diff-${v.voucherId}">0</span></div>
          <button class="nav-btn-styled" onclick="submitTourVoucherCheck(${v.voucherId})">Submit</button>
        </div>
      </div>
    </div>`;
}

// Company-Paid Travel Tickets — this employee's Unactioned bookings,
// sorted by travel date (server order), with the ones overlapping this
// voucher's own visit window visually flagged. Checkboxes (not radio) —
// a voucher may link several tickets (outbound/return booked
// separately). No blocking validation: employee-claimed Travel lines and
// company-paid tickets can legitimately coexist on one voucher.
function tvcRenderTicketPicker(v) {
  const candidates = v.linkableTravelTickets || [];
  if (candidates.length === 0) return "";
  // CSS Grid, not flex/label — a checkbox+flex-content+price row built
  // with <label>/bare <span> here was collapsing the middle column to a
  // sliver in production (root cause never pinned down); grid with an
  // explicit minmax(0,1fr) track can't do that, so it's rebuilt on that
  // instead of chasing the original layout further.
  const rows = candidates.map(t => {
    const dateCell = t.tripType === 'Round Trip' && t.returnDate
      ? `${formatDateDMY(t.departDate)} → ${formatDateDMY(t.returnDate)}` : formatDateDMY(t.departDate);
    const overlapBadge = t.overlapsVisit
      ? `<div style="display:inline-block; background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;">Matches visit dates</div>`
      : `<div style="display:inline-block; background:#f1f5f9; color:var(--muted); padding:2px 8px; border-radius:10px; font-size:0.72rem;">Outside visit window</div>`;
    const metaBits = [dateCell, t.pnrNumber ? `PNR: ${escapeHtml(t.pnrNumber)}` : null].filter(Boolean).join(' · ');
    return `<div class="tvc-ticket-row" onclick="tvcToggleTicketRow(event, ${t.travellerId})"
        style="display:grid; grid-template-columns:24px minmax(0,1fr) auto; align-items:center; column-gap:12px;
               padding:10px 12px; border:1px solid ${t.overlapsVisit ? '#86efac' : 'var(--border)'}; border-radius:6px;
               margin-bottom:8px; cursor:pointer; background:${t.overlapsVisit ? '#f0fdf4' : '#fff'};">
      <input type="checkbox" class="tvc-ticket-input" data-traveller-id="${t.travellerId}" onclick="event.stopPropagation();" style="width:16px; height:16px; margin:0;">
      <div style="min-width:0;">
        <div style="font-weight:700; overflow-wrap:break-word;">${escapeHtml(t.modeOfTravel)}: ${escapeHtml(t.fromCity)} → ${escapeHtml(t.toCity)}</div>
        <div style="color:var(--muted); font-size:0.82rem; margin-top:2px;">${metaBits}</div>
        <div style="margin-top:4px;">${overlapBadge}</div>
      </div>
      <div style="font-weight:700; white-space:nowrap;">${formatINRComma(t.price)}</div>
    </div>`;
  }).join("");
  return `
    <div style="margin-bottom:14px; padding:12px; background:var(--highlight-bg); border-radius:var(--radius);">
      <div style="font-weight:700; margin-bottom:8px;">Company-Paid Travel Tickets</div>
      <div style="font-size:0.8rem; color:var(--muted); margin-bottom:8px; font-style:italic;">
        Recorded on the voucher for the record. Not added to Total Actual Amount and not paid to the employee.
      </div>
      ${rows}
    </div>`;
}

// Clicking anywhere on a ticket row toggles its checkbox — the checkbox
// itself already stops propagation so this doesn't double-toggle.
function tvcToggleTicketRow(event, travellerId) {
  const cb = document.querySelector(`.tvc-ticket-input[data-traveller-id="${travellerId}"]`);
  if (cb) cb.checked = !cb.checked;
}

// Position-based daily expense limit (migration 167) — shows/hides the
// per-row reason box live as the checker edits Actual, comparing against
// this row's FIXED cap (data-cap, computed server-side from the claimed
// amount at queue-fetch time — never recomputed client-side).
function tvcCheckOverLimit(lineId) {
  const input = document.querySelector(`.tvc-actual-input[data-line-id="${lineId}"]`);
  const reasonBox = document.querySelector(`.tvc-reason-input[data-line-id="${lineId}"]`);
  if (!input || !reasonBox) return;
  const cap = Number(input.dataset.cap);
  const val = Number(input.value) || 0;
  reasonBox.style.display = val > cap ? "block" : "none";
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
  const lines = rows.map(tr => {
    const actualInput = tr.querySelector(".tvc-actual-input");
    const reasonInput = tr.querySelector(".tvc-reason-input");
    return {
      lineId: Number(tr.dataset.lineId),
      actualAmount: parseFloat(actualInput.value),
      billChecked: tr.querySelector(".tvc-checked-input").checked,
      overLimitReason: reasonInput ? reasonInput.value.trim() : "",
      _cap: Number(actualInput.dataset.cap),
    };
  });
  if (lines.some(l => !l.billChecked)) {
    return showTourFeedback("Every line's Bill Checked box must be ticked before you can submit.", "error");
  }
  if (lines.some(l => isNaN(l.actualAmount) || l.actualAmount < 0)) {
    return showTourFeedback("Every line needs a valid non-negative Actual Amount.", "error");
  }
  // Position-based daily expense limit — client-side pre-check, mirrors
  // (does not replace) the authoritative server-side check.
  if (lines.some(l => l.actualAmount > l._cap && !l.overLimitReason)) {
    return showTourFeedback("One or more lines exceed their position-based daily limit cap — a reason is required before this voucher can be submitted.", "error");
  }
  const linesToSend = lines.map(({ _cap, ...l }) => l);

  const travellerIds = [...card.querySelectorAll(".tvc-ticket-input:checked")].map(cb => Number(cb.dataset.travellerId));

  showBlockingOverlay("Submitting check...");
  try {
    const data = await acFetch("checkTourVoucher", { voucherId, lines: linesToSend, travellerIds });
    hideBlockingOverlay();
    if (data.success) {
      const pdfLine = data.pdfUrl
        ? `<div style="margin-top:8px;"><a href="${driveLink(data.pdfUrl)}" target="_blank" rel="noopener" style="color:#15803d; font-weight:700;">Download Voucher PDF</a></div>` : '';
      document.getElementById("tvc-feed").innerHTML = `
        <div style="background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:20px; border-radius:var(--radius);">
          <strong>Voucher checked successfully${data.employeeName ? ' for ' + escapeHtml(data.employeeName) : ''}.</strong><br/>
          ${escapeHtml(data.employeeName || 'Employee')}'s new balance: <strong style="font-size:1.05rem;">${formatINRComma(data.newBalance)}</strong>
          ${pdfLine}
          <div style="margin-top:12px;">
            <button class="nav-btn-styled" onclick="loadVoucherCheckQueue()">+ Check New Tour Expense Vouchers</button>
          </div>
        </div>`;
    } else {
      showTourFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}
