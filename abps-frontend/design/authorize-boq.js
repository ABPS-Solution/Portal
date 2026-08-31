async function initializeAuthorizeBOQPanel(mode) {
  eboqMode = mode;
  eboqCurrentDraft = null;
  eboqExpandedCardBoqId = null;

  // Revision-authorize is a fundamentally different data source
  // (boq_update_requests, keyed by updateId) than initial authorize
  // (boq_drafts pending queue), so it has its own dedicated flow.
  if (mode === "authorize-update") {
    await initializeAuthorizeBOQRevisionPanel();
    return;
  }

  const cardsFeedId = "auth-boq-queue-cards-feed";
  const feedbackId  = "auth-boq-feedback";
  const status      = "Pending Authorization";

  // Reset DOM immediately — before any async calls
  const cardsFeed = document.getElementById(cardsFeedId);
  if (!cardsFeed) return;
  cardsFeed.style.display = "";
  cardsFeed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);"><div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>Loading Pending BOQs...</div>`;
  const fbEl = document.getElementById(feedbackId); if (fbEl) { fbEl.style.display = "none"; fbEl.innerHTML = ""; }

  await loadItemCodeCatalogIntoCache().catch(() => {});
  await loadMaterialDescriptionsIntoCache().catch(() => {});

  try {
    const data = await apFetch({ action:"fetchBOQDraftsQueue", status });
    let drafts = data.drafts || []; // already ordered oldest-first by the backend query

    if (drafts.length === 0) {
      cardsFeed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;"><h3 style="color:var(--accent);">No Pending BOQs</h3></div>`;
      return;
    }

    cardsFeed.innerHTML = "";
    drafts.forEach(draft => {
      const card = document.createElement("div");
      card.className = "contact-summary-card-parent";
      card.id = `auth-boq-card-${mode}-${draft.boqId.replace(/[^a-zA-Z0-9]/g, '_')}`;
      card.innerHTML = `
        <div class="contact-summary-header-row" onclick="toggleAuthBOQCardExpansion('${draft.boqId}', '${mode}')" style="cursor:pointer; width:100%; padding-bottom:8px;">
          <div class="contact-summary-title-info" style="width:100%;">
            <div class="meta-row-line-block" style="margin-bottom:6px;">
              <span style="background:#edf2f7;">Customer:</span><strong style="margin-right:15px;">${draft.customerName}</strong>
              <span style="background:#edf2f7;">Project ID:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:700; color:var(--brand); margin-right:15px;">${draft.projectId}</span>
              <span style="background:#edf2f7;">Prepared By:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827;">${draft.preparedBy}</span>
            </div>
            <div class="meta-row-line-block" style="margin-bottom:6px;">
              <span style="background:#e2e8f0;">Product:</span><strong>${draft.productName} ${draft.productRating}</strong>
            </div>
            <div class="meta-row-line-block">
              <span style="background:#edf2f7;">Department:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827; margin-right:15px;">${draft.department}</span>
              <span style="background:#edf2f7;">MFC Qty:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827; margin-right:15px;">${formatQtyTrimmed(draft.orderQuantity)}</span>
              <span style="background:#edf2f7;">Date:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827;">${formatDateDMY(draft.date)}</span>
            </div>
          </div>
        </div>
        <div id="auth-boq-card-body-${mode}-${draft.boqId.replace(/[^a-zA-Z0-9]/g, '_')}" style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;"></div>
      `;
      cardsFeed.appendChild(card);
    });
  } catch(e) {
    cardsFeed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Sync Error: ${e.message}</div>`;
  }
}

// ── Authorize BOQ Revision — its own flow, sourced from
// boq_update_requests (keyed by updateId), NOT the boq_drafts pending
// queue. Each pending request renders a card; expanding shows the
// change summary + the proposed rows in an EDITABLE form (the authorizer
// may tweak before approving); Authorize commits, Reject discards.
let uboqRevList = [];          // cached pending requests from the server
let uboqRevExpandedId = null;  // currently expanded updateId
let uboqRevRows = [];          // editable working copy of the expanded request's rows

async function initializeAuthorizeBOQRevisionPanel() {
  const cardsFeed = document.getElementById("auth-boq-upd-queue-cards-feed");
  const fbEl = document.getElementById("auth-boq-upd-feedback");
  if (fbEl) { fbEl.style.display = "none"; fbEl.innerHTML = ""; }
  if (!cardsFeed) return;
  cardsFeed.style.display = "";
  cardsFeed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);"><div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>Loading pending revisions...</div>`;

  await loadItemCodeCatalogIntoCache().catch(() => {});
  await loadMaterialDescriptionsIntoCache().catch(() => {});
  uboqRevExpandedId = null;
  uboqRevRows = [];

  try {
    const data = await apFetch({ action: "fetchPendingBOQUpdateRequests" });
    uboqRevList = data.requests || [];

    if (uboqRevList.length === 0) {
      cardsFeed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;"><h3 style="color:var(--accent);">No Pending BOQ Revisions</h3></div>`;
      return;
    }

    cardsFeed.innerHTML = "";
    uboqRevList.forEach(reqItem => {
      const card = document.createElement("div");
      card.className = "contact-summary-card-parent";
      card.id = `auth-boqrev-card-${reqItem.updateId}`;
      card.innerHTML = `
        <div class="contact-summary-header-row" onclick="toggleBOQRevisionExpansion(${reqItem.updateId})" style="cursor:pointer; width:100%; padding-bottom:8px;">
          <div class="contact-summary-title-info" style="width:100%;">
            <div class="meta-row-line-block" style="margin-bottom:6px;">
              <span style="background:#edf2f7;">Customer:</span><strong style="margin-right:15px;">${reqItem.customerName || ""}</strong>
              <span style="background:#edf2f7;">Project ID:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:700; color:var(--brand); margin-right:15px;">${reqItem.projectId || ""}</span>
              <span style="background:#edf2f7;">Requested By:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827;">${reqItem.requestedBy || ""}</span>
            </div>
            <div class="meta-row-line-block" style="margin-bottom:6px;">
              <span style="background:#e2e8f0;">Product:</span><strong>${reqItem.productName || ""} ${reqItem.productRating || ""}</strong>
            </div>
            <div class="meta-row-line-block">
              <span style="background:#edf2f7;">Department:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827; margin-right:15px;">${reqItem.department || ""}</span>
              <span style="background:#edf2f7;">MFC Qty:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827; margin-right:15px;">${formatQtyTrimmed(reqItem.newOrderQuantity)}</span>
              <span style="background:#edf2f7;">Date:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827;">${formatDateDMY(reqItem.createdAt)}</span>
            </div>
          </div>
        </div>
        <div id="auth-boqrev-body-${reqItem.updateId}" style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;"></div>
      `;
      cardsFeed.appendChild(card);
    });
  } catch (e) {
    cardsFeed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Sync Error: ${e.message}</div>`;
  }
}

async function authorizeBOQRevision(updateId) {
  const reqItem = uboqRevList.find(r => String(r.updateId) === String(updateId));
  if (!reqItem) return;
  const invalid = uboqRevRows.find(r => !r.materialName || r.quantityFor1Set === "" || r.quantityFor1Set === null || r.quantityFor1Set === undefined);
  if (invalid) { showBOQBanner("auth-boq-upd-feedback", "⚠️ Every row must have a Material Description and Qty/Set.", "error"); return; }
  if (uboqRevRows.length === 0) { showBOQBanner("auth-boq-upd-feedback", "⚠️ At least one material row is required.", "error"); return; }

  const authBtn = document.getElementById(`boqrev-auth-btn-${updateId}`);
  const rejBtn  = document.getElementById(`boqrev-reject-btn-${updateId}`);
  if (authBtn) { authBtn.disabled = true; authBtn.textContent = "Authorizing..."; }
  if (rejBtn) rejBtn.disabled = true;
  showBlockingOverlay("Authorizing Bill of Quantity Revision...");
  // (button labels intentionally stay "Authorizing..."/"Rejecting..." mid-flight, not the full renamed text — keeps the in-progress state visually distinct)

  const revDescInput = document.getElementById(`boqrev-desc-input-${updateId}`);
  const revDescIdField = document.getElementById(`boqrev-description-id-${updateId}`);
  const editedDescriptionOfMaterial = revDescInput ? (revDescInput.value.trim() || null) : undefined;
  const editedDescriptionId = revDescIdField ? (revDescIdField.value.trim() ? parseInt(revDescIdField.value.trim()) : null) : undefined;

  try {
    const data = await apFetch({
      action: "submitBOQUpdateAuthorize",
      updateId,
      editedMaterialRows: uboqRevRows,
      editedOrderQuantity: reqItem.newOrderQuantity,
      authorizedBy: appActiveOperatorIdentityString || "",
      editedDescriptionId, editedDescriptionOfMaterial
    });
    hideBlockingOverlay();
    if (data.success) {
      const cardsFeed = document.getElementById("auth-boq-upd-queue-cards-feed");
      if (cardsFeed) { cardsFeed.style.display = "none"; cardsFeed.innerHTML = ""; }

      // Same grid-card layout as "Authorize Bill of Quantity"'s success
      // message (submitEBOQAuthorize), not the plain one-line banner this
      // used to show.
      const pdfNote = data.pdfUrl
        ? `<div style="font-size:0.78rem; margin-top:6px;">📄 <a href="${driveLink(data.pdfUrl)}" target="_blank" style="color:var(--accent); font-weight:700;">View BOQ PDF</a></div>` : ``;
      const fb = document.getElementById("auth-boq-upd-feedback");
      if (fb) {
        fb.style.borderLeftColor = "var(--accent)";
        fb.style.background      = "#f0fff4";
        fb.style.color           = "#276749";
        fb.style.display         = "block";
        fb.innerHTML = `
          <div style="font-size:0.85rem; font-weight:800; margin-bottom:10px;">✅ Bill of Quantity Revision Authorized Successfully!</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; font-size:0.8rem; margin-bottom:14px;">
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">BOQ ID</span><span style="font-family:monospace; font-weight:800;">${data.boqId || reqItem.boqId}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Project ID</span><span style="font-weight:700;">${reqItem.projectId || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Customer</span><span style="font-weight:700;">${reqItem.customerName || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Name</span><span style="font-weight:700;">${reqItem.productName || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Rating</span><span style="font-weight:700;">${reqItem.productRating || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Order Qty (Sets)</span><span style="font-weight:700;">${formatQtyTrimmed(reqItem.newOrderQuantity)}</span></div>
          </div>
          ${pdfNote}
          <button onclick="document.getElementById('auth-boq-upd-feedback').style.display='none'; initializeAuthorizeBOQRevisionPanel();"
            style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">
            Authorize Another BOQ Revision
          </button>`;
      }
    } else {
      if (authBtn) { authBtn.disabled = false; authBtn.textContent = "Authorize BOQ Revision"; }
      if (rejBtn) rejBtn.disabled = false;
      showBOQBanner("auth-boq-upd-feedback", data.error || "Authorization failed.", "error");
    }
  } catch (e) {
    hideBlockingOverlay();
    if (authBtn) { authBtn.disabled = false; authBtn.textContent = "Authorize BOQ Revision"; }
    if (rejBtn) rejBtn.disabled = false;
    showBOQBanner("auth-boq-upd-feedback", "Network error: " + e.message, "error");
  }
}

async function rejectBOQRevision(updateId) {
  const reqItem = uboqRevList.find(r => String(r.updateId) === String(updateId));
  if (!reqItem) return;
  if (!confirm(`Reject this revision request for ${reqItem.boqId}? The BOQ stays at its current authorized version.`)) return;

  const authBtn = document.getElementById(`boqrev-auth-btn-${updateId}`);
  const rejBtn  = document.getElementById(`boqrev-reject-btn-${updateId}`);
  if (rejBtn) { rejBtn.disabled = true; rejBtn.textContent = "Rejecting..."; }
  if (authBtn) authBtn.disabled = true;

  try {
    const data = await apFetch({ action: "submitBOQUpdateReject", updateId });
    if (data.success) {
      showBOQBanner("auth-boq-upd-feedback", `Revision request for ${reqItem.boqId} was rejected.`, "success");
      await initializeAuthorizeBOQRevisionPanel();
    } else {
      if (rejBtn) { rejBtn.disabled = false; rejBtn.textContent = "Reject BOQ Revision"; }
      if (authBtn) authBtn.disabled = false;
      showBOQBanner("auth-boq-upd-feedback", data.error || "Rejection failed.", "error");
    }
  } catch (e) {
    if (rejBtn) { rejBtn.disabled = false; rejBtn.textContent = "Reject Revision"; }
    if (authBtn) authBtn.disabled = false;
    showBOQBanner("auth-boq-upd-feedback", "Network error: " + e.message, "error");
  }
}

async function rejectBOQDraft(boqId) {
  if (!confirm(`Reject BOQ ${boqId}? This fully undoes it -- as if it was never made. The product/material will become selectable again on Create BOQ.`)) return;

  const rejBtn    = document.getElementById("eboq-reject-btn");
  const submitBtn = document.getElementById("eboq-submit-btn");
  if (rejBtn) { rejBtn.disabled = true; rejBtn.textContent = "Rejecting..."; }
  if (submitBtn) submitBtn.disabled = true;

  try {
    const data = await apFetch({ action: "submitBOQReject", boqId, rejectedBy: appActiveOperatorIdentityString || "" });
    if (data.success) {
      showBOQBanner("auth-boq-feedback", `BOQ ${boqId} was rejected.`, "success");
      await initializeAuthorizeBOQPanel("authorize");
    } else {
      if (rejBtn) { rejBtn.disabled = false; rejBtn.textContent = "Reject BOQ"; }
      if (submitBtn) submitBtn.disabled = false;
      showBOQBanner("auth-boq-feedback", data.error || "Rejection failed.", "error");
    }
  } catch (e) {
    if (rejBtn) { rejBtn.disabled = false; rejBtn.textContent = "Reject BOQ"; }
    if (submitBtn) submitBtn.disabled = false;
    showBOQBanner("auth-boq-feedback", "Network error: " + e.message, "error");
  }
}

function renderEBOQForm(containerId) {
  const draft = eboqCurrentDraft;
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:16px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">BOQ Header</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">BOQ ID (auto)</label>
          <textarea id="eboq-boq-id" readonly rows="1" style="padding:8px; font-family:monospace; font-weight:800; background:#e0f2fe; color:var(--brand); cursor:not-allowed; border-radius:var(--radius); width:100%; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; box-sizing:border-box; border:1px solid var(--border); font-size:inherit;">${draft.boqId}</textarea>
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Prepared By (locked)</label>
          <input type="text" value="${draft.preparedBy}" readonly style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius);" />
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">Project ID (locked)</label>
          <textarea readonly rows="1" style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius); width:100%; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; box-sizing:border-box; border:1px solid var(--border); font-size:inherit;">${(draft.projectId || '').toString().replace(/</g, '&lt;')}</textarea>
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Customer Name (locked)</label>
          <textarea readonly rows="1" style="padding:8px; background:#f1f5f9; color:var(--text); font-weight:600; cursor:not-allowed; border-radius:var(--radius); width:100%; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; box-sizing:border-box; border:1px solid var(--border); font-size:1rem;">${(draft.customerName || '').toString().replace(/</g, '&lt;')}</textarea>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">${eboqMode === "authorize-update" ? "Product Name (locked)" : "Product Name *"}</label>
          ${eboqMode === "authorize-update" ? `
          <textarea readonly rows="1" style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius); width:100%; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; box-sizing:border-box; border:1px solid var(--border); font-size:inherit;">${(draft.productName || '').toString().replace(/</g, '&lt;')}</textarea>
          ` : `
          <div style="position:relative;">
            <textarea id="eboq-product-search" rows="1" readonly placeholder="Loading..." autocomplete="off"
              onclick="showEBOQProductDropdown()"
              style="padding:8px; font-weight:600; border:1.5px solid var(--border); border-radius:var(--radius); width:100%; box-sizing:border-box; cursor:pointer; background:#fff; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; font-family:inherit; font-size:inherit; min-height:38px;"></textarea>
            <div id="eboq-product-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:240px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
          </div>
          <input type="hidden" id="eboq-product-name" value="${draft.productName}" />
          <input type="hidden" id="eboq-source-po-line-id" value="${draft.sourcePoLineId || ""}" />
          `}
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">${eboqMode === "authorize-update" ? "Product Rating (locked)" : "Product Rating"}</label>
          <textarea id="eboq-product-rating" readonly rows="1"
            style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius); width:100%; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; box-sizing:border-box; border:1px solid var(--border); font-size:inherit;"
            placeholder="${eboqMode === "authorize-update" ? "" : "Auto-filled from Product Name"}">${(draft.productRating || '').toString().replace(/</g, '&lt;')}</textarea>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px;">
        <div style="position:relative;">
          <label class="field-label" style="margin-top:0;">Description of Material (optional)</label>
          <textarea id="eboq-desc-input" rows="1" placeholder="Type to search or create a description..." autocomplete="off"
            oninput="handleMaterialDescriptionTypeaheadInput(this.value, 'eboq-desc-input', 'eboq-desc-dropdown', 'eboq-description-id'); autoGrowTextField(this);"
            onkeydown="if(event.key==='Enter') event.preventDefault();"
            style="padding:8px; font-weight:600; border:1.5px solid var(--border); border-radius:var(--radius); width:100%; box-sizing:border-box; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; font-family:inherit; font-size:inherit; min-height:34px;">${(draft.descriptionOfMaterial || '').toString().replace(/</g, '&lt;')}</textarea>
          <div id="eboq-desc-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:200px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
          <input type="hidden" id="eboq-description-id" value="${draft.descriptionId || ''}" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Make</label>
          <input type="text" id="eboq-header-make" readonly value="" style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius); width:100%; box-sizing:border-box;" placeholder="Auto-filled from Product Name" />
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">Current Manufacturing Clearance Quantity (No. of Sets) *</label>
          <input type="number" id="eboq-order-qty" value="${formatQtyTrimmed(draft.orderQuantity)}" min="1" readonly oninput="updateEBOQTotals()" style="padding:8px; background:#f1f5f9; color:var(--text); font-weight:600; cursor:not-allowed; border-radius:var(--radius);" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Date</label>
          <input type="text" value="${formatDateDMY(draft.date)}" readonly style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius);" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Department ${eboqMode === "authorize-update" ? "(locked)" : "*"}</label>
          ${eboqMode === "authorize-update"
            ? `<input type="text" id="eboq-department" value="${draft.department}" readonly style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius);" />`
            : `<select id="eboq-department" style="padding:8px; font-weight:600; border:1.5px solid var(--border); border-radius:var(--radius);">
                <option value="Reactor" ${draft.department==="Reactor"?"selected":""}>Reactor</option>
                <option value="Capacitor" ${draft.department==="Capacitor"?"selected":""}>Capacitor</option>
                <option value="Panel" ${draft.department==="Panel"?"selected":""}>Panel</option>
              </select>`
          }
        </div>
      </div>
    </div>

    <!-- Material Rows -->
    <div style="margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand);">Material Rows *</span>
        <button class="nav-btn-styled" onclick="addEBOQMaterialRow()" style="background:var(--accent); padding:5px 14px; font-size:0.78rem;">+ Add Row</button>
      </div>
      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
        <table class="store-basket-data-table" style="width:100%; min-width:1050px; border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="width:40px; text-align:center; padding:8px; font-size:0.7rem;">Sr No</th>
              <th style="width:110px; padding:8px; font-size:0.7rem;">Type of Store *</th>
              <th style="width:350px; padding:8px; font-size:0.7rem;">Material Name *</th>
              <th style="width:80px; padding:8px; font-size:0.7rem;">Item Code</th>
              <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Qty / Set *</th>
              <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Unit *</th>
              <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Design Rate / Qty</th>
              <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Total Material Cost / Set</th>
              <th style="width:40px; padding:8px; font-size:0.7rem; text-align:center;">Del</th>
            </tr>
          </thead>
          <tbody id="eboq-material-rows-body"></tbody>
        </table>
      </div>
    </div>

    <div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:var(--radius); padding:14px; margin-bottom:16px; display:flex; justify-content:flex-end; gap:32px;">
      <div style="text-align:right;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:var(--muted);">Total BOQ Cost Per Set</div>
        <div id="eboq-total-per-set" style="font-size:1.1rem; font-weight:800; color:var(--accent);">₹0.00</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:var(--muted);">Total BOQ Cost</div>
        <div id="eboq-total-cost" style="font-size:1.1rem; font-weight:800; color:var(--accent);">₹0.00</div>
      </div>
    </div>

    <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border); padding-top:14px;">
      ${eboqMode === "authorize" ? `
      <button class="nav-btn-styled" onclick="rejectBOQDraft('${draft.boqId}')" style="background:#dc2626; padding:8px 24px; font-weight:700;" id="eboq-reject-btn">
        Reject BOQ
      </button>
      ` : ``}
      <button class="nav-btn-styled" onclick="submitEBOQAuthorize()" style="background:var(--accent); padding:8px 24px; font-weight:700;" id="eboq-submit-btn">
        ${eboqMode === "authorize" ? "Authorize BOQ" : "Authorize BOQ Revision"}
      </button>
    </div>
  `;

  container.querySelectorAll('textarea').forEach(autoGrowPoField);

  renderEBOQMaterialRows();

  if (eboqMode === "authorize") {
    const authByEl = document.getElementById("eboq-authorized-by");
    if (authByEl) {
      authByEl.innerHTML = '<option value="">Loading...</option>';
      const allPersonnel = window.cboqAllPersonnel || [];
      if (allPersonnel.length > 0) {
        authByEl.innerHTML = '<option value="">— Select Authorized By —</option>';
        allPersonnel.filter(p => p.departmentsList.some(d => d.toLowerCase().includes("design")))
          .forEach(p => { const o = document.createElement("option"); o.value = p.fullName; o.textContent = p.fullName; authByEl.appendChild(o); });
      } else {
        apFetch({ action: "getStoreOperatorsList" }).then(data => {
          window.cboqAllPersonnel = data.fullPersonnelDataRecordsTree || [];
          authByEl.innerHTML = '<option value="">— Select Authorized By —</option>';
          window.cboqAllPersonnel.filter(p => p.departmentsList.some(d => d.toLowerCase().includes("design")))
            .forEach(p => { const o = document.createElement("option"); o.value = p.fullName; o.textContent = p.fullName; authByEl.appendChild(o); });
        }).catch(() => { authByEl.innerHTML = '<option value="">Error loading personnel</option>'; });
      }
    }
    loadEBOQAllowedProducts(draft);
  }
}

// loadEBOQAllowedProducts — same gating as Create BOQ's dropdown, plus the
// draft's own current product folded in (even if it wouldn't otherwise be
// offered) so an untouched draft always has a valid selection.
async function loadEBOQAllowedProducts(draft) {
  const search = document.getElementById("eboq-product-search");
  if (!search) return;
  search.value = ""; search.placeholder = "Loading...";
  try {
    const data = await apFetch({ action: "fetchAllowedBoqProducts", projectId: draft.projectId });
    let options = (data.success && data.options) ? [...data.options] : [];
    window.eboqAllowedOptionsByValue = {};

    // Fold the draft's own current product in, even if it wouldn't
    // otherwise be offered, so an untouched draft always has a valid
    // selection — matched by product_item_code (set at createBOQDraft
    // time) rather than a name+rating lookup into the catalog, which
    // breaks once two Description of Material variants can share one
    // name+rating.
    if (draft.productItemCode && !options.some(o => o.itemCode === draft.productItemCode && (o.descriptionId || null) === (draft.descriptionId || null))) {
      const catalogEntry = (window.itemCodeCatalogCache || []).find(c => c.itemCode === draft.productItemCode);
      options.push({
        itemCode: draft.productItemCode, descriptionId: draft.descriptionId || null,
        productName: draft.productName, productRating: draft.productRating,
        descriptionOfMaterial: draft.descriptionOfMaterial || null, make: catalogEntry ? catalogEntry.make : null,
        displayLabel: `${draft.productName}${draft.productRating ? " - " + draft.productRating : ""}${draft.descriptionOfMaterial ? " - " + draft.descriptionOfMaterial : ""}${catalogEntry && catalogEntry.make ? " - Make: " + catalogEntry.make : ""}`,
        lockedQuantity: draft.orderQuantity, sourcePoLineId: draft.sourcePoLineId || null,
      });
    }

    // Keyed by itemCode + descriptionId — see the same fix in create-boq.js.
    options.forEach(opt => { window.eboqAllowedOptionsByValue[opt.itemCode + '|' + (opt.descriptionId || '')] = opt; });
    window.eboqAllowedOptionsList = options;
    search.placeholder = options.length ? "— Select Product —" : "— No Products Available —";

    if (options.length > 0) {
      const selectedOpt = options.find(o => o.itemCode === draft.productItemCode && (o.descriptionId || null) === (draft.descriptionId || null)) || options[0];
      search.value = selectedOpt.displayLabel || selectedOpt.productName;
      autoGrowPoField(search);
      handleEBOQProductSelectChange(selectedOpt.itemCode + '|' + (selectedOpt.descriptionId || ''), true);
    }
  } catch(e) {
    search.placeholder = "Network error";
  }
}

// showEBOQProductDropdown / selectEBOQProductOption — same pattern as
// Create BOQ's showCBOQProductDropdown/selectCBOQProductOption: a locked
// list (not free text), textarea just triggers the floating option list so
// a long selected label wraps and grows the box instead of clipping the
// way the old native <select> always did.
function showEBOQProductDropdown() {
  const dropdown = document.getElementById("eboq-product-dropdown");
  if (!dropdown) return;
  const options = window.eboqAllowedOptionsList || [];
  if (options.length === 0) { dropdown.style.display = "none"; return; }

  dropdown.innerHTML = options.map(opt => `
    <div onmousedown="event.preventDefault();" onclick="selectEBOQProductOption('${opt.itemCode}', '${(opt.descriptionId || '')}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${opt.displayLabel || opt.productName}
    </div>`).join("");
  dropdown.style.display = "block";
}

document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("eboq-product-dropdown");
  if (dropdown && dropdown.style.display !== "none" &&
      !e.target.closest("#eboq-product-search") && !e.target.closest("#eboq-product-dropdown")) {
    dropdown.style.display = "none";
  }
});

function selectEBOQProductOption(itemCode, descriptionId) {
  const compositeKey = itemCode + '|' + (descriptionId || '');
  const opt = (window.eboqAllowedOptionsByValue || {})[compositeKey];
  const dropdown = document.getElementById("eboq-product-dropdown");
  if (dropdown) dropdown.style.display = "none";
  if (!opt) return;

  const search = document.getElementById("eboq-product-search");
  if (search) { search.value = opt.displayLabel || opt.productName; autoGrowPoField(search); }
  handleEBOQProductSelectChange(compositeKey);
}

// compositeKey is "<itemCode>|<descriptionId-or-empty>", matching the
// keying fix above. skipBoqIdPreview is true only when this is called from
// the initial render (loadEBOQAllowedProducts), where the BOQ ID is already
// correct and shouldn't be recomputed from a "change" that didn't actually
// happen.
function handleEBOQProductSelectChange(compositeKey, skipBoqIdPreview) {
  const opt = (window.eboqAllowedOptionsByValue || {})[compositeKey];
  if (!opt) return;
  document.getElementById("eboq-product-name").value = opt.productName;
  document.getElementById("eboq-source-po-line-id").value = opt.sourcePoLineId || "";
  const ratingEl = document.getElementById("eboq-product-rating");
  if (ratingEl) { ratingEl.value = opt.productRating || ""; autoGrowPoField(ratingEl); }
  const qtyEl = document.getElementById("eboq-order-qty");
  if (qtyEl) { qtyEl.value = trimNum(opt.lockedQuantity); updateEBOQTotals(); }
  const descInput = document.getElementById("eboq-desc-input");
  const descIdField = document.getElementById("eboq-description-id");
  const makeField = document.getElementById("eboq-header-make");
  if (descInput) { descInput.value = opt.descriptionOfMaterial || ""; autoGrowTextField(descInput); }
  if (descIdField) descIdField.value = opt.descriptionId || "";
  if (makeField) makeField.value = opt.make || "";
  if (!skipBoqIdPreview) recomputeEBOQBoqId(opt.productName, opt.productRating || "");
}

// updateEBOQId() removed -- the BOQ ID is generated once at creation
// time and never changes; this used to overwrite the correct displayed
// ID with a bogus client-side recomputation ("BOQ-<projectId>-<garbled>")
// the moment someone touched Product Name/Rating, which is exactly the
// wrong-ID-shown bug that got reported. Product Name/Rating are now a
// locked dropdown (see loadEBOQAllowedProducts/handleEBOQProductSelectChange
// above) rather than free text, so there's nothing left that needs to
// recompute a preview here at all beyond a selection change.

// BOQ ID format (set server-side by generateBOQId) is:
// BOQ_<FYLabel>_<MonthAbbr>_<Company>_<PO>_<Product>_<Rating>
// with underscores used ONLY as the 7-way segment separator (never
// inside a segment itself). So the first 5 segments — BOQ, FY, Month,
// Company, PO — are a stable prefix that survives a product change;
// only the trailing Product/Rating segments need swapping when the
// user edits Product Name/Rating on the Authorize screen. This is a
// LIVE PREVIEW only — the backend recomputes the same way and is the
// actual source of truth for what gets saved.
function recomputeEBOQBoqId(productName, rating) {
  const boqIdBox = document.getElementById('eboq-boq-id');
  if (!boqIdBox || !eboqCurrentDraft?.boqId) return;
  // Strip any trailing "_<n>" variant suffix BEFORE the segment split, so
  // it survives this preview rebuild instead of being silently dropped —
  // same fix as the server-side parseBOQIdVariantSuffix (routes/design.js).
  const suffixMatch = /^(.*)_(\d+)$/.exec(eboqCurrentDraft.boqId);
  const base = suffixMatch ? suffixMatch[1] : eboqCurrentDraft.boqId;
  const variantSuffix = suffixMatch && Number(suffixMatch[2]) > 1 ? `_${suffixMatch[2]}` : '';
  const parts = base.split('_');
  if (parts.length < 7) return; // unexpected format — leave the original ID untouched rather than risk mangling it
  const prefix = parts.slice(0, 5).join('_');
  const cleanSeg = (s) => (s || '').toString().trim().replace(/\s+/g, ' ');
  const newBoqId = `${prefix}_${cleanSeg(productName)}_${cleanSeg(rating)}${variantSuffix}`;
  boqIdBox.value = newBoqId;
  boqIdBox.style.height = 'auto'; boqIdBox.style.height = boqIdBox.scrollHeight + 'px';
}

function addEBOQMaterialRow() {
  eboqMaterialRows.push({ typeOfStore:"Raw Materials Store", materialName:"", itemCode:"", make:"", quantityFor1Set:"", unit:"", designRatePerQuantity:"" });
  renderEBOQMaterialRows();
}

function deleteEBOQMaterialRow(idx) {
  eboqMaterialRows.splice(idx, 1);
  renderEBOQMaterialRows();
}

function renderEBOQMaterialRows() {
  const tbody = document.getElementById("eboq-material-rows-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (eboqMaterialRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--muted); font-size:0.82rem;">No material rows. Click "+ Add Row".</td></tr>';
    updateEBOQTotals();
    return;
  }
  eboqMaterialRows.forEach((row, idx) => {
    const isRawMaterial = row.typeOfStore !== "Spare Store";
    const isFgRow = row.typeOfStore === "Finished Goods Store";
    const totalMaterialRate = isRawMaterial ? ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0)) : 0;
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #f1f5f9";
    tr.innerHTML = `
      <td style="text-align:center; padding:6px; font-weight:700; color:var(--muted);">${idx + 1}</td>
      <td style="padding:4px;">
        <select onchange="eboqMaterialRows[${idx}].typeOfStore=this.value; renderEBOQMaterialRows();" style="padding:4px; font-size:0.8rem; width:100%;">
          <option value="Raw Materials Store" ${row.typeOfStore==="Raw Materials Store"?"selected":""}>Raw Material</option>
          <option value="Finished Goods Store" ${row.typeOfStore==="Finished Goods Store"?"selected":""}>Finished Goods</option>
        </select>
      </td>
      <td style="padding:4px; position:relative;">
        <textarea rows="1" placeholder="Type to search..." autocomplete="off"
          oninput="handleBOQRowMaterialSearch(this.value, ${idx}, 'eboq'); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
          onfocus="handleBOQRowMaterialSearch(this.value, ${idx}, 'eboq'); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
          style="padding:5px; font-size:0.82rem; width:100%; border:1px solid var(--border); border-radius:3px; resize:none; overflow:hidden; font-family:inherit; line-height:1.3; display:block;"
        >${boqRowMaterialDisplayText(row)}</textarea>
        <div id="eboq-mat-dropdown-${idx}" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:6px; overflow-y:auto; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.18); min-width:320px;"></div>
      </td>
      <td style="padding:4px;">
        <input type="text" value="${row.itemCode || ""}" readonly 
          style="padding:5px; font-size:0.78rem; font-family:monospace; font-weight:700; background:#e0f2fe; color:var(--brand); cursor:not-allowed; border-radius:3px; border:1px solid #bae6fd; width:100%;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="number" value="${row.quantityFor1Set || ""}" min="0" placeholder="0"
          oninput="eboqMaterialRows[${idx}].quantityFor1Set=parseFloat(this.value)||0; updateEBOQTotals(); const r=document.getElementById('eboq-rate-${idx}'); if(r) { const v=eboqMaterialRows[${idx}].quantityFor1Set*(Number(eboqMaterialRows[${idx}].designRatePerQuantity)||0); r.value=v.toLocaleString('en-IN',{maximumFractionDigits:2}); }"
          style="padding:5px; font-size:0.85rem; text-align:center; width:100%; border:1px solid var(--border); border-radius:3px;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="text" value="${row.unit || "—"}" readonly
          style="padding:4px; font-size:0.8rem; width:100%; background:#f1f5f9; color:var(--text); font-weight:600; cursor:not-allowed; text-align:center; border-radius:3px; border:1px solid var(--border);" />
      </td>
      <td style="padding:4px; text-align:center;">
        ${isRawMaterial ? `
        <input type="number" class="boq-center-num" value="${row.designRatePerQuantity || ""}" min="0" step="0.01" placeholder="0.00"
          oninput="eboqMaterialRows[${idx}].designRatePerQuantity=parseFloat(this.value)||0; updateEBOQTotals(); const r=document.getElementById('eboq-rate-${idx}'); if(r) { const v=(Number(eboqMaterialRows[${idx}].quantityFor1Set)||0)*(parseFloat(this.value)||0); r.value=v.toLocaleString('en-IN',{maximumFractionDigits:2}); }"
          ${isFgRow ? `title="Provisional — replaced automatically when this Finished Goods material's own BOQ is authorized" style="padding:5px; font-size:0.85rem; width:100%; border:1.5px solid #f59e0b; background:#fffbeb; border-radius:3px;"` : `style="padding:5px; font-size:0.85rem; width:100%; border:1px solid var(--border); border-radius:3px;"`} />
        ` : `<input type="text" class="boq-center-num" value="—" readonly style="padding:5px; font-size:0.85rem; width:100%; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:3px; border:1px solid var(--border);" />`}
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="text" id="eboq-rate-${idx}" value="${isRawMaterial ? totalMaterialRate.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}" readonly
          style="padding:5px; font-size:0.85rem; font-weight:700; text-align:center; width:100%; background:#f0fdf4; color:var(--accent); cursor:not-allowed; border-radius:3px; border:1px solid #86efac;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <button onclick="deleteEBOQMaterialRow(${idx})" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:3px 8px; border-radius:3px; cursor:pointer; font-size:0.75rem; font-weight:700;">✕</button>
      </td>`;
    tbody.appendChild(tr);

    if (isFgRow) {
      const descTr = document.createElement("tr");
      descTr.style.borderBottom = "1px solid #f1f5f9";
      descTr.innerHTML = `
        <td></td>
        <td colspan="8" style="padding:4px 4px 8px 4px; position:relative;">
          <label style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; display:block; margin-bottom:3px;">Description of Material (optional, for this Finished Goods row)</label>
          <input type="text" id="eboq-row-desc-${idx}" value="${row.descriptionOfMaterial || ""}" placeholder="Type to search or create a description..." autocomplete="off"
            oninput="handleMaterialDescriptionTypeaheadInput(this.value, 'eboq-row-desc-${idx}', 'eboq-row-desc-dropdown-${idx}', 'eboq-row-desc-id-${idx}', 'boqRowDescOnSelect', 'eboq:${idx}'); eboqMaterialRows[${idx}].descriptionOfMaterial=this.value; eboqMaterialRows[${idx}].descriptionId=null;"
            style="padding:6px; font-size:0.82rem; width:60%; border:1px solid var(--border); border-radius:3px;" />
          <div id="eboq-row-desc-dropdown-${idx}" style="display:none; position:absolute; background:#fff; border:1.5px solid var(--brand); border-radius:6px; overflow-y:auto; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.18); min-width:280px;"></div>
          <input type="hidden" id="eboq-row-desc-id-${idx}" value="${row.descriptionId || ""}" />
        </td>`;
      tbody.appendChild(descTr);
    }
  });

  requestAnimationFrame(() => {
    tbody.querySelectorAll("textarea").forEach(ta => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    });
  });

  updateEBOQTotals();
}

function updateEBOQTotals() {
  const totalPerSet = eboqMaterialRows.reduce((sum, row) => {
    return sum + ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0));
  }, 0);
  const orderQty = parseInt(document.getElementById("eboq-order-qty")?.value) || 0;
  const totalCost = totalPerSet * orderQty;

  const perSetEl = document.getElementById("eboq-total-per-set");
  const totalEl  = document.getElementById("eboq-total-cost");
  if (perSetEl) perSetEl.textContent = "₹" + totalPerSet.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (totalEl)  totalEl.textContent  = "₹" + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

let _submitBOQAuthorizeInProgress = false;
async function submitEBOQAuthorize() {
  if (_submitBOQAuthorizeInProgress) return;
  _submitBOQAuthorizeInProgress = true;
  const btn         = document.getElementById("eboq-submit-btn");
  const feedbackId  = eboqMode === "authorize" ? "auth-boq-feedback" : "auth-boq-upd-feedback";
  const cardsFeedId = eboqMode === "authorize" ? "auth-boq-queue-cards-feed" : "auth-boq-upd-queue-cards-feed";
  const action      = eboqMode === "authorize" ? "submitBOQAuthorize" : "submitBOQUpdateAuthorize";

  const productName  = document.getElementById("eboq-product-name")?.value.trim() || "";
  const productRating= document.getElementById("eboq-product-rating")?.value.trim() || "";
  const department   = document.getElementById("eboq-department")?.value.trim() || "";
  const orderQty     = parseInt(document.getElementById("eboq-order-qty")?.value) || 0;
  const authorizedBy = appActiveOperatorIdentityString || "";
  const descriptionOfMaterial = document.getElementById("eboq-desc-input")?.value.trim() || null;
  const descriptionIdRaw = document.getElementById("eboq-description-id")?.value.trim() || "";
  const descriptionId = descriptionIdRaw ? parseInt(descriptionIdRaw) : null;

  const _validationFail = (msg) => { _submitBOQAuthorizeInProgress = false; showBOQBanner(feedbackId, msg, "error"); };

  if (!productName)   { _validationFail("⚠️ Product Name is required."); return; }
  if (!productRating) { _validationFail("⚠️ Product Rating is required."); return; }
  if (!department)    { _validationFail("⚠️ Department is required."); return; }
  if (orderQty < 1)   { _validationFail("⚠️ Order Quantity must be at least 1."); return; }
  if (eboqMaterialRows.length === 0) { _validationFail("⚠️ At least one material row is required."); return; }
  if (eboqMode === "authorize" && !authorizedBy) { _validationFail("⚠️ Authorized By is required."); return; }

  const invalidRow = eboqMaterialRows.find(r => !r.materialName || !r.quantityFor1Set);
  if (invalidRow) { _validationFail("⚠️ All rows must have Material Description and Quantity."); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Authorizing...';
  showBlockingOverlay(eboqMode === "authorize" ? "Authorizing Bill of Quantity..." : "Authorizing Bill of Quantity Revision...");

  try {
    const data = await apFetch({
      action,
      boqId: eboqCurrentDraft.boqId,
      productName, productRating, department,
      orderQuantity: orderQty,
      materialRowsList: eboqMaterialRows,
      authorizedBy,
      descriptionId, descriptionOfMaterial
    });
    hideBlockingOverlay();

    if (data.success) {
      const _lastDraft = eboqCurrentDraft;
      eboqCurrentDraft = null;
      eboqMaterialRows = [];
      eboqExpandedCardBoqId = null;

      // Hide the cards feed (all pending BOQ cards + expanded forms)
      const cardsFeedEl = document.getElementById(cardsFeedId);
      if (cardsFeedEl) cardsFeedEl.style.display = "none";

      const pdfNote = data.pdfWarning
        ? `<div style="font-size:0.78rem; color:#b45309; margin-top:6px;">⚠️ PDF could not be generated — BOQ is authorized. Contact admin to verify Drive folder setup.</div>`
        : (data.pdfUrl ? `<div style="font-size:0.78rem; margin-top:6px;">📄 <a href="${driveLink(data.pdfUrl)}" target="_blank" style="color:var(--accent); font-weight:700;">View BOQ PDF</a></div>` : ``);

      const fb = document.getElementById(feedbackId);
      if (fb) {
        fb.style.borderLeftColor = "var(--accent)";
        fb.style.background      = "#f0fff4";
        fb.style.color           = "#276749";
        fb.style.display         = "block";
        fb.innerHTML = `
          <div style="font-size:0.85rem; font-weight:800; margin-bottom:10px;">✅ Bill of Quantity ${eboqMode === "authorize" ? "Authorized" : "Revision Authorized"} Successfully!</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; font-size:0.8rem; margin-bottom:14px;">
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">BOQ ID</span><span style="font-family:monospace; font-weight:800;">${data.boqId}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Project ID</span><span style="font-weight:700;">${_lastDraft?.projectId || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Customer</span><span style="font-weight:700;">${_lastDraft?.customerName || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Name</span><span style="font-weight:700;">${data.productName || _lastDraft?.productName || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Rating</span><span style="font-weight:700;">${data.productRating || _lastDraft?.productRating || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Order Qty (Sets)</span><span style="font-weight:700;">${formatQtyTrimmed(orderQty)}</span></div>
          </div>
          ${pdfNote}
          <button onclick="
            const _cf=document.getElementById('${cardsFeedId}');
            if(_cf){_cf.innerHTML='';_cf.style.display='';}
            document.getElementById('${feedbackId}').style.display='none';
            initializeAuthorizeBOQPanel('${eboqMode}').catch(()=>{});"
            style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">
            ${eboqMode === "authorize" ? "Authorize Another Bill of Quantity" : "Authorize Another BOQ Revision"}
          </button>`;
      }
    } else {
      showBOQBanner(feedbackId, data.error || "Authorization failed.", "error");
    }
  } catch(e) {
    hideBlockingOverlay();
    showBOQBanner(feedbackId, "Network error: " + e.message, "error");
  } finally {
    _submitBOQAuthorizeInProgress = false;
    btn.disabled = false;
    btn.textContent = eboqMode === "authorize" ? "Authorize BOQ" : "Authorize BOQ Update";
  }
}

// ═══════════════════════════════════════════════════════
// UPDATE BOQ
// ═══════════════════════════════════════════════════════

