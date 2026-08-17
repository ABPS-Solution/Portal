// ═══════════════════════════════════════════════════════════════════════
// project/customer-queries.js — "Customer Queries Received through Email"
// (16 Aug 2026). Three toggles sharing one panel, same switcher shape as
// Project Invoice Generation's switchPinvMode: Incoming Email Queries
// (AI-filtered inbox → Create Query), Current Pending Queries
// (date-bucketed worklist, close with delay tracking), Resolved Queries
// (multi-filter search, reopen). Backend: routes/project-queries.js.
// ═══════════════════════════════════════════════════════════════════════
const CQ_STAGE_OPTIONS = ['Drawing Approval', 'Inspection Call & Clearance', 'Products Received at Site', 'I & C and Hand over to Customer', 'Others'];
const CQ_DEPARTMENT_OPTIONS = ['Marketing', 'Design', 'QA', 'Service', 'Accounts', 'Project'];
const CQ_BUCKETS = [
  ['', 'All'], ['Overdue', 'Overdue'], ['Today', 'Today'], ['Tomorrow', 'Tomorrow'],
  ['ThisWeek', 'This Week'], ['NextWeek', 'Next Week'], ['ThisMonth', 'This Month'],
];

let cqMode = 'incoming';
let cqIncomingEmails = [];
let cqPendingQueries = [];
let cqResolvedQueries = [];
let cqOpenCreateFormFor = null; // messageId of the email whose Create Query form is expanded
let cqCreateFormState = {};     // per-messageId form state
let cqOpenPendingId = null;     // queryId of the expanded Pending card
let cqPendingEditState = {};
let cqOpenResolvedId = null;
let cqActiveBucket = '';
let cqCommunicationsCache = {}; // queryId -> [{communicationId, threadLink, sentTo, subject, commType, sentAt, ...}]
let cqUnattributedComms = [];

// Own project-code cache — deliberately NOT window.sharedActiveProjectCodes
// (shared/typeahead.js), which is hardcoded to Active-only projects
// (routes/utility.js's pullLiveActiveProjectCodes ignores its own
// statusFilter param). A customer query can reference a Completed or
// Inactive project just as legitimately as an Active one.
let cqAllProjectCodes = [];
let cqProjectMeta = {};
let cqProjectDataLoaded = false;
let cqProductsCache = {}; // projectId -> [{standardProductName, description}]

