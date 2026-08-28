let pinvInvoiceState = null;

// Invoice Documents — one dropzone per type, each accepting multiple
// files, mirroring finished-goods.js's FG_DOC_META pattern. lrCopy, mdcc,
// and inspectionClearance are optional (see PINV_REQUIRED_DOC_TYPES
// below) -- everything else is compulsory since it's never skippable for
// a real dispatch. inspectionClearance moved here from Add to Finished
// Goods Store / Add to Finished Goods Store Approval — it's project-level
// now, not tied to one Job Card's finished good.
const PINV_DOC_META = {
  packingList:        { dropzoneId: "pinv-doc-packingList-dropzone",        listId: "pinv-doc-packingList-filelist",        label: "Packing List",                             placeholder: "📎 Click to attach Packing List" },
  deliveryChallan:     { dropzoneId: "pinv-doc-deliveryChallan-dropzone",    listId: "pinv-doc-deliveryChallan-filelist",    label: "Delivery Challan",                          placeholder: "📎 Click to attach Delivery Challan" },
  lrCopy:              { dropzoneId: "pinv-doc-lrCopy-dropzone",            listId: "pinv-doc-lrCopy-filelist",             label: "LR Copy",                                   placeholder: "📎 Click to attach LR Copy" },
  historyCard:         { dropzoneId: "pinv-doc-historyCard-dropzone",       listId: "pinv-doc-historyCard-filelist",        label: "History Card",                              placeholder: "📎 Click to attach History Card" },
  truckLoadedImages:   { dropzoneId: "pinv-doc-truckLoadedImages-dropzone", listId: "pinv-doc-truckLoadedImages-filelist",  label: "Images of Products Loaded in Truck",        placeholder: "📎 Click to attach Images of Products Loaded in Truck" },
  mdcc:                { dropzoneId: "pinv-doc-mdcc-dropzone",              listId: "pinv-doc-mdcc-filelist",               label: "MD cc",                                     placeholder: "📎 Click to attach MD cc" },
  inspectionClearance: { dropzoneId: "pinv-doc-inspectionClearance-dropzone", listId: "pinv-doc-inspectionClearance-filelist", label: "Inspection Clearance",                    placeholder: "📎 Click to attach Inspection Clearance" },
};
const PINV_REQUIRED_DOC_TYPES = Object.keys(PINV_DOC_META).filter(t => t !== 'lrCopy' && t !== 'mdcc' && t !== 'inspectionClearance');
let pinvDocFiles = {};

function resetPinvDocFiles() {
  pinvDocFiles = {};
  Object.keys(PINV_DOC_META).forEach(t => { pinvDocFiles[t] = []; renderPinvFileList(t); });
}
resetPinvDocFiles();

// The <input> carries `multiple` (index.html) so the OS file picker lets
// several files be selected in one go, instead of a separate click-and-
// select round trip per file.
function handlePinvFileSelectionMulti(input, type) {
  const files = [...(input.files || [])];
  input.value = "";
  if (files.length === 0 || !PINV_DOC_META[type]) return;
  pinvDocFiles[type].push(...files);
  renderPinvFileList(type);
}

function removePinvFile(type, idx) {
  if (!pinvDocFiles[type]) return;
  pinvDocFiles[type].splice(idx, 1);
  renderPinvFileList(type);
}

function renderPinvFileList(type) {
  const meta = PINV_DOC_META[type];
  if (!meta) return;
  const files = pinvDocFiles[type] || [];
  const box = document.getElementById(meta.dropzoneId);
  if (box) {
    if (files.length > 0) { box.textContent = `✅ ${files.length} file${files.length > 1 ? "s" : ""} attached — click to add more`; box.classList.add("done"); }
    else { box.textContent = meta.placeholder; box.classList.remove("done"); }
  }
  const list = document.getElementById(meta.listId);
  if (!list) return;
  list.innerHTML = files.map((f, i) => `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; font-size:0.82rem; padding:4px 8px; background:#f8fafc; border:1px solid var(--border); border-radius:4px; margin-top:4px;">
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${f.name}</span>
      <span onclick="removePinvFile('${type}', ${i})" style="cursor:pointer; color:#b91c1c; font-weight:700; flex-shrink:0;" title="Remove">✕</span>
    </div>`).join("");
}

// Generate Invoice / Revise Invoice — two independent flows sharing the
// panel. Revise deliberately does NOT touch project status / PRNs / stock
// (all settled at the original Generate step) — it only regenerates the
// Project Invoice PDF with corrected figures.
function switchPinvMode(mode) {
  const genBtn = document.getElementById("pinv-mode-generate-btn");
  const revBtn = document.getElementById("pinv-mode-revise-btn");
  document.getElementById("pinv-generate-mode").style.display = mode === "generate" ? "block" : "none";
  document.getElementById("pinv-revise-mode").style.display = mode === "revise" ? "block" : "none";
  genBtn.style.background = mode === "generate" ? "var(--accent)" : "#718096";
  revBtn.style.background = mode === "revise" ? "var(--accent)" : "#718096";
  document.getElementById("pinv-feedback").style.display = "none";
  if (mode === "generate") initializePinvWorkspace();
  else initializePinvReviseWorkspace();
}

async function initializePinvWorkspace() {
  document.getElementById("pinv-feedback").style.display = "none";
  document.getElementById("pinv-generate-mode").style.display = "block";
  document.getElementById("pinv-revise-mode").style.display = "none";
  document.getElementById("pinv-mode-generate-btn").style.background = "var(--accent)";
  document.getElementById("pinv-mode-revise-btn").style.background = "#718096";
  document.getElementById("pinv-detail-zone").style.display = "none";
  document.getElementById("pinv-invoice-form-zone").style.display = "none";
  document.getElementById("pinv-invoice-form-zone").innerHTML = "";
  document.getElementById("pinv-documents-zone").style.display = "none";
  document.getElementById("pinv-payment-received").value = "No";
  resetPinvDocFiles();
  document.getElementById("pinv-success-zone").style.display = "none";
  document.getElementById("pinv-select-zone").style.display = "block";
  pinvInvoiceState = null;
  const select = document.getElementById("pinv-project-select");
  select.innerHTML = '<option value="">Loading...</option>';
  try {
    const data = await apFetch({ action: "fetchPartialInvoiceEligibleProjects" });
    if (!data.success) { select.innerHTML = '<option value="">Failed to load</option>'; return; }
    select.innerHTML = '<option value="">— Select Project ID —</option>' +
      data.projects.map(p => `<option value="${p.projectId}">${p.projectId} — ${p.companyName || ''}</option>`).join("");
    if (data.projects.length === 0) {
      select.innerHTML = '<option value="">No eligible Project IDs — at least one product\'s Job Cards must be QA-passed and not yet invoiced</option>';
    }
  } catch(e) {
    select.innerHTML = '<option value="">Network error</option>';
  }
}

// pinvCache.lines — one row per PO line item, joined to its BOQ's Job Card
// readiness stats (jcTotal / jcQaPassed / alreadyInvoicedQty /
// readyToInvoiceQty). Lines with no linked BOQ (freight/service items)
// aren't gated by Job Card completion at all — they're only billable on
// the Final Invoice, same as the old single-shot flow allowed.
async function handlePinvProjectChange(projectId) {
  const detailZone = document.getElementById("pinv-detail-zone");
  const invoiceFormZone = document.getElementById("pinv-invoice-form-zone");
  if (!projectId) { detailZone.style.display = "none"; invoiceFormZone.style.display = "none"; invoiceFormZone.innerHTML = ""; return; }
  // A <select> can re-fire 'change' for the value it already has (browser
  // autofill/back-forward restore, or a stray re-render touching the
  // element) -- without this guard that silently wiped pinvDocFiles via
  // resetPinvDocFiles() below, discarding any already-attached document
  // (e.g. Delivery Challan) with no visible warning, so Generate would
  // then fail the required-docs check even though the user had just
  // successfully attached it.
  if (pinvCache && pinvCache.projectId === projectId) return;
  detailZone.style.display = "block";
  invoiceFormZone.style.display = "none";
  invoiceFormZone.innerHTML = "";
  document.getElementById("pinv-documents-zone").style.display = "none";
  document.getElementById("pinv-payment-received").value = "No";
  resetPinvDocFiles();
  document.getElementById("pinv-jc-body").innerHTML = '<tr><td colspan="9" style="padding:14px; text-align:center;">Loading...</td></tr>';
  document.getElementById("pinv-blockers").style.display = "none";
  document.getElementById("pinv-generate-zone").style.display = "none";
  try {
    const [lineData, prefillData, invoiceNoData] = await Promise.all([
      apFetch({ action: "fetchProjectInvoiceLineDetail", projectId }),
      apFetch({ action: "fetchProjectInvoicePrefill", projectId }),
      apFetch({ action: "fetchNextInvoiceNumberPreview" }),
    ]);
    if (!lineData.success) { showBOQBanner("pinv-feedback", lineData.error || "Failed to load.", "error"); return; }
    pinvCache = {
      projectId, lines: lineData.lines, poNumber: prefillData.poNumber || "", poDate: prefillData.poDate || "",
      // Preview only -- the server mints the real number atomically at
      // submit time (allocateNextInvoiceNumber, routes/projects.js) and
      // never trusts this value; see fetchNextInvoiceNumberPreview.
      invoiceNoPreview: invoiceNoData.success ? invoiceNoData.invoiceNo : "",
    };
    initPinvInvoiceStateFromLines();
    renderPinvDetail();
  } catch(e) {
    showBOQBanner("pinv-feedback", "Network error: " + e.message, "error");
  }
}

