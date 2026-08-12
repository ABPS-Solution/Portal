let materialAckExpandedTicketId = null;

async function initializeMaterialAckWorkspace() {
  const feed     = document.getElementById("material-ack-queue-feed");
  const feedback = document.getElementById("material-ack-feedback");
  if (feedback) feedback.style.display = "none";
  materialAckExpandedTicketId = null;
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">
    <div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>
    Loading Material Receipts...
  </div>`;

  try {
    const data = await apFetch({ action: "fetchPendingMaterialAcknowledgements" });
    if (!data.success) {
      feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">${data.error}</div>`;
      return;
    }
    if (!data.tickets || data.tickets.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <h3 style="color:var(--accent);">No Material Receipts Awaiting Acknowledgement</h3>
      </div>`;
      return;
    }
    feed.innerHTML = "";
    data.tickets.forEach(ticket => {
      feed.appendChild(renderMaterialAckCard(ticket));
    });
  } catch(e) {
    if (e.message !== "SESSION_EXPIRED") {
      feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Network error: ${e.message}</div>`;
    }
  }
}

function renderMaterialAckCard(ticket) {
  const card = document.createElement("div");
  card.className = "contact-summary-card-parent";
  card.id = `material-ack-card-${ticket.ticketId}`;

  const items = ticket.items || [];
  const rowsHtml = items.map(item => `
    <tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px; font-weight:600;">${item.materialName || item.itemCode || ""}</td>
      <td style="padding:8px; font-family:monospace; color:var(--brand);">${item.itemCode || "—"}</td>
      <td style="padding:8px; text-align:center;">${fmtQty(item.released ?? item.quantity)}</td>
      <td style="padding:8px; text-align:center; color:var(--muted);">${item.unitType || "—"}</td>
    </tr>`).join("");

  card.innerHTML = `
    <div class="contact-summary-header-row" onclick="toggleMaterialAckCardBody('${ticket.ticketId}')" style="margin-bottom:0; padding-bottom:8px; cursor:pointer;">
      <div class="contact-summary-title-info" style="width:100%;">
        <div class="meta-row-line-block">
          <span style="font-family:monospace; font-weight:800; background:#e0f2fe; color:var(--brand); padding:3px 8px; font-size:0.85rem; border-radius:3px;">${ticket.ticketId}</span>
          <strong style="margin-left:10px; color:var(--brand); font-size:0.9rem;">${ticket.jobCardNumber || "—"}</strong>
          <span id="material-ack-caret-${ticket.ticketId}" style="float:right; font-weight:700; color:var(--muted);">▸</span>
        </div>
        <div class="meta-row-line-block" style="margin-top:8px; font-size:0.85rem;">
          <span>Project:</span> <strong style="color:#111827;">${ticket.projectId || "—"}</strong>
          <span style="margin-left:8px;">|</span>
          <span style="margin-left:8px;">Issued By:</span> <strong style="color:#111827;">${ticket.actionedBy || "—"}</strong>
          <span style="margin-left:8px;">|</span>
          <strong style="color:#111827; margin-left:8px;">${formatDateDMY(ticket.dateActioned) || "—"}</strong>
          <span style="margin-left:12px;">Dept:</span> <strong style="color:#111827;">${ticket.department || "—"}</strong>
        </div>
      </div>
    </div>
    <div id="material-ack-body-${ticket.ticketId}" style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:8px;">
      <div style="overflow-x:auto; margin-bottom:14px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
          <thead>
            <tr style="background:var(--highlight-bg); text-align:left;">
              <th style="padding:8px;">Material Name</th>
              <th style="padding:8px;">Item Code</th>
              <th style="padding:8px; text-align:center;">Issued Quantity</th>
              <th style="padding:8px; text-align:center;">Unit</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="nav-btn-styled" onclick="submitMaterialAcknowledgement('${ticket.ticketId}')"
          id="material-ack-confirm-btn-${ticket.ticketId}"
          style="background:var(--accent); padding:8px 20px; font-weight:700;">
          Confirm Receipt
        </button>
      </div>
    </div>
  `;
  return card;
}

function toggleMaterialAckCardBody(ticketId) {
  const body = document.getElementById(`material-ack-body-${ticketId}`);
  const caret = document.getElementById(`material-ack-caret-${ticketId}`);
  if (!body) return;
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "block";
  if (caret) caret.textContent = isOpen ? "▸" : "▾";
}

async function submitMaterialAcknowledgement(ticketId) {
  if (!confirm(`Confirm that the material issued on Ticket ${ticketId} has been physically received? This cannot be undone.`)) return;

  const btn = document.getElementById(`material-ack-confirm-btn-${ticketId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Confirming..."; }
  showBlockingOverlay("Confirming Material Receipt...");
  try {
    const data = await apFetch({ action: "submitMaterialReceiptAcknowledgement", ticketId });
    if (data.success) {
      await initializeMaterialAckWorkspace();
    } else {
      alert(data.error || "Failed to confirm receipt.");
      if (btn) { btn.disabled = false; btn.textContent = "Confirm Receipt"; }
    }
  } catch(e) {
    alert("Network error: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Confirm Receipt"; }
  } finally {
    hideBlockingOverlay();
  }
}
