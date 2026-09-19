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
  deliveryChallan:     { dropzoneId: "cpdi-doc-deliveryChallan-dropzone",    listId: "cpdi-doc-deliveryChallan-filelist",    label: "Delivery Challan",                          placeholder: "📎 Click to attach Delivery Challan" },
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
const PDI_INCOTERMS_OPTIONS = [
  { code: 'EXW', label: 'EXW — Ex Works' },
  { code: 'FCA', label: 'FCA — Free Carrier' },
  { code: 'CPT', label: 'CPT — Carriage Paid To' },
  { code: 'CIP', label: 'CIP — Carriage And Insurance Paid To' },
  { code: 'DPU', label: 'DPU — Delivered At Place Unloaded' },
  { code: 'FOB', label: 'FOB — Free On Board' },
  { code: 'CFR', label: 'CFR — Cost And Freight' },
  { code: 'CIF', label: 'CIF — Cost, Insurance And Freight' },
];
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
