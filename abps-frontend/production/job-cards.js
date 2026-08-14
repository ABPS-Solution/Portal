let jobCardBOQGroups = [];
let jobCardExisting = {};

async function updateSelectedLiveStockPillCounter(liveStockOverride) {
  const selectedMaterial = document.getElementById("ticket-item-selection-dropdown").value;
  const projectId = document.getElementById("ticket-project-id-dropdown-ta-input").value;
  const counterZone = document.getElementById("ticket-live-counter-pill-zone");
  
  if (!selectedMaterial || !projectId) {
    counterZone.innerHTML = ""; return;
  }

  // Show an immediate loading state the instant a material is picked, regardless of cache
  // state below — closes the visible gap between selecting a material and the pill actually
  // rendering, even on a cache hit where the "Evaluating..." message further down never fires.
  counterZone.innerHTML = `<span style="font-size:0.75rem; color:var(--muted); font-weight:600;">🔄 Loading stock &amp; allotment…</span>`;

  const activeStoreScope = document.getElementById("ticket-selected-store-scope-toggle")?.value || "Raw Materials Store";

  // --- FINISHED GOODS STORE: show FG item details ---
  if (activeStoreScope === "Finished Goods Store") {
    const jobCardNumberValForPillFG = document.getElementById("ticket-job-card-dropdown")?.value || "";
    const jcmCacheKeyForPillFG = jobCardNumberValForPillFG + "|" + projectId;

    if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPillFG) {
      counterZone.innerHTML = `<span style="font-size:0.75rem; color:var(--brand); font-weight:700;">🔄 Evaluating Real-Time Job Card Allocations...</span>`;
    }

    try {
      if (!jobCardNumberValForPillFG) {
        counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Select a Job Card Number first.</span>`;
        return;
      }

      if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPillFG) {
        const jcmFetchFGPill = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValForPillFG, projectId: projectId });
        window._ticketJobCardMaterialsCache = { key: jcmCacheKeyForPillFG, records: jcmFetchFGPill.records || [] };
      }
      let jcmCacheDataFG = window._ticketJobCardMaterialsCache;

      const cleanSearchKeyFG = selectedMaterial.replace(/\s*\(\d+\s+\w+\s+available\)/i, "").trim().replace(/\s+/g, '').toLowerCase();

      function findJcmMatchForPillFG_(recs) {
        const scopedFG = (recs || []).filter(r => r.typeOfStore === "Finished Goods Store");
        return scopedFG.find(r => (r.materialName || "").replace(/\s+/g, '').toLowerCase() === cleanSearchKeyFG)
          || scopedFG.find(r => (r.materialName || "").replace(/\s+/g, '').toLowerCase().includes(cleanSearchKeyFG.substring(0, 20)))
          || scopedFG.find(r => cleanSearchKeyFG.includes((r.materialName || "").replace(/\s+/g, '').toLowerCase().substring(0, 20)));
      }

      let jcmMatchFG = findJcmMatchForPillFG_(jcmCacheDataFG.records);

      if (!jcmMatchFG) {
        try {
          const freshJcmDataFG = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValForPillFG, projectId: projectId });
          window._ticketJobCardMaterialsCache = { key: jcmCacheKeyForPillFG, records: freshJcmDataFG.records || [] };
          jcmCacheDataFG = window._ticketJobCardMaterialsCache;
          jcmMatchFG = findJcmMatchForPillFG_(jcmCacheDataFG.records);
        } catch(refreshErrFG) {
          console.error("JobCardMaterials cache self-heal refetch failed (FG):", refreshErrFG);
        }
      }

      if (!jcmMatchFG) {
        counterZone.innerHTML = `
          <div style="margin:8px 0 4px; font-size:0.88rem; font-weight:700; color:var(--text);">
            <span style="font-size:0.75rem; color:var(--warn);">⚠️ No allotment for this Job Card</span>
          </div>`;
        return;
      }

      // Physical "In Stock" count comes ONLY from liveStockOverride (getLiveStockForItem, a
      // fresh sheet read fired every time a material is selected) — no client-side cache. On the
      // fast first pass (liveStockOverride is null, JCM allotment still renders immediately) the
      // count shows a loading placeholder until the live fetch resolves and re-renders this pill.
      const unitTokenFG = jcmMatchFG.unitType || "NOS";
      const hasLiveFGCount = !!liveStockOverride;
      const inStockCount = hasLiveFGCount ? (liveStockOverride.fgInStockCount || 0) : 0;
      let styleClassFG = !hasLiveFGCount ? "" : (inStockCount === 0 ? "pill-stock-empty" : inStockCount <= 2 ? "pill-stock-low" : "pill-stock-healthy");
      const countDisplay = hasLiveFGCount
        ? `<span class="live-counter-pill ${styleClassFG}" style="font-size:1rem; padding:3px 8px; margin-left:4px;">${fmtQty(inStockCount)} ${unitTokenFG}</span>`
        : `<span style="font-size:0.78rem; color:var(--muted); margin-left:4px;">🔄 checking live stock…</span>`;

      counterZone.innerHTML = `
        <div style="margin:12px 0 4px; font-size:0.88rem; font-weight:700; color:var(--text); text-align:left; line-height:1.6;">
          <div>
            Finished Goods Store Total Stock Count:
            ${countDisplay}
          </div>
          <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
            <span style="font-size:0.86rem; font-weight:700; background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:4px;">ALLOTTED (THIS JOB CARD): ${fmtQty(jcmMatchFG.allottedQty)} ${unitTokenFG}</span>
            <span style="font-size:0.86rem; font-weight:700; background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:4px;">USED: ${fmtQty(jcmMatchFG.usedQty)} ${unitTokenFG}</span>
            <span style="font-size:0.86rem; font-weight:700; background:#dcfce7; color:#166534; padding:3px 8px; border-radius:4px;">REMAINING: ${fmtQty(jcmMatchFG.remainingQty)} ${unitTokenFG}</span>
          </div>
        </div>
      `;
    } catch(errFG) {
      console.error("FG pill allocation tracking crash:", errFG);
      counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Could not load FG stock/allotment.</span>`;
    }
    return;
  }

  // --- SPARE STORE: show live spare stock count + JobCardMaterials allocation ---
  // Same allotment source and logic as Raw Materials Store below — Raw and Spare draws share
  // one unified JobCardMaterials row per Job Card + material. Only the physical stock count
  // itself differs (SpareInventory here, MasterInventory for Raw).
  if (activeStoreScope === "Spare Store") {
    const jobCardNumberValForPillSpare = document.getElementById("ticket-job-card-dropdown")?.value || "";
    const jcmCacheKeyForPillSpare = jobCardNumberValForPillSpare + "|" + projectId;

    if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPillSpare) {
      counterZone.innerHTML = `<span style="font-size:0.75rem; color:var(--brand); font-weight:700;">🔄 Evaluating Real-Time Job Card Allocations...</span>`;
    }

    try {
      if (!jobCardNumberValForPillSpare) {
        counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Select a Job Card Number first.</span>`;
        return;
      }

      if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPillSpare) {
        const jcmFetchS = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValForPillSpare, projectId: projectId });
        window._ticketJobCardMaterialsCache = { key: jcmCacheKeyForPillSpare, records: jcmFetchS.records || [] };
      }
      let jcmCacheDataSpare = window._ticketJobCardMaterialsCache;

      const cleanSearchKeySpare = selectedMaterial.replace(/\s*\(\d+\s+\w+\s+available\)/i, "").trim().replace(/\s+/g, '').toLowerCase();

      let spareInventoryMatch;
      if (liveStockOverride) {
        spareInventoryMatch = { availableStock: liveStockOverride.spareStock, reservedStock: liveStockOverride.spareReservedStock, unitType: liveStockOverride.unitType };
      } else {
        const _spare = window.cachedSpareStoreStock || [];
        spareInventoryMatch = _spare.find(i => (i.materialName || "").replace(/\s+/g, '').toLowerCase() === cleanSearchKeySpare)
          || _spare.find(i => (i.materialName || "").replace(/\s+/g, '').toLowerCase().includes(cleanSearchKeySpare.substring(0, 20)))
          || _spare.find(i => cleanSearchKeySpare.includes((i.materialName || "").replace(/\s+/g, '').toLowerCase().substring(0, 20)));
      }

      function findJcmMatchForPillSpare_(recs) {
        const scopedSpare = (recs || []).filter(r => r.typeOfStore === "Spare Store");
        return scopedSpare.find(r => (r.itemCode || "").replace(/\s+/g, '').toLowerCase() === (spareInventoryMatch?.itemCode || "").replace(/\s+/g, '').toLowerCase() && spareInventoryMatch?.itemCode)
          || scopedSpare.find(r => (r.materialName || "").replace(/\s+/g, '').toLowerCase() === cleanSearchKeySpare)
          || scopedSpare.find(r => (r.materialName || "").replace(/\s+/g, '').toLowerCase().includes(cleanSearchKeySpare.substring(0, 20)))
          || scopedSpare.find(r => cleanSearchKeySpare.includes((r.materialName || "").replace(/\s+/g, '').toLowerCase().substring(0, 20)));
      }

      let jcmMatchSpare = findJcmMatchForPillSpare_(jcmCacheDataSpare.records);

      if (!jcmMatchSpare) {
        try {
          const freshJcmDataSpare = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValForPillSpare, projectId: projectId });
          window._ticketJobCardMaterialsCache = { key: jcmCacheKeyForPillSpare, records: freshJcmDataSpare.records || [] };
          jcmCacheDataSpare = window._ticketJobCardMaterialsCache;
          jcmMatchSpare = findJcmMatchForPillSpare_(jcmCacheDataSpare.records);
        } catch(refreshErrSpare) {
          console.error("JobCardMaterials cache self-heal refetch failed (Spare):", refreshErrSpare);
        }
      }

      if (spareInventoryMatch && jcmMatchSpare) {
        let styleClassSpare = "pill-stock-healthy";
        const availableCountSpare = Number(spareInventoryMatch.availableStock) || 0;
        const reservedCountSpare  = Number(spareInventoryMatch.reservedStock)  || 0;
        const unitTokenSpare = (spareInventoryMatch.unitType || "NOS").toUpperCase();

        if (availableCountSpare === 0)  styleClassSpare = "pill-stock-empty";
        else if (availableCountSpare <= 5) styleClassSpare = "pill-stock-low";

        const totalStockCountSpare = (spareInventoryMatch.totalStock !== undefined && spareInventoryMatch.totalStock !== null) ? Number(spareInventoryMatch.totalStock) : (availableCountSpare + reservedCountSpare);
        counterZone.innerHTML = `
          <div style="margin:12px 0 4px; font-size:0.88rem; font-weight:700; color:var(--text); text-align:left; line-height:1.6;">
            <div>
              Spare Store Total Stock Count:
              <span class="live-counter-pill ${styleClassSpare}" style="font-size:1rem; padding:3px 8px; margin-left:4px;">
                ${fmtQty(totalStockCountSpare)} ${unitTokenSpare}
              </span>
            </div>
            <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
              <span style="font-size:0.86rem; font-weight:700; background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:4px;">ALLOTTED (THIS JOB CARD): ${fmtQty(jcmMatchSpare.allottedQty)} ${unitTokenSpare}</span>
              <span style="font-size:0.86rem; font-weight:700; background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:4px;">USED: ${fmtQty(jcmMatchSpare.usedQty)} ${unitTokenSpare}</span>
              <span style="font-size:0.86rem; font-weight:700; background:#dcfce7; color:#166534; padding:3px 8px; border-radius:4px;">REMAINING: ${fmtQty(jcmMatchSpare.remainingQty)} ${unitTokenSpare}</span>
            </div>
          </div>
        `;
      } else if (spareInventoryMatch && !jcmMatchSpare) {
        const availableCountSpare = Number(spareInventoryMatch.availableStock) || 0;
        const unitTokenSpare = (spareInventoryMatch.unitType || "NOS").toUpperCase();
        let styleClassSpare = availableCountSpare === 0 ? "pill-stock-empty" : availableCountSpare <= 5 ? "pill-stock-low" : "pill-stock-healthy";
        counterZone.innerHTML = `
          <div style="margin:8px 0 4px; font-size:0.88rem; font-weight:700; color:var(--text);">
            Spare Store: <span class="live-counter-pill ${styleClassSpare}" style="font-size:1rem; padding:3px 8px; margin-left:4px;">${availableCountSpare} ${unitTokenSpare}</span>
            <span style="font-size:0.75rem; color:var(--warn); margin-left:8px;">⚠️ No allotment for this Job Card</span>
          </div>`;
      } else {
        counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Selected item missing configuration parameters.</span>`;
      }
    } catch(errSpare) {
      console.error("Spare pill allocation tracking crash:", errSpare);
      counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Could not load Spare stock/allotment.</span>`;
    }
    return;
  }

  // --- RAW MATERIALS STORE: show inventory + JobCardMaterials allocation ---
  // Tickets are Job-Card-scoped, never BOQ-scoped — this pill must read JobCardMaterials
  // (per-Job-Card Allotted/Used/Remaining), not BillOfQuantity (project-wide total across
  // every Set). BillOfQuantity is background bookkeeping only; the ticket workflow never
  // reads it directly.
  const jobCardNumberValForPill = document.getElementById("ticket-job-card-dropdown")?.value || "";
  const jcmCacheKeyForPill = jobCardNumberValForPill + "|" + projectId;

  // Only show loading text on first load, not on poll refreshes
  if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPill) {
    counterZone.innerHTML = `<span style="font-size:0.75rem; color:var(--brand); font-weight:700;">🔄 Evaluating Real-Time Job Card Allocations...</span>`;
  }

  try {
    if (!jobCardNumberValForPill) {
      counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Select a Job Card Number first.</span>`;
      return;
    }

    if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPill) {
      const jcmFetch = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValForPill, projectId: projectId });
      window._ticketJobCardMaterialsCache = { key: jcmCacheKeyForPill, records: jcmFetch.records || [] };
    }
    let jcmCacheData = window._ticketJobCardMaterialsCache;

    const cleanSearchKey = selectedMaterial.replace(/\s*\(\d+\s+\w+\s+available\)/i, "").trim().replace(/\s+/g, '').toLowerCase();
    
    let inventoryMatch;
    if (liveStockOverride) {
      inventoryMatch = { availableStock: liveStockOverride.availableStock, reservedStock: liveStockOverride.reservedStock, unitType: liveStockOverride.unitType };
    } else {
      const _inv = window.cachedInventoryStockCollection || cachedInventoryStockCollection || [];
      inventoryMatch = _inv.find(i => i.materialName.replace(/\s+/g, '').toLowerCase() === cleanSearchKey)
        || _inv.find(i => i.materialName.replace(/\s+/g, '').toLowerCase().includes(cleanSearchKey.substring(0, 20)))
        || _inv.find(i => cleanSearchKey.includes(i.materialName.replace(/\s+/g, '').toLowerCase().substring(0, 20)));
    }

    function findJcmMatchForPill_(recs) {
      const scoped = (recs || []).filter(r => r.typeOfStore === "Raw Materials Store");
      return scoped.find(r => (r.itemCode || "").replace(/\s+/g, '').toLowerCase() === (inventoryMatch?.itemCode || "").replace(/\s+/g, '').toLowerCase() && inventoryMatch?.itemCode)
        || scoped.find(r => (r.materialName || "").replace(/\s+/g, '').toLowerCase() === cleanSearchKey)
        || scoped.find(r => (r.materialName || "").replace(/\s+/g, '').toLowerCase().includes(cleanSearchKey.substring(0, 20)))
        || scoped.find(r => cleanSearchKey.includes((r.materialName || "").replace(/\s+/g, '').toLowerCase().substring(0, 20)));
    }

    let jcmMatch = findJcmMatchForPill_(jcmCacheData.records);

    // SELF-HEAL: a cache miss here is ambiguous — either this material genuinely isn't
    // allotted on this Job Card, or the cache was populated before seedJobCardMaterials_
    // finished writing this row (e.g. right after a BOQ authorize/update in another tab).
    // Force ONE fresh, uncached re-fetch before concluding it's really missing, so a stale
    // snapshot can never masquerade as "no allotment" for the rest of the session.
    if (!jcmMatch) {
      try {
        const freshJcmData = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValForPill, projectId: projectId });
        window._ticketJobCardMaterialsCache = { key: jcmCacheKeyForPill, records: freshJcmData.records || [] };
        jcmCacheData = window._ticketJobCardMaterialsCache;
        jcmMatch = findJcmMatchForPill_(jcmCacheData.records);
      } catch(refreshErr) {
        console.error("JobCardMaterials cache self-heal refetch failed:", refreshErr);
      }
    }
    
    if (inventoryMatch && jcmMatch) {
      let styleClass = "pill-stock-healthy";
      const availableCount = Number(inventoryMatch.availableStock) || 0;
      const reservedCount  = Number(inventoryMatch.reservedStock)  || 0;
      const unitToken = (inventoryMatch.unitType || "NOS").toUpperCase();
      
      if (availableCount === 0)  styleClass = "pill-stock-empty";
      else if (availableCount <= 5) styleClass = "pill-stock-low";
      
      const totalStockCount = (inventoryMatch.totalStock !== undefined && inventoryMatch.totalStock !== null) ? Number(inventoryMatch.totalStock) : (availableCount + reservedCount);
      counterZone.innerHTML = `
        <div style="margin:12px 0 4px; font-size:0.88rem; font-weight:700; color:var(--text); text-align:left; line-height:1.6;">
          <div>
            Raw Material Store Total Stock Count:
            <span class="live-counter-pill ${styleClass}" style="font-size:1rem; padding:3px 8px; margin-left:4px;">
              ${fmtQty(totalStockCount)} ${unitToken}
            </span>
          </div>
          <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
            <span style="font-size:0.86rem; font-weight:700; background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:4px;">ALLOTTED (THIS JOB CARD): ${fmtQty(jcmMatch.allottedQty)} ${unitToken}</span>
            <span style="font-size:0.86rem; font-weight:700; background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:4px;">USED: ${fmtQty(jcmMatch.usedQty)} ${unitToken}</span>
            <span style="font-size:0.86rem; font-weight:700; background:#dcfce7; color:#166534; padding:3px 8px; border-radius:4px;">REMAINING: ${fmtQty(jcmMatch.remainingQty)} ${unitToken}</span>
          </div>
        </div>
      `;
    } else if (inventoryMatch && !jcmMatch) {
      const availableCount = Number(inventoryMatch.availableStock) || 0;
      const unitToken = (inventoryMatch.unitType || "NOS").toUpperCase();
      let styleClass = availableCount === 0 ? "pill-stock-empty" : availableCount <= 5 ? "pill-stock-low" : "pill-stock-healthy";
      counterZone.innerHTML = `
        <div style="margin:8px 0 4px; font-size:0.88rem; font-weight:700; color:var(--text);">
          Raw Material Store: <span class="live-counter-pill ${styleClass}" style="font-size:1rem; padding:3px 8px; margin-left:4px;">${availableCount} ${unitToken}</span>
          <span style="font-size:0.75rem; color:var(--warn); margin-left:8px;">⚠️ No allotment for this Job Card</span>
        </div>`;
    } else {
      counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Selected item missing configuration parameters.</span>`;
    }
  } catch(err) {
    console.error("Pill allocation tracking crash:", err);
    // Don't blank the zone — if we have live stock data, show it even without BOQ
    if (liveStockOverride) {
      const availableCount = Number(liveStockOverride.availableStock) || 0;
      const reservedCount  = Number(liveStockOverride.reservedStock)  || 0;
      const unitToken      = (liveStockOverride.unitType || "NOS").toUpperCase();
      const styleClass     = availableCount === 0 ? "pill-stock-empty" : availableCount <= 5 ? "pill-stock-low" : "pill-stock-healthy";
      counterZone.innerHTML = `
        <div style="margin:12px 0 4px; font-size:0.88rem; font-weight:700; color:var(--text); text-align:left; line-height:1.6;">
          <div>
            Raw Material Store Count:
            <span class="live-counter-pill ${styleClass}" style="font-size:1rem; padding:3px 8px; margin-left:4px;">
              ${fmtQty(availableCount)} ${unitToken} Extra Unreserved
            </span>
          </div>
          <div style="margin-top:4px; font-size:0.72rem; color:var(--warn);">⚠️ BOQ data could not be loaded. Retry by reselecting the item.</div>
        </div>`;
    }
  }
}

async function handleCreateTicketProjectChange(chosenProjectVal) {
  const storeScopeDropdown = document.getElementById("ticket-selected-store-scope-toggle");
  const storeScopeLabel = document.getElementById("lbl-store-scope-title");
  const boqLabel = document.getElementById("lbl-ticket-boq-title");
  const customerNameField = document.getElementById("ticket-customer-name");

  // Reset everything downstream
  resetMaterialRequestCascadingLockState();
  storeScopeDropdown.value = "";
  ticketJobCardDisplayReset("— Choose BOQ First —");

  storeScopeDropdown.disabled = true;
  storeScopeDropdown.style.opacity = "0.5";
  storeScopeDropdown.style.cursor = "not-allowed";
  storeScopeDropdown.innerHTML = buildStoreScopeOptionsHtml_("— Choose Department First —");
  if (storeScopeLabel) storeScopeLabel.style.color = "var(--muted)";

  const meta = (window._ticketProjectMetaCache || {})[chosenProjectVal];
  if (customerNameField) customerNameField.value = meta ? (meta.companyName || "") : "";

  if (!chosenProjectVal) {
    ticketBOQDisplayReset("— Choose Project First —");
    if (boqLabel) boqLabel.style.color = "var(--muted)";
    return;
  }

  ticketBOQDisplayReset("Loading...");
  // Clear BOQ cache when project changes
  window._ticketBOQCache = null;

  try {
    const data = await apFetch({ action:"fetchJobCardsForProject", projectId: chosenProjectVal });
    // Extract unique BOQ IDs from job cards
    const boqMap = {};
    (data.jobCards || []).forEach(jc => {
      if (jc.boqId && !boqMap[jc.boqId]) {
        boqMap[jc.boqId] = jc.boqId;
      }
    });
    // Cache job cards for BOQ filtering
    window.ticketJobCardsCache = data.jobCards || [];

    if (Object.keys(boqMap).length === 0) {
      ticketBOQDisplayReset("⚠ No BOQ IDs found for this project");
      if (boqLabel) boqLabel.style.color = "var(--warn)";
    } else {
      ticketBOQDisplayReset("— Select BOQ ID —");
      ticketBOQPopulate(Object.entries(boqMap).map(([boqId, label]) => ({ value: boqId, label })));
      ticketBOQDisplayEnable();
      if (boqLabel) boqLabel.style.color = "var(--brand)";
    }
  } catch(e) {
    ticketBOQDisplayReset("Error loading BOQs");
  }
}

async function initializeJobCardPanel() {
  const projDrop = document.getElementById("job-card-project");
  projDrop.innerHTML = '<option value="">Loading...</option>';
  document.getElementById("job-card-customer").value = "";
  document.getElementById("job-card-boq-groups-mount").style.display = "none";
  document.getElementById("job-card-boq-groups-mount").innerHTML = "";
  document.getElementById("job-card-bottom-controls").style.display = "none";
  document.getElementById("job-card-feedback").style.display = "none";

  try {
    const data = await apFetch({ action:"pullLiveActiveProjectCodes" });
    projDrop.innerHTML = '<option value="">— Select Project ID —</option>';
    (data.projects || []).forEach(code => {
      const opt = document.createElement("option"); opt.value = code; opt.textContent = code; projDrop.appendChild(opt);
    });
    window.jobCardProjectMeta = data.projectMeta || {};
  } catch(e) {
    projDrop.innerHTML = '<option value="">Error loading projects</option>';
  }

  // Load Production personnel
  const createdByDrop = document.getElementById("job-card-created-by");
  createdByDrop.innerHTML = '<option value="">Loading...</option>';
  try {
    const data = await apFetch({ action:"getStoreOperatorsList" });
    const allPersonnel = data.fullPersonnelDataRecordsTree || [];
    const prodPeople = filterOutPureAdminPersonnel(allPersonnel.filter(p => p.departmentsList.some(d => d.toLowerCase().trim() === "production" || d.toLowerCase().trim() === "admin")));
    createdByDrop.innerHTML = '<option value="">— Select Person —</option>';
    prodPeople.forEach(p => {
      const opt = document.createElement("option"); opt.value = p.fullName; opt.textContent = p.fullName;
      createdByDrop.appendChild(opt);
    });
  } catch(e) {
    createdByDrop.innerHTML = '<option value="">Error loading personnel</option>';
  }
}

function handleJobCardProjectChange(projectId) {
  const meta = window.jobCardProjectMeta && window.jobCardProjectMeta[projectId];
  document.getElementById("job-card-customer").value = meta ? (meta.companyName || "") : "";

  const mount = document.getElementById("job-card-boq-groups-mount");
  const bottomControls = document.getElementById("job-card-bottom-controls");

  if (!projectId) {
    mount.style.display = "none";
    mount.innerHTML = "";
    bottomControls.style.display = "none";
    return;
  }

  loadJobCardBOQGroups(projectId);
}

async function loadJobCardBOQGroups(projectId) {
  const mount = document.getElementById("job-card-boq-groups-mount");
  const bottomControls = document.getElementById("job-card-bottom-controls");
  mount.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  mount.style.display = "block";

  try {
    const [boqData, jcData] = await Promise.all([
      apFetch({ action:"fetchBOQProductsForJobCard", projectId }),
      apFetch({ action:"fetchJobCardsForProject", projectId })
    ]);

    jobCardBOQGroups = boqData.boqGroups || [];

    // Map existing job cards: key = boqId_setNumber
    jobCardExisting = {};
    (jcData.jobCards || []).forEach(jc => {
      jobCardExisting[`${jc.boqId}_${jc.setNumber}`] = jc.jobCardNumber;
    });

    if (jobCardBOQGroups.length === 0) {
      mount.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;">No authorized BOQ found for this project.</div>`;
      bottomControls.style.display = "none";
      return;
    }

    mount.innerHTML = "";
    jobCardBOQGroups.forEach(group => {
      const safeBoqId = group.boqId.replace(/[^a-zA-Z0-9]/g, '_');
      const section = document.createElement("div");
      section.style.cssText = "margin-bottom:18px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;";

      let rowsHtml = "";
      for (let setNum = 1; setNum <= group.orderQuantity; setNum++) {
        const existingVal = jobCardExisting[`${group.boqId}_${setNum}`] || "";
        rowsHtml += `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:8px; text-align:center; font-weight:700; color:var(--muted);">${setNum}</td>
            <td style="padding:8px;">
              <input type="text" 
                data-boqid="${group.boqId}" data-setnum="${setNum}"
                data-project="${group.boqId ? '' : ''}"
                class="job-card-input-${safeBoqId}"
                value="${existingVal}"
                placeholder="Enter Job Card Number..."
                style="padding:7px; font-weight:600; width:100%; border:1.5px solid var(--border); border-radius:4px;" />
            </td>
          </tr>`;
      }

      section.innerHTML = `
        <div style="padding:10px 16px; background:var(--highlight-bg); border-bottom:1px solid var(--border);">
          <span style="font-family:monospace; font-weight:800; background:var(--brand); color:#fff; font-size:0.72rem; padding:3px 6px;">${group.boqId}</span>
          <span style="margin-left:8px; font-weight:700; color:var(--text);">${group.productName} ${group.productRating}</span>
          <span style="font-size:0.72rem; color:var(--muted); margin-left:8px;">Order Qty: ${group.orderQuantity}</span>
        </div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:8px; font-size:0.7rem; text-transform:uppercase; color:var(--muted); width:60px;">Set No.</th>
              <th style="padding:8px; font-size:0.7rem; text-transform:uppercase; color:var(--muted); text-align:left;">Job Card Number *</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
      mount.appendChild(section);
    });

    bottomControls.style.display = "block";
  } catch(e) {
    mount.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn);">Error: ${e.message}</div>`;
  }
}

// ═══════════════════════════════════════════════════════
// PURCHASE WORKSPACE NAVIGATION
// ═══════════════════════════════════════════════════════

window.cpoVendors = [];
window.cpoMaterialRows = [];
window.cpoActiveProjects = [];
window.cpoRowSeq = 0;

