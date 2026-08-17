let liveStockSyncIntervalId = null;
// --- GLOBAL INVENTORY MODULE STATE STORAGE ---
let cachedInventoryStockCollection = [];
function renderBOQLimitExceededApprovalRequestWorkspaceBlock(materialsList) {
  const inlineFeedbackBanner = document.getElementById("store-ticket-runtime-inline-feedback-banner");
  // Anchored off the basket table's sibling — same stable reference
  // resetMaterialRequestFormSubmissionActionControlsRow already uses —
  // NOT the submit button's own parent, since that button lives inside
  // the very content this function replaces. Using the button as the
  // anchor meant a second call (a second over-limit item added) would
  // resolve to a different element than the first call, leaving the
  // original box orphaned in the DOM instead of being replaced.
  const bottomActionControlsRow = document.getElementById("shopping-basket-preview-table").parentElement.nextElementSibling;
  
  if (inlineFeedbackBanner) {
    inlineFeedbackBanner.style.cssText = "display: block; background: #fffaf0; border-left: 4px solid #dd6b20; color: #c05621; padding: 12px; font-size: 0.82rem; font-weight: 700; text-align: left; margin-bottom: 12px;";
    inlineFeedbackBanner.innerHTML = `Requested Materials <strong>{ ${materialsList.join(", ")} }</strong> are over the Allotted BOQ for this project. Send an Approval request to Admin or Reduce the requested quantity.`;
  }

  // Overwrite submission controls row layout area to mount the justification text box window natively
  bottomActionControlsRow.innerHTML = `
    <div style="width: 100%; text-align: left; background: #f8fafc; border: 1px solid var(--border); padding: 12px; border-radius: var(--radius); display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
      <label class="field-label" style="margin: 0; color: var(--brand); font-weight: bold;">Explain Request / Justification *</label>
      <textarea id="boq-increase-justification-notes-input" placeholder="Specify why additional material is required for this Job Card..." style="min-height: 55px; padding: 8px; font-size: 0.82rem; border-color: var(--brand);"></textarea>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
        <button class="nav-btn-styled" onclick="clearFullBasketDraftState()" style="background: #718096; padding: 6px 14px;">Clear Basket</button>
        <button class="nav-btn-styled" id="submit-ticket-final-btn" onclick="executeBOQLimitIncreaseRequestTransmissionPipeline()" style="background: var(--brand); padding: 8px 20px; font-weight: 700;">Send Approval Request to Admin</button>
      </div>
    </div>
  `;
}

function exitStoreWorkspacePanelBackToMenu() {
  document.getElementById("module-store-workspace-enclosure-panel").style.display = "none";

  // Reset header controls to hidden default state
  const leftControls = document.getElementById("store-panel-left-controls");
  const centerTitle  = document.getElementById("store-panel-center-title");
  const syncBtn      = document.getElementById("live-stock-sync-btn");
  if (leftControls) leftControls.style.visibility = "hidden";
  if (centerTitle)  { centerTitle.style.visibility = "hidden"; centerTitle.textContent = ""; }
  if (syncBtn) { syncBtn.removeAttribute("onclick"); syncBtn.onclick = function() { triggerLiveWarehouseStockMetricsSync(); }; }

  // Restore the main dashboard — this was missing, which is why leaving a Store screen
  // left the page in a half-hidden state instead of returning to the department grid.
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";

  enforceDynamicModuleRoleGateways(userPermissions);

  if(document.getElementById("canvas-module-fg-reactor"))   document.getElementById("canvas-module-fg-reactor").style.display   = "none";
  if(document.getElementById("canvas-module-fg-capacitor")) document.getElementById("canvas-module-fg-capacitor").style.display = "none";
  if(document.getElementById("canvas-module-assign-current-stock")) document.getElementById("canvas-module-assign-current-stock").style.display = "none";
  if(document.getElementById("canvas-module-expected-inbounds")) document.getElementById("canvas-module-expected-inbounds").style.display = "none";

  // FIX: these panels share the Store enclosure but were never hidden or state-reset on exit,
  // so re-entering the section showed stale selections from the previous visit.
  if(document.getElementById("canvas-module-jc-letterhead")) document.getElementById("canvas-module-jc-letterhead").style.display = "none";
  if(document.getElementById("canvas-module-stock-sweep")) { document.getElementById("canvas-module-stock-sweep").style.display = "none"; initializeStockSweepPanel(); }
  if(document.getElementById("canvas-module-fg-add")) document.getElementById("canvas-module-fg-add").style.display = "none";
  if(document.getElementById("canvas-module-fg-approval")) document.getElementById("canvas-module-fg-approval").style.display = "none";
  if(document.getElementById("canvas-module-project-invoice")) document.getElementById("canvas-module-project-invoice").style.display = "none";
  if(document.getElementById("canvas-module-store-live-fg")) document.getElementById("canvas-module-store-live-fg").style.display = "none";
  if(document.getElementById("canvas-module-store-live-spare")) document.getElementById("canvas-module-store-live-spare").style.display = "none";
  if(document.getElementById("canvas-module-store-history-matrix")) document.getElementById("canvas-module-store-history-matrix").style.display = "none";

  resetJCLHWorkspace();

  document.getElementById("dashboard-view").style.display = "flex"; 
  triggerCompanyDropdownArrayFetch(); 
}

/**
 * RENDER STORE APPROVALS QUEUE CARDS FEED
 * Generates actionable entry cards for all unreleased material transaction tickets.
 * Explicitly distinguishes and styles custom Admin BOQ limit overrun increase requests.
 */
function renderStoreManagerApprovalsCardsFeed(pendingTicketsList) {
  const cardsFeedZone = document.getElementById("store-manager-approvals-queue-cards-feed");
  if (!cardsFeedZone) return;
  
  cardsFeedZone.innerHTML = "";
  if (pendingTicketsList.length === 0) {
    cardsFeedZone.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;"><h3 style="color:var(--accent);">Tickets Approvals Queue Clear</h3></div>`;
    return;
  }
  
  pendingTicketsList.forEach((ticket) => {
    let cardWrapper = document.createElement("div");
    cardWrapper.className = "contact-summary-card-parent";
    cardWrapper.id = `store-pending-ticket-card-node-${ticket.ticketId}`;
    
    let itemsArray = Array.isArray(ticket.items) ? ticket.items : [];
    
    const isRawTicket = (ticket.storeTargetScope || "Raw Materials Store") === "Raw Materials Store";
    let itemRowsHtml = "";
    itemsArray.forEach(item => {
      const overrunHighlightStyle = item.requiresBOQIncreaseFlag === true ? 'color: var(--warn); font-weight: 800; background: #fff5f2; padding: 2px 6px; border-radius: 4px; border: 1px solid #fca5a5;' : '';
      const reqQty = Number(item.quantity) || 0;
      const jcAllotted = (item.jcAllottedQty !== null && item.jcAllottedQty !== undefined) ? fmtQty(item.jcAllottedQty) : "—";
      const jcRemaining = (item.jcRemainingQty !== null && item.jcRemainingQty !== undefined) ? item.jcRemainingQty : null;
      const spareCellsHtml = isRawTicket ? `
          <td style="padding:6px; text-align:center; vertical-align:middle;">
            <select class="ticket-spare-needed-select" data-itemcode="${item.itemCode}" onchange="handleSpareNeededChange(this)"
              style="width:100%; padding:5px 4px; font-size:0.82rem; font-weight:600; border:1.5px solid var(--border); border-radius:4px;">
              <option value="No" selected>No</option>
              <option value="Blocked">Blocked</option>
              <option value="Restricted">Restricted</option>
            </select>
          </td>
          <td style="padding:6px; text-align:center; vertical-align:middle;">
            <input type="number" class="ticket-spare-qty-input" data-itemcode="${item.itemCode}" value="" min="0" step="any" disabled
              style="box-sizing:border-box; width:100%; margin:0; padding:5px 6px; text-align:center; font-family:monospace; font-weight:700; font-size:1.05rem; border:1.5px solid var(--border); border-radius:4px; background:#f1f5f9; color:var(--muted);" />
          </td>` : `
          <td style="padding:6px; text-align:center; vertical-align:middle; color:var(--muted);">—</td>
          <td style="padding:6px; text-align:center; vertical-align:middle; color:var(--muted);">—</td>`;
      itemRowsHtml += `
        <tr>
          <td style="padding:6px; font-weight:600; text-align:left; ${overrunHighlightStyle}">
            ${item.materialName}
            ${item.requiresBOQIncreaseFlag ? '<span style="font-size:0.62rem; background:var(--warn); color:white; padding:1px 4px; border-radius:3px; margin-left:4px; font-weight:bold;">OVERRUN</span>' : ''}
          </td>
          <td style="padding:6px; color:#111827; font-weight:600; font-size:0.9rem; text-align:center; vertical-align:middle;">${jcAllotted}</td>
          <td class="ticket-jc-remaining-cell" data-itemcode="${item.itemCode}" style="padding:6px; font-weight:700; font-size:0.9rem; text-align:center; vertical-align:middle; color:#0369a1;">${jcRemaining !== null ? fmtQty(jcRemaining) : "—"}</td>
          <td style="padding:6px; color:var(--muted); font-size:0.95rem; font-weight:600; text-align:center; vertical-align:middle;">${item.unitType || 'Pcs'}</td>
          <td style="padding:6px; font-family:monospace; font-weight:700; font-size:1.05rem; color:var(--brand); text-align:center; vertical-align:middle;">${fmtQty(reqQty)}</td>
          <td style="padding:6px; text-align:center; vertical-align:middle;">
            <input type="number" class="ticket-actual-qty-input" data-itemcode="${item.itemCode}" data-requested="${reqQty}" data-jcremaining="${jcRemaining !== null ? jcRemaining : ''}"
              value="${reqQty}" min="0" max="${reqQty}" step="any" oninput="clampTicketActualQtyInput(this)"
              style="box-sizing:border-box; width:100%; margin:0; padding:5px 6px; text-align:center; font-family:monospace; font-weight:700; font-size:1.05rem; border:1.5px solid var(--border); border-radius:4px;" />
          </td>
${spareCellsHtml}
        </tr>`;
    });
    
    const typeLabel = (ticket.ticketType || "Request Material").toString().trim();
    const isBoqInc = typeLabel === "BOQ INCREASE REQUEST";
    
    const statusBadgeText = isBoqInc ? "BOQ LIMIT OVERRUN" : "PENDING RELEASE";
    const mappedStorageScope = ticket.storeTargetScope || "Raw Materials Store";

    cardWrapper.innerHTML = `
      <div class="contact-summary-header-row" onclick="toggleTicketCardBody('${ticket.ticketId}')" style="margin-bottom:0; padding-bottom:6px; cursor:pointer;">
        <div class="contact-summary-title-info" style="width:100%;">
          <div class="meta-row-line-block">
            <span style="font-family:monospace; font-weight:800; background:var(--brand); color:#fff; font-size:0.75rem; padding:3px 6px;">${ticket.ticketId}</span>
            <span style="background:#fef3c7; color:#b45309; font-weight:700; margin-left:4px;">${statusBadgeText}</span>
            <span style="margin-left:8px;">Store:</span> <strong style="color:#111827;">${mappedStorageScope}</strong>
            <span style="margin-left:8px;">Department:</span> <strong style="color:#111827;">${ticket.department || "General Store"}</strong>
            <span style="margin-left:8px;">Ticket Created By:</span> <strong style="color:#111827;">${ticket.requestedBy}</strong>
            <span id="ticket-card-caret-${ticket.ticketId}" style="float:right; font-weight:700; color:var(--muted);">▸</span>
          </div>
          <div class="meta-row-line-block" style="margin-top:6px; font-size:0.85rem;">
            <span>Project ID:</span><strong style="margin-right:15px; color:var(--brand);">${ticket.projectId}</strong>
            <span>Job Card Number:</span><strong style="color:var(--brand);">${ticket.jobCardNumber || "—"}</strong>
          </div>
        </div>
      </div>
      <div id="ticket-card-body-${ticket.ticketId}" style="display:none; padding-top:10px; border-top:1px dashed var(--border); margin-top:6px;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:6px; margin-bottom:12px;">
          <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.82rem; table-layout:fixed;">
            <colgroup>
              <col style="width:auto;">
              <col style="width:110px;">
              <col style="width:110px;">
              <col style="width:90px;">
              <col style="width:140px;">
              <col style="width:140px;">
              <col style="width:130px;">
              <col style="width:110px;">
            </colgroup>
            <thead>
              <tr style="border-bottom:1px solid #e2e8f0;">
                <th style="padding:6px; font-size:0.68rem; text-transform:uppercase; color:var(--muted);">Material Name</th>
                <th style="padding:6px; font-size:0.68rem; text-transform:uppercase; color:var(--muted); text-align:center;">JC Allotted Qty</th>
                <th style="padding:6px; font-size:0.68rem; text-transform:uppercase; color:var(--muted); text-align:center;">JC Remaining Qty</th>
                <th style="padding:6px; font-size:0.68rem; text-transform:uppercase; color:var(--muted); text-align:center;">Unit</th>
                <th style="padding:6px; font-size:0.68rem; text-transform:uppercase; color:var(--muted); text-align:center;">Requested Quantity</th>
                <th style="padding:6px; font-size:0.68rem; text-transform:uppercase; color:var(--muted); text-align:center;">Actual Quantity *</th>
                <th style="padding:6px; font-size:0.68rem; text-transform:uppercase; color:var(--muted); text-align:center;">Spare Stock Needed</th>
                <th style="padding:6px; font-size:0.68rem; text-transform:uppercase; color:var(--muted); text-align:center;">Spare Store Extra Qty</th>
              </tr>
            </thead>
            <tbody>${itemRowsHtml}</tbody>
          </table>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="nav-btn-styled" id="btn-reject-${ticket.ticketId}" style="background:#e53e3e; padding:6px 12px; font-size:0.75rem;" onclick="executeStoreManagerTicketActionDecision('${ticket.ticketId}', 'REJECT')">Reject</button>
            <button class="nav-btn-styled" id="btn-approve-${ticket.ticketId}" style="background:var(--accent); padding:6px 14px; font-size:0.78rem; font-weight:700;" onclick="checkCoverageAndApprove('${ticket.ticketId}', '${ticket.projectId}', this)">
            ${isBoqInc ? 'Approve Allocation Overwrite' : 'Approve'}
          </button>
        </div>
      </div>
    `;
    cardsFeedZone.appendChild(cardWrapper);
  });
}

