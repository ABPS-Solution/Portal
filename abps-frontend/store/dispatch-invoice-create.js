// ═══════════════════════════════════════════════════════════════════════
// store/dispatch-invoice-create.js — Create Project Dispatch Invoice
// (migration 208, 19 Sep 2026). Two tabs: New (draft a fresh invoice) and
// Pending Invoices (Editing) (edit/reprint your own drafts). Mirrors
// purchase/po.js's switchCreatePOTab('new'|'editing') shape.
//
// A draft RESERVES units (Job Cards claimed via invoiced_in_invoice_id)
// but commits nothing — no invoice number, no Dispatched status, no
// project completion. Submitting here always ends with a watermarked
// checking draft, never the real invoice PDF; that only exists once
// Authorize Project Dispatch Invoice commits it.
// ═══════════════════════════════════════════════════════════════════════

let cpdiInvoiceState = null;
let cpdiCache = null;
// Tracks which rendered table (New form vs. an expanded Editing card) is
// currently live, so updateCpdiLineItem's readonly Amount-cell sync
// targets the right DOM id regardless of which one last rendered.
let cpdiActiveIdPrefix = 'cpdi';
let cpdiAllLines = [];
let cpdiDocFiles = {};

function cpdiResetDocFiles() {
  cpdiDocFiles = {};
  Object.keys(PDI_DOC_META).forEach(t => { cpdiDocFiles[t] = []; cpdiRenderFileList(t); });
}
cpdiResetDocFiles();

