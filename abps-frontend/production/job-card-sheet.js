// BOQ ID / Job Card Number are custom click-to-open dropdowns (not native
// <select>) — same pattern as Add to Finished Goods Store's
// fg-add-boq-display/fg-add-jobcard-display — because a native select's
// closed-box text can't wrap, and these values (BOQ ID especially) run
// long enough to get clipped. jclh-boq/jclh-jobcard stay as hidden inputs
// holding the actual value; everything else here just reads/writes those.
function jclhBOQDisplayReset(text) {
  const disp = document.getElementById("jclh-boq-display");
  const textEl = document.getElementById("jclh-boq-display-text");
  const hidden = document.getElementById("jclh-boq");
  const list = document.getElementById("jclh-boq-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function jclhBOQDisplayEnable() {
  const disp = document.getElementById("jclh-boq-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function jclhBOQPopulate(options) {
  const list = document.getElementById("jclh-boq-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectJCLHBOQ('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleJCLHBOQDropdown() {
  const disp = document.getElementById("jclh-boq-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("jclh-boq-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectJCLHBOQ(boqId, label) {
  document.getElementById("jclh-boq").value = boqId;
  document.getElementById("jclh-boq-display-text").textContent = label;
  document.getElementById("jclh-boq-dropdown-list").style.display = "none";
  handleJCLHBoqChange(boqId);
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#jclh-boq-display") && !e.target.closest("#jclh-boq-dropdown-list")) {
    const l = document.getElementById("jclh-boq-dropdown-list"); if (l) l.style.display = "none";
  }
});

function jclhJobCardDisplayReset(text) {
  const disp = document.getElementById("jclh-jobcard-display");
  const textEl = document.getElementById("jclh-jobcard-display-text");
  const hidden = document.getElementById("jclh-jobcard");
  const list = document.getElementById("jclh-jobcard-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function jclhJobCardDisplayEnable() {
  const disp = document.getElementById("jclh-jobcard-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function jclhJobCardPopulate(options) {
  const list = document.getElementById("jclh-jobcard-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectJCLHJobCard('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleJCLHJobCardDropdown() {
  const disp = document.getElementById("jclh-jobcard-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("jclh-jobcard-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectJCLHJobCard(jobCardNumber, label) {
  document.getElementById("jclh-jobcard").value = jobCardNumber;
  document.getElementById("jclh-jobcard-display-text").textContent = label;
  document.getElementById("jclh-jobcard-dropdown-list").style.display = "none";
  updateJCLHDownloadButtonState();
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#jclh-jobcard-display") && !e.target.closest("#jclh-jobcard-dropdown-list")) {
    const l = document.getElementById("jclh-jobcard-dropdown-list"); if (l) l.style.display = "none";
  }
});

// Sets a readonly auto-grow textarea's value and re-measures its height —
// a plain .value = assignment never fires 'input', so the box would stay
// collapsed at rows="1" even once long text is poured in.
function jclhSetAutoGrowValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value || "";
  autoGrowTextField(el);
}

function resetJCLHWorkspace() {
  // Full clean-slate wipe: dropdown state, cached lookups, and read-only autofill fields.
  jclhAllJobCardsForProject = [];
  window.jclhProjectMeta = {};

  const feedback = document.getElementById("jclh-feedback");
  if (feedback) feedback.style.display = "none";

  const projInput = document.getElementById("jclh-project-ta-input");
  const typeDrop = document.getElementById("jclh-product-type");
  const sheetDrop = document.getElementById("jclh-sheet-type");
  if (projInput) projInput.value = "";
  jclhBOQDisplayReset("— Select Project First —");
  jclhJobCardDisplayReset("— Select BOQ ID First —");
  if (typeDrop) { typeDrop.value = ""; typeDrop.disabled = true; }
  if (sheetDrop) { sheetDrop.value = ""; sheetDrop.disabled = true; }

  const customer = document.getElementById("jclh-customer");
  const dept     = document.getElementById("jclh-department");
  const pdesc    = document.getElementById("jclh-description-of-material");
  const pmake    = document.getElementById("jclh-make");
  if (customer) customer.value = "";
  if (dept)     dept.value     = "";
  jclhSetAutoGrowValue("jclh-product-name", "");
  jclhSetAutoGrowValue("jclh-product-rating", "");
  if (pdesc)    pdesc.value    = "";
  if (pmake)    pmake.value    = "";

  updateJCLHDownloadButtonState();
}

async function handleJCLHProjectChange(projectId) {
  const meta = window.jclhProjectMeta && window.jclhProjectMeta[projectId];
  document.getElementById("jclh-customer").value = meta ? (meta.companyName || "") : "";

  resetJCLHDownstreamFields();

  if (!projectId) {
    jclhBOQDisplayReset("— Select Project First —");
    jclhJobCardDisplayReset("— Select BOQ ID First —");
    return;
  }

  jclhBOQDisplayReset("Loading...");
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

    jclhBOQDisplayReset("— Select BOQ ID —");
    jclhBOQPopulate(boqOptions.map(jc => ({ value: jc.boqId, label: `${jc.boqId} | ${jc.productName}${jc.productRating ? " " + jc.productRating : ""}` })));
    jclhBOQDisplayEnable();
  } catch(e) {
    jclhBOQDisplayReset("Error loading BOQs");
  }
}

function handleJCLHBoqChange(boqId) {
  document.getElementById("jclh-department").value     = "";
  jclhSetAutoGrowValue("jclh-product-name", "");
  jclhSetAutoGrowValue("jclh-product-rating", "");
  document.getElementById("jclh-description-of-material").value = "";
  document.getElementById("jclh-make").value = "";
  updateJCLHDownloadButtonState();

  if (!boqId) {
    jclhJobCardDisplayReset("— Select BOQ ID First —");
    return;
  }

  const matches = jclhAllJobCardsForProject.filter(jc => jc.boqId === boqId);
  if (matches.length > 0) {
    document.getElementById("jclh-department").value     = matches[0].department || "";
    jclhSetAutoGrowValue("jclh-product-name", matches[0].productName || "");
    jclhSetAutoGrowValue("jclh-product-rating", matches[0].productRating || "");
    // Description of Material + Make (both BOQ/Item-Code-level, per the
    // product this Job Card is for) — composed into a single "Product:"
    // line on the printed sheet, see submitJCLHDownload.
    document.getElementById("jclh-description-of-material").value = matches[0].descriptionOfMaterial || "";
    document.getElementById("jclh-make").value = matches[0].make || "";
  }

  jclhJobCardDisplayReset("— Select Job Card Number —");
  jclhJobCardPopulate(matches.map(jc => ({ value: jc.jobCardNumber, label: `${jc.jobCardNumber} (Set ${jc.setNumber})` })));
  jclhJobCardDisplayEnable();
}

function resetJCLHDownstreamFields() {
  document.getElementById("jclh-department").value     = "";
  jclhSetAutoGrowValue("jclh-product-name", "");
  jclhSetAutoGrowValue("jclh-product-rating", "");
  document.getElementById("jclh-description-of-material").value = "";
  document.getElementById("jclh-make").value = "";
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
  const descriptionOfMaterial = document.getElementById("jclh-description-of-material").value.trim();
  const make           = document.getElementById("jclh-make").value.trim();
  const jobCardNumber = document.getElementById("jclh-jobcard").value.trim();
  const productType   = document.getElementById("jclh-product-type").value.trim();
  const sheetType      = document.getElementById("jclh-sheet-type").value.trim();

  showBlockingOverlay(`Downloading ${sheetType} Sheet...`);

  try {
    const data = await apFetch({
      action: "generateJobCardOrInProcessSheetPdf",
      projectId, customerName, productName, productRating, descriptionOfMaterial, make, jobCardNumber, productType, sheetType
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
