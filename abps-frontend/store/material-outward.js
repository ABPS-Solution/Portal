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
        <button class="nav-btn-styled" style="background:var(--accent);" onclick="openMaterialOutwardUploadModal('${ticket.ticket_id}')">Upload Delivery Challan</button>
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
    <h3 style="margin-top:0;">Upload Delivery Challan — ${escapeHtml(ticketId)}</h3>
    <p style="color:var(--muted); font-size:0.85rem;">${ticket.project_id ? "Project " + escapeHtml(ticket.project_id) : "Legacy project"}${ticket.company_name ? " — " + escapeHtml(ticket.company_name) : ""}</p>
    <input type="file" id="mow-challan-file-input" accept=".pdf,image/*" style="margin-bottom:14px;" />
    <div style="display:flex; justify-content:flex-end; gap:10px;">
      <button class="nav-btn-styled" style="background:#718096;" onclick="closeMaterialOutwardUploadModal()">Cancel</button>
      <button class="nav-btn-styled" id="mow-extract-btn" style="background:var(--brand);" onclick="extractMaterialOutwardChallan()">Extract with AI</button>
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
  const fileInput = document.getElementById("mow-challan-file-input");
  const feedback = document.getElementById("mow-modal-inline-feedback");
  const file = fileInput && fileInput.files[0];
  if (!file) {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = "Select a Delivery Challan file first.";
    return;
  }
  const extractBtn = document.getElementById("mow-extract-btn");
  if (extractBtn) { extractBtn.disabled = true; extractBtn.textContent = "Extracting..."; }
  try {
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
    const ticket = window._mowActiveTicket;
    const data = await apFetch({
      action: "extractDeliveryChallanPreview",
      ticketId: ticket.ticket_id, projectId: ticket.project_id,
      fileName: file.name, base64Data: b64, mimeType: file.type || "application/octet-stream",
    });
    if (!data.success) throw new Error(data.error || "Extraction failed.");
    window._mowExtractedPreview = { ...data, fileName: file.name, base64Data: b64, mimeType: file.type || "application/octet-stream" };
    renderMaterialOutwardReviewForm(data);
  } catch (err) {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = err.message;
  } finally {
    if (extractBtn) { extractBtn.disabled = false; extractBtn.textContent = "Extract with AI"; }
  }
}

