// ═══════════════════════════════════════════════════════════════════════
// Material Outward on Delivery Challan — Use Case 1: Service.
// Two toggles: "Materials for Service" (approved Service tickets waiting
// on a challan) and "Search Challans" (the register, filterable by
// project + date range). Upload → AI-extracted review → commit follows
// the same extract → review → commit pattern as Upload Purchase Order.
// ═══════════════════════════════════════════════════════════════════════

let mowServiceTicketsCache = [];

async function initializeMaterialOutwardWorkspace() {
  await ensureSharedProjectTypeaheadData();
  switchMaterialOutwardToggle('service');
}

function switchMaterialOutwardToggle(mode) {
  const serviceBtn = document.getElementById("mow-toggle-service-btn");
  const searchBtn = document.getElementById("mow-toggle-search-btn");
  const servicePanel = document.getElementById("mow-service-panel");
  const searchPanel = document.getElementById("mow-search-panel");
  const feedback = document.getElementById("mow-feedback-banner");
  if (feedback) feedback.style.display = "none";

  if (mode === 'search') {
    if (serviceBtn) serviceBtn.style.background = "#718096";
    if (searchBtn) searchBtn.style.background = "var(--brand)";
    if (servicePanel) servicePanel.style.display = "none";
    if (searchPanel) searchPanel.style.display = "block";
  } else {
    if (serviceBtn) serviceBtn.style.background = "var(--brand)";
    if (searchBtn) searchBtn.style.background = "#718096";
    if (servicePanel) servicePanel.style.display = "block";
    if (searchPanel) searchPanel.style.display = "none";
    loadMaterialOutwardServiceQueue();
  }
}

