// ═══════════════════════════════════════════════════════════════════════
// qa/qa-inspection-timeline.js — Quality Assurance > QA Inspection Timeline.
//
// The write surface for Stage 5 (Customer Inspection / Inspection
// Clearance Note / Dispatch Clearance) moved out of Project Timeline
// (project/project-timeline.js) so the screen and the write-gating agree
// — this screen's own permission (perm_qa_inspection_timeline) is now the
// only gate, not a department check. Project Timeline still shows the
// same three dates, but read-only now — see PTL_QA_CHAIN there.
//
// A cross-project table (Overdue / Due This Week / Upcoming / Completed),
// each row expandable in place into the full per-project Stage 5 detail
// (Stage 4 lane terminal dates, the projected chain, LD exposure flag,
// the inspection-call record, documents).
//
// Every function/variable here is prefixed qait* to avoid colliding with
// project-timeline.js's ptl* globals or store/qa.js's existing QA-named
// functions (runQARevisionSearch, autoBalanceQaQuantities, etc.) — this
// app is one global scope (CLAUDE.md §1), so any shared name is a fatal
// duplicate-declaration SyntaxError.
// ═══════════════════════════════════════════════════════════════════════

let qaitRows = null;
let qaitExpanded = new Set();
let qaitDetailCache = new Map();
let qaitActiveBucketFilter = "all";

const QAIT_BUCKETS = [
  { key: "overdue", label: "Overdue", color: "#b91c1c", bg: "#fee2e2" },
  { key: "due", label: "Due This Week", color: "#b45309", bg: "#fef3c7" },
  { key: "upcoming", label: "Upcoming", color: "#1d4ed8", bg: "#dbeafe" },
  { key: "completed", label: "Completed", color: "#15803d", bg: "#dcfce7" },
];
const QAIT_MILESTONE_LABELS = {
  customer_inspection: "Customer Inspection",
  inspection_clearance_note: "Inspection Clearance Note",
  dispatch_clearance: "Dispatch Clearance",
};
const QAIT_MILESTONE_CHAIN = ["customer_inspection", "inspection_clearance_note", "dispatch_clearance"];
const QAIT_DOC_TYPES = ["Inspection Clearance Note", "Customer Inspection Report", "Call Letter"];

const qaitIsAdmin = () => localStorage.getItem("isUserAdminGlobal") === "true";

function qaitFmt(s) {
  return s ? formatOrdinalDate(s) : "—";
}

// A confirmed/actual date always renders green (checkmark AND the date
// text together — a green check next to black text read as a mismatch),
// vs. an estimated one (plain text, no mark) — used everywhere a Stage 5
// milestone or lane terminal date shows up (table cells, lane rows).
function qaitDoneDate(s) {
  return `<span style="color:#15803d; font-weight:700;">✓ ${qaitFmt(s)}</span>`;
}

async function initializeQaInspectionTimelinePanel() {
  qaitRows = null;
  qaitExpanded = new Set();
  qaitDetailCache = new Map();
  qaitActiveBucketFilter = "all";
  const fb = document.getElementById("qait-feedback");
  if (fb) fb.style.display = "none";
  qaitRenderFilterBar();
  await qaitLoadQueue();
}

// .dd-period-btn/.dd-period-btn.active is the same toggle style every
// department dashboard's period selector (Today/This Week/.../Custom)
// already uses — reused here instead of a bespoke, differently-colored-
// per-bucket chip design so this screen's filter bar reads the same way
// as everywhere else in the app.
function qaitRenderFilterBar() {
  const bar = document.getElementById("qait-bucket-filter-bar");
  if (!bar) return;
  const counts = { all: qaitRows ? qaitRows.length : 0 };
  QAIT_BUCKETS.forEach(b => { counts[b.key] = qaitRows ? qaitRows.filter(r => r.bucket === b.key).length : 0; });
  const chips = [{ key: "all", label: "All" }, ...QAIT_BUCKETS];
  bar.innerHTML = chips.map(c => {
    const active = qaitActiveBucketFilter === c.key;
    return `<button class="dd-period-btn${active ? ' active' : ''}" onclick="qaitSetBucketFilter('${c.key}')" style="font-size:0.78rem; padding:6px 14px;">${escapeHtml(c.label)} (${counts[c.key] || 0})</button>`;
  }).join("");
}

