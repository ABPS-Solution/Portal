let cboqSpecFiles = [];
let targetBOQUploadFileRawObject = null;
let cboqMaterialRows = [];
// Search Product Name + Rating first (deduped across every finalized BOQ,
// typeahead-style like the Product Name * field below) — Project ID only
// activates and lists the projects that actually have that product+rating
// once one is picked, since with many BOQs a flat <select> of every one
// became unusable.
function handleCBOQImportProductSearch(query) {
  const dropdown = document.getElementById("cboq-import-product-dropdown");
  const list = window.cboqImportBOQList || [];
  resetCBOQImportResolution();

  if (!query || query.trim().length < 1) { dropdown.style.display = "none"; return; }
  const q = query.toLowerCase();
  const seen = new Set();
  const matches = [];
  for (const b of list) {
    const combined = `${b.productName || ""} ${b.productRating || ""}`.trim();
    const key = combined.toLowerCase();
    if (!key.includes(q) || seen.has(key)) continue;
    seen.add(key);
    matches.push({ productName: b.productName, productRating: b.productRating, combined });
    if (matches.length >= 10) break;
  }

  if (matches.length === 0) { dropdown.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#b91c1c; font-weight:600;">No matching BOQ found.</div>`; dropdown.style.display = "block"; return; }

  dropdown.innerHTML = matches.map(m => `
    <div onclick="selectCBOQImportProduct('${(m.productName||'').replace(/'/g,"\\'")}', '${(m.productRating||'').replace(/'/g,"\\'")}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${m.productName}${m.productRating ? ` - <span style="color:var(--brand); font-weight:700;">${m.productRating}</span>` : ""}
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectCBOQImportProduct(productName, productRating) {
  const searchEl = document.getElementById("cboq-import-product-search");
  searchEl.value = productRating ? `${productName} - ${productRating}` : productName;
  searchEl.style.height = "auto"; searchEl.style.height = searchEl.scrollHeight + "px";
  document.getElementById("cboq-import-product-dropdown").style.display = "none";
  window.cboqImportSelectedProduct = { productName, productRating };

  const descSelect = document.getElementById("cboq-import-description-select");
  const matches = (window.cboqImportBOQList || []).filter(b => b.productName === productName && (b.productRating || "") === (productRating || ""));
  window.cboqImportProductMatches = matches;
  resetCBOQImportProjectStage();

  if (matches.length === 0) {
    descSelect.innerHTML = '<option value="">— No BOQs found for this product —</option>';
    descSelect.disabled = true;
    descSelect.style.background = "#f1f5f9"; descSelect.style.color = "var(--muted)";
    return;
  }

  // Distinct descriptions among BOQs for this exact product+rating —
  // includes a "no description" option since not every variant has one.
  const seenDesc = new Map(); // descriptionId (or "" for none) -> text
  matches.forEach(b => { seenDesc.set(b.descriptionId || "", b.descriptionOfMaterial || ""); });
  const descOptions = Array.from(seenDesc.entries());

  descSelect.disabled = false;
  descSelect.style.background = "#fff"; descSelect.style.color = "var(--text)";
  if (descOptions.length === 1) {
    // Only one variant (with or without a description) — skip straight to Project ID.
    descSelect.innerHTML = `<option value="${descOptions[0][0]}" selected>${descOptions[0][1] || "— No Description of Material —"}</option>`;
    handleCBOQImportDescriptionChange(String(descOptions[0][0]));
  } else {
    descSelect.innerHTML = '<option value="">— Select Description of Material —</option>' +
      descOptions.map(([id, text]) => `<option value="${id}">${text || "— No Description of Material —"}</option>`).join("");
  }
}

function handleCBOQImportDescriptionChange(descriptionIdStr) {
  const projSearch = document.getElementById("cboq-import-project-search");
  resetCBOQImportProjectStage();
  if (descriptionIdStr === "" && (window.cboqImportProductMatches || []).some(b => b.descriptionId)) {
    // Placeholder re-selected on a product that DOES have real options — wait for a real pick.
    return;
  }
  const matches = (window.cboqImportProductMatches || []).filter(b => String(b.descriptionId || "") === descriptionIdStr);
  window.cboqImportProjectMatches = matches;
  if (matches.length === 0) return;
  projSearch.value = "";
  projSearch.placeholder = "Type to search Project ID...";
  projSearch.disabled = false;
  projSearch.style.background = "#fff"; projSearch.style.color = "var(--text)";
}

function resetCBOQImportProjectStage() {
  const projSearch = document.getElementById("cboq-import-project-search");
  window.cboqImportProjectMatches = [];
  window.cboqImportResolvedBoqId = null;
  if (projSearch) {
    projSearch.value = "";
    projSearch.placeholder = "Select Description First";
    projSearch.disabled = true;
    projSearch.style.background = "#f1f5f9"; projSearch.style.color = "var(--muted)";
    autoGrowTextField(projSearch);
  }
  const projDropdown = document.getElementById("cboq-import-project-dropdown");
  if (projDropdown) projDropdown.style.display = "none";
  const importBtn = document.getElementById("cboq-import-btn");
  if (importBtn) { importBtn.disabled = true; importBtn.style.opacity = "0.5"; importBtn.style.cursor = "not-allowed"; }
}

// Project ID is a free-text typeahead, not a <select> — only ever offering
// the projects that actually have this exact Product Name + Rating as a
// BOQ (window.cboqImportProjectMatches, set by selectCBOQImportProduct),
// same "filtered by what's already picked above" shape as Search by
// Company Name's typeahead elsewhere in the app.
function handleCBOQImportProjectSearch(query) {
  const dropdown = document.getElementById("cboq-import-project-dropdown");
  const matches = window.cboqImportProjectMatches || [];
  window.cboqImportResolvedBoqId = null;
  const importBtn = document.getElementById("cboq-import-btn");
  importBtn.disabled = true; importBtn.style.opacity = "0.5"; importBtn.style.cursor = "not-allowed";

  if (!query || query.trim().length < 1) { dropdown.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const filtered = matches.filter(b => (b.projectId || "").toLowerCase().includes(q)).slice(0, 15);

  if (filtered.length === 0) { dropdown.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#b91c1c; font-weight:600;">No matching Project ID found.</div>`; dropdown.style.display = "block"; return; }

  dropdown.innerHTML = filtered.map(b => `
    <div onclick="selectCBOQImportProjectOption('${b.projectId.replace(/'/g,"\\'")}', '${b.boqId.replace(/'/g,"\\'")}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${b.projectId} <span style="color:var(--muted); font-size:0.75rem;">(Order Qty: ${Math.round(Number(b.orderQuantity) || 0)})</span>
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectCBOQImportProjectOption(projectId, boqId) {
  const projSearch = document.getElementById("cboq-import-project-search");
  projSearch.value = projectId;
  autoGrowTextField(projSearch);
  document.getElementById("cboq-import-project-dropdown").style.display = "none";
  window.cboqImportResolvedBoqId = boqId;
  const importBtn = document.getElementById("cboq-import-btn");
  importBtn.disabled = false; importBtn.style.opacity = "1"; importBtn.style.cursor = "pointer";
}

function resetCBOQImportResolution() {
  window.cboqImportSelectedProduct = null;
  window.cboqImportProductMatches = [];
  resetCBOQImportProjectStage();
  const projSearch = document.getElementById("cboq-import-project-search");
  if (projSearch) projSearch.placeholder = "Select Product First";
  const descSelect = document.getElementById("cboq-import-description-select");
  if (descSelect) {
    descSelect.innerHTML = '<option value="">— Select Product First —</option>';
    descSelect.disabled = true;
    descSelect.style.background = "#f1f5f9"; descSelect.style.color = "var(--muted)";
  }
}

function resetCBOQImportSearch() {
  const searchEl = document.getElementById("cboq-import-product-search");
  if (searchEl) { searchEl.value = ""; searchEl.style.height = "auto"; }
  const dropdown = document.getElementById("cboq-import-product-dropdown");
  if (dropdown) dropdown.style.display = "none";
  resetCBOQImportResolution();
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#cboq-import-product-search") && !e.target.closest("#cboq-import-product-dropdown")) {
    const d = document.getElementById("cboq-import-product-dropdown");
    if (d) d.style.display = "none";
  }
  if (!e.target.closest("#cboq-import-project-search") && !e.target.closest("#cboq-import-project-dropdown")) {
    const d = document.getElementById("cboq-import-project-dropdown");
    if (d) d.style.display = "none";
  }
});

async function importCBOQFromExisting() {
  const boqId = window.cboqImportResolvedBoqId;
  if (!boqId) { alert("Please select a Product Name + Rating and a Project ID to import first."); return; }

  const btn = document.getElementById("cboq-import-btn");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Importing...";

  try {
    const data = await apFetch({ action: "fetchBOQMaterialRowsForImport", boqId: boqId });
    if (!data.success) { alert("Import failed: " + data.error); return; }

    // Strip trailing decimal noise (DB numeric columns come back as
    // strings like "16.000") the same way formatRateSmart does server-side:
    // whole numbers show with no decimals, fractional values keep up to 2.
    const cleanNum = (v) => {
      const n = Number(v) || 0;
      return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
    };
    // Make is re-derived from the current Item Code catalog rather than
    // trusting the imported row's stored value — Make is now locked/
    // catalog-driven (18 Aug 2026), so an old BOQ's saved make could be
    // stale if the Item Code's Make has since changed.
    const catalogForImport = window.itemCodeCatalogCache || [];
    cboqMaterialRows = (data.materialRows || []).map(row => {
      const catalogEntry = catalogForImport.find(c => c.itemCode === row.itemCode);
      return {
        typeOfStore: row.typeOfStore || "Raw Materials Store",
        materialName: row.materialName || "",
        itemCode: row.itemCode || "",
        make: (catalogEntry && catalogEntry.make) || row.make || "",
        quantityFor1Set: row.quantityFor1Set !== null && row.quantityFor1Set !== undefined ? cleanNum(row.quantityFor1Set) : "",
        unit: row.unit || "",
        // Design Rate / Qty is deliberately NOT imported — the operator must
        // re-enter it fresh for this BOQ rather than carrying over a rate
        // that may no longer be accurate.
        designRatePerQuantity: "",
        descriptionId: row.descriptionId || null,
        descriptionOfMaterial: row.descriptionOfMaterial || ""
      };
    });
    renderCBOQMaterialRows();

    // Product Name / Rating are NOT auto-filled from the imported BOQ —
    // they're still gated by the locked dropdown, selected from whatever
    // products are currently allowed for this project.
    const banner = document.getElementById("cboq-import-banner");
    banner.style.display = "block";
    banner.textContent = `Material rows imported from Project ID: ${data.sourceProjectId}, Product: ${data.sourceProductName} ${data.sourceProductRating}. Select the Product Name from the allowed list above.`;

    window.cboqImportSourceInfo = { boqId, sourceProjectId: data.sourceProjectId, sourceProductName: data.sourceProductName, sourceProductRating: data.sourceProductRating };
  } catch(e) {
    alert("Network request execution failure: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function handleCBOQProjectChange(projectId) {
  const meta = window.cboqProjectMeta && window.cboqProjectMeta[projectId];
  const customerNameEl = document.getElementById("cboq-customer-name");
  customerNameEl.value = meta ? (meta.companyName || "") : "";
  autoGrowPoField(customerNameEl);

  const fieldsToToggle = ["cboq-product-search", "cboq-department"];
  const addRowBtn = document.getElementById("cboq-add-row-btn");
  const submitBtn = document.getElementById("cboq-submit-btn");

  // Product Name/Rating and the derived Order Quantity are reset every
  // time the project changes — they're re-populated from
  // fetchAllowedBoqProducts, never carried over from a previous project.
  resetCBOQProductSelection();

  if (projectId) {
    fieldsToToggle.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
    if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = "1"; submitBtn.style.cursor = "pointer"; }
    loadItemCodeCatalogIntoCache();
    loadMaterialDescriptionsIntoCache();
    loadCboqAllowedProducts(projectId);
  } else {
    fieldsToToggle.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
    const pb = document.getElementById("cboq-prepared-by");
    if (pb) { pb.disabled = true; pb.style.opacity = "0.5"; pb.innerHTML = '<option value="">— Select Department First —</option>'; }
    if (addRowBtn) { addRowBtn.disabled = true; addRowBtn.style.opacity = "0.5"; addRowBtn.style.cursor = "not-allowed"; }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = "0.5"; submitBtn.style.cursor = "not-allowed"; }
    const banner = document.getElementById("cboq-pending-products-banner");
    if (banner) banner.style.display = "none";
  }
}

function resetCBOQProductSelection() {
  window.cboqAllowedOptionsByValue = {};
  window.cboqAllowedOptionsList = [];
  const search = document.getElementById("cboq-product-search");
  if (search) { search.value = ""; search.placeholder = "— Select Project First —"; autoGrowTextField(search); }
  const dropdown = document.getElementById("cboq-product-dropdown");
  if (dropdown) dropdown.style.display = "none";
  document.getElementById("cboq-product-name").value = "";
  document.getElementById("cboq-product-itemcode").value = "";
  document.getElementById("cboq-source-po-line-id").value = "";
  const ratingEl = document.getElementById("cboq-product-rating");
  if (ratingEl) ratingEl.value = "";
  const qtyEl = document.getElementById("cboq-order-qty");
  if (qtyEl) qtyEl.value = "";
  const addRowBtn = document.getElementById("cboq-add-row-btn");
  if (addRowBtn) { addRowBtn.disabled = true; addRowBtn.style.opacity = "0.5"; addRowBtn.style.cursor = "not-allowed"; }
  const descInput = document.getElementById("cboq-desc-input");
  const descIdField = document.getElementById("cboq-description-id");
  const makeField = document.getElementById("cboq-header-make");
  if (descInput) { descInput.value = ""; autoGrowTextField(descInput); }
  if (descIdField) descIdField.value = "";
  if (makeField) makeField.value = "";
}

// loadCboqAllowedProducts — gates Product Name to a locked, search-driven
// list: Tier 1 is PO products cleared for manufacturing (MFC Quantity > 0)
// that don't have a BOQ yet; once all of those have BOQs, Tier 2 offers the
// Finished Goods materials found inside them, recursively.
// Defensive against out-of-order responses: two calls can legitimately
// fire close together (e.g. a stray native "change" from the project
// typeahead losing focus, followed immediately by the real click-driven
// one) and there's no guarantee the network returns them in request order.
// A stale response landing after a newer one has already rendered would
// silently clobber the correct selection with wrong data. Only ever apply
// the response from whichever call was issued most recently.
let cboqAllowedProductsRequestSeq = 0;
async function loadCboqAllowedProducts(projectId) {
  const seq = ++cboqAllowedProductsRequestSeq;
  const search = document.getElementById("cboq-product-search");
  const banner = document.getElementById("cboq-pending-products-banner");
  if (search) { search.value = ""; search.placeholder = "Loading..."; autoGrowTextField(search); }
  try {
    const data = await apFetch({ action: "fetchAllowedBoqProducts", projectId });
    if (seq !== cboqAllowedProductsRequestSeq) return; // superseded by a newer request — ignore
    if (!data.success) {
      if (search) search.placeholder = data.error || "Could not load allowed products.";
      if (banner) { banner.style.display = "block"; banner.textContent = data.error || "Could not load allowed products."; }
      return;
    }

    // Keyed by itemCode + descriptionId (not itemCode alone) — Tier 2 can
    // now offer two Description of Material variants of the same item
    // code as separate options; a bare itemCode key would let the second
    // one silently overwrite the first in this map.
    window.cboqAllowedOptionsByValue = {};
    (data.options || []).forEach(opt => { window.cboqAllowedOptionsByValue[opt.itemCode + '|' + (opt.descriptionId || '')] = opt; });
    window.cboqAllowedOptionsList = data.options || [];

    if (!data.options || data.options.length === 0) {
      if (search) search.placeholder = "— No Products Cleared for a New BOQ —";
      if (banner) {
        banner.style.display = "block";
        banner.textContent = data.message || "No products are cleared for manufacturing yet. check Manufacturing Clearance.";
      }
      return;
    }

    if (search) search.placeholder = "— Select Product —";
    if (banner) {
      banner.style.display = "block";
      const heading = data.tier === "poProducts" ? "BOQ pending for:" : "Finished Goods BOQs pending for:";
      const esc = (s) => (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const bullets = data.pendingNames.map(n => `<li>${esc(n)}</li>`).join("");
      banner.innerHTML = `${heading}<ul style="margin:6px 0 0; padding-left:20px;">${bullets}</ul>`;
    }
  } catch(e) {
    if (seq !== cboqAllowedProductsRequestSeq) return;
    if (search) search.placeholder = "Network error";
    if (banner) { banner.style.display = "block"; banner.textContent = "Network error loading allowed products: " + e.message; }
  }
}

// Search box shows the combined "Product Name + Rating" per option (same
// as Import BOQ's and Manufacturing Clearance's typeaheads) — still a
// locked list, not free text; the field itself is readonly and clicking it
// just opens the full list of allowed options (no filtering/typing) — but
// once an option is picked, selectCBOQProductOption splits the combined
// label straight back into its own Product Name / Product Rating fields,
// matching how design.item_codes actually stores them (material_name,
// rating as separate columns).
function showCBOQProductDropdown() {
  const dropdown = document.getElementById("cboq-product-dropdown");
  if (!dropdown) return;
  const options = window.cboqAllowedOptionsList || [];

  if (options.length === 0) { dropdown.style.display = "none"; return; }

  // Held options render greyed and non-selectable with an "On Hold" badge
  // — the real block is server-side (createBOQDraft's assertPoLineNotOnHold),
  // this is purely so the operator sees WHY a product they expect isn't
  // pickable instead of thinking the list is wrong.
  dropdown.innerHTML = options.map(opt => opt.onHold ? `
    <div title="${(opt.holdReason || '').replace(/"/g,'&quot;')}"
      style="padding:8px 12px; cursor:not-allowed; border-bottom:1px solid #f1f5f9; font-size:0.82rem; color:var(--muted); background:#f8fafc; display:flex; justify-content:space-between; align-items:center; gap:8px;">
      <span>${opt.displayLabel || opt.productName}</span>
      <span style="background:#fee2e2; color:#b91c1c; font-size:0.65rem; font-weight:800; padding:2px 7px; border-radius:10px; text-transform:uppercase; white-space:nowrap;">⏸ On Hold</span>
    </div>` : `
    <div onmousedown="event.preventDefault();" onclick="selectCBOQProductOption('${opt.itemCode}', '${(opt.descriptionId || '')}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${opt.displayLabel || opt.productName}
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectCBOQProductOption(itemCode, descriptionId) {
  const opt = (window.cboqAllowedOptionsByValue || {})[itemCode + '|' + (descriptionId || '')];
  if (opt && opt.onHold) { alert(`This product is On Hold — ${opt.holdReason || 'no reason given'}. An admin must remove the Hold before a BOQ can be created for it.`); return; }
  const searchEl = document.getElementById("cboq-product-search");
  const ratingEl = document.getElementById("cboq-product-rating");
  const qtyEl = document.getElementById("cboq-order-qty");
  const addRowBtn = document.getElementById("cboq-add-row-btn");
  const dropdown = document.getElementById("cboq-product-dropdown");
  if (dropdown) dropdown.style.display = "none";

  if (!opt) return;

  if (searchEl) { searchEl.value = opt.productName; autoGrowTextField(searchEl); }
  document.getElementById("cboq-product-name").value = opt.productName;
  document.getElementById("cboq-product-itemcode").value = opt.itemCode;
  // resolveAllowedBoqProducts (routes/design.js) returns this field as
  // "lineId", not "sourcePoLineId" — reading the wrong key here meant this
  // hidden field was always empty, so source_po_line_id never got saved on
  // BOQ creation, which meant the "does this PO line already have a BOQ"
  // NOT EXISTS check in resolveAllowedBoqProducts could never find a match:
  // an already-BOQ'd product kept reappearing as still-pending forever,
  // silently allowing duplicate BOQs for the same product on one project.
  document.getElementById("cboq-source-po-line-id").value = opt.lineId || "";
  if (ratingEl) { ratingEl.value = opt.productRating || ""; ratingEl.style.height = "auto"; ratingEl.style.height = ratingEl.scrollHeight + "px"; }
  if (qtyEl) { qtyEl.value = trimNum(opt.lockedQuantity); updateCBOQTotals(); }

  // Description of Material / Make — Tier 2 (Finished Goods) options carry
  // these from the FG row they were sourced from; Tier 1 (fresh PO
  // products) never have either yet, so both stay blank for those.
  const descInput = document.getElementById("cboq-desc-input");
  const descIdField = document.getElementById("cboq-description-id");
  const makeField = document.getElementById("cboq-header-make");
  if (descInput) { descInput.value = opt.descriptionOfMaterial || ""; autoGrowTextField(descInput); }
  if (descIdField) descIdField.value = opt.descriptionId || "";
  if (makeField) makeField.value = opt.make || "";
  if (addRowBtn) { addRowBtn.disabled = false; addRowBtn.style.opacity = "1"; addRowBtn.style.cursor = "pointer"; }
}

document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("cboq-product-dropdown");
  if (dropdown && dropdown.style.display !== "none" &&
      !e.target.closest("#cboq-product-search") && !e.target.closest("#cboq-product-dropdown")) {
    dropdown.style.display = "none";
  }
});

