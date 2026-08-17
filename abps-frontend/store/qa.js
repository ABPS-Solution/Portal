function exitCanvasToCardView() {
  collapseNewEntryDropdownFormExplicitly();
  document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
  document.getElementById("step2-inline-interaction-canvas").style.display = "none";
  document.getElementById("missing-trigger-notice-block").style.display = "none";
  if (currentActiveModuleContext === "CARD") {
    document.getElementById("step1-card-capture-block").style.display = "block";
  } else if (currentActiveModuleContext === "DROPDOWN") {
    document.getElementById("company-dropdown-selector-block").style.display = "block";
    triggerCompanyDropdownArrayFetch();
  } else {
    // FILTERS context — show the search form in whichever workspace last had results
    const filterInputMap = {
      "workspace-searchStatus":        "status-search-section",
      "workspace-searchEngineer":      "engineer-search-section",
      "workspace-searchQualification": "qualification-search-section",
      "workspace-searchCityState":     "city-state-search-section"
    };
    const sectionId = filterInputMap[canvasLastParentWorkspaceId];
    if (sectionId && document.getElementById(sectionId)) {
      document.getElementById(sectionId).style.display = "block";
    }
  }
}

function toggleFollowUpAccordion(headerElement) {
  const bodyPanel = headerElement.closest('.fup-item-card').querySelector('.fup-item-body');
  const statusIndicator = headerElement.querySelector('span:last-child');
  if (bodyPanel.style.display === "block" || bodyPanel.style.display === "") {
    bodyPanel.style.display = "none"; if (statusIndicator) statusIndicator.textContent = "View details ▾";
  } else {
    bodyPanel.style.display = "block"; if (statusIndicator) statusIndicator.textContent = "Collapse details ▴";
  }
}

function renderIsolatedFollowUpTimeline(leadRef, list, scopeNode) {
  const box = scopeNode.querySelector(".template-timeline-box");
  box.innerHTML = list.length === 0 ? '<p style="color:var(--muted); font-size:0.85rem; padding:10px;">No Follow-up Records</p>' : '';
  
  list.forEach(f => {
    let card = document.createElement("div"); card.className = "fup-item-card";
    const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
    const deleteActionHtml = isAdminUser 
      ? `<button class="nav-btn-styled" id="trigger-inner-delete-fup-${leadRef}-${f.num}" style="font-size:0.7rem; background:var(--warn); padding:4px 8px;">Delete Follow-Up</button>` 
      : `<span id="trigger-inner-delete-fup-${leadRef}-${f.num}" style="display:none;"></span>`;

    card.innerHTML = `
      <div class="fup-item-header" onclick="toggleFollowUpAccordion(this)">
        <span>Follow-Up ${f.num} (${formatCleanDateOnly(f.date)} ${cleanISTTimestamp(f.time)})</span>
        <span style="color:var(--brand); font-size:0.75rem;">View details ▾</span>
      </div>
      <div class="fup-item-body">
        <div style="font-size:0.82rem; line-height:1.5; color:var(--muted); margin-bottom:6px;">
          <strong>Status:</strong> ${f.status}<br/><strong>Lead ID:</strong> ${f.leadId}<br/><strong>ABPS Engineer Name:</strong> ${f.eng}<br/>
          <strong>Next Follow-Up Date:</strong> ${formatCleanDateOnly(f.nextDate)} | <strong>Time:</strong> ${f.nextTime || "None"}<br/>
          <strong>Outcome:</strong> ${f.outcome || "—"} | <strong>Mode:</strong> ${f.mode || "—"}<br/>
          <strong>Next Action:</strong> ${f.nextActionType || "—"} | <strong>Objection:</strong> ${f.objectionRaised || "—"}
        </div>
        <div style="font-size:0.85rem; color:#2d3748; padding:6px 0; border-top:1px solid #edf2f7; word-wrap:break-word; overflow-wrap:break-word; white-space:pre-wrap;"><strong>Notes:</strong> ${f.notes}</div>
        <div style="margin-top:8px; display:flex; gap:8px;">
          <button class="nav-btn-styled" id="trigger-inner-edit-fup-${leadRef}-${f.num}" style="font-size:0.7rem; padding:4px 8px;">Edit</button>
          ${deleteActionHtml}
        </div>
      </div>`;
    box.appendChild(card);
    
    // Guard event attachments to prevent null runtime reference crashes
    if (isAdminUser && document.getElementById(`trigger-inner-delete-fup-${leadRef}-${f.num}`)) {
      document.getElementById(`trigger-inner-delete-fup-${leadRef}-${f.num}`).onclick = function(e) { removeIsolatedFollowUpItem(leadRef, f.num, e); };
    }
    document.getElementById('trigger-inner-edit-fup-' + leadRef + '-' + f.num).onclick = function() { editIsolatedFollowUpItem(leadRef, scopeNode, f); };
    document.getElementById('trigger-inner-delete-fup-' + leadRef + '-' + f.num).onclick = function(e) { removeIsolatedFollowUpItem(leadRef, f.num, e); };
  });
}

function editIsolatedFollowUpItem(leadRef, scopeNode, f) {
  const fupForm = scopeNode.querySelector(".template-fup-form");
  fupForm.querySelector(".fup-is-edit-flag").value = "true";
  fupForm.querySelector(".fup-status-select").value = f.status;
  fupForm.querySelector(".fup-num-input").value = f.num;
  fupForm.querySelector(".fup-leadid-input").value = leadRef;
  fupForm.querySelector(".fup-eng-select").value = f.eng;
  fupForm.querySelector(".fup-notes-input").value = f.notes;
  fupForm.querySelector(".fup-nexttarget-input").value = formatCleanDateOnly(f.nextDate);
  fupForm.querySelector(".fup-nexttime-select").value = f.nextTime || "Morning";
  
  fupForm.querySelector(".fup-outcome-select").value = f.outcome || "";
  fupForm.querySelector(".fup-mode-select").value = f.mode || "";
  fupForm.querySelector(".fup-nextaction-input").value = f.nextActionType || "";
  fupForm.querySelector(".fup-objection-input").value = f.objectionRaised || "";
  fupForm.style.display = "grid"; scopeNode.querySelector(".trigger-fup-open").style.display = "none"; scopeNode.querySelector(".trigger-fup-close").style.display = "inline-flex";
  const fupLabelEdit = scopeNode.querySelector(".fup-status-label"); if (fupLabelEdit) fupLabelEdit.style.display = "inline";
}

