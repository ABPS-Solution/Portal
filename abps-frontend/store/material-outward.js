// ═══════════════════════════════════════════════════════════════════════
// Material Outward on Delivery Challan (migration 211, 20 Sep 2026) —
// system-generated document, PDFShift via lib/deliveryChallanTemplate.js
// on the backend, replacing the old scanned-upload + AI-extraction flow.
// Two toggles: "Materials for Outward" (approved tickets with a Purpose
// set — Service/Processing/Replacement — waiting on a challan) and
// "Search Challans" (the register, filterable by project + date range).
//
// Same watermarked checking-draft paper-review loop as RM PO's Checking
// Draft and Project Dispatch Invoice, collapsed onto one screen for one
// person (no separate maker/checker here — everything is
// perm_material_outward): Save Draft (fields, no PDF, no number) ->
// Generate Checking Draft (as many times as needed) -> Finalise Challan
// (mints the real number + the clean PDF).
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
  // Restores visibility in case a prior Finalise hid this feed to show
  // its own dedicated success view (see mowFinaliseChallan/
  // mowResetAfterChallanSave) — every path back into this queue (toggle
  // switch, Load Next Ticket, Save/Generate/Discard reloads) goes
  // through here, so this is the one place that needs to undo that hide.
  feed.style.display = "flex";
  feed.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center;">Loading approved tickets awaiting a Delivery Challan...</div>`;
  try {
    const data = await apFetch({ action: "fetchServiceTicketsAwaitingChallan" });
    if (!data.success) throw new Error(data.error || "Failed to load.");
    mowServiceTicketsCache = data.tickets || [];
    if (mowServiceTicketsCache.length === 0) {
      feed.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center;">No approved tickets are awaiting a Delivery Challan.</div>`;
      return;
    }
    feed.innerHTML = mowServiceTicketsCache.map(renderServiceTicketCard).join("");
    mowServiceTicketsCache.forEach(t => mowValidateCard(t.ticket_id));
    autoGrowAllIn(feed);
  } catch (err) {
    feed.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}

// Per-ticket client-side blocker count — this screen can have several
// approved tickets' cards on the page at once, so this is keyed by
// ticketId rather than a single "active ticket".
window._mowBlockingCountByTicket = window._mowBlockingCountByTicket || {};

// mowBuildDisplayLineItems — the materials table's row source. Prefers
// the draft's own line_items (already {itemCode, description, hsnCode,
// quantity, unit}, built server-side by saveDeliveryChallanDraft) so a
// refreshed/resumed card shows whatever HSN codes were already typed;
// falls back to building a blank-HSN display straight from the ticket's
// approved release for a ticket that has no draft yet.
function mowBuildDisplayLineItems(ticket) {
  if (Array.isArray(ticket.line_items) && ticket.line_items.length) return ticket.line_items;
  return (ticket.items || []).map(it => ({
    itemCode: it.itemCode,
    description: it.materialName || it.itemCode || "",
    hsnCode: "",
    quantity: it.released ?? it.__releaseQty ?? it.quantity ?? 0,
    unit: it.unitType || "",
  }));
}

