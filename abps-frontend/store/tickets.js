let dynamicTicketShoppingBasketArray = [];
/**
 * INITIALIZE MATERIAL REQUEST WORKSPACE
 * Synchronizes warehouse quantities, active active projects list, and staff databases.
 * Automatically respects the active "Choose Store" scope selection to feed the correct items catalog.
 */
async function initializeMaterialRequestWorkspace() {
  const projectDropdown = document.getElementById("ticket-project-id-dropdown-ta-input");
  const itemDropdown = document.getElementById("ticket-item-selection-dropdown");
  const deptDropdown = document.getElementById("ticket-department-outgoing-dropdown");
  const storeScopeDropdown = document.getElementById("ticket-selected-store-scope-toggle");
  
  if (!projectDropdown || !itemDropdown || !deptDropdown) return;

  // Full session-state reset — without this, leaving and re-entering this section kept whatever
  // Request/Return mode, FG catalog mode, and per-Job-Card caches were left over from the
  // previous visit, instead of genuinely starting fresh like a first-time arrival.
  const ticketTypeToggle = document.getElementById("ticket-action-type-toggle-dropdown");
  if (ticketTypeToggle) ticketTypeToggle.value = "Request Material";
  window._fgActiveCatalogMode = "item";
  window._ticketJobCardMaterialsCache = null;
  window._ticketBOQCache = null;
  window.cachedSpareStoreStock = [];

  // Enforce pristine starting conditions across cascading lock states parameters
  projectDropdown.value = "";
  deptDropdown.value = ""; 
  if (storeScopeDropdown) storeScopeDropdown.value = "";
  ticketBOQDisplayReset("— Choose Project First —");
  ticketJobCardDisplayReset("— Choose BOQ First —");
  const customerNameField = document.getElementById("ticket-customer-name");
  if (customerNameField) customerNameField.value = "";
  window.ticketJobCardsCache = [];
  window._ticketProjectMetaCache = {};
  resetMaterialRequestCascadingLockState();
  
  clearFullBasketDraftState();
  document.getElementById("ticket-live-counter-pill-zone").innerHTML = "";

  projectDropdown.placeholder = "Loading Active Projects...";
  itemDropdown.innerHTML = '<option value="">— Select Material —</option>';
  try {
    const [inventoryData, projectsData, serviceProjectsData, staffData] = await Promise.all([
      apFetch({ action: "pullLiveInventoryCounts" }),
      apFetch({ action: "pullLiveActiveProjectCodes" }),
      apFetch({ action: "fetchInvoicedProjectsForService" }),
      apFetch({ action: "getStoreOperatorsList" })
    ]);

    if (inventoryData.success && projectsData.success && staffData.success) {
      cachedInventoryStockCollection = inventoryData.inventory;
      window.cachedInventoryStockCollection = cachedInventoryStockCollection;
      globalOperatorsDatabasePayloadCache = staffData.fullPersonnelDataRecordsTree || [];
      window._ticketProjectMetaCache = projectsData.projectMeta || {};

      // Seed Active Project Codes — entry point of the cascade. The
      // typeahead input filters/renders from these two globals itself
      // (handleSharedProjectTypeaheadInput), not from populated <option>
      // elements — there's no <select> here anymore to fill.
      //
      // Outgoing Use (Service vs Reactor/Capacitor/Panel/Processing) is
      // chosen AFTER Project ID in this screen's cascade, so the project
      // list can't swap in response to it — instead, invoiced/completed
      // projects (eligible for a Service issue) are merged into the same
      // typeahead source up front. fetchJobCardsForProject has no
      // project_status filter, so BOQ/Job Card cascade already works for
      // either kind of project once selected.
      const activeProjects = projectsData.projects || [];
      const activeIds = new Set(activeProjects);
      const serviceProjects = (serviceProjectsData.success ? serviceProjectsData.projects : []) || [];
      const mergedProjects = activeProjects.concat(serviceProjects.filter(id => !activeIds.has(id)));
      const mergedMeta = { ...(projectsData.projectMeta || {}), ...(serviceProjectsData.projectMeta || {}) };

      window.sharedActiveProjectCodes = mergedProjects;
      window.sharedProjectMeta = mergedMeta;
      window._ticketProjectMetaCache = mergedMeta;
      projectDropdown.placeholder = "Type Project ID or Customer Name...";
    }
  } catch (error) {
    console.error("Critical Matrix Load Failure:", error);
    projectDropdown.placeholder = "Error loading projects";
  }

  resetMaterialRequestCascadingLockState();

  // Defensive re-reset — the scroll-to-top at navigation time can be undone if the page's
  // height changes once the dropdowns above actually populate (e.g. arriving from a long,
  // deeply-scrolled screen like the Store Dashboard). A single requestAnimationFrame only
  // covers one paint cycle; dropdown population can span more than one, so this chains a
  // couple of frames plus a short delayed fallback to catch any later reflow.
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  });
  setTimeout(() => window.scrollTo(0, 0), 150);
}

/**
 * SUBMIT TICKET SYSTEM GATEWAY
 * Validates inputs based on whether the active system state is set to Request or Return,
 * transmits the data, and displays a clean, full-panel success message for 5 seconds.
 */
