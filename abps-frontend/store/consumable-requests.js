// ═══════════════════════════════════════════════════════════════════════
// store/consumable-requests.js — Approve Production Memo Purchase Requests
// (perm_approve_consumable_purchase, migration 238), plus the Service
// consumable requests section on List of Material to Raise Purchase Order.
// Backend: routes/consumables.js.
// ═══════════════════════════════════════════════════════════════════════

function cprTargetLabel(r) {
  if (r.jobCardNumber) {
    const set = (String(r.jobCardNumber).match(/JC_Set-\d+/) || [])[0];
    return `${r.projectId || ''}${set ? ' · ' + set : ''}`;
  }
  return r.projectId || r.legacyCompanyName || '';
}

async function initializeConsumablePurchaseApprovalsWorkspace() {
  const feed = document.getElementById('cpr-queue-feed');
  const fb = document.getElementById('cpr-feedback');
  if (fb) fb.style.display = 'none';
  if (!feed) return;
  feed.innerHTML = '<div style="color:var(--muted); padding:12px;">Loading requests...</div>';
  try {
    const data = await apFetch({ action: 'fetchConsumablePurchaseRequests' });
    if (!data.success) throw new Error(data.error || 'Could not load requests.');
    const pending = data.pending || [];
    const recent = data.recent || [];
    feed.innerHTML = `
      ${pending.length ? `<div style="display:flex; flex-direction:column; gap:14px;">${pending.map(cprRenderPendingCard).join('')}</div>` : '<div style="color:var(--muted); padding:12px;">No Production Memo purchase requests are waiting.</div>'}
      ${recent.length ? `
        <div style="margin-top:18px; font-weight:800; color:var(--brand);">Recently actioned</div>
        <div style="overflow-x:auto;"><table class="grid-lines-table" style="width:100%; border-collapse:collapse; font-size:0.85rem; min-width:760px;">
          <thead><tr style="background:#f8fafc;">
            <th style="padding:6px; text-align:left;">Request</th><th style="padding:6px; text-align:left;">Material</th>
            <th style="padding:6px; text-align:left;">For</th><th style="padding:6px; text-align:center;">Requested</th>
            <th style="padding:6px; text-align:center;">Approved</th><th style="padding:6px; text-align:center;">Status</th>
            <th style="padding:6px; text-align:left;">By</th></tr></thead>
          <tbody>${recent.map(r => `<tr>
            <td style="padding:6px;">#${r.requestId}</td>
            <td style="padding:6px;">${escapeHtml(r.materialName || r.itemCode)}</td>
            <td style="padding:6px;">${escapeHtml(r.department)} · ${escapeHtml(cprTargetLabel(r))}</td>
            <td style="padding:6px; text-align:center;">${fmtQty(r.requestedQty)} ${escapeHtml(r.unit || '')}</td>
            <td style="padding:6px; text-align:center;">${r.approvedQty != null ? fmtQty(r.approvedQty) : '—'}</td>
            <td style="padding:6px; text-align:center; font-weight:700; color:${r.status === 'Rejected' ? '#b91c1c' : '#15803d'};">${escapeHtml(r.status)}${r.orderedPoNo ? ' · ' + escapeHtml(r.orderedPoNo) : ''}</td>
            <td style="padding:6px;">${escapeHtml(r.actionedBy || '')}${r.actionedAt ? '<br><span style="color:var(--muted); font-size:0.78rem;">' + escapeHtml(formatOrdinalDateTime(r.actionedAt)) + '</span>' : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : ''}`;
  } catch (e) {
    if (e.message === 'SESSION_EXPIRED') return;
    feed.innerHTML = `<div style="color:#b91c1c; padding:12px;">${escapeHtml(e.message)}</div>`;
  }
}

function cprRenderPendingCard(r) {
  const id = r.requestId;
  const th = (t, al) => `<th style="border:1px solid var(--border); padding:8px; text-align:${al || "center"}; vertical-align:middle;">${t}</th>`;
  const td = (h, al) => `<td style="border:1px solid var(--border); padding:8px; text-align:${al || "center"}; vertical-align:middle; font-weight:600;">${h}</td>`;
  const req = Number(r.requestedQty) || 0;
  return `
    <div class="contact-summary-card-parent" style="border-left:4px solid #7c3aed;">
      <div class="contact-summary-header-row" onclick="document.getElementById('cpr-card-body-${id}').style.display = document.getElementById('cpr-card-body-${id}').style.display === 'none' ? 'block' : 'none'" style="margin-bottom:0; padding-bottom:8px; cursor:pointer;">
        <div class="contact-summary-title-info" style="width:100%;">
          <div class="meta-row-line-block">
            <strong style="color:var(--brand); font-size:0.9rem;">${escapeHtml(r.jobCardNumber || r.projectId || r.legacyCompanyName || "")}</strong>
          </div>
          <div class="meta-row-line-block" style="margin-top:8px; font-size:0.85rem;">
            <span>Project ID:</span> <strong style="color:#111827; font-family:monospace;">${escapeHtml(r.projectId || "—")}</strong>
            ${r.companyName ? `<span style="margin-left:8px;">|</span> <strong style="color:#111827; margin-left:8px;">${escapeHtml(r.companyName)}</strong>` : ""}
            <span style="margin-left:8px;">|</span>
            <span style="margin-left:8px;">By:</span> <strong style="color:#111827;">${escapeHtml(r.requestedBy || "")}</strong>
            <span style="margin-left:8px;">|</span>
            <strong style="color:#111827; margin-left:8px;">${escapeHtml(formatOrdinalDateTime(r.requestedAt))}</strong>
            <span style="margin-left:12px;">Dept:</span> <strong style="color:#111827;">${escapeHtml(r.department || "—")}</strong>
          </div>
        </div>
      </div>
      <div id="cpr-card-body-${id}" style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:8px;">
        <div style="overflow-x:auto; margin-bottom:14px;">
          <table class="cpr-grid" style="width:100%; border-collapse:collapse; font-size:0.85rem; table-layout:fixed; min-width:640px;">
            <colgroup><col style="width:46%"><col style="width:9%"><col style="width:15%"><col style="width:15%"><col style="width:15%"></colgroup>
            <thead><tr style="background:var(--highlight-bg);">
              ${th("Material Name", "left")}${th("Unit")}${th("Already Used in this JC")}${th("Purchase Qty Requested")}${th("Approve Purchase Qty")}
            </tr></thead>
            <tbody><tr>
              ${td(escapeHtml(r.materialName || r.itemCode), "left")}
              ${td(escapeHtml(r.unit || ""))}
              ${td(r.jobCardNumber ? fmtQty(r.usedInJobCard) : "—")}
              ${td(`<span style="color:#5b21b6; font-weight:700;">${fmtQty(req)}</span>`)}
              <td style="border:1px solid var(--border); padding:8px; text-align:center; vertical-align:middle;">
                <input type="number" min="0" max="${req}" step="any" id="cpr-qty-${id}" value="${req}"
                  oninput="if (parseFloat(this.value) > ${req}) this.value = ${req}; if (parseFloat(this.value) < 0) this.value = 0;"
                  style="width:100px; padding:5px 6px; text-align:center; font-family:monospace; font-weight:700; border:2px solid #64748b; border-radius:4px;">
              </td>
            </tr></tbody>
          </table>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button class="nav-btn-styled" style="width:auto; padding:8px 20px; background:#b91c1c; font-weight:700;" onclick="cprAction(${id}, 'Reject')">Reject</button>
          <button class="nav-btn-styled" style="width:auto; padding:8px 20px; background:var(--accent); font-weight:700;" onclick="cprAction(${id}, 'Approve')">Approve</button>
        </div>
      </div>
    </div>`;
}

async function cprAction(requestId, decision) {
  const qty = document.getElementById(`cpr-qty-${requestId}`)?.value;
  const rejectionReason = '';
  const ok = await abpsConfirm(decision === 'Approve'
    ? `Approve request #${requestId} for ${qty}?` : `Reject request #${requestId}?`,
    { okLabel: decision });
  if (!ok) return;
  showBlockingOverlay(decision === 'Approve' ? 'Approving...' : 'Rejecting...');
  try {
    const data = await apFetch({ action: 'actionConsumablePurchaseRequest', requestId, decision, approvedQty: qty, rejectionReason });
    const fb = document.getElementById('cpr-feedback');
    if (!data.success) {
      showBOQBanner('cpr-feedback', escapeHtml(data.error || 'Could not save.'), 'error');
      return;
    }
    showBOQBanner('cpr-feedback', decision === 'Approve'
      ? `Request #${requestId} approved${data.prnId ? ` and added to ${escapeHtml(data.prnId)}` : ''}.` : `Request #${requestId} rejected.`, 'success');
    if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'center' });
    initializeConsumablePurchaseApprovalsWorkspace();
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') showBOQBanner('cpr-feedback', escapeHtml(e.message), 'error');
  } finally {
    hideBlockingOverlay();
  }
}

