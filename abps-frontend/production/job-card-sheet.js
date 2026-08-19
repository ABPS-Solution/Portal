function resetJCLHWorkspace() {
  // Full clean-slate wipe: dropdown state, cached lookups, and read-only autofill fields.
  jclhAllJobCardsForProject = [];
  window.jclhProjectMeta = {};

  const feedback = document.getElementById("jclh-feedback");
  if (feedback) feedback.style.display = "none";

  const projInput = document.getElementById("jclh-project-ta-input");
  const boqDrop  = document.getElementById("jclh-boq");
  const jcDrop   = document.getElementById("jclh-jobcard");
  const typeDrop = document.getElementById("jclh-product-type");
  const sheetDrop = document.getElementById("jclh-sheet-type");
  if (projInput) projInput.value = "";
  if (boqDrop)  { boqDrop.innerHTML = '<option value="">— Select Project First —</option>'; boqDrop.disabled = true; }
  if (jcDrop)   { jcDrop.innerHTML  = '<option value="">— Select BOQ ID First —</option>'; jcDrop.disabled = true; }
  if (typeDrop) { typeDrop.value = ""; typeDrop.disabled = true; }
  if (sheetDrop) { sheetDrop.value = ""; sheetDrop.disabled = true; }

  const customer = document.getElementById("jclh-customer");
  const dept     = document.getElementById("jclh-department");
  const pname    = document.getElementById("jclh-product-name");
  const prating  = document.getElementById("jclh-product-rating");
  if (customer) customer.value = "";
  if (dept)     dept.value     = "";
  if (pname)    pname.value    = "";
  if (prating)  prating.value  = "";

  updateJCLHDownloadButtonState();
}

async function handleJCLHProjectChange(projectId) {
  const meta = window.jclhProjectMeta && window.jclhProjectMeta[projectId];
  document.getElementById("jclh-customer").value = meta ? (meta.companyName || "") : "";

  const boqDrop = document.getElementById("jclh-boq");
  const jcDrop  = document.getElementById("jclh-jobcard");
  resetJCLHDownstreamFields();

  if (!projectId) {
    boqDrop.innerHTML = '<option value="">— Select Project First —</option>';
    boqDrop.disabled = true;
    jcDrop.innerHTML  = '<option value="">— Select BOQ ID First —</option>';
    jcDrop.disabled   = true;
    return;
  }

  boqDrop.innerHTML = '<option value="">Loading...</option>';
  boqDrop.disabled = true;
  try {
    const data = await apFetch({ action: "fetchJobCardsForProject", projectId });
    jclhAllJobCardsForProject = data.jobCards || [];

    // Distinct BOQ IDs that already have job cards, per requirement
    const seenBoq = {};
    const boqOptions = [];
    jclhAllJobCardsForProject.forEach(jc => {
      if (jc.boqId && !seenBoq[jc.boqId]) {
        seenBoq[jc.boqId] = true;
        boqOptions.push(jc);
      }
    });

    boqDrop.innerHTML = '<option value="">— Select BOQ ID —</option>';
    boqOptions.forEach(jc => {
      const opt = document.createElement("option");
      opt.value = jc.boqId;
      opt.textContent = `${jc.boqId} | ${jc.productName}${jc.productRating ? " " + jc.productRating : ""}`;
      boqDrop.appendChild(opt);
    });
    boqDrop.disabled = false;
  } catch(e) {
    boqDrop.innerHTML = '<option value="">Error loading BOQs</option>';
  }
}

function handleJCLHBoqChange(boqId) {
  const jcDrop = document.getElementById("jclh-jobcard");
  document.getElementById("jclh-department").value     = "";
  document.getElementById("jclh-product-name").value   = "";
  document.getElementById("jclh-product-rating").value = "";
  updateJCLHDownloadButtonState();

  if (!boqId) {
    jcDrop.innerHTML = '<option value="">— Select BOQ ID First —</option>';
    jcDrop.disabled = true;
    return;
  }

  const matches = jclhAllJobCardsForProject.filter(jc => jc.boqId === boqId);
  if (matches.length > 0) {
    document.getElementById("jclh-department").value     = matches[0].department || "";
    document.getElementById("jclh-product-name").value   = matches[0].productName || "";
    document.getElementById("jclh-product-rating").value = matches[0].productRating || "";
  }

  jcDrop.innerHTML = '<option value="">— Select Job Card Number —</option>';
  matches.forEach(jc => {
    const opt = document.createElement("option");
    opt.value = jc.jobCardNumber;
    opt.textContent = `${jc.jobCardNumber} (Set ${jc.setNumber})`;
    jcDrop.appendChild(opt);
  });
  jcDrop.disabled = false;
  jcDrop.onchange = updateJCLHDownloadButtonState;
}