function qaitSetBucketFilter(key) {
  qaitActiveBucketFilter = key;
  qaitRenderFilterBar();
  qaitRenderTable();
}

async function qaitLoadQueue() {
  const body = document.getElementById("qait-table-body");
  if (body) body.innerHTML = `<tr><td colspan="8" style="padding:16px; text-align:center; color:var(--muted);">Loading…</td></tr>`;
  try {
    const data = await apFetch({ action: "fetchQaInspectionQueue" });
    if (!data.success) { showPurchaseFeedback("qait-feedback", data.error || "Could not load the queue.", "error", true); return; }
    qaitRows = data.rows || [];
    qaitRenderFilterBar();
    qaitRenderSummary();
    qaitRenderTable();
  } catch (e) {
    showPurchaseFeedback("qait-feedback", "Network error: " + e.message, "error", true);
  }
}

function qaitRenderSummary() {
  const strip = document.getElementById("qait-summary-strip");
  if (!strip || !qaitRows) return;
  const overdue = qaitRows.filter(r => r.bucket === "overdue").length;
  const due = qaitRows.filter(r => r.bucket === "due").length;
  strip.innerHTML = overdue || due
    ? `<div style="font-size:0.82rem; font-weight:700; color:${overdue ? '#b91c1c' : '#b45309'};">
        ${overdue ? `⚠️ ${overdue} project${overdue === 1 ? '' : 's'} overdue` : ''}${overdue && due ? ' · ' : ''}${due ? `${due} due this week` : ''}
       </div>`
    : `<div style="font-size:0.82rem; color:var(--muted);">Nothing overdue or due this week.</div>`;
}

function qaitRenderTable() {
  const body = document.getElementById("qait-table-body");
  if (!body || !qaitRows) return;
  const rows = qaitActiveBucketFilter === "all" ? qaitRows : qaitRows.filter(r => r.bucket === qaitActiveBucketFilter);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" style="padding:16px; text-align:center; color:var(--muted);">No projects in this view.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(r => qaitRenderRow(r)).join("");
}

function qaitBucketBadge(bucket) {
  const b = QAIT_BUCKETS.find(x => x.key === bucket);
  if (!b) return "";
  return `<span style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:${b.color}; background:${b.bg}; padding:2px 8px; border-radius:10px;">${escapeHtml(b.label)}</span>`;
}

