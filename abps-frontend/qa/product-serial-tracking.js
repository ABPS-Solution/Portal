// ===========================================================================
// qa/product-serial-tracking.js -- Quality Assurance > Product Serial Number
// Tracking. job_card_number identifies a finished good INSIDE the company;
// product_serial_number identifies it OUTSIDE, at the customer's site. QA
// types a serial number here and gets the full build/QA/PO-sourcing audit
// back — read-only throughout, the search box is the only input on this
// screen.
//
// Every top-level name here is prefixed psn*/PSN_ — this file shares one
// global scope with every other <script> in the app (no bundler, see
// CLAUDE.md), so a bare name collision is a fatal SyntaxError for the
// whole portal, not just this screen.
// ===========================================================================

let psnActiveTab = 'search';
let psnHits = [];
let psnActiveFgId = null;
let psnQueueFilter = { missingSnapshotOnly: false };

const PSN_TIER_META = {
  exact: { label: 'Exact', color: '#15803d', bg: '#dcfce7' },
  auto:  { label: 'Auto-assigned', color: '#b45309', bg: '#fef3c7' },
  fifo:  { label: 'FIFO-inferred', color: '#1d4ed8', bg: '#dbeafe' },
};

function initializeProductSerialTrackingPanel() {
  psnActiveTab = 'search';
  psnHits = [];
  psnActiveFgId = null;
  psnQueueFilter = { missingSnapshotOnly: false };

  const feedback = document.getElementById('psn-feedback');
  if (feedback) feedback.style.display = 'none';
  document.getElementById('psn-results').innerHTML = '';
  document.getElementById('psn-detail').innerHTML = '';
  document.getElementById('psn-queue-body').innerHTML = '';

  psnRenderTabBar();
  psnShowTab('search');

  const input = document.getElementById('psn-search-input');
  if (input) {
    input.value = '';
    input.onkeydown = (e) => { if (e.key === 'Enter') psnRunSearch(); };
  }
}

function psnRenderTabBar() {
  const bar = document.getElementById('psn-tab-bar');
  if (!bar) return;
  const tabs = [{ key: 'search', label: 'Search by Serial' }, { key: 'queue', label: 'All Units' }];
  bar.innerHTML = tabs.map(t => {
    const active = psnActiveTab === t.key;
    return `<button class="nav-btn-styled" style="${active ? '' : 'background:var(--card); color:var(--text); border:1px solid var(--border);'}" onclick="psnShowTab('${t.key}')">${escapeHtml(t.label)}</button>`;
  }).join('');
}

function psnShowTab(tab) {
  psnActiveTab = tab;
  psnRenderTabBar();
  document.getElementById('psn-search-tab').style.display = tab === 'search' ? 'block' : 'none';
  document.getElementById('psn-queue-tab').style.display = tab === 'queue' ? 'block' : 'none';
  if (tab === 'queue') psnLoadQueue();
}

// ── Search ────────────────────────────────────────────────────────────────
async function psnRunSearch() {
  const input = document.getElementById('psn-search-input');
  const serial = (input?.value || '').trim();
  document.getElementById('psn-detail').innerHTML = '';
  if (!serial) {
    showPurchaseFeedback('psn-feedback', 'Enter a serial number to search.', 'error');
    return;
  }
  document.getElementById('psn-results').innerHTML = `<p style="color:var(--muted);">Searching...</p>`;
  try {
    const data = await apFetch({ action: 'searchProductSerial', serial });
    if (!data.success) { showPurchaseFeedback('psn-feedback', escapeHtml(data.error || 'Search failed.'), 'error'); document.getElementById('psn-results').innerHTML = ''; return; }
    psnHits = data.rows || [];
    if (psnHits.length === 0) {
      document.getElementById('psn-results').innerHTML = `<p style="color:var(--muted); padding:12px 0;">No product found with that serial number.</p>`;
    } else if (psnHits.length === 1) {
      document.getElementById('psn-results').innerHTML = '';
      await psnOpenDetail(psnHits[0].fgId);
    } else {
      psnRenderChooser();
    }
  } catch (err) {
    showPurchaseFeedback('psn-feedback', 'Search failed — please try again.', 'error');
    document.getElementById('psn-results').innerHTML = '';
  }
}

function psnRenderChooser() {
  const wrap = document.getElementById('psn-results');
  wrap.innerHTML = `
    <p style="color:var(--muted); margin-bottom:8px;">Multiple products matched — select the one you need:</p>
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${psnHits.map(h => `
        <div onclick="psnOpenDetail(${h.fgId})" style="cursor:pointer; padding:12px; border:1px solid var(--border); border-radius:var(--radius); background:var(--card);">
          <strong>${escapeHtml(h.productSerialNumber || '')}</strong>
          — ${escapeHtml(h.productName || '')} ${escapeHtml(h.productRating || '')}
          <div style="font-size:0.8rem; color:var(--muted); margin-top:4px;">
            Job Card ${escapeHtml(h.jobCardNumber || '')} · Project ${escapeHtml(h.projectId || '—')} · ${escapeHtml(h.customerName || '')} · ${escapeHtml(h.status || '')}
          </div>
        </div>`).join('')}
    </div>`;
}

