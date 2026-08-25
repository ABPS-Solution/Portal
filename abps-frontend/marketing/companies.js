let activeSearchRef = ""; 
let activeSearchCompany = "";
/**
 * CORE SEARCH DISPATCH PIPELINE
 * Queries company metadata profiles robustly and secures smooth DOM container alignment
 */
async function triggerSequentialSearch(triggerSourceMode) {
  let comp = ""; 
  let targetName = "";
  let btn = null;

  // Safeguard DOM nodes isolation checks
  const successScreen = document.getElementById('success-screen');
  const remainingForm = document.getElementById('remaining-sections-form');
  const missingNoticeBlock = document.getElementById("missing-trigger-notice-block");
  const inlineCanvas = document.getElementById("step2-inline-interaction-canvas");

  if (successScreen) successScreen.style.display = 'none';
  if (remainingForm) remainingForm.style.display = 'block';
  
  if (triggerSourceMode === "CARD") {
    comp = document.getElementById("f-company").value;
    targetName = document.getElementById("f-name").value;
    btn = document.getElementById("gate-search-btn");
  } else {
    const dropdown = document.getElementById("lookup-module-company-dropdown");
    if (!dropdown) return;
    comp = dropdown.value;
    targetName = ""; 
    btn = document.getElementById("lookup-module-search-btn");
    if (!comp) return alert("Select a company first.");
    
    // Standardize text lookup values by stripping out trailing bracketed metadata notes
    if (comp.indexOf(" (") !== -1) {
      comp = comp.split(" (")[0].trim();
    }
  }
  
  if (!comp) return alert("Specify Company parameters.");
  if (btn) {
    btn.disabled = true; 
    btn.innerHTML = '<div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></div> Searching...';
  }

  try {
    const headerRowEnclosure = document.getElementById("canvas-back-btn-enclosure-row");
    if (headerRowEnclosure) headerRowEnclosure.innerHTML = "";

    const data = await apFetch({ 
      action: "searchCompanyData", 
      activeEngineer: appActiveOperatorIdentityString,
      companyName: comp, 
      contactName: targetName 
    });
    
    // FIXED: Uniform parent element resolution targeting rules
    const activePanelId = (triggerSourceMode === "CARD") ? "workspace-cardDetails" : "workspace-searchCompany";
    const activePanel = document.getElementById(activePanelId);
    
    if (activePanel) {
      if (missingNoticeBlock) activePanel.appendChild(missingNoticeBlock);
      if (inlineCanvas) activePanel.appendChild(inlineCanvas);
    }
    
    if (data.success) {
      activeSearchCompany = comp.toString().trim();
      globalFollowUpsCacheMap = data.followups;
      globalTasksCacheMap = data.tasks;
      
      const bannerHook = document.getElementById("split-missing-person-banner-hook");
      if (bannerHook) {
        const searchedForPerson = targetName && targetName.toString().trim();
        if (searchedForPerson && !data.nameMatchFound) {
          // Card Details flow: a specific person was searched but not found.
          bannerHook.innerHTML = `
            <div class="system-runtime-inline-alert-callout">
              <span class="alert-callout-text-msg">We have information on the following people from this ${activeSearchCompany}, but not for ${targetName.toString().trim()}.</span>
              <button class="nav-btn-styled" style="background:var(--accent);" onclick="revealNewEntryFormDropdownFromBanner()">Create New Entry</button>
            </div>
          `;
        } else if (!searchedForPerson) {
          // Search-by-Company flow: no person was searched, so "no name
          // match" isn't a warning — reuse the existing Back to Search
          // handler (returns to the company search input, not the main
          // dashboard) plus keep Create New Entry.
          bannerHook.innerHTML = `
            <div class="system-runtime-inline-alert-callout">
              <button class="nav-btn-styled" style="background:#4a5568;" onclick="exitCanvasToCardView()">Back to Search</button>
              <button class="nav-btn-styled" style="background:var(--accent);" onclick="revealNewEntryFormDropdownFromBanner()">Create New Entry</button>
            </div>
          `;
        } else {
          bannerHook.innerHTML = "";
        }
      }

      buildMultiContactDirectoryInterface(data.leads, targetName);
      
      if (missingNoticeBlock) missingNoticeBlock.style.display = "none";
      
      if (triggerSourceMode === "CARD") {
        const step1Block = document.getElementById("step1-card-capture-block");
        if (step1Block) step1Block.style.display = "none";
      } else {
        const dropdownBlock = document.getElementById("company-dropdown-selector-block");
        if (dropdownBlock) dropdownBlock.style.display = "none";
      }
      
      const controlHeaderBtn = document.getElementById("global-direct-inline-create-entry-btn");
      const controlCollapseBtn = document.getElementById("global-direct-inline-collapse-entry-btn");
      const globalNavHeaderBar = document.getElementById("main-global-nav-header-bar");
      const inlineControlsBlock = document.getElementById("inline-creation-header-controls-block");

      if (globalNavHeaderBar && inlineControlsBlock) {
        globalNavHeaderBar.insertBefore(inlineControlsBlock, globalNavHeaderBar.firstChild);
      }
      
      // The top-left header Create New Entry / Collapse Form pair is never
      // used on Card Details or Search by Company Name — both screens open
      // the form via their own in-page banner button instead.
      if (controlHeaderBtn) controlHeaderBtn.style.display = "none";
      if (controlCollapseBtn) controlCollapseBtn.style.display = "none";
      if (inlineCanvas) inlineCanvas.style.display = "block";

    } else {
      if (missingNoticeBlock) missingNoticeBlock.style.display = "flex";
      if (inlineCanvas) inlineCanvas.style.display = "none";
    }
  } catch(e) { 
    alert("Lookup Failed: " + e.message); 
  } finally { 
    if (btn) {
      btn.disabled = false; 
      btn.innerHTML = triggerSourceMode === "CARD" ? "Search Marketing Database" : "Search Company"; 
    }
  }
}