let _pendingTicketsQueuePollTimer = null;
function startPendingTicketsQueuePolling() {
  stopPendingTicketsQueuePolling();
  _pendingTicketsQueuePollTimer = setInterval(refreshJcQuantitiesLiveInQueue, 5000);
}
function stopPendingTicketsQueuePolling() {
  if (_pendingTicketsQueuePollTimer) { clearInterval(_pendingTicketsQueuePollTimer); _pendingTicketsQueuePollTimer = null; }
}
function executeClientSideStoreTicketFilterSearch() {
  const resultsFeedZone = document.getElementById("store-historical-matrix-results-feed");
  if (!resultsFeedZone) return;

  // READ ALL ACTIVE INTERFACE CHECKED ELEMENTS PILLS CHANNELS
  const checkedStores      = Array.from(document.querySelectorAll('input[name="matrixStoreFilter"]:checked')).map(cb => cb.value.toLowerCase().trim());
  const checkedStoreLabels = Array.from(document.querySelectorAll('input[name="matrixStoreFilter"]:checked')).map(cb => cb.value);
  const checkedStatuses    = Array.from(document.querySelectorAll('input[name="matrixStatusFilter"]:checked')).map(cb => cb.value.toLowerCase().trim());
  const checkedStatusLabels = Array.from(document.querySelectorAll('input[name="matrixStatusFilter"]:checked')).map(cb => cb.nextElementSibling ? cb.nextElementSibling.textContent : cb.value);
  const checkedDepartments = Array.from(document.querySelectorAll('input[name="matrixDepartmentFilter"]:checked')).map(cb => cb.value.toLowerCase().trim());
  const checkedDeptLabels  = Array.from(document.querySelectorAll('input[name="matrixDepartmentFilter"]:checked')).map(cb => cb.value);

  const valSpan = (v) => `<span style="color:#000;">${v}</span>`;
  const summaryParts = [];
  summaryParts.push(checkedStoreLabels.length ? `Stores: ${valSpan(checkedStoreLabels.join(", or "))}` : `Stores: ${valSpan("ALL")}`);
  summaryParts.push(checkedStatusLabels.length ? `Statuses: ${valSpan(checkedStatusLabels.join(", or "))}` : `Statuses: ${valSpan("ALL")}`);
  if (matrixActiveMaterialSearchQuery) summaryParts.push(`Material: ${valSpan(`"${matrixActiveMaterialSearchDisplay}"`)}`);
  if (matrixActiveProjectSearchQuery) summaryParts.push(`Project ID: ${valSpan(`"${matrixActiveProjectSearchDisplay}"`)}`);
  if (checkedDeptLabels.length) summaryParts.push(`Department: ${valSpan(checkedDeptLabels.join(", or "))}`);
  const summaryEl = document.getElementById("matrix-search-summary-text");
  if (summaryEl) { summaryEl.style.display = "block"; summaryEl.innerHTML = `Searching for:<br>${summaryParts.join(" • ")}`; }

  resultsFeedZone.innerHTML = "";

  const filteredOutputList = masterStoreTicketsHistoryCacheCollection.filter(ticket => {
    // FALLBACK PROTECTION NORMALIZATION: Eradicates undefined reading property execution errors
    const ticketStoreStr = (ticket.storeTargetScope || "Raw Materials Store").toString().trim().toLowerCase();
    const ticketDeptStr  = (ticket.department || "General Store").toString().trim().toLowerCase();
    const projectIdStr   = (ticket.projectId || "").toString().trim().toLowerCase();
    const statusStr      = (ticket.status || "Pending").toString().trim().toLowerCase();
    const materialMatchStr = (Array.isArray(ticket.items) ? ticket.items : []).map(i => `${i.materialName || ""} ${i.itemCode || ""}`).join(" ").toLowerCase();
    
    const matchStore    = (checkedStores.length === 0 || checkedStores.indexOf(ticketStoreStr) !== -1);
    const matchProject  = (!matrixActiveProjectSearchQuery || projectIdStr.includes(matrixActiveProjectSearchQuery));
    const matchMaterial = (!matrixActiveMaterialSearchQuery || materialMatchStr.includes(matrixActiveMaterialSearchQuery));
    const matchStatus   = (checkedStatuses.length === 0 || checkedStatuses.indexOf(statusStr) !== -1);
    const matchDept     = (checkedDepartments.length === 0 || checkedDepartments.indexOf(ticketDeptStr) !== -1);
    
    return matchStore && matchProject && matchMaterial && matchStatus && matchDept;
  });

  if (filteredOutputList.length === 0) {
    resultsFeedZone.innerHTML = `<div style="text-align:center; padding:20px; background:#fff; border:1px solid var(--border); border-radius:4px; color:var(--muted); font-size:0.85rem;">No historical tickets matched your current combination.</div>`;
    return;
  }

  filteredOutputList.forEach(ticket => {
    const card = document.createElement("div");
    card.className = "contact-summary-card-parent";
    
    let itemsArray = Array.isArray(ticket.items) ? ticket.items : [];
    
    let itemsTableRowsHtml = "";
    itemsArray.forEach(i => {
      const mappedQty = (i.released !== undefined && i.released !== null) ? i.released : i.quantity;
      itemsTableRowsHtml += `
        <tr>
          <td style="padding:6px; color:var(--text); font-weight:600; text-align:left;">${i.materialName}</td>
          <td style="padding:6px; font-family:monospace; font-weight:700; font-size:1.05rem; text-align:right; color:var(--brand);">${fmtQty(mappedQty)} ${i.unitType || 'Pcs'}</td>
        </tr>`;
    });

    let badgeColorStyle = "background:#fef3c7; color:#b45309;"; 
    const currentStatus = (ticket.status || "Pending").toString().trim();
    if (currentStatus === "Approved") badgeColorStyle = "background:#dcfce7; color:#15803d;";
    if (currentStatus === "Rejected" || currentStatus === "Expired" || currentStatus === "Rejected by Admin") badgeColorStyle = "background:#fee2e2; color:#b91c1c;";

    const statusBadgeText = currentStatus.toUpperCase();
    const mappedStorageScope = ticket.storeTargetScope || "Raw Materials Store";

    let cleanCreatedDate = formatDateTimeDMY(ticket.dateCreated);
    let cleanActionedDate = ticket.dateActioned ? formatDateTimeDMY(ticket.dateActioned) : "Not Actioned Yet";

    card.innerHTML = `
      <div class="contact-summary-header-row" onclick="toggleMatrixCardBody('${ticket.ticketId}')" style="margin-bottom:0; padding-bottom:6px; cursor:pointer;">
        <div class="contact-summary-title-info" style="width:100%;">
          <div class="meta-row-line-block" style="display:flex; align-items:center; justify-content:space-between;">
            <div>
              <span style="font-family:monospace; font-weight:800; background:var(--highlight-bg); color:var(--brand); padding:2px 6px; border-radius:4px; font-size:0.8rem;">${ticket.ticketId}</span>
              <span style="margin-left:8px;">Store:</span> <strong style="color:#111827;">${mappedStorageScope}</strong>
              <span style="margin-left:8px;">Department:</span> <strong style="color:#111827;">${ticket.department || "General Store"}</strong>
            </div>
            <div>
              <span style="font-size:0.68rem; font-weight:700; border-radius:4px; padding:2px 6px; ${badgeColorStyle}">${statusBadgeText}</span>
              <span id="matrix-card-caret-${ticket.ticketId}" style="margin-left:8px; font-weight:700; color:var(--muted);">▸</span>
            </div>
          </div>
          <div class="meta-row-line-block" style="margin-top:6px; font-size:0.85rem;">
            <span>Job Card Number:</span> <strong style="color:var(--brand);">${ticket.jobCardNumber || "—"}</strong>
          </div>
        </div>
      </div>
      <div id="matrix-card-body-${ticket.ticketId}" style="display:none; padding-top:8px; border-top:1px dashed var(--border); margin-top:6px;">
        <div style="font-size:0.8rem; line-height:1.5; margin-bottom:8px; color:#4a5568; text-align:left;">
          <strong>Requested By:</strong> ${ticket.requestedBy} | <strong>Actioned By:</strong> ${ticket.actionedBy || "Pending Review"}<br/>  
          <strong>Created On:</strong> ${cleanCreatedDate} | <strong>Actioned On:</strong> ${cleanActionedDate}
        </div>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:6px;">
          <table style="width:100%; font-size:0.82rem; border-collapse:collapse; table-layout:fixed;">
            <thead>
              <tr style="border-bottom:1px solid #e2e8f0; font-size:0.7rem; color:var(--muted); font-weight:bold; text-transform:uppercase;">
                <th style="text-align:left; padding:4px;">Material Description</th>
                <th style="text-align:right; padding:4px;">Quantity</th>
              </tr>
            </thead>
            <tbody>${itemsTableRowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
    resultsFeedZone.appendChild(card);
  });
}

function toggleMatrixCardBody(ticketId) {
  const body = document.getElementById(`matrix-card-body-${ticketId}`);
  const caret = document.getElementById(`matrix-card-caret-${ticketId}`);
  if (!body) return;
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "block";
  if (caret) caret.textContent = isOpen ? "▸" : "▾";
}

/**
 * REFRESH REAL-TIME LIVE INVENTORY STRIP METRICS
 * Queries balances from master workbook catalog with interactive button state loader animations.
 */
async function triggerLiveWarehouseStockMetricsSync() {
  const mountZone = document.getElementById("dashboard-live-inventory-metrics-mount-zone");
  const syncBtn = document.getElementById("live-stock-sync-btn");
  if (!mountZone) return;

  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Syncing...';
  }

  try {
    const data = await apFetch({ action: "pullLiveInventoryCounts" });

    if (data.success && data.inventory) {
      cachedInventoryStockCollection = data.inventory;
      mountZone.innerHTML = "";

      if (!cachedInventoryStockCollection || cachedInventoryStockCollection.length === 0) {
        mountZone.innerHTML = `
          <div style="grid-column:1/-1; text-align:center; padding:40px 20px; background:var(--card); border:1px solid var(--border); border-radius:var(--radius);">
            <div style="font-size:2rem; margin-bottom:10px;">📦</div>
            <div style="font-size:0.95rem; font-weight:700; color:var(--muted);">Raw Materials Store is Empty</div>
            <div style="font-size:0.8rem; color:var(--muted); margin-top:4px;">No items have been added to the store yet.</div>
          </div>`;
        return;
      }

      // Group items by Type of Material
      const typeGroups = {};
      // Type of Material order now lives in design.item_code_type_config
      // (16 Aug 2026, see design/item-codes.js's loadItemCodeTypeConfigIntoCache)
      // — this hardcoded list is kept as a fallback ONLY, so a failed/not-yet-run
      // fetch (e.g. this screen opened before Item Code's cache warmed up)
      // can't break Live Stock's grouping.
      const FALLBACK_TYPE_ORDER = [
        "Fabrication","Switchgear","Cables","Busbar","Lugs","Hardware","Meters","Fiber Glass Material",
        "Relay","Fans","Air Core Reactor","Measuring Equipment","HT Capacitors","Iron Core Reactor",
        "Conductor","Fuses","LT Capacitors","Associated Equipment","Insulators","Electronic Card",
        "Resin Hardener and Varnish","Paint and Thinner","Power Factor Controller","Harmonic Filter Bank",
        "APFC","Damping Resistors","HT Capacitor Raw Material","Insulating Material","TSM","SCR",
        "Heatsink","Laminations","Consumables","Consumable Spares","Gas Cylinders","Packing Material",
        "Assembly Material","Capital Goods",""
      ];
      const typeOrder = (window.itemCodeTypeConfigCache && window.itemCodeTypeConfigCache.length > 0)
        ? [...window.itemCodeTypeConfigCache.map(t => t.typeOfMaterial), ""]
        : FALLBACK_TYPE_ORDER;
      // Fire-and-forget warm-up for next time — doesn't block this render.
      if (typeof loadItemCodeTypeConfigIntoCache === "function") loadItemCodeTypeConfigIntoCache();
      // Shared display helper — stored values are the full Type of Material name directly.
      // Defined once here since this is the first place it's needed.
      window.typeLabelDisplay_ = window.typeLabelDisplay_ || function(t) {
        const clean = (t || "").toString().trim();
        return clean || "Uncategorized";
      };
      
      cachedInventoryStockCollection.forEach(item => {
        const type = (item.typeOfMaterial || item.typematerial || "").toString().trim() || "Uncategorized";
        if (!typeGroups[type]) typeGroups[type] = [];
        typeGroups[type].push(item);
      });

      // Sort groups by typeOrder
      const sortedTypes = Object.keys(typeGroups).sort((a, b) => {
        const ai = typeOrder.indexOf(a); 
        const bi = typeOrder.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

      sortedTypes.forEach(type => {
        const items = typeGroups[type];
        const label = window.typeLabelDisplay_(type);
        const sectionId = "rm-section-body-" + type.replace(/\s+/g, '_');
        const isCollapsed = localStorage.getItem("rm_section_" + type) === "collapsed";

        // Section wrapper
        const section = document.createElement("div");
        section.style.cssText = "grid-column:1/-1; margin-bottom:16px; background:var(--card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.04);";

        // Section header
        const headerDiv = document.createElement("div");
        headerDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:var(--highlight-bg); border-bottom:1px solid var(--border); cursor:pointer; user-select:none;";
        headerDiv.onclick = () => {
          const body = document.getElementById(sectionId);
          const btn  = document.getElementById("rm-toggle-btn-" + type.replace(/\s+/g,'_'));
          if (body.style.display === "none") {
            body.style.display = "flex";
            btn.textContent = "▲ Collapse";
            localStorage.setItem("rm_section_" + type, "expanded");
          } else {
            body.style.display = "none";
            btn.textContent = "▼ Expand";
            localStorage.setItem("rm_section_" + type, "collapsed");
          }
        };
        headerDiv.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:0.78rem; font-weight:800; text-transform:uppercase; color:var(--brand); letter-spacing:0.5px;">${label}</span>
            <span style="font-size:0.72rem; font-weight:700; background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:10px;">${items.length} ${items.length === 1 ? 'item' : 'items'}</span>
          </div>
          <button id="rm-toggle-btn-${type.replace(/\s+/g,'_')}" style="background:transparent; border:1px solid var(--border); color:var(--brand); font-size:0.72rem; font-weight:700; padding:3px 10px; border-radius:4px; cursor:pointer;">
            ${isCollapsed ? '▼ Expand' : '▲ Collapse'}
          </button>
        `;

        // Section body — grid of cards
        const bodyDiv = document.createElement("div");
        bodyDiv.id = sectionId;
        bodyDiv.style.cssText = `display:${isCollapsed ? 'none' : 'flex'}; flex-wrap:wrap; gap:10px; padding:14px;`;

        items.forEach(item => {
          const card = document.createElement("div");
          card.style.cssText = "background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:var(--radius); display:flex; flex-direction:column; gap:6px; box-shadow:0 1px 3px rgba(0,0,0,0.02); width:180px; flex-shrink:0; cursor:pointer;";
          card.title = "Click to see how Reserved stock is assigned across BOQs";
          card.onclick = () => showStockAssignmentBreakdownModal(item.itemCode, item.materialName, item.unitType, item.availableStock, 'raw');
          card.innerHTML = `
            <div style="font-size:0.8rem; font-weight:700; color:#334155; line-height:1.4; word-break:break-word;">
              ${item.materialName}
            </div>
            <div style="text-align:right;">
              <span style="display:inline-block; font-size:0.65rem; font-weight:700; padding:2px 6px; border-radius:3px; background:#dcfce7; color:#15803d;">${(item.unitType || "PCS").toUpperCase()}</span>
            </div>
            <div style="border-top:1px dashed #e2e8f0; padding-top:8px; display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:600; color:#334155;">
                <span>Available:</span><span style="font-family:monospace; font-weight:700;">${item.availableStock}</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:600; color:#334155;">
                <span>Reserved:</span><span style="font-family:monospace; font-weight:700;">${item.reservedStock || 0}</span>
              </div>
            </div>
          `;
          bodyDiv.appendChild(card);
        });

        section.appendChild(headerDiv);
        section.appendChild(bodyDiv);
        mountZone.appendChild(section);
      });
    }
  } catch (error) {
    console.error(error);
    mountZone.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--warn);">⚠️ Sync Exception: Couldn't refresh active inventory balances.</div>`;
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.innerHTML = "🔄 Refresh"; }
  }
}

