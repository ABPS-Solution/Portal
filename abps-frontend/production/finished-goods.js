// Each document type now accepts multiple files (was one File per type) —
// fgDocFiles[type] is an array, appended to on every selection rather than
// replaced, with a running list rendered under each dropzone.
const FG_DOC_META = {
  jobCardSheet:         { dropzoneId: "fg-add-jobcard-sheet-dropzone", listId: "fg-add-jobcard-sheet-filelist", label: "Job Card Sheet",              placeholder: "📎 Click to attach Job Card Sheet" },
  packedProductsImages: { dropzoneId: "fg-add-packed-images-dropzone", listId: "fg-add-packed-images-filelist", label: "Packed Products Images",      placeholder: "📎 Click to attach Packed Products Images" },
  testCert:             { dropzoneId: "fg-add-test-cert-dropzone",     listId: "fg-add-test-cert-filelist",     label: "Test Certificate",            placeholder: "📎 Click to attach Test Certificate" },
  inProcessInspection:  { dropzoneId: "fg-add-inprocess-dropzone",     listId: "fg-add-inprocess-filelist",     label: "In Process Inspection Sheet", placeholder: "📎 Click to attach In Process Inspection Sheet" },
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

// input.value is cleared after every pick so selecting the SAME file(s)
// twice (or picking again right after a remove) still fires onchange.
// The <input> itself carries `multiple` (index.html) so the OS file
// picker lets someone select several files in one go — this loops
// input.files rather than just files[0], the previous behavior forced a
// separate click-and-select round trip per file.
function handleFGFileSelectionMulti(input, type) {
  const files = [...(input.files || [])];
  input.value = "";
  if (files.length === 0 || !FG_DOC_META[type]) return;
  fgDocFiles[type].push(...files);
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
  // A successful submission hides fg-add-form and shows the success
  // banner instead (see submitFGAddItem) — that display:none only gets
  // undone by clicking "+ Add Another FG Material" (startAnotherFGAddEntry).
  // Navigating away and back into this screen without clicking it left the
  // form permanently hidden — just header/toggle visible, blank body —
  // since this init function never restored it. Every fresh entry must
  // show the form regardless of how the screen was left last time.
  const formEl = document.getElementById("fg-add-form");
  if (formEl) formEl.style.display = "block";
  try {
  await loadItemCodeCatalogIntoCache();

  // Load projects
  const projDrop = document.getElementById("fg-add-project-ta-input");
  projDrop.placeholder = "Loading...";
  try {
    // fetchFGEligibleProjects, not the shared pullLiveActiveProjectCodes —
    // this screen's Project ID search should only ever surface a project
    // that still has at least one job card without an FG entry (see
    // handleFGAddProjectChange's own job-card filtering below for the
    // matching BOQ/Job-Card-level cut). The shared typeahead globals still
    // get (re)populated here since handleSharedProjectTypeaheadInput reads
    // them directly — every other screen re-populates them fresh on its
    // own entry, so this doesn't leak a filtered list elsewhere.
    const data = await apFetch({ action:"fetchFGEligibleProjects" });
    const projectMeta = {};
    (data.projects || []).forEach(p => { projectMeta[p.projectId] = { companyName: p.companyName }; });
    window.sharedActiveProjectCodes = (data.projects || []).map(p => p.projectId);
    window.sharedProjectMeta = projectMeta;
    window.fgAddProjectMeta = projectMeta;
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
      // Job cards that already have a live FG entry (hasFgEntry) are
      // dropped from the cache entirely here — both the BOQ dropdown below
      // and handleFGBOQChange's Job Card Number list read from this same
      // cache, so filtering once at this single point keeps a completed
      // Job Card out of both, and a BOQ whose every Job Card is done out
      // of the BOQ list (it simply never gets a boqMap entry).
      window.fgJobCardsCache = (data.jobCards || []).filter(jc => !jc.hasFgEntry);
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
    document.getElementById("fg-add-item-code-display").value = "";
    document.getElementById("fg-add-item-code").value = "";
    document.getElementById("fg-add-description").value = "";
    document.getElementById("fg-add-description-id").value = "";
    document.getElementById("fg-add-make").value = "";
    return;
  }
  const filtered = (window.fgJobCardsCache || []).filter(jc => jc.boqId === boqId);
  const sample = filtered[0] || {};
  document.getElementById("fg-add-product-name-display").value = sample.productName || "";
  document.getElementById("fg-add-product-name").value = sample.productName || "";
  document.getElementById("fg-add-rating").value = sample.productRating || "";
  document.getElementById("fg-add-unit").value = "NOS";

  // Item Code, Description of Material and Make (18 Aug 2026) now come
  // straight off the BOQ itself (design.boq_drafts.product_item_code /
  // description_of_material, joined to item_codes.make in
  // fetchJobCardsForProject) instead of a fuzzy Material Name + Rating
  // match against the catalog — that match could silently land on the
  // wrong Item Code once two Description of Material variants shared one
  // name+rating, and it also left some rows with no item_code at all
  // whenever internal spacing differed. This is the direct fix for both.
  document.getElementById("fg-add-item-code-display").value = sample.productItemCode || "";
  document.getElementById("fg-add-item-code").value = sample.productItemCode || "";
  document.getElementById("fg-add-description").value = sample.descriptionOfMaterial || "";
  document.getElementById("fg-add-description-id").value = sample.descriptionId || "";
  document.getElementById("fg-add-make").value = sample.make || "";

  fgJobCardDisplayReset("— Select Job Card Number —");
  fgJobCardPopulate(filtered.map(jc => ({ value: jc.jobCardNumber, label: `${jc.jobCardNumber} (Set ${jc.setNumber})` })));
  fgJobCardDisplayEnable();
  if (jobCardLabel) jobCardLabel.style.color = "var(--brand)";
}
function resetFGDownstreamOfBOQ() {
  window.fgBOQValidationPassed = false;
  window.fgBOQValidationRan = false;
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
    window.fgBOQValidationRan = false;
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
      window.fgBOQValidationRan = false;
      updateFGSubmitButtonState();
      return;
    }

    if (!data.details || data.details.length === 0) {
      zone.innerHTML = `<div style="padding:12px; background:#fff5f5; border:1.5px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-size:0.85rem; font-weight:600;">⚠️ No BOQ found for Product Name <strong>${productName}</strong> ${productRating}. Contact Design department to create/authorize the BOQ for this product.</div>`;
      window.fgBOQValidationPassed = false;
      window.fgBOQValidationRan = false;
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

    // Informational only — no longer blocks submission. Since Return
    // Tickets were removed (Stock Sweep handles leftover material now,
    // and doesn't touch job_card_materials.used_quantity), an exact-match
    // requirement here would just force operators to draw material they
    // don't need, or block them forever after an intentional under-draw.
    // The breakdown stays visible because it's still useful signal for
    // correcting this BOQ's per-set quantities on future Job Cards.
    window.fgBOQValidationPassed = data.matched;
    window.fgBOQValidationRan = true;

    if (data.matched) {
      zone.innerHTML = `
        <div style="padding:10px 12px; background:#f0fdf4; border:1.5px solid #86efac; border-radius:var(--radius) var(--radius) 0 0; color:#15803d; font-size:0.85rem; font-weight:700;">✅ Bill of Quantity material consumption matches for this Job Card.</div>
        <div style="border:1px solid var(--border); border-top:none; padding:10px; border-radius:0 0 var(--radius) var(--radius);">${rowsHtml}</div>`;
    } else {
      zone.innerHTML = `
        <div style="padding:10px 12px; background:#fffbeb; border:1.5px solid #fcd34d; border-radius:var(--radius) var(--radius) 0 0; color:#92400e; font-size:0.85rem; font-weight:700;">⚠️ Material consumption doesn't exactly match the BOQ for ${productName} ${productRating} — informational only, submission isn't blocked. Worth checking whether this BOQ's per-set quantities need correcting.</div>
        <div style="border:1px solid var(--border); border-top:none; padding:10px; border-radius:0 0 var(--radius) var(--radius);">${rowsHtml}</div>`;
    }

    updateFGSubmitButtonState();
  } catch(e) {
    zone.innerHTML = `<div style="padding:12px; background:#fff5f5; border:1.5px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-size:0.85rem;">Network error checking BOQ: ${e.message}</div>`;
    window.fgBOQValidationPassed = false;
    window.fgBOQValidationRan = false;
    updateFGSubmitButtonState();
  }
}

function updateFGSubmitButtonState() {
  const btn = document.getElementById("fg-add-submit-btn");
  if (!btn) return;
  const projectId = document.getElementById("fg-add-project-ta-input").value.trim();
  if (!projectId) return; // still locked by project, no change needed

  // Gated on the check having run at all (a real BOQ was found for this
  // Job Card / Product), not on it matching — see triggerFGBOQValidation's
  // comment on why an exact-match requirement no longer makes sense.
  if (window.fgBOQValidationRan) {
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
   "fg-add-rating","fg-add-item-code-display","fg-add-item-code",
   "fg-add-jobcard","fg-add-boq","fg-add-serial","fg-add-remarks",
   "fg-add-description","fg-add-description-id","fg-add-make"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  fgBOQDisplayReset("— Select Project First —");
  fgJobCardDisplayReset("— Select BOQ First —");
  document.getElementById("fg-add-packing-quality").value = "No";
  document.getElementById("fg-add-use-toggle").value = "";
  resetFGDocFiles();
  document.getElementById("fg-add-feedback").style.display = "none";
  const validationZone = document.getElementById("fg-boq-validation-zone");
  if (validationZone) { validationZone.style.display = "none"; validationZone.innerHTML = ""; }
  window.fgBOQValidationPassed = false;
  window.fgBOQValidationRan = false;
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
  const itemCode   = document.getElementById("fg-add-item-code").value.trim();
  const jobCard    = document.getElementById("fg-add-jobcard").value.trim();
  const serialNumber = document.getElementById("fg-add-serial").value.trim();
  const unit = document.getElementById("fg-add-unit").value.trim();
  const remarks    = document.getElementById("fg-add-remarks").value.trim();
  const descriptionOfMaterial = document.getElementById("fg-add-description").value.trim() || null;
  const descriptionIdRaw = document.getElementById("fg-add-description-id").value.trim();
  const descriptionId = descriptionIdRaw ? parseInt(descriptionIdRaw) : null;
  const make = document.getElementById("fg-add-make").value.trim() || null;
  const productionPersonName = appActiveOperatorIdentityString || "";
  const packingQualityConfirmation = document.getElementById("fg-add-packing-quality").value.trim();
  const finishedGoodUse = document.getElementById("fg-add-use-toggle").value.trim();

  // Every early-return validation MUST go through failFG (not a bare
  // showBOQBanner) — only failFG resets _submitFGAddItemInProgress. Every
  // check that used to call showBOQBanner directly left that guard stuck
  // true forever after the first failed attempt, so the top-of-function
  // `if (_submitFGAddItemInProgress) return;` silently no-op'd every
  // later click — the banner never updated again even after the actual
  // problem (e.g. a missing Serial Number) was fixed, because Submit
  // stopped doing anything at all.
  const failFG = (msg) => { _submitFGAddItemInProgress = false; return showBOQBanner("fg-add-feedback", msg, "error"); };
  if (!department)  return failFG("Department is required.");
  if (!projectId)   return failFG("Project ID is required.");
  if (!productName) return failFG("Product Name is required.");
  if (!serialNumber) return failFG("Product Serial Number is required.");
  if (!finishedGoodUse) return failFG("Select Use (Use in other Product / Ready for Dispatch) before submitting.");
  if (!window.fgBOQValidationRan) return failFG("BOQ material check for this Job Card hasn't completed yet.");
  if (packingQualityConfirmation !== "Yes") return failFG("Packing Quality Confirmation must be set to Yes before this item can be submitted.");
  // Packing Quality Confirmation is not persisted — see migration 077: a
  // finished_goods_inventory row's mere existence already implies it (and,
  // historically, Q/A Done — that field was removed since this screen is
  // filled by Production, not QA; actual QA sign-off happens at FG Approval).
  for (const docType of FG_REQUIRED_DOC_TYPES) {
    if (!(fgDocFiles[docType] || []).length) {
      return failFG(`${FG_DOC_META[docType].label} document is required.`);
    }
  }
  // Other Documents is optional — no validation block.

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Uploading documents...';

  // Returns the server-renamed fileName (buildFGDocFileName, routes/production.js
  // — "<Doc Label>_<Job Card Number>.<ext>"), not the raw browser file.name,
  // so the Approval screen's "Uploaded Document" link shows the intended
  // naming from the very first submission, same as a later Replace/+Add Row.
  async function uploadFGDoc(file, docLabel, jobCardNum) {
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
    const upData = await apFetch({ action: "uploadProductionJobCardDocument", projectId, customerName, boqId, jobCardNumber: jobCardNum, docLabel, fileName: file.name, file: { fileName: file.name, base64Data: b64, mimeType: file.type || "application/octet-stream" } });
    return upData.success ? { url: upData.url, fileName: upData.fileName || file.name } : null;
  }

  showBlockingOverlay("Uploading documents...");
  try {
    const documents = [];
    for (const docType of Object.keys(FG_DOC_META)) {
      const files = fgDocFiles[docType] || [];
      const label = FG_DOC_META[docType].label;
      for (const file of files) {
        const uploaded = await uploadFGDoc(file, label, jobCard);
        if (!uploaded) throw new Error(`Upload failed for "${file.name}" (${label}). Please retry.`);
        documents.push({ docType, fileName: uploaded.fileName, url: uploaded.url });
      }
    }

    btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting...';

    const data = await apFetch({
      action: "addFinishedGoodsItem",
      department, projectId, customerName, productName,
      itemCode, productRating: rating, jobCardNumber: jobCard,
      productSerialNumber: serialNumber,
      unit, additionalRemarks: remarks,
      productionPersonName, finishedGoodUse, documents,
      descriptionOfMaterial, descriptionId, make,
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

