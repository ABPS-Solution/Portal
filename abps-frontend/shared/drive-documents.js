// ═══════════════════════════════════════════════════════════════════════
// shared/drive-documents.js — Drive Documents screen (header "Drive"
// button, perm_documents) and Security & Login Access → Document Access.
// Browse by Project or by Type → folder → document → every version.
// Opening a file uses the normal driveFile proxy link (shared/apFetch.js
// adds the file token on click); "?dl=1" makes the proxy save it instead.
// Backend: routes/documents.js. Types: lib/documentCategories.js.
// ═══════════════════════════════════════════════════════════════════════

let ddocState = { view: "project", categories: [], departments: [], isAdmin: false, trail: [] };

const DDOC_DEPT_COLORS = {
  Marketing: "#be185d", Design: "#2563eb", Purchase: "#7c3aed", Store: "#0369a1", Production: "#b45309",
  QA: "#dc2626", Dispatch: "#0f766e", Accounts: "#0f766e", Service: "#475569",
};

function openDriveDocumentsPanel() {
  switchActiveDashboardModule("drive-documents");
}

function exitDriveDocumentsBackToMenu() {
  document.getElementById("canvas-module-drive-documents").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

async function initializeDriveDocumentsPanel() {
  const mount = document.getElementById("ddoc-mount");
  if (!mount) return;
  mount.innerHTML = `<div class="ddoc-loading">Loading documents...</div>`;
  const search = document.getElementById("ddoc-search");
  if (search) search.value = "";
  try {
    const data = await apFetch({ action: "fetchDocumentCategories" });
    if (!data.success) throw new Error(data.error || "Could not load documents.");
    ddocState.categories = data.categories || [];
    ddocState.departments = data.departments || [];
    ddocState.isAdmin = !!data.isAdmin;
    const adminBar = document.getElementById("ddoc-admin-bar");
    if (adminBar) adminBar.style.display = ddocState.isAdmin ? "flex" : "none";
    if (!ddocState.categories.length) {
      mount.innerHTML = `<div class="ddoc-empty">You have not been given access to any document type yet. Ask an admin (Security &amp; Login Access → Document Access).</div>`;
      return;
    }
    ddocSetView(ddocState.view);
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    mount.innerHTML = `<div class="ddoc-error">${escapeHtml(err.message)}</div>`;
  }
}

function ddocSetView(view) {
  ddocState.view = view;
  ["project", "type"].forEach(v => {
    const b = document.getElementById("ddoc-view-" + v);
    if (b) b.classList.toggle("active", v === view);
  });
  if (view === "project") ddocShowProjects(); else ddocShowTypes();
}

function ddocBreadcrumb(parts) {
  ddocState.trail = parts;
  const el = document.getElementById("ddoc-breadcrumb");
  if (!el) return;
  el.innerHTML = parts.map((p, i) => i < parts.length - 1
    ? `<a href="#" onclick="event.preventDefault(); ddocState.trail[${i}].go();">${escapeHtml(p.label)}</a>`
    : `<span>${escapeHtml(p.label)}</span>`).join(`<span class="ddoc-sep">›</span>`);
}

// ── By Type ─────────────────────────────────────────────────────────────
function ddocShowTypes() {
  ddocBreadcrumb([{ label: "All types", go: ddocShowTypes }]);
  const mount = document.getElementById("ddoc-mount");
  const byDept = {};
  ddocState.categories.forEach(c => { (byDept[c.department] = byDept[c.department] || []).push(c); });
  mount.innerHTML = ddocState.departments.filter(d => byDept[d]).map(d => `
    <div class="ddoc-dept">
      <div class="ddoc-dept-title" style="color:${DDOC_DEPT_COLORS[d] || "#334155"};">${escapeHtml(d)}</div>
      <div class="ddoc-grid">
        ${byDept[d].map(c => `
          <button class="ddoc-folder" style="border-left-color:${DDOC_DEPT_COLORS[d] || "#334155"};" onclick="ddocOpenCategory(${jsArg(c.key)})">
            <span class="ddoc-folder-icon">📁</span>
            <span class="ddoc-folder-name">${escapeHtml(c.label)}</span>
            <span class="ddoc-folder-count">${c.count} file${c.count === 1 ? "" : "s"}</span>
          </button>`).join("")}
      </div>
    </div>`).join("");
}

async function ddocOpenCategory(categoryKey) {
  const cat = ddocState.categories.find(c => c.key === categoryKey);
  if (!cat) return;
  ddocBreadcrumb([{ label: "All types", go: ddocShowTypes }, { label: cat.label, go: () => ddocOpenCategory(categoryKey) }]);
  const mount = document.getElementById("ddoc-mount");
  mount.innerHTML = `<div class="ddoc-loading">Loading folders...</div>`;
  try {
    const data = await apFetch({ action: "fetchDocumentFolders", category: categoryKey });
    if (!data.success) throw new Error(data.error || "Could not load folders.");
    if (!data.folders.length) { mount.innerHTML = `<div class="ddoc-empty">No ${escapeHtml(cat.label)} documents yet.</div>`; return; }
    mount.innerHTML = `
      <input type="text" class="ddoc-filter" placeholder="Filter ${escapeHtml(cat.groupLabel.toLowerCase())}s..." oninput="ddocFilterFolders(this.value)">
      <div class="ddoc-grid" id="ddoc-folder-grid">
        ${data.folders.map(f => `
          <button class="ddoc-folder" data-filter="${escapeHtml((f.grp + " " + (f.company_name || "")).toLowerCase())}"
                  onclick="ddocOpenFolder(${jsArg(categoryKey)}, ${jsArg(f.grp)})">
            <span class="ddoc-folder-icon">📁</span>
            <span class="ddoc-folder-name">${escapeHtml(f.grp)}</span>
            ${f.company_name && !String(f.grp).includes(f.company_name) ? `<span class="ddoc-folder-sub">${escapeHtml(f.company_name)}</span>` : ""}
            <span class="ddoc-folder-count">${f.n} file${f.n === 1 ? "" : "s"}${f.last_at ? " · " + escapeHtml(formatOrdinalDate(f.last_at)) : ""}</span>
          </button>`).join("")}
      </div>`;
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    mount.innerHTML = `<div class="ddoc-error">${escapeHtml(err.message)}</div>`;
  }
}

function ddocFilterFolders(q) {
  const needle = String(q || "").trim().toLowerCase();
  document.querySelectorAll("#ddoc-folder-grid .ddoc-folder").forEach(el => {
    el.style.display = !needle || (el.dataset.filter || "").includes(needle) ? "" : "none";
  });
}

async function ddocOpenFolder(categoryKey, group) {
  const cat = ddocState.categories.find(c => c.key === categoryKey);
  ddocBreadcrumb([
    { label: "All types", go: ddocShowTypes },
    { label: cat ? cat.label : categoryKey, go: () => ddocOpenCategory(categoryKey) },
    { label: group, go: () => ddocOpenFolder(categoryKey, group) },
  ]);
  await ddocLoadDocuments({ action: "fetchDocumentFiles", category: categoryKey, group }, false);
}

// ── By Project ──────────────────────────────────────────────────────────
async function ddocShowProjects() {
  ddocBreadcrumb([{ label: "All projects", go: ddocShowProjects }]);
  const mount = document.getElementById("ddoc-mount");
  mount.innerHTML = `<div class="ddoc-loading">Loading projects...</div>`;
  try {
    const data = await apFetch({ action: "fetchDocumentProjects" });
    if (!data.success) throw new Error(data.error || "Could not load projects.");
    const others = ddocState.categories.filter(c => !c.projectScoped);
    mount.innerHTML = `
      <input type="text" class="ddoc-filter" placeholder="Filter projects..." oninput="ddocFilterFolders(this.value)">
      <div class="ddoc-grid" id="ddoc-folder-grid">
        ${(data.projects || []).map(p => `
          <button class="ddoc-folder" data-filter="${escapeHtml((p.project_id + " " + (p.company_name || "")).toLowerCase())}"
                  onclick="ddocOpenProject(${jsArg(p.project_id)})">
            <span class="ddoc-folder-icon">📁</span>
            <span class="ddoc-folder-name">${escapeHtml(p.project_id)}</span>
            <span class="ddoc-folder-sub">${escapeHtml(p.company_name || "")}${p.project_status ? " · " + escapeHtml(p.project_status) : ""}</span>
            <span class="ddoc-folder-count">${p.n} file${p.n === 1 ? "" : "s"}</span>
          </button>`).join("") || `<div class="ddoc-empty">No project documents yet.</div>`}
      </div>
      ${others.length ? `
        <div class="ddoc-dept-title" style="margin-top:22px;">Not tied to a project</div>
        <div class="ddoc-grid">
          ${others.map(c => `
            <button class="ddoc-folder" style="border-left-color:${DDOC_DEPT_COLORS[c.department] || "#334155"};" onclick="ddocOpenCategory(${jsArg(c.key)})">
              <span class="ddoc-folder-icon">📁</span>
              <span class="ddoc-folder-name">${escapeHtml(c.label)}</span>
              <span class="ddoc-folder-count">${c.count} file${c.count === 1 ? "" : "s"}</span>
            </button>`).join("")}
        </div>` : ""}`;
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    mount.innerHTML = `<div class="ddoc-error">${escapeHtml(err.message)}</div>`;
  }
}

async function ddocOpenProject(projectId) {
  ddocBreadcrumb([{ label: "All projects", go: ddocShowProjects }, { label: projectId, go: () => ddocOpenProject(projectId) }]);
  await ddocLoadDocuments({ action: "fetchDocumentFiles", projectId }, true);
}

// ── Search ──────────────────────────────────────────────────────────────
let ddocSearchTimer = null;
function ddocSearchInput(value) {
  clearTimeout(ddocSearchTimer);
  const q = String(value || "").trim();
  ddocSearchTimer = setTimeout(() => {
    if (q.length < 2) { ddocSetView(ddocState.view); return; }
    ddocBreadcrumb([{ label: "Search results for “" + q + "”", go: () => ddocSearchInput(q) }]);
    ddocLoadDocuments({ action: "searchDocuments", query: q }, true);
  }, 350);
}

// ── Document list (shared by folder, project and search views) ──────────
async function ddocLoadDocuments(payload, groupByCategory) {
  const mount = document.getElementById("ddoc-mount");
  mount.innerHTML = `<div class="ddoc-loading">Loading documents...</div>`;
  try {
    const data = await apFetch(payload);
    if (!data.success) throw new Error(data.error || "Could not load documents.");
    const docs = data.documents || [];
    if (!docs.length) { mount.innerHTML = `<div class="ddoc-empty">No documents found.</div>`; return; }
    const sections = new Map();
    docs.forEach(d => {
      const head = groupByCategory ? d.categoryLabel : "";
      const sectionKey = head + "|" + (d.subFolder || "");
      if (!sections.has(sectionKey)) sections.set(sectionKey, { head, sub: d.subFolder, docs: [] });
      sections.get(sectionKey).docs.push(d);
    });
    const ordered = [...sections.values()].sort((a, b) => a.head.localeCompare(b.head) || String(a.sub || "").localeCompare(String(b.sub || "")));
    mount.innerHTML = ordered.map(s => `
      <div class="ddoc-section">
        ${s.head || s.sub ? `<div class="ddoc-section-title">📂 ${escapeHtml([s.head, s.sub].filter(Boolean).join(" › "))}</div>` : ""}
        ${s.docs.map(ddocRenderDocument).join("")}
      </div>`).join("");
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    mount.innerHTML = `<div class="ddoc-error">${escapeHtml(err.message)}</div>`;
  }
}

function ddocVersionLabel(v, isLatest) {
  const parts = [];
  if (v.version !== null && v.version !== undefined) parts.push("V" + v.version);
  if (isLatest) parts.push("Latest");
  return parts.join(" · ");
}

function ddocFileButtons(v) {
  const open = driveLink(v.url);
  return `<a class="ddoc-btn" href="${escapeHtml(open)}" target="_blank" rel="noopener">Open</a>
          <a class="ddoc-btn ddoc-btn-dl" href="${escapeHtml(open + (open.includes("?") ? "&" : "?") + "dl=1")}" target="_blank" rel="noopener">Download</a>`;
}

function ddocRenderDocument(d) {
  const latest = d.versions[0];
  const older = d.versions.slice(1);
  const id = "ddoc-v-" + Math.random().toString(36).slice(2, 9);
  return `
    <div class="ddoc-doc">
      <div class="ddoc-doc-main">
        <div class="ddoc-doc-info">
          <div class="ddoc-doc-title">📄 ${escapeHtml(d.title)}</div>
          <div class="ddoc-doc-meta">
            ${escapeHtml([d.group, ddocVersionLabel(latest, older.length > 0), latest.date ? formatOrdinalDateTime(latest.date) : "", latest.fileName].filter(Boolean).join(" · "))}
          </div>
        </div>
        <div class="ddoc-doc-actions">
          ${older.length ? `<button class="ddoc-btn ddoc-btn-ghost" onclick="ddocToggleVersions('${id}', this)">${older.length} older version${older.length === 1 ? "" : "s"} ▾</button>` : ""}
          ${ddocFileButtons(latest)}
        </div>
      </div>
      ${older.length ? `
        <div class="ddoc-versions" id="${id}" style="display:none;">
          ${older.map(v => `
            <div class="ddoc-version">
              <span>${escapeHtml([ddocVersionLabel(v, false) || "Earlier version", v.date ? formatOrdinalDateTime(v.date) : "", v.title !== d.title ? v.title : "", v.fileName].filter(Boolean).join(" · "))}</span>
              <span class="ddoc-doc-actions">${ddocFileButtons(v)}</span>
            </div>`).join("")}
        </div>` : ""}
    </div>`;
}

function ddocToggleVersions(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const show = el.style.display === "none";
  el.style.display = show ? "block" : "none";
  btn.textContent = btn.textContent.replace(show ? "▾" : "▴", show ? "▴" : "▾");
}

async function ddocRunIndex(scanDrive) {
  if (scanDrive && !(await abpsConfirm("Read Drive once to add older BOQ / PRN / PPS versions and all Drawings? This can take a few minutes.", { okLabel: "Scan Drive" }))) return;
  const status = document.getElementById("ddoc-admin-status");
  if (status) status.textContent = scanDrive ? "Scanning Drive... (this can take a few minutes)" : "Refreshing...";
  try {
    const data = await apFetch({ action: "runDocumentIndex", scanDrive: !!scanDrive, _timeoutMs: 600000 });
    if (!data.success) throw new Error(data.error || "Refresh failed.");
    const h = data.history;
    if (status) status.textContent = `Done: ${data.index.indexed} links checked` + (h ? `, ${h.olderVersions} older versions and ${h.drawings} drawings added` + (h.errors.length ? `, ${h.errors.length} errors` : "") : "") + ".";
    initializeDriveDocumentsPanel();
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    if (status) status.textContent = err.message;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Security & Login Access → Document Access
// ═══════════════════════════════════════════════════════════════════════
let daccState = { users: [], categories: [], departments: [], selected: null };

async function loadDocumentAccessMatrix() {
  const body = document.getElementById("sa-docaccess-body");
  if (!body) return;
  body.innerHTML = `<div class="ddoc-loading">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchDocumentAccessMatrix" });
    if (!data.success) throw new Error(data.error || "Could not load Document Access.");
    daccState.users = data.users || [];
    daccState.categories = data.categories || [];
    daccState.departments = data.departments || [];
    daccRender();
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    body.innerHTML = `<div class="ddoc-error">${escapeHtml(err.message)}</div>`;
  }
}

function daccName(u) { return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.personKey; }

function daccRender() {
  const body = document.getElementById("sa-docaccess-body");
  const filter = (document.getElementById("sa-docaccess-search") || {}).value || "";
  const needle = filter.trim().toLowerCase();
  const people = daccState.users.filter(u => !needle || (daccName(u) + " " + (u.department || "")).toLowerCase().includes(needle));
  if (!daccState.selected || !daccState.users.some(u => u.personKey === daccState.selected)) {
    daccState.selected = people.length ? people[0].personKey : null;
  }
  const sel = daccState.users.find(u => u.personKey === daccState.selected);
  body.innerHTML = `
    <div class="dacc-layout">
      <div class="dacc-people">
        ${people.map(u => `
          <button class="dacc-person ${u.personKey === daccState.selected ? "active" : ""}" onclick="daccSelect(${jsArg(u.personKey)})">
            <span class="dacc-person-name">${escapeHtml(daccName(u))}</span>
            <span class="dacc-person-meta">${escapeHtml(u.department || "")} · ${u.isAdmin ? "Admin (all)" : u.categories.length + " types"}${u.documentsScreen ? "" : " · screen off"}</span>
          </button>`).join("") || `<div class="ddoc-empty">No one matches.</div>`}
      </div>
      <div class="dacc-detail">${sel ? daccDetailHtml(sel) : ""}</div>
    </div>`;
}

function daccDetailHtml(u) {
  const has = new Set(u.categories);
  const byDept = {};
  daccState.categories.forEach(c => { (byDept[c.department] = byDept[c.department] || []).push(c); });
  return `
    <div class="dacc-head">
      <div>
        <div class="dacc-head-name">${escapeHtml(daccName(u))}</div>
        <div class="dacc-person-meta">${escapeHtml(u.department || "")}${u.isAdmin ? " · Admins can open every document type." : ""}</div>
      </div>
      <label class="dacc-screen-toggle">
        <input type="checkbox" ${u.documentsScreen ? "checked" : ""} onchange="daccToggleScreen(${jsArg(u.personKey)}, this.checked, this)">
        Drive Documents screen
      </label>
    </div>
    <p class="dacc-hint">Click a type to give or take away access. This decides who can open these documents anywhere in the system, not only on the Drive Documents screen.</p>
    ${daccState.departments.filter(d => byDept[d]).map(d => {
      const all = byDept[d].every(c => has.has(c.key));
      const color = DDOC_DEPT_COLORS[d] || "#334155";
      return `
      <div class="dacc-dept">
        <div class="dacc-dept-head">
          <span style="color:${color}; font-weight:800;">${escapeHtml(d)}</span>
          <button class="ddoc-btn ddoc-btn-ghost" onclick="daccToggle(${jsArg(u.personKey)}, null, ${jsArg(d)}, ${!all})">${all ? "Remove all" : "Give all"}</button>
        </div>
        <div class="dacc-pills">
          ${byDept[d].map(c => `
            <button class="dacc-pill ${has.has(c.key) ? "on" : ""}" style="${has.has(c.key) ? `background:${color}; border-color:${color};` : ""}"
                    onclick="daccToggle(${jsArg(u.personKey)}, ${jsArg(c.key)}, null, ${!has.has(c.key)})">${escapeHtml(c.label)}</button>`).join("")}
        </div>
      </div>`;
    }).join("")}`;
}

function daccSelect(personKey) {
  daccState.selected = personKey;
  daccRender();
}

async function daccToggle(personKey, category, department, grant) {
  try {
    const data = await apFetch({ action: "toggleDocumentAccess", personKey, category, department, grant });
    if (!data.success) throw new Error(data.error || "Could not save.");
    const u = daccState.users.find(x => x.personKey === personKey);
    if (u) u.categories = data.categories;
    daccRender();
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    alert(err.message);
  }
}

async function daccToggleScreen(personKey, enabled, box) {
  try {
    const data = await apFetch({ action: "toggleDocumentsScreen", personKey, enabled });
    if (!data.success) throw new Error(data.error || "Could not save.");
    const u = daccState.users.find(x => x.personKey === personKey);
    if (u) u.documentsScreen = enabled;
    daccRender();
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    box.checked = !enabled;
    alert(err.message);
  }
}

async function daccShowDownloadLog() {
  const body = document.getElementById("sa-docaccess-body");
  body.innerHTML = `<div class="ddoc-loading">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchDocumentDownloadLog" });
    if (!data.success) throw new Error(data.error || "Could not load the log.");
    const labels = Object.fromEntries(daccState.categories.map(c => [c.key, c.label]));
    body.innerHTML = `
      <button class="ddoc-btn ddoc-btn-ghost" style="margin-bottom:10px;" onclick="daccRender()">‹ Back to people</button>
      <div style="overflow-x:auto;">
      <table class="dacc-log">
        <thead><tr><th>When</th><th>Person</th><th>Type</th><th>Document</th><th>Result</th></tr></thead>
        <tbody>${(data.rows || []).map(r => `
          <tr>
            <td>${escapeHtml(formatOrdinalDateTime(r.at))}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(labels[r.category] || r.category || "")}</td>
            <td>${escapeHtml([r.doc_title || r.file_name, r.doc_group].filter(Boolean).join(" · "))}</td>
            <td style="color:${r.allowed ? "#15803d" : "#b91c1c"}; font-weight:700;">${r.allowed ? "Opened" : "Blocked"}</td>
          </tr>`).join("") || `<tr><td colspan="5">Nothing opened yet.</td></tr>`}</tbody>
      </table></div>`;
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") return;
    body.innerHTML = `<div class="ddoc-error">${escapeHtml(err.message)}</div>`;
  }
}