// ── List of Material to Raise Purchase Order: Service consumable requests ──
async function renderServiceConsumableRequestsToOrder(mountId) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  try {
    const data = await apFetch({ action: 'fetchServiceConsumableRequestsToOrder' });
    const reqs = (data && data.success && data.requests) || [];
    if (!reqs.length) { mount.innerHTML = ''; return; }
    mount.innerHTML = `
      <div style="margin:18px 0 8px; font-weight:800; color:#7c3aed;">Service Production Memo requests (approved, to order)</div>
      <div style="font-size:0.8rem; color:var(--muted); margin-bottom:6px;">These have no BOQ, so raise an RM PO for the item as usual, then enter its PO number here to close the request. The stock arrives as free stock.</div>
      <div style="overflow-x:auto;"><table class="grid-lines-table" style="width:100%; border-collapse:collapse; font-size:0.85rem; min-width:760px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:6px; text-align:left;">Project / Company</th><th style="padding:6px; text-align:left;">Material</th>
          <th style="padding:6px; text-align:center;">Quantity</th><th style="padding:6px; text-align:left;">Approved</th>
          <th style="padding:6px; text-align:left;">RM PO No.</th></tr></thead>
        <tbody>${reqs.map(r => `<tr>
          <td style="padding:6px;">${escapeHtml(r.projectId || r.legacyCompanyName || '')}${r.companyName ? '<br><span style="color:var(--muted); font-size:0.78rem;">' + escapeHtml(r.companyName) + '</span>' : ''}</td>
          <td style="padding:6px;">${escapeHtml(r.materialName || r.itemCode)} <span style="color:var(--muted); font-family:monospace;">${escapeHtml(r.itemCode)}</span></td>
          <td style="padding:6px; text-align:center; font-weight:700;">${fmtQty(r.approvedQty)} ${escapeHtml(r.unit || '')}</td>
          <td style="padding:6px;">${escapeHtml(formatOrdinalDate(r.actionedAt))}</td>
          <td style="padding:6px;"><div style="display:flex; gap:6px;">
            <input type="text" id="cpr-po-${r.requestId}" placeholder="PO_26-27_00001" style="width:150px; padding:5px;">
            <button class="nav-btn-styled" style="width:auto; padding:5px 10px; font-size:0.8rem;" onclick="cprMarkOrdered(${r.requestId}, '${mountId}')">Mark Ordered</button>
          </div></td>
        </tr>`).join('')}</tbody></table></div>`;
  } catch (e) { mount.innerHTML = ''; }
}

async function cprMarkOrdered(requestId, mountId) {
  const poNo = (document.getElementById(`cpr-po-${requestId}`)?.value || '').trim();
  if (!poNo) { alert('Enter the RM PO number.'); return; }
  try {
    const data = await apFetch({ action: 'markServiceConsumableOrdered', requestId, poNo });
    if (!data.success) { alert(data.error || 'Could not save.'); return; }
    renderServiceConsumableRequestsToOrder(mountId);
  } catch (e) { if (e.message !== 'SESSION_EXPIRED') alert(e.message); }
}
