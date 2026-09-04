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

function renderServiceTicketCard(ticket) {
  const items = Array.isArray(ticket.items) ? ticket.items : [];
  const itemsHtml = items.map(it =>
    `<div style="font-size:0.82rem; padding:3px 0;">${escapeHtml(it.materialName || it.itemCode || "")} — Qty ${escapeHtml(String(it.__releaseQty ?? it.quantity ?? ""))}</div>`
  ).join("");
  return `
    <div class="section" style="padding:16px; border:1px solid var(--border); border-radius:var(--radius);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:800; font-size:0.98rem;">${escapeHtml(ticket.ticket_id)}</div>
          <div style="color:var(--muted); font-size:0.85rem; margin-top:2px;">
            ${escapeHtml(ticket.project_id || "Legacy")}${ticket.company_name ? " — " + escapeHtml(ticket.company_name) : ""}
            ${ticket.boq_id ? " · BOQ " + escapeHtml(ticket.boq_id) : ""}
            ${ticket.job_card_number ? " · Job Card " + escapeHtml(ticket.job_card_number) : ""}
          </div>
          <div style="color:var(--muted); font-size:0.8rem; margin-top:2px;">${escapeHtml(ticket.type_of_store || "")} · Requested by ${escapeHtml(ticket.requested_returned_by || "")}</div>
        </div>
        <button class="nav-btn-styled" style="background:var(--accent);" onclick="openMaterialOutwardUploadModal('${ticket.ticket_id}')">Upload Challan + Request Form</button>
      </div>
      <div style="margin-top:10px; border-top:1px solid var(--border); padding-top:8px;">${itemsHtml}</div>
    </div>`;
}

function openMaterialOutwardUploadModal(ticketId) {
  const ticket = mowServiceTicketsCache.find(t => t.ticket_id === ticketId);
  if (!ticket) return;
  window._mowActiveTicket = ticket;
  window._mowExtractedPreview = null;
  const modal = document.getElementById("mow-upload-modal");
  const body = document.getElementById("mow-upload-modal-body");
  body.innerHTML = `
    <h3 style="margin-top:0;">Upload Delivery Challan + Material Out Request Form — ${escapeHtml(ticketId)}</h3>
    <p style="color:var(--muted); font-size:0.85rem;">${ticket.project_id ? "Project " + escapeHtml(ticket.project_id) : "Legacy project"}${ticket.company_name ? " — " + escapeHtml(ticket.company_name) : ""}</p>
    <label class="field-label" style="margin-top:0;">Delivery Challan *</label>
    <input type="file" id="mow-challan-file-input" accept=".pdf,image/*" style="margin-bottom:12px;" />
    <label class="field-label">Material Out Request Form *</label>
    <input type="file" id="mow-morf-file-input" accept=".pdf,image/*" style="margin-bottom:14px;" />
    <div style="display:flex; justify-content:flex-end; gap:10px;">
      <button class="nav-btn-styled" style="background:#718096;" onclick="closeMaterialOutwardUploadModal()">Cancel</button>
      <button class="nav-btn-styled" id="mow-extract-btn" style="background:var(--brand);" onclick="extractMaterialOutwardChallan()">Extract Both with AI</button>
    </div>
    <div id="mow-modal-inline-feedback" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
  `;
  modal.style.display = "flex";
}

function closeMaterialOutwardUploadModal() {
  const modal = document.getElementById("mow-upload-modal");
  if (modal) modal.style.display = "none";
  window._mowActiveTicket = null;
  window._mowExtractedPreview = null;
}

async function extractMaterialOutwardChallan() {
  const dcInput = document.getElementById("mow-challan-file-input");
  const morfInput = document.getElementById("mow-morf-file-input");
  const feedback = document.getElementById("mow-modal-inline-feedback");
  const dcFile = dcInput && dcInput.files[0];
  const morfFile = morfInput && morfInput.files[0];
  if (!dcFile || !morfFile) {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = !dcFile ? "Select a Delivery Challan file first." : "Select a Material Out Request Form file first.";
    return;
  }
  const extractBtn = document.getElementById("mow-extract-btn");
  if (extractBtn) { extractBtn.disabled = true; extractBtn.textContent = "Extracting..."; }
  try {
    const readB64 = f => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(f); });
    const [dcB64, morfB64] = await Promise.all([readB64(dcFile), readB64(morfFile)]);
    const challanFile = { fileName: dcFile.name, base64Data: dcB64, mimeType: dcFile.type || "application/octet-stream" };
    const morfFilePayload = { fileName: morfFile.name, base64Data: morfB64, mimeType: morfFile.type || "application/octet-stream" };
    const ticket = window._mowActiveTicket;
    const data = await apFetch({
      action: "extractDeliveryChallanPreview",
      ticketId: ticket.ticket_id, challanFile, morfFile: morfFilePayload,
    });
    if (!data.success) throw new Error(data.error || "Extraction failed.");
    window._mowExtractedPreview = { ...data, challanFile, morfFile: morfFilePayload };
    renderMaterialOutwardReviewForm(data);
  } catch (err) {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = err.message;
  } finally {
    if (extractBtn) { extractBtn.disabled = false; extractBtn.textContent = "Extract Both with AI"; }
  }
}