async function triggerLiveSpareStoreStockMetricsSync() {
  const mountZone = document.getElementById("dashboard-live-spare-inventory-metrics-mount-zone");
  const syncBtn   = document.getElementById("live-stock-sync-btn");
  if (!mountZone) return;

  mountZone.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--muted);"><div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>Loading Spare Store...</div>`;

  try {
    const data = await apFetch({ action: "getSpareStoreStock" });

    if (!data.success || !data.stock || data.stock.length === 0) {
      mountZone.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px 20px; background:var(--card); border:1px solid var(--border); border-radius:var(--radius);"><div style="font-size:2rem; margin-bottom:10px;">📦</div><div style="font-size:0.95rem; font-weight:700; color:var(--muted);">Spare Store is Empty</div></div>`;
      return;
    }

    const typeGroups = {};
    data.stock.forEach(item => {
      const type = item.typeOfMaterial || "Uncategorized";
      if (!typeGroups[type]) typeGroups[type] = [];
      typeGroups[type].push(item);
    });

    mountZone.innerHTML = "";
    Object.keys(typeGroups).sort().forEach(type => {
      const items     = typeGroups[type];
      const sectionId = "spare-section-body-" + type.replace(/\s+/g, '_');
      const toggleId  = "spare-toggle-btn-" + type.replace(/\s+/g, '_');
      const isCollapsed = localStorage.getItem("spare_section_" + type) === "collapsed";

      const section = document.createElement("div");
      section.style.cssText = "grid-column:1/-1; margin-bottom:16px; background:var(--card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.04);";

      const headerDiv = document.createElement("div");
      headerDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:var(--highlight-bg); border-bottom:1px solid var(--border); cursor:pointer; user-select:none;";
      headerDiv.onclick = () => {
        const body = document.getElementById(sectionId);
        const btn  = document.getElementById(toggleId);
        if (body.style.display === "none") {
          body.style.display = "flex";
          btn.textContent = "▲ Collapse";
          localStorage.setItem("spare_section_" + type, "expanded");
        } else {
          body.style.display = "none";
          btn.textContent = "▼ Expand";
          localStorage.setItem("spare_section_" + type, "collapsed");
        }
      };
      headerDiv.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:0.78rem; font-weight:800; text-transform:uppercase; color:var(--brand); letter-spacing:0.5px;">${window.typeLabelDisplay_(type)}</span>
          <span style="font-size:0.72rem; font-weight:700; background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:10px;">${items.length} ${items.length === 1 ? 'item' : 'items'}</span>
        </div>
        <button id="${toggleId}" style="background:transparent; border:1px solid var(--border); color:var(--brand); font-size:0.72rem; font-weight:700; padding:3px 10px; border-radius:4px; cursor:pointer;">
          ${isCollapsed ? '▼ Expand' : '▲ Collapse'}
        </button>`;

      const bodyDiv = document.createElement("div");
      bodyDiv.id = sectionId;
      bodyDiv.style.cssText = `display:${isCollapsed ? 'none' : 'flex'}; flex-wrap:wrap; gap:10px; padding:14px;`;

      items.forEach(item => {
        const card = document.createElement("div");
        card.style.cssText = "background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:var(--radius); display:flex; flex-direction:column; gap:6px; box-shadow:0 1px 3px rgba(0,0,0,0.02); width:180px; flex-shrink:0; cursor:pointer;";
        card.title = "Click to see how Reserved stock is assigned across BOQs";
        card.onclick = () => showStockAssignmentBreakdownModal(item.itemCode, item.materialName, item.unitType, item.availableStock, 'spare');
        card.innerHTML = `
          <div style="font-size:0.8rem; font-weight:700; color:#334155; line-height:1.4; word-break:break-word;">
            ${item.materialName}
          </div>
          <div style="text-align:right;">
            <span style="display:inline-block; font-size:0.65rem; font-weight:700; padding:2px 6px; border-radius:3px; background:#dcfce7; color:#15803d;">${(item.unitType || "NOS").toUpperCase()}</span>
          </div>
          <div style="border-top:1px dashed #e2e8f0; padding-top:8px; display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:600; color:#334155;">
              <span>Available:</span><span style="font-family:monospace; font-weight:700;">${item.availableStock}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:600; color:#334155;">
              <span>Reserved:</span><span style="font-family:monospace; font-weight:700;">${item.reservedStock || 0}</span>
            </div>
          </div>`;
        bodyDiv.appendChild(card);
      });

      section.appendChild(headerDiv);
      section.appendChild(bodyDiv);
      mountZone.appendChild(section);
    });
  } catch(e) {
    mountZone.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--warn);">⚠️ Refresh failed: ${e.message}</div>`;
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.innerHTML = "🔄 Refresh"; }
  }
}

// FIXED REF: Automatic background refresh controller targeting loop
const parentShowAppView = showAppView;
showAppView = async function() {
  await parentShowAppView();

  if (userPermissions && userPermissions.liveStoreStock === true) {
    if (liveStockSyncIntervalId) clearInterval(liveStockSyncIntervalId);
    liveStockSyncIntervalId = setInterval(() => {
      const liveStockPanel    = document.getElementById("canvas-module-store-live-stock");
      const liveFinishedPanel = document.getElementById("canvas-module-store-live-fg");
      if (liveStockPanel    && liveStockPanel.style.display    === "block") triggerLiveWarehouseStockMetricsSync();
      else if (liveFinishedPanel && liveFinishedPanel.style.display === "block") triggerLiveFinishedGoodsStoreStockMetricsSync();
    }, 30000);
  }
};

