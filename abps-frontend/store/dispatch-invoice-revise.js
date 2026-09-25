// ═══════════════════════════════════════════════════════════════════════
// store/dispatch-invoice-revise.js — Revise Project Dispatch Invoice
// (migration 209, 19 Sep 2026). Two tabs: Select Invoice (start a new
// revision request against an already-authorized invoice) and Pending
// Revisions (Editing) (edit/reprint your own pending requests). Same
// draft loop as Create — the live invoice is untouched until
// the revision request is authorized elsewhere.
// ═══════════════════════════════════════════════════════════════════════

let rpdiProjectCodes = [];
let rpdiProjectMeta = {};
let rpdiLoaded = false;
let rpdiState = null;
let rpdiCache = { invoiceId: null, projectId: "", invoiceType: "", invoiceRevision: 0 };

function switchRevisePdiTab(tab) {
  const isSelect = tab === 'select';
  const tabsBar = document.getElementById("rpdi-tab-select")?.parentElement;
  if (tabsBar) tabsBar.style.display = "flex";
  document.getElementById("rpdi-select-section").style.display = isSelect ? "" : "none";
  document.getElementById("rpdi-editing-section").style.display = isSelect ? "none" : "";
  const on = (id) => { const el = document.getElementById(id); if (el) { el.style.background = "var(--accent)"; el.style.color = "#fff"; } };
  const off = (id) => { const el = document.getElementById(id); if (el) { el.style.background = "#e2e8f0"; el.style.color = "var(--text)"; } };
  if (isSelect) { on("rpdi-tab-select"); off("rpdi-tab-editing"); initializeRpdiWorkspace(); }
  else { off("rpdi-tab-select"); on("rpdi-tab-editing"); initializeRpdiEditingTab(); }
}

async function ensureRpdiProjectData(forceRefresh = false) {
  if (rpdiLoaded && !forceRefresh) return;
  try {
    const data = await apFetch({ action: "fetchInvoicedProjectsForRevise" });
    rpdiProjectCodes = (data.projects || []).map(p => p.projectId);
    rpdiProjectMeta = {};
    (data.projects || []).forEach(p => { rpdiProjectMeta[p.projectId] = { companyName: p.companyName }; });
    rpdiLoaded = true;
  } catch(e) {
    rpdiProjectCodes = []; rpdiProjectMeta = {};
  }
}

async function initializeRpdiWorkspace() {
  document.getElementById("rpdi-ta-input").value = "";
  document.getElementById("rpdi-ta-dropdown").style.display = "none";
  document.getElementById("rpdi-detail-zone").style.display = "none";
  document.getElementById("rpdi-history-zone").innerHTML = "";
  document.getElementById("rpdi-invoice-form-zone").innerHTML = "";
  document.getElementById("rpdi-generate-btn-wrap").style.display = "none";
  document.getElementById("rpdi-success-zone").style.display = "none";
  document.getElementById("rpdi-select-zone").style.display = "block";
  rpdiState = null;
  rpdiCache = { invoiceId: null, projectId: "", invoiceType: "", invoiceRevision: 0 };
  await ensureRpdiProjectData(true);
}

async function handleRpdiTypeaheadInput(query) {
  await ensureRpdiProjectData();
  const dd = document.getElementById("rpdi-ta-dropdown");
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const matches = rpdiProjectCodes.filter(p => {
    const companyName = (rpdiProjectMeta[p] && rpdiProjectMeta[p].companyName) || "";
    return p.toLowerCase().includes(q) || companyName.toLowerCase().includes(q);
  }).slice(0, 10);
  if (matches.length === 0) {
    dd.innerHTML = `<div style="padding:8px 10px; font-size:0.87rem; color:var(--muted);">No authorized invoiced projects match.</div>`;
    dd.style.display = "block";
    return;
  }
  dd.innerHTML = matches.map(p => {
    const companyName = (rpdiProjectMeta[p] && rpdiProjectMeta[p].companyName) || "";
    return `<div onmousedown="event.preventDefault();" onclick="selectRpdiProject('${p.replace(/'/g,"\\'")}')"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.88rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;">${p}</span>${companyName ? ` <span style="color:var(--muted);">— ${companyName}</span>` : ''}
    </div>`;
  }).join("");
  dd.style.display = "block";
}