function renderMaterialOutwardReviewForm(preview) {
  const ticket = window._mowActiveTicket;
  const body = document.getElementById("mow-upload-modal-body");
  window._mowReleasedTotal = Number(preview.releasedTotal) || 0;
  window._mowMorfTotalFromServer = Number(preview.morfTotal) || 0;

  const lineRows = (preview.lineItems || []).map((li, idx) => `
    <tr style="${(li.quantityMismatch || li.morfQuantityMismatch) ? 'background:#fffbeb;' : ''}">
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-li-name-${idx}" value="${escapeHtml(li.materialName || '')}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-li-hsn-${idx}" value="${escapeHtml(li.hsnCode || '')}" style="width:80px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="number" id="mow-li-qty-${idx}" value="${escapeHtml(String(li.quantity ?? ''))}" oninput="recomputeMaterialOutwardCrossChecks()" style="width:90px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-li-unit-${idx}" value="${escapeHtml(li.unit || '')}" style="width:70px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border); font-size:0.78rem; color:${(li.quantityMismatch || li.morfQuantityMismatch) ? '#b45309' : 'var(--muted)'};">
        Ticket ${li.releasedQty ?? '—'} · MORF ${li.morfQty ?? '—'}
      </td>
    </tr>`).join("");

  const morfLineRows = (preview.morfLineItems || []).map((li, idx) => `
    <tr id="mow-morf-li-row-${idx}">
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-name-${idx}" value="${escapeHtml(li.materialName || '')}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="number" id="mow-morf-li-qty-${idx}" value="${escapeHtml(String(li.quantity ?? ''))}" oninput="recomputeMaterialOutwardCrossChecks()" style="width:90px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-unit-${idx}" value="${escapeHtml(li.unit || '')}" style="width:70px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-rating-${idx}" value="${escapeHtml(li.rating || '')}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
    </tr>`).join("");
  window._mowMorfLineCount = (preview.morfLineItems || []).length;

  const morf = preview.morf || {};
  const returnableOptions = ['', 'Returnable', 'Non-Returnable'].map(v =>
    `<option value="${v}" ${morf.returnableStatus === v ? 'selected' : ''}>${v || '— Select —'}</option>`).join("");

  body.innerHTML = `
    <h3 style="margin-top:0;">Review — ${escapeHtml(ticket.ticket_id)}</h3>
    <div id="mow-crosscheck-band"></div>

    <h4 style="margin-bottom:6px;">Delivery Challan</h4>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
      <div><label class="field-label" style="margin-top:0;">Challan Number *</label><input type="text" id="mow-review-number" value="${escapeHtml(preview.challanNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Challan Date *</label><input type="date" id="mow-review-date" value="${escapeHtml(preview.challanDate || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Consignee Name</label><input type="text" id="mow-review-consignee-name" value="${escapeHtml(preview.consigneeName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Consignee Address</label><input type="text" id="mow-review-consignee-address" value="${escapeHtml(preview.consigneeAddress || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">State</label><input type="text" id="mow-review-state" value="${escapeHtml(preview.consigneeState || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Contact Person</label><input type="text" id="mow-review-contact-name" value="${escapeHtml(preview.contactPersonName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Contact Number</label><input type="text" id="mow-review-contact-number" value="${escapeHtml(preview.contactNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Transporter Name</label><input type="text" id="mow-review-transporter" value="${escapeHtml(preview.transporterName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Vehicle Number</label><input type="text" id="mow-review-vehicle" value="${escapeHtml(preview.vehicleNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">LR Number</label><input type="text" id="mow-review-lr" value="${escapeHtml(preview.lrNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Freight</label><input type="text" id="mow-review-freight" value="${escapeHtml(preview.freight || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Remarks</label><input type="text" id="mow-review-remarks" value="${escapeHtml(preview.remarks || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:18px;">
      <thead><tr style="background:var(--highlight-bg);">
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Material</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">HSN</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Qty</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Unit</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Reconciliation</th>
      </tr></thead>
      <tbody id="mow-review-lines-body">${lineRows || '<tr><td colspan="5" style="padding:8px; text-align:center; color:var(--muted);">No line items extracted.</td></tr>'}</tbody>
    </table>

    <h4 style="margin-bottom:6px; border-top:1px solid var(--border); padding-top:14px;">Material Out Request Form</h4>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); padding:12px;">
      <div><label class="field-label" style="margin-top:0;">Requested By</label><input type="text" id="mow-morf-requested-by" value="${escapeHtml(morf.requestedBy || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Department</label><input type="text" id="mow-morf-department" value="${escapeHtml(morf.department || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Customer Name</label><input type="text" id="mow-morf-customer-name" value="${escapeHtml(morf.customerName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Customer Address</label><input type="text" id="mow-morf-customer-address" value="${escapeHtml(morf.customerAddress || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Contact Name</label><input type="text" id="mow-morf-contact-name" value="${escapeHtml(morf.contactName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Contact Number</label><input type="text" id="mow-morf-contact-number" value="${escapeHtml(morf.contactNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Freight Charges</label><input type="text" id="mow-morf-freight-charges" value="${escapeHtml(morf.freightCharges || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Returnable Status</label><select id="mow-morf-returnable" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);">${returnableOptions}</select></div>
      <div><label class="field-label" style="margin-top:0;">Reason</label><input type="text" id="mow-morf-reason" value="${escapeHtml(morf.reason || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Remarks</label><input type="text" id="mow-morf-remarks" value="${escapeHtml(morf.remarks || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:8px;">
      <thead><tr style="background:var(--highlight-bg);">
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Material</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Qty</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Unit</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Rating</th>
      </tr></thead>
      <tbody id="mow-morf-lines-body">${morfLineRows || '<tr><td colspan="4" style="padding:8px; text-align:center; color:var(--muted);">No line items extracted.</td></tr>'}</tbody>
    </table>
    <div style="margin-bottom:18px;"><span onclick="addMowMorfLineRow()" style="font-size:0.78rem; font-weight:700; color:var(--brand); cursor:pointer; text-decoration:underline;">+ Add row</span></div>

    <div style="display:flex; justify-content:flex-end; gap:10px;">
      <button class="nav-btn-styled" style="background:#718096;" onclick="closeMaterialOutwardUploadModal()">Cancel</button>
      <button class="nav-btn-styled" id="mow-commit-btn" style="background:var(--accent);" onclick="commitMaterialOutwardChallan()">Confirm & Save</button>
    </div>
    <div id="mow-modal-inline-feedback" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
  `;
  renderMaterialOutwardCrossCheckBand(preview.crossChecks || { blocking: [], warnings: [] }, preview.parseWarnings || []);
}

