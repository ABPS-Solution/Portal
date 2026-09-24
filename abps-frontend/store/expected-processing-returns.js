// store/expected-processing-returns.js — Expected Processing Material
// Return (24 Sep 2026). Read-only list of every Processing ticket (job
// work at an outside vendor), what is expected back, and its stage.

let epmrRows = [];
let epmrFilter = "all";

function epmrStage(r) {
  if (r.status === "Rejected") return { label: "Rejected", color: "#64748b", key: "rejected" };
  if (r.status !== "Approved") return { label: "Awaiting Ticket Approval", color: "#b45309", key: "pending" };
  if (!r.challanNumber && !r.challanStatus) return { label: "Awaiting Delivery Challan", color: "#b45309", key: "pending" };
  if (r.challanStatus !== "Finalised") return { label: "Challan Being Prepared", color: "#2563eb", key: "pending" };
  return { label: "Sent to Vendor", color: "#15803d", key: "sent" };
}

async function initializeExpectedProcessingReturnsWorkspace() {
  const feed = document.getElementById("epmr-feed");
  if (!feed) return;
  const search = document.getElementById("epmr-search");
  if (search) search.value = "";
  feed.innerHTML = `<div style="color:var(--muted); padding:20px; text-align:center;">Loading Processing tickets...</div>`;
  try {
    const data = await apFetch({ action: "fetchExpectedProcessingReturns" });
    if (!data.success) throw new Error(data.error || "Failed to load.");
    epmrRows = data.rows || [];
    epmrRender();
  } catch (err) {
    feed.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}

function epmrSetFilter(key) {
  epmrFilter = key;
  epmrRender();
}

function epmrRender() {
  const feed = document.getElementById("epmr-feed");
  if (!feed) return;
  ["all", "sent", "pending"].forEach(k => {
    const b = document.getElementById(`epmr-filter-${k}`);
    if (b) { b.style.background = epmrFilter === k ? "var(--brand)" : "#e2e8f0"; b.style.color = epmrFilter === k ? "#fff" : "#334155"; }
  });
  const q = (document.getElementById("epmr-search")?.value || "").trim().toLowerCase();
  const rows = epmrRows.filter(r => {
    const st = epmrStage(r);
    if (epmrFilter !== "all" && st.key !== epmrFilter) return false;
    if (!q) return true;
    const hay = [r.ticketId, r.vendorName, r.companyName, r.projectId, r.challanNumber, r.requestedBy,
      ...(r.expectedReturnItems || []).map(i => i.materialName || i.itemCode)].join(" ").toLowerCase();
    return hay.includes(q);
  });
  if (!rows.length) {
    feed.innerHTML = `<div style="padding:16px; text-align:center; color:var(--muted); border:1px dashed var(--border); border-radius:var(--radius);">No Processing tickets match.</div>`;
    return;
  }
  const th = "padding:8px; border:1px solid var(--border); font-size:0.72rem; text-transform:uppercase; color:var(--muted);";
  const td = "padding:6px 8px; border:1px solid var(--border); font-size:0.85rem;";
  feed.innerHTML = rows.map(r => {
    const st = epmrStage(r);
    const sent = (r.items || []).map(i => `<tr><td style="${td}">${escapeHtml(i.materialName || i.itemCode || "")}</td><td style="${td} text-align:center; font-weight:700;">${escapeHtml(String(fmtQty(i.released ?? i.quantity ?? 0)))}</td><td style="${td} text-align:center;">${escapeHtml(i.unitType || "")}</td></tr>`).join("");
    const back = (r.expectedReturnItems || []).map(i => `<tr><td style="${td}">${escapeHtml(i.materialName || i.itemCode || "")}</td><td style="${td} text-align:center; font-weight:700;">${escapeHtml(String(fmtQty(i.quantity ?? 0)))}</td><td style="${td} text-align:center;">${escapeHtml(i.unit || "")}</td></tr>`).join("");
    const table = (title, body) => `<div style="min-width:0;"><div style="font-weight:800; font-size:0.8rem; color:var(--brand); margin-bottom:4px;">${title}</div>
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;"><colgroup><col style="width:64%;"/><col style="width:18%;"/><col style="width:18%;"/></colgroup>
      <thead><tr style="background:var(--highlight-bg);"><th style="${th} text-align:left;">Material</th><th style="${th}">Qty</th><th style="${th}">Unit</th></tr></thead>
      <tbody>${body || `<tr><td colspan="3" style="${td} color:var(--muted); text-align:center;">None recorded.</td></tr>`}</tbody></table></div>`;
    const cell = (label, value) => `<div style="min-width:0;"><div style="font-size:0.68rem; font-weight:800; text-transform:uppercase; color:var(--muted);">${label}</div><div style="font-weight:700; font-size:0.86rem; word-break:break-word;">${value}</div></div>`;
    const challan = r.challanNumber
      ? (r.challanUrl && r.challanStatus === "Finalised" ? `<a href="${driveLink(r.challanUrl)}" target="_blank" rel="noopener" style="color:var(--brand);">${escapeHtml(r.challanNumber)} ↗</a>` : escapeHtml(r.challanNumber))
      : "—";
    return `<div style="border:1px solid var(--border); border-left:4px solid ${st.color}; border-radius:var(--radius); padding:14px; background:#fff;">
      <div style="display:grid; grid-template-columns:1.1fr 1.3fr 1.4fr 1.2fr 1fr 1.2fr; gap:10px 14px; margin-bottom:12px;">
        ${cell("Ticket ID", `<span style="font-family:monospace;">${escapeHtml(r.ticketId)}</span>`)}
        ${cell("Stage", `<span style="color:${st.color};">${st.label}</span>`)}
        ${cell("Vendor", escapeHtml(r.vendorName || "—"))}
        ${cell("Delivery Challan", challan + (r.challanDate ? `<div style="font-weight:600; color:var(--muted); font-size:0.78rem;">${escapeHtml(formatOrdinalDate(r.challanDate))}</div>` : ""))}
        ${cell("Raised", escapeHtml(r.dateCreated ? formatOrdinalDate(r.dateCreated) : "—") + `<div style="font-weight:600; color:var(--muted); font-size:0.78rem;">${escapeHtml(r.requestedBy || "")}</div>`)}
        ${cell("Project / Company", escapeHtml(r.companyName || r.projectId || "—"))}
      </div>
      <div class="epmr-tables" style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
        ${table("Sent for Processing", sent)}
        ${table("Expected Processing Material Return", back)}
      </div>
    </div>`;
  }).join("");
}
