// Each document type now accepts multiple files (was one File per type) —
// fgDocFiles[type] is an array, appended to on every selection rather than
// replaced, with a running list rendered under each dropzone.
const FG_DOC_META = {
  jobCardSheet:         { dropzoneId: "fg-add-jobcard-sheet-dropzone", listId: "fg-add-jobcard-sheet-filelist", label: "Job Card Sheet",              placeholder: "📎 Click to attach Job Card Sheet" },
  packedProductsImages: { dropzoneId: "fg-add-packed-images-dropzone", listId: "fg-add-packed-images-filelist", label: "Packed Products Images",      placeholder: "📎 Click to attach Packed Products Images" },
  testCert:             { dropzoneId: "fg-add-test-cert-dropzone",     listId: "fg-add-test-cert-filelist",     label: "Test Certificate",            placeholder: "📎 Click to attach Test Certificate" },
  inProcessInspection:  { dropzoneId: "fg-add-inprocess-dropzone",     listId: "fg-add-inprocess-filelist",     label: "In Process Inspection Sheet", placeholder: "📎 Click to attach In Process Inspection Sheet" },
  inspectionClearance:  { dropzoneId: "fg-add-inspection-dropzone",    listId: "fg-add-inspection-filelist",    label: "Inspection Clearance",        placeholder: "📎 Click to attach Inspection Clearance" },
  warrantyCard:         { dropzoneId: "fg-add-warranty-dropzone",      listId: "fg-add-warranty-filelist",      label: "Warranty Card",                placeholder: "📎 Click to attach Warranty Card" },
  otherDocuments:       { dropzoneId: "fg-add-otherdocs-dropzone",     listId: "fg-add-otherdocs-filelist",     label: "Other Documents",              placeholder: "📎 Click to attach Other Documents" },
};
const FG_REQUIRED_DOC_TYPES = ["jobCardSheet", "packedProductsImages", "testCert", "inProcessInspection", "warrantyCard"];
let fgDocFiles = {};

function resetFGDocFiles() {
  fgDocFiles = {};
  Object.keys(FG_DOC_META).forEach(t => { fgDocFiles[t] = []; renderFGFileList(t); });
}
resetFGDocFiles();

// input.value is cleared after every pick so selecting the SAME file
// twice (or picking again right after a remove) still fires onchange.
function handleFGFileSelectionMulti(input, type) {
  const file = input.files[0];
  input.value = "";
  if (!file || !FG_DOC_META[type]) return;
  fgDocFiles[type].push(file);
  renderFGFileList(type);
}

function removeFGFile(type, idx) {
  if (!fgDocFiles[type]) return;
  fgDocFiles[type].splice(idx, 1);
  renderFGFileList(type);
}

function renderFGFileList(type) {
  const meta = FG_DOC_META[type];
  if (!meta) return;
  const files = fgDocFiles[type] || [];
  const box = document.getElementById(meta.dropzoneId);
  if (box) {
    if (files.length > 0) { box.textContent = `✅ ${files.length} file${files.length > 1 ? "s" : ""} attached — click to add more`; box.classList.add("done"); }
    else { box.textContent = meta.placeholder; box.classList.remove("done"); }
  }
  const list = document.getElementById(meta.listId);
  if (!list) return;
  list.innerHTML = files.map((f, i) => `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; font-size:0.76rem; padding:4px 8px; background:#f8fafc; border:1px solid var(--border); border-radius:4px; margin-top:4px;">
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${f.name}</span>
      <span onclick="removeFGFile('${type}', ${i})" style="cursor:pointer; color:#b91c1c; font-weight:700; flex-shrink:0;" title="Remove">✕</span>
    </div>`).join("");
}

/**
 * SUBMIT FINISHED GOODS ADD ENTRY
 */