function addMowMorfLineRow() {
  const tbody = document.getElementById("mow-morf-lines-body");
  if (!tbody) return;
  if (tbody.querySelector("td[colspan]")) tbody.innerHTML = "";
  const idx = window._mowMorfLineCount++;
  const row = document.createElement("tr");
  row.id = `mow-morf-li-row-${idx}`;
  row.innerHTML = `
    <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-name-${idx}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
    <td style="padding:6px; border:1px solid var(--border);"><input type="number" id="mow-morf-li-qty-${idx}" oninput="recomputeMaterialOutwardCrossChecks()" style="width:90px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
    <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-unit-${idx}" style="width:70px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
    <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-morf-li-rating-${idx}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>`;
  tbody.appendChild(row);
}

// Re-derives just the BLOCKING quantity checks client-side, on every DC/
// MORF quantity edit, so correcting a wrong number re-enables Confirm &
// Save without needing a full re-extraction. The server re-validates the
// same totals independently at commit regardless — this is convenience,
// never the actual guard (see commitDeliveryChallan, routes/store.js).
function recomputeMaterialOutwardCrossChecks() {
  const preview = window._mowExtractedPreview;
  if (!preview) return;
  const dcQtyInputs = document.querySelectorAll('[id^="mow-li-qty-"]');
  const dcTotal = [...dcQtyInputs].reduce((s, el) => s + (Number(el.value) || 0), 0);
  const morfQtyInputs = document.querySelectorAll('[id^="mow-morf-li-qty-"]');
  const morfCount = morfQtyInputs.length;
  const morfTotal = [...morfQtyInputs].reduce((s, el) => s + (Number(el.value) || 0), 0);
  const releasedTotal = window._mowReleasedTotal || 0;
  const near = (a, b) => Math.abs(a - b) < 0.001;

  const blocking = [];
  if (dcQtyInputs.length === 0) blocking.push('No line items on the Delivery Challan.');
  if (!near(dcTotal, releasedTotal)) blocking.push(`Delivery Challan total quantity (${dcTotal}) does not match the quantity released on this ticket (${releasedTotal}).`);
  if (morfCount && !near(dcTotal, morfTotal)) blocking.push(`Delivery Challan total quantity (${dcTotal}) does not match the Material Out Request Form total (${morfTotal}).`);

  renderMaterialOutwardCrossCheckBand({ blocking, warnings: (preview.crossChecks && preview.crossChecks.warnings) || [] }, preview.parseWarnings || []);
}

