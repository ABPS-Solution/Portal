// ═══════════════════════════════════════════════════════════════════════
// shared/documentation.js — Documentation screen. Two-pane layout: a
// left nav built from fetchDocumentationNav (department cards + sections,
// already filtered server-side to what THIS user can see — nothing here
// re-derives visibility from userPermissions, the server is the single
// source of truth for that, same discipline every write route already
// follows), and a right content pane that renders whatever article HTML
// fetchDocumentationArticle returns via innerHTML — server-authored
// content only (routes/documentation.js), not user input.
//
// No permission gate on the "📖 Docs" header button itself — every
// logged-in user can open this screen; what they see INSIDE it is what's
// filtered.
// ═══════════════════════════════════════════════════════════════════════

let docNavData = null;       // { gettingStarted, departments } from the server
let docActiveKey = null;     // currently-open article key
let docExpandedDepts = new Set();

async function initializeDocumentationPanel() {
  const mount = document.getElementById('doc-mount');
  if (!mount) return;
  mount.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Loading Documentation...</div>`;

  try {
    const data = await apFetch({ action: 'fetchDocumentationNav' });
    if (!data.success) {
      mount.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error || 'Could not load Documentation.')}</p>`;
      return;
    }
    docNavData = data;
  } catch (e) {
    mount.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`;
    return;
  }

  // Default landing article: Getting Started if it exists, else the
  // first section this user can actually see — never a blank pane.
  docExpandedDepts = new Set();
  let defaultKey = docNavData.gettingStarted ? docNavData.gettingStarted.key : null;
  if (!defaultKey) {
    const firstDept = (docNavData.departments || [])[0];
    if (firstDept) {
      docExpandedDepts.add(firstDept.key);
      defaultKey = firstDept.overviewKey || (firstDept.sections[0] && firstDept.sections[0].key) || null;
    }
  }

  mount.innerHTML = `
    <div style="display:flex; gap:20px; align-items:flex-start;">
      <div id="doc-nav" style="flex:none; width:260px; position:sticky; top:0;"></div>
      <div id="doc-content" class="doc-article" style="flex:1 1 auto; min-width:0;"></div>
    </div>
  `;
  docRenderNav();
  if (defaultKey) docShowArticle(defaultKey);
  else document.getElementById('doc-content').innerHTML = `<p style="color:var(--muted);">Nothing is written yet for your sections.</p>`;
}

function docRenderNav() {
  const nav = document.getElementById('doc-nav');
  if (!nav || !docNavData) return;

  let html = '';
  if (docNavData.gettingStarted) {
    html += docNavLinkHtml(docNavData.gettingStarted.key, '🚀 Getting Started', true);
  }

  (docNavData.departments || []).forEach(dept => {
    const expanded = docExpandedDepts.has(dept.key);
    html += `
      <div style="margin-top:10px;">
        <div onclick="docToggleDept('${dept.key}')" style="display:flex; align-items:center; gap:6px; padding:7px 10px; border-radius:var(--radius); cursor:pointer; font-weight:700; font-size:0.82rem; color:${dept.color};">
          <span style="font-size:0.7rem;">${expanded ? '▾' : '▸'}</span>
          <span style="width:8px; height:8px; border-radius:50%; background:${dept.color}; flex:none;"></span>
          ${escapeHtml(dept.label)}
        </div>
        ${expanded ? `<div style="padding-left:14px; border-left:2px solid var(--border); margin-left:14px;">
          ${dept.overviewKey ? docNavLinkHtml(dept.overviewKey, 'Overview') : ''}
          ${dept.sections.map(s => docNavLinkHtml(s.key, s.label)).join('')}
          ${(dept.sections.length === 0 && !dept.overviewKey) ? `<div style="padding:6px 10px; font-size:0.76rem; color:var(--muted); font-style:italic;">Nothing written yet.</div>` : ''}
        </div>` : ''}
      </div>`;
  });

  nav.innerHTML = html;
}

function docNavLinkHtml(key, label, top) {
  const active = key === docActiveKey;
  return `<div onclick="docShowArticle('${key}')" id="doc-nav-item-${docSafeId(key)}"
      style="padding:${top ? '8px 10px' : '6px 10px'}; border-radius:var(--radius); cursor:pointer; font-size:${top ? '0.85rem' : '0.8rem'}; font-weight:${active ? '700' : '500'}; color:${active ? 'var(--brand)' : 'var(--text)'}; background:${active ? 'var(--highlight-bg)' : 'transparent'};"
      onmouseover="if(this.id!=='doc-nav-item-${docSafeId(docActiveKey || '')}') this.style.background='#f8fafc';"
      onmouseout="if(this.id!=='doc-nav-item-${docSafeId(docActiveKey || '')}') this.style.background='transparent';">${escapeHtml(label)}</div>`;
}

// dbColumn/key values are plain identifiers (perm_xxx, dept:xxx,
// getting-started) but a DOM id can't contain a colon — swapped for a
// dash purely for the id attribute, never sent back to the server.
function docSafeId(key) {
  return (key || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function docToggleDept(deptKey) {
  if (docExpandedDepts.has(deptKey)) docExpandedDepts.delete(deptKey);
  else docExpandedDepts.add(deptKey);
  docRenderNav();
}

async function docShowArticle(key) {
  docActiveKey = key;
  docRenderNav();
  const content = document.getElementById('doc-content');
  if (!content) return;
  content.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Loading...</div>`;
  content.scrollTop = 0;

  try {
    const data = await apFetch({ action: 'fetchDocumentationArticle', articleKey: key });
    if (!data.success) {
      content.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error || 'Could not load this article.')}</p>`;
      return;
    }
    content.innerHTML = data.html || '';
  } catch (e) {
    content.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`;
  }
}

function exitDocumentationBackToMenu() {
  document.getElementById('canvas-module-documentation').style.display = 'none';
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById('dashboard-view').style.display = 'flex';
}