async function commitStoreEntryVerificationToBackend(gateNum, encodedItem) {
  const itemData = JSON.parse(decodeURIComponent(encodedItem));
  const banner = document.getElementById('store-entry-runtime-feedback-banner');
  const btn = event.target;
  banner.style.display = "none";
  
  // Activate frontend button compression animation
  btn.disabled = true; 
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Saving Entry...';
  
  // Capture Item Code inputs and physically received quantities from the active table row coordinates
  document.querySelectorAll(`.se-item-code-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].itemCode = inp.value.trim(); // Must match itemCode
  });
  document.querySelectorAll(`.se-mat-name-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].materialName = inp.value.trim();
  });
  document.querySelectorAll(`.se-phys-qty-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].verifiedPhysicalQuantity = parseInt(inp.value, 10) || 0;
  });
  // Invoice Unit (editable, carried from Gate Entry) and Item Code Unit
  // (resolved from design.item_codes.unit via the material match) — the
  // latter is what actually governs stock from here on, see
  // commitStoreEntryPipelineStep.
  document.querySelectorAll(`.se-invoice-unit-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].unitType = inp.value.trim() || 'NOS';
  });
  document.querySelectorAll(`.se-item-code-unit-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].itemCodeUnit = inp.value.trim() || null;
  });

  let materialTypeMissing = false;
  let itemCodeMissing = false;

  document.querySelectorAll(`.se-material-type-${gateNum}`).forEach(inp => {
    const val = inp.value.trim();
    if (!val) materialTypeMissing = true;
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].materialType = val;
  });

  document.querySelectorAll(`.se-rate-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].ratePerQuantity = parseFloat(inp.value) || 0;
  });
  document.querySelectorAll(`.se-gst-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].gstPercent = parseFloat(inp.value) || 18;
  });
  document.querySelectorAll(`.se-basic-amt-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].totalBasicAmount = parseFloat(inp.value) || 0;
  });
  document.querySelectorAll(`.se-inv-amt-${gateNum}`).forEach(inp => {
    itemData.lineItems[parseInt(inp.dataset.idx, 10)].totalInvoiceAmount = parseFloat(inp.value) || 0;
  });

  // Attach linked rejection resolutions, matched by item code now that Store Entry has resolved them
  itemData.lineItems.forEach(li => {
    const code = (li.itemCode || "").toString().trim().toUpperCase();
    for (const [rejId, link] of Object.entries(window.activeGateRejectionLinks || {})) {
      if ((link.itemCode || "").toString().trim().toUpperCase() === code) {
        li.resolvesRejectionId = rejId;
        li.resolvedQuantity = link.linkedQty;
        break;
      }
    }
  });

  itemData.storePerson = appActiveOperatorIdentityString || "";

  document.querySelectorAll(`.se-item-code-${gateNum}`).forEach(inp => {
    const val = inp.value.trim();
    if (!val) itemCodeMissing = true;
  });

  itemData.storePerson = appActiveOperatorIdentityString || "";

  const poNoInput = document.getElementById(`se-po-number-${gateNum}`);
  const poNoVal = poNoInput ? poNoInput.value.trim() : "";
  itemData.poNo = poNoVal;

  if (!poNoVal) {
    showBOQBanner('store-entry-runtime-feedback-banner', "⚠️ PO Number is required — QA cannot be completed without a linked Purchase Order.", "error");
    banner.scrollIntoView({ behavior: "smooth", block: "center" });
    btn.disabled = false;
    btn.textContent = "Submit Store Entry and GRN";
    return;
  }

  if (itemCodeMissing || materialTypeMissing) {
    showBOQBanner('store-entry-runtime-feedback-banner', "⚠️ Every line item must have a material selected. If no match exists, create the Item Code first.", "error");
    banner.scrollIntoView({ behavior: "smooth", block: "center" });
    btn.disabled = false;
    btn.textContent = "Submit Store Entry and GRN";
    return;
  }

  showBlockingOverlay("Verifying Store Entry...");
  try {
    const data = await apFetch({ 
      action: "commitStoreEntryPipelineStep", 
      activeEngineer: appActiveOperatorIdentityString, 
      payload: itemData 
    });
    hideBlockingOverlay();
    
    if (data.success) {
      // Clear current row staging queue card objects feed out of sight completely
      document.getElementById("store-entry-queue-cards-feed").innerHTML = "";
      
      banner.style.cssText = "display: block; background: #dcfce7; border-left: 4px solid #15803d; color: #15803d; padding: 20px; border-radius: var(--radius); margin-bottom:15px;";
      banner.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; text-align:left;">
          <div>
            <strong>Success! Store Entry + GRN Generated.</strong><br/>
            <span>GRN Number: <strong style="font-family:monospace; font-size:1.05rem; color:#111827;">${data.grnNumber}</strong></span>
          </div>
          <button class="nav-btn-styled" onclick="
            document.getElementById('store-entry-runtime-feedback-banner').style.display = 'none';
            initializeStoreEntryWorkspaceQueue();
          " style="background:#15803d; color:white; padding:8px 16px; font-weight:700;">+ Create New Entry</button>
        </div>`;
    } else {
      alert("Submission Rejected: " + data.error);
      btn.disabled = false; btn.textContent = "Submit Store Entry and GRN";
    }
  } catch(e) { 
    hideBlockingOverlay();
    alert("Network request execution failure: " + e.message); 
    btn.disabled = false; btn.textContent = "Submit Store Entry and GRN"; 
  }
}

window.activeQAToggle = "pending";

async function renderQARevisionSearchPanel(feed, toggleBar) {
  feed.innerHTML = toggleBar + `
    <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:14px;">
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; align-items:end;">
        <div><label class="field-label">GRN Number</label><input type="text" id="qarev-grn" placeholder="e.g. GRN-XXXX" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" /></div>
        <div style="position:relative;">
          <label class="field-label">Vendor Name</label>
          <input type="text" id="qarev-vendor" placeholder="Search vendor..." autocomplete="off" oninput="handleQARevVendorSearch(this.value)" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" />
          <div id="qarev-vendor-drop" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; max-height:180px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
        </div>
        <div><label class="field-label">Product / Item Code</label><input type="text" id="qarev-product" placeholder="Material or item code..." style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label">Q/A Date From</label><input type="date" id="qarev-date-from" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" /></div>
        <div><label class="field-label">Q/A Date To</label><input type="date" id="qarev-date-to" style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius);" /></div>
        <div><button class="nav-btn-styled" style="background:#15803d; width:100%;" onclick="runQARevisionSearch()">Search</button></div>
      </div>
    </div>
    <div id="qarev-results"></div>`;
}

let qaRevVendorDebounce = null;
async function commitStoreQAToBackend(grnNum, encodedItem, btnEl) {
  const itemData = JSON.parse(decodeURIComponent(encodedItem));
  const banner = document.getElementById('store-grn-runtime-feedback-banner');
  const btn = btnEl || event.target;

  let actionMissing = false;
  let validationError = false;
  let qaDoneMissing = false;

  itemData.lineItems.forEach((line, idx) => {
    const ok       = parseInt(document.querySelector(`.qa-ok-${grnNum}[data-idx="${idx}"]`).value, 10) || 0;
    const notOk    = parseInt(document.querySelector(`.qa-notok-${grnNum}[data-idx="${idx}"]`).value, 10) || 0;
    const reason   = document.querySelector(`.qa-reason-${grnNum}[data-idx="${idx}"]`).value.trim();
    const action   = document.querySelector(`.qa-action-${grnNum}[data-idx="${idx}"]`).value;
    const done     = document.querySelector(`.qa-done-${grnNum}[data-idx="${idx}"]`).checked;
    const itemCode = document.querySelector(`.qa-item-code-${grnNum}[data-idx="${idx}"]`).value.trim();
    const matName  = document.querySelector(`.qa-mat-name-${grnNum}[data-idx="${idx}"]`).value.trim();
    const unit     = document.querySelector(`.qa-unit-${grnNum}[data-idx="${idx}"]`).value.trim();

    if (notOk > 0 && !action) actionMissing = true;
    if (ok + notOk !== (parseInt(line.quantityReceived, 10) || 0)) validationError = true;
    if (!done) qaDoneMissing = true;

    line.okQuantity              = ok;
    line.notOkQuantity           = notOk;
    line.reasonForNotOk          = reason;
    line.actionForRejectedMaterial = action;
    // Pick up any correction made against the original invoice description
    line.itemCode      = itemCode;
    line.materialName   = matName;
    line.unitType        = unit;
  });

  banner.style.display = "none";

  if (qaDoneMissing) {
    showBOQBanner('store-grn-runtime-feedback-banner', "⚠️ Every line item must be checked off as Q/A Done before this can be submitted.", "error");
    banner.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (actionMissing) {
    showBOQBanner('store-grn-runtime-feedback-banner', "⚠️ Action for Rejected Material is compulsory for any line item with a Not OK quantity greater than zero.", "error");
    banner.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (validationError) {
    showBOQBanner('store-grn-runtime-feedback-banner', "⚠️ Quantity Balancing Violation: OK Quantity + Not OK Quantity must equal Received Quantity exactly.", "error");
    banner.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting Q/A...';

  showBlockingOverlay("Verifying Q/A...");
  try {
    const data = await apFetch({
      action: "commitStoreQAPipelineStep",
      activeEngineer: appActiveOperatorIdentityString,
      payload: { grnNumber: grnNum, vendorName: itemData.vendorName || "", lineItems: itemData.lineItems }
    });
    hideBlockingOverlay();
    if (data.success) {
      // Hide the whole queue (not just this card) until Refresh Queue is pressed.
      const feed = document.getElementById("store-grn-queue-cards-feed");
      if (feed) feed.innerHTML = "";
      banner.style.cssText = "display: block; background: #dcfce7; border-left: 4px solid #15803d; color: #15803d; padding: 20px; border-radius: var(--radius); margin-bottom:15px;";
      banner.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; text-align:left;">
          <div><strong>Success! Q/A Complete & Stock Updated.</strong></div>
          <button class="nav-btn-styled" onclick="
            document.getElementById('store-grn-runtime-feedback-banner').style.display = 'none';
            initializeStoreGrnWorkspaceQueue('pending');
          " style="background: #15803d; color: white; padding:8px 16px; font-weight:700;">Refresh Queue</button>
        </div>`;
    } else {
      alert("Server Error: " + data.error);
      btn.disabled = false; btn.textContent = "Submit Q/A & Add Stock";
    }
  } catch(e) {
    hideBlockingOverlay();
    alert("Network request execution failure: " + e.message);
    btn.disabled = false; btn.textContent = "Submit Q/A & Add Stock";
  }
}

async function commitRepairQAToBackend(grnNum, btn) {
  const banner = document.getElementById('store-grn-runtime-feedback-banner');
  banner.style.display = "none";

  const lineItems = [];
  document.querySelectorAll(`.repair-qty-${grnNum}`).forEach(inp => {
    const repairedQuantity = parseFloat(inp.value) || 0;
    if (repairedQuantity > 0) {
      lineItems.push({ rejectionId: inp.dataset.rejid, repairedQuantity: repairedQuantity });
    }
  });
  if (lineItems.length === 0) { alert("Enter at least one repaired quantity greater than zero."); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Confirming...';

  showBlockingOverlay("Confirming Repair Q/A...");
  try {
    const data = await apFetch({
      action: "commitRepairQAPipelineStep",
      activeEngineer: appActiveOperatorIdentityString,
      payload: { lineItems: lineItems }
    });
    hideBlockingOverlay();
    if (data.success) {
      const feed = document.getElementById("store-grn-queue-cards-feed");
      if (feed) feed.innerHTML = "";
      banner.style.cssText = "display: block; background: #dcfce7; border-left: 4px solid #15803d; color: #15803d; padding: 20px; border-radius: var(--radius); margin-bottom:15px;";
      banner.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; text-align:left;">
          <div><strong>Success! Repaired material returned to stock.</strong></div>
          <button class="nav-btn-styled" onclick="
            document.getElementById('store-grn-runtime-feedback-banner').style.display = 'none';
            initializeStoreGrnWorkspaceQueue('repair');
          " style="background: #15803d; color: white; padding:8px 16px; font-weight:700;">Refresh Queue</button>
        </div>`;
    } else {
      alert("Server Error: " + data.error);
      btn.disabled = false; btn.textContent = "Confirm Repair Q/A & Add to Stock";
    }
  } catch(e) {
    hideBlockingOverlay();
    alert("Network request execution failure: " + e.message);
    btn.disabled = false; btn.textContent = "Confirm Repair Q/A & Add to Stock";
  }
}

async function triggerLiveFinishedGoodsStoreStockMetricsSync() {
  // Always fetch fresh data — don't rely only on the raw materials sync cache.
  // This was previously calling pullLiveInventoryCounts (the RAW materials
  // endpoint) and reading a `finishedGoodsInventory` field that route never
  // returns, so this screen always rendered empty. The real data source is
  // getLiveFinishedGoodsInventory, a flat array of camelCase-keyed rows
  // (not grouped by department, and not the old capitalized-key row shape).
  try {
    const data = await apFetch({ action: "getLiveFinishedGoodsInventory" });
    if (data.success) {
      window.cachedFinishedGoodsStoreStockCollection = data.inventory || [];
    }
  } catch(e) {
    console.error("FG stock sync error:", e);
  }
  const cached = window.cachedFinishedGoodsStoreStockCollection;
  if (!cached) return;

  const depts = [
    { key: "reactor",   label: "Reactor",   containerId: "fg-stock-reactor-rows"   },
    { key: "capacitor", label: "Capacitor", containerId: "fg-stock-capacitor-rows" },
    { key: "panel",     label: "Panel",     containerId: "fg-stock-panel-rows"     }
  ];

  depts.forEach(dept => {
    const rows = cached.filter(row => (row.department || "").trim().toLowerCase() === dept.key);
    const container = document.getElementById(dept.containerId);
    if (!container) return;

    // Group by Project ID + Product Name + Product Rating
    const groups = {};
    rows.forEach(row => {
      const pid    = (row.projectId     || "").trim();
      const pname  = (row.productName   || "").trim();
      const prating= (row.productRating || "").trim();
      const key    = pid + "||" + pname + "||" + prating;
      if (!groups[key]) {
        groups[key] = {
          projectId:    pid,
          customerName: (row.customerName || "").trim(),
          itemCode:     (row.itemCode     || "").trim(),
          productRating:prating,
          productName:  pname,
          unit:         (row.unit || "NOS").trim(),
          jobCards:     [],
          inStock:      0
        };
      }
      // addFinishedGoodsItem always writes status = 'In Store' — there is
      // no other status transition yet, so this counts every row for now,
      // but stays correct if a "Dispatched"-style transition is added later.
      if ((row.status || "").trim() === "In Store") {
        groups[key].inStock++;
        if (row.jobCardNumber) groups[key].jobCards.push(row.jobCardNumber);
      }
    });

    const groupArr = Object.values(groups);

    if (groupArr.length === 0) {
      container.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--muted); font-size:0.82rem;">No items in ${dept.label} Finished Goods Store.</td></tr>`;
      return;
    }

    container.innerHTML = groupArr.map(g => `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:8px; font-weight:700; font-size:0.82rem;">${g.projectId}</td>
        <td style="padding:8px; font-size:0.82rem;">${g.customerName}</td>
        <td style="padding:8px; font-family:monospace; font-size:0.78rem; font-weight:700; color:var(--brand);">${g.itemCode || "—"}</td>
        <td style="padding:8px; font-size:0.82rem;">${g.productRating || "—"}</td>
        <td style="padding:8px; font-size:0.82rem;">${g.productName}</td>
        <td style="padding:8px; font-size:0.82rem;">${g.unit}</td>
        <td style="padding:8px; text-align:center; font-weight:800; font-size:0.9rem; color:${g.inStock > 0 ? "var(--accent)" : "#b91c1c"};">
          ${g.inStock}
          ${g.jobCards.length > 0 ? `<div style="font-size:0.65rem; color:var(--muted); font-weight:400; margin-top:2px;">JC: ${g.jobCards.join(", ")}</div>` : ""}
        </td>
      </tr>`).join("");
  });
}

