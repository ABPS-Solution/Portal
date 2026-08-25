function navigateToDesignWorkspacePanel(targetModuleId) {
  window.scrollTo(0, 0);
  setTimeout(() => window.scrollTo(0, 0), 50);
  // 1. Un-nest and minimize homepage structures
  document.getElementById("dashboard-view").style.display = "none";
  
  if (document.getElementById("module-workspace-container")) {
    document.getElementById("module-workspace-container").style.display = "none";
  }
  
  // 2. Force reveal the master parent enclosure block wide
  const masterParentEnclosure = document.getElementById("module-design-workspace-enclosure-panel");
  if (masterParentEnclosure) {
    masterParentEnclosure.style.display = "block";
  } else {
    console.error("Layout Render Error: module-design-workspace-enclosure-panel container not found in DOM.");
    return;
  }
  
  // 3. Isolate child views to prevent element draw overlap anomalies
  const allDesignCanvases = [
    "canvas-module-design-itemcode",
    "canvas-module-design-create-boq",
    "canvas-module-design-auth-boq",
    "canvas-module-design-update-boq",
    "canvas-module-design-auth-boq-upd",
    "canvas-module-design-upload-drawings"
  ];
  allDesignCanvases.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  
  // 4. Wipe operational dropzone feedback notes caches
  const dropzoneUpload = document.getElementById("boq-upload-file-dropzone");
  const dropzoneRevision = document.getElementById("boq-revision-file-dropzone");
  const resultsViewport = document.getElementById("boq-update-search-results-viewport");
  
  if (dropzoneUpload) {
    dropzoneUpload.textContent = "📷 Select or Capture Bill of Quantity Document Page Image";
    dropzoneUpload.classList.remove("done");
  }
  if (dropzoneRevision) {
    dropzoneRevision.textContent = "📷 Select Revised BOQ Document Page Image";
    dropzoneRevision.classList.remove("done");
  }
  if (resultsViewport) {
    resultsViewport.style.display = "none";
  }
  
  targetBOQUploadFileRawObject = null;

  // 5. STRICT ROUTING INTERCEPT SWEEP
  // Fixed mapping triggers to avoid string Processing dropouts or uppercase mismatch locks
  if (targetModuleId === 'design-itemcode') {
    const itemcodeCanvas = document.getElementById("canvas-module-design-itemcode");
    if (itemcodeCanvas) {
      itemcodeCanvas.style.display = "block";
      document.getElementById("itemcode-search-input").value = "";
      document.getElementById("itemcode-search-results-zone").style.display   = "none";
      document.getElementById("itemcode-no-results-zone").style.display       = "none";
      document.getElementById("itemcode-create-form-zone").style.display      = "none";
      document.getElementById("itemcode-feedback-banner").style.display       = "none";
      window.icfSearchSelectedType = "";
      const searchTypeInput = document.getElementById("icf-search-type-ta-input");
      if (searchTypeInput) searchTypeInput.value = "";
      // Admin-only "Add / Change Item Code Format" toggle — server routes
      // independently enforce perm_admin regardless of this, same
      // "localStorage is forgeable, the backend is the real gate" reasoning
      // already established at project/customer-queries.js's admin delete.
      const fmtBtn = document.getElementById("icf-mode-btn-format");
      if (fmtBtn) fmtBtn.style.display = localStorage.getItem("isUserAdminGlobal") === "true" ? "inline-block" : "none";
      switchItemCodeMode('search');
      loadItemCodeTypeConfigIntoCache();
    }
  } else if (targetModuleId === 'design-create-boq') {
    const el = document.getElementById("canvas-module-design-create-boq");
    if (el) { el.style.display = "block"; initializeCreateBOQPanel().catch(e => { if (e.message !== "SESSION_EXPIRED") console.error("BOQ init error:", e); }); }
  } else if (targetModuleId === 'design-auth-boq') {
    const el = document.getElementById("canvas-module-design-auth-boq");
    if (el) { el.style.display = "block"; initializeAuthorizeBOQPanel('authorize').catch(e => { if (e?.message !== "SESSION_EXPIRED") console.error("Auth BOQ init error:", e); }); }
  } else if (targetModuleId === 'design-update-boq') {
    const el = document.getElementById("canvas-module-design-update-boq");
    if (el) { el.style.display = "block"; initializeUpdateBOQPanel().catch(e => { if (e.message !== "SESSION_EXPIRED") console.error("Update BOQ init error:", e); }); }
  } else if (targetModuleId === 'design-auth-boq-upd') {
    const el = document.getElementById("canvas-module-design-auth-boq-upd");
    if (el) { el.style.display = "block"; initializeAuthorizeBOQPanel('authorize-update').catch(e => { if (e?.message !== "SESSION_EXPIRED") console.error("Auth BOQ upd init error:", e); }); }
  } else if (targetModuleId === 'design-upload-drawings') {
    const el = document.getElementById("canvas-module-design-upload-drawings");
    if (el) { el.style.display = "block"; initializeUploadDrawingsPanel(); }
  } else {
    console.warn("Design routing gateway parameter fallback unmapped: ", targetModuleId);
  }
}