function exitCustomerQueriesBackToMenu() {
  document.getElementById("canvas-module-customer-queries").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function initializeCustomerQueriesWorkspace() {
  switchCqMode('incoming');
}

function switchCqMode(mode) {
  cqMode = mode;
  document.getElementById("cq-feedback").style.display = "none";
  ['incoming', 'pending', 'resolved'].forEach(m => {
    document.getElementById(`cq-mode-${m}`).style.display = m === mode ? "block" : "none";
    document.getElementById(`cq-mode-btn-${m}`).style.background = m === mode ? "var(--accent)" : "#718096";
  });
  if (mode === 'incoming') loadCqIncomingEmails();
  else if (mode === 'pending') { renderCqBucketBar(); loadCqPendingQueries().then(() => loadCqUnattributed()); }
  else if (mode === 'resolved') { /* wait for the user to search */ }
}

// "Ask the user to attribute it" — confirmed design decision, never
// AI-guessed. A sent email the scan couldn't tie to exactly one query by
// thread or recipient shows here until a human assigns it.
async function loadCqUnattributed() {
  const zone = document.getElementById("cq-unattributed-zone");
  try {
    const data = await apFetch({ action: "fetchUnattributedCommunications" });
    cqUnattributedComms = data.success ? (data.communications || []) : [];
  } catch (e) {
    cqUnattributedComms = [];
  }
  renderCqUnattributedList();
}

function renderCqUnattributedList() {
  const zone = document.getElementById("cq-unattributed-zone");
  if (!zone) return;
  if (cqUnattributedComms.length === 0) { zone.style.display = "none"; zone.innerHTML = ""; return; }
  zone.style.display = "block";
  zone.innerHTML = `
    <div style="background:#fef9c3; border:1.5px solid #eab308; border-radius:var(--radius); padding:14px; margin-bottom:16px;">
      <div style="font-weight:700; color:#854d0e; margin-bottom:10px;">We found ${cqUnattributedComms.length} email(s) to a customer — which query does each answer?</div>
      ${cqUnattributedComms.map(c => `
        <div style="background:#fff; border:1px solid var(--border); border-radius:4px; padding:10px; margin-bottom:8px; font-size:0.82rem;">
          <div><strong>${c.commType}</strong> to ${c.sentTo || ''} — ${formatDateDMY(c.sentAt)} ${c.threadLink ? `<a href="${c.threadLink}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open Email ↗</a>` : ''}</div>
          <div style="color:var(--muted); margin:4px 0;">${c.subject || ''}${c.aiSummary ? ' — ' + c.aiSummary : ''}</div>
          <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
            <select id="cq-attr-select-${c.communicationId}" style="flex:1; padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.8rem;">
              <option value="">— Select the query this answers —</option>
              ${cqPendingQueries.map(q => `<option value="${q.queryId}">#${q.queryId} — ${q.projectId} — ${q.customerName || ''}</option>`).join('')}
            </select>
            <button class="nav-btn-styled" style="background:var(--accent); padding:5px 12px; font-size:0.78rem;" onclick="attributeCqCommunication(${c.communicationId})">Attribute</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function attributeCqCommunication(communicationId) {
  const select = document.getElementById(`cq-attr-select-${communicationId}`);
  const queryId = select?.value;
  if (!queryId) { showBOQBanner("cq-feedback", "⚠️ Select which query this email answers.", "error"); return; }
  try {
    const data = await apFetch({ action: "attributeCommunication", communicationId, queryId: Number(queryId) });
    if (data.success) {
      showBOQBanner("cq-feedback", "Email attributed.", "success");
      await loadCqUnattributed();
      await loadCqPendingQueries();
    } else {
      showBOQBanner("cq-feedback", "⚠️ " + (data.error || "Failed."), "error");
    }
  } catch (e) {
    showBOQBanner("cq-feedback", "Network error: " + e.message, "error");
  }
}

function renderCqBucketBar() {
  const bar = document.getElementById("cq-bucket-bar");
  bar.innerHTML = CQ_BUCKETS.map(([val, label]) => `
    <button type="button" class="nav-btn-styled cq-bucket-btn" data-bucket="${val}" onclick="selectCqBucket('${val}')"
      style="padding:6px 14px; font-size:0.8rem; border:1.5px solid var(--border); background:${val === cqActiveBucket ? 'var(--accent)' : '#fff'}; color:${val === cqActiveBucket ? '#fff' : 'var(--text)'};">${label}</button>
  `).join("");
}

async function ensureCqProjectData(forceRefresh = false) {
  if (cqProjectDataLoaded && !forceRefresh) return;
  try {
    const data = await apFetch({ action: "fetchAllProjectCodesForQuery" });
    cqAllProjectCodes = data.projects || [];
    cqProjectMeta = data.projectMeta || {};
    cqProjectDataLoaded = true;
  } catch (e) {
    cqAllProjectCodes = []; cqProjectMeta = {};
  }
}

async function ensureCqProductsForProject(projectId) {
  if (cqProductsCache[projectId]) return cqProductsCache[projectId];
  try {
    const data = await apFetch({ action: "fetchStandardProductsForProject", projectId });
    cqProductsCache[projectId] = data.success ? (data.products || []) : [];
  } catch (e) {
    cqProductsCache[projectId] = [];
  }
  return cqProductsCache[projectId];
}

// ═══════════════════════════════════════════ INCOMING EMAIL QUERIES ═══

async function loadCqIncomingEmails() {
  const list = document.getElementById("cq-incoming-list");
  list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  cqOpenCreateFormFor = null;
  try {
    const data = await apFetch({ action: "fetchIncomingQueryEmails" });
    if (!data.success) { list.innerHTML = `<div style="padding:14px; color:#b91c1c;">${data.error || "Failed to load."}</div>`; return; }
    cqIncomingEmails = data.emails || [];
    renderCqIncomingList();
  } catch (e) {
    list.innerHTML = `<div style="padding:14px; color:#b91c1c;">Network error: ${e.message}</div>`;
  }
}

async function refreshCqIncomingEmailsNow() {
  const btn = document.getElementById("cq-incoming-refresh-btn");
  btn.disabled = true; btn.textContent = "Checking mailbox...";
  try {
    const data = await apFetch({ action: "pollCustomerQueryEmailsNow" });
    if (!data.success) showBOQBanner("cq-feedback", data.error || "Failed to poll.", "error");
    await loadCqIncomingEmails();
  } catch (e) {
    showBOQBanner("cq-feedback", "Network error: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Check for New Emails";
  }
}

function renderCqIncomingList() {
  const list = document.getElementById("cq-incoming-list");
  const isAdmin = localStorage.getItem("isUserAdminGlobal") === "true"; // server re-checks perm_admin regardless
  if (cqIncomingEmails.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted); font-size:0.85rem;">No incoming customer query emails.</div>`;
    return;
  }
  list.innerHTML = cqIncomingEmails.map(mail => {
    const isOpen = cqOpenCreateFormFor === mail.messageId;
    return `<div style="border:1px solid var(--border); border-radius:var(--radius); padding:14px; margin-bottom:12px; background:#fff;">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="flex:1; min-width:240px;">
          <div style="font-size:0.78rem; color:var(--muted);">${formatDateDMY(mail.receivedDate)} — ${mail.inboxAccount || ''}</div>
          <div style="font-weight:700; margin-top:2px;">${mail.fromAddress || '—'}</div>
          <div style="font-size:0.85rem; margin-top:2px;">${mail.subject || '(no subject)'}</div>
          <div style="font-size:0.8rem; color:var(--muted); margin-top:6px;">${mail.aiSummary || mail.bodySnippet || ''}</div>
          ${mail.threadLink ? `<a href="${mail.threadLink}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; font-size:0.8rem; display:inline-block; margin-top:6px;">Open Email ↗</a>` : ''}
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
          <button class="nav-btn-styled" style="background:var(--accent); padding:7px 16px; font-size:0.8rem;" onclick="toggleCqCreateForm('${mail.messageId}')">${isOpen ? 'Close' : 'Create Query'}</button>
          ${isAdmin ? `<button class="nav-btn-styled" style="background:#b91c1c; padding:5px 12px; font-size:0.72rem;" onclick="deleteCqIncomingEmail('${mail.messageId}')">Delete</button>` : ''}
        </div>
      </div>
      <div id="cq-create-form-${mail.messageId}" style="${isOpen ? '' : 'display:none;'} margin-top:14px; border-top:1px solid var(--border); padding-top:14px;"></div>
    </div>`;
  }).join("");
  if (cqOpenCreateFormFor) renderCqCreateForm(cqOpenCreateFormFor);
}

async function toggleCqCreateForm(messageId) {
  if (cqOpenCreateFormFor === messageId) { cqOpenCreateFormFor = null; renderCqIncomingList(); return; }
  cqOpenCreateFormFor = messageId;
  const mail = cqIncomingEmails.find(m => m.messageId === messageId);
  cqCreateFormState[messageId] = {
    origin: 'Email', customerEmail: mail?.fromAddress || "",
    projectId: "", customerName: "",
    standardProductNames: [], orderProductDescriptions: [],
    stageName: "", stageOtherText: "",
    customerQueryDate: (mail?.receivedDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    customerQuery: "", concernedDepartments: [], abpsResponsiblePerson: "", targetClosingDate: "",
  };
  await ensureCqProjectData();
  renderCqIncomingList();
}

// "+ Add New Customer Query" — a query that never came through email at
// all. Reuses the exact same form as the email flow (renderCqCreateForm),
// keyed on the literal string 'manual' instead of a messageId — the only
// behavioral difference is Customer Email becomes a required, editable
// field (there's no source email to pull it from) instead of a read-only
// display, enforced both here and server-side (createCustomerQuery).
async function toggleCqManualForm() {
  const zone = document.getElementById("cq-create-form-manual");
  if (cqOpenCreateFormFor === 'manual') {
    cqOpenCreateFormFor = null;
    zone.style.display = "none";
    zone.innerHTML = "";
    return;
  }
  cqOpenCreateFormFor = 'manual';
  cqCreateFormState['manual'] = {
    origin: 'Manual', customerEmail: "",
    projectId: "", customerName: "",
    standardProductNames: [], orderProductDescriptions: [],
    stageName: "", stageOtherText: "",
    customerQueryDate: new Date().toISOString().slice(0, 10),
    customerQuery: "", concernedDepartments: [], abpsResponsiblePerson: "", targetClosingDate: "",
  };
  await ensureCqProjectData();
  zone.style.display = "block";
  renderCqCreateForm('manual');
}

function renderCqCreateForm(messageId) {
  const zone = document.getElementById(`cq-create-form-${messageId}`);
  if (!zone) return;
  const s = cqCreateFormState[messageId];
  const esc = (v) => (v == null ? '' : v.toString()).replace(/"/g, '&quot;');
  const products = cqProductsCache[s.projectId] || [];

  const isManual = s.origin === 'Manual';
  zone.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
      <div style="position:relative;">
        <label class="field-label" style="margin-top:0;">Project ID or Customer Name *</label>
        <input type="text" id="cq-cf-project-${messageId}" autocomplete="off" value="${esc(s.projectId)}"
          oninput="handleCqCreateProjectInput('${messageId}', this.value)"
          style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
        <div id="cq-cf-project-dd-${messageId}" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:220px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
      </div>
      <div>
        <label class="field-label" style="margin-top:0;">Customer Name</label>
        <input type="text" readonly value="${esc(s.customerName)}" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius); background:#f1f5f9;" />
      </div>
    </div>
    <div style="margin-top:12px;">
      <label class="field-label" style="margin-top:0;">Customer Email ${isManual ? '*' : ''}</label>
      <input type="email" ${isManual ? '' : 'readonly'} value="${esc(s.customerEmail)}"
        ${isManual ? `oninput="updateCqCreateField('${messageId}','customerEmail',this.value)"` : ''}
        placeholder="${isManual ? 'Required — used to detect our reply to this customer' : ''}"
        style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius); ${isManual ? '' : 'background:#f1f5f9;'}" />
    </div>

    <div style="margin-top:12px;">
      <label class="field-label" style="margin-top:0;">Standard Product Name * (select one or more)</label>
      <div class="pill-group">
        ${products.length === 0 ? `<span style="font-size:0.78rem; color:var(--muted);">${s.projectId ? 'No Standard Product Names found for this project.' : 'Select a Project first.'}</span>` : products.map(p => `
          <input type="checkbox" id="cq-cf-prod-${messageId}-${p.standardProductName}" name="cq-cf-prod-${messageId}" value="${esc(p.standardProductName)}"
            ${s.standardProductNames.includes(p.standardProductName) ? 'checked' : ''} onchange="updateCqCreateProducts('${messageId}')" />
          <label for="cq-cf-prod-${messageId}-${p.standardProductName}">${p.standardProductName}</label>
        `).join('')}
      </div>
      ${s.orderProductDescriptions.length ? `<div style="font-size:0.78rem; color:var(--muted); margin-top:4px;">Order Product Description: ${s.orderProductDescriptions.join('; ')}</div>` : ''}
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:12px;">
      <div>
        <label class="field-label" style="margin-top:0;">Name of Stage *</label>
        <select id="cq-cf-stage-${messageId}" onchange="updateCqCreateField('${messageId}','stageName',this.value); renderCqIncomingList();" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);">
          <option value="">— Select Stage —</option>
          ${CQ_STAGE_OPTIONS.map(o => `<option value="${o}" ${s.stageName === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
        ${s.stageName === 'Others' ? `<input type="text" placeholder="Describe the stage" value="${esc(s.stageOtherText)}" oninput="updateCqCreateField('${messageId}','stageOtherText',this.value)" style="width:100%; margin-top:6px; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />` : ''}
      </div>
      <div>
        <label class="field-label" style="margin-top:0;">Customer Query Date *</label>
        <input type="date" value="${esc(s.customerQueryDate)}" oninput="updateCqCreateField('${messageId}','customerQueryDate',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
      </div>
    </div>

    <div style="margin-top:12px;">
      <label class="field-label" style="margin-top:0;">Customer Query</label>
      <textarea rows="3" oninput="updateCqCreateField('${messageId}','customerQuery',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);">${esc(s.customerQuery)}</textarea>
    </div>

    <div style="margin-top:12px;">
      <label class="field-label" style="margin-top:0;">Concerned Departments * (select one or more)</label>
      <div class="pill-group">
        ${CQ_DEPARTMENT_OPTIONS.map(d => `
          <input type="checkbox" id="cq-cf-dept-${messageId}-${d}" name="cq-cf-dept-${messageId}" value="${d}" ${s.concernedDepartments.includes(d) ? 'checked' : ''} onchange="updateCqCreateDepartments('${messageId}')" />
          <label for="cq-cf-dept-${messageId}-${d}">${d}</label>
        `).join('')}
      </div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:12px;">
      <div>
        <label class="field-label" style="margin-top:0;">ABPS Responsible Person *</label>
        <input type="text" value="${esc(s.abpsResponsiblePerson)}" oninput="updateCqCreateField('${messageId}','abpsResponsiblePerson',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
      </div>
      <div>
        <label class="field-label" style="margin-top:0;">Target Closing Date Given by Departments *</label>
        <input type="date" value="${esc(s.targetClosingDate)}" oninput="updateCqCreateField('${messageId}','targetClosingDate',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
      </div>
    </div>

    <div style="text-align:right; margin-top:14px;">
      <button class="nav-btn-styled" style="background:var(--accent); padding:9px 22px; font-weight:700;" onclick="submitCqCreateQuery('${messageId}')">Create Query</button>
    </div>
  `;
}

function updateCqCreateField(messageId, key, value) { cqCreateFormState[messageId][key] = value; }

function updateCqCreateDepartments(messageId) {
  cqCreateFormState[messageId].concernedDepartments = Array.from(
    document.querySelectorAll(`input[name="cq-cf-dept-${messageId}"]:checked`)
  ).map(cb => cb.value);
}

function updateCqCreateProducts(messageId) {
  const s = cqCreateFormState[messageId];
  const selected = Array.from(document.querySelectorAll(`input[name="cq-cf-prod-${messageId}"]:checked`)).map(cb => cb.value);
  s.standardProductNames = selected;
  const products = cqProductsCache[s.projectId] || [];
  s.orderProductDescriptions = selected.map(name => {
    const p = products.find(pp => pp.standardProductName === name);
    return p?.description || '';
  }).filter(Boolean);
  renderCqCreateForm(messageId); // re-render to show the auto-filled description line
}

function handleCqCreateProjectInput(messageId, query) {
  const dd = document.getElementById(`cq-cf-project-dd-${messageId}`);
  cqCreateFormState[messageId].projectId = query;
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const matches = cqAllProjectCodes.filter(p => {
    const companyName = (cqProjectMeta[p] && cqProjectMeta[p].companyName) || "";
    return p.toLowerCase().includes(q) || companyName.toLowerCase().includes(q);
  }).slice(0, 10);
  if (matches.length === 0) { dd.innerHTML = `<div style="padding:8px 10px; font-size:0.8rem; color:var(--muted);">No matches.</div>`; dd.style.display = "block"; return; }
  dd.innerHTML = matches.map(p => {
    const companyName = (cqProjectMeta[p] && cqProjectMeta[p].companyName) || "";
    return `<div onmousedown="event.preventDefault();" onclick="selectCqCreateProject('${messageId}', '${p.replace(/'/g, "\\'")}')"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;">${p}</span>${companyName ? ` <span style="color:var(--muted);">— ${companyName}</span>` : ''}
    </div>`;
  }).join("");
  dd.style.display = "block";
}

async function selectCqCreateProject(messageId, projectId) {
  document.getElementById(`cq-cf-project-dd-${messageId}`).style.display = "none";
  const s = cqCreateFormState[messageId];
  s.projectId = projectId;
  s.customerName = (cqProjectMeta[projectId] && cqProjectMeta[projectId].companyName) || "";
  s.standardProductNames = []; s.orderProductDescriptions = [];
  await ensureCqProductsForProject(projectId);
  renderCqIncomingList();
}

async function submitCqCreateQuery(messageId) {
  const s = cqCreateFormState[messageId];
  const bannerId = "cq-feedback";
  const err = validateCqPayloadClientSide(s);
  if (err) {
    showBOQBanner(bannerId, "⚠️ " + err, "error");
    document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  showBlockingOverlay("Creating query...");
  try {
    const isManual = messageId === 'manual';
    const data = await apFetch({
      action: "createCustomerQuery", operatorName: appActiveOperatorIdentityString || "Unknown",
      sourceMessageId: isManual ? undefined : messageId, ...s,
    });
    if (data.success) {
      showBOQBanner(bannerId, "Query created successfully.", "success");
      cqOpenCreateFormFor = null;
      if (isManual) {
        const zone = document.getElementById("cq-create-form-manual");
        zone.style.display = "none"; zone.innerHTML = "";
      }
      await loadCqIncomingEmails();
    } else {
      showBOQBanner(bannerId, "⚠️ " + (data.error || "Failed."), "error");
      document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (e) {
    showBOQBanner(bannerId, "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

function validateCqPayloadClientSide(s) {
  if (s.origin === 'Manual' && !s.customerEmail?.trim()) return "Customer Email is required.";
  if (!s.projectId) return "Project ID is required.";
  if (!s.standardProductNames || s.standardProductNames.length === 0) return "At least one Standard Product Name is required.";
  if (!s.stageName) return "Name of Stage is required.";
  if (s.stageName === 'Others' && !s.stageOtherText?.trim()) return '"Others" requires the stage text to be filled in.';
  if (!s.customerQueryDate) return "Customer Query Date is required.";
  if (!s.concernedDepartments || s.concernedDepartments.length === 0) return "At least one Concerned Department is required.";
  if (!s.abpsResponsiblePerson?.trim()) return "ABPS Responsible Person is required.";
  if (!s.targetClosingDate) return "Target Closing Date Given by Departments is required.";
  return null;
}

async function deleteCqIncomingEmail(messageId) {
  if (!confirm("Delete this incoming email? This cannot be undone.")) return;
  try {
    const data = await apFetch({ action: "deleteIncomingQueryEmail", messageId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (data.success) await loadCqIncomingEmails();
    else showBOQBanner("cq-feedback", "⚠️ " + (data.error || "Failed."), "error");
  } catch (e) {
    showBOQBanner("cq-feedback", "Network error: " + e.message, "error");
  }
}

// ═══════════════════════════════════════════ CURRENT PENDING QUERIES ═══

function selectCqBucket(bucket) {
  cqActiveBucket = bucket;
  document.querySelectorAll('.cq-bucket-btn').forEach(b => {
    b.style.background = b.dataset.bucket === bucket ? "var(--accent)" : "#fff";
    b.style.color = b.dataset.bucket === bucket ? "#fff" : "var(--text)";
  });
  loadCqPendingQueries();
}

async function loadCqPendingQueries() {
  const list = document.getElementById("cq-pending-list");
  list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  cqOpenPendingId = null;
  try {
    const data = await apFetch({ action: "fetchPendingCustomerQueries", bucket: cqActiveBucket || undefined });
    if (!data.success) { list.innerHTML = `<div style="padding:14px; color:#b91c1c;">${data.error || "Failed to load."}</div>`; return; }
    cqPendingQueries = data.queries || [];
    renderCqPendingList();
  } catch (e) {
    list.innerHTML = `<div style="padding:14px; color:#b91c1c;">Network error: ${e.message}</div>`;
  }
}

function renderCqPendingList() {
  const list = document.getElementById("cq-pending-list");
  if (cqPendingQueries.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted); font-size:0.85rem;">No pending queries in this view.</div>`;
    return;
  }
  list.innerHTML = cqPendingQueries.map(q => cqRenderPendingCard(q)).join("");
  if (cqOpenPendingId) renderCqPendingEditForm(cqOpenPendingId);
}

function cqRenderPendingCard(q) {
  const isOpen = cqOpenPendingId === q.queryId;
  return `<div style="border:1px solid var(--border); border-radius:var(--radius); margin-bottom:10px; background:#fff; overflow:hidden;">
    <div style="padding:12px 14px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;" onclick="toggleCqPendingCard(${q.queryId})">
      <div style="font-size:0.82rem;">
        <strong>${q.projectId}</strong> — ${q.customerName || ''} &nbsp;|&nbsp; ${formatDateDMY(q.customerQueryDate)} &nbsp;|&nbsp; ${q.stageName}${q.stageName === 'Others' && q.stageOtherText ? ` (${q.stageOtherText})` : ''}<br>
        <span style="color:var(--muted);">${(q.concernedDepartments || []).join(', ')} — Owner: ${q.abpsResponsiblePerson}</span>
      </div>
      <div style="font-weight:700; color:var(--brand);">Target: ${formatDateDMY(q.targetClosingDate)}</div>
    </div>
    <div id="cq-pending-edit-${q.queryId}" style="${isOpen ? '' : 'display:none;'} padding:14px; border-top:1px solid var(--border);"></div>
  </div>`;
}

function toggleCqPendingCard(queryId) {
  if (cqOpenPendingId === queryId) { cqOpenPendingId = null; renderCqPendingList(); return; }
  const q = cqPendingQueries.find(x => x.queryId === queryId);
  cqPendingEditState[queryId] = {
    standardProductNames: [...(q.standardProductNames || [])],
    orderProductDescriptions: [...(q.orderProductDescriptions || [])],
    stageName: q.stageName, stageOtherText: q.stageOtherText || "",
    customerQueryDate: (q.customerQueryDate || "").slice(0, 10),
    customerQuery: q.customerQuery || "",
    concernedDepartments: [...(q.concernedDepartments || [])],
    abpsResponsiblePerson: q.abpsResponsiblePerson, targetClosingDate: (q.targetClosingDate || "").slice(0, 10),
    actionForQuery: q.actionForQuery || "",
    actualClosingDate: "", reasonForDelay: "", customerInformedConfirmed: false, newTargetClosingDate: "",
  };
  cqOpenPendingId = queryId;
  ensureCqProjectData().then(() => ensureCqProductsForProject(q.projectId)).then(() => renderCqPendingList());
  loadCqCommunicationsForQuery(queryId);
}

function renderCqPendingEditForm(queryId) {
  const zone = document.getElementById(`cq-pending-edit-${queryId}`);
  if (!zone) return;
  const q = cqPendingQueries.find(x => x.queryId === queryId);
  const s = cqPendingEditState[queryId];
  const esc = (v) => (v == null ? '' : v.toString()).replace(/"/g, '&quot;');
  const products = cqProductsCache[q.projectId] || [];

  zone.innerHTML = `
    <div style="margin-bottom:12px;">
      <label class="field-label" style="margin-top:0;">Standard Product Name * (select one or more)</label>
      <div class="pill-group">
        ${products.map(p => `
          <input type="checkbox" id="cq-pe-prod-${queryId}-${p.standardProductName}" name="cq-pe-prod-${queryId}" value="${esc(p.standardProductName)}"
            ${s.standardProductNames.includes(p.standardProductName) ? 'checked' : ''} onchange="updateCqPendingProducts(${queryId}, '${q.projectId}')" />
          <label for="cq-pe-prod-${queryId}-${p.standardProductName}">${p.standardProductName}</label>
        `).join('')}
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:12px;">
      <div>
        <label class="field-label" style="margin-top:0;">Name of Stage *</label>
        <select onchange="updateCqPendingField(${queryId},'stageName',this.value); renderCqPendingList();" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);">
          ${CQ_STAGE_OPTIONS.map(o => `<option value="${o}" ${s.stageName === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
        ${s.stageName === 'Others' ? `<input type="text" value="${esc(s.stageOtherText)}" oninput="updateCqPendingField(${queryId},'stageOtherText',this.value)" style="width:100%; margin-top:6px; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />` : ''}
      </div>
      <div>
        <label class="field-label" style="margin-top:0;">Customer Query Date *</label>
        <input type="date" value="${esc(s.customerQueryDate)}" oninput="updateCqPendingField(${queryId},'customerQueryDate',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
      </div>
    </div>
    <div style="margin-bottom:12px;">
      <label class="field-label" style="margin-top:0;">Customer Query</label>
      <textarea rows="3" oninput="updateCqPendingField(${queryId},'customerQuery',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);">${esc(s.customerQuery)}</textarea>
    </div>
    <div style="margin-bottom:12px;">
      <label class="field-label" style="margin-top:0;">Concerned Departments *</label>
      <div class="pill-group">
        ${CQ_DEPARTMENT_OPTIONS.map(d => `
          <input type="checkbox" id="cq-pe-dept-${queryId}-${d}" name="cq-pe-dept-${queryId}" value="${d}" ${s.concernedDepartments.includes(d) ? 'checked' : ''} onchange="updateCqPendingDepartments(${queryId})" />
          <label for="cq-pe-dept-${queryId}-${d}">${d}</label>
        `).join('')}
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:12px;">
      <div>
        <label class="field-label" style="margin-top:0;">ABPS Responsible Person *</label>
        <input type="text" value="${esc(s.abpsResponsiblePerson)}" oninput="updateCqPendingField(${queryId},'abpsResponsiblePerson',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
      </div>
      <div>
        <label class="field-label" style="margin-top:0;">Target Closing Date Given by Departments</label>
        <input type="text" readonly value="${formatDateDMY(s.targetClosingDate)}" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius); background:#f1f5f9;" />
      </div>
    </div>
    <div style="margin-bottom:12px;">
      <label class="field-label" style="margin-top:0;">Action for the Query *</label>
      <textarea rows="2" placeholder="What was/is being done about this query..." oninput="updateCqPendingField(${queryId},'actionForQuery',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);">${esc(s.actionForQuery)}</textarea>
    </div>
    <div style="text-align:right; margin-bottom:14px;">
      <button class="nav-btn-styled" style="background:#718096; padding:8px 18px; font-size:0.82rem;" onclick="submitCqUpdateQuery(${queryId})">Save Changes</button>
    </div>

    ${q.hasBreach ? `<div style="padding:10px 14px; margin-bottom:14px; background:#fff5f5; border-left:4px solid #b91c1c; border-radius:var(--radius); color:#b91c1c; font-weight:700; font-size:0.82rem;">⚠ This query missed its target closing date with no customer email sent — recorded as a breach.</div>` : ''}

    <div style="background:#f0f9ff; border:1.5px solid #7dd3fc; border-radius:var(--radius); padding:14px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#0369a1;">Customer Communication</div>
        <button class="nav-btn-styled" style="background:var(--brand); padding:5px 12px; font-size:0.75rem;" onclick="checkCqEmailNow(${queryId})">Check for my email now</button>
      </div>
      <div id="cq-comm-list-${queryId}" style="font-size:0.8rem; margin-bottom:12px;">Loading communication history...</div>

      <div style="border-top:1px solid #bae6fd; padding-top:10px; display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
        <div>
          <label class="field-label" style="margin-top:0;">Extend Target Date To</label>
          <input type="date" value="${esc(s.newTargetClosingDate)}" oninput="updateCqPendingField(${queryId},'newTargetClosingDate',this.value)" style="padding:7px; border:1.5px solid var(--border); border-radius:var(--radius);" />
        </div>
        <button class="nav-btn-styled" style="background:#0369a1; padding:8px 16px; font-size:0.8rem;" onclick="submitCqExtendTarget(${queryId})">Extend Target Date</button>
      </div>
      <div style="font-size:0.72rem; color:var(--muted); margin-top:6px;">Requires an Extension email already detected for this query since the target was last set.</div>
    </div>

    <div style="background:#fffbeb; border:1.5px solid #f59e0b; border-radius:var(--radius); padding:14px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#b45309; margin-bottom:10px;">Close Query</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
        <div>
          <label class="field-label" style="margin-top:0;">Actual Closing Date *</label>
          <input type="date" value="${esc(s.actualClosingDate)}" oninput="updateCqPendingField(${queryId},'actualClosingDate',this.value); renderCqPendingList();" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Number of Delay Days</label>
          <input type="text" readonly value="${s.actualClosingDate ? Math.max(0, Math.round((new Date(s.actualClosingDate) - new Date(s.targetClosingDate)) / 86400000)) : ''}" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius); background:#f1f5f9;" />
        </div>
      </div>
      ${s.actualClosingDate && new Date(s.actualClosingDate) > new Date(s.targetClosingDate) ? `
      <div style="margin-top:10px;">
        <label class="field-label" style="margin-top:0;">Reason for Delay *</label>
        <textarea rows="2" oninput="updateCqPendingField(${queryId},'reasonForDelay',this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);">${esc(s.reasonForDelay)}</textarea>
      </div>` : ''}
      <div style="display:flex; justify-content:flex-end; align-items:center; gap:12px; margin-top:12px; flex-wrap:wrap;">
        <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; font-weight:700; ${q.hasResolutionEmail ? 'color:var(--text);' : 'color:var(--muted); cursor:not-allowed;'}">
          <input type="checkbox" ${q.hasResolutionEmail ? '' : 'disabled'} ${s.customerInformedConfirmed ? 'checked' : ''}
            onchange="updateCqPendingField(${queryId},'customerInformedConfirmed',this.checked)" />
          Did we inform the Customer?
        </label>
        <button class="nav-btn-styled" style="background:#15803d; padding:9px 22px; font-weight:700;" onclick="submitCqCloseQuery(${queryId})">Close Query</button>
      </div>
      ${!q.hasResolutionEmail ? `<div style="font-size:0.72rem; color:var(--muted); margin-top:6px; text-align:right;">No Resolution email detected yet for this query — send it, then "Check for my email now" to unlock the checkbox.</div>` : ''}
    </div>
  `;
  renderCqCommunicationsList(queryId);
}

async function loadCqCommunicationsForQuery(queryId) {
  try {
    const data = await apFetch({ action: "fetchCommunicationsForQuery", queryId });
    cqCommunicationsCache[queryId] = data.success ? (data.communications || []) : [];
  } catch (e) {
    cqCommunicationsCache[queryId] = [];
  }
  renderCqCommunicationsList(queryId);
}

function renderCqCommunicationsList(queryId) {
  const el = document.getElementById(`cq-comm-list-${queryId}`);
  if (!el) return;
  const comms = cqCommunicationsCache[queryId];
  if (!comms) { el.textContent = "Loading communication history..."; return; }
  if (comms.length === 0) { el.innerHTML = `<span style="color:var(--muted);">No emails detected for this query yet.</span>`; return; }
  el.innerHTML = comms.map(c => `
    <div style="padding:6px 0; border-bottom:1px solid #e0f2fe;">
      <strong>${c.commType}</strong> — ${c.sentTo || ''} — ${formatDateDMY(c.sentAt)}
      ${c.threadLink ? `<a href="${c.threadLink}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; margin-left:6px;">Open Email ↗</a>` : ''}
      <div style="color:var(--muted); font-size:0.75rem;">${c.subject || ''}${c.aiSummary ? ' — ' + c.aiSummary : ''}</div>
    </div>
  `).join("");
}

async function checkCqEmailNow(queryId) {
  showBlockingOverlay("Checking for your email...");
  try {
    const data = await apFetch({ action: "rescanCustomerQuerySentMailNow", queryId });
    if (!data.success) showBOQBanner("cq-feedback", "⚠️ " + (data.error || "Failed."), "error");
    await loadCqCommunicationsForQuery(queryId);
    await loadCqPendingQueries(); // refresh hasResolutionEmail/hasUnusedExtensionEmail/hasBreach flags
  } catch (e) {
    showBOQBanner("cq-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

async function submitCqExtendTarget(queryId) {
  const s = cqPendingEditState[queryId];
  const bannerId = "cq-feedback";
  if (!s.newTargetClosingDate) {
    showBOQBanner(bannerId, "⚠️ Enter the new target date to extend to.", "error");
    document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  showBlockingOverlay("Extending target date...");
  try {
    const data = await apFetch({
      action: "extendCustomerQueryTarget", queryId, newTargetClosingDate: s.newTargetClosingDate,
      operatorName: appActiveOperatorIdentityString || "Unknown",
    });
    if (data.success) { showBOQBanner(bannerId, "Target Closing Date extended.", "success"); await loadCqPendingQueries(); }
    else { showBOQBanner(bannerId, "⚠️ " + (data.error || "Failed."), "error"); document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" }); }
  } catch (e) {
    showBOQBanner(bannerId, "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

function updateCqPendingField(queryId, key, value) { cqPendingEditState[queryId][key] = value; }
function updateCqPendingDepartments(queryId) {
  cqPendingEditState[queryId].concernedDepartments = Array.from(document.querySelectorAll(`input[name="cq-pe-dept-${queryId}"]:checked`)).map(cb => cb.value);
}
function updateCqPendingProducts(queryId, projectId) {
  const s = cqPendingEditState[queryId];
  const selected = Array.from(document.querySelectorAll(`input[name="cq-pe-prod-${queryId}"]:checked`)).map(cb => cb.value);
  s.standardProductNames = selected;
  const products = cqProductsCache[projectId] || [];
  s.orderProductDescriptions = selected.map(name => (products.find(p => p.standardProductName === name) || {}).description || '').filter(Boolean);
}

async function submitCqUpdateQuery(queryId) {
  const s = cqPendingEditState[queryId];
  const err = validateCqPayloadClientSide({ ...s, projectId: 'x' }); // projectId isn't editable here
  if (err) { showBOQBanner("cq-feedback", "⚠️ " + err, "error"); document.getElementById("cq-feedback").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  try {
    const data = await apFetch({ action: "updateCustomerQuery", queryId, operatorName: appActiveOperatorIdentityString || "Unknown", ...s });
    if (data.success) { showBOQBanner("cq-feedback", "Changes saved.", "success"); await loadCqPendingQueries(); }
    else { showBOQBanner("cq-feedback", "⚠️ " + (data.error || "Failed."), "error"); }
  } catch (e) {
    showBOQBanner("cq-feedback", "Network error: " + e.message, "error");
  }
}

async function submitCqCloseQuery(queryId) {
  const s = cqPendingEditState[queryId];
  const bannerId = "cq-feedback";
  if (!s.actionForQuery?.trim()) {
    showBOQBanner(bannerId, "⚠️ Action for the Query is required.", "error");
    document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!s.actualClosingDate) {
    showBOQBanner(bannerId, "⚠️ Actual Closing Date is required.", "error");
    document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (new Date(s.actualClosingDate) > new Date(s.targetClosingDate) && !s.reasonForDelay?.trim()) {
    showBOQBanner(bannerId, "⚠️ Reason for Delay is required since Actual Closing Date is after the Target Closing Date.", "error");
    document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!s.customerInformedConfirmed) {
    showBOQBanner(bannerId, "⚠️ Confirm \"Did we inform the Customer?\" before closing (requires a detected Resolution email).", "error");
    document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  showBlockingOverlay("Closing query...");
  try {
    const data = await apFetch({
      action: "closeCustomerQuery", queryId, actualClosingDate: s.actualClosingDate,
      reasonForDelay: s.reasonForDelay || null, actionForQuery: s.actionForQuery,
      customerInformedConfirmed: s.customerInformedConfirmed,
      operatorName: appActiveOperatorIdentityString || "Unknown",
    });
    if (data.success) { showBOQBanner(bannerId, "Query closed and moved to Resolved Queries.", "success"); await loadCqPendingQueries(); }
    else { showBOQBanner(bannerId, "⚠️ " + (data.error || "Failed."), "error"); document.getElementById(bannerId).scrollIntoView({ behavior: "smooth", block: "center" }); }
  } catch (e) {
    showBOQBanner(bannerId, "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

// ═══════════════════════════════════════════════ RESOLVED QUERIES ═════

async function searchCqResolvedQueries() {
  const departments = Array.from(document.querySelectorAll('input[name="cq-res-dept"]:checked')).map(cb => cb.value);
  const stages = Array.from(document.querySelectorAll('input[name="cq-res-stage"]:checked')).map(cb => cb.value);
  const payload = {
    action: "searchResolvedCustomerQueries",
    projectIdOrCustomerName: document.getElementById("cq-res-project-input").value.trim() || null,
    concernedDepartments: departments.length ? departments : null,
    actualClosingDateFrom: document.getElementById("cq-res-date-from").value || null,
    actualClosingDateTo: document.getElementById("cq-res-date-to").value || null,
    stageNames: stages.length ? stages : null,
    standardProductName: document.getElementById("cq-res-product-input").value.trim() || null,
  };
  const list = document.getElementById("cq-resolved-list");
  list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Searching...</div>`;
  cqOpenResolvedId = null;
  try {
    const data = await apFetch(payload);
    if (!data.success) { list.innerHTML = `<div style="padding:14px; color:#b91c1c;">${data.error || "Search failed."}</div>`; return; }
    cqResolvedQueries = data.queries || [];
    renderCqResolvedList();
  } catch (e) {
    list.innerHTML = `<div style="padding:14px; color:#b91c1c;">Network error: ${e.message}</div>`;
  }
}

function renderCqResolvedList() {
  const list = document.getElementById("cq-resolved-list");
  if (cqResolvedQueries.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted); font-size:0.85rem;">No resolved queries match this search.</div>`;
    return;
  }
  list.innerHTML = cqResolvedQueries.map(q => {
    const isOpen = cqOpenResolvedId === q.queryId;
    return `<div style="border:1px solid var(--border); border-radius:var(--radius); margin-bottom:10px; background:#fff; overflow:hidden;">
      <div style="padding:12px 14px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;" onclick="toggleCqResolvedCard(${q.queryId})">
        <div style="font-size:0.82rem;">
          <strong>${q.projectId}</strong> — ${q.customerName || ''} &nbsp;|&nbsp; ${q.stageName}<br>
          <span style="color:var(--muted);">${(q.concernedDepartments || []).join(', ')} — Owner: ${q.abpsResponsiblePerson}</span>
        </div>
        <div style="font-weight:700; color:#15803d;">Closed: ${formatDateDMY(q.actualClosingDate)} (${q.delayDays} day(s) delay)</div>
      </div>
      ${isOpen ? cqRenderResolvedDetail(q) : ''}
    </div>`;
  }).join("");
}

