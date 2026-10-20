// Upload Revised Purchase Order (Marketing). Pick an Active project, view its
// current customer PO, upload the revised PO, review the AI extraction (map
// each row to an existing PO row or New), then commit.
let crpoProjects = [];
let crpoDetails = null;
let crpoReview = null;
let crpoFile = null;
let crpoOaFile = null, crpoCrFile = null; // revised Order Acceptance / Contract Review, replace the old file

const CRPO_HEADER_FIELDS = [
  ['poNumber', 'PO Number', 'text', 2], ['poDate', 'PO Date', 'date', 2], ['deliveryDate', 'Tentative Delivery Date *', 'date', 2],
  ['gstNumber', 'GST Number', 'text', 2], ['abgAmount', 'ABG Amount', 'number', 2], ['pbgAmount', 'PBG Amount', 'number', 2],
  ['headOfficeAddress', 'Head Office Address', 'text', 6], ['deliveryAddress', 'Delivery Address', 'text', 6],
  ['freightScope', 'Freight', 'text', 4], ['insuranceScope', 'Insurance', 'text', 4], ['packagingForwardingScope', 'Packaging & Forwarding', 'text', 4],
  ['deliverySchedule', 'Delivery Schedule', 'text', 6], ['warrantyTerms', 'Warranty Terms', 'text', 6],
  ['paymentTerms', 'Payment Terms', 'text', 6], ['ldClause', 'LD Clause', 'text', 6],
  ['abgTerms', 'ABG Terms', 'text', 6], ['pbgTerms', 'PBG Terms', 'text', 6],
  ['inspectionTerms', 'Inspection Terms', 'text', 6], ['documentsRequirement', 'Documents Requirement', 'text', 6],
  ['specialRequirement', 'Special Requirement', 'text', 12],
];

function crpoMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? escapeHtml(String(v)) : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function crpoNum(v) { const n = Number(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; }
function crpoBanner(msg, type) {
  const el = document.getElementById('crpo-feedback-banner');
  if (!el) return;
  if (!msg) { el.style.display = 'none'; return; }
  const ok = type === 'success';
  el.style.display = 'block';
  el.style.background = ok ? '#f0fdf4' : '#fef2f2';
  el.style.color = ok ? '#15803d' : '#b91c1c';
  el.style.borderLeftColor = ok ? '#15803d' : '#b91c1c';
  el.innerHTML = msg;
  if (!ok) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function crpoInitPanel() {
  crpoDetails = null; crpoReview = null; crpoFile = null; crpoOaFile = null; crpoCrFile = null;
  crpoBanner('');
  ['crpo-details-zone', 'crpo-upload-zone', 'crpo-review-zone'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  });
  const sel = document.getElementById('crpo-project-select');
  if (!sel) return;
  const taInput = document.getElementById('crpo-project-ta-input');
  if (taInput) { taInput.value = ''; taInput.placeholder = 'Loading projects...'; }
  sel.innerHTML = '<option value="">Loading projects...</option>';
  try {
    const data = await apFetch({ action: 'fetchActiveProjectsForPoRevision' });
    if (!data.success) { sel.innerHTML = '<option value="">Could not load projects</option>'; crpoBanner(escapeHtml(data.error || 'Failed to load projects.')); return; }
    crpoProjects = data.projects || [];
    sel.innerHTML = '<option value="">— Select an Active project —</option>' + crpoProjects.map(p =>
      `<option value="${escapeHtml(p.projectId)}">${escapeHtml(p.companyName || '')} · ${escapeHtml(p.projectId)}${p.poNumber ? ' · PO ' + escapeHtml(p.poNumber) : ''}</option>`).join('');
    if (taInput) taInput.placeholder = 'Start typing a company name, project ID or PO number...';
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') sel.innerHTML = '<option value="">Network error</option>';
  }
}

// Type-to-pick project, same as Upload Purchase Order's company box: the
// hidden <select> keeps the chosen project id for the rest of this screen.
function handleCrpoProjectTypeaheadInput(query) {
  const sel = document.getElementById('crpo-project-select');
  const input = document.getElementById('crpo-project-ta-input');
  if (!sel || !input) return;
  const ddId = 'crpo-project-ta-dropdown';
  const dd = ensureCompanySearchDropdownEl(ddId);
  dd.dataset.inputId = 'crpo-project-ta-input';
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { dd.style.display = 'none'; return; }
  const matches = [...sel.options].filter(o => o.value && words.every(w => o.text.toLowerCase().includes(w))).slice(0, 15);
  if (!matches.length) {
    dd.innerHTML = '<div style="padding:9px 12px; font-size:0.85rem; color:var(--muted);">No matching Active project.</div>';
  } else {
    dd.innerHTML = matches.map(o => `
      <div onmousedown="event.preventDefault(); selectCrpoProjectTypeahead(${jsArg(o.value)})"
        style="padding:9px 12px; cursor:pointer; font-size:0.88rem; border-bottom:1px solid var(--border);"
        onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background=''">${escapeHtml(o.text)}</div>`).join('');
  }
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + 'px';
  dd.style.left = rect.left + 'px';
  dd.style.width = rect.width + 'px';
  dd.style.display = 'block';
}

function selectCrpoProjectTypeahead(projectId) {
  const sel = document.getElementById('crpo-project-select');
  const input = document.getElementById('crpo-project-ta-input');
  if (!sel || !input) return;
  sel.value = projectId;
  input.value = sel.selectedOptions[0] ? sel.selectedOptions[0].text : '';
  const dd = document.getElementById('crpo-project-ta-dropdown');
  if (dd) dd.style.display = 'none';
  crpoSelectProject(projectId);
}

async function crpoSelectProject(projectId) {
  crpoReview = null; crpoFile = null; crpoOaFile = null; crpoCrFile = null; crpoBanner('');
  const dz = document.getElementById('crpo-details-zone');
  const uz = document.getElementById('crpo-upload-zone');
  const rz = document.getElementById('crpo-review-zone');
  rz.innerHTML = ''; rz.style.display = 'none';
  uz.innerHTML = ''; uz.style.display = 'none';
  if (!projectId) { dz.innerHTML = ''; dz.style.display = 'none'; return; }
  dz.style.display = 'block';
  dz.innerHTML = '<div style="color:var(--muted); padding:12px;">Loading current PO...</div>';
  try {
    const data = await apFetch({ action: 'fetchProjectPoDetails', projectId });
    if (!data.success) { dz.innerHTML = `<div style="color:#b91c1c;">${escapeHtml(data.error || 'Failed to load PO.')}</div>`; return; }
    crpoDetails = data;
    // Upload box first, then the editable current PO, then the revision history.
    dz.innerHTML = `
      <div style="margin-top:14px; font-weight:800; color:var(--brand); font-size:1.05rem;">Upload Revised Purchase Order (optional)</div>
      <div style="color:var(--muted); font-size:0.82rem; margin-top:2px;">Upload and process a revised PO to fill the form below from it, or just edit the form and save.</div>
      <div class="card-box" id="crpo-upload-box" onclick="document.getElementById('crpo-file').click()" style="margin-top:8px; padding:24px; font-size:0.9rem; min-height:90px; display:flex; align-items:center; justify-content:center;">📋 Select Revised Purchase Order</div>
      <input type="file" id="crpo-file" accept="image/*,application/pdf" hidden onchange="crpoFileChosen(this)" />
      <button class="nav-btn-styled" id="crpo-extract-btn" style="margin-top:12px; width:100%; padding:10px;" onclick="crpoExtract()">Process Revised Purchase Order with AI</button>
      <div style="margin-top:14px; font-weight:800; color:var(--brand); font-size:0.95rem;">Revised Order Acceptance / Contract Review (optional)</div>
      <div style="color:var(--muted); font-size:0.82rem; margin-top:2px;">A file chosen here replaces the current one when you save; the old file is deleted.</div>
      <div style="display:flex; gap:12px; margin-top:8px; flex-wrap:wrap;">
        <div class="card-box" id="crpo-oa-box" onclick="document.getElementById('crpo-oa-file').click()" style="flex:1 1 240px; padding:18px; font-size:0.88rem; min-height:70px; display:flex; align-items:center; justify-content:center;">📄 Select Revised Order Acceptance</div>
        <div class="card-box" id="crpo-cr-box" onclick="document.getElementById('crpo-cr-file').click()" style="flex:1 1 240px; padding:18px; font-size:0.88rem; min-height:70px; display:flex; align-items:center; justify-content:center;">📄 Select Revised Contract Review</div>
      </div>
      <input type="file" id="crpo-oa-file" accept="image/*,application/pdf" hidden onchange="crpoDocChosen('oa', this)" />
      <input type="file" id="crpo-cr-file" accept="image/*,application/pdf" hidden onchange="crpoDocChosen('cr', this)" />
      <div id="crpo-review-inner"></div>
      <div id="crpo-history"></div>`;
    crpoStartFromCurrentPo();
    crpoRenderHistory();
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') dz.innerHTML = `<div style="color:#b91c1c;">Network error: ${escapeHtml(e.message)}</div>`;
  }
}

function crpoRenderHistory() {
  const d = crpoDetails;
  const revs = (d.revisions || []).map(r => `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px; text-align:center; font-weight:700;">${r.revisionNo}</td>
      <td style="padding:6px;">${escapeHtml(r.poNumber || '—')}</td>
      <td style="padding:6px;">${escapeHtml(formatOrdinalDateTime(r.createdAt))}</td>
      <td style="padding:6px;">${escapeHtml(r.createdBy || '')}</td>
      <td style="padding:6px;">${escapeHtml(r.summary || '')}</td>
      <td style="padding:6px; text-align:center;">${r.poDocumentUrl ? `<a href="${driveLink(r.poDocumentUrl)}" target="_blank" rel="noopener">View ↗</a>` : '—'}</td>
    </tr>`).join('');
  const el = document.getElementById('crpo-history');
  if (!el) return;
  el.innerHTML = `
    ${revs ? `<div style="margin-top:18px; font-weight:700;">Revision History</div>
    <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
      <thead><tr style="background:var(--highlight-bg); text-align:left;"><th style="padding:6px; text-align:center;">Rev</th><th style="padding:6px;">PO Number</th><th style="padding:6px;">Date</th><th style="padding:6px;">By</th><th style="padding:6px;">Changes</th><th style="padding:6px; text-align:center;">Document</th></tr></thead>
      <tbody>${revs}</tbody></table></div>` : ''}`;
}

function crpoFileChosen(input) {
  crpoFile = input.files && input.files[0] ? input.files[0] : null;
  const box = document.getElementById('crpo-upload-box');
  if (box) box.textContent = crpoFile ? `✅ ${crpoFile.name}` : '📋 Select Revised Purchase Order *';
}

function crpoDocChosen(kind, input) {
  const f = input.files && input.files[0] ? input.files[0] : null;
  if (kind === 'oa') crpoOaFile = f; else crpoCrFile = f;
  const box = document.getElementById(kind === 'oa' ? 'crpo-oa-box' : 'crpo-cr-box');
  const label = kind === 'oa' ? 'Order Acceptance' : 'Contract Review';
  if (box) box.textContent = f ? `✅ ${f.name}` : `📄 Select Revised ${label}`;
}

function crpoReadBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function crpoExtract() {
  const projectId = document.getElementById('crpo-project-select').value;
  if (!projectId) return abpsAlert('Select a project first.');
  if (!crpoFile) return abpsAlert('Select the revised Purchase Order file first.');
  const btn = document.getElementById('crpo-extract-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'AI Extracting...'; }
  showBlockingOverlay('Reading Revised Purchase Order...');
  try {
    const base64Data = await crpoReadBase64(crpoFile);
    const data = await apFetch({ action: 'extractRevisedPurchaseOrderPreview', _timeoutMs: 270000, projectId, base64Data, mimeType: crpoFile.type || 'application/octet-stream' });
    if (!data.success) { crpoBanner(escapeHtml(data.error || 'Extraction failed.')); return; }
    crpoReview = { projectId, base64Data, header: { ...data.header }, lineItems: data.lineItems || [], removeLineIds: new Set() };
    crpoRenderReview();
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') crpoBanner('Network error: ' + escapeHtml(e.message));
  } finally {
    hideBlockingOverlay();
    if (btn) { btn.disabled = false; btn.textContent = 'Process Revised Purchase Order with AI'; }
  }
}

// The form opens filled with the current PO, ready to edit. Processing a
// revised document replaces these values with what the AI read.
function crpoStartFromCurrentPo() {
  const projectId = document.getElementById('crpo-project-select').value;
  if (!projectId || !crpoDetails) return;
  const header = {};
  CRPO_HEADER_FIELDS.forEach(([k]) => { header[k] = crpoDetails.header[k] == null ? '' : crpoDetails.header[k]; });
  const lineItems = crpoDetails.lines.map(l => ({
    itemCode: l.itemCode || '', hsnNumber: l.hsnNumber || '', description: l.description || '',
    quantity: l.quantity ?? '', unit: l.unit || '', ratePerQuantity: l.ratePerQuantity ?? '', gstAmount: l.gstAmount ?? '',
    matchLineId: l.lineId,
  }));
  crpoReview = { projectId, base64Data: null, header, lineItems, removeLineIds: new Set(), withoutDocument: true };
  // Keep the saved PO Amounts if they differ from the rows' sum (set by hand before).
  const savedHdr = crpoDetails.amounts || {};
  let rowBasic = 0, rowGst = 0;
  lineItems.forEach(li => { rowBasic += crpoNum(li.quantity) * crpoNum(li.ratePerQuantity); rowGst += crpoNum(li.gstAmount); });
  if (savedHdr.poBasicAmount != null && (Math.abs(crpoNum(savedHdr.poBasicAmount) - rowBasic) > 0.005 || Math.abs(crpoNum(savedHdr.poGstAmount) - rowGst) > 0.005)) {
    crpoReview.amounts = { edited: true, basic: String(savedHdr.poBasicAmount ?? ''), gst: String(savedHdr.poGstAmount ?? ''), total: String(savedHdr.poTotalAmount ?? '') };
  }
  crpoRenderReview();
}

// Same rows, columns and formatting as Upload Purchase Order's review.
function crpoRenderReview() {
  const zone = document.getElementById('crpo-review-inner');
  if (!zone) return;
  const h = crpoReview.header;
  const d = crpoDetails.header;
  const rowBreak = `<div style="grid-column: 1 / -1; height: 6px;"></div>`;
  const lockedRow = (label, value, span) => `
    <div class="grid-cell-item" style="background:#f1f5f9; grid-column: span ${span};">
      <label style="font-size:0.72rem;">${label}</label>
      <div style="padding:6px 8px; font-weight:600; color:var(--text); font-size:0.95rem; white-space:normal; word-break:break-word; border:1.5px solid #8492a6; border-radius:4px; background:#f8fafc;">${value || '—'}</div>
    </div>`;
  const field = (label, key, type, span, required) => {
    const raw = h[key] == null ? '' : String(h[key]);
    const lbl = required ? `${label} *` : label;
    if (type === 'number') {
      return `<div class="grid-cell-item" style="grid-column: span ${span};"><label style="font-size:0.72rem;">${lbl}</label>
        <input type="text" inputmode="decimal" value="${escapeHtml(formatIndianCurrencyInput(raw))}"
          oninput="crpoReview.header['${key}'] = sanitizeAmountInput(this)"
          onfocus="this.value = (crpoReview.header['${key}'] ?? '').toString();"
          onblur="this.value = formatIndianCurrencyInput(crpoReview.header['${key}']);"
          style="font-size:0.95rem; padding:7px 8px;" /></div>`;
    }
    if (type === 'date') {
      return `<div class="grid-cell-item" style="grid-column: span ${span};"><label style="font-size:0.72rem;">${lbl}</label>
        <input type="date" value="${escapeHtml(raw.slice(0, 10))}" oninput="crpoReview.header['${key}'] = this.value" style="font-size:0.95rem; padding:7px 8px;" /></div>`;
    }
    return `<div class="grid-cell-item" style="grid-column: span ${span};"><label style="font-size:0.72rem;">${lbl}</label>
      <textarea rows="1" oninput="crpoReview.header['${key}'] = this.value; autoGrowPoField(this);" onfocus="autoGrowPoField(this);"
        style="font-size:0.95rem; padding:7px 8px; resize:none; overflow:hidden; font-family:inherit; min-height:32px;">${escapeHtml(raw)}</textarea></div>`;
  };
  const docUrl = (crpoDetails.amounts || {}).poDocumentUrl;
  zone.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-top:18px;">
      <div style="font-weight:800; color:var(--brand); margin-bottom:4px; font-size:1.05rem;">${crpoReview.withoutDocument ? 'Purchase Order' : 'Review Revised Purchase Order'}</div>
      <div style="font-size:0.88rem; color:var(--muted); margin-bottom:14px;">${crpoReview.withoutDocument
        ? 'Change any value that needs correcting, then Save Changes. The revision history records what changed.'
        : 'Check every value the AI read. For each product row choose which current PO row it revises, or "New row". Current rows you don\'t map stay as they are unless you tick Remove.'}</div>

      <div class="po-review-fields-grid" style="margin-bottom:14px;">
        <div class="grid-cell-item" style="background:#f1f5f9; grid-column: span 6;">
          <label style="font-size:0.72rem;">Project ID</label>
          <div style="padding:6px 4px; font-weight:700; color:var(--brand); font-family:monospace; font-size:1.05rem; word-break:break-all;">${escapeHtml(crpoReview.projectId)}</div>
        </div>
        ${lockedRow('Status', escapeHtml(d.projectStatus || 'Active'), 2)}
        ${field('PO Number', 'poNumber', 'text', 4, true)}
        ${field('PO Date', 'poDate', 'date', 4, true)}
        ${lockedRow('Company Name', escapeHtml(d.companyName || ''), 8)}
        ${rowBreak}
        ${field('GST Number', 'gstNumber', 'text', 4)}
        ${field('Head Office Address', 'headOfficeAddress', 'text', 8)}
        ${field('Delivery Address', 'deliveryAddress', 'text', 8)}
        ${field('Tentative Delivery Date', 'deliveryDate', 'date', 4, true)}
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.95rem;">Product List</div>
      <div id="crpo-review-lines"></div>
      <button class="nav-btn-styled" style="background:var(--brand); margin-top:8px; padding:6px 14px; font-size:0.85rem; width:auto;" onclick="crpoAddRow()">+ Add Row</button>
      <div id="crpo-unmapped"></div>

      <div class="po-review-fields-grid" style="margin-top:16px;">
        ${field('Freight Scope', 'freightScope', 'text', 8)}
        ${field('Insurance Scope', 'insuranceScope', 'text', 8)}
        ${field('Packaging and Forwarding Scope', 'packagingForwardingScope', 'text', 8)}
        ${rowBreak}
        ${field('Delivery Schedule as per PO', 'deliverySchedule', 'text', 8)}
        ${field('Warranty Terms', 'warrantyTerms', 'text', 8)}
        ${field('Payment Terms', 'paymentTerms', 'text', 8)}
        ${rowBreak}
        ${field('ABG Terms', 'abgTerms', 'text', 6)}
        ${field('ABG Amount', 'abgAmount', 'number', 3)}
        ${field('PBG Terms', 'pbgTerms', 'text', 6)}
        ${field('PBG Amount', 'pbgAmount', 'number', 3)}
        ${field('LD Clause', 'ldClause', 'text', 6)}
        ${rowBreak}
        ${field('Inspection Terms', 'inspectionTerms', 'text', 8)}
        ${field('Special Requirement', 'specialRequirement', 'text', 8)}
        ${field('Documents Requirement', 'documentsRequirement', 'text', 8)}
        ${rowBreak}
        <div id="crpo-amounts" style="display:contents;"></div>
        ${lockedRow('Current PO Document', docUrl ? `<a href="${driveLink(docUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open Document ↗</a>` : '—', 4)}
      </div>

      <button class="nav-btn-styled" id="crpo-submit-btn" style="margin-top:16px; width:100%; padding:12px; background:var(--accent); font-weight:700; font-size:0.95rem;" onclick="crpoSubmit()">${crpoReview.withoutDocument ? 'Save Changes' : 'Submit Revised Purchase Order'}</button>
    </div>`;
  zone.querySelectorAll('.grid-cell-item textarea').forEach(autoGrowPoField);
  crpoRenderLines();
}

// Basic / GST / Total PO Amount start as the sum of the product rows and
// follow them, until someone types one (13 Oct 2026): then the typed values
// are kept and saved (crpoReview.amounts). Typing Basic or GST updates Total.
function crpoRenderAmounts() {
  const el = document.getElementById('crpo-amounts');
  if (!el) return;
  let basic = 0, gst = 0;
  crpoReview.lineItems.forEach(li => { basic += crpoNum(li.quantity) * crpoNum(li.ratePerQuantity); gst += crpoNum(li.gstAmount); });
  const a = crpoReview.amounts || (crpoReview.amounts = { edited: false });
  if (!a.edited) { a.basic = String(Math.round(basic * 100) / 100); a.gst = String(Math.round(gst * 100) / 100); a.total = String(Math.round((basic + gst) * 100) / 100); }
  const focused = document.activeElement && document.activeElement.id && document.activeElement.id.startsWith('crpo-amt-');
  if (focused && el.children.length) return; // don't redraw under the cursor
  const box = (label, k) => `<div class="grid-cell-item" style="grid-column: span 4;"><label style="font-size:0.72rem;">${label}</label>
    <input id="crpo-amt-${k}" type="text" inputmode="decimal" value="${escapeHtml(formatIndianCurrencyInput(a[k] ?? ''))}"
      oninput="crpoAmountTyped('${k}', sanitizeAmountInput(this))"
      onfocus="this.value = (crpoReview.amounts['${k}'] ?? '').toString();"
      onblur="this.value = formatIndianCurrencyInput(crpoReview.amounts['${k}']);"
      style="padding:6px 8px; font-weight:600; font-size:0.95rem; border:1.5px solid #8492a6; border-radius:4px; text-align:right; width:100%; box-sizing:border-box;" /></div>`;
  el.innerHTML = box('Basic PO Amount', 'basic') + box('PO GST Amount', 'gst') + box('PO Total Amount', 'total');
}

function crpoAmountTyped(k, value) {
  const a = crpoReview.amounts;
  a.edited = true;
  a[k] = value;
  if (k !== 'total') {
    a.total = String(Math.round((crpoNum(a.basic) + crpoNum(a.gst)) * 100) / 100);
    const t = document.getElementById('crpo-amt-total');
    if (t) t.value = formatIndianCurrencyInput(a.total);
  }
}

function crpoLineWarning(li) {
  if (!li.matchLineId) return '';
  const old = crpoDetails.lines.find(l => String(l.lineId) === String(li.matchLineId));
  if (!old) return '';
  const qty = crpoNum(li.quantity);
  const inv = Number(old.invoicedQuantity) || 0, mfc = Number(old.mfcQuantity) || 0;
  if (qty < inv) return `<div style="color:#b91c1c; font-size:0.75rem; font-weight:700;">Below invoiced qty (${fmtQty(inv)}) — not allowed</div>`;
  if (qty < mfc) return `<div style="color:#b45309; font-size:0.75rem; font-weight:700;">Below MFC qty (${fmtQty(mfc)}) — MFC and BOQ / Job Cards will be reduced</div>`;
  return '';
}

function crpoRenderLines() {
  const usedBy = {};
  crpoReview.lineItems.forEach((li, i) => { if (li.matchLineId) usedBy[li.matchLineId] = i; });
  const opts = (i, cur) => '<option value="">New row</option>' + crpoDetails.lines.map(l => {
    const taken = usedBy[l.lineId] !== undefined && usedBy[l.lineId] !== i;
    return `<option value="${l.lineId}" ${String(cur) === String(l.lineId) ? 'selected' : ''} ${taken ? 'disabled' : ''}>${escapeHtml((l.description || l.itemCode || 'Row ' + l.lineId).slice(0, 70))} (qty ${fmtQty(l.quantity)})</option>`;
  }).join('');
  const cell = 'width:100%; min-width:0; box-sizing:border-box; padding:5px; font-size:0.85rem;';
  const wrapTxt = (i, k, align) => `<textarea rows="1" oninput="crpoUpdateLine(${i}, '${k}', this.value); autoGrowPoField(this);" onfocus="autoGrowPoField(this);"
    style="${cell} text-align:${align}; resize:none; overflow:hidden; font-family:inherit; min-height:28px;">${escapeHtml(String(crpoReview.lineItems[i][k] ?? ''))}</textarea>`;
  const amt = (i, k) => `<input type="text" inputmode="decimal" value="${escapeHtml(formatIndianCurrencyInput(crpoReview.lineItems[i][k] ?? ''))}"
    oninput="crpoUpdateLine(${i}, '${k}', sanitizeAmountInput(this))"
    onfocus="this.value = (crpoReview.lineItems[${i}]['${k}'] ?? '').toString();"
    onblur="this.value = formatIndianCurrencyInput(crpoReview.lineItems[${i}]['${k}']);"
    style="${cell} text-align:right;" />`;
  const derived = (id, v) => `<input id="${id}" type="text" value="${escapeHtml(formatIndianCurrencyInput(String(v)))}" readonly disabled style="${cell} text-align:right; background:#eef1f5; color:var(--text); border:1px solid var(--border);" />`;
  const rows = crpoReview.lineItems.map((li, i) => {
    const basic = crpoNum(li.quantity) * crpoNum(li.ratePerQuantity);
    return `<tr>
      <td style="vertical-align:middle;"><select onchange="crpoUpdateLine(${i}, 'matchLineId', this.value, true)" style="${cell}">${opts(i, li.matchLineId)}</select><div id="crpo-warn-${i}">${crpoLineWarning(li)}</div></td>
      <td style="vertical-align:middle;">${wrapTxt(i, 'itemCode', 'center')}</td>
      <td style="vertical-align:middle;">${wrapTxt(i, 'hsnNumber', 'center')}</td>
      <td style="vertical-align:middle;">${wrapTxt(i, 'description', 'left')}</td>
      <td style="vertical-align:middle;"><input type="number" value="${escapeHtml(String(li.quantity ?? ''))}" oninput="crpoUpdateLine(${i}, 'quantity', this.value)" style="${cell} text-align:right;" /></td>
      <td style="vertical-align:middle;">${wrapTxt(i, 'unit', 'center')}</td>
      <td style="vertical-align:middle;">${amt(i, 'ratePerQuantity')}</td>
      <td style="vertical-align:middle;">${derived(`crpo-basic-${i}`, basic)}</td>
      <td style="vertical-align:middle;">${amt(i, 'gstAmount')}</td>
      <td style="vertical-align:middle;">${derived(`crpo-total-${i}`, basic + crpoNum(li.gstAmount))}</td>
      <td style="vertical-align:middle; text-align:center;"><button class="po-li-del-btn" onclick="crpoDeleteRow(${i})" title="Remove row">✕</button></td>
    </tr>`;
  }).join('');
  const el = document.getElementById('crpo-review-lines');
  el.innerHTML = `
    <div class="po-li-table-wrap" style="overflow-x:auto;">
    <table class="store-basket-data-table" style="width:100%; min-width:1100px; table-layout:fixed;">
      <colgroup><col style="width:15%"><col style="width:7.5%"><col style="width:6.5%"><col style="width:23%"><col style="width:6%"><col style="width:5%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:3%"></colgroup>
      <thead><tr>
        <th style="text-align:left;">Revises Current Row</th><th style="text-align:center;">Customer Item Code</th><th style="text-align:center;">HSN Number</th>
        <th style="text-align:left;">Order Product Description *</th><th style="text-align:right;">Order Quantity *</th><th style="text-align:center;">UOM</th>
        <th style="text-align:right;">Rate / Quantity</th><th style="text-align:right;">Total Basic Price</th><th style="text-align:right;">GST Amount</th>
        <th style="text-align:right;">Total Amount (incl. GST)</th><th></th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="11" style="text-align:center; color:var(--muted);">No rows. Click + Add Row.</td></tr>'}</tbody>
    </table></div>`;
  el.querySelectorAll('textarea').forEach(autoGrowPoField);
  crpoRenderUnmapped();
  crpoRenderAmounts();
}

function crpoRenderUnmapped() {
  const mapped = new Set(crpoReview.lineItems.map(li => String(li.matchLineId || '')));
  const unmapped = crpoDetails.lines.filter(l => !mapped.has(String(l.lineId)));
  [...crpoReview.removeLineIds].forEach(id => { if (mapped.has(String(id))) crpoReview.removeLineIds.delete(id); });
  const el = document.getElementById('crpo-unmapped');
  if (!unmapped.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="margin-top:16px; font-weight:700;">Current rows not in the revision</div>
    <div style="color:var(--muted); font-size:0.8rem; margin-bottom:6px;">These stay unchanged unless you tick Remove. A row with MFC, a BOQ or an invoice cannot be removed.</div>
    ${unmapped.map(l => {
      const locked = (Number(l.mfcQuantity) || 0) > 0 || l.hasBoq || (Number(l.invoicedQuantity) || 0) > 0;
      return `<label style="display:flex; gap:8px; align-items:center; padding:4px 0; font-size:0.85rem; ${locked ? 'color:var(--muted);' : ''}">
        <input type="checkbox" style="width:auto;" ${locked ? 'disabled' : ''} ${crpoReview.removeLineIds.has(l.lineId) ? 'checked' : ''} onchange="crpoToggleRemove(${l.lineId}, this.checked)">
        Remove "${escapeHtml(l.description || l.itemCode || '')}" (qty ${fmtQty(l.quantity)})${locked ? ' — has MFC / BOQ / invoice' : ''}</label>`;
    }).join('')}`;
}

function crpoUpdateLine(i, key, value, rerender) {
  const li = crpoReview.lineItems[i];
  if (!li) return;
  li[key] = key === 'matchLineId' ? (value ? Number(value) : null) : value;
  if (rerender) { crpoRenderLines(); return; }
  const basic = crpoNum(li.quantity) * crpoNum(li.ratePerQuantity);
  const basicEl = document.getElementById(`crpo-basic-${i}`);
  if (basicEl) basicEl.value = formatIndianCurrencyInput(String(basic));
  const totalEl = document.getElementById(`crpo-total-${i}`);
  if (totalEl) totalEl.value = formatIndianCurrencyInput(String(basic + crpoNum(li.gstAmount)));
  crpoRenderAmounts();
  const warnEl = document.getElementById(`crpo-warn-${i}`);
  if (warnEl) warnEl.innerHTML = crpoLineWarning(li);
}
function crpoAddRow() {
  crpoReview.lineItems.push({ itemCode: '', hsnNumber: '', description: '', quantity: '', unit: '', ratePerQuantity: '', gstAmount: '', matchLineId: null });
  crpoRenderLines();
}
function crpoDeleteRow(i) { crpoReview.lineItems.splice(i, 1); crpoRenderLines(); }
function crpoToggleRemove(lineId, on) { if (on) crpoReview.removeLineIds.add(lineId); else crpoReview.removeLineIds.delete(lineId); }

// Same look as Upload Purchase Order's "Purchase Order Saved" card.
function crpoRenderSuccess(data, h, review) {
  const pid = data.projectId || review.projectId;
  const amt = review.amounts || {};
  const rupee = (v) => (v || v === 0) && String(v).trim() !== '' ? '₹' + crpoNum(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
  const tile = (label, value, mono) => `
    <div style="background:#fff; border:1px solid #d1fae5; border-radius:8px; padding:12px 14px; min-width:0;">
      <div style="font-size:0.7rem; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; color:#6b7a8d; margin-bottom:4px;">${label}</div>
      <div style="font-size:1.02rem; font-weight:700; color:#111827; overflow-wrap:anywhere; ${mono ? 'font-family:monospace;' : ''}">${value}</div>
    </div>`;
  const link = (url, text) => `<a href="${driveLink(url)}" target="_blank" rel="noopener" style="display:inline-block; margin:8px 10px 0 0; background:#fff; color:var(--brand); border:1.5px solid var(--brand); padding:7px 16px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; text-decoration:none;">${text}</a>`;
  const notes = [];
  if (data.oldProjectId) notes.push(`Project ID renamed from <b>${escapeHtml(data.oldProjectId)}</b> (${data.renamedIds} IDs renamed). BOQ / PRN documents and Drive folders are being updated in the background.`);
  if (data.summary) notes.push(escapeHtml(data.summary));
  if (data.revisedBoqIds && data.revisedBoqIds.length) notes.push('Revised BOQs: ' + data.revisedBoqIds.map(x => escapeHtml(x)).join(', '));
  (data.docWarnings || []).forEach(w => notes.push(`<span style="color:#b45309;">${escapeHtml(w)}</span>`));
  if (!data.withoutDocument && !data.fileUrl) notes.push('<span style="color:#b45309;">The PO document could not be saved to Drive.</span>');
  crpoBanner('');
  ['crpo-details-zone', 'crpo-upload-zone'].forEach(id => { const z = document.getElementById(id); if (z) { z.innerHTML = ''; z.style.display = 'none'; } });
  const zone = document.getElementById('crpo-review-zone');
  zone.style.display = 'block';
  zone.innerHTML = `
    <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:10px; padding:18px 20px; margin-top:8px;">
      <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
        <div style="flex:1; min-width:200px; font-size:1.15rem; font-weight:800; color:#15803d;">Revised Purchase Order Saved</div>
        <button class="nav-btn-styled" onclick="crpoReviseAnother()" style="width:auto; background:#15803d; color:#fff; padding:9px 18px; font-weight:700;">+ Revise Another</button>
      </div>
      <div style="margin-top:16px; background:#fff; border:1.5px solid #15803d; border-radius:8px; padding:12px 14px;">
        <div style="font-size:0.7rem; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; color:#6b7a8d; margin-bottom:4px;">Project ID</div>
        <div style="font-family:monospace; font-size:1.05rem; font-weight:700; color:#111827; overflow-wrap:anywhere;">${escapeHtml(pid)}</div>
      </div>
      <div style="margin-top:12px; display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:10px;">
        ${tile('Revision', escapeHtml(String(data.revisionNo ?? '—')))}
        ${tile('PO Number', escapeHtml(h.poNumber || '—'), true)}
        ${tile('Tentative Delivery Date', formatOrdinalDate(h.deliveryDate) || escapeHtml(h.deliveryDate || '—'))}
        ${tile('Basic Amount (excl. GST)', rupee(amt.basic))}
        ${tile('Total Amount (incl. GST)', rupee(amt.total))}
      </div>
      ${notes.length ? `<div style="margin-top:12px; font-size:0.85rem; color:#166534; line-height:1.5;">${notes.join('<br>')}</div>` : ''}
      <div>${data.fileUrl ? link(data.fileUrl, 'View Revised PO') : ''}${data.orderAcceptanceUrl ? link(data.orderAcceptanceUrl, 'View Order Acceptance') : ''}${data.contractReviewUrl ? link(data.contractReviewUrl, 'View Contract Review') : ''}</div>
    </div>`;
  zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function crpoReviseAnother() {
  crpoReview = null; crpoFile = null; crpoOaFile = null; crpoCrFile = null;
  const z = document.getElementById('crpo-review-zone'); if (z) { z.innerHTML = ''; z.style.display = 'none'; }
  await crpoInitPanel();
  const sel = document.getElementById('crpo-project-select'), inp = document.getElementById('crpo-project-ta-input');
  if (sel) sel.value = ''; if (inp) inp.value = '';
}

async function crpoSubmit() {
  if (!crpoReview) return;
  const h = crpoReview.header;
  if (!String(h.deliveryDate || '').trim()) return abpsAlert('Tentative Delivery Date is required.');
  const lines = crpoReview.lineItems.filter(li => (li.description || li.itemCode));
  if (!lines.length) return abpsAlert('At least one product row is required.');
  if (lines.some(li => String(li.quantity ?? '').trim() === '')) return abpsAlert('Every product row needs a quantity.');
  const cuts = [];
  for (const li of lines) {
    if (!li.matchLineId) continue;
    const old = crpoDetails.lines.find(l => String(l.lineId) === String(li.matchLineId));
    if (!old) continue;
    const qty = crpoNum(li.quantity);
    if (qty < (Number(old.invoicedQuantity) || 0)) return abpsAlert(`"${old.description}" cannot go below its invoiced quantity (${fmtQty(old.invoicedQuantity)}).`);
    if (qty < (Number(old.mfcQuantity) || 0)) cuts.push(`${old.description}: MFC ${fmtQty(old.mfcQuantity)} → ${fmtQty(qty)}`);
  }
  const poChanged = String(h.poNumber || '').trim() !== String((crpoDetails.header || {}).poNumber || '').trim();
  const msg = (crpoReview.withoutDocument ? `Save these changes to the Purchase Order for ${crpoReview.projectId}? No new document will be attached.` : `Submit this revision of the Purchase Order for ${crpoReview.projectId}?`) +
    (cuts.length ? `\n\nThese products go below their MFC quantity. MFC, BOQ and Job Cards will be reduced:\n• ${cuts.join('\n• ')}` : '') +
    (crpoReview.removeLineIds.size ? `\n\n${crpoReview.removeLineIds.size} current row(s) will be removed.` : '') +
    (poChanged ? `\n\nThe PO Number changes to "${h.poNumber}". The Project ID and every BOQ, PRN and Job Card ID built from it will be renamed to the new PO Number.` : '') +
    (crpoOaFile ? '\n\nThe Order Acceptance document will be replaced.' : '') +
    (crpoCrFile ? '\n\nThe Contract Review document will be replaced.' : '');
  if (!await abpsConfirm(msg)) return;

  const btn = document.getElementById('crpo-submit-btn');
  if (btn) btn.disabled = true;
  showBlockingOverlay('Saving Revised Purchase Order...');
  try {
    const docPayload = async (f) => f ? { base64Data: await crpoReadBase64(f), fileName: f.name, mimeType: f.type || 'application/octet-stream' } : null;
    const orderAcceptanceFile = await docPayload(crpoOaFile);
    const contractReviewFile = await docPayload(crpoCrFile);
    const data = await apFetch({
      orderAcceptanceFile, contractReviewFile,
      action: 'commitRevisedPurchaseOrder', _timeoutMs: 180000,
      projectId: crpoReview.projectId, header: h, lineItems: lines,
      removeLineIds: [...crpoReview.removeLineIds],
      poAmounts: crpoReview.amounts && crpoReview.amounts.edited
        ? { basic: crpoNum(crpoReview.amounts.basic), gst: crpoNum(crpoReview.amounts.gst), total: crpoNum(crpoReview.amounts.total) } : null,
      fileName: crpoFile ? crpoFile.name : 'Revised_PO', base64Data: crpoReview.base64Data,
      mimeType: crpoFile ? (crpoFile.type || 'application/octet-stream') : 'application/octet-stream',
    });
    if (!data.success) { crpoBanner(escapeHtml(data.error || 'Saving failed.')); return; }
    crpoRenderSuccess(data, h, crpoReview);
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') crpoBanner('Network error: ' + escapeHtml(e.message));
  } finally {
    hideBlockingOverlay();
    if (btn) btn.disabled = false;
  }
}
