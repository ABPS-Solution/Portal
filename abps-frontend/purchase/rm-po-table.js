// Search Raw Material Purchase Order → PO Table view (perm_search_rm_po).
// Backend: fetchRMPOTable / downloadRMPOTableExcel (lib/rmPoTable.js).
let rptRows = [];
let rptView = "table";
let rptSort = { key: "orderDate", dir: -1 };
let rptPeriod = "today";
let rptLastResult = null;
const rptOpenRows = new Set();
const rptSel = { vendor: null, itemCode: null };

const rptEsc = (v) => escapeHtml(v == null ? "" : String(v));
const rptMoney = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const rptAmount = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const rptDash = '<span style="color:#94a3b8;">-</span>';
const rptRowId = (poNo) => "rpt-" + Array.from(String(poNo)).map(c => c.charCodeAt(0).toString(36)).join("");
const RPT_PERIODS = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This Week"], ["month", "This Month"], ["quarter", "This Quarter"], ["year", "This Year"], ["all", "All time"]];

// The old "Search" view was removed; the PO Table is the only view now.
function rptSwitchView() {
  rptView = "table";
  [["rpt-tab-table", "table"], ["rpt-tab-search", "search"]].forEach(([id, v]) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.style.background = rptView === v ? "var(--brand)" : "#e2e8f0";
    b.style.color = rptView === v ? "#fff" : "#334155";
  });
  const root = document.getElementById("rpt-root"), sv = document.getElementById("srchpo-search-view");
  if (sv) sv.style.display = rptView === "search" ? "block" : "none";
  if (root) root.style.display = rptView === "table" ? "block" : "none";
  if (rptView === "table" && root) rptBuild();
}

