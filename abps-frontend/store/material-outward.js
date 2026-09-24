// ═══════════════════════════════════════════════════════════════════════
// Material Outward on Delivery Challan (migration 211, 20 Sep 2026;
// multi-ticket grouping added migration 212, same day) — system-
// generated document, PDFShift via lib/deliveryChallanTemplate.js on the
// backend, replacing the old scanned-upload + AI-extraction flow.
//
// A Delivery Challan is a shipping wrapper around one or more approved
// tickets going to the same consignee — the operator checks tickets in
// the pool below, then either starts a new draft challan from the
// selection or adds the selection to an already-open draft. Two toggles:
// "Materials for Outward" (the pool + open drafts) and "Search Challans"
// (the register, filterable by project + date range).
//
// Same watermarked checking-draft paper-review loop as RM PO's Checking
// Draft and Project Dispatch Invoice, collapsed onto one screen for one
// person (no separate maker/checker here — everything is
// perm_material_outward): Save Draft (fields + which tickets are on it —
// no PDF, no number) -> Generate Checking Draft (as many times as
// needed) -> Finalise Challan (mints the real number + the clean PDF).
// ═══════════════════════════════════════════════════════════════════════

let mowServiceTicketsCache = [];
let mowDraftsCache = [];
window._mowSelectedPoolTickets = window._mowSelectedPoolTickets || new Set();

async function initializeMaterialOutwardWorkspace() {
  const feedback = document.getElementById("mow-feedback-banner");
  if (feedback) feedback.style.display = "none";
  loadMaterialOutwardServiceQueue();
}

// Search Material Outward on Delivery Challan — its own section since 24 Sep 2026.
async function initializeSearchMaterialOutwardWorkspace() {
  await ensureSharedProjectTypeaheadData();
}