function addCBOQMaterialRow() {
  cboqMaterialRows.push({ typeOfStore: "Raw Materials Store", materialName: "", itemCode: "", make: "", quantityFor1Set: "", unit: "", designRatePerQuantity: "" });
  renderCBOQMaterialRows();
}

function deleteCBOQMaterialRow(idx) {
  cboqMaterialRows.splice(idx, 1);
  renderCBOQMaterialRows();
}

function renderCBOQMaterialRows() {
  const tbody = document.getElementById("cboq-material-rows-body");
  if (cboqMaterialRows.length === 0) {
    tbody.innerHTML = '<tr id="cboq-empty-row"><td colspan="9" style="text-align:center; padding:20px; color:var(--muted); font-size:0.82rem;">No material rows added yet. Click "+ Add Row" to begin.</td></tr>';
    updateCBOQTotals();
    return;
  }
  tbody.innerHTML = "";
  cboqMaterialRows.forEach((row, idx) => {
    const isRawMaterial = row.typeOfStore !== "Spare Store";
    const isFgRow = row.typeOfStore === "Finished Goods Store";
    const totalMaterialRate = isRawMaterial ? ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0)) : 0;
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #f1f5f9";
    tr.innerHTML = `
      <td style="text-align:center; padding:6px; font-weight:700; color:var(--muted);">${idx + 1}</td>
      <td style="padding:4px;">
        <select onchange="cboqMaterialRows[${idx}].typeOfStore=this.value; renderCBOQMaterialRows();" style="padding:4px; font-size:0.8rem; width:100%;">
          <option value="Raw Materials Store" ${row.typeOfStore==="Raw Materials Store"?"selected":""}>Raw Material</option>
          <option value="Finished Goods Store" ${row.typeOfStore==="Finished Goods Store"?"selected":""}>Finished Goods</option>
        </select>
      </td>
      <td style="padding:4px; position:relative;">
        <textarea rows="1" placeholder="Type to search..." autocomplete="off"
          oninput="handleBOQRowMaterialSearch(this.value, ${idx}, 'cboq'); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
          onfocus="handleBOQRowMaterialSearch(this.value, ${idx}, 'cboq'); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
          style="padding:5px; font-size:0.82rem; width:100%; border:1px solid var(--border); border-radius:3px; resize:none; overflow:hidden; font-family:inherit; line-height:1.3; display:block;"
        >${boqRowMaterialDisplayText(row)}</textarea>
        <div id="cboq-mat-dropdown-${idx}" onmousedown="event.stopPropagation();" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:6px; overflow-y:auto; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.18); min-width:320px;"></div>
      </td>
      <td style="padding:4px;">
        <input type="text" value="${row.itemCode || ""}" readonly 
          style="padding:5px; font-size:0.78rem; font-family:monospace; font-weight:700; background:#e0f2fe; color:var(--brand); cursor:not-allowed; border-radius:3px; border:1px solid #bae6fd; width:100%;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="number" value="${row.quantityFor1Set || ""}" min="0" placeholder="0"
          oninput="cboqMaterialRows[${idx}].quantityFor1Set=parseFloat(this.value)||0; updateCBOQTotals(); const r=document.getElementById('cboq-rate-${idx}'); if(r) { const v=cboqMaterialRows[${idx}].quantityFor1Set*(Number(cboqMaterialRows[${idx}].designRatePerQuantity)||0); r.value=v.toLocaleString('en-IN',{maximumFractionDigits:2}); }"
          style="padding:5px; font-size:0.85rem; text-align:center; width:100%; border:1px solid var(--border); border-radius:3px;" />
      </td>
      <td style="padding:4px; text-align:center; vertical-align:middle;">
        <input type="text" value="${row.unit || "—"}" readonly
          style="padding:4px; font-size:0.8rem; width:100%; background:#f1f5f9; color:var(--text); font-weight:600; cursor:not-allowed; text-align:center; border-radius:3px; border:1px solid var(--border);" />
      </td>
      <td style="padding:4px; text-align:center;">
        ${isRawMaterial ? `
        <input type="number" value="${row.designRatePerQuantity || ""}" min="0" step="0.01" placeholder="0.00"
          oninput="cboqMaterialRows[${idx}].designRatePerQuantity=parseFloat(this.value)||0; updateCBOQTotals(); const r=document.getElementById('cboq-rate-${idx}'); if(r) { const v=(Number(cboqMaterialRows[${idx}].quantityFor1Set)||0)*(parseFloat(this.value)||0); r.value=v.toLocaleString('en-IN',{maximumFractionDigits:2}); }"
          ${isFgRow ? `title="Provisional — replaced automatically when this Finished Goods material's own BOQ is authorized" style="padding:5px; font-size:0.85rem; text-align:center; width:100%; border:1.5px solid #f59e0b; background:#fffbeb; border-radius:3px;"` : `style="padding:5px; font-size:0.85rem; text-align:center; width:100%; border:1px solid var(--border); border-radius:3px;"`} />
        ` : `<input type="text" value="—" readonly style="padding:5px; font-size:0.85rem; text-align:center; width:100%; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:3px; border:1px solid var(--border);" />`}
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="text" id="cboq-rate-${idx}" value="${isRawMaterial ? totalMaterialRate.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}" readonly
          style="padding:5px; font-size:0.85rem; font-weight:700; text-align:center; width:100%; background:#f0fdf4; color:var(--accent); cursor:not-allowed; border-radius:3px; border:1px solid #86efac;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <button onclick="deleteCBOQMaterialRow(${idx})" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:3px 8px; border-radius:3px; cursor:pointer; font-size:0.75rem; font-weight:700;">✕</button>
      </td>`;
    tbody.appendChild(tr);

    if (isFgRow) {
      const descTr = document.createElement("tr");
      descTr.style.borderBottom = "1px solid #f1f5f9";
      descTr.innerHTML = `
        <td></td>
        <td colspan="8" style="padding:4px 4px 8px 4px; position:relative;">
          <label style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; display:block; margin-bottom:3px;">Description of Material (optional, for this Finished Goods row)</label>
          <input type="text" id="cboq-row-desc-${idx}" value="${row.descriptionOfMaterial || ""}" placeholder="Type to search or create a description..." autocomplete="off"
            oninput="handleMaterialDescriptionTypeaheadInput(this.value, 'cboq-row-desc-${idx}', 'cboq-row-desc-dropdown-${idx}', 'cboq-row-desc-id-${idx}', 'boqRowDescOnSelect', 'cboq:${idx}'); cboqMaterialRows[${idx}].descriptionOfMaterial=this.value; cboqMaterialRows[${idx}].descriptionId=null;"
            style="padding:6px; font-size:0.82rem; width:60%; border:1px solid var(--border); border-radius:3px;" />
          <div id="cboq-row-desc-dropdown-${idx}" style="display:none; position:absolute; background:#fff; border:1.5px solid var(--brand); border-radius:6px; overflow-y:auto; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.18); min-width:280px;"></div>
          <input type="hidden" id="cboq-row-desc-id-${idx}" value="${row.descriptionId || ""}" />
        </td>`;
      tbody.appendChild(descTr);
    }
  });

  // Auto-size all description textareas to fit existing content on initial render
  tbody.querySelectorAll("textarea").forEach(ta => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  });

  updateCBOQTotals();
}

