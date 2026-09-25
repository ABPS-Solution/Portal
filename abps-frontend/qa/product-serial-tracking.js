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
let psnSearchDebounceTimer = null;
let psnSearchReqToken = 0;
let psnQueueRows = []; // cached full "All Units" list, filtered client-side by psnFilterQueue

const PSN_TIER_META = {
  exact: { label: 'Exact', color: '#15803d', bg: '#dcfce7' },
  auto:  { label: 'Auto-assigned', color: '#b45309', bg: '#fef3c7' },
  fifo:  { label: 'FIFO-inferred', color: '#1d4ed8', bg: '#dbeafe' },
};

// Status badge colors — a real stock/lifecycle state (Pending FG Approval /
// In Store / Reserved / On Ticket / Consumed in Production), or the
// display-only "Dispatched" override psnRenderDetail/psnLoadQueue apply
// once an invoice/job_card link says the unit actually shipped (see the
// comment in psnRenderDetail for why fg.status itself never says this).
const PSN_STATUS_META = {
  'Pending FG Approval':     { color: '#b45309', bg: '#fef3c7' },
  'In Store':                { color: '#1d4ed8', bg: '#dbeafe' },
  'Reserved / On Ticket':    { color: '#7c3aed', bg: '#ede9fe' },
  'Consumed in Production':  { color: '#475569', bg: '#e2e8f0' },
  'Dispatched':              { color: '#15803d', bg: '#dcfce7' },
};

function psnStatusBadge(status) {
  const s = status || 'Unknown';
  const meta = PSN_STATUS_META[s] || { color: '#334155', bg: '#f1f5f9' };
  return `<span class="psn-status-badge" style="color:${meta.color}; background:${meta.bg};">${escapeHtml(s)}</span>`;
}

function initializeProductSerialTrackingPanel() {
  psnActiveTab = 'search';
  psnHits = [];
  psnActiveFgId = null;
  psnQueueRows = [];
  psnSearchReqToken++; // invalidate any in-flight suggestion fetch from a prior visit

  const feedback = document.getElementById('psn-feedback');
  if (feedback) feedback.style.display = 'none';
  document.getElementById('psn-results').innerHTML = '';
  document.getElementById('psn-detail').innerHTML = '';
  document.getElementById('psn-queue-body').innerHTML = '';
  const queueFilterInput = document.getElementById('psn-queue-filter-input');
  if (queueFilterInput) queueFilterInput.value = '';
  const queueCount = document.getElementById('psn-queue-count');
  if (queueCount) queueCount.textContent = '';

  psnRenderTabBar();
  psnShowTab('search');

  const input = document.getElementById('psn-search-ta-input');
  const dd = document.getElementById('psn-search-ta-dropdown');
  if (input) {
    input.value = '';
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        if (dd) dd.style.display = 'none';
        psnRunSearch();
      }
    };
  }
  if (dd) dd.style.display = 'none';
}