// ═══════════════════════════════════════════════════════
// SHARED BANNER HELPER
// ═══════════════════════════════════════════════════════

async function refreshRPRNDeltaLiveStock() {
  const pending = window.rprnPendingCreate;
  if (!pending) { if (window._rprnDeltaStockInterval) clearInterval(window._rprnDeltaStockInterval); return; }
  const itemCodes = pending.lineItems.map(it => it.itemCode).filter(Boolean);
  if (itemCodes.length === 0) return;
  try {
    const data = await apFetch({ action: "fetchLiveMaterialStock", itemCodes });
    if (!data.success) return;
    document.querySelectorAll(".rprn-delta-livestock").forEach(span => {
      const code = span.dataset.itemcode;
      const s = data.stock[code.toUpperCase()] || { raw: 0, spare: 0 };
      const total = s.raw + s.spare;
      span.dataset.liveRaw = s.raw;
      span.dataset.liveSpare = s.spare;
      span.dataset.liveTotal = total;
      const tr = span.closest("tr");
      const inp = tr ? tr.querySelector(".rprn-delta-storeqty") : null;

      const isDecreaseInp = inp && inp.classList.contains("rprn-delta-decrease-storeqty");
      const isIncreaseInp = inp && inp.classList.contains("rprn-delta-increase-storeqty");
      const idxForItem = inp ? Number(inp.dataset.idx) : null;
      const itemForSpan = (idxForItem !== null && !isNaN(idxForItem)) ? pending.lineItems[idxForItem] : null;
      const addBackOwn = (isDecreaseInp || isIncreaseInp) && itemForSpan;
      const baseRaw = addBackOwn ? s.raw + (Number(itemForSpan.storeFromRaw) || 0) : s.raw;
      const baseSpare = addBackOwn ? s.spare + (Number(itemForSpan.storeFromSpare) || 0) : s.spare;
      const effectiveTotal = baseRaw + baseSpare;

      // Overwriting these with the ADD-BACK-INCLUSIVE numbers, not the
      // raw live-only ones — the input's own typing listener reads these
      // exact dataset keys for both its cap and its live split preview.
      // Storing the raw-only numbers here (as before) meant the display
      // text (computed fresh, correctly, right below) and the input's
      // actual cap/typing behavior disagreed — capping you at 50 while
      // showing 70, and re-diverging on every poll cycle.
      span.dataset.liveRaw = baseRaw;
      span.dataset.liveSpare = baseSpare;
      span.dataset.liveTotal = effectiveTotal;

      const currentVal = inp ? (Math.round((parseFloat(inp.value) || 0) * 100) / 100) : 0;
      const split = computeLiveStoreSplit(baseRaw, baseSpare, currentVal);
      span.textContent = `${split.remainingRaw + split.remainingSpare} (Raw: ${split.remainingRaw}, Spare: ${split.remainingSpare})`;
      const bufferedReqForCap = itemForSpan ? (Number(itemForSpan.bufferedRequirement) || 0) : Infinity;
      if (inp) {
        if (!inp.classList.contains("rprn-delta-decrease-storeqty")) {
          if (inp.disabled) { inp.disabled = false; inp.style.opacity = "1"; }
          const cap = Math.min(effectiveTotal, bufferedReqForCap);
          inp.max = cap;
          if (currentVal > cap) { inp.value = Math.round(cap * 100) / 100; inp.dispatchEvent(new Event("input")); }
        } else {
          // Decrease/removed rows have THREE ceilings: the requirement
          // itself (totalCovered), the NEW buffered BOQ requirement (a
          // material removed from the BOQ caps at 0), and how much can
          // genuinely be claimed beyond what this row already holds
          // (effectiveTotal — live stock + this row's own hold).
          const realCap = Math.min(totalCovered_dataset(inp), bufferedReqForCap, effectiveTotal);
          inp.max = realCap;
          if (currentVal > realCap) {
            inp.value = Math.round(realCap * 100) / 100;
            inp.dispatchEvent(new Event("input"));
          }
        }
      }
    });
  } catch(e) { /* silent, retry next interval */ }
}

// Same live raw+spare polling as Create/Auth PRN, and the same
// enforce-in-code cap — the input's `max` attribute alone does not stop
// typing, so updateRevisePRNRow also reads it back to actually block
// entering more than what's genuinely available.
async function refreshRevisePRNLiveStock() {
  const st = window.rprnState;
  if (!st) { if (window._rprnStockInterval) clearInterval(window._rprnStockInterval); return; }
  const itemCodes = st.lineItems.map(li => li.itemCode).filter(Boolean);
  if (itemCodes.length === 0) return;
  try {
    const data = await apFetch({ action: "fetchLiveMaterialStock", itemCodes });
    if (!data.success) return;
    document.querySelectorAll(".rprn-livestock").forEach(span => {
      const code = span.dataset.itemcode;
      const idx = Number(span.dataset.idx);
      const li = st.lineItems[idx];
      const s = data.stock[code.toUpperCase()] || { raw: 0, spare: 0 };

      // Add back THIS PRN's own reservation, per pool, using the exact
      // recorded split — not an assumed spare-first guess.
      const reservedRaw = li ? (Number(li.storeFromRaw) || 0) : 0;
      const reservedSpare = li ? (Number(li.storeFromSpare) || 0) : 0;
      const baseRaw = s.raw + reservedRaw;
      const baseSpare = s.spare + reservedSpare;
      const total = baseRaw + baseSpare;

      span.dataset.baseraw = baseRaw;
      span.dataset.basespare = baseSpare;
      span.dataset.reservedraw = reservedRaw;
      span.dataset.reservedspare = reservedSpare;

      const inp = document.querySelector(`.rprn-store[data-idx="${idx}"]`);
      const currentTyped = inp ? (parseFloat(inp.value) || 0) : (li ? Number(li.storeQty) || 0 : 0);
      const disp = computeRevisePRNStoreDisplay(baseRaw, baseSpare, reservedRaw, reservedSpare, currentTyped);
      span.textContent = `${disp.remainingRaw + disp.remainingSpare} (Raw: ${disp.remainingRaw}, Spare: ${disp.remainingSpare})`;

      if (inp && li) {
        const requirementCap = Number(li.bufferedRequirement) || 0;
        const cap = Math.min(requirementCap, total);
        inp.max = cap;
        if (currentTyped > cap) { inp.value = Math.round(cap * 100) / 100; updateRevisePRNRow(idx); }
      }
    });
  } catch (e) { /* silent — quantities still editable without this */ }
}

function updateRevisePRNRow(idx) {
  const st = window.rprnState;
  const li = st.lineItems[idx];
  const inp = document.querySelector(`.rprn-store[data-idx="${idx}"]`);
  const req = Number(li.bufferedRequirement) || 0;
  const onOrder = Number(li.onOrderQty) || 0;
  // `max` alone does not stop typing — read it back and cap in code,
  // same enforcement pattern as Create/Authorize PRN.
  const liveMax = inp.max !== '' ? Number(inp.max) : req;
  const cap = Math.min(req, isNaN(liveMax) ? req : liveMax);
  let store = parseFloat(inp.value) || 0;
  if (store > cap) { store = cap; inp.value = store; }
  const rawPurchase = Math.max(0, req - store);
  const isCountUnit = (li.unit || "").toString().trim().toUpperCase() === "NOS";
  const newPurchase = isCountUnit ? Math.ceil(rawPurchase - 1e-9) : rawPurchase;
  const cell = document.getElementById(`rprn-newpurch-${idx}`);
  const bad = newPurchase < onOrder - 1e-9 || store > req + 1e-9;
  inp.style.borderColor = bad ? "#b91c1c" : "var(--brand)";
  cell.style.color = bad ? "#b91c1c" : (Math.abs(newPurchase - (Number(li.purchaseQty)||0)) > 1e-9 ? "#15803d" : "#1a2332");
  cell.textContent = newPurchase.toLocaleString("en-IN",{maximumFractionDigits:2})
    + (newPurchase < onOrder - 1e-9 ? `  (below ${onOrder} on order)` : "");

  // Live-update "Store Available Stock" as the typed quantity changes —
  // spare-first on increase, raw-first release on decrease, matching
  // exactly how the backend will actually reserve/release it on submit.
  const stockSpan = document.querySelector(`.rprn-livestock[data-idx="${idx}"]`);
  if (stockSpan && stockSpan.dataset.baseraw !== undefined) {
    const baseRaw = Number(stockSpan.dataset.baseraw) || 0;
    const baseSpare = Number(stockSpan.dataset.basespare) || 0;
    const reservedRaw = Number(stockSpan.dataset.reservedraw) || 0;
    const reservedSpare = Number(stockSpan.dataset.reservedspare) || 0;
    const disp = computeRevisePRNStoreDisplay(baseRaw, baseSpare, reservedRaw, reservedSpare, store);
    stockSpan.textContent = `${disp.remainingRaw + disp.remainingSpare} (Raw: ${disp.remainingRaw}, Spare: ${disp.remainingSpare})`;
  }
}

async function refreshAPRNLiveStock() {
  const itemCodes = aprnRows.map(r => r.itemCode).filter(Boolean);
  if (itemCodes.length === 0) return;
  try {
    const data = await apFetch({ action: "fetchLiveMaterialStock", itemCodes });
    if (!data.success) return;
    document.querySelectorAll(".aprn-livestock").forEach(span => {
      const code = span.dataset.itemcode;
      const s = data.stock[code.toUpperCase()] || { raw: 0, spare: 0 };
      const tr = span.closest("tr");
      const inp = tr ? tr.querySelector(".aprn-storeqty") : null;
      const idx = inp ? Number(inp.dataset.idx) : null;
      const row = (idx !== null && !isNaN(idx)) ? aprnRows[idx] : null;

      // What THIS pending PRN already holds counts as available TO
      // ITSELF — otherwise the screen would show almost nothing free and
      // force the input down to whatever tiny amount happens to still be
      // genuinely unclaimed, even though the full claim is still
      // legitimately this PRN's to keep or edit. For a Delta PRN's
      // new/increase rows, that claim hasn't been applied to the live
      // pool yet (it only lands at authorize), so the DELTA is what's
      // missing and gets added back. For a resplit revision row, the
      // opposite is true — its claim/release already executed immediately
      // at submission, so the live pool already reflects it; adding the
      // delta back again would double-count a claim or double-release a
      // release. Resplit rows carry the ABSOLUTE current split
      // (newStoreFromRaw/newStoreFromSpare) for exactly this reason.
      const isResplitRow = row && row.changeKind === 'resplit';
      const ownRaw = row ? (isResplitRow ? (Number(row.newStoreFromRaw) || 0) : (Number(row.storeFromRaw) || 0)) : 0;
      const ownSpare = row ? (isResplitRow ? (Number(row.newStoreFromSpare) || 0) : (Number(row.storeFromSpare) || 0)) : 0;
      const baseRaw = s.raw + ownRaw;
      const baseSpare = s.spare + ownSpare;
      const total = baseRaw + baseSpare;

      span.dataset.baseraw = baseRaw;
      span.dataset.basespare = baseSpare;

      const currentTyped = inp ? (parseFloat(inp.value) || 0) : 0;
      const split = isResplitRow
        ? computeRevisePRNStoreDisplay(baseRaw, baseSpare, ownRaw, ownSpare, currentTyped)
        : computeLiveStoreSplit(baseRaw, baseSpare, currentTyped);
      span.textContent = `${split.remainingRaw + split.remainingSpare} (Raw: ${split.remainingRaw}, Spare: ${split.remainingSpare})`;

      if (inp) {
        const requirementCap = row
          ? (row.editable !== false ? (Number(row.bufferedRequirement) || 0) : ((Number(row.previousStoreQty) || 0) + (Number(row.previousPurchaseQty) || 0)))
          : Infinity;
        const cap = Math.min(requirementCap, total);
        inp.max = cap;
        if (currentTyped > cap) {
          inp.value = Math.round(cap * 100) / 100;
          updateAPRNRow(idx, inp.value, window.aprnExpandedId);
        }
      }
    });
  } catch (e) { /* silent — quantities still editable without this */ }
}