function cpdiHandleFileSelectionMulti(input, type) {
  const files = [...(input.files || [])];
  input.value = "";
  if (files.length === 0 || !PDI_DOC_META[type]) return;
  cpdiDocFiles[type].push(...files);
  cpdiRenderFileList(type);
}
function cpdiRemoveFile(type, idx) {
  if (!cpdiDocFiles[type]) return;
  cpdiDocFiles[type].splice(idx, 1);
  cpdiRenderFileList(type);
}
function cpdiRenderFileList(type) {
  const meta = PDI_DOC_META[type];
  if (!meta) return;
  const files = cpdiDocFiles[type] || [];
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
      <span onclick="cpdiRemoveFile('${type}', ${i})" style="cursor:pointer; color:#b91c1c; font-weight:700; flex-shrink:0;" title="Remove">✕</span>
    </div>`).join("");
}

// ── Tabs ─────────────────────────────────────────────────────────────
function switchCreatePdiTab(tab) {
  const isNew = tab === 'new';
  const tabsBar = document.getElementById("cpdi-tab-new")?.parentElement;
  if (tabsBar) tabsBar.style.display = "flex";
  document.getElementById("cpdi-new-section").style.display = isNew ? "" : "none";
  document.getElementById("cpdi-editing-section").style.display = isNew ? "none" : "";
  const on = (id) => { const el = document.getElementById(id); if (el) { el.style.background = "var(--accent)"; el.style.color = "#fff"; } };
  const off = (id) => { const el = document.getElementById(id); if (el) { el.style.background = "#e2e8f0"; el.style.color = "var(--text)"; } };
  if (isNew) { on("cpdi-tab-new"); off("cpdi-tab-editing"); initializeCpdiWorkspace(); }
  else { off("cpdi-tab-new"); on("cpdi-tab-editing"); initializeCpdiEditingTab(); }
}

// ── New tab ──────────────────────────────────────────────────────────
async function initializeCpdiWorkspace() {
  document.getElementById("cpdi-feedback").style.display = "none";
  document.getElementById("cpdi-detail-zone").style.display = "none";
  document.getElementById("cpdi-invoice-form-zone").style.display = "none";
  document.getElementById("cpdi-invoice-form-zone").innerHTML = "";
  document.getElementById("cpdi-documents-zone").style.display = "none";
  document.getElementById("cpdi-payment-received").value = "No";
  cpdiResetDocFiles();
  document.getElementById("cpdi-success-zone").style.display = "none";
  document.getElementById("cpdi-select-zone").style.display = "block";
  cpdiInvoiceState = null;
  cpdiCache = null;
  const select = document.getElementById("cpdi-project-select");
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

async function handleCpdiProjectChange(projectId) {
  const detailZone = document.getElementById("cpdi-detail-zone");
  const invoiceFormZone = document.getElementById("cpdi-invoice-form-zone");
  if (!projectId) { detailZone.style.display = "none"; invoiceFormZone.style.display = "none"; invoiceFormZone.innerHTML = ""; return; }
  if (cpdiCache && cpdiCache.projectId === projectId) return;
  detailZone.style.display = "block";
  invoiceFormZone.style.display = "none";
  invoiceFormZone.innerHTML = "";
  document.getElementById("cpdi-documents-zone").style.display = "none";
  document.getElementById("cpdi-payment-received").value = "No";
  cpdiResetDocFiles();
  document.getElementById("cpdi-jc-body").innerHTML = '<tr><td colspan="6" style="padding:14px; text-align:center;">Loading...</td></tr>';
  document.getElementById("cpdi-generate-zone").style.display = "none";
  try {
    const lineData = await apFetch({ action: "fetchProjectInvoiceLineDetail", projectId });
    if (!lineData.success) { showBOQBanner("cpdi-feedback", lineData.error || "Failed to load.", "error"); return; }
    cpdiAllLines = lineData.lines.slice();
    cpdiCache = { projectId, lines: lineData.lines };
    cpdiInitInvoiceStateFromLines();
    cpdiRenderDetail();
  } catch(e) {
    showBOQBanner("cpdi-feedback", "Network error: " + e.message, "error");
  }
}

function cpdiInitInvoiceStateFromLines() {
  cpdiInvoiceState = {
    insuranceNo: "", mdccNo: "", transportName: "", lrNoDate: "", lcNoDate: "", dcNoDate: "", vehicleNo: "", mobileNo: "", freightText: "",
    incoterms: "", incotermsPlace: "", tradeType: "Local", usdRate: "",
    billTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "" },
    shipTo: { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "" },
    lineItems: cpdiCache.lines.map(l => {
      const qty = l.boqId ? l.readyToInvoiceQty : 0;
      return { lineId: l.lineId, description: l.description, hsnNumber: l.hsnNumber, unit: l.unit,
        quantity: qty, ratePerQuantity: l.ratePerQuantity, totalBasicPrice: qty * (parseFloat(l.ratePerQuantity) || 0) };
    }),
    igstPercent: "18", cgstPercent: "", sgstPercent: "", roundOff: "0", freightAmount: "0", othersAmount: "0",
    bankAccountKey: PDI_BANK_OPTIONS[0].key,
    bankDetails: { beneficiary: "ABPS SOLUTION PRIVATE LIMITED", swift: "", ...PDI_STANDARD_BANK_DETAILS },
    declaration: PDI_STANDARD_DECLARATION,
  };
}

function showCpdiReadySerials(idx) {
  const l = cpdiCache.lines[idx];
  if (!l || !(l.readySerials || []).length) return;
  const lines = l.readySerials.map(s => `${s.jobCardNumber} — Serial No.: ${s.serialNumber || '(not recorded)'}`);
  alert(`${l.productName || l.description}\n\nJob Cards / Product Serial Numbers that would be reserved:\n\n${lines.join('\n')}`);
}

function cpdiRenderDetail() {
  const body = document.getElementById("cpdi-jc-body");
  body.innerHTML = cpdiCache.lines.map((l, idx) => {
    const hasBoq = !!l.boqId;
    const blockerMsgs = [];
    if (l.pendingTicketsCount > 0) blockerMsgs.push(`${l.pendingTicketsCount} pending store ticket(s)`);
    if (l.pendingBoqIncreaseCount > 0) blockerMsgs.push(`${l.pendingBoqIncreaseCount} open BOQ Increase Request(s)`);
    const maxQty = hasBoq ? l.readyToInvoiceQty : l.orderedQuantity;
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px;">${l.productName || l.description}${blockerMsgs.length ? `<div style="color:#b91c1c; font-size:0.78rem; font-weight:700; margin-top:2px;">⚠ ${blockerMsgs.join(', ')} — this product is blocked</div>` : ''}</td>
      <td style="padding:8px; text-align:center;">${hasBoq ? l.orderedQuantity : '—'}</td>
      <td style="padding:8px; text-align:center;">${hasBoq ? l.alreadyInvoicedQty : '—'}</td>
      <td style="padding:8px; text-align:center; font-weight:700; color:${maxQty > 0 ? '#15803d' : 'var(--muted)'};">${hasBoq ? l.readyToInvoiceQty : 'Final only'}${(hasBoq && (l.readySerials || []).length) ? `<div><a href="javascript:void(0)" onclick="showCpdiReadySerials(${idx})" style="font-size:0.72rem; font-weight:600; color:var(--brand);">View Job Cards / Serial Nos.</a></div>` : ''}</td>
      <td style="padding:8px; text-align:center;">
        <input type="number" min="0" max="${maxQty}" ${cpdiInvoiceState.lineItems[idx].quantity > 0 ? `value="${cpdiInvoiceState.lineItems[idx].quantity}"` : `value="" placeholder="0"`}
          ${blockerMsgs.length ? 'disabled' : ''}
          oninput="updateCpdiClaimQty(${idx}, this.value, ${maxQty}, this)"
          style="width:70px; text-align:center; padding:4px; font-size:0.87rem;" />
      </td>
    </tr>`;
  }).join("");
  document.getElementById("cpdi-generate-zone").style.display = "flex";
  document.getElementById("cpdi-documents-zone").style.display = "block";
  cpdiRenderInvoiceForm();
  updateCpdiGenerateButtonsState();
}

function updateCpdiClaimQty(idx, value, maxQty, inputEl) {
  const qty = Math.max(0, Math.min(Number(value) || 0, maxQty));
  const li = cpdiInvoiceState.lineItems[idx];
  li.quantity = qty;
  li.totalBasicPrice = qty * (parseFloat(li.ratePerQuantity) || 0);
  if (inputEl && Number(inputEl.value) !== qty) inputEl.value = qty > 0 ? qty : '';
  cpdiRenderLineItemsTable();
  recalcPdiTotals(cpdiInvoiceState, 'cpdi');
  updateCpdiGenerateButtonsState();
}