function selectRpdiProject(projectId) {
  document.getElementById("rpdi-ta-input").value = projectId;
  document.getElementById("rpdi-ta-dropdown").style.display = "none";
  loadRpdiHistory(projectId);
}

async function loadRpdiHistory(projectId) {
  const detailZone = document.getElementById("rpdi-detail-zone");
  const historyZone = document.getElementById("rpdi-history-zone");
  const zone = document.getElementById("rpdi-invoice-form-zone");
  detailZone.style.display = "block";
  zone.innerHTML = "";
  document.getElementById("rpdi-generate-btn-wrap").style.display = "none";
  historyZone.innerHTML = `<div style="text-align:center; padding:14px; color:var(--muted); font-size:0.9rem;">Loading invoice history...</div>`;
  try {
    const data = await apFetch({ action: "fetchProjectInvoiceHistory", projectId });
    if (!data.success || !(data.invoices || []).length) {
      historyZone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.9rem;">${data.error || "No authorized invoices found for this project."}</div>`;
      return;
    }
    historyZone.innerHTML = `
      <div style="font-weight:700; color:var(--brand); margin-bottom:8px; font-size:0.9rem;">Invoice History — ${projectId}</div>
      <table style="width:100%; border-collapse:collapse; table-layout:fixed; font-size:0.88rem; margin-bottom:6px;">
        <colgroup><col style="width:13%;" /><col style="width:23%;" /><col style="width:8%;" /><col style="width:13%;" /><col style="width:13%;" /><col style="width:30%;" /></colgroup>
        <thead><tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:6px;">Type</th><th style="padding:6px;">Invoice No.</th><th style="padding:6px;">Rev</th><th style="padding:6px;">PDF</th><th style="padding:6px;">Docs</th><th style="padding:6px; text-align:right;"></th>
        </tr></thead>
        <tbody>
          ${data.invoices.map(inv => `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:6px; font-weight:700; word-wrap:break-word;">${inv.invoiceType}</td>
            <td style="padding:6px; word-wrap:break-word;">${inv.invoiceNo}</td>
            <td style="padding:6px;">V${inv.revision}</td>
            <td style="padding:6px;">${inv.pdfUrl ? `<a href="${driveLink(inv.pdfUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open ↗</a>` : '—'}</td>
            <td style="padding:6px;"><button class="nav-btn-styled" style="background:var(--muted); padding:3px 10px; font-size:0.78rem;" onclick="toggleRpdiDocuments(${inv.invoiceId})">View</button></td>
            <td style="padding:6px; text-align:right;">${inv.pendingRevisionRequestId
              ? `<span style="color:#b45309; font-weight:600; font-size:0.8rem;">Revision pending (#${inv.pendingRevisionRequestId})</span>`
              : `<button class="nav-btn-styled" style="background:var(--accent); padding:5px 12px; font-size:0.85rem;" onclick="loadRpdiForm(${inv.invoiceId})">Revise</button>`}</td>
          </tr>
          <tr id="rpdi-docs-row-${inv.invoiceId}" style="display:none;">
            <td colspan="6" style="padding:4px 6px 10px 6px;"><div id="rpdi-docs-zone-${inv.invoiceId}" style="font-size:0.82rem; color:var(--muted);"></div></td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  } catch(e) {
    historyZone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.9rem;">Network error: ${e.message}</div>`;
  }
}

async function toggleRpdiDocuments(invoiceId) {
  const row = document.getElementById(`rpdi-docs-row-${invoiceId}`);
  const zone = document.getElementById(`rpdi-docs-zone-${invoiceId}`);
  if (!row || !zone) return;
  if (row.style.display === "table-row") { row.style.display = "none"; return; }
  row.style.display = "table-row";
  zone.innerHTML = "Loading documents...";
  try {
    const data = await apFetch({ action: "fetchProjectInvoiceDocuments", invoiceId });
    if (!data.success) { zone.innerHTML = `<span style="color:#b91c1c;">${data.error || "Failed to load documents."}</span>`; return; }
    if (!(data.documents || []).length) { zone.innerHTML = "No documents attached to this invoice."; return; }
    zone.innerHTML = data.documents.map(d =>
      `<div style="margin-bottom:2px;">${d.docLabel}${d.fileName ? ` — ${d.fileName}` : ""}: <a href="${driveLink(d.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open ↗</a></div>`
    ).join("");
  } catch(e) {
    zone.innerHTML = `<span style="color:#b91c1c;">Network error: ${e.message}</span>`;
  }
}

