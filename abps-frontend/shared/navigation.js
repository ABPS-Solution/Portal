let currentActiveModuleContext = "CARD";
let canvasLastParentWorkspaceId = "workspace-searchCompany";

// Reminder banners shown at the top of the Store / Purchase workspace
// enclosures — re-checked on every navigation into either enclosure so
// they disappear on their own once the underlying revision is authorized.
async function checkStorePRNRevisionReminder() {
  const banner = document.getElementById("store-prn-revision-reminder-banner");
  if (!banner) return;
  try {
    const data = await apFetch({ action: "checkBOQsNeedingPRNRevisionCount" });
    banner.style.display = (data.success && data.count > 0) ? "block" : "none";
  } catch (e) { /* non-critical — leave banner state as-is on network error */ }
}

async function checkPurchasePORevisionReminder() {
  const banner = document.getElementById("purchase-po-revision-reminder-banner");
  if (!banner) return;
  try {
    const data = await apFetch({ action: "checkPRNsNeedingPORevisionCount" });
    banner.style.display = (data.success && data.count > 0) ? "block" : "none";
  } catch (e) { /* non-critical — leave banner state as-is on network error */ }
}
async function navigateToModule(key) { 
    window.scrollTo(0, 0);
    setTimeout(() => window.scrollTo(0, 0), 50);
    // 1. Core verification gateway check routing against userPermissions payload mapping
    if (!userPermissions[key]) return alert("Access Denied: Missing permission profile privileges."); 
    
    const canvas = document.getElementById("step2-inline-interaction-canvas");
    if (canvas) {
        canvas.style.display = "none";
    }

    document.getElementById("dashboard-view").style.display = "none"; 
    document.getElementById("module-workspace-container").style.display = "block"; 
    document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none"); 
    
    // Maps keys to the exact workspace element panel DOM IDs
    let targetPanelKeyIdStr = key;
    if (key === "emailLeads") {
        targetPanelKeyIdStr = "emailWhatsapp";
    } else if (key === "dispatchBill") {
        targetPanelKeyIdStr = "dispatchBill";
    } else if (key === "commissioningReport") {
        targetPanelKeyIdStr = "commissioningReport";
    } else if (key === "purchaseOrder") {
        targetPanelKeyIdStr = "purchaseOrder";
        // Always start fresh — otherwise leaving via Return to Main
        // Dashboard mid-review and coming back shows the previous
        // session's Review Extracted Purchase Order screen instead of
        // the blank upload form.
        if (typeof resetPurchaseOrderWorkspace === "function") resetPurchaseOrderWorkspace();
        // Populate owner dropdown with marketing engineers
        const poOwnerDrop = document.getElementById("po-owner-of-order-dropdown");
        if (poOwnerDrop) {
          const populatePOOwnerDrop = () => {
            poOwnerDrop.innerHTML = '<option value="">— Select Engineer —</option>';
            cachedEngineers.forEach(eng => {
              const opt = document.createElement("option");
              opt.value = eng.email; opt.textContent = eng.name;
              poOwnerDrop.appendChild(opt);
            });
            if (appActiveOperatorIdentityString && cachedEngineers.indexOf(appActiveOperatorIdentityString) !== -1) {
              poOwnerDrop.value = appActiveOperatorIdentityString;
            }
          };
          if (cachedEngineers.length > 0) {
            populatePOOwnerDrop();
          } else {
            poOwnerDrop.innerHTML = '<option value="">Loading engineers...</option>';
            let waitAttempts = 0;
            const waitForEngineers = setInterval(() => {
              waitAttempts++;
              if (cachedEngineers.length > 0 || waitAttempts > 25) {
                clearInterval(waitForEngineers);
                if (cachedEngineers.length > 0) populatePOOwnerDrop();
              }
            }, 200);
          }
          // Always default to logged-in user
          setTimeout(() => {
            if (poOwnerDrop.value === "" && appActiveOperatorIdentityString) {
              poOwnerDrop.value = appActiveOperatorIdentityString;
            }
          }, 300);
        }
    }

    const targetWorkspacePanel = document.getElementById("workspace-" + targetPanelKeyIdStr);
    if (targetWorkspacePanel) targetWorkspacePanel.style.display = "block"; 
    
    document.getElementById("multi-contact-records-container").innerHTML = "";
    document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
    document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none";
    document.getElementById("missing-trigger-notice-block").style.display = "none";
    
    const taskOutputNode = document.getElementById("task-matrix-results-output-node");
    if (taskOutputNode) taskOutputNode.innerHTML = "";

    currentActiveModuleContext = (key === "cardDetails") ? "CARD" : (key === "searchCompany" ? "DROPDOWN" : "FILTERS");
    resetSequentialFormState();

    if (key === "cardDetails") {
      fileFront = null; fileBack = null;
      const fb = document.getElementById('front-box'); if (fb) { fb.textContent = '📷 Front Side '; fb.classList.remove('done'); }
      const bb = document.getElementById('back-box'); if (bb) { bb.textContent = '📷 Back Side (Optional)'; bb.classList.remove('done'); }
      const fi = document.getElementById('card-front'); if (fi) fi.value = '';
      const bi = document.getElementById('card-back'); if (bi) bi.value = '';
      ['f-company','f-name','f-position','f-phone','f-altphone','f-email','f-website','f-city','f-state','f-country','f-address'].forEach(function(id){ const el=document.getElementById(id); if(el) el.value=''; });
      document.getElementById('step1-card-capture-block').style.display = 'block';
      document.getElementById('step2-new-entry-dropdown').style.display = 'none';
      document.getElementById('step2-inline-interaction-canvas').style.display = 'none';
      document.getElementById('missing-trigger-notice-block').style.display = 'none';
    }
    
    // Runtime synchronization switches
    if (key === "searchCompany") {
      const companyDropdownNode = document.getElementById("lookup-module-company-dropdown");
      if (companyDropdownNode && companyDropdownNode.value) {
          triggerSequentialSearch('DROPDOWN');
      } else {
          triggerCompanyDropdownArrayFetch();
      }
    } else if (key === "cardDetails") {
      const companyInputTextNode = document.getElementById("f-company");
      if (companyInputTextNode && companyInputTextNode.value.trim() !== "") {
          triggerSequentialSearch('CARD');
      }
    } else if (key === "searchQualification") {
      document.querySelectorAll('input[name="searchQual"]').forEach(cb => cb.checked = false);
      const drawerPanel = document.getElementById("custom-qualifications-sub-drawer");
      if (drawerPanel) drawerPanel.style.display = "block";
      document.getElementById("selected-quals-display").textContent = "";
      loadQualFilter();
    } else if (key === "searchStatus") {
      document.querySelectorAll('input[name="leadMatrixStatusFilter"]').forEach(cb => cb.checked = false);
      renderLeadMatrixEngineerCheckboxes();
      const fd = document.getElementById("lead-matrix-active-filters-display");
      if (fd) { fd.style.display = "none"; fd.textContent = ""; }
    } else if (key === "searchEngineer") {
      const engineerSelectNode = document.getElementById("engineer-filter-select");
      if (engineerSelectNode && engineerSelectNode.value) triggerEngineerSearch();
    } else if (key === "searchCityState") {
      loadCityStateFilterOptions();
    } else if (key === "emailLeads") { 
      executeInboundEmailSyncPipelineFetch();
    }
}

