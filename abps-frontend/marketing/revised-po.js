// Upload Revised Purchase Order (Marketing). Pick an Active project, view its
// current customer PO, upload the revised PO, review the AI extraction (map
// each row to an existing PO row or New), then commit.
let crpoProjects = [];
let crpoDetails = null;
let crpoReview = null;
let crpoFile = null;

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
  crpoDetails = null; crpoReview = null; crpoFile = null;
  crpoBanner('');
  ['crpo-details-zone', 'crpo-upload-zone', 'crpo-review-zone'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  });
  const sel = document.getElementById('crpo-project-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading projects...</option>';
  try {
    const data = await apFetch({ action: 'fetchActiveProjectsForPoRevision' });
    if (!data.success) { sel.innerHTML = '<option value="">Could not load projects</option>'; crpoBanner(escapeHtml(data.error || 'Failed to load projects.')); return; }
    crpoProjects = data.projects || [];
    sel.innerHTML = '<option value="">— Select an Active project —</option>' + crpoProjects.map(p =>
      `<option value="${escapeHtml(p.projectId)}">${escapeHtml(p.companyName || '')} · ${escapeHtml(p.projectId)}${p.poNumber ? ' · PO ' + escapeHtml(p.poNumber) : ''}</option>`).join('');
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') sel.innerHTML = '<option value="">Network error</option>';
  }
}

async function crpoSelectProject(projectId) {
  crpoReview = null; crpoFile = null; crpoBanner('');
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
    crpoRenderDetails();
    uz.style.display = 'block';
    uz.innerHTML = `
      <div style="margin-top:18px; font-weight:800; color:var(--brand); font-size:1.05rem;">Upload Revised Purchase Order</div>
      <div class="card-box" id="crpo-upload-box" onclick="document.getElementById('crpo-file').click()" style="margin-top:8px; padding:24px; font-size:0.9rem; min-height:90px; display:flex; align-items:center; justify-content:center;">📋 Select Revised Purchase Order *</div>
      <input type="file" id="crpo-file" accept="image/*,application/pdf" hidden onchange="crpoFileChosen(this)" />
      <button class="nav-btn-styled" id="crpo-extract-btn" style="margin-top:12px; width:100%; padding:10px;" onclick="crpoExtract()">Process Revised Purchase Order with AI</button>
      <div style="text-align:center; color:var(--muted); font-size:0.85rem; margin:12px 0 6px;">or</div>
      <button class="nav-btn-styled" style="width:100%; padding:10px; background:#475569;" onclick="crpoEditWithoutDocument()">Edit without a new document</button>`;
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') dz.innerHTML = `<div style="color:#b91c1c;">Network error: ${escapeHtml(e.message)}</div>`;
  }
}

