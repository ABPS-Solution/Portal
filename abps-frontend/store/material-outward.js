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
window._mowMorfLineCountByTicket = window._mowMorfLineCountByTicket || {};
window._mowReleasedTotalByTicket = window._mowReleasedTotalByTicket || {};
window._mowBlockingCountByTicket = window._mowBlockingCountByTicket || {};

function renderServiceTicketCard(ticket) {
  const ticketId = ticket.ticket_id;
  const items = Array.isArray(ticket.items) ? ticket.items : [];
  // materialName already carries the full Name - Rating - Make: X combined
  // string (fetchServiceItemCatalog/fetchJobCardMaterials both build it
  // that way — see CLAUDE.md's combinedName convention) — no separate join
  // needed here, this is genuinely the same string the operator picked
  // from the item dropdown at ticket-creation time.
  const materialRowsHtml = items.map(it => `
    <tr>
      <td style="padding:6px; border:1px solid var(--border); text-align:left;">${escapeHtml(it.materialName || it.itemCode || "")}</td>
      <td style="padding:6px; border:1px solid var(--border); text-align:center;">${escapeHtml(it.unitType || "—")}</td>
      <td style="padding:6px; border:1px solid var(--border); text-align:center; font-family:monospace; font-weight:700;">${escapeHtml(String(fmtQty(it.__releaseQty ?? it.quantity ?? 0)))}</td>
    </tr>`).join("");

  return `
    <div class="section" id="mow-card-${ticketId}" style="padding:16px; border:1px solid var(--border); border-radius:var(--radius);">
      <div>
        <div style="font-weight:800; font-size:0.98rem;">${escapeHtml(ticketId)}</div>
        <div style="color:var(--muted); font-size:0.85rem; margin-top:2px;">
          ${escapeHtml(ticket.project_id || "Legacy")}${ticket.company_name ? " — " + escapeHtml(ticket.company_name) : ""}
          ${ticket.boq_id ? " · BOQ " + escapeHtml(ticket.boq_id) : ""}
          ${ticket.job_card_number ? " · Job Card " + escapeHtml(ticket.job_card_number) : ""}
        </div>
        <div style="color:var(--muted); font-size:0.8rem; margin-top:2px;">${escapeHtml(ticket.type_of_store || "")} · Requested by ${escapeHtml(ticket.requested_returned_by || "")}</div>
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

      <div style="margin-top:14px; border-top:1px solid var(--border); padding-top:10px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
          <thead><tr style="background:var(--highlight-bg);">
            <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Material Name</th>
            <th style="padding:6px; border:1px solid var(--border); text-align:center; width:90px; font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Unit</th>
            <th style="padding:6px; border:1px solid var(--border); text-align:center; width:90px; font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Qty</th>
          </tr></thead>
          <tbody>${materialRowsHtml || '<tr><td colspan="3" style="padding:8px; text-align:center; color:var(--muted);">No items on this ticket.</td></tr>'}</tbody>
        </table>
      </div>

      <div id="mow-inline-feedback-${ticketId}" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
    </div>`;
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
  window._mowReleasedTotalByTicket[ticketId] = Number(preview.releasedTotal) || 0;
  window._mowMorfLineCountByTicket[ticketId] = (preview.morfLineItems || []).length;

  const lineRows = (preview.lineItems || []).map((li, idx) => `
    <tr style="${(li.quantityMismatch || li.morfQuantityMismatch) ? 'background:#fffbeb;' : ''}">
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-li-name-${ticketId}-${idx}" value="${escapeHtml(li.materialName || '')}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-li-hsn-${ticketId}-${idx}" value="${escapeHtml(li.hsnCode || '')}" style="width:80px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="number" id="mow-li-qty-${ticketId}-${idx}" value="${escapeHtml(String(li.quantity ?? ''))}" oninput="recomputeMaterialOutwardCrossChecks('${ticketId}')" style="width:90px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-li-unit-${ticketId}-${idx}" value="${escapeHtml(li.unit || '')}" style="width:70px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border); font-size:0.78rem; color:${(li.quantityMismatch || li.morfQuantityMismatch) ? '#b45309' : 'var(--muted)'};">
        Ticket ${li.releasedQty ?? '—'} · MORF ${li.morfQty ?? '—'}
      </td>
    </tr>`).join("");

  const morfLineRows = (preview.morfLineItems || []).map((li, idx) => `
    <tr id="mow-morf-li-row-${ticketId}-${idx}">
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-name-${ticketId}-${idx}" value="${escapeHtml(li.materialName || '')}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="number" id="mow-morf-li-qty-${ticketId}-${idx}" value="${escapeHtml(String(li.quantity ?? ''))}" oninput="recomputeMaterialOutwardCrossChecks('${ticketId}')" style="width:90px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-unit-${ticketId}-${idx}" value="${escapeHtml(li.unit || '')}" style="width:70px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-rating-${ticketId}-${idx}" value="${escapeHtml(li.rating || '')}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
    </tr>`).join("");

  const morf = preview.morf || {};
  const returnableOptions = ['', 'Returnable', 'Non-Returnable'].map(v =>
    `<option value="${v}" ${morf.returnableStatus === v ? 'selected' : ''}>${v || '— Select —'}</option>`).join("");

  zone.innerHTML = `
    <div style="margin-top:14px; border-top:1px solid var(--border); padding-top:14px;">
      <h4 style="margin-top:0;">Review — ${escapeHtml(ticketId)}</h4>
      <div id="mow-crosscheck-band-${ticketId}"></div>

      <h4 style="margin-bottom:6px;">Delivery Challan</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
        <div><label class="field-label" style="margin-top:0;">Challan Number *</label><input type="text" id="mow-review-number-${ticketId}" value="${escapeHtml(preview.challanNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Challan Date *</label><input type="date" id="mow-review-date-${ticketId}" value="${escapeHtml(preview.challanDate || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Consignee Name</label><input type="text" id="mow-review-consignee-name-${ticketId}" value="${escapeHtml(preview.consigneeName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Consignee Address</label><input type="text" id="mow-review-consignee-address-${ticketId}" value="${escapeHtml(preview.consigneeAddress || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">State</label><input type="text" id="mow-review-state-${ticketId}" value="${escapeHtml(preview.consigneeState || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Contact Person</label><input type="text" id="mow-review-contact-name-${ticketId}" value="${escapeHtml(preview.contactPersonName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Contact Number</label><input type="text" id="mow-review-contact-number-${ticketId}" value="${escapeHtml(preview.contactNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Transporter Name</label><input type="text" id="mow-review-transporter-${ticketId}" value="${escapeHtml(preview.transporterName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Vehicle Number</label><input type="text" id="mow-review-vehicle-${ticketId}" value="${escapeHtml(preview.vehicleNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">LR Number</label><input type="text" id="mow-review-lr-${ticketId}" value="${escapeHtml(preview.lrNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Freight</label><input type="text" id="mow-review-freight-${ticketId}" value="${escapeHtml(preview.freight || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Remarks</label><input type="text" id="mow-review-remarks-${ticketId}" value="${escapeHtml(preview.remarks || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      </div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:18px;">
        <thead><tr style="background:var(--highlight-bg);">
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Material</th>
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">HSN</th>
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Qty</th>
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Unit</th>
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Reconciliation</th>
        </tr></thead>
        <tbody id="mow-review-lines-body-${ticketId}">${lineRows || '<tr><td colspan="5" style="padding:8px; text-align:center; color:var(--muted);">No line items extracted.</td></tr>'}</tbody>
      </table>

      <h4 style="margin-bottom:6px; border-top:1px solid var(--border); padding-top:14px;">Material Out Request Form</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); padding:12px;">
        <div><label class="field-label" style="margin-top:0;">Requested By</label><input type="text" id="mow-morf-requested-by-${ticketId}" value="${escapeHtml(morf.requestedBy || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Department</label><input type="text" id="mow-morf-department-${ticketId}" value="${escapeHtml(morf.department || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Customer Name</label><input type="text" id="mow-morf-customer-name-${ticketId}" value="${escapeHtml(morf.customerName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Customer Address</label><input type="text" id="mow-morf-customer-address-${ticketId}" value="${escapeHtml(morf.customerAddress || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Contact Name</label><input type="text" id="mow-morf-contact-name-${ticketId}" value="${escapeHtml(morf.contactName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Contact Number</label><input type="text" id="mow-morf-contact-number-${ticketId}" value="${escapeHtml(morf.contactNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Freight Charges</label><input type="text" id="mow-morf-freight-charges-${ticketId}" value="${escapeHtml(morf.freightCharges || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Returnable Status</label><select id="mow-morf-returnable-${ticketId}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);">${returnableOptions}</select></div>
        <div><label class="field-label" style="margin-top:0;">Reason</label><input type="text" id="mow-morf-reason-${ticketId}" value="${escapeHtml(morf.reason || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label" style="margin-top:0;">Remarks</label><input type="text" id="mow-morf-remarks-${ticketId}" value="${escapeHtml(morf.remarks || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      </div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:8px;">
        <thead><tr style="background:var(--highlight-bg);">
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Material</th>
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Qty</th>
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Unit</th>
          <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Rating</th>
        </tr></thead>
        <tbody id="mow-morf-lines-body-${ticketId}">${morfLineRows || '<tr><td colspan="4" style="padding:8px; text-align:center; color:var(--muted);">No line items extracted.</td></tr>'}</tbody>
      </table>
      <div style="margin-bottom:18px;"><span onclick="addMowMorfLineRow('${ticketId}')" style="font-size:0.78rem; font-weight:700; color:var(--brand); cursor:pointer; text-decoration:underline;">+ Add row</span></div>

      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="nav-btn-styled" style="background:#718096;" onclick="cancelMaterialOutwardReview('${ticketId}')">Cancel</button>
        <button class="nav-btn-styled" id="mow-commit-btn-${ticketId}" style="background:var(--accent);" onclick="commitMaterialOutwardChallan('${ticketId}')">Confirm & Save</button>
      </div>
      <div id="mow-modal-inline-feedback-${ticketId}" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
    </div>
  `;
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

function addMowMorfLineRow(ticketId) {
  const tbody = document.getElementById(`mow-morf-lines-body-${ticketId}`);
  if (!tbody) return;
  if (tbody.querySelector("td[colspan]")) tbody.innerHTML = "";
  const idx = window._mowMorfLineCountByTicket[ticketId] || 0;
  window._mowMorfLineCountByTicket[ticketId] = idx + 1;
  const row = document.createElement("tr");
  row.id = `mow-morf-li-row-${ticketId}-${idx}`;
  row.innerHTML = `
    <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-name-${ticketId}-${idx}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
    <td style="padding:6px; border:1px solid var(--border);"><input type="number" id="mow-morf-li-qty-${ticketId}-${idx}" oninput="recomputeMaterialOutwardCrossChecks('${ticketId}')" style="width:90px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
    <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-unit-${ticketId}-${idx}" style="width:70px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
    <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-rating-${ticketId}-${idx}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>`;
  tbody.appendChild(row);
}

// Re-derives just the BLOCKING quantity checks client-side, on every DC/
// MORF quantity edit, so correcting a wrong number re-enables Confirm &
// Save without needing a full re-extraction. The server re-validates the
// same totals independently at commit regardless — this is convenience,
// never the actual guard (see commitDeliveryChallan, routes/store.js).
function recomputeMaterialOutwardCrossChecks(ticketId) {
  const preview = window._mowExtractedPreviewByTicket[ticketId];
  if (!preview) return;
  const dcQtyInputs = document.querySelectorAll(`[id^="mow-li-qty-${ticketId}-"]`);
  const dcTotal = [...dcQtyInputs].reduce((s, el) => s + (Number(el.value) || 0), 0);
  const morfQtyInputs = document.querySelectorAll(`[id^="mow-morf-li-qty-${ticketId}-"]`);
  const morfCount = morfQtyInputs.length;
  const morfTotal = [...morfQtyInputs].reduce((s, el) => s + (Number(el.value) || 0), 0);
  const releasedTotal = window._mowReleasedTotalByTicket[ticketId] || 0;
  const near = (a, b) => Math.abs(a - b) < 0.001;

  const blocking = [];
  if (dcQtyInputs.length === 0) blocking.push('No line items on the Delivery Challan.');
  if (!near(dcTotal, releasedTotal)) blocking.push(`Delivery Challan total quantity (${dcTotal}) does not match the quantity released on this ticket (${releasedTotal}).`);
  if (morfCount && !near(dcTotal, morfTotal)) blocking.push(`Delivery Challan total quantity (${dcTotal}) does not match the Material Out Request Form total (${morfTotal}).`);

  renderMaterialOutwardCrossCheckBand(ticketId, { blocking, warnings: (preview.crossChecks && preview.crossChecks.warnings) || [] }, preview.parseWarnings || []);
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
  if (!challanNumber || !challanDate) {
    showError("Challan Number and Challan Date are required.");
    return;
  }
  if ((window._mowBlockingCountByTicket[ticketId] || 0) > 0) {
    showError("Resolve the quantity mismatches above before saving.");
    return;
  }
  const lineItems = (preview.lineItems || []).map((_, idx) => ({
    materialName: document.getElementById(`mow-li-name-${ticketId}-${idx}`)?.value || "",
    hsnCode: document.getElementById(`mow-li-hsn-${ticketId}-${idx}`)?.value || "",
    quantity: document.getElementById(`mow-li-qty-${ticketId}-${idx}`)?.value || "",
    unit: document.getElementById(`mow-li-unit-${ticketId}-${idx}`)?.value || "",
  }));
  const morfLineItems = [];
  for (let idx = 0; idx < (window._mowMorfLineCountByTicket[ticketId] || 0); idx++) {
    const nameEl = document.getElementById(`mow-morf-li-name-${ticketId}-${idx}`);
    if (!nameEl) continue; // row was never rendered (e.g. dense re-count not needed here)
    morfLineItems.push({
      materialName: nameEl.value || "",
      quantity: document.getElementById(`mow-morf-li-qty-${ticketId}-${idx}`)?.value || "",
      unit: document.getElementById(`mow-morf-li-unit-${ticketId}-${idx}`)?.value || "",
      rating: document.getElementById(`mow-morf-li-rating-${ticketId}-${idx}`)?.value || "",
    });
  }
  const morf = {
    requestedBy: document.getElementById(`mow-morf-requested-by-${ticketId}`).value.trim(),
    department: document.getElementById(`mow-morf-department-${ticketId}`).value.trim(),
    customerName: document.getElementById(`mow-morf-customer-name-${ticketId}`).value.trim(),
    customerAddress: document.getElementById(`mow-morf-customer-address-${ticketId}`).value.trim(),
    contactName: document.getElementById(`mow-morf-contact-name-${ticketId}`).value.trim(),
    contactNumber: document.getElementById(`mow-morf-contact-number-${ticketId}`).value.trim(),
    freightCharges: document.getElementById(`mow-morf-freight-charges-${ticketId}`).value.trim(),
    returnableStatus: document.getElementById(`mow-morf-returnable-${ticketId}`).value,
    reason: document.getElementById(`mow-morf-reason-${ticketId}`).value.trim(),
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
      consigneeName: document.getElementById(`mow-review-consignee-name-${ticketId}`).value.trim(),
      consigneeAddress: document.getElementById(`mow-review-consignee-address-${ticketId}`).value.trim(),
      consigneeState: document.getElementById(`mow-review-state-${ticketId}`).value.trim(),
      contactPersonName: document.getElementById(`mow-review-contact-name-${ticketId}`).value.trim(),
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
