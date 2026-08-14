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

    const catalogToSearch = window.itemCodeCatalogCache || [];
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
      card.onmouseover = () => { card.style.borderColor = "var(--brand)"; card.style.background = "var(--highlight-bg)"; };
      card.onmouseout  = () => { card.style.borderColor = "var(--border)";  card.style.background = "#fff"; };
      card.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.9rem;">${match.itemCode}</span>
          </div>
          <div style="font-size:0.88rem; font-weight:600; color:var(--text); line-height:1.4;">${match.productName}</div>
          <div style="font-size:0.75rem; color:var(--muted); margin-top:2px;">${match.typeOfMaterial}${_unit ? ` &nbsp;·&nbsp; <strong style="color:var(--text);">Unit: ${_unit}</strong>` : ""}</div>
        </div>
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
  const typeSelect = document.getElementById("itemcode-new-type");
  const banner     = document.getElementById("itemcode-feedback-banner");

  // Hide both "Create New Item Code" trigger buttons
  const noneMatchBanner = document.getElementById("itemcode-none-match-banner");
  const noResultsBtn    = document.getElementById("itemcode-no-results-create-btn");
  if (noneMatchBanner) noneMatchBanner.style.display = "none";
  if (noResultsBtn)    noResultsBtn.style.display    = "none";

  // Pre-fill product name from search query
  const query = document.getElementById("itemcode-search-input").value.trim();
  nameInput.value  = query;
  typeSelect.value = "";
  codeInput.value  = "Loading...";
  banner.style.display = "none";

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
  const materialName= document.getElementById("itemcode-new-name").value.trim();
  const rating     = document.getElementById("itemcode-new-rating").value.trim();
  const typeOfMat  = document.getElementById("itemcode-new-type").value.trim();
  const unit       = document.getElementById("itemcode-new-unit").value.trim();

  if (!materialName) { alert("Material Name is required."); return; }
  if (!typeOfMat)    { alert("Type of Material is required."); return; }
  if (!unit)         { alert("Unit is required."); return; }
  if (!itemCode || itemCode === "Loading..." || itemCode === "Error — refresh") {
    alert("Item Code not loaded yet. Please wait or refresh.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Creating...';

  try {
    const data = await apFetch({
      action: "createItemCode",
      itemCode,
      materialName,
      rating,
      typeOfMaterial: typeOfMat,
      unit,
      createdBy: appActiveOperatorIdentityString
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
          <span>Product: <strong>${materialName}${rating ? " " + rating : ""}</strong></span>
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
    <div onclick="selectSENameMatch('${gateNum}', ${idx}, '${c.itemCode}', '${(c.combinedName || c.productName).replace(/'/g,"\\'")}', '${c.typeOfMaterial || ""}')"
      style="padding:7px 10px; cursor:pointer; font-size:0.78rem; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:600;">${c.combinedName || c.productName}</span>
      <span style="font-size:0.7rem; color:var(--muted); background:#f1f5f9; padding:2px 6px; border-radius:3px;">${c.itemCode}</span>
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectSENameMatch(gateNum, idx, itemCode, productName, typeOfMaterial) {
  const dropdown    = document.getElementById(`se-drop-${gateNum}-${idx}`);
  const searchInput = document.getElementById(`se-search-${gateNum}-${idx}`);
  selectStoreEntryItemCodeMatch(gateNum, idx, itemCode, productName, typeOfMaterial, null);
  if (searchInput) searchInput.style.display = "none";
  if (dropdown)    dropdown.style.display = "none";
}

// Close SE dropdowns on outside click
document.addEventListener("click", function(e) {
  if (!e.target.id || !e.target.id.startsWith("se-search-")) {
    document.querySelectorAll("[id^='se-drop-']").forEach(d => d.style.display = "none");
  }
});

function selectStoreEntryItemCodeMatch(gateNum, idx, itemCode, productName, typeOfMaterial, clickedEl) {
  const codeInput   = document.querySelector(`.se-item-code-${gateNum}[data-idx="${idx}"]`);
  const nameInput   = document.querySelector(`.se-mat-name-${gateNum}[data-idx="${idx}"]`);
  const typeInput   = document.querySelector(`.se-material-type-${gateNum}[data-idx="${idx}"]`);
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