function renderServiceTicketCard(ticket) {
  const ticketId = ticket.ticket_id;
  const hasDraft = !!ticket.challan_id;
  const items = mowBuildDisplayLineItems(ticket);
  const todayStr = (typeof formatOrdinalDate === 'function') ? formatOrdinalDate(new Date()) : new Date().toLocaleDateString();

  const returnableOptions = ['', 'Returnable', 'Non-Returnable'].map(v =>
    `<option value="${v}" ${(ticket.returnable_status || '') === v ? 'selected' : ''}>${v || '— Select —'}</option>`).join("");

  const materialRowsHtml = items.map((it, i) => `
    <tr>
      <td style="padding:8px; border:1px solid var(--border); text-align:center;">${i + 1}</td>
      <td style="padding:8px; border:1px solid var(--border); font-family:monospace; text-align:center;">${escapeHtml(it.itemCode || '')}</td>
      <td style="padding:8px; border:1px solid var(--border); white-space:normal; word-break:break-word;">${escapeHtml(it.description || '')}</td>
      <td style="padding:6px; border:1px solid var(--border); text-align:center;">
        <input type="text" class="mow-hsn-input" data-item-code="${escapeHtml(it.itemCode || '')}" data-ticket-id="${escapeHtml(ticketId)}"
               value="${escapeHtml(it.hsnCode || '')}" oninput="mowValidateCard('${ticketId}')"
               style="width:90px; text-align:center; padding:6px; border:1px solid ${(it.hsnCode || '').trim() ? 'var(--border)' : 'var(--danger)'}; border-radius:var(--radius);" />
      </td>
      <td style="padding:8px; border:1px solid var(--border); text-align:center; font-family:monospace; font-weight:700;">${escapeHtml(String(fmtQty(it.quantity ?? 0)))}</td>
      <td style="padding:8px; border:1px solid var(--border); text-align:center;">${escapeHtml(it.unit || "—")}</td>
    </tr>`).join("");

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

      <div style="margin-top:14px; border-top:1px solid var(--border); padding-top:12px;">
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px 16px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          <div><label class="field-label" style="margin-top:0;">Purpose</label><div style="padding:8px; font-weight:700;">${escapeHtml(ticket.outward_purpose || '—')}</div></div>
          <div><label class="field-label" style="margin-top:0;">Status *</label><select id="mow-status-${ticketId}" oninput="mowValidateCard('${ticketId}')" onchange="mowValidateCard('${ticketId}')" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius);">${returnableOptions}</select></div>
          <div><label class="field-label" style="margin-top:0;">Challan No</label><div style="padding:8px; color:var(--muted); font-style:italic;">allocated on finalise</div></div>
          <div><label class="field-label" style="margin-top:0;">Challan Date</label><div style="padding:8px;">${escapeHtml(todayStr)}</div></div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px 16px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          ${mowFieldFor(ticketId, 'Company Name', 'company', ticket.consignee_name, true)}
          ${mowFieldFor(ticketId, 'Contact Name', 'contact-name', ticket.contact_person_name, true)}
          ${mowFieldFor(ticketId, 'Contact Number', 'contact-number', ticket.contact_number, false)}
        </div>
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px 16px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          ${mowFieldFor(ticketId, 'Address', 'address', ticket.consignee_address, true)}
          ${mowFieldFor(ticketId, 'State', 'state', ticket.consignee_state, false)}
        </div>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px 16px; margin-bottom:16px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          ${mowFieldFor(ticketId, 'LR No', 'lr', ticket.lr_number, false)}
          ${mowFieldFor(ticketId, 'Transport Name', 'transport', ticket.transporter_name, false)}
          ${mowFieldFor(ticketId, 'Freight', 'freight', ticket.freight, false)}
        </div>
        <div style="margin-bottom:16px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          ${mowFieldFor(ticketId, 'Note (optional)', 'note', ticket.challan_remarks, false)}
        </div>

        <h4 style="margin:0 0 6px; font-size:0.95rem; font-weight:800; color:var(--brand);">Materials</h4>
        <p style="margin:0 0 8px; font-size:0.78rem; color:var(--muted);">Item Code, Description, Qty and Unit come from the approved Material Request — not editable here. HSN Code is required for every row.</p>
        <table style="width:100%; border-collapse:collapse; margin-bottom:14px; table-layout:fixed;">
          <colgroup><col style="width:6%;" /><col style="width:14%;" /><col style="width:38%;" /><col style="width:14%;" /><col style="width:14%;" /><col style="width:14%;" /></colgroup>
          <thead><tr style="background:var(--highlight-bg);">
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Sr</th>
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Item Code</th>
            <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Description of Material</th>
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">HSN Code *</th>
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Qty</th>
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Unit</th>
          </tr></thead>
          <tbody>${materialRowsHtml || '<tr><td colspan="6" style="padding:8px; text-align:center; color:var(--muted);">No items on this ticket.</td></tr>'}</tbody>
        </table>

        <div id="mow-crosscheck-band-${ticketId}"></div>

        <div style="display:flex; justify-content:flex-end; align-items:center; gap:10px; flex-wrap:wrap;">
          ${ticket.checking_doc_url ? `<a href="${driveLink(ticket.checking_doc_url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; margin-right:auto;">View Checking Draft #${escapeHtml(String(ticket.checking_draft_count || ''))} ↗</a>` : '<span></span>'}
          ${hasDraft ? `<button class="nav-btn-styled" id="mow-discard-btn-${ticketId}" style="background:#718096;" onclick="mowDiscardDraft('${ticketId}')">Discard Draft</button>` : ''}
          <button class="nav-btn-styled" id="mow-save-btn-${ticketId}" style="background:#718096;" onclick="mowSaveDraft('${ticketId}')">Save Draft</button>
          <button class="nav-btn-styled" id="mow-checking-btn-${ticketId}" style="background:var(--brand);" onclick="mowGenerateCheckingDraft('${ticketId}')">Generate Checking Draft</button>
          <button class="nav-btn-styled" id="mow-finalise-btn-${ticketId}" style="background:var(--accent);" onclick="mowFinaliseChallan('${ticketId}')">Finalise Challan</button>
        </div>
        <div id="mow-inline-feedback-${ticketId}" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
      </div>
    </div>`;
}

// mowFieldFor — thin wrapper over the shared auto-growing-textarea
// pattern, without the mowField id-parsing hack above (kept simple:
// every caller passes the ticketId explicitly).
function mowFieldFor(ticketId, label, key, value, required) {
  const id = `mow-${key}-${ticketId}`;
  return `<div><label class="field-label" style="margin-top:0;">${label}${required ? ' *' : ''}</label><textarea rows="1" id="${id}" oninput="autoGrowTextField(this); mowValidateCard('${ticketId}');" onfocus="autoGrowTextField(this);" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:var(--radius); resize:none; overflow:hidden; font-family:inherit; font-size:inherit;">${escapeHtml(value || '')}</textarea></div>`;
}

