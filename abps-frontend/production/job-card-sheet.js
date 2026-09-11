// BOQ ID / Job Card Number are custom click-to-open dropdowns (not native
// <select>) — same pattern as Add to Finished Goods Store's
// fg-add-boq-display/fg-add-jobcard-display — because a native select's
// closed-box text can't wrap, and these values (BOQ ID especially) run
// long enough to get clipped. jcsh-boq/jcsh-jobcard stay as hidden inputs
// holding the actual value; everything else here just reads/writes those.
//
// This is the Job Card Sheet screen (Production dept), split off from the
// old combined Job Card & In Process Sheet screen (11 Sep 2026) — Sheet
// Type is gone, this screen always downloads a Job Card sheet. The sibling
// In Process Sheet screen (QA dept) lives in qa/in-process-sheet.js with
// its own ipsh-* prefix.
function jcshBOQDisplayReset(text) {
  const disp = document.getElementById("jcsh-boq-display");
  const textEl = document.getElementById("jcsh-boq-display-text");
  const hidden = document.getElementById("jcsh-boq");
  const list = document.getElementById("jcsh-boq-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function jcshBOQDisplayEnable() {
  const disp = document.getElementById("jcsh-boq-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function jcshBOQPopulate(options) {
  const list = document.getElementById("jcsh-boq-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectJCSHBOQ('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleJCSHBOQDropdown() {
  const disp = document.getElementById("jcsh-boq-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("jcsh-boq-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectJCSHBOQ(boqId, label) {
  document.getElementById("jcsh-boq").value = boqId;
  document.getElementById("jcsh-boq-display-text").textContent = label;
  document.getElementById("jcsh-boq-dropdown-list").style.display = "none";
  handleJCSHBoqChange(boqId);
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#jcsh-boq-display") && !e.target.closest("#jcsh-boq-dropdown-list")) {
    const l = document.getElementById("jcsh-boq-dropdown-list"); if (l) l.style.display = "none";
  }
});

function jcshJobCardDisplayReset(text) {
  const disp = document.getElementById("jcsh-jobcard-display");
  const textEl = document.getElementById("jcsh-jobcard-display-text");
  const hidden = document.getElementById("jcsh-jobcard");
  const list = document.getElementById("jcsh-jobcard-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function jcshJobCardDisplayEnable() {
  const disp = document.getElementById("jcsh-jobcard-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function jcshJobCardPopulate(options) {
  const list = document.getElementById("jcsh-jobcard-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectJCSHJobCard('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleJCSHJobCardDropdown() {
  const disp = document.getElementById("jcsh-jobcard-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("jcsh-jobcard-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectJCSHJobCard(jobCardNumber, label) {
  document.getElementById("jcsh-jobcard").value = jobCardNumber;
  document.getElementById("jcsh-jobcard-display-text").textContent = label;
  document.getElementById("jcsh-jobcard-dropdown-list").style.display = "none";
  updateJCSHDownloadButtonState();
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#jcsh-jobcard-display") && !e.target.closest("#jcsh-jobcard-dropdown-list")) {
    const l = document.getElementById("jcsh-jobcard-dropdown-list"); if (l) l.style.display = "none";
  }
});

// Sets a readonly auto-grow textarea's value and re-measures its height —
// a plain .value = assignment never fires 'input', so the box would stay
// collapsed at rows="1" even once long text is poured in.
function jcshSetAutoGrowValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value || "";
  autoGrowTextField(el);
}

// Local YYYY-MM-DD (not toISOString, which shifts by UTC offset) — same
// gotcha lib/businessDays.js's own header comment documents server-side.
function jcshTodayLocalISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function resetJCSHWorkspace() {
  // Full clean-slate wipe: dropdown state, cached lookups, and read-only autofill fields.
  jcshAllJobCardsForProject = [];
  window.jcshProjectMeta = {};

  const feedback = document.getElementById("jcsh-feedback");
  if (feedback) feedback.style.display = "none";

  const projInput = document.getElementById("jcsh-project-ta-input");
  const typeDrop = document.getElementById("jcsh-product-type");
  if (projInput) projInput.value = "";
  jcshBOQDisplayReset("— Select Project First —");
  jcshJobCardDisplayReset("— Select BOQ ID First —");
  if (typeDrop) { typeDrop.value = ""; typeDrop.disabled = true; }

  const dateInput = document.getElementById("jcsh-sheet-date");
  if (dateInput) dateInput.value = jcshTodayLocalISO();

  const customer = document.getElementById("jcsh-customer");
  const dept     = document.getElementById("jcsh-department");
  const pdesc    = document.getElementById("jcsh-description-of-material");
  const pmake    = document.getElementById("jcsh-make");
  if (customer) customer.value = "";
  if (dept)     dept.value     = "";
  jcshSetAutoGrowValue("jcsh-product-name", "");
  jcshSetAutoGrowValue("jcsh-product-rating", "");
  if (pdesc)    pdesc.value    = "";
  if (pmake)    pmake.value    = "";

  updateJCSHDownloadButtonState();
}

async function handleJCSHProjectChange(projectId) {
  const meta = window.jcshProjectMeta && window.jcshProjectMeta[projectId];
  document.getElementById("jcsh-customer").value = meta ? (meta.companyName || "") : "";

  resetJCSHDownstreamFields();

  if (!projectId) {
    jcshBOQDisplayReset("— Select Project First —");
    jcshJobCardDisplayReset("— Select BOQ ID First —");
    return;
  }

  jcshBOQDisplayReset("Loading...");
  try {
    const data = await apFetch({ action: "fetchJobCardsForProject", projectId });
    jcshAllJobCardsForProject = data.jobCards || [];

    // Distinct BOQ IDs that already have job cards, per requirement
    const seenBoq = {};
    const boqOptions = [];
    jcshAllJobCardsForProject.forEach(jc => {
      if (jc.boqId && !seenBoq[jc.boqId]) {
        seenBoq[jc.boqId] = true;
        boqOptions.push(jc);
      }
    });

    jcshBOQDisplayReset("— Select BOQ ID —");
    jcshBOQPopulate(boqOptions.map(jc => ({ value: jc.boqId, label: `${jc.boqId} | ${jc.productName}${jc.productRating ? " " + jc.productRating : ""}` })));
    jcshBOQDisplayEnable();
  } catch(e) {
    jcshBOQDisplayReset("Error loading BOQs");
  }
}

function handleJCSHBoqChange(boqId) {
  document.getElementById("jcsh-department").value     = "";
  jcshSetAutoGrowValue("jcsh-product-name", "");
  jcshSetAutoGrowValue("jcsh-product-rating", "");
  document.getElementById("jcsh-description-of-material").value = "";
  document.getElementById("jcsh-make").value = "";
  updateJCSHDownloadButtonState();

  if (!boqId) {
    jcshJobCardDisplayReset("— Select BOQ ID First —");
    return;
  }

  const matches = jcshAllJobCardsForProject.filter(jc => jc.boqId === boqId);
  if (matches.length > 0) {
    document.getElementById("jcsh-department").value     = matches[0].department || "";
    jcshSetAutoGrowValue("jcsh-product-name", matches[0].productName || "");
    jcshSetAutoGrowValue("jcsh-product-rating", matches[0].productRating || "");
    // Description of Material + Make (both BOQ/Item-Code-level, per the
    // product this Job Card is for) — composed into a single "Product:"
    // line on the printed sheet, see submitJCSHDownload.
    document.getElementById("jcsh-description-of-material").value = matches[0].descriptionOfMaterial || "";
    document.getElementById("jcsh-make").value = matches[0].make || "";
  }

  jcshJobCardDisplayReset("— Select Job Card Number —");
  jcshJobCardPopulate(matches.map(jc => ({ value: jc.jobCardNumber, label: `${jc.jobCardNumber} (Set ${jc.setNumber})` })));
  jcshJobCardDisplayEnable();
}

function resetJCSHDownstreamFields() {
  document.getElementById("jcsh-department").value     = "";
  jcshSetAutoGrowValue("jcsh-product-name", "");
  jcshSetAutoGrowValue("jcsh-product-rating", "");
  document.getElementById("jcsh-description-of-material").value = "";
  document.getElementById("jcsh-make").value = "";
  updateJCSHDownloadButtonState();
}

function updateJCSHDownloadButtonState() {
  const btn = document.getElementById("jcsh-download-btn");
  const jc  = document.getElementById("jcsh-jobcard").value.trim();
  const typeDrop = document.getElementById("jcsh-product-type");
  const dateInput = document.getElementById("jcsh-sheet-date");
  if (!btn) return;

  // Product Type unlocks once a Job Card Number is picked (Sheet Type no
  // longer exists on this screen — it's always Job Card now).
  if (typeDrop) {
    typeDrop.disabled = !jc;
    if (!jc) typeDrop.value = "";
  }

  const productType = typeDrop ? typeDrop.value.trim() : "";
  const sheetDate = dateInput ? dateInput.value.trim() : "";
  if (jc && productType && sheetDate) {
    btn.disabled = false; btn.style.opacity = "1"; btn.style.cursor = "pointer";
  } else {
    btn.disabled = true; btn.style.opacity = "0.5"; btn.style.cursor = "not-allowed";
  }
}

async function submitJCSHDownload() {
  if (jcshSubmitInProgress) return;
  jcshSubmitInProgress = true;
  const btn = document.getElementById("jcsh-download-btn");
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = "Generating...";

  const projectId     = document.getElementById("jcsh-project-ta-input").value.trim();
  const customerName  = document.getElementById("jcsh-customer").value.trim();
  const productName   = document.getElementById("jcsh-product-name").value.trim();
  const productRating = document.getElementById("jcsh-product-rating").value.trim();
  const descriptionOfMaterial = document.getElementById("jcsh-description-of-material").value.trim();
  const make           = document.getElementById("jcsh-make").value.trim();
  const jobCardNumber = document.getElementById("jcsh-jobcard").value.trim();
  const productType   = document.getElementById("jcsh-product-type").value.trim();
  const sheetDate      = document.getElementById("jcsh-sheet-date").value.trim();

  showBlockingOverlay("Downloading Job Card Sheet...");

  try {
    const data = await apFetch({
      action: "generateJobCardSheetPdf",
      projectId, customerName, productName, productRating, descriptionOfMaterial, make, jobCardNumber, productType, sheetDate
    });
    if (data.success) {
      const link = document.createElement("a");
      link.href = "data:application/pdf;base64," + data.base64;
      link.download = data.fileName || "Job_Card_Sheet.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showBOQBanner("jcsh-feedback", "Job Card Sheet PDF downloaded.", "success");
    } else {
      showBOQBanner("jcsh-feedback", data.error || "Failed to generate PDF.", "error");
    }
  } catch(e) {
    showBOQBanner("jcsh-feedback", "Network error: " + e.message, "error");
  } finally {
    jcshSubmitInProgress = false;
    btn.disabled = false; btn.textContent = originalText;
    updateJCSHDownloadButtonState();
    hideBlockingOverlay();
  }
}

// ═══════════════════════════════════════════════════════
// ADD TO FINISHED GOODS STORE
// ═══════════════════════════════════════════════════════

let fgAddWorkspaceInitInProgress = false;
let boqFormIsDirty    = false;
let boqUpdateIsDirty  = false;