function exitProjectStatusBackToMenu() {
  document.getElementById("canvas-module-project-status").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

window.pstatKnownProjectCodes = [];

async function loadItemCodeCatalogIntoCache(forceRefresh = false) {
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  if (
    !forceRefresh &&
    window.itemCodeCatalogCache &&
    window.itemCodeCatalogCache.length > 0 &&
    window._itemCodeCacheLoadedAt &&
    (now - window._itemCodeCacheLoadedAt) < CACHE_TTL_MS
  ) {
    return; // Cache is fresh — skip backend hit
  }
  try {
    const data = await apFetch({ action: "fetchItemCodeCatalog" });
    if (data.success) {
      window.itemCodeCatalogCache = data.catalog;
      window._itemCodeCacheLoadedAt = Date.now();
    } else {
      console.error("ItemCode catalog failed:", data.error);
      window.itemCodeCatalogCache = [];
    }
  } catch(e) {
    console.error("ItemCode catalog load failed:", e);
    window.itemCodeCatalogCache = [];
  }
}

// Stricter than the shared fuzzyPreFilterCatalog (marketing/business-card.js
// — kept loose on purpose for OCR'd business-card matching, where
// looseness helps). This screen's complaint was the opposite: results
// were too broad, because that shared scorer awards points if ANY query
// token loosely overlaps ANY name token (including bare substring-anywhere
// on tokens as short as 2 characters). Here EVERY query token must have a
// real match (exact word, or a word-start match at least 3 characters
// long) for an item to qualify at all — a short/generic word can no
// longer single-handedly surface an unrelated item.
function filterItemCodeCatalogStrict(query, catalog, topN) {
  const queryWords = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  if (queryWords.length === 0) return [];
  const codeQuery = query.toLowerCase().replace(/\s+/g, '');

  const scored = catalog.map(item => {
    const nameNorm = (item.productName || "").toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const nameWords = nameNorm.split(/\s+/).filter(Boolean);
    const codeNorm = (item.itemCode || "").toLowerCase();
    const codeMatch = codeQuery.length >= 3 && codeNorm.includes(codeQuery);

    let score = 0;
    for (const qw of queryWords) {
      let tokenScore = 0;
      for (const nw of nameWords) {
        if (nw === qw) tokenScore = Math.max(tokenScore, 10);
        else if (qw.length >= 3 && (nw.startsWith(qw) || qw.startsWith(nw))) tokenScore = Math.max(tokenScore, 6);
      }
      if (tokenScore === 0) return { item, score: 0, allMatched: false };
      score += tokenScore;
    }
    if (codeMatch) score += 20;
    return { item, score, allMatched: true };
  });

  return scored
    .filter(s => s.allMatched || s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => s.item);
}

async function executeItemCodeSearch() {
  const query = document.getElementById("itemcode-search-input").value.trim();
  const btn   = document.getElementById("itemcode-search-btn");
  const resultsZone  = document.getElementById("itemcode-search-results-zone");
  const noResultsZone= document.getElementById("itemcode-no-results-zone");
  const suggestMount = document.getElementById("itemcode-suggestions-mount");
  const createZone   = document.getElementById("itemcode-create-form-zone");
  const banner       = document.getElementById("itemcode-feedback-banner");

  if (!query) { alert("Please enter a material name to search."); return; }

  // Reset zones
  resultsZone.style.display   = "none";
  noResultsZone.style.display = "none";
  createZone.style.display    = "none";
  banner.style.display        = "none";
  suggestMount.innerHTML      = "";

  // Reset create buttons visibility for fresh search
  const nmBanner = document.getElementById("itemcode-none-match-banner");
  const nrBtn    = document.getElementById("itemcode-no-results-create-btn");
  if (nmBanner) nmBanner.style.display = "block";
  if (nrBtn)    nrBtn.style.display    = "inline";

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Searching...';

  try {
    // Always reload catalog before searching to ensure fresh data
    await loadItemCodeCatalogIntoCache();

    // Optional Type of Material narrowing (search zone's typeahead) — when
    // set, the search runs only within that type instead of the whole
    // catalog, same idea as pointed to in the request ("like search
    // Project ID... this will make the search more specific").
    const allCatalog = window.itemCodeCatalogCache || [];
    const catalogToSearch = window.icfSearchSelectedType
      ? allCatalog.filter(item => item.typeOfMaterial === window.icfSearchSelectedType)
      : allCatalog;
    console.log("Searching catalog of", catalogToSearch.length, "items for query:", query);

    // Direct exact match check first — whole typed phrase as one substring.
    const exactMatch = catalogToSearch.filter(item =>
      (item.productName || "").toLowerCase().includes(query.toLowerCase())
    );
    console.log("Direct includes match:", exactMatch.length, "items");

    // Step 1: strict client-side pre-filter (every query word must really
    // match, not the loose OR-scoring fuzzyPreFilterCatalog does) → top 15.
    const top30 = filterItemCodeCatalogStrict(query, catalogToSearch, 15);
    console.log("Strict pre-filter top15:", top30.length, "items");

    const candidatesToUse = top30.length > 0 ? top30 : exactMatch;

    if (candidatesToUse.length === 0) {
      noResultsZone.style.display = "block";
      return;
    }

    // If catalog is small (≤5 items) or we have very few candidates, skip Gemini
    // and show direct matches with "high" confidence
    let finalMatches;
    if (candidatesToUse.length <= 5) {
      finalMatches = candidatesToUse.map(c => ({
        itemCode:       c.itemCode,
        productName:    c.combinedName || c.productName,
        typeOfMaterial: c.typeOfMaterial,
        confidence:     "high"
      }));
    } else {
      // Step 2: Gemini semantic re-rank for larger catalogs
      const data = await apFetch({
        action: "searchItemCodeSemantic",
        query: query,
        candidates: candidatesToUse
      });

      if (!data.success || !data.matches || data.matches.length === 0) {
        // Gemini failed — fall back to showing direct matches
        finalMatches = candidatesToUse.slice(0, 5).map(c => ({
          itemCode:       c.itemCode,
          productName:    c.combinedName || c.productName,
          typeOfMaterial: c.typeOfMaterial,
          confidence:     "medium"
        }));
      } else {
        // Gemini only ever returns itemCode + confidence now (see backend fix) — map each
        // match back to its exact combinedName + typeOfMaterial from the candidate list this
        // client already built, rather than trusting any AI-echoed text.
        const candidateByCode = {};
        candidatesToUse.forEach(c => { candidateByCode[(c.itemCode || "").toUpperCase()] = c; });
        finalMatches = data.matches
          .map(m => {
            const c = candidateByCode[(m.itemCode || "").toUpperCase()];
            if (!c) return null;
            return {
              itemCode:       c.itemCode,
              productName:    c.combinedName || c.productName,
              typeOfMaterial: c.typeOfMaterial,
              confidence:     m.confidence || "medium"
            };
          })
          .filter(Boolean);
      }
    }

    if (!finalMatches || finalMatches.length === 0) {
      noResultsZone.style.display = "block";
      return;
    }

    // Step 3: Render suggestions
    const catalogUnitLookup = {};
    (window.itemCodeCatalogCache || []).forEach(c => {
      if (c.itemCode) catalogUnitLookup[c.itemCode.toUpperCase()] = c.unit || "";
    });

    const _unitLookup = {};
    (window.itemCodeCatalogCache || []).forEach(c => {
      if (c.itemCode) _unitLookup[c.itemCode.toString().trim().toUpperCase()] = (c.unit || "").toString().trim();
    });

    finalMatches.forEach((match, idx) => {
      const _unit  = _unitLookup[(match.itemCode || "").toString().trim().toUpperCase()] || "";
      const unit   = catalogUnitLookup[(match.itemCode || "").toUpperCase()] || match.unit || "";
      const card   = document.createElement("div");
      card.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#fff; border:1.5px solid var(--border); border-radius:var(--radius); padding:12px 16px; cursor:pointer; transition:all 0.15s ease;";
      card.title = "Click to clone this item code into the Create form — change what's different, then Create to save it as a new item code.";
      card.onmouseover = () => { card.style.borderColor = "var(--brand)"; card.style.background = "var(--highlight-bg)"; };
      card.onmouseout  = () => { card.style.borderColor = "var(--border)";  card.style.background = "#fff"; };
      card.onclick = () => cloneItemCodeIntoCreateForm(match.itemCode);
      card.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.9rem;">${match.itemCode}</span>
          </div>
          <div style="font-size:0.88rem; font-weight:600; color:var(--text); line-height:1.4;">${match.productName}</div>
          <div style="font-size:0.75rem; color:var(--muted); margin-top:2px;">${match.typeOfMaterial}${_unit ? ` &nbsp;·&nbsp; <strong style="color:var(--text);">Unit: ${_unit}</strong>` : ""}</div>
        </div>
        <span style="color:var(--brand); font-size:0.78rem; font-weight:700; flex-shrink:0; margin-left:10px;">Clone →</span>
      `;
      suggestMount.appendChild(card);
    });

    resultsZone.style.display = "block";

  } catch(e) {
    banner.style.cssText = "display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:10px; border-left:4px solid #b91c1c;";
    banner.textContent = "Search failed: " + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Search";
  }
}

async function revealItemCodeCreateForm() {
  const createZone = document.getElementById("itemcode-create-form-zone");
  const codeInput  = document.getElementById("itemcode-new-code");
  const nameInput  = document.getElementById("itemcode-new-name");
  const typeInput  = document.getElementById("icf-new-type-ta-input");
  const banner     = document.getElementById("itemcode-feedback-banner");

  // Hide both "Create New Item Code" trigger buttons
  const noneMatchBanner = document.getElementById("itemcode-none-match-banner");
  const noResultsBtn    = document.getElementById("itemcode-no-results-create-btn");
  if (noneMatchBanner) noneMatchBanner.style.display = "none";
  if (noResultsBtn)    noResultsBtn.style.display    = "none";

  // Pre-fill product name from search query — only meaningful for the
  // Free Form fallback fields; the Fixed Format path builds its own name
  // from the chosen template instead.
  const query = document.getElementById("itemcode-search-input").value.trim();
  nameInput.value  = query;
  typeInput.value  = "";
  typeInput.disabled = false;
  const subSelectReset = document.getElementById("icf-new-suboption-select");
  if (subSelectReset) subSelectReset.disabled = false;
  codeInput.value  = "Loading...";
  banner.style.display = "none";
  document.getElementById("icf-new-fixed-zone").style.display = "none";
  document.getElementById("icf-new-freeform-zone").style.display = "none";
  if (document.getElementById("icf-new-fixed-make")) document.getElementById("icf-new-fixed-make").value = "";
  if (document.getElementById("itemcode-new-make")) document.getElementById("itemcode-new-make").value = "";
  await loadItemCodeTypeConfigIntoCache();

  createZone.style.display = "block";
  createZone.scrollIntoView({ behavior: "smooth", block: "nearest" });

  // Fetch next available code
  try {
    const data = await apFetch({
      action: "getNextItemCode"
    });
    codeInput.value = data.success ? data.nextCode : "Error — refresh";
  } catch(e) {
    codeInput.value = "Error — refresh";
  }
}

async function submitNewItemCode() {
  const btn        = document.getElementById("itemcode-create-submit-btn");
  const banner     = document.getElementById("itemcode-feedback-banner");
  const itemCode   = document.getElementById("itemcode-new-code").value.trim();
  const typeOfMat  = document.getElementById("icf-new-type-ta-input").value.trim();

  if (!typeOfMat) { alert("Type of Material is required."); return; }
  if (!itemCode || itemCode === "Loading..." || itemCode === "Error — refresh") {
    alert("Item Code not loaded yet. Please wait or refresh.");
    return;
  }

  // Which path: the Fixed Format template form, or the manual/Free-Form
  // fields (used directly for Free Form types, or as the admin bypass for
  // a Fixed Format type). The server re-checks this same distinction
  // itself — see createItemCode — this is only what decides the payload
  // shape, not a trust boundary.
  const usingFormat = document.getElementById("icf-new-fixed-zone").style.display !== "none"
    && !document.getElementById("icf-new-admin-manual-checkbox").checked;

  let payload;
  let materialName, rating, unit; // used only for the success banner text below

  // Make is shared across both paths (it's not part of either template) —
  // read from whichever zone is actually visible, uppercase it defensively
  // (the input already forces this as-typed) and block any case of "ABPS"
  // client-side too, so the error surfaces before a round-trip.
  const makeInput = usingFormat ? document.getElementById("icf-new-fixed-make") : document.getElementById("itemcode-new-make");
  const make = (makeInput ? makeInput.value.trim().toUpperCase() : "");
  if (make && make.includes("ABPS")) {
    showBOQBanner("itemcode-feedback-banner", "⚠️ Make cannot be \"ABPS\" — leave Make blank for ABPS-made materials, and only enter another company's name.", "error");
    return;
  }

  if (usingFormat) {
    if (!icfSelectedFormat) { alert("Select a Sub-Option first."); return; }
    const nameValues = icfNameGetValues ? icfNameGetValues() : [];
    const ratingValues = icfRatingGetValues ? icfRatingGetValues() : [];
    const nameErr = icfValidateValues(icfSelectedFormat.materialNameTemplate, nameValues);
    if (nameErr) { showBOQBanner("itemcode-feedback-banner", "⚠️ Material Name: " + nameErr, "error"); return; }
    if (icfSelectedFormat.ratingTemplate) {
      const ratingErr = icfValidateValues(icfSelectedFormat.ratingTemplate, ratingValues);
      if (ratingErr) { showBOQBanner("itemcode-feedback-banner", "⚠️ Rating: " + ratingErr, "error"); return; }
    }
    payload = { formatId: icfSelectedFormat.formatId, materialNameValues: nameValues, ratingValues, make };
    materialName = document.getElementById("icf-new-preview-name").textContent;
    rating = document.getElementById("icf-new-preview-rating").textContent;
    unit = icfSelectedFormat.unit;
  } else {
    materialName = document.getElementById("itemcode-new-name").value.trim();
    rating = document.getElementById("itemcode-new-rating").value.trim();
    unit = document.getElementById("itemcode-new-unit").value.trim();
    if (!materialName) { alert("Material Name is required."); return; }
    if (!unit)         { alert("Unit is required."); return; }
    payload = { materialName, rating, typeOfMaterial: typeOfMat, unit, make };
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Creating...';

  try {
    const data = await apFetch({
      action: "createItemCode",
      ...payload,
      createdBy: appActiveOperatorIdentityString,
      operatorName: appActiveOperatorIdentityString
    });

    if (data.success) {
      // Hide form and search zone
      document.getElementById("itemcode-create-form-zone").style.display  = "none";
      document.getElementById("itemcode-search-results-zone").style.display = "none";
      document.getElementById("itemcode-no-results-zone").style.display    = "none";
      document.getElementById("itemcode-search-zone-wrapper").style.display = "none";

      // Show success banner
      banner.style.cssText = "display:block; background:#dcfce7; border-color:#15803d; color:#15803d; padding:14px; border-left:4px solid #15803d; border-radius:var(--radius);";
      banner.innerHTML = `
        <strong style="font-size:0.95rem;">Item Code Created Successfully!</strong><br/>
        <div style="margin-top:8px; display:flex; gap:16px; flex-wrap:wrap;">
          <span>Code: <strong style="font-family:monospace; font-size:1rem; background:#fff; padding:2px 8px; border-radius:4px; border:1px solid #15803d;">${data.itemCode || itemCode}</strong></span>
          <span>Product: <strong>${materialName}${rating ? " - " + rating : ""}${make ? " - Make: " + make : ""}</strong></span>
          <span>Type: <strong>${window.typeLabelDisplay_(typeOfMat)}</strong></span>
          <span>Unit: <strong>${unit}</strong></span>
        </div>
        <button onclick="
          document.getElementById('itemcode-feedback-banner').style.display='none';
          document.getElementById('itemcode-search-input').value='';
          document.getElementById('itemcode-search-results-zone').style.display='none';
          document.getElementById('itemcode-no-results-zone').style.display='none';
          document.getElementById('itemcode-create-form-zone').style.display='none';
          document.getElementById('itemcode-search-zone-wrapper').style.display='block';
          const nm = document.getElementById('itemcode-none-match-banner'); if(nm) nm.style.display='block';
          const nb = document.getElementById('itemcode-no-results-create-btn'); if(nb) nb.style.display='inline';
        " style="margin-top:10px; background:#15803d; color:#fff; border:none; padding:6px 14px; border-radius:4px; font-weight:700; cursor:pointer; font-size:0.8rem;">
          + Search / Add Another Item
        </button>
      `;

      // Refresh local catalog cache
      await loadItemCodeCatalogIntoCache();

      banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      banner.style.cssText = "display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:12px; border-left:4px solid #b91c1c; border-radius:var(--radius);";
      banner.textContent = "Failed: " + data.error;
    }
  } catch(e) {
    banner.style.cssText = "display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:12px; border-left:4px solid #b91c1c; border-radius:var(--radius);";
    banner.textContent = "Network error: " + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Item Code";
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Template-driven Item Code creation (16 Aug 2026) — see
// ABPS_SYSTEM_OVERVIEW.md §21 and abps-backend/lib/itemCodeFormat.js for
// the template notation. The server is the ONLY authority on what a
// format actually renders to (see createItemCode) — everything below is
// convenience/preview, matching the numberToWordsINRClient precedent.
// ═══════════════════════════════════════════════════════════════════════

async function loadItemCodeTypeConfigIntoCache(forceRefresh = false) {
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const now = Date.now();
  if (!forceRefresh && window.itemCodeTypeConfigCache && window.itemCodeTypeConfigCache.length > 0 &&
      window._itemCodeTypeConfigLoadedAt && (now - window._itemCodeTypeConfigLoadedAt) < CACHE_TTL_MS) {
    return;
  }
  try {
    const data = await apFetch({ action: "fetchItemCodeTypeConfig" });
    if (data.success) {
      window.itemCodeTypeConfigCache = data.types;
      window._itemCodeTypeConfigLoadedAt = Date.now();
    }
  } catch(e) {
    console.error("Item Code type config load failed:", e);
  }
}

function switchItemCodeMode(mode) {
  document.getElementById("icf-mode-search").style.display = mode === 'search' ? "block" : "none";
  document.getElementById("icf-mode-format").style.display = mode === 'format' ? "block" : "none";
  document.getElementById("icf-mode-btn-search").style.background = mode === 'search' ? "var(--brand)" : "#e2e8f0";
  document.getElementById("icf-mode-btn-search").style.color = mode === 'search' ? "#fff" : "#334155";
  document.getElementById("icf-mode-btn-format").style.background = mode === 'format' ? "var(--brand)" : "#e2e8f0";
  document.getElementById("icf-mode-btn-format").style.color = mode === 'format' ? "#fff" : "#334155";
  document.getElementById("itemcode-feedback-banner").style.display = "none";
}

// ── Generic Type of Material typeahead — shared/typeahead.js's project
// typeahead is hardcoded to project data, so this is a sibling following
// the same shape/id convention (-ta-input/-ta-dropdown, load-bearing for
// the global outside-click closer in that same file). Used by three
// inputs: the search-zone filter, the create form's Type of Material, and
// the format editor's Type of Material.
function handleIcfTypeTypeaheadInput(query, inputId, dropdownId) {
  const dd = document.getElementById(dropdownId);
  if (!dd) return;
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const matches = (window.itemCodeTypeConfigCache || [])
    .filter(t => t.typeOfMaterial.toLowerCase().includes(q)).slice(0, 15);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(t => `
    <div onmousedown="event.preventDefault();" onclick="selectIcfTypeTypeahead('${t.typeOfMaterial.replace(/'/g,"\\'")}', '${inputId}', '${dropdownId}')"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;">${t.typeOfMaterial}</span>
      <span style="font-size:0.7rem; color:var(--muted); margin-left:6px;">${t.entryMode}</span>
    </div>`).join("");
  dd.style.display = "block";
}

function selectIcfTypeTypeahead(typeOfMaterial, inputId, dropdownId) {
  const input = document.getElementById(inputId);
  input.value = typeOfMaterial;
  document.getElementById(dropdownId).style.display = "none";
  input.dispatchEvent(new Event('change'));
}

// ── Search zone: optional Type of Material narrowing ───────────────────
function handleIcfSearchTypeChange(typeOfMaterial) {
  window.icfSearchSelectedType = (typeOfMaterial || "").trim();
}

// ── Create New Item Code: progressive flow ──────────────────────────────
let icfCurrentFormats = [];
let icfNameGetValues = null;
let icfRatingGetValues = null;
let icfSelectedFormat = null;

async function handleIcfNewTypeChange(typeOfMaterial) {
  const type = (typeOfMaterial || "").trim();
  const fixedZone = document.getElementById("icf-new-fixed-zone");
  const freeformZone = document.getElementById("icf-new-freeform-zone");
  const fixedForm = document.getElementById("icf-new-fixed-form");
  const subSelect = document.getElementById("icf-new-suboption-select");
  const adminToggleWrap = document.getElementById("icf-new-admin-manual-toggle");
  const adminCheckbox = document.getElementById("icf-new-admin-manual-checkbox");

  icfSelectedFormat = null;
  fixedForm.style.display = "none";
  subSelect.innerHTML = '<option value="">— Select Sub-Option —</option>';
  adminCheckbox.checked = false;

  const cfg = (window.itemCodeTypeConfigCache || []).find(t => t.typeOfMaterial === type);
  if (!type || !cfg) {
    fixedZone.style.display = "none";
    freeformZone.style.display = "none";
    return;
  }

  const isAdmin = localStorage.getItem("isUserAdminGlobal") === "true";
  if (cfg.entryMode === 'Free Form') {
    fixedZone.style.display = "none";
    freeformZone.style.display = "block";
    return;
  }

  // Fixed Format
  freeformZone.style.display = "none";
  fixedZone.style.display = "block";
  adminToggleWrap.style.display = isAdmin ? "block" : "none";

  try {
    const data = await apFetch({ action: "fetchItemCodeFormats", typeOfMaterial: type });
    icfCurrentFormats = data.success ? data.formats : [];
  } catch(e) { icfCurrentFormats = []; }

  subSelect.innerHTML = '<option value="">— Select Sub-Option —</option>' +
    icfCurrentFormats.map(f => `<option value="${f.formatId}">${f.subOption}</option>`).join("");
}

// initialValues (optional) — { materialNameValues, ratingValues }, same
// shape as item_codes.format_values — pre-fills the rendered fields when
// cloning an existing item code (see cloneItemCodeIntoCreateForm).
function handleIcfSubOptionChange(formatIdStr, initialValues) {
  const fixedForm = document.getElementById("icf-new-fixed-form");
  icfSelectedFormat = icfCurrentFormats.find(f => String(f.formatId) === String(formatIdStr)) || null;
  if (!icfSelectedFormat) { fixedForm.style.display = "none"; return; }

  fixedForm.style.display = "block";
  icfNameGetValues = icfRenderFormInputs(
    document.getElementById("icf-new-name-inputs"), icfSelectedFormat.materialNameTemplate, updateIcfNewPreview, "icf-new-name",
    initialValues ? initialValues.materialNameValues : undefined
  );
  const ratingContainer = document.getElementById("icf-new-rating-inputs");
  if (icfSelectedFormat.ratingTemplate && icfSelectedFormat.ratingTemplate.trim()) {
    icfRatingGetValues = icfRenderFormInputs(ratingContainer, icfSelectedFormat.ratingTemplate, updateIcfNewPreview, "icf-new-rating",
      initialValues ? initialValues.ratingValues : undefined);
  } else {
    ratingContainer.innerHTML = '<span style="color:var(--muted); font-size:0.82rem;">— No Rating for this Sub-Option —</span>';
    icfRatingGetValues = () => [];
  }
  document.getElementById("icf-new-preview-unit").textContent = icfSelectedFormat.unit;
  updateIcfNewPreview();
}

// cloneItemCodeIntoCreateForm — "Did you mean one of these?" search result
// cards are clickable: pre-fills the Create form from an existing item
// code so the user can tweak one or two things and Create a NEW item
// code, instead of retyping everything from scratch. For a Fixed Format
// type, Type of Material and Sub-Option are locked (only the format's
// own value fields + Make stay editable) — the user explicitly asked
// that nothing outside the fixed format be changeable in that case. For
// Free Form, every field stays editable, just pre-filled. Either way this
// always creates a NEW row; the existing item code is never modified —
// the server's Name+Rating+Make duplicate check is what stops a no-op
// "clone" from creating an actual duplicate.
async function cloneItemCodeIntoCreateForm(itemCode) {
  const item = (window.itemCodeCatalogCache || []).find(c => c.itemCode === itemCode);
  if (!item) { alert("Could not find that item code's details — try refreshing the search."); return; }

  await revealItemCodeCreateForm();

  const typeInput = document.getElementById("icf-new-type-ta-input");
  const subSelect = document.getElementById("icf-new-suboption-select");
  typeInput.value = item.typeOfMaterial || "";
  await handleIcfNewTypeChange(item.typeOfMaterial || "");

  if (item.formatId) {
    // format_values is a JSONB column — the pg driver already hands it
    // back as a parsed object, not a JSON string; no JSON.parse here.
    const initialValues = item.formatValues || null;
    subSelect.value = item.formatId;
    handleIcfSubOptionChange(String(item.formatId), initialValues);
    if (document.getElementById("icf-new-fixed-make")) document.getElementById("icf-new-fixed-make").value = item.make || "";
    typeInput.disabled = true;
    subSelect.disabled = true;
  } else {
    if (document.getElementById("itemcode-new-name"))  document.getElementById("itemcode-new-name").value  = item.productName || "";
    if (document.getElementById("itemcode-new-rating")) document.getElementById("itemcode-new-rating").value = item.rating || "";
    if (document.getElementById("itemcode-new-unit"))  document.getElementById("itemcode-new-unit").value  = item.unit || "";
    if (document.getElementById("itemcode-new-make"))  document.getElementById("itemcode-new-make").value  = item.make || "";
  }

  const banner = document.getElementById("itemcode-feedback-banner");
  banner.style.cssText = "display:block; background:#eff6ff; border-color:var(--brand); color:var(--brand); padding:10px; border-left:4px solid var(--brand); border-radius:var(--radius); font-size:0.85rem;";
  banner.textContent = `Cloned from ${itemCode}${item.formatId ? " — Type of Material and Sub-Option are locked to match its fixed format" : ""}. Change what's different, then Create to save as a new item code.`;
}

function updateIcfNewPreview() {
  if (!icfSelectedFormat) return;
  const nameEl = document.getElementById("icf-new-preview-name");
  const ratingEl = document.getElementById("icf-new-preview-rating");
  try {
    nameEl.textContent = icfRenderTemplate(icfSelectedFormat.materialNameTemplate, icfNameGetValues ? icfNameGetValues() : []) || "—";
  } catch(e) { nameEl.textContent = "—"; }
  try {
    ratingEl.textContent = icfSelectedFormat.ratingTemplate
      ? (icfRenderTemplate(icfSelectedFormat.ratingTemplate, icfRatingGetValues ? icfRatingGetValues() : []) || "—")
      : "—";
  } catch(e) { ratingEl.textContent = "—"; }
}

// Admin-only backup: bypass the format entirely for this Fixed Format
// type, falling back to the same free-text fields Free Form types use.
function handleIcfAdminManualToggle(checked) {
  document.getElementById("icf-new-fixed-form").style.display = checked ? "none" : "block";
  document.getElementById("icf-new-suboption-select").disabled = checked;
  document.getElementById("icf-new-freeform-zone").style.display = checked ? "block" : "none";
}

// ── Admin: Add / Change Item Code Format ────────────────────────────────
let icfFmtCurrentType = "";

async function handleIcfFormatTypeChange(typeOfMaterial) {
  const type = (typeOfMaterial || "").trim();
  icfFmtCurrentType = type;
  const listZone = document.getElementById("icf-fmt-list-zone");
  const entryModeSelect = document.getElementById("icf-fmt-entry-mode");
  closeIcfFormatEditor();
  if (!type) { listZone.style.display = "none"; return; }

  const cfg = (window.itemCodeTypeConfigCache || []).find(t => t.typeOfMaterial === type);
  entryModeSelect.value = cfg ? cfg.entryMode : 'Fixed Format';

  listZone.style.display = "block";
  const listEl = document.getElementById("icf-fmt-formats-list");
  listEl.innerHTML = '<div style="color:var(--muted); font-size:0.85rem;">Loading...</div>';
  try {
    const data = await apFetch({ action: "fetchItemCodeFormats", typeOfMaterial: type });
    icfCurrentFormats = data.success ? data.formats : [];
  } catch(e) { icfCurrentFormats = []; }

  if (icfCurrentFormats.length === 0) {
    listEl.innerHTML = '<div style="color:var(--muted); font-size:0.85rem;">No formats yet for this Type of Material.</div>';
    return;
  }
  listEl.innerHTML = icfCurrentFormats.map(f => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:12px 16px;">
      <div>
        <div style="font-weight:700; color:var(--brand);">${f.subOption}</div>
        <div style="font-size:0.78rem; color:var(--muted); font-family:monospace; margin-top:2px;">${f.materialNameTemplate}</div>
        ${f.ratingTemplate ? `<div style="font-size:0.78rem; color:var(--muted); font-family:monospace;">${f.ratingTemplate}</div>` : ''}
        <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Unit: <strong>${f.unit}</strong></div>
      </div>
      <button onclick="editIcfFormat(${f.formatId})" style="background:var(--brand); color:#fff; border:none; padding:6px 14px; border-radius:4px; font-weight:700; cursor:pointer; font-size:0.8rem;">Edit</button>
    </div>`).join("");
}

async function handleIcfEntryModeChange(newMode) {
  if (!icfFmtCurrentType) return;
  try {
    await apFetch({ action: "saveItemCodeTypeConfig", typeOfMaterial: icfFmtCurrentType, entryMode: newMode, operatorName: appActiveOperatorIdentityString });
    await loadItemCodeTypeConfigIntoCache(true);
  } catch(e) {
    showBOQBanner("itemcode-feedback-banner", "⚠️ Failed to update entry mode: " + e.message, "error");
  }
}

function openIcfAddFormatEditor() {
  document.getElementById("icf-fmt-editor-formatid").value = "";
  document.getElementById("icf-fmt-editor-suboption").value = "";
  document.getElementById("icf-fmt-editor-name-template").value = "";
  document.getElementById("icf-fmt-editor-rating-template").value = "";
  document.getElementById("icf-fmt-editor-unit").value = "";
  document.getElementById("icf-fmt-editor-deactivate-btn").style.display = "none";
  document.getElementById("icf-fmt-editor-name-error").textContent = "";
  document.getElementById("icf-fmt-editor-rating-error").textContent = "";
  document.getElementById("icf-fmt-editor-zone").style.display = "block";
  renderIcfFormatEditorPreview();
  document.getElementById("icf-fmt-editor-zone").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function editIcfFormat(formatId) {
  const f = icfCurrentFormats.find(x => x.formatId === formatId);
  if (!f) return;
  document.getElementById("icf-fmt-editor-formatid").value = f.formatId;
  document.getElementById("icf-fmt-editor-suboption").value = f.subOption;
  document.getElementById("icf-fmt-editor-name-template").value = f.materialNameTemplate;
  document.getElementById("icf-fmt-editor-rating-template").value = f.ratingTemplate || "";
  document.getElementById("icf-fmt-editor-unit").value = f.unit;
  document.getElementById("icf-fmt-editor-deactivate-btn").style.display = "inline-block";
  document.getElementById("icf-fmt-editor-name-error").textContent = "";
  document.getElementById("icf-fmt-editor-rating-error").textContent = "";
  document.getElementById("icf-fmt-editor-zone").style.display = "block";
  renderIcfFormatEditorPreview();
  document.getElementById("icf-fmt-editor-zone").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeIcfFormatEditor() {
  document.getElementById("icf-fmt-editor-zone").style.display = "none";
}

// Admin's live preview — same parser as the operator's create form, just
// rendered with a no-op onChange since nothing here needs to be submitted.
function renderIcfFormatEditorPreview() {
  const nameTemplate = document.getElementById("icf-fmt-editor-name-template").value;
  const ratingTemplate = document.getElementById("icf-fmt-editor-rating-template").value;
  const nameErrEl = document.getElementById("icf-fmt-editor-name-error");
  const ratingErrEl = document.getElementById("icf-fmt-editor-rating-error");
  const namePreview = document.getElementById("icf-fmt-editor-name-preview");
  const ratingPreview = document.getElementById("icf-fmt-editor-rating-preview");

  const nameParsed = icfParseTemplate(nameTemplate);
  nameErrEl.textContent = nameParsed.error || "";
  icfRenderFormInputs(namePreview, nameTemplate, () => {}, "icf-fmt-editor-name-preview-ph");

  if (ratingTemplate.trim()) {
    const ratingParsed = icfParseTemplate(ratingTemplate);
    ratingErrEl.textContent = ratingParsed.error || "";
    icfRenderFormInputs(ratingPreview, ratingTemplate, () => {}, "icf-fmt-editor-rating-preview-ph");
  } else {
    ratingErrEl.textContent = "";
    ratingPreview.innerHTML = '<span style="color:var(--muted); font-size:0.82rem;">— No Rating —</span>';
  }
}

async function submitIcfSaveFormat() {
  const formatId = document.getElementById("icf-fmt-editor-formatid").value.trim();
  const subOption = document.getElementById("icf-fmt-editor-suboption").value.trim();
  const nameTemplate = document.getElementById("icf-fmt-editor-name-template").value.trim();
  const ratingTemplate = document.getElementById("icf-fmt-editor-rating-template").value.trim();
  const unit = document.getElementById("icf-fmt-editor-unit").value.trim();

  if (!subOption) return showBOQBanner("itemcode-feedback-banner", "⚠️ Sub-Option is required.", "error");
  if (!nameTemplate) return showBOQBanner("itemcode-feedback-banner", "⚠️ Material Name Template is required.", "error");
  if (!unit) return showBOQBanner("itemcode-feedback-banner", "⚠️ Unit is required.", "error");

  try {
    const data = await apFetch({
      action: "saveItemCodeFormat", formatId: formatId || null, typeOfMaterial: icfFmtCurrentType,
      subOption, materialNameTemplate: nameTemplate, ratingTemplate: ratingTemplate || null, unit,
      operatorName: appActiveOperatorIdentityString
    });
    if (!data.success) return showBOQBanner("itemcode-feedback-banner", "⚠️ " + data.error, "error");
    showBOQBanner("itemcode-feedback-banner", `✅ Format "${subOption}" saved.`, "success");
    closeIcfFormatEditor();
    handleIcfFormatTypeChange(icfFmtCurrentType);
  } catch(e) {
    showBOQBanner("itemcode-feedback-banner", "⚠️ Network error: " + e.message, "error");
  }
}

async function submitIcfDeactivateFormat() {
  const formatId = document.getElementById("icf-fmt-editor-formatid").value.trim();
  if (!formatId) return;
  if (!confirm("Deactivate this Item Code format? Existing item codes already created from it are unaffected.")) return;
  try {
    const data = await apFetch({ action: "deactivateItemCodeFormat", formatId, operatorName: appActiveOperatorIdentityString });
    if (!data.success) return showBOQBanner("itemcode-feedback-banner", "⚠️ " + data.error, "error");
    showBOQBanner("itemcode-feedback-banner", "✅ Format deactivated.", "success");
    closeIcfFormatEditor();
    handleIcfFormatTypeChange(icfFmtCurrentType);
  } catch(e) {
    showBOQBanner("itemcode-feedback-banner", "⚠️ Network error: " + e.message, "error");
  }
}

function reopenSEMaterialSearch(gateNum, idx) {
  const nameDisplay = document.querySelector(`.se-mat-name-display-${gateNum}[data-idx="${idx}"]`);
  const searchInput = document.getElementById(`se-search-${gateNum}-${idx}`);
  if (nameDisplay) nameDisplay.style.display = "none";
  if (searchInput) {
    searchInput.style.display = "block";
    searchInput.value = "";
    searchInput.focus();
  }
  // Note: the previously-selected Item Code / Material Name / Type values are left in place
  // (in the hidden inputs) until a new match is actually picked from the dropdown — so if the
  // person clicks "change" and then clicks away without selecting anything, the original
  // selection is still submitted rather than silently becoming blank.
}

function handleSENameSearch(inputEl, gateNum, idx) {
  const query   = inputEl.value.trim().toLowerCase();
  const dropId  = `se-drop-${gateNum}-${idx}`;
  const dropdown = document.getElementById(dropId);
  const catalog  = window.itemCodeCatalogCache || [];
  if (!dropdown) return;

  const rect = inputEl.getBoundingClientRect();
  dropdown.style.top   = (rect.bottom + 2) + "px";
  dropdown.style.left  = rect.left + "px";
  dropdown.style.width = rect.width + "px";

  if (query.length < 2) { dropdown.style.display = "none"; return; }
  // Search matches the raw name (findable without knowing the rating), display/select the
  // combined name — same convention as BOQ search and every other catalog consumer.
  const matches = catalog.filter(c => (c.productName || "").toLowerCase().includes(query)).slice(0, 10);
  if (matches.length === 0) {
    const createUrl = window.location.pathname + "?module=design-itemcode";
    dropdown.innerHTML = `<div style="padding:8px 10px; font-size:0.78rem; color:var(--muted); display:flex; justify-content:space-between; align-items:center;">
      <span>No match found</span>
      <a href="${createUrl}" target="_blank" style="color:var(--brand); font-weight:700; font-size:0.75rem;">+ Create Item Code →</a>
    </div>`;
    dropdown.style.display = "block"; return;
  }
  dropdown.innerHTML = matches.map(c => `
    <div onclick="selectSENameMatch('${gateNum}', ${idx}, '${c.itemCode}', '${(c.combinedName || c.productName).replace(/'/g,"\\'")}', '${c.typeOfMaterial || ""}', '${c.unit || ""}')"
      style="padding:7px 10px; cursor:pointer; font-size:0.78rem; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:600;">${c.combinedName || c.productName}</span>
      <span style="font-size:0.7rem; color:var(--muted); background:#f1f5f9; padding:2px 6px; border-radius:3px;">${c.itemCode}</span>
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectSENameMatch(gateNum, idx, itemCode, productName, typeOfMaterial, unit) {
  const dropdown    = document.getElementById(`se-drop-${gateNum}-${idx}`);
  const searchInput = document.getElementById(`se-search-${gateNum}-${idx}`);
  selectStoreEntryItemCodeMatch(gateNum, idx, itemCode, productName, typeOfMaterial, null, unit);
  if (searchInput) searchInput.style.display = "none";
  if (dropdown)    dropdown.style.display = "none";
}

// Close SE dropdowns on outside click
document.addEventListener("click", function(e) {
  if (!e.target.id || !e.target.id.startsWith("se-search-")) {
    document.querySelectorAll("[id^='se-drop-']").forEach(d => d.style.display = "none");
  }
});

function selectStoreEntryItemCodeMatch(gateNum, idx, itemCode, productName, typeOfMaterial, clickedEl, unit) {
  const codeInput   = document.querySelector(`.se-item-code-${gateNum}[data-idx="${idx}"]`);
  const nameInput   = document.querySelector(`.se-mat-name-${gateNum}[data-idx="${idx}"]`);
  const typeInput   = document.querySelector(`.se-material-type-${gateNum}[data-idx="${idx}"]`);
  const unitInput   = document.querySelector(`.se-item-code-unit-${gateNum}[data-idx="${idx}"]`);
  const nameDisplay = document.querySelector(`.se-mat-name-display-${gateNum}[data-idx="${idx}"]`);
  const typeDisplay = document.querySelector(`.se-material-type-display-${gateNum}[data-idx="${idx}"]`);
  const searchInput = document.getElementById(`se-search-${gateNum}-${idx}`);
  const dropdown    = document.getElementById(`se-drop-${gateNum}-${idx}`);
  if (searchInput) searchInput.style.display = "none";
  if (dropdown)    dropdown.style.display    = "none";

  if (codeInput) {
    codeInput.value = itemCode;
    codeInput.placeholder = "";
    codeInput.style.border = "1.5px solid #86efac";
    codeInput.style.background = "#f0fdf4";
    codeInput.style.color = "var(--brand)";
  }
  if (nameInput) nameInput.value = productName;
  if (typeInput) typeInput.value = typeOfMaterial;
  if (unitInput) unitInput.value = unit || "NOS";
  // Item Code Unit just (re)resolved -- re-evaluate whether the Unit
  // Converter should lock to 1 (units now match) or open up for manual
  // entry (they don't), same trigger as editing Invoice Unit directly.
  if (typeof updateSEUnitConverterLock === "function") updateSEUnitConverterLock(gateNum, idx);
  // Item code just changed — whatever PO was picked for this row was
  // keyed to the OLD item code, so it's no longer meaningful.
  if (typeof resetSEPOSelectionsForRow === "function") resetSEPOSelectionsForRow(gateNum, idx);
  // Item code resolved via the material search (not from Gate Entry), so
  // the initial queue-load PO-options batch never covered it — fetch it
  // now, lazily, if not already cached.
  if (itemCode && window._sePoOptionsCache && !window._sePoOptionsCache[itemCode]) {
    apFetch({ action: "fetchStoreEntryPOOptions", itemCodes: [itemCode] })
      .then(d => { if (d.success) Object.assign(window._sePoOptionsCache, d.optionsByItemCode || {}); })
      .catch(e => console.error("fetchStoreEntryPOOptions (lazy) failed:", e));
  }

  if (nameDisplay) {
    nameDisplay.style.display = "block";
    nameDisplay.textContent = productName;
  }
  if (typeDisplay) {
    typeDisplay.textContent = typeOfMaterial;
    typeDisplay.style.color = "var(--accent)";
  }

  // Dim all pills in this row, highlight selected
  if (clickedEl) {
    const parent = clickedEl.closest("td");
    if (parent) {
      parent.querySelectorAll("div[onclick]").forEach(pill => {
        pill.style.opacity = "0.4";
        pill.style.border  = "1.5px solid #e2e8f0";
        pill.style.background = "#f8fafc";
      });
    }
    clickedEl.style.opacity   = "1";
    clickedEl.style.border    = "2px solid var(--accent)";
    clickedEl.style.background = "#f0fdf4";
  }
}

// ═══════════════════════════════════════════════════════
// CREATE BOQ
// ═══════════════════════════════════════════════════════