function returnToDashboard() {
  boqFormIsDirty   = false;
  boqUpdateIsDirty = false;
  collapseNewEntryDropdownFormExplicitly(); 
  resetSequentialFormState();

  // Clear any stale "missing person" banner / no-match notice left over from a prior visit
  const bannerHookReset = document.getElementById("split-missing-person-banner-hook");
  if (bannerHookReset) bannerHookReset.innerHTML = "";
  const missingNoticeReset = document.getElementById("missing-trigger-notice-block");
  if (missingNoticeReset) missingNoticeReset.style.display = "none";

  // Duplicate-fields block may have been left hidden from a prior CARD-mode visit — restore
  // it to its default visible state so the next visit starts clean.
  const dupBlockReset = document.getElementById("dropform-duplicate-fields-block");
  if (dupBlockReset) dupBlockReset.style.display = "block";

  // Engineer Name should show its placeholder again, not a stale selection
  const engResetEl = document.getElementById("engName");
  if (engResetEl) engResetEl.value = "";
  
  document.getElementById("module-store-workspace-enclosure-panel").style.display = "none";
  if (document.getElementById("module-purchase-workspace-enclosure-panel")) document.getElementById("module-purchase-workspace-enclosure-panel").style.display = "none";
  
  // Hide all independent inward/outbound sub-modules views panels cleanly
  if(document.getElementById("canvas-module-store-material-request")) document.getElementById("canvas-module-store-material-request").style.display = "none";
  if(document.getElementById("canvas-module-store-manager-approvals")) document.getElementById("canvas-module-store-manager-approvals").style.display = "none";
  if(document.getElementById("canvas-module-store-history-matrix")) document.getElementById("canvas-module-store-history-matrix").style.display = "none";
  if(document.getElementById("canvas-module-store-gate-entry")) document.getElementById("canvas-module-store-gate-entry").style.display = "none";
  if(document.getElementById("canvas-module-store-entry")) document.getElementById("canvas-module-store-entry").style.display = "none";
  if(document.getElementById("canvas-module-store-grn")) document.getElementById("canvas-module-store-grn").style.display = "none";
  if(document.getElementById("canvas-module-store-live-stock")) document.getElementById("canvas-module-store-live-stock").style.display = "none";
  
  // FIXED REDIRECT RUNTIME REMOVES: Clear out the newly mounted Finished Goods view container as well
  if(document.getElementById("canvas-module-store-finished-goods-live-stock")) document.getElementById("canvas-module-store-finished-goods-live-stock").style.display = "none";
  if(document.getElementById("canvas-module-fg-add")) document.getElementById("canvas-module-fg-add").style.display = "none";
  if(document.getElementById("canvas-module-fg-approval")) document.getElementById("canvas-module-fg-approval").style.display = "none";
  if(document.getElementById("canvas-module-project-invoice")) document.getElementById("canvas-module-project-invoice").style.display = "none";
  if(document.getElementById("canvas-module-material-ack")) document.getElementById("canvas-module-material-ack").style.display = "none";

  document.getElementById("module-workspace-container").style.display = "none";
  document.getElementById("dashboard-view").style.display = "block"; 
  
  const canvas = document.getElementById("step2-inline-interaction-canvas");
  if (canvas) canvas.style.display = "none";
  
  document.getElementById("multi-contact-records-container").innerHTML = "";

  // Reset Upload Purchase Order / Dispatch Bill / Commissioning Report sections back to first-visit state
  targetDispatchBillFileObj = null;
  targetCommissioningReportFileObj = null;
  targetPurchaseOrderFileObj = null;

  [
    { boxId: "dispatch-bill-upload-box",        fileId: "dispatch-bill-raw-file",        label: "📋 Select Dispatch Bill",        bannerId: "dispatch-bill-feedback-banner",        containerId: "dispatch-bill-inputs-container",        leadId: "dispatch-bill-lead-dropdown",        btnId: "btn-ops-dispatch-submit",         btnLabel: "Process Dispatch Bill with AI" },
    { boxId: "commissioning-report-upload-box", fileId: "commissioning-report-raw-file", label: "📋 Select Commissioning Report", bannerId: "commissioning-report-feedback-banner", containerId: "commissioning-report-inputs-container", leadId: "commissioning-report-lead-dropdown", btnId: "btn-ops-commission-submit",       btnLabel: "Process Commissioning Report with AI" },
    { boxId: "purchase-order-upload-box",       fileId: "purchase-order-raw-file",       label: "📋 Select Purchase Order",       bannerId: "purchase-order-feedback-banner",       containerId: "purchase-order-inputs-container",       leadId: "purchase-order-lead-dropdown",       btnId: "btn-ops-purchase-order-submit",   btnLabel: "Process Purchase Order with AI" }
  ].forEach(cfg => {
    const box = document.getElementById(cfg.boxId);
    if (box) { box.textContent = cfg.label; box.classList.remove('done'); }
    const fileInput = document.getElementById(cfg.fileId);
    if (fileInput) fileInput.value = '';
    const banner = document.getElementById(cfg.bannerId);
    if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
    const container = document.getElementById(cfg.containerId);
    if (container) container.style.display = 'block';
    const leadDrop = document.getElementById(cfg.leadId);
    if (leadDrop) leadDrop.value = '';
    const btn = document.getElementById(cfg.btnId);
    if (btn) { btn.disabled = false; btn.innerHTML = cfg.btnLabel; }
  });
  const poAcceptDate = document.getElementById('purchase-order-acceptance-date'); if (poAcceptDate) poAcceptDate.value = '';
  const poSpecialReq = document.getElementById('purchase-order-special-requirement'); if (poSpecialReq) poSpecialReq.value = '';
  const poContractReviewInput = document.getElementById('purchase-order-contract-review-file'); if (poContractReviewInput) poContractReviewInput.value = '';
  const poContractReviewBox = document.getElementById('purchase-order-contract-review-box');
  if (poContractReviewBox) { poContractReviewBox.textContent = '📋 Select Contract Review Document *'; poContractReviewBox.classList.remove('done'); }
  // Reset card scan fields for next use
  fileFront = null; fileBack = null;
  const fb = document.getElementById('front-box'); if (fb) { fb.textContent = '📷 Front Side '; fb.classList.remove('done'); }
  const bb = document.getElementById('back-box'); if (bb) { bb.textContent = '📷 Back Side (Optional)'; bb.classList.remove('done'); }
  const fi = document.getElementById('card-front'); if (fi) fi.value = '';
  const bi = document.getElementById('card-back'); if (bi) bi.value = '';
  ['f-company','f-name','f-position','f-phone','f-altphone','f-email','f-website','f-city','f-state','f-country','f-address'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const step1 = document.getElementById('step1-card-capture-block'); if (step1) step1.style.display = 'block';
  document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
  document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none";

  // Reset all search filter sections to clean state
  document.querySelectorAll('input[name="searchQual"], #sq_others_trigger').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[name="leadMatrixStatusFilter"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[name="leadMatrixEngineerFilter"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[name="taskMatrixEngineer"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[name="taskMatrixStatus"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[name="searchCountryFilter"], input[name="searchStateFilter"], input[name="searchCityFilter"]').forEach(cb => cb.checked = false);
  const engDrop = document.getElementById("engineer-filter-select"); if (engDrop) engDrop.value = "";
  const statusDrop = document.getElementById("status-filter-select"); if (statusDrop) statusDrop.value = "";
  const companyDrop = document.getElementById("lookup-module-company-dropdown"); if (companyDrop) companyDrop.value = "";
  const selDisplay = document.getElementById("selected-quals-display"); if (selDisplay) selDisplay.textContent = "";
  const qualDrawer = document.getElementById("custom-qualifications-sub-drawer"); if (qualDrawer) qualDrawer.style.display = "none";
  const taskOutput = document.getElementById("task-matrix-results-output-node"); if (taskOutput) taskOutput.innerHTML = "";
  const tfd = document.getElementById("task-matrix-active-filters-display"); if (tfd) { tfd.style.display = "none"; tfd.textContent = ""; }
  const lfd = document.getElementById("lead-matrix-active-filters-display"); if (lfd) { lfd.style.display = "none"; lfd.textContent = ""; }
  // Full "brand new" reset — stale results from a previous visit to any
  // marketing search screen should never carry over into the next one.
  globalFollowUpsCacheMap = {};
  globalTasksCacheMap = {};

  // Restore search section input blocks that get hidden after a search runs
  const companyDropBlock = document.getElementById("company-dropdown-selector-block"); if (companyDropBlock) companyDropBlock.style.display = "block";
  const step1Card = document.getElementById("step1-card-capture-block"); if (step1Card) step1Card.style.display = "block";

  // Move canvas back to its neutral position inside module-workspace-container
  const canvasNode = document.getElementById("step2-inline-interaction-canvas");
  const mwc = document.getElementById("module-workspace-container");
  if (canvasNode && mwc && canvasNode.parentElement !== mwc) mwc.appendChild(canvasNode);
}

/**
 * DYNAMIC PLATFORM ROLE GATEWAY ENFORCER
 * Evaluates active session authorization permissions matrices,
 * mapping structural visibility states safely across all dashboard grids rows.
 */
function enforceDynamicModuleRoleGateways(userPermissionsObject) {
  // 1. EXTRACT MARKETING ACCESS PRIVILEGES MATRIX
  const canEnterCard               = userPermissionsObject.cardDetails === true;
  const canViewEmailLeads          = userPermissionsObject.emailLeads === true;
  const canUploadDispatchBill      = userPermissionsObject.dispatchBill === true;
  const canUploadCommissioning     = userPermissionsObject.commissioningReport === true;
  const canUploadPurchaseOrder     = userPermissionsObject.purchaseOrder === true;
  const canSearchCompany           = userPermissionsObject.searchCompany === true;
  const canSearchTasks             = userPermissionsObject.searchTasks === true;
  const canSearchStatus            = userPermissionsObject.searchStatus === true;
  const canSearchQual              = userPermissionsObject.searchQualification === true;
  const canSearchCityState         = userPermissionsObject.searchCityState === true;

  // 2. EXTRACT RAW WAREHOUSE ACCESS PRIVILEGES MATRIX
  const canViewLiveStock           = userPermissionsObject.liveStoreStock === true;
  const canUploadInvoice           = userPermissionsObject.storeUploadInvoice === true;
  const canCreateTicket            = userPermissionsObject.storeCreateTicket === true;
  const canReleaseTicket           = userPermissionsObject.storeApproveTickets === true;
  const canSearchStoreMat          = userPermissionsObject.storeAdminMatrix === true;

  // 3. EXTRACT FINISHED GOODS & DESIGN PRIVILEGES MATRIX MATRICES
  const canAddFinishedGoods = userPermissionsObject.addFinishedGoodsStore === true;
  const canFgApproval       = userPermissionsObject.fgApproval           === true;
  const canCreateBOQ        = userPermissionsObject.createBOQ        === true;
  const canAuthorizeBOQ     = userPermissionsObject.authorizeBOQ     === true;
  const canUpdateBOQ        = userPermissionsObject.updateBOQ        === true;
  const canAuthorizeBOQUpdate = userPermissionsObject.authorizeBOQUpdate === true;
  const canViewLiveFinishedStock   = userPermissionsObject.liveFinishedGoodsStoreStock === true;
  const canUploadBOQ               = userPermissionsObject.uploadBOQ === true;
  const canUploadDrawings = userPermissionsObject.uploadDrawings === true;
  const canPurchaseRequestNote     = userPermissionsObject.purchaseRequestNote === true;
  const canViewMaterialListPurchase= userPermissionsObject.materialListForPurchase === true;
  const canCreateJobCardNumber = userPermissionsObject.createJobCardNumber === true;
  const canReserveStoreStock  = userPermissionsObject.reserveStoreStock  === true;
  const canExpectedInbounds = userPermissionsObject.expectedDeliveries === true;
  const canManufacturingClearance = userPermissionsObject.manufacturingClearance === true;
  const canProjectStatus = userPermissionsObject.projectStatus === true;
  const canViewRejectedMaterial = userPermissionsObject.rejectedMaterial === true;
  const canCreatePO = userPermissionsObject.createRMPurchaseOrder === true;
  const canAuthorizePO = userPermissionsObject.authorizeRMPurchaseOrder === true;
  const canAuthorizePRN = userPermissionsObject.authorizePRN === true;
  const canPPSTracking = userPermissionsObject.ppsTracking === true;
  const canRevisePRN = userPermissionsObject.revisePRN === true;
  const canAuthorizePRNRevision = userPermissionsObject.authorizePRNRevision === true;
  const canReviseRMPO = userPermissionsObject.reviseRMPO === true;
  const canAuthorizeRMPORevision = userPermissionsObject.authorizeRMPORevision === true;
  const canSearchRMPO = userPermissionsObject.searchRMPO === true;

  // --- SET INDIVIDUAL VISIBILITY FOR MARKETING TARGET CARDS ---
  if (document.getElementById("mod-card")) {
    document.getElementById("mod-card").style.display = canEnterCard ? "block" : "none";
  }
  if (document.getElementById("mod-email-whatsapp")) {
    document.getElementById("mod-email-whatsapp").style.display = canViewEmailLeads ? "block" : "none";
  }
  if (document.getElementById("mod-dispatch-bill")) {
    document.getElementById("mod-dispatch-bill").style.display = canUploadDispatchBill ? "block" : "none";
  }
  if (document.getElementById("mod-commissioning-report")) {
    document.getElementById("mod-commissioning-report").style.display = canUploadCommissioning ? "block" : "none";
  }
  if (document.getElementById("mod-purchase-order")) {
    document.getElementById("mod-purchase-order").style.display = canUploadPurchaseOrder ? "block" : "none";
  }
  if (document.getElementById("mod-company")) {
    document.getElementById("mod-company").style.display = canSearchCompany ? "block" : "none";
  }
  if (document.getElementById("mod-tasks")) {
    document.getElementById("mod-tasks").style.display = canSearchTasks ? "block" : "none";
  }
  if (document.getElementById("mod-status")) {
    document.getElementById("mod-status").style.display = canSearchStatus ? "block" : "none";
  }
  if (document.getElementById("mod-qual")) {
    document.getElementById("mod-qual").style.display = canSearchQual ? "block" : "none";
  }
  if (document.getElementById("mod-city-state")) {
    document.getElementById("mod-city-state").style.display = canSearchCityState ? "block" : "none";
  }

  // --- SET INDIVIDUAL VISIBILITY FOR STORE & FINISHED GOODS CARDS ---
  // FIXED ALIGNMENT: Dynamically links your frontend layout element IDs perfectly with permissions criteria keys
  if (document.getElementById("mod-store-gate")) {
    document.getElementById("mod-store-gate").style.display = userPermissionsObject.gateEntry === true ? "block" : "none";
  }
  if (document.getElementById("mod-store-entry")) {
    document.getElementById("mod-store-entry").style.display = userPermissionsObject.storeEntryAndGrn === true ? "block" : "none";
  }
  if (document.getElementById("mod-store-grn")) {
    document.getElementById("mod-store-grn").style.display = userPermissionsObject.qaCheck === true ? "block" : "none";
  }
  if (document.getElementById("mod-store-ticket")) {
    document.getElementById("mod-store-ticket").style.display = canCreateTicket ? "block" : "none";
  }
  
  if (document.getElementById("mod-fg-add")) document.getElementById("mod-fg-add").style.display = canAddFinishedGoods ? "block" : "none";
  if (document.getElementById("mod-fg-approval")) document.getElementById("mod-fg-approval").style.display = canFgApproval ? "block" : "none";
  const canProjectInvoiceGeneration = userPermissionsObject.projectInvoiceGeneration === true;
  if (document.getElementById("mod-project-invoice")) document.getElementById("mod-project-invoice").style.display = canProjectInvoiceGeneration ? "block" : "none";
  if (document.getElementById("mod-jc-letterhead")) document.getElementById("mod-jc-letterhead").style.display = userPermissionsObject.jobCardLetterhead === true ? "block" : "none";
  const canAcknowledgeMaterialReceipt = userPermissionsObject.acknowledgeMaterialReceipt === true;
  if (document.getElementById("mod-material-ack")) document.getElementById("mod-material-ack").style.display = canAcknowledgeMaterialReceipt ? "block" : "none";

  const canApproveBOQIncrease = userPermissionsObject.approveJCIncrease === true;
  if (document.getElementById("mod-boq-increase-approvals")) {
    document.getElementById("mod-boq-increase-approvals").style.display = canApproveBOQIncrease ? "block" : "none";
  }
  if (document.getElementById("mod-store-approvals")) {
    document.getElementById("mod-store-approvals").style.display = canReleaseTicket ? "block" : "none";
  }
  if (document.getElementById("mod-live-store-stock")) {
    document.getElementById("mod-live-store-stock").style.display = canViewLiveStock ? "block" : "none";
  }
  if (document.getElementById("mod-store-matrix")) {
    document.getElementById("mod-store-matrix").style.display = canSearchStoreMat ? "block" : "none";
  }
  
  // Finished Goods Card visibility state markers bindings
  if (document.getElementById("mod-live-finished-store-stock")) {
    document.getElementById("mod-live-finished-store-stock").style.display = canViewLiveFinishedStock ? "block" : "none";
  }

  // --- SET INDIVIDUAL VISIBILITY FOR DESIGN CARDS ---
  if (document.getElementById("mod-design-create-boq"))   document.getElementById("mod-design-create-boq").style.display   = canCreateBOQ ? "block" : "none";
  if (document.getElementById("mod-design-auth-boq"))     document.getElementById("mod-design-auth-boq").style.display     = canAuthorizeBOQ ? "block" : "none";
  if (document.getElementById("mod-design-update-boq"))   document.getElementById("mod-design-update-boq").style.display   = canUpdateBOQ ? "block" : "none";
  if (document.getElementById("mod-design-auth-boq-upd")) document.getElementById("mod-design-auth-boq-upd").style.display = canAuthorizeBOQUpdate ? "block" : "none";
  if (document.getElementById("mod-design-upload-drawings")) document.getElementById("mod-design-upload-drawings").style.display = canUploadDrawings ? "block" : "none";
  const canSeeItemCode = canCreateBOQ || canAuthorizeBOQ || canUpdateBOQ || canAuthorizeBOQUpdate || canUploadDrawings
    || userPermissionsObject.storeEntryAndGrn === true
    || userPermissionsObject.qaCheck === true
    || userPermissionsObject.itemCodeAccess === true;
  if (document.getElementById("mod-design-itemcode")) {
    document.getElementById("mod-design-itemcode").style.display = canSeeItemCode ? "block" : "none";
  }

  // Design block visibility
  const designHeaderBlock = document.getElementById("dashboard-design-department-header-block");
  if (designHeaderBlock) {
    designHeaderBlock.style.display = (canCreateBOQ || canAuthorizeBOQ || canUpdateBOQ || canAuthorizeBOQUpdate || canUploadDrawings || canSeeItemCode) ? "block" : "none";
  }

  // Purchase Department block visibility
  if (document.getElementById("mod-purchase-request-note"))  document.getElementById("mod-purchase-request-note").style.display  = canPurchaseRequestNote      ? "block" : "none";
  if (document.getElementById("mod-purchase-material-list")) document.getElementById("mod-purchase-material-list").style.display = canViewMaterialListPurchase  ? "block" : "none";
  if (document.getElementById("mod-purchase-create-po"))     document.getElementById("mod-purchase-create-po").style.display     = canCreatePO    ? "block" : "none";
  if (document.getElementById("mod-purchase-authorize-po"))  document.getElementById("mod-purchase-authorize-po").style.display  = canAuthorizePO ? "block" : "none";
  if (document.getElementById("mod-purchase-authorize-prn")) document.getElementById("mod-purchase-authorize-prn").style.display = canAuthorizePRN ? "block" : "none";
  if (document.getElementById("mod-purchase-pps-tracking"))  document.getElementById("mod-purchase-pps-tracking").style.display  = canPPSTracking ? "block" : "none";
  if (document.getElementById("mod-purchase-rejected-material")) document.getElementById("mod-purchase-rejected-material").style.display = canViewRejectedMaterial ? "block" : "none";
  if (document.getElementById("mod-revise-prn")) document.getElementById("mod-revise-prn").style.display = canRevisePRN ? "block" : "none";
  if (document.getElementById("mod-authorize-prn-revision")) document.getElementById("mod-authorize-prn-revision").style.display = canAuthorizePRNRevision ? "block" : "none";
  if (document.getElementById("mod-revise-rm-po")) document.getElementById("mod-revise-rm-po").style.display = canReviseRMPO ? "block" : "none";
  if (document.getElementById("mod-authorize-rm-po-revision")) document.getElementById("mod-authorize-rm-po-revision").style.display = canAuthorizeRMPORevision ? "block" : "none";
  if (document.getElementById("mod-search-rm-po")) document.getElementById("mod-search-rm-po").style.display = canSearchRMPO ? "block" : "none";
  const purchaseHeaderBlock = document.getElementById("dashboard-purchase-department-header-block");
  if (purchaseHeaderBlock) {
    purchaseHeaderBlock.style.display = (canViewMaterialListPurchase || canViewRejectedMaterial || canCreatePO || canAuthorizePO || canPPSTracking || userPermissionsObject.viewPurchaseDashboard === true) ? "block" : "none";
  }

  // Production Department block visibility
  const productionHeaderBlock = document.getElementById("dashboard-production-department-header-block");
  if (productionHeaderBlock) {
    productionHeaderBlock.style.display = (canCreateJobCardNumber || canCreateTicket || canAddFinishedGoods || canFgApproval || canProjectInvoiceGeneration || canAcknowledgeMaterialReceipt) ? "block" : "none";
  }

  // Live Spare Store Stock card visibility
  const canLiveSpareStoreStock = userPermissionsObject.liveSpareStoreStock === true;
  if (document.getElementById("mod-live-spare-store-stock")) document.getElementById("mod-live-spare-store-stock").style.display = canLiveSpareStoreStock ? "block" : "none";
  if (document.getElementById("mod-assign-current-stock")) document.getElementById("mod-assign-current-stock").style.display = canReserveStoreStock ? "block" : "none";
  if (document.getElementById("mod-stock-sweep")) document.getElementById("mod-stock-sweep").style.display = canReserveStoreStock ? "block" : "none";
  if (document.getElementById("mod-expected-inbounds")) document.getElementById("mod-expected-inbounds").style.display = canExpectedInbounds ? "block" : "none";

  // --- DASHBOARD WRAPPER VISIBILITY (show entire wrapper, not just the card) ---
  const dashMap = {
    "mod-design-dashboard-wrapper":      userPermissionsObject.viewDesignDashboard,
    "mod-purchase-dashboard-wrapper":    userPermissionsObject.viewPurchaseDashboard,
    "mod-store-dashboard-wrapper":       userPermissionsObject.viewStoreDashboard,
    "mod-production-dashboard-wrapper":  userPermissionsObject.viewProductionDashboard,
    "mod-marketing-dashboard-wrapper":   userPermissionsObject.viewMarketingDashboard,
  };
  Object.keys(dashMap).forEach(function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (dashMap[id] === true) {
      el.style.removeProperty("display");
      el.classList.add("dept-dash-pill-visible");
    } else {
      el.style.display = "none";
      el.classList.remove("dept-dash-pill-visible");
    }
  });

  // --- EVALUATE DEPARTMENT ENCLOSURE OVERLAYS ---
  const marketingHeaderBlock = document.getElementById("dashboard-marketing-department-header-block");
  if (marketingHeaderBlock) {
    marketingHeaderBlock.style.display = (canEnterCard || canViewEmailLeads || canUploadDispatchBill || canUploadCommissioning || canUploadPurchaseOrder || canSearchCompany || canSearchTasks || canSearchStatus || canSearchQual || canSearchCityState) ? "block" : "none";
  }

  const storeHeaderBlock = document.getElementById("dashboard-store-department-header-block");
      if (storeHeaderBlock) {
        storeHeaderBlock.style.display = (canViewLiveStock || canReleaseTicket || canSearchStoreMat || canApproveBOQIncrease || userPermissionsObject.gateEntry === true || userPermissionsObject.storeEntryAndGrn === true || userPermissionsObject.qaCheck === true || canViewLiveFinishedStock || canLiveSpareStoreStock || canReserveStoreStock || canPurchaseRequestNote) ? "block" : "none";
      }

      if (document.getElementById("mod-manufacturing-clearance")) document.getElementById("mod-manufacturing-clearance").style.display = canManufacturingClearance ? "block" : "none";
      if (document.getElementById("mod-project-status")) document.getElementById("mod-project-status").style.display = canProjectStatus ? "block" : "none";
      const projectHeaderBlock = document.getElementById("dashboard-project-department-header-block");
      if (projectHeaderBlock) projectHeaderBlock.style.display = (canManufacturingClearance || canProjectStatus) ? "block" : "none";

      const canTourExpense = userPermissionsObject.tourExpense === true;
      if (document.getElementById("mod-tour-expense")) document.getElementById("mod-tour-expense").style.display = canTourExpense ? "block" : "none";
      const accountsHeaderBlock = document.getElementById("dashboard-accounts-department-header-block");
      if (accountsHeaderBlock) accountsHeaderBlock.style.display = canTourExpense ? "block" : "none";
}

function navigateToStoreWorkspacePanel(targetPanelModuleId) {
  window.scrollTo(0, 0);
  setTimeout(() => window.scrollTo(0, 0), 50);
  checkStorePRNRevisionReminder();
  stopLiveStockPolling();
  stopPendingTicketsQueuePolling();
  // 1. Hide the primary dashboard menu grid view and the global marketing containers completely
  document.getElementById("dashboard-view").style.display = "none";
  document.querySelectorAll("#module-workspace-container .workspace-panel").forEach(p => p.style.display = "none");
  document.getElementById("module-workspace-container").style.display = "none";

  // 2. Hide all store sub-modules panels explicitly to ensure no element blending artifact drops
  if (document.getElementById("canvas-module-store-material-request")) document.getElementById("canvas-module-store-material-request").style.display = "none";
  if (document.getElementById("canvas-module-boq-increase-approvals")) document.getElementById("canvas-module-boq-increase-approvals").style.display = "none";
  if (document.getElementById("canvas-module-store-manager-approvals")) document.getElementById("canvas-module-store-manager-approvals").style.display = "none";
  if (document.getElementById("canvas-module-store-history-matrix")) document.getElementById("canvas-module-store-history-matrix").style.display = "none";
  if (document.getElementById("canvas-module-store-live-stock")) document.getElementById("canvas-module-store-live-stock").style.display = "none";
  if (document.getElementById("canvas-module-store-finished-goods-live-stock")) document.getElementById("canvas-module-store-finished-goods-live-stock").style.display = "none";
  if (document.getElementById("canvas-module-fg-reactor"))   document.getElementById("canvas-module-fg-reactor").style.display   = "none";
  if (document.getElementById("canvas-module-fg-capacitor")) document.getElementById("canvas-module-fg-capacitor").style.display = "none";
  if (document.getElementById("canvas-module-fg-panel"))     document.getElementById("canvas-module-fg-panel").style.display     = "none";
  if (document.getElementById("canvas-module-store-gate-entry")) document.getElementById("canvas-module-store-gate-entry").style.display = "none";
  if (document.getElementById("canvas-module-store-entry")) document.getElementById("canvas-module-store-entry").style.display = "none";
  if (document.getElementById("canvas-module-store-grn")) document.getElementById("canvas-module-store-grn").style.display = "none";
  if (document.getElementById("canvas-module-assign-current-stock")) document.getElementById("canvas-module-assign-current-stock").style.display = "none";
  if (document.getElementById("canvas-module-expected-inbounds")) document.getElementById("canvas-module-expected-inbounds").style.display = "none";

  // 3. Force reveal the parent enclosure panel wrapper canvas box wide
  document.getElementById("module-store-workspace-enclosure-panel").style.display = "block";

  // Toggle explicit synchronization header controllers visibility rules context parameters
  const leftControls = document.getElementById("store-panel-left-controls");
  const centerTitle = document.getElementById("store-panel-center-title");
  
  // Handled explicitly for standard raw materials inventory panels
  const isLiveStock = targetPanelModuleId === 'store-live-stock';
  if (leftControls) leftControls.style.visibility = isLiveStock ? "visible" : "hidden";
  if (centerTitle) {
    centerTitle.style.visibility = isLiveStock ? "visible" : "hidden";
    if (isLiveStock) {
      centerTitle.textContent = "Live Raw Materials Store Stock";
    }
  }
  
  // Re-map sync action click listener attributes natively back to default
  const syncBtn = document.getElementById("live-stock-sync-btn");
  if (syncBtn && isLiveStock) {
    syncBtn.removeAttribute("onclick");
    syncBtn.onclick = function() { triggerLiveWarehouseStockMetricsSync(); };
  }

  // 4. CORE STORE PIPELINE WORKSPACE GATING SWITCH
  if (targetPanelModuleId === 'store-material-request') {
    document.getElementById("canvas-module-store-material-request").style.display = "block";
    initializeMaterialRequestWorkspace();
  } else if (targetPanelModuleId === 'boq-increase-approvals') {
    document.getElementById("canvas-module-boq-increase-approvals").style.display = "block";
    initializeBOQIncreaseApprovalsWorkspace();
  } else if (targetPanelModuleId === 'store-manager-approvals') {
    document.getElementById("canvas-module-store-manager-approvals").style.display = "block";
    initializeStoreManagerApprovalsWorkspace();
  } else if (targetPanelModuleId === 'store-history-matrix') {
    document.getElementById("canvas-module-store-history-matrix").style.display = "block";
    initializeStoreHistoryMatrixWorkspace();
  } else if (targetPanelModuleId === 'store-live-stock') {
    document.getElementById("canvas-module-store-live-stock").style.display = "block";
    triggerLiveWarehouseStockMetricsSync();
  } else if (targetPanelModuleId === 'store-gate-entry') {
    document.getElementById("canvas-module-store-gate-entry").style.display = "block";
    resetGateEntryWorkspaceState();
  } else if (targetPanelModuleId === 'store-entry') {
    document.getElementById("canvas-module-store-entry").style.display = "block";
    const seBanner = document.getElementById("store-entry-runtime-feedback-banner");
    if (seBanner) { seBanner.style.display = "none"; seBanner.innerHTML = ""; }
    initializeStoreEntryWorkspaceQueue();
  } else if (targetPanelModuleId === 'store-grn') {
    document.getElementById("canvas-module-store-grn").style.display = "block";
    const grnBanner = document.getElementById("store-grn-runtime-feedback-banner");
    if (grnBanner) { grnBanner.style.display = "none"; grnBanner.innerHTML = ""; }
    window.activeQAToggle = "pending";
    initializeStoreGrnWorkspaceQueue('pending');
  } else if (targetPanelModuleId === 'stock-sweep') {
    document.getElementById("canvas-module-stock-sweep").style.display = "block";
    initializeStockSweepPanel();
  } else if (targetPanelModuleId === 'assign-current-stock') {
    document.getElementById("canvas-module-assign-current-stock").style.display = "block";
    initializeAssignCurrentStockPanel();
  } else if (targetPanelModuleId === 'expected-inbounds') {
    document.getElementById("canvas-module-expected-inbounds").style.display = "block";
    initializeExpectedInboundsPanel();  
  }
}

function switchActiveDashboardModule(targetCanvasModuleId) {
  window.scrollTo(0, 0);
  checkStorePRNRevisionReminder();
  // 1. Hide the primary dashboard menu card view and inline popup filters
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.getElementById("step2-inline-interaction-canvas").style.display = "none";
  
  // 2. Hide all modular store sub-sections layout sheets containers
  if (document.getElementById("canvas-module-store-gate-entry")) document.getElementById("canvas-module-store-gate-entry").style.display = "none";
  if (document.getElementById("canvas-module-store-entry")) document.getElementById("canvas-module-store-entry").style.display = "none";
  if (document.getElementById("canvas-module-store-grn")) document.getElementById("canvas-module-store-grn").style.display = "none";
  if (document.getElementById("canvas-module-store-material-request")) document.getElementById("canvas-module-store-material-request").style.display = "none";
  if (document.getElementById("canvas-module-boq-increase-approvals")) document.getElementById("canvas-module-boq-increase-approvals").style.display = "none";
  if (document.getElementById("canvas-module-store-manager-approvals")) document.getElementById("canvas-module-store-manager-approvals").style.display = "none";
  if (document.getElementById("canvas-module-store-live-stock")) document.getElementById("canvas-module-store-live-stock").style.display = "none";
  if (document.getElementById("canvas-module-store-finished-goods-live-stock")) document.getElementById("canvas-module-store-finished-goods-live-stock").style.display = "none";
  if (document.getElementById("canvas-module-fg-reactor"))   document.getElementById("canvas-module-fg-reactor").style.display   = "none";
  if (document.getElementById("canvas-module-fg-capacitor")) document.getElementById("canvas-module-fg-capacitor").style.display = "none";
  if (document.getElementById("canvas-module-fg-panel"))     document.getElementById("canvas-module-fg-panel").style.display     = "none";
  if (document.getElementById("canvas-module-store-history-matrix")) document.getElementById("canvas-module-store-history-matrix").style.display = "none";
  
  // 3. Hide all design engineering sub-module views panels
  if (document.getElementById("module-design-workspace-enclosure-panel")) document.getElementById("module-design-workspace-enclosure-panel").style.display = "none";

  // 4. ROUTE CRITERIA SWITCH GATING HARNESS
  if (targetCanvasModuleId === 'marketing-leads') {
    navigateToModule('searchCompany');
  } else if (targetCanvasModuleId === 'marketing-email-leads') {
    navigateToModule('emailLeads');
  } else if (targetCanvasModuleId === 'marketing-tasks') {
    navigateToModule('searchTasks');
  } 
  // Raw Materials Store Inward operations routing passes
  else if (targetCanvasModuleId === 'store-gate-entry') {
    navigateToStoreWorkspacePanel('store-gate-entry');
  } else if (targetCanvasModuleId === 'store-entry') {
    navigateToStoreWorkspacePanel('store-entry');
  } else if (targetCanvasModuleId === 'store-grn') {
    navigateToStoreWorkspacePanel('store-grn');
  }
  // Raw Materials Store Outward operations routing passes
  else if (targetCanvasModuleId === 'store-material-request') {
    navigateToStoreWorkspacePanel('store-material-request');
  } else if (targetCanvasModuleId === 'store-manager-approvals') {
    navigateToStoreWorkspacePanel('store-manager-approvals');
  } 
  // Reporting inventories metric sheets passes
  else if (targetCanvasModuleId === 'store-live-stock') {
    navigateToStoreWorkspacePanel('store-live-stock');
  } else if (targetCanvasModuleId === 'store-live-finished-goods' || targetCanvasModuleId === 'live-finished-goods') {
    document.getElementById("module-store-workspace-enclosure-panel").style.display = "block";
    document.querySelectorAll("#module-store-workspace-enclosure-panel .workspace-panel").forEach(p => p.style.display = "none");
    const leftControls = document.getElementById("store-panel-left-controls");
    const centerTitle  = document.getElementById("store-panel-center-title");
    const syncBtn      = document.getElementById("live-stock-sync-btn");
    if (leftControls) leftControls.style.visibility = "visible";
    if (centerTitle)  { centerTitle.style.visibility = "visible"; centerTitle.textContent = "Live Finished Goods Store Stock"; }
    if (syncBtn) {
      syncBtn.removeAttribute("onclick");
      syncBtn.onclick = function() { triggerLiveFinishedGoodsStoreStockMetricsSync(); };
    }
    document.getElementById("canvas-module-store-live-fg").style.display = "block";
    triggerLiveFinishedGoodsStoreStockMetricsSync();
  } else if (targetCanvasModuleId === 'store-live-spare') {
    document.getElementById("module-store-workspace-enclosure-panel").style.display = "block";
    document.querySelectorAll("#module-store-workspace-enclosure-panel .workspace-panel").forEach(p => p.style.display = "none");
    const leftControls = document.getElementById("store-panel-left-controls");
    const centerTitle  = document.getElementById("store-panel-center-title");
    const syncBtn      = document.getElementById("live-stock-sync-btn");
    if (leftControls) leftControls.style.visibility = "visible";
    if (centerTitle)  { centerTitle.style.visibility  = "visible"; centerTitle.textContent = "Live Spare Store Stock"; }
    if (syncBtn) {
      syncBtn.removeAttribute("onclick");
      syncBtn.onclick = function() { triggerLiveSpareStoreStockMetricsSync(); };
    }
    document.getElementById("canvas-module-store-live-spare").style.display = "block";
    triggerLiveSpareStoreStockMetricsSync();
  } else if (targetCanvasModuleId === 'manufacturing-clearance') {
    document.getElementById("dashboard-view").style.display = "none";
    const c = document.getElementById("canvas-module-manufacturing-clearance");
    if (c) { c.style.display = "block"; initializeManufacturingClearancePanel(); }
  } else if (targetCanvasModuleId === 'store-history-matrix') {
    navigateToStoreWorkspacePanel('store-history-matrix');
  } else if (targetCanvasModuleId === 'design-itemcode') {
    navigateToDesignWorkspacePanel('design-itemcode');
  } else if (targetCanvasModuleId === 'dispatched-product-code') {
    navigateToDesignWorkspacePanel('dispatched-product-code');
  } else if (targetCanvasModuleId === 'design-create-boq') {
    navigateToDesignWorkspacePanel('design-create-boq');
  } else if (targetCanvasModuleId === 'design-auth-boq') {
    navigateToDesignWorkspacePanel('design-auth-boq');
  } else if (targetCanvasModuleId === 'design-update-boq') {
    navigateToDesignWorkspacePanel('design-update-boq');
  } else if (targetCanvasModuleId === 'design-auth-boq-upd') {
    navigateToDesignWorkspacePanel('design-auth-boq-upd');
  } else if (targetCanvasModuleId === 'design-upload-drawings') {
    navigateToDesignWorkspacePanel('design-upload-drawings');
  } else if (targetCanvasModuleId === 'jc-letterhead') {
    document.getElementById("module-store-workspace-enclosure-panel").style.display = "block";
    const leftControlsJCLH = document.getElementById("store-panel-left-controls");
    const centerTitleJCLH  = document.getElementById("store-panel-center-title");
    if (leftControlsJCLH) leftControlsJCLH.style.visibility = "hidden";
    if (centerTitleJCLH)  centerTitleJCLH.style.visibility  = "hidden";
    document.getElementById("canvas-module-jc-letterhead").style.display = "block";
    initializeJCLHWorkspace();
  } else if (targetCanvasModuleId === 'fg-add') {
    document.getElementById("module-store-workspace-enclosure-panel").style.display = "block";
    const leftControls = document.getElementById("store-panel-left-controls");
    const centerTitle  = document.getElementById("store-panel-center-title");
    if (leftControls) leftControls.style.visibility = "hidden";
    if (centerTitle)  centerTitle.style.visibility  = "hidden";
    document.getElementById("canvas-module-fg-add").style.display = "block";
    initializeFGAddWorkspace()
  } else if (targetCanvasModuleId === 'fg-approval') {
    document.getElementById("module-store-workspace-enclosure-panel").style.display = "block";
    const leftControlsFGA = document.getElementById("store-panel-left-controls");
    const centerTitleFGA  = document.getElementById("store-panel-center-title");
    if (leftControlsFGA) leftControlsFGA.style.visibility = "hidden";
    if (centerTitleFGA)  centerTitleFGA.style.visibility  = "hidden";
    document.getElementById("canvas-module-fg-approval").style.display = "block";
    initializeFGApprovalWorkspace();
  } else if (targetCanvasModuleId === 'project-invoice') {
    document.getElementById("module-store-workspace-enclosure-panel").style.display = "block";
    const leftControls = document.getElementById("store-panel-left-controls");
    const centerTitle  = document.getElementById("store-panel-center-title");
    if (leftControls) leftControls.style.visibility = "hidden";
    if (centerTitle)  centerTitle.style.visibility  = "hidden";
    document.getElementById("canvas-module-project-invoice").style.display = "block";
    initializePinvWorkspace();
  } else if (targetCanvasModuleId === 'material-ack') {
    document.getElementById("module-store-workspace-enclosure-panel").style.display = "block";
    const leftControlsMA = document.getElementById("store-panel-left-controls");
    const centerTitleMA  = document.getElementById("store-panel-center-title");
    if (leftControlsMA) leftControlsMA.style.visibility = "hidden";
    if (centerTitleMA)  centerTitleMA.style.visibility  = "hidden";
    document.getElementById("canvas-module-material-ack").style.display = "block";
    initializeMaterialAckWorkspace();
  } else if (targetCanvasModuleId === 'tour-expense') {
    document.getElementById("dashboard-view").style.display = "none";
    const teCanvas = document.getElementById("canvas-module-tour-expense");
    if (teCanvas) { teCanvas.style.display = "block"; initializeTourExpensePanel(); }
  } else if (targetCanvasModuleId === 'project-status') {
    document.getElementById("dashboard-view").style.display = "none";
    const psCanvas = document.getElementById("canvas-module-project-status");
    if (psCanvas) { psCanvas.style.display = "block"; initializeProjectStatusPanel(); }
  } else if (targetCanvasModuleId === 'coming-soon') {
    document.getElementById("dashboard-view").style.display = "none";
    document.getElementById("module-workspace-container").style.display = "block";
    document.querySelectorAll("#module-workspace-container .workspace-panel").forEach(p => p.style.display = "none");
    document.getElementById("workspace-coming-soon").style.display = "block";
  }
}

function exitManufacturingClearanceBackToMenu() {
  document.getElementById("canvas-module-manufacturing-clearance").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