function initPinvInvoiceStateFromLines() {
  pinvInvoiceState = {
    invoiceNo: pinvCache.invoiceNoPreview || "", insuranceNo: "", mdccNo: "", transportName: "", lrNoDate: "", lcNoDate: "", dcNoDate: "", vehicleNo: "", mobileNo: "", incoterms: PINV_INCOTERMS_OPTIONS[0].code, incotermsPlace: "",
    tradeType: "Import", usdRate: "",
    poNumber: pinvCache.poNumber, poDate: pinvCache.poDate,
    billTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "" },
    shipTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "" },
    lineItems: pinvCache.lines.map(l => {
      const qty = l.boqId ? l.readyToInvoiceQty : 0;
      return {
        lineId: l.lineId, description: l.description, hsnNumber: l.hsnNumber, unit: l.unit,
        quantity: qty, ratePerQuantity: l.ratePerQuantity, totalBasicPrice: qty * (parseFloat(l.ratePerQuantity) || 0),
      };
    }),
    igstPercent: "18", cgstPercent: "", sgstPercent: "", roundOff: "0",
    bankAccountKey: PINV_BANK_OPTIONS[0].key,
    bankDetails: { beneficiary: "ABPS SOLUTION PRIVATE LIMITED", swift: "", ...PINV_STANDARD_BANK_DETAILS },
    declaration: PINV_STANDARD_DECLARATION,
  };
}