function updateCBOQTotals() {
  const totalPerSet = cboqMaterialRows.reduce((sum, row) => {
    return sum + ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0));
  }, 0);
  const orderQty = parseInt(document.getElementById("cboq-order-qty")?.value) || 0;
  const totalCost = totalPerSet * orderQty;

  const perSetEl = document.getElementById("cboq-total-per-set");
  const totalEl  = document.getElementById("cboq-total-cost");
  if (perSetEl) perSetEl.textContent = "₹" + totalPerSet.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (totalEl)  totalEl.textContent  = "₹" + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Fixed-position dropdowns (this one and its siblings) compute their
// coordinates once, at open time — scrolling moves the actual input away
// underneath while the dropdown stays frozen at its old screen position.
// Closing on scroll rather than trying to track position live, since
// this dropdown is dismissed by selection/blur anyway in normal use.
// MUST exclude scroll events that originate from inside the dropdown's
// own overflow-y:auto option list — capture:true catches scroll events
// at their real target regardless of bubbling, so scrolling the option
// list itself was firing this handler and closing the dropdown on the
// very interaction it was meant to allow.
if (!window._boqDropdownScrollHandlerInstalled) {
  window._boqDropdownScrollHandlerInstalled = true;
  window.addEventListener('scroll', (e) => {
    if (e.target && e.target.id && e.target.id.includes('-mat-dropdown-')) return;
    document.querySelectorAll('[id*="-mat-dropdown-"]').forEach(dd => {
      if (dd.style.display === 'block') dd.style.display = 'none';
    });
  }, true); // capture:true — catches scrolling on any nested scrollable container, not just the window
}

