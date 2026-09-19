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
      <div style="border:1px solid var(--border); border-radius:var(--radius); padding:12px; margin-bottom:10px; background:#fff;">
        <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="toggleArpdiCard(${r.requestId})">
          <div>
            <strong>Revision #${r.requestId}</strong> — ${r.invoiceType} Invoice ${r.invoiceNo} (${r.projectId}${r.companyName ? `, ${r.companyName}` : ''})
            <div style="font-size:0.8rem; color:var(--muted);">Requested by ${r.requestedBy || '—'} · current revision V${r.currentRevision}</div>
          </div>
          <div style="text-align:right;">
            ${r.checkingDocUrl ? `<a href="${driveLink(r.checkingDocUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:var(--brand); font-weight:700; font-size:0.85rem;">📄 Checking Draft #${r.checkingDraftCount} ↗</a>` : `<span style="color:#b45309; font-size:0.8rem;">No checking draft yet</span>`}
          </div>
        </div>
        <div id="arpdi-card-${r.requestId}" style="display:none; margin-top:12px; border-top:1px solid var(--border); padding-top:12px;"></div>
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
  card.innerHTML = renderArpdiCard(window._arpdiRequestsById[requestId]);
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
    ${lineSummaryHtml}${generalSummaryHtml}${noChangesHtml}
    <button class="nav-btn-styled" style="background:var(--brand); padding:8px 18px; font-weight:700;" onclick="openArpdiAuthorizeConfirm(${r.requestId}, '${r.invoiceNo}')">Authorize</button>
    ${typeof isUserAdminGlobal !== 'undefined' && isUserAdminGlobal ? `<button class="nav-btn-styled" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:8px 18px; font-weight:700; margin-left:8px;" onclick="adminDeleteArpdiRequest(${r.requestId})">Admin: Delete Request</button>` : ''}
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
      showBOQBanner("arpdi-feedback", `Revision authorized — now at V${data.revision}.${data.pdfPending ? ' PDF generation is pending and will retry automatically.' : ''}`, "success");
      initializeArpdiWorkspace();
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