function resetJCLHDownstreamFields() {
  document.getElementById("jclh-department").value     = "";
  document.getElementById("jclh-product-name").value   = "";
  document.getElementById("jclh-product-rating").value = "";
  updateJCLHDownloadButtonState();
}

function updateJCLHDownloadButtonState() {
  const btn = document.getElementById("jclh-download-btn");
  const jc  = document.getElementById("jclh-jobcard").value.trim();
  const typeDrop = document.getElementById("jclh-product-type");
  const sheetDrop = document.getElementById("jclh-sheet-type");
  if (!btn) return;

  // Sheet Type unlocks once a Job Card Number is picked. Product Type is
  // sequenced one step further — it stays disabled until Sheet Type has a
  // value, per explicit request (Sheet Type is chosen first, then Product
  // Type). Clearing/changing Sheet Type re-locks and clears Product Type.
  if (sheetDrop) {
    sheetDrop.disabled = !jc;
    if (!jc) sheetDrop.value = "";
  }
  const sheetType = sheetDrop ? sheetDrop.value.trim() : "";
  if (typeDrop) {
    typeDrop.disabled = !sheetType;
    if (!sheetType) typeDrop.value = "";
  }

  const productType = typeDrop ? typeDrop.value.trim() : "";
  if (jc && sheetType && productType) {
    btn.disabled = false; btn.style.opacity = "1"; btn.style.cursor = "pointer";
  } else {
    btn.disabled = true; btn.style.opacity = "0.5"; btn.style.cursor = "not-allowed";
  }
}

async function submitJCLHDownload() {
  if (jclhSubmitInProgress) return;
  jclhSubmitInProgress = true;
  const btn = document.getElementById("jclh-download-btn");
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = "Generating...";

  const projectId     = document.getElementById("jclh-project-ta-input").value.trim();
  const customerName  = document.getElementById("jclh-customer").value.trim();
  const productName   = document.getElementById("jclh-product-name").value.trim();
  const productRating = document.getElementById("jclh-product-rating").value.trim();
  const jobCardNumber = document.getElementById("jclh-jobcard").value.trim();
  const productType   = document.getElementById("jclh-product-type").value.trim();
  const sheetType      = document.getElementById("jclh-sheet-type").value.trim();

  showBlockingOverlay(`Downloading ${sheetType} Sheet...`);

  try {
    const data = await apFetch({
      action: "generateJobCardOrInProcessSheetPdf",
      projectId, customerName, productName, productRating, jobCardNumber, productType, sheetType
    });
    if (data.success) {
      const link = document.createElement("a");
      link.href = "data:application/pdf;base64," + data.base64;
      link.download = data.fileName || `${sheetType}_Sheet.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showBOQBanner("jclh-feedback", `${sheetType} Sheet PDF downloaded.`, "success");
    } else {
      showBOQBanner("jclh-feedback", data.error || "Failed to generate PDF.", "error");
    }
  } catch(e) {
    showBOQBanner("jclh-feedback", "Network error: " + e.message, "error");
  } finally {
    jclhSubmitInProgress = false;
    btn.disabled = false; btn.textContent = originalText;
    updateJCLHDownloadButtonState();
    hideBlockingOverlay();
  }
}

// ═══════════════════════════════════════════════════════
// ADD TO FINISHED GOODS STORE
// ═══════════════════════════════════════════════════════

let fgAddWorkspaceInitInProgress = false;
let boqFormIsDirty    = false;
let boqUpdateIsDirty  = false;