// Same look as the Add/Check Item Code Search/Format toggle
// (icf-mode-btn-search/format in switchItemCodeMode) — the bare
// .nav-btn-styled base class (5px 10px padding, 0.75rem font) is sized
// for a small inline action button, not a prominent tab switcher, and the
// old inactive style here (bordered white pill) didn't match that
// established toggle convention anywhere else in the app.
function psnRenderTabBar() {
  const bar = document.getElementById('psn-tab-bar');
  if (!bar) return;
  const tabs = [{ key: 'search', label: 'Search by Serial Number' }, { key: 'queue', label: 'All Units' }];
  bar.innerHTML = tabs.map(t => {
    const active = psnActiveTab === t.key;
    const bg = active ? 'var(--brand)' : '#e2e8f0';
    const color = active ? '#fff' : '#334155';
    return `<button class="nav-btn-styled" style="background:${bg}; color:${color}; font-weight:700; padding:11px 20px;" onclick="psnShowTab('${t.key}')">${escapeHtml(t.label)}</button>`;
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
// Suggestion dropdown as you type, same shape as the Type of Material
// typeahead (design/item-codes.js's handleIcfTypeTypeaheadInput) — debounced
// against the live server (there's no client-side serial-number cache to
// filter locally the way that screen's Type of Material list is cached),
// with a request token so a slow earlier response can never clobber a
// faster later one.
function psnHandleSearchInput(query) {
  clearTimeout(psnSearchDebounceTimer);
  const dd = document.getElementById('psn-search-ta-dropdown');
  const q = (query || '').trim();
  if (!q) { if (dd) dd.style.display = 'none'; return; }
  psnSearchDebounceTimer = setTimeout(() => psnFetchSearchSuggestions(q), 300);
}

async function psnFetchSearchSuggestions(q) {
  const dd = document.getElementById('psn-search-ta-dropdown');
  if (!dd) return;
  const myToken = ++psnSearchReqToken;
  try {
    const data = await apFetch({ action: 'searchProductSerial', serial: q });
    if (myToken !== psnSearchReqToken) return; // a newer keystroke already superseded this
    if (!data.success || !data.rows || data.rows.length === 0) { dd.style.display = 'none'; return; }
    const matches = data.rows.slice(0, 8);
    dd.innerHTML = matches.map(h => `
      <div class="psn-suggestion-row" onmousedown="event.preventDefault();" onclick="psnSelectSearchSuggestion(${h.fgId}, '${(h.productSerialNumber || '').replace(/'/g, "\\'")}')">
        <span style="font-weight:700; font-family:ui-monospace, 'SF Mono', Consolas, monospace;">${escapeHtml(h.productSerialNumber || '')}</span>
        <span style="font-size:0.75rem; color:var(--muted); margin-left:8px;">${escapeHtml(h.productName || '')}${h.productRating ? ' ' + escapeHtml(h.productRating) : ''}</span>
        <div style="font-size:0.7rem; color:var(--muted); margin-top:3px; display:flex; align-items:center; gap:6px;">${escapeHtml(h.customerName || 'N/A')} ${psnStatusBadge(h.status)}</div>
      </div>`).join('');
    dd.style.display = 'block';
  } catch (err) {
    dd.style.display = 'none';
  }
}

function psnSelectSearchSuggestion(fgId, serial) {
  const input = document.getElementById('psn-search-ta-input');
  if (input) input.value = serial;
  const dd = document.getElementById('psn-search-ta-dropdown');
  if (dd) dd.style.display = 'none';
  psnHits = [];
  document.getElementById('psn-results').innerHTML = '';
  psnOpenDetail(fgId);
}

async function psnRunSearch() {
  const dd = document.getElementById('psn-search-ta-dropdown');
  if (dd) dd.style.display = 'none';
  const input = document.getElementById('psn-search-ta-input');
  const serial = (input?.value || '').trim();
  document.getElementById('psn-detail').innerHTML = '';
  if (!serial) {
    showPurchaseFeedback('psn-feedback', 'Enter a serial number to search.', 'error');
    return;
  }
  document.getElementById('psn-results').innerHTML = `<div class="psn-empty-state"><span class="psn-spinner"></span>Searching...</div>`;
  try {
    const data = await apFetch({ action: 'searchProductSerial', serial });
    if (!data.success) { showPurchaseFeedback('psn-feedback', escapeHtml(data.error || 'Search failed.'), 'error'); document.getElementById('psn-results').innerHTML = ''; return; }
    psnHits = data.rows || [];
    if (psnHits.length === 0) {
      document.getElementById('psn-results').innerHTML = `<div class="psn-empty-state">No product found with that serial number.</div>`;
    } else if (psnHits.length === 1) {
      document.getElementById('psn-results').innerHTML = '';
      await psnOpenDetail(psnHits[0].fgId);
    } else {
      psnRenderChooser();
    }
  } catch (err) {
    showPurchaseFeedback('psn-feedback', 'Search failed, please try again.', 'error');
    document.getElementById('psn-results').innerHTML = '';
  }
}

function psnRenderChooser() {
  const wrap = document.getElementById('psn-results');
  wrap.innerHTML = `
    <p style="color:var(--muted); margin-bottom:10px; font-size:0.85rem;">Multiple products matched, select the one you need:</p>
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${psnHits.map(h => `
        <div class="psn-chooser-card" onclick="psnOpenDetail(${h.fgId})">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <span style="font-weight:700; font-family:ui-monospace, 'SF Mono', Consolas, monospace;">${escapeHtml(h.productSerialNumber || '')}</span>
              <span style="color:var(--muted);"> · ${escapeHtml(h.productName || '')} ${escapeHtml(h.productRating || '')}</span>
            </div>
            ${psnStatusBadge(h.status)}
          </div>
          <div style="font-size:0.8rem; color:var(--muted); margin-top:6px;">
            Job Card ${escapeHtml(psnShortJobCard(h.jobCardNumber))} · Project ${escapeHtml(h.projectId || 'N/A')} · ${escapeHtml(h.customerName || '')}
          </div>
        </div>`).join('')}
    </div>`;
}

// ── Detail ────────────────────────────────────────────────────────────────
async function psnOpenDetail(fgId) {
  psnActiveFgId = fgId;
  const detailEl = document.getElementById('psn-detail');
  detailEl.innerHTML = `<div class="psn-empty-state"><span class="psn-spinner"></span>Loading...</div>`;
  try {
    const data = await apFetch({ action: 'fetchProductSerialDetail', fgId });
    if (!data.success) { showPurchaseFeedback('psn-feedback', escapeHtml(data.error || 'Could not load this record.'), 'error'); detailEl.innerHTML = ''; return; }
    detailEl.innerHTML = psnRenderDetail(data);
  } catch (err) {
    showPurchaseFeedback('psn-feedback', 'Failed to load product detail.', 'error');
    detailEl.innerHTML = '';
  }
}

function psnField(label, value, mono) {
  const empty = value === null || value === undefined || value === '';
  return `<div class="psn-field"><div class="psn-field-label">${escapeHtml(label)}</div><div class="psn-field-value${mono ? ' psn-mono' : ''}">${empty ? '<span style="color:var(--muted);">N/A</span>' : value}</div></div>`;
}

function psnDocLink(url, text) {
  if (!text) return '';
  return url
    ? `<a href="${driveLink(url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; text-decoration:underline;">${escapeHtml(text)}</a>`
    : escapeHtml(text);
}

function psnInvoiceText(invoiceNo, invoiceType) {
  if (!invoiceNo) return '';
  return invoiceNo + (invoiceType ? ` (${invoiceType})` : '');
}

// One accent color per section, purely visual grouping.
const PSN_CARD_META = {
  'Identity':                     '#0056b3',
  'Where It Went':                '#15803d',
  'Who Built It, Who Cleared It': '#7c3aed',
  'Documents':                    '#475569',
  'What Went Into It':            '#b45309',
};

function psnCard(title, innerHtml) {
  const accent = PSN_CARD_META[title] || 'var(--brand)';
  return `<div class="psn-section-card" style="--psn-accent:${accent};">
    <div class="psn-section-title">${escapeHtml(title)}</div>
    ${innerHtml}
  </div>`;
}

function psnRenderDetail(data) {
  const h = data.header;
  const documents = data.documents || [];
  const trace = data.trace;
  const usedIn = data.usedIn || [];

  // The unit counts as dispatched once its Job Card is on an invoice (the
  // raw fg.status predates the 'Dispatched' value on older rows).
  const statusDisplay = psnStatusBadge(h.invoiceId ? 'Dispatched' : h.status);

  const identity = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
      <div style="font-size:1.5rem; font-weight:700; font-family:ui-monospace, 'SF Mono', Consolas, monospace;">${escapeHtml(h.productSerialNumber || '')}</div>
      ${statusDisplay}
    </div>
    <div class="psn-field-grid psn-grid-6">
      ${psnField('Product Name', escapeHtml(h.productName || ''))}
      ${psnField('Product Rating', escapeHtml(h.productRating || ''))}
      ${psnField('Description of Material', escapeHtml(h.descriptionOfMaterial || ''))}
      ${psnField('Unit', escapeHtml(h.unit || ''))}
      ${psnField('Department', escapeHtml(h.department || ''))}
      ${psnField('Finished Good Use', escapeHtml(h.finishedGoodUse || ''))}
    </div>
    <div class="psn-field-grid psn-grid-2" style="margin-top:10px;">
      ${psnField('Job Card Number', escapeHtml(h.jobCardNumber || ''), true)}
      ${psnField('BOQ ID', psnDocLink(h.boqPdfUrlNoCost, h.boqId), true)}
    </div>`;

  const dispatchValue = h.invoiceId
    ? psnDocLink(h.invoicePdfUrl, psnInvoiceText(h.invoiceNo, h.invoiceType))
      + (h.dispatchDate ? ` <span style="color:var(--muted);">on ${formatOrdinalDate(h.dispatchDate)}</span>` : '')
    : (usedIn.length
        ? '<span style="color:var(--muted);">Used inside another product, see Used In below</span>'
        : '<span style="color:var(--muted);">Not dispatched</span>');
  let whereItWent = `<div class="psn-field-grid psn-grid-3">
      ${psnField('Project ID', escapeHtml(h.projectId || ''), true)}
      ${psnField('Company', escapeHtml(h.companyName || ''))}
      ${psnField('Dispatch Invoice', dispatchValue)}
    </div>`;
  if (usedIn.length) {
    whereItWent += `<div class="psn-field-label" style="margin-top:14px;">Used In</div>
      <table class="psn-bordered" style="margin-top:6px;">
        <thead><tr><th style="width:6%;">Level</th><th>Product</th><th>Job Card Number</th><th style="width:14%;">Serial Number</th><th style="width:14%;">Finished Good Use</th><th style="width:18%;">Dispatch Invoice</th></tr></thead>
        <tbody>${usedIn.map((u, i) => `<tr>
          <td style="text-align:center;">${i + 1}</td>
          <td>${escapeHtml(u.productName || '')}${u.productRating ? ' ' + escapeHtml(u.productRating) : ''}</td>
          <td class="psn-mono">${escapeHtml(u.jobCardNumber || '')}</td>
          <td class="psn-mono">${u.fgId ? `<a href="javascript:void(0)" onclick="psnOpenDetail(${u.fgId})" style="color:var(--brand); font-weight:700;">${escapeHtml(u.productSerialNumber || 'Open')}</a>` : '<span style="color:var(--muted);">Not yet added to FG</span>'}</td>
          <td>${u.finishedGoodUse ? escapeHtml(u.finishedGoodUse) : '<span style="color:var(--muted);">N/A</span>'}</td>
          <td>${u.invoiceNo ? psnDocLink(u.invoicePdfUrl, psnInvoiceText(u.invoiceNo, u.invoiceType)) : '<span style="color:var(--muted);">Not dispatched yet</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  const qaApprovedLine = h.qaApprovedOn
    ? formatOrdinalDate(h.qaApprovedOn)
    : `<span style="color:var(--muted);">N/A <span style="font-size:0.75rem;">(recorded from Sep 2026 onward)</span></span>`;
  const buildChain = `<div class="psn-field-grid psn-grid-5">
      ${psnField('Production Person who Add to FG', escapeHtml(h.productionPerson || ''))}
      ${psnField('JC Set Number', h.setNumber != null ? escapeHtml(String(h.setNumber)) : '')}
      ${psnField('JC FG Added Date', formatOrdinalDate(h.fgDate))}
      ${psnField('Add to FG QA Authorizing Person', escapeHtml(h.qaAuthorizingPerson || ''))}
      ${psnField('Add to FG QA Approved On Date', qaApprovedLine)}
    </div>`;

  const docsHtml = documents.length
    ? `<div style="display:flex; flex-wrap:wrap; gap:10px;">${documents.map(d => `<a href="${driveLink(d.url)}" target="_blank" rel="noopener" class="psn-doc-chip"><span class="psn-doc-type">${escapeHtml(d.docLabel || d.docType)}</span>${d.fileName ? `<span class="psn-doc-name">${escapeHtml(d.fileName)}</span>` : ''}</a>`).join('')}</div>`
    : `<span style="color:var(--muted);">No documents.</span>`;

  const materialHtml = psnRenderMaterialSources(trace);

  return psnCard('Identity', identity)
    + psnCard('Where It Went', whereItWent)
    + psnCard('Who Built It, Who Cleared It', buildChain)
    + psnCard('Documents', docsHtml)
    + psnCard('What Went Into It', materialHtml);
}

function psnRenderMaterialSources(trace) {
  if (!trace || !trace.materialSources || trace.materialSources.length === 0) {
    return `<span style="color:var(--muted);">No material source data recorded for this unit.</span>`;
  }
  const lines = typeof trace.materialSources === 'string' ? JSON.parse(trace.materialSources) : trace.materialSources;
  return lines.map(m => {
    const issued = Number(m.issuedQuantity) || 0;
    const unattributed = Number(m.unattributedQuantity) || 0;
    const attributedPct = issued > 0 ? Math.max(0, Math.min(100, Math.round(((issued - unattributed) / issued) * 100))) : 100;

    const poRows = (m.poLines || []).map(pl => {
      const tier = PSN_TIER_META[pl.tier] || { label: pl.tier, color: '#334155', bg: '#f1f5f9' };
      const chip = `<span class="psn-tier-chip" style="color:${tier.color}; background:${tier.bg};">${escapeHtml(tier.label)}</span>`;
      const evidence = pl.grnNumber
        ? `${escapeHtml(pl.grnNumber)}${pl.invoiceNumber ? ' · Invoice ' + escapeHtml(pl.invoiceNumber) : ''}${pl.qaPerson ? ' · QA by ' + escapeHtml(pl.qaPerson) : ''}${pl.qaPassDate ? ' on ' + formatOrdinalDate(pl.qaPassDate) : ''}`
        : (pl.poNo ? '' : '<span style="color:var(--muted);">No receipt could be matched for this quantity.</span>');
      const okNotOk = (pl.okQuantity != null || pl.notOkQuantity != null || pl.missingQuantity != null)
        ? ` <span style="color:var(--muted);">(OK ${trimNum(pl.okQuantity || 0)} / Not-OK ${trimNum(pl.notOkQuantity || 0)} / Missing ${trimNum(pl.missingQuantity || 0)})</span>` : '';
      const meta = [pl.poDate ? formatOrdinalDate(pl.poDate) : '', pl.vendorName ? escapeHtml(pl.vendorName) : ''].filter(Boolean).join(' · ');
      return `<div class="psn-po-row">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>${chip} <strong style="margin-left:6px; font-family:ui-monospace, 'SF Mono', Consolas, monospace;">${pl.poNo ? escapeHtml(pl.poNo) : '<span style="color:var(--muted); font-family:inherit;">No PO</span>'}</strong>
            ${meta ? ' <span style="color:var(--muted);">· ' + meta + '</span>' : ''}</span>
            <span style="font-weight:700;">${trimNum(pl.attributedQuantity || 0)}</span>
          </div>
          <div style="font-size:0.88rem; color:var(--text); margin-top:5px;">${evidence}${okNotOk}</div>
        </div>`;
    }).join('');

    const warn = unattributed > 0
      ? `<div style="margin-top:8px; padding:8px 10px; background:#fee2e2; border-left:4px solid #b91c1c; border-radius:var(--radius); font-size:0.82rem;">${trimNum(unattributed)} ${escapeHtml(m.unitType || '')} could not be attributed to any receipt.</div>`
      : '';

    const rejectionsHtml = (m.rejections || []).length
      ? `<div style="margin-top:8px;"><div style="font-size:0.78rem; font-weight:600; color:var(--muted); margin-bottom:4px;">Rejection / repair history</div>
          ${m.rejections.map(r => `<div style="font-size:0.8rem; padding:6px 0; border-top:1px solid var(--border);">
              ${escapeHtml(r.status || '')}: Not-OK ${trimNum(r.notOkQuantity || 0)} / Missing ${trimNum(r.missingQuantity || 0)}
              ${r.reasonForNotOk ? ' · ' + escapeHtml(r.reasonForNotOk) : ''} ${r.setDate ? ' (' + formatOrdinalDate(r.setDate) + ')' : ''}
            </div>`).join('')}
        </div>`
      : '';

    return `<div class="psn-material-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
          <div style="flex:1; min-width:0;"><strong>${escapeHtml(m.itemCode || '')}</strong> <span style="color:var(--text);">${escapeHtml(m.materialName || '')}</span></div>
          <span style="font-size:0.95rem; font-weight:600; color:var(--text); white-space:nowrap; flex-shrink:0;">Allotted ${trimNum(m.allottedQuantity || 0)} / Used ${trimNum(m.usedQuantity || 0)} / Issued ${trimNum(m.issuedQuantity || 0)} ${escapeHtml(m.unitType || '')}</span>
        </div>
        <div class="psn-qty-bar-track"><div class="psn-qty-bar-fill" style="width:${attributedPct}%; ${unattributed > 0 ? 'background:#dc2626;' : ''}"></div></div>
        ${poRows || '<div style="color:var(--muted); font-size:0.85rem; margin-top:8px;">No source receipts recorded.</div>'}
        ${warn}
        ${rejectionsHtml}
      </div>`;
  }).join('');
}

// No longer called: the Source Attribution section was removed from the
// screen on 25 Sep 2026 (the route still exists). Flagged, not deleted.
async function psnRebuildSnapshot(fgId) {
  try {
    const data = await apFetch({ action: 'rebuildProductSerialSnapshot', fgId, operatorName: appActiveOperatorIdentityString });
    if (!data.success) { showPurchaseFeedback('psn-feedback', escapeHtml(data.error || 'Rebuild failed.'), 'error'); return; }
    showPurchaseFeedback('psn-feedback', `Source record rebuilt (${escapeHtml(data.snapshotStatus)}).`, data.snapshotStatus === 'ok' ? 'success' : 'error', true);
    if (psnActiveFgId) await psnOpenDetail(psnActiveFgId);
  } catch (err) {
    showPurchaseFeedback('psn-feedback', 'Rebuild failed, please try again.', 'error');
  }
}

// ── Queue ────────────────────────────────────────────────────────────────
// "Needs attribution" filter toggle was removed (10 Sep 2026, explicit
// request — "too confusing") — this now always loads the full, unfiltered
// list. The backend route's missingSnapshotOnly param is untouched
// (flagged, not deleted) in case a clearer surfacing of this is wanted
// later; nothing on this screen sends it anymore.
async function psnLoadQueue() {
  const body = document.getElementById('psn-queue-body');
  const filterInput = document.getElementById('psn-queue-filter-input');
  if (filterInput) filterInput.value = '';
  body.innerHTML = `<tr><td colspan="7" style="padding:16px; color:var(--muted); text-align:center;"><span class="psn-spinner"></span>Loading...</td></tr>`;
  try {
    const data = await apFetch({ action: 'fetchProductSerialQueue' });
    if (!data.success) { body.innerHTML = `<tr><td colspan="7" style="padding:10px; color:#b91c1c;">${escapeHtml(data.error || 'Failed to load.')}</td></tr>`; return; }
    psnQueueRows = data.rows || [];
    psnRenderQueueRows(psnQueueRows);
  } catch (err) {
    psnQueueRows = [];
    body.innerHTML = `<tr><td colspan="7" style="padding:10px; color:#b91c1c;">Failed to load.</td></tr>`;
  }
}

function psnRenderQueueRows(rows) {
  const body = document.getElementById('psn-queue-body');
  const countEl = document.getElementById('psn-queue-count');
  if (countEl) countEl.textContent = `${rows.length} of ${psnQueueRows.length} unit${psnQueueRows.length === 1 ? '' : 's'}`;
  if (rows.length === 0) { body.innerHTML = `<tr><td colspan="7" style="padding:10px; color:var(--muted);">No units found.</td></tr>`; return; }
  body.innerHTML = rows.map(r => {
    return `<tr style="cursor:pointer;" onclick="psnOpenFromQueue(${r.fgId})">
        <td style="padding:8px; font-family:ui-monospace, 'SF Mono', Consolas, monospace; font-weight:600;">${escapeHtml(r.productSerialNumber || '')}</td>
        <td style="padding:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(r.jobCardNumber || '')}">${escapeHtml(psnShortJobCard(r.jobCardNumber))}</td>
        <td style="padding:8px;">${escapeHtml(r.projectId || '')}</td>
        <td style="padding:8px;">${escapeHtml(r.customerName || '')}</td>
        <td style="padding:8px;">${escapeHtml(r.productName || '')} ${escapeHtml(r.productRating || '')}</td>
        <td style="padding:8px;">${formatOrdinalDate(r.fgDate)}</td>
        <td style="padding:8px;">${psnStatusBadge(r.status)}</td>
      </tr>`;
  }).join('');
}

// psnFilterQueue -- client-side filter over the already-loaded queue, no
// extra round-trip. Matches serial/job card/project/customer/product,
// case-insensitive substring, same as every other quick-filter box in
// this app.
function psnFilterQueue(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) { psnRenderQueueRows(psnQueueRows); return; }
  const filtered = psnQueueRows.filter(r =>
    (r.productSerialNumber || '').toLowerCase().includes(q) ||
    (r.jobCardNumber || '').toLowerCase().includes(q) ||
    (r.projectId || '').toLowerCase().includes(q) ||
    (r.customerName || '').toLowerCase().includes(q) ||
    (r.productName || '').toLowerCase().includes(q)
  );
  psnRenderQueueRows(filtered);
}

// psnShortJobCard -- the full job_card_number is `JC_Set-<n>_<boqIdSuffix>`
// (see routes/design.js's deriveJobCardNumber) — very long, and this table
// already has separate Project ID / Product Name columns carrying that
// same information, so only the "JC_Set-<n>" lead segment is shown here.
// Falls back to the full string for any legacy row that doesn't match the
// expected shape, rather than silently showing nothing.
function psnShortJobCard(jobCardNumber) {
  const s = (jobCardNumber || '').toString();
  const m = /^(JC_Set-\d+)/.exec(s);
  return m ? m[1] : s;
}

async function psnOpenFromQueue(fgId) {
  psnShowTab('search');
  document.getElementById('psn-results').innerHTML = '';
  await psnOpenDetail(fgId);
}