async function renderStoreEntryRejectionBanner(cardEl, gateNum, vendorName, lineItems) {
  if (!vendorName) return;
  try {
    const data = await apFetch({ action: "fetchOpenRejectionsForVendor", vendorName: vendorName });
    if (!data.success || !data.openRejections || data.openRejections.length === 0) return;

    const bannerEl = cardEl.querySelector(`.se-rejection-banner-${gateNum}`);
    if (!bannerEl) return;

    const rows = data.openRejections.map((r, idx) => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #fde68a;">
        <input type="checkbox" id="se-rej-check-${gateNum}-${idx}" onchange="toggleGateRejectionLink('${r.rejectionId}', this.checked, '${r.itemCode}', '${(r.materialName||'').replace(/'/g,"\\'")}',  '${r.unitType}', ${r.outstandingQuantity}, '${gateNum}', ${idx})" />
        <label for="se-rej-check-${gateNum}-${idx}" style="flex:1; font-size:0.85rem;">
          <strong>${r.materialName}</strong> (${r.itemCode}) — ${r.action || "Pending action"} — Pending Qty: ${r.outstandingQuantity} ${r.unitType}
          ${lineItems.some(li => (li.itemCode||'').toUpperCase() === r.itemCode.toUpperCase()) ? '' : '<span style="color:#b91c1c; font-weight:700;"> (no matching item code on this delivery)</span>'}
        </label>
        <input type="number" min="0" max="${r.outstandingQuantity}" placeholder="Qty" style="width:80px;" disabled
               id="se-rej-qty-${gateNum}-${idx}" onchange="updateGateRejectionLinkQty('${r.rejectionId}', this.value)" />
      </div>`).join("");

    bannerEl.style.cssText = "display:block; margin:10px 0; background:#fffbeb; border-left:4px solid #d97706; padding:14px; border-radius:var(--radius);";
    bannerEl.innerHTML = `
      <div style="font-weight:700; color:#92400e; margin-bottom:8px;">This vendor has open repair/replacement items — link any that this delivery resolves:</div>
      ${rows}`;
  } catch(e) { /* non-fatal, banner just stays empty */ }
}

function toggleGateRejectionLink(rejectionId, checked, itemCode, materialName, unitType, outstandingQty, gateNum, idx) {
  const qtyInput = document.getElementById(`se-rej-qty-${gateNum}-${idx}`);
  if (qtyInput) { qtyInput.disabled = !checked; if (checked && !qtyInput.value) qtyInput.value = outstandingQty; }
  if (checked) {
    window.activeGateRejectionLinks[rejectionId] = { linkedQty: outstandingQty, itemCode, materialName, unitType };
  } else {
    delete window.activeGateRejectionLinks[rejectionId];
  }
}

function updateGateRejectionLinkQty(rejectionId, val) {
  if (window.activeGateRejectionLinks[rejectionId]) {
    window.activeGateRejectionLinks[rejectionId].linkedQty = parseFloat(val) || 0;
  }
}

function updateSERowAmounts(gateNumber, idx) {
  const qtyInput  = document.querySelector(`.se-phys-qty-${gateNumber}[data-idx="${idx}"]`);
  const rateInput = document.querySelector(`.se-rate-${gateNumber}[data-idx="${idx}"]`);
  const gstInput  = document.querySelector(`.se-gst-${gateNumber}[data-idx="${idx}"]`);
  const basicHidden = document.querySelector(`.se-basic-amt-${gateNumber}[data-idx="${idx}"]`);
  const invHidden    = document.querySelector(`.se-inv-amt-${gateNumber}[data-idx="${idx}"]`);
  const displaySpan  = document.querySelector(`.se-amount-display-${gateNumber}[data-idx="${idx}"]`);

  const qty  = parseFloat(qtyInput?.value)  || 0;
  const rate = parseFloat(rateInput?.value) || 0;
  const gst  = parseFloat(gstInput?.value)  || 0;

  const basicAmt = qty * rate;
  const invAmt   = basicAmt * (1 + gst / 100);

  if (basicHidden) basicHidden.value = basicAmt.toFixed(2);
  if (invHidden) invHidden.value = invAmt.toFixed(2);
  if (displaySpan) displaySpan.textContent = invAmt.toLocaleString("en-IN",{maximumFractionDigits:2});
}

async function checkVendorOpenRejections() {
  const banner = document.getElementById('gate-vendor-rejection-banner');
  const vendorName = document.getElementById('gate-meta-vendor').value.trim();
  if (!vendorName) { banner.style.display = "none"; banner.innerHTML = ""; return; }

  try {
    const data = await apFetch({ action: "fetchOpenRejectionsForVendor", vendorName: vendorName });
    if (!data.success || !data.openRejections || data.openRejections.length === 0) {
      banner.style.display = "none";
      banner.innerHTML = "";
      return;
    }

    const rows = data.openRejections.map(r => `
      <div style="padding:4px 0; font-size:0.85rem;">
        <strong>${r.materialName}</strong> (${r.itemCode}) — ${r.action || "Pending action"} — Pending Qty: ${r.outstandingQuantity} ${r.unitType}
      </div>`).join("");

    banner.style.cssText = "display:block; margin-bottom:16px; background:#fffbeb; border-left:4px solid #d97706; padding:14px; border-radius:var(--radius);";
    banner.innerHTML = `
      <div style="font-weight:700; color:#92400e; margin-bottom:8px;">Heads up — this vendor has open repair/replacement items. You'll be able to link them once item codes are matched at Store Entry.</div>
      ${rows}`;
  } catch(e) { banner.style.display = "none"; }
}

function handleQARevVendorSearch(query) {
  clearTimeout(qaRevVendorDebounce);
  const drop = document.getElementById("qarev-vendor-drop");
  if (!query || query.trim().length < 1) { if (drop) drop.style.display = "none"; return; }
  qaRevVendorDebounce = setTimeout(async () => {
    try {
      const data = await apFetch({ action: "searchVendorNamesForRejectedMaterial", query });
      if (!drop) return;
      if (!data.success || !data.vendors.length) { drop.style.display = "none"; return; }
      drop.innerHTML = data.vendors.map(v => `<div onclick="document.getElementById('qarev-vendor').value='${v.replace(/'/g,"\\'")}'; document.getElementById('qarev-vendor-drop').style.display='none';" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${v}</div>`).join("");
      drop.style.display = "block";
    } catch(e) { if (drop) drop.style.display = "none"; }
  }, 250);
}

async function runQARevisionSearch() {
  const zone = document.getElementById("qarev-results");
  zone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Searching...</div>`;
  try {
    const data = await apFetch({
      action: "fetchQARevisionSearch",
      grnNumber: document.getElementById("qarev-grn").value.trim(),
      vendorName: document.getElementById("qarev-vendor").value.trim(),
      productName: document.getElementById("qarev-product").value.trim(),
      qaDateFrom: document.getElementById("qarev-date-from").value,
      qaDateTo: document.getElementById("qarev-date-to").value,
    });
    if (!data.success) { zone.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }
    if (!data.results.length) { zone.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">No Q/A-completed GRNs match this search.</div>`; return; }
    zone.innerHTML = data.results.map(r => `
      <div class="contact-summary-card-parent" style="margin-bottom:10px;">
        <div onclick="openQARevisionDetail('${r.grnNumber}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding:4px;">
          <div>
            <span style="background:#dcfce7; color:#15803d; font-weight:700; padding:3px 8px;">${r.grnNumber}</span>
            <span style="background:#edf2f7; color:var(--text); margin-left:4px; font-weight:700; padding:3px 8px;">Vendor: ${r.vendorName}</span>
            ${r.poNo ? `<span style="background:#e0f2fe; color:#0369a1; margin-left:4px; font-weight:700; padding:3px 8px;">PO: ${r.poNo}</span>` : ''}
          </div>
          <div style="font-size:0.78rem; color:var(--muted); font-weight:600;">${r.lineCount} line(s) · Q/A by ${r.qaPerson || '—'} · ${formatDateTimeDMY(r.qaTimestamp)}</div>
        </div>
        <div id="qarev-detail-${r.grnNumber}" style="display:none; padding-top:12px; margin-top:10px; border-top:1px dashed var(--border);"></div>
      </div>`).join("");
  } catch(e) { zone.innerHTML = `<p style="color:var(--warn);">${e.message}</p>`; }
}

