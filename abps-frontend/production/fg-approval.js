// ═══════════════════════════════════════════════════════
// ADD TO FINISHED GOODS STORE APPROVAL
// Same expandable-wrapper-card queue convention as BOQ Increase
// Approvals (store/approvals.js) — collapsed header, click to expand,
// detail lazy-loaded on first expand.
// ═══════════════════════════════════════════════════════

async function initializeFGApprovalWorkspace() {
  const feed     = document.getElementById("fg-approval-queue-feed");
  const feedback = document.getElementById("fg-approval-feedback");
  feedback.style.display = "none";
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">
    <div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>
    Loading pending FG approvals...
  </div>`;

  try {
    const data = await apFetch({ action: "fetchPendingFGApprovals" });
    if (!data.success) {
      feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">${data.error}</div>`;
      return;
    }
    if (!data.items || data.items.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <h3 style="color:var(--accent);">No Pending FG Approvals</h3>
      </div>`;
      return;
    }
    feed.innerHTML = "";
    data.items.forEach(item => feed.appendChild(renderFGApprovalCard(item)));
  } catch(e) {
    if (e.message !== "SESSION_EXPIRED") {
      feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Network error: ${e.message}</div>`;
    }
  }
}

function renderFGApprovalCard(item) {
  const card = document.createElement("div");
  card.className = "contact-summary-card-parent";
  card.id = `fg-approval-card-${item.fgId}`;
  card.style.borderLeft = "4px solid #f59e0b";

  card.innerHTML = `
    <div class="contact-summary-header-row" onclick="toggleFGApprovalCardBody(${item.fgId})" style="margin-bottom:0; padding-bottom:8px; cursor:pointer;">
      <div class="contact-summary-title-info" style="width:100%;">
        <div class="meta-row-line-block">
          <strong style="color:var(--brand); font-size:0.9rem;">${item.projectId || "—"}</strong>
          <span style="margin-left:10px;">Dept:</span> <strong style="color:#111827;">${item.department || "—"}</strong>
          <span id="fg-approval-caret-${item.fgId}" style="float:right; font-weight:700; color:var(--muted);">▸</span>
        </div>
        <div class="meta-row-line-block" style="margin-top:8px; font-size:0.85rem;">
          <span>Product:</span> <strong style="color:#111827;">${item.productName || "—"} ${item.productRating || ""}</strong>
          <span style="margin-left:12px;">Created By:</span> <strong style="color:#111827;">${item.qaPerson || "—"}</strong>
        </div>
      </div>
    </div>
    <div id="fg-approval-body-${item.fgId}" style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:8px;"></div>
  `;
  return card;
}

// Document type dropdown for "+ Add Row" — same set the Add to
// Finished Goods Store form itself uploads against (production/finished-
// goods.js's FG_DOC_META), just label-only here since this screen never
// needs the dropzone/filelist ids.
const FG_DOC_TYPE_LABELS = {
  jobCardSheet: "Job Card Sheet",
  packedProductsImages: "Packed Products Images",
  testCert: "Test Certificate",
  inProcessInspection: "In Process Inspection Sheet",
  inspectionClearance: "Inspection Clearance",
  warrantyCard: "Warranty Card",
  otherDocuments: "Other Documents",
};

// Per-fgId working state for the expanded review card — documents already
// on the server (docs) plus any rows added via "+ Add Row" that haven't
// been uploaded yet (newRows, no documentId until the upload succeeds).
// Re-rendered from this on every mutation instead of re-fetching, and
// QA Document Check state lives here too (qaChecked) so rebuilding the
// table for one row's upload doesn't lose every other row's ticked box.
window._fgApprovalState = window._fgApprovalState || {};
window._fgApprovalRowSeq = window._fgApprovalRowSeq || 0;

function formatFGUploadTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value || "";
  return `${get('hour')}:${get('minute')} ${get('day')}-${get('month')}-${get('year')}`;
}