async function submitMaterialRequestTicketToBackend() {
  const projectIdField = document.getElementById("ticket-project-id-dropdown-ta-input");
  const operatorDropdownField = document.getElementById("ticket-requested-by-operator-dropdown");
  const typeDropdownField = document.getElementById("ticket-action-type-toggle-dropdown");
  const submitBtn = document.getElementById("submit-ticket-final-btn");
  const feedbackBanner = document.getElementById("store-ticket-runtime-inline-feedback-banner");
  const departmentVal = document.getElementById("ticket-department-outgoing-dropdown").value;
  const materialRequestPanelContainer = document.getElementById("canvas-module-store-material-request");
  const chosenStoreTargetScopeStr = document.getElementById("ticket-selected-store-scope-toggle")?.value || "Raw Materials Store";
  
  if (!projectIdField || !submitBtn || !materialRequestPanelContainer) {
    console.error("UI Reference Error: Compulsory form inputs missing from the DOM layout.");
    return;
  }

  const projectId = projectIdField.value;
  const operatorSignatureName = appActiveOperatorIdentityString;
  const ticketTypeVal = typeDropdownField ? typeDropdownField.value : "Request Material";

  if (feedbackBanner) feedbackBanner.style.display = "none";
  
  if (!operatorSignatureName) {
    if (feedbackBanner) {
      feedbackBanner.style.cssText = "display: block; background: #fff3c7; border-color: #b45309; color: #b45309; padding: 10px; margin-bottom: 12px; border-left: 4px solid #b45309; text-align: left;";
      feedbackBanner.innerHTML = `<strong>Compulsory Input Missing:</strong> You must be logged in with an active operator identity to submit a ticket.`;
    }
    return;
  }

  if (!projectId) {
    if (feedbackBanner) {
      feedbackBanner.style.cssText = "display: block; background: #fff3c7; border-color: #b45309; color: #b45309; padding: 10px; margin-bottom: 12px; border-left: 4px solid #b45309; text-align: left;";
      feedbackBanner.innerHTML = `<strong>Compulsory Input Missing:</strong> Please select an active Project ID code to map this transaction.`;
    }
    return;
  }

  if (!document.getElementById("ticket-job-card-dropdown")?.value) {
    if (feedbackBanner) {
      feedbackBanner.style.cssText = "display: block; background: #fff3c7; border-color: #b45309; color: #b45309; padding: 10px; margin-bottom: 12px; border-left: 4px solid #b45309; text-align: left;";
      feedbackBanner.innerHTML = `<strong>Compulsory Input Missing:</strong> Please select a Job Card Number.`;
    }
    return;
  }
  
  if (dynamicTicketShoppingBasketArray.length === 0) {
    if (feedbackBanner) {
      feedbackBanner.style.cssText = "display: block; background: #fee2e2; border-color: #b91c1c; color: #b91c1c; padding: 10px; margin-bottom: 12px; border-left: 4px solid #b91c1c; text-align: left;";
      feedbackBanner.innerHTML = `<strong>Empty Basket Warning:</strong> Cannot compile a store transaction ticket with no items in your material basket.`;
    }
    return;
  }
  
  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></div>
    <span>Generating Request Ticket...</span>
  `;
  
  // Cache the full primary HTML skeleton parameters map before clearing for success screen view layout
  if (!window.storeCreateTicketOriginalTemplateCacheHTML) {
    window.storeCreateTicketOriginalTemplateCacheHTML = materialRequestPanelContainer.innerHTML;
  }
  
  showBlockingOverlay("Submitting Material Issue Ticket...");
  try {
    const jobCardNumberVal = document.getElementById("ticket-job-card-dropdown")?.value || "";
    const payload = {
      action: "submitEngineerMaterialTicket",
      activeEngineer: operatorSignatureName,
      operatorName: operatorSignatureName,
      requestedBy: operatorSignatureName,
      projectId: projectId,
      jobCardNumber: jobCardNumberVal,
      department: departmentVal,
      departmentOutgoing: departmentVal,
      ticketTypeCommandString: ticketTypeVal,
      storeTargetScope: chosenStoreTargetScopeStr,
      requestOrReturn: 'Request',
      typeOfStore: chosenStoreTargetScopeStr,
      items: dynamicTicketShoppingBasketArray,
      itemsClusterArray: dynamicTicketShoppingBasketArray
    };
    
    const result = await apFetch(payload);
    hideBlockingOverlay();
    
    if (result.success) {
      // Clear current memory shopping draft arrays parameters instantly
      dynamicTicketShoppingBasketArray = [];
      
      // FIXED: Removed the 5-second automatic timeout return redirect entirely
      materialRequestPanelContainer.style.padding = "20px";
      materialRequestPanelContainer.innerHTML = `
        <div style="background: #dcfce7; border: 1px solid #15803d; border-left: 4px solid #15803d; color: #15803d; padding: 20px; border-radius: var(--radius); text-align: left; box-shadow: 0 4px 6px rgba(0,0,0,0.02); margin: 10px 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
          <div>
            <h3 style="font-size: 1.1rem; margin-top: 0; margin-bottom: 6px; font-weight: 700;">Success! Material Issue Ticket Created.</h3>
            <div style="font-size: 0.92rem; font-weight: 600; display: flex; align-items: center; gap: 4px;">
              Assigned Reference Tracking ID: 
              <span style="font-family: monospace; font-weight: 800; background: #fff; padding: 3px 8px; border-radius: 4px; border: 1px solid #15803d; color: #111827; margin-left: 4px; font-size: 1rem;">
                ${result.ticketId}
              </span>
            </div>
          </div>
          <button class="nav-btn-styled" style="background: #15803d; color: white; padding: 10px 20px; font-weight: 700; font-size: 0.85rem;" onclick="resetStoreCreateTicketToInitialState()">
            + Create New Ticket
          </button>
        </div>
      `;
    } 
    else {
      if (feedbackBanner) {
        feedbackBanner.style.cssText = "display: block; background: #fee2e2; border-color: #b91c1c; color: #b91c1c; padding: 12px; margin-bottom: 12px; border-left: 4px solid #b91c1c; text-align: left;";
        feedbackBanner.innerHTML = `<strong>Submission Rejected by Server:</strong> ${result.error}`;
        feedbackBanner.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      submitBtn.disabled = false;
      submitBtn.textContent = "Generate Material Ticket";
    }
  } catch (err) {
    hideBlockingOverlay();
    if (feedbackBanner) {
      feedbackBanner.style.cssText = "display: block; background: #fee2e2; border-color: #b91c1c; color: #b91c1c; padding: 12px; margin-bottom: 12px; border-left: 4px solid #b91c1c; text-align: left;";
      feedbackBanner.innerHTML = `<strong>Network Request Connection Error:</strong> ${err.message}`;
      feedbackBanner.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    submitBtn.disabled = false;
    submitBtn.textContent = "Generate Material Ticket";
  }
}

/**
 * WORKSPACE LOOP ACTION RE-INITIALIZER
 * Programmatically restores native inputs layout structure from cache and triggers parallel dropdown down sync paths
 */
function resetStoreCreateTicketToInitialState() {
  stopLiveStockPolling();
  window._ticketBOQCache = null;
  const materialRequestPanelContainer = document.getElementById("canvas-module-store-material-request");
  if (materialRequestPanelContainer && window.storeCreateTicketOriginalTemplateCacheHTML) {
    // Restores original HTML skeleton element properties safely
    materialRequestPanelContainer.innerHTML = window.storeCreateTicketOriginalTemplateCacheHTML;
    
    // Re-fire standard workflow bootloader tasks to sync operators and fresh available stocks live down to selects
    initializeMaterialRequestWorkspace();
  }
}

/**
 * 2. LIVE SELECTION STOCK COUNTER LOOKUP PILL
 * Scans cache maps instantly as the user clicks options to show stock states
 */

let _liveStockPollTimer = null;

function startLiveStockPolling() {
  stopLiveStockPolling();
  _liveStockPollTimer = setInterval(async () => {
    const selectedMaterial = document.getElementById("ticket-item-selection-dropdown")?.value;
    if (!selectedMaterial) { stopLiveStockPolling(); return; }
    await refreshLiveStockForSelectedMaterial();
  }, 5000); // refresh every 5 seconds
}

function stopLiveStockPolling() {
  if (_liveStockPollTimer) { clearInterval(_liveStockPollTimer); _liveStockPollTimer = null; }
}

async function refreshLiveStockForSelectedMaterial() {
  const activeStoreScope   = document.getElementById("ticket-selected-store-scope-toggle")?.value || "Raw Materials Store";
  const selectedMaterial   = document.getElementById("ticket-item-selection-dropdown")?.value;
  const projectId          = document.getElementById("ticket-project-id-dropdown-ta-input")?.value;
  if (!selectedMaterial) { stopLiveStockPolling(); return; }

  // Strip any appended stock count suffix e.g. " (0 NOS available)" from Spare Store dropdown labels
  const cleanMaterialName = selectedMaterial.replace(/\s*\(\d+\s+\w+\s+available\)/i, "").trim();

  try {
    // PERF: render the pill immediately from whatever's already cached (JobCardMaterials was
    // warmed the moment Store was selected, well before this material-pick moment) — no BOQ
    // round-trip needed here anymore, that cache is no longer what the pill reads from. Finished
    // Goods Store belongs in this immediate render too — it was left out, which meant the whole
    // FG pill (including ALLOTTED/USED/REMAINING, which don't need any live network call at all)
    // silently never appeared until the live-count fetch below succeeded.
    if (projectId && (activeStoreScope === "Raw Materials Store" || activeStoreScope === "Spare Store" || activeStoreScope === "Finished Goods Store")) {
      await updateSelectedLiveStockPillCounter(null);
    }

    // getLiveStockForItem looks up by Item Code, not material name -- resolve
    // it from the catalog cache first (loading the cache if this is the
    // first time this screen has needed it).
    if (!window.itemCodeCatalogCache || window.itemCodeCatalogCache.length === 0) {
      await loadItemCodeCatalogIntoCache().catch(() => {});
    }
    const cleanKeyForLookup = cleanMaterialName.replace(/\s+/g, "").toLowerCase();
    const matchedCatalogEntry = (window.itemCodeCatalogCache || []).find(
      c => (c.productName || "").replace(/\s+/g, "").toLowerCase() === cleanKeyForLookup
    );
    // Fall back to the JobCardMaterials cache's own itemCode when the name doesn't
    // resolve in the Item Code catalog (e.g. a Finished Goods material whose
    // production.job_card_materials row already carries the right itemCode
    // regardless of catalog naming) — without this, a catalog miss silently
    // killed the live total-stock count even though ALLOTTED/USED/REMAINING
    // above already rendered fine from the JCM cache alone.
    const jcmFallbackForItemCode = (window._ticketJobCardMaterialsCache?.records || []).find(
      r => (r.materialName || "").replace(/\s+/g, "").toLowerCase() === cleanKeyForLookup
    );
    const resolvedItemCode = matchedCatalogEntry?.itemCode || jcmFallbackForItemCode?.itemCode;
    if (!resolvedItemCode) return; // no Item Code found for this material -- nothing to look up

    // NOW fire the single network call for live stock counts
    const jobCardNumberForPill = document.getElementById("ticket-job-card-dropdown")?.value || "";
    const data = await apFetch({ action: "getLiveStockForItem", itemCode: resolvedItemCode, projectId: projectId, jobCardNumber: jobCardNumberForPill });
    if (!data.success) return;

    // Also refresh job_card_materials on every tick — a QA check completing,
    // automatic reservation shifting stock, or a BOQ revision changing this
    // Job Card's allotment can all happen while this pill sits open, and
    // ALLOTTED/USED/REMAINING (plus the "Currently Reserved" figure above
    // them) come from this cache, not from getLiveStockForItem.
    const jobCardNumberValPoll = document.getElementById("ticket-job-card-dropdown")?.value || "";
    if (jobCardNumberValPoll && projectId) {
      try {
        const freshJcmPoll = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValPoll, projectId: projectId });
        window._ticketJobCardMaterialsCache = { key: jobCardNumberValPoll + "|" + projectId, records: freshJcmPoll.records || [] };
      } catch(e) { /* keep whatever was already cached on a transient failure */ }
    }

    // Patch inventory counts in local cache
    const cleanKey = cleanMaterialName.replace(/\s+/g,"").toLowerCase();

    const _invCache = window.cachedInventoryStockCollection || cachedInventoryStockCollection || [];
    const existing = _invCache.find(i =>
      (i.materialName||"").replace(/\s+/g,"").toLowerCase() === cleanKey
    );
    if (existing) {
      existing.availableStock = data.stock.availableStock;
      existing.reservedStock  = data.stock.reservedStock;
      existing.unitType       = data.stock.unitType;
    }

    const spareExisting = (window.cachedSpareStoreStock||[]).find(i =>
      (i.materialName||"").replace(/\s+/g,"").toLowerCase() === cleanKey
    );
    if (spareExisting) {
      spareExisting.availableStock = data.stock.spareStock;

      // FIX: Rebuild the spare store dropdown option text with the fresh count
      if (activeStoreScope === "Spare Store") {
        const itemDrop = document.getElementById("ticket-item-selection-dropdown");
        if (itemDrop) {
          Array.from(itemDrop.options).forEach(opt => {
            const optCleanKey = opt.value.replace(/\s+/g,"").toLowerCase();
            if (optCleanKey === cleanKey) {
              opt.textContent = `${spareExisting.materialName}`;
            }
          });
        }
      }
    }

    await updateSelectedLiveStockPillCounter(data.stock);
  } catch(e) { console.warn("refreshLiveStockForSelectedMaterial error:", e.message); }
}

function checkSpareStoreSuggestion() {
  const banner = document.getElementById("spare-store-suggestion-banner");
  if (!banner) return;

  const activeStoreScope = document.getElementById("ticket-selected-store-scope-toggle")?.value || "";
  if (activeStoreScope !== "Raw Materials Store") {
    banner.style.display = "none";
    return;
  }

  const selectedMaterial = document.getElementById("ticket-item-selection-dropdown").value;
  const qty = parseInt(document.getElementById("ticket-item-quantity-input").value, 10);

  if (!selectedMaterial || !qty || qty <= 0) {
    banner.style.display = "none";
    return;
  }

  const cleanSearchKey = selectedMaterial.replace(/\s+/g, '').toLowerCase();
  const spareCache = window.cachedSpareStoreStock || [];
  const spareMatch = spareCache.find(item => (item.materialName || "").replace(/\s+/g, '').toLowerCase() === cleanSearchKey);

  if (spareMatch && spareMatch.availableStock >= qty) {
    banner.innerHTML = `⚠️ ${spareMatch.availableStock} ${spareMatch.unitType} of <strong>${selectedMaterial}</strong> already available in Spare Store. Consider requesting from Spare Store instead of Raw Materials Store.`;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
}

/**
 * 3. ADD LINE ITEM TO BASKET STREAM
 * Validates against ghost-stock limitations and formats rows inside the view viewport
 */
async function addItemToShoppingBasketRow() {
  const itemSelect = document.getElementById("ticket-item-selection-dropdown");
  const qtyInput = document.getElementById("ticket-item-quantity-input");
  const projectId = document.getElementById("ticket-project-id-dropdown-ta-input").value;
  const activeStoreScope = document.getElementById("ticket-selected-store-scope-toggle")?.value || "Raw Materials Store";
  
  const materialName = itemSelect.value;
  const quantity = parseInt(qtyInput.value, 10);

  // Button loading state
  const addBtn = document.getElementById("ticket-add-item-action-btn");
  const addBtnOriginalText = addBtn ? addBtn.innerHTML : "+ Add";
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.style.cursor = "not-allowed";
    addBtn.style.opacity = "0.75";
    addBtn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">
      <svg style="animation:spin 0.7s linear infinite;width:13px;height:13px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round"/>
      </svg>Adding...</span>`;
  }
  const restoreAddBtn = () => {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.style.cursor = "pointer";
      addBtn.style.opacity = "1";
      addBtn.innerHTML = addBtnOriginalText;
    }
  };
  
  if (!materialName || isNaN(quantity) || quantity <= 0) {
    restoreAddBtn();
    alert("Please select a material item line and enter a valid quantity count.");
    return;
  }
  
  const cleanSearchKey = materialName.replace(/\s+/g, '').toLowerCase();

  // --- SPARE STORE: block if requested qty exceeds available spare stock ---
  if (activeStoreScope === "Spare Store") {
    const spareCache = window.cachedSpareStoreStock || [];
    const spareMatch = spareCache.find(item => (item.materialName || "").replace(/\s+/g, '').toLowerCase() === cleanSearchKey);
    const availableQty = spareMatch ? spareMatch.availableStock : 0;

    if (quantity > availableQty) {
      restoreAddBtn();
      alert(`Spare Store Lockout: Only ${availableQty} ${spareMatch ? spareMatch.unitType : 'units'} of ${materialName} available in Spare Store. Please request from Raw Materials Store instead. This material is not currently available in sufficient quantity in Spare Store.`);
      return;
    }

    const existingLineItem = dynamicTicketShoppingBasketArray.find(i => i.materialName.replace(/\s+/g, '').toLowerCase() === cleanSearchKey);
    let totalRequestedQuantity = quantity;
    if (existingLineItem) {
      totalRequestedQuantity += existingLineItem.quantity;
      if (totalRequestedQuantity > availableQty) {
        restoreAddBtn();
        alert(`Spare Store Lockout: Combined requested quantity (${totalRequestedQuantity}) exceeds available Spare Store stock (${availableQty}) for ${materialName}. Please request the remainder from Raw Materials Store instead.`);
        return;
      }
      existingLineItem.quantity = totalRequestedQuantity;
    } else {
      dynamicTicketShoppingBasketArray.push({
        materialName: materialName,
        itemCode: spareMatch ? spareMatch.itemCode : "",
        quantity: totalRequestedQuantity,
        unitType: spareMatch ? spareMatch.unitType : "NOS",
        requiresBOQIncreaseFlag: false,
        allottedRemainingLimit: availableQty
      });
    }
    qtyInput.value = "";
    restoreAddBtn();
    renderDraftBasketTableViewportRows();
    return;
  }

  // --- FINISHED GOODS STORE: same JobCardMaterials allotment check as Raw Materials Store ---
  if (activeStoreScope === "Finished Goods Store") {
    const jobCardNumberValFGAdd = document.getElementById("ticket-job-card-dropdown")?.value || "";
    const cacheKeyFGAdd = jobCardNumberValFGAdd + "|" + projectId;

    if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== cacheKeyFGAdd) {
      try {
        const jcmDataFGAdd = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValFGAdd, projectId: projectId });
        window._ticketJobCardMaterialsCache = { key: cacheKeyFGAdd, records: jcmDataFGAdd.records || [] };
      } catch(e) {
        window._ticketJobCardMaterialsCache = { key: cacheKeyFGAdd, records: [] };
      }
    }

    const jcmRecordsFGAdd = window._ticketJobCardMaterialsCache.records || [];
    const jcmMatchFGAdd = jcmRecordsFGAdd.find(r => (r.materialName || "").replace(/\s+/g, '').toLowerCase() === cleanSearchKey);

    if (!jcmMatchFGAdd) {
      restoreAddBtn();
      alert("This Finished Goods material has no allotment for " + jobCardNumberValFGAdd + ".");
      return;
    }

    const fgCatalogEntry = (window.itemCodeCatalogCache || []).find(c =>
      (c.productName || "").replace(/\s+/g, "").toLowerCase() === cleanSearchKey
    );

    const existingLineItem = dynamicTicketShoppingBasketArray.find(i => i.materialName.replace(/\s+/g, '').toLowerCase() === cleanSearchKey);
    let totalRequestedQuantity = quantity;
    if (existingLineItem) totalRequestedQuantity += existingLineItem.quantity;

    // Finished Goods Store has no BOQ Increase / Excess Material Request
    // path at all (see handleBOQIncreaseDecision / createBOQLimitIncreaseRequestTicket
    // — both hardcoded to Raw Materials Store only), so unlike Raw/Spare a
    // request over this Job Card's remaining allotment is a hard lockout
    // here, not a soft "flag for admin approval" — there is no admin
    // approval flow on the other end to catch it.
    if (totalRequestedQuantity > Number(jcmMatchFGAdd.remainingQty)) {
      restoreAddBtn();
      alert(`Finished Goods Store Lockout: Only ${fmtQty(jcmMatchFGAdd.remainingQty)} ${jcmMatchFGAdd.unitType || 'units'} of ${materialName} remain allotted to this Job Card. Reduce the quantity — Finished Goods Store requests cannot exceed the Job Card allotment.`);
      return;
    }

    if (existingLineItem) {
      existingLineItem.quantity = totalRequestedQuantity;
      existingLineItem.requiresBOQIncreaseFlag = false;
      existingLineItem.allottedRemainingLimit = jcmMatchFGAdd.remainingQty;
    } else {
      dynamicTicketShoppingBasketArray.push({
        materialName: materialName,
        itemCode: jcmMatchFGAdd.itemCode || "",
        quantity: totalRequestedQuantity,
        unitType: (fgCatalogEntry && fgCatalogEntry.unit) ? fgCatalogEntry.unit : "NOS",
        requiresBOQIncreaseFlag: false,
        allottedRemainingLimit: jcmMatchFGAdd.remainingQty,
        boqId: jcmMatchFGAdd.boqId || "",
        jcmRowIdx: jcmMatchFGAdd.jcmRowIdx
      });
    }
    qtyInput.value = "";
    restoreAddBtn();
    renderDraftBasketTableViewportRows();
    return;
  }

  // --- RAW MATERIALS STORE: inventory + BOQ check ---
  let activeCacheCollection = cachedInventoryStockCollection;
  
  const itemData = activeCacheCollection.find(i => i.materialName.replace(/\s+/g, '').toLowerCase() === cleanSearchKey)
    || activeCacheCollection.find(i => i.materialName.replace(/\s+/g, '').toLowerCase().includes(cleanSearchKey.substring(0, 20)))
    || activeCacheCollection.find(i => cleanSearchKey.includes(i.materialName.replace(/\s+/g, '').toLowerCase().substring(0, 20)));

  if (!itemData) {
    restoreAddBtn();
    alert("Material not found in inventory catalog. Please sync stock first.");
    return;
  }
  
  // Pull JobCardMaterials for this specific job card — source of truth for per-card allotment
  const jobCardNumberVal = document.getElementById("ticket-job-card-dropdown")?.value || "";
  const cacheKey = jobCardNumberVal + "|" + projectId;

  if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== cacheKey) {
    try {
      const jcmData = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberVal, projectId: projectId });
      window._ticketJobCardMaterialsCache = { key: cacheKey, records: jcmData.records || [] };
    } catch(e) {
      window._ticketJobCardMaterialsCache = { key: cacheKey, records: [] };
    }
  }

  function findJcmMatch_(recs) {
    return (recs || []).find(r => (r.itemCode || "").replace(/\s+/g, '').toLowerCase() === (itemData.itemCode || "").replace(/\s+/g, '').toLowerCase())
      || (recs || []).find(r => (r.materialName || "").replace(/\s+/g, '').toLowerCase() === cleanSearchKey);
  }

  let jcmMatch = findJcmMatch_(window._ticketJobCardMaterialsCache.records);

  // SELF-HEAL: same rationale as the BOQ cache above — a miss here could mean this cache
  // was populated before seedJobCardMaterials_ finished writing this row (e.g. right after
  // a BOQ authorize/update in another tab). Force one fresh, uncached re-fetch before
  // blocking the user with a hard "no allotment" error.
  if (!jcmMatch) {
    try {
      const freshJcmData = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberVal, projectId: projectId });
      window._ticketJobCardMaterialsCache = { key: cacheKey, records: freshJcmData.records || [] };
      jcmMatch = findJcmMatch_(window._ticketJobCardMaterialsCache.records);
    } catch(refreshErr) {
      console.error("JobCardMaterials cache self-heal refetch failed:", refreshErr);
    }
  }

  const jcmRecords = window._ticketJobCardMaterialsCache.records || [];

  if (!jcmMatch) {
    restoreAddBtn();
    alert("This material has no Job Card allotment for " + jobCardNumberVal + ". Ensure the BOQ is authorized and the Job Card is saved.");
    return;
  }

  const existingLineItem = dynamicTicketShoppingBasketArray.find(i => i.materialName.replace(/\s+/g, '').toLowerCase() === cleanSearchKey);
  let totalRequestedQuantity = quantity;
  if (existingLineItem) {
    totalRequestedQuantity += existingLineItem.quantity;
  }

  // Total Stock check runs FIRST, independently of the JC-limit check —
  // never nested inside it. A request can sit well within this JC's own
  // remaining_quantity and still be physically impossible if the BOQ's
  // claim was never backed by real stock yet (e.g. still on order, no GRN
  // yet) — in that case the JC-limit check alone would wrongly say "fine"
  // since it only compares against paper entitlement, not what physically
  // exists anywhere in the store.
  const invMatch = (cachedInventoryStockCollection || []).find(i => (i.itemCode || "") === (jcmMatch.itemCode || ""));
  const totalStockForItem = invMatch ? Number(invMatch.totalStock) || 0 : null;
  if (totalStockForItem !== null && totalRequestedQuantity > totalStockForItem) {
    restoreAddBtn();
    alert(`${materialName} requested quantity (${totalRequestedQuantity}) exceeds the current total stock in ${activeStoreScope} (${totalStockForItem}). Reduce the quantity, or check with Purchase Department on when more will arrive.`);
    return;
  }

  const isOverAllottedBOQLimit = totalRequestedQuantity > Number(jcmMatch.remainingQty);
  const allottedLimit = Number(jcmMatch.remainingQty);

  if (existingLineItem) {
    existingLineItem.quantity = totalRequestedQuantity;
    existingLineItem.requiresBOQIncreaseFlag = isOverAllottedBOQLimit;
    existingLineItem.allottedRemainingLimit = allottedLimit;
  } else {
    dynamicTicketShoppingBasketArray.push({
      materialName: itemData.materialName,
      quantity: totalRequestedQuantity,
      unitType: itemData.unitType || "NOS",
      requiresBOQIncreaseFlag: isOverAllottedBOQLimit,
      allottedRemainingLimit: allottedLimit,
      itemCode: jcmMatch.itemCode || itemData.itemCode || "",
      boqId: jcmMatch.boqId || ""
    });
  }
  
  qtyInput.value = "";
  restoreAddBtn();
  renderDraftBasketTableViewportRows();
}

