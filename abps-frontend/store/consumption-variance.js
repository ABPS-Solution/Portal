// ═══════════════════════════════════════════════════════════════════════
// store/consumption-variance.js — "Consumption Variance" toggle inside
// Live Raw Materials Store Stock (canvas-module-store-live-stock), a
// sibling of the Store Ledger toggle (store/store-ledger.js), but this one
// compares each project's BOQ estimate against what was actually issued.
// Backend: routes/store.js's fetchMaterialConsumptionVariance /
// downloadMaterialConsumptionVariance.
// ═══════════════════════════════════════════════════════════════════════

// Selected projects for the current report — a plain array of {id, label},
// separate from window.storeLedgerSelectedMaterials (different picker,
// different screen section) and from sharedActiveProjectCodes' own
// single-select convention (selectSharedProjectTypeahead overwrites one
// input's value; this screen needs several projects at once).
window.cvarSelectedProjects = window.cvarSelectedProjects || [];

function switchRMStockView(view) {
  const liveView = document.getElementById('rm-live-view');
  const ledgerView = document.getElementById('rm-ledger-view');
  const varianceView = document.getElementById('rm-variance-view');
  const liveBtn = document.getElementById('rm-toggle-live');
  const ledgerBtn = document.getElementById('rm-toggle-ledger');
  const varianceBtn = document.getElementById('rm-toggle-variance');
  if (!liveView || !ledgerView || !varianceView) return;

  liveView.style.display = view === 'live' ? '' : 'none';
  ledgerView.style.display = view === 'ledger' ? '' : 'none';
  varianceView.style.display = view === 'variance' ? '' : 'none';
  if (liveBtn) liveBtn.style.background = view === 'live' ? 'var(--accent)' : '#718096';
  if (ledgerBtn) ledgerBtn.style.background = view === 'ledger' ? 'var(--accent)' : '#718096';
  if (varianceBtn) varianceBtn.style.background = view === 'variance' ? 'var(--accent)' : '#718096';

  if (view === 'ledger') loadItemCodeCatalogIntoCache().catch(() => {});
  if (view === 'variance') ensureSharedProjectTypeaheadData().catch(() => {});
}

function cvarHandleProjectInput(query) {
  const dropdown = document.getElementById('cvar-project-ta-dropdown');
  const inputEl = document.getElementById('cvar-project-ta-input');
  if (!dropdown || !inputEl) return;
  const rect = inputEl.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = rect.bottom + 'px';
  dropdown.style.width = Math.max(rect.width, 280) + 'px';
  dropdown.style.maxHeight = '240px';

  const q = (query || '').trim().toLowerCase();
  if (q.length < 1) { dropdown.style.display = 'none'; return; }

  const meta = window.sharedProjectMeta || {};
  const already = new Set(window.cvarSelectedProjects.map(p => p.id));
  const matches = (window.sharedActiveProjectCodes || []).filter(p => {
    if (already.has(p)) return false;
    const companyName = (meta[p] && meta[p].companyName) || '';
    return p.toLowerCase().includes(q) || companyName.toLowerCase().includes(q);
  }).slice(0, 10);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div style="padding:8px 10px; font-size:0.8rem; color:var(--muted);">No matching project found.</div>`;
    dropdown.style.display = 'block';
    return;
  }
  dropdown.innerHTML = matches.map(p => {
    const companyName = (meta[p] && meta[p].companyName) || '';
    return `<div onmousedown="event.preventDefault();" onclick="cvarSelectProject('${p.replace(/'/g, "\\'")}', \`${companyName.replace(/`/g, "'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;">${p}</span>${companyName ? ` <span style="color:var(--muted);">— ${companyName}</span>` : ''}
    </div>`;
  }).join('');
  dropdown.style.display = 'block';
}

function cvarSelectProject(projectId, companyName) {
  if (window.cvarSelectedProjects.length >= 20) {
    showCvarFeedback('At most 20 projects at a time.', 'error');
    return;
  }
  if (!window.cvarSelectedProjects.some(p => p.id === projectId)) {
    window.cvarSelectedProjects.push({ id: projectId, label: companyName ? `${projectId} — ${companyName}` : projectId });
  }
  const inputEl = document.getElementById('cvar-project-ta-input');
  const dropdown = document.getElementById('cvar-project-ta-dropdown');
  if (inputEl) inputEl.value = '';
  if (dropdown) dropdown.style.display = 'none';
  cvarRenderSelectedProjects();
}

function cvarRemoveProject(projectId) {
  window.cvarSelectedProjects = window.cvarSelectedProjects.filter(p => p.id !== projectId);
  cvarRenderSelectedProjects();
}

function cvarRenderSelectedProjects() {
  const mount = document.getElementById('cvar-selected-projects');
  if (!mount) return;
  mount.innerHTML = window.cvarSelectedProjects.map(p => `
    <span style="display:inline-flex; align-items:center; gap:5px; background:var(--highlight-bg); color:var(--brand); font-weight:600; font-size:0.78rem; padding:4px 8px; border-radius:14px; border:1px solid var(--border);">
      ${escapeHtml(p.label)}
      <span onclick="cvarRemoveProject('${p.id.replace(/'/g, "\\'")}')" style="cursor:pointer; font-weight:800; color:#b91c1c;" title="Remove">✕</span>
    </span>`).join('');
}

document.addEventListener('click', function(e) {
  if (!e.target.id || e.target.id !== 'cvar-project-ta-input') {
    const dd = document.getElementById('cvar-project-ta-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

function showCvarFeedback(msg, type) {
  const el = document.getElementById('cvar-feedback');
  if (!el) return;
  const colors = { error: '#dc2626', success: '#15803d' };
  el.style.cssText = `display:block; padding:12px; margin-bottom:12px; border-left:4px solid ${colors[type] || colors.error}; background:${type === 'success' ? '#f0fff4' : '#fef2f2'}; color:${colors[type] || colors.error}; border-radius:var(--radius); font-weight:600; font-size:0.85rem;`;
  el.textContent = msg;
}

function cvarCurrentRange() {
  const projectIds = window.cvarSelectedProjects.map(p => p.id);
  if (projectIds.length === 0) {
    showCvarFeedback('Add at least one project.', 'error');
    return null;
  }
  const startDate = document.getElementById('cvar-start-date')?.value || null;
  const endDate = document.getElementById('cvar-end-date')?.value || null;
  if (startDate && endDate && startDate > endDate) {
    showCvarFeedback('Start Date must be on or before End Date.', 'error');
    return null;
  }
  return { projectIds, startDate, endDate };
}

async function runConsumptionVarianceReport() {
  const feedback = document.getElementById('cvar-feedback');
  if (feedback) feedback.style.display = 'none';
  const range = cvarCurrentRange();
  if (!range) return;

  const resultsEl = document.getElementById('cvar-results');
  const bodyEl = document.getElementById('cvar-table-body');
  if (bodyEl) bodyEl.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:16px; color:var(--muted);">Loading...</td></tr>`;
  if (resultsEl) resultsEl.style.display = 'block';

  try {
    const data = await apFetch({ action: 'fetchMaterialConsumptionVariance', ...range });
    if (!data.success) {
      showCvarFeedback(data.error || 'Failed to load the report.', 'error');
      if (resultsEl) resultsEl.style.display = 'none';
      return;
    }
    cvarRenderTable(data.rows || []);
  } catch (e) {
    showCvarFeedback('Network error: ' + e.message, 'error');
    if (resultsEl) resultsEl.style.display = 'none';
  }
}