async function loadRpdiForm(invoiceId) {
  const zone = document.getElementById("rpdi-invoice-form-zone");
  zone.innerHTML = `<div style="text-align:center; padding:14px; color:var(--muted); font-size:0.9rem;">Loading current invoice details...</div>`;
  try {
    const data = await apFetch({ action: "fetchProjectInvoiceRevisionPrefillById", invoiceId });
    if (!data.success) { zone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.9rem;">${data.error || "Failed to load."}</div>`; return; }
    rpdiCache = { invoiceId: data.invoiceId, projectId: data.projectId, invoiceType: data.invoiceType, invoiceRevision: data.revision || 0 };
    const last = data.lastInvoiceDetails || {};
    rpdiState = {
      insuranceNo: last.insuranceNo || "", mdccNo: last.mdccNo || "", transportName: last.transportName || "",
      lrNoDate: last.lrNoDate || "", lcNoDate: last.lcNoDate || "", dcNoDate: last.dcNoDate || "", vehicleNo: last.vehicleNo || "",
      mobileNo: last.mobileNo || "", freightText: last.freightText || "", incoterms: last.incoterms || "", incotermsPlace: last.incotermsPlace || "",
      tradeType: last.tradeType || "Local", usdRate: last.usdRate || "",
      poNumber: data.poNumber || "", poDate: data.poDate || "",
      billTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "", ...(last.billTo || {}) },
      shipTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "", ...(last.shipTo || {}) },
      lineItems: (data.lineItems || []).map(li => ({ ...li })),
      igstPercent: last.igstPercent || "18", cgstPercent: last.cgstPercent || "", sgstPercent: last.sgstPercent || "", roundOff: last.roundOff || "0",
      freightAmount: last.freightAmount || "0", othersAmount: last.othersAmount || "0",
      bankAccountKey: (PDI_BANK_OPTIONS.find(o => o.ac === (last.bankDetails || {}).ac) || PDI_BANK_OPTIONS[0]).key,
      bankDetails: { beneficiary: "ABPS SOLUTION PRIVATE LIMITED", swift: "", ...PDI_STANDARD_BANK_DETAILS, ...(last.bankDetails || {}) },
      declaration: last.declaration || PDI_STANDARD_DECLARATION,
    };
    renderRpdiForm();
    document.getElementById("rpdi-generate-btn-wrap").style.display = "block";
  } catch(e) {
    zone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.9rem;">Network error: ${e.message}</div>`;
  }
}