// ── Detail ────────────────────────────────────────────────────────────────
async function psnOpenDetail(fgId) {
  psnActiveFgId = fgId;
  const detailEl = document.getElementById('psn-detail');
  detailEl.innerHTML = `<p style="color:var(--muted);">Loading...</p>`;
  try {
    const data = await apFetch({ action: 'fetchProductSerialDetail', fgId });
    if (!data.success) { showPurchaseFeedback('psn-feedback', escapeHtml(data.error || 'Could not load this record.'), 'error'); detailEl.innerHTML = ''; return; }
    detailEl.innerHTML = psnRenderDetail(data);
  } catch (err) {
    showPurchaseFeedback('psn-feedback', 'Failed to load product detail.', 'error');
    detailEl.innerHTML = '';
  }
}

function psnField(label, value) {
  return `<div><div style="font-size:0.72rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.03em;">${escapeHtml(label)}</div><div style="font-size:0.95rem;">${value === null || value === undefined || value === '' ? '—' : value}</div></div>`;
}

function psnCard(title, innerHtml) {
  return `<div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:14px;">
    <div style="font-weight:600; margin-bottom:10px;">${escapeHtml(title)}</div>
    ${innerHtml}
  </div>`;
}

function psnRenderDetail(data) {
  const h = data.header;
  const documents = data.documents || [];
  const trace = data.trace;

  const identity = `
    <div style="font-size:1.4rem; font-weight:700; margin-bottom:10px;">${escapeHtml(h.productSerialNumber || '')}</div>
    <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px;">
      ${psnField('Product', escapeHtml(h.productName || ''))}
      ${psnField('Rating', escapeHtml(h.productRating || ''))}
      ${psnField('Description of Material', escapeHtml(h.descriptionOfMaterial || ''))}
      ${psnField('Make', escapeHtml(h.make || ''))}
      ${psnField('Item Code', escapeHtml(h.itemCode || ''))}
      ${psnField('Unit', escapeHtml(h.unit || ''))}
      ${psnField('Finished Good Use', escapeHtml(h.finishedGoodUse || ''))}
      ${psnField('Department', escapeHtml(h.department || ''))}
      ${psnField('Status', escapeHtml(h.status || ''))}
    </div>`;

  const dispatchLine = h.invoiceId
    ? `Invoice ${escapeHtml(h.invoiceNo || '')} (${escapeHtml(h.invoiceType || '')}) — ${formatDateDMY(h.dispatchDate)}`
    : `<span style="color:var(--muted);">Not dispatched</span>`;
  const whereItWent = `<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">
      ${psnField('Project ID', escapeHtml(h.projectId || ''))}
      ${psnField('Company', escapeHtml(h.companyName || ''))}
      ${psnField('Dispatch', dispatchLine)}
    </div>`;

  const qaApprovedLine = h.qaApprovedOn
    ? formatDateDMY(h.qaApprovedOn)
    : `<span style="color:var(--muted);">— <span style="font-size:0.75rem;">(recorded from Sep 2026 onward)</span></span>`;
  const buildChain = `<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">
      ${psnField('Production Person', escapeHtml(h.productionPerson || ''))}
      ${psnField('Job Card', escapeHtml(h.jobCardNumber || ''))}
      ${psnField('BOQ ID', escapeHtml(h.boqId || ''))}
      ${psnField('Set Number', h.setNumber != null ? escapeHtml(String(h.setNumber)) : '')}
      ${psnField('Job Card Created', formatDateDMY(h.jobCardCreated))}
      ${psnField('FG Date', formatDateDMY(h.fgDate))}
      ${psnField('QA Authorizing Person', escapeHtml(h.qaAuthorizingPerson || ''))}
      ${psnField('QA Approved On', qaApprovedLine)}
    </div>`;

  const docsHtml = documents.length
    ? `<div style="display:flex; flex-wrap:wrap; gap:10px;">${documents.map(d => `<a href="${driveLink(d.url)}" target="_blank" rel="noopener" style="font-size:0.85rem;">${escapeHtml(d.docLabel || d.docType)}${d.fileName ? ' — ' + escapeHtml(d.fileName) : ''} ↗</a>`).join('')}</div>`
    : `<span style="color:var(--muted);">No documents.</span>`;

  const materialHtml = psnRenderMaterialSources(trace);

  let provenanceHtml;
  if (!trace) {
    provenanceHtml = `<div style="padding:10px; background:#f1f5f9; border-left:4px solid #64748b; border-radius:var(--radius); color:var(--muted);">No attribution recorded — predates traceability.</div>`;
  } else if (trace.snapshotStatus !== 'ok') {
    provenanceHtml = `<div style="padding:10px; background:#fef3c7; border-left:4px solid #b45309; border-radius:var(--radius); margin-bottom:8px;">
        <strong>Attribution ${escapeHtml(trace.snapshotStatus)}.</strong> ${escapeHtml(trace.snapshotError || 'Some material quantity could not be traced to a specific receipt.')}
      </div>
      <button class="nav-btn-styled" onclick="psnRebuildSnapshot(${h.fgId})">Rebuild attribution</button>`;
  } else {
    provenanceHtml = `<div style="font-size:0.8rem; color:var(--muted);">Source attribution frozen on ${escapeHtml(trace.builtAt || '')}${trace.builtBy ? ' by ' + escapeHtml(trace.builtBy) : ''}.
      <button class="nav-btn-styled" style="margin-left:10px; padding:2px 10px; font-size:0.75rem;" onclick="psnRebuildSnapshot(${h.fgId})">Rebuild</button></div>`;
  }

  return psnCard('Identity', identity)
    + psnCard('Where It Went', whereItWent)
    + psnCard('Who Built It, Who Cleared It', buildChain)
    + psnCard('Documents', docsHtml)
    + psnCard('What Went Into It', materialHtml)
    + psnCard('Source Attribution', provenanceHtml);
}

