// ═══════════════════════════════════════════════════════════════════════
// store/dispatch-invoice-shared.js — constants and generic render/calc
// helpers shared by all four Project Dispatch Invoice sections (Create,
// Authorize, Revise, Authorize Revision), migration 208-209 (19 Sep
// 2026). Loaded before the four section files.
//
// Ported from the old single-screen production/project-invoice.js
// (retired) — its Generate/Revise line-item table and totals functions
// were near-identical twins (renderPinvLineItemsTable/
// renderPinvReviseLineItemsTable, recalcPinvTotals/recalcPinvReviseTotals);
// the versions here are collapsed into one generic function each,
// parameterized by (state, idPrefix), rather than duplicated a third and
// fourth time for Create/Revise's dispatch-invoice equivalents.
// ═══════════════════════════════════════════════════════════════════════

// Invoice Documents — Create only (Revise never re-uploads supporting
// documents; a revision only changes commercial figures). Identical set
// to the old screen's PINV_DOC_META.
const PDI_DOC_META = {
  packingList:        { dropzoneId: "cpdi-doc-packingList-dropzone",        listId: "cpdi-doc-packingList-filelist",        label: "Packing List",                             placeholder: "📎 Click to attach Packing List" },
  lrCopy:              { dropzoneId: "cpdi-doc-lrCopy-dropzone",            listId: "cpdi-doc-lrCopy-filelist",             label: "LR Copy",                                   placeholder: "📎 Click to attach LR Copy" },
  historyCard:         { dropzoneId: "cpdi-doc-historyCard-dropzone",       listId: "cpdi-doc-historyCard-filelist",        label: "History Card",                              placeholder: "📎 Click to attach History Card" },
  truckLoadedImages:   { dropzoneId: "cpdi-doc-truckLoadedImages-dropzone", listId: "cpdi-doc-truckLoadedImages-filelist",  label: "Images of Products Loaded in Truck",        placeholder: "📎 Click to attach Images of Products Loaded in Truck" },
  mdcc:                { dropzoneId: "cpdi-doc-mdcc-dropzone",              listId: "cpdi-doc-mdcc-filelist",               label: "MD cc",                                     placeholder: "📎 Click to attach MD cc" },
  inspectionClearance: { dropzoneId: "cpdi-doc-inspectionClearance-dropzone", listId: "cpdi-doc-inspectionClearance-filelist", label: "Inspection Clearance",                    placeholder: "📎 Click to attach Inspection Clearance" },
  warrantyCard:        { dropzoneId: "cpdi-doc-warrantyCard-dropzone",       listId: "cpdi-doc-warrantyCard-filelist",       label: "Warranty Card",                             placeholder: "📎 Click to attach Warranty Card" },
  serialNumberConfirmationSheet: { dropzoneId: "cpdi-doc-serialNumberConfirmationSheet-dropzone", listId: "cpdi-doc-serialNumberConfirmationSheet-filelist", label: "Serial Number Confirmation Sheet", placeholder: "📎 Click to attach Serial Number Confirmation Sheet" },
};
const PDI_REQUIRED_DOC_TYPES = Object.keys(PDI_DOC_META).filter(t => t !== 'lrCopy' && t !== 'mdcc' && t !== 'inspectionClearance');