function cqRenderResolvedDetail(q) {
  return `<div style="padding:14px; border-top:1px solid var(--border); font-size:0.85rem;">
    <div><strong>Standard Product Name(s):</strong> ${(q.standardProductNames || []).join(', ')}</div>
    <div><strong>Order Product Description(s):</strong> ${(q.orderProductDescriptions || []).join('; ') || '—'}</div>
    <div><strong>Customer Query Date:</strong> ${formatDateDMY(q.customerQueryDate)}</div>
    <div><strong>Customer Query:</strong> ${q.customerQuery || '—'}</div>
    <div><strong>Target Closing Date:</strong> ${formatDateDMY(q.targetClosingDate)}</div>
    <div><strong>Actual Closing Date:</strong> ${formatDateDMY(q.actualClosingDate)}</div>
    <div><strong>Number of Delay Days:</strong> ${q.delayDays}</div>
    <div><strong>Reason for Delay:</strong> ${q.reasonForDelay || '—'}</div>
    <div style="text-align:right; margin-top:12px;">
      <button class="nav-btn-styled" style="background:var(--accent); padding:8px 20px; font-weight:700;" onclick="reopenCqQuery(${q.queryId})">Reopen Query</button>
    </div>
  </div>`;
}

function toggleCqResolvedCard(queryId) {
  cqOpenResolvedId = cqOpenResolvedId === queryId ? null : queryId;
  renderCqResolvedList();
}

async function reopenCqQuery(queryId) {
  if (!confirm("Reopen this query? It will move back to Current Pending Queries.")) return;
  try {
    const data = await apFetch({ action: "reopenCustomerQuery", queryId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (data.success) {
      showBOQBanner("cq-feedback", "Query reopened — see Current Pending Queries.", "success");
      await searchCqResolvedQueries();
    } else {
      showBOQBanner("cq-feedback", "⚠️ " + (data.error || "Failed."), "error");
    }
  } catch (e) {
    showBOQBanner("cq-feedback", "Network error: " + e.message, "error");
  }
}