function psnRenderMaterialSources(trace) {
  if (!trace || !trace.materialSources || trace.materialSources.length === 0) {
    return `<span style="color:var(--muted);">No material source data recorded for this unit.</span>`;
  }
  const lines = typeof trace.materialSources === 'string' ? JSON.parse(trace.materialSources) : trace.materialSources;
  return lines.map(m => {
    const poRows = (m.poLines || []).map(pl => {
      const tier = PSN_TIER_META[pl.tier] || { label: pl.tier, color: '#334155', bg: '#f1f5f9' };
      const chip = `<span style="display:inline-block; padding:2px 8px; border-radius:999px; font-size:0.72rem; font-weight:600; color:${tier.color}; background:${tier.bg};">${escapeHtml(tier.label)}</span>`;
      const evidence = pl.grnNumber
        ? `GRN ${escapeHtml(pl.grnNumber)}${pl.invoiceNumber ? ' · Invoice ' + escapeHtml(pl.invoiceNumber) : ''}${pl.qaPerson ? ' · QA by ' + escapeHtml(pl.qaPerson) : ''}${pl.qaPassDate ? ' on ' + formatDateDMY(pl.qaPassDate) : ''}`
        : (pl.poNo ? '' : '<span style="color:var(--muted);">No receipt could be matched for this quantity.</span>');
      const okNotOk = (pl.okQuantity != null || pl.notOkQuantity != null || pl.missingQuantity != null)
        ? ` <span style="color:var(--muted); font-size:0.78rem;">(OK ${trimNum(pl.okQuantity || 0)} / Not-OK ${trimNum(pl.notOkQuantity || 0)} / Missing ${trimNum(pl.missingQuantity || 0)})</span>` : '';
      return `<div style="padding:8px 10px; border:1px solid var(--border); border-radius:var(--radius); margin-top:6px;">
          ${chip} <strong style="margin-left:6px;">${pl.poNo ? escapeHtml(pl.poNo) : '<span style="color:var(--muted);">No PO</span>'}</strong>
          ${pl.poDate ? ' — ' + formatDateDMY(pl.poDate) : ''} ${pl.vendorName ? ' — ' + escapeHtml(pl.vendorName) : ''}
          <span style="float:right; font-weight:600;">${trimNum(pl.attributedQuantity || 0)}</span>
          <div style="font-size:0.8rem; color:var(--muted); margin-top:4px;">${evidence}${okNotOk}</div>
        </div>`;
    }).join('');

    const warn = m.unattributedQuantity > 0
      ? `<div style="margin-top:6px; padding:8px; background:#fee2e2; border-left:4px solid #b91c1c; border-radius:var(--radius); font-size:0.82rem;">${trimNum(m.unattributedQuantity)} ${escapeHtml(m.unitType || '')} could not be attributed to any receipt.</div>`
      : '';

    const rejectionsHtml = (m.rejections || []).length
      ? `<div style="margin-top:8px;"><div style="font-size:0.78rem; font-weight:600; color:var(--muted); margin-bottom:4px;">Rejection / repair history</div>
          ${m.rejections.map(r => `<div style="font-size:0.8rem; padding:6px 0; border-top:1px solid var(--border);">
              ${escapeHtml(r.status || '')} — Not-OK ${trimNum(r.notOkQuantity || 0)} / Missing ${trimNum(r.missingQuantity || 0)}
              ${r.reasonForNotOk ? ' — ' + escapeHtml(r.reasonForNotOk) : ''} ${r.setDate ? ' (' + formatDateDMY(r.setDate) + ')' : ''}
            </div>`).join('')}
        </div>`
      : '';

    return `<div style="margin-bottom:14px; padding-bottom:10px; border-bottom:1px dashed var(--border);">
        <div><strong>${escapeHtml(m.itemCode || '')}</strong> ${escapeHtml(m.materialName || '')}
          <span style="float:right; font-size:0.82rem; color:var(--muted);">Allotted ${trimNum(m.allottedQuantity || 0)} / Used ${trimNum(m.usedQuantity || 0)} / Issued ${trimNum(m.issuedQuantity || 0)} ${escapeHtml(m.unitType || '')}</span>
        </div>
        ${poRows || '<div style="color:var(--muted); font-size:0.85rem; margin-top:6px;">No source receipts recorded.</div>'}
        ${warn}
        ${rejectionsHtml}
      </div>`;
  }).join('');
}