async function openQARevisionDetail(grnNumber) {
  const zone = document.getElementById(`qarev-detail-${grnNumber}`);
  if (!zone) return;
  if (zone.style.display === "block") { zone.style.display = "none"; return; }
  zone.style.display = "block";
  zone.innerHTML = `<div style="text-align:center; padding:14px; color:var(--muted);">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchQARevisionDetail", grnNumber });
    if (!data.success) { zone.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }
    window[`qaRevData_${grnNumber}`] = data.lineItems;
    const blocked = (data.blockers || []).length > 0;

    const trs = data.lineItems.map((line, idx) => {
      const recvd = parseFloat(line.quantityReceived) || 0;
      return `<tr style="border-bottom:1px solid #f1f5f9; vertical-align:middle;">
        <td style="width:110px; padding:6px;"><input type="text" class="qarev-item-code-${grnNumber}" data-idx="${idx}" value="${line.itemCode}" readonly style="font-size:0.78rem; padding:5px 4px; font-weight:800; border:1.5px solid #86efac; text-align:center; width:100%; background:#f0fdf4; color:var(--brand); border-radius:3px;"></td>
        <td style="padding:8px; font-size:0.78rem; color:#64748b; min-width:180px; max-width:220px; line-height:1.4; word-break:break-word;">${(line.invoiceDescription || '').replace(/</g,'&lt;').replace(/>/g,'&gt;') || "—"}</td>
        <td style="padding:6px; min-width:220px;">
          <div class="qarev-name-display-${grnNumber}" data-idx="${idx}" ${blocked?'':`onclick="reopenQARevMaterialSearch('${grnNumber}', ${idx})"`} style="cursor:${blocked?'default':'pointer'}; font-size:0.85rem; font-weight:700; color:var(--brand); padding:5px 6px; border:1.5px solid var(--accent); border-radius:3px; background:#f0fdf4;"><span>${(line.materialName||'').replace(/</g,'&lt;')}</span>${blocked?'':' <span style="font-size:0.65rem; color:var(--muted);">✎ change</span>'}</div>
          <input type="hidden" class="qarev-mat-name-${grnNumber}" data-idx="${idx}" value="${(line.materialName||'').replace(/"/g,'&quot;')}" />
          <input type="hidden" class="qarev-unit-${grnNumber}" data-idx="${idx}" value="${line.unitType||'NOS'}" />
          <div style="position:relative; margin-top:4px;">
            <input type="text" id="qarev-search-${grnNumber}-${idx}" placeholder="Search to change..." oninput="handleQARevNameSearch(this, '${grnNumber}', ${idx})" autocomplete="off" style="font-size:0.78rem; padding:4px 6px; border:1px solid var(--border); width:100%; border-radius:3px; display:none;" />
            <div id="qarev-drop-${grnNumber}-${idx}" style="display:none; position:fixed; background:#fff; border:1px solid var(--border); border-radius:4px; z-index:9999; max-height:180px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:240px;"></div>
          </div>
        </td>
        <td style="width:55px; padding:6px; text-align:center; font-family:monospace; font-weight:700;">${line.unitType}</td>
        <td style="width:70px; padding:6px; text-align:center; font-weight:700;">${recvd}</td>
        <td style="width:70px; padding:6px;"><input type="number" min="0" class="qarev-ok-${grnNumber}" data-idx="${idx}" data-max="${recvd}" value="${parseFloat(line.okQuantity)||0}" ${blocked?'disabled':''} oninput="autoBalanceQARevQuantities(this, '${grnNumber}', ${idx})" style="width:100%; border:1.5px solid var(--brand); font-weight:700; text-align:center; padding:5px 2px; border-radius:3px;"></td>
        <td style="width:70px; padding:6px;"><input type="number" min="0" class="qarev-notok-${grnNumber}" data-idx="${idx}" value="${parseFloat(line.notOkQuantity)||0}" readonly style="width:100%; border:1.5px solid #f59e0b; font-weight:700; text-align:center; padding:5px 2px; border-radius:3px; background:#fffbeb;"></td>
        <td style="min-width:140px; padding:6px;"><input type="text" class="qarev-reason-${grnNumber}" data-idx="${idx}" value="${(line.reasonForNotOk||'').replace(/"/g,'&quot;')}" ${blocked?'disabled':''} placeholder="Reason..." style="width:100%; font-size:0.78rem; padding:5px 6px; border:1px solid var(--border); border-radius:3px;"></td>
        <td style="min-width:170px; padding:6px;">
          <select class="qarev-action-${grnNumber}" data-idx="${idx}" ${blocked?'disabled':''} style="width:100%; font-size:0.76rem; padding:4px 2px;">
            <option value="">-- Select --</option>
            <option value="Return to Vendor for Replacement" ${line.actionForRejectedMaterial==='Return to Vendor for Replacement'?'selected':''}>Return to Vendor for Replacement</option>
            <option value="Return to Vendor for Repair" ${line.actionForRejectedMaterial==='Return to Vendor for Repair'?'selected':''}>Return to Vendor for Repair</option>
            <option value="Ask Vendor to repair at ABPS" ${line.actionForRejectedMaterial==='Ask Vendor to repair at ABPS'?'selected':''}>Ask Vendor to repair at ABPS</option>
            <option value="Ask ABPS to Repair at ABPS" ${line.actionForRejectedMaterial==='Ask ABPS to Repair at ABPS'?'selected':''}>Ask ABPS to Repair at ABPS</option>
          </select>
        </td>
      </tr>`;
    }).join("");

    zone.innerHTML = `
      ${blocked ? `<div style="background:#fef2f2; border-left:4px solid #b91c1c; padding:12px; margin-bottom:12px; border-radius:4px;">
        <div style="font-weight:800; color:#b91c1c; margin-bottom:6px;">This GRN can no longer be revised automatically</div>
        <ul style="margin:0; padding-left:18px; font-size:0.82rem; color:#7f1d1d;">${data.blockers.map(b => `<li>${b}</li>`).join("")}</ul>
        <div style="font-size:0.78rem; color:#7f1d1d; margin-top:8px;">Downstream activity has already moved past this Q/A. Correct it with a manual stock adjustment instead.</div>
      </div>` : ''}
      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
        <table class="store-basket-data-table" style="width:100%; border-collapse:collapse;">
          <thead><tr style="background:#f8fafc;">
            <th style="width:110px; text-align:center; font-size:0.72rem; padding:8px 6px;">Item Code</th>
            <th style="text-align:left; font-size:0.72rem; padding:8px 6px;">Invoice Material Description</th>
            <th style="text-align:left; font-size:0.72rem; padding:8px 6px;">Standard Material Name</th>
            <th style="width:80px; text-align:center; font-size:0.72rem; padding:8px 6px;">Item Code Unit</th>
            <th style="width:70px; text-align:center; font-size:0.72rem; padding:8px 6px;">Received</th>
            <th style="width:70px; text-align:center; font-size:0.72rem; padding:8px 6px;">OK Qty</th>
            <th style="width:70px; text-align:center; font-size:0.72rem; padding:8px 6px;">Not OK</th>
            <th style="text-align:left; font-size:0.72rem; padding:8px 6px;">Reason for Not OK</th>
            <th style="text-align:left; font-size:0.72rem; padding:8px 6px;">Action for Rejected</th>
          </tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
      ${blocked ? '' : `<div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <button class="nav-btn-styled" style="background:var(--brand);" onclick="commitQARevisionToBackend('${grnNumber}', this)">Submit Q/A Revision</button>
      </div>`}`;
  } catch(e) { zone.innerHTML = `<p style="color:var(--warn);">${e.message}</p>`; }
}

function autoBalanceQARevQuantities(okInput, grnNum, idx) {
  const max = parseFloat(okInput.dataset.max) || 0;
  let okVal = parseFloat(okInput.value) || 0;
  if (okVal > max) { okVal = max; okInput.value = max; }
  if (okVal < 0) { okVal = 0; okInput.value = 0; }
  const notOk = document.querySelector(`.qarev-notok-${grnNum}[data-idx="${idx}"]`);
  if (notOk) notOk.value = Math.round((max - okVal) * 1000) / 1000;
}

function reopenQARevMaterialSearch(grnNum, idx) {
  const disp = document.querySelector(`.qarev-name-display-${grnNum}[data-idx="${idx}"]`);
  const search = document.getElementById(`qarev-search-${grnNum}-${idx}`);
  if (disp) disp.style.display = "none";
  if (search) { search.style.display = "block"; search.value = ""; search.focus(); }
}

function handleQARevNameSearch(inputEl, grnNum, idx) {
  const query = inputEl.value.trim().toLowerCase();
  const dropdown = document.getElementById(`qarev-drop-${grnNum}-${idx}`);
  const catalog = window.itemCodeCatalogCache || [];
  if (!dropdown) return;
  const rect = inputEl.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + 2) + "px";
  dropdown.style.left = rect.left + "px";
  dropdown.style.width = rect.width + "px";
  if (query.length < 2) { dropdown.style.display = "none"; return; }
  const matches = catalog.filter(c => (c.productName || "").toLowerCase().includes(query)).slice(0, 10);
  if (!matches.length) { dropdown.innerHTML = `<div style="padding:8px 10px; font-size:0.78rem; color:var(--muted);">No match found</div>`; dropdown.style.display = "block"; return; }
  dropdown.innerHTML = matches.map(c => `
    <div onclick="selectQARevNameMatch('${grnNum}', ${idx}, '${c.itemCode}', '${(c.combinedName || c.productName).replace(/'/g,"\\'")}', '${(c.unit || 'NOS').replace(/'/g,"\\'")}')"
      style="padding:7px 10px; cursor:pointer; font-size:0.78rem; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; gap:8px;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:600;">${c.combinedName || c.productName}</span>
      <span style="font-size:0.7rem; color:var(--muted); background:#f1f5f9; padding:2px 6px; border-radius:3px;">${c.itemCode}</span>
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectQARevNameMatch(grnNum, idx, itemCode, productName, unit) {
  const codeInput = document.querySelector(`.qarev-item-code-${grnNum}[data-idx="${idx}"]`);
  const nameInput = document.querySelector(`.qarev-mat-name-${grnNum}[data-idx="${idx}"]`);
  const unitInput = document.querySelector(`.qarev-unit-${grnNum}[data-idx="${idx}"]`);
  const disp = document.querySelector(`.qarev-name-display-${grnNum}[data-idx="${idx}"]`);
  if (codeInput) codeInput.value = itemCode;
  if (nameInput) nameInput.value = productName;
  if (unitInput) unitInput.value = unit || "NOS";
  if (disp) { disp.querySelector("span").textContent = productName; disp.style.display = "block"; }
  const search = document.getElementById(`qarev-search-${grnNum}-${idx}`);
  const drop = document.getElementById(`qarev-drop-${grnNum}-${idx}`);
  if (search) search.style.display = "none";
  if (drop) drop.style.display = "none";
}