// Recompute purchase qty exactly as the backend does, so what the
// authorizer sees is what gets committed.
function updateAPRNRow(idx, value, prnId) {
  const row = aprnRows[idx];
  if (!row) return;
  const isDecreaseRow = row.changeKind === 'decrease' || row.changeKind === 'removed';
  const totalCovered = (Number(row.previousStoreQty) || 0) + (Number(row.previousPurchaseQty) || 0);
  const buffered = Number(row.bufferedRequirement) || 0;
  const staticCap = isDecreaseRow ? Math.min(totalCovered, buffered) : buffered;
  const inputEl = document.querySelector(`.aprn-storeqty[data-idx="${idx}"]`);
  const liveMax = inputEl && inputEl.max !== '' ? Number(inputEl.max) : staticCap;
  const cap = Math.min(staticCap, isNaN(liveMax) ? staticCap : liveMax);
  let storeQty = parseFloat(value) || 0;
  if (storeQty < 0) storeQty = 0;
  if (storeQty > cap) storeQty = cap;
  if (inputEl) inputEl.value = storeQty;
  row.currentUnassignedStoreQty = storeQty;
  const isCountUnit = (row.unit || "").toString().trim().toUpperCase() === "NOS";
  const cell = document.getElementById(`aprn-purchaseqty-${idx}`);
  // Recomputed against the true buffered BOQ requirement even for
  // deferred rows — the actual purchase_quantity DB field stays locked
  // until the PO is revised, but this preview reflects what's really
  // needed now, same as the Revise PRN screen.
  const raw = Math.max(0, buffered - storeQty);
  row.purchaseQty = isCountUnit ? Math.ceil(raw - 1e-9) : raw;
  if (cell) {
    cell.textContent = trimNum(row.purchaseQty);
    // Green once the authorizer's live edit actually moves this row away
    // from what was originally submitted for review; black if it still
    // matches. Editable rows' original value is purchaseDelta (what the
    // initial cell rendered); non-editable rows' is newPurchaseTotal.
    const originalVal = row.editable !== false ? (Number(row.purchaseDelta) || 0) : (Number(row.newPurchaseTotal) || 0);
    const stillMatchesOriginal = Math.abs(Number(row.purchaseQty) - originalVal) < 1e-9;
    cell.style.color = stillMatchesOriginal ? "#1a2332" : "#15803d";
  }

  // Live-update "Store Available Stock" as the typed quantity changes —
  // spare is consumed first, matching exactly how the backend reserves
  // it on submit, so what's shown updating is what will really happen.
  const tr = inputEl ? inputEl.closest("tr") : null;
  const stockSpan = tr ? tr.querySelector(".aprn-livestock") : null;
  if (stockSpan && stockSpan.dataset.baseraw !== undefined) {
    const baseRaw = Number(stockSpan.dataset.baseraw) || 0;
    const baseSpare = Number(stockSpan.dataset.basespare) || 0;
    // Resplit rows: raw-first release / spare-first extra-claim, same
    // formula Revise PRN's own preview uses and what the backend now
    // actually commits — NOT the generic spare-first-claim formula
    // (computeLiveStoreSplit) Delta PRN rows use, which assumes a fresh
    // claim rather than an edit against an existing specific split.
    const split = row.changeKind === 'resplit'
      ? computeRevisePRNStoreDisplay(baseRaw, baseSpare, Number(row.newStoreFromRaw) || 0, Number(row.newStoreFromSpare) || 0, storeQty)
      : computeLiveStoreSplit(baseRaw, baseSpare, storeQty);
    stockSpan.textContent = `${split.remainingRaw + split.remainingSpare} (Raw: ${split.remainingRaw}, Spare: ${split.remainingSpare})`;
  }
}

async function refreshPRNCreateLiveStock() {
  const pending = window.prnPendingCreate;
  if (!pending) { if (window._prnCreateStockInterval) clearInterval(window._prnCreateStockInterval); return; }
  const itemCodes = pending.lineItems.map(it => it.itemCode).filter(Boolean);
  if (itemCodes.length === 0) return;
  try {
    const data = await apFetch({ action: "fetchLiveMaterialStock", itemCodes });
    if (!data.success) return;
    document.querySelectorAll(".prn-create-livestock").forEach(span => {
      const code = span.dataset.itemcode;
      const s = data.stock[code.toUpperCase()] || { raw: 0, spare: 0 };
      const total = s.raw + s.spare;
      span.dataset.liveRaw = s.raw;
      span.dataset.liveSpare = s.spare;
      span.dataset.liveTotal = total;
      const tr = span.closest("tr");
      const inp = tr ? tr.querySelector(".prn-create-storeqty") : null;
      const currentVal = inp ? (Math.round((parseFloat(inp.value) || 0) * 100) / 100) : 0;
      // Decrease/removed rows already hold their pre-filled amount from
      // this PRN's PRIOR authorization — that's not a new claim being
      // made, so it needs adding back to the live pool before simulating
      // "what happens if the typed amount is claimed", same as Revise
      // PRN/Authorize PRN already do for their own equivalent rows.
      const isDecreaseInp = inp && inp.classList.contains("prn-create-decrease-storeqty");
      const isIncreaseInp = inp && inp.classList.contains("prn-create-increase-storeqty");
      const idxForItem = inp ? Number(inp.dataset.idx) : null;
      const itemForSpan = (idxForItem !== null && !isNaN(idxForItem)) ? pending.lineItems[idxForItem] : null;
      const addBackOwn = (isDecreaseInp || isIncreaseInp) && itemForSpan;
      const baseRaw = addBackOwn ? s.raw + (Number(itemForSpan.storeFromRaw) || 0) : s.raw;
      const baseSpare = addBackOwn ? s.spare + (Number(itemForSpan.storeFromSpare) || 0) : s.spare;
      const effectiveTotal = baseRaw + baseSpare;
      // Overwriting with the ADD-BACK-INCLUSIVE numbers — the dataset
      // values were set above from s.raw/s.spare/total (live-pool-only,
      // BEFORE this row's own held stock gets added back), so the cap
      // logic below and any other reader of these same dataset keys was
      // silently disagreeing with the "remaining" text this function
      // itself displays two lines down.
      span.dataset.liveRaw = baseRaw;
      span.dataset.liveSpare = baseSpare;
      span.dataset.liveTotal = effectiveTotal;
      const split = computeLiveStoreSplit(baseRaw, baseSpare, currentVal);
      span.textContent = `${split.remainingRaw + split.remainingSpare} (Raw: ${split.remainingRaw}, Spare: ${split.remainingSpare})`;
      const bufferedReqForCap = itemForSpan ? (Number(itemForSpan.bufferedRequirement) || 0) : Infinity;
      if (inp) {
        if (!inp.classList.contains("prn-create-decrease-storeqty")) {
          if (inp.disabled) { inp.disabled = false; inp.style.opacity = "1"; }
          const cap = Math.min(effectiveTotal, bufferedReqForCap);
          inp.max = cap;
          if (currentVal > cap) { inp.value = Math.round(cap * 100) / 100; inp.dispatchEvent(new Event("input")); }
        }
      }
    });
  } catch(e) { /* silent, retry next interval */ }
}

function updatePRNDecreaseRowPurchaseQty(idx, input) {
  const totalCovered = parseFloat(input.dataset.totalCovered) || 0;
  const item = window.prnPendingCreate.lineItems[idx];
  const bufferedReq = Number(item.bufferedRequirement) || 0;
  const liveSpan = document.querySelector(`.prn-create-livestock[data-itemcode="${item.itemCode}"]`);
  const liveCap = (liveSpan && liveSpan.dataset.liveTotal !== undefined) ? Number(liveSpan.dataset.liveTotal) : totalCovered;
  const realCap = Math.min(totalCovered, bufferedReq, isNaN(liveCap) ? totalCovered : liveCap);
  let val = parseFloat(input.value) || 0;
  if (val < 0) { val = 0; input.value = "0"; }
  if (val > realCap) { val = Math.round(realCap * 100) / 100; input.value = val; }
  const purchaseCell = document.getElementById(`prn-create-purchaseqty-${idx}`);
  if (!purchaseCell) return;
  const purchaseQty = Math.max(0, bufferedReq - val);
  const rounded = item.isCountUnit ? Math.ceil(purchaseQty - 1e-9) : purchaseQty;
  purchaseCell.textContent = trimNum(rounded);
}

async function refreshPRNLiveStock() {
  if (!prnCurrentData || !prnCurrentData.lineItems) return;
  const itemCodes = prnCurrentData.lineItems.map(it => it.itemCode).filter(Boolean);
  if (itemCodes.length === 0) return;
  try {
    const data = await apFetch({ action: "fetchLiveMaterialStock", itemCodes });
    if (!data.success) return;
    document.querySelectorAll(".prn-livestock-total").forEach(span => {
      const code = span.dataset.itemcode;
      const s = data.stock[code.toUpperCase()] || { raw: 0, spare: 0 };
      const total = s.raw + s.spare;
      span.textContent = `${total} (Raw: ${s.raw}, Spare: ${s.spare})`;
      span.dataset.liveTotal = total;

      // If the currently entered Store Quantity exceeds the new live stock, clamp it down
      const idxAttr = span.closest("tr")?.querySelector(".prn-store-qty-input");
      if (idxAttr) {
        if (idxAttr.disabled) { idxAttr.disabled = false; idxAttr.style.opacity = "1"; }
        const currentVal = parseFloat(idxAttr.value) || 0;
        if (currentVal > total) {
          idxAttr.value = total;
          idxAttr.dispatchEvent(new Event("input"));
        }
        idxAttr.max = total;
      }
    });
  } catch(e) { /* silent fail, retry on next interval */ }
}

function updatePRNPurchaseQtyCell(inputEl, idx) {
  if (!prnCurrentData || !prnCurrentData.lineItems[idx]) return;
  // Round to 2dp defensively — floating point math upstream (e.g. 48 * 1.16) can produce
  // values like 55.67999999999999 instead of 55.68, which would otherwise silently clamp
  // a user's valid, exact-match entry down to an ugly long-decimal value.
  const bufferedQty = Math.round((Number(prnCurrentData.lineItems[idx].bufferedPurchaseQty) || 0) * 100) / 100;
  const liveStockSpan = document.querySelector(`.prn-livestock-total[data-itemcode="${prnCurrentData.lineItems[idx].itemCode}"]`);
  // Default to 0 (not Infinity) until live stock has actually loaded, so nothing can be over-entered in the gap
  const liveStockMax  = (liveStockSpan && liveStockSpan.dataset.liveTotal !== undefined) ? (Number(liveStockSpan.dataset.liveTotal) || 0) : 0;
  const cap = Math.round(Math.min(bufferedQty, liveStockMax) * 100) / 100;

  let storeQty = Math.round((parseFloat(inputEl.value) || 0) * 100) / 100;
  if (storeQty > cap) {
    storeQty = cap;
    inputEl.value = storeQty;
    inputEl.style.border = "1.5px solid #ef4444";
  } else {
    inputEl.style.border = "1.5px solid var(--brand)";
  }
  const purchaseQty = Math.max(0, bufferedQty - storeQty);
  prnCurrentData.lineItems[idx].currentUnassignedStoreQty = storeQty;
  const cell = document.getElementById(`prn-purchase-qty-cell-${idx}`);
  if (cell) { cell.textContent = Number.isInteger(purchaseQty) ? String(purchaseQty) : purchaseQty.toFixed(2); cell.style.color = "#1a2332"; }
}