function renderPinvDetail() {
  const body = document.getElementById("pinv-jc-body");
  body.innerHTML = pinvCache.lines.map((l, idx) => {
    const hasBoq = !!l.boqId;
    const blockerMsgs = [];
    if (l.pendingTicketsCount > 0) blockerMsgs.push(`${l.pendingTicketsCount} pending store ticket(s)`);
    if (l.pendingBoqIncreaseCount > 0) blockerMsgs.push(`${l.pendingBoqIncreaseCount} open BOQ Increase Request(s)`);
    const maxQty = hasBoq ? l.readyToInvoiceQty : l.orderedQuantity;
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px;">${l.productName || l.description}${blockerMsgs.length ? `<div style="color:#b91c1c; font-size:0.78rem; font-weight:700; margin-top:2px;">⚠ ${blockerMsgs.join(', ')} — this product is blocked</div>` : ''}</td>
      <td style="padding:8px; text-align:center;">${hasBoq ? l.orderedQuantity : '—'}</td>
      <td style="padding:8px; text-align:center;">${hasBoq ? l.jcTotal : '—'}</td>
      <td style="padding:8px; text-align:center;">${hasBoq ? l.jcQaPassed : '—'}</td>
      <td style="padding:8px; text-align:center;">${hasBoq ? l.alreadyInvoicedQty : '—'}</td>
      <td style="padding:8px; text-align:center; font-weight:700; color:${maxQty > 0 ? '#15803d' : 'var(--muted)'};">${hasBoq ? l.readyToInvoiceQty : 'Final only'}</td>
      <td style="padding:8px; text-align:center;">
        <input type="number" min="0" max="${maxQty}" value="${pinvInvoiceState.lineItems[idx].quantity}"
          ${blockerMsgs.length ? 'disabled' : ''}
          oninput="updatePinvClaimQty(${idx}, this.value, ${maxQty})"
          style="width:70px; text-align:center; padding:4px; font-size:0.87rem;" />
      </td>
    </tr>`;
  }).join("");

  const blockersDiv = document.getElementById("pinv-blockers");
  blockersDiv.style.display = "none";
  document.getElementById("pinv-generate-zone").style.display = "flex";
  document.getElementById("pinv-documents-zone").style.display = "block";
  renderPinvInvoiceForm();
  updatePinvGenerateButtonsState();
}

// Qty typed against a per-line readiness cap (readyToInvoiceQty for a
// BOQ-linked line, orderedQuantity for a freight/service line) — the
// server re-validates and re-claims independently, this is only what's
// shown/sent.
function updatePinvClaimQty(idx, value, maxQty) {
  const qty = Math.max(0, Math.min(Number(value) || 0, maxQty));
  const li = pinvInvoiceState.lineItems[idx];
  li.quantity = qty;
  li.totalBasicPrice = qty * (parseFloat(li.ratePerQuantity) || 0);
  renderPinvLineItemsTable();
  recalcPinvTotals();
  updatePinvGenerateButtonsState();
}

// Final Invoice only unlocks once every BOQ-linked line has nothing left
// to produce — already invoiced + currently ready together cover the full
// ordered quantity, and every Job Card that exists is QA-passed.
function updatePinvGenerateButtonsState() {
  const partialBtn = document.getElementById("pinv-generate-partial-btn");
  const finalBtn = document.getElementById("pinv-generate-final-btn");
  if (!partialBtn || !finalBtn) return;
  const anyQty = (pinvInvoiceState.lineItems || []).some(li => Number(li.quantity) > 0);
  const anyBlocked = pinvCache.lines.some(l => l.pendingTicketsCount > 0 || l.pendingBoqIncreaseCount > 0);
  partialBtn.disabled = !anyQty || anyBlocked;
  partialBtn.style.opacity = partialBtn.disabled ? "0.5" : "1";
  partialBtn.style.cursor = partialBtn.disabled ? "not-allowed" : "pointer";

  const allSettled = pinvCache.lines.filter(l => l.boqId).every(l =>
    l.jcTotal > 0 && l.jcQaPassed === l.jcTotal && (l.alreadyInvoicedQty + l.readyToInvoiceQty) >= l.orderedQuantity
  );
  finalBtn.disabled = !allSettled || anyBlocked;
  finalBtn.style.opacity = finalBtn.disabled ? "0.5" : "1";
  finalBtn.style.cursor = finalBtn.disabled ? "not-allowed" : "pointer";
}

// ═══════════════════════════════════════════════════════
// INVOICE DETAILS — prefilled from the project/PO line items, fully
// editable before Generate Invoice Doc. Bank Details and Declaration
// start from fixed standard values every time this loads fresh (never
// persisted) — editing them only affects the invoice being generated
// right now; the next invoice starts from the same standards again.
// ═══════════════════════════════════════════════════════
// Three real ABPS accounts the invoice can be raised against -- picking one
// overwrites the whole Bank Details block below with that account's values;
// every field stays editable afterward same as before.
const PINV_BANK_OPTIONS = [
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
    branch: "Pune - Chinchwad Branch, Code:-321" },
];
const PINV_STANDARD_BANK_DETAILS = { ...PINV_BANK_OPTIONS[0] };

function applyPinvBankOption(key) {
  return PINV_BANK_OPTIONS.find(o => o.key === key) || PINV_BANK_OPTIONS[0];
}
const PINV_INCOTERMS_OPTIONS = [
  { code: 'EXW', label: 'EXW — Ex Works' },
  { code: 'FCA', label: 'FCA — Free Carrier' },
  { code: 'CPT', label: 'CPT — Carriage Paid To' },
  { code: 'CIP', label: 'CIP — Carriage And Insurance Paid To' },
  { code: 'DPU', label: 'DPU — Delivered At Place Unloaded' },
  { code: 'FOB', label: 'FOB — Free On Board' },
  { code: 'CFR', label: 'CFR — Cost And Freight' },
  { code: 'CIF', label: 'CIF — Cost, Insurance And Freight' },
];
const PINV_STANDARD_DECLARATION = "I / We hereby certify that our registration certificate under the GST Act, 2017 is in force on the date on which the supply of goods specified in this Tax invoice is made by me / us & the transaction of supply covered by this Tax invoice had been effected by me / us & it shall be accounted for in the turnover of supplies while filing of return & due tax if any payable on the supplies has been paid or shall be paid. Further certified that the particulars given above are true and correct & the amount indicated represents the prices actually charged and that there is no flow of additional consideration directly or indirectly from the buyer. Interest @18% p.a. charged on all outstanding more than one month after invoice has been rendered.";

// Client-side port of lib/poTemplate.js's numberToWordsINR — live preview
// only; the backend recomputes this itself (from the same edited line
// items) when it actually builds the PDF, so this never needs to match
// byte-for-byte, just close enough to be a useful live readout.
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

// Same core as numberToWordsINRClient but Western thousand/million/billion
// grouping and a "US Dollars Only" suffix -- client-side port of the
// backend's numberToWordsUSD (lib/poTemplate.js), live preview only.
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

function pinvAutoGrowField(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function renderPinvInvoiceForm() {
  const zone = document.getElementById("pinv-invoice-form-zone");
  zone.style.display = "block";
  const s = pinvInvoiceState;
  const today = new Date();
  const todayDMY = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
  const esc = (v) => (v == null ? '' : v.toString()).replace(/"/g, '&quot;');

  // Auto-growing textarea instead of a single-line <input> — a long Bill
  // To/Ship To address or bank branch name used to clip silently; same
  // rows="1" + scrollHeight-on-input technique as Manufacturing Clearance's
  // mcAutoGrowField / Upload Purchase Order's autoGrowPoField.
  const field = (label, key, path) => {
    const val = path ? (s[path[0]][path[1]] || '') : (s[key] || '');
    const setter = path ? `updatePinvNested('${path[0]}','${path[1]}', this.value)` : `updatePinvField('${key}', this.value)`;
    return `<div class="grid-cell-item"><label>${label}</label><textarea rows="1" oninput="${setter}; pinvAutoGrowField(this);" onfocus="pinvAutoGrowField(this);" style="width:100%; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(val)}</textarea></div>`;
  };

  zone.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-top:16px;">
      <div style="font-weight:800; color:var(--brand); margin-bottom:4px; font-size:1rem;">Invoice Details</div>
      <div style="font-size:0.87rem; color:var(--muted); margin-bottom:14px;">Fill in what the invoice needs, edit any product row if needed, then Generate Invoice Doc.</div>

      <div style="display:flex; gap:14px; align-items:flex-end; margin-bottom:14px; flex-wrap:wrap;">
        <div class="grid-cell-item" style="max-width:200px; margin:0;">
          <label>Import / Export</label>
          <select onchange="updatePinvTradeType(this.value)" style="width:100%; padding:6px 4px;">
            <option value="Import" ${s.tradeType !== 'Export' ? 'selected' : ''}>Import</option>
            <option value="Export" ${s.tradeType === 'Export' ? 'selected' : ''}>Export</option>
          </select>
        </div>
        ${s.tradeType === 'Export' ? `
        <div class="grid-cell-item" style="max-width:220px; margin:0;">
          <label>INR to USD Rate</label>
          <input type="number" min="0" step="0.01" placeholder="e.g. 95.3" value="${esc(s.usdRate)}"
            oninput="updatePinvField('usdRate', this.value); recalcPinvTotals();" style="width:100%; padding:6px 4px;" />
        </div>` : ''}
      </div>

      <div class="compact-fields-grid" style="margin-bottom:14px;">
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>Invoice No.</label><div style="padding:6px 4px; font-weight:600; color:var(--brand);" title="Auto-generated -- assigned for real, atomically, when you generate the invoice">${s.invoiceNo || '—'}</div></div>
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>Date</label><div style="padding:6px 4px; font-weight:600;">${todayDMY}</div></div>
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
        <div class="grid-cell-item"><label>Incoterms</label>
          <select onchange="updatePinvField('incoterms', this.value)" style="width:100%; padding:6px 4px;">
            ${PINV_INCOTERMS_OPTIONS.map(o => `<option value="${o.code}" ${s.incoterms === o.code ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="grid-cell-item"><label>Named Place</label>
          <input type="text" placeholder="e.g. Mumbai Port" value="${esc(s.incotermsPlace)}" oninput="updatePinvField('incotermsPlace', this.value)" style="width:100%; padding:6px 4px;" />
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:#fff;">
          <div style="font-weight:700; color:var(--brand); margin-bottom:8px; font-size:0.88rem;">BILL TO PARTY</div>
          ${field('Name', null, ['billTo','name'])}
          ${field('Address', null, ['billTo','address'])}
          ${field('State', null, ['billTo','state'])}
          <div class="grid-cell-item"><label>GST No.</label><textarea rows="1" oninput="pinvAutoSetGstFromBillToGst(this.value); pinvAutoGrowField(this);" onfocus="pinvAutoGrowField(this);" style="width:100%; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(s.billTo.gstNo || '')}</textarea></div>
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

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.9rem;">Item Details</div>
      <div id="pinv-lineitems-wrap"></div>

      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <div style="width:300px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Sub Total</span>
            <strong id="pinv-subtotal-display">₹0</strong>
          </div>
          ${s.tradeType === 'Export' ? `
          <div style="font-size:0.78rem; color:var(--muted); padding:2px 2px;">No GST for Export invoices.</div>
          ` : `
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">CGST %</span>
            <input id="pinv-cgst-input" type="number" min="0" placeholder="0" value="${esc(s.cgstPercent)}" oninput="updatePinvField('cgstPercent', this.value); recalcPinvTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">SGST %</span>
            <input id="pinv-sgst-input" type="number" min="0" placeholder="0" value="${esc(s.sgstPercent)}" oninput="updatePinvField('sgstPercent', this.value); recalcPinvTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">IGST %</span>
            <input id="pinv-igst-input" type="number" min="0" value="${esc(s.igstPercent)}" oninput="updatePinvField('igstPercent', this.value); recalcPinvTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>`}
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Round Off</span>
            <input type="number" value="${esc(s.roundOff)}" oninput="updatePinvField('roundOff', this.value); recalcPinvTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f0fdf4; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:#15803d; text-transform:uppercase;">Grand Total</span>
            <strong id="pinv-grandtotal-display" style="color:#15803d;">₹0</strong>
          </div>
        </div>
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.9rem;">Bank Details</div>
      <div class="grid-cell-item" style="max-width:320px; margin-bottom:10px;">
        <label>Bank Account</label>
        <select onchange="selectPinvBankOption(this.value)" style="width:100%; padding:6px 4px;">
          ${PINV_BANK_OPTIONS.map(o => `<option value="${o.key}" ${s.bankAccountKey === o.key ? 'selected' : ''}>${o.label}</option>`).join('')}
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
        <textarea rows="4" style="width:100%; padding:8px; font-size:0.85rem; border:1.5px solid var(--border); border-radius:var(--radius);" oninput="updatePinvField('declaration', this.value)">${s.declaration}</textarea>
      </div>

      <div style="margin-top:14px; font-size:0.87rem; color:var(--muted);">Total Invoice Amount in Words: <strong id="pinv-words-display" style="color:var(--text);">—</strong></div>
    </div>
  `;
  renderPinvLineItemsTable();
  recalcPinvTotals();
  zone.querySelectorAll('.grid-cell-item textarea').forEach(pinvAutoGrowField);
}

// Column widths: Sr No 3%, Invoice Material Description 50%, HSN Code 7%,
// Qty/Unit/Rate per Qty/Amount 10% each (100% total) -- needs table-layout:
// fixed for the colgroup percentages to actually hold.
const PINV_LINEITEM_COLS = [
  ['description', 'Invoice Material Description', 'text', '50%'],
  ['hsnNumber', 'HSN Code', 'text', '7%'],
  ['quantity', 'Qty', 'number', '10%'],
  ['unit', 'Unit', 'text', '10%'],
  ['ratePerQuantity', 'Rate / Qty', 'number', '10%'],
  ['totalBasicPrice', 'Amount', 'number', '10%'],
];

function renderPinvLineItemsTable() {
  const wrap = document.getElementById("pinv-lineitems-wrap");
  if (!wrap) return;
  const items = pinvInvoiceState.lineItems || [];
  // Amount is always derived, so re-derive it here too -- covers rows
  // prefilled from the server before this locking was added, or any state
  // where quantity/rate changed without going through updatePinvLineItem.
  items.forEach(it => { it.totalBasicPrice = (parseFloat(it.quantity) || 0) * (parseFloat(it.ratePerQuantity) || 0); });
  const cols = PINV_LINEITEM_COLS;
  wrap.innerHTML = `
    <table class="store-basket-data-table" style="min-width:820px; table-layout:fixed;">
      <colgroup><col style="width:3%;" />${cols.map(c => `<col style="width:${c[3]};" />`).join('')}<col style="width:36px;" /></colgroup>
      <thead><tr><th>Sr No</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead>
      <tbody>
        ${items.length === 0 ? `<tr><td colspan="${cols.length + 2}" style="text-align:center; color:var(--muted);">No PO line items found for this project</td></tr>` : items.map((it, idx) => `
          <tr>
            <td style="text-align:center; font-weight:700;">${idx + 1}</td>
            ${cols.map(([key, , type]) => {
              if (key === 'totalBasicPrice') {
                // Locked -- always derived from Qty x Rate/Qty, never
                // independently operator-entered, same "never trust a
                // hand-typed total" stance as the Item Code Format engine's
                // auto-calc fields.
                return `<td><input type="number" id="pinv-amount-${idx}" value="${(it[key] ?? '').toString().replace(/"/g, '&quot;')}" readonly
                  style="width:100%; min-width:80px; padding:4px; font-size:0.85rem; background:#f1f5f9; color:var(--muted); cursor:not-allowed;" /></td>`;
              }
              return type === 'text'
                ? `<td><textarea rows="1" oninput="updatePinvLineItem(${idx}, '${key}', this.value); pinvAutoGrowField(this);" onfocus="pinvAutoGrowField(this);" style="width:100%; min-width:80px; padding:4px; font-size:0.85rem; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(it[key] ?? '')}</textarea></td>`
                : `<td><input type="${type}" value="${(it[key] ?? '').toString().replace(/"/g, '&quot;')}" oninput="updatePinvLineItem(${idx}, '${key}', this.value)" style="width:100%; min-width:80px; padding:4px; font-size:0.85rem;" /></td>`;
            }).join('')}
            <td style="text-align:center;"><button type="button" onclick="pinvDeleteLineItem(${idx})" title="Remove this line from the invoice"
              style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:3px; font-size:0.76rem; font-weight:700; padding:3px 7px; cursor:pointer;">✕</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('textarea').forEach(pinvAutoGrowField);
}