function renderMaterialOutwardReviewForm(preview) {
  const ticket = window._mowActiveTicket;
  const body = document.getElementById("mow-upload-modal-body");
  const lineRows = (preview.lineItems || []).map((li, idx) => `
    <tr style="${li.quantityMismatch ? 'background:#fffbeb;' : ''}">
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-li-name-${idx}" value="${escapeHtml(li.materialName || '')}" style="width:100%; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="number" id="mow-li-qty-${idx}" value="${escapeHtml(String(li.quantity ?? ''))}" style="width:90px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border);"><input type="text" id="mow-li-unit-${idx}" value="${escapeHtml(li.unit || '')}" style="width:70px; border:1px solid var(--border); border-radius:4px; padding:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border); font-size:0.78rem; color:${li.quantityMismatch ? '#b45309' : 'var(--muted)'};">
        ${li.releasedQty != null ? `Ticket released ${escapeHtml(String(li.releasedQty))}${li.quantityMismatch ? ' — mismatch' : ''}` : '—'}
      </td>
    </tr>`).join("");

  body.innerHTML = `
    <h3 style="margin-top:0;">Review Delivery Challan — ${escapeHtml(ticket.ticket_id)}</h3>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
      <div><label class="field-label" style="margin-top:0;">Challan Number *</label><input type="text" id="mow-review-number" value="${escapeHtml(preview.challanNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Challan Date *</label><input type="date" id="mow-review-date" value="${escapeHtml(preview.challanDate || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Consignee Name</label><input type="text" id="mow-review-consignee-name" value="${escapeHtml(preview.consigneeName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Consignee Address</label><input type="text" id="mow-review-consignee-address" value="${escapeHtml(preview.consigneeAddress || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Transporter Name</label><input type="text" id="mow-review-transporter" value="${escapeHtml(preview.transporterName || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">Vehicle Number</label><input type="text" id="mow-review-vehicle" value="${escapeHtml(preview.vehicleNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
      <div><label class="field-label" style="margin-top:0;">LR Number</label><input type="text" id="mow-review-lr" value="${escapeHtml(preview.lrNumber || '')}" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);" /></div>
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:14px;">
      <thead><tr style="background:var(--highlight-bg);">
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Material</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Qty</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Unit</th>
        <th style="padding:6px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Reconciliation</th>
      </tr></thead>
      <tbody id="mow-review-lines-body">${lineRows || '<tr><td colspan="4" style="padding:8px; text-align:center; color:var(--muted);">No line items extracted.</td></tr>'}</tbody>
    </table>
    ${preview.documentUrl ? `<div style="margin-bottom:12px;"><a href="${driveLink(preview.documentUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">View Uploaded Document ↗</a></div>` : ''}
    <div style="display:flex; justify-content:flex-end; gap:10px;">
      <button class="nav-btn-styled" style="background:#718096;" onclick="closeMaterialOutwardUploadModal()">Cancel</button>
      <button class="nav-btn-styled" id="mow-commit-btn" style="background:var(--accent);" onclick="commitMaterialOutwardChallan()">Confirm & Save Challan</button>
    </div>
    <div id="mow-modal-inline-feedback" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
  `;
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
  const lineItems = (preview.lineItems || []).map((_, idx) => ({
    materialName: document.getElementById(`mow-li-name-${idx}`)?.value || "",
    quantity: document.getElementById(`mow-li-qty-${idx}`)?.value || "",
    unit: document.getElementById(`mow-li-unit-${idx}`)?.value || "",
  }));

  const commitBtn = document.getElementById("mow-commit-btn");
  if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = "Saving..."; }
  try {
    const data = await apFetch({
      action: "commitDeliveryChallan",
      ticketId: ticket.ticket_id, projectId: ticket.project_id, legacyCompanyName: ticket.legacy_company_name,
      challanNumber, challanDate,
      consigneeName: document.getElementById("mow-review-consignee-name").value.trim(),
      consigneeAddress: document.getElementById("mow-review-consignee-address").value.trim(),
      transporterName: document.getElementById("mow-review-transporter").value.trim(),
      vehicleNumber: document.getElementById("mow-review-vehicle").value.trim(),
      lrNumber: document.getElementById("mow-review-lr").value.trim(),
      lineItems, documentUrl: preview.documentUrl || null,
      fileName: preview.fileName, base64Data: preview.base64Data, mimeType: preview.mimeType,
      operatorName: appActiveOperatorIdentityString || "Unknown",
    });
    if (!data.success) throw new Error(data.error || "Save failed.");
    closeMaterialOutwardUploadModal();
    const banner = document.getElementById("mow-feedback-banner");
    showSuccessWithReset("mow-feedback-banner", `Delivery Challan ${escapeHtml(challanNumber)} saved for ${escapeHtml(ticket.ticket_id)}.`, "Load Next Ticket", "loadMaterialOutwardServiceQueue()");
    loadMaterialOutwardServiceQueue();
  } catch (err) {
    feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
    feedback.textContent = err.message;
  } finally {
    if (commitBtn) { commitBtn.disabled = false; commitBtn.textContent = "Confirm & Save Challan"; }
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
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Document</th>
        </tr></thead>
        <tbody>
          ${challans.map(c => `
            <tr>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.challan_number || '')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(formatDMYFromISO ? formatDMYFromISO(c.challan_date) : (c.challan_date || ''))}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.project_id || 'Legacy')}${c.company_name ? ' — ' + escapeHtml(c.company_name) : ''}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.ticket_id || '')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.consignee_name || '')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${c.document_url ? `<a href="${driveLink(c.document_url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">View ↗</a>` : '—'}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    results.innerHTML = `<div style="color:var(--danger); padding:16px; text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}