async function psnRebuildSnapshot(fgId) {
  try {
    const data = await apFetch({ action: 'rebuildProductSerialSnapshot', fgId, operatorName: appActiveOperatorIdentityString });
    if (!data.success) { showPurchaseFeedback('psn-feedback', escapeHtml(data.error || 'Rebuild failed.'), 'error'); return; }
    showPurchaseFeedback('psn-feedback', `Attribution rebuilt (${escapeHtml(data.snapshotStatus)}).`, data.snapshotStatus === 'ok' ? 'success' : 'error', true);
    if (psnActiveFgId) await psnOpenDetail(psnActiveFgId);
  } catch (err) {
    showPurchaseFeedback('psn-feedback', 'Rebuild failed — please try again.', 'error');
  }
}

// ── Queue ────────────────────────────────────────────────────────────────
async function psnLoadQueue() {
  document.getElementById('psn-queue-filter-bar').innerHTML = `
    <button class="nav-btn-styled" style="${psnQueueFilter.missingSnapshotOnly ? '' : 'background:var(--card); color:var(--text); border:1px solid var(--border);'}" onclick="psnToggleQueueFilter()">Needs attribution</button>`;
  const body = document.getElementById('psn-queue-body');
  body.innerHTML = `<tr><td colspan="8" style="padding:10px; color:var(--muted);">Loading...</td></tr>`;
  try {
    const data = await apFetch({ action: 'fetchProductSerialQueue', missingSnapshotOnly: psnQueueFilter.missingSnapshotOnly || undefined });
    if (!data.success) { body.innerHTML = `<tr><td colspan="8" style="padding:10px; color:#b91c1c;">${escapeHtml(data.error || 'Failed to load.')}</td></tr>`; return; }
    const rows = data.rows || [];
    if (rows.length === 0) { body.innerHTML = `<tr><td colspan="8" style="padding:10px; color:var(--muted);">No units found.</td></tr>`; return; }
    body.innerHTML = rows.map(r => {
      const attribution = !r.traceId
        ? '<span style="color:var(--muted);">Not built</span>'
        : (r.snapshotStatus === 'ok' ? `<span style="color:#15803d;">OK (${r.poCount || 0} PO${r.poCount === 1 ? '' : 's'})</span>` : `<span style="color:#b45309;">${escapeHtml(r.snapshotStatus)}</span>`);
      return `<tr style="cursor:pointer; border-top:1px solid var(--border);" onclick="psnOpenFromQueue(${r.fgId})">
          <td style="padding:8px;">${escapeHtml(r.productSerialNumber || '')}</td>
          <td style="padding:8px;">${escapeHtml(r.jobCardNumber || '')}</td>
          <td style="padding:8px;">${escapeHtml(r.projectId || '')}</td>
          <td style="padding:8px;">${escapeHtml(r.customerName || '')}</td>
          <td style="padding:8px;">${escapeHtml(r.productName || '')} ${escapeHtml(r.productRating || '')}</td>
          <td style="padding:8px;">${formatDateDMY(r.fgDate)}</td>
          <td style="padding:8px;">${escapeHtml(r.status || '')}</td>
          <td style="padding:8px;">${attribution}</td>
        </tr>`;
    }).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" style="padding:10px; color:#b91c1c;">Failed to load.</td></tr>`;
  }
}

function psnToggleQueueFilter() {
  psnQueueFilter.missingSnapshotOnly = !psnQueueFilter.missingSnapshotOnly;
  psnLoadQueue();
}

async function psnOpenFromQueue(fgId) {
  psnShowTab('search');
  document.getElementById('psn-results').innerHTML = '';
  await psnOpenDetail(fgId);
}
