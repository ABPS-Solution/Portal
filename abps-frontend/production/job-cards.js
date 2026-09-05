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
  // Only do this when the zone is still empty (first render for this selection) — this
  // function is also called twice per 5s poll tick (once from cache, once with live data),
  // and wiping already-rendered content back to this placeholder on every one of those calls
  // was producing a visible flicker every 5 seconds even though nothing had changed.
  if (!counterZone.innerHTML.trim()) {
    counterZone.innerHTML = `<span style="font-size:0.75rem; color:var(--muted); font-weight:600;">🔄 Loading stock &amp; allotment…</span>`;
  }

  const activeStoreScope = document.getElementById("ticket-selected-store-scope-toggle")?.value || "Raw Materials Store";

  // --- FINISHED GOODS STORE: show FG item details ---
  if (activeStoreScope === "Finished Goods Store") {
    const jobCardNumberValForPillFG = document.getElementById("ticket-job-card-dropdown")?.value || "";
    const isServicePillFG = typeof ticketIsServiceItemMode_ === "function" && ticketIsServiceItemMode_();
    const jcmCacheKeyForPillFG = typeof ticketJcmCacheKeyFor_ === "function"
      ? ticketJcmCacheKeyFor_("Finished Goods Store", jobCardNumberValForPillFG, projectId)
      : (jobCardNumberValForPillFG + "|" + projectId);

    if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPillFG) {
      counterZone.innerHTML = `<span style="font-size:0.75rem; color:var(--brand); font-weight:700;">🔄 Evaluating Real-Time Stock...</span>`;
    }

    try {
      if (!jobCardNumberValForPillFG && !isServicePillFG) {
        counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Select a Job Card Number first.</span>`;
        return;
      }

      if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPillFG) {
        if (isServicePillFG) {
          await ticketEnsureJcmCache_("Finished Goods Store", jobCardNumberValForPillFG, projectId);
        } else {
          const jcmFetchFGPill = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValForPillFG, projectId: projectId });
          window._ticketJobCardMaterialsCache = { key: jcmCacheKeyForPillFG, records: jcmFetchFGPill.records || [] };
        }
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

      // Self-heal only applies to the Job-Card-scoped case — a miss against
      // the Service free-pool catalog is a real "not in stock", not a
      // caching race to retry.
      if (!jcmMatchFG && !isServicePillFG) {
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
  const isServicePillRaw = typeof ticketIsServiceItemMode_ === "function" && ticketIsServiceItemMode_();
  const jcmCacheKeyForPill = typeof ticketJcmCacheKeyFor_ === "function"
    ? ticketJcmCacheKeyFor_("Raw Materials Store", jobCardNumberValForPill, projectId)
    : (jobCardNumberValForPill + "|" + projectId);

  // Only show loading text on first load, not on poll refreshes
  if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPill) {
    counterZone.innerHTML = `<span style="font-size:0.75rem; color:var(--brand); font-weight:700;">🔄 Evaluating Real-Time Stock...</span>`;
  }

  try {
    if (!jobCardNumberValForPill && !isServicePillRaw) {
      counterZone.innerHTML = `<span style="color:var(--warn); font-size:0.8rem;">⚠️ Select a Job Card Number first.</span>`;
      return;
    }

    if (!window._ticketJobCardMaterialsCache || window._ticketJobCardMaterialsCache.key !== jcmCacheKeyForPill) {
      if (isServicePillRaw) {
        await ticketEnsureJcmCache_("Raw Materials Store", jobCardNumberValForPill, projectId);
      } else {
        const jcmFetch = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jobCardNumberValForPill, projectId: projectId });
        window._ticketJobCardMaterialsCache = { key: jcmCacheKeyForPill, records: jcmFetch.records || [] };
      }
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
    if (!jcmMatch && !isServicePillRaw) {
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
  storeScopeDropdown.innerHTML = buildStoreScopeOptionsHtml_("— Choose BOQ First —");
  if (storeScopeLabel) storeScopeLabel.style.color = "var(--muted)";

  const meta = (window._ticketProjectMetaCache || {})[chosenProjectVal];
  if (customerNameField) { customerNameField.value = meta ? (meta.companyName || "") : ""; autoGrowTextField(customerNameField); }

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