async function showStockAssignmentBreakdownModal(itemCode, materialName, unit, availableQty, storeType) {
  const existing = document.getElementById("stock-assignment-breakdown-modal-overlay");
  if (existing) existing.remove();

  const unitLabel = (unit || "NOS").toUpperCase();
  const modal = document.createElement("div");
  modal.id = "stock-assignment-breakdown-modal-overlay";
  modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;";
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:#fff;border-radius:var(--radius);padding:24px;max-width:680px;width:92%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;border-bottom:2px solid var(--border);padding-bottom:12px;">
        <div>
          <div style="font-size:1rem;font-weight:800;color:var(--brand);">${materialName}</div>
          <div style="font-size:0.78rem;color:var(--muted);margin-top:3px;">Item Code: <strong>${itemCode}</strong></div>
        </div>
        <button onclick="document.getElementById('stock-assignment-breakdown-modal-overlay').remove()" style="background:transparent;border:none;font-size:1.3rem;line-height:1;color:var(--muted);cursor:pointer;padding:0 0 0 10px;">&times;</button>
      </div>
      <div id="stock-assignment-breakdown-body">
        <div style="text-align:center; padding:20px; color:var(--muted);"><div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>Loading breakdown...</div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const body = document.getElementById("stock-assignment-breakdown-body");
  try {
    const data = await apFetch({ action: "fetchStockAssignmentBreakdown", itemCode, storeType });
    if (!data.success) { body.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }
    const rows = data.breakdown || [];
    const rowsHtml = rows.length === 0
      ? `<tr><td colspan="2" style="padding:14px; text-align:center; color:var(--muted); font-size:0.85rem;">No stock currently claimed by a BOQ.</td></tr>`
      : rows.map(r => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px 6px; font-size:0.85rem; font-weight:600; color:#334155;">${r.boqId}</td>
            <td style="padding:8px 6px; text-align:right; font-family:monospace; font-size:0.95rem; font-weight:800; color:#b45309;">${(Math.round(r.assignedQty * 100) / 100).toString()} <span style="font-size:0.7rem; font-weight:700; color:var(--muted);">${unitLabel}</span></td>
          </tr>`).join("");
    body.innerHTML = `
      <table style="width:100%; border-collapse:collapse; table-layout:fixed; margin-bottom:16px;">
        <colgroup><col style="width:70%;"><col style="width:30%;"></colgroup>
        <tbody>
          <tr style="background:#f0fdf4;">
            <td style="padding:10px 6px; font-size:0.85rem; font-weight:800; color:#15803d;">Available (unassigned)</td>
            <td style="padding:10px 6px; text-align:right; font-family:monospace; font-size:0.95rem; font-weight:800; color:#15803d;">${(Math.round((availableQty || 0) * 100) / 100).toString()} <span style="font-size:0.7rem; font-weight:700; color:var(--muted);">${unitLabel}</span></td>
          </tr>
        </tbody>
      </table>
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
        <colgroup><col style="width:70%;"><col style="width:30%;"></colgroup>
        <thead>
          <tr style="text-align:left; border-bottom:2px solid var(--border);">
            <th style="padding:6px; font-size:0.72rem; text-transform:uppercase; color:var(--muted); letter-spacing:0.5px;">BOQ ID</th>
            <th style="padding:6px; text-align:right; font-size:0.72rem; text-transform:uppercase; color:var(--muted); letter-spacing:0.5px;">Reserved Qty</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  } catch(e) {
    body.innerHTML = `<p style="color:var(--warn);">${e.message}</p>`;
  }
}

// ═══════════════════════════════════════════════════════
// RAW MATERIAL PO UPLOAD
// ═══════════════════════════════════════════════════════

let targetRMPOFileObj       = null;
let activeParsedRMPOPayload = null;

function handleAssStockSearch(query) {
  const dropdown = document.getElementById("ass-material-dropdown");
  if (!query || query.trim().length < 1) { dropdown.style.display = "none"; return; }
  const catalog = window.itemCodeCatalogCache || [];
  const q = query.toLowerCase();
  const combinedLabel = (item) => item.rating ? `${item.productName} - ${item.rating}` : item.productName;
  const matches = catalog.filter(item => combinedLabel(item).toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dropdown.style.display = "none"; return; }
  dropdown.innerHTML = matches.map(item => `
    <div onclick="loadAssStockForItem('${item.itemCode}', \`${combinedLabel(item).replace(/`/g,"'")}\`)"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:8px;">${item.itemCode}</span>${combinedLabel(item)}
    </div>`).join("");
  dropdown.style.display = "block";
}

let assStockCache = { itemCode: "", materialName: "", totals: { totalStock: 0, reservedStock: 0, availableStock: 0 }, assignments: [] };

async function loadAssStockForItem(itemCode, materialName) {
  document.getElementById("ass-material-search").value = materialName;
  document.getElementById("ass-material-dropdown").style.display = "none";
  document.getElementById("ass-results-zone").style.display = "block";
  document.getElementById("ass-material-title").textContent = itemCode + ": " + materialName;
  document.getElementById("ass-results-body").innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center;">Loading...</td></tr>';
  try {
    const data = await apFetch({ action: "fetchStockAssignmentsForItem", itemCode });
    if (!data.success) { showBOQBanner("ass-feedback", data.error || "Failed to load.", "error"); return; }
    assStockCache = { ...data, materialName };
    renderAssStockRows();
  } catch(e) {
    showBOQBanner("ass-feedback", "Network error: " + e.message, "error");
  }
}

function renderAssStockRows() {
  const body = document.getElementById("ass-results-body");
  updateAssSummaryDisplay();
  if (assStockCache.assignments.length === 0) {
    body.innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center; color:var(--muted);">No BOQ currently holds reserved stock for this material.</td></tr>';
    return;
  }
  const unit = (assStockCache.totals && assStockCache.totals.unitType) || "";
  body.innerHTML = assStockCache.assignments.map((a, i) => `
    <tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px; word-break:break-word; white-space:normal;">${a.boqId}</td>
      <td style="padding:8px; text-align:center; vertical-align:middle;">${unit}</td>
      <td style="padding:8px; text-align:center; vertical-align:middle;">${a.numberOfJobCards != null ? trimNum(a.numberOfJobCards) : '—'}</td>
      <td style="padding:8px; text-align:center; vertical-align:middle; font-weight:700;">${trimNum(a.assignedQty)}</td>
      <td style="padding:8px; text-align:center; vertical-align:middle;">
        <input type="number" min="0" step="any" data-row="${i}" value="${trimNum(a.assignedQty)}"
          oninput="handleAssReservedInputChange()"
          style="width:100px; padding:5px; border:1.5px solid var(--brand); border-radius:3px; text-align:center;" />
      </td>
    </tr>`).join("");
}

function updateAssSummaryDisplay() {
  document.getElementById("ass-total-stock").textContent = trimNum(assStockCache.totals.totalStock);
  document.getElementById("ass-reserved-stock").textContent = trimNum(assStockCache.totals.reservedStock);
  document.getElementById("ass-available-stock").textContent = trimNum(assStockCache.totals.availableStock);
}

function handleAssReservedInputChange() {
  const inputs = document.querySelectorAll('#ass-results-body input[data-row]');
  let originalVisibleTotal = 0, newVisibleTotal = 0;
  inputs.forEach(inp => {
    const row = assStockCache.assignments[Number(inp.dataset.row)];
    originalVisibleTotal += Number(row.assignedQty) || 0;
    newVisibleTotal += parseFloat(inp.value) || 0;
  });
  const totalStock = Number(assStockCache.totals.totalStock) || 0;
  const baseReserved = Number(assStockCache.totals.reservedStock) || 0;
  const projectedReserved = baseReserved - originalVisibleTotal + newVisibleTotal;
  document.getElementById("ass-reserved-stock").textContent = trimNum(projectedReserved);
  document.getElementById("ass-available-stock").textContent = trimNum(totalStock - projectedReserved);
}

function showAssReservationSuccess(materialName) {
  document.getElementById("ass-results-zone").style.display = "none";
  const feedback = document.getElementById("ass-feedback");
  feedback.style.display = "block";
  feedback.innerHTML = `<div style="padding:12px; border-left:4px solid #22c55e; background:#f0fdf4; border-radius:var(--radius); color:#15803d; font-weight:600;">Reservation changed Successfully for ${materialName}</div>
    <button id="ass-reserve-another-btn" class="nav-btn-styled" style="margin-top:10px; background:var(--brand); padding:8px 18px; font-weight:700;" onclick="resetAssReservationPanel()">+ Reserve Another Store Stock</button>`;
}

function resetAssReservationPanel() {
  document.getElementById("ass-feedback").style.display = "none";
  document.getElementById("ass-feedback").innerHTML = "";
  document.getElementById("ass-results-zone").style.display = "none";
  document.getElementById("ass-material-search").value = "";
  document.getElementById("ass-material-title").textContent = "";
  assStockCache = { itemCode: "", materialName: "", totals: { totalStock: 0, reservedStock: 0, availableStock: 0, unitType: '' }, assignments: [] };
}

async function initializeAssignCurrentStockPanel() {
  document.getElementById("ass-feedback").style.display = "none";
  document.getElementById("ass-results-zone").style.display = "none";
  document.getElementById("ass-material-search").value = "";
  document.getElementById("ass-material-dropdown").style.display = "none";
  assStockCache = { itemCode: "", materialName: "", totals: { totalStock: 0, reservedStock: 0, availableStock: 0 }, assignments: [] };
}

// ═══════════════════════════════════════════════════════
// EXPECTED Deliveries
// ═══════════════════════════════════════════════════════

let expectedInboundsFilterMode = "all";

function initializeExpectedInboundsPanel() {
  document.getElementById("expected-inbounds-feedback").style.display = "none";
  setExpectedInboundsFilter("7");
}

function setExpectedInboundsFilter(mode) {
  expectedInboundsFilterMode = mode;
  document.querySelectorAll(".ei-filter-btn").forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.style.background  = active ? "var(--brand)" : "#fff";
    btn.style.color       = active ? "#fff" : "var(--text)";
    btn.style.borderColor = active ? "var(--brand)" : "var(--border)";
  });
  if (mode === "delivered") renderDeliveredSearchPanel();
  else loadExpectedInbounds();
}

function renderDeliveredSearchPanel() {
  window.eiDelivSelectedItemCode = null;
  const zone = document.getElementById("expected-inbounds-results");
  zone.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-bottom:18px; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:14px;">
      <div style="position:relative;">
        <label class="field-label" style="margin-top:0; color:var(--brand);">PO Number</label>
        <input type="text" id="ei-deliv-po-input" placeholder="e.g. PO_26-27_00001" autocomplete="off" oninput="handleEiDelivPOInput(this.value)" onkeydown="if(event.key==='Enter')runEiDelivPOSearch()" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        <div id="ei-deliv-po-dd" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:220px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
        <button class="nav-btn-styled" onclick="runEiDelivPOSearch()" style="margin-top:8px; background:var(--accent); color:#fff; font-weight:700; padding:7px 16px; width:100%;">Search</button>
      </div>
      <div style="position:relative;">
        <label class="field-label" style="margin-top:0; color:var(--brand);">Material Name</label>
        <input type="text" id="ei-deliv-material-input" placeholder="Start typing material name..." autocomplete="off" oninput="handleEiDelivMaterialInput(this.value)" onkeydown="if(event.key==='Enter')runEiDelivMaterialSearch()" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        <div id="ei-deliv-material-dd" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:220px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
        <button class="nav-btn-styled" onclick="runEiDelivMaterialSearch()" style="margin-top:8px; background:var(--accent); color:#fff; font-weight:700; padding:7px 16px; width:100%;">Search</button>
      </div>
      <div style="position:relative;">
        <label class="field-label" style="margin-top:0; color:var(--brand);">Vendor Name</label>
        <input type="text" id="ei-deliv-vendor-input" placeholder="Start typing vendor name..." autocomplete="off" oninput="handleEiDelivVendorInput(this.value)" onkeydown="if(event.key==='Enter')runEiDelivVendorSearch()" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        <div id="ei-deliv-vendor-dd" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:220px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
        <button class="nav-btn-styled" onclick="runEiDelivVendorSearch()" style="margin-top:8px; background:var(--accent); color:#fff; font-weight:700; padding:7px 16px; width:100%;">Search</button>
      </div>
    </div>
    <div id="ei-deliv-search-label" style="display:none; font-weight:700; color:var(--brand); margin-bottom:10px; font-size:0.9rem;"></div>
    <div id="ei-delivered-results" style="display:flex; flex-direction:column; gap:16px;"></div>`;
  loadItemCodeCatalogIntoCache();
}

let eiDelivPODebounce = null;
function handleEiDelivPOInput(query) {
  clearTimeout(eiDelivPODebounce);
  const dd = document.getElementById("ei-deliv-po-dd");
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  eiDelivPODebounce = setTimeout(async () => {
    try {
      const data = await apFetch({ action: "searchPONumbersForExpectedDeliveries", query });
      if (!dd) return;
      if (!data.success || !data.results.length) { dd.style.display = "none"; return; }
      dd.innerHTML = data.results.map(r => `
        <div onclick="document.getElementById('ei-deliv-po-input').value='${r.poNo.replace(/'/g,"\\'")}'; document.getElementById('ei-deliv-po-dd').style.display='none';"
          style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
          onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
          <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:6px;">${r.poNo}</span>${r.vendorName || ''}
        </div>`).join("");
      dd.style.display = "block";
    } catch(e) { dd.style.display = "none"; }
  }, 250);
}

function handleEiDelivMaterialInput(query) {
  window.eiDelivSelectedItemCode = null;
  const dd = document.getElementById("ei-deliv-material-dd");
  const catalog = window.itemCodeCatalogCache || [];
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.toLowerCase();
  const matches = catalog.filter(it => (it.productName||"").toLowerCase().includes(q) || (it.rating||"").toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(it => `
    <div onclick="selectEiDelivMaterial(\`${(it.productName||'').replace(/\`/g,"'")}\`, \`${(it.rating||'').replace(/\`/g,"'")}\`)"
      style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:6px;">${it.itemCode}</span>${it.productName}${it.rating ? ` - <span style="color:var(--brand); font-weight:700;">${it.rating}</span>` : ''}
    </div>`).join("");
  dd.style.display = "block";
}

function selectEiDelivMaterial(productName, rating) {
  document.getElementById("ei-deliv-material-input").value = rating ? `${productName} - ${rating}` : productName;
  document.getElementById("ei-deliv-material-dd").style.display = "none";
}

let eiDelivVendorDebounce = null;
function handleEiDelivVendorInput(query) {
  clearTimeout(eiDelivVendorDebounce);
  const dd = document.getElementById("ei-deliv-vendor-dd");
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  eiDelivVendorDebounce = setTimeout(async () => {
    try {
      const data = await apFetch({ action: "searchVendorNamesForExpectedDeliveries", query });
      if (!dd) return;
      if (!data.success || !data.vendors.length) { dd.style.display = "none"; return; }
      dd.innerHTML = data.vendors.map(v => `
        <div onclick="document.getElementById('ei-deliv-vendor-input').value='${v.replace(/'/g,"\\'")}'; document.getElementById('ei-deliv-vendor-dd').style.display='none';"
          style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
          onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${v}</div>`).join("");
      dd.style.display = "block";
    } catch(e) { dd.style.display = "none"; }
  }, 250);
}

function eiDelivSetSearchingLabel(text) {
  const el = document.getElementById("ei-deliv-search-label");
  if (!el) return;
  el.textContent = text;
  el.style.display = "block";
}

async function eiDelivRunSearch(params, label) {
  eiDelivSetSearchingLabel(label);
  const results = document.getElementById("ei-delivered-results");
  results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Searching...</div>`;
  try {
    const data = await apFetch({ action: "fetchExpectedDeliveries", filterMode: "delivered", ...params });
    if (!data.success) { results.innerHTML = `<div style="color:var(--warn); padding:12px;">${data.error}</div>`; return; }
    if (!data.delivered || data.delivered.length === 0) {
      results.innerHTML = `<div style="text-align:center;padding:30px;color:var(--muted);background:#fff;border:1px solid var(--border);border-radius:6px;">No delivered POs match.</div>`;
      return;
    }
    results.innerHTML = "";
    const schemeDelivered = { sectionBg: "#f0fdf4", sectionBorder: "#86efac", headerColor: "#15803d", badgeBg: "#dcfce7", badgeColor: "#15803d", icon: "✅" };
    results.appendChild(renderExpectedInboundsSection("Delivered", data.delivered, schemeDelivered));
  } catch(e) {
    results.innerHTML = `<div style="color:var(--warn); padding:12px;">Network error: ${e.message}</div>`;
  }
}

