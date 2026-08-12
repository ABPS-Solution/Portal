async function initializeBOQIncreaseApprovalsWorkspace() {
  const feed     = document.getElementById("boq-increase-approvals-queue-feed");
  const feedback = document.getElementById("boq-increase-approvals-feedback");
  feedback.style.display = "none";
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">
    <div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>
    Loading Excess Material Requests...
  </div>`;

  try {
    const data = await apFetch({ action: "fetchPendingBOQIncreaseTickets" });
    if (!data.success) {
      feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">${data.error}</div>`;
      return;
    }
    if (!data.tickets || data.tickets.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <h3 style="color:var(--accent);">No Pending Excess Material Requests</h3>
      </div>`;
      return;
    }
    feed.innerHTML = "";
    data.tickets.forEach(ticket => {
      feed.appendChild(renderBOQIncreaseTicketCard(ticket));
    });
  } catch(e) {
    if (e.message !== "SESSION_EXPIRED") {
      feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Network error: ${e.message}</div>`;
    }
  }
}

function renderBOQIncreaseTicketCard(ticket) {
  const card = document.createElement("div");
  card.className = "contact-summary-card-parent";
  card.id = `boq-increase-card-${ticket.ticketId}`;
  card.style.borderLeft = "4px solid #f59e0b";

  const items = ticket.exceededItems || [];
  const justificationText = items.length > 0 ? (items[0].boqIncreaseNotes || "") : "";

  const rowsHtml = items.map(item => {
    const safeCode = item.itemCode.replace(/[^a-zA-Z0-9]/g,'_');
    const reqQty = Number(item.requestedQty) || 0;
    const remQty = Number(item.boqRemainingQty) || 0;
    return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-weight:600;">${item.itemDescription || ""}</td>
        <td style="padding:8px; text-align:center; color:var(--muted);">${item.unitType || "—"}</td>
        <td style="padding:8px; text-align:center;">${fmtQty(item.boqAllottedQty)}</td>
        <td style="padding:8px; text-align:center;">${fmtQty(item.boqUsedQty)}</td>
        <td style="padding:8px; text-align:center; font-weight:700; color:#0369a1;">${fmtQty(remQty)}</td>
        <td style="padding:8px; text-align:center;">${fmtQty(reqQty)}</td>
        <td style="padding:8px; text-align:center; font-weight:700; color:#b45309;">${fmtQty(item.boqExceedAmount)}</td>
        <td style="padding:8px; text-align:center;">
          <input type="number" data-itemcode="${item.itemCode}" data-min="${remQty}" data-max="${reqQty}"
            id="boq-final-qty-${ticket.ticketId}-${safeCode}"
            value="${reqQty}" min="${remQty}" max="${reqQty}" step="any"
            oninput="clampBOQFinalTicketQty(this)"
            style="width:100px; padding:5px 6px; text-align:center; font-family:monospace; font-weight:700; border:1.5px solid var(--border); border-radius:4px;" />
        </td>
      </tr>`;
  }).join("");

  card.innerHTML = `
    <div class="contact-summary-header-row" onclick="toggleBOQIncreaseCardBody('${ticket.ticketId}')" style="margin-bottom:0; padding-bottom:8px; cursor:pointer;">
      <div class="contact-summary-title-info" style="width:100%;">
        <div class="meta-row-line-block">
          <span style="font-family:monospace; font-weight:800; background:#fef3c7; color:#b45309; padding:3px 8px; font-size:0.85rem; border-radius:3px;">${ticket.ticketId}</span>
          <strong style="margin-left:10px; color:var(--brand); font-size:0.9rem;">${ticket.jobCardNumber || "—"}</strong>
          <span id="boq-increase-caret-${ticket.ticketId}" style="float:right; font-weight:700; color:var(--muted);">▸</span>
        </div>
        <div class="meta-row-line-block" style="margin-top:8px; font-size:0.85rem;">
          <span>By:</span> <strong style="color:#111827;">${ticket.requestedBy}</strong>
          <span style="margin-left:8px;">|</span>
          <strong style="color:#111827; margin-left:8px;">${fmtPstatDateTime(ticket.dateCreated)}</strong>
          <span style="margin-left:12px;">Dept:</span> <strong style="color:#111827;">${ticket.department || "—"}</strong>
          <span style="margin-left:8px;">|</span>
          <span style="margin-left:8px;">Store:</span> <strong style="color:#111827;">${ticket.storeType || "—"}</strong>
        </div>
      </div>
    </div>
    <div id="boq-increase-body-${ticket.ticketId}" style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:8px;">
      <div style="font-size:0.85rem; color:#475569; background:#f8fafc; border:1px solid var(--border); border-radius:4px; padding:10px 12px; margin-bottom:12px;">
        <strong>Engineer's Justification:</strong> ${justificationText}
      </div>
      <div style="overflow-x:auto; margin-bottom:14px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
          <thead>
            <tr style="background:var(--highlight-bg); text-align:left;">
              <th style="padding:8px;">Material Name</th>
              <th style="padding:8px; text-align:center;">Unit</th>
              <th style="padding:8px; text-align:center;">JC Allotted Qty</th>
              <th style="padding:8px; text-align:center;">JC Used Qty</th>
              <th style="padding:8px; text-align:center;">JC Remaining Qty</th>
              <th style="padding:8px; text-align:center;">Requested Qty</th>
              <th style="padding:8px; text-align:center;">Extra Qty</th>
              <th style="padding:8px; text-align:center;">Final Ticket Qty</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="nav-btn-styled" onclick="submitBOQIncreaseDecision('${ticket.ticketId}')"
          style="background:var(--accent); padding:8px 20px; font-weight:700;">
          Submit Decision for This Ticket
        </button>
      </div>
    </div>
  `;
  return card;
}

function toggleBOQIncreaseCardBody(ticketId) {
  const body = document.getElementById(`boq-increase-body-${ticketId}`);
  const caret = document.getElementById(`boq-increase-caret-${ticketId}`);
  if (!body) return;
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "block";
  if (caret) caret.textContent = isOpen ? "▸" : "▾";
}

function clampBOQFinalTicketQty(inp) {
  const min = Number(inp.dataset.min) || 0;
  const max = Number(inp.dataset.max) || 0;
  let val = parseFloat(inp.value);
  if (isNaN(val)) return;
  if (val < min) val = min;
  if (val > max) val = max;
  inp.value = val;
}

async function submitBOQIncreaseDecision(ticketId) {
  const card     = document.getElementById(`boq-increase-card-${ticketId}`);
  const feedback = document.getElementById("boq-increase-approvals-feedback");
  // Collect Final Ticket Qty per item — always an "accept" action now,
  // there's no separate Reject path on this screen.
  const itemDecisions = [];
  let hasInvalid = false;
  card.querySelectorAll("input[id^='boq-final-qty-']").forEach(inp => {
    const finalTicketQty = parseFloat(inp.value);
    if (isNaN(finalTicketQty) || finalTicketQty < Number(inp.dataset.min)) { hasInvalid = true; return; }
    itemDecisions.push({ itemCode: inp.dataset.itemcode, finalTicketQty });
  });
  if (hasInvalid || itemDecisions.length === 0) {
    feedback.style.cssText = "display:block; background:#fff3c7; border-left:4px solid #b45309; color:#b45309; padding:12px; margin-bottom:12px;";
    feedback.textContent   = "Final Ticket Qty must be set, and can never be less than JC Remaining Qty, for every item.";
    return;
  }
  const adminAction = "accept";
  const submitBtn = card.querySelector("button[onclick^='submitBOQIncreaseDecision']");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting...'; }
  try {
    const data = await apFetch({
      action:          "commitBOQLimitIncreaseRequestTicket",
      activeEngineer:  appActiveOperatorIdentityString,
      ticketId,
      adminAction,
      itemDecisions
    });

    if (data.success) {
      feedback.style.cssText = "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:12px; margin-bottom:12px; font-weight:700;";
      feedback.textContent   = `Ticket ${ticketId} actioned: ${adminAction.toUpperCase()}. Ticket moved to ${data.newStatus}.`;
      card.remove();
      const remainingCards = document.getElementById("boq-increase-approvals-queue-feed").children.length;
      if (remainingCards === 0) initializeBOQIncreaseApprovalsWorkspace();
    } else {
      feedback.style.cssText = "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:12px; margin-bottom:12px;";
      feedback.textContent   = data.error || "Submission failed.";
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Decision for This Ticket"; }
    }
  } catch(e) {
    if (e.message !== "SESSION_EXPIRED") {
      feedback.style.cssText = "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:12px; margin-bottom:12px;";
      feedback.textContent   = "Network error: " + e.message;
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Decision for This Ticket"; }
  }
}

async function confirmFGReleaseSelection(ticketId) {
  const errZone = document.getElementById("fg-release-modal-error");
  errZone.style.display = "none";
  try {
    const result = await apFetch({
      action: "actionTicketReleaseApproval", activeEngineer: appActiveOperatorIdentityString,
      ticketId, managerDecisionCommand: "APPROVE", fgFinalSelections: window._fgReleaseSelections
    });
    if (!result.success) { errZone.textContent = result.error || "Release failed."; errZone.style.display = "block"; return; }
    document.getElementById("fg-release-modal-overlay").style.display = "none";
    const cardNode = document.getElementById(`store-pending-ticket-card-node-${ticketId}`);
    if (cardNode) cardNode.remove();
  } catch(e) {
    errZone.textContent = "Network error: " + e.message;
    errZone.style.display = "block";
  }
}

async function checkCoverageAndApprove(ticketId, projectId, btn, storeType) {
  if (storeType === 'Finished Goods Store') {
    return openFGReleaseSelectionModal(ticketId);
  }
  if (hasEmptyActualQtyInputs(ticketId)) {
    alert("Actual Quantity is required for every item before approving.");
    return;
  }
  const overrunItem = findActualQtyOverJcRemaining(ticketId);
  if (overrunItem) {
    alert(`The Actual Quantity for ${overrunItem.materialName} is more than the JC Remaining Qty. Either reduce the Actual Quantity to match the JC Remaining Qty, or reject the entire ticket and have them create a new ticket with an Excess Material Request.`);
    return;
  }
  const invalidSpare = findInvalidSpareAllocation(ticketId);
  if (invalidSpare) {
    alert(`Spare Store Qty is required for ${invalidSpare.materialName} since Spare Stock Needed is set to Blocked or Restricted.`);
    return;
  }
  // Skips the standalone stock-coverage pre-check/manual-reallocation modal
  // entirely — that path relied on a backend field (coverageReport) that
  // never actually existed, and it's superseded anyway: the Total Stock
  // check at ticket creation already blocks anything impossible, and
  // findAndBorrowForShortfall runs automatically inside the real approval
  // itself, throwing a clear error if a shortfall genuinely can't be
  // covered. Straight to approval, no separate pre-check round-trip.
  executeStoreManagerTicketActionDecision(ticketId, "APPROVE");
}

async function executeStoreManagerTicketActionDecision(ticketId, decisionString) {
  const feedbackBanner = document.getElementById("store-approvals-runtime-inline-feedback-banner");
  const cardNode = document.getElementById(`store-pending-ticket-card-node-${ticketId}`);
  
  // Isolate button targets inside the selected card viewport parameters bounds
  const approveBtn = document.getElementById(`btn-approve-${ticketId}`);
  const rejectBtn = document.getElementById(`btn-reject-${ticketId}`);
  const activeTargetBtn = decisionString === 'APPROVE' ? approveBtn : rejectBtn;

  if (feedbackBanner) feedbackBanner.style.display = "none";
  showBlockingOverlay(decisionString === 'APPROVE' ? "Releasing Stock..." : "Freeing Reserved Stock...");

  // --- TRIGGER CLICK ANIMATIONS ENGINE MATRIX ---
  if (approveBtn && rejectBtn && activeTargetBtn) {
    // 1. Lock both fields buttons elements instantly to block hardware multi-tap ghost requests submission pools
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    approveBtn.style.opacity = "0.4";
    rejectBtn.style.opacity = "0.4";
    
    // 2. Maximize opacity focus on target choice block element tracker
    activeTargetBtn.style.opacity = "1";
    
    // 3. Inject the clean hardware-accelerated CSS spinner vector circle block inline inside text wrappers nodes
    activeTargetBtn.innerHTML = `
      <div class="spinner" style="
        display: inline-block; 
        width: 14px; 
        height: 14px; 
        border: 2px solid rgba(255,255,255,0.3); 
        border-top-color: #ffffff; 
        border-radius: 50%; 
        animation: spin 0.6s linear infinite;
        vertical-align: middle;
      "></div>
      <span>${decisionString === 'APPROVE' ? 'Releasing Items...' : 'Freeing Stock...'}</span>
    `;
  }

  try {
    const result = await apFetch({
      action: "actionTicketReleaseApproval",
      activeEngineer: appActiveOperatorIdentityString,
      ticketId: ticketId,
      managerDecisionCommand: decisionString,
      actualQuantities: decisionString === "APPROVE" ? collectTicketActualQuantities(ticketId) : undefined,
      spareAllocations: decisionString === "APPROVE" ? collectSpareAllocations(ticketId) : undefined
    });
    if (result.success) {
      if (feedbackBanner) {
        // SILENT METRICS RE-INDEX: Instantly refresh home dashboard widgets states counters fields
        if (userPermissions.liveStoreStock === true) triggerLiveWarehouseStockMetricsSync();
        feedbackBanner.style.cssText = "display: block; background: #dcfce7; border-color: #15803d; color: #15803d; padding: 12px; margin-bottom: 14px; border-left: 4px solid #15803d; font-weight:700;";
        feedbackBanner.innerHTML = `Ticket Reference ${ticketId} successfully ${decisionString.slice(0, 6).toLowerCase()}ed`;
      }
      
      // Remove visual panel node block smoothly out of sight matching flow constraints
      if (cardNode) cardNode.remove();

      hideBlockingOverlay();
      setTimeout(() => {
        if (feedbackBanner) feedbackBanner.style.display = "none";
        const remainingQueueItems = document.getElementById("store-manager-approvals-queue-cards-feed").children.length;
        if (remainingQueueItems === 0) {
          initializeStoreManagerApprovalsWorkspace();
        }
      }, 3000);

    } else {
      hideBlockingOverlay();
      if (feedbackBanner) {
        feedbackBanner.style.cssText = "display: block; background: #fee2e2; border-color: #b91c1c; color: #b91c1c; padding: 12px; margin-bottom: 14px; border-left: 4px solid #b91c1c;";
        feedbackBanner.innerHTML = `<strong>Action Rejected:</strong> ${result.error}`;
      }
      // Restoration loop rollbacks button state styles elements layout flags if backend reports error checks failures
      if (approveBtn && rejectBtn) {
        approveBtn.disabled = false; rejectBtn.disabled = false;
        approveBtn.style.opacity = "1"; rejectBtn.style.opacity = "1";
        approveBtn.innerHTML = `<span>Approve & Release Items</span>`;
        rejectBtn.innerHTML = `<span>Reject & Free Stock</span>`;
      }
    }

  } catch (error) {
    hideBlockingOverlay();
    if (feedbackBanner) {
      feedbackBanner.style.cssText = "display: block; background: #fee2e2; border-color: #b91c1c; color: #b91c1c; padding: 12px; margin-bottom: 14px; border-left: 4px solid #b91c1c;";
      feedbackBanner.innerHTML = `<strong>Network Exception Failure:</strong> ${error.message}`;
    }
    // Restoration loop rollbacks button state styles elements layout flags if network connection completely collapses
    if (approveBtn && rejectBtn) {
      approveBtn.disabled = false; rejectBtn.disabled = false;
      approveBtn.style.opacity = "1"; rejectBtn.style.opacity = "1";
      approveBtn.innerHTML = `<span>Approve & Release Items</span>`;
      rejectBtn.innerHTML = `<span>Reject & Free Stock</span>`;
    }
  }
}