function rptBuild() {
  const root = document.getElementById("rpt-root");
  rptPeriod = "today";
  rptSort = { key: "orderDate", dir: -1 };
  rptOpenRows.clear();
  rptSel.vendor = rptSel.itemCode = null;
  const box = (label, width, inner) => `<div style="position:relative; flex:1 1 ${width}px; min-width:0;">
      <label class="field-label" style="margin-top:0; color:var(--brand);">${label}</label>${inner}</div>`;
  const inp = (id, ph, handler) => `<input type="text" id="${id}" placeholder="${ph}" autocomplete="off" ${handler ? `oninput="${handler}"` : ""}
      style="width:100%; box-sizing:border-box; padding:9px; border:1.5px solid var(--border); border-radius:var(--radius);">
      <div id="${id}-dd" class="rpt-dd"></div>`;
  root.innerHTML = `
    <style>
      .rpt-dd { display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:240px; overflow-y:auto; z-index:300; box-shadow:0 6px 16px rgba(0,0,0,0.15); }
      .rpt-dd div { padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem; }
      .rpt-dd div:hover { background:var(--highlight-bg); }
      #rpt-table { width:100%; table-layout:fixed; border-collapse:separate; border-spacing:0; font-size:0.84rem; }
      #rpt-table thead th { background:#eef2f7; color:#1e293b; font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.02em;
        padding:9px 6px; vertical-align:middle; white-space:normal; overflow-wrap:anywhere; border-left:1.5px solid var(--border); border-bottom:2px solid #94a3b8; cursor:pointer; user-select:none; }
      #rpt-table td { padding:8px 6px; vertical-align:middle; overflow-wrap:anywhere; word-break:normal; border-left:1.5px solid var(--border); border-bottom:2px solid #94a3b8; }
      #rpt-table .rpt-amt { font-size:0.98rem; font-weight:700; color:#0f172a; }
      #rpt-table .rpt-po-link { font-size:0.95rem; font-weight:800; color:var(--brand); font-family:monospace; text-decoration:underline; }
      @media (max-width:640px) { #rpt-table { min-width:900px; } }
      @media (max-width:900px) { .rpt-pd-row { grid-template-columns:repeat(2, minmax(0, 1fr)) !important; } }
      #rpt-table th:first-child, #rpt-table td:first-child { border-left:none; }
      #rpt-table tbody tr.rpt-row:nth-child(4n+1) td { background:#fff; }
      #rpt-table tbody tr.rpt-row:nth-child(4n+3) td { background:#f8fafc; }
      #rpt-table tbody tr.rpt-row:hover td { background:#eef4ff; }
      #rpt-table tbody tr.rpt-row.rpt-open td { background:#e0ecff; }
      #rpt-table .rpt-exp { width:auto; max-width:100%; white-space:nowrap; padding:4px 6px; font-weight:800; font-size:0.85rem; border:1.5px solid var(--brand); background:#fff; color:var(--brand); border-radius:6px; cursor:pointer; }
      #rpt-table tr.rpt-open .rpt-exp { background:var(--brand); color:#fff; }
      #rpt-table td.rpt-detail-cell { padding:0 14px 14px; background:#f1f5f9; }
      .rpt-badge { display:inline-block; padding:3px 10px; border-radius:999px; font-size:0.74rem; font-weight:800; white-space:nowrap; }
    </style>
    <div id="rpt-feedback" style="display:none;"></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">${RPT_PERIODS.map(([k, label]) =>
      `<button type="button" class="nav-btn-styled rpt-period" data-k="${k}" onclick="rptSetPeriod('${k}')" style="width:auto; padding:7px 16px; font-size:0.85rem; font-weight:700; border-radius:999px;">${label}</button>`).join("")}</div>
    <div style="display:flex; gap:12px; flex-wrap:wrap; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:14px; margin-bottom:12px; align-items:flex-end;">
      ${box("PO Number", 150, inp("rpt-po", "e.g. PO_26-27_00001"))}
      ${box("Vendor Name", 220, inp("rpt-vendor", "Start typing vendor name...", "rptVendorInput(this.value)"))}
      ${box("Material Name", 300, inp("rpt-material", "Start typing material name...", "rptMaterialInput(this.value)"))}
      ${box("Delivery Progress", 160, `<select id="rpt-delivery" style="width:100%; padding:9px; border:1.5px solid var(--border); border-radius:var(--radius);">
        ${["All", "Not received", "Partly received", "Fully received"].map(o => `<option value="${o}">${o}</option>`).join("")}</select>`)}
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="nav-btn-styled" onclick="rptLoad()" style="width:auto; background:var(--accent); color:#fff; padding:9px 20px; font-weight:700;">Search</button>
        <button type="button" class="nav-btn-styled" onclick="rptBuild()" style="width:auto; background:#e2e8f0; color:#334155; padding:9px 20px; font-weight:700;">Reset</button>
        <button type="button" class="nav-btn-styled" id="rpt-xl-btn" onclick="rptDownloadExcel()" style="width:auto; background:#15803d; color:#fff; padding:9px 20px; font-weight:700;">Download Excel</button>
      </div>
    </div>
    <input type="text" id="rpt-text" placeholder="Search PO number, vendor, project ID, material or prepared by..." autocomplete="off" oninput="rptRender()"
      style="width:100%; box-sizing:border-box; padding:10px 12px; border:1.5px solid var(--border); border-radius:var(--radius); margin-bottom:12px; font-size:0.9rem;">
    <div id="rpt-summary"></div>
    <div id="rpt-table-box"></div>`;
  rptPaintPeriod();
  rptLoad();
}

document.addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest("#rpt-root")) return;
  document.querySelectorAll("#rpt-root .rpt-dd").forEach(dd => { if (!dd.parentElement.contains(e.target)) dd.style.display = "none"; });
});

function rptPaintPeriod() {
  document.querySelectorAll("#rpt-root .rpt-period").forEach(b => {
    const on = b.dataset.k === rptPeriod;
    b.style.background = on ? "var(--brand)" : "#e2e8f0";
    b.style.color = on ? "#fff" : "#334155";
  });
}

function rptSetPeriod(k) { rptPeriod = k; rptPaintPeriod(); rptLoad(); }

function rptShowDd(id, html) {
  const dd = document.getElementById(id + "-dd");
  if (!dd) return;
  dd.innerHTML = html;
  dd.style.display = html ? "block" : "none";
}

function rptVendorInput(q) {
  rptSel.vendor = null;
  if (!q.trim()) return rptShowDd("rpt-vendor", "");
  ensureRMPOVendorListCache().then(list => {
    const ql = q.toLowerCase();
    const m = list.filter(v => (v.vendorName || "").toLowerCase().includes(ql)).slice(0, 12);
    rptShowDd("rpt-vendor", m.map(v => `<div onmousedown="event.preventDefault(); rptPick('vendor', ${jsArg(v.vendorName)})">${rptEsc(v.vendorName)}</div>`).join(""));
  });
}

