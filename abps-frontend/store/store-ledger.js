// ═══════════════════════════════════════════════════════════════════════
// store/store-ledger.js — "Store Ledger" toggle shared by Live Raw
// Materials / Finished Goods / Spare Store Stock. One generic
// implementation parameterized by a screen `prefix` ('rm' | 'fgstock' |
// 'spare') and the backend's `storeType` string ('Raw Materials' |
// 'Finished Goods' | 'Spare') — every DOM id follows `{prefix}-ledger-*`.
// Backend: routes/store.js's fetchStoreLedgerReport / downloadStoreLedgerReport.
// ═══════════════════════════════════════════════════════════════════════

// { [prefix]: [{itemCode, label}] } — materials added via the typeahead,
// only consulted when that prefix's "All Materials" checkbox is unchecked.
window.storeLedgerSelectedMaterials = window.storeLedgerSelectedMaterials || {};

function switchStoreLedgerView(prefix, view) {
  const liveView = document.getElementById(`${prefix}-live-view`);
  const ledgerView = document.getElementById(`${prefix}-ledger-view`);
  const liveBtn = document.getElementById(`${prefix}-toggle-live`);
  const ledgerBtn = document.getElementById(`${prefix}-toggle-ledger`);
  if (!liveView || !ledgerView) return;
  const showLive = view === 'live';
  liveView.style.display = showLive ? '' : 'none';
  ledgerView.style.display = showLive ? 'none' : '';
  if (liveBtn) liveBtn.style.background = showLive ? 'var(--accent)' : '#718096';
  if (ledgerBtn) ledgerBtn.style.background = showLive ? '#718096' : 'var(--accent)';
  if (!showLive) loadItemCodeCatalogIntoCache().catch(() => {});
}

function toggleStoreLedgerAllMaterials(prefix) {
  const checkbox = document.getElementById(`${prefix}-ledger-all-materials`);
  const picker = document.getElementById(`${prefix}-ledger-material-picker`);
  if (picker) picker.style.display = checkbox && checkbox.checked ? 'none' : 'block';
}