function updateCpdiGenerateButtonsState() {
  const partialBtn = document.getElementById("cpdi-generate-partial-btn");
  const finalBtn = document.getElementById("cpdi-generate-final-btn");
  const reasonEl = document.getElementById("cpdi-generate-reason");
  if (!partialBtn || !finalBtn) return;
  const anyQty = (cpdiInvoiceState.lineItems || []).some(li => Number(li.quantity) > 0);
  const blockedLines = cpdiCache.lines.filter(l => l.pendingTicketsCount > 0 || l.pendingBoqIncreaseCount > 0);
  const anyBlocked = blockedLines.length > 0;
  partialBtn.disabled = !anyQty || anyBlocked;
  partialBtn.style.opacity = partialBtn.disabled ? "0.5" : "1";
  partialBtn.style.cursor = partialBtn.disabled ? "not-allowed" : "pointer";

  const boqLines = cpdiCache.lines.filter(l => l.boqId);
  const unsettledLines = boqLines.filter(l =>
    !(l.jcTotal > 0 && l.jcQaPassed === l.jcTotal && (l.alreadyInvoicedQty + l.readyToInvoiceQty) >= l.orderedQuantity)
  );
  const allSettled = unsettledLines.length === 0;
  finalBtn.disabled = !allSettled || anyBlocked;
  finalBtn.style.opacity = finalBtn.disabled ? "0.5" : "1";
  finalBtn.style.cursor = finalBtn.disabled ? "not-allowed" : "pointer";

  const partialReasons = [];
  if (anyBlocked) partialReasons.push(`${blockedLines.length} product(s) blocked by pending store tickets/BOQ Increase Requests`);
  if (!anyQty) partialReasons.push(`Qty to Bill Now is 0 for every product`);
  const finalReasons = [];
  if (anyBlocked) finalReasons.push(`${blockedLines.length} product(s) blocked by pending store tickets/BOQ Increase Requests`);
  unsettledLines.forEach(l => {
    const name = l.productName || l.description || 'This product';
    if (!(l.jcTotal > 0)) finalReasons.push(`${name}: no Job Card exists yet`);
    else if (l.jcQaPassed !== l.jcTotal) finalReasons.push(`${name}: ${l.jcTotal - l.jcQaPassed} of ${l.jcTotal} Job Card(s) not yet QA-passed`);
    else if ((l.alreadyInvoicedQty + l.readyToInvoiceQty) < l.orderedQuantity) finalReasons.push(`${name}: only ${l.alreadyInvoicedQty + l.readyToInvoiceQty} of ${l.orderedQuantity} ordered qty invoiced/ready`);
  });
  if (reasonEl) {
    const shown = !partialBtn.disabled ? finalReasons : [...new Set([...partialReasons, ...finalReasons])];
    reasonEl.textContent = shown.length ? `⚠️ ${shown.join(' · ')}` : '';
  }
}

