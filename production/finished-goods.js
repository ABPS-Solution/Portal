let fgJobCardSheetFile    = null;
let fgQATestCertFile      = null;
let fgQAInspectionFile    = null;
let fgWarrantyCardFile    = null;
let fgOtherDocsFile       = null;
let fgInProcessInspFile   = null;

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
  if (!e.target.closest("#fg-product-dropdown") && !e.target.closest("#fg-add-product-search")) {
    const d = document.getElementById("fg-product-dropdown");
    if (d) d.style.display = "none";
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

  const fieldsToToggle = ["fg-add-department","fg-add-product-search","fg-add-rating","fg-add-serial","fg-add-prod-person","fg-add-qa-person","fg-add-remarks"];
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

// "Finished Good Use" no longer changes which catalog is searched — Dispatch Product Code
// was removed; every use (including "Ready for Dispatch") now searches Item Code.
function handleFGUseToggleChange(chosenUse) {
  document.getElementById("fg-add-product-search").value = "";
  document.getElementById("fg-add-product-name").value   = "";
  document.getElementById("fg-add-item-code").value      = "";
  document.getElementById("fg-add-rating").value          = "";
  const dropdown = document.getElementById("fg-product-dropdown");
  if (dropdown) dropdown.style.display = "none";

  const searchInput = document.getElementById("fg-add-product-search");
  if (searchInput) searchInput.placeholder = "Type to search item code product name...";

  loadItemCodeCatalogIntoCache();
}

function handleFGProductSearch(query) {
  const dropdown  = document.getElementById("fg-product-dropdown");
  const catalog = (window.itemCodeCatalogCache || []).map(c => ({ ...c, displayName: c.productName }));

  if (!query || query.trim().length < 1) {
    dropdown.style.display = "none";
    document.getElementById("fg-add-product-name").value = "";
    document.getElementById("fg-add-item-code").value    = "";
    document.getElementById("fg-add-rating").value        = "";
    return;
  }

  const q = query.toLowerCase();
  const matches = catalog.filter(item => {
    const name = (item.productName || "").toLowerCase();
    const combined = `${name} ${(item.rating || "").toLowerCase()}`.trim();
    return name.includes(q) || combined.includes(q);
  }).slice(0, 10);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#b91c1c; font-weight:600;">
      No matching product found. <a href="${window.location.pathname}?module=design-itemcode&q=${encodeURIComponent(query)}" target="_blank" style="color:var(--brand); font-weight:700;">Create Item Code first →</a>
    </div>`;
    dropdown.style.display = "block";
    document.getElementById("fg-add-product-name").value = "";
    document.getElementById("fg-add-item-code").value    = "";
    document.getElementById("fg-add-rating").value        = "";
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div onclick="selectFGProduct('${item.productName.replace(/'/g,"\\'")}', '${item.itemCode}', '${(item.rating||'').replace(/'/g,"\\'")}', '${(item.unit||'').replace(/'/g,"\\'")}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:8px;">${item.itemCode}</span>
      ${item.displayName}${item.rating ? ` <span style="color:var(--brand); font-weight:700;">${item.rating}</span>` : ""}
      ${item.typeOfMaterial ? `<span style="font-size:0.7rem; color:var(--muted); margin-left:6px;">(${window.typeLabelDisplay_(item.typeOfMaterial)})</span>` : ""}
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectFGProduct(productName, itemCode, rating, unit) {
  document.getElementById("fg-add-product-search").value = productName;
  document.getElementById("fg-add-product-name").value   = productName;
  document.getElementById("fg-add-item-code").value      = itemCode;
  document.getElementById("fg-add-rating").value          = rating || "";
  document.getElementById("fg-add-unit").value            = unit || "";
  document.getElementById("fg-product-dropdown").style.display = "none";
  triggerFGBOQValidation();
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
    return;
  }
  const filtered = (window.fgJobCardsCache || []).filter(jc => jc.boqId === boqId);
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
  ["fg-add-customer","fg-add-product-search","fg-add-product-name","fg-add-item-code",
   "fg-add-rating","fg-add-jobcard","fg-add-boq","fg-add-serial","fg-add-remarks"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  fgBOQDisplayReset("— Select Project First —");
  fgJobCardDisplayReset("— Select BOQ First —");
  document.getElementById("fg-add-qa-done").value = "No";
  fgJobCardSheetFile = null; fgQATestCertFile = null; fgInProcessInspFile = null; fgQAInspectionFile = null;
  fgWarrantyCardFile = null; fgOtherDocsFile = null;
  [["fg-add-jobcard-sheet-dropzone","📎 Click to attach Job Card Sheet"],
   ["fg-add-test-cert-dropzone","📎 Click to attach Test Certificate"],
   ["fg-add-inprocess-dropzone","📎 Click to attach In Process Inspection Sheet"],
   ["fg-add-inspection-dropzone","📎 Click to attach Inspection Clearance"],
   ["fg-add-warranty-dropzone","📎 Click to attach Warranty Card"],
   ["fg-add-otherdocs-dropzone","📎 Click to attach Other Documents"]
  ].forEach(([id, label]) => { const b = document.getElementById(id); if (b) { b.textContent = label; b.classList.remove("done"); } });
  document.getElementById("fg-product-dropdown").style.display = "none";
  document.getElementById("fg-add-feedback").style.display = "none";
  const validationZone = document.getElementById("fg-boq-validation-zone");
  if (validationZone) { validationZone.style.display = "none"; validationZone.innerHTML = ""; }
  window.fgBOQValidationPassed = false;
  handleFGAddProjectChange(""); // re-lock fields
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
  const itemCode   = document.getElementById("fg-add-item-code").value.trim();
  const rating     = document.getElementById("fg-add-rating").value.trim();
  const jobCard    = document.getElementById("fg-add-jobcard").value.trim();
  const serialNumber = document.getElementById("fg-add-serial").value.trim();
  const unit = document.getElementById("fg-add-unit").value.trim();
  const prodPerson = appActiveOperatorIdentityString || "";
  const remarks    = document.getElementById("fg-add-remarks").value.trim();
  const qaPersonName = appActiveOperatorIdentityString || "";
  const qaDone     = document.getElementById("fg-add-qa-done").value.trim();

  const failFG = (msg) => { _submitFGAddItemInProgress = false; return showBOQBanner("fg-add-feedback", msg, "error"); };
  if (!department)  return failFG("Department is required.");
  if (!projectId)   return showBOQBanner("fg-add-feedback", "Project ID is required.", "error");
  if (!productName) return showBOQBanner("fg-add-feedback", "Product Name is required.", "error");
  if (!serialNumber) return showBOQBanner("fg-add-feedback", "Product Serial Number is required.", "error");
  if (!window.fgBOQValidationPassed) return showBOQBanner("fg-add-feedback", "Material consumption for this Job Card does not match the BOQ. Resolve the mismatch before submitting.", "error");
  if (qaDone !== "Yes") return showBOQBanner("fg-add-feedback", "Q/A Done must be set to Yes before this item can be submitted.", "error");
  if (!fgJobCardSheetFile)  return showBOQBanner("fg-add-feedback", "Job Card Sheet document is required (Production).", "error");
  if (!fgQATestCertFile)    return showBOQBanner("fg-add-feedback", "Test Certificate is required (Q/A).", "error");
  if (!fgInProcessInspFile) return showBOQBanner("fg-add-feedback", "In Process Inspection Sheet is required (Q/A).", "error");
  if (!fgWarrantyCardFile)  return showBOQBanner("fg-add-feedback", "Warranty Card is required.", "error");
  // Inspection Clearance and Other Documents are optional — no validation block.

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Uploading documents...';

  async function uploadFGDoc(file, docLabel, jobCardNum) {
    if (!file) return ""; // Inspection Clearance is optional — skip cleanly if not attached.
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
    const fileName = docLabel + " " + jobCardNum;
    const upData = await apFetch({ action: "uploadProductionJobCardDocument", projectId, customerName, boqId: document.getElementById("fg-add-item-code").value.trim() || "", jobCardNumber: jobCardNum, docLabel, fileName, file: { fileName: fileName + "." + (file.name.split(".").pop() || "pdf"), base64Data: b64, mimeType: file.type || "application/octet-stream" } });
    return upData.success ? upData.url : "";
  }

  showBlockingOverlay("Adding to Finished Goods Store...");
  try {
    const jobCardSheetUrl    = await uploadFGDoc(fgJobCardSheetFile,    "Job Card Sheet",             jobCard);
    const testCertUrl        = await uploadFGDoc(fgQATestCertFile,      "Test Certificate",           jobCard);
    const inProcessInspUrl   = await uploadFGDoc(fgInProcessInspFile,   "In Process Inspection Sheet",jobCard);
    const inspectionClearanceUrl = await uploadFGDoc(fgQAInspectionFile,"Inspection Clearance",       jobCard);
    const warrantyCardUrl    = await uploadFGDoc(fgWarrantyCardFile,   "Warranty Card",              jobCard);
    const otherDocumentsUrl  = await uploadFGDoc(fgOtherDocsFile,      "Other Documents",            jobCard);

    btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Adding to Finished Goods...';

    const finishedGoodUse = document.getElementById("fg-add-use-toggle")?.value || "Use in other Product";

    const data = await apFetch({
      action: "addFinishedGoodsItem",
      department, projectId, customerName, productName,
      itemCode, productRating: rating, jobCardNumber: jobCard,
      productSerialNumber: serialNumber,
      unit, prodResponsible: prodPerson,
      additionalRemarks: remarks,
      qaPersonName, qaDone, finishedGoodUse,
      testCertUrl, inspectionClearanceUrl, inProcessInspUrl, jobCardSheetUrl,
      warrantyCardUrl, otherDocumentsUrl
    });

    hideBlockingOverlay();
    if (data.success) {
      showBOQBanner("fg-add-feedback", `<strong>${productName}</strong> added to Finished Goods Store (${department}) successfully!`, "success");
      resetFGAddForm();
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

