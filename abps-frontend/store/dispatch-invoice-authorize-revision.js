// ═══════════════════════════════════════════════════════════════════════
// store/dispatch-invoice-authorize-revision.js — Authorize Project
// Dispatch Invoice Revision (migration 209, 19 Sep 2026). Approve-only,
// no inline editing, no reject — same rule as Authorize Project Dispatch
// Invoice. Renders a change summary (line-item + general field diff)
// copying the shape of purchase/revise-po.js's renderAPORCard, the only
// existing precedent for this pattern in the codebase (RM PO Revision /
// BOQ Revision / PRN Revision all hand-roll their own version of it).
// ═══════════════════════════════════════════════════════════════════════

const ARPDI_FMT = (n) => (Math.round((parseFloat(n) || 0) * 100) / 100).toLocaleString('en-IN');

let arpdiExpandedRequestId = null;

async function initializeArpdiWorkspace() {
  document.getElementById("arpdi-feedback").style.display = "none";
  arpdiExpandedRequestId = null;
  const feed = document.getElementById("arpdi-cards-feed");
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchPendingProjectDispatchInvoiceRevisions" });
    if (!data.success) { feed.innerHTML = `<div style="color:#b91c1c; padding:14px;">${data.error || 'Failed to load.'}</div>`; return; }
    if (!(data.requests || []).length) { feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">No revision requests awaiting authorization.</div>`; return; }
    feed.innerHTML = data.requests.map(r => `
      <div style="border:2px solid #94a3b8; border-radius:8px; margin-bottom:14px; background:#fff; box-shadow:0 2px 6px rgba(15,23,42,0.08);">
        ${renderPdiQueueCardHeader(`toggleArpdiCard(${r.requestId})`, [
          ["Invoice No.", escapeHtml(r.invoiceNo || '')],
          ["Revision", `V${Number(r.currentRevision) || 1} → V${(Number(r.currentRevision) || 1) + 1}`],
          ["Invoice Type", escapeHtml(r.invoiceType || '')],
          ["Customer", escapeHtml(r.companyName || '')],
          ["Project ID", escapeHtml(r.projectId || '')],
          ["Requested By", escapeHtml(r.requestedBy || '')],
          ["Requested On", r.requestedAt ? escapeHtml(formatOrdinalDateTime(r.requestedAt)) : ''],
        ], r.checkingDocUrl ? `<a href="${driveLink(r.checkingDocUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" class="pdi-link-btn">Draft #${r.checkingDraftCount} ↗</a>` : `<span style="color:#b45309; font-size:0.8rem; font-weight:600;">No draft yet</span>`)}
        <div id="arpdi-card-${r.requestId}" style="display:none; padding:12px 14px;"></div>
      </div>`).join('');
    // Stash the full payload per request so toggleArpdiCard doesn't need a
    // second fetch — the queue route already returns { current, proposed }.
    window._arpdiRequestsById = {};
    data.requests.forEach(r => { window._arpdiRequestsById[r.requestId] = r; });
  } catch(e) {
    feed.innerHTML = `<div style="color:#b91c1c; padding:14px;">Network error: ${e.message}</div>`;
  }
}

function toggleArpdiCard(requestId) {
  const card = document.getElementById(`arpdi-card-${requestId}`);
  if (!card) return;
  if (arpdiExpandedRequestId === requestId) { card.style.display = "none"; arpdiExpandedRequestId = null; return; }
  arpdiExpandedRequestId = requestId;
  card.style.display = "block";
  const r = window._arpdiRequestsById[requestId];
  card.innerHTML = renderArpdiCard(r);
  loadArpdiDocuments(r);
}

async function loadArpdiDocuments(r) {
  const zone = r && document.getElementById(`arpdi-docs-${r.requestId}`);
  if (!zone) return;
  try {
    const data = await apFetch({ action: "fetchProjectInvoiceDocuments", invoiceId: r.invoiceId });
    zone.innerHTML = data.success ? renderPdiDocumentsTableHtml(data.documents || [], null)
      : `<div style="color:#b91c1c;">${escapeHtml(data.error || 'Failed to load documents.')}</div>`;
  } catch (e) {
    zone.innerHTML = `<div style="color:#b91c1c;">Network error: ${escapeHtml(e.message)}</div>`;
  }
}

// The declarative field-diff shape, ported from purchase/revise-po.js's
// renderAPORCard: generalFieldDefs + changedField()/bulletHtml() generics.
const ARPDI_GENERAL_FIELD_DEFS = (cur, prop) => [
  { label: "Invoice Date", cur: cur.invoiceDate, rev: prop.invoiceDate, isDate: true },
  { label: "Trade Type", cur: cur.tradeType || 'Local', rev: prop.tradeType, isText: true },
  { label: "Incoterms", cur: [cur.incoterms, cur.incotermsPlace].filter(Boolean).join(' '), rev: [prop.incoterms, prop.incotermsPlace].filter(Boolean).join(' '), isText: true },
  { label: "CGST %", cur: cur.cgstPercent, rev: prop.cgstPercent },
  { label: "SGST %", cur: cur.sgstPercent, rev: prop.sgstPercent },
  { label: "IGST %", cur: cur.igstPercent, rev: prop.igstPercent },
  { label: "Freight (incl. GST)", cur: cur.freightAmount, rev: prop.freightAmount },
  { label: "Others (incl. GST)", cur: cur.othersAmount, rev: prop.othersAmount },
  { label: "Round Off", cur: cur.roundOff, rev: prop.roundOff },
  { label: "LC No & Date", cur: cur.lcNoDate, rev: prop.lcNoDate, isText: true },
  { label: "DC No & Date", cur: cur.dcNoDate, rev: prop.dcNoDate, isText: true },
  { label: "Transport Name", cur: cur.transportName, rev: prop.transportName, isText: true },
  { label: "Vehicle No.", cur: cur.vehicleNo, rev: prop.vehicleNo, isText: true },
  { label: "Bank A/C", cur: (cur.bankDetails || {}).ac, rev: (prop.bankDetails || {}).ac, isText: true },
];

function arpdiChangedField(f) {
  if (f.rev == null) return false;
  if (f.isDate) {
    const c = f.cur ? new Date(f.cur).toDateString() : '';
    const r = f.rev ? new Date(f.rev).toDateString() : '';
    return c !== r;
  }
  if (f.isText) return (f.rev || "") !== (f.cur || "");
  return Math.abs(Number(f.rev || 0) - Number(f.cur || 0)) > 1e-9;
}
function arpdiBulletHtml(f) {
  const disp = (v) => f.isDate ? (v ? formatOrdinalDate(v) : '—') : (f.isText ? (v || '—') : ARPDI_FMT(v));
  return `<li><strong>${f.label}</strong>: ${disp(f.cur)} → <span style="font-weight:700; color:#b45309;">${disp(f.rev)}</span></li>`;
}

function renderArpdiCard(r) {
  if (!r) return `<div style="color:#b91c1c;">Not found.</div>`;
  const cur = r.current || {};
  const prop = r.proposed || {};
  if (prop.error) return `<div style="color:#b91c1c;">Cannot compute the proposed revision: ${prop.error}</div>`;

  // Line Item Change Summary — old -> new quantity/rate per line, keyed
  // on lineId (= po_line_id, what the authorize route updates by).
  const curByLineId = {};
  (cur.lineItems || []).forEach(l => { curByLineId[l.lineId] = l; });
  const lineSummaryLines = (prop.lineItems || []).map(pl => {
    const c = curByLineId[pl.lineId] || {};
    const oldQty = Number(c.quantity) || 0, newQty = Number(pl.quantity) || 0;
    const oldRate = Number(c.ratePerQuantity) || 0, newRate = Number(pl.ratePerQuantity) || 0;
    if (Math.abs(newQty - oldQty) < 1e-9 && Math.abs(newRate - oldRate) < 1e-9) return "";
    const qtyColor = newQty > oldQty ? "#15803d" : (newQty < oldQty ? "#b91c1c" : "#334155");
    return `<li><strong>${escapeHtml(pl.description || c.description || ('Line ' + pl.lineId))}:</strong> Qty ${ARPDI_FMT(oldQty)} → <span style="font-weight:700; color:${qtyColor};">${ARPDI_FMT(newQty)}</span>${Math.abs(newRate - oldRate) > 1e-9 ? `, Rate ${ARPDI_FMT(oldRate)} → <span style="font-weight:700; color:#b45309;">${ARPDI_FMT(newRate)}</span>` : ""}</li>`;
  }).filter(Boolean);
  const lineSummaryHtml = lineSummaryLines.length ? `
    <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:10px 14px; margin-bottom:12px;">
      <div style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:#78350f; margin-bottom:6px;">Line Item Change Summary</div>
      <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#334155; line-height:1.7;">${lineSummaryLines.join("")}</ul>
    </div>` : "";

  // General Change Summary — header fields only, changed ones only.
  const generalFieldDefs = ARPDI_GENERAL_FIELD_DEFS(cur, prop);
  const generalBullets = generalFieldDefs.filter(arpdiChangedField).map(arpdiBulletHtml);
  const generalSummaryHtml = generalBullets.length ? `
    <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:10px 14px; margin-bottom:12px;">
      <div style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:#78350f; margin-bottom:6px;">General Change Summary</div>
      <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#334155; line-height:1.7;">${generalBullets.join("")}</ul>
    </div>` : "";

  const noChangesHtml = (!lineSummaryLines.length && !generalBullets.length)
    ? `<div style="padding:10px 14px; color:var(--muted); font-size:0.86rem; margin-bottom:12px;">No changes detected in this revision request.</div>` : "";

  return `
    <div style="padding:10px 12px; margin-bottom:12px; border-left:4px solid #0ea5e9; background:#f0f9ff; color:#0c4a6e; border-radius:var(--radius); font-size:0.82rem; font-weight:600;">
      View only. Authorizing approves the latest signed revision draft exactly as printed. To change anything, the person who drafted it edits it in Pending Revisions (Editing) and prints a new draft.
    </div>
    ${lineSummaryHtml}${generalSummaryHtml}${noChangesHtml}
    <div class="pdi-view-section" style="margin-top:6px;">Invoice after this revision (V${(Number(r.currentRevision) || 1) + 1})</div>
    ${renderPdiInvoiceViewHtml(prop, {
      invoiceNo: r.invoiceNo, invoiceType: r.invoiceType, projectId: r.projectId,
      invoiceDate: r.draftDocDate ? formatOrdinalDate(r.draftDocDate) : (prop.invoiceDate || ''),
      poNumber: r.poNumber, poDate: r.poDate ? formatOrdinalDate(r.poDate) : '',
    })}
    <div class="pdi-view-section">Invoice Documents</div>
    <div id="arpdi-docs-${r.requestId}" style="font-size:0.85rem; color:var(--muted);">Loading documents...</div>
    <div style="margin-top:16px;">
    <button class="nav-btn-styled" style="background:var(--brand); padding:8px 18px; font-weight:700;" onclick="openArpdiAuthorizeConfirm(${r.requestId}, '${r.invoiceNo}')">Authorize</button>
    ${typeof isUserAdminGlobal !== 'undefined' && isUserAdminGlobal ? `<button class="nav-btn-styled" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:8px 18px; font-weight:700; margin-left:8px;" onclick="adminDeleteArpdiRequest(${r.requestId})">Admin: Delete Request</button>` : ''}
    </div>
    <div id="arpdi-card-feedback-${r.requestId}" style="margin-top:10px;"></div>`;
}

let arpdiConfirmRequestId = null;
function openArpdiAuthorizeConfirm(requestId, invoiceNo) {
  arpdiConfirmRequestId = requestId;
  document.getElementById("arpdi-confirm-target").textContent = `Revision #${requestId} (Invoice ${invoiceNo})`;
  document.getElementById("arpdi-confirm-modal").style.display = "flex";
}
function closeArpdiAuthorizeConfirm() { document.getElementById("arpdi-confirm-modal").style.display = "none"; }

async function submitArpdiAuthorize() {
  const requestId = arpdiConfirmRequestId;
  closeArpdiAuthorizeConfirm();
  if (!requestId) return;
  showBlockingOverlay("Authorizing revision...");
  try {
    const data = await apFetch({ action: "authorizeProjectDispatchInvoiceRevision", requestId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (data.success) {
      initializeArpdiWorkspace();
      const pending = [];
      if (!data.url) pending.push("The invoice PDF is still being generated and will retry automatically.");
      if (data.challanNumber && !data.challanUrl) pending.push("The updated Delivery Challan PDF is still being generated and will retry automatically.");
      const r = (window._arpdiRequestsById || {})[requestId] || {};
      renderPdiSuccessCard("arpdi-feedback", {
        title: `Revision authorized${data.invoiceNo ? ` for Invoice ${escapeHtml(String(data.invoiceNo))}` : ""}`,
        rows: [
          ["Invoice No.", data.invoiceNo],
          ["Now at Revision", data.revision ? `V${data.revision}` : ""],
          ["Invoice Type", r.invoiceType ? `${r.invoiceType} Invoice` : ""],
          ["Project ID", r.projectId],
          ["Delivery Challan No.", data.challanNumber],
        ],
        notes: pending,
        links: [
          { label: "Open Revised Invoice", url: data.url ? driveLink(data.url) : "" },
          { label: "Open Delivery Challan", url: data.challanUrl ? driveLink(data.challanUrl) : "" },
        ],
        resetLabel: "Authorize Another", resetFn: "initializeArpdiWorkspace()",
      });
      document.getElementById("arpdi-feedback").scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const fb = document.getElementById(`arpdi-card-feedback-${requestId}`);
      if (fb) fb.innerHTML = `<div style="color:#b91c1c; font-weight:600;">${data.error || 'Failed.'}</div>`;
      else showBOQBanner("arpdi-feedback", data.error || "Failed.", "error");
    }
  } catch(e) {
    showBOQBanner("arpdi-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

async function adminDeleteArpdiRequest(requestId) {
  if (!confirm(`Admin: permanently delete pending revision request #${requestId}? The live invoice is untouched.`)) return;
  showBlockingOverlay("Deleting request...");
  try {
    const data = await apFetch({ action: "deleteProjectDispatchInvoiceRevisionRequest", requestId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (data.success) { showBOQBanner("arpdi-feedback", "Revision request deleted.", "success"); initializeArpdiWorkspace(); }
    else showBOQBanner("arpdi-feedback", data.error || "Failed.", "error");
  } catch(e) {
    showBOQBanner("arpdi-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}