// mowValidateCard — client-side validation only ("a convenience, never
// the guard" — every rule here is re-enforced server-side in
// saveDeliveryChallanDraft/generateDeliveryChallanCheckingDraft/
// finaliseDeliveryChallan). Live-toggles Generate/Finalise disabled state
// and red-borders any empty HSN cell.
function mowValidateCard(ticketId) {
  const card = document.getElementById(`mow-card-${ticketId}`);
  if (!card) return;
  const errors = [];
  const status = document.getElementById(`mow-status-${ticketId}`)?.value || '';
  if (!status) errors.push('Select a Status (Returnable / Non-Returnable).');
  const company = document.getElementById(`mow-company-${ticketId}`)?.value.trim() || '';
  if (!company) errors.push('Company Name is required.');
  const contactName = document.getElementById(`mow-contact-name-${ticketId}`)?.value.trim() || '';
  if (!contactName) errors.push('Contact Name is required.');
  const address = document.getElementById(`mow-address-${ticketId}`)?.value.trim() || '';
  if (!address) errors.push('Address is required.');
  const hsnInputs = card.querySelectorAll('.mow-hsn-input');
  let missingHsn = 0;
  hsnInputs.forEach(inp => {
    const filled = !!inp.value.trim();
    inp.style.borderColor = filled ? 'var(--border)' : 'var(--danger)';
    if (!filled) missingHsn++;
  });
  if (missingHsn > 0) errors.push(`HSN Code is required for ${missingHsn} material row${missingHsn > 1 ? 's' : ''}.`);

  window._mowBlockingCountByTicket[ticketId] = errors.length;
  const bandEl = document.getElementById(`mow-crosscheck-band-${ticketId}`);
  if (bandEl) {
    bandEl.innerHTML = errors.length
      ? `<div style="margin-bottom:10px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-size:0.82rem;">
          <strong>Cannot generate a checking draft or finalise until these are resolved:</strong>
          <ul style="margin:6px 0 0; padding-left:18px;">${errors.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul></div>`
      : '';
  }
  ['mow-checking-btn-', 'mow-finalise-btn-'].forEach(prefix => {
    const btn = document.getElementById(`${prefix}${ticketId}`);
    if (btn) {
      btn.disabled = errors.length > 0;
      btn.style.opacity = errors.length > 0 ? "0.5" : "1";
      btn.style.cursor = errors.length > 0 ? "not-allowed" : "pointer";
    }
  });
}

function mowShowInlineError(ticketId, msg) {
  const feedback = document.getElementById(`mow-inline-feedback-${ticketId}`);
  if (!feedback) return;
  feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
  feedback.textContent = msg;
}

