// ═══════════════════════════════════════════════════════════════════════
// store/dispatch-invoice-authorize.js — Authorize Project Dispatch
// Invoice (migration 208, 19 Sep 2026). Approve-only, no inline editing,
// no reject — the authorizer signs off exactly what the draft
// already showed on paper. The only escape hatch for a wrong draft is an
// admin deleting it (deleteProjectDispatchInvoiceDraft).
// ═══════════════════════════════════════════════════════════════════════

let apdiExpandedInvoiceId = null;

async function initializeApdiWorkspace() {
  document.getElementById("apdi-feedback").style.display = "none";
  apdiExpandedInvoiceId = null;
  const feed = document.getElementById("apdi-cards-feed");
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchPendingProjectDispatchInvoices" });
    if (!data.success) { feed.innerHTML = `<div style="color:#b91c1c; padding:14px;">${data.error || 'Failed to load.'}</div>`; return; }
    if (!(data.invoices || []).length) { feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">No invoices awaiting authorization.</div>`; return; }
    feed.innerHTML = data.invoices.map(inv => `
      <div style="border:1px solid var(--border); border-radius:var(--radius); padding:12px; margin-bottom:10px; background:#fff;">
        <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="toggleApdiCard(${inv.invoiceId})">
          <div>
            <strong>${inv.invoiceType} Invoice #${inv.invoiceId}</strong> — ${inv.projectId} ${inv.companyName ? `(${inv.companyName})` : ''}
            <div style="font-size:0.8rem; color:var(--muted);">Created by ${inv.createdBy || '—'} · pending ${inv.pendingDays === 0 ? 'today' : `${inv.pendingDays} day(s)`}</div>
          </div>
          <div style="text-align:right;">
            ${inv.checkingDocUrl ? `<a href="${driveLink(inv.checkingDocUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:var(--brand); font-weight:700; font-size:0.85rem;">📄 Draft #${inv.checkingDraftCount} ↗</a>` : `<span style="color:#b45309; font-size:0.8rem;">No draft yet</span>`}
          </div>
        </div>
        <div id="apdi-card-${inv.invoiceId}" style="display:none; margin-top:12px; border-top:1px solid var(--border); padding-top:12px;"></div>
      </div>`).join('');
  } catch(e) {
    feed.innerHTML = `<div style="color:#b91c1c; padding:14px;">Network error: ${e.message}</div>`;
  }
}

async function toggleApdiCard(invoiceId) {
  const card = document.getElementById(`apdi-card-${invoiceId}`);
  if (!card) return;
  if (apdiExpandedInvoiceId === invoiceId) { card.style.display = "none"; apdiExpandedInvoiceId = null; return; }
  apdiExpandedInvoiceId = invoiceId;
  card.style.display = "block";
  card.innerHTML = `<div style="text-align:center; padding:12px; color:var(--muted);">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchPendingProjectDispatchInvoiceDetail", invoiceId });
    if (!data.success) { card.innerHTML = `<div style="color:#b91c1c;">${data.error || 'Failed to load.'}</div>`; return; }
    const details = data.invoiceDetails || {};
    const items = details.lineItems || [];
    const rowsHtml = items.map(it => `<tr>
      <td style="padding:6px;">${escapeHtml(it.description || '')}</td>
      <td style="padding:6px; text-align:center;">${it.hsnNumber || '—'}</td>
      <td style="padding:6px; text-align:center;">${it.quantity}</td>
      <td style="padding:6px; text-align:right;">${(parseFloat(it.ratePerQuantity) || 0).toLocaleString('en-IN')}</td>
      <td style="padding:6px; text-align:right; font-weight:600;">${(parseFloat(it.totalBasicPrice) || 0).toLocaleString('en-IN')}</td>
    </tr>`).join('');
    card.innerHTML = `
      <div style="font-size:0.85rem; color:var(--muted); margin-bottom:10px;">
        Trade Type: <strong>${details.tradeType || 'Local'}</strong>${details.tradeType === 'Export' ? ` · Rate: ${details.usdRate || '—'}` : ''} ·
        Freight: ${details.freightAmount || 0} · Others: ${details.othersAmount || 0}
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:10px;">
        <thead><tr style="background:var(--highlight-bg);"><th style="padding:6px; text-align:left;">Description</th><th style="padding:6px;">HSN</th><th style="padding:6px;">Qty</th><th style="padding:6px;">Rate</th><th style="padding:6px;">Amount</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="font-size:0.85rem; margin-bottom:10px;">
        <strong>Documents:</strong>
        ${(data.documents || []).map(d => `<div>${d.docLabel}${d.fileName ? ` — ${d.fileName}` : ''}: <a href="${driveLink(d.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open ↗</a></div>`).join('') || '<span style="color:var(--muted);"> none</span>'}
      </div>
      <button class="nav-btn-styled" style="background:var(--brand); padding:8px 18px; font-weight:700;" onclick="openApdiAuthorizeConfirm(${invoiceId}, '${data.projectId}')">Authorize</button>
      ${typeof isUserAdminGlobal !== 'undefined' && isUserAdminGlobal ? `<button class="nav-btn-styled" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:8px 18px; font-weight:700; margin-left:8px;" onclick="adminDeleteApdiDraft(${invoiceId})">Admin: Delete Draft</button>` : ''}
      <div id="apdi-card-feedback-${invoiceId}" style="margin-top:10px;"></div>`;
  } catch(e) {
    card.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
  }
}

let apdiConfirmInvoiceId = null;
function openApdiAuthorizeConfirm(invoiceId, projectId) {
  apdiConfirmInvoiceId = invoiceId;
  document.getElementById("apdi-confirm-target").textContent = `${projectId} (Invoice #${invoiceId})`;
  document.getElementById("apdi-confirm-modal").style.display = "flex";
}
function closeApdiAuthorizeConfirm() { document.getElementById("apdi-confirm-modal").style.display = "none"; }

async function submitApdiAuthorize() {
  const invoiceId = apdiConfirmInvoiceId;
  closeApdiAuthorizeConfirm();
  if (!invoiceId) return;
  showBlockingOverlay("Authorizing invoice...");
  try {
    const data = await apFetch({ action: "authorizeProjectDispatchInvoice", invoiceId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (data.success) {
      initializeApdiWorkspace();
      const pending = [];
      if (!data.url) pending.push("The invoice PDF is still being generated and will retry automatically.");
      if (!data.challanUrl) pending.push("The Delivery Challan PDF is still being generated and will retry automatically — find it later in Search Material Outward on Delivery Challan.");
      showSuccessWithReset("apdi-feedback",
        `Invoice ${escapeHtml(String(data.invoiceNo || ""))} authorized.${data.challanNumber ? ` Delivery Challan ${escapeHtml(String(data.challanNumber))} created.` : ""}${pending.length ? `<div style="font-weight:600; color:#b45309; margin-top:6px;">${pending.join("<br>")}</div>` : ""}`,
        "Authorize Another", "initializeApdiWorkspace()",
        [
          { label: "📄 Open Invoice PDF", url: data.url ? driveLink(data.url) : "" },
          { label: "📄 Open Delivery Challan PDF", url: data.challanUrl ? driveLink(data.challanUrl) : "" },
        ]);
      document.getElementById("apdi-feedback").scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const fb = document.getElementById(`apdi-card-feedback-${invoiceId}`);
      if (fb) fb.innerHTML = `<div style="color:#b91c1c; font-weight:600;">${data.error || 'Failed.'}</div>`;
      else showBOQBanner("apdi-feedback", data.error || "Failed.", "error");
    }
  } catch(e) {
    showBOQBanner("apdi-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

// ── Admin-only: delete a stuck draft (the sole escape hatch, no reject) ──
async function adminDeleteApdiDraft(invoiceId) {
  if (!confirm(`Admin: permanently delete pending invoice draft #${invoiceId}? This releases its reserved units and cannot be undone. No invoice number was ever minted, so nothing is burned.`)) return;
  showBlockingOverlay("Deleting draft...");
  try {
    const data = await apFetch({ action: "deleteProjectDispatchInvoiceDraft", invoiceId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (data.success) { showBOQBanner("apdi-feedback", "Draft deleted.", "success"); initializeApdiWorkspace(); }
    else showBOQBanner("apdi-feedback", data.error || "Failed.", "error");
  } catch(e) {
    showBOQBanner("apdi-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}