function renderRpdiForm() {
  const zone = document.getElementById("rpdi-invoice-form-zone");
  const s = rpdiState;
  const esc = (v) => (v == null ? '' : v.toString()).replace(/"/g, '&quot;');
  const field = (label, key, path) => {
    const val = path ? (s[path[0]][path[1]] || '') : (s[key] || '');
    const setter = path ? `updateRpdiNested('${path[0]}','${path[1]}', this.value)` : `updateRpdiField('${key}', this.value)`;
    return `<div class="grid-cell-item"><label>${label}</label><textarea rows="1" oninput="${setter}; pdiAutoGrowField(this);" onfocus="pdiAutoGrowField(this);" style="width:100%; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(val)}</textarea></div>`;
  };

  zone.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-top:16px;">
      <div style="font-weight:800; color:var(--brand); margin-bottom:4px; font-size:1rem;">${rpdiCache.invoiceType} Invoice ${rpdiCache.invoiceId} — proposed Revision V${(rpdiCache.invoiceRevision || 0) + 1}</div>
      <div style="font-size:0.87rem; color:var(--muted); margin-bottom:14px;">Prefilled from this invoice's current values. Edit anything, then submit — this creates a REVISION REQUEST for authorization; the live invoice is untouched until then. Invoice number never changes.</div>

      <div style="display:flex; gap:14px; align-items:flex-end; margin-bottom:14px; flex-wrap:wrap;">
        <div class="grid-cell-item" style="max-width:200px; margin:0;">
          <label>Local / Export</label>
          <select onchange="updateRpdiTradeType(this.value)" style="width:100%; padding:6px 4px;">
            <option value="Local" ${s.tradeType !== 'Export' ? 'selected' : ''}>Local</option>
            <option value="Export" ${s.tradeType === 'Export' ? 'selected' : ''}>Export</option>
          </select>
        </div>
        ${s.tradeType === 'Export' ? `
        <div class="grid-cell-item" style="max-width:220px; margin:0;">
          <label>INR to USD Rate</label>
          <input type="number" min="0" step="0.01" placeholder="e.g. 95.3" value="${esc(s.usdRate)}"
            oninput="updateRpdiField('usdRate', this.value); recalcPdiTotals(rpdiState,'rpdi');" style="width:100%; padding:6px 4px;" />
        </div>` : ''}
      </div>

      <div class="compact-fields-grid" style="margin-bottom:14px;">
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>P.O. No.</label><div style="padding:6px 4px; font-weight:600;">${s.poNumber || '—'}</div></div>
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>PO Date</label><div style="padding:6px 4px; font-weight:600;">${s.poDate || '—'}</div></div>
        ${field('Insurance No.', 'insuranceNo')}
        ${field('MDCC NO', 'mdccNo')}
        ${field('Transport Name', 'transportName')}
        ${field('LR No & Date', 'lrNoDate')}
        ${field('LC No & Date', 'lcNoDate')}
        ${field('DC No & Date', 'dcNoDate')}
        ${field('Vehicle No.', 'vehicleNo')}
        ${field('Mobile No', 'mobileNo')}
        ${field('Freight', 'freightText')}
        ${field('Incoterms', 'incoterms')}
        <div class="grid-cell-item"><label>Named Place</label>
          <input type="text" placeholder="e.g. Mumbai Port" value="${esc(s.incotermsPlace)}" oninput="updateRpdiField('incotermsPlace', this.value)" style="width:100%; padding:6px 4px;" />
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:#fff;">
          <div style="font-weight:700; color:var(--brand); margin-bottom:8px; font-size:0.88rem;">BILL TO PARTY</div>
          ${field('Name', null, ['billTo','name'])}
          ${field('Address', null, ['billTo','address'])}
          ${field('State', null, ['billTo','state'])}
          <div class="grid-cell-item"><label>GST No.</label><textarea rows="1" oninput="pdiAutoSetGstFromBillToGst(rpdiState, this.value, 'rpdi', () => recalcPdiTotals(rpdiState,'rpdi')); pdiAutoGrowField(this);" onfocus="pdiAutoGrowField(this);" style="width:100%; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(s.billTo.gstNo || '')}</textarea></div>
          ${field('Contact Name', null, ['billTo','contactName'])}
          ${field('Contact No.', null, ['billTo','contactNo'])}
        </div>
        <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:#fff;">
          <div style="font-weight:700; color:var(--brand); margin-bottom:8px; font-size:0.88rem;">SHIP TO PARTY</div>
          ${field('Name', null, ['shipTo','name'])}
          ${field('Address', null, ['shipTo','address'])}
          ${field('State', null, ['shipTo','state'])}
          ${field('GST No.', null, ['shipTo','gstNo'])}
          ${field('Contact Name', null, ['shipTo','contactName'])}
          ${field('Contact No.', null, ['shipTo','contactNo'])}
        </div>
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.9rem;">Product Details</div>
      <div id="rpdi-lineitems-wrap" style="overflow-x:auto;"></div>

      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <div style="width:300px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Sub Total</span>
            <strong id="rpdi-subtotal-display">₹0</strong>
          </div>
          ${s.tradeType === 'Export' ? `
          <div style="font-size:0.78rem; color:var(--muted); padding:2px 2px;">No GST for Export invoices.</div>
          ` : `
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">CGST %</span>
            <input id="rpdi-cgst-input" type="number" min="0" placeholder="0" value="${esc(s.cgstPercent)}" oninput="updateRpdiField('cgstPercent', this.value); recalcPdiTotals(rpdiState,'rpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">SGST %</span>
            <input id="rpdi-sgst-input" type="number" min="0" placeholder="0" value="${esc(s.sgstPercent)}" oninput="updateRpdiField('sgstPercent', this.value); recalcPdiTotals(rpdiState,'rpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">IGST %</span>
            <input id="rpdi-igst-input" type="number" min="0" value="${esc(s.igstPercent)}" oninput="updateRpdiField('igstPercent', this.value); recalcPdiTotals(rpdiState,'rpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>`}
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Freight <span style="text-transform:none; font-weight:500;">(incl. GST)</span></span>
            <input id="rpdi-freight-input" type="number" min="0" placeholder="0" value="${esc(s.freightAmount)}" oninput="updateRpdiField('freightAmount', this.value); recalcPdiTotals(rpdiState,'rpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Others <span style="text-transform:none; font-weight:500;">(incl. GST)</span></span>
            <input id="rpdi-others-input" type="number" min="0" placeholder="0" value="${esc(s.othersAmount)}" oninput="updateRpdiField('othersAmount', this.value); recalcPdiTotals(rpdiState,'rpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Round Off</span>
            <input type="number" value="${esc(s.roundOff)}" data-allow-negative="true" oninput="updateRpdiField('roundOff', this.value); recalcPdiTotals(rpdiState,'rpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f0fdf4; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:#15803d; text-transform:uppercase;">Grand Total</span>
            <strong id="rpdi-grandtotal-display" style="color:#15803d;">₹0</strong>
          </div>
        </div>
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.9rem;">Bank Details</div>
      <div class="grid-cell-item" style="max-width:320px; margin-bottom:10px;">
        <label>Bank Account</label>
        <select onchange="selectRpdiBankOption(this.value)" style="width:100%; padding:6px 4px;">
          ${PDI_BANK_OPTIONS.map(o => `<option value="${o.key}" ${s.bankAccountKey === o.key ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
      <div class="compact-fields-grid">
        ${field('Beneficiary', null, ['bankDetails','beneficiary'])}
        ${field('Bank Name', null, ['bankDetails','bankName'])}
        ${s.tradeType === 'Export'
          ? field('Swift Code', null, ['bankDetails','swift'])
          : field('IFSC Code For RTGS/NEFT', null, ['bankDetails','ifsc'])}
        ${field('A/C', null, ['bankDetails','ac'])}
        ${field('Address', null, ['bankDetails','address'])}
        ${field('Branch Name & Code', null, ['bankDetails','branch'])}
      </div>

      <div style="margin-top:14px;">
        <label class="field-label" style="margin-top:0; font-size:0.76rem;">Declaration</label>
        <textarea rows="4" style="width:100%; padding:8px; font-size:0.85rem; border:1.5px solid var(--border); border-radius:var(--radius);" oninput="updateRpdiField('declaration', this.value)">${s.declaration}</textarea>
      </div>

      <div style="margin-top:14px; font-size:0.87rem; color:var(--muted);">Total Invoice Amount in Words: <strong id="rpdi-words-display" style="color:var(--text);">—</strong></div>
    </div>
  `;
  renderRpdiLineItemsTable();
  recalcPdiTotals(rpdiState, 'rpdi');
  zone.querySelectorAll('.grid-cell-item textarea').forEach(pdiAutoGrowField);
}

function renderRpdiLineItemsTable() {
  renderPdiLineItemsTable('rpdi-lineitems-wrap', rpdiState.lineItems, 'rpdi', 'updateRpdiLineItem', null, null);
}
function updateRpdiField(key, value) { rpdiState[key] = value; }
function updateRpdiNested(parentKey, childKey, value) { rpdiState[parentKey][childKey] = value; }
function updateRpdiTradeType(value) { updatePdiTradeType(rpdiState, value); renderRpdiForm(); }
function selectRpdiBankOption(key) {
  rpdiState.bankAccountKey = key;
  const o = applyPdiBankOption(key);
  rpdiState.bankDetails = { ...rpdiState.bankDetails, bankName: o.bankName, ifsc: o.ifsc, ac: o.ac, address: o.address, branch: o.branch };
  renderRpdiForm();
}
function updateRpdiLineItem(idx, key, value) {
  const item = rpdiState.lineItems[idx];
  if (!item) return;
  item[key] = value;
  if (key === 'quantity' || key === 'ratePerQuantity') {
    const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.ratePerQuantity) || 0);
    item.totalBasicPrice = amount;
    const amountEl = document.getElementById(`rpdi-amount-${idx}`);
    if (amountEl) amountEl.value = amount;
    recalcPdiTotals(rpdiState, 'rpdi');
  }
}

function openRpdiConfirmModal() {
  if ((rpdiState.lineItems || []).some(li => !(li.hsnNumber || '').toString().trim())) {
    showBOQBanner("rpdi-feedback", "HSN Code is required for every invoice line.", "error");
    return;
  }
  if (rpdiState.tradeType === 'Export' && !(Number(rpdiState.usdRate) > 0)) {
    showBOQBanner("rpdi-feedback", "INR to USD Rate is required when Export is selected.", "error");
    return;
  }
  document.getElementById("rpdi-confirm-target").textContent = rpdiCache.projectId;
  document.getElementById("rpdi-confirm-modal").style.display = "flex";
}
function closeRpdiConfirmModal() { document.getElementById("rpdi-confirm-modal").style.display = "none"; }

// Line items for the revision request payload -- only ratePerQuantity/
// quantity/totalBasicPrice are what the server's mergeRevisionInvoiceLines
// applies; description/hsnNumber/unit stay display-only here since a
// revision can only change what a line BILLS, never remove/add one or
// retype its description (see lib/projectInvoiceRevisionMerge.js).
function buildRpdiRevisedLineItemsPayload() {
  return (rpdiState.lineItems || []).map(li => ({ poLineId: li.lineId, quantity: Number(li.quantity) || 0, ratePerQuantity: Number(li.ratePerQuantity) || 0, totalBasicPrice: Number(li.totalBasicPrice) || 0 }));
}
function buildRpdiRevisedDetailsPayload() {
  const { lineItems, poNumber, poDate, ...rest } = rpdiState;
  return rest;
}

async function submitRpdiCreateRequest() {
  closeRpdiConfirmModal();
  showBlockingOverlay("Submitting revision request...");
  try {
    const data = await apFetch({
      action: "createProjectDispatchInvoiceRevisionRequest", invoiceId: rpdiCache.invoiceId,
      revisedInvoiceDetails: buildRpdiRevisedDetailsPayload(), revisedLineItems: buildRpdiRevisedLineItemsPayload(),
      operatorName: appActiveOperatorIdentityString || "Unknown",
    });
    if (data.success) {
      const rpdiTabsBar = document.getElementById("rpdi-tab-select")?.parentElement;
      if (rpdiTabsBar) rpdiTabsBar.style.display = "none";
      document.getElementById("rpdi-select-zone").style.display = "none";
      document.getElementById("rpdi-detail-zone").style.display = "none";
      const successZone = document.getElementById("rpdi-success-zone");
      successZone.style.display = "block";
      successZone.innerHTML = `
        <div style="padding:14px; background:#f0fdf4; border-left:4px solid #22c55e; border-radius:var(--radius); color:#15803d; font-weight:600; margin-bottom:14px;">
          Revision request #${data.requestId} submitted for Invoice ${rpdiCache.invoiceId} — awaiting authorization.
        </div>
        ${data.checkingDocUrl ? `<a href="${driveLink(data.checkingDocUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">📄 Open Draft #${data.checkingDraftNumber} ↗</a>` : `<div style="color:#b45309; font-weight:600;">⚠ Checking draft generation failed — retry from the Editing tab.</div>`}
        <div style="margin-top:16px;">
          <button class="nav-btn-styled" style="background:var(--accent); padding:8px 20px; font-weight:700;" onclick="switchRevisePdiTab('select')">+ Revise Another Invoice</button>
          <button class="nav-btn-styled" style="background:var(--muted); padding:8px 20px; font-weight:700; margin-left:8px;" onclick="switchRevisePdiTab('editing')">Go to Pending Revisions (Editing)</button>
        </div>`;
    } else {
      showBOQBanner("rpdi-feedback", data.error || "Failed.", "error");
    }
  } catch(e) {
    showBOQBanner("rpdi-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

// ── Editing tab ──────────────────────────────────────────────────────
let rpdiEditExpandedRequestId = null;

async function initializeRpdiEditingTab() {
  document.getElementById("rpdi-editing-feedback").style.display = "none";
  const feed = document.getElementById("rpdi-editing-cards-feed");
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  rpdiEditExpandedRequestId = null;
  try {
    const data = await apFetch({ action: "fetchPendingProjectDispatchInvoiceRevisionsForEditing" });
    if (!data.success) { feed.innerHTML = `<div style="color:#b91c1c; padding:14px;">${data.error || 'Failed to load.'}</div>`; return; }
    if (!(data.requests || []).length) { feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">No pending revision requests.</div>`; return; }
    feed.innerHTML = data.requests.map(r => `
      <div style="border:1px solid var(--border); border-radius:var(--radius); padding:12px; margin-bottom:10px; background:#fff;">
        <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="toggleRpdiEditCard(${r.requestId})">
          <div>
            <strong>Revision #${r.requestId}</strong> for ${r.invoiceType} Invoice ${r.invoiceNo} (${r.projectId})
            <div style="font-size:0.8rem; color:var(--muted);">Requested by ${r.requestedBy || '—'}</div>
          </div>
          <div style="text-align:right;">
            ${r.checkingDocUrl ? `<a href="${driveLink(r.checkingDocUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:var(--brand); font-weight:700; font-size:0.85rem;">📄 Draft #${r.checkingDraftCount} ↗</a>` : `<span style="color:#b45309; font-size:0.8rem;">No draft yet</span>`}
          </div>
        </div>
        <div id="rpdi-edit-card-${r.requestId}" style="display:none; margin-top:12px; border-top:1px solid var(--border); padding-top:12px;"></div>
      </div>`).join('');
  } catch(e) {
    feed.innerHTML = `<div style="color:#b91c1c; padding:14px;">Network error: ${e.message}</div>`;
  }
}

async function toggleRpdiEditCard(requestId) {
  const card = document.getElementById(`rpdi-edit-card-${requestId}`);
  if (!card) return;
  if (rpdiEditExpandedRequestId === requestId) { card.style.display = "none"; rpdiEditExpandedRequestId = null; return; }
  rpdiEditExpandedRequestId = requestId;
  card.style.display = "block";
  card.innerHTML = `<div style="text-align:center; padding:12px; color:var(--muted);">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchPendingProjectDispatchInvoiceRevisionsForEditing" });
    const r = (data.requests || []).find(x => x.requestId === requestId);
    if (!r) { card.innerHTML = `<div style="color:#b91c1c;">Request not found.</div>`; return; }
    const invData = await apFetch({ action: "fetchProjectInvoiceRevisionPrefillById", invoiceId: r.invoiceId });
    const last = invData.lastInvoiceDetails || {};
    rpdiCache = { invoiceId: r.invoiceId, projectId: r.projectId, invoiceType: r.invoiceType, invoiceRevision: 0 };
    rpdiState = {
      insuranceNo: last.insuranceNo || "", mdccNo: last.mdccNo || "", transportName: last.transportName || "",
      lrNoDate: last.lrNoDate || "", lcNoDate: last.lcNoDate || "", dcNoDate: last.dcNoDate || "", vehicleNo: last.vehicleNo || "",
      mobileNo: last.mobileNo || "", freightText: last.freightText || "", incoterms: last.incoterms || "", incotermsPlace: last.incotermsPlace || "",
      tradeType: last.tradeType || "Local", usdRate: last.usdRate || "",
      billTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "", ...(last.billTo || {}) },
      shipTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "", ...(last.shipTo || {}) },
      lineItems: (invData.lineItems || []).map(li => ({ ...li })),
      igstPercent: last.igstPercent || "18", cgstPercent: last.cgstPercent || "", sgstPercent: last.sgstPercent || "", roundOff: last.roundOff || "0",
      freightAmount: last.freightAmount || "0", othersAmount: last.othersAmount || "0",
      bankAccountKey: (PDI_BANK_OPTIONS.find(o => o.ac === (last.bankDetails || {}).ac) || PDI_BANK_OPTIONS[0]).key,
      bankDetails: { beneficiary: "ABPS SOLUTION PRIVATE LIMITED", swift: "", ...PDI_STANDARD_BANK_DETAILS, ...(last.bankDetails || {}) },
      declaration: last.declaration || PDI_STANDARD_DECLARATION,
    };
    card.innerHTML = `
      <div id="rpdi-edit-lineitems-wrap-${requestId}" style="overflow-x:auto;"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button class="nav-btn-styled" style="background:var(--brand); padding:8px 16px;" onclick="saveRpdiEdit(${requestId})">📄 Save &amp; Generate Draft</button>
      </div>
      <div id="rpdi-edit-feedback-${requestId}" style="margin-top:10px;"></div>`;
    renderPdiLineItemsTable(`rpdi-edit-lineitems-wrap-${requestId}`, rpdiState.lineItems, `rpdi-edit-${requestId}`, 'updateRpdiEditLineItem', null, null);
  } catch(e) {
    card.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
  }
}
function updateRpdiEditLineItem(idx, key, value) {
  const item = rpdiState.lineItems[idx];
  if (!item) return;
  item[key] = value;
  if (key === 'quantity' || key === 'ratePerQuantity') {
    item.totalBasicPrice = (parseFloat(item.quantity) || 0) * (parseFloat(item.ratePerQuantity) || 0);
  }
}
async function saveRpdiEdit(requestId) {
  const fb = document.getElementById(`rpdi-edit-feedback-${requestId}`);
  showBlockingOverlay("Saving changes...");
  try {
    const data = await apFetch({
      action: "updateProjectDispatchInvoiceRevisionRequest", requestId,
      revisedInvoiceDetails: buildRpdiRevisedDetailsPayload(), revisedLineItems: buildRpdiRevisedLineItemsPayload(),
      operatorName: appActiveOperatorIdentityString || "Unknown",
    });
    if (!data.success) { fb.innerHTML = `<div style="color:#b91c1c; font-weight:600;">${data.error || 'Failed.'}</div>`; return; }
  } catch(e) {
    fb.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
    return;
  } finally {
    hideBlockingOverlay();
  }
  // Saving and printing are one step (24 Sep 2026).
  await generateRpdiCheckingDraftOnly(requestId);
}
async function generateRpdiCheckingDraftOnly(requestId) {
  const fb = document.getElementById(`rpdi-edit-feedback-${requestId}`);
  showBlockingOverlay("Generating draft...");
  try {
    const data = await apFetch({ action: "regenerateProjectDispatchInvoiceRevisionCheckingDraft", requestId });
    if (data.success && data.checkingDocUrl) {
      document.getElementById("rpdi-editing-cards-feed").innerHTML = "";
      const tabsBar = document.getElementById("rpdi-tab-select")?.parentElement;
      if (tabsBar) tabsBar.style.display = "none";
      const fbEl = document.getElementById("rpdi-editing-feedback");
      fbEl.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #15803d; background:#dcfce7; color:#15803d; border-radius:var(--radius); font-weight:600;";
      fbEl.innerHTML = `Changes saved. Draft #${data.checkingDraftNumber} generated. <a href="${driveLink(data.checkingDocUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">📄 Open Draft ↗</a>
        <div><button class="nav-btn-styled" style="margin-top:12px; background:var(--accent); padding:7px 18px; font-weight:700;" onclick="switchRevisePdiTab('editing')">+ Edit Another Invoice Revision</button></div>`;
      fbEl.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    fb.innerHTML = data.success
      ? `<div style="color:#b45309; font-weight:600;">Changes saved, but the draft could not be generated. Click the button again to retry.</div>`
      : `<div style="color:#b91c1c; font-weight:600;">${data.error || 'Failed.'}</div>`;
  } catch(e) {
    fb.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
  } finally {
    hideBlockingOverlay();
  }
}