async function submitFinishedGoodsAddEntry(department, canvasId) {
  const get = (id) => { const el = document.getElementById(`${id}-${canvasId}`); return el ? el.value.trim() : ""; };

  const entryDate     = get("fg-date");
  const projectId     = get("fg-project");
  const customerName  = get("fg-customer");
  const serialNumber  = get("fg-serial");
  const jobCardNumber = get("fg-jobcard");
  const productRating = get("fg-rating");
  const productDetails= get("fg-details");
  const totalStock    = parseInt(get("fg-qty"), 10);
  const prodResponsible = get("fg-prod");
  const storeIncharge = get("fg-store");
  const additionalRemarks = get("fg-remarks");

  const banner    = document.getElementById(`fg-feedback-${canvasId}`);
  const submitBtn = document.getElementById(`fg-submit-${canvasId}`);

  if (!projectId)              return alert("Project ID is required.");
  if (!totalStock || totalStock <= 0) return alert("Product Quantity must be greater than 0.");
  if (!storeIncharge)          return alert("Finished Goods Store Incharge Person is required.");

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Saving...';

  try {
    const data = await apFetch({
      action:           "addFinishedGoodsItem",
      activeEngineer:   appActiveOperatorIdentityString,
      department,
      projectId,
      customerName,
      productName:          productDetails,
      productSerialNumber:  serialNumber,
      itemCode:             "",         // populate from your fg-item-code field if it exists in this form
      productRating,
      jobCardNumber,
      unit:                 "NOS",
      prodResponsible,
      storeIncharge,
      additionalRemarks,
      qaPersonName:         appActiveOperatorIdentityString,
      qaDone:               "Yes"
    });

    if (data.success) {
      document.getElementById(`fg-form-${canvasId}`).style.display = "none";
      banner.style.cssText = "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:16px; border-radius:var(--radius); margin-bottom:15px; text-align:left;";
      banner.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <strong>Added to ${department} Finished Goods Store.</strong><br/>
            <span style="font-size:0.88rem; font-weight:600;">Project: <strong>${projectId}</strong> · Customer: ${customerName} · Qty: ${totalStock}</span>
          </div>
          <button class="nav-btn-styled" onclick="initializeFinishedGoodsAddWorkspace('${department}', '${canvasId}')" style="background:#15803d; color:white; padding:10px 18px; font-weight:700;">
            + Add Another Item
          </button>
        </div>`;
    } else {
      alert("Submission failed: " + (data.error || "Unknown error."));
      submitBtn.disabled = false;
      submitBtn.textContent = "Add to Finished Goods Store";
    }
  } catch(err) {
    alert("Network error: " + err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Add to Finished Goods Store";
  }
}

function filterOutPureAdminPersonnel(personnelTree) {
  return (personnelTree || []).filter(u => {
    const depts = (u.departmentsList || []).map(d => d.toLowerCase().trim());
    // Exclude only if Admin is their ONLY department
    return !(depts.length === 1 && depts[0] === "admin");
  });
}

// Close dropdowns when clicking outside. Checks both input and textarea —
// Create BOQ's material search field is a <textarea>, not an <input>, so
// e.target.closest("input") was always null for it; any interaction that
// registered as a click there (including scroll-related mouse activity
// inside the dropdown itself) was being treated as "outside" and closing
// the list before a scroll or selection could complete.
document.addEventListener("click", function(e) {
  if (!e.target.closest("[id*='-mat-dropdown-']") && !e.target.closest("input") && !e.target.closest("textarea")) {
    document.querySelectorAll("[id*='-mat-dropdown-']").forEach(d => d.style.display = "none");
  }
});

async function initializeFGAddWorkspace() {
  if (fgAddWorkspaceInitInProgress) return;
  fgAddWorkspaceInitInProgress = true;
  document.getElementById("fg-add-feedback").style.display = "none";
  try {
  await loadItemCodeCatalogIntoCache();

  // Load projects
  const projDrop = document.getElementById("fg-add-project-ta-input");
  projDrop.placeholder = "Loading...";
  try {
    const data = await apFetch({ action:"pullLiveActiveProjectCodes" });
    // The typeahead input filters/renders from these two globals itself
    // (handleSharedProjectTypeaheadInput) — no <select> to populate here.
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
    window.fgAddProjectMeta = data.projectMeta || {};
    projDrop.placeholder = "Type Project ID or Customer Name...";
  } catch(e) {
    projDrop.placeholder = "Error loading projects";
  }

  // Load personnel
  const prodDrop  = document.getElementById("fg-add-prod-person");
  prodDrop.innerHTML  = '<option value="">Loading...</option>';
  try {
    const data = await apFetch({ action:"getStoreOperatorsList" });
    const allPersonnel = data.fullPersonnelDataRecordsTree || [];

    const prodPeople  = filterOutPureAdminPersonnel(allPersonnel.filter(p => p.departmentsList.some(d => d.toLowerCase().trim() === "production" || d.toLowerCase().trim() === "admin")));

    prodDrop.innerHTML  = '<option value="">— Select Person —</option>';

    prodPeople.forEach(p => {
      const opt = document.createElement("option"); opt.value = p.fullName; opt.textContent = p.fullName;
      prodDrop.appendChild(opt);
    });

    } catch(e) {
    prodDrop.innerHTML  = '<option value="">Error loading personnel</option>';
  }

  resetFGAddForm();
  } catch(e) {
    console.error("initializeFGAddWorkspace error:", e);
  } finally {
    fgAddWorkspaceInitInProgress = false;
  }
}

async function handleFGAddProjectChange(projectId) {
  const meta = window.fgAddProjectMeta && window.fgAddProjectMeta[projectId];
  document.getElementById("fg-add-customer").value = meta ? (meta.companyName || "") : "";

  const fieldsToToggle = ["fg-add-department","fg-add-serial","fg-add-prod-person","fg-add-qa-person","fg-add-remarks"];
  const submitBtn = document.getElementById("fg-add-submit-btn");
  const boqLabel = document.getElementById("fg-add-boq-label");
  const jobCardLabel = document.getElementById("fg-add-jobcard-label");

  fgJobCardDisplayReset("— Select BOQ First —");
  if (jobCardLabel) jobCardLabel.style.color = "var(--muted)";

  if (projectId) {
    fieldsToToggle.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
    // Submit button stays locked until BOQ validation passes

    fgBOQDisplayReset("Loading...");
    try {
      const data = await apFetch({ action:"fetchJobCardsForProject", projectId });
      window.fgJobCardsCache = data.jobCards || [];
      const boqMap = {};
      window.fgJobCardsCache.forEach(jc => {
        if (jc.boqId && !boqMap[jc.boqId]) boqMap[jc.boqId] = jc.boqId;
      });
      if (Object.keys(boqMap).length === 0) {
        fgBOQDisplayReset("⚠ No BOQ IDs found for this project");
        if (boqLabel) boqLabel.style.color = "var(--warn)";
      } else {
        fgBOQDisplayReset("— Select BOQ ID —");
        fgBOQPopulate(Object.entries(boqMap).map(([boqId, label]) => ({ value: boqId, label })));
        fgBOQDisplayEnable();
        if (boqLabel) boqLabel.style.color = "var(--brand)";
      }
    } catch(e) {
      fgBOQDisplayReset("Error loading BOQs");
    }
  } else {
    fieldsToToggle.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = "0.5"; submitBtn.style.cursor = "not-allowed"; }
    fgBOQDisplayReset("— Select Project First —");
    if (boqLabel) boqLabel.style.color = "var(--muted)";
  }
}

function fgBOQDisplayReset(text) {
  const disp = document.getElementById("fg-add-boq-display");
  const textEl = document.getElementById("fg-add-boq-display-text");
  const hidden = document.getElementById("fg-add-boq");
  const list = document.getElementById("fg-add-boq-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function fgBOQDisplayEnable() {
  const disp = document.getElementById("fg-add-boq-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function fgBOQPopulate(options) {
  const list = document.getElementById("fg-add-boq-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectFGBOQ('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleFGBOQDropdown() {
  const disp = document.getElementById("fg-add-boq-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("fg-add-boq-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectFGBOQ(boqId, label) {
  document.getElementById("fg-add-boq").value = boqId;
  document.getElementById("fg-add-boq-display-text").textContent = label;
  document.getElementById("fg-add-boq-dropdown-list").style.display = "none";
  handleFGBOQChange(boqId);
}
function handleFGBOQChange(boqId) {
  const jobCardLabel = document.getElementById("fg-add-jobcard-label");
  resetFGDownstreamOfBOQ();
  if (!boqId) {
    fgJobCardDisplayReset("— Select BOQ First —");
    if (jobCardLabel) jobCardLabel.style.color = "var(--muted)";
    document.getElementById("fg-add-product-name-display").value = "";
    document.getElementById("fg-add-product-name").value = "";
    document.getElementById("fg-add-rating").value = "";
    document.getElementById("fg-add-unit").value = "";
    return;
  }
  const filtered = (window.fgJobCardsCache || []).filter(jc => jc.boqId === boqId);
  const sample = filtered[0] || {};
  document.getElementById("fg-add-product-name-display").value = sample.productName || "";
  document.getElementById("fg-add-product-name").value = sample.productName || "";
  document.getElementById("fg-add-rating").value = sample.productRating || "";
  document.getElementById("fg-add-unit").value = "NOS";
  fgJobCardDisplayReset("— Select Job Card Number —");
  fgJobCardPopulate(filtered.map(jc => ({ value: jc.jobCardNumber, label: `${jc.jobCardNumber} (Set ${jc.setNumber})` })));
  fgJobCardDisplayEnable();
  if (jobCardLabel) jobCardLabel.style.color = "var(--brand)";
}
function resetFGDownstreamOfBOQ() {
  window.fgBOQValidationPassed = false;
  const zone = document.getElementById("fg-boq-validation-zone");
  if (zone) { zone.style.display = "none"; zone.innerHTML = ""; }
  updateFGSubmitButtonState();
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#fg-add-boq-display") && !e.target.closest("#fg-add-boq-dropdown-list")) {
    const l = document.getElementById("fg-add-boq-dropdown-list"); if (l) l.style.display = "none";
  }
});

function fgJobCardDisplayReset(text) {
  const disp = document.getElementById("fg-add-jobcard-display");
  const textEl = document.getElementById("fg-add-jobcard-display-text");
  const hidden = document.getElementById("fg-add-jobcard");
  const list = document.getElementById("fg-add-jobcard-dropdown-list");
  if (textEl) textEl.textContent = text;
  if (hidden) hidden.value = "";
  if (list) { list.style.display = "none"; list.innerHTML = ""; }
  if (disp) { disp.dataset.disabled = "1"; disp.style.opacity = "0.5"; disp.style.cursor = "not-allowed"; disp.style.color = "var(--muted)"; disp.style.background = "#f1f5f9"; }
}
function fgJobCardDisplayEnable() {
  const disp = document.getElementById("fg-add-jobcard-display");
  if (disp) { disp.dataset.disabled = "0"; disp.style.opacity = "1"; disp.style.cursor = "pointer"; disp.style.color = "var(--text)"; disp.style.background = "#fff"; }
}
function fgJobCardPopulate(options) {
  const list = document.getElementById("fg-add-jobcard-dropdown-list");
  if (!list) return;
  list.innerHTML = options.map(o => `
    <div onclick="event.stopPropagation(); selectFGJobCard('${o.value.replace(/'/g,"\\'")}', \`${o.label.replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
}
function toggleFGJobCardDropdown() {
  const disp = document.getElementById("fg-add-jobcard-display");
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById("fg-add-jobcard-dropdown-list");
  const isOpen = list.style.display === "block";
  document.querySelectorAll("[id$='-dropdown-list']").forEach(l => l.style.display = "none");
  list.style.display = isOpen ? "none" : "block";
}
function selectFGJobCard(jobCardNumber, label) {
  document.getElementById("fg-add-jobcard").value = jobCardNumber;
  document.getElementById("fg-add-jobcard-display-text").textContent = label;
  document.getElementById("fg-add-jobcard-dropdown-list").style.display = "none";
  handleFGJobCardChange(jobCardNumber);
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#fg-add-jobcard-display") && !e.target.closest("#fg-add-jobcard-dropdown-list")) {
    const l = document.getElementById("fg-add-jobcard-dropdown-list"); if (l) l.style.display = "none";
  }
});

function handleFGJobCardChange(jobCardNumber) {
  triggerFGBOQValidation();
}

async function triggerFGBOQValidation() {
  const zone = document.getElementById("fg-boq-validation-zone");
  const projectId    = document.getElementById("fg-add-project-ta-input").value.trim();
  const jobCardNumber= document.getElementById("fg-add-jobcard").value.trim();
  const productName  = document.getElementById("fg-add-product-name").value.trim();
  const productRating= document.getElementById("fg-add-rating").value.trim();

  if (!projectId || !jobCardNumber || !productName) {
    zone.style.display = "none";
    zone.innerHTML = "";
    window.fgBOQValidationPassed = false;
    updateFGSubmitButtonState();
    return;
  }

  zone.style.display = "block";
  zone.innerHTML = `<div style="text-align:center; padding:14px; color:var(--muted); font-size:0.85rem;">Checking BOQ material consumption for this Job Card...</div>`;

  try {
    const data = await apFetch({
      action: "validateJobCardBOQConsumption",
      projectId, jobCardNumber, productName, productRating
    });

    if (!data.success) {
      zone.innerHTML = `<div style="padding:12px; background:#fff5f5; border:1.5px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-size:0.85rem; font-weight:600;">⚠️ ${data.error || "Validation failed."}</div>`;
      window.fgBOQValidationPassed = false;
      updateFGSubmitButtonState();
      return;
    }

    if (!data.details || data.details.length === 0) {
      zone.innerHTML = `<div style="padding:12px; background:#fff5f5; border:1.5px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-size:0.85rem; font-weight:600;">⚠️ No BOQ found for Product Name <strong>${productName}</strong> ${productRating}. Contact Design department to create/authorize the BOQ for this product.</div>`;
      window.fgBOQValidationPassed = false;
      updateFGSubmitButtonState();
      return;
    }

    const rowsHtml = data.details.map(d => {
      const statusColor = d.matched ? { bg: "#dcfce7", color: "#15803d", icon: "✅" } : { bg: "#fee2e2", color: "#b91c1c", icon: "❌" };
      return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:${statusColor.bg}; border-radius:4px; margin-bottom:4px;">
        <div style="font-size:0.8rem; font-weight:600; color:#1e293b;">${statusColor.icon} ${d.materialName} <span style="font-size:0.68rem; color:var(--muted); font-weight:400;">(${d.typeOfStore})</span></div>
        <div style="font-size:0.78rem; font-weight:700; color:${statusColor.color};">Required: ${fmtQty(d.required)} ${d.unitType} | Consumed: ${fmtQty(d.consumed)} ${d.unitType}</div>
      </div>`;
    }).join("");

    window.fgBOQValidationPassed = data.matched;

    if (data.matched) {
      zone.innerHTML = `
        <div style="padding:10px 12px; background:#f0fdf4; border:1.5px solid #86efac; border-radius:var(--radius) var(--radius) 0 0; color:#15803d; font-size:0.85rem; font-weight:700;">✅ Bill of Quantity material consumption matches for this Job Card.</div>
        <div style="border:1px solid var(--border); border-top:none; padding:10px; border-radius:0 0 var(--radius) var(--radius);">${rowsHtml}</div>`;
    } else {
      zone.innerHTML = `
        <div style="padding:10px 12px; background:#fff5f5; border:1.5px solid #fca5a5; border-radius:var(--radius) var(--radius) 0 0; color:#b91c1c; font-size:0.85rem; font-weight:700;">❌ Material consumption mismatch for ${productName} ${productRating}. Contact Design department to update the BOQ for this product, or correct material requests/returns for this Job Card.</div>
        <div style="border:1px solid var(--border); border-top:none; padding:10px; border-radius:0 0 var(--radius) var(--radius);">${rowsHtml}</div>`;
    }

    updateFGSubmitButtonState();
  } catch(e) {
    zone.innerHTML = `<div style="padding:12px; background:#fff5f5; border:1.5px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-size:0.85rem;">Network error checking BOQ: ${e.message}</div>`;
    window.fgBOQValidationPassed = false;
    updateFGSubmitButtonState();
  }
}

