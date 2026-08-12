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
    body.innerHTML = renderFGApprovalDetailBody(data.fg, data.documents || []);
  } catch(e) {
    body.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`;
  }
}

function renderFGApprovalDetailBody(fg, documents) {
  const field = (label, val) => `
    <div>
      <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:3px;">${label}</div>
      <div style="font-size:0.85rem; font-weight:600; color:#111827;">${val || "—"}</div>
    </div>`;

  const docRows = documents.map(d => `
    <tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px;">${d.docLabel}</td>
      <td style="padding:8px;"><a href="${driveLink(d.url)}" target="_blank" style="color:var(--brand); font-weight:600;">${d.fileName || d.docLabel}</a></td>
      <td style="padding:8px; text-align:center;">
        <input type="checkbox" class="fg-approval-doc-check" data-fgid="${fg.fgId}" style="width:18px; height:18px; cursor:pointer;" onchange="updateFGApprovalSubmitState(${fg.fgId})" />
      </td>
    </tr>`).join("");

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

    <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); letter-spacing:0.5px; margin-bottom:8px;">FG Documents</div>
    <div style="overflow-x:auto; margin-bottom:14px;">
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead>
          <tr style="background:var(--highlight-bg); text-align:left;">
            <th style="padding:8px;">Type of Document</th>
            <th style="padding:8px;">Uploaded Document</th>
            <th style="padding:8px; text-align:center;">QA Document Check</th>
          </tr>
        </thead>
        <tbody>${docRows || `<tr><td colspan="3" style="padding:12px; text-align:center; color:var(--muted);">No documents found.</td></tr>`}</tbody>
      </table>
    </div>

    <div id="fg-approval-reject-reason-${fg.fgId}" style="display:none; margin-bottom:12px;">
      <label class="field-label" style="margin-top:0;">Rejection Reason</label>
      <input type="text" id="fg-approval-reject-input-${fg.fgId}" placeholder="Why is this being rejected..." style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
    </div>

    <div style="display:flex; justify-content:flex-end; gap:10px;">
      <button class="nav-btn-styled" onclick="toggleFGRejectReason(${fg.fgId})" style="background:#dc2626;">Reject</button>
      <button class="nav-btn-styled" id="fg-approval-submit-${fg.fgId}" disabled onclick="submitFGApprovalDecision(${fg.fgId}, 'approve')"
        style="background:var(--accent); padding:8px 20px; font-weight:700; opacity:0.5; cursor:not-allowed;">
        Approve & Add to FG Store
      </button>
    </div>
  `;
}

// Every "QA Document Check" checkbox for this card must be ticked (and
// there must be at least one document) before Approve unlocks.
function updateFGApprovalSubmitState(fgId) {
  const btn = document.getElementById(`fg-approval-submit-${fgId}`);
  if (!btn) return;
  const boxes = Array.from(document.querySelectorAll(`.fg-approval-doc-check[data-fgid="${fgId}"]`));
  const allChecked = boxes.length > 0 && boxes.every(b => b.checked);
  btn.disabled = !allChecked;
  btn.style.opacity = allChecked ? "1" : "0.5";
  btn.style.cursor = allChecked ? "pointer" : "not-allowed";
}

function toggleFGRejectReason(fgId) {
  const zone = document.getElementById(`fg-approval-reject-reason-${fgId}`);
  if (!zone) return;
  if (zone.style.display === "none") {
    zone.style.display = "block";
  } else {
    submitFGApprovalDecision(fgId, "reject");
  }
}

async function submitFGApprovalDecision(fgId, action) {
  const card = document.getElementById(`fg-approval-card-${fgId}`);
  const feedback = document.getElementById("fg-approval-feedback");
  feedback.style.display = "none";

  const reason = document.getElementById(`fg-approval-reject-input-${fgId}`)?.value?.trim() || "";
  if (action === "reject" && !reason) {
    feedback.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #dc2626; background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-weight:600;";
    feedback.textContent = "Enter a rejection reason before rejecting.";
    feedback.scrollIntoView({ behavior:"smooth", block:"center" });
    return;
  }
  if (action === "reject" && !confirm(`Reject this Finished Goods submission? The Job Card will need Add to Finished Goods Store redone from scratch.`)) return;

  showBlockingOverlay(action === "approve" ? "Approving..." : "Rejecting...");
  try {
    const actionName = action === "approve" ? "approveFinishedGoodsItem" : "rejectFinishedGoodsItem";
    const data = await apFetch({ action: actionName, activeEngineer: appActiveOperatorIdentityString, fgId, reason, operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (data.success) {
      if (card) card.remove();
      const feed = document.getElementById("fg-approval-queue-feed");
      if (feed && feed.children.length === 0) {
        feed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;">
          <h3 style="color:var(--accent);">No Pending FG Approvals</h3>
        </div>`;
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
