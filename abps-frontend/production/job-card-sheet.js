function resetJCLHWorkspace() {
  // Full clean-slate wipe: dropdown state, cached lookups, and read-only autofill fields.
  jclhAllJobCardsForProject = [];
  window.jclhProjectMeta = {};

  const feedback = document.getElementById("jclh-feedback");
  if (feedback) feedback.style.display = "none";

  const projDrop = document.getElementById("jclh-project");
  const boqDrop  = document.getElementById("jclh-boq");
  const jcDrop   = document.getElementById("jclh-jobcard");
  if (projDrop) projDrop.innerHTML = '<option value="">— Select Project ID —</option>';
  if (boqDrop)  { boqDrop.innerHTML = '<option value="">— Select Project First —</option>'; boqDrop.disabled = true; }
  if (jcDrop)   { jcDrop.innerHTML  = '<option value="">— Select BOQ ID First —</option>'; jcDrop.disabled = true; }

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
  if (!btn) return;
  if (jc) {
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
  showBlockingOverlay("Downloading Job Card Letterhead...");

  const projectId     = document.getElementById("jclh-project").value.trim();
  const customerName  = document.getElementById("jclh-customer").value.trim();
  const boqId          = document.getElementById("jclh-boq").value.trim();
  const productName   = document.getElementById("jclh-product-name").value.trim();
  const productRating = document.getElementById("jclh-product-rating").value.trim();
  const department     = document.getElementById("jclh-department").value.trim();
  const jobCardNumber = document.getElementById("jclh-jobcard").value.trim();

  try {
    const data = await apFetch({
      action: "generateJobCardLetterheadPdf",
      projectId, customerName, boqId, productName, productRating, department, jobCardNumber
    });
    if (data.success) {
      const link = document.createElement("a");
      link.href = "data:application/pdf;base64," + data.base64;
      link.download = data.fileName || "JobCard_Letterhead.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showBOQBanner("jclh-feedback", "Letterhead PDF downloaded.", "success");
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