async function loadMaterialOutwardServiceQueue() {
  const feed = document.getElementById("mow-service-queue-feed");
  if (!feed) return;
  // Restores visibility in case a prior Finalise hid this feed to show
  // its own dedicated success view (see mowFinaliseChallan/
  // mowResetAfterChallanSave) — every path back into this queue (toggle
  // switch, Load Next, Save/Generate/Discard reloads) goes through here,
  // so this is the one place that needs to undo that hide.
  feed.style.display = "flex";
  feed.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center;">Loading approved tickets awaiting a Delivery Challan...</div>`;
  try {
    let data;
    try {
      data = await apFetch({ action: "fetchServiceTicketsAwaitingChallan" });
      if (!data.success) throw new Error(data.error || "Failed to load.");
      abpsDraftSave(MOW_QUEUE_CACHE_KEY, { tickets: data.tickets, drafts: data.drafts });
    } catch (loadErr) {
      // Offline / server unreachable: fall back to the last queue this
      // browser saw, so typed-in challan fields can still be reviewed.
      const cached = abpsDraftRead(MOW_QUEUE_CACHE_KEY);
      if (!cached) throw loadErr;
      data = { success: true, ...cached.payload, offline: true };
    }
    mowServiceTicketsCache = data.tickets || [];
    mowDraftsCache = data.drafts || [];
    window._mowSelectedPoolTickets = new Set(
      [...window._mowSelectedPoolTickets].filter(id => mowServiceTicketsCache.some(t => t.ticket_id === id))
    );
    if (mowServiceTicketsCache.length === 0 && mowDraftsCache.length === 0) {
      feed.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center;">No approved tickets are awaiting a Delivery Challan.</div>`;
      return;
    }
    // New Challan / Editing tabs (24 Sep 2026, same idea as Create PO): a
    // draft stays under New until its first Checking Draft is printed,
    // then it moves to Editing for any changes after the paper review.
    const tab = window._mowTab || "new";
    const editing = mowDraftsCache.filter(d => Number(d.checking_draft_count) > 0);
    const fresh = mowDraftsCache.filter(d => !(Number(d.checking_draft_count) > 0));
    const tabBtn = (key, label) => `<button class="nav-btn-styled" onclick="mowSwitchTab('${key}')" style="width:auto; background:${tab === key ? "var(--brand)" : "#e2e8f0"}; color:${tab === key ? "#fff" : "#334155"};">${label}</button>`;
    const tabsHtml = `<div style="display:flex; gap:8px;">${tabBtn("new", "New Challan")}${tabBtn("editing", `Pending Challans (Editing) (${editing.length})`)}</div>`;
    feed.innerHTML = tabsHtml + (tab === "editing"
      ? (editing.length ? editing.map(renderDraftChallanCard).join("") : `<div style="padding:16px; text-align:center; color:var(--muted); border:1px dashed var(--border); border-radius:var(--radius);">No challans are waiting for edits.</div>`)
      : fresh.map(renderDraftChallanCard).join("") + renderTicketPoolSection());
    if (data.offline) feed.insertAdjacentHTML("afterbegin", `<div style="padding:10px 12px; background:#fffbeb; border-left:4px solid #f59e0b; color:#92400e; border-radius:var(--radius); font-weight:600;">You're offline — showing the last saved queue. Your typing is kept on this device; save once you're back online.</div>`);
    mowDraftsCache.forEach(d => { if (document.getElementById(`mow-draft-card-${d.challan_id}`)) { mowRestoreCardLocal(d.challan_id); mowValidateDraftCard(d.challan_id); } });
    autoGrowAllIn(feed);
  } catch (err) {
    feed.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}

// Per-draft client-side blocker count — several draft challans can be on
// the page at once, keyed by challanId.
window._mowBlockingCountByChallan = window._mowBlockingCountByChallan || {};

// mowBuildDisplayLineItems — the materials table's row source for a
// linked ticket that has no draft line_items yet (i.e. it is only in the
// pool, not yet added to any draft) — a blank-HSN display straight from
// the ticket's approved release.
function mowBuildDisplayLineItems(ticket) {
  return (ticket.items || []).map(it => ({
    ticketId: ticket.ticket_id,
    itemCode: it.itemCode,
    description: it.materialName || it.itemCode || "",
    hsnCode: "",
    quantity: it.released ?? it.__releaseQty ?? it.quantity ?? 0,
    unit: it.unitType || "",
  }));
}

function mowTicketSummaryLine(t) {
  const tid = t.ticket_id || t.ticketId || "";
  const proj = t.project_id || t.projectId || "";
  return `${escapeHtml(tid)}${proj ? " — " + escapeHtml(proj) : ""}` +
    `${(t.company_name || t.companyName) ? " — " + escapeHtml(t.company_name || t.companyName) : ""}` +
    `${(t.boq_id || t.boqId) ? " · BOQ " + escapeHtml(t.boq_id || t.boqId) : ""}` +
    `${(t.job_card_number || t.jobCardNumber) ? " · Job Card " + escapeHtml(t.job_card_number || t.jobCardNumber) : ""}`;
}

// renderTicketPoolSection — every approved ticket not yet linked to any
// challan. A checkbox per ticket; the action row above the list starts a
// new draft (or, when at least one draft is already open, offers to add
// the selection to one of them).
function renderTicketPoolSection() {
  if (mowServiceTicketsCache.length === 0) {
    return `<div style="padding:16px; text-align:center; color:var(--muted); border:1px dashed var(--border); border-radius:var(--radius);">No further approved tickets are waiting to be added to a challan.</div>`;
  }
  const rowsHtml = mowServiceTicketsCache.map(t => `
    <label style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius); margin-bottom:8px; cursor:pointer; background:${window._mowSelectedPoolTickets.has(t.ticket_id) ? '#eff6ff' : '#fff'};">
      <input type="checkbox" class="mow-pool-checkbox" data-ticket-id="${escapeHtml(t.ticket_id)}" ${window._mowSelectedPoolTickets.has(t.ticket_id) ? 'checked' : ''}
        onchange="mowTogglePoolSelection('${t.ticket_id}', this.checked)" style="margin-top:3px; width:18px; height:18px; flex:none; cursor:pointer;" />
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:0.92rem;">${mowTicketSummaryLine(t)}</div>
        <div style="color:var(--muted); font-size:0.78rem; margin-top:2px;">Purpose: ${escapeHtml(t.outward_purpose || '—')} · ${escapeHtml(t.type_of_store || "")} · Requested by ${escapeHtml(t.requested_returned_by || "")}</div>
      </div>
      <button class="nav-btn-styled" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; font-weight:700; padding:4px 10px; font-size:0.8rem; white-space:nowrap; width:auto; flex:none;" onclick="event.preventDefault(); rejectMaterialOutwardRequest('${t.ticket_id}')">Reject</button>
    </label>`).join("");

  const addToDraftButtons = mowDraftsCache.map(d =>
    `<button class="nav-btn-styled" id="mow-add-to-draft-${d.challan_id}" style="background:var(--brand);" onclick="mowAddSelectedToDraft(${d.challan_id})">+ Add Selected to Draft Challan #${d.challan_id}</button>`
  ).join(" ");

  return `
    <div style="margin-top:${mowDraftsCache.length ? '20px' : '0'};">
      <h4 style="margin:0 0 8px; font-size:1rem; font-weight:800;">Approved Tickets Awaiting a Challan</h4>
      <p style="margin:0 0 10px; font-size:0.78rem; color:var(--muted);">Select one or more tickets going to the same consignee, then start a new challan or add them to an already-open draft below. Every selected ticket must share the same Purpose.</p>
      ${rowsHtml}
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
        <button class="nav-btn-styled" id="mow-start-new-btn" style="background:var(--accent);" onclick="mowStartNewChallanFromSelection()" ${window._mowSelectedPoolTickets.size === 0 ? 'disabled' : ''}>+ Start New Challan From Selected</button>
        ${addToDraftButtons}
      </div>
    </div>`;
}

function mowTogglePoolSelection(ticketId, checked) {
  if (checked) window._mowSelectedPoolTickets.add(ticketId);
  else window._mowSelectedPoolTickets.delete(ticketId);
  const startBtn = document.getElementById("mow-start-new-btn");
  if (startBtn) startBtn.disabled = window._mowSelectedPoolTickets.size === 0;
}

async function mowStartNewChallanFromSelection() {
  const ticketIds = [...window._mowSelectedPoolTickets];
  if (ticketIds.length === 0) return;
  await mowSaveDraftAndReload(null, ticketIds);
}

async function mowAddSelectedToDraft(challanId) {
  const draft = mowDraftsCache.find(d => String(d.challan_id) === String(challanId));
  if (!draft) return;
  const existingIds = (draft.linked_tickets || []).map(t => t.ticketId);
  const ticketIds = [...new Set([...existingIds, ...window._mowSelectedPoolTickets])];
  await mowSaveDraftAndReload(challanId, ticketIds, draft);
}

// mowSaveDraftAndReload — the shared "sync this draft to exactly these
// ticketIds" call. Reuses whatever header fields already exist on the
// draft (if resuming/adding to one) so adding a ticket never blanks out
// fields already filled in; a brand-new draft starts with blank fields.
async function mowSaveDraftAndReload(challanId, ticketIds, existingDraft) {
  const btn = challanId ? document.getElementById(`mow-add-to-draft-${challanId}`) : document.getElementById("mow-start-new-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    const hsnByItemCode = {};
    for (const li of (existingDraft?.line_items || [])) hsnByItemCode[li.itemCode] = li.hsnCode;
    const payload = challanId ? {
      challanId,
      returnableStatus: existingDraft?.returnable_status || '',
      vendorName: existingDraft?.vendor_name || '',
      companyName: existingDraft?.consignee_name || '',
      contactName: existingDraft?.contact_person_name || '',
      contactNumber: existingDraft?.contact_number || '',
      address: existingDraft?.consignee_address || '',
      state: existingDraft?.consignee_state || '',
      lrNo: existingDraft?.lr_number || '',
      transportName: existingDraft?.transporter_name || '',
      freight: existingDraft?.freight || '',
      note: existingDraft?.challan_remarks || '',
    } : {};
    const data = await apFetch({ action: "saveDeliveryChallanDraft", ...payload, ticketIds, hsnByItemCode, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (!data.success) throw new Error(data.error || "Save failed.");
    window._mowSelectedPoolTickets.clear();
    await loadMaterialOutwardServiceQueue();
  } catch (err) {
    alert(err.message);
    if (btn) { btn.disabled = false; btn.textContent = challanId ? `+ Add Selected to Draft Challan #${challanId}` : "+ Start New Challan From Selected"; }
  }
}

// mowRemoveTicketFromDraft — resends the draft's current ticketIds minus
// the one being removed, through the same sync-based save route. If it
// was the last ticket, the server deletes the now-empty draft entirely.
async function mowRemoveTicketFromDraft(challanId, ticketId) {
  const draft = mowDraftsCache.find(d => String(d.challan_id) === String(challanId));
  if (!draft) return;
  if (!confirm(`Remove ${ticketId} from Draft Challan #${challanId}? It will return to the pool of tickets awaiting a challan.`)) return;
  const remaining = (draft.linked_tickets || []).map(t => t.ticketId).filter(id => id !== ticketId);
  if (remaining.length === 0) {
    // Removing the last ticket is equivalent to discarding the draft —
    // saveDeliveryChallanDraft refuses an empty ticketIds array.
    await mowDiscardDraft(challanId, /* skipConfirm */ true);
    return;
  }
  await mowSaveDraftAndReload(challanId, remaining, draft);
}

function renderDraftChallanCard(draft) {
  const challanId = draft.challan_id;
  const linkedTickets = draft.linked_tickets || [];
  const items = draft.line_items && draft.line_items.length
    ? draft.line_items
    : linkedTickets.flatMap(t => mowBuildDisplayLineItems({ ticket_id: t.ticketId, items: t.items }));
  const todayStr = (typeof formatOrdinalDate === 'function') ? formatOrdinalDate(new Date()) : new Date().toLocaleDateString();

  const returnableOptions = ['', 'Returnable', 'Non-Returnable'].map(v =>
    `<option value="${v}" ${(draft.returnable_status || '') === v ? 'selected' : ''}>${v || '— Select —'}</option>`).join("");

  const linkedTicketsHtml = linkedTickets.map(t => `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; border:1px solid var(--border); border-radius:var(--radius); margin-bottom:6px; background:#f8fafc;">
      <span style="font-size:0.85rem;">${mowTicketSummaryLine(t)}</span>
      <button class="nav-btn-styled" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; font-weight:700; padding:2px 8px; font-size:0.75rem;" onclick="mowRemoveTicketFromDraft(${challanId}, '${t.ticketId}')">Remove</button>
    </div>`).join("");

  const materialRowsHtml = items.map((it, i) => `
    <tr>
      <td style="padding:8px; border:1px solid var(--border); text-align:center;">${i + 1}</td>
      <td style="padding:8px; border:1px solid var(--border); white-space:normal; word-break:break-word;">${escapeHtml(it.description || '')}</td>
      <td style="padding:6px; border:1px solid var(--border); text-align:center;">
        <input type="text" class="mow-hsn-input" data-item-code="${escapeHtml(it.itemCode || '')}" data-challan-id="${challanId}"
               value="${escapeHtml(it.hsnCode || '')}" oninput="mowValidateDraftCard(${challanId})"
               style="width:100%; max-width:140px; text-align:center; padding:6px; border:1.5px solid ${(it.hsnCode || '').trim() ? '#94a3b8' : '#dc2626'}; background:#fff; border-radius:var(--radius);" />
      </td>
      <td style="padding:8px; border:1px solid var(--border); text-align:center; font-family:monospace; font-weight:700;">${escapeHtml(String(fmtQty(it.quantity ?? 0)))}</td>
      <td style="padding:8px; border:1px solid var(--border); text-align:center;">${escapeHtml(it.unit || "—")}</td>
    </tr>`).join("");

  return `
    <div class="section" id="mow-draft-card-${challanId}" style="padding:16px; border:1px solid var(--brand); border-radius:var(--radius); margin-bottom:16px; background:#fbfdff;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div style="font-weight:800; font-size:1rem; color:var(--brand);">Draft Challan #${challanId} <span style="font-weight:600; color:var(--muted); font-size:0.85rem;">(${linkedTickets.length} ticket${linkedTickets.length === 1 ? '' : 's'})</span></div>
      </div>

      <div style="margin-top:12px;">${linkedTicketsHtml}</div>

      <div style="margin-top:14px; border-top:1px solid var(--border); padding-top:12px;">
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px 16px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          <div><label class="field-label" style="margin-top:0;">Purpose</label><div style="padding:8px; font-weight:700;">${escapeHtml(draft.outward_type || '—')}</div></div>
          <div><label class="field-label" style="margin-top:0;">Status *</label><select id="mow-status-${challanId}" oninput="mowValidateDraftCard(${challanId})" onchange="mowValidateDraftCard(${challanId})" style="width:100%; padding:8px; border:1.5px solid #94a3b8; background:#fff; border-radius:var(--radius);">${returnableOptions}</select></div>
          <div><label class="field-label" style="margin-top:0;">Challan No</label><div style="padding:8px; font-weight:700; font-family:monospace;">${escapeHtml(draft.challan_number || '—')}</div></div>
          <div><label class="field-label" style="margin-top:0;">Challan Date</label><div style="padding:8px;">${escapeHtml(todayStr)}</div></div>
        </div>

        <div style="display:grid; grid-template-columns:2fr 1fr 1fr; gap:12px 16px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          ${draft.outward_type === 'Processing'
            ? mowVendorPickerFor(challanId, draft.vendor_name || '')
            : mowFieldFor(challanId, 'Company Name', 'company', draft.consignee_name, true)}
          ${mowFieldFor(challanId, 'Contact Name', 'contact-name', draft.contact_person_name, true)}
          ${mowFieldFor(challanId, 'Contact Number', 'contact-number', draft.contact_number, false)}
        </div>
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px 16px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          ${mowFieldFor(challanId, 'Address', 'address', draft.consignee_address, true)}
          ${mowFieldFor(challanId, 'State', 'state', draft.consignee_state, false)}
        </div>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px 16px; margin-bottom:16px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          ${mowFieldFor(challanId, 'LR No', 'lr', draft.lr_number, false)}
          ${mowFieldFor(challanId, 'Transport Name', 'transport', draft.transporter_name, false)}
          ${mowFieldFor(challanId, 'Freight', 'freight', draft.freight, false)}
        </div>
        <div style="margin-bottom:16px; border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:#f8fafc;">
          ${mowFieldFor(challanId, 'Note (optional)', 'note', draft.challan_remarks, false)}
        </div>

        <h4 style="margin:0 0 6px; font-size:0.95rem; font-weight:800; color:var(--brand);">Materials</h4>
        <p style="margin:0 0 8px; font-size:0.78rem; color:var(--muted);">Description, Qty and Unit come from the linked tickets' approved release — not editable here. HSN Code is required for every row.</p>
        <table style="width:100%; border-collapse:collapse; margin-bottom:14px; table-layout:fixed;">
          <colgroup><col style="width:7%;" /><col style="width:47%;" /><col style="width:16%;" /><col style="width:15%;" /><col style="width:15%;" /></colgroup>
          <thead><tr style="background:var(--highlight-bg);">
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Sr</th>
            <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Description of Material</th>
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">HSN Code *</th>
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Qty</th>
            <th style="padding:8px; border:1px solid var(--border); font-size:0.75rem; text-transform:uppercase; color:var(--muted);">Unit</th>
          </tr></thead>
          <tbody>${materialRowsHtml || '<tr><td colspan="5" style="padding:8px; text-align:center; color:var(--muted);">No items on this challan.</td></tr>'}</tbody>
        </table>

        <div id="mow-crosscheck-band-${challanId}"></div>

        <div style="display:flex; justify-content:flex-end; align-items:center; gap:10px; flex-wrap:wrap;">
          ${draft.checking_doc_url ? `<a href="${driveLink(draft.checking_doc_url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; margin-right:auto;">View Checking Draft #${escapeHtml(String(draft.checking_draft_count || ''))} ↗</a>` : '<span></span>'}
          <button class="nav-btn-styled" style="background:#718096;" onclick="mowDiscardDraft(${challanId})">Discard Entire Draft</button>
          <button class="nav-btn-styled" id="mow-checking-btn-${challanId}" style="background:var(--brand);" onclick="mowGenerateCheckingDraft(${challanId})">Save &amp; Generate Checking Draft</button>
        </div>
        <div id="mow-inline-feedback-${challanId}" style="display:none; margin-top:12px; padding:10px; border-left:4px solid; border-radius:var(--radius);"></div>
      </div>
    </div>`;
}

// mowFieldFor — auto-growing-textarea field, same convention as Project
// Invoice's own field() helper — a plain single-line <input> clips a
// long value.
function mowFieldFor(challanId, label, key, value, required) {
  const id = `mow-${key}-${challanId}`;
  return `<div><label class="field-label" style="margin-top:0;">${label}${required ? ' *' : ''}</label><textarea rows="1" id="${id}" oninput="autoGrowTextField(this); mowValidateDraftCard(${challanId});" onfocus="autoGrowTextField(this);" style="width:100%; padding:8px; border:1.5px solid #94a3b8; background:#fff; border-radius:var(--radius); resize:none; overflow:hidden; font-family:inherit; font-size:inherit;">${escapeHtml(value || '')}</textarea></div>`;
}

// mowValidateDraftCard — client-side validation only ("a convenience,
// never the guard" — every rule here is re-enforced server-side in
// saveDeliveryChallanDraft/generateDeliveryChallanCheckingDraft/
// finaliseDeliveryChallan). Live-toggles Generate/Finalise disabled state
// and red-borders any empty HSN cell.
function mowValidateDraftCard(challanId) {
  const card = document.getElementById(`mow-draft-card-${challanId}`);
  if (!card) return;
  const errors = [];
  const status = document.getElementById(`mow-status-${challanId}`)?.value || '';
  if (!status) errors.push('Select a Status (Returnable / Non-Returnable).');
  const isProcessingCard = !!document.getElementById(`mow-vendor-${challanId}`);
  const consignee = document.getElementById(isProcessingCard ? `mow-vendor-${challanId}` : `mow-company-${challanId}`)?.value.trim() || '';
  if (!consignee) errors.push(isProcessingCard ? 'Vendor Name is required.' : 'Company Name is required.');
  const contactName = document.getElementById(`mow-contact-name-${challanId}`)?.value.trim() || '';
  if (!contactName) errors.push('Contact Name is required.');
  const address = document.getElementById(`mow-address-${challanId}`)?.value.trim() || '';
  if (!address) errors.push('Address is required.');
  const hsnInputs = card.querySelectorAll('.mow-hsn-input');
  let missingHsn = 0;
  hsnInputs.forEach(inp => {
    const filled = !!inp.value.trim();
    inp.style.borderColor = filled ? '#94a3b8' : '#dc2626';
    if (!filled) missingHsn++;
  });
  if (missingHsn > 0) errors.push(`HSN Code is required for ${missingHsn} material row${missingHsn > 1 ? 's' : ''}.`);

  window._mowBlockingCountByChallan[challanId] = errors.length;
  const bandEl = document.getElementById(`mow-crosscheck-band-${challanId}`);
  if (bandEl) {
    bandEl.innerHTML = errors.length
      ? `<div style="margin-bottom:10px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-size:0.82rem;">
          <strong>Cannot generate a checking draft until these are resolved:</strong>
          <ul style="margin:6px 0 0; padding-left:18px;">${errors.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul></div>`
      : '';
  }
  ['mow-checking-btn-', 'mow-finalise-btn-'].forEach(prefix => {
    const btn = document.getElementById(`${prefix}${challanId}`);
    if (btn) {
      btn.disabled = errors.length > 0;
      btn.style.opacity = errors.length > 0 ? "0.5" : "1";
      btn.style.cursor = errors.length > 0 ? "not-allowed" : "pointer";
    }
  });
}

function mowShowInlineError(challanId, msg) {
  const feedback = document.getElementById(`mow-inline-feedback-${challanId}`);
  if (!feedback) { alert(msg); return; }
  feedback.style.cssText = "display:block; margin-top:12px; padding:10px; border-left:4px solid var(--danger); background:#fef2f2; color:#b91c1c; border-radius:var(--radius);";
  feedback.textContent = msg;
}

// mowCollectCardPayload — the fields this screen actually lets the
// operator set, plus an hsnByItemCode map built from data-item-code
// rather than DOM order, so a reordered/re-rendered table can never
// mis-assign an HSN code to the wrong material line. ticketIds is read
// from the cached draft (not the DOM — there's no per-ticket input on
// this card besides the Remove buttons, which act immediately via
// mowRemoveTicketFromDraft rather than waiting for a Save).
function mowCollectCardPayload(challanId) {
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const hsnByItemCode = {};
  document.querySelectorAll(`.mow-hsn-input[data-challan-id="${challanId}"]`).forEach(inp => {
    hsnByItemCode[inp.dataset.itemCode] = inp.value.trim();
  });
  const draft = mowDraftsCache.find(d => String(d.challan_id) === String(challanId));
  const ticketIds = (draft?.linked_tickets || []).map(t => t.ticketId);
  return {
    challanId, ticketIds,
    returnableStatus: document.getElementById(`mow-status-${challanId}`)?.value || '',
    vendorName: val(`mow-vendor-${challanId}`),
    companyName: val(`mow-company-${challanId}`),
    contactName: val(`mow-contact-name-${challanId}`),
    contactNumber: val(`mow-contact-number-${challanId}`),
    address: val(`mow-address-${challanId}`),
    state: val(`mow-state-${challanId}`),
    lrNo: val(`mow-lr-${challanId}`),
    transportName: val(`mow-transport-${challanId}`),
    freight: val(`mow-freight-${challanId}`),
    note: val(`mow-note-${challanId}`),
    hsnByItemCode,
    operatorName: appActiveOperatorIdentityString || "Unknown",
  };
}

// mowSaveDraftCore — the shared save step Generate Checking Draft and
// Finalise both run first (so neither can act on stale field values
// without the operator needing a separate explicit Save click). Returns
// true/false; on failure it has already shown the inline error.
async function mowSaveDraftCore(challanId) {
  try {
    const data = await apFetch({ action: "saveDeliveryChallanDraft", ...mowCollectCardPayload(challanId) });
    if (!data.success) throw new Error(data.error || "Save failed.");
    abpsDraftClear(mowCardKey(challanId));
    return true;
  } catch (err) {
    mowShowInlineError(challanId, err.message);
    return false;
  }
}

async function mowSaveDraft(challanId) {
  const btn = document.getElementById(`mow-save-btn-${challanId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  const ok = await mowSaveDraftCore(challanId);
  if (btn) { btn.disabled = false; btn.textContent = "Save Draft"; }
  if (ok) loadMaterialOutwardServiceQueue();
}

async function mowGenerateCheckingDraft(challanId) {
  const btn = document.getElementById(`mow-checking-btn-${challanId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Generating..."; }
  showBlockingOverlay("Saving challan and generating checking draft...");
  try {
    const ok = await mowSaveDraftCore(challanId);
    if (!ok) return;
    const data = await apFetch({ action: "generateDeliveryChallanCheckingDraft", challanId });
    if (!data.success) throw new Error(data.error || "Failed to generate checking draft.");
    // Done view: only the success message until the next action is chosen.
    const wasEditing = (window._mowTab || "new") === "editing";
    const feed = document.getElementById("mow-service-queue-feed");
    if (feed) feed.style.display = "none";
    const draft = mowDraftsCache.find(d => String(d.challan_id) === String(challanId));
    showSuccessWithReset("mow-feedback-banner",
      `Delivery Challan ${escapeHtml(draft?.challan_number || "#" + challanId)} saved. Checking Draft #${escapeHtml(String(data.draftNumber))} generated — print it for review. It now waits in Authorize Material Outward on Delivery Challan.`,
      wasEditing ? "Edit Another Challan" : "Create New Challan",
      wasEditing ? "mowSwitchTab('editing')" : "mowSwitchTab('new')",
      data.url ? [{ url: driveLink(data.url), label: "📄 Open Checking Draft #" + data.draftNumber }] : []);
  } catch (err) {
    mowShowInlineError(challanId, err.message);
  } finally {
    hideBlockingOverlay();
    if (btn) { btn.disabled = false; btn.textContent = "Save & Generate Checking Draft"; }
  }
}

async function mowFinaliseChallan(challanId) {
  const btn = document.getElementById(`mow-finalise-btn-${challanId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Finalising..."; }
  try {
    const ok = await mowSaveDraftCore(challanId);
    if (!ok) return;
    const data = await apFetch({ action: "finaliseDeliveryChallan", challanId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (!data.success) throw new Error(data.error || "Finalise failed.");
    // Own dedicated success view, same convention as Stock Sweep/Create
    // BOQ — hide the rest of the queue entirely until the operator
    // explicitly clicks Load Next (mowResetAfterChallanSave).
    const feed = document.getElementById("mow-service-queue-feed");
    if (feed) feed.style.display = "none";
    const pendingNote = data.pdfPending
      ? ' The PDF is still being generated in the background and will appear in the register shortly.'
      : '';
    showSuccessWithReset("mow-feedback-banner", `Delivery Challan ${escapeHtml(data.challanNumber)} generated.${pendingNote}`, "Load Next", "mowResetAfterChallanSave()");
  } catch (err) {
    mowShowInlineError(challanId, err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Finalise Challan"; }
  }
}

async function mowDiscardDraft(challanId, skipConfirm) {
  try {
    showBlockingOverlay("Discarding draft...");
    const data = await apFetch({ action: "discardDeliveryChallanDraft", challanId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    hideBlockingOverlay();
    if (!data.success) throw new Error(data.error || "Discard failed.");
    abpsDraftClear(mowCardKey(challanId));
    loadMaterialOutwardServiceQueue();
  } catch (err) {
    hideBlockingOverlay();
    mowShowInlineError(challanId, err.message);
  }
}

// Rejects (voids) a single ticket sitting in the pool — for the case
// where the Material Issue Ticket itself was a mistake (wrong material/
// qty requested). The backend independently re-checks status and that no
// challan was FINALISED for it before reversing anything; if the ticket
// was linked to an in-progress Draft, it is unlinked server-side as part
// of the same reversal (and the draft deleted too if it was the last
// ticket on it). Reverses the stock released at ticket approval and
// tells the operator to raise a fresh ticket instead of trying to patch
// this one.
async function rejectMaterialOutwardRequest(ticketId) {
  try {
    showBlockingOverlay("Rejecting ticket...");
    const data = await apFetch({ action: "rejectMaterialOutwardRequest", ticketId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    hideBlockingOverlay();
    if (!data.success) throw new Error(data.error || "Failed to reject.");
    const feed = document.getElementById("mow-service-queue-feed");
    if (feed) feed.style.display = "none";
    showSuccessWithReset("mow-feedback-banner", `${escapeHtml(ticketId)} rejected — its stock has been returned to the store. Raise a new Material Issue Ticket to correct it.`, "Refresh Queue", "mowResetAfterChallanSave()");
    const refreshBtn = document.querySelector("#mow-feedback-banner button");
    if (refreshBtn) refreshBtn.textContent = "Refresh Queue";
  } catch (err) {
    hideBlockingOverlay();
    alert(err.message);
  }
}

// "+ Load Next" — dismisses the Finalise success view and reloads the
// queue (which also restores the feed's own visibility, see
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
    // multi-material, multi-ticket challan still reads as one register
    // entry.
    results.innerHTML = `
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
        <colgroup><col style="width:9%;" /><col style="width:14%;" /><col style="width:11%;" /><col style="width:27%;" /><col style="width:9%;" /><col style="width:15%;" /><col style="width:13%;" /></colgroup>
        <thead><tr style="background:var(--highlight-bg);">
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Date</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Project / Company</th>
          <th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">Tickets</th>
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
            const ticketsHtml = (c.ticket_ids || []).map(escapeHtml).join('<br>') || '—';
            return `
            <tr>
              <td style="padding:8px; border:1px solid var(--border);">${escapeHtml(formatOrdinalDate(c.challan_date) || c.challan_date || '')}</td>
              <td style="padding:8px; border:1px solid var(--border); word-wrap:break-word;">${escapeHtml(c.project_id || 'Legacy')}${c.company_name ? ' — ' + escapeHtml(c.company_name) : ''}</td>
              <td style="padding:8px; border:1px solid var(--border); font-size:0.78rem;">${ticketsHtml}</td>
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


// ── Unsaved typing kept on this device (24 Sep 2026) ───────────────────
// Same treatment as Create BOQ: everything typed on a draft challan card
// (header fields, Status, HSN codes) is kept in this browser as you type,
// so leaving for the dashboard, a refresh or a dropped connection doesn't
// lose it. Cleared once Save & Generate Checking Draft saves the card, or
// the draft is discarded.
const MOW_QUEUE_CACHE_KEY = "mowQueueCache";
function mowCardKey(challanId) { return "mowCard:" + challanId; }

function mowSaveCardLocal(challanId) {
  const card = document.getElementById(`mow-draft-card-${challanId}`);
  if (!card) return;
  const vals = {};
  card.querySelectorAll('textarea[id^="mow-"], select[id^="mow-"], input[id^="mow-vendor-"]').forEach(el => { vals[el.id] = el.value; });
  card.querySelectorAll(".mow-hsn-input").forEach(el => { vals["hsn|" + el.dataset.itemCode] = el.value; });
  abpsDraftSave(mowCardKey(challanId), vals);
}

function mowRestoreCardLocal(challanId) {
  const d = abpsDraftRead(mowCardKey(challanId));
  const card = document.getElementById(`mow-draft-card-${challanId}`);
  if (!d || !card) return;
  Object.entries(d.payload || {}).forEach(([k, v]) => {
    const el = k.startsWith("hsn|")
      ? card.querySelector(`.mow-hsn-input[data-item-code="${CSS.escape(k.slice(4))}"]`)
      : card.querySelector("#" + CSS.escape(k));
    if (el) el.value = v;
  });
}

(function () {
  let timer = null;
  const handler = (e) => {
    const card = e.target.closest && e.target.closest('[id^="mow-draft-card-"]');
    if (!card) return;
    const challanId = card.id.replace("mow-draft-card-", "");
    clearTimeout(timer);
    timer = setTimeout(() => mowSaveCardLocal(challanId), 400);
  };
  document.addEventListener("input", handler, true);
  document.addEventListener("change", handler, true);
})();


// Vendor Name for a Processing challan — must be a vendor from Purchase's
// vendor list (the challan row links to it), so it's picked from search
// suggestions rather than typed freely (24 Sep 2026).
function mowVendorPickerFor(challanId, value) {
  return `<div style="position:relative;"><label class="field-label" style="margin-top:0;">Vendor Name *</label>
    <input type="text" id="mow-vendor-${challanId}" value="${escapeHtml(value || "")}" autocomplete="off" placeholder="Search vendor..."
      oninput="mowVendorSearch(${challanId}, this.value); mowValidateDraftCard(${challanId});" onfocus="mowVendorSearch(${challanId}, this.value)"
      style="width:100%; padding:8px; border:1.5px solid #94a3b8; background:#fff; border-radius:var(--radius); font-family:inherit; font-size:inherit;" />
    <div id="mow-vendor-dd-${challanId}" style="display:none; position:fixed; z-index:9999; background:#fff; border:1.5px solid var(--brand); border-radius:4px; max-height:240px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div></div>`;
}

let mowVendorSearchSeq = 0;
async function mowVendorSearch(challanId, query) {
  const input = document.getElementById(`mow-vendor-${challanId}`);
  const dd = document.getElementById(`mow-vendor-dd-${challanId}`);
  if (!input || !dd) return;
  const seq = ++mowVendorSearchSeq;
  try {
    const data = await apFetch({ action: "searchVendorNamesForMaterialOutward", query: query || "" });
    if (seq !== mowVendorSearchSeq) return;
    const vendors = (data.success ? data.vendors : []) || [];
    window._mowVendorDetails = window._mowVendorDetails || {};
    (data.vendorDetails || []).forEach(v => { window._mowVendorDetails[v.name] = v; });
    const r = input.getBoundingClientRect();
    dd.style.left = r.left + "px"; dd.style.top = r.bottom + "px"; dd.style.width = Math.max(r.width, 260) + "px";
    dd.innerHTML = vendors.length
      ? vendors.map(v => `<div onmousedown="event.preventDefault(); mowPickVendor(${challanId}, this.dataset.v)" data-v="${escapeHtml(v)}"
          style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.85rem;"
          onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">${escapeHtml(v)}</div>`).join("")
      : `<div style="padding:8px 12px; font-size:0.8rem; color:#b91c1c;">No vendor found. Add it as a vendor in Purchase first.</div>`;
    dd.style.display = "block";
  } catch (e) { dd.style.display = "none"; }
}

function mowPickVendor(challanId, name) {
  const input = document.getElementById(`mow-vendor-${challanId}`);
  const dd = document.getElementById(`mow-vendor-dd-${challanId}`);
  if (input) input.value = name;
  const vd = (window._mowVendorDetails || {})[name];
  if (vd) {
    const addr = document.getElementById(`mow-address-${challanId}`);
    const st = document.getElementById(`mow-state-${challanId}`);
    if (addr && vd.address) { addr.value = vd.address; autoGrowTextField(addr); }
    if (st && vd.state) { st.value = vd.state; autoGrowTextField(st); }
  }
  mowValidateDraftCard(challanId);
  mowSaveCardLocal(challanId);
  if (dd) dd.style.display = "none";
}

document.addEventListener("click", (e) => {
  if (e.target.closest && (e.target.closest('[id^="mow-vendor-dd-"]') || e.target.closest('input[id^="mow-vendor-"]'))) return;
  document.querySelectorAll('[id^="mow-vendor-dd-"]').forEach(d => { d.style.display = "none"; });
});


function mowSwitchTab(tab) {
  window._mowTab = tab;
  const banner = document.getElementById("mow-feedback-banner");
  if (banner) banner.style.display = "none";
  loadMaterialOutwardServiceQueue();
}