function runEiDelivPOSearch() {
  const q = document.getElementById("ei-deliv-po-input").value.trim();
  if (!q) return;
  eiDelivRunSearch({ poNumber: q }, `Searching for "${q}"`);
}

function runEiDelivMaterialSearch() {
  const q = document.getElementById("ei-deliv-material-input").value.trim();
  if (!q) return;
  eiDelivRunSearch({ materialName: q }, `Searching for "${q}"`);
}

function runEiDelivVendorSearch() {
  const q = document.getElementById("ei-deliv-vendor-input").value.trim();
  if (!q) return;
  eiDelivRunSearch({ vendorName: q }, `Searching for "${q}"`);
}

async function loadExpectedInbounds() {
  const zone = document.getElementById("expected-inbounds-results");
  zone.innerHTML = `<div style="text-align:center; padding:30px; color:var(--brand); font-weight:600;">
    <div class="spinner" style="display:inline-block; width:18px; height:18px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:10px; vertical-align:middle;"></div>
    Loading Expected Deliveries...
  </div>`;

  try {
    const data = await apFetch({ action: "fetchExpectedDeliveries", filterMode: expectedInboundsFilterMode });
    if (!data.success) {
      zone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">${data.error}</div>`;
      return;
    }

    zone.innerHTML = "";
    const totalCount = (data.today || []).length + (data.overdue || []).length + (data.upcoming || []).length;

    if (totalCount === 0) {
      zone.innerHTML = `<div style="text-align:center; padding:40px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); color:var(--muted);">
        <div style="font-size:2.5rem; margin-bottom:12px;">📦</div>
        <div style="font-weight:700; color:var(--accent); font-size:0.95rem;">No Pending Deliveries</div>
      </div>`;
      return;
    }

    const schemeDueToday = { sectionBg: "#fff7ed", sectionBorder: "#f59e0b", headerColor: "#b45309", badgeBg: "#fef3c7", badgeColor: "#b45309", icon: "🕐" };
    const schemeOverdue  = { sectionBg: "#fff5f5", sectionBorder: "#fca5a5", headerColor: "#b91c1c", badgeBg: "#fee2e2", badgeColor: "#b91c1c", icon: "🚨" };
    const schemeUpcoming = { sectionBg: "#f0fdf4", sectionBorder: "#86efac", headerColor: "#15803d", badgeBg: "#dcfce7", badgeColor: "#15803d", icon: "📅" };

    // Overdue/Today called out first regardless of window; Upcoming is already
    // sorted ascending by daysRemaining from the backend.
    if ((data.overdue || []).length > 0)  zone.appendChild(renderExpectedInboundsSection("Overdue",   data.overdue,  schemeOverdue));
    if ((data.today || []).length > 0)    zone.appendChild(renderExpectedInboundsSection("Due Today", data.today,    schemeDueToday));
    if ((data.upcoming || []).length > 0) zone.appendChild(renderExpectedInboundsSection("Upcoming",  data.upcoming, schemeUpcoming));

  } catch(e) {
    zone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Network error: ${e.message}</div>`;
  }
}

function renderExpectedInboundsSection(title, poList, scheme) {
  const sectionEl = document.createElement("div");
  sectionEl.style.cssText = `background:#fff; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;`;

  const safeSectionId = "ei-section-" + title.replace(/\s+/g, "_").toLowerCase();

  sectionEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:${scheme.sectionBg}; border-bottom:1.5px solid ${scheme.sectionBorder};">
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:1.1rem;">${scheme.icon}</span>
        <span style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:${scheme.headerColor}; letter-spacing:0.5px;">${title}</span>
        <span style="font-size:0.72rem; font-weight:700; background:${scheme.badgeBg}; color:${scheme.badgeColor}; padding:2px 8px; border-radius:10px;">${poList.length} PO${poList.length !== 1 ? "s" : ""}</span>
      </div>
    </div>
    <div id="${safeSectionId}-body" style="display:flex; flex-direction:column; gap:10px; padding:12px;">
      ${poList.map(po => renderExpectedInboundsPOCard(po, scheme)).join("")}
    </div>`;

  return sectionEl;
}

function toggleEISection(sectionId) {
  const body   = document.getElementById(sectionId + "-body");
  const btn    = document.getElementById(sectionId + "-toggle-btn");
  if (!body || !btn) return;
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "flex";
  btn.textContent    = isOpen ? "▼ Expand" : "▲ Collapse";
}

function renderExpectedInboundsPOCard(po, scheme) {
  const receivedPct   = po.totalCount > 0 ? Math.round((po.receivedCount / po.totalCount) * 100) : 0;
  const hasPartial    = po.lineItems.some(i => i.partialReceived);
  const allPending    = po.receivedCount === 0 && !hasPartial;
  const partial       = po.receivedCount > 0 || hasPartial;
  const progressColor = allPending ? "#b91c1c" : partial ? "#b45309" : "#15803d";

  let daysLabel = "";
  if (po.daysOverdue > 0)     daysLabel = `<span style="font-size:0.72rem; font-weight:800; background:#fee2e2; color:#b91c1c; padding:2px 8px; border-radius:4px;">${po.daysOverdue} day${po.daysOverdue !== 1 ? "s" : ""} overdue</span>`;
  else if (po.daysRemaining > 0) daysLabel = `<span style="font-size:0.72rem; font-weight:800; background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:4px;">${po.daysRemaining} day${po.daysRemaining !== 1 ? "s" : ""} remaining</span>`;
  else daysLabel = `<span style="font-size:0.72rem; font-weight:800; background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:4px;">Due Today</span>`;

  const lineItemsHtml = po.lineItems.map(item => {
    let statusBadge;
    if (item.fullyReceived) {
      statusBadge = `<span style="font-size:0.7rem; font-weight:700; background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:3px;">✅ Fully Received</span>`;
    } else if (item.partialReceived) {
      statusBadge = `<span style="font-size:0.7rem; font-weight:700; background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:3px;">Partial</span>`;
    } else {
      statusBadge = `<span style="font-size:0.7rem; font-weight:700; background:#fee2e2; color:#b91c1c; padding:2px 8px; border-radius:3px;">Pending</span>`;
    }
    return `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:6px 8px; font-family:monospace; font-size:0.75rem; font-weight:700; color:var(--brand); white-space:nowrap;">${item.itemCode || "—"}</td>
      <td style="padding:6px 8px; font-size:0.8rem; font-weight:600; line-height:1.4;">${item.materialName}</td>
      <td style="padding:6px 8px; text-align:center; font-family:monospace; font-weight:700; font-size:1rem; white-space:nowrap;">${item.orderedQty} ${item.unit}</td>
      <td style="padding:6px 8px; text-align:center; font-family:monospace; font-weight:700; font-size:1rem; white-space:nowrap; color:#15803d;">${item.receivedQty}</td>
      <td style="padding:6px 8px; text-align:center; font-family:monospace; font-weight:700; font-size:1rem; white-space:nowrap; color:#b45309;">${item.repairQty}</td>
      <td style="padding:6px 8px; text-align:center; font-family:monospace; font-weight:700; font-size:1rem; white-space:nowrap; color:#b91c1c;">${item.returnMissingQty}</td>
      <td style="padding:6px 8px; text-align:center;">${statusBadge}</td>
    </tr>`;
  }).join("");

  return `
    <div style="background:#fff; border:1px solid ${scheme.sectionBorder}; border-radius:var(--radius); overflow:hidden;">
      <div style="padding:10px 14px; background:${scheme.sectionBg}; border-bottom:1px solid ${scheme.sectionBorder};">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
          <div>
            <span style="font-size:0.78rem; font-weight:700; color:var(--muted);">Purchase Order Number: <strong style="color:var(--text);">${po.poNumber || "—"}</strong></span>
            <span style="font-size:0.78rem; font-weight:700; color:var(--muted); margin-left:10px;">Vendor: <strong style="color:var(--text);">${po.vendorName}</strong></span>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            ${po.actualDeliveryDate ? `<span style="font-size:0.72rem; font-weight:800; background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:4px;">✅ Delivered on ${formatDateDMY(po.actualDeliveryDate)}</span>` : daysLabel}
          </div>
        </div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; font-size:0.78rem; color:var(--muted);">
          <span>📅 Order Date: <strong>${po.orderDate || "—"}</strong></span>
          <span>🚚 Expected Delivery Date: <strong>${formatDateDMY(po.deliveryDate) || "—"}</strong></span>
          <span>📦 Actual Delivery Date: <strong>${po.actualDeliveryDate ? formatDateDMY(po.actualDeliveryDate) : "—"}</strong></span>
        </div>
      </div>

      <div style="padding:6px 14px; background:#f8fafc; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px;">
        <div style="flex:1; background:#e2e8f0; border-radius:4px; height:6px; overflow:hidden;">
          <div style="height:100%; width:${receivedPct}%; background:${progressColor}; border-radius:4px; transition:width 0.3s ease;"></div>
        </div>
        <span style="font-size:0.72rem; font-weight:700; color:${progressColor}; white-space:nowrap;">${po.receivedCount} / ${po.totalCount} fully received</span>
      </div>

      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; min-width:920px; table-layout:fixed;">
          <colgroup>
            <col style="width:7%;">
            <col style="width:38%;">
            <col style="width:11%;">
            <col style="width:11%;">
            <col style="width:11%;">
            <col style="width:11%;">
            <col style="width:11%;">
          </colgroup>
          <thead>
            <tr style="background:#f8fafc; border-bottom:1px solid var(--border);">
              <th style="padding:6px 8px; font-size:0.68rem; text-align:left; color:var(--muted); font-weight:700; text-transform:uppercase; white-space:nowrap;">Item Code</th>
              <th style="padding:6px 8px; font-size:0.68rem; text-align:left; color:var(--muted); font-weight:700; text-transform:uppercase;">Material Name</th>
              <th style="padding:6px 4px; font-size:0.65rem; text-align:center; color:var(--muted); font-weight:700; text-transform:uppercase; line-height:1.3;">Ordered<br>Qty</th>
              <th style="padding:6px 4px; font-size:0.65rem; text-align:center; color:var(--muted); font-weight:700; text-transform:uppercase; line-height:1.3;">Received<br>Qty</th>
              <th style="padding:6px 4px; font-size:0.65rem; text-align:center; color:var(--muted); font-weight:700; text-transform:uppercase; line-height:1.3;">Being Repaired<br>at ABPS Qty</th>
              <th style="padding:6px 4px; font-size:0.65rem; text-align:center; color:var(--muted); font-weight:700; text-transform:uppercase; line-height:1.3;">Return to Vendor<br>/ Missing Qty</th>
              <th style="padding:6px 4px; font-size:0.65rem; text-align:center; color:var(--muted); font-weight:700; text-transform:uppercase; line-height:1.3;">Status</th>
            </tr>
          </thead>
          <tbody>${lineItemsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

setInterval(enhanceAllDateInputsForDMY, 400);