/**
 * 4. RENDER BASKET DATA VIEWPORT ROWS
 */
function renderDraftBasketTableViewportRows() {
  const tbody = document.getElementById("shopping-basket-table-body");
  const materialRequestPanelContainer = document.getElementById("canvas-module-store-material-request");
  
  if (dynamicTicketShoppingBasketArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--muted); padding: 20px;">Your request ticket basket is currently empty.</td></tr>`;
    resetMaterialRequestFormSubmissionActionControlsRow(); // Restores generation defaults
    return;
  }
  
  tbody.innerHTML = "";
  let containsOverAllottedItems = false;
  let overAllottedMaterialsList = [];

  dynamicTicketShoppingBasketArray.forEach((rowItem, arrayIdx) => {
    const tr = document.createElement("tr");
    
    // Highlight over-allocated items with high-contrast text and warm formatting colors
    if (rowItem.requiresBOQIncreaseFlag === true) {
      containsOverAllottedItems = true;
      overAllottedMaterialsList.push(rowItem.materialName);
      tr.style.background = "#fffbeb";
      tr.style.color = "#b45309";
    }

    tr.innerHTML = `
      <td style="font-weight:600; padding:10px 8px;">
        ${rowItem.materialName} 
        ${rowItem.requiresBOQIncreaseFlag ? '<span style="font-size:0.65rem; background:#fef3c7; color:#b45309; padding:1px 4px; border-radius:3px; font-weight:bold; margin-left:4px;">⚠️ EXCEEDS JOB CARD LIMIT</span>' : ''}
      </td>
      <td style="color:var(--muted); font-size:0.8rem;">${rowItem.unitType}</td>
      <td style="font-family:monospace; font-weight:700; font-size:1.05rem; text-align:center;">${rowItem.quantity}</td>
      <td style="text-align:center;">
        <button class="nav-btn-styled" onclick="removeSingleBasketItemLineAtIndex(${arrayIdx})" style="background:#e53e3e; padding:2px 8px; font-size:0.75rem;">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 4. ACTION SWAP INTERCEPTOR: Inject the approval request panel text box if allocation limits are broken
  if (containsOverAllottedItems) {
    renderBOQLimitExceededApprovalRequestWorkspaceBlock(overAllottedMaterialsList);
  } else {
    resetMaterialRequestFormSubmissionActionControlsRow();
  }
}

function resetMaterialRequestFormSubmissionActionControlsRow() {
  const inlineFeedbackBanner = document.getElementById("store-ticket-runtime-inline-feedback-banner");
  const bottomActionControlsRow = document.getElementById("shopping-basket-preview-table").parentElement.nextElementSibling;
  
  if (inlineFeedbackBanner) inlineFeedbackBanner.style.display = "none";
  if (bottomActionControlsRow && !document.getElementById("boq-increase-justification-notes-input")) return;
  
  const parentNodeBox = document.getElementById("shopping-basket-preview-table").parentNode;
  // Recover native Generate Material Ticket options parameters row
  let controlsRow = parentNodeBox.nextElementSibling;
  if (controlsRow) {
    controlsRow.innerHTML = `
      <button class="nav-btn-styled" onclick="clearFullBasketDraftState()" style="background: #718096;">Clear Basket</button>
      <button class="nav-btn-styled" id="submit-ticket-final-btn" onclick="submitMaterialRequestTicketToBackend()" style="background: var(--accent); padding: 8px 20px; font-weight: 700;">Generate Material Ticket</button>
    `;
  }
}

function removeSingleBasketItemLineAtIndex(index) {
  dynamicTicketShoppingBasketArray.splice(index, 1);
  renderDraftBasketTableViewportRows();
}

function clearFullBasketDraftState() {
  dynamicTicketShoppingBasketArray = [];
  renderDraftBasketTableViewportRows();
  checkSpareStoreSuggestion();
}

/**
 * EXECUTE BOQ LIMIT INCREASE REQUEST TRANSMISSION PIPELINE
 * Compiles a flat JSON payload structure directly matching the backend doPost routers
 * to transmit allotment overrun justification entries safely without dropping parameters.
 */
async function executeBOQLimitIncreaseRequestTransmissionPipeline() {
  const notesField = document.getElementById("boq-increase-justification-notes-input");
  const projectId = document.getElementById("ticket-project-id-dropdown-ta-input").value;
  const operatorName = appActiveOperatorIdentityString;
  const departmentVal = document.getElementById("ticket-department-outgoing-dropdown").value;
  const materialRequestPanelContainer = document.getElementById("canvas-module-store-material-request");

  if (!notesField || !notesField.value.trim()) {
    alert("Compulsory Input Missing: You must fill out the Explain Request justification text box notes before sending to Admin.");
    return;
  }
  
  const btn = document.getElementById("submit-ticket-final-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></div> Transmitting Request to Admin...';
  if (!window.storeCreateTicketOriginalTemplateCacheHTML) {
    window.storeCreateTicketOriginalTemplateCacheHTML = materialRequestPanelContainer.innerHTML;
  }
  try {
    // FIXED FLAT PAYLOAD: Flattens parameters straight into the base object root to prevent router switch drops
    const flatServerRequestPayload = {
      action: "createBOQLimitIncreaseRequestTicket",
      activeEngineer: operatorName,
      operatorName: operatorName,
      projectId: projectId,
      jobCardNumber: document.getElementById("ticket-job-card-dropdown")?.value || "",
      departmentOutgoing: departmentVal,
      justificationNotesText: notesField.value.trim(),
      itemsClusterArray: dynamicTicketShoppingBasketArray
    };
    
    const result = await apFetch(flatServerRequestPayload);
    
    if (result.success) {
      dynamicTicketShoppingBasketArray = [];
      materialRequestPanelContainer.style.padding = "20px";
      materialRequestPanelContainer.innerHTML = `
        <div style="background: #e0f2fe; border: 1px solid #0369a1; border-left: 4px solid #0369a1; color: #0369a1; padding: 20px; border-radius: var(--radius); text-align: left; box-shadow: 0 4px 6px rgba(0,0,0,0.02); margin: 10px 0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
          <div>
            <h3 style="font-size: 1.1rem; margin: 0 0 6px 0; font-weight: 700;">Job Card Limit Request Submitted</h3>
            <div style="font-size: 0.92rem; font-weight: 700; display: flex; align-items: center; gap: 4px;">
              Assigned Ticket ID:
              <span style="font-family: monospace; font-weight: 800; background: #fff; padding: 3px 8px; border-radius: 4px; border: 1px solid #0369a1; color: #111827; margin-left: 4px; font-size: 1rem;">
                ${result.ticketId}
              </span>
            </div>
          </div>
          <button class="nav-btn-styled" style="background: #0369a1; color: white; padding: 10px 20px; font-weight: 700; font-size: 0.85rem;" onclick="resetStoreCreateTicketToInitialState()">
            + Create New Ticket
          </button>
        </div>
      `;
    } else {
      alert("Submission Rejected by Server: " + result.error);
      btn.disabled = false;
      btn.textContent = "Send Approval Request to Admin";
    }
  } catch(e) { 
    alert("Network request execution failure: " + e.message); 
    btn.disabled = false;
    btn.textContent = "Send Approval Request to Admin";
  }
}

/**
 * 1. INITIALIZE APPROVALS WORKSPACE LOCK
 * Fetches all un-actioned pending tickets directly from the warehouse ledger
 */
async function initializeStoreManagerApprovalsWorkspace() {
  const cardsFeedZone = document.getElementById("store-manager-approvals-queue-cards-feed");
  const feedbackBanner = document.getElementById("store-approvals-runtime-inline-feedback-banner");
  
  feedbackBanner.style.display = "none";
  cardsFeedZone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);"><div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>Loading Un-Actioned Material Issue Tickets...</div>`;

  try {
    const data = await apFetch({
      action: "fetchPendingTicketsQueueStream"
    });
    if (!data.success) {
      cardsFeedZone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Sync Error: ${data.error}</div>`;
      return;
    }

    renderStoreManagerApprovalsCardsFeed(data.queue);
    startPendingTicketsQueuePolling();

  } catch (error) {
    cardsFeedZone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Network Exception: ${error.message}</div>`;
  }
}

// Shared builder for the "Choose Store" dropdown's option list. 

// Return Material was removed — production returns now come in via Stock
// Sweep. Spare → Raw Material stays: it's a bin-to-bin relocation, not a
// production return, so it moved here rather than leaving with Return mode.
function buildStoreScopeOptionsHtml_(placeholderText, restrictToService) {
  // Service issues (post-invoice replacement/shortage/spare sent for
  // customer servicing) can only draw from Raw or Finished Goods — Spare
  // Store is not a valid source (see submitEngineerMaterialTicket's
  // isServiceIssue guard, routes/store.js).
  if (restrictToService) {
    return `<option value="">${placeholderText}</option>`
      + `<option value="Raw Materials Store">Raw Materials Store</option>`
      + `<option value="Finished Goods Store">Finished Goods Store</option>`;
  }
  return `<option value="">${placeholderText}</option>`
    + `<option value="Raw Materials Store">Raw Materials Store</option>`
    + `<option value="Spare Store">Spare Store</option>`
    + `<option value="Finished Goods Store">Finished Goods Store</option>`;
}

function ticketBOQDisplayReset(text) {
  const disp = document.getElementById("ticket-boq-display");
  const textEl = document.getElementById("ticket-boq-display-text");
  const hidden = document.getElementById("ticket-boq-dropdown");
  const list = document.getElementById("ticket-boq-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function ticketBOQDisplayEnable() {
  const disp = document.getElementById("ticket-boq-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function ticketBOQPopulate(options) {
  const list = document.getElementById("ticket-boq-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectTicketBOQ('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleTicketBOQDropdown() {
  const disp = document.getElementById("ticket-boq-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("ticket-boq-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectTicketBOQ(boqId, label) {
  document.getElementById("ticket-boq-dropdown").value = boqId;
  document.getElementById("ticket-boq-display-text").textContent = label;
  document.getElementById("ticket-boq-dropdown-list").style.display = "none";
  handleCreateTicketBOQChange(boqId);
}

function ticketJobCardDisplayReset(text) {
  const disp = document.getElementById("ticket-job-card-display");
  const textEl = document.getElementById("ticket-job-card-display-text");
  const hidden = document.getElementById("ticket-job-card-dropdown");
  const list = document.getElementById("ticket-job-card-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function ticketJobCardDisplayEnable() {
  const disp = document.getElementById("ticket-job-card-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function ticketJobCardPopulate(options) {
  const list = document.getElementById("ticket-job-card-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectTicketJobCard('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleTicketJobCardDropdown() {
  const disp = document.getElementById("ticket-job-card-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("ticket-job-card-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectTicketJobCard(jobCardNumber, label) {
  document.getElementById("ticket-job-card-dropdown").value = jobCardNumber;
  document.getElementById("ticket-job-card-display-text").textContent = label;
  document.getElementById("ticket-job-card-dropdown-list").style.display = "none";
  handleTicketJobCardChange(jobCardNumber);
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#ticket-boq-display") && !e.target.closest("#ticket-boq-dropdown-list") &&
      !e.target.closest("#ticket-job-card-display") && !e.target.closest("#ticket-job-card-dropdown-list")) {
    const l1 = document.getElementById("ticket-boq-dropdown-list"); if (l1) l1.style.display = "none";
    const l2 = document.getElementById("ticket-job-card-dropdown-list"); if (l2) l2.style.display = "none";
  }
});

function handleStoreTicketTypeInterfaceLayoutChange(chosenModeString) {
  const labelNode = document.getElementById("lbl-dynamic-operator-signature-title");
  const submitBtn = document.getElementById("submit-ticket-final-btn");
  
  if (!labelNode) return;
  
  // CHANGED: Clears the shopping basket arrays completely upon swapping interaction modes to avoid mixing up request types
  clearFullBasketDraftState();
  resetMaterialRequestFormSubmissionActionControlsRow();

  labelNode.textContent = "Requested By *";
  if (submitBtn) submitBtn.textContent = "Generate Material Ticket";

  // Rebuild the Store dropdown's option list immediately — switching back to Request Material
  // must remove the Spare -> Raw Material option if it was showing, and switching to Return
  // Material must add it back, even if the dropdown is currently locked/disabled at this stage.
  const storeScopeDropNow = document.getElementById("ticket-selected-store-scope-toggle");
  if (storeScopeDropNow) {
    const currentPlaceholder = storeScopeDropNow.options[0] ? storeScopeDropNow.options[0].text : "— Choose Requested By First —";
    storeScopeDropNow.innerHTML = buildStoreScopeOptionsHtml_(currentPlaceholder);
  }
}

async function refreshJcQuantitiesLiveInQueue() {
  const cardsFeedZone = document.getElementById("store-manager-approvals-queue-cards-feed");
  if (!cardsFeedZone || !cardsFeedZone.children.length) return;
  try {
    const data = await apFetch({ action: "fetchPendingTicketsQueueStream" });
    if (!data.success) return;
    (data.queue || []).forEach(ticket => {
      const card = document.getElementById(`store-pending-ticket-card-node-${ticket.ticketId}`);
      if (!card) return;
      (ticket.items || []).forEach(item => {
        const allottedCell = card.querySelector(`.ticket-jc-allotted-cell[data-itemcode="${CSS.escape(item.itemCode)}"]`);
        const remainingCell = card.querySelector(`.ticket-jc-remaining-cell[data-itemcode="${CSS.escape(item.itemCode)}"]`);
        const qtyInput = card.querySelector(`.ticket-actual-qty-input[data-itemcode="${CSS.escape(item.itemCode)}"]`);
        if (allottedCell) allottedCell.textContent = (item.jcAllottedQty !== null && item.jcAllottedQty !== undefined) ? fmtQty(item.jcAllottedQty) : "—";
        if (remainingCell) remainingCell.textContent = (item.jcRemainingQty !== null && item.jcRemainingQty !== undefined) ? fmtQty(item.jcRemainingQty) : "—";
        if (qtyInput) qtyInput.dataset.jcremaining = (item.jcRemainingQty !== null && item.jcRemainingQty !== undefined) ? item.jcRemainingQty : "";
      });
    });
  } catch (e) { /* silent — next tick retries */ }
}

function toggleTicketCardBody(ticketId) {
  const body = document.getElementById(`ticket-card-body-${ticketId}`);
  const caret = document.getElementById(`ticket-card-caret-${ticketId}`);
  if (!body) return;
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "block";
  if (caret) caret.textContent = isOpen ? "▸" : "▾";
}

function handleSpareNeededChange(sel) {
  const row = sel.closest("tr");
  const qtyInput = row ? row.querySelector(".ticket-spare-qty-input") : null;
  if (!qtyInput) return;
  if (sel.value === "No") {
    qtyInput.value = "";
    qtyInput.disabled = true;
    qtyInput.style.background = "#f1f5f9";
    qtyInput.style.color = "var(--muted)";
  } else {
    qtyInput.disabled = false;
    qtyInput.style.background = "#fff";
    qtyInput.style.color = "var(--text)";
  }
}

function collectSpareAllocations(ticketId) {
  const card = document.getElementById(`store-pending-ticket-card-node-${ticketId}`);
  const result = {};
  if (!card) return result;
  card.querySelectorAll(".ticket-spare-needed-select").forEach(sel => {
    if (sel.value === "No") return;
    const row = sel.closest("tr");
    const qtyInput = row ? row.querySelector(".ticket-spare-qty-input") : null;
    const qty = qtyInput ? Number(qtyInput.value) : 0;
    result[sel.dataset.itemcode] = { needed: sel.value, qty: (!isNaN(qty) && qty > 0) ? qty : 0 };
  });
  return result;
}

function findInvalidSpareAllocation(ticketId) {
  const card = document.getElementById(`store-pending-ticket-card-node-${ticketId}`);
  if (!card) return null;
  const selects = Array.from(card.querySelectorAll(".ticket-spare-needed-select"));
  for (const sel of selects) {
    if (sel.value === "No") continue;
    const row = sel.closest("tr");
    const qtyInput = row ? row.querySelector(".ticket-spare-qty-input") : null;
    const qty = qtyInput ? Number(qtyInput.value) : NaN;
    if (!qtyInput || qtyInput.value.trim() === "" || isNaN(qty) || qty <= 0) {
      const materialName = row ? row.querySelector("td")?.textContent?.trim() : sel.dataset.itemcode;
      return { itemCode: sel.dataset.itemcode, materialName };
    }
  }
  return null;
}

function clampTicketActualQtyInput(inp) {
  const requested = Number(inp.dataset.requested) || 0;
  let val = parseFloat(inp.value);
  if (isNaN(val) || val < 0) val = 0;
  if (val > requested) { val = requested; inp.value = val; }
}

function collectTicketActualQuantities(ticketId) {
  const card = document.getElementById(`store-pending-ticket-card-node-${ticketId}`);
  const result = {};
  if (!card) return result;
  card.querySelectorAll(".ticket-actual-qty-input").forEach(inp => {
    const requested = Number(inp.dataset.requested) || 0;
    let val = Number(inp.value);
    if (isNaN(val) || val < 0) val = 0;
    if (val > requested) val = requested; // clamp client-side too; server clamps authoritatively
    result[inp.dataset.itemcode] = val;
  });
  return result;
}

function hasEmptyActualQtyInputs(ticketId) {
  const card = document.getElementById(`store-pending-ticket-card-node-${ticketId}`);
  if (!card) return false;
  return Array.from(card.querySelectorAll(".ticket-actual-qty-input")).some(inp => inp.value.trim() === "");
}

function findActualQtyOverJcRemaining(ticketId) {
  const card = document.getElementById(`store-pending-ticket-card-node-${ticketId}`);
  if (!card) return null;
  const inputs = Array.from(card.querySelectorAll(".ticket-actual-qty-input"));
  for (const inp of inputs) {
    if (inp.dataset.jcremaining === "" || inp.dataset.jcremaining === undefined) continue; // no JC tracking for this item (e.g. FG) — nothing to enforce
    const jcRemaining = Number(inp.dataset.jcremaining);
    const actual = Number(inp.value);
    if (!isNaN(actual) && actual > jcRemaining) {
      const row = inp.closest("tr");
      const materialName = row ? row.querySelector("td")?.textContent?.trim() : inp.dataset.itemcode;
      return { itemCode: inp.dataset.itemcode, materialName };
    }
  }
  return null;
}

/**
 * MATERIAL NAME SEARCH INPUT HANDLER
 * Debounced handler for the material search input — triggers filter on each keystroke.
 */
let matrixMaterialSearchDebounceTimer = null;
let matrixActiveMaterialSearchQuery = "";
let matrixActiveProjectSearchQuery = "";
let matrixActiveMaterialSearchDisplay = "";
let matrixActiveProjectSearchDisplay = "";
window.matrixKnownProjectCodes = [];

/**
 * 3. EXECUTE RELEASE DISPATCH ACTION CONTROL LOOP (UPDATED: CLICK ANIMATIONS ADDED)
 * Directly handles instant button transforms, text state loaders, and interface locking keys.
 */
async function openFGReleaseSelectionModal(ticketId) {
  let overlay = document.getElementById("fg-release-modal-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "fg-release-modal-overlay";
    overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:900; display:flex; align-items:center; justify-content:center;";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div style="background:#fff; border-radius:var(--radius); padding:20px; max-width:700px; width:92%; max-height:85vh; overflow-y:auto;">
    <div style="text-align:center; padding:20px; color:var(--muted);">Loading reserved units...</div>
  </div>`;
  overlay.style.display = "flex";

  try {
    const data = await apFetch({ action: "fetchTicketFGReservationDetails", ticketId });
    if (!data.success) { overlay.innerHTML = `<div style="background:#fff; border-radius:8px; padding:20px;">Error: ${data.error}</div>`; return; }

    window._fgReleaseSelections = {};
    data.items.forEach(it => { window._fgReleaseSelections[it.itemCode] = it.reserved.map(r => r.fgId); });

    const itemsHtml = data.items.map(it => `
      <div style="margin-bottom:16px; border:1px solid var(--border); border-radius:var(--radius); padding:12px;">
        <div style="font-weight:700; margin-bottom:8px;">${it.materialName} <span style="color:var(--muted); font-weight:400;">(need ${fmtQty(it.quantity)})</span></div>
        ${it.swapCandidates.map(c => `
          <label style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:0.85rem; cursor:pointer;">
            <input type="checkbox" ${it.reserved.some(r => r.fgId === c.fgId) ? 'checked' : ''}
              onchange="toggleFGReleaseSelection('${it.itemCode}', ${c.fgId}, this.checked, ${it.quantity})">
            <span style="font-family:monospace;">${c.serial || '(no serial)'}</span>
            <span style="color:var(--muted); font-size:0.75rem;">${new Date(c.fgDate).toLocaleDateString()}</span>
          </label>`).join("")}
      </div>`).join("");

    overlay.innerHTML = `<div style="background:#fff; border-radius:var(--radius); padding:20px; max-width:700px; width:92%; max-height:85vh; overflow-y:auto;">
      <h3 style="margin-top:0;">Confirm Finished Goods Units for Release</h3>
      <p style="color:var(--muted); font-size:0.85rem;">Reserved units are pre-checked. Swap by checking a different unit and unchecking one already selected — the count per item must match what was requested.</p>
      ${itemsHtml}
      <div id="fg-release-modal-error" style="color:var(--warn); font-size:0.85rem; margin-bottom:10px; display:none;"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button class="nav-btn-styled" style="background:#718096;" onclick="document.getElementById('fg-release-modal-overlay').style.display='none';">Cancel</button>
        <button class="nav-btn-styled" style="background:var(--accent);" onclick="confirmFGReleaseSelection('${ticketId}')">Confirm & Release</button>
      </div>
    </div>`;
  } catch(e) {
    overlay.innerHTML = `<div style="background:#fff; border-radius:8px; padding:20px;">Network error: ${e.message}</div>`;
  }
}

function toggleFGReleaseSelection(itemCode, fgId, checked, needQty) {
  const sel = window._fgReleaseSelections[itemCode] || [];
  window._fgReleaseSelections[itemCode] = checked ? [...new Set([...sel, fgId])] : sel.filter(id => id !== fgId);
}

function showShortfallResolutionModal(ticketId, projectId, coverageReport) {
  const shortfallItems = coverageReport.filter(r => r.shortfall > 0);

  const itemsHtml = shortfallItems.map(item => {
    const reallOpts = (item.reallocationOptions || []).length > 0
      ? (item.reallocationOptions || []).map(opt => `
          <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.82rem;flex-wrap:wrap;">
            <input type="checkbox" class="realloc-check"
              data-itemcode="${item.itemCode}" data-material="${(item.materialName||'').replace(/"/g,'&quot;')}"
              data-donor="${opt.boqId}" data-surplus="${opt.surplusQty}"
              onchange="updateReallocQtyInput(this)" style="width:auto;flex-shrink:0;" />
            <span>From <strong>${opt.boqId}</strong> — surplus: <strong style="color:#15803d;">${opt.surplusQty}</strong></span>
            <input type="number" class="realloc-qty-input"
              data-itemcode="${item.itemCode}" data-donor="${opt.boqId}"
              min="0" max="${Math.min(opt.surplusQty, item.shortfall)}" value="0"
              style="width:70px;padding:3px 6px;font-weight:700;border:1.5px solid var(--brand);border-radius:3px;flex-shrink:0;" />
          </label>`).join("")
      : `<div style="font-size:0.8rem;color:var(--muted);font-style:italic;">No other BOQs have surplus assigned stock for this material.</div>`;

    return `
      <div style="background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:10px;">
        <div style="font-family:monospace;font-size:0.78rem;color:var(--brand);font-weight:700;">${item.itemCode}</div>
        <div style="font-weight:700;font-size:0.88rem;margin-bottom:8px;">${item.materialName}</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;">
          <div style="background:#f0fdf4;padding:6px;border-radius:4px;text-align:center;">
            <div style="color:var(--muted);font-size:0.62rem;font-weight:700;text-transform:uppercase;">Requested</div>
            <div style="font-weight:800;color:var(--text);">${item.requestedQty}</div>
          </div>
          <div style="background:#f0fdf4;padding:6px;border-radius:4px;text-align:center;">
            <div style="color:var(--muted);font-size:0.62rem;font-weight:700;text-transform:uppercase;">Assigned Remaining</div>
            <div style="font-weight:800;color:#15803d;">${item.remainingAssigned}</div>
          </div>
          <div style="background:#f0f7ff;padding:6px;border-radius:4px;text-align:center;">
            <div style="color:var(--muted);font-size:0.62rem;font-weight:700;text-transform:uppercase;">Pool Available</div>
            <div style="font-weight:800;color:var(--brand);">${item.unassignedPool}</div>
          </div>
          <div style="background:#fff5f5;padding:6px;border-radius:4px;text-align:center;">
            <div style="color:var(--muted);font-size:0.62rem;font-weight:700;text-transform:uppercase;">Shortfall</div>
            <div style="font-weight:800;color:#b91c1c;">${item.shortfall}</div>
          </div>
        </div>
        <div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;color:var(--brand);margin-bottom:6px;letter-spacing:0.5px;">Option B — Reallocate from another BOQ:</div>
        ${reallOpts}
      </div>`;
  }).join("");

  const existing = document.getElementById("shortfall-modal-overlay");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "shortfall-modal-overlay";
  modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:var(--radius);padding:24px;max-width:700px;width:94%;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;border-bottom:2px solid var(--border);padding-bottom:12px;">
        <div>
          <div style="font-size:1rem;font-weight:800;color:#b91c1c;">⚠️ Stock Shortfall Detected</div>
          <div style="font-size:0.8rem;color:var(--muted);margin-top:3px;">Ticket: <strong>${ticketId}</strong> · Project: <strong>${projectId}</strong></div>
        </div>
      </div>
      <div style="background:#fffbeb;border:1.5px solid #f59e0b;border-radius:var(--radius);padding:10px 12px;margin-bottom:14px;font-size:0.82rem;color:#92400e;">
        <strong>Option A — Partial Release:</strong> Release whatever stock is available now. The shortfall is logged as a backorder and flagged on the next GRN.<br/>
        <strong>Option B — Reallocate:</strong> Transfer surplus assigned stock from another BOQ to cover this shortfall, then do a full release.
      </div>
      ${itemsHtml}
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;border-top:1px solid var(--border);padding-top:14px;flex-wrap:wrap;">
        <button class="nav-btn-styled" style="background:#718096;" onclick="document.getElementById('shortfall-modal-overlay').remove()">Cancel</button>
        <button class="nav-btn-styled" style="background:#b45309;" onclick="executeShortfallResolution('${ticketId}', '${projectId}', 'partial')">⚡ Option A — Partial Release</button>
        <button class="nav-btn-styled" style="background:var(--brand);" onclick="executeShortfallResolution('${ticketId}', '${projectId}', 'reallocate')">🔄 Option B — Reallocate & Release</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function updateReallocQtyInput(checkbox) {
  const qtyInput = document.querySelector(`.realloc-qty-input[data-itemcode="${checkbox.dataset.itemcode}"][data-donor="${checkbox.dataset.donor}"]`);
  if (qtyInput) qtyInput.value = checkbox.checked ? Math.min(parseFloat(checkbox.dataset.surplus) || 0, parseFloat(qtyInput.max) || 0) : 0;
}

async function executeShortfallResolution(ticketId, projectId, resolutionType) {
  const overlay = document.getElementById("shortfall-modal-overlay");

  let reallocations = [];
  if (resolutionType === "reallocate") {
    document.querySelectorAll(".realloc-check:checked").forEach(cb => {
      const qtyEl = document.querySelector(`.realloc-qty-input[data-itemcode="${cb.dataset.itemcode}"][data-donor="${cb.dataset.donor}"]`);
      const qty   = parseFloat(qtyEl?.value) || 0;
      if (qty > 0) reallocations.push({
        itemCode:          cb.dataset.itemcode,
        materialName:      cb.dataset.material,
        donorBoqId:        cb.dataset.donor,
        recipientProjectId: projectId,
        transferQty:       qty
      });
    });
    if (reallocations.length === 0) return alert("Select at least one reallocation source and enter a quantity greater than 0.");
  }

  if (overlay) overlay.remove();

  const feedbackBanner = document.getElementById("store-approvals-runtime-inline-feedback-banner");

  try {
    const data = await apFetch({
      action:          "resolveTicketShortfall",
      ticketId,
      resolutionType,
      approverName:    appActiveOperatorIdentityString,
      reallocations
    });

    if (data.success) {
      if (feedbackBanner) {
        feedbackBanner.style.cssText = "display:block;background:#dcfce7;border-left:4px solid #15803d;color:#15803d;padding:12px;margin-bottom:12px;font-weight:700;";
        feedbackBanner.textContent = resolutionType === "partial"
          ? "✅ Partial release completed. Backorder logged for shortfall quantities — will surface on next GRN."
          : "✅ Stock reallocated and ticket fully released.";
      }
      const card = document.getElementById(`store-pending-ticket-card-node-${ticketId}`);
      if (card) card.remove();
      setTimeout(() => {
        if (feedbackBanner) feedbackBanner.style.display = "none";
        if (document.getElementById("store-manager-approvals-queue-cards-feed")?.children.length === 0) {
          initializeStoreManagerApprovalsWorkspace();
        }
      }, 3500);
    } else {
      alert("Resolution failed: " + (data.error || "Unknown error."));
    }
  } catch(e) {
    alert("Network error: " + e.message);
  }
}

/**
 * RESET MATERIAL REQUEST CASCADING LOCK STATE
 * Clears dependent child selectors footprint, re-disables subsequent input fields,
 * and standardizes font colors and opacities across cascading dropdown verification tiers.
 */
function resetMaterialRequestCascadingLockState() {
  const itemDrop = document.getElementById("ticket-item-selection-dropdown");
  const qtyInp = document.getElementById("ticket-item-quantity-input");
  const addBtn = document.getElementById("ticket-add-item-action-btn");

  const deptDrop = document.getElementById("ticket-department-outgoing-dropdown");
  if (deptDrop) {
    if (deptDrop.options[0]) deptDrop.options[0].text = "— Choose Job Card First —";
    deptDrop.value = "";
    deptDrop.disabled = true;
    deptDrop.style.opacity = "0.5";
    deptDrop.style.cursor = "not-allowed";
  }
  const deptLabelReset = document.getElementById("lbl-dept-outgoing-title");
  if (deptLabelReset) deptLabelReset.style.color = "var(--muted)";
  itemDrop.disabled = true; 
  qtyInp.disabled = true; 
  addBtn.disabled = true;

  // Re-lock Choose Store on any cascade reset
  const storeScopeDrop = document.getElementById("ticket-selected-store-scope-toggle");
  const storeScopeLabel = document.getElementById("lbl-store-scope-title");
  if (storeScopeDrop) {
    storeScopeDrop.disabled = true;
    storeScopeDrop.style.opacity = "0.5";
    storeScopeDrop.style.cursor = "not-allowed";
    storeScopeDrop.value = "";
    storeScopeDrop.options[0].text = "— Choose Department First —";
  }
  if (storeScopeLabel) storeScopeLabel.style.color = "var(--muted)";

  document.getElementById("wrapper-ticket-add-item-zone").style.opacity = "0.5";
  addBtn.style.cursor = "not-allowed";
}

/**
 * STEP 1 CHANGE: Dynamic personnel filtration for any chosen outgoing use case.
 * Populates options with personnel belonging to Store, Production, or Admin.
 */
function handleCreateTicketDepartmentChange(chosenDepartmentVal) {
  // Only reset below Department — not the full cascade
  const storeScopeDrop2 = document.getElementById("ticket-selected-store-scope-toggle");
  const storeScopeLabel2 = document.getElementById("lbl-store-scope-title");
  const itemDrop2 = document.getElementById("ticket-item-selection-dropdown");
  const qtyInp2 = document.getElementById("ticket-item-quantity-input");
  const addBtn2 = document.getElementById("ticket-add-item-action-btn");
  if (storeScopeDrop2) { storeScopeDrop2.disabled = true; storeScopeDrop2.style.opacity = "0.5"; storeScopeDrop2.style.cursor = "not-allowed"; storeScopeDrop2.value = ""; if (storeScopeDrop2.options[0]) storeScopeDrop2.options[0].text = "— Choose Department First —"; }
  if (storeScopeLabel2) storeScopeLabel2.style.color = "var(--muted)";
  if (itemDrop2) itemDrop2.disabled = true;
  if (qtyInp2) qtyInp2.disabled = true;
  if (addBtn2) { addBtn2.disabled = true; addBtn2.style.cursor = "not-allowed"; }
  document.getElementById("wrapper-ticket-add-item-zone").style.opacity = "0.5";
  if (!chosenDepartmentVal) return;

  if (storeScopeDrop2) {
    storeScopeDrop2.disabled = false;
    storeScopeDrop2.style.opacity = "1";
    storeScopeDrop2.style.cursor = "pointer";
    storeScopeDrop2.innerHTML = buildStoreScopeOptionsHtml_("— Select Store —", chosenDepartmentVal === "Service");
  }
  if (storeScopeLabel2) storeScopeLabel2.style.color = "var(--brand)";
}

/**
 * STEP 2 CHANGE: Unlocks Step 3 Project Dropdown Field
 */
function handleCreateTicketOperatorChange(chosenOperatorVal) {
  const itemDrop = document.getElementById("ticket-item-selection-dropdown");
  const qtyInp = document.getElementById("ticket-item-quantity-input");
  const addBtn = document.getElementById("ticket-add-item-action-btn");
  const addZone = document.getElementById("wrapper-ticket-add-item-zone");

  if (!chosenOperatorVal) {
    itemDrop.disabled = true; qtyInp.disabled = true; addBtn.disabled = true;
    addZone.style.opacity = "0.5"; addBtn.style.cursor = "not-allowed";
    return;
  }

  // Unlock Choose Store after Requested By is selected
  const storeScopeDrop = document.getElementById("ticket-selected-store-scope-toggle");
  const storeScopeLabel = document.getElementById("lbl-store-scope-title");
  if (storeScopeDrop) {
    storeScopeDrop.disabled = false;
    storeScopeDrop.style.opacity = "1";
    storeScopeDrop.style.cursor = "pointer";
    storeScopeDrop.value = "";
    if (storeScopeDrop.options[0]) storeScopeDrop.options[0].text = "— Choose Store —";
  }
  if (storeScopeLabel) storeScopeLabel.style.color = "var(--brand)";
}

/**
 * STEP 3 CHANGE: Final cascade tier unlocks Step 4 Add Item Canvas Zone Box
 */
// --- LOCATE AND UPDATE THE PROJECT CHANGE HANDLER INSIDE index.html ---

function handleCreateTicketBOQChange(chosenBoqId) {
  const jobCardLabel = document.getElementById("lbl-job-card-title");

  // Clear BOQ cache — different BOQ means different material allocations
  window._ticketBOQCache = null;

  // Reset downstream
  resetMaterialRequestCascadingLockState();
  document.getElementById("ticket-selected-store-scope-toggle").value = "";
  document.getElementById("ticket-selected-store-scope-toggle").disabled = true;
  document.getElementById("ticket-selected-store-scope-toggle").style.opacity = "0.5";

  if (!chosenBoqId) {
    ticketJobCardDisplayReset("— Choose BOQ First —");
    if (jobCardLabel) jobCardLabel.style.color = "var(--muted)";
    return;
  }

  const filtered = (window.ticketJobCardsCache || []).filter(jc => jc.boqId === chosenBoqId);
  ticketJobCardDisplayReset("— Select Job Card Number —");
  ticketJobCardPopulate(filtered.map(jc => ({ value: jc.jobCardNumber, label: `${jc.jobCardNumber} (Set ${jc.setNumber})` })));
  ticketJobCardDisplayEnable();
  if (jobCardLabel) jobCardLabel.style.color = "var(--brand)";
}

async function loadItemCatalogForSelectedProjectAndStore() {
  const itemDrop = document.getElementById("ticket-item-selection-dropdown");
  const qtyInp = document.getElementById("ticket-item-quantity-input");
  const addBtn = document.getElementById("ticket-add-item-action-btn");
  const addZone = document.getElementById("wrapper-ticket-add-item-zone");
  const feedbackBanner = document.getElementById("store-ticket-runtime-inline-feedback-banner");
  const chosenProjectVal = document.getElementById("ticket-project-id-dropdown-ta-input").value;

  if (!chosenProjectVal) {
    itemDrop.disabled = true; qtyInp.disabled = true; addBtn.disabled = true;
    addZone.style.opacity = "0.5"; addBtn.style.cursor = "not-allowed";
    return;
  }

  itemDrop.innerHTML = '<option value="">Loading Catalog...</option>';
  if (feedbackBanner) feedbackBanner.style.display = "none";

  const activeStoreScope = document.getElementById("ticket-selected-store-scope-toggle")?.value || "Raw Materials Store";

  try {
    if (activeStoreScope === "Spare Store") {
      // Spare Store now shows exactly the same Job-Card-allotted material list as Raw Materials
      // Store — the two share one unified JobCardMaterials row per material (see architecture
      // note: a Spare draw and a Raw draw on the same Job Card + item both update the same row).
      // Physical Spare stock is pre-fetched here in the background for the Store Count pill —
      // it does not gate which materials are selectable, only how much of each is available.
      apFetch({ action: "getSpareStoreStock" })
        .then(d => { window.cachedSpareStoreStock = d.stock || []; }).catch(() => {});

      const chosenJobCardValSpare = document.getElementById("ticket-job-card-dropdown")?.value || "";
      if (!chosenJobCardValSpare) {
        itemDrop.innerHTML = '<option value="">⚠️ Select a Job Card Number first</option>';
        addZone.style.opacity = "0.5";
        return;
      }

      const jcmCacheKeySpare = chosenJobCardValSpare + "|" + chosenProjectVal;
      let jcmFetchSpare;
      try {
        jcmFetchSpare = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: chosenJobCardValSpare, projectId: chosenProjectVal });
      } catch(e) {
        jcmFetchSpare = { success: false, records: [], error: e.message };
      }

      // Warm the same cache the pill and Add-button use — no duplicate fetch when a material is picked.
      window._ticketJobCardMaterialsCache = { key: jcmCacheKeySpare, records: jcmFetchSpare.records || [] };

      const spareRecordsForCard = (jcmFetchSpare.records || []).filter(r =>
        (r.typeOfStore || "").toString().trim() !== "Finished Goods Store"
      );

      if (jcmFetchSpare.success && spareRecordsForCard.length > 0) {
        itemDrop.innerHTML = '<option value="" style="font-weight:700;">— Select Material from Job Card —</option>';
        let uniqueMaterialsMapSpare = {};
        spareRecordsForCard.forEach(r => {
          if (!uniqueMaterialsMapSpare[r.materialName]) {
            uniqueMaterialsMapSpare[r.materialName] = true;
            let opt = document.createElement("option");
            opt.value = r.materialName;
            opt.textContent = r.materialName;
            itemDrop.appendChild(opt);
          }
        });
        addZone.style.opacity = "1";
        itemDrop.disabled = false; qtyInp.disabled = false; addBtn.disabled = false;
        addBtn.style.cursor = "pointer";
      } else {
        itemDrop.innerHTML = '<option value="">⚠️ No materials allotted to this Job Card</option>';
        addZone.style.opacity = "0.5";
      }
      return;
    }
    if (activeStoreScope === "Finished Goods Store") {
      const chosenJobCardValFG = document.getElementById("ticket-job-card-dropdown")?.value || "";
      if (!chosenJobCardValFG) {
        itemDrop.innerHTML = '<option value="">⚠️ Select a Job Card Number first</option>';
        addZone.style.opacity = "0.5";
        return;
      }

      const jcmCacheKeyFG = chosenJobCardValFG + "|" + chosenProjectVal;
      let jcmFetchFG;
      try {
        jcmFetchFG = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: chosenJobCardValFG, projectId: chosenProjectVal });
      } catch(e) {
        jcmFetchFG = { success: false, records: [], error: e.message };
      }

      window._ticketJobCardMaterialsCache = { key: jcmCacheKeyFG, records: jcmFetchFG.records || [] };

      const fgRecordsForCard = (jcmFetchFG.records || []).filter(r =>
        (r.typeOfStore || "").toString().trim() === "Finished Goods Store"
      );

      if (jcmFetchFG.success && fgRecordsForCard.length > 0) {
        itemDrop.innerHTML = '<option value="" style="font-weight:700;">— Select Item from Job Card —</option>';
        let uniqueMaterialsMapFG = {};
        fgRecordsForCard.forEach(r => {
          if (!uniqueMaterialsMapFG[r.materialName]) {
            uniqueMaterialsMapFG[r.materialName] = true;
            let opt = document.createElement("option");
            opt.value = r.materialName;
            opt.textContent = r.materialName;
            itemDrop.appendChild(opt);
          }
        });
        addZone.style.opacity = "1";
        itemDrop.disabled = false; qtyInp.disabled = false; addBtn.disabled = false;
        addBtn.style.cursor = "pointer";
      } else {
        itemDrop.innerHTML = '<option value="">⚠️ No Finished Goods materials allotted to this Job Card</option>';
        addZone.style.opacity = "0.5";
      }
      return;
    } else {
      // Pre-fetch spare store stock for the suggestion banner
      apFetch({ action: "getSpareStoreStock" })
        .then(d => { window.cachedSpareStoreStock = d.stock || []; }).catch(() => {});

      // Raw Materials Store — scoped to the SELECTED JOB CARD, not the whole project.
      // Tickets are Job-Card-scoped everywhere else (pill, Add validation) — this dropdown
      // must match, or it offers materials the selected Job Card was never allotted at all.
      const chosenJobCardVal = document.getElementById("ticket-job-card-dropdown")?.value || "";
      if (!chosenJobCardVal) {
        itemDrop.innerHTML = '<option value="">⚠️ Select a Job Card Number first</option>';
        addZone.style.opacity = "0.5";
        return;
      }

      const jcmCacheKey = chosenJobCardVal + "|" + chosenProjectVal;
      let jcmFetch;
      try {
        jcmFetch = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: chosenJobCardVal, projectId: chosenProjectVal });
        console.log("fetchJobCardMaterials response for", chosenJobCardVal, "/", chosenProjectVal, ":", jcmFetch);
      } catch(e) {
        console.error("fetchJobCardMaterials threw:", e);
        jcmFetch = { success: false, records: [], error: e.message };
      }

      // Warm the same cache the pill and Add-button already use — avoids a duplicate fetch
      // the moment a material is selected.
      window._ticketJobCardMaterialsCache = { key: jcmCacheKey, records: jcmFetch.records || [] };

      // Raw and Spare draws share one unified row per Job Card + material,
      // so both dropdowns list the same set — but Finished Goods items are
      // a genuinely separate pool (their own dropdown branch above) and
      // must never appear here.
      const rawRecordsForCard = (jcmFetch.records || []).filter(r =>
        (r.typeOfStore || "").toString().trim() !== "Finished Goods Store"
      );

      if (jcmFetch.success && rawRecordsForCard.length > 0) {
        itemDrop.innerHTML = '<option value="" style="font-weight:700;">— Select Material from Job Card —</option>';
        let uniqueMaterialsMap = {};
        rawRecordsForCard.forEach(r => {
          if (!uniqueMaterialsMap[r.materialName]) {
            uniqueMaterialsMap[r.materialName] = true;
            let opt = document.createElement("option");
            opt.value = r.materialName;
            opt.textContent = r.materialName;
            itemDrop.appendChild(opt);
          }
        });
        addZone.style.opacity = "1";
        itemDrop.disabled = false; qtyInp.disabled = false; addBtn.disabled = false;
        addBtn.style.cursor = "pointer";
      } else {
        itemDrop.innerHTML = '<option value="">⚠️ No materials allotted to this Job Card</option>';
        addZone.style.opacity = "0.5";
      }
    }
  } catch(e) {
    console.error("BOQ filtration setup crash:", e);
  }
}

function handleTicketStoreScopeSelectionChange(chosenStoreValue) {
  // Clear basket and BOQ cache only — Department and Requested By are upstream, never touch them
  stopLiveStockPolling();
  window._ticketBOQCache = null;
  clearFullBasketDraftState();
  document.getElementById("ticket-live-counter-pill-zone").innerHTML = "";
  checkSpareStoreSuggestion();

  // Reset only the Add Item zone below Choose Store
  const itemDrop = document.getElementById("ticket-item-selection-dropdown");
  const qtyInp   = document.getElementById("ticket-item-quantity-input");
  const addBtn   = document.getElementById("ticket-add-item-action-btn");
  const addZone  = document.getElementById("wrapper-ticket-add-item-zone");
  if (itemDrop) { itemDrop.disabled = true; itemDrop.innerHTML = '<option value="">— Select Material —</option>'; }
  if (qtyInp)   qtyInp.disabled = true;
  if (addBtn)   { addBtn.disabled = true; addBtn.style.cursor = "not-allowed"; }
  if (addZone)  addZone.style.opacity = "0.5";

  if (!chosenStoreValue) return;

  // Finished Goods Store can only be requested/returned against Panel, Processing, or Service
  // departments — if the currently-selected department isn't one of those, auto-correct it to
  // Panel rather than leaving an invalid combination selected.
  if (chosenStoreValue === "Finished Goods Store") {
    const deptDropForFG = document.getElementById("ticket-department-outgoing-dropdown");
    const validFGDepts = ["Panel", "Processing", "Service"];
    if (deptDropForFG && !validFGDepts.includes(deptDropForFG.value)) {
      deptDropForFG.value = "Panel";
    }
  }

  // Pre-load item catalog now that store scope is known
  loadItemCatalogForSelectedProjectAndStore();
}

function handleTicketJobCardChange(chosenJobCard) {
  const deptDropdown   = document.getElementById("ticket-department-outgoing-dropdown");
  const deptLabel      = document.getElementById("lbl-dept-outgoing-title");
  const storeScopeDrop = document.getElementById("ticket-selected-store-scope-toggle");
  const storeScopeLabel = document.getElementById("lbl-store-scope-title");

  resetMaterialRequestCascadingLockState();

  // Always keep Choose Store locked at this stage
  if (storeScopeDrop) {
    storeScopeDrop.disabled = true;
    storeScopeDrop.style.opacity = "0.5";
    storeScopeDrop.style.cursor = "not-allowed";
    storeScopeDrop.value = "";
    storeScopeDrop.innerHTML = buildStoreScopeOptionsHtml_("— Choose Department First —");
  }
  if (storeScopeLabel) storeScopeLabel.style.color = "var(--muted)";

  if (!chosenJobCard) {
    if (deptLabel) deptLabel.style.color = "var(--muted)";
    return;
  }

  // Unlock Production Department only
  if (deptDropdown) {
    deptDropdown.disabled = false;
    deptDropdown.style.opacity = "1";
    deptDropdown.style.cursor = "pointer";
    deptDropdown.value = "";
    if (deptDropdown.options[0]) deptDropdown.options[0].text = "— Select Department —";
  }
  if (deptLabel) deptLabel.style.color = "var(--brand)";
}

async function submitAssReservationChanges() {
  const inputs = document.querySelectorAll('#ass-results-body input[data-row]');
  const changes = [];
  inputs.forEach(inp => {
    const row = assStockCache.assignments[Number(inp.dataset.row)];
    const newQty = parseFloat(inp.value) || 0;
    if (Math.abs(newQty - Number(row.assignedQty)) > 1e-9) changes.push({ prnId: row.prnId, newQty });
  });
  if (changes.length === 0) { showBOQBanner("ass-feedback", "No changes to submit.", "error"); return; }
  showBlockingOverlay("Saving reservation changes...");
  try {
    const data = await apFetch({ action: "submitReserveStockChanges", itemCode: assStockCache.itemCode, changes, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (data.success) showAssReservationSuccess(assStockCache.materialName);
    else showBOQBanner("ass-feedback", data.error || "Failed.", "error");
  } catch(e) { showBOQBanner("ass-feedback", "Network error: " + e.message, "error"); }
  finally { hideBlockingOverlay(); }
}