async function globalExecutionScopeReloader(leadRef, scopeNode) {
  try {
    const data = await apFetch({ 
      action: "searchCompanyData", 
      activeEngineer: appActiveOperatorIdentityString,
      companyName: activeSearchCompany 
    });
    if (data.success) { globalFollowUpsCacheMap = data.followups; globalTasksCacheMap = data.tasks; currentFollowUpCount = data.followups[leadRef] ? data.followups[leadRef].length : 0; renderIsolatedFollowUpTimeline(leadRef, data.followups[leadRef] || [], scopeNode); renderIsolatedTaskItemsList(leadRef, data.tasks[leadRef] || [], scopeNode); }
  } catch(e) { console.error(e.message); }
}

// combineCardImagesToBase64 — combines front+back card photos onto one
// canvas (or just converts front alone) and returns raw base64, for the
// caller to send as `base64Image` on the actual /submit call. This used
// to pre-upload via its own apFetch call to a "uploadVisitingCardToDrive"
// action and pass back a URL — that backend action never existed (confirmed
// against every real route), so it always 404'd, was swallowed by this
// function's own try/catch, and returned "" silently. Even had it
// worked, /submit only ever reads `base64Image`, never the `imageUrl`
// the old code sent — so no card photo from this form has ever actually
// reached Drive. /submit (routes/marketing.js) already has working,
// tested upload logic for exactly this base64Image + mimeType shape
// (the "scan business card" OCR flow uses it), so this just feeds that
// path instead of duplicating it.
async function combineCardImagesToBase64(fileFrontImg, fileBackImg) {
  if (!fileFrontImg) return { base64: "", mimeType: "" };

  const loadImage = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  try {
    const frontImg = await loadImage(fileFrontImg);
    let base64;

    if (fileBackImg) {
      const backImg  = await loadImage(fileBackImg);
      const gap      = 12;
      const canvasH  = Math.max(frontImg.naturalHeight, backImg.naturalHeight);
      const canvasW  = frontImg.naturalWidth + gap + backImg.naturalWidth;
      const canvas   = document.createElement("canvas");
      canvas.width   = canvasW;
      canvas.height  = canvasH;
      const ctx      = canvas.getContext("2d");
      ctx.fillStyle  = "#ffffff";
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.drawImage(frontImg, 0, 0);
      ctx.drawImage(backImg, frontImg.naturalWidth + gap, 0);
      base64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
    } else {
      // Front only — just convert to base64
      const canvas  = document.createElement("canvas");
      canvas.width  = frontImg.naturalWidth;
      canvas.height = frontImg.naturalHeight;
      const ctx     = canvas.getContext("2d");
      ctx.drawImage(frontImg, 0, 0);
      base64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
    }
    return { base64, mimeType: "image/jpeg" };
  } catch(e) {
    console.error("Card image processing failed:", e);
    return { base64: "", mimeType: "" };
  }
}