function renderMaterialOutwardCrossCheckBand(crossChecks, parseWarnings) {
  const bandEl = document.getElementById("mow-crosscheck-band");
  const commitBtn = document.getElementById("mow-commit-btn");
  const blocking = crossChecks.blocking || [];
  const warnings = [...(crossChecks.warnings || []), ...(parseWarnings || [])];
  window._mowBlockingCount = blocking.length;
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

async function commitMaterialOutwardChallan() {
  const preview = window._mowExtractedPreview;
  const ticket = window._mowActiveTicket;
  if (!preview || !ticket) return;
  const feedback = document.getElementById("mow-modal-inline-feedback");
  const challanNumber = document.getElementById("mow-review-number").value.trim();
  const challanDate = document.getElementById("mow-review-date").value;
  if (!challanNumber || !challanDate) {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = "Challan Number and Challan Date are required.";
    return;
  }
  if ((window._mowBlockingCount || 0) > 0) {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = "Resolve the quantity mismatches above before saving.";
    return;
  }
  const lineItems = (preview.lineItems || []).map((_, idx) => ({
    materialName: document.getElementById(`mow-li-name-${idx}`)?.value || "",
    hsnCode: document.getElementById(`mow-li-hsn-${idx}`)?.value || "",
    quantity: document.getElementById(`mow-li-qty-${idx}`)?.value || "",
    unit: document.getElementById(`mow-li-unit-${idx}`)?.value || "",
  }));
  const morfLineItems = [];
  for (let idx = 0; idx < (window._mowMorfLineCount || 0); idx++) {
    const nameEl = document.getElementById(`mow-morf-li-name-${idx}`);
    if (!nameEl) continue; // row was never rendered (e.g. dense re-count not needed here)
    morfLineItems.push({
      materialName: nameEl.value || "",
      quantity: document.getElementById(`mow-morf-li-qty-${idx}`)?.value || "",
      unit: document.getElementById(`mow-morf-li-unit-${idx}`)?.value || "",
      rating: document.getElementById(`mow-morf-li-rating-${idx}`)?.value || "",
    });
  }
  const morf = {
    requestedBy: document.getElementById("mow-morf-requested-by").value.trim(),
    department: document.getElementById("mow-morf-department").value.trim(),
    customerName: document.getElementById("mow-morf-customer-name").value.trim(),
    customerAddress: document.getElementById("mow-morf-customer-address").value.trim(),
    contactName: document.getElementById("mow-morf-contact-name").value.trim(),
    contactNumber: document.getElementById("mow-morf-contact-number").value.trim(),
    freightCharges: document.getElementById("mow-morf-freight-charges").value.trim(),
    returnableStatus: document.getElementById("mow-morf-returnable").value,
    reason: document.getElementById("mow-morf-reason").value.trim(),
    remarks: document.getElementById("mow-morf-remarks").value.trim(),
  };

  const commitBtn = document.getElementById("mow-commit-btn");
  if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = "Saving..."; }
  try {
    const data = await apFetch({
      action: "commitDeliveryChallan",
      ticketId: ticket.ticket_id, projectId: ticket.project_id, legacyCompanyName: ticket.legacy_company_name,
      companyName: ticket.company_name,
      challanNumber, challanDate,
      consigneeName: document.getElementById("mow-review-consignee-name").value.trim(),
      consigneeAddress: document.getElementById("mow-review-consignee-address").value.trim(),
      consigneeState: document.getElementById("mow-review-state").value.trim(),
      contactPersonName: document.getElementById("mow-review-contact-name").value.trim(),
      contactNumber: document.getElementById("mow-review-contact-number").value.trim(),
      transporterName: document.getElementById("mow-review-transporter").value.trim(),
      vehicleNumber: document.getElementById("mow-review-vehicle").value.trim(),
      lrNumber: document.getElementById("mow-review-lr").value.trim(),
      freight: document.getElementById("mow-review-freight").value.trim(),
      challanRemarks: document.getElementById("mow-review-remarks").value.trim(),
      lineItems, morf, morfLineItems,
      challanFile: preview.challanFile, morfFile: preview.morfFile,
      operatorName: appActiveOperatorIdentityString || "Unknown",
    });
    if (!data.success) throw new Error(data.error || "Save failed.");
    closeMaterialOutwardUploadModal();
    showSuccessWithReset("mow-feedback-banner", `Delivery Challan ${escapeHtml(challanNumber)} and Material Out Request Form saved for ${escapeHtml(ticket.ticket_id)}.`, "Load Next Ticket", "loadMaterialOutwardServiceQueue()");
    loadMaterialOutwardServiceQueue();
  } catch (err) {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = err.message;
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