function cvarRenderTable(rows) {
  const bodyEl = document.getElementById('cvar-table-body');
  if (!bodyEl) return;
  if (rows.length === 0) {
    bodyEl.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:16px; color:var(--muted);">No BOQ or issue activity found for this selection.</td></tr>`;
    return;
  }
  bodyEl.innerHTML = rows.map(r => {
    const flags = [];
    if (r.orphan) flags.push('No BOQ line');
    if (r.unitMismatch) flags.push('Unit mismatch');
    if (Number(r.variantCount) > 1) flags.push(`${r.variantCount} variants`);
    if (r.hasServiceIssue) flags.push('Service issue');
    const varianceCell = r.unitMismatch ? '—' : trimNum(r.varianceQty);
    const varianceColor = r.unitMismatch ? 'var(--muted)' : (Number(r.varianceQty) > 0 ? '#b91c1c' : (Number(r.varianceQty) < 0 ? '#15803d' : 'var(--text)'));
    return `
    <tr style="border-bottom:1px solid var(--border); ${r.orphan ? 'background:#fffbeb;' : ''}">
      <td style="padding:8px; font-family:monospace; font-weight:700;">${escapeHtml(r.projectId || '')}</td>
      <td style="padding:8px; font-weight:600;">${escapeHtml(r.materialName || r.itemCode || '—')}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700;">${r.estimateQty != null ? trimNum(r.estimateQty) + (r.estUnit ? ' ' + escapeHtml(r.estUnit) : '') : '—'}</td>
      <td style="padding:8px; text-align:center; font-family:monospace;">${r.approvedIncreaseQty != null ? trimNum(r.approvedIncreaseQty) : '—'}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700;">${trimNum(r.actualQty)}${r.actUnit ? ' ' + escapeHtml(r.actUnit) : ''}</td>
      <td style="padding:8px; text-align:center; font-family:monospace; font-weight:800; color:${varianceColor};">${varianceCell}</td>
      <td style="padding:8px; font-size:0.76rem; color:var(--muted);">${flags.length ? escapeHtml(flags.join(', ')) : '—'}</td>
    </tr>`;
  }).join('');
}

async function downloadConsumptionVarianceReportFile() {
  const feedback = document.getElementById('cvar-feedback');
  if (feedback) feedback.style.display = 'none';
  const range = cvarCurrentRange();
  if (!range) return;

  showBlockingOverlay('Building Consumption Variance Excel...');
  try {
    const data = await apFetch({ action: 'downloadMaterialConsumptionVariance', ...range });
    hideBlockingOverlay();
    if (!data.success) { showCvarFeedback(data.error || 'Failed to build the Excel file.', 'error'); return; }
    const link = document.createElement('a');
    link.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + data.base64;
    link.download = data.fileName || 'Material_Consumption_Variance.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    hideBlockingOverlay();
    showCvarFeedback('Network error: ' + e.message, 'error');
  }
}