function rptMaterialInput(q) {
  rptSel.itemCode = null;
  if (!q.trim()) return rptShowDd("rpt-material", "");
  const m = materialSearch(window.itemCodeCatalogCache || [], q, 12);
  rptShowDd("rpt-material", m.map(it => {
    const label = [it.productName, it.rating].filter(Boolean).join(" - ");
    return `<div onmousedown="event.preventDefault(); rptPick('material', ${jsArg(it.itemCode)}, ${jsArg(label)})"><span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:6px;">${rptEsc(it.itemCode)}</span>${rptEsc(label)}</div>`;
  }).join(""));
}

function rptPick(kind, value, label) {
  if (kind === "vendor") { rptSel.vendor = value; document.getElementById("rpt-vendor").value = value; }
  if (kind === "material") { rptSel.itemCode = value; document.getElementById("rpt-material").value = label; }
  rptShowDd("rpt-" + kind, "");
}

function rptFeedback(ok, msg) {
  const fb = document.getElementById("rpt-feedback");
  if (!fb) return;
  if (!msg) { fb.style.display = "none"; return; }
  fb.style.cssText = ok
    ? "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:10px 12px; margin-bottom:12px; font-weight:700; border-radius:4px;"
    : "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:10px 12px; margin-bottom:12px; font-weight:700; border-radius:4px;";
  fb.textContent = msg;
}

function rptFilters() {
  const v = (id) => (document.getElementById(id)?.value || "").trim();
  if (v("rpt-material") && !rptSel.itemCode) {
    rptFeedback(false, "Select a Material Name from the dropdown list, or clear the field to search all materials.");
    return null;
  }
  rptFeedback(true, "");
  return {
    textQuery: v("rpt-text") || null,
    period: rptPeriod,
    poNumberQuery: v("rpt-po") || null,
    vendorName: rptSel.vendor || v("rpt-vendor") || null,
    itemCode: rptSel.itemCode || null,
    deliveryState: v("rpt-delivery") || "All",
  };
}

async function rptLoad() {
  const box = document.getElementById("rpt-table-box");
  if (!box) return;
  const f = rptFilters();
  if (!f) return;
  box.innerHTML = `<div style="padding:24px; text-align:center; color:var(--muted);">Loading purchase orders...</div>`;
  try {
    // The text box filters the loaded rows on screen (rptRender), so it is not sent here.
    const d = await apFetch({ action: "fetchRMPOTable", ...f, textQuery: null });
    if (!d.success) throw new Error(d.error || "Could not load purchase orders.");
    rptLastResult = d;
    rptRows = d.rows || [];
    rptRender();
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") box.innerHTML = `<div style="padding:16px; color:#b91c1c; font-weight:700;">${rptEsc(e.message)}</div>`;
  }
}

function rptDeliveryCell(r) {
  if (r.poType === "Transport") return r.status === "Completed" ? '<span class="rpt-badge" style="background:#dcfce7; color:#15803d;">Completed</span>' : rptDash;
  if (!r.deliveryState) return `<span style="font-size:0.78rem; color:#64748b;">${rptEsc(r.status)}</span>`;
  const c = r.deliveryState === "Fully received" ? ["#dcfce7", "#15803d"] : r.deliveryState === "Partly received" ? ["#fef3c7", "#b45309"] : ["#e2e8f0", "#475569"];
  return `<div><span class="rpt-badge" style="background:${c[0]}; color:${c[1]};">${rptEsc(r.deliveryState)}</span>
    <div style="margin-top:5px; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;"><div style="height:100%; width:${r.progressPct || 0}%; background:${c[1]};"></div></div>
    <div style="font-size:0.74rem; color:#64748b; margin-top:2px;">${trimNum(r.progressPct || 0)}%${r.overdueDays > 0 ? ` · <strong style="color:#b91c1c;">${r.overdueDays} day${r.overdueDays === 1 ? "" : "s"} overdue</strong>` : ""}</div></div>`;
}