function crpoRenderDetails() {
  const d = crpoDetails, h = d.header;
  const cell = (label, val, span) => `<div style="grid-column:span ${span}; min-width:0;"><div style="font-size:0.72rem; font-weight:700; color:var(--muted); text-transform:uppercase;">${label}</div><div style="padding:6px 8px; background:#f1f5f9; border-radius:4px; font-size:0.85rem; min-height:30px; white-space:pre-wrap; word-break:break-word;">${val}</div></div>`;
  const fmtVal = (k, type) => {
    const v = h[k];
    if (v === null || v === undefined || v === '') return '—';
    if (type === 'date') return escapeHtml(formatOrdinalDate(v));
    if (type === 'number') return crpoMoney(v);
    return escapeHtml(String(v));
  };
  const a = d.amounts || {};
  const lines = d.lines.map(l => `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px;">${escapeHtml(l.itemCode || '—')}</td>
      <td style="padding:6px;">${escapeHtml(l.hsnNumber || '—')}</td>
      <td style="padding:6px;">${escapeHtml(l.description || '')}</td>
      <td style="padding:6px; text-align:center; font-weight:700;">${fmtQty(l.quantity)}</td>
      <td style="padding:6px; text-align:center;">${escapeHtml(l.unit || '—')}</td>
      <td style="padding:6px; text-align:right;">${crpoMoney(l.ratePerQuantity)}</td>
      <td style="padding:6px; text-align:right;">${crpoMoney(l.totalBasicPrice)}</td>
      <td style="padding:6px; text-align:right;">${crpoMoney(l.gstAmount)}</td>
      <td style="padding:6px; text-align:right;">${crpoMoney(l.totalAmount)}</td>
      <td style="padding:6px; text-align:center;">${fmtQty(l.mfcQuantity || 0)}</td>
      <td style="padding:6px; text-align:center;">${fmtQty(l.invoicedQuantity || 0)}</td>
    </tr>`).join('');
  const revs = (d.revisions || []).map(r => `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px; text-align:center; font-weight:700;">${r.revisionNo}</td>
      <td style="padding:6px;">${escapeHtml(r.poNumber || '—')}</td>
      <td style="padding:6px;">${escapeHtml(formatOrdinalDateTime(r.createdAt))}</td>
      <td style="padding:6px;">${escapeHtml(r.createdBy || '')}</td>
      <td style="padding:6px;">${escapeHtml(r.summary || '')}</td>
      <td style="padding:6px; text-align:center;">${r.poDocumentUrl ? `<a href="${driveLink(r.poDocumentUrl)}" target="_blank" rel="noopener">View ↗</a>` : '—'}</td>
    </tr>`).join('');
  document.getElementById('crpo-details-zone').innerHTML = `
    <div style="margin-top:14px; font-weight:800; color:var(--brand); font-size:1.05rem;">Current Purchase Order — ${escapeHtml(h.companyName || '')} (${escapeHtml(h.projectId)})</div>
    <div style="display:grid; grid-template-columns:repeat(12, minmax(0,1fr)); gap:10px; margin-top:10px;">
      ${CRPO_HEADER_FIELDS.map(([k, label, type, span]) => cell(label.replace(' *', ''), fmtVal(k, type), span)).join('')}
      ${cell('Basic PO Amount', crpoMoney(a.poBasicAmount), 3)}${cell('GST Amount', crpoMoney(a.poGstAmount), 3)}${cell('Total PO Amount', crpoMoney(a.poTotalAmount), 3)}
      ${cell('PO Document', a.poDocumentUrl ? `<a href="${driveLink(a.poDocumentUrl)}" target="_blank" rel="noopener">View PO ↗</a>` : '—', 3)}
    </div>
    <div style="overflow-x:auto; margin-top:14px;">
      <table style="width:100%; min-width:900px; border-collapse:collapse; font-size:0.82rem;">
        <thead><tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:6px;">Customer Item Code</th><th style="padding:6px;">HSN</th><th style="padding:6px;">Order Product Description</th>
          <th style="padding:6px; text-align:center;">Qty</th><th style="padding:6px; text-align:center;">UOM</th><th style="padding:6px; text-align:right;">Rate</th>
          <th style="padding:6px; text-align:right;">Basic</th><th style="padding:6px; text-align:right;">GST</th><th style="padding:6px; text-align:right;">Total</th>
          <th style="padding:6px; text-align:center;">MFC Qty</th><th style="padding:6px; text-align:center;">Invoiced Qty</th>
        </tr></thead>
        <tbody>${lines || '<tr><td colspan="11" style="padding:10px; color:var(--muted);">No product rows.</td></tr>'}</tbody>
      </table>
    </div>
    ${revs ? `<div style="margin-top:14px; font-weight:700;">Revision History</div>
    <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
      <thead><tr style="background:var(--highlight-bg); text-align:left;"><th style="padding:6px; text-align:center;">Rev</th><th style="padding:6px;">PO Number</th><th style="padding:6px;">Date</th><th style="padding:6px;">By</th><th style="padding:6px;">Changes</th><th style="padding:6px; text-align:center;">Document</th></tr></thead>
      <tbody>${revs}</tbody></table></div>` : ''}`;
}