// Delete-only, not add: every row here is tied to a real
// project.customer_po_line_items row via lineId, and
// project_invoice_line_items.po_line_id is NOT NULL + FK'd to that table --
// a freely-typed new row with no backing PO line item would just be
// silently dropped by generatePartialProjectInvoice/generateFinalProjectInvoice
// at submit time, since both only ever bill lines that resolve to a real PO
// line. Removing an existing line from THIS invoice is safe (same effect as
// zeroing its quantity) and keeps pinvCache.lines in step with
// pinvInvoiceState.lineItems since the JC-readiness table above (Ordered
// Qty/JCs Total/etc.) is index-aligned against pinvCache.lines by the same
// idx — re-rendering both via renderPinvDetail() keeps them in sync.
function pinvDeleteLineItem(idx) {
  if (!pinvInvoiceState.lineItems[idx]) return;
  pinvInvoiceState.lineItems.splice(idx, 1);
  pinvCache.lines.splice(idx, 1);
  renderPinvDetail();
}

function updatePinvField(key, value) { pinvInvoiceState[key] = value; }
function updatePinvNested(parentKey, childKey, value) { pinvInvoiceState[parentKey][childKey] = value; }
// ABPS is Maharashtra-based (GSTIN prefix 27) -- a Bill To GST No. also
// starting 27 is an intra-state (same-state) supply, so CGST+SGST applies;
// any other state prefix is inter-state, so IGST applies. Recomputed on
// every keystroke rather than only once, since a corrected GST No. should
// re-derive the default too -- this does mean a manual override of the %
// fields gets reset if the GST No. is edited again afterward, which is the
// intended tradeoff (the operator can always re-adjust the %s after).
function pinvAutoSetGstFromBillToGst(value) {
  updatePinvNested('billTo', 'gstNo', value);
  const isMaharashtra = (value || '').trim().slice(0, 2) === '27';
  pinvInvoiceState.cgstPercent = isMaharashtra ? '9' : '0';
  pinvInvoiceState.sgstPercent = isMaharashtra ? '9' : '0';
  pinvInvoiceState.igstPercent = isMaharashtra ? '0' : '18';
  const cgstEl = document.getElementById('pinv-cgst-input');
  const sgstEl = document.getElementById('pinv-sgst-input');
  const igstEl = document.getElementById('pinv-igst-input');
  if (cgstEl) cgstEl.value = pinvInvoiceState.cgstPercent;
  if (sgstEl) sgstEl.value = pinvInvoiceState.sgstPercent;
  if (igstEl) igstEl.value = pinvInvoiceState.igstPercent;
  recalcPinvTotals();
}
// Switching to Export clears GST% (no GST on an export invoice, enforced
// again server-side in renderProjectInvoiceHTML) and clears the IFSC/Swift
// field, since Swift Code is always typed manually, never carried over from
// whatever IFSC an Import invoice had. Switching back to Import clears the
// USD rate so a stale rate can't accidentally survive into an Import
// invoice's state.
function updatePinvTradeType(value) {
  pinvInvoiceState.tradeType = value;
  if (value === 'Export') {
    pinvInvoiceState.cgstPercent = ""; pinvInvoiceState.sgstPercent = ""; pinvInvoiceState.igstPercent = "";
    pinvInvoiceState.bankDetails.swift = "";
  } else {
    pinvInvoiceState.usdRate = "";
  }
  renderPinvInvoiceForm();
}
function selectPinvBankOption(key) {
  pinvInvoiceState.bankAccountKey = key;
  const o = applyPinvBankOption(key);
  // Beneficiary and Swift Code are left untouched -- Beneficiary is a fixed
  // constant, and Swift Code is always manually typed (never autofilled
  // from a bank option), so switching accounts shouldn't wipe either.
  pinvInvoiceState.bankDetails = { ...pinvInvoiceState.bankDetails, bankName: o.bankName, ifsc: o.ifsc, ac: o.ac, address: o.address, branch: o.branch };
  renderPinvInvoiceForm();
}
function updatePinvLineItem(idx, key, value) {
  const item = pinvInvoiceState.lineItems[idx];
  if (!item) return;
  item[key] = value;
  if (key === 'quantity' || key === 'ratePerQuantity') {
    const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.ratePerQuantity) || 0);
    item.totalBasicPrice = amount;
    const amountEl = document.getElementById(`pinv-amount-${idx}`);
    if (amountEl) amountEl.value = amount;
    recalcPinvTotals();
  }
}

