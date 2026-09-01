// ═══════════════════════════════════════════════════════
// SEARCH VENDOR COSTING INFORMATION (Purchase dept)
// Split out of the old "Search Vendor Information" toggle that used to
// live inside Search Raw Material Purchase Order — searches by Material
// Name (required), optional Vendor Name, and a compulsory date range
// filtered on each PO's EFFECTIVE date (latest Authorized revision date,
// or creation date if never revised) — see routes/purchase.js:
// searchVendorCostingInformation.
// ═══════════════════════════════════════════════════════

async function initializeSearchVendorCostingInfoPanel() {
  window.svciSelectedItemCode = null;
  window.svciSelectedVendorName = null;
  window.svciResultsCache = [];
  window.svciSortState = { col: null, dir: 'desc' };
  window.svciLastSearchMeta = null;

  const matInput = document.getElementById("svci-material-input");
  const vendInput = document.getElementById("svci-vendor-input");
  const fromInput = document.getElementById("svci-date-from");
  const toInput = document.getElementById("svci-date-to");
  if (matInput) { matInput.value = ""; matInput.style.height = "auto"; }
  if (vendInput) vendInput.value = "";
  if (fromInput) fromInput.value = "";
  if (toInput) toInput.value = "";
  const fb = document.getElementById("svci-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  const lbl = document.getElementById("svci-search-label");
  if (lbl) lbl.style.display = "none";
  const results = document.getElementById("svci-results");
  if (results) results.innerHTML = "";

  loadItemCodeCatalogIntoCache();
  if (!window.svciVendorsCache) {
    try {
      const data = await apFetch({ action: "fetchVendorNamesForCostingSearch" });
      window.svciVendorsCache = data.success ? (data.vendors || []) : [];
    } catch(e) { window.svciVendorsCache = []; }
  }
}

function handleSVCIMaterialInput(query) {
  window.svciSelectedItemCode = null;
  const dd = document.getElementById("svci-material-dd");
  const catalog = window.itemCodeCatalogCache || [];
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.toLowerCase();
  const matches = catalog.filter(it => (it.productName||"").toLowerCase().includes(q) || (it.rating||"").toLowerCase().includes(q) || (it.make||"").toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(it => `
    <div onclick="selectSVCIMaterial('${it.itemCode}', \`${(it.productName||'').replace(/\`/g,"'")}\`, \`${(it.rating||'').replace(/\`/g,"'")}\`)"
      style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:6px;">${it.itemCode}</span>${it.productName}${it.rating ? ` - <span style="color:var(--brand); font-weight:700;">${it.rating}</span>` : ''}
    </div>`).join("");
  dd.style.display = "block";
}

function selectSVCIMaterial(itemCode, productName, rating) {
  window.svciSelectedItemCode = itemCode;
  const inputEl = document.getElementById("svci-material-input");
  inputEl.value = rating ? `${productName} - ${rating}` : productName;
  inputEl.style.height = "auto"; inputEl.style.height = inputEl.scrollHeight + "px";
  document.getElementById("svci-material-dd").style.display = "none";
}

// Vendor Name is optional — leaving it blank means "search all vendors".
// Client-side filter over a one-time fetch (window.svciVendorsCache), same
// "fetch full list once, filter locally" shape as Create PO's own vendor
// data, just typeahead-style here instead of a <select>.
function handleSVCIVendorInput(query) {
  window.svciSelectedVendorName = null;
  const dd = document.getElementById("svci-vendor-dd");
  const vendors = window.svciVendorsCache || [];
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.toLowerCase();
  const matches = vendors.filter(v => (v.vendorName||"").toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(v => `
    <div onclick="selectSVCIVendor('${(v.vendorName||'').replace(/'/g,"\\'")}')"
      style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${v.vendorName}${v.city ? `<span style="color:var(--muted); font-size:0.75rem;"> — ${v.city}${v.state ? ', ' + v.state : ''}</span>` : ''}
    </div>`).join("");
  dd.style.display = "block";
}

function selectSVCIVendor(vendorName) {
  window.svciSelectedVendorName = vendorName;
  document.getElementById("svci-vendor-input").value = vendorName;
  document.getElementById("svci-vendor-dd").style.display = "none";
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#svci-material-input") && !e.target.closest("#svci-material-dd")) {
    const d = document.getElementById("svci-material-dd"); if (d) d.style.display = "none";
  }
  if (!e.target.closest("#svci-vendor-input") && !e.target.closest("#svci-vendor-dd")) {
    const d = document.getElementById("svci-vendor-dd"); if (d) d.style.display = "none";
  }
});

function svciShowFeedback(msg, isError) {
  const fb = document.getElementById("svci-feedback");
  if (!fb) return;
  fb.style.display = "block";
  fb.style.borderLeftColor = isError ? "var(--warn)" : "var(--brand)";
  fb.style.background = isError ? "#fef2f2" : "#eff6ff";
  fb.style.color = isError ? "#b91c1c" : "var(--brand)";
  fb.innerHTML = msg;
}

// e.g. "10 Aug 2026" — distinct from fmtPODate's DD/MM/YYYY table style,
// used only for the "Searching for..." label and the PDF header text.
function svciFmtDisplayDate(isoOrDateStr) {
  if (!isoOrDateStr) return "";
  const dt = new Date(isoOrDateStr);
  if (isNaN(dt.getTime())) return "";
  return `${String(dt.getDate()).padStart(2,'0')} ${dt.toLocaleString('en-US',{month:'short'})} ${dt.getFullYear()}`;
}

async function searchVendorCostingInfoUI() {
  document.getElementById("svci-feedback").style.display = "none";
  if (!window.svciSelectedItemCode) { svciShowFeedback("Select a Material Name from the dropdown list.", true); return; }
  const dateFrom = document.getElementById("svci-date-from").value;
  const dateTo = document.getElementById("svci-date-to").value;
  if (!dateFrom || !dateTo) { svciShowFeedback("Both Date Range From and To are required.", true); return; }
  if (dateFrom > dateTo) { svciShowFeedback("Date Range From cannot be after Date Range To.", true); return; }

  const materialLabel = document.getElementById("svci-material-input").value.trim();
  const vendorLabel = window.svciSelectedVendorName || "All Vendors";
  const dateRangeLabel = `${svciFmtDisplayDate(dateFrom)} to ${svciFmtDisplayDate(dateTo)}`;

  const results = document.getElementById("svci-results");
  results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Searching...</div>`;
  const lbl = document.getElementById("svci-search-label");
  lbl.style.display = "block";
  const esc = (s) => (s || "").toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const val = (s) => `<span style="color:var(--brand);">${esc(s)}</span>`;
  lbl.innerHTML = `<span style="color:#000;">Searching for</span><br><span style="color:#000;">Material:</span> ${val(materialLabel)}<br><span style="color:#000;">Vendor:</span> ${val(vendorLabel)}<br><span style="color:#000;">Date Range:</span> ${val(dateRangeLabel)}`;

  try {
    const data = await apFetch({
      action: "searchVendorCostingInformation",
      itemCode: window.svciSelectedItemCode,
      vendorName: window.svciSelectedVendorName || null,
      dateFrom, dateTo
    });
    if (!data.success) { svciShowFeedback(data.error, true); results.innerHTML = ""; return; }
    window.svciResultsCache = data.results || [];
    // Default sort: most recent Delivery Date first — matches the
    // backend's own default ORDER BY, re-applied here so the active
    // column/arrow in the table header reflects it too.
    window.svciSortState = { col: 'deliveryDate', dir: 'desc' };
    const getVal = SVCI_SORTABLE_COLS.deliveryDate;
    window.svciResultsCache.sort((a, b) => getVal(b) - getVal(a));
    window.svciLastSearchMeta = { materialLabel, vendorLabel, dateRangeLabel };
    renderSVCIResultsTable();
  } catch(e) { svciShowFeedback(e.message, true); results.innerHTML = ""; }
}

// Column-header click-to-sort: first click on a column sorts descending, a
// second click on the SAME column sorts ascending (arrow shown next to the
// active header reflects the current direction). Only Rate/Qty, Order
// Date, and Delivery Date are sortable, per spec.
const SVCI_SORTABLE_COLS = {
  ratePerQty:   (r) => Number(r.ratePerQty) || 0,
  orderDate:    (r) => r.orderDate    ? new Date(r.orderDate).getTime()    : 0,
  deliveryDate: (r) => r.deliveryDate ? new Date(r.deliveryDate).getTime() : 0
};

function sortSVCITable(col) {
  const st = window.svciSortState;
  st.dir = (st.col === col) ? (st.dir === 'desc' ? 'asc' : 'desc') : 'desc';
  st.col = col;
  const getVal = SVCI_SORTABLE_COLS[col];
  const dirMult = st.dir === 'asc' ? 1 : -1;
  window.svciResultsCache = [...window.svciResultsCache].sort((a, b) => (getVal(a) - getVal(b)) * dirMult);
  renderSVCIResultsTable();
}

function svciSortableHeader(col, label) {
  const st = window.svciSortState;
  const active = st.col === col;
  const arrow = active ? (st.dir === 'asc' ? ' ▲' : ' ▼') : "";
  return `<th onclick="sortSVCITable('${col}')" style="padding:8px; font-size:0.7rem; text-align:center; text-transform:uppercase; color:${active ? 'var(--brand)' : 'var(--muted)'}; cursor:pointer; user-select:none; white-space:nowrap;">${label}${arrow}</th>`;
}

function renderSVCIResultsTable() {
  const results = document.getElementById("svci-results");
  const list = window.svciResultsCache || [];
  if (list.length === 0) {
    results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">No matching Authorized Purchase Orders found.</div>`;
    return;
  }
  // PO Number links straight to the PO's own PDF (drive_file_url), through
  // the authenticated proxy the same way every other PO/PRN doc link in
  // this app does — a bare Drive URL 401s (see shared/apFetch.js driveLink).
  const rows = list.map(r => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:8px; font-family:monospace; font-weight:700;">${r.poPdfUrl ? `<a href="${driveLink(r.poPdfUrl)}" target="_blank" style="color:var(--brand); text-decoration:underline;">${r.poNo}</a>` : `<span style="color:var(--brand);">${r.poNo}</span>`}</td>
      <td style="padding:8px; font-weight:600;">${r.vendorName || "—"}</td>
      <td style="padding:8px;">${r.city || "—"}${r.state ? ', ' + r.state : ''}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-size:1rem; font-weight:700;">${fmtQty(r.poQuantity)}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-size:1rem; font-weight:700;">${fmtQty(r.ratePerQty)}</td>
      <td style="padding:8px; text-align:center; white-space:nowrap;">${fmtPODate(r.orderDate) || "—"}</td>
      <td style="padding:8px; text-align:center; white-space:nowrap;">${fmtPODate(r.deliveryDate) || "—"}</td>
    </tr>`).join("");

  results.innerHTML = `
    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
      <table style="width:100%; border-collapse:collapse; min-width:760px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:8px; font-size:0.7rem; text-align:left; text-transform:uppercase; color:var(--muted);">PO No</th>
          <th style="padding:8px; font-size:0.7rem; text-align:left; text-transform:uppercase; color:var(--muted);">Vendor Name</th>
          <th style="padding:8px; font-size:0.7rem; text-align:left; text-transform:uppercase; color:var(--muted);">City, State</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; text-transform:uppercase; color:var(--muted);">PO Quantity</th>
          ${svciSortableHeader('ratePerQty', 'Rate / Qty')}
          ${svciSortableHeader('orderDate', 'Order Date')}
          ${svciSortableHeader('deliveryDate', 'Delivery Date')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="text-align:right; margin-top:14px;">
      <button class="nav-btn-styled" onclick="downloadSVCIPdf(this)" style="background:var(--accent); color:#fff; font-weight:700; padding:9px 22px;">📄 Download Vendor Costing Information</button>
    </div>`;
}

// PDF is built entirely server-side (routes/purchase.js:
// generateVendorCostingInformationPdf) and returned as base64 — this is a
// throwaway report of a search's current result set, not a document tied
// to any PO/BOQ/PRN record, so unlike every other PDF in this app it's
// never persisted to Drive/Cloud Storage; the browser just downloads the
// bytes directly via a Blob, since apFetch is JSON-only and there's no
// existing binary-download flow to reuse.
async function downloadSVCIPdf(btn) {
  const meta = window.svciLastSearchMeta;
  const list = window.svciResultsCache || [];
  if (!meta || list.length === 0) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating PDF...";
  const SVCI_SORT_COL_LABELS = { ratePerQty: "Rate / Qty", orderDate: "Order Date", deliveryDate: "Delivery Date" };
  const st = window.svciSortState || {};
  const sortColumnLabel = SVCI_SORT_COL_LABELS[st.col] || "";
  const sortDirectionLabel = st.dir === 'asc' ? "Ascending" : "Descending";
  try {
    const data = await apFetch({
      action: "generateVendorCostingInformationPdf",
      materialName: meta.materialLabel,
      vendorName: meta.vendorLabel === "All Vendors" ? "" : meta.vendorLabel,
      dateRangeText: meta.dateRangeLabel,
      sortColumnLabel, sortDirectionLabel,
      rows: list
    });
    if (!data.success) { alert("Could not generate PDF: " + data.error); return; }
    const byteChars = atob(data.pdfBase64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const safeName = (s) => (s || "").toString().replace(/[\\/:*?"<>|]/g, "").trim();
    const a = document.createElement("a");
    a.href = url;
    a.download = `Vendor Costing Information for ${safeName(meta.materialLabel)} for ${safeName(meta.vendorLabel)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch(e) {
    alert("Network error generating PDF: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
