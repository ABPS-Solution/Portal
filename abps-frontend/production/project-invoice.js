let pinvInvoiceState = null;

async function initializePinvWorkspace() {
  document.getElementById("pinv-feedback").style.display = "none";
  document.getElementById("pinv-detail-zone").style.display = "none";
  document.getElementById("pinv-invoice-form-zone").style.display = "none";
  document.getElementById("pinv-invoice-form-zone").innerHTML = "";
  document.getElementById("pinv-success-zone").style.display = "none";
  document.getElementById("pinv-select-zone").style.display = "block";
  pinvInvoiceState = null;
  const select = document.getElementById("pinv-project-select");
  select.innerHTML = '<option value="">Loading...</option>';
  try {
    const data = await apFetch({ action: "fetchInvoiceEligibleProjects" });
    if (!data.success) { select.innerHTML = '<option value="">Failed to load</option>'; return; }
    select.innerHTML = '<option value="">— Select Project ID —</option>' +
      data.projects.map(p => `<option value="${p.projectId}">${p.projectId} — ${p.companyName || ''}</option>`).join("");
    if (data.projects.length === 0) {
      select.innerHTML = '<option value="">No eligible Project IDs. All Job Cards for a project must be Added to FG first</option>';
    }
  } catch(e) {
    select.innerHTML = '<option value="">Network error</option>';
  }
}

async function handlePinvProjectChange(projectId) {
  const detailZone = document.getElementById("pinv-detail-zone");
  const invoiceFormZone = document.getElementById("pinv-invoice-form-zone");
  if (!projectId) { detailZone.style.display = "none"; invoiceFormZone.style.display = "none"; invoiceFormZone.innerHTML = ""; return; }
  detailZone.style.display = "block";
  invoiceFormZone.style.display = "none";
  invoiceFormZone.innerHTML = "";
  document.getElementById("pinv-jc-body").innerHTML = '<tr><td colspan="3" style="padding:14px; text-align:center;">Loading...</td></tr>';
  document.getElementById("pinv-blockers").style.display = "none";
  document.getElementById("pinv-generate-zone").style.display = "none";
  try {
    const data = await apFetch({ action: "fetchProjectInvoiceDetail", projectId });
    if (!data.success) { showBOQBanner("pinv-feedback", data.error || "Failed to load.", "error"); return; }
    pinvCache = data;
    renderPinvDetail();
  } catch(e) {
    showBOQBanner("pinv-feedback", "Network error: " + e.message, "error");
  }
}