async function loadMaterialOutwardServiceQueue() {
  const feed = document.getElementById("mow-service-queue-feed");
  if (!feed) return;
  feed.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center;">Loading approved Service tickets...</div>`;
  try {
    const data = await apFetch({ action: "fetchServiceTicketsAwaitingChallan" });
    if (!data.success) throw new Error(data.error || "Failed to load.");
    mowServiceTicketsCache = data.tickets || [];
    if (mowServiceTicketsCache.length === 0) {
      feed.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center;">No approved Service tickets are awaiting a Delivery Challan.</div>`;
      return;
    }
    feed.innerHTML = mowServiceTicketsCache.map(renderServiceTicketCard).join("");
  } catch (err) {
    feed.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}

// Per-ticket state — this screen can have several approved Service
// tickets' cards on the page at once, each with its own independent
// upload/AI-review progress, so every piece of in-flight state below is
// keyed by ticketId rather than a single "active ticket" the old
// modal-based version used.
window._mowFilesByTicket = window._mowFilesByTicket || {};
window._mowExtractedPreviewByTicket = window._mowExtractedPreviewByTicket || {};
window._mowBlockingCountByTicket = window._mowBlockingCountByTicket || {};

function renderServiceTicketCard(ticket) {
  const ticketId = ticket.ticket_id;
  return `
    <div class="section" id="mow-card-${ticketId}" style="padding:16px; border:1px solid var(--border); border-radius:var(--radius);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div>
          <div style="font-weight:800; font-size:0.98rem;">${escapeHtml(ticketId)}</div>
          <div style="color:var(--muted); font-size:0.85rem; margin-top:2px;">
            ${escapeHtml(ticket.project_id || "Legacy")}${ticket.company_name ? " — " + escapeHtml(ticket.company_name) : ""}
            ${ticket.boq_id ? " · BOQ " + escapeHtml(ticket.boq_id) : ""}
            ${ticket.job_card_number ? " · Job Card " + escapeHtml(ticket.job_card_number) : ""}
          </div>
          <div style="color:var(--muted); font-size:0.8rem; margin-top:2px;">${escapeHtml(ticket.type_of_store || "")} · Requested by ${escapeHtml(ticket.requested_returned_by || "")}</div>
        </div>
        <button class="nav-btn-styled" id="mow-reject-btn-${ticketId}" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; font-weight:700; padding:6px 14px; white-space:nowrap;" onclick="rejectMaterialOutwardRequest('${ticketId}')">Reject</button>
      </div>

      <div id="mow-upload-section-${ticketId}" style="margin-top:14px; border-top:1px solid var(--border); padding-top:12px;">
        <div class="card-row">
          <div class="card-box" id="mow-challan-box-${ticketId}" onclick="document.getElementById('mow-challan-file-${ticketId}').click()">📄 Upload Challan</div>
          <div class="card-box" id="mow-morf-box-${ticketId}" onclick="document.getElementById('mow-morf-file-${ticketId}').click()">📄 Request Form</div>
        </div>
        <input type="file" id="mow-challan-file-${ticketId}" accept=".pdf,image/*" hidden onchange="handleMowFileSelected('${ticketId}', 'challan', this)" />
        <input type="file" id="mow-morf-file-${ticketId}" accept=".pdf,image/*" hidden onchange="handleMowFileSelected('${ticketId}', 'morf', this)" />
        <button class="btn btn-ai" id="mow-process-btn-${ticketId}" disabled style="width:100%; opacity:0.5; cursor:not-allowed;" onclick="processMaterialOutwardDocsWithAI('${ticketId}')">Process Docs with AI</button>
      </div>

      <div id="mow-review-zone-${ticketId}"></div>

      <div id="mow-inline-feedback-${ticketId}" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
    </div>`;
}

// Rejects (voids) a ticket sitting in this queue — for the case where the
// Material Issue Ticket itself was a mistake (wrong material/qty
// requested). Only offered while a ticket is still awaiting a challan
// (this whole queue is exactly that population); the backend independently
// re-checks status and that no challan was recorded before reversing
// anything. Reverses the stock released at ticket approval and tells the
// operator to raise a fresh ticket instead of trying to patch this one.
async function rejectMaterialOutwardRequest(ticketId) {
  const reason = prompt(`Reject ${ticketId} and return its stock to the store?\n\nThis completely voids the request — the operator will need to raise a new Material Issue Ticket with the correct material/quantity.\n\nOptional: reason for rejecting (shown in the audit log):`);
  if (reason === null) return; // Cancel
  const btn = document.getElementById(`mow-reject-btn-${ticketId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Rejecting..."; }
  try {
    const data = await apFetch({ action: "rejectMaterialOutwardRequest", ticketId, reason: reason || "", operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (!data.success) throw new Error(data.error || "Failed to reject.");
    showSuccessWithReset("mow-feedback-banner", `${escapeHtml(ticketId)} rejected — its stock has been returned to the store. Raise a new Material Issue Ticket to correct it.`, "Refresh Queue", "loadMaterialOutwardServiceQueue()");
    loadMaterialOutwardServiceQueue();
  } catch (err) {
    const feedback = document.getElementById(`mow-inline-feedback-${ticketId}`);
    if (feedback) {
      feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
      feedback.textContent = err.message;
    }
    if (btn) { btn.disabled = false; btn.textContent = "Reject"; }
  }
}

function handleMowFileSelected(ticketId, kind, inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  window._mowFilesByTicket[ticketId] = window._mowFilesByTicket[ticketId] || {};
  window._mowFilesByTicket[ticketId][kind] = file;
  const box = document.getElementById(`mow-${kind}-box-${ticketId}`);
  if (box) {
    box.textContent = (kind === 'challan' ? 'Challan ✅' : 'Request Form ✅');
    box.classList.add('done');
  }
  const files = window._mowFilesByTicket[ticketId];
  const btn = document.getElementById(`mow-process-btn-${ticketId}`);
  if (btn) {
    const ready = !!(files.challan && files.morf);
    btn.disabled = !ready;
    btn.style.opacity = ready ? "1" : "0.5";
    btn.style.cursor = ready ? "pointer" : "not-allowed";
  }
}

async function processMaterialOutwardDocsWithAI(ticketId) {
  const ticket = mowServiceTicketsCache.find(t => t.ticket_id === ticketId);
  const files = window._mowFilesByTicket[ticketId];
  const feedback = document.getElementById(`mow-inline-feedback-${ticketId}`);
  const showInlineError = (msg) => {
    if (!feedback) return;
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = msg;
  };
  if (!ticket || !files || !files.challan || !files.morf) {
    showInlineError(!files || !files.challan ? "Select a Delivery Challan file first." : "Select a Material Out Request Form file first.");
    return;
  }
  const btn = document.getElementById(`mow-process-btn-${ticketId}`);
  if (btn) { btn.disabled = true; btn.classList.add("loading"); btn.textContent = "AI Processing Docs"; }
  try {
    const readB64 = f => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(f); });
    const [dcB64, morfB64] = await Promise.all([readB64(files.challan), readB64(files.morf)]);
    const challanFile = { fileName: files.challan.name, base64Data: dcB64, mimeType: files.challan.type || "application/octet-stream" };
    const morfFilePayload = { fileName: files.morf.name, base64Data: morfB64, mimeType: files.morf.type || "application/octet-stream" };
    const data = await apFetch({ action: "extractDeliveryChallanPreview", ticketId, challanFile, morfFile: morfFilePayload });
    if (!data.success) throw new Error(data.error || "Extraction failed.");
    window._mowExtractedPreviewByTicket[ticketId] = { ...data, challanFile, morfFile: morfFilePayload };
    renderMaterialOutwardReviewForm(ticketId, data);
  } catch (err) {
    showInlineError(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); btn.textContent = "Process Docs with AI"; }
  }
}

function renderMaterialOutwardReviewForm(ticketId, preview) {
  const zone = document.getElementById(`mow-review-zone-${ticketId}`);
  if (!zone) return;
  // Hide the upload boxes once a review is in progress — re-uploading
  // means Cancel first (cancelMaterialOutwardReview), not silently
  // re-processing over an unsaved review.
  const uploadSection = document.getElementById(`mow-upload-section-${ticketId}`);
  if (uploadSection) uploadSection.style.display = "none";

  // Materials Table (below) is view-only, sourced from the ticket's own
  // approved release — never from the uploaded documents.
  const ticket = mowServiceTicketsCache.find(t => t.ticket_id === ticketId);
  const items = (ticket && Array.isArray(ticket.items)) ? ticket.items : [];

  const returnableOptions = ['', 'Returnable', 'Non-Returnable'].map(v =>
    `<option value="${v}" ${(preview.morf || {}).returnableStatus === v ? 'selected' : ''}>${v || '— Select —'}</option>`).join("");

  // Contact Person/Number are now ONE merged field on this screen, but the
  // two source documents each carry their own copy — the Delivery
  // Challan's own contactPersonName/contactNumber, and the Material Out
  // Request Form's separate contactName/contactNumber (parseMaterialOut
  // RequestForm). Falling back to the MORF's copy when the challan's own
  // is blank was dropped by mistake when the two sections were merged —
  // a challan whose contact cell is phone-digits-only (so
  // contactPersonName correctly comes back "") can still have a named
  // contact on the MORF, and that name shouldn't be lost.
  const morf = preview.morf || {};
  const mergedContactPerson = preview.contactPersonName || morf.contactName || '';
  const mergedContactNumber = preview.contactNumber || morf.contactNumber || '';

  const fieldBoxStyle = "border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;";
  // A plain single-line <input> clips a long value instead of showing it —
  // every field here is an auto-growing textarea instead (shared
  // autoGrowTextField, shared/ui.js), same convention as Project
  // Invoice's own field() helper. autoGrowAllIn(zone) below sizes them
  // once on first render, since a prefilled value never fires its own
  // input event.
  const field = (label, id, value, required) =>
    `<div><label class="field-label" style="margin-top:0;">${label}${required ? ' *' : ''}</label><textarea rows="1" id="${id}" oninput="autoGrowTextField(this);" onfocus="autoGrowTextField(this);" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius); resize:none; overflow:hidden; font-family:inherit; font-size:inherit;">${escapeHtml(value || '')}</textarea></div>`;

  const materialRowsHtml = items.map(it => `
    <tr>
      <td style="padding:8px; border:1px solid var(--border); white-space:normal; word-break:break-word;">${escapeHtml(it.materialName || it.itemCode || "")}</td>
      <td style="padding:8px; border:1px solid var(--border); text-align:center; font-family:monospace; font-weight:700; font-size:1.15rem;">${escapeHtml(String(fmtQty(it.__releaseQty ?? it.quantity ?? 0)))}</td>
      <td style="padding:8px; border:1px solid var(--border); text-align:center;">${escapeHtml(it.unitType || "—")}</td>
    </tr>`).join("");

  zone.innerHTML = `
    <div style="margin-top:14px; border-top:2px solid var(--border); padding-top:16px;">
      <h3 style="margin:0 0 4px; font-size:1.05rem;">Review — ${escapeHtml(ticketId)}</h3>
      <p style="margin:0 0 12px; font-size:0.78rem; color:var(--muted);">Header fields were read from the Delivery Challan and Material Out Request Form — check the values below before saving.</p>
      <div id="mow-crosscheck-band-${ticketId}"></div>

      <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:12px 16px; margin-bottom:12px; ${fieldBoxStyle}">
        ${field('Challan Number', `mow-review-number-${ticketId}`, preview.challanNumber, true)}
        <div><label class="field-label" style="margin-top:0;">Challan Date *</label><input type="date" id="mow-review-date-${ticketId}" value="${escapeHtml(preview.challanDate || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        ${field('Company Name', `mow-review-consignee-name-${ticketId}`, preview.consigneeName, true)}
        ${field('Contact Person', `mow-review-contact-name-${ticketId}`, mergedContactPerson, true)}
        ${field('Contact Number', `mow-review-contact-number-${ticketId}`, mergedContactNumber, false)}
      </div>
      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px 16px; margin-bottom:12px; ${fieldBoxStyle}">
        ${field('Transporter Name', `mow-review-transporter-${ticketId}`, preview.transporterName, false)}
        ${field('Vehicle Number', `mow-review-vehicle-${ticketId}`, preview.vehicleNumber, false)}
        ${field('LR Number', `mow-review-lr-${ticketId}`, preview.lrNumber, false)}
        ${field('Freight Terms', `mow-review-freight-${ticketId}`, preview.freight, false)}
      </div>
      <div style="display:grid; grid-template-columns:1fr 3fr; gap:12px 16px; margin-bottom:12px; ${fieldBoxStyle}">
        ${field('State', `mow-review-state-${ticketId}`, preview.consigneeState, false)}
        ${field('Company Address', `mow-review-consignee-address-${ticketId}`, preview.consigneeAddress, true)}
      </div>
      <div style="display:grid; grid-template-columns:1fr 2fr 2fr; gap:12px 16px; margin-bottom:20px; ${fieldBoxStyle}">
        <div><label class="field-label" style="margin-top:0;">Returnable Status</label><select id="mow-morf-returnable-${ticketId}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);">${returnableOptions}</select></div>
        ${field('Delivery Challan Remarks', `mow-review-remarks-${ticketId}`, preview.remarks, false)}
        ${field('Material Out Request Form Remarks', `mow-morf-remarks-${ticketId}`, morf.remarks, false)}
      </div>

      <h4 style="margin:0 0 6px; font-size:0.95rem; font-weight:800; color:var(--brand);">Materials Table</h4>
      <p style="margin:0 0 8px; font-size:0.78rem; color:var(--muted);">Material Name and Qty here come from the approved Material Request (this ticket's own release) — not from the uploaded document. If you see a mismatch, upload a new document instead of editing here.</p>
      <table style="width:100%; border-collapse:collapse; margin-bottom:20px; table-layout:fixed;">
        <colgroup><col style="width:70%;" /><col style="width:15%;" /><col style="width:15%;" /></colgroup>
        <thead><tr style="background:var(--highlight-bg);">
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Material Name</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:center; font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Qty</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:center; font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Unit</th>
        </tr></thead>
        <tbody>${materialRowsHtml || '<tr><td colspan="3" style="padding:8px; text-align:center; color:var(--muted);">No items on this ticket.</td></tr>'}</tbody>
      </table>

      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="nav-btn-styled" style="background:#718096;" onclick="cancelMaterialOutwardReview('${ticketId}')">Cancel</button>
        <button class="nav-btn-styled" id="mow-commit-btn-${ticketId}" style="background:var(--accent);" onclick="commitMaterialOutwardChallan('${ticketId}')">Confirm & Save</button>
      </div>
      <div id="mow-modal-inline-feedback-${ticketId}" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
    </div>
  `;
  autoGrowAllIn(zone);
  renderMaterialOutwardCrossCheckBand(ticketId, preview.crossChecks || { blocking: [], warnings: [] }, preview.parseWarnings || []);
}

// Backs out of an in-progress review without saving, back to the upload
// boxes — e.g. the operator picked the wrong file and wants to redo it.
function cancelMaterialOutwardReview(ticketId) {
  const zone = document.getElementById(`mow-review-zone-${ticketId}`);
  if (zone) zone.innerHTML = "";
  const uploadSection = document.getElementById(`mow-upload-section-${ticketId}`);
  if (uploadSection) uploadSection.style.display = "";
  delete window._mowExtractedPreviewByTicket[ticketId];
}

function renderMaterialOutwardCrossCheckBand(ticketId, crossChecks, parseWarnings) {
  const bandEl = document.getElementById(`mow-crosscheck-band-${ticketId}`);
  const commitBtn = document.getElementById(`mow-commit-btn-${ticketId}`);
  const blocking = crossChecks.blocking || [];
  const warnings = [...(crossChecks.warnings || []), ...(parseWarnings || [])];
  window._mowBlockingCountByTicket[ticketId] = blocking.length;
  if (!bandEl) return;
  let html = "";
  if (blocking.length) {
    html += `<div style="margin-bottom:10px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-size:0.82rem;">
      <strong>Cannot save until these are resolved:</strong><ul style="margin:6px 0 0; padding-left:18px;">${blocking.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul></div>`;
  }
  if (warnings.length) {
    html += `<div style="margin-bottom:12px; padding:10px; border-left:4px solid #f59e0b; background:#fffbeb; color:#b45309; border-radius:var(--radius); font-size:0.82rem;">
      <strong>Worth a look (these do not prevent saving):</strong><ul style="margin:6px 0 0; padding-left:18px;">${warnings.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul></div>`;
  }
  bandEl.innerHTML = html;
  if (commitBtn) {
    commitBtn.disabled = blocking.length > 0;
    commitBtn.style.opacity = blocking.length > 0 ? "0.5" : "1";
    commitBtn.style.cursor = blocking.length > 0 ? "not-allowed" : "pointer";
  }
}

async function commitMaterialOutwardChallan(ticketId) {
  const preview = window._mowExtractedPreviewByTicket[ticketId];
  const ticket = mowServiceTicketsCache.find(t => t.ticket_id === ticketId);
  if (!preview || !ticket) return;
  const feedback = document.getElementById(`mow-modal-inline-feedback-${ticketId}`);
  const showError = (msg) => {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = msg;
  };
  const challanNumber = document.getElementById(`mow-review-number-${ticketId}`).value.trim();
  const challanDate = document.getElementById(`mow-review-date-${ticketId}`).value;
  const consigneeName = document.getElementById(`mow-review-consignee-name-${ticketId}`).value.trim();
  const contactPersonName = document.getElementById(`mow-review-contact-name-${ticketId}`).value.trim();
  const consigneeAddress = document.getElementById(`mow-review-consignee-address-${ticketId}`).value.trim();
  if (!challanNumber || !challanDate || !consigneeName || !contactPersonName || !consigneeAddress) {
    showError("Challan Number, Challan Date, Company Name, Contact Person, and Company Address are required.");
    return;
  }
  // Materials Table is view-only, sourced from the ticket's own approved
  // release — both backend arrays are built directly from it rather than
  // from anything typed/edited on this screen, so they can never disagree
  // with the ticket regardless of what the uploaded documents said.
  const lineItems = [];
  const morfLineItems = [];
  for (const it of ticket.items || []) {
    const materialName = it.materialName || it.itemCode || "";
    const quantity = it.__releaseQty ?? it.quantity ?? 0;
    const unit = it.unitType || "";
    lineItems.push({ materialName, hsnCode: "", quantity, unit });
    morfLineItems.push({ materialName, quantity, unit, rating: "" });
  }
  const morf = {
    returnableStatus: document.getElementById(`mow-morf-returnable-${ticketId}`).value,
    remarks: document.getElementById(`mow-morf-remarks-${ticketId}`).value.trim(),
  };

  const commitBtn = document.getElementById(`mow-commit-btn-${ticketId}`);
  if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = "Saving..."; }
  try {
    const data = await apFetch({
      action: "commitDeliveryChallan",
      ticketId: ticket.ticket_id, projectId: ticket.project_id, legacyCompanyName: ticket.legacy_company_name,
      companyName: ticket.company_name,
      challanNumber, challanDate,
      consigneeName, consigneeAddress,
      consigneeState: document.getElementById(`mow-review-state-${ticketId}`).value.trim(),
      contactPersonName,
      contactNumber: document.getElementById(`mow-review-contact-number-${ticketId}`).value.trim(),
      transporterName: document.getElementById(`mow-review-transporter-${ticketId}`).value.trim(),
      vehicleNumber: document.getElementById(`mow-review-vehicle-${ticketId}`).value.trim(),
      lrNumber: document.getElementById(`mow-review-lr-${ticketId}`).value.trim(),
      freight: document.getElementById(`mow-review-freight-${ticketId}`).value.trim(),
      challanRemarks: document.getElementById(`mow-review-remarks-${ticketId}`).value.trim(),
      lineItems, morf, morfLineItems,
      challanFile: preview.challanFile, morfFile: preview.morfFile,
      operatorName: appActiveOperatorIdentityString || "Unknown",
    });
    if (!data.success) throw new Error(data.error || "Save failed.");
    delete window._mowExtractedPreviewByTicket[ticketId];
    delete window._mowFilesByTicket[ticketId];
    showSuccessWithReset("mow-feedback-banner", `Delivery Challan ${escapeHtml(challanNumber)} and Material Out Request Form saved for ${escapeHtml(ticketId)}.`, "Load Next Ticket", "loadMaterialOutwardServiceQueue()");
    loadMaterialOutwardServiceQueue();
  } catch (err) {
    showError(err.message);
  } finally {
    if (commitBtn) { commitBtn.disabled = false; commitBtn.textContent = "Confirm & Save"; }
  }
}