async function toggleTaskCompanyExpand(taskId, encodedCompany, encodedPerson) {
  const companyName = decodeURIComponent(encodedCompany);
  const personName  = decodeURIComponent(encodedPerson);
  const expandDiv   = document.getElementById(`matrix-task-company-expand-${taskId}`);
  const btn         = document.getElementById(`view-company-btn-${taskId}`);
  if (!expandDiv || !btn) return;

  // Collapse if already open
  if (expandDiv.style.display === "block") {
    expandDiv.style.display = "none";
    expandDiv.innerHTML = "";
    btn.textContent = "View Company";
    btn.style.background = "var(--brand)";
    return;
  }

  btn.textContent = "Loading...";
  btn.disabled = true;

  try {
    const data = await apFetch({
      action: "searchCompanyData",
      activeEngineer: appActiveOperatorIdentityString,
      companyName: companyName,
      contactName: ""
    });

    if (!data.success || !data.leads || data.leads.length === 0) {
      expandDiv.innerHTML = `<p style="color:var(--warn); font-size:0.85rem; font-weight:700;">No records found for "${companyName}".</p>`;
      expandDiv.style.display = "block";
      btn.textContent = "Collapse Company";
      btn.style.background = "#718096";
      btn.disabled = false;
      return;
    }

    globalFollowUpsCacheMap = data.followups;
    globalTasksCacheMap = data.tasks;

    // Sort — matching person first
    const leads = data.leads.sort((a, b) => {
      const aMatch = (a["Contact Person Name"] || "").toLowerCase() === personName.toLowerCase();
      const bMatch = (b["Contact Person Name"] || "").toLowerCase() === personName.toLowerCase();
      return aMatch && !bMatch ? -1 : !aMatch && bMatch ? 1 : 0;
    });

    expandDiv.innerHTML = `<div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:10px; letter-spacing:0.3px;">📋 ${companyName} — All Contacts</div>`;

    leads.forEach(lead => {
      const tRef = lead["Lead ID"];
      const isTarget = (lead["Contact Person Name"] || "").toLowerCase() === personName.toLowerCase();
      const cardName = lead["Contact Person Name"] || "Unspecified";
      const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
      const escForOnclick2 = s => (s || "").toString().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const deleteHtml = isAdminUser
        ? `<button class="nav-btn-styled" style="font-size:1rem; padding:9px 18px; background:var(--warn);" onclick="removeLeadRowEntirely('${tRef}', '${escForOnclick2(companyName)}', '${escForOnclick2(cardName)}')">Delete Record</button>`
        : "";

      const card = document.createElement("div");
      card.className = "contact-summary-card-parent" + (isTarget ? " search-highlighted-focus-node" : "");
      card.id = `task-expand-card-${tRef}`;
      if (isTarget) card.style.cssText = "border:2.5px solid var(--brand) !important; background:var(--highlight-bg) !important; box-shadow:0 4px 12px rgba(0,86,179,0.15) !important;";

      card.innerHTML = `
        <div class="contact-summary-header-row">
          <div class="contact-summary-title-info">
            <div class="meta-row-line-block" style="margin-bottom:6px;">
              <span style="background:#e2e8f0;">Company:</span><strong style="margin-right:20px;">${lead["Company Name"] || companyName}</strong>
              <span style="background:#edf2f7;">Status:</span><strong id="card-lbl-status-${tRef}">${lead["Status"] || "N/A"}</strong>
              ${isTarget ? '<span style="background:var(--brand); color:#fff; margin-left:8px; font-size:0.65rem; padding:2px 6px; border-radius:4px; font-weight:700;">LINKED TO TASK</span>' : ''}
            </div>
            <div class="meta-row-line-block">
              <span style="background:#e2e8f0;">Name:</span><strong style="margin-right:20px;" id="card-lbl-name-${tRef}">${cardName}</strong>
              <span style="background:#edf2f7;">Position:</span><strong id="card-lbl-pos-${tRef}">${lead["Position"] || "Unspecified"}</strong>
            </div>
          </div>
          <div class="directory-btn-actions-block">
            <button class="nav-btn-styled" style="font-size:1rem; padding:9px 18px;" onclick="toggleContactExpansionView('${tRef}', \`${encodeURIComponent(JSON.stringify(lead))}\`)" id="expand-trigger-${tRef}">View Details</button>
            ${deleteHtml}
          </div>
        </div>
        <div class="contact-expanded-workspace-payload-drawer" id="drawer-panel-${tRef}" style="display:none; padding-top:4px;">
          <div class="leads-editable-fields-box-canvas" id="canvas-fields-${tRef}"></div>
          <div class="child-injected-modules-mount-point" id="modules-mount-${tRef}" style="margin-top:10px;"></div>
        </div>
      `;
      expandDiv.appendChild(card);

      if (isTarget) {
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
      }
    });

    expandDiv.style.display = "block";
    btn.textContent = "Collapse Company";
    btn.style.background = "#718096";

  } catch(e) {
    expandDiv.innerHTML = `<p style="color:var(--warn);">Error: ${e.message}</p>`;
    expandDiv.style.display = "block";
    btn.textContent = "View Company";
    btn.style.background = "var(--brand)";
  }
  btn.disabled = false;
}