async function toggleFGApprovalCardBody(fgId) {
  const body  = document.getElementById(`fg-approval-body-${fgId}`);
  const caret = document.getElementById(`fg-approval-caret-${fgId}`);
  if (!body) return;
  const isOpen = body.style.display !== "none";
  if (isOpen) {
    body.style.display = "none";
    if (caret) caret.textContent = "▸";
    return;
  }
  body.style.display = "block";
  if (caret) caret.textContent = "▾";
  body.innerHTML = `<div style="text-align:center; padding:16px; color:var(--muted);">Loading documents...</div>`;
  try {
    const data = await apFetch({ action: "fetchFGApprovalDetail", fgId });
    if (!data.success) { body.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }
    window._fgApprovalState[fgId] = {
      fg: data.fg,
      docs: (data.documents || []).map(d => ({ ...d, qaChecked: false })),
      newRows: [],
    };
    body.innerHTML = renderFGApprovalDetailBody(fgId);
  } catch(e) {
    body.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`;
  }
}

function renderFGApprovalDetailBody(fgId) {
  const st = window._fgApprovalState[fgId];
  const fg = st.fg;
  const field = (label, val) => `
    <div>
      <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:3px;">${label}</div>
      <div style="font-size:0.85rem; font-weight:600; color:#111827;">${val || "—"}</div>
    </div>`;

  return `
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:14px; margin-bottom:16px;">
      ${field("Project ID", fg.projectId)}
      ${field("Department", fg.department)}
      ${field("Product Name", fg.productName)}
      ${field("Product Rating", fg.productRating)}
      ${field("Job Card Number *", fg.jobCardNumber)}
      ${field("Unit *", fg.unit)}
      ${field("Product Serial Number *", fg.productSerialNumber)}
    </div>

    ${fg.additionalRemarks ? `
    <div style="margin-bottom:14px;">
      <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:3px;">Additional Remarks</div>
      <div style="font-size:0.85rem; color:#111827; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:8px 10px;">${fg.additionalRemarks}</div>
    </div>` : ""}

    <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); letter-spacing:0.5px; margin-bottom:8px;">FG Documents</div>
    <div id="fg-doc-table-wrap-${fgId}" style="overflow-x:auto; margin-bottom:8px; position:relative;">
      ${renderFGDocTable(fgId)}
    </div>
    <button onclick="addFGDocRow(${fgId})" style="font-size:0.78rem; font-weight:700; padding:6px 14px; background:var(--accent); color:#fff; border:none; border-radius:4px; cursor:pointer; margin-bottom:14px;">+ Add Row</button>

    <div style="display:flex; justify-content:flex-end; gap:10px;">
      <button class="nav-btn-styled" onclick="submitFGApprovalDecision(${fgId}, 'reject')" style="background:#dc2626;">Reject</button>
      <button class="nav-btn-styled" id="fg-approval-submit-${fgId}" disabled onclick="submitFGApprovalDecision(${fgId}, 'approve')"
        style="background:var(--accent); padding:8px 20px; font-weight:700; opacity:0.5; cursor:not-allowed;">
        Approve & Add to FG Store
      </button>
    </div>
  `;
}

function renderFGDocTable(fgId) {
  const st = window._fgApprovalState[fgId];

  const existingRows = st.docs.map(d => `
    <tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px;">${d.docLabel}</td>
      <td style="padding:8px;"><a href="${driveLink(d.url)}" target="_blank" style="color:var(--brand); font-weight:600;">${d.fileName || d.docLabel}</a></td>
      <td style="padding:8px; font-size:0.78rem; color:var(--muted); white-space:nowrap;">${formatFGUploadTime(d.createdAt)}</td>
      <td style="padding:8px; text-align:center;">
        <input type="checkbox" class="fg-approval-doc-check" data-fgid="${fgId}" ${d.qaChecked ? "checked" : ""} style="width:18px; height:18px; cursor:pointer;" onchange="handleFGDocCheckChange(${fgId}, ${d.documentId}, this.checked)" />
      </td>
      <td style="padding:8px; text-align:center; white-space:nowrap;">
        <button onclick="triggerFGReplaceUpload(${fgId}, ${d.documentId})" style="font-size:0.72rem; font-weight:700; padding:5px 10px; background:#fff; color:var(--brand); border:1.5px solid var(--brand); border-radius:4px; cursor:pointer;">Replace</button>
        <button onclick="removeFGDocRow(${fgId}, ${d.documentId})" title="Remove this document" style="margin-left:6px; background:#fef2f2; border:1px solid #fecaca; color:#dc2626; cursor:pointer; font-size:0.85rem; width:26px; height:26px; border-radius:4px; vertical-align:middle;">✕</button>
      </td>
    </tr>`).join("");

  const newRows = st.newRows.map(r => {
    const typeCell = r.docType
      ? `<div style="font-weight:600;">${r.docLabel}</div>`
      : `<div onclick="toggleFGDocTypeDropdown(${fgId}, ${r.tempId}, this)" style="cursor:pointer; padding:6px 8px; border:1.5px solid var(--brand); border-radius:4px; color:var(--muted); font-size:0.82rem; display:flex; justify-content:space-between; align-items:center; gap:6px; background:#fff;">
          <span>— Select Type —</span><span>▾</span>
        </div>`;
    return `
    <tr id="fg-doc-newrow-${r.tempId}" style="border-bottom:1px solid var(--border); background:#fffbeb;">
      <td style="padding:8px;">${typeCell}</td>
      <td style="padding:8px; color:var(--muted);">—</td>
      <td style="padding:8px; color:var(--muted);">—</td>
      <td style="padding:8px; text-align:center; color:var(--muted);">—</td>
      <td style="padding:8px; text-align:center; white-space:nowrap;">
        <button onclick="triggerFGNewRowUpload(${fgId}, ${r.tempId})" ${r.docType ? "" : "disabled"} style="font-size:0.72rem; font-weight:700; padding:5px 10px; background:${r.docType ? "var(--accent)" : "#cbd5e1"}; color:#fff; border:none; border-radius:4px; cursor:${r.docType ? "pointer" : "not-allowed"};">Upload</button>
        <button onclick="removeFGDocRow(${fgId}, null, ${r.tempId})" title="Remove this row" style="margin-left:6px; background:#fef2f2; border:1px solid #fecaca; color:#dc2626; cursor:pointer; font-size:0.85rem; width:26px; height:26px; border-radius:4px; vertical-align:middle;">✕</button>
      </td>
    </tr>`;
  }).join("");

  const rows = existingRows + newRows;

  return `
    <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
      <thead>
        <tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:8px;">Type of Document</th>
          <th style="padding:8px;">Uploaded Document</th>
          <th style="padding:8px;">Uploaded Time</th>
          <th style="padding:8px; text-align:center;">QA Document Check</th>
          <th style="padding:8px; text-align:center;">Action</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5" style="padding:12px; text-align:center; color:var(--muted);">No documents found.</td></tr>`}</tbody>
    </table>`;
}

function refreshFGDocTable(fgId) {
  const wrap = document.getElementById(`fg-doc-table-wrap-${fgId}`);
  if (wrap) wrap.innerHTML = renderFGDocTable(fgId);
  updateFGApprovalSubmitState(fgId);
}

function handleFGDocCheckChange(fgId, documentId, checked) {
  const st = window._fgApprovalState[fgId];
  const doc = st.docs.find(d => d.documentId === documentId);
  if (doc) doc.qaChecked = checked;
  updateFGApprovalSubmitState(fgId);
}

function addFGDocRow(fgId) {
  const st = window._fgApprovalState[fgId];
  st.newRows.push({ tempId: ++window._fgApprovalRowSeq, docType: "", docLabel: "" });
  refreshFGDocTable(fgId);
}

// The doc-type dropdown is a single shared element appended straight to
// <body> with position:fixed, positioned via the trigger's own
// getBoundingClientRect on open — NOT a per-row absolutely-positioned
// child of the table. The table wrapper scrolls (overflow-x:auto, which
// forces overflow-y clipping along with it), so an absolutely-positioned
// dropdown nested inside it gets clipped/squashed against the wrapper's
// own bounds instead of floating freely over the page, same as the
// dropdown pattern already used in store/grn.js for exactly this reason.
let _fgDocTypeDropdownFgId = null;
let _fgDocTypeDropdownTempId = null;

function ensureFGDocTypeDropdownEl() {
  let dd = document.getElementById("fg-doctype-shared-dd");
  if (!dd) {
    dd = document.createElement("div");
    dd.id = "fg-doctype-shared-dd";
    dd.style.cssText = "display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);";
    dd.innerHTML = Object.entries(FG_DOC_TYPE_LABELS).map(([type, label]) => `
      <div onclick="selectFGDocType('${type}')" style="padding:7px 10px; cursor:pointer; font-size:0.82rem; border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${label}</div>
    `).join("");
    document.body.appendChild(dd);
  }
  return dd;
}

function toggleFGDocTypeDropdown(fgId, tempId, triggerEl) {
  const dd = ensureFGDocTypeDropdownEl();
  const alreadyOpenForThisRow = dd.style.display === "block" && _fgDocTypeDropdownTempId === tempId;
  if (alreadyOpenForThisRow) { dd.style.display = "none"; return; }
  const rect = triggerEl.getBoundingClientRect();
  dd.style.top = rect.bottom + "px";
  dd.style.left = rect.left + "px";
  dd.style.width = rect.width + "px";
  dd.style.display = "block";
  _fgDocTypeDropdownFgId = fgId;
  _fgDocTypeDropdownTempId = tempId;
}

function selectFGDocType(docType) {
  const fgId = _fgDocTypeDropdownFgId, tempId = _fgDocTypeDropdownTempId;
  const dd = document.getElementById("fg-doctype-shared-dd");
  if (dd) dd.style.display = "none";
  const st = window._fgApprovalState[fgId];
  const row = st && st.newRows.find(r => r.tempId === tempId);
  if (!row) return;
  row.docType = docType;
  row.docLabel = FG_DOC_TYPE_LABELS[docType] || docType;
  refreshFGDocTable(fgId);
}

// removeFGDocRow — the "✕" next to each row's Action buttons. A
// documentId means a real, already-uploaded row: delete it from Drive
// and the DB, same guard (pending-only) as Replace. A null documentId
// with a tempId means an unuploaded "+ Add Row" row with nothing on the
// server yet — just drop it from local state, no backend call needed.
async function removeFGDocRow(fgId, documentId, tempId) {
  const st = window._fgApprovalState[fgId];
  if (documentId == null) {
    st.newRows = st.newRows.filter(r => r.tempId !== tempId);
    refreshFGDocTable(fgId);
    return;
  }
  if (!confirm("Remove this document? It will be deleted from Drive as well.")) return;
  try {
    const data = await apFetch({
      action: "deleteFinishedGoodsDocument", activeEngineer: appActiveOperatorIdentityString,
      documentId, operatorName: appActiveOperatorIdentityString,
    });
    if (!data.success) { alert(data.error || "Remove failed."); return; }
    st.docs = st.docs.filter(d => d.documentId !== documentId);
    refreshFGDocTable(fgId);
  } catch(e) {
    alert("Network error: " + e.message);
  }
}

// Shared by both upload paths — opens a native file picker via a
// throwaway hidden input, resolves with the chosen File (or null if the
// user cancelled), same one-shot-input pattern used elsewhere in the app.
function pickFGFile() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    input.onchange = () => { resolve(input.files[0] || null); document.body.removeChild(input); };
    document.body.appendChild(input);
    input.click();
  });
}
function fileToBase64(file) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.readAsDataURL(file);
  });
}

async function triggerFGReplaceUpload(fgId, documentId) {
  const file = await pickFGFile();
  if (!file) return;
  const btn = document.querySelector(`#fg-doc-table-wrap-${fgId} button[onclick="triggerFGReplaceUpload(${fgId}, ${documentId})"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Uploading..."; }
  try {
    const base64Data = await fileToBase64(file);
    const data = await apFetch({
      action: "replaceFinishedGoodsDocument", activeEngineer: appActiveOperatorIdentityString,
      documentId, file: { fileName: file.name, base64Data, mimeType: file.type || "application/octet-stream" },
      operatorName: appActiveOperatorIdentityString,
    });
    if (!data.success) { alert(data.error || "Replace failed."); if (btn) { btn.disabled = false; btn.textContent = "Replace"; } return; }
    const st = window._fgApprovalState[fgId];
    const doc = st.docs.find(d => d.documentId === documentId);
    if (doc) { doc.url = data.url; doc.fileName = data.fileName; doc.createdAt = data.createdAt; doc.qaChecked = false; }
    refreshFGDocTable(fgId);
  } catch(e) {
    alert("Network error: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Replace"; }
  }
}