// mowCollectCardPayload — the fields this screen actually lets the
// operator set, plus an hsnByItemCode map built from data-item-code
// rather than DOM order, so a reordered/re-rendered table can never
// mis-assign an HSN code to the wrong material line.
function mowCollectCardPayload(ticketId) {
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const hsnByItemCode = {};
  document.querySelectorAll(`.mow-hsn-input[data-ticket-id="${ticketId}"]`).forEach(inp => {
    hsnByItemCode[inp.dataset.itemCode] = inp.value.trim();
  });
  return {
    ticketId,
    returnableStatus: document.getElementById(`mow-status-${ticketId}`)?.value || '',
    companyName: val(`mow-company-${ticketId}`),
    contactName: val(`mow-contact-name-${ticketId}`),
    contactNumber: val(`mow-contact-number-${ticketId}`),
    address: val(`mow-address-${ticketId}`),
    state: val(`mow-state-${ticketId}`),
    lrNo: val(`mow-lr-${ticketId}`),
    transportName: val(`mow-transport-${ticketId}`),
    freight: val(`mow-freight-${ticketId}`),
    note: val(`mow-note-${ticketId}`),
    hsnByItemCode,
    operatorName: appActiveOperatorIdentityString || "Unknown",
  };
}

// mowSaveDraftCore — the shared save step Generate Checking Draft and
// Finalise both run first (so neither can act on stale field values
// without the operator needing a separate explicit Save click). Returns
// true/false; on failure it has already shown the inline error.
async function mowSaveDraftCore(ticketId) {
  try {
    const data = await apFetch({ action: "saveDeliveryChallanDraft", ...mowCollectCardPayload(ticketId) });
    if (!data.success) throw new Error(data.error || "Save failed.");
    return true;
  } catch (err) {
    mowShowInlineError(ticketId, err.message);
    return false;
  }
}