// Shared typeahead for BOQ material rows
function handleBOQRowMaterialSearch(query, rowIdx, formPrefix) {
  const dropdownId = formPrefix + "-mat-dropdown-" + rowIdx;
  const dropdown   = document.getElementById(dropdownId);
  if (!dropdown) return;

  // Position fixed dropdown under the input, stretching to viewport bottom
  const inputEl   = dropdown.previousElementSibling;
  const inputRect = (inputEl || dropdown.parentElement).getBoundingClientRect();
  const availableHeight = window.innerHeight - inputRect.bottom - 12;
  dropdown.style.left      = inputRect.left + "px";
  dropdown.style.top       = inputRect.bottom + "px";
  dropdown.style.width     = Math.max(inputRect.width, 320) + "px";
  dropdown.style.maxHeight = Math.min(Math.max(availableHeight, 180), 280) + "px";

  const catalog = window.itemCodeCatalogCache || [];
  if (!query || query.trim().length < 1) {
    dropdown.style.display = "none";
    return;
  }

  const q = query.toLowerCase();
  // Matches against the raw name alone (so typing just "Air Core Reactor"
  // still finds it without knowing the rating) OR the combined
  // "name rating" string (so typing "Air Core Reactor 40A" also finds
  // it) — display and select still use the combined name, same
  // convention as every other catalog consumer.
  const matches = catalog.filter(item => {
    const name = (item.productName || "").toLowerCase();
    const combined = (item.combinedName || `${name} ${(item.rating || "").toLowerCase()} ${(item.make || "").toLowerCase()}`).toLowerCase().trim();
    return name.includes(q) || combined.includes(q);
  }).slice(0, 10);

  if (matches.length === 0) {
    dropdown.style.display = "block";
    dropdown.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#b91c1c; font-weight:600;">
      No matching product found. 
      <a href="${window.location.pathname}?module=design-itemcode&q=${encodeURIComponent(query)}" target="_blank" style="color:var(--brand); font-weight:700;">Create Item Code first →</a>
    </div>`;
    return;
  }

  dropdown.innerHTML = matches.map(item => {
    // materialName stored on the row is bare "Name - Rating" (Make deliberately
    // excluded here) — Make lives in its own row.make field, so the BOQ Material
    // column can compose "Name - Rating - Description - Make: X" in the right
    // order at display time instead of Make being baked into the middle of the
    // string. The dropdown suggestion itself still SHOWS combinedName (with
    // Make) so the picker remains unambiguous.
    const bareNameRating = item.productName + (item.rating ? ' - ' + item.rating : '');
    return `
    <div onclick="selectBOQRowMaterial(${rowIdx}, '${bareNameRating.replace(/'/g,"\\'")}', '${item.itemCode}', '${formPrefix}')"
      style="padding:9px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; display:flex; align-items:center; gap:10px; background:#fff; transition:background 0.1s;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:600; color:var(--text); flex:1;">${item.combinedName || item.productName}</span>
      <span style="font-size:0.7rem; color:var(--muted); background:#f1f5f9; padding:2px 6px; border-radius:3px; white-space:nowrap; flex-shrink:0;">${window.typeLabelDisplay_(item.typeOfMaterial)}</span>
    </div>`;
  }).join("");
  dropdown.style.display = "block";
}

// Refresh item code catalog when tab regains focus (e.g. after creating item code in another tab).
// Forced (bypasses the 5-min TTL) since this is a deliberate user action, not a background poll —
// the whole point is to catch an item code created seconds ago in another tab.
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "visible" && window.itemCodeCatalogCache) {
    loadItemCodeCatalogIntoCache(true).catch(() => {});
  }
});
function resetCreateBOQForm() {
  cboqMaterialRows = [];
  renderCBOQMaterialRows();
  ["cboq-project-id-ta-input","cboq-department"].forEach(id => { const el = document.getElementById(id); if(el) el.value = ""; });
  ["cboq-customer-name","cboq-product-name","cboq-product-rating","cboq-prepared-by"].forEach(id => { const el = document.getElementById(id); if(el) el.value = ""; });
  resetCBOQProductSelection();
  const ratingEl = document.getElementById("cboq-product-rating");
  if (ratingEl) ratingEl.style.height = "auto";
  const fbEl = document.getElementById("create-boq-feedback"); if (fbEl) fbEl.style.display = "none";
  const importBanner = document.getElementById("cboq-import-banner"); if (importBanner) importBanner.style.display = "none";
  window.cboqImportSourceInfo = null;
  resetCBOQImportSearch();
  handleCBOQProjectChange(""); // re-lock fields
}

async function submitCreateBOQ() {
  const btn      = document.getElementById("cboq-submit-btn");
  const banner   = document.getElementById("create-boq-feedback");
  const projectId   = document.getElementById("cboq-project-id-ta-input").value.trim();
  const productName = document.getElementById("cboq-product-name").value.trim();
  const productRating=document.getElementById("cboq-product-rating").value.trim();
  const department  = document.getElementById("cboq-department").value.trim();
  const orderQty    = parseInt(document.getElementById("cboq-order-qty").value) || 0;
  const customerName= document.getElementById("cboq-customer-name").value.trim();
  const preparedBy  = appActiveOperatorIdentityString || "";
  const sourcePoLineIdRaw = document.getElementById("cboq-source-po-line-id").value.trim();
  const sourcePoLineId = sourcePoLineIdRaw ? parseInt(sourcePoLineIdRaw) : null;
  const productItemCode = document.getElementById("cboq-product-itemcode").value.trim() || null;
  const descriptionOfMaterial = document.getElementById("cboq-desc-input").value.trim() || null;
  const descriptionIdRaw = document.getElementById("cboq-description-id").value.trim();
  const descriptionId = descriptionIdRaw ? parseInt(descriptionIdRaw) : null;

  if (!projectId)    return showBOQBanner("create-boq-feedback", "⚠️ Project ID is required.", "error");
  if (!productName)  return showBOQBanner("create-boq-feedback", "⚠️ Product Name is required.", "error");
  if (!productRating)return showBOQBanner("create-boq-feedback", "⚠️ Product Rating is required.", "error");
  if (!department)   return showBOQBanner("create-boq-feedback", "⚠️ Department is required.", "error");
  if (orderQty < 1)  return showBOQBanner("create-boq-feedback", "⚠️ Order Quantity must be at least 1.", "error");
  if (cboqMaterialRows.length === 0) return showBOQBanner("create-boq-feedback", "⚠️ Add at least one material row.", "error");

  const invalidRow = cboqMaterialRows.find(r => !r.materialName || !r.quantityFor1Set || !r.unit || !r.designRatePerQuantity);
  if (invalidRow) return showBOQBanner("create-boq-feedback", "⚠️ All material rows must have Material Name, Qty / Set, Unit, and Design Rate / Qty filled in.", "error");

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting...';
  showBlockingOverlay("Saving Bill of Quantity Draft...");

  const totalCostPerSet = cboqMaterialRows.reduce((sum, row) => {
    return sum + ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0));
  }, 0);
  const totalCost = totalCostPerSet * orderQty;

  try {
    const data = await apFetch({
      action: "createBOQDraft",
      projectId, customerName, productName, productRating,
      department, orderQuantity: orderQty,
      materialRowsList: cboqMaterialRows,
      totalCostPerSet, totalCost,
      preparedBy, sourcePoLineId,
      productItemCode, descriptionId, descriptionOfMaterial
    });
    hideBlockingOverlay();

    if (data.success) {
      // Clear all in-progress state right away — Create BOQ deliberately
      // preserves an unfinished draft across navigation (see
      // initializeCreateBOQPanel's isFirstVisit gate), but that same
      // preservation was also keeping a just-SUBMITTED BOQ's data sitting
      // in the form forever (isFirstVisit only ever resets once per
      // session), so leaving without clicking "+ Create New Bill of
      // Quantity" showed the already-submitted BOQ again on return. Reset
      // BEFORE building the success banner below — resetCreateBOQForm()
      // hides #create-boq-feedback, which the banner then re-shows with
      // its own content right after.
      resetCreateBOQForm();
      const fb = document.getElementById("create-boq-feedback");
      if (fb) {
        const formBody = document.getElementById("cboq-form-body");
        if (formBody) formBody.style.display = "none";
        const importSection = document.getElementById("cboq-import-section");
        if (importSection) importSection.style.display = "none";
        fb.style.borderLeftColor = "var(--accent)";
        fb.style.background      = "#f0fff4";
        fb.style.color           = "#276749";
        fb.style.display         = "block";
        fb.innerHTML = `
          <div style="font-size:0.85rem; font-weight:800; margin-bottom:10px;">✅ Bill of Quantity Submitted for Authorization!</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; font-size:0.8rem; margin-bottom:14px;">
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">BOQ ID</span><span style="font-family:monospace; font-weight:800;">${data.boqId}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Project ID</span><span style="font-weight:700;">${projectId}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Customer</span><span style="font-weight:700;">${customerName}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Name</span><span style="font-weight:700;">${productName}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Rating</span><span style="font-weight:700;">${productRating}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Order Quantity (Sets)</span><span style="font-weight:700;">${orderQty}</span></div>
          </div>
          <button onclick="const fb=document.getElementById('cboq-form-body'); if(fb) fb.style.display=''; const is=document.getElementById('cboq-import-section'); if(is) is.style.display=''; resetCreateBOQForm(); initializeCreateBOQPanel().catch(()=>{});"  
            style="background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">
            + Create New Bill of Quantity
          </button>`;
      }
    } else {
      showBOQBanner("create-boq-feedback", data.error || "Submission failed.", "error");
    }
  } catch(e) {
    hideBlockingOverlay();
    showBOQBanner("create-boq-feedback", "Network error: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit BOQ for Authorization";
  }
}

// ═══════════════════════════════════════════════════════
// SHARED BOQ EDIT FORM (used by Authorize + Authorize Update)
// ═══════════════════════════════════════════════════════

let eboqMaterialRows = [];
let eboqCurrentDraft = null;
let eboqMode         = ""; // "authorize" or "authorize-update"
let eboqExpandedCardBoqId = null;

async function toggleAuthBOQCardExpansion(boqId, mode) {
  const safeBoqId = boqId.replace(/[^a-zA-Z0-9]/g, '_');
  const bodyEl = document.getElementById(`auth-boq-card-body-${mode}-${safeBoqId}`);
  if (!bodyEl) return;

  // Collapse if already open
  if (eboqExpandedCardBoqId === boqId) {
    bodyEl.style.display = "none";
    bodyEl.innerHTML = "";
    eboqExpandedCardBoqId = null;
    return;
  }

  // Collapse any other open card first
  if (eboqExpandedCardBoqId) {
    const prevSafeId = eboqExpandedCardBoqId.replace(/[^a-zA-Z0-9]/g, '_');
    const prevBody = document.getElementById(`auth-boq-card-body-${mode}-${prevSafeId}`);
    if (prevBody) { prevBody.style.display = "none"; prevBody.innerHTML = ""; }
  }

  eboqExpandedCardBoqId = boqId;
  eboqMode = mode;
  bodyEl.innerHTML = `<div style="text-align:center; padding:16px; color:var(--muted);">Loading...</div>`;
  bodyEl.style.display = "block";

  const feedbackId = mode === "authorize" ? "auth-boq-feedback" : "auth-boq-upd-feedback";

  try {
    const data = await apFetch({ action:"fetchBOQDraftById", boqId });
    if (!data.success) { bodyEl.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }

    eboqCurrentDraft = data.draft;
    eboqMaterialRows = (data.draft.materialRows || []).map(r => ({ ...r }));

    let summaryHtml = "";
    if (mode === "authorize-update") {
      summaryHtml = `
        <div id="auth-boq-upd-summary-${safeBoqId}" style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:14px; margin-bottom:16px;">
          <div style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:#78350f; margin-bottom:6px;">Change Summary</div>
          <ul id="auth-boq-upd-summary-text-${safeBoqId}" style="margin:0; padding-left:18px; font-size:0.86rem; color:#334155; line-height:1.7;"><li>Generating change summary...</li></ul>
        </div>`;
    }

    bodyEl.innerHTML = summaryHtml + `<div id="eboq-form-mount-${safeBoqId}"></div>`;

    renderEBOQForm(`eboq-form-mount-${safeBoqId}`);

    if (mode === "authorize-update") {
      try {
        const sumData = await apFetch({
          action: "generateBOQUpdateSummary",
          boqId,
          updatedRows: eboqMaterialRows,
          updatedDepartment:  document.getElementById("eboq-department")?.value.trim()  || "",
          updatedOrderQty:    parseInt(document.getElementById("eboq-order-qty")?.value) || 0
        });
        const sumTextEl = document.getElementById(`auth-boq-upd-summary-text-${safeBoqId}`);
        if (sumTextEl) sumTextEl.innerHTML = renderBOQChangeBullets(sumData.changes);
      } catch(e) {
        const sumTextEl = document.getElementById(`auth-boq-upd-summary-text-${safeBoqId}`);
        if (sumTextEl) sumTextEl.innerHTML = "<li>Could not generate summary.</li>";
      }
    }
  } catch(e) {
    bodyEl.innerHTML = `<p style="color:var(--warn);">Error loading BOQ: ${e.message}</p>`;
  }
}