async function triggerFGNewRowUpload(fgId, tempId) {
  const st = window._fgApprovalState[fgId];
  const row = st.newRows.find(r => r.tempId === tempId);
  if (!row || !row.docType) return;
  const file = await pickFGFile();
  if (!file) return;
  const btn = document.querySelector(`#fg-doc-newrow-${tempId} button`);
  if (btn) { btn.disabled = true; btn.textContent = "Uploading..."; }
  try {
    const base64Data = await fileToBase64(file);
    const data = await apFetch({
      action: "addFinishedGoodsDocument", activeEngineer: appActiveOperatorIdentityString,
      fgId, docType: row.docType, docLabel: row.docLabel,
      file: { fileName: file.name, base64Data, mimeType: file.type || "application/octet-stream" },
      operatorName: appActiveOperatorIdentityString,
    });
    if (!data.success) { alert(data.error || "Upload failed."); if (btn) { btn.disabled = false; btn.textContent = "Upload"; } return; }
    st.newRows = st.newRows.filter(r => r.tempId !== tempId);
    st.docs.push({ documentId: data.documentId, docType: row.docType, docLabel: data.docLabel, fileName: data.fileName, url: data.url, createdAt: data.createdAt, qaChecked: false });
    refreshFGDocTable(fgId);
  } catch(e) {
    alert("Network error: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Upload"; }
  }
}