const PDI_BANK_OPTIONS = [
  { key: "boi1", label: "BOI: 051430110000209",
    bankName: "Bank Of India", ifsc: "BKID0000514", ac: "051430110000209",
    address: "Fergusson College Road, 1201 C A Shivagi nagar, Pune-411004",
    branch: "Fergusson Road Branch, Code:-00051" },
  { key: "boi2", label: "BOI: 051420110001177",
    bankName: "Bank Of India", ifsc: "BKID0000514", ac: "051420110001177",
    address: "Fergusson Road Branch, Pune, Maharashtra-411004",
    branch: "Fergusson Road Branch, Code:-00051" },
  { key: "icici1", label: "ICICI: 777705290523",
    bankName: "ICICI Bank", ifsc: "ICIC0000321", ac: "777705290523",
    address: "Shop No. 3 & 8, Ground Floor, F Wing, Premier Plaza, Old Mumbai Pune Highway, Chinchwad, Pune, Maharashtra-411019",
    branch: "Pune - Chinchwad Branch, Code:-0321" },
];
const PDI_STANDARD_BANK_DETAILS = { ...PDI_BANK_OPTIONS[0] };
function applyPdiBankOption(key) {
  return PDI_BANK_OPTIONS.find(o => o.key === key) || PDI_BANK_OPTIONS[0];
}
// Incoterms used to be a fixed dropdown (PDI_INCOTERMS_OPTIONS, 8 codes) --
// changed to free text per explicit request, since Incoterms only ever
// appears on this one document and a rigid list was more restrictive than
// useful (e.g. no room for a trailing named-place variant, a rarer code,
// or "N/A"). The paired "Named Place" field is unchanged.
const PDI_STANDARD_DECLARATION = "I / We hereby certify that our registration certificate under the GST Act, 2017 is in force on the date on which the supply of goods specified in this Tax invoice is made by me / us & the transaction of supply covered by this Tax invoice had been effected by me / us & it shall be accounted for in the turnover of supplies while filing of return & due tax if any payable on the supplies has been paid or shall be paid. Further certified that the particulars given above are true and correct & the amount indicated represents the prices actually charged and that there is no flow of additional consideration directly or indirectly from the buyer. Interest @18% p.a. charged on all outstanding more than one month after invoice has been rendered.";