function renderPinvDetail() {
  const body = document.getElementById("pinv-jc-body");
  const jcByBoq = {};
  pinvCache.jobCards.forEach(jc => { (jcByBoq[jc.boqId] = jcByBoq[jc.boqId] || []).push(jc); });
  body.innerHTML = pinvCache.boqs.map(b => {
    const jcs = jcByBoq[b.boqId] || [];
    if (jcs.length === 0) {
      return `<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">${b.boqId}</td><td style="padding:8px; color:var(--warn); font-weight:700;" colspan="2">⚠ No Job Cards found for this BOQ</td></tr>`;
    }
    return jcs.map((jc, i) => {
      const useLabel = jc.finishedGoodUse === 'Use in other Product' ? 'Used in other Product'
                      : jc.finishedGoodUse === 'Keep in FG Store' ? 'Ready for Dispatch' : '—';
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px;">${i === 0 ? b.boqId : ''}</td>
        <td style="padding:8px;">✅ JC_Set${jc.setNumber}</td>
        <td style="padding:8px;">${useLabel}</td>
      </tr>`;
    }).join("");
  }).join("");

  const blockersDiv = document.getElementById("pinv-blockers");
  const msgs = [];
  if (pinvCache.pendingTicketsCount > 0) msgs.push(`${pinvCache.pendingTicketsCount} pending store ticket(s) exist for this project's job cards — resolve them first.`);
  if (pinvCache.pendingBoqIncreaseCount > 0) msgs.push(`${pinvCache.pendingBoqIncreaseCount} open BOQ Increase Request(s) exist for this project — resolve them first.`);
  if (msgs.length > 0) {
    blockersDiv.style.display = "block";
    blockersDiv.innerHTML = msgs.map(m => `<div style="padding:12px; margin-bottom:8px; background:#fff5f5; border-left:4px solid #e53e3e; border-radius:var(--radius); color:#b91c1c; font-weight:600;">${m}</div>`).join("");
    document.getElementById("pinv-generate-zone").style.display = "none";
    document.getElementById("pinv-invoice-form-zone").style.display = "none";
  } else {
    blockersDiv.style.display = "none";
    document.getElementById("pinv-generate-zone").style.display = "block";
    loadPinvInvoiceForm();
  }
}

// ═══════════════════════════════════════════════════════
// INVOICE DETAILS — prefilled from the project/PO line items, fully
// editable before Generate Invoice Doc. Bank Details and Declaration
// start from fixed standard values every time this loads fresh (never
// persisted) — editing them only affects the invoice being generated
// right now; the next invoice starts from the same standards again.
// ═══════════════════════════════════════════════════════
const PINV_STANDARD_BANK_DETAILS = {
  bankName: "Bank Of India", ifsc: "BKID0000514", ac: "051430110000209",
  address: "Fergusson College Road, 1201 C A Shivagi nagar, Pune-411004",
  branch: "Fergusson Road Branch, Code:-00051",
};
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

async function loadPinvInvoiceForm() {
  const zone = document.getElementById("pinv-invoice-form-zone");
  zone.style.display = "block";
  zone.innerHTML = `<div style="text-align:center; padding:14px; color:var(--muted); font-size:0.85rem;">Loading invoice details...</div>`;
  try {
    const data = await apFetch({ action: "fetchProjectInvoicePrefill", projectId: pinvCache.projectId });
    if (!data.success) { zone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.85rem;">${data.error || "Failed to load invoice prefill."}</div>`; return; }

    pinvInvoiceState = {
      invoiceNo: "", insuranceNo: "", mdccNo: "", transportName: "", lrNoDate: "", vehicleNo: "", mobileNo: "", freight: "",
      poNumber: data.poNumber || "", poDate: data.poDate || "",
      billTo: { name: "", address: "", state: "", gstNo: "", contactNo: "" },
      shipTo: { name: "", address: "", state: "", gstNo: "", contactNo: "" },
      lineItems: (data.lineItems || []).map(li => ({ ...li })),
      igstPercent: "18",
      bankDetails: { ...PINV_STANDARD_BANK_DETAILS },
      declaration: PINV_STANDARD_DECLARATION,
    };
    renderPinvInvoiceForm();
  } catch(e) {
    zone.innerHTML = `<div style="padding:12px; color:#b91c1c; font-size:0.85rem;">Network error: ${e.message}</div>`;
  }
}

function renderPinvInvoiceForm() {
  const zone = document.getElementById("pinv-invoice-form-zone");
  const s = pinvInvoiceState;
  const today = new Date();
  const todayDMY = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
  const esc = (v) => (v == null ? '' : v.toString()).replace(/"/g, '&quot;');

  const field = (label, key, path) => {
    const val = path ? (s[path[0]][path[1]] || '') : (s[key] || '');
    const setter = path ? `updatePinvNested('${path[0]}','${path[1]}', this.value)` : `updatePinvField('${key}', this.value)`;
    return `<div class="grid-cell-item"><label>${label}</label><input type="text" value="${esc(val)}" oninput="${setter}" /></div>`;
  };

  zone.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-top:16px;">
      <div style="font-weight:800; color:var(--brand); margin-bottom:4px; font-size:0.95rem;">Invoice Details</div>
      <div style="font-size:0.8rem; color:var(--muted); margin-bottom:14px;">Fill in what the invoice needs, edit any product row if needed, then Generate Invoice Doc.</div>

      <div class="compact-fields-grid" style="margin-bottom:14px;">
        ${field('Invoice No. *', 'invoiceNo')}
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>Date</label><div style="padding:6px 4px; font-weight:600;">${todayDMY}</div></div>
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>P.O. No.</label><div style="padding:6px 4px; font-weight:600;">${s.poNumber || '—'}</div></div>
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>PO Date</label><div style="padding:6px 4px; font-weight:600;">${s.poDate || '—'}</div></div>
        ${field('Insurance No.', 'insuranceNo')}
        ${field('MDCC NO', 'mdccNo')}
        ${field('Transport Name', 'transportName')}
        ${field('LR No & Date', 'lrNoDate')}
        ${field('Vehicle No.', 'vehicleNo')}
        ${field('Mobile No', 'mobileNo')}
        ${field('Freight', 'freight')}
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:#fff;">
          <div style="font-weight:700; color:var(--brand); margin-bottom:8px; font-size:0.82rem;">BILL TO PARTY</div>
          ${field('Name', null, ['billTo','name'])}
          ${field('Address', null, ['billTo','address'])}
          ${field('State', null, ['billTo','state'])}
          ${field('GST No.', null, ['billTo','gstNo'])}
          ${field('Contact No.', null, ['billTo','contactNo'])}
        </div>
        <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:#fff;">
          <div style="font-weight:700; color:var(--brand); margin-bottom:8px; font-size:0.82rem;">SHIP TO PARTY</div>
          ${field('Name', null, ['shipTo','name'])}
          ${field('Address', null, ['shipTo','address'])}
          ${field('State', null, ['shipTo','state'])}
          ${field('GST No.', null, ['shipTo','gstNo'])}
          ${field('Contact No.', null, ['shipTo','contactNo'])}
        </div>
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.85rem;">Item Details</div>
      <div id="pinv-lineitems-wrap"></div>

      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <div style="width:300px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.78rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Sub Total</span>
            <strong id="pinv-subtotal-display">₹0</strong>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.78rem; font-weight:700; color:var(--muted); text-transform:uppercase;">IGST %</span>
            <input type="number" value="${esc(s.igstPercent)}" oninput="updatePinvField('igstPercent', this.value); recalcPinvTotals();" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f0fdf4; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.78rem; font-weight:700; color:#15803d; text-transform:uppercase;">Grand Total</span>
            <strong id="pinv-grandtotal-display" style="color:#15803d;">₹0</strong>
          </div>
        </div>
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.85rem;">Bank Details</div>
      <div class="compact-fields-grid">
        ${field('Bank Name', null, ['bankDetails','bankName'])}
        ${field('IFSC Code For RTGS/NEFT', null, ['bankDetails','ifsc'])}
        ${field('A/C', null, ['bankDetails','ac'])}
        ${field('Address', null, ['bankDetails','address'])}
        ${field('Branch Name & Code', null, ['bankDetails','branch'])}
      </div>

      <div style="margin-top:14px;">
        <label class="field-label" style="margin-top:0;">Declaration</label>
        <textarea rows="4" style="width:100%; padding:8px; font-size:0.78rem; border:1.5px solid var(--border); border-radius:var(--radius);" oninput="updatePinvField('declaration', this.value)">${s.declaration}</textarea>
      </div>

      <div style="margin-top:14px; font-size:0.8rem; color:var(--muted);">Total Invoice Amount in Words: <strong id="pinv-words-display" style="color:var(--text);">—</strong></div>
    </div>
  `;
  renderPinvLineItemsTable();
  recalcPinvTotals();
}

function renderPinvLineItemsTable() {
  const wrap = document.getElementById("pinv-lineitems-wrap");
  if (!wrap) return;
  const items = pinvInvoiceState.lineItems || [];
  const cols = [
    ['description', 'Description', 'text'], ['hsnNumber', 'HSN Code', 'text'], ['quantity', 'Qty', 'number'],
    ['unit', 'Unit', 'text'], ['ratePerQuantity', 'Rate', 'number'], ['totalBasicPrice', 'Amount', 'number'],
  ];
  wrap.innerHTML = `
    <table class="store-basket-data-table" style="min-width:820px;">
      <thead><tr><th>Sr No</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead>
      <tbody>
        ${items.length === 0 ? `<tr><td colspan="${cols.length + 1}" style="text-align:center; color:var(--muted);">No PO line items found for this project</td></tr>` : items.map((it, idx) => `
          <tr>
            <td style="text-align:center; font-weight:700;">${idx + 1}</td>
            ${cols.map(([key, , type]) => `<td><input type="${type}" value="${(it[key] ?? '').toString().replace(/"/g, '&quot;')}" oninput="updatePinvLineItem(${idx}, '${key}', this.value)" style="width:100%; min-width:80px; padding:4px; font-size:0.78rem;" /></td>`).join('')}
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function updatePinvField(key, value) { pinvInvoiceState[key] = value; }
function updatePinvNested(parentKey, childKey, value) { pinvInvoiceState[parentKey][childKey] = value; }
function updatePinvLineItem(idx, key, value) {
  if (!pinvInvoiceState.lineItems[idx]) return;
  pinvInvoiceState.lineItems[idx][key] = value;
  if (key === 'totalBasicPrice') recalcPinvTotals();
}

function recalcPinvTotals() {
  const items = pinvInvoiceState.lineItems || [];
  const subTotal = items.reduce((sum, it) => sum + (parseFloat(it.totalBasicPrice) || 0), 0);
  const igstPercent = parseFloat(pinvInvoiceState.igstPercent) || 0;
  const igstAmount = subTotal * igstPercent / 100;
  const grandTotal = subTotal + igstAmount;
  const st = document.getElementById("pinv-subtotal-display");
  const gt = document.getElementById("pinv-grandtotal-display");
  const w = document.getElementById("pinv-words-display");
  if (st) st.textContent = "₹" + subTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (gt) gt.textContent = "₹" + grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (w) w.textContent = numberToWordsINRClient(grandTotal);
}

function openPinvConfirmModal() {
  if (!pinvInvoiceState?.invoiceNo?.trim()) {
    showBOQBanner("pinv-feedback", "Invoice No. is required before generating.", "error");
    return;
  }
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

async function submitPinvGeneration() {
  const confirmProjectId = document.getElementById("pinv-confirm-input").value.trim();
  closePinvConfirmModal();
  showBlockingOverlay("Generating invoice and completing project...");
  try {
    const data = await apFetch({
      action: "generateProjectInvoiceAndComplete", projectId: pinvCache.projectId, confirmProjectId,
      operatorName: appActiveOperatorIdentityString || "Unknown", invoice: pinvInvoiceState,
    });
    if (data.success) {
      document.getElementById("pinv-select-zone").style.display = "none";
      document.getElementById("pinv-detail-zone").style.display = "none";
      const successZone = document.getElementById("pinv-success-zone");
      successZone.style.display = "block";
      successZone.innerHTML = `
        <div style="padding:14px; background:#f0fdf4; border-left:4px solid #22c55e; border-radius:var(--radius); color:#15803d; font-weight:600; margin-bottom:14px;">
          Invoice Generated for Project ID: ${pinvCache.projectId}
        </div>
        <a href="${driveLink(data.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open Invoice Document ↗</a>
        <br>
        <a href="${driveLink(data.reviewUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; display:inline-block; margin-top:8px;">Open Project Review Document ↗</a>
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

let _submitFGAddItemInProgress = false;