function qaitRenderRow(r) {
  const expanded = qaitExpanded.has(r.projectId);
  const nextStepLabel = r.nextStep ? QAIT_MILESTONE_LABELS[r.nextStep] : "—";
  const colBorder = "border-left:2px solid var(--border);";
  const centered = "text-align:center;";
  const rowMain = `
    <tr id="qait-row-${r.projectId}" onclick="qaitToggleRow('${r.projectId}')" style="cursor:pointer; border-bottom:2px solid var(--border);">
      <td style="padding:8px 6px; ${centered} font-weight:700; color:var(--brand);">${expanded ? '▾' : '▸'}</td>
      <td style="padding:8px 6px; font-weight:700; ${colBorder}">${escapeHtml(r.projectId)}${r.hasLdExposure ? ' <span title="LD applicable on this project" style="color:#b91c1c;">⚠</span>' : ''}</td>
      <td style="padding:8px 6px; ${colBorder}">${escapeHtml(r.companyName || '')}</td>
      <td style="padding:8px 6px; ${colBorder}">${escapeHtml(nextStepLabel)} ${qaitBucketBadge(r.bucket)}</td>
      <td style="padding:8px 6px; ${centered} ${colBorder} ${r.bucket === 'overdue' ? 'color:#b91c1c; font-weight:700;' : ''}">${r.nextStepDate ? qaitFmt(r.nextStepDate) + (r.daysOverdue ? ` (${r.daysOverdue}d late)` : '') : '—'}</td>
      <td style="padding:8px 6px; ${centered} ${colBorder}">${r.actuals.customer_inspection ? qaitDoneDate(r.actuals.customer_inspection) : (r.chain.inspection ? 'Estimated ' + qaitFmt(r.chain.inspection) : '—')}</td>
      <td style="padding:8px 6px; ${centered} ${colBorder}">${r.actuals.inspection_clearance_note ? qaitDoneDate(r.actuals.inspection_clearance_note) : (r.chain.clearanceNote ? 'Estimated ' + qaitFmt(r.chain.clearanceNote) : '—')}</td>
      <td style="padding:8px 6px; ${centered} ${colBorder}">${r.actuals.dispatch_clearance ? qaitDoneDate(r.actuals.dispatch_clearance) : (r.chain.dispatchClearance ? 'Estimated ' + qaitFmt(r.chain.dispatchClearance) : '—')}</td>
    </tr>`;
  const detailRow = expanded
    ? `<tr id="qait-detail-${r.projectId}"><td colspan="8" style="padding:0;"><div style="padding:14px; background:var(--highlight-bg); border-bottom:2px solid var(--border);">${qaitDetailCache.has(r.projectId) ? qaitRenderDetail(r.projectId, qaitDetailCache.get(r.projectId)) : '<div style="color:var(--muted); font-size:0.82rem;">Loading…</div>'}</div></td></tr>`
    : "";
  return rowMain + detailRow;
}

async function qaitToggleRow(projectId) {
  if (qaitExpanded.has(projectId)) {
    qaitExpanded.delete(projectId);
    qaitRenderTable();
    return;
  }
  qaitExpanded.add(projectId);
  qaitRenderTable();
  if (!qaitDetailCache.has(projectId)) {
    await qaitFetchDetail(projectId);
  }
}

async function qaitFetchDetail(projectId) {
  try {
    const data = await apFetch({ action: "fetchQaInspectionForProject", projectId });
    if (!data.success) {
      qaitDetailCache.set(projectId, { error: data.error || "Could not load this project." });
    } else {
      qaitDetailCache.set(projectId, data);
    }
  } catch (e) {
    qaitDetailCache.set(projectId, { error: "Network error: " + e.message });
  }
  qaitRenderTable();
}