// Every "QA Document Check" checkbox must be ticked, there must be at
// least one document, and no "+ Add Row" row can still be sitting
// unuploaded — before Approve unlocks.
function updateFGApprovalSubmitState(fgId) {
  const btn = document.getElementById(`fg-approval-submit-${fgId}`);
  if (!btn) return;
  const st = window._fgApprovalState[fgId];
  const allChecked = st.docs.length > 0 && st.docs.every(d => d.qaChecked) && st.newRows.length === 0;
  btn.disabled = !allChecked;
  btn.style.opacity = allChecked ? "1" : "0.5";
  btn.style.cursor = allChecked ? "pointer" : "not-allowed";
}

async function submitFGApprovalDecision(fgId, action) {
  const card = document.getElementById(`fg-approval-card-${fgId}`);
  const feedback = document.getElementById("fg-approval-feedback");
  feedback.style.display = "none";

  if (action === "reject" && !confirm(`Reject this Finished Goods submission? The Job Card will need Add to Finished Goods Store redone from scratch.`)) return;

  const fg = window._fgApprovalState[fgId]?.fg || {};

  showBlockingOverlay(action === "approve" ? "Approving..." : "Rejecting...");
  try {
    const actionName = action === "approve" ? "approveFinishedGoodsItem" : "rejectFinishedGoodsItem";
    const data = await apFetch({ action: actionName, activeEngineer: appActiveOperatorIdentityString, fgId, operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (data.success) {
      delete window._fgApprovalState[fgId];
      if (card) card.remove();
      const feed = document.getElementById("fg-approval-queue-feed");
      if (feed && feed.children.length === 0) {
        feed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;">
          <h3 style="color:var(--accent);">No Pending FG Approvals</h3>
        </div>`;
      }

      // Same success-banner-with-details-grid-and-"+ Another" convention
      // as Authorize BOQ — the feed itself just quietly loses the card,
      // this is the persistent confirmation of what actually happened.
      if (action === "approve") {
        feedback.style.cssText = "display:block; padding:16px; margin-bottom:12px; border-left:4px solid #15803d; background:#f0fff4; color:#276749; border-radius:var(--radius);";
        feedback.innerHTML = `
          <div style="font-size:0.85rem; font-weight:800; margin-bottom:10px;">✅ Finished Good Approved & Added to FG Store!</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; font-size:0.8rem; margin-bottom:14px;">
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Job Card Number</span><span style="font-weight:700;">${fg.jobCardNumber || "—"}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Name</span><span style="font-weight:700;">${fg.productName || "—"}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Rating</span><span style="font-weight:700;">${fg.productRating || "—"}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Department</span><span style="font-weight:700;">${fg.department || "—"}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Serial Number</span><span style="font-weight:700;">${fg.productSerialNumber || "—"}</span></div>
          </div>
          <button onclick="document.getElementById('fg-approval-feedback').style.display='none'; initializeFGApprovalWorkspace();"
            style="margin-top:4px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">
            + Approve Another FG Store Product
          </button>`;
        feedback.scrollIntoView({ behavior:"smooth", block:"center" });
      }
    } else {
      feedback.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #dc2626; background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-weight:600;";
      feedback.textContent = data.error || "Failed.";
      feedback.scrollIntoView({ behavior:"smooth", block:"center" });
    }
  } catch(e) {
    hideBlockingOverlay();
    feedback.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #dc2626; background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-weight:600;";
    feedback.textContent = "Network error: " + e.message;
    feedback.scrollIntoView({ behavior:"smooth", block:"center" });
  }
}

document.addEventListener("click", (e) => {
  if (e.target.closest('#fg-doctype-shared-dd') || e.target.closest('[onclick^="toggleFGDocTypeDropdown"]')) return;
  const dd = document.getElementById("fg-doctype-shared-dd");
  if (dd) dd.style.display = "none";
});