function cpdiRenderInvoiceForm() {
  const zone = document.getElementById("cpdi-invoice-form-zone");
  zone.style.display = "block";
  const s = cpdiInvoiceState;
  const esc = (v) => (v == null ? '' : v.toString()).replace(/"/g, '&quot;');
  const field = (label, key, path) => {
    const val = path ? (s[path[0]][path[1]] || '') : (s[key] || '');
    const setter = path ? `updateCpdiNested('${path[0]}','${path[1]}', this.value)` : `updateCpdiField('${key}', this.value)`;
    return `<div class="grid-cell-item"><label>${label}</label><textarea rows="1" oninput="${setter}; pdiAutoGrowField(this);" onfocus="pdiAutoGrowField(this);" style="width:100%; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(val)}</textarea></div>`;
  };

  zone.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-top:16px;">
      <div style="font-weight:800; color:var(--brand); margin-bottom:4px; font-size:1rem;">Invoice Details</div>
      <div style="font-size:0.87rem; color:var(--muted); margin-bottom:14px;">Fill in what the invoice needs. This creates a DRAFT — the invoice number is minted only when it's authorized.</div>

      <div style="display:flex; gap:14px; align-items:flex-end; margin-bottom:14px; flex-wrap:wrap;">
        <div class="grid-cell-item" style="max-width:200px; margin:0;">
          <label>Local / Export</label>
          <select onchange="updateCpdiTradeType(this.value)" style="width:100%; padding:6px 4px;">
            <option value="Local" ${s.tradeType !== 'Export' ? 'selected' : ''}>Local</option>
            <option value="Export" ${s.tradeType === 'Export' ? 'selected' : ''}>Export</option>
          </select>
        </div>
        ${s.tradeType === 'Export' ? `
        <div class="grid-cell-item" style="max-width:220px; margin:0;">
          <label>INR to USD Rate</label>
          <input type="number" min="0" step="0.01" placeholder="e.g. 95.3" value="${esc(s.usdRate)}"
            oninput="updateCpdiField('usdRate', this.value); recalcPdiTotals(cpdiInvoiceState,'cpdi');" style="width:100%; padding:6px 4px;" />
        </div>` : ''}
      </div>

      <div class="compact-fields-grid" style="margin-bottom:14px;">
        <div class="grid-cell-item" style="background:#f1f5f9;"><label>Invoice No.</label><div style="padding:6px 4px; font-weight:600; color:var(--muted);" title="Allocated only when this draft is authorized">Allocated on authorization</div></div>
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
          <input type="text" placeholder="e.g. Mumbai Port" value="${esc(s.incotermsPlace)}" oninput="updateCpdiField('incotermsPlace', this.value)" style="width:100%; padding:6px 4px;" />
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div style="border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:#fff;">
          <div style="font-weight:700; color:var(--brand); margin-bottom:8px; font-size:0.88rem;">BILL TO PARTY</div>
          ${field('Name', null, ['billTo','name'])}
          ${field('Address', null, ['billTo','address'])}
          ${field('State', null, ['billTo','state'])}
          <div class="grid-cell-item"><label>GST No.</label><textarea rows="1" oninput="pdiAutoSetGstFromBillToGst(cpdiInvoiceState, this.value, 'cpdi', () => recalcPdiTotals(cpdiInvoiceState,'cpdi')); pdiAutoGrowField(this);" onfocus="pdiAutoGrowField(this);" style="width:100%; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(s.billTo.gstNo || '')}</textarea></div>
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
      <div id="cpdi-lineitems-wrap" style="overflow-x:auto;"></div>

      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <div style="width:300px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Sub Total</span>
            <strong id="cpdi-subtotal-display">₹0</strong>
          </div>
          ${s.tradeType === 'Export' ? `
          <div style="font-size:0.78rem; color:var(--muted); padding:2px 2px;">No GST for Export invoices.</div>
          ` : `
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">CGST %</span>
            <input id="cpdi-cgst-input" type="number" min="0" placeholder="0" value="${esc(s.cgstPercent)}" oninput="updateCpdiField('cgstPercent', this.value); recalcPdiTotals(cpdiInvoiceState,'cpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">SGST %</span>
            <input id="cpdi-sgst-input" type="number" min="0" placeholder="0" value="${esc(s.sgstPercent)}" oninput="updateCpdiField('sgstPercent', this.value); recalcPdiTotals(cpdiInvoiceState,'cpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">IGST %</span>
            <input id="cpdi-igst-input" type="number" min="0" value="${esc(s.igstPercent)}" oninput="updateCpdiField('igstPercent', this.value); recalcPdiTotals(cpdiInvoiceState,'cpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>`}
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Freight <span style="text-transform:none; font-weight:500;">(incl. GST)</span></span>
            <input id="cpdi-freight-input" type="number" min="0" placeholder="0" value="${esc(s.freightAmount)}" oninput="updateCpdiField('freightAmount', this.value); recalcPdiTotals(cpdiInvoiceState,'cpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Others <span style="text-transform:none; font-weight:500;">(incl. GST)</span></span>
            <input id="cpdi-others-input" type="number" min="0" placeholder="0" value="${esc(s.othersAmount)}" oninput="updateCpdiField('othersAmount', this.value); recalcPdiTotals(cpdiInvoiceState,'cpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border); border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Round Off</span>
            <input type="number" value="${esc(s.roundOff)}" data-allow-negative="true" oninput="updateCpdiField('roundOff', this.value); recalcPdiTotals(cpdiInvoiceState,'cpdi');" style="width:70px; text-align:right; padding:3px;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f0fdf4; border-radius:4px; padding:6px 10px;">
            <span style="font-size:0.85rem; font-weight:700; color:#15803d; text-transform:uppercase;">Grand Total</span>
            <strong id="cpdi-grandtotal-display" style="color:#15803d;">₹0</strong>
          </div>
        </div>
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.9rem;">Bank Details</div>
      <div class="grid-cell-item" style="max-width:320px; margin-bottom:10px;">
        <label>Bank Account</label>
        <select onchange="selectCpdiBankOption(this.value)" style="width:100%; padding:6px 4px;">
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
        <textarea rows="4" style="width:100%; padding:8px; font-size:0.85rem; border:1.5px solid var(--border); border-radius:var(--radius);" oninput="updateCpdiField('declaration', this.value)">${s.declaration}</textarea>
      </div>

      <div style="margin-top:14px; font-size:0.87rem; color:var(--muted);">Total Invoice Amount in Words: <strong id="cpdi-words-display" style="color:var(--text);">—</strong></div>
    </div>
  `;
  cpdiRenderLineItemsTable();
  recalcPdiTotals(cpdiInvoiceState, 'cpdi');
  zone.querySelectorAll('.grid-cell-item textarea').forEach(pdiAutoGrowField);
}

function cpdiRenderLineItemsTable() {
  cpdiActiveIdPrefix = 'cpdi';
  const presentIds = new Set(cpdiCache.lines.map(l => l.lineId));
  const candidates = cpdiAllLines.filter(l => !presentIds.has(l.lineId));
  const addRowHtml = candidates.length === 0
    ? `<span style="font-size:0.78rem; color:var(--muted);">Every product for this project is already listed above.</span>`
    : `<span onclick="cpdiShowAddRowPicker()" style="font-size:0.78rem; font-weight:700; color:var(--brand); cursor:pointer; text-decoration:underline;">+ Add row</span>`;
  renderPdiLineItemsTable('cpdi-lineitems-wrap', cpdiInvoiceState.lineItems, 'cpdi', 'updateCpdiLineItem', 'cpdiDeleteLineItem', addRowHtml);
}

function cpdiShowAddRowPicker() {
  const zone = document.getElementById("cpdi-addrow-zone");
  if (!zone) return;
  const presentIds = new Set(cpdiCache.lines.map(l => l.lineId));
  const candidates = cpdiAllLines.filter(l => !presentIds.has(l.lineId));
  if (candidates.length === 0) return;
  zone.innerHTML = `
    <div style="display:flex; gap:8px; align-items:center;">
      <select id="cpdi-addrow-select" style="padding:6px 8px; font-size:0.85rem; border:1px solid var(--border); border-radius:4px; flex:1; min-width:0; max-width:900px;">
        ${candidates.map(l => `<option value="${l.lineId}">${escapeHtml(l.productName || l.description || ('Line ' + l.lineId))}</option>`).join('')}
      </select>
      <button type="button" onclick="cpdiAddLineItemRow()" class="nav-btn-styled" style="background:var(--accent); padding:5px 12px; font-size:0.78rem;">Add</button>
      <span onclick="cpdiRenderLineItemsTable()" style="font-size:0.78rem; color:var(--muted); cursor:pointer; text-decoration:underline;">Cancel</span>
    </div>`;
}
function cpdiAddLineItemRow() {
  const select = document.getElementById("cpdi-addrow-select");
  if (!select || !select.value) return;
  const lineId = Number(select.value);
  const line = cpdiAllLines.find(l => l.lineId === lineId);
  if (!line) return;
  cpdiCache.lines.push(line);
  const qty = line.boqId ? line.readyToInvoiceQty : 0;
  cpdiInvoiceState.lineItems.push({
    lineId: line.lineId, description: line.description, hsnNumber: line.hsnNumber, unit: line.unit,
    quantity: qty, ratePerQuantity: line.ratePerQuantity, totalBasicPrice: qty * (parseFloat(line.ratePerQuantity) || 0),
  });
  cpdiRenderDetail();
}
function cpdiDeleteLineItem(idx) {
  if (!cpdiInvoiceState.lineItems[idx]) return;
  cpdiInvoiceState.lineItems.splice(idx, 1);
  cpdiCache.lines.splice(idx, 1);
  cpdiRenderDetail();
}
function updateCpdiField(key, value) { cpdiInvoiceState[key] = value; }
function updateCpdiNested(parentKey, childKey, value) { cpdiInvoiceState[parentKey][childKey] = value; }
function updateCpdiTradeType(value) { updatePdiTradeType(cpdiInvoiceState, value); cpdiRenderInvoiceForm(); }
function selectCpdiBankOption(key) {
  cpdiInvoiceState.bankAccountKey = key;
  const o = applyPdiBankOption(key);
  cpdiInvoiceState.bankDetails = { ...cpdiInvoiceState.bankDetails, bankName: o.bankName, ifsc: o.ifsc, ac: o.ac, address: o.address, branch: o.branch };
  cpdiRenderInvoiceForm();
}
function updateCpdiLineItem(idx, key, value) {
  const item = cpdiInvoiceState.lineItems[idx];
  if (!item) return;
  item[key] = value;
  if (key === 'quantity' || key === 'ratePerQuantity') {
    const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.ratePerQuantity) || 0);
    item.totalBasicPrice = amount;
    const amountEl = document.getElementById(`${cpdiActiveIdPrefix}-amount-${idx}`);
    if (amountEl) amountEl.value = amount;
    recalcPdiTotals(cpdiInvoiceState, 'cpdi');
  }
}

let cpdiSubmitMode = 'partial';
function openCpdiConfirmModal(mode) {
  if ((cpdiInvoiceState.lineItems || []).some(li => Number(li.quantity) > 0 && !(li.hsnNumber || '').toString().trim())) {
    showBOQBanner("cpdi-feedback", "HSN Code is required for every invoice line.", "error");
    return;
  }
  if (cpdiInvoiceState.tradeType === 'Export' && !(Number(cpdiInvoiceState.usdRate) > 0)) {
    showBOQBanner("cpdi-feedback", "INR to USD Rate is required when Export is selected.", "error");
    return;
  }
  for (const docType of PDI_REQUIRED_DOC_TYPES) {
    if (!(cpdiDocFiles[docType] || []).length) {
      showBOQBanner("cpdi-feedback", `${PDI_DOC_META[docType].label} document is required.`, "error");
      return;
    }
  }
  if (!["Yes", "Credit"].includes(document.getElementById("cpdi-payment-received").value.trim())) {
    showBOQBanner("cpdi-feedback", "Payment Received Confirmation must be set to Yes or Credit before this draft can be created.", "error");
    return;
  }
  cpdiSubmitMode = mode;
  document.getElementById("cpdi-confirm-warning").textContent = mode === 'final'
    ? "Creating this Final Invoice draft reserves EVERY remaining ready unit on this project — no Partial invoice can be created until this draft is authorized or deleted. Nothing is committed (no PRN close, no stock release, no project completion) until it is authorized."
    : "This reserves only the quantities entered above. Nothing is committed until this draft is authorized — other products can still be drafted separately later.";
  document.getElementById("cpdi-confirm-title").textContent = mode === 'final' ? "Confirm Final Invoice Draft" : "Confirm Partial Invoice Draft";
  document.getElementById("cpdi-confirm-target").textContent = cpdiCache.projectId;
  document.getElementById("cpdi-confirm-input").value = "";
  document.getElementById("cpdi-confirm-submit-btn").disabled = true;
  document.getElementById("cpdi-confirm-submit-btn").style.opacity = "0.5";
  document.getElementById("cpdi-confirm-submit-btn").style.cursor = "not-allowed";
  document.getElementById("cpdi-confirm-modal").style.display = "flex";
}
function closeCpdiConfirmModal() { document.getElementById("cpdi-confirm-modal").style.display = "none"; }
function handleCpdiConfirmInput() {
  const match = document.getElementById("cpdi-confirm-input").value.trim() === cpdiCache.projectId;
  const btn = document.getElementById("cpdi-confirm-submit-btn");
  btn.disabled = !match;
  btn.style.opacity = match ? "1" : "0.5";
  btn.style.cursor = match ? "pointer" : "not-allowed";
}

async function uploadCpdiDoc(projectId, file, docLabel) {
  const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
  const upData = await apFetch({
    action: "uploadProjectInvoiceDocument", projectId, docLabel,
    file: { fileName: file.name, base64Data: b64, mimeType: file.type || "application/octet-stream" },
    operatorName: appActiveOperatorIdentityString || "Unknown",
  });
  return upData.success ? upData.url : "";
}

async function submitCpdiCreate() {
  const confirmProjectId = document.getElementById("cpdi-confirm-input").value.trim();
  const paymentReceivedConfirmation = document.getElementById("cpdi-payment-received").value.trim();
  closeCpdiConfirmModal();
  for (const docType of PDI_REQUIRED_DOC_TYPES) {
    if (!(cpdiDocFiles[docType] || []).length) {
      showBOQBanner("cpdi-feedback", `${PDI_DOC_META[docType].label} document is required.`, "error");
      return;
    }
  }
  showBlockingOverlay("Uploading documents...");
  try {
    const documents = [];
    for (const docType of Object.keys(PDI_DOC_META)) {
      const files = cpdiDocFiles[docType] || [];
      const label = PDI_DOC_META[docType].label;
      for (const file of files) {
        const url = await uploadCpdiDoc(cpdiCache.projectId, file, label);
        if (!url) throw new Error(`Upload failed for "${file.name}" (${label}). Please retry.`);
        documents.push({ docType, fileName: file.name, url });
      }
    }
    const isFinal = cpdiSubmitMode === 'final';
    showBlockingOverlay(isFinal ? "Creating Final Invoice draft..." : "Creating Partial Invoice draft...");
    const data = await apFetch({
      action: isFinal ? "createFinalProjectDispatchInvoice" : "createPartialProjectDispatchInvoice",
      projectId: cpdiCache.projectId, confirmProjectId,
      operatorName: appActiveOperatorIdentityString || "Unknown", invoice: cpdiInvoiceState,
      paymentReceivedConfirmation, documents,
    });
    if (data.success) {
      const cpdiTabsBar = document.getElementById("cpdi-tab-new")?.parentElement;
      if (cpdiTabsBar) cpdiTabsBar.style.display = "none";
      document.getElementById("cpdi-select-zone").style.display = "none";
      document.getElementById("cpdi-detail-zone").style.display = "none";
      const successZone = document.getElementById("cpdi-success-zone");
      successZone.style.display = "block";
      successZone.innerHTML = `
        <div style="padding:14px; background:#f0fdf4; border-left:4px solid #22c55e; border-radius:var(--radius); color:#15803d; font-weight:600; margin-bottom:14px;">
          ${isFinal ? 'Final' : 'Partial'} Invoice draft #${data.invoiceId} created for Project ID: ${cpdiCache.projectId} — awaiting authorization.
        </div>
        ${data.checkingDocUrl ? `<a href="${driveLink(data.checkingDocUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">📄 Open Invoice Checking Draft #${data.checkingDraftNumber} ↗</a>` : `<div style="color:#b45309; font-weight:600;">⚠ Invoice checking draft generation failed — retry from the Editing tab.</div>`}
        <div id="cpdi-dc-checking-zone" style="margin-top:10px;"></div>
        <div style="margin-top:16px;">
          <button class="nav-btn-styled" style="background:var(--accent); padding:8px 20px; font-weight:700;" onclick="switchCreatePdiTab('new')">+ Create New Draft</button>
          <button class="nav-btn-styled" style="background:var(--muted); padding:8px 20px; font-weight:700; margin-left:8px;" onclick="switchCreatePdiTab('editing')">Go to Pending Invoices (Editing)</button>
        </div>`;
      if (data.dispatchChallanId) renderCpdiDcCheckingControl('cpdi-dc-checking-zone', data.dispatchChallanId);
    } else {
      showBOQBanner("cpdi-feedback", data.error || "Failed.", "error");
    }
  } catch(e) {
    showBOQBanner("cpdi-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

// ── Editing tab ──────────────────────────────────────────────────────
let cpdiEditExpandedInvoiceId = null;

async function initializeCpdiEditingTab() {
  document.getElementById("cpdi-editing-feedback").style.display = "none";
  const feed = document.getElementById("cpdi-editing-cards-feed");
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  cpdiEditExpandedInvoiceId = null;
  try {
    const data = await apFetch({ action: "fetchPendingProjectDispatchInvoicesForEditing" });
    if (!data.success) { feed.innerHTML = `<div style="color:#b91c1c; padding:14px;">${data.error || 'Failed to load.'}</div>`; return; }
    if (!(data.invoices || []).length) { feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">No pending drafts.</div>`; return; }
    feed.innerHTML = data.invoices.map(inv => `
      <div style="border:1px solid var(--border); border-radius:var(--radius); padding:12px; margin-bottom:10px; background:#fff;">
        <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="toggleCpdiEditCard(${inv.invoiceId})">
          <div>
            <strong>${inv.invoiceType} Invoice draft #${inv.invoiceId}</strong> — ${inv.projectId}
            <div style="font-size:0.8rem; color:var(--muted);">Created by ${inv.createdBy || '—'} · ${formatOrdinalDateTime ? formatOrdinalDateTime(inv.createdAt) : inv.createdAt}</div>
          </div>
          <div style="text-align:right;">
            ${inv.checkingDocUrl ? `<a href="${driveLink(inv.checkingDocUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:var(--brand); font-weight:700; font-size:0.85rem;">📄 Invoice Checking Draft #${inv.checkingDraftCount} ↗</a>` : `<span style="color:#b45309; font-size:0.8rem;">No invoice checking draft yet</span>`}
            <br/>
            ${inv.dcCheckingDocUrl ? `<a href="${driveLink(inv.dcCheckingDocUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:var(--brand); font-weight:700; font-size:0.85rem;">📄 Delivery Challan Checking Draft #${inv.dcCheckingDraftCount} ↗</a>` : (inv.dispatchChallanId ? `<span style="color:#b45309; font-size:0.8rem;">No Delivery Challan checking draft yet</span>` : '')}
          </div>
        </div>
        <div id="cpdi-edit-card-${inv.invoiceId}" style="display:none; margin-top:12px; border-top:1px solid var(--border); padding-top:12px;"></div>
      </div>`).join('');
  } catch(e) {
    feed.innerHTML = `<div style="color:#b91c1c; padding:14px;">Network error: ${e.message}</div>`;
  }
}

// dispatchChallanId of whichever Editing card is currently expanded —
// set from fetchProjectDispatchInvoiceDraftById below, read by
// generateCpdiDcCheckingDraft (there's only ever one card open at a
// time, same reasoning cpdiActiveIdPrefix already relies on).
let cpdiEditDispatchChallanId = null;

async function toggleCpdiEditCard(invoiceId) {
  const card = document.getElementById(`cpdi-edit-card-${invoiceId}`);
  if (!card) return;
  if (cpdiEditExpandedInvoiceId === invoiceId) { card.style.display = "none"; cpdiEditExpandedInvoiceId = null; return; }
  cpdiEditExpandedInvoiceId = invoiceId;
  card.style.display = "block";
  card.innerHTML = `<div style="text-align:center; padding:12px; color:var(--muted);">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchProjectDispatchInvoiceDraftById", invoiceId });
    if (!data.success) { card.innerHTML = `<div style="color:#b91c1c;">${data.error || 'Failed to load.'}</div>`; return; }
    cpdiCache = { projectId: data.projectId, lines: (data.invoiceDetails.lineItems || []).map(li => ({ ...li, boqId: li.boqId || null, orderedQuantity: li.quantity, readyToInvoiceQty: li.quantity, jcTotal: 0, jcQaPassed: 0, alreadyInvoicedQty: 0, pendingTicketsCount: 0, pendingBoqIncreaseCount: 0 })) };
    cpdiAllLines = cpdiCache.lines.slice();
    cpdiInvoiceState = { ...data.invoiceDetails, lineItems: (data.invoiceDetails.lineItems || []).map(li => ({ ...li })) };
    if (!cpdiInvoiceState.billTo) cpdiInvoiceState.billTo = { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "" };
    if (!cpdiInvoiceState.shipTo) cpdiInvoiceState.shipTo = { name: "", address: "", state: "", gstNo: "", contactName: "", contactNo: "" };
    if (!cpdiInvoiceState.bankDetails) cpdiInvoiceState.bankDetails = { beneficiary: "ABPS SOLUTION PRIVATE LIMITED", swift: "", ...PDI_STANDARD_BANK_DETAILS };
    if (!cpdiInvoiceState.bankAccountKey) cpdiInvoiceState.bankAccountKey = (PDI_BANK_OPTIONS.find(o => o.ac === cpdiInvoiceState.bankDetails.ac) || PDI_BANK_OPTIONS[0]).key;
    cpdiEditDispatchChallanId = data.dispatchChallanId || null;

    card.innerHTML = `
      <div id="cpdi-edit-form-${invoiceId}"></div>
      <div id="cpdi-edit-lineitems-wrap-${invoiceId}" style="overflow-x:auto; margin-top:10px;"></div>
      <div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;">
        <button class="nav-btn-styled" style="background:var(--brand); padding:8px 16px;" onclick="saveCpdiEdit(${invoiceId})">📄 Save &amp; Generate Invoice Checking Draft</button>
        ${cpdiEditDispatchChallanId ? `<button class="nav-btn-styled" style="background:var(--accent); padding:8px 16px;" onclick="generateCpdiDcCheckingDraft(${invoiceId}, ${cpdiEditDispatchChallanId})">📄 Generate Delivery Challan Checking Draft</button>` : ''}
      </div>
      <div id="cpdi-edit-feedback-${invoiceId}" style="margin-top:10px;"></div>`;
    cpdiRenderEditForm(invoiceId);
  } catch(e) {
    card.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
  }
}

