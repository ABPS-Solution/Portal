// In Process Sheet screen (Quality Assurance dept, Finished Goods sub-
// heading) — split off from the old combined Job Card & In Process Sheet
// screen (11 Sep 2026). Sheet Type is gone, this screen always downloads
// an In Process sheet. The sibling Job Card Sheet screen (Production dept)
// lives in production/job-card-sheet.js with its own jcsh-* prefix — this
// file is a near-identical twin, ipsh-* prefixed, calling
// generateInProcessSheetPdf instead of generateJobCardSheetPdf.
function ipshBOQDisplayReset(text) {
  const disp = document.getElementById("ipsh-boq-display");
  const textEl = document.getElementById("ipsh-boq-display-text");
  const hidden = document.getElementById("ipsh-boq");
  const list = document.getElementById("ipsh-boq-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function ipshBOQDisplayEnable() {
  const disp = document.getElementById("ipsh-boq-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function ipshBOQPopulate(options) {
  const list = document.getElementById("ipsh-boq-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectIPSHBOQ('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleIPSHBOQDropdown() {
  const disp = document.getElementById("ipsh-boq-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("ipsh-boq-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectIPSHBOQ(boqId, label) {
  document.getElementById("ipsh-boq").value = boqId;
  document.getElementById("ipsh-boq-display-text").textContent = label;
  document.getElementById("ipsh-boq-dropdown-list").style.display = "none";
  handleIPSHBoqChange(boqId);
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#ipsh-boq-display") && !e.target.closest("#ipsh-boq-dropdown-list")) {
    const l = document.getElementById("ipsh-boq-dropdown-list"); if (l) l.style.display = "none";
  }
});

function ipshJobCardDisplayReset(text) {
  const disp = document.getElementById("ipsh-jobcard-display");
  const textEl = document.getElementById("ipsh-jobcard-display-text");
  const hidden = document.getElementById("ipsh-jobcard");
  const list = document.getElementById("ipsh-jobcard-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function ipshJobCardDisplayEnable() {
  const disp = document.getElementById("ipsh-jobcard-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function ipshJobCardPopulate(options) {
  const list = document.getElementById("ipsh-jobcard-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectIPSHJobCard('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleIPSHJobCardDropdown() {
  const disp = document.getElementById("ipsh-jobcard-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("ipsh-jobcard-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectIPSHJobCard(jobCardNumber, label) {
  document.getElementById("ipsh-jobcard").value = jobCardNumber;
  document.getElementById("ipsh-jobcard-display-text").textContent = label;
  document.getElementById("ipsh-jobcard-dropdown-list").style.display = "none";
  updateIPSHDownloadButtonState();
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#ipsh-jobcard-display") && !e.target.closest("#ipsh-jobcard-dropdown-list")) {
    const l = document.getElementById("ipsh-jobcard-dropdown-list"); if (l) l.style.display = "none";
  }
});

// Sets a readonly auto-grow textarea's value and re-measures its height —
// a plain .value = assignment never fires 'input', so the box would stay
// collapsed at rows="1" even once long text is poured in.
function ipshSetAutoGrowValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value || "";
  autoGrowTextField(el);
}

// Local YYYY-MM-DD (not toISOString, which shifts by UTC offset) — same
// gotcha lib/businessDays.js's own header comment documents server-side.
function ipshTodayLocalISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

let ipshAllJobCardsForProject = [];
let ipshSubmitInProgress = false;
let ipshWorkspaceInitInProgress = false;

function resetIPSHWorkspace() {
  // Full clean-slate wipe: dropdown state, cached lookups, and read-only autofill fields.
  ipshAllJobCardsForProject = [];
  window.ipshProjectMeta = {};

  const feedback = document.getElementById("ipsh-feedback");
  if (feedback) feedback.style.display = "none";

  const projInput = document.getElementById("ipsh-project-ta-input");
  const typeDrop = document.getElementById("ipsh-product-type");
  if (projInput) projInput.value = "";
  ipshBOQDisplayReset("— Select Project First —");
  ipshJobCardDisplayReset("— Select BOQ ID First —");
  if (typeDrop) { typeDrop.value = ""; typeDrop.disabled = true; }

  const dateInput = document.getElementById("ipsh-sheet-date");
  if (dateInput) dateInput.value = ipshTodayLocalISO();

  const customer = document.getElementById("ipsh-customer");
  const dept     = document.getElementById("ipsh-department");
  const pdesc    = document.getElementById("ipsh-description-of-material");
  const pmake    = document.getElementById("ipsh-make");
  if (customer) customer.value = "";
  if (dept)     dept.value     = "";
  ipshSetAutoGrowValue("ipsh-product-name", "");
  ipshSetAutoGrowValue("ipsh-product-rating", "");
  if (pdesc)    pdesc.value    = "";
  if (pmake)    pmake.value    = "";

  updateIPSHDownloadButtonState();
}

async function initializeIPSHWorkspace() {
  ipshWorkspaceInitInProgress = false; // clear any stuck guard from an abandoned prior load
  resetIPSHWorkspace();                // guarantee first-time-like state on every entry
  ipshWorkspaceInitInProgress = true;
  try {
    const data = await fetchWithStaleCache({ action: "pullLiveActiveProjectCodes" });
    window.ipshProjectMeta = data.projectMeta || {};
    // Same shared typeahead component Create BOQ uses (handleSharedProjectTypeaheadInput /
    // selectSharedProjectTypeahead) — it filters window.sharedActiveProjectCodes /
    // window.sharedProjectMeta, so this screen must keep those populated too.
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
    handleIPSHProjectChange("");
  } catch(e) {
    // Typeahead input just stays empty/unresponsive on failure — no dropdown to fall back to.
  } finally {
    ipshWorkspaceInitInProgress = false;
  }
}

async function handleIPSHProjectChange(projectId) {
  const meta = window.ipshProjectMeta && window.ipshProjectMeta[projectId];
  document.getElementById("ipsh-customer").value = meta ? (meta.companyName || "") : "";

  resetIPSHDownstreamFields();

  if (!projectId) {
    ipshBOQDisplayReset("— Select Project First —");
    ipshJobCardDisplayReset("— Select BOQ ID First —");
    return;
  }

  ipshBOQDisplayReset("Loading...");
  try {
    const data = await apFetch({ action: "fetchJobCardsForProject", projectId });
    ipshAllJobCardsForProject = data.jobCards || [];

    // Distinct BOQ IDs that already have job cards, per requirement
    const seenBoq = {};
    const boqOptions = [];
    ipshAllJobCardsForProject.forEach(jc => {
      if (jc.boqId && !seenBoq[jc.boqId]) {
        seenBoq[jc.boqId] = true;
        boqOptions.push(jc);
      }
    });

    ipshBOQDisplayReset("— Select BOQ ID —");
    ipshBOQPopulate(boqOptions.map(jc => ({ value: jc.boqId, label: `${jc.boqId} | ${jc.productName}${jc.productRating ? " " + jc.productRating : ""}` })));
    ipshBOQDisplayEnable();
  } catch(e) {
    ipshBOQDisplayReset("Error loading BOQs");
  }
}

function handleIPSHBoqChange(boqId) {
  document.getElementById("ipsh-department").value     = "";
  ipshSetAutoGrowValue("ipsh-product-name", "");
  ipshSetAutoGrowValue("ipsh-product-rating", "");
  document.getElementById("ipsh-description-of-material").value = "";
  document.getElementById("ipsh-make").value = "";
  updateIPSHDownloadButtonState();

  if (!boqId) {
    ipshJobCardDisplayReset("— Select BOQ ID First —");
    return;
  }

  const matches = ipshAllJobCardsForProject.filter(jc => jc.boqId === boqId);
  if (matches.length > 0) {
    document.getElementById("ipsh-department").value     = matches[0].department || "";
    ipshSetAutoGrowValue("ipsh-product-name", matches[0].productName || "");
    ipshSetAutoGrowValue("ipsh-product-rating", matches[0].productRating || "");
    // Description of Material + Make (both BOQ/Item-Code-level, per the
    // product this Job Card is for) — composed into a single "Product:"
    // line on the printed sheet, see submitIPSHDownload.
    document.getElementById("ipsh-description-of-material").value = matches[0].descriptionOfMaterial || "";
    document.getElementById("ipsh-make").value = matches[0].make || "";
  }

  ipshJobCardDisplayReset("— Select Job Card Number —");
  ipshJobCardPopulate(matches.map(jc => ({ value: jc.jobCardNumber, label: `${jc.jobCardNumber} (Set ${jc.setNumber})` })));
  ipshJobCardDisplayEnable();
}

function resetIPSHDownstreamFields() {
  document.getElementById("ipsh-department").value     = "";
  ipshSetAutoGrowValue("ipsh-product-name", "");
  ipshSetAutoGrowValue("ipsh-product-rating", "");
  document.getElementById("ipsh-description-of-material").value = "";
  document.getElementById("ipsh-make").value = "";
  updateIPSHDownloadButtonState();
}

function updateIPSHDownloadButtonState() {
  const btn = document.getElementById("ipsh-download-btn");
  const jc  = document.getElementById("ipsh-jobcard").value.trim();
  const typeDrop = document.getElementById("ipsh-product-type");
  const dateInput = document.getElementById("ipsh-sheet-date");
  if (!btn) return;

  // Product Type unlocks once a Job Card Number is picked (Sheet Type no
  // longer exists on this screen — it's always In Process now).
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

async function submitIPSHDownload() {
  if (ipshSubmitInProgress) return;
  ipshSubmitInProgress = true;
  const btn = document.getElementById("ipsh-download-btn");
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = "Generating...";

  const projectId     = document.getElementById("ipsh-project-ta-input").value.trim();
  const customerName  = document.getElementById("ipsh-customer").value.trim();
  const productName   = document.getElementById("ipsh-product-name").value.trim();
  const productRating = document.getElementById("ipsh-product-rating").value.trim();
  const descriptionOfMaterial = document.getElementById("ipsh-description-of-material").value.trim();
  const make           = document.getElementById("ipsh-make").value.trim();
  const jobCardNumber = document.getElementById("ipsh-jobcard").value.trim();
  const productType   = document.getElementById("ipsh-product-type").value.trim();
  const sheetDate      = document.getElementById("ipsh-sheet-date").value.trim();

  showBlockingOverlay("Downloading In Process Sheet...");

  try {
    const data = await apFetch({
      action: "generateInProcessSheetPdf",
      projectId, customerName, productName, productRating, descriptionOfMaterial, make, jobCardNumber, productType, sheetDate
    });
    if (data.success) {
      const link = document.createElement("a");
      link.href = "data:application/pdf;base64," + data.base64;
      link.download = data.fileName || "In_Process_Sheet.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showBOQBanner("ipsh-feedback", "In Process Sheet PDF downloaded.", "success");
    } else {
      showBOQBanner("ipsh-feedback", data.error || "Failed to generate PDF.", "error");
    }
  } catch(e) {
    showBOQBanner("ipsh-feedback", "Network error: " + e.message, "error");
  } finally {
    ipshSubmitInProgress = false;
    btn.disabled = false; btn.textContent = originalText;
    updateIPSHDownloadButtonState();
    hideBlockingOverlay();
  }
}
