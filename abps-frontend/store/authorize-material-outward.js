// ═══════════════════════════════════════════════════════════════════════
// store/authorize-material-outward.js — Authorize Material Outward on
// Delivery Challan (24 Sep 2026). Same maker-checker idea as RM PO: the
// preparer fills the challan and prints a Draft on Material
// Outward on Delivery Challan; it then waits here for someone else to
// authorize it (admins may authorize their own). Authorizing is what
// issues the real document (finaliseDeliveryChallan); Reject discards the
// draft so its tickets return to the Material Outward queue.
// ═══════════════════════════════════════════════════════════════════════

window._amoChallans = [];
window._amoExpanded = new Set();
window._amoViewer = { personKey: null, isAdmin: false };

async function initializeAuthorizeMaterialOutwardWorkspace() {
  const fb = document.getElementById("amo-feedback-banner");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  window._amoExpanded = new Set();
  await amoLoadQueue();
}

async function amoLoadQueue() {
  const feed = document.getElementById("amo-feed");
  if (!feed) return;
  feed.style.display = "flex";
  feed.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted);">Loading challans awaiting authorization…</div>`;
  try {
    const data = await apFetch({ action: "fetchDeliveryChallansPendingAuthorization" });
    if (!data.success) throw new Error(data.error || "Failed to load.");
    window._amoChallans = data.challans || [];
    window._amoViewer = { personKey: data.viewerPersonKey, isAdmin: !!data.viewerIsAdmin };
    if (!window._amoChallans.length) {
      feed.innerHTML = `<div style="padding:16px; text-align:center; background:#f0fdf4; border:1px solid #86efac; border-radius:var(--radius); color:#15803d; font-weight:600;">✅ No Delivery Challans are waiting for authorization.</div>`;
      return;
    }
    feed.innerHTML = window._amoChallans.map(amoRenderCard).join("");
  } catch (err) {
    feed.innerHTML = `<div style="padding:14px; color:#b91c1c; background:#fef2f2; border-radius:var(--radius);">${escapeHtml(err.message)}</div>`;
  }
}

function amoConsigneeLabel(c) {
  return c.outward_type === "Processing" ? "Vendor Name" : "Company Name";
}