// Reuses the same field/table-render shape as the New form but scoped to
// a specific invoiceId's card — a lighter editor (header fields + line
// items only, no document re-upload, no Payment Confirmation re-check).
function cpdiRenderEditForm(invoiceId) {
  const s = cpdiInvoiceState;
  const esc = (v) => (v == null ? '' : v.toString()).replace(/"/g, '&quot;');
  document.getElementById(`cpdi-edit-form-${invoiceId}`).innerHTML = `
    <div class="compact-fields-grid">
      <div class="grid-cell-item"><label>Transport Name</label><input type="text" value="${esc(s.transportName)}" oninput="cpdiInvoiceState.transportName=this.value" style="width:100%; padding:6px 4px;" /></div>
      <div class="grid-cell-item"><label>Vehicle No.</label><input type="text" value="${esc(s.vehicleNo)}" oninput="cpdiInvoiceState.vehicleNo=this.value" style="width:100%; padding:6px 4px;" /></div>
      <div class="grid-cell-item"><label>Freight (incl. GST)</label><input type="number" value="${esc(s.freightAmount)}" oninput="cpdiInvoiceState.freightAmount=this.value" style="width:100%; padding:6px 4px;" /></div>
      <div class="grid-cell-item"><label>Others (incl. GST)</label><input type="number" value="${esc(s.othersAmount)}" oninput="cpdiInvoiceState.othersAmount=this.value" style="width:100%; padding:6px 4px;" /></div>
    </div>`;
  // updateCpdiLineItem is reused directly (same shared cpdiInvoiceState var)
  // rather than a per-invoiceId handler — only one edit card is ever
  // expanded at a time (toggleCpdiEditCard enforces this). cpdiActiveIdPrefix
  // tracks which table last rendered so the Amount-cell sync below targets
  // the right DOM id.
  cpdiActiveIdPrefix = `cpdi-edit-${invoiceId}`;
  renderPdiLineItemsTable(`cpdi-edit-lineitems-wrap-${invoiceId}`, s.lineItems, cpdiActiveIdPrefix, 'updateCpdiLineItem', null, null);
}

async function saveCpdiEdit(invoiceId) {
  const fb = document.getElementById(`cpdi-edit-feedback-${invoiceId}`);
  showBlockingOverlay("Saving changes...");
  try {
    const data = await apFetch({ action: "updateProjectDispatchInvoiceDraft", invoiceId, invoice: cpdiInvoiceState, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (!data.success) { fb.innerHTML = `<div style="color:#b91c1c; font-weight:600;">${data.error || 'Failed.'}</div>`; return; }
  } catch(e) {
    fb.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
    return;
  } finally {
    hideBlockingOverlay();
  }
  // Saving and printing are one step (24 Sep 2026).
  await generateCpdiCheckingDraftOnly(invoiceId);
}

async function generateCpdiCheckingDraftOnly(invoiceId) {
  const fb = document.getElementById(`cpdi-edit-feedback-${invoiceId}`);
  showBlockingOverlay("Generating checking draft...");
  try {
    const data = await apFetch({ action: "regenerateProjectDispatchInvoiceCheckingDraft", invoiceId });
    if (data.success && data.checkingDocUrl) {
      // Done state (24 Sep 2026): the list is hidden until "+ Edit Another" is clicked.
      const challanId = cpdiEditDispatchChallanId;
      document.getElementById("cpdi-editing-cards-feed").innerHTML = "";
      const tabsBar = document.getElementById("cpdi-tab-new")?.parentElement;
      if (tabsBar) tabsBar.style.display = "none";
      const fbEl = document.getElementById("cpdi-editing-feedback");
      fbEl.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #15803d; background:#dcfce7; color:#15803d; border-radius:var(--radius); font-weight:600;";
      fbEl.innerHTML = `Changes saved. Invoice Checking Draft #${data.checkingDraftNumber} generated. <a href="${driveLink(data.checkingDocUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">📄 Open Invoice Checking Draft ↗</a>
        <div id="cpdi-edit-done-dc" style="margin-top:10px;"></div>
        <div><button class="nav-btn-styled" style="margin-top:12px; background:var(--accent); padding:7px 18px; font-weight:700;" onclick="switchCreatePdiTab('editing')">+ Edit Another Dispatch Invoice</button></div>`;
      if (challanId) renderCpdiDcCheckingControl('cpdi-edit-done-dc', challanId);
      fbEl.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    fb.innerHTML = data.success
      ? `<div style="color:#b45309; font-weight:600;">Changes saved, but the checking draft could not be generated. Click the button again to retry.</div>`
      : `<div style="color:#b91c1c; font-weight:600;">${data.error || 'Failed.'}</div>`;
  } catch(e) {
    fb.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
  } finally {
    hideBlockingOverlay();
  }
}

// generateCpdiDcCheckingDraft — same watermarked-paper-review loop as
// every ticket-sourced Delivery Challan's own checking draft
// (generateDeliveryChallanCheckingDraft, store/material-outward.js), just
// invoked from here since a Dispatch challan has no card of its own on
// the Material Outward screen. Reuses that exact backend route — the
// permission gate there was widened (migration 213) to also accept
// perm_create_project_dispatch_invoice.
async function generateCpdiDcCheckingDraft(invoiceId, challanId) {
  const fb = document.getElementById(`cpdi-edit-feedback-${invoiceId}`);
  showBlockingOverlay("Generating Delivery Challan checking draft...");
  try {
    const data = await apFetch({ action: "generateDeliveryChallanCheckingDraft", challanId });
    fb.innerHTML = data.success
      ? `<div style="color:#15803d; font-weight:600;">Delivery Challan Checking Draft #${data.draftNumber} generated. <a href="${driveLink(data.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open ↗</a></div>`
      : `<div style="color:#b91c1c; font-weight:600;">${data.error || 'Failed.'}</div>`;
  } catch(e) {
    fb.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
  } finally {
    hideBlockingOverlay();
  }
}

// renderCpdiDcCheckingControl — shown right after a fresh Create, in the
// success banner, so the preparer can immediately pull a paper draft of
// the linked Delivery Challan without first navigating to the Editing
// tab.
function renderCpdiDcCheckingControl(containerId, challanId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<button class="nav-btn-styled" style="background:var(--accent); padding:8px 16px; font-weight:700;" onclick="generateCpdiDcCheckingDraftInline('${containerId}', ${challanId})">📄 Generate Delivery Challan Checking Draft</button>`;
}
async function generateCpdiDcCheckingDraftInline(containerId, challanId) {
  const el = document.getElementById(containerId);
  showBlockingOverlay("Generating Delivery Challan checking draft...");
  try {
    const data = await apFetch({ action: "generateDeliveryChallanCheckingDraft", challanId });
    if (el) el.innerHTML = data.success
      ? `<div style="color:#15803d; font-weight:600;">Delivery Challan Checking Draft #${data.draftNumber} generated. <a href="${driveLink(data.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open ↗</a></div>`
      : `<div style="color:#b91c1c; font-weight:600;">${data.error || 'Failed.'}</div>`;
  } catch(e) {
    if (el) el.innerHTML = `<div style="color:#b91c1c;">Network error: ${e.message}</div>`;
  } finally {
    hideBlockingOverlay();
  }
}