// Export: no GST (enforced regardless of whatever stale %s might be in
// state), and every amount is converted INR-source -> USD by dividing by
// the entered rate before display -- same conversion the backend applies
// at PDF-render time (renderProjectInvoiceHTML), Round Off excluded from
// the divide for the same reason noted there (it's a manual adjustment
// typed directly against the already-converted totals).
function recalcPinvTotals() {
  const items = pinvInvoiceState.lineItems || [];
  const rawSubTotal = items.reduce((sum, it) => sum + (parseFloat(it.totalBasicPrice) || 0), 0);
  const isExport = pinvInvoiceState.tradeType === 'Export';
  const usdRate = parseFloat(pinvInvoiceState.usdRate) || 0;
  const subTotal = (isExport && usdRate > 0) ? rawSubTotal / usdRate : rawSubTotal;
  const roundOff = parseFloat(pinvInvoiceState.roundOff) || 0;
  let grandTotal;
  if (isExport) {
    grandTotal = subTotal + roundOff;
  } else {
    const igstAmount = rawSubTotal * (parseFloat(pinvInvoiceState.igstPercent) || 0) / 100;
    const cgstAmount = rawSubTotal * (parseFloat(pinvInvoiceState.cgstPercent) || 0) / 100;
    const sgstAmount = rawSubTotal * (parseFloat(pinvInvoiceState.sgstPercent) || 0) / 100;
    grandTotal = subTotal + cgstAmount + sgstAmount + igstAmount + roundOff;
  }
  const st = document.getElementById("pinv-subtotal-display");
  const gt = document.getElementById("pinv-grandtotal-display");
  const w = document.getElementById("pinv-words-display");
  const symbol = isExport ? "$" : "₹";
  if (st) st.textContent = symbol + subTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (gt) gt.textContent = symbol + grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (w) w.textContent = isExport ? numberToWordsUSDClient(grandTotal) : numberToWordsINRClient(grandTotal);
}

let pinvSubmitMode = 'partial'; // set by openPinvConfirmModal, read by submitPinvGeneration

function openPinvConfirmModal(mode) {
  if (!pinvInvoiceState?.invoiceNo?.trim()) {
    showBOQBanner("pinv-feedback", "Invoice No. is required before generating.", "error");
    return;
  }
  if ((pinvInvoiceState.lineItems || []).some(li => !(li.hsnNumber || '').toString().trim())) {
    showBOQBanner("pinv-feedback", "HSN Code is required for every invoice line.", "error");
    return;
  }
  if (pinvInvoiceState.tradeType === 'Export' && !(Number(pinvInvoiceState.usdRate) > 0)) {
    showBOQBanner("pinv-feedback", "INR to USD Rate is required when Export is selected.", "error");
    return;
  }
  for (const docType of PINV_REQUIRED_DOC_TYPES) {
    if (!(pinvDocFiles[docType] || []).length) {
      showBOQBanner("pinv-feedback", `${PINV_DOC_META[docType].label} document is required.`, "error");
      return;
    }
  }
  if (document.getElementById("pinv-payment-received").value.trim() !== "Yes") {
    showBOQBanner("pinv-feedback", "Payment Received Confirmation must be set to Yes before this invoice can be generated.", "error");
    return;
  }
  pinvSubmitMode = mode; // 'partial' | 'final'
  const warningEl = document.getElementById("pinv-confirm-warning");
  warningEl.textContent = mode === 'final'
    ? "This will force-close remaining PRNs, release unused reserved stock, and mark the project Complete. This cannot be undone from here."
    : "This bills only the quantities entered above. Project status, PRNs, and stock reservations are left untouched — other products can still be invoiced separately later.";
  document.getElementById("pinv-confirm-title").textContent = mode === 'final' ? "Confirm Final Invoice Generation" : "Confirm Partial Invoice Generation";
  document.getElementById("pinv-confirm-target").textContent = pinvCache.projectId;
  document.getElementById("pinv-confirm-input").value = "";
  document.getElementById("pinv-confirm-submit-btn").disabled = true;
  document.getElementById("pinv-confirm-submit-btn").style.opacity = "0.5";
  document.getElementById("pinv-confirm-submit-btn").style.cursor = "not-allowed";
  document.getElementById("pinv-confirm-modal").style.display = "flex";
}

function closePinvConfirmModal() {
  document.getElementById("pinv-confirm-modal").style.display = "none";
}

function handlePinvConfirmInput() {
  const match = document.getElementById("pinv-confirm-input").value.trim() === pinvCache.projectId;
  const btn = document.getElementById("pinv-confirm-submit-btn");
  btn.disabled = !match;
  btn.style.opacity = match ? "1" : "0.5";
  btn.style.cursor = match ? "pointer" : "not-allowed";
}

async function uploadPinvDoc(file, docLabel) {
  const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
  const upData = await apFetch({
    action: "uploadProjectInvoiceDocument", projectId: pinvCache.projectId, docLabel,
    file: { fileName: file.name, base64Data: b64, mimeType: file.type || "application/octet-stream" },
    operatorName: appActiveOperatorIdentityString || "Unknown",
  });
  return upData.success ? upData.url : "";
}

