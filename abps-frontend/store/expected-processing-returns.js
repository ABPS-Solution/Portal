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
  const th = "padding:9px 10px; border:2px solid #94a3b8; background:#e0e7ff; color:#1e3a8a; font-size:0.74rem; font-weight:800; text-transform:uppercase;";
  const td = "padding:8px 10px; border:2px solid #94a3b8; font-size:0.87rem; vertical-align:top;";
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
    <td style="${td} text-align:center; font-weight:700;">${escapeHtml(typeof qtyOf(i) === "string" ? qtyOf(i) : String(fmtQty(qtyOf(i))))}</td>
    <td style="${td} text-align:center;">${escapeHtml(unitOf(i) || "")}</td></tr>`).join("");
  const cell = (label, value) => `<div style="min-width:0;"><div style="font-size:0.68rem; font-weight:800; text-transform:uppercase; color:var(--muted);">${label}</div><div style="font-weight:700; font-size:0.87rem; word-break:break-word;">${value}</div></div>`;

  // One card per Delivery Challan (29 Sep 2026); a challan can carry
  // several tickets, so ticket fields list every value and materials merge
  // by item code + unit.
  const uniqJoin = (arr) => [...new Set(arr.filter(Boolean))].join(", ");
  const mergeLines = (list, qtyOf, unitOf) => {
    const m = new Map();
    list.forEach(i => {
      const unit = unitOf(i) || "";
      const key = (i.itemCode || i.materialName || "") + "|" + unit;
      const e = m.get(key) || { itemCode: i.itemCode, materialName: i.materialName, unit, qty: 0 };
      e.qty += parseFloat(qtyOf(i)) || 0;
      m.set(key, e);
    });
    return [...m.values()];
  };
  const groups = new Map();
  rows.forEach(r => {
    const key = r.challanNumber || ("ticket:" + r.ticketId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  const statusOf = (tickets) => {
    let exp = 0, rec = 0;
    tickets.forEach(t => (t.returnProgress || []).forEach(p => { exp += Number(p.expectedQty) || 0; rec += Math.min(Number(p.receivedQty) || 0, Number(p.expectedQty) || 0); }));
    if (exp > 0 && rec >= exp - 1e-9) return "Delivered";
    return rec > 1e-9 ? "Partially Delivered" : "Pending";
  };
  const shown = [...groups.entries()].filter(([, tickets]) => q || statusOf(tickets) !== "Delivered");
  if (!shown.length) {
    feed.innerHTML = `<div style="padding:16px; text-align:center; color:var(--muted); border:1px dashed var(--border); border-radius:var(--radius);">No Processing material is due back. Search to see delivered challans.</div>`;
    return;
  }
  const statusBadge = (st) => {
    const c = st === "Delivered" ? ["#15803d", "#dcfce7"] : st === "Partially Delivered" ? ["#b45309", "#fef3c7"] : ["#475569", "#f1f5f9"];
    return `<span style="color:${c[0]}; background:${c[1]}; padding:2px 8px; border-radius:4px; font-size:0.8rem;">${st}</span>`;
  };

  feed.innerHTML = shown.map(([key, tickets]) => {
    const r = tickets[0];
    const status = statusOf(tickets);
    const open = epmrExpandedTicketId === key;
    const sent = mergeLines(tickets.flatMap(t => t.items || []), i => i.released ?? i.quantity ?? 0, i => i.unitType);
    const expected = mergeLines(tickets.flatMap(t => t.expectedReturnItems || []), i => i.quantity ?? 0, i => i.unit);
    const receivedByCode = {};
    tickets.forEach(t => (t.returnProgress || []).forEach(p => { receivedByCode[p.itemCode] = (receivedByCode[p.itemCode] || 0) + (parseFloat(p.receivedQty) || 0); }));
    const tickets_ = tickets.map(t => t.ticketId);
    const challan = r.challanNumber
      ? (r.challanUrl ? `<a href="${driveLink(r.challanUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:var(--brand);">${escapeHtml(r.challanNumber)} ↗</a>` : escapeHtml(r.challanNumber))
      : "—";
    return `<div style="border:1px solid ${open ? "var(--brand)" : "var(--border)"}; border-left:4px solid #15803d; border-radius:var(--radius); background:#fff;">
      <div onclick="epmrToggle(${jsArg(key)})" style="cursor:pointer; padding:12px 14px; background:#eaf1fb; border-radius:${open ? "var(--radius) var(--radius) 0 0" : "var(--radius)"}; display:grid; grid-template-columns:1.5fr 1.1fr 1.4fr 1.3fr 1fr 1fr 1fr 24px; gap:10px 14px; align-items:center;">
        ${cell("Project", escapeHtml(uniqJoin(tickets.map(t => t.projectId || t.companyName)) || "—"))}
        ${cell("Ticket ID", `<span style="font-family:monospace;">${escapeHtml(tickets_.join(", "))}</span>`)}
        ${cell("Vendor Name", escapeHtml(r.vendorName || "—"))}
        ${cell("Delivery Challan", challan)}
        ${cell("Ticket Raised On", escapeHtml(uniqJoin(tickets.map(t => t.dateCreated ? formatOrdinalDate(t.dateCreated) : "")) || "—"))}
        ${cell("Ticket Raised By", escapeHtml(uniqJoin(tickets.map(t => t.requestedBy)) || "—"))}
        ${cell("Status", statusBadge(status))}
        <div style="font-size:1rem; color:var(--muted); text-align:right;">${open ? "▲" : "▼"}</div>
      </div>
      ${open ? `<div class="epmr-tables" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:0 14px 14px; border-top:1px solid var(--border); padding-top:12px;">
        ${table("Materials Sent for Processing", rowsOf(sent, i => i.qty, i => i.unit))}
        ${table("Expected Processing Material Return (received / expected, left)", rowsOf(expected, i => { const rc = receivedByCode[i.itemCode] || 0; const left = Math.max(0, i.qty - rc); return `${fmtQty(rc)} / ${fmtQty(i.qty)}${left > 1e-9 ? ` · ${fmtQty(left)} left` : " · done"}`; }, i => i.unit))}
      </div>` : ""}
    </div>`;
  }).join("");
}
