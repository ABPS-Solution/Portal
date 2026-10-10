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
      ${pending.length ? pending.map(cprRenderPendingCard).join('') : '<div style="color:var(--muted); padding:12px;">No Production Memo purchase requests are waiting.</div>'}
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
  return `
    <div style="border:1.5px solid #94a3b8; border-radius:var(--radius); padding:14px 16px; background:#fff;">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
        <div>
          <div style="font-weight:800; color:var(--brand);">#${id} · ${escapeHtml(r.materialName || r.itemCode)}</div>
          <div style="font-size:0.85rem; color:#334155; margin-top:2px;">${escapeHtml(r.department)} · ${escapeHtml(cprTargetLabel(r))}${r.companyName ? ' · ' + escapeHtml(r.companyName) : ''}</div>
          <div style="font-size:0.8rem; color:var(--muted); margin-top:2px;">Requested by ${escapeHtml(r.requestedBy || '')} · ${escapeHtml(formatOrdinalDateTime(r.requestedAt))}</div>
          ${r.reason ? `<div style="font-size:0.85rem; margin-top:6px;"><strong>Reason:</strong> ${escapeHtml(r.reason)}</div>` : ''}
        </div>
        <div style="font-size:0.82rem; text-align:right; color:#334155;">
          Requested: <strong>${fmtQty(r.requestedQty)} ${escapeHtml(r.unit || '')}</strong><br>
          In store now: ${fmtQty(r.totalStock)} (free ${fmtQty(Math.max(0, Number(r.freeStock) || 0))})
        </div>
      </div>
      <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-top:12px;">
        <div><label class="field-label" style="margin-top:0;">Approved quantity</label>
          <input type="number" min="0" step="any" id="cpr-qty-${id}" value="${escapeHtml(String(Number(r.requestedQty)))}" style="width:140px; padding:7px;"></div>
        <div style="flex:1 1 220px;"><label class="field-label" style="margin-top:0;">Rejection reason (if rejecting)</label>
          <input type="text" id="cpr-rej-${id}" style="width:100%; padding:7px;"></div>
        <button class="nav-btn-styled" style="width:auto; padding:8px 18px; background:#15803d;" onclick="cprAction(${id}, 'Approve')">Approve</button>
        <button class="nav-btn-styled" style="width:auto; padding:8px 18px; background:#b91c1c;" onclick="cprAction(${id}, 'Reject')">Reject</button>
      </div>
      <div style="font-size:0.78rem; color:var(--muted); margin-top:8px;">${r.jobCardNumber
        ? 'Approving adds this quantity to the Job Card\'s PRN, so it appears in List of Material to Raise Purchase Order for this project.'
        : 'Approving lists it for Purchase under this project (Service request), in List of Material to Raise Purchase Order.'}</div>
    </div>`;
}

async function cprAction(requestId, decision) {
  const qty = document.getElementById(`cpr-qty-${requestId}`)?.value;
  const rejectionReason = document.getElementById(`cpr-rej-${requestId}`)?.value || '';
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