async function submitPinvGeneration() {
  const confirmProjectId = document.getElementById("pinv-confirm-input").value.trim();
  const paymentReceivedConfirmation = document.getElementById("pinv-payment-received").value.trim();
  closePinvConfirmModal();
  // Re-check required docs right before upload starts -- openPinvConfirmModal
  // already checked this once, but re-verifying here closes any gap where
  // state changed while the confirm modal was open, giving a clear early
  // error instead of a confusing round trip through the upload loop and
  // then the server's own (differently-worded) rejection.
  for (const docType of PINV_REQUIRED_DOC_TYPES) {
    if (!(pinvDocFiles[docType] || []).length) {
      showBOQBanner("pinv-feedback", `${PINV_DOC_META[docType].label} document is required.`, "error");
      return;
    }
  }
  showBlockingOverlay("Uploading documents...");
  try {
    const documents = [];
    for (const docType of Object.keys(PINV_DOC_META)) {
      const files = pinvDocFiles[docType] || [];
      const label = PINV_DOC_META[docType].label;
      for (const file of files) {
        const url = await uploadPinvDoc(file, label);
        if (!url) throw new Error(`Upload failed for "${file.name}" (${label}). Please retry.`);
        documents.push({ docType, fileName: file.name, url });
      }
    }

    const isFinal = pinvSubmitMode === 'final';
    showBlockingOverlay(isFinal ? "Generating Final Invoice and completing project..." : "Generating Partial Invoice...");
    const data = await apFetch({
      action: isFinal ? "generateFinalProjectInvoice" : "generatePartialProjectInvoice",
      projectId: pinvCache.projectId, confirmProjectId,
      operatorName: appActiveOperatorIdentityString || "Unknown", invoice: pinvInvoiceState,
      paymentReceivedConfirmation, documents,
    });
    if (data.success) {
      document.getElementById("pinv-select-zone").style.display = "none";
      document.getElementById("pinv-detail-zone").style.display = "none";
      const successZone = document.getElementById("pinv-success-zone");
      successZone.style.display = "block";
      successZone.innerHTML = `
        <div style="padding:14px; background:#f0fdf4; border-left:4px solid #22c55e; border-radius:var(--radius); color:#15803d; font-weight:600; margin-bottom:14px;">
          ${isFinal ? 'Final' : 'Partial'} Invoice ${data.invoiceNo ? `<strong>${data.invoiceNo}</strong> ` : ''}Generated for Project ID: ${pinvCache.projectId}
        </div>
        <a href="${driveLink(data.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open Invoice Document ↗</a>
        ${data.reviewUrl ? `<br><a href="${driveLink(data.reviewUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; display:inline-block; margin-top:8px;">Open Project Review Document ↗</a>` : ''}
        <div style="margin-top:16px;">
          <button class="nav-btn-styled" style="background:var(--accent); padding:8px 20px; font-weight:700;" onclick="initializePinvWorkspace()">+ Create New Project Invoice</button>
        </div>`;
    } else {
      showBOQBanner("pinv-feedback", data.error || "Failed.", "error");
    }
  } catch(e) {
    showBOQBanner("pinv-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

// ═══════════════════════════════════════════════════════
// REVISE INVOICE — search by Project ID/Customer Name, restricted to
// projects that are Complete with an invoice already on file (NOT the
// shared "active projects" typeahead every other screen uses — that data
// set is the wrong universe entirely for this search). Loads the last
// submitted invoice values back into an editable form, then regenerates
// only the invoice PDF; project status/PRNs/stock/documents are untouched.
// ═══════════════════════════════════════════════════════
let pinvReviseProjectCodes = [];
let pinvReviseProjectMeta = {};
let pinvReviseLoaded = false;
let pinvReviseState = null;
let pinvReviseCache = { invoiceId: null, projectId: "", invoiceType: "", invoiceRevision: 0 };

async function ensurePinvReviseProjectData(forceRefresh = false) {
  if (pinvReviseLoaded && !forceRefresh) return;
  try {
    const data = await apFetch({ action: "fetchInvoicedProjectsForRevise" });
    pinvReviseProjectCodes = (data.projects || []).map(p => p.projectId);
    pinvReviseProjectMeta = {};
    (data.projects || []).forEach(p => { pinvReviseProjectMeta[p.projectId] = { companyName: p.companyName }; });
    pinvReviseLoaded = true;
  } catch(e) {
    pinvReviseProjectCodes = [];
    pinvReviseProjectMeta = {};
  }
}

async function initializePinvReviseWorkspace() {
  document.getElementById("pinv-revise-ta-input").value = "";
  document.getElementById("pinv-revise-ta-dropdown").style.display = "none";
  document.getElementById("pinv-revise-detail-zone").style.display = "none";
  document.getElementById("pinv-revise-history-zone").innerHTML = "";
  document.getElementById("pinv-revise-invoice-form-zone").innerHTML = "";
  document.getElementById("pinv-revise-generate-btn-wrap").style.display = "none";
  document.getElementById("pinv-revise-success-zone").style.display = "none";
  pinvReviseState = null;
  pinvReviseCache = { invoiceId: null, projectId: "", invoiceType: "", invoiceRevision: 0 };
  await ensurePinvReviseProjectData(true);
}

async function handlePinvReviseTypeaheadInput(query) {
  await ensurePinvReviseProjectData();
  const dd = document.getElementById("pinv-revise-ta-dropdown");
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const matches = pinvReviseProjectCodes.filter(p => {
    const companyName = (pinvReviseProjectMeta[p] && pinvReviseProjectMeta[p].companyName) || "";
    return p.toLowerCase().includes(q) || companyName.toLowerCase().includes(q);
  }).slice(0, 10);
  if (matches.length === 0) {
    dd.innerHTML = `<div style="padding:8px 10px; font-size:0.87rem; color:var(--muted);">No completed invoiced projects match.</div>`;
    dd.style.display = "block";
    return;
  }
  dd.innerHTML = matches.map(p => {
    const companyName = (pinvReviseProjectMeta[p] && pinvReviseProjectMeta[p].companyName) || "";
    return `<div onmousedown="event.preventDefault();" onclick="selectPinvReviseProject('${p.replace(/'/g,"\\'")}')"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.88rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;">${p}</span>${companyName ? ` <span style="color:var(--muted);">— ${companyName}</span>` : ''}
    </div>`;
  }).join("");
  dd.style.display = "block";
}

function selectPinvReviseProject(projectId) {
  document.getElementById("pinv-revise-ta-input").value = projectId;
  document.getElementById("pinv-revise-ta-dropdown").style.display = "none";
  loadPinvReviseHistory(projectId);
}

// A project can now carry several invoices (multiple Partials + a Final)
// — show the list first, then load whichever one the user picks into the
// same editable form Revise always used.
async function loadPinvReviseHistory(projectId) {
  const detailZone = document.getElementById("pinv-revise-detail-zone");
  const historyZone = document.getElementById("pinv-revise-history-zone");
  const zone = document.getElementById("pinv-revise-invoice-form-zone");
  detailZone.style.display = "block";
  zone.innerHTML = "";
  // The Generate button only makes sense once a specific invoice has been
  // picked from the history table below (loadPinvReviseForm) — hide it
  // again whenever the history itself (re)loads.
  document.getElementById("pinv-revise-generate-btn-wrap").style.display = "none";
  historyZone.innerHTML = `<div style="text-align:center; padding:14px; color:var(--muted); font-size:0.9rem;">Loading invoice history...</div>`;
  try {
    const data = await apFetch({ action: "fetchProjectInvoiceHistory", projectId });
    if (!data.success || !(data.invoices || []).length) {
      historyZone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.9rem;">${data.error || "No invoices found for this project."}</div>`;
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
            <td style="padding:6px;"><button class="nav-btn-styled" style="background:var(--muted); padding:3px 10px; font-size:0.78rem;" onclick="togglePinvDocuments(${inv.invoiceId})">View</button></td>
            <td style="padding:6px; text-align:right;"><button class="nav-btn-styled" style="background:var(--accent); padding:5px 12px; font-size:0.85rem;" onclick="loadPinvReviseForm(${inv.invoiceId})">Revise</button></td>
          </tr>
          <tr id="pinv-docs-row-${inv.invoiceId}" style="display:none;">
            <td colspan="6" style="padding:4px 6px 10px 6px;"><div id="pinv-docs-zone-${inv.invoiceId}" style="font-size:0.82rem; color:var(--muted);"></div></td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  } catch(e) {
    historyZone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.9rem;">Network error: ${e.message}</div>`;
  }
}

// project.project_invoice_documents was write-only from application code
// before 24 Aug 2026 — this is the first screen that reads it back, so a
// user can actually see what was attached to a given invoice. Toggled
// per-row rather than loaded eagerly with the history table, since most
// invoices in a long history will never need this looked at.
async function togglePinvDocuments(invoiceId) {
  const row = document.getElementById(`pinv-docs-row-${invoiceId}`);
  const zone = document.getElementById(`pinv-docs-zone-${invoiceId}`);
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

async function loadPinvReviseForm(invoiceId) {
  const zone = document.getElementById("pinv-revise-invoice-form-zone");
  zone.innerHTML = `<div style="text-align:center; padding:14px; color:var(--muted); font-size:0.9rem;">Loading current invoice details...</div>`;
  try {
    const data = await apFetch({ action: "fetchProjectInvoiceRevisionPrefillById", invoiceId });
    if (!data.success) {
      zone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.9rem;">${data.error || "Failed to load."}</div>`;
      return;
    }
    pinvReviseCache = { invoiceId: data.invoiceId, projectId: data.projectId, invoiceType: data.invoiceType, invoiceRevision: data.revision || 0 };
    const last = data.lastInvoiceDetails || {};
    pinvReviseState = {
      invoiceNo: last.invoiceNo || "", insuranceNo: last.insuranceNo || "", mdccNo: last.mdccNo || "",
      transportName: last.transportName || "", lrNoDate: last.lrNoDate || "", lcNoDate: last.lcNoDate || "", dcNoDate: last.dcNoDate || "", vehicleNo: last.vehicleNo || "",
      mobileNo: last.mobileNo || "", incoterms: last.incoterms || PINV_INCOTERMS_OPTIONS[0].code, incotermsPlace: last.incotermsPlace || "",
      tradeType: last.tradeType || "Import", usdRate: last.usdRate || "",
      poNumber: data.poNumber || "", poDate: data.poDate || "",
      billTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "", ...(last.billTo || {}) },
      shipTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "", ...(last.shipTo || {}) },
      lineItems: (data.lineItems || []).map(li => ({ ...li })),
      igstPercent: last.igstPercent || "18", cgstPercent: last.cgstPercent || "", sgstPercent: last.sgstPercent || "", roundOff: last.roundOff || "0",
      // Match the prior invoice's bank details back to one of the 3 known
      // accounts by A/C number so the dropdown reflects what was actually
      // used last time; falls back to the default if it doesn't match any
      // (e.g. a hand-edited A/C on an old invoice).
      bankAccountKey: (PINV_BANK_OPTIONS.find(o => o.ac === (last.bankDetails || {}).ac) || PINV_BANK_OPTIONS[0]).key,
      bankDetails: { beneficiary: "ABPS SOLUTION PRIVATE LIMITED", swift: "", ...PINV_STANDARD_BANK_DETAILS, ...(last.bankDetails || {}) },
      declaration: last.declaration || PINV_STANDARD_DECLARATION,
    };
    renderPinvReviseInvoiceForm();
    document.getElementById("pinv-revise-generate-btn-wrap").style.display = "block";
  } catch(e) {
    zone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.9rem;">Network error: ${e.message}</div>`;
  }
}

function renderPinvReviseInvoiceForm() {
  const zone = document.getElementById("pinv-revise-invoice-form-zone");
  const s = pinvReviseState;
  const esc = (v) => (v == null ? '' : v.toString()).replace(/"/g, '&quot;');

  // Auto-growing textarea, same as Generate's field() helper — Revise
  // used to use a plain single-line <input>, which silently clipped a
  // long address/bank-branch value instead of growing to show it.
  const field = (label, key, path) => {
    const val = path ? (s[path[0]][path[1]] || '') : (s[key] || '');
    const setter = path ? `updatePinvReviseNested('${path[0]}','${path[1]}', this.value)` : `updatePinvReviseField('${key}', this.value)`;
    return `<div class="grid-cell-item"><label>${label}</label><textarea rows="1" oninput="${setter}; pinvAutoGrowField(this);" onfocus="pinvAutoGrowField(this);" style="width:100%; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(val)}</textarea></div>`;
  };

  zone.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-top:16px;">
      <div style="font-weight:800; color:var(--brand); margin-bottom:4px; font-size:1rem;">${pinvReviseCache.invoiceType} Invoice ${pinvReviseCache.invoiceId} — Revision V${(pinvReviseCache.invoiceRevision || 0) + 1}</div>
      <div style="font-size:0.87rem; color:var(--muted); margin-bottom:14px;">Prefilled from this specific invoice. Edit anything, then generate the revised doc — this only replaces THIS invoice; other invoices on the project, project status, PRNs, and stock are not touched.</div>

      <div style="display:flex; gap:14px; align-items:flex-end; margin-bottom:14px; flex-wrap:wrap;">
        <div class="grid-cell-item" style="max-width:200px; margin:0;">
          <label>Import / Export</label>
          <select onchange="updatePinvReviseTradeType(this.value)" style="width:100%; padding:6px 4px;">
            <option value="Import" ${s.tradeType !== 'Export' ? 'selected' : ''}>Import</option>
            <option value="Export" ${s.tradeType === 'Export' ? 'selected' : ''}>Export</option>
          </select>
        </div>
        ${s.tradeType === 'Export' ? `
        <div class="grid-cell-item" style="max-width:220px; margin:0;">
          <label>INR to USD Rate</label>
          <input type="number" min="0" step="0.01" placeholder="e.g. 95.3" value="${esc(s.usdRate)}"
            oninput="updatePinvReviseField('usdRate', this.value); recalcPinvReviseTotals();" style="width:100%; padding:6px 4px;" />
        </div>` : ''}
      </div>

      <div class="compact-fields-grid" style="margin-bottom:14px;">
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>Invoice No.</label><div style="padding:6px 4px; font-weight:600; color:var(--brand);" title="A revision keeps the invoice's original number — it's never re-minted or hand-edited here">${s.invoiceNo || '—'}</div></div>
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
        <div class="grid-cell-item"><label>Incoterms</label>
          <select onchange="updatePinvReviseField('incoterms', this.value)" style="width:100%; padding:6px 4px;">
            ${PINV_INCOTERMS_OPTIONS.map(o => `<option value="${o.code}" ${s.incoterms === o.code ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="grid-cell-item"><label>Named Place</label>
          <input type="text" placeholder="e.g. Mumbai Port" value="${esc(s.incotermsPlace)}" oninput="updatePinvReviseField('incotermsPlace', this.value)" style="width:100%; padding:6px 4px;" />
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:#fff;">
          <div style="font-weight:700; color:var(--brand); margin-bottom:8px; font-size:0.88rem;">BILL TO PARTY</div>
          ${field('Name', null, ['billTo','name'])}
          ${field('Address', null, ['billTo','address'])}
          ${field('State', null, ['billTo','state'])}
          <div class="grid-cell-item"><label>GST No.</label><textarea rows="1" oninput="pinvAutoSetReviseGstFromBillToGst(this.value); pinvAutoGrowField(this);" onfocus="pinvAutoGrowField(this);" style="width:100%; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(s.billTo.gstNo || '')}</textarea></div>
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

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.9rem;">Item Details</div>
      <div id="pinv-revise-lineitems-wrap"></div>

      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <div style="width:300px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Sub Total</span>
            <strong id="pinv-revise-subtotal-display">₹0</strong>
          </div>
          ${s.tradeType === 'Export' ? `
          <div style="font-size:0.78rem; color:var(--muted); padding:2px 2px;">No GST for Export invoices.</div>
          ` : `
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">CGST %</span>
            <input id="pinv-revise-cgst-input" type="number" min="0" placeholder="0" value="${esc(s.cgstPercent)}" oninput="updatePinvReviseField('cgstPercent', this.value); recalcPinvReviseTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">SGST %</span>
            <input id="pinv-revise-sgst-input" type="number" min="0" placeholder="0" value="${esc(s.sgstPercent)}" oninput="updatePinvReviseField('sgstPercent', this.value); recalcPinvReviseTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">IGST %</span>
            <input id="pinv-revise-igst-input" type="number" min="0" value="${esc(s.igstPercent)}" oninput="updatePinvReviseField('igstPercent', this.value); recalcPinvReviseTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>`}
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Round Off</span>
            <input type="number" value="${esc(s.roundOff)}" oninput="updatePinvReviseField('roundOff', this.value); recalcPinvReviseTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f0fdf4; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:#15803d; text-transform:uppercase;">Grand Total</span>
            <strong id="pinv-revise-grandtotal-display" style="color:#15803d;">₹0</strong>
          </div>
        </div>
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.9rem;">Bank Details</div>
      <div class="grid-cell-item" style="max-width:320px; margin-bottom:10px;">
        <label>Bank Account</label>
        <select onchange="selectPinvReviseBankOption(this.value)" style="width:100%; padding:6px 4px;">
          ${PINV_BANK_OPTIONS.map(o => `<option value="${o.key}" ${s.bankAccountKey === o.key ? 'selected' : ''}>${o.label}</option>`).join('')}
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
        <textarea rows="4" style="width:100%; padding:8px; font-size:0.85rem; border:1.5px solid var(--border); border-radius:var(--radius);" oninput="updatePinvReviseField('declaration', this.value)">${s.declaration}</textarea>
      </div>

      <div style="margin-top:14px; font-size:0.87rem; color:var(--muted);">Total Invoice Amount in Words: <strong id="pinv-revise-words-display" style="color:var(--text);">—</strong></div>
    </div>
  `;
  renderPinvReviseLineItemsTable();
  recalcPinvReviseTotals();
  zone.querySelectorAll('.grid-cell-item textarea').forEach(pinvAutoGrowField);
}

// Mirrors renderPinvLineItemsTable exactly (same colgroup widths, derived
// readonly Amount, auto-growing textarea for the description, delete-row
// button) — Revise used to be a plain, unwidth-controlled table with a
// hand-editable Amount, which let a revised invoice's Amount silently
// drift from Qty x Rate/Qty.
function renderPinvReviseLineItemsTable() {
  const wrap = document.getElementById("pinv-revise-lineitems-wrap");
  if (!wrap) return;
  const items = pinvReviseState.lineItems || [];
  items.forEach(it => { it.totalBasicPrice = (parseFloat(it.quantity) || 0) * (parseFloat(it.ratePerQuantity) || 0); });
  const cols = PINV_LINEITEM_COLS;
  wrap.innerHTML = `
    <table class="store-basket-data-table" style="min-width:820px; table-layout:fixed;">
      <colgroup><col style="width:3%;" />${cols.map(c => `<col style="width:${c[3]};" />`).join('')}<col style="width:36px;" /></colgroup>
      <thead><tr><th>Sr No</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead>
      <tbody>
        ${items.length === 0 ? `<tr><td colspan="${cols.length + 2}" style="text-align:center; color:var(--muted);">No PO line items found for this project</td></tr>` : items.map((it, idx) => `
          <tr>
            <td style="text-align:center; font-weight:700;">${idx + 1}</td>
            ${cols.map(([key, , type]) => {
              if (key === 'totalBasicPrice') {
                return `<td><input type="number" id="pinv-revise-amount-${idx}" value="${(it[key] ?? '').toString().replace(/"/g, '&quot;')}" readonly
                  style="width:100%; min-width:80px; padding:4px; font-size:0.85rem; background:#f1f5f9; color:var(--muted); cursor:not-allowed;" /></td>`;
              }
              return type === 'text'
                ? `<td><textarea rows="1" oninput="updatePinvReviseLineItem(${idx}, '${key}', this.value); pinvAutoGrowField(this);" onfocus="pinvAutoGrowField(this);" style="width:100%; min-width:80px; padding:4px; font-size:0.85rem; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(it[key] ?? '')}</textarea></td>`
                : `<td><input type="${type}" value="${(it[key] ?? '').toString().replace(/"/g, '&quot;')}" oninput="updatePinvReviseLineItem(${idx}, '${key}', this.value)" style="width:100%; min-width:80px; padding:4px; font-size:0.85rem;" /></td>`;
            }).join('')}
            <td style="text-align:center;"><button type="button" onclick="pinvReviseDeleteLineItem(${idx})" title="Remove this line from the invoice"
              style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:3px; font-size:0.76rem; font-weight:700; padding:3px 7px; cursor:pointer;">✕</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('textarea').forEach(pinvAutoGrowField);
}

function pinvReviseDeleteLineItem(idx) {
  if (!pinvReviseState.lineItems[idx]) return;
  pinvReviseState.lineItems.splice(idx, 1);
  renderPinvReviseLineItemsTable();
  recalcPinvReviseTotals();
}

function updatePinvReviseField(key, value) { pinvReviseState[key] = value; }
function updatePinvReviseNested(parentKey, childKey, value) { pinvReviseState[parentKey][childKey] = value; }
function pinvAutoSetReviseGstFromBillToGst(value) {
  updatePinvReviseNested('billTo', 'gstNo', value);
  const isMaharashtra = (value || '').trim().slice(0, 2) === '27';
  pinvReviseState.cgstPercent = isMaharashtra ? '9' : '0';
  pinvReviseState.sgstPercent = isMaharashtra ? '9' : '0';
  pinvReviseState.igstPercent = isMaharashtra ? '0' : '18';
  const cgstEl = document.getElementById('pinv-revise-cgst-input');
  const sgstEl = document.getElementById('pinv-revise-sgst-input');
  const igstEl = document.getElementById('pinv-revise-igst-input');
  if (cgstEl) cgstEl.value = pinvReviseState.cgstPercent;
  if (sgstEl) sgstEl.value = pinvReviseState.sgstPercent;
  if (igstEl) igstEl.value = pinvReviseState.igstPercent;
  recalcPinvReviseTotals();
}
function updatePinvReviseTradeType(value) {
  pinvReviseState.tradeType = value;
  if (value === 'Export') {
    pinvReviseState.cgstPercent = ""; pinvReviseState.sgstPercent = ""; pinvReviseState.igstPercent = "";
    pinvReviseState.bankDetails.swift = "";
  } else {
    pinvReviseState.usdRate = "";
  }
  renderPinvReviseInvoiceForm();
}
function selectPinvReviseBankOption(key) {
  pinvReviseState.bankAccountKey = key;
  const o = applyPinvBankOption(key);
  pinvReviseState.bankDetails = { ...pinvReviseState.bankDetails, bankName: o.bankName, ifsc: o.ifsc, ac: o.ac, address: o.address, branch: o.branch };
  renderPinvReviseInvoiceForm();
}
function updatePinvReviseLineItem(idx, key, value) {
  const item = pinvReviseState.lineItems[idx];
  if (!item) return;
  item[key] = value;
  if (key === 'quantity' || key === 'ratePerQuantity') {
    const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.ratePerQuantity) || 0);
    item.totalBasicPrice = amount;
    const amountEl = document.getElementById(`pinv-revise-amount-${idx}`);
    if (amountEl) amountEl.value = amount;
    recalcPinvReviseTotals();
  }
}

function recalcPinvReviseTotals() {
  const items = pinvReviseState.lineItems || [];
  const rawSubTotal = items.reduce((sum, it) => sum + (parseFloat(it.totalBasicPrice) || 0), 0);
  const isExport = pinvReviseState.tradeType === 'Export';
  const usdRate = parseFloat(pinvReviseState.usdRate) || 0;
  const subTotal = (isExport && usdRate > 0) ? rawSubTotal / usdRate : rawSubTotal;
  const roundOff = parseFloat(pinvReviseState.roundOff) || 0;
  let grandTotal;
  if (isExport) {
    grandTotal = subTotal + roundOff;
  } else {
    const igstAmount = rawSubTotal * (parseFloat(pinvReviseState.igstPercent) || 0) / 100;
    const cgstAmount = rawSubTotal * (parseFloat(pinvReviseState.cgstPercent) || 0) / 100;
    const sgstAmount = rawSubTotal * (parseFloat(pinvReviseState.sgstPercent) || 0) / 100;
    grandTotal = subTotal + cgstAmount + sgstAmount + igstAmount + roundOff;
  }
  const st = document.getElementById("pinv-revise-subtotal-display");
  const gt = document.getElementById("pinv-revise-grandtotal-display");
  const w = document.getElementById("pinv-revise-words-display");
  const symbol = isExport ? "$" : "₹";
  if (st) st.textContent = symbol + subTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (gt) gt.textContent = symbol + grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (w) w.textContent = isExport ? numberToWordsUSDClient(grandTotal) : numberToWordsINRClient(grandTotal);
}

function openPinvReviseConfirmModal() {
  if (!pinvReviseState?.invoiceNo?.trim()) {
    showBOQBanner("pinv-feedback", "Invoice No. is required before generating.", "error");
    return;
  }
  if ((pinvReviseState.lineItems || []).some(li => !(li.hsnNumber || '').toString().trim())) {
    showBOQBanner("pinv-feedback", "HSN Code is required for every invoice line.", "error");
    return;
  }
  if (pinvReviseState.tradeType === 'Export' && !(Number(pinvReviseState.usdRate) > 0)) {
    showBOQBanner("pinv-feedback", "INR to USD Rate is required when Export is selected.", "error");
    return;
  }
  document.getElementById("pinv-revise-confirm-target").textContent = pinvReviseCache.projectId;
  document.getElementById("pinv-revise-confirm-input").value = "";
  document.getElementById("pinv-revise-confirm-submit-btn").disabled = true;
  document.getElementById("pinv-revise-confirm-submit-btn").style.opacity = "0.5";
  document.getElementById("pinv-revise-confirm-submit-btn").style.cursor = "not-allowed";
  document.getElementById("pinv-revise-confirm-modal").style.display = "flex";
}

function closePinvReviseConfirmModal() {
  document.getElementById("pinv-revise-confirm-modal").style.display = "none";
}

function handlePinvReviseConfirmInput() {
  const match = document.getElementById("pinv-revise-confirm-input").value.trim() === pinvReviseCache.projectId;
  const btn = document.getElementById("pinv-revise-confirm-submit-btn");
  btn.disabled = !match;
  btn.style.opacity = match ? "1" : "0.5";
  btn.style.cursor = match ? "pointer" : "not-allowed";
}

async function submitPinvRevision() {
  const confirmProjectId = document.getElementById("pinv-revise-confirm-input").value.trim();
  if (confirmProjectId !== pinvReviseCache.projectId) return;
  closePinvReviseConfirmModal();
  showBlockingOverlay("Generating revised invoice...");
  try {
    const data = await apFetch({
      action: "reviseProjectInvoiceById", invoiceId: pinvReviseCache.invoiceId,
      operatorName: appActiveOperatorIdentityString || "Unknown", invoice: pinvReviseState,
    });
    if (data.success) {
      document.getElementById("pinv-revise-select-zone").style.display = "none";
      document.getElementById("pinv-revise-detail-zone").style.display = "none";
      const successZone = document.getElementById("pinv-revise-success-zone");
      successZone.style.display = "block";
      successZone.innerHTML = `
        <div style="padding:14px; background:#f0fdf4; border-left:4px solid #22c55e; border-radius:var(--radius); color:#15803d; font-weight:600; margin-bottom:14px;">
          Invoice Revised (V${data.revision}) for Project ID: ${pinvReviseCache.projectId}
        </div>
        <a href="${driveLink(data.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open Revised Invoice Document ↗</a>
        <div style="margin-top:16px;">
          <button class="nav-btn-styled" style="background:var(--accent); padding:8px 20px; font-weight:700;" onclick="initializePinvReviseWorkspace(); document.getElementById('pinv-revise-select-zone').style.display='block';">+ Revise Another Invoice</button>
        </div>`;
    } else {
      showBOQBanner("pinv-feedback", data.error || "Failed.", "error");
    }
  } catch(e) {
    showBOQBanner("pinv-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

let _submitFGAddItemInProgress = false;