function crpoFileChosen(input) {
  crpoFile = input.files && input.files[0] ? input.files[0] : null;
  const box = document.getElementById('crpo-upload-box');
  if (box) box.textContent = crpoFile ? `✅ ${crpoFile.name}` : '📋 Select Revised Purchase Order *';
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
  if (!projectId) return alert('Select a project first.');
  if (!crpoFile) return alert('Select the revised Purchase Order file first.');
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

// Same review form, filled with the current PO, so a few fields can be
// corrected and saved without uploading a revised document.
function crpoEditWithoutDocument() {
  const projectId = document.getElementById('crpo-project-select').value;
  if (!projectId || !crpoDetails) return alert('Select a project first.');
  crpoFile = null;
  const box = document.getElementById('crpo-upload-box');
  if (box) box.textContent = '📋 Select Revised Purchase Order *';
  const header = {};
  CRPO_HEADER_FIELDS.forEach(([k]) => { header[k] = crpoDetails.header[k] == null ? '' : crpoDetails.header[k]; });
  const lineItems = crpoDetails.lines.map(l => ({
    itemCode: l.itemCode || '', hsnNumber: l.hsnNumber || '', description: l.description || '',
    quantity: l.quantity ?? '', unit: l.unit || '', ratePerQuantity: l.ratePerQuantity ?? '', gstAmount: l.gstAmount ?? '',
    matchLineId: l.lineId,
  }));
  crpoReview = { projectId, base64Data: null, header, lineItems, removeLineIds: new Set(), withoutDocument: true };
  crpoRenderReview();
  document.getElementById('crpo-review-zone').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function crpoRenderReview() {
  const rz = document.getElementById('crpo-review-zone');
  rz.style.display = 'block';
  const h = crpoReview.header;
  const headerHtml = CRPO_HEADER_FIELDS.map(([k, label, type, span]) => {
    const v = h[k] == null ? '' : h[k];
    const input = type === 'date'
      ? `<input type="date" lang="en-GB" value="${escapeHtml(String(v).slice(0, 10))}" onchange="crpoReview.header['${k}'] = this.value" style="width:100%; padding:6px;">`
      : type === 'number'
        ? `<input type="text" inputmode="decimal" value="${escapeHtml(String(v))}" oninput="crpoReview.header['${k}'] = this.value" style="width:100%; padding:6px;">`
        : `<textarea rows="1" oninput="crpoReview.header['${k}'] = this.value; this.style.height='auto'; this.style.height=this.scrollHeight+'px';" style="width:100%; padding:6px; resize:none; overflow:hidden; font-family:inherit;">${escapeHtml(String(v))}</textarea>`;
    return `<div style="grid-column:span ${span}; min-width:0;"><label class="field-label">${label}</label>${input}</div>`;
  }).join('');
  rz.innerHTML = `
    <div style="margin-top:20px; padding:16px; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius);">
      <div style="font-weight:800; color:var(--brand); font-size:1.1rem;">${crpoReview.withoutDocument ? 'Edit Purchase Order' : 'Review Revised Purchase Order'}</div>
      <div style="color:var(--muted); font-size:0.82rem; margin:4px 0 12px;">${crpoReview.withoutDocument
        ? 'Change only the values that need correcting and save. No new document is attached; the revision history records what changed.'
        : 'Check every value. For each product row choose which current PO row it revises, or "New row". Current rows you don\'t map stay as they are unless you tick Remove.'}</div>
      <div style="display:grid; grid-template-columns:repeat(12, minmax(0,1fr)); gap:10px;">${headerHtml}</div>
      <div style="margin-top:16px; font-weight:700;">Product Rows</div>
      <div id="crpo-review-lines"></div>
      <button class="nav-btn-styled" style="margin-top:8px; width:auto; padding:6px 14px; background:#475569;" onclick="crpoAddRow()">+ Add Row</button>
      <div id="crpo-unmapped"></div>
      <button class="nav-btn-styled" id="crpo-submit-btn" style="margin-top:16px; width:100%; padding:10px; background:var(--accent); font-weight:700;" onclick="crpoSubmit()">${crpoReview.withoutDocument ? 'Save Changes' : 'Submit Revised Purchase Order'}</button>
    </div>`;
  rz.querySelectorAll('textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; });
  crpoRenderLines();
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
  const inp = (i, k, w, align) => `<input type="text" value="${escapeHtml(String(crpoReview.lineItems[i][k] ?? ''))}" oninput="crpoUpdateLine(${i}, '${k}', this.value)" style="width:100%; padding:4px; ${align ? 'text-align:' + align + ';' : ''}">`;
  const rows = crpoReview.lineItems.map((li, i) => {
    const basic = crpoNum(li.quantity) * crpoNum(li.ratePerQuantity);
    return `<tr style="border-bottom:1px solid var(--border); vertical-align:top;">
      <td style="padding:4px;"><select onchange="crpoUpdateLine(${i}, 'matchLineId', this.value, true)" style="width:100%; padding:4px;">${opts(i, li.matchLineId)}</select><div id="crpo-warn-${i}">${crpoLineWarning(li)}</div></td>
      <td style="padding:4px;">${inp(i, 'itemCode')}</td>
      <td style="padding:4px;">${inp(i, 'hsnNumber')}</td>
      <td style="padding:4px;"><textarea rows="2" oninput="crpoUpdateLine(${i}, 'description', this.value)" style="width:100%; padding:4px; font-family:inherit; resize:vertical;">${escapeHtml(li.description || '')}</textarea></td>
      <td style="padding:4px;">${inp(i, 'quantity', 0, 'center')}</td>
      <td style="padding:4px;">${inp(i, 'unit', 0, 'center')}</td>
      <td style="padding:4px;">${inp(i, 'ratePerQuantity', 0, 'right')}</td>
      <td style="padding:4px; text-align:right;" id="crpo-basic-${i}">${crpoMoney(basic)}</td>
      <td style="padding:4px;">${inp(i, 'gstAmount', 0, 'right')}</td>
      <td style="padding:4px; text-align:center;"><button onclick="crpoDeleteRow(${i})" style="background:none; border:none; color:#b91c1c; font-weight:800; cursor:pointer;">✕</button></td>
    </tr>`;
  }).join('');
  document.getElementById('crpo-review-lines').innerHTML = `
    <div style="overflow-x:auto;"><table style="width:100%; min-width:1000px; border-collapse:collapse; font-size:0.82rem; table-layout:fixed;">
      <colgroup><col style="width:20%"><col style="width:9%"><col style="width:8%"><col style="width:23%"><col style="width:7%"><col style="width:6%"><col style="width:9%"><col style="width:9%"><col style="width:7%"><col style="width:2%"></colgroup>
      <thead><tr style="background:var(--highlight-bg); text-align:left;">
        <th style="padding:6px;">Revises Current Row</th><th style="padding:6px;">Customer Item Code</th><th style="padding:6px;">HSN</th><th style="padding:6px;">Order Product Description *</th>
        <th style="padding:6px; text-align:center;">Qty *</th><th style="padding:6px; text-align:center;">UOM</th><th style="padding:6px; text-align:right;">Rate</th><th style="padding:6px; text-align:right;">Basic</th><th style="padding:6px; text-align:right;">GST Amount</th><th></th>
      </tr></thead><tbody>${rows || '<tr><td colspan="10" style="padding:10px; color:var(--muted);">No rows.</td></tr>'}</tbody></table></div>`;
  crpoRenderUnmapped();
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
  const basicEl = document.getElementById(`crpo-basic-${i}`);
  if (basicEl) basicEl.innerHTML = crpoMoney(crpoNum(li.quantity) * crpoNum(li.ratePerQuantity));
  const warnEl = document.getElementById(`crpo-warn-${i}`);
  if (warnEl) warnEl.innerHTML = crpoLineWarning(li);
}
function crpoAddRow() {
  crpoReview.lineItems.push({ itemCode: '', hsnNumber: '', description: '', quantity: '', unit: '', ratePerQuantity: '', gstAmount: '', matchLineId: null });
  crpoRenderLines();
}
function crpoDeleteRow(i) { crpoReview.lineItems.splice(i, 1); crpoRenderLines(); }
function crpoToggleRemove(lineId, on) { if (on) crpoReview.removeLineIds.add(lineId); else crpoReview.removeLineIds.delete(lineId); }

async function crpoSubmit() {
  if (!crpoReview) return;
  const h = crpoReview.header;
  if (!String(h.deliveryDate || '').trim()) return alert('Tentative Delivery Date is required.');
  const lines = crpoReview.lineItems.filter(li => (li.description || li.itemCode));
  if (!lines.length) return alert('At least one product row is required.');
  if (lines.some(li => String(li.quantity ?? '').trim() === '')) return alert('Every product row needs a quantity.');
  const cuts = [];
  for (const li of lines) {
    if (!li.matchLineId) continue;
    const old = crpoDetails.lines.find(l => String(l.lineId) === String(li.matchLineId));
    if (!old) continue;
    const qty = crpoNum(li.quantity);
    if (qty < (Number(old.invoicedQuantity) || 0)) return alert(`"${old.description}" cannot go below its invoiced quantity (${fmtQty(old.invoicedQuantity)}).`);
    if (qty < (Number(old.mfcQuantity) || 0)) cuts.push(`${old.description}: MFC ${fmtQty(old.mfcQuantity)} → ${fmtQty(qty)}`);
  }
  const msg = (crpoReview.withoutDocument ? `Save these changes to the Purchase Order for ${crpoReview.projectId}? No new document will be attached.` : `Submit this revision of the Purchase Order for ${crpoReview.projectId}?`) +
    (cuts.length ? `\n\nThese products go below their MFC quantity. MFC, BOQ and Job Cards will be reduced:\n• ${cuts.join('\n• ')}` : '') +
    (crpoReview.removeLineIds.size ? `\n\n${crpoReview.removeLineIds.size} current row(s) will be removed.` : '');
  if (!await abpsConfirm(msg)) return;

  const btn = document.getElementById('crpo-submit-btn');
  if (btn) btn.disabled = true;
  showBlockingOverlay('Saving Revised Purchase Order...');
  try {
    const data = await apFetch({
      action: 'commitRevisedPurchaseOrder', _timeoutMs: 180000,
      projectId: crpoReview.projectId, header: h, lineItems: lines,
      removeLineIds: [...crpoReview.removeLineIds],
      fileName: crpoFile ? crpoFile.name : 'Revised_PO', base64Data: crpoReview.base64Data,
      mimeType: crpoFile ? (crpoFile.type || 'application/octet-stream') : 'application/octet-stream',
    });
    if (!data.success) { crpoBanner(escapeHtml(data.error || 'Saving failed.')); return; }
    const pid = crpoReview.projectId;
    const okMsg = `✅ Revision ${data.revisionNo} saved for ${escapeHtml(pid)}: ${escapeHtml(data.summary || '')}.` +
      (data.revisedBoqIds && data.revisedBoqIds.length ? ` Revised BOQs: ${data.revisedBoqIds.map(x => escapeHtml(x)).join(', ')}.` : '') +
      (data.withoutDocument ? '' : data.fileUrl ? ` <a href="${driveLink(data.fileUrl)}" target="_blank" rel="noopener">View revised PO ↗</a>` : ' <span style="color:#b45309;">(The PO document could not be saved to Drive.)</span>');
    await crpoSelectProject(pid);
    crpoBanner(okMsg, 'success');
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') crpoBanner('Network error: ' + escapeHtml(e.message));
  } finally {
    hideBlockingOverlay();
    if (btn) btn.disabled = false;
  }
}