function qaitRenderDetail(projectId, d) {
  if (d.error) return `<div style="color:#b91c1c; font-size:0.82rem;">${escapeHtml(d.error)}</div>`;
  if (d.blocked) return `<div style="color:var(--muted); font-style:italic; font-size:0.82rem;">${escapeHtml(d.blocked)}</div>`;

  const laneRows = (d.laneTerminals || []).length
    ? `<table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
         <thead><tr style="background:var(--highlight-bg);">
           <th style="text-align:left; padding:8px 14px; font-weight:700; color:var(--muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.03em; border-bottom:1px solid var(--border);">Product</th>
           <th style="text-align:right; padding:8px 14px; font-weight:700; color:var(--muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.03em; border-bottom:1px solid var(--border); white-space:nowrap; width:220px;">Packing / Add to FG</th>
         </tr></thead>
         <tbody>${d.laneTerminals.map(l => `
           <tr style="border-bottom:1px solid var(--border);">
             <td style="padding:10px 14px; font-weight:700; vertical-align:top;">${escapeHtml(l.productName || '')}${l.productRating ? ' ' + escapeHtml(l.productRating) : ''}</td>
             <td style="padding:10px 14px; text-align:right; white-space:nowrap; vertical-align:top; ${l.actual ? '' : 'color:var(--muted);'}">${l.actual ? qaitDoneDate(l.actual) : (l.effective ? 'Estimated ' + qaitFmt(l.effective) : 'Not yet scheduled')}</td>
           </tr>`).join("")}</tbody>
       </table>`
    : `<div style="color:var(--muted); font-size:0.78rem; padding:10px 14px;">No in-scope lanes.</div>`;

  const chainRows = QAIT_MILESTONE_CHAIN.map((key, idx) => {
    const actual = d.actuals[key];
    const canWrite = !actual || qaitIsAdmin();
    const chainDate = idx === 0 ? d.chain.inspection : (idx === 1 ? d.chain.clearanceNote : d.chain.dispatchClearance);
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--border);">
        <div style="flex:none; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:${actual ? 'var(--accent)' : '#fff'}; border:2.5px solid ${actual ? 'var(--accent)' : 'var(--muted)'};">
          ${actual ? '<span style="color:#fff; font-weight:900; font-size:0.8rem;">✓</span>' : ''}
        </div>
        <div style="flex:1;">
          <div style="font-weight:700; font-size:0.85rem;">${escapeHtml(QAIT_MILESTONE_LABELS[key])}</div>
          <div style="font-size:0.78rem; ${actual ? 'color:#15803d; font-weight:700;' : 'color:var(--muted);'}">${actual ? qaitFmt(actual) : (chainDate ? `Estimated ${qaitFmt(chainDate)}` : 'Not yet estimable')}</div>
        </div>
        ${canWrite ? `<div style="display:flex; align-items:center; gap:6px;">
          <input type="date" id="qait-date-${projectId}-${key}" value="${actual || ''}" style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem;" />
          <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="qaitSetMilestoneDate('${projectId}', '${key}')">${actual ? 'Update (admin)' : 'Set Date'}</button>
        </div>` : ''}
      </div>`;
  }).join("");

  const call = d.call;
  const callBlock = `
    <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
      <div style="font-weight:700; font-size:0.85rem; margin-bottom:4px;">Inspection Call</div>
      ${call
        ? `<div style="font-size:0.8rem; color:var(--text);">Placed on ${qaitFmt(call.callPlacedOn)}${call.customerContact ? ' · Contact: ' + escapeHtml(call.customerContact) : ''}${call.notes ? '<div style="color:var(--muted); margin-top:2px;">' + escapeHtml(call.notes) + '</div>' : ''}</div>
           ${qaitIsAdmin() ? qaitCallFormHtml(projectId, call) : ''}`
        : qaitCallFormHtml(projectId, null)}
    </div>`;

  const docsBlock = `
    <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
      <div style="font-weight:700; font-size:0.85rem; margin-bottom:6px;">Documents</div>
      ${(d.documents || []).map(doc => `<div style="font-size:0.78rem; padding:2px 0;">
        <a href="#" onclick="event.preventDefault(); driveLink('${doc.fileUrl}');" style="color:var(--brand); font-weight:600;">${escapeHtml(doc.documentType)}</a>
        <span style="color:var(--muted);"> · ${escapeHtml(doc.fileName)} (${qaitFmt(doc.uploadedAt)})</span>
      </div>`).join("") || `<div style="color:var(--muted); font-size:0.78rem; margin-bottom:6px;">No documents uploaded yet.</div>`}
      <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <select id="qait-doc-type-${projectId}" style="padding:6px 8px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem; flex:1 1 240px; min-width:200px;">
          ${QAIT_DOC_TYPES.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
        </select>
        <input type="file" id="qait-doc-file-${projectId}" style="font-size:0.72rem; flex:2 1 320px; min-width:260px;" />
        <button class="nav-btn-styled" style="padding:6px 16px; font-size:0.78rem; flex:none; white-space:nowrap;" onclick="qaitUploadDocument('${projectId}')">Upload</button>
      </div>
    </div>`;

  return `
    <div style="font-weight:700; font-size:0.85rem; margin-bottom:6px;">Stage 4: In-Scope Lanes</div>
    <div style="border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; background:var(--card);">${laneRows}</div>
    <div style="font-weight:700; font-size:0.85rem; margin:10px 0 4px;">Stage 5 Chain</div>
    ${chainRows}
    ${callBlock}
    ${docsBlock}
  `;
}

// shared/format.js's DD/MM/YYYY overlay enhancer wraps every
// <input type="date"> and forces the real input's own width to 100% (so
// its overlay text tracks the input) — a width set directly on a date
// input gets silently overwritten by that enhancer (CLAUDE.md, 4 Sep
// 2026). Fix: wrap the input in its own sizing container instead.
function qaitDateInput(id, value) {
  return `<span style="display:inline-block; flex:none; width:130px;"><input type="date" id="${id}" value="${value || ''}" style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem; width:100%;" /></span>`;
}

function qaitCallFormHtml(projectId, existing) {
  return `<div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
    ${qaitDateInput(`qait-call-date-${projectId}`, existing ? existing.callPlacedOn : '')}
    <input type="text" id="qait-call-contact-${projectId}" placeholder="Customer contact (optional)" value="${existing ? escapeHtml(existing.customerContact || '') : ''}" style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem; flex:1; min-width:220px;" />
    <input type="text" id="qait-call-notes-${projectId}" placeholder="Notes (optional)" value="${existing ? escapeHtml(existing.notes || '') : ''}" style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem; flex:1; min-width:220px;" />
    <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem; flex:none; white-space:nowrap;" onclick="qaitRecordCall('${projectId}')">${existing ? 'Update' : 'Record Call'}</button>
  </div>`;
}

// After any successful write, re-fetch the row's detail rather than
// patching locally — the rest of the Stage 5 chain is a live server-side
// projection off whichever dates are now real (computeQaChainProjection),
// so a local patch would leave every downstream estimate frozen on its
// old value instead of cascading forward (same reasoning
// ptlSetQaMilestoneDate's own comment used to document).
async function qaitSetMilestoneDate(projectId, milestoneKey) {
  const el = document.getElementById(`qait-date-${projectId}-${milestoneKey}`);
  const date = el ? el.value : "";
  if (!date) { alert("Pick a date first."); return; }
  try {
    const data = await apFetch({ action: "saveQaMilestoneDate", operatorName: appActiveOperatorIdentityString, projectId, milestoneKey, date });
    if (!data.success) { alert(data.error || "Could not set this date."); return; }
    qaitDetailCache.delete(projectId);
    await qaitFetchDetail(projectId);
    await qaitLoadQueue();
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

async function qaitRecordCall(projectId) {
  const date = document.getElementById(`qait-call-date-${projectId}`)?.value || "";
  const contact = document.getElementById(`qait-call-contact-${projectId}`)?.value || "";
  const notes = document.getElementById(`qait-call-notes-${projectId}`)?.value || "";
  if (!date) { alert("Pick a call date first."); return; }
  try {
    const data = await apFetch({ action: "recordInspectionCall", operatorName: appActiveOperatorIdentityString, projectId, callPlacedOn: date, customerContact: contact, notes });
    if (!data.success) { alert(data.error || "Could not record this call."); return; }
    qaitDetailCache.delete(projectId);
    await qaitFetchDetail(projectId);
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

async function qaitUploadDocument(projectId) {
  const typeEl = document.getElementById(`qait-doc-type-${projectId}`);
  const fileEl = document.getElementById(`qait-doc-file-${projectId}`);
  const documentType = typeEl ? typeEl.value : "";
  const file = fileEl && fileEl.files && fileEl.files[0];
  if (!file) { alert("Choose a file first."); return; }
  try {
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const data = await apFetch({
      action: "uploadQaInspectionDocument", operatorName: appActiveOperatorIdentityString,
      projectId, documentType,
      file: { fileName: file.name, mimeType: file.type, base64Data },
    });
    if (!data.success) { alert(data.error || "Upload failed."); return; }
    qaitDetailCache.delete(projectId);
    await qaitFetchDetail(projectId);
  } catch (e) {
    alert("Upload error: " + e.message);
  }
}