function amoRenderCard(c) {
  const id = c.challan_id;
  const open = window._amoExpanded.has(String(id));
  const own = c.created_by && c.created_by === window._amoViewer.personKey && !window._amoViewer.isAdmin;
  const tickets = c.linked_tickets || [];
  const items = c.line_items || [];
  const returns = tickets.flatMap(t => t.expectedReturnItems || []);
  const cell = "padding:7px 8px; border:1px solid var(--border);";
  const head = "padding:7px 8px; border:1px solid var(--border); background:var(--highlight-bg); font-size:0.72rem; text-transform:uppercase; color:var(--muted);";
  const field = (label, value) => `<div style="background:#fff; border:1px solid #cbd5e1; border-radius:var(--radius); padding:8px 10px; min-width:0;"><div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); margin-bottom:3px;">${label}</div><div style="font-weight:600; word-break:break-word;">${escapeHtml(value || "—")}</div></div>`;

  const body = !open ? "" : `
    <div style="margin-top:12px; border-top:1px dashed var(--border); padding-top:12px;">
      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:14px; padding:12px; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius);">
        ${field("Purpose", c.outward_type)}
        ${field("Status", c.returnable_status)}
        ${field("Challan No", c.challan_number)}
        ${field("Tickets", tickets.map(t => t.ticketId).join(", "))}
        ${field(amoConsigneeLabel(c), c.consignee_name)}
        ${field("Contact Name", c.contact_person_name)}
        ${field("Contact Number", c.contact_number)}
        ${field("State", c.consignee_state)}
        <div style="grid-column:span 3;">${field("Address", c.consignee_address)}</div>
        ${field("LR No", c.lr_number)}
        ${field("Transport Name", c.transporter_name)}
        ${field("Freight", c.freight)}
        <div style="grid-column:span 4;">${field("Note", c.challan_remarks)}</div>
      </div>
      <table style="width:100%; border-collapse:collapse; table-layout:fixed; margin-bottom:12px;">
        <colgroup><col style="width:7%"><col style="width:53%"><col style="width:14%"><col style="width:13%"><col style="width:13%"></colgroup>
        <thead><tr><th style="${head}">Sr</th><th style="${head} text-align:left;">Description of Material</th><th style="${head}">HSN Code</th><th style="${head}">Qty</th><th style="${head}">Unit</th></tr></thead>
        <tbody>${items.map((it, i) => `<tr><td style="${cell} text-align:center;">${i + 1}</td><td style="${cell}">${escapeHtml(it.description || "")}</td><td style="${cell} text-align:center;">${escapeHtml(it.hsnCode || "")}</td><td style="${cell} text-align:center; font-weight:700;">${escapeHtml(String(fmtQty(it.quantity ?? 0)))}</td><td style="${cell} text-align:center;">${escapeHtml(it.unit || "")}</td></tr>`).join("")}</tbody>
      </table>
      ${returns.length ? `
      <div style="font-weight:800; color:var(--brand); margin-bottom:6px;">Expected Processing Material Return</div>
      <table style="width:100%; border-collapse:collapse; table-layout:fixed; margin-bottom:12px;">
        <colgroup><col style="width:7%"><col style="width:67%"><col style="width:13%"><col style="width:13%"></colgroup>
        <thead><tr><th style="${head}">Sr</th><th style="${head} text-align:left;">Material</th><th style="${head}">Qty</th><th style="${head}">Unit</th></tr></thead>
        <tbody>${returns.map((r, i) => `<tr><td style="${cell} text-align:center;">${i + 1}</td><td style="${cell}">${escapeHtml(r.materialName || r.itemCode || "")}</td><td style="${cell} text-align:center; font-weight:700;">${escapeHtml(String(fmtQty(r.quantity ?? 0)))}</td><td style="${cell} text-align:center;">${escapeHtml(r.unit || "")}</td></tr>`).join("")}</tbody>
      </table>` : ""}
      ${own ? `<div style="padding:9px 12px; margin-bottom:10px; background:#fffbeb; border-left:4px solid #f59e0b; color:#92400e; border-radius:var(--radius); font-size:0.85rem; font-weight:600;">You prepared this challan, so someone else has to authorize it.</div>` : ""}
      <div id="amo-inline-${id}" style="display:none; margin-bottom:10px; padding:10px; border-left:4px solid #dc2626; background:#fef2f2; color:#b91c1c; border-radius:var(--radius);"></div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="nav-btn-styled" style="background:#dc2626; width:auto;" onclick="amoReject(${id})">Reject</button>
        <button class="nav-btn-styled" id="amo-auth-btn-${id}" style="background:var(--accent); width:auto; ${own ? "opacity:0.5; cursor:not-allowed;" : ""}" ${own ? "disabled" : ""} onclick="amoAuthorize(${id})">Authorize Delivery Challan</button>
      </div>
    </div>`;

  return `
    <div class="contact-summary-card-parent" style="padding:14px;">
      <div onclick="amoToggle(${id})" style="display:flex; justify-content:space-between; align-items:center; gap:10px; cursor:pointer; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span style="font-family:monospace; font-weight:800; background:var(--brand); color:#fff; padding:3px 8px; border-radius:4px;">${escapeHtml(c.challan_number || `Draft #${id}`)}</span>
          <span style="font-weight:700;">${escapeHtml(c.outward_type || "")}</span>
          <span style="color:var(--muted);">${amoConsigneeLabel(c)}:</span> <strong>${escapeHtml(c.consignee_name || "—")}</strong>
        </div>
        <div style="display:flex; align-items:center; gap:12px; font-size:0.82rem; color:var(--muted);">
          ${c.checking_doc_url ? `<a href="${driveLink(c.checking_doc_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:var(--brand); font-weight:700;">📄 Draft #${escapeHtml(String(c.checking_draft_count || ""))} ↗</a>` : ""}
          <span>Prepared by ${escapeHtml(c.created_by_name || "—")}</span>
          <span style="font-weight:700;">${open ? "▾" : "▸"}</span>
        </div>
      </div>
      ${body}
    </div>`;
}

function amoToggle(id) {
  const key = String(id);
  if (window._amoExpanded.has(key)) window._amoExpanded.delete(key);
  else window._amoExpanded.add(key);
  const feed = document.getElementById("amo-feed");
  if (feed) feed.innerHTML = window._amoChallans.map(amoRenderCard).join("");
}

function amoInlineError(id, msg) {
  const el = document.getElementById(`amo-inline-${id}`);
  if (!el) { alert(msg); return; }
  el.style.display = "block";
  el.textContent = msg;
}

function amoShowDone(html) {
  const feed = document.getElementById("amo-feed");
  if (feed) feed.style.display = "none";
  const fb = document.getElementById("amo-feedback-banner");
  if (!fb) return;
  fb.style.cssText = "display:block; background:#f0fdf4; border-left:4px solid var(--accent); color:#15803d; padding:14px; margin-bottom:14px; border-radius:var(--radius);";
  fb.innerHTML = `${html}<div><button class="nav-btn-styled" style="background:var(--accent); margin-top:12px; padding:7px 18px; font-weight:700; width:auto;" onclick="initializeAuthorizeMaterialOutwardWorkspace()">Authorize Another Challan</button></div>`;
}

async function amoAuthorize(id) {
  const c = window._amoChallans.find(x => String(x.challan_id) === String(id));
  if (!c) return;
  showBlockingOverlay("Authorizing Delivery Challan...");
  try {
    const data = await apFetch({ action: "finaliseDeliveryChallan", challanId: id, operatorName: appActiveOperatorIdentityString || "Unknown" });
    hideBlockingOverlay();
    if (!data.success) { amoInlineError(id, data.error || "Authorization failed."); return; }
    amoShowDone(`<div style="font-weight:700;">Delivery Challan ${escapeHtml(data.challanNumber)} authorized.</div>
      ${data.url ? `<div style="margin-top:8px;"><a href="${driveLink(data.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">📄 Open Delivery Challan ↗</a></div>`
                 : `<div style="margin-top:8px;">The PDF is still being generated and will appear in Search Challans shortly.</div>`}`);
  } catch (err) {
    hideBlockingOverlay();
    amoInlineError(id, err.message);
  }
}

async function amoReject(id) {
  const c = window._amoChallans.find(x => String(x.challan_id) === String(id));
  if (!c) return;
  showBlockingOverlay("Rejecting...");
  try {
    const data = await apFetch({ action: "discardDeliveryChallanDraft", challanId: id, operatorName: appActiveOperatorIdentityString || "Unknown" });
    hideBlockingOverlay();
    if (!data.success) { amoInlineError(id, data.error || "Reject failed."); return; }
    amoShowDone(`<div style="font-weight:700;">${escapeHtml(c.challan_number || "Draft #" + id)} rejected. Its tickets are back in Material Outward on Delivery Challan.</div>`);
  } catch (err) {
    hideBlockingOverlay();
    amoInlineError(id, err.message);
  }
}