async function mowSaveDraft(ticketId) {
  const btn = document.getElementById(`mow-save-btn-${ticketId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  const ok = await mowSaveDraftCore(ticketId);
  if (btn) { btn.disabled = false; btn.textContent = "Save Draft"; }
  if (ok) loadMaterialOutwardServiceQueue();
}

async function mowGenerateCheckingDraft(ticketId) {
  const btn = document.getElementById(`mow-checking-btn-${ticketId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Generating..."; }
  try {
    const ok = await mowSaveDraftCore(ticketId);
    if (!ok) return;
    const data = await apFetch({ action: "generateDeliveryChallanCheckingDraft", ticketId });
    if (!data.success) throw new Error(data.error || "Failed to generate checking draft.");
    loadMaterialOutwardServiceQueue();
  } catch (err) {
    mowShowInlineError(ticketId, err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate Checking Draft"; }
  }
}

async function mowFinaliseChallan(ticketId) {
  const btn = document.getElementById(`mow-finalise-btn-${ticketId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Finalising..."; }
  try {
    const ok = await mowSaveDraftCore(ticketId);
    if (!ok) return;
    const data = await apFetch({ action: "finaliseDeliveryChallan", ticketId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (!data.success) throw new Error(data.error || "Finalise failed.");
    // Own dedicated success view, same convention as Stock Sweep/Create
    // BOQ — hide the rest of the queue entirely until the operator
    // explicitly clicks Load Next Ticket (mowResetAfterChallanSave).
    const feed = document.getElementById("mow-service-queue-feed");
    if (feed) feed.style.display = "none";
    const pendingNote = data.pdfPending
      ? ' The PDF is still being generated in the background and will appear in the register shortly.'
      : '';
    showSuccessWithReset("mow-feedback-banner", `Delivery Challan ${escapeHtml(data.challanNumber)} generated for ${escapeHtml(ticketId)}.${pendingNote}`, "Load Next Ticket", "mowResetAfterChallanSave()");
  } catch (err) {
    mowShowInlineError(ticketId, err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Finalise Challan"; }
  }
}

async function mowDiscardDraft(ticketId) {
  if (!confirm(`Discard the in-progress Delivery Challan draft for ${ticketId}? Anything typed on this card will be lost.`)) return;
  const btn = document.getElementById(`mow-discard-btn-${ticketId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Discarding..."; }
  try {
    const data = await apFetch({ action: "discardDeliveryChallanDraft", ticketId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (!data.success) throw new Error(data.error || "Discard failed.");
    loadMaterialOutwardServiceQueue();
  } catch (err) {
    mowShowInlineError(ticketId, err.message);
    if (btn) { btn.disabled = false; btn.textContent = "Discard Draft"; }
  }
}

// Rejects (voids) a ticket sitting in this queue — for the case where the
// Material Issue Ticket itself was a mistake (wrong material/qty
// requested). Only offered while a ticket is still awaiting a challan
// (this whole queue is exactly that population); the backend
// independently re-checks status and that no challan was FINALISED
// before reversing anything — an in-progress draft is deleted server-side
// as part of the same reversal. Reverses the stock released at ticket
// approval and tells the operator to raise a fresh ticket instead of
// trying to patch this one.
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
    mowShowInlineError(ticketId, err.message);
    if (btn) { btn.disabled = false; btn.textContent = "Reject"; }
  }
}

// "+ Load Next Ticket" — dismisses the Finalise success view and reloads
// the queue (which also restores the feed's own visibility, see
// loadMaterialOutwardServiceQueue's own comment).
function mowResetAfterChallanSave() {
  const banner = document.getElementById("mow-feedback-banner");
  if (banner) banner.style.display = "none";
  loadMaterialOutwardServiceQueue();
}

// Same "Searching for ..." summary convention as the Accounts search
// screens (cash-expense-search.js's cesBuildSearchLabel and siblings) —
// shown once a search actually runs, between the filter row and results.
function mowBuildSearchLabel() {
  const esc = (s) => (s || "").toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const val = (s) => `<span style="color:var(--brand);">${esc(s || 'All')}</span>`;
  const projectId = document.getElementById("mow-search-project-ta-input").value.trim();
  const dateFrom = document.getElementById("mow-search-date-from").value;
  const dateTo = document.getElementById("mow-search-date-to").value;
  const dateRangeLabel = (dateFrom || dateTo) ? `${dateFrom ? formatOrdinalDate(dateFrom) : '…'} to ${dateTo ? formatOrdinalDate(dateTo) : '…'}` : "All";
  return `<span style="color:#000;">Searching for</span>` +
    `<br><span style="color:#000;">Project ID or Customer Name:</span> ${val(projectId)}` +
    `<br><span style="color:#000;">Date:</span> ${val(dateRangeLabel)}`;
}

async function runMaterialOutwardSearch() {
  const projectId = document.getElementById("mow-search-project-ta-input").value.trim();
  const dateFrom = document.getElementById("mow-search-date-from").value;
  const dateTo = document.getElementById("mow-search-date-to").value;
  const label = document.getElementById("mow-search-label");
  const results = document.getElementById("mow-search-results");
  label.style.display = "block";
  label.innerHTML = mowBuildSearchLabel();
  results.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center;">Searching...</div>`;
  try {
    const data = await apFetch({ action: "searchMaterialOutwardChallans", projectId: projectId || null, dateFrom: dateFrom || null, dateTo: dateTo || null });
    if (!data.success) throw new Error(data.error || "Search failed.");
    const challans = data.challans || [];
    if (challans.length === 0) {
      results.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center;">No Delivery Challans match this search.</div>`;
      return;
    }
    // Challan Materials — every material + qty on this challan, one per
    // line WITHIN the same cell (not a separate row per material), so a
    // multi-material challan still reads as one register entry.
    results.innerHTML = `
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
        <colgroup><col style="width:9%;" /><col style="width:15%;" /><col style="width:9%;" /><col style="width:30%;" /><col style="width:9%;" /><col style="width:15%;" /><col style="width:13%;" /></colgroup>
        <thead><tr style="background:var(--highlight-bg);">
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Date</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Project</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Ticket</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Challan Materials</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Returnable</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Challan No.</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Document</th>
        </tr></thead>
        <tbody>
          ${challans.map(c => {
            const materials = Array.isArray(c.line_items) ? c.line_items : [];
            const materialsHtml = materials.length
              ? materials.map(it => `${escapeHtml(it.description || it.materialName || '')} — ${escapeHtml(String(it.quantity ?? ''))} ${escapeHtml(it.unit || '')}`).join('<br>')
              : '—';
            return `
            <tr>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(formatOrdinalDate(c.challan_date) || c.challan_date || '')}</td>
              <td style="padding:8px; border:1px solid var(--border); word-wrap:break-word;">${escapeHtml(c.project_id || 'Legacy')}${c.company_name ? ' — ' + escapeHtml(c.company_name) : ''}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.ticket_id || '')}</td>
              <td style="padding:8px; border:1px solid var(--border); word-wrap:break-word;">${materialsHtml}</td>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(c.returnable_status || '—')}</td>
              <td style="padding:8px; border:1px solid var(--border); font-family:monospace; font-size:0.8rem;">${escapeHtml(c.challan_number || '')}</td>
              <td style="padding:8px; border:1px solid var(--border);">${c.document_url ? `<a href="${driveLink(c.document_url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">View ↗</a>` : '—'}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    results.innerHTML = `<div style="color:var(--danger); padding:16px; text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}