async function runMaterialOutwardSearch() {
  const projectId = document.getElementById("mow-search-project-ta-input").value.trim();
  const dateFrom = document.getElementById("mow-search-date-from").value;
  const dateTo = document.getElementById("mow-search-date-to").value;
  const results = document.getElementById("mow-search-results");
  results.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center;">Searching...</div>`;
  try {
    const data = await apFetch({ action: "searchMaterialOutwardChallans", projectId: projectId || null, dateFrom: dateFrom || null, dateTo: dateTo || null });
    if (!data.success) throw new Error(data.error || "Search failed.");
    const challans = data.challans || [];
    if (challans.length === 0) {
      results.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center;">No Delivery Challans match this search.</div>`;
      return;
    }
    results.innerHTML = `
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr style="background:var(--highlight-bg);">
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Challan No.</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Date</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Project</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Ticket</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Consignee</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Returnable</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Delivery Challan</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Request Form</th>
        </tr></thead>
        <tbody>
          ${challans.map(c => `
            <tr>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.challan_number || '')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(formatOrdinalDate(c.challan_date) || c.challan_date || '')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.project_id || 'Legacy')}${c.company_name ? ' — ' + escapeHtml(c.company_name) : ''}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.ticket_id || '')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.consignee_name || '')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.morf_returnable_status || '—')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${c.document_url ? `<a href="${driveLink(c.document_url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">View ↗</a>` : '—'}</td>
              <td style="padding:8px; border:1px solid var(--border);">${c.morf_document_url ? `<a href="${driveLink(c.morf_document_url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">View ↗</a>` : '—'}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    results.innerHTML = `<div style="color:var(--danger); padding:16px; text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}