// Client-side port of lib/poTemplate.js's numberToWordsINR/USD — live
// preview only, the backend recomputes this itself when it builds a PDF.
function numberToWordsINRClient(amount) {
  amount = Math.round(parseFloat(amount) || 0);
  if (amount === 0) return "Zero Rupees Only";
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const twoDigit = (n) => n < 20 ? ones[n] : tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
  const threeDigit = (n) => (n >= 100 ? ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' : '') : '') + (n%100 ? twoDigit(n%100) : '');
  let words = '';
  let a = amount;
  const crore = Math.floor(a / 10000000); a %= 10000000;
  const lakh  = Math.floor(a / 100000);   a %= 100000;
  const thousand = Math.floor(a / 1000);  a %= 1000;
  const hundred = a;
  if (crore)    words += threeDigit(crore) + ' Crore ';
  if (lakh)     words += twoDigit(lakh) + ' Lakh ';
  if (thousand) words += twoDigit(thousand) + ' Thousand ';
  if (hundred)  words += threeDigit(hundred);
  return words.trim() + ' Rupees Only';
}
function numberToWordsUSDClient(amount) {
  amount = Math.round(parseFloat(amount) || 0);
  if (amount === 0) return "Zero US Dollars Only";
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const twoDigit = (n) => n < 20 ? ones[n] : tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
  const threeDigit = (n) => (n >= 100 ? ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' : '') : '') + (n%100 ? twoDigit(n%100) : '');
  let words = '';
  let a = amount;
  const billion  = Math.floor(a / 1000000000); a %= 1000000000;
  const million  = Math.floor(a / 1000000);    a %= 1000000;
  const thousand = Math.floor(a / 1000);       a %= 1000;
  const hundred = a;
  if (billion)  words += threeDigit(billion) + ' Billion ';
  if (million)  words += threeDigit(million) + ' Million ';
  if (thousand) words += threeDigit(thousand) + ' Thousand ';
  if (hundred)  words += threeDigit(hundred);
  return words.trim() + ' US Dollars Only';
}

function pdiAutoGrowField(el) { autoGrowTextField(el); }

// PINV_LINEITEM_COLS equivalent — Sr No 3% + these 6 (50/7/10/10/10/10 =
// 100%) + a 36px delete-button column, needs table-layout:fixed.
const PDI_LINEITEM_COLS = [
  ['description', 'Invoice Material Description', 'text', '50%'],
  ['hsnNumber', 'HSN Code', 'text', '7%'],
  ['quantity', 'Qty', 'number', '10%'],
  ['unit', 'Unit', 'text', '10%'],
  ['ratePerQuantity', 'Rate / Qty', 'number', '10%'],
  ['totalBasicPrice', 'Amount', 'number', '10%'],
];

// renderPdiLineItemsTable — generic port of renderPinvLineItemsTable /
// renderPinvReviseLineItemsTable, parameterized so both Create's New
// form and Revise's form (and their respective Editing tabs) share one
// implementation instead of four near-identical copies.
//   wrapId: the container element id to render into
//   items: state.lineItems (mutated in place — totalBasicPrice re-derived)
//   idPrefix: used to build unique <input id> for the Amount cell
//   onItemChange(idx, key, value): called on every keystroke
//   onDeleteItem(idx): called when the row's ✕ is clicked, or null to hide delete
//   showAddRow: { onShowPicker } or null to omit the "+ Add row" control
function renderPdiLineItemsTable(wrapId, items, idPrefix, onItemChange, onDeleteItem, addRowHtml) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  items.forEach(it => { it.totalBasicPrice = (parseFloat(it.quantity) || 0) * (parseFloat(it.ratePerQuantity) || 0); });
  const cols = PDI_LINEITEM_COLS;
  const showDelete = typeof onDeleteItem === 'function';
  wrap.innerHTML = `
    <table class="store-basket-data-table" style="min-width:820px; table-layout:fixed;">
      <colgroup><col style="width:3%;" />${cols.map(c => `<col style="width:${c[3]};" />`).join('')}${showDelete ? '<col style="width:36px;" />' : ''}</colgroup>
      <thead><tr><th>Sr No</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}${showDelete ? '<th></th>' : ''}</tr></thead>
      <tbody>
        ${items.length === 0 ? `<tr><td colspan="${cols.length + (showDelete ? 2 : 1)}" style="text-align:center; color:var(--muted);">No PO line items found for this project</td></tr>` : items.map((it, idx) => `
          <tr>
            <td style="text-align:center; font-weight:700;">${idx + 1}</td>
            ${cols.map(([key, , type]) => {
              if (key === 'totalBasicPrice') {
                return `<td><input type="number" id="${idPrefix}-amount-${idx}" value="${(it[key] ?? '').toString().replace(/"/g, '&quot;')}" readonly
                  style="width:100%; min-width:80px; box-sizing:border-box; padding:7px 9px; font-size:0.87rem; border:1px solid var(--border); border-radius:4px; background:#f1f5f9; color:var(--muted); cursor:not-allowed;" /></td>`;
              }
              if (type === 'text') {
                return `<td><textarea rows="1" oninput="${onItemChange}(${idx}, '${key}', this.value); pdiAutoGrowField(this);" onfocus="pdiAutoGrowField(this);" style="width:100%; min-width:80px; box-sizing:border-box; padding:7px 9px; font-size:0.87rem; border:1px solid var(--border); border-radius:4px; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(it[key] ?? '')}</textarea></td>`;
              }
              const rawVal = key === 'quantity' && (parseFloat(it[key]) || 0) === 0
                ? `value="" placeholder="0"`
                : `value="${(it[key] ?? '').toString().replace(/"/g, '&quot;')}"`;
              return `<td><input type="${type}" ${rawVal} oninput="${onItemChange}(${idx}, '${key}', this.value)" style="width:100%; min-width:80px; box-sizing:border-box; padding:7px 9px; font-size:0.87rem; border:1px solid var(--border); border-radius:4px;" /></td>`;
            }).join('')}
            ${showDelete ? `<td style="text-align:center;"><button type="button" onclick="${onDeleteItem}(${idx})" title="Remove this line from the invoice"
              style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:3px; font-size:0.76rem; font-weight:700; padding:3px 7px; cursor:pointer;">✕</button></td>` : ''}
          </tr>`).join('')}
      </tbody>
    </table>
    ${addRowHtml != null ? `<div id="${idPrefix}-addrow-zone" style="margin-top:8px;">${addRowHtml}</div>` : ''}`;
  wrap.querySelectorAll('textarea').forEach(pdiAutoGrowField);
}

// recalcPdiTotals — generic port of recalcPinvTotals/recalcPinvReviseTotals.
// idPrefix drives the display element ids (`${idPrefix}-subtotal-display` etc).
function recalcPdiTotals(state, idPrefix) {
  const items = state.lineItems || [];
  const rawSubTotal = items.reduce((sum, it) => sum + (parseFloat(it.totalBasicPrice) || 0), 0);
  const isExport = state.tradeType === 'Export';
  const usdRate = parseFloat(state.usdRate) || 0;
  const subTotal = (isExport && usdRate > 0) ? rawSubTotal / usdRate : rawSubTotal;
  const roundOff = parseFloat(state.roundOff) || 0;
  const freightAmount = parseFloat(state.freightAmount) || 0;
  const othersAmount = parseFloat(state.othersAmount) || 0;
  let grandTotal;
  if (isExport) {
    grandTotal = subTotal + freightAmount + othersAmount + roundOff;
  } else {
    const igstAmount = rawSubTotal * (parseFloat(state.igstPercent) || 0) / 100;
    const cgstAmount = rawSubTotal * (parseFloat(state.cgstPercent) || 0) / 100;
    const sgstAmount = rawSubTotal * (parseFloat(state.sgstPercent) || 0) / 100;
    grandTotal = subTotal + cgstAmount + sgstAmount + igstAmount + freightAmount + othersAmount + roundOff;
  }
  const st = document.getElementById(`${idPrefix}-subtotal-display`);
  const gt = document.getElementById(`${idPrefix}-grandtotal-display`);
  const w = document.getElementById(`${idPrefix}-words-display`);
  const symbol = isExport ? "$" : "₹";
  if (st) st.textContent = symbol + subTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (gt) gt.textContent = symbol + grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (w) w.textContent = isExport ? numberToWordsUSDClient(grandTotal) : numberToWordsINRClient(grandTotal);
}

// pdiAutoSetGstFromBillToGst — ABPS is Maharashtra-based (GSTIN prefix
// 27); recomputes CGST/SGST/IGST on every keystroke of the Bill To GST
// No. field. gstInputIdPrefix drives the 3 <input> ids to sync back.
function pdiAutoSetGstFromBillToGst(state, value, gstInputIdPrefix, onDoneCallback) {
  state.billTo.gstNo = value;
  const isMaharashtra = (value || '').trim().slice(0, 2) === '27';
  state.cgstPercent = isMaharashtra ? '9' : '0';
  state.sgstPercent = isMaharashtra ? '9' : '0';
  state.igstPercent = isMaharashtra ? '0' : '18';
  const cgstEl = document.getElementById(`${gstInputIdPrefix}-cgst-input`);
  const sgstEl = document.getElementById(`${gstInputIdPrefix}-sgst-input`);
  const igstEl = document.getElementById(`${gstInputIdPrefix}-igst-input`);
  if (cgstEl) cgstEl.value = state.cgstPercent;
  if (sgstEl) sgstEl.value = state.sgstPercent;
  if (igstEl) igstEl.value = state.igstPercent;
  if (typeof onDoneCallback === 'function') onDoneCallback();
}

// updatePdiTradeType — Export clears GST% + Swift Code; Local clears USD rate.
function updatePdiTradeType(state, value) {
  state.tradeType = value;
  if (value === 'Export') {
    state.cgstPercent = ""; state.sgstPercent = ""; state.igstPercent = "";
    state.bankDetails.swift = "";
  } else {
    state.usdRate = "";
  }
}

// ── View-only invoice (Authorize screens, 25 Sep 2026) ────────────────
// Authorize approves the signed draft exactly as printed, so both Authorize
// screens show every invoice detail read-only in one consistent layout.
function pdiMoney(n, isExport) {
  const v = (parseFloat(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return (isExport ? '$' : '₹') + v;
}

function renderPdiInvoiceViewHtml(d, meta) {
  d = d || {}; meta = meta || {};
  const isExport = d.tradeType === 'Export';
  const usdRate = parseFloat(d.usdRate) || 0;
  const conv = (n) => (isExport && usdRate > 0) ? (parseFloat(n) || 0) / usdRate : (parseFloat(n) || 0);
  const v = (x) => (x == null || String(x).trim() === '') ? '<span style="color:var(--muted);">—</span>' : escapeHtml(String(x));
  const cell = (label, val) => `<div class="pdi-view-cell"><div class="pdi-view-label">${label}</div><div class="pdi-view-value">${v(val)}</div></div>`;
  const party = (title, p) => {
    p = p || {};
    const rows = [['Name', p.name], ['Address', p.address], ['State', p.state], ['GST No.', p.gstNo], ['Contact Name', p.contactName], ['Contact No.', p.contactNo]];
    return `<div class="pdi-view-box"><div class="pdi-view-box-title">${title}</div>
      <table class="pdi-grid-table"><tbody>${rows.map(r => `<tr><th style="width:32%;">${r[0]}</th><td>${v(r[1])}</td></tr>`).join('')}</tbody></table></div>`;
  };
  const items = d.lineItems || [];
  const lineAmt = (it) => parseFloat(it.totalBasicPrice) || ((parseFloat(it.quantity) || 0) * (parseFloat(it.ratePerQuantity) || 0));
  const rawSub = items.reduce((s, it) => s + lineAmt(it), 0);
  const cgst = rawSub * (parseFloat(d.cgstPercent) || 0) / 100;
  const sgst = rawSub * (parseFloat(d.sgstPercent) || 0) / 100;
  const igst = rawSub * (parseFloat(d.igstPercent) || 0) / 100;
  const extras = (parseFloat(d.freightAmount) || 0) + (parseFloat(d.othersAmount) || 0) + (parseFloat(d.roundOff) || 0);
  const grand = isExport ? conv(rawSub) + extras : rawSub + cgst + sgst + igst + extras;
  const bank = d.bankDetails || {};
  const docs = meta.documents;
  return `
    <div class="pdi-view">
      <div class="pdi-view-section">Invoice</div>
      <div class="pdi-view-grid">
        ${cell('Invoice No.', meta.invoiceNo)}
        ${cell('Invoice Date', meta.invoiceDate)}
        ${cell('Invoice Type', meta.invoiceType)}
        ${cell('Project ID', meta.projectId)}
        ${cell('PO Number', meta.poNumber)}
        ${cell('PO Date', meta.poDate)}
        ${cell('Local / Export', d.tradeType || 'Local')}
        ${isExport ? cell('INR to USD Rate', d.usdRate) : ''}
        ${cell('Insurance No.', d.insuranceNo)}
        ${cell('MDCC No.', d.mdccNo)}
        ${cell('Transport Name', d.transportName)}
        ${cell('LR No & Date', d.lrNoDate)}
        ${cell('LC No & Date', d.lcNoDate)}
        ${cell('DC No & Date', d.dcNoDate)}
        ${cell('Vehicle No.', d.vehicleNo)}
        ${cell('Mobile No.', d.mobileNo)}
        ${cell('Freight', d.freightText)}
        ${cell('Incoterms', [d.incoterms, d.incotermsPlace].filter(Boolean).join(' '))}
      </div>

      <div class="pdi-view-two">${party('Bill To Party', d.billTo)}${party('Ship To Party', d.shipTo)}</div>

      <div class="pdi-view-section">Product Details</div>
      <div style="overflow-x:auto;">
      <table class="pdi-grid-table" style="min-width:720px;">
        <colgroup><col style="width:5%;"><col style="width:45%;"><col style="width:10%;"><col style="width:8%;"><col style="width:8%;"><col style="width:12%;"><col style="width:12%;"></colgroup>
        <thead><tr><th>Sr No</th><th>Invoice Material Description</th><th>HSN Code</th><th>Qty</th><th>Unit</th><th>Rate / Qty</th><th>Amount</th></tr></thead>
        <tbody>${items.length ? items.map((it, i) => `<tr>
          <td style="text-align:center; font-weight:700;">${i + 1}</td>
          <td>${v(it.description)}</td>
          <td style="text-align:center;">${v(it.hsnNumber)}</td>
          <td style="text-align:center; font-weight:700;">${v(fmtQty(it.quantity))}</td>
          <td style="text-align:center;">${v(it.unit)}</td>
          <td style="text-align:right;">${pdiMoney(conv(it.ratePerQuantity), isExport)}</td>
          <td style="text-align:right; font-weight:700;">${pdiMoney(conv(lineAmt(it)), isExport)}</td>
        </tr>`).join('') : `<tr><td colspan="7" style="text-align:center; color:var(--muted);">No lines</td></tr>`}</tbody>
      </table>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <table class="pdi-grid-table" style="width:340px;"><tbody>
          <tr><th>Sub Total</th><td style="text-align:right;">${pdiMoney(conv(rawSub), isExport)}</td></tr>
          ${isExport ? '' : `
          <tr><th>CGST ${v(d.cgstPercent || 0)}%</th><td style="text-align:right;">${pdiMoney(cgst)}</td></tr>
          <tr><th>SGST ${v(d.sgstPercent || 0)}%</th><td style="text-align:right;">${pdiMoney(sgst)}</td></tr>
          <tr><th>IGST ${v(d.igstPercent || 0)}%</th><td style="text-align:right;">${pdiMoney(igst)}</td></tr>`}
          <tr><th>Freight (incl. GST)</th><td style="text-align:right;">${pdiMoney(d.freightAmount, isExport)}</td></tr>
          <tr><th>Others (incl. GST)</th><td style="text-align:right;">${pdiMoney(d.othersAmount, isExport)}</td></tr>
          <tr><th>Round Off</th><td style="text-align:right;">${pdiMoney(d.roundOff, isExport)}</td></tr>
          <tr class="pdi-grand"><th>Grand Total</th><td style="text-align:right;">${pdiMoney(grand, isExport)}</td></tr>
        </tbody></table>
      </div>
      <div style="margin-top:8px; font-size:0.86rem;">Amount in words: <strong>${isExport ? numberToWordsUSDClient(grand) : numberToWordsINRClient(grand)}</strong></div>

      <div class="pdi-view-section">Bank Details</div>
      <table class="pdi-grid-table"><tbody>
        <tr><th style="width:20%;">Beneficiary</th><td>${v(bank.beneficiary)}</td><th style="width:20%;">Bank Name</th><td>${v(bank.bankName)}</td></tr>
        <tr><th>${isExport ? 'Swift Code' : 'IFSC Code'}</th><td>${v(isExport ? bank.swift : bank.ifsc)}</td><th>A/C</th><td>${v(bank.ac)}</td></tr>
        <tr><th>Address</th><td>${v(bank.address)}</td><th>Branch Name &amp; Code</th><td>${v(bank.branch)}</td></tr>
      </tbody></table>

      <div class="pdi-view-section">Declaration</div>
      <div style="font-size:0.84rem; border:1px solid #cbd5e1; border-radius:4px; padding:10px; background:#fff;">${v(d.declaration)}</div>

      ${docs === undefined ? '' : `<div class="pdi-view-section">Invoice Documents</div><div class="pdi-view-docs">${renderPdiDocumentsTableHtml(docs || [], null)}</div>`}
    </div>`;
}

// renderPdiDocumentsTableHtml — supporting documents in a bordered table.
// actions(doc) returns extra action-cell HTML (Revise's Replace / Remove),
// or pass null for view only.
function renderPdiDocumentsTableHtml(docs, actions) {
  if (!docs.length) return `<div style="font-size:0.85rem; color:var(--muted); padding:6px 0;">No documents attached.</div>`;
  return `
    <table class="pdi-grid-table">
      <colgroup><col style="width:6%;"><col style="width:28%;"><col><col style="width:${actions ? '28%' : '12%'};"></colgroup>
      <thead><tr><th>Sr No</th><th>Document</th><th>File</th><th>${actions ? 'Actions' : 'Open'}</th></tr></thead>
      <tbody>${docs.map((d, i) => `<tr>
        <td style="text-align:center; font-weight:700;">${i + 1}</td>
        <td style="font-weight:600;">${escapeHtml(d.docLabel || d.docType || '')}</td>
        <td style="word-break:break-word;">${escapeHtml(d.fileName || '')}</td>
        <td style="text-align:center; white-space:nowrap;">
          <a href="${driveLink(d.url)}" target="_blank" rel="noopener" class="pdi-link-btn">Open ↗</a>${actions ? actions(d) : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

// renderPdiSuccessCard — the Authorize screens' success message: title, the
// key facts in a bordered table, document buttons and the reset button.
function renderPdiSuccessCard(elementId, opts) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const rows = (opts.rows || []).filter(r => r && r[1] != null && r[1] !== '');
  const links = (opts.links || []).filter(l => l && l.url);
  el.style.cssText = "display:block; margin-bottom:14px;";
  el.innerHTML = `
    <div style="border:1.5px solid #86efac; background:#f0fdf4; border-radius:var(--radius); padding:18px;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <div style="width:34px; height:34px; border-radius:50%; background:#16a34a; color:#fff; display:flex; align-items:center; justify-content:center; font-size:1.1rem; font-weight:800; flex-shrink:0;">✓</div>
        <div style="font-size:1.05rem; font-weight:800; color:#15803d;">${opts.title}</div>
      </div>
      <table class="pdi-grid-table" style="max-width:640px; background:#fff;"><tbody>
        ${rows.map(r => `<tr><th style="width:40%;">${r[0]}</th><td style="font-weight:700;">${escapeHtml(String(r[1]))}</td></tr>`).join('')}
      </tbody></table>
      ${(opts.notes || []).length ? `<div style="margin-top:10px; font-size:0.84rem; font-weight:600; color:#b45309;">${opts.notes.join('<br>')}</div>` : ''}
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
        ${links.map(l => `<a href="${l.url}" target="_blank" rel="noopener" style="display:inline-block; background:#fff; color:var(--brand); border:1.5px solid var(--brand); padding:8px 16px; border-radius:var(--radius); font-weight:700; font-size:0.84rem; text-decoration:none;">${l.label} ↗</a>`).join('')}
        <button class="nav-btn-styled" style="background:var(--accent); color:#fff; padding:8px 18px; font-weight:700; font-size:0.84rem;" onclick="${opts.resetFn}">+ ${opts.resetLabel}</button>
      </div>
    </div>`;
}

// renderPdiQueueCardHeader — the clickable header of an Authorize queue card
// (25 Sep 2026): tinted background, labelled cells, the draft link on the
// right. cells: [[label, valueHtml], ...]
function renderPdiQueueCardHeader(onclickJs, cells, rightHtml) {
  return `<div onclick="${onclickJs}" style="cursor:pointer; background:#eaf1fb; border-bottom:1px solid #d3e0f2; border-radius:var(--radius) var(--radius) 0 0; padding:12px 14px; display:flex; gap:14px; align-items:center;">
    <div style="flex:1; display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px 16px;">
      ${cells.map(c => `<div style="min-width:0;"><div style="font-size:0.66rem; font-weight:800; text-transform:uppercase; color:var(--muted);">${c[0]}</div><div style="font-weight:700; font-size:0.88rem; word-break:break-word;">${c[1] == null || c[1] === '' ? '—' : c[1]}</div></div>`).join('')}
    </div>
    <div style="flex-shrink:0; text-align:right;">${rightHtml || ''}</div>
  </div>`;
}