document.addEventListener("click", function(e) {
  if (!e.target.id || !e.target.id.startsWith("qarev-search-")) {
    document.querySelectorAll("[id^='qarev-drop-']").forEach(d => d.style.display = "none");
  }
});

async function commitQARevisionToBackend(grnNumber, btn) {
  const original = window[`qaRevData_${grnNumber}`] || [];
  const lineItems = original.map((line, idx) => {
    const g = (cls) => document.querySelector(`.${cls}-${grnNumber}[data-idx="${idx}"]`);
    return {
      ledgerId: line.ledgerId,
      itemCode: g('qarev-item-code').value.trim(),
      materialName: g('qarev-mat-name').value.trim(),
      invoiceDescription: line.invoiceDescription,
      unitType: g('qarev-unit').value.trim(),
      quantityReceived: parseFloat(line.quantityReceived) || 0,
      okQuantity: parseFloat(g('qarev-ok').value) || 0,
      notOkQuantity: parseFloat(g('qarev-notok').value) || 0,
      reasonForNotOk: g('qarev-reason').value.trim(),
      actionForRejectedMaterial: g('qarev-action').value,
    };
  });

  for (const li of lineItems) {
    if (li.notOkQuantity > 0 && !li.actionForRejectedMaterial) {
      alert(`Action for Rejected Material is required for ${li.itemCode}.`);
      return;
    }
  }
  if (!confirm(`This will reverse the original Q/A for ${grnNumber} and re-apply it with these values across stock, PRN, PO, PPS and assignments. Continue?`)) return;

  btn.disabled = true; btn.textContent = "Submitting...";
  showBlockingOverlay("Revising Q/A...");
  try {
    const data = await apFetch({ action: "commitQARevision", payload: { grnNumber, lineItems }, operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (data.success) {
      alert("Q/A revision applied successfully.");
      runQARevisionSearch();
    } else {
      alert("Server Error: " + data.error);
      btn.disabled = false; btn.textContent = "Submit Q/A Revision";
    }
  } catch(e) {
    hideBlockingOverlay();
    alert("Network request execution failure: " + e.message);
    btn.disabled = false; btn.textContent = "Submit Q/A Revision";
  }
}

async function initializeStoreGrnWorkspaceQueue(toggle) {
  window.activeQAToggle = toggle || window.activeQAToggle || "pending";
  const feed = document.getElementById("store-grn-queue-cards-feed");

  const toggleBar = `
    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button class="nav-btn-styled" onclick="initializeStoreGrnWorkspaceQueue('pending')" style="background:${window.activeQAToggle==='pending' ? 'var(--brand)' : '#e2e8f0'}; color:${window.activeQAToggle==='pending' ? '#fff' : '#334155'}; font-weight:700;">Pending Q/A</button>
      <button class="nav-btn-styled" onclick="initializeStoreGrnWorkspaceQueue('repair')" style="background:${window.activeQAToggle==='repair' ? 'var(--brand)' : '#e2e8f0'}; color:${window.activeQAToggle==='repair' ? '#fff' : '#334155'}; font-weight:700;">Being Repaired at ABPS</button>
      <button class="nav-btn-styled" onclick="initializeStoreGrnWorkspaceQueue('revision')" style="background:${window.activeQAToggle==='revision' ? 'var(--brand)' : '#e2e8f0'}; color:${window.activeQAToggle==='revision' ? '#fff' : '#334155'}; font-weight:700;">Q/A Revision</button>
    </div>`;

  feed.innerHTML = toggleBar + `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); gap:12px; color:var(--accent);">
      <div class="spinner" style="width:28px; height:28px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <span style="font-size:0.9rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Loading...</span>
    </div>`;

  try {
    if (window.activeQAToggle === 'revision') { await renderQARevisionSearchPanel(feed, toggleBar); return; }
    const data = await apFetch({ action: "fetchStoreQAQueue", toggle: window.activeQAToggle });
    if (!data.success || !data.queue || data.queue.length === 0) {
      feed.innerHTML = toggleBar + `<div style="text-align:center;padding:30px;color:var(--muted);background:#fff;border:1px solid var(--border);border-radius:6px;">${window.activeQAToggle === 'repair' ? 'No materials currently being repaired at ABPS.' : 'No records waiting for Q/A.'}</div>`;
      return;
    }

    feed.innerHTML = toggleBar;

    data.queue.forEach(item => {
      let trs = "";

      if (window.activeQAToggle === "repair") {
        item.lineItems.forEach((line, idx) => {
          trs += `<tr style="border-bottom:1px solid #f1f5f9; vertical-align:middle;">
            <td style="width:9%; padding:8px 6px; text-align:center; font-weight:700; font-family:monospace;">${line.itemCode}</td>
            <td style="width:26%; padding:8px 6px; font-size:0.85rem;">${(line.materialName || "").replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
            <td style="width:18%; padding:8px 6px; font-size:0.78rem; color:#64748b;">${line.action}</td>
            <td style="width:7%; padding:8px 6px; text-align:center; font-family:monospace; font-weight:700;">${line.unitType}</td>
            <td style="width:10%; padding:8px 6px; text-align:center; font-weight:700;">${line.notOkQuantity}</td>
            <td style="width:10%; padding:8px 6px; text-align:center; font-weight:700;">${line.outstandingQty}</td>
            <td style="width:20%; padding:8px 6px; text-align:center;">
              <input type="number" min="0" max="${line.outstandingQty}" class="repair-qty-${item.grnNumber}" data-idx="${idx}" data-rejid="${line.rejectionId}" value="${line.outstandingQty}" style="width:100%; text-align:center; font-weight:700; border:1.5px solid var(--brand); padding:5px; border-radius:3px;">
            </td>
          </tr>`;
        });

        // Date/time badge — same source and formatting as the GRN card in Store Entry.
        let repairDateDisplay = formatDateTimeDMY(item.invoiceDate);

        let card = document.createElement("div"); card.className = "contact-summary-card-parent";
        card.innerHTML = `
          <div class="contact-summary-header-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='block'?'none':'block'" style="cursor:pointer; width:100%;">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:8px;">
              <div>
                <span style="background:#dcfce7; color:#15803d; font-weight:700; padding:3px 8px;">${item.grnNumber}</span>
                <span style="background:#edf2f7; color:var(--text); margin-left:4px; font-weight:700;">Vendor: ${item.vendorName}</span>
              </div>
              ${repairDateDisplay ? `<span style="background:#cbd5e1; color:#1e293b; font-weight:700; font-size:0.8rem; padding:3px 8px;">${repairDateDisplay}</span>` : ''}
            </div>
          </div>
          <div style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;">
            <div style="overflow-x:auto; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius);">
              <table class="store-basket-data-table" style="width:100%; table-layout:fixed; border-collapse:collapse;">
                <thead><tr style="background:#f8fafc;">
                  <th style="width:9%; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Item Code</th>
                  <th style="width:26%; text-align:left; font-size:0.72rem; padding:8px 6px;">Standard Material Name</th>
                  <th style="width:18%; text-align:left; font-size:0.72rem; padding:8px 6px;">Action Selected</th>
                  <th style="width:9%; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Item Code Unit</th>
                  <th style="width:10%; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Total Not OK Qty</th>
                  <th style="width:10%; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Pending Qty</th>
                  <th style="width:20%; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Repaired Qty (assumed OK)</th>
                </tr></thead>
                <tbody>${trs}</tbody>
              </table>
            </div>
            <div style="display:flex; justify-content:flex-end;">
              <button class="nav-btn-styled" style="background:var(--brand);" onclick="commitRepairQAToBackend('${item.grnNumber}', this)">Confirm Repair Q/A & Add to Stock</button>
            </div>
          </div>`;
        feed.appendChild(card);

      } else {
        item.lineItems.forEach((line, idx) => {
          const recvd = parseInt(line.quantityReceived, 10) || 0;
          const searchId = `qa-search-${item.grnNumber}-${idx}`;
          const dropId   = `qa-drop-${item.grnNumber}-${idx}`;
          const matName  = (line.materialName || "").toString();
          trs += `<tr style="border-bottom:1px solid #f1f5f9; vertical-align:middle;">
            <td style="width:110px; padding:6px; vertical-align:middle;">
              <input type="text" class="qa-item-code-${item.grnNumber}" data-idx="${idx}" value="${line.itemCode}" readonly
                style="font-size:0.78rem; padding:5px 4px; font-weight:800; border:1.5px solid #86efac; text-align:center; width:100%; background:#f0fdf4; color:var(--brand); border-radius:3px;">
            </td>
            <td style="padding:8px; font-size:0.78rem; color:#64748b; white-space:normal; word-wrap:break-word; overflow-wrap:break-word; min-width:180px; max-width:220px; line-height:1.4; vertical-align:middle;">
              ${(line.invoiceDescription || "").replace(/</g,'&lt;').replace(/>/g,'&gt;') || "—"}
            </td>
            <td style="padding:6px; min-width:220px; vertical-align:middle;">
              <div class="qa-mat-name-display-${item.grnNumber}" data-idx="${idx}"
                onclick="reopenQAMaterialSearch('${item.grnNumber}', ${idx})"
                title="Click to correct the material match"
                style="display:flex; justify-content:space-between; align-items:center; gap:6px; cursor:pointer; font-size:0.85rem; font-weight:700; color:var(--brand); padding:5px 6px; min-height:30px; border:1.5px solid var(--accent); border-radius:3px; background:#f0fdf4; line-height:1.4;">
                <span>${matName.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
                <span style="font-size:0.65rem; font-weight:700; color:var(--muted); white-space:nowrap; flex-shrink:0;">✎ change</span>
              </div>
              <input type="hidden" class="qa-mat-name-${item.grnNumber}" data-idx="${idx}" value="${matName.replace(/"/g,'&quot;')}" />
              <div style="position:relative; margin-top:4px;">
                <input type="text" id="${searchId}"
                  placeholder="Search to change..."
                  oninput="handleQANameSearch(this, '${item.grnNumber}', ${idx})"
                  autocomplete="off"
                  style="font-size:0.78rem; padding:4px 6px; border:1px solid var(--border); width:100%; border-radius:3px; display:none;" />
                <div id="${dropId}" style="display:none; position:fixed; background:#fff; border:1px solid var(--border); border-radius:4px; z-index:9999; max-height:180px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:240px;"></div>
              </div>
            </td>
            <td style="width:55px; padding:6px; text-align:center; vertical-align:middle;">
              <input type="text" class="qa-unit-${item.grnNumber}" data-idx="${idx}" value="${line.unitType}" readonly
                style="width:100%; text-align:center; font-family:monospace; font-weight:700; border:none; background:transparent; color:#1e293b;">
            </td>
            <td style="width:70px; padding:6px; text-align:center; font-weight:700; vertical-align:middle;">${recvd}</td>
            <td style="width:70px; padding:6px; vertical-align:middle;">
              <input type="number" min="0" class="qa-ok-${item.grnNumber}" data-idx="${idx}" data-max="${recvd}" value="${recvd}" style="width:100%; border:1.5px solid var(--brand); font-weight:700; text-align:center; padding:5px 2px; border-radius:3px;" onchange="autoBalanceQaQuantities(this, '${item.grnNumber}', ${idx})">
            </td>
            <td style="width:55px; padding:6px; vertical-align:middle;">
              <input type="number" min="0" class="qa-notok-${item.grnNumber}" data-idx="${idx}" value="0" style="width:100%; background:#f1f5f9; text-align:center; font-weight:700; padding:5px 2px; border:1px solid var(--border); border-radius:3px;" readonly>
            </td>
            <td style="width:150px; padding:6px; vertical-align:middle;">
              <input type="text" class="qa-reason-${item.grnNumber}" data-idx="${idx}" placeholder="Reason for Not OK..." style="font-size:0.78rem; padding:6px; width:100%; border:1px solid var(--border); border-radius:3px;">
            </td>
            <td style="width:170px; padding:6px; vertical-align:middle;">
              <select class="qa-action-${item.grnNumber}" data-idx="${idx}" style="width:100%; font-size:0.76rem; padding:5px 2px; border-radius:3px;">
                <option value="">— N/A —</option>
                <option value="Return to Vendor for Replacement">Return to Vendor for Replacement</option>
                <option value="Return to Vendor for Repair">Return to Vendor for Repair</option>
                <option value="Ask Vendor to repair at ABPS">Ask Vendor to repair at ABPS</option>
                <option value="Ask ABPS to Repair at ABPS">Ask ABPS to Repair at ABPS</option>
              </select>
            </td>
            <td style="width:60px; padding:6px; text-align:center; vertical-align:middle;">
              <input type="checkbox" class="qa-done-${item.grnNumber}" data-idx="${idx}" style="width:18px; height:18px; cursor:pointer;">
            </td>
          </tr>`;
        });

        // Date/time badge — same source and formatting as the GRN card in Store Entry.
        let qaDateDisplay = formatDateTimeDMY(item.invoiceDate);

        let card = document.createElement("div"); card.className = "contact-summary-card-parent";
        card.innerHTML = `
          <div class="contact-summary-header-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='block'?'none':'block'" style="cursor:pointer; width:100%;">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:8px;">
              <div>
                <span style="background:#dcfce7; color:#15803d; font-weight:700; padding:3px 8px;">${item.grnNumber}</span>
                <span style="background:#edf2f7; color:var(--text); margin-left:4px; font-weight:700;">Vendor: ${item.vendorName}</span>
                <span style="background:#edf2f7; color:var(--text); margin-left:4px; font-weight:700;">Invoice: ${item.invoiceNumber}</span>
              </div>
              ${qaDateDisplay ? `<span style="background:#cbd5e1; color:#1e293b; font-weight:700; font-size:0.8rem; padding:3px 8px;">${qaDateDisplay}</span>` : ''}
            </div>
          </div>
          <div style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;">
            <div style="overflow-x:auto; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius);">
              <table class="store-basket-data-table" style="width:100%; table-layout:fixed; min-width:1250px; border-collapse:collapse;">
                <thead><tr style="background:#f8fafc;">
                  <th style="width:80px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Item Code</th>
                  <th style="width:180px; text-align:left; font-size:0.72rem; padding:8px 6px;">Invoice Material Description</th>
                  <th style="width:220px; text-align:left; font-size:0.72rem; padding:8px 6px;">Standard Material Name</th>
                  <th style="width:80px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Item Code Unit</th>
                  <th style="width:65px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Received Qty</th>
                  <th style="width:65px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">OK Qty</th>
                  <th style="width:55px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Not OK</th>
                  <th style="width:150px; text-align:left; font-size:0.72rem; padding:8px 6px;">Reason for Not OK</th>
                  <th style="width:170px; text-align:left; font-size:0.72rem; padding:8px 6px;">Action for Rejected *</th>
                  <th style="width:60px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Q/A Done</th>
                </tr></thead>
                <tbody>${trs}</tbody>
              </table>
            </div>
            <div style="display:flex; justify-content:flex-end;">
              <button class="nav-btn-styled" style="background:var(--brand);" onclick="commitStoreQAToBackend('${item.grnNumber}', \`${encodeURIComponent(JSON.stringify(item))}\`, this)">Submit Q/A & Add Stock</button>
            </div>
          </div>`;
        feed.appendChild(card);
      }
    });
  } catch(e) { feed.innerHTML = toggleBar + `<p style="color:var(--warn);">${e.message}</p>`; }
}

function reopenQAMaterialSearch(grnNum, idx) {
  const nameDisplay = document.querySelector(`.qa-mat-name-display-${grnNum}[data-idx="${idx}"]`);
  const searchInput = document.getElementById(`qa-search-${grnNum}-${idx}`);
  if (nameDisplay) nameDisplay.style.display = "none";
  if (searchInput) { searchInput.style.display = "block"; searchInput.value = ""; searchInput.focus(); }
}

function handleQANameSearch(inputEl, grnNum, idx) {
  const query    = inputEl.value.trim().toLowerCase();
  const dropId   = `qa-drop-${grnNum}-${idx}`;
  const dropdown = document.getElementById(dropId);
  const catalog  = window.itemCodeCatalogCache || [];
  if (!dropdown) return;

  const rect = inputEl.getBoundingClientRect();
  dropdown.style.top   = (rect.bottom + 2) + "px";
  dropdown.style.left  = rect.left + "px";
  dropdown.style.width = rect.width + "px";

  if (query.length < 2) { dropdown.style.display = "none"; return; }
  const matches = catalog.filter(c => (c.productName || "").toLowerCase().includes(query)).slice(0, 10);
  if (matches.length === 0) {
    dropdown.innerHTML = `<div style="padding:8px 10px; font-size:0.78rem; color:var(--muted);">No match found</div>`;
    dropdown.style.display = "block"; return;
  }
  dropdown.innerHTML = matches.map(c => `
    <div onclick="selectQANameMatch('${grnNum}', ${idx}, '${c.itemCode}', '${(c.combinedName || c.productName).replace(/'/g,"\\'")}', '${(c.unit || 'NOS').replace(/'/g,"\\'")}')"
      style="padding:7px 10px; cursor:pointer; font-size:0.78rem; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:600;">${c.combinedName || c.productName}</span>
      <span style="font-size:0.7rem; color:var(--muted); background:#f1f5f9; padding:2px 6px; border-radius:3px;">${c.itemCode}</span>
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectQANameMatch(grnNum, idx, itemCode, productName, unit) {
  const dropdown     = document.getElementById(`qa-drop-${grnNum}-${idx}`);
  const searchInput  = document.getElementById(`qa-search-${grnNum}-${idx}`);
  const codeInput    = document.querySelector(`.qa-item-code-${grnNum}[data-idx="${idx}"]`);
  const nameInput    = document.querySelector(`.qa-mat-name-${grnNum}[data-idx="${idx}"]`);
  const nameDisplay  = document.querySelector(`.qa-mat-name-display-${grnNum}[data-idx="${idx}"]`);
  const unitInput    = document.querySelector(`.qa-unit-${grnNum}[data-idx="${idx}"]`);

  if (codeInput) codeInput.value = itemCode;
  if (nameInput) nameInput.value = productName;
  if (unitInput) unitInput.value = unit || "NOS";
  if (nameDisplay) {
    nameDisplay.querySelector("span").textContent = productName;
    nameDisplay.style.display = "flex";
  }
  if (searchInput) searchInput.style.display = "none";
  if (dropdown)    dropdown.style.display    = "none";
}

// Close QA dropdowns on outside click
document.addEventListener("click", function(e) {
  if (!e.target.id || !e.target.id.startsWith("qa-search-")) {
    document.querySelectorAll("[id^='qa-drop-']").forEach(d => d.style.display = "none");
  }
});

function autoBalanceQaQuantities(okInput, grnNum, idx) {
  const max = parseInt(okInput.dataset.max, 10);
  let okVal = parseInt(okInput.value, 10) || 0;
  if (okVal > max) { okVal = max; okInput.value = max; }
  if (okVal < 0) { okVal = 0; okInput.value = 0; }
  const notOkInput = document.querySelector(`.qa-notok-${grnNum}[data-idx="${idx}"]`);
  if (notOkInput) notOkInput.value = max - okVal;
}

function handleRejVendorSearch(query) {
  clearTimeout(rejVendorSearchDebounce);
  const dropdown = document.getElementById("rejected-material-vendor-dropdown");
  if (!query || query.trim().length < 1) { if (dropdown) dropdown.style.display = "none"; return; }
  rejVendorSearchDebounce = setTimeout(async () => {
    try {
      const data = await apFetch({ action: "searchVendorNamesForRejectedMaterial", query });
      if (!dropdown) return;
      if (!data.success || !data.vendors.length) { dropdown.style.display = "none"; return; }
      dropdown.innerHTML = data.vendors.map(v => `<div onclick="selectRejVendorSuggestion('${v.replace(/'/g,"\\'")}')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${v}</div>`).join("");
      dropdown.style.display = "block";
    } catch(e) { if (dropdown) dropdown.style.display = "none"; }
  }, 250);
}

function selectRejVendorSuggestion(vendorName) {
  const input = document.getElementById("rejected-material-vendor-input");
  if (input) input.value = vendorName;
  const dropdown = document.getElementById("rejected-material-vendor-dropdown");
  if (dropdown) dropdown.style.display = "none";
  applyRejectedMaterialFilters();
}

function toggleRejActionAll(checked) {
  if (checked) {
    document.querySelectorAll(".rej-action-filter-cb").forEach(cb => cb.checked = false);
  }
  applyRejectedMaterialFilters();
}

function handleRejActionFilterChange() {
  const anyChecked = Array.from(document.querySelectorAll(".rej-action-filter-cb")).some(cb => cb.checked);
  const allCb = document.getElementById("rej-action-all");
  if (allCb) allCb.checked = !anyChecked;
  applyRejectedMaterialFilters();
}

function applyRejectedMaterialFilters() {
  const vendorInput = document.getElementById("rejected-material-vendor-input");
  window.rejMaterialVendorFilter = vendorInput ? vendorInput.value : "";
  const allCb = document.getElementById("rej-action-all");
  window.rejMaterialActionFilter = (allCb && allCb.checked)
    ? []
    : Array.from(document.querySelectorAll(".rej-action-filter-cb:checked")).map(cb => cb.value);
  initializeRejectedMaterialPanel('completed');
}

async function initializeRejectedMaterialPanel(toggle) {
  window.activeRejectedMaterialToggle = toggle || window.activeRejectedMaterialToggle || "pending";
  const feed = document.getElementById("rejected-material-cards-feed");
  const isCompleted = window.activeRejectedMaterialToggle === "completed";

  const cleanVendor = (window.rejMaterialVendorFilter || "").toString().trim();
  const selectedActions = window.rejMaterialActionFilter || [];
  const ALL_ACTIONS = ["Return to Vendor for Replacement", "Return to Vendor for Repair", "Ask Vendor to repair at ABPS", "Ask ABPS to Repair at ABPS"];

  const filterSummaryText = isCompleted
    ? `Filtering for ${selectedActions.length === 0 ? "All Action for Rejected" : selectedActions.join(", or ")}${cleanVendor ? ` • Vendor: "${cleanVendor}"` : ""}`
    : "";

  const toggleBar = `
    <div style="display:flex; gap:8px; margin-bottom:12px;">
      <button class="nav-btn-styled" onclick="initializeRejectedMaterialPanel('pending')" style="background:${!isCompleted ? 'var(--brand)' : '#e2e8f0'}; color:${!isCompleted ? '#fff' : '#334155'}; font-weight:700;">Pending Action</button>
      <button class="nav-btn-styled" onclick="initializeRejectedMaterialPanel('completed')" style="background:${isCompleted ? 'var(--brand)' : '#e2e8f0'}; color:${isCompleted ? '#fff' : '#334155'}; font-weight:700;">Action in Progress</button>
    </div>
    ${isCompleted ? `
    <div style="display:flex; gap:14px; margin-bottom:12px; flex-wrap:wrap; align-items:center; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:12px;">
      <div style="position:relative; flex:1; min-width:200px;">
        <input type="text" id="rejected-material-vendor-input" placeholder="Search by Vendor Name..." value="${cleanVendor.replace(/"/g,'&quot;')}" autocomplete="off"
          style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);"
          oninput="handleRejVendorSearch(this.value)"
          onkeydown="if(event.key==='Enter') applyRejectedMaterialFilters()" />
        <div id="rejected-material-vendor-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:200px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; font-weight:700; padding:6px 12px; border:1.5px solid ${selectedActions.length === 0 ? 'var(--brand)' : 'var(--border)'}; border-radius:20px; background:${selectedActions.length === 0 ? '#eff6ff' : '#fff'}; cursor:pointer; white-space:nowrap;">
          <input type="checkbox" id="rej-action-all" onchange="toggleRejActionAll(this.checked)" ${selectedActions.length === 0 ? 'checked' : ''} style="margin:0; cursor:pointer;"> ALL
        </label>
        ${ALL_ACTIONS.map(a => `
          <label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; font-weight:600; padding:6px 12px; border:1.5px solid ${selectedActions.includes(a) ? 'var(--brand)' : 'var(--border)'}; border-radius:20px; background:${selectedActions.includes(a) ? '#eff6ff' : '#fff'}; cursor:pointer; white-space:nowrap;">
            <input type="checkbox" class="rej-action-filter-cb" value="${a}" onchange="handleRejActionFilterChange()" ${selectedActions.includes(a) ? 'checked' : ''} style="margin:0; cursor:pointer;"> ${a}
          </label>`).join("")}
      </div>
    </div>
    <div style="margin-bottom:14px; font-size:0.82rem; font-weight:700; color:#475569;">${filterSummaryText}</div>
    ` : ''}`;

  feed.innerHTML = toggleBar + `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); gap:12px; color:var(--accent);">
      <div class="spinner" style="width:28px; height:28px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <span style="font-size:0.9rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Loading...</span>
    </div>`;

  try {
    const data = await apFetch({ action: "fetchRejectedMaterialQueue", toggle: window.activeRejectedMaterialToggle, vendorName: cleanVendor, actions: selectedActions });
    if (!data.success || !data.queue || data.queue.length === 0) {
      feed.innerHTML = toggleBar + `<div style="text-align:center;padding:30px;color:var(--muted);background:#fff;border:1px solid var(--border);border-radius:6px;">No records found.</div>`;
      return;
    }

    feed.innerHTML = toggleBar;

    data.queue.forEach(item => {
      let cardHasEditableLine = false;
      let trs = "";
      item.lineItems.forEach((line, idx) => {
        const isMissingOnly = (Number(line.notOkQuantity) || 0) === 0 && (Number(line.missingQuantity) || 0) > 0;
        const isEditable = line.status !== 'Resolved' && !isMissingOnly;
        if (isEditable) cardHasEditableLine = true;
        trs += `<tr style="border-bottom:1px solid #f1f5f9; vertical-align:middle;">
          <td style="width:110px; padding:8px 6px; text-align:center; font-family:monospace; font-weight:700;">${line.itemCode}</td>
          <td style="min-width:180px; padding:8px 6px; font-size:0.85rem;">${(line.materialName || "").replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
          <td style="width:70px; padding:8px 6px; text-align:center; font-weight:700; font-size:1rem;">${Number(line.missingQuantity) || 0}</td>
          <td style="width:70px; padding:8px 6px; text-align:center; font-weight:700; font-size:1rem;">${line.notOkQuantity}</td>
          <td style="width:90px; padding:8px 6px; text-align:center; font-weight:700; font-size:1rem;">${line.outstandingQuantity}</td>
          <td style="width:180px; padding:8px 6px; font-size:0.8rem; color:#64748b;">${(line.reasonForNotOk || "").replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
          <td style="width:170px; padding:8px 6px;">
            ${isMissingOnly ? `<span style="font-size:0.8rem; font-weight:600; color:#64748b;">Awaiting vendor replacement</span> <span style="font-size:0.72rem; color:var(--muted);">(${line.status})</span>` :
              isEditable ? `
              <select class="rej-action-${item.grnNumber}" data-idx="${idx}" data-rejid="${line.rejectionId}" style="width:100%; font-size:0.76rem; padding:3px 2px;">
                <option value="Return to Vendor for Replacement" ${line.actionForRejectedMaterial==='Return to Vendor for Replacement'?'selected':''}>Return to Vendor for Replacement</option>
                <option value="Return to Vendor for Repair" ${line.actionForRejectedMaterial==='Return to Vendor for Repair'?'selected':''}>Return to Vendor for Repair</option>
                <option value="Ask Vendor to repair at ABPS" ${line.actionForRejectedMaterial==='Ask Vendor to repair at ABPS'?'selected':''}>Ask Vendor to repair at ABPS</option>
                <option value="Ask ABPS to Repair at ABPS" ${line.actionForRejectedMaterial==='Ask ABPS to Repair at ABPS'?'selected':''}>Ask ABPS to Repair at ABPS</option>
              </select>` : `<span style="font-size:0.8rem; font-weight:600;">${line.actionForRejectedMaterial}</span> <span style="font-size:0.72rem; color:var(--muted);">(${line.status})</span>`}
          </td>
        </tr>`;
      });

      // Date/time badge — same source and formatting as the GRN card in Store Entry.
      let rejDateDisplay = formatDateTimeDMY(item.invoiceDate);

      let card = document.createElement("div"); card.className = "contact-summary-card-parent";
      card.innerHTML = `
        <div class="contact-summary-header-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='block'?'none':'block'" style="cursor:pointer; width:100%;">
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:8px;">
            <div>
              <span style="background:#dcfce7; color:#15803d; font-weight:700; padding:3px 8px;">${item.grnNumber}</span>
              <span style="background:#edf2f7; color:var(--text); margin-left:4px; font-weight:700;">Vendor: ${item.vendorName}</span>
              ${item.poNo ? `<span style="background:#e0f2fe; color:#0369a1; margin-left:4px; font-weight:700;">PO: ${item.poNo}</span>` : ''}
            </div>
            ${rejDateDisplay ? `<span style="background:#cbd5e1; color:#1e293b; font-weight:700; font-size:0.8rem; padding:3px 8px;">${rejDateDisplay}</span>` : ''}
          </div>
        </div>
        <div style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;">
          <div style="overflow-x:auto; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius);">
            <table class="store-basket-data-table" style="width:100%; table-layout:fixed; min-width:900px; border-collapse:collapse;">
              <thead><tr style="background:#f8fafc;">
                <th style="width:100px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Item Code</th>
                <th style="width:140px; text-align:left; font-size:0.72rem; padding:8px 6px;">Description of Material</th>
                <th style="width:80px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Missing Qty</th>
                <th style="width:80px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Not OK</th>
                <th style="width:110px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Pending Qty</th>
                <th style="width:220px; text-align:left; font-size:0.72rem; padding:8px 6px;">Reason for Not OK</th>
                <th style="width:170px; text-align:left; font-size:0.72rem; padding:8px 6px;">Action for Rejected</th>
              </tr></thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
          ${cardHasEditableLine ? `<div style="display:flex; justify-content:flex-end;">
            <button class="nav-btn-styled" style="background:var(--brand);" onclick="commitRejectedMaterialActionToBackend('${item.grnNumber}', this)">${isCompleted ? 'Update Action' : 'Submit Action'}</button>
          </div>` : ''}
        </div>`;
      feed.appendChild(card);
    });
  } catch(e) { feed.innerHTML = toggleBar + `<p style="color:var(--warn);">${e.message}</p>`; }
}

async function commitRejectedMaterialActionToBackend(grnNum, btn) {
  const banner = document.getElementById('rejected-material-feedback-banner');
  banner.style.display = "none";

  const lineItems = [];
  document.querySelectorAll(`.rej-action-${grnNum}`).forEach(sel => {
    lineItems.push({ rejectionId: sel.dataset.rejid, actionForRejectedMaterial: sel.value });
  });
  if (lineItems.length === 0) return;

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting...';

  showBlockingOverlay("Submitting Action...");
  try {
    const data = await apFetch({
      action: "commitRejectedMaterialAction",
      activeEngineer: appActiveOperatorIdentityString,
      payload: { lineItems: lineItems }
    });
    hideBlockingOverlay();
    if (data.success) {
      const feed = document.getElementById("rejected-material-cards-feed");
      if (feed) feed.innerHTML = "";
      banner.style.cssText = "display: block; background: #dcfce7; border-left: 4px solid #15803d; color: #15803d; padding: 20px; border-radius: var(--radius); margin-bottom:15px;";
      banner.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; text-align:left;">
          <div><strong>Success! Action recorded for ${grnNum}.</strong></div>
          <button class="nav-btn-styled" onclick="
            document.getElementById('rejected-material-feedback-banner').style.display = 'none';
            initializeRejectedMaterialPanel(window.activeRejectedMaterialToggle);
          " style="background: #15803d; color: white; padding:8px 16px; font-weight:700;">Refresh Queue</button>
        </div>`;
    } else {
      alert("Server Error: " + data.error);
      btn.disabled = false; btn.textContent = window.activeRejectedMaterialToggle === 'completed' ? 'Update Action' : 'Submit Action';
    }
  } catch(e) {
    hideBlockingOverlay();
    alert("Network request execution failure: " + e.message);
    btn.disabled = false; btn.textContent = window.activeRejectedMaterialToggle === 'completed' ? 'Update Action' : 'Submit Action';
  }
}