function rptMaterialLinesHtml(r) {
  const lines = Array.isArray(r.materialLines) ? r.materialLines : r.materialNames.map(name => ({ name, qty: null }));
  if (!lines.length) return rptDash;
  return `<div style="font-size:0.8rem; line-height:1.4;">${lines.map(l => rptEsc(l.name) + (l.qty == null ? ""
    : ` - <strong>Qty: ${fmtQty(l.qty)}${l.unit ? " " + rptEsc(l.unit) : ""}</strong>`)).join("<br>")}</div>`;
}

// Same rule as rmPoTextMatches (lib/rmPoTable.js), used by the Excel download.
function rptTextMatches(r, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  return [r.poNo, r.vendorName, r.preparedBy, ...(r.projectIds || []), ...(r.materialNames || [])]
    .some(v => v != null && String(v).toLowerCase().includes(needle));
}

// [header, sort key, cell, align, width %]
const RPT_COLS = [
  ["PO Number", "poNo", r => `${r.pdfUrl ? `<a class="rpt-po-link" href="${driveLink(r.pdfUrl)}" target="_blank" rel="noopener" title="${r.pdfIsDraft ? "Open draft" : "Open PO document"}">${rptEsc(r.poNo)}</a>`
    : `<span style="font-weight:800; color:var(--brand); font-family:monospace; font-size:0.95rem;">${rptEsc(r.poNo)}</span>`}${r.poType === "Transport" ? '<div><span class="rpt-badge" style="background:#ede9fe; color:#6d28d9; margin-top:4px;">Transport</span></div>' : ""}`, "left", 9],
  ["PO Date", "orderDate", r => r.orderDate ? formatOrdinalDate(r.orderDate) : rptDash, "center", 8],
  ["Vendor Name", "vendorName", r => `<div style="font-weight:600;">${rptEsc(r.vendorName)}</div>`, "left", 12],
  ["Project ID(s)", "projectIds", r => r.projectIds.length ? `<div style="font-size:0.76rem; line-height:1.4;">${r.projectIds.map(rptEsc).join("<br>")}</div>` : rptDash, "left", 11],
  ["Material Names", "materialNames", rptMaterialLinesHtml, "left", 22],
  ["Basic Amount", "basicAmount", r => `<span class="rpt-amt">${rptAmount(r.basicAmount)}</span>`, "center", 7.5],
  ["Total incl. GST", "grandTotal", r => `<span class="rpt-amt">${rptAmount(r.grandTotal)}</span>`, "center", 7.5],
  ["Delivery Progress", "progressPct", rptDeliveryCell, "left", 12],
  ["Prepared By", "preparedBy", r => rptEsc(r.preparedBy || "-"), "left", 6],
];

function rptSortBy(key) {
  rptSort = rptSort.key === key ? { key, dir: -rptSort.dir } : { key, dir: key === "orderDate" ? -1 : 1 };
  rptRender();
}

function rptSorted() {
  const { key, dir } = rptSort;
  const val = (r) => { const v = r[key]; return Array.isArray(v) ? v.join(",") : v; };
  return rptRows.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    const xe = x == null || x === "", ye = y == null || y === "";
    if (xe || ye) return xe && ye ? 0 : xe ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c * dir || String(b.poNo).localeCompare(String(a.poNo));
  });
}

