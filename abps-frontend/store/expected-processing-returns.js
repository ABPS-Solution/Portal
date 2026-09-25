// store/expected-processing-returns.js — Expected Processing Material
// Return (24 Sep 2026). Read-only list of Processing tickets (job work at an
// outside vendor) that have actually been SENT (their Delivery Challan is
// authorized), and what is expected back. Tickets not yet sent are tracked
// in Material Outward on Delivery Challan instead (25 Sep 2026). One
// collapsible card per ticket; only one open at a time.

let epmrRows = [];
let epmrExpandedTicketId = null;

function epmrIsSent(r) {
  return r.status === "Approved" && r.challanStatus === "Finalised";
}

async function initializeExpectedProcessingReturnsWorkspace() {
  const feed = document.getElementById("epmr-feed");
  if (!feed) return;
  const search = document.getElementById("epmr-search");
  if (search) search.value = "";
  epmrExpandedTicketId = null;
  feed.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center;">Loading Processing tickets...</div>`;
  try {
    const data = await apFetch({ action: "fetchExpectedProcessingReturns" });
    if (!data.success) throw new Error(data.error || "Failed to load.");
    epmrRows = (data.rows || []).filter(epmrIsSent);
    epmrRender();
  } catch (err) {
    feed.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}

function epmrToggle(ticketId) {
  epmrExpandedTicketId = epmrExpandedTicketId === ticketId ? null : ticketId;
  epmrRender();
}

function epmrRender() {
  const feed = document.getElementById("epmr-feed");
  if (!feed) return;
  const q = (document.getElementById("epmr-search")?.value || "").trim().toLowerCase();
  const rows = epmrRows.filter(r => {
    if (!q) return true;
    const hay = [r.ticketId, r.vendorName, r.companyName, r.projectId, r.challanNumber, r.requestedBy,
      ...(r.items || []).map(i => i.materialName || i.itemCode),
      ...(r.expectedReturnItems || []).map(i => i.materialName || i.itemCode)].join(" ").toLowerCase();
    return hay.includes(q);
  });
  if (!rows.length) {
    feed.innerHTML = `<div style="padding:16px; text-align:center; color:var(--muted); border:1px dashed var(--border); border-radius:var(--radius);">No Processing material sent to a vendor matches.</div>`;
    return;
  }
  const th = "padding:9px 10px; border:1px solid #cbd5e1; background:#e0e7ff; color:#1e3a8a; font-size:0.74rem; font-weight:800; text-transform:uppercase;";
  const td = "padding:8px 10px; border:1px solid #cbd5e1; font-size:0.87rem; vertical-align:top;";
  const table = (title, body) => `<div style="min-width:0;">
    <div style="font-weight:800; font-size:0.84rem; color:var(--brand); margin-bottom:6px;">${title}</div>
    <table style="width:100%; border-collapse:collapse; table-layout:fixed; background:#fff;">
      <colgroup><col style="width:8%;"/><col style="width:60%;"/><col style="width:16%;"/><col style="width:16%;"/></colgroup>
      <thead><tr><th style="${th}">Sr No</th><th style="${th} text-align:left;">Material</th><th style="${th}">Qty</th><th style="${th}">Unit</th></tr></thead>
      <tbody>${body || `<tr><td colspan="4" style="${td} color:var(--muted); text-align:center;">None recorded.</td></tr>`}</tbody>
    </table></div>`;
  const rowsOf = (list, qtyOf, unitOf) => list.map((i, n) => `<tr>
    <td style="${td} text-align:center; font-weight:700;">${n + 1}</td>
    <td style="${td} word-break:break-word;">${escapeHtml(i.materialName || i.itemCode || "")}</td>
    <td style="${td} text-align:center; font-weight:700;">${escapeHtml(String(fmtQty(qtyOf(i))))}</td>
    <td style="${td} text-align:center;">${escapeHtml(unitOf(i) || "")}</td></tr>`).join("");
  const cell = (label, value) => `<div style="min-width:0;"><div style="font-size:0.68rem; font-weight:800; text-transform:uppercase; color:var(--muted);">${label}</div><div style="font-weight:700; font-size:0.87rem; word-break:break-word;">${value}</div></div>`;

  feed.innerHTML = rows.map(r => {
    const open = epmrExpandedTicketId === r.ticketId;
    const challan = r.challanNumber
      ? (r.challanUrl ? `<a href="${driveLink(r.challanUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:var(--brand);">${escapeHtml(r.challanNumber)} ↗</a>` : escapeHtml(r.challanNumber))
      : "—";
    const tid = escapeHtml(r.ticketId).replace(/'/g, "&#39;");
    return `<div style="border:1px solid ${open ? "var(--brand)" : "var(--border)"}; border-left:4px solid #15803d; border-radius:var(--radius); background:#fff;">
      <div onclick="epmrToggle('${tid}')" style="cursor:pointer; padding:12px 14px; display:grid; grid-template-columns:1.5fr 1.1fr 1.4fr 1.3fr 1fr 1fr 24px; gap:10px 14px; align-items:center;">
        ${cell("Project / Company", escapeHtml(r.companyName || r.projectId || "—"))}
        ${cell("Ticket ID", `<span style="font-family:monospace;">${escapeHtml(r.ticketId)}</span>`)}
        ${cell("Vendor Name", escapeHtml(r.vendorName || "—"))}
        ${cell("Delivery Challan", challan)}
        ${cell("Raised On", escapeHtml(r.dateCreated ? formatOrdinalDate(r.dateCreated) : "—"))}
        ${cell("Raised By", escapeHtml(r.requestedBy || "—"))}
        <div style="font-size:1rem; color:var(--muted); text-align:right;">${open ? "▲" : "▼"}</div>
      </div>
      ${open ? `<div class="epmr-tables" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:0 14px 14px; border-top:1px solid var(--border); padding-top:12px;">
        ${table("Materials Sent for Processing", rowsOf(r.items || [], i => i.released ?? i.quantity ?? 0, i => i.unitType))}
        ${table("Expected Processing Material Return", rowsOf(r.expectedReturnItems || [], i => i.quantity ?? 0, i => i.unit))}
      </div>` : ""}
    </div>`;
  }).join("");
}