function handleStoreLedgerMaterialSearch(prefix, query) {
  const dropdown = document.getElementById(`${prefix}-ledger-material-dropdown`);
  const inputEl = document.getElementById(`${prefix}-ledger-material-search`);
  if (!dropdown || !inputEl) return;
  const rect = inputEl.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = rect.bottom + 'px';
  dropdown.style.width = Math.max(rect.width, 280) + 'px';
  dropdown.style.maxHeight = '240px';

  const q = (query || '').trim().toLowerCase();
  if (q.length < 1) { dropdown.style.display = 'none'; return; }

  const catalog = window.itemCodeCatalogCache || [];
  const already = new Set((window.storeLedgerSelectedMaterials[prefix] || []).map(m => m.itemCode));
  const matches = catalog.filter(c => {
    if (already.has(c.itemCode)) return false;
    const name = (c.productName || '').toLowerCase();
    const combined = (c.combinedName || `${name} ${(c.rating || '').toLowerCase()} ${(c.make || '').toLowerCase()}`).toLowerCase().trim();
    return name.includes(q) || combined.includes(q) || (c.itemCode || '').toLowerCase().includes(q);
  }).slice(0, 12);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div style="padding:8px 10px; font-size:0.8rem; color:var(--muted);">No matching material found.</div>`;
    dropdown.style.display = 'block';
    return;
  }
  dropdown.innerHTML = matches.map(m => `
    <div onclick="selectStoreLedgerMaterial('${prefix}', '${m.itemCode}', \`${(m.combinedName || m.productName).replace(/`/g, "'")}\`)"
      style="padding:7px 10px; cursor:pointer; font-size:0.8rem; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:600;">${m.combinedName || m.productName}</span>
      <span style="font-size:0.68rem; color:var(--muted); background:#f1f5f9; padding:2px 6px; border-radius:3px; margin-left:8px;">${m.itemCode}</span>
    </div>`).join('');
  dropdown.style.display = 'block';
}

function selectStoreLedgerMaterial(prefix, itemCode, label) {
  window.storeLedgerSelectedMaterials[prefix] = window.storeLedgerSelectedMaterials[prefix] || [];
  if (!window.storeLedgerSelectedMaterials[prefix].some(m => m.itemCode === itemCode)) {
    window.storeLedgerSelectedMaterials[prefix].push({ itemCode, label });
  }
  const searchInput = document.getElementById(`${prefix}-ledger-material-search`);
  const dropdown = document.getElementById(`${prefix}-ledger-material-dropdown`);
  if (searchInput) searchInput.value = '';
  if (dropdown) dropdown.style.display = 'none';
  renderStoreLedgerSelectedMaterials(prefix);
}

function removeStoreLedgerMaterial(prefix, itemCode) {
  window.storeLedgerSelectedMaterials[prefix] = (window.storeLedgerSelectedMaterials[prefix] || []).filter(m => m.itemCode !== itemCode);
  renderStoreLedgerSelectedMaterials(prefix);
}

function renderStoreLedgerSelectedMaterials(prefix) {
  const mount = document.getElementById(`${prefix}-ledger-selected-materials`);
  if (!mount) return;
  const selected = window.storeLedgerSelectedMaterials[prefix] || [];
  mount.innerHTML = selected.map(m => `
    <span style="display:inline-flex; align-items:center; gap:5px; background:var(--highlight-bg); color:var(--brand); font-weight:600; font-size:0.78rem; padding:4px 8px; border-radius:14px; border:1px solid var(--border);">
      ${m.label}
      <span onclick="removeStoreLedgerMaterial('${prefix}', '${m.itemCode}')" style="cursor:pointer; font-weight:800; color:#b91c1c;" title="Remove">✕</span>
    </span>`).join('');
}

// Close ledger material dropdowns on outside click — same convention as
// every other fixed-position dropdown in the app (e.g. design/item-codes.js).
document.addEventListener('click', function(e) {
  if (!e.target.id || !e.target.id.endsWith('-ledger-material-search')) {
    document.querySelectorAll("[id$='-ledger-material-dropdown']").forEach(d => d.style.display = 'none');
  }
});

function validateStoreLedgerRange(prefix) {
  const startEl = document.getElementById(`${prefix}-ledger-start`);
  const endEl = document.getElementById(`${prefix}-ledger-end`);
  const start = startEl ? startEl.value : '';
  const end = endEl ? endEl.value : '';
  if (!start || !end) { showStoreLedgerFeedback(prefix, 'Start Date and End Date are both required.', 'error'); return null; }
  if (start > end) { showStoreLedgerFeedback(prefix, 'Start Date must be on or before End Date.', 'error'); return null; }
  return { startDate: start, endDate: end };
}

function currentStoreLedgerItemCodes(prefix) {
  const allChecked = document.getElementById(`${prefix}-ledger-all-materials`)?.checked;
  if (allChecked) return null;
  const selected = window.storeLedgerSelectedMaterials[prefix] || [];
  return selected.map(m => m.itemCode);
}

function showStoreLedgerFeedback(prefix, msg, type) {
  const el = document.getElementById(`${prefix}-ledger-feedback`);
  if (!el) return;
  const colors = { error: '#dc2626', success: '#15803d' };
  el.style.cssText = `display:block; padding:12px; margin-bottom:12px; border-left:4px solid ${colors[type] || colors.error}; background:${type === 'success' ? '#f0fff4' : '#fef2f2'}; color:${colors[type] || colors.error}; border-radius:var(--radius); font-weight:600; font-size:0.85rem;`;
  el.textContent = msg;
}

async function generateStoreLedgerReport(prefix, storeType) {
  const feedback = document.getElementById(`${prefix}-ledger-feedback`);
  if (feedback) feedback.style.display = 'none';
  const range = validateStoreLedgerRange(prefix);
  if (!range) return;
  const itemCodes = currentStoreLedgerItemCodes(prefix);
  if (itemCodes && itemCodes.length === 0) {
    showStoreLedgerFeedback(prefix, 'Add at least one material, or check "All Materials".', 'error');
    return;
  }

  const resultsEl = document.getElementById(`${prefix}-ledger-results`);
  const bodyEl = document.getElementById(`${prefix}-ledger-table-body`);
  if (bodyEl) bodyEl.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:16px; color:var(--muted);">Loading...</td></tr>`;
  if (resultsEl) resultsEl.style.display = 'block';

  try {
    const data = await apFetch({ action: 'fetchStoreLedgerReport', storeType, startDate: range.startDate, endDate: range.endDate, itemCodes });
    if (!data.success) {
      showStoreLedgerFeedback(prefix, data.error || 'Failed to load Store Ledger.', 'error');
      if (resultsEl) resultsEl.style.display = 'none';
      return;
    }
    renderStoreLedgerTable(prefix, data.rows || []);
  } catch (e) {
    showStoreLedgerFeedback(prefix, 'Network error: ' + e.message, 'error');
    if (resultsEl) resultsEl.style.display = 'none';
  }
}

function renderStoreLedgerTable(prefix, rows) {
  const bodyEl = document.getElementById(`${prefix}-ledger-table-body`);
  if (!bodyEl) return;
  if (rows.length === 0) {
    bodyEl.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:16px; color:var(--muted);">No materials found for this range.</td></tr>`;
    return;
  }
  bodyEl.innerHTML = rows.map(r => `
    <tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px; font-weight:600;">${r.materialName || '—'}</td>
      <td style="padding:8px; text-align:center;">${r.unit || '—'}</td>
      <td style="padding:8px;">${r.typeOfMaterial || '—'}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700;">${trimNum(r.startingStock)}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:#15803d;">${trimNum(r.inwardQty)}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:#b91c1c;">${trimNum(r.issuedQty)}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-weight:800; color:var(--brand);">${trimNum(r.endingStock)}</td>
    </tr>`).join('');
}

async function downloadStoreLedgerReportFile(prefix, storeType) {
  const feedback = document.getElementById(`${prefix}-ledger-feedback`);
  if (feedback) feedback.style.display = 'none';
  const range = validateStoreLedgerRange(prefix);
  if (!range) return;
  const itemCodes = currentStoreLedgerItemCodes(prefix);
  if (itemCodes && itemCodes.length === 0) {
    showStoreLedgerFeedback(prefix, 'Add at least one material, or check "All Materials".', 'error');
    return;
  }

  showBlockingOverlay('Building Store Ledger Excel...');
  try {
    const data = await apFetch({ action: 'downloadStoreLedgerReport', storeType, startDate: range.startDate, endDate: range.endDate, itemCodes });
    hideBlockingOverlay();
    if (!data.success) { showStoreLedgerFeedback(prefix, data.error || 'Failed to build the Excel file.', 'error'); return; }
    const link = document.createElement('a');
    link.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + data.base64;
    link.download = data.fileName || 'Store_Ledger.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    hideBlockingOverlay();
    showStoreLedgerFeedback(prefix, 'Network error: ' + e.message, 'error');
  }
}