function rptRender() {
  const box = document.getElementById("rpt-table-box");
  const sum = document.getElementById("rpt-summary");
  if (!box) return;
  const d = rptLastResult || {};
  const text = document.getElementById("rpt-text")?.value || "";
  const visible = rptSorted().filter(r => rptTextMatches(r, text));
  const s = {
    count: visible.length,
    totalValue: visible.reduce((a, r) => a + (Number(r.grandTotal) || 0), 0),
    pendingValue: visible.reduce((a, r) => a + (Number(r.pendingValue) || 0), 0),
    overdueCount: visible.filter(r => r.overdueDays > 0).length,
  };
  const tile = (label, value, color) => `<div style="background:#fff; border:2px solid #94a3b8; border-top:4px solid ${color}; border-radius:8px; padding:9px 12px; min-width:0;">
      <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; color:#64748b;">${label}</div>
      <div style="font-size:1.2rem; font-weight:800; color:#0f172a; margin-top:3px;">${value}</div></div>`;
  sum.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin-bottom:10px;">
      ${tile("Purchase Orders", trimNum(s.count), "var(--brand)")}${tile("Total Value (incl. GST)", rptMoney(s.totalValue), "var(--brand)")}
      ${tile("Pending Value", rptMoney(s.pendingValue), "#b45309")}${tile("Overdue POs", trimNum(s.overdueCount), s.overdueCount ? "#b91c1c" : "#94a3b8")}</div>
    ${d.capped ? `<div style="background:#fffbeb; border-left:4px solid #d97706; color:#92400e; padding:9px 12px; border-radius:4px; font-size:0.85rem; margin-bottom:10px;">Showing the newest ${trimNum(d.cap)} purchase orders only. Pick a shorter period or narrow the filters to see the rest.</div>` : ""}`;
  if (!visible.length) {
    box.innerHTML = `<div style="text-align:center; padding:28px; color:var(--muted); background:#fff; border:2px solid #94a3b8; border-radius:var(--radius);">No purchase orders match.</div>`;
    return;
  }
  const n = RPT_COLS.length + 1;
  const arrow = (k) => rptSort.key === k ? (rptSort.dir < 0 ? " ▼" : " ▲") : "";
  enableTableCrosshair(box);
  box.innerHTML = `
    <div class="rpt-scroll" style="overflow-x:auto; border:2px solid #94a3b8; border-radius:var(--radius); background:#fff;">
      <table id="rpt-table">
        <colgroup><col style="width:5%;">${RPT_COLS.map(c => `<col style="width:${c[4]}%;">`).join("")}</colgroup>
        <thead><tr><th style="text-align:center; cursor:default;">Sr No</th>${RPT_COLS.map(([h, k, , al]) =>
          `<th onclick="rptSortBy('${k}')" style="text-align:${k === "progressPct" ? "center" : al};">${h}${arrow(k)}</th>`).join("")}</tr></thead>
        <tbody>${visible.map((r, i) => { const id = rptRowId(r.poNo); const open = rptOpenRows.has(r.poNo); return `
          <tr class="rpt-row${open ? " rpt-open" : ""}" id="${id}-row">
            <td style="text-align:center;"><button type="button" class="rpt-exp" title="Open / close PO details" onclick="rptToggleRow(${jsArg(r.poNo)})">${i + 1} ${open ? "▴" : "▾"}</button></td>
            ${RPT_COLS.map(([, , fn, al]) => `<td style="text-align:${al};">${fn(r)}</td>`).join("")}
          </tr>
          <tr id="${id}-detail" style="display:${open ? "table-row" : "none"};"><td colspan="${n}" class="rpt-detail-cell"><div id="${id}-box">${open ? rptDetailHtml(r) : ""}</div></td></tr>`; }).join("")}</tbody>
      </table>
    </div>`;
  rptOpenRows.forEach(po => { const b = document.getElementById(rptRowId(po) + "-box"); if (b) rptFitDetail(b); });
}

// Keep an open PO's details inside the visible width of the scrolling table.
function rptFitDetail(b) {
  const wrap = b.closest(".rpt-scroll");
  if (!wrap) return;
  b.style.position = "sticky"; b.style.left = "14px";
  b.style.width = Math.max(280, wrap.clientWidth - 30) + "px";
}
window.addEventListener("resize", () => document.querySelectorAll("#rpt-table .rpt-detail-cell > div").forEach(rptFitDetail));

function rptToggleRow(poNo) {
  const id = rptRowId(poNo);
  const det = document.getElementById(id + "-detail"), row = document.getElementById(id + "-row"), b = document.getElementById(id + "-box");
  const btn = row && row.querySelector(".rpt-exp");
  if (rptOpenRows.has(poNo)) {
    rptOpenRows.delete(poNo);
    if (det) det.style.display = "none";
    if (row) row.classList.remove("rpt-open");
    if (btn) btn.textContent = btn.textContent.replace("▴", "▾");
    return;
  }
  rptOpenRows.add(poNo);
  const r = rptRows.find(x => x.poNo === poNo);
  if (b && r) { b.innerHTML = rptDetailHtml(r); rptFitDetail(b); }
  if (det) det.style.display = "table-row";
  if (row) row.classList.add("rpt-open");
  if (btn) btn.textContent = btn.textContent.replace("▾", "▴");
}

function rptDetailHtml(r) {
  const h = r.header || {};
  // Same border weights as PPS Tracking (purchase/pps-tracking.js).
  const B = "2px solid #94a3b8";
  const CELL_B = "border-left:1.5px solid var(--border); border-bottom:2px solid #94a3b8;";
  const cell = (label, val, raw) => `<div style="padding:9px 12px; ${CELL_B} min-width:0;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#64748b; letter-spacing:0.3px;">${label}</div>
      <div style="font-weight:600; color:#0f172a; margin-top:2px; overflow-wrap:anywhere; white-space:pre-line;">${val ? (raw ? val : rptEsc(val)) : '<span style="color:#94a3b8;">-</span>'}</div></div>`;
  const pdRow = (cols, cells) => `<div class="rpt-pd-row" style="display:grid; grid-template-columns:${cols}; margin-left:-1.5px;">${cells}</div>`;
  const pdf = r.pdfUrl ? `<a href="${driveLink(r.pdfUrl)}" target="_blank" rel="noopener" style="font-weight:700;">${r.pdfIsDraft ? "View Draft" : "View PO"} ↗</a>` : "";
  const header = `<div style="border:${B}; border-bottom:none; border-radius:var(--radius); background:#fff; overflow:hidden;">
      ${pdRow("repeat(7, minmax(0, 1fr))", cell("PO Type", r.poType) + cell("Vendor GSTIN", h.vendorGstin)
        + cell("Vendor Contact Name", h.vendorContact) + cell("Vendor Contact Number", h.vendorPhone) + cell("Vendor Contact Email", h.vendorEmail)
        + cell("Vendor City / State", [h.vendorCity, h.vendorState].filter(Boolean).join(", "))
        + cell("Trade Type", h.tradeType === "Import" ? `Import${h.usdRate ? " (USD rate " + trimNum(Number(h.usdRate)) + ")" : ""}` : h.tradeType))}
      ${pdRow("minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr)", cell("Supplier Ref / Offer No", h.supplierRef)
        + cell("Delivery Date (on PO)", h.deliveryDate ? formatOrdinalDate(h.deliveryDate) : "") + cell("PO Document", pdf, true) + cell("Notes", h.notes))}
      ${pdRow("repeat(4, minmax(0, 1fr))", cell("Payment Terms", h.paymentTerms) + cell("Freight Terms", h.freightTerms)
        + cell("Warranty", h.warranty) + cell("Insurance", h.insurance))}</div>`;
  const th = (t, al) => `<th style="padding:8px 6px; text-align:${al || "center"}; vertical-align:middle; background:var(--highlight-bg); font-weight:800; overflow-wrap:anywhere; ${CELL_B}">${t}</th>`;
  const td = (x, al) => `<td style="padding:8px 6px; text-align:${al || "center"}; vertical-align:top; overflow-wrap:anywhere; ${CELL_B}">${x}</td>`;
  const cols = (ws) => `<colgroup>${ws.map(w => `<col style="width:${w}%;">`).join("")}</colgroup>`;
  const poText = (l) => (r.poType === "Transport" ? (l.additionalDescription || l.materialName) : (l.materialName || l.additionalDescription)) || "";
  let table;
  if (r.poType === "Transport") {
    table = `<table style="width:100%; table-layout:fixed; border-collapse:collapse; font-size:0.85rem; min-width:560px; background:#fff;">${cols([46, 22, 12, 7, 13])}<thead><tr>${th("Description", "left")}${th("Projects", "left")}${th("Rate")}${th("Discount %")}${th("Amount")}</tr></thead>
      <tbody>${r.lines.map(l => `<tr>${td(rptEsc(poText(l)), "left")}${td(l.projectIds.map(rptEsc).join("<br>") || "-", "left")}${td(rptMoney(l.rate))}${td(l.discountPercent ? trimNum(l.discountPercent) : "-")}${td(`<strong>${rptMoney(l.amount)}</strong>`)}</tr>`).join("")}</tbody></table>`;
  } else {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const sched = (l) => l.schedule.length ? l.schedule.map(s => {
      const late = s.status !== "Received" && s.plannedDate && s.plannedDate < today;
      return `<div${late ? ' style="color:#b91c1c; font-weight:700;"' : ""}>${formatOrdinalDate(s.plannedDate)}: ${fmtQty(s.plannedQty)} <span style="font-size:0.74rem; color:#64748b;">(${rptEsc(s.status)})</span></div>`;
    }).join("") : '<span style="color:#94a3b8;">Not scheduled</span>';
    table = `<table style="width:100%; table-layout:fixed; border-collapse:collapse; font-size:0.85rem; min-width:760px; background:#fff;">${cols([37, 6, 7, 7, 7, 8, 5, 9, 14])}<thead><tr>${th("Material Name", "left")}${th("Unit")}${th("Ordered")}${th("Received")}${th("Still Due")}${th("Rate")}${th("Disc. %")}${th("Amount")}${th("Delivery Schedule", "left")}</tr></thead>
      <tbody>${r.lines.map(l => `<tr>${td(`<div style="font-weight:700;">${rptEsc(poText(l))}</div>`, "left")}
        ${td(rptEsc(l.unit || "-"))}${td(fmtQty(l.orderedQty))}${td(l.tracked ? `<strong style="color:#15803d;">${fmtQty(l.receivedQty)}</strong>` : "-")}
        ${td(l.tracked ? (l.stillDueQty > 0 ? `<strong style="color:#b45309;">${fmtQty(l.stillDueQty)}</strong>` : "0") : "-")}
        ${td(rptMoney(l.rate))}${td(l.discountPercent ? trimNum(l.discountPercent) : "-")}${td(`<strong>${rptMoney(l.amount)}</strong>`)}${td(sched(l), "left")}</tr>`).join("")}</tbody></table>`;
  }
  return `<div style="margin-top:14px; background:#f8fafc; border:${B}; border-radius:var(--radius); overflow:hidden;">
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center; padding:12px 16px; background:#fff; border-bottom:${B};">
        <div style="font-size:1.15rem; font-weight:800; color:var(--brand);">${rptEsc(r.poNo)} <span style="font-weight:600; color:#334155;">· ${rptEsc(r.vendorName)}</span></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          ${r.poType === "Transport" && r.status === "Authorized" ? `<button type="button" class="nav-btn-styled" style="width:auto; background:#15803d; color:#fff; padding:7px 16px; font-weight:700; font-size:0.85rem;" onclick="rptMarkTransportCompleted(${jsArg(r.poNo)}, this)">Mark Completed</button>` : ""}
          <button type="button" class="nav-btn-styled" style="width:auto; background:#718096; padding:7px 16px; font-weight:700; font-size:0.85rem;" onclick="rptToggleRow(${jsArg(r.poNo)})">Close</button>
        </div>
      </div>
      <div style="padding:14px 16px 18px;">
        <div class="sec-label" style="margin:0 0 8px;">PO Details</div>${header}
        <div class="sec-label" style="margin:16px 0 8px;">${r.poType === "Transport" ? "Rows" : "Materials"}</div>
        <div style="overflow-x:auto; border:${B}; border-radius:var(--radius);">${r.lines.length ? table : '<div style="padding:14px; text-align:center; color:var(--muted);">No lines.</div>'}</div>
      </div></div>`;
}

// Uses the same confirmation + route as the old Search view (markTransportPOCompleted in purchase/po.js).
async function rptMarkTransportCompleted(poNo, btn) {
  await markTransportPOCompleted(poNo, btn);
  if (btn.isConnected) return;
  const r = rptRows.find(x => x.poNo === poNo);
  if (r) r.status = "Completed";
  rptRender();
}

async function rptDownloadExcel() {
  const f = rptFilters();
  if (!f) return;
  const btn = document.getElementById("rpt-xl-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }
  try {
    const d = await apFetch({ action: "downloadRMPOTableExcel", ...f });
    if (!d.success) throw new Error(d.error || "Could not build the Excel file.");
    const link = document.createElement("a");
    link.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + d.base64;
    link.download = d.fileName || "RM_PO_Table.xlsx";
    document.body.appendChild(link); link.click(); link.remove();
    if (d.capped) rptFeedback(false, "The Excel file has the newest purchase orders only. Pick a shorter period or narrow the filters to include the rest.");
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") rptFeedback(false, e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Download Excel"; }
  }
}