function updateFGSubmitButtonState() {
  const btn = document.getElementById("fg-add-submit-btn");
  if (!btn) return;
  const projectId = document.getElementById("fg-add-project-ta-input").value.trim();
  if (!projectId) return; // still locked by project, no change needed

  if (window.fgBOQValidationPassed) {
    btn.disabled = false;
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
  } else {
    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.style.cursor = "not-allowed";
  }
}

function resetFGAddForm() {
  ["fg-add-department","fg-add-project","fg-add-prod-person","fg-add-unit"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  ["fg-add-customer","fg-add-product-name-display","fg-add-product-name",
   "fg-add-rating","fg-add-jobcard","fg-add-boq","fg-add-serial","fg-add-remarks"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  fgBOQDisplayReset("— Select Project First —");
  fgJobCardDisplayReset("— Select BOQ First —");
  document.getElementById("fg-add-qa-done").value = "No";
  document.getElementById("fg-add-packing-quality").value = "No";
  resetFGDocFiles();
  document.getElementById("fg-add-feedback").style.display = "none";
  const validationZone = document.getElementById("fg-boq-validation-zone");
  if (validationZone) { validationZone.style.display = "none"; validationZone.innerHTML = ""; }
  window.fgBOQValidationPassed = false;
  handleFGAddProjectChange(""); // re-lock fields
}

function startAnotherFGAddEntry() {
  document.getElementById("fg-add-feedback").style.display = "none";
  document.getElementById("fg-add-form").style.display = "block";
  resetFGAddForm();
}

let pinvCache = { projectId: "", boqs: [], jobCards: [] };

async function submitFGAddItem() {
  if (_submitFGAddItemInProgress) return;
  _submitFGAddItemInProgress = true;
  const btn        = document.getElementById("fg-add-submit-btn");
  const department = document.getElementById("fg-add-department").value.trim();
  const projectId  = document.getElementById("fg-add-project-ta-input").value.trim();
  const customerName=document.getElementById("fg-add-customer").value.trim();
  const productName= document.getElementById("fg-add-product-name").value.trim();
  const boqId      = document.getElementById("fg-add-boq").value.trim();
  const rating     = document.getElementById("fg-add-rating").value.trim();
  const jobCard    = document.getElementById("fg-add-jobcard").value.trim();
  const serialNumber = document.getElementById("fg-add-serial").value.trim();
  const unit = document.getElementById("fg-add-unit").value.trim();
  const remarks    = document.getElementById("fg-add-remarks").value.trim();
  const qaPersonName = appActiveOperatorIdentityString || "";
  const qaDone     = document.getElementById("fg-add-qa-done").value.trim();
  const packingQualityConfirmation = document.getElementById("fg-add-packing-quality").value.trim();

  const failFG = (msg) => { _submitFGAddItemInProgress = false; return showBOQBanner("fg-add-feedback", msg, "error"); };
  if (!department)  return failFG("Department is required.");
  if (!projectId)   return showBOQBanner("fg-add-feedback", "Project ID is required.", "error");
  if (!productName) return showBOQBanner("fg-add-feedback", "Product Name is required.", "error");
  if (!serialNumber) return showBOQBanner("fg-add-feedback", "Product Serial Number is required.", "error");
  if (!window.fgBOQValidationPassed) return showBOQBanner("fg-add-feedback", "Material consumption for this Job Card does not match the BOQ. Resolve the mismatch before submitting.", "error");
  if (qaDone !== "Yes") return showBOQBanner("fg-add-feedback", "Q/A Done must be set to Yes before this item can be submitted.", "error");
  if (packingQualityConfirmation !== "Yes") return showBOQBanner("fg-add-feedback", "Packing Quality Confirmation must be set to Yes before this item can be submitted.", "error");
  // Neither Q/A Done nor Packing Quality Confirmation is persisted — see
  // migration 077: a finished_goods_inventory row's mere existence already
  // implies both, so these are submit-time gates only.
  for (const docType of FG_REQUIRED_DOC_TYPES) {
    if (!(fgDocFiles[docType] || []).length) {
      return showBOQBanner("fg-add-feedback", `${FG_DOC_META[docType].label} document is required.`, "error");
    }
  }
  // Inspection Clearance and Other Documents are optional — no validation block.

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Uploading documents...';

  async function uploadFGDoc(file, docLabel, jobCardNum) {
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
    const upData = await apFetch({ action: "uploadProductionJobCardDocument", projectId, customerName, boqId, jobCardNumber: jobCardNum, docLabel, fileName: file.name, file: { fileName: file.name, base64Data: b64, mimeType: file.type || "application/octet-stream" } });
    return upData.success ? upData.url : "";
  }

  showBlockingOverlay("Uploading documents...");
  try {
    const documents = [];
    for (const docType of Object.keys(FG_DOC_META)) {
      const files = fgDocFiles[docType] || [];
      const label = FG_DOC_META[docType].label;
      for (const file of files) {
        const url = await uploadFGDoc(file, label, jobCard);
        if (!url) throw new Error(`Upload failed for "${file.name}" (${label}). Please retry.`);
        documents.push({ docType, fileName: file.name, url });
      }
    }

    btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting...';

    const finishedGoodUse = document.getElementById("fg-add-use-toggle")?.value || "Use in other Product";

    const data = await apFetch({
      action: "addFinishedGoodsItem",
      department, projectId, customerName, productName,
      itemCode: "", productRating: rating, jobCardNumber: jobCard,
      productSerialNumber: serialNumber,
      unit, additionalRemarks: remarks,
      qaPersonName, finishedGoodUse, documents,
      operatorName: appActiveOperatorIdentityString
    });

    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("fg-add-form").style.display = "none";
      showBOQBanner("fg-add-feedback",
        `<strong>${productName}</strong> submitted for ${department} Finished Goods Store — pending FG Approval.
         <div style="margin-top:10px;">
           <button class="nav-btn-styled" onclick="startAnotherFGAddEntry()" style="background:#15803d; color:#fff; font-weight:700; padding:8px 18px;">+ Add Another FG Material</button>
         </div>`,
        "success", true);
    } else {
      showBOQBanner("fg-add-feedback", data.error || "Failed to add item.", "error");
    }
  } catch(e) {
    hideBlockingOverlay();
    showBOQBanner("fg-add-feedback", "Network error: " + e.message, "error");
  } finally {
    _submitFGAddItemInProgress = false;
    btn.disabled = false;
    btn.textContent = "Add to Finished Goods Store";
  }
}

// ═══════════════════════════════════════════════════════
// LIVE FG STOCK — update triggerLiveFinishedGoodsStoreStockMetricsSync
// ═══════════════════════════════════════════════════════

