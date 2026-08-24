let cachedEngineers = [];
let cachedUploadLeadsList = [];
let targetDispatchBillFileObj = null;
let targetCommissioningReportFileObj = null;
let targetPurchaseOrderFileObj = null;

let globalLocationDatabaseCacheMap = {};
// cachedEngineers holds {email, name} objects. Checkbox/filter values are
// emails (needed for DB filtering), but anything shown to the user must be
// the display name — never the email. This maps a list of emails to names.
function engineerEmailsToNames(emails) {
  return emails.map(em => {
    const match = cachedEngineers.find(e => e.email === em);
    return match ? match.name : em;
  });
}

async function fetchAndPopulateUploadLeadDropdowns() {
  try {
    const d = await apFetch({ action: "getLeadsForDocumentUploadDropdown", activeEngineer: appActiveOperatorIdentityString });
    if (!d.success) return;
    cachedUploadLeadsList = d.leads;
    ["dispatch-bill-lead-dropdown", "purchase-order-lead-dropdown"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const prevVal = el.value;
      el.innerHTML = '<option value="">— Select Company / Lead —</option>';
      cachedUploadLeadsList.forEach(l => {
        const opt = document.createElement("option");
        opt.value = l.leadId; opt.textContent = l.displayLabel;
        el.appendChild(opt);
      });
      if (prevVal && cachedUploadLeadsList.some(l => l.leadId === prevVal)) el.value = prevVal;
    });
  } catch(e) { /* non-fatal — dropdowns just stay on placeholder if this fails */ }
}

/**
 * INTERACTIVE DROPDOWN CHANGE LISTENER
 * Filters names instantly based on selected department string variables key
 */
function handleLoginDepartmentSelectionChange(selectedDepartmentNameString) {
  const nameSelect = document.getElementById("app-auth-active-engineer-identity");
  if (!nameSelect) return;
  
  if (!selectedDepartmentNameString || !globalPersonnelAuthDirectoryTreePayloadCache[selectedDepartmentNameString]) {
    nameSelect.innerHTML = '<option value="">— Choose Department First —</option>';
    nameSelect.disabled = true;
    return;
  }
  
  // Isolate user name matches array list from cached memory tree block
  const filteredStaffList = globalPersonnelAuthDirectoryTreePayloadCache[selectedDepartmentNameString];
  
  nameSelect.innerHTML = '<option value="">— Select Your Name —</option>';
  filteredStaffList.forEach(fullName => {
    const opt = document.createElement("option");
    opt.value = fullName.trim();
    opt.textContent = fullName.trim();
    nameSelect.appendChild(opt);
  });
  
  nameSelect.disabled = false;
}

function initializeGoogleAuthPlatformEngine() {
  if (document.getElementById("auth-portal-processing-loader")) {
    document.getElementById("auth-portal-processing-loader").style.display = "none";
  }
  
  localStorage.clear();
  appActiveOperatorIdentityString = "";
  document.getElementById("app-container").style.display = "none";
  document.getElementById("auth-container").style.display = "flex";
  
  setTimeout(() => {
    const mountNode = document.getElementById("google-auth-button-mount-point");
    if (!mountNode) {
      console.error("Critical Render Error: google-auth-button-mount-point container not found in DOM.");
      return;
    }

    // 1. COMPLETELY RECONSTRUCT THE MOUNT NODE TO DESTROY MOBILE CACHED EVENT LISTENERS
    const parentContainer = mountNode.parentNode;
    mountNode.remove();
    
    const freshMountNode = document.createElement("div");
    freshMountNode.id = "google-auth-button-mount-point";
    freshMountNode.style.cssText = "display: flex; justify-content: center; margin-top: 15px; min-height: 40px;";
    parentContainer.insertBefore(freshMountNode, document.getElementById("auth-portal-processing-loader"));

    // 2. INITIALIZE GOOGLE WITH MOBILE CACHE OVERRIDES
    google.accounts.id.initialize({
      client_id: "223982503901-jij5hbl0npjmbqnsgl352pvmq4sk75nt.apps.googleusercontent.com",
      callback: handleGooglePlatformCredentialResponse,
      ux_mode: "popup",
      use_fedcm_for_prompt: true
    });
    
    // 3. FORCE RENDER THE FRESH IFRAME
    google.accounts.id.renderButton(
      freshMountNode,
      { theme: "outline", size: "large", width: "320" }
    );
    
    // FedCM compatible — do not call prompt(), rely only on renderButton click
    console.log("Google Auth: FedCM mode active, button rendered.");

  }, 250); 
}

async function parseCard() {
  const btn = document.getElementById('parse-btn');
  if (!fileFront) return alert("Please capture or select the Front Side of the business card first.");
  const MAX_CLOUDINARY = 10 * 1024 * 1024; // 10MB
  if (fileFront.size > MAX_CLOUDINARY) return alert("Front image is too large (max 10MB). Please use a smaller image.");
  if (fileBack && fileBack.size > MAX_CLOUDINARY) return alert("Back image is too large (max 10MB). Please use a smaller image.");
  
  btn.disabled = true;
  btn.classList.add("loading");
  btn.textContent = "AI Processing Card";
  
  try {
    // 1. Convert files into Base64 formats strings parameters
    const getBase64 = file => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = e => rej(e);
      r.readAsDataURL(file);
    });
    
    const base64Front = await getBase64(fileFront);
    const base64Back = fileBack ? await getBase64(fileBack) : null;

    // 2. Route through apFetch so SESSION_EXPIRED is caught globally
    const data = await apFetch({
      action: "parse",
      activeEngineer: appActiveOperatorIdentityString,
      base64Image: base64Front,
      mimeType: fileFront.type || "image/jpeg",
      base64ImageBack: base64Back,
      mimeTypeBack: fileBack ? fileBack.type || "image/jpeg" : null
    });

    // 3. Backend already parses server-side (routes/marketing.js's /parse
    // + lib/gemini.js's parseBusinessCard) and returns clean structured
    // fields at data.parsed — not raw Gemini API JSON to parse ourselves.
    if (data && data.success === false) {
      alert("Card processing failed: " + (data.error || "Unknown server error."));
      return;
    }
    if (data && data.parsed) {
      const resultData = data.parsed;

      // 4. Inject extracted fields into form inputs
      document.getElementById("f-company").value  = resultData.companyName        || "";
      document.getElementById("f-name").value     = resultData.contactPersonName  || "";
      document.getElementById("f-position").value = resultData.position           || "";
      document.getElementById("f-phone").value    = resultData.phone              || "";
      document.getElementById("f-altphone").value = (resultData.altPhone || "").replace(/,/g, ", ");
      document.getElementById("f-email").value    = resultData.email              || "";
      document.getElementById("f-website").value  = resultData.website            || "";
      document.getElementById("f-address").value  = resultData.companyAddress     || "";

      if (document.getElementById("f-city"))    document.getElementById("f-city").value    = resultData.city    || "";
      if (document.getElementById("f-state"))   document.getElementById("f-state").value   = resultData.state   || "";
      if (document.getElementById("f-country")) document.getElementById("f-country").value = resultData.country || "";

    } else {
      alert("AI could not read the card. Please try a clearer image.");
    }
  } catch (e) {
    alert("Card Processing network execution crash: " + e.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.textContent = "Process Card with AI";
  }
}

async function loadCityStateFilterOptions() {
  const btn = document.getElementById("city-state-search-submit-btn");
  const countryMount = document.getElementById("location-country-checkboxes-mount");
  const stateMount = document.getElementById("location-state-checkboxes-mount");
  const cityMount = document.getElementById("location-city-checkboxes-mount");
  
  if (countryMount) {
    countryMount.innerHTML = `<p style="font-size:0.75rem; color:var(--muted); padding:4px 0;">Loading...</p>`;
  }
  if (stateMount) stateMount.innerHTML = "";
  if (cityMount) cityMount.innerHTML = "";
  if (btn) btn.disabled = true;
  
  try {
    const data = await apFetch({
      action: "getUniqueCityStatePayloadTree",
      activeEngineer: appActiveOperatorIdentityString
    });
    if (data.success) {
      // Safely assign the multi-tier nested database tree (Country -> State -> City)
      globalLocationDatabaseCacheMap = data.tree;
      renderCountryCheckboxPillElements();
    } else {
      if (countryMount) countryMount.innerHTML = `<p style="font-size:0.75rem; color:var(--warn);">Failed to sync locations ledger: ${data.error}</p>`;
    }
  } catch (e) {
    console.error("Geographic dictionary fetch exception:", e);
    if (countryMount) countryMount.innerHTML = `<p style="font-size:0.75rem; color:var(--warn);">Network Error loading location lookups</p>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderCountryCheckboxPillElements() {
  const countryMount = document.getElementById("location-country-checkboxes-mount");
  const stateMount = document.getElementById("location-state-checkboxes-mount");
  const cityMount = document.getElementById("location-city-checkboxes-mount");
  
  if (!countryMount) return;
  countryMount.innerHTML = "";
  
  if (stateMount) {
    stateMount.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); font-weight:600; margin:0;">Select a Country above to see States...</p>';
  }
  if (cityMount) {
    cityMount.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); font-weight:600; margin:0;">Select a State above to see Cities...</p>';
  }
  
  if (!globalLocationDatabaseCacheMap || Object.keys(globalLocationDatabaseCacheMap).length === 0) {
    countryMount.innerHTML = '<p style="font-size:0.75rem; color:var(--muted);">No geographic logs tracked inside records yet.</p>';
    return;

  }
  
  const countriesList = Object.keys(globalLocationDatabaseCacheMap).sort();
  countriesList.forEach(country => {
    const cleanCountryName = country.toString().trim();
    const cleanId = "country_chk_" + cleanCountryName.replace(/\s+/g, '_');
    
    countryMount.innerHTML += `
      <input type="checkbox" name="searchCountryFilter" value="${cleanCountryName}" id="${cleanId}" onchange="handleCountryPillSelectionChangeContext()">
      <label for="${cleanId}">${cleanCountryName}</label>
    `;
  });
}

function handleCountryPillSelectionChangeContext() {
  const selectedCountries = Array.from(document.querySelectorAll('input[name="searchCountryFilter"]:checked')).map(cb => cb.value);
  const stateMount = document.getElementById("location-state-checkboxes-mount");
  const cityMount = document.getElementById("location-city-checkboxes-mount");
  
  stateMount.innerHTML = "";
  if (cityMount) {
    cityMount.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); font-weight:600; margin:0;">Select a state above to generate city filters...</p>';
  }
  
  if (selectedCountries.length === 0) {
    stateMount.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); font-weight:600; margin:0;">Select a country above to generate state filters...</p>';
    return;
  }
  
  let aggregatedStates = new Set();
  selectedCountries.forEach(country => {
    if (globalLocationDatabaseCacheMap[country]) {
      Object.keys(globalLocationDatabaseCacheMap[country]).forEach(state => aggregatedStates.add(state));
    }
  });
  
  const sortedStates = Array.from(aggregatedStates).sort();
  if (sortedStates.length === 0) {
    stateMount.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); margin:0;">No states mapped for the selected country.</p>';
    return;
  }
  
  sortedStates.forEach(state => {
    const cleanStateName = state.toString().trim();
    const cleanId = "state_chk_" + cleanStateName.replace(/\s+/g, '_');
    
    stateMount.innerHTML += `
      <input type="checkbox" name="searchStateFilter" value="${cleanStateName}" id="${cleanId}" onchange="handleStatePillSelectionChangeContext()">
      <label for="${cleanId}">${cleanStateName}</label>
    `;
  });
}

function handleStatePillSelectionChangeContext() {
  const selectedCountries = Array.from(document.querySelectorAll('input[name="searchCountryFilter"]:checked')).map(cb => cb.value);
  const selectedStates = Array.from(document.querySelectorAll('input[name="searchStateFilter"]:checked')).map(cb => cb.value);
  const cityMountPoint = document.getElementById("location-city-checkboxes-mount");
  
  cityMountPoint.innerHTML = "";

  if (selectedCountries.length === 0) {
    cityMountPoint.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); font-weight:600; margin:0;">Select a Country above to generate State filters...</p>';
    return;
  }
  
  if (selectedStates.length === 0) {
    cityMountPoint.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); font-weight:600; margin:0;">Select a State above to generate City filters...</p>';
    return;
  }
  
  let aggregatedCities = [];
  selectedCountries.forEach(country => {
    if (globalLocationDatabaseCacheMap[country]) {
      selectedStates.forEach(state => {
        if (globalLocationDatabaseCacheMap[country][state]) {
          aggregatedCities = aggregatedCities.concat(globalLocationDatabaseCacheMap[country][state]);
        }
      });
    }
  });
  
  aggregatedCities = [...new Set(aggregatedCities)].sort();
  if (aggregatedCities.length === 0) {
    cityMountPoint.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); margin:0;">No cities mapped for the selected states.</p>';
    return;
  }
  
  const allId = "city_chk_ALL_INDICATOR";
  cityMountPoint.innerHTML += `
    <input type="checkbox" id="${allId}" value="ALL" onchange="handleAllCitiesCheckboxOverrideToggle(this)">
    <label for="${allId}" style="background:var(--highlight-bg); border-color:var(--brand); font-weight:700; color:var(--brand);">ALL CITIES</label>
  `;
  
  aggregatedCities.forEach(city => {
     const cleanCityId = "city_chk_" + city.replace(/\s+/g, '_');
     cityMountPoint.innerHTML += `
       <input type="checkbox" name="searchCityFilter" value="${city}" id="${cleanCityId}" onchange="handleIndividualCityPillToggleSelectionContext()">
       <label for="${cleanCityId}">${city}</label>
     `;
  });
}

function handleAllCitiesCheckboxOverrideToggle(allNode) {
   const cityCheckboxes = document.querySelectorAll('input[name="searchCityFilter"]');
   cityCheckboxes.forEach(cb => {
      cb.checked = allNode.checked;
   });
}

function handleIndividualCityPillToggleSelectionContext() {
   const allCitiesCheckbox = document.getElementById("city_chk_ALL_INDICATOR");
   const totalCitiesCount = document.querySelectorAll('input[name="searchCityFilter"]').length;
   const checkedCitiesCount = document.querySelectorAll('input[name="searchCityFilter"]:checked').length;
   
   if (allCitiesCheckbox) {
      allCitiesCheckbox.checked = (totalCitiesCount === checkedCitiesCount && totalCitiesCount > 0);
   }
}

async function triggerCityStateQuerySearchExecution() {
  const btn = document.getElementById("city-state-search-submit-btn");
  const selectedCountries = Array.from(document.querySelectorAll('input[name="searchCountryFilter"]:checked')).map(cb => cb.value);
  const selectedStates = Array.from(document.querySelectorAll('input[name="searchStateFilter"]:checked')).map(cb => cb.value);
  let selectedCities = Array.from(document.querySelectorAll('input[name="searchCityFilter"]:checked')).map(cb => cb.value);
  
  if (selectedCountries.length === 0) return alert("Select at least one Country.");
  if (selectedStates.length === 0) return alert("Select at least one State.");
  if (selectedCities.length === 0) return alert("Select at least one City or 'All Cities'.");
  
  btn.classList.add("loading"); btn.textContent = "Searching...";
  document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
  
  try {
     const data = await apFetch({
       action: "searchLeadsByCityStateMatrix",
       activeEngineer: appActiveOperatorIdentityString,
       countries: selectedCountries,
       states: selectedStates,
       cities: selectedCities
     });
     if (data.success) {
        const canvas = document.getElementById("step2-inline-interaction-canvas");
        
        canvasLastParentWorkspaceId = "workspace-searchCityState";
        document.getElementById("workspace-searchCityState").appendChild(canvas);
        
        document.getElementById("canvas-back-btn-enclosure-row").innerHTML = `
          <div class="qualification-status-bar" style="width:100%; text-align:center; font-size:0.75rem; margin-bottom:10px;">
             Location: [Countries: ${selectedCountries.join(", ")}] [States: ${selectedStates.join(", ")}] | [Cities: ${selectedCities.length > 5 ? 'Multi Selected (' + selectedCities.length + ')' : selectedCities.join(", ")}]
          </div>
        `;
        
        globalFollowUpsCacheMap = data.followups; 
        globalTasksCacheMap = data.tasks;
        buildMultiContactDirectoryInterface(data.leads, "");
        
        canvas.style.display = "block"; 
     } else {
        alert("Geographic search error: " + (data.error || "No records match."));
     }
  } catch (e) {
     alert("Geographic layout request connection crash: " + e.message);
  } finally {
     btn.classList.remove("loading"); btn.textContent = "Search Location";
  }
}

function populateEngineerDropdowns() {
  const el = document.getElementById("engName"); if (!el) return;
  el.innerHTML = '<option value="">— Select —</option>';
  cachedEngineers.forEach(eng => {
    let opt = document.createElement("option"); opt.value = eng.email; opt.textContent = eng.name; el.appendChild(opt);
  });
}

// "Enter Visiting Card Details" (CARD) runs on one shared phone login used by
// multiple marketing staff, so the app genuinely can't know who's holding the
// phone — that screen keeps the manual "ABPS Engineer Name" dropdown. Every
// other entry point into this same form is an individual laptop login, so
// there's no reason to make someone pick their own name from a list every
// time (and it removes the chance of picking the wrong one) — lock it to
// whoever is actually logged in. Falls back to leaving it editable if the
// logged-in display name isn't found in cachedEngineers, rather than locking
// someone out of a field they can't fix.
function applyEngineerFieldLockState() {
  const el = document.getElementById("engName");
  if (!el) return;
  if (currentActiveModuleContext === "CARD") {
    el.disabled = false;
    el.title = "";
    return;
  }
  const self = cachedEngineers.find(eng => eng.name === appActiveOperatorIdentityString);
  if (self) {
    el.value = self.email;
    el.disabled = true;
    el.title = "Set automatically from your logged-in account.";
  } else {
    el.disabled = false;
    el.title = "";
  }
}

function handleOpsFileChange(inputNode, uploadBoxId, confirmationMsg) {
  const fileObj = inputNode.files[0];
  const box = document.getElementById(uploadBoxId);
  if (box && fileObj) {
    if (uploadBoxId === 'dispatch-bill-upload-box') targetDispatchBillFileObj = fileObj;
    else if (uploadBoxId === 'commissioning-report-upload-box') targetCommissioningReportFileObj = fileObj;
    else if (uploadBoxId === 'purchase-order-upload-box') targetPurchaseOrderFileObj = fileObj;
    box.textContent = confirmationMsg;
    box.classList.add('done');
  }
}

/**
 * RESET MASTER ENTRY FORM STATE
 * Clears standard form input trees, resets default dropdown values,
 * wipes newly added custom diagnostic inputs, and collapses visibility panels.
 */
function resetSequentialFormState() {
  document.getElementById('remaining-sections-form').style.display = 'block';
  if (document.getElementById('success-screen')) document.getElementById('success-screen').style.display = 'none';
  
  // 1. Loop and clear all baseline input tags, textareas, and select elements
  const inputs = document.querySelectorAll('#remaining-sections-form input, #remaining-sections-form textarea, #remaining-sections-form select');
  inputs.forEach(input => {
      if(input.type === 'checkbox' || input.type === 'radio') {
          input.checked = false;
      } else if (input.tagName === 'SELECT') {
          // Reset actions checkboxes and dropdown toggles back to standard "No"
          if (['act1', 'act2', 'act3', 'act4', 'actOffer', 'act7'].includes(input.id)) {
              input.value = 'No';
          } else if (input.id !== 'dropform-status') {
              // Section 3 engineering diagnostic select dropdowns are set empty by default
              input.value = ''; 
          }
      } else if (input.id !== 'dropform-company-locked') {
          input.value = '';
      }
  });

  // 2. Explicitly target and reset newly integrated custom layout form elements
  if (document.getElementById("dropform-city")) document.getElementById("dropform-city").value = "";
  if (document.getElementById("dropform-state")) document.getElementById("dropform-state").value = "";
  if (document.getElementById("dropform-country")) document.getElementById("dropform-country").value = "";
  if (document.getElementById("purchaseInquire")) document.getElementById("purchaseInquire").value = "";
  if (document.getElementById("tenderInquire")) document.getElementById("tenderInquire").value = "";
  if (document.getElementById("esd")) document.getElementById("esd").value = "";

  // 3. Reset visibility layouts back to hidden defaults
  document.querySelectorAll('.other-input, #vendor-fields').forEach(el => el.style.display = 'none');
}

function toggleOtherText(r, id) {
  document.getElementById(id).style.display = (r.value === 'Other') ? 'block' : 'none';
}
function toggleOtherCheck(c, id) {
  document.getElementById(id).style.display = c.checked ? 'block' : 'none';
}
function handleQualChange() {
  document.getElementById('vendor-fields').style.display = document.getElementById('q8').checked ? 'block' : 'none';
  document.getElementById('qualificationOther').style.display = document.getElementById('q9').checked ? 'block' : 'none';
}
function toggleDropdownNo(selectNode, inputId) {
  const targetInput = document.getElementById(inputId);
  if (selectNode.value === "No") {
    targetInput.value = "No";
  } else if (targetInput.value === "No") {
    targetInput.value = "";
  }
}

function collapseNewEntryDropdownFormExplicitly() {
  document.getElementById("step2-new-entry-dropdown").style.display = "none";
  document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none";
  // The top-left header Create New Entry / Collapse Form pair is never used
  // in Card Details (CARD) or Search by Company Name (DROPDOWN) — those
  // screens only ever open the form via the in-page banner button, and
  // close it via Cancel & Back, so this pair stays hidden for both.
}

function revealNewEntryFormDropdown() { 
  const container = (currentActiveModuleContext === "CARD") ? "workspace-cardDetails" : "workspace-searchCompany";
  const dropdownEl = document.getElementById("step2-new-entry-dropdown");
  
  if (!dropdownEl) return;
  document.getElementById(container).appendChild(dropdownEl);
  // appendChild always lands the form at the END of the panel — hide any
  // search-results canvas already rendered above it (matches
  // revealNewEntryFormDropdownFromBanner's already-established pattern),
  // otherwise stale/unrelated result cards sit above the form and its
  // success message, reading as if they belong to this submission.
  const resultsCanvas = document.getElementById("step2-inline-interaction-canvas");
  if (resultsCanvas) resultsCanvas.style.display = "none";

  // These fields duplicate what's already entered in "Business Card Information" when
  // arriving via CARD mode — hide them there. In DROPDOWN mode (Search Company) they're
  // the only place to enter this data, so keep them visible.
  const dupBlock = document.getElementById("dropform-duplicate-fields-block");
  if (dupBlock) dupBlock.style.display = (currentActiveModuleContext === "CARD") ? "none" : "block";

  let companyName = "";
  let contactName = "";
  
  // FIXED: Explicitly retain typed contact person names across both CARD and DROPDOWN contexts safely
  if (currentActiveModuleContext === "CARD") {
      companyName = document.getElementById("f-company") ? document.getElementById("f-company").value.trim() : "";
      contactName = document.getElementById("f-name") ? document.getElementById("f-name").value.trim() : "";
  } else if (currentActiveModuleContext === "DROPDOWN") {
      companyName = activeSearchCompany || "";
      // Prioritize whatever text was typed inside the primary dashboard layout contact elements fields
      contactName = document.getElementById("f-name") && document.getElementById("f-name").value.trim() !== "" 
                    ? document.getElementById("f-name").value.trim() 
                    : (document.getElementById("dropform-name") ? document.getElementById("dropform-name").value.trim() : "");
  } else {
      // lookup-module-company-dropdown is a type-to-search text input now
      // (was a <select>) — .value is already the clean company name, no
      // .options/.selectedIndex to read.
      const dropdown = document.getElementById("lookup-module-company-dropdown");
      if (dropdown && dropdown.value) {
        companyName = dropdown.value.split(" (")[0].trim();
      }
  }
  
  const companyLockInp = document.getElementById("dropform-company-locked");
  if (companyLockInp) {
    companyLockInp.value = companyName || "No Company Specified";
  }
  
  // FIXED: Sync text context elements parameters securely without dropping user input data
  if (document.getElementById("dropform-name")) {
    document.getElementById("dropform-name").value = contactName;
  }
  
  if (document.getElementById("dropform-position")) document.getElementById("dropform-position").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-position")) ? document.getElementById("f-position").value : "";
  if (document.getElementById("dropform-phone")) document.getElementById("dropform-phone").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-phone")) ? document.getElementById("f-phone").value : "";
  if (document.getElementById("dropform-altphone")) document.getElementById("dropform-altphone").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-altphone")) ? document.getElementById("f-altphone").value : "";
  if (document.getElementById("dropform-email")) document.getElementById("dropform-email").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-email")) ? document.getElementById("f-email").value : "";
  if (document.getElementById("dropform-website")) document.getElementById("dropform-website").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-website")) ? document.getElementById("f-website").value : "";
  if (document.getElementById("dropform-city")) document.getElementById("dropform-city").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-city")) ? document.getElementById("f-city").value : "";
  if (document.getElementById("dropform-state")) document.getElementById("dropform-state").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-state")) ? document.getElementById("f-state").value : "";
  if (document.getElementById("dropform-country")) document.getElementById("dropform-country").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-country")) ? document.getElementById("f-country").value : "";
  if (document.getElementById("dropform-address")) document.getElementById("dropform-address").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-address")) ? document.getElementById("f-address").value : "";

  // Neither header button is ever shown in CARD/DROPDOWN — Cancel & Back
  // (staged-back-button-row) is the only way out of this form on these screens.
  if (document.getElementById("global-direct-inline-create-entry-btn")) document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
  if (document.getElementById("global-direct-inline-collapse-entry-btn")) document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none";

  const rowNode = document.getElementById("staged-back-button-row");
  if (rowNode) rowNode.style.display = "flex";

  applyEngineerFieldLockState();
  dropdownEl.style.display = "block";
  window.scrollTo(0,0);
}

function revealNewEntryFormDropdownFromBanner() {
  const dropdownEl = document.getElementById("step2-new-entry-dropdown");
  if (!dropdownEl) return;
  
  document.getElementById("step2-inline-interaction-canvas").style.display = "none";
  const parentId = (currentActiveModuleContext === "CARD") ? "workspace-cardDetails" : "workspace-searchCompany";
  document.getElementById(parentId).appendChild(dropdownEl);

  // Unlike revealNewEntryFormDropdown() (the plain/global "no match at all" entry point),
  // this banner path represents "add a new contact to a company we already matched" —
  // always show the fields here so the person can confirm/edit the new contact's details,
  // even in CARD mode.
  const dupBlockFromBanner = document.getElementById("dropform-duplicate-fields-block");
  if (dupBlockFromBanner) dupBlockFromBanner.style.display = "block";
  
  if (document.getElementById("dropform-company-locked")) {
    document.getElementById("dropform-company-locked").value = activeSearchCompany || "";
  }
  
  // FIXED: Read from the form value first, then fallback to search input fields properties
  if (document.getElementById("dropform-name")) {
    document.getElementById("dropform-name").value = document.getElementById("dropform-name").value.trim() || (document.getElementById("f-name") ? document.getElementById("f-name").value.trim() : "");
  }
  
  if (document.getElementById("dropform-position")) document.getElementById("dropform-position").value = document.getElementById("f-position") ? document.getElementById("f-position").value : "";
  if (document.getElementById("dropform-phone")) document.getElementById("dropform-phone").value = document.getElementById("f-phone") ? document.getElementById("f-phone").value : "";
  if (document.getElementById("dropform-altphone")) document.getElementById("dropform-altphone").value = document.getElementById("f-altphone") ? document.getElementById("f-altphone").value : "";
  if (document.getElementById("dropform-email")) document.getElementById("dropform-email").value = document.getElementById("f-email") ? document.getElementById("f-email").value : "";
  if (document.getElementById("dropform-website")) document.getElementById("dropform-website").value = document.getElementById("f-website") ? document.getElementById("f-website").value : "";
  if (document.getElementById("dropform-city")) document.getElementById("dropform-city").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-city")) ? document.getElementById("f-city").value : "";
  if (document.getElementById("dropform-state")) document.getElementById("dropform-state").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-state")) ? document.getElementById("f-state").value : "";
  if (document.getElementById("dropform-country")) document.getElementById("dropform-country").value = (currentActiveModuleContext === "CARD" && document.getElementById("f-country")) ? document.getElementById("f-country").value : "";
  if (document.getElementById("dropform-address")) document.getElementById("dropform-address").value = document.getElementById("f-address") ? document.getElementById("f-address").value : "";

  if (document.getElementById("global-direct-inline-create-entry-btn")) document.getElementById("global-direct-inline-create-entry-btn").style.display = "none"; 
  if (document.getElementById("global-direct-inline-collapse-entry-btn")) document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none"; 
  
  const rowNode = document.getElementById("staged-back-button-row");
  if (rowNode) rowNode.style.display = "flex";

  applyEngineerFieldLockState();
  dropdownEl.style.display = "block";
  window.scrollTo(0,0);
}

function returnToDirectoryCardsFromFormView() {
  document.getElementById("step2-new-entry-dropdown").style.display = "none";
  document.getElementById("staged-back-button-row").style.display = "none";
  // The top-left header pair is never used on Card Details or Search by
  // Company — the in-page banner button (e.g. reveal-new-entry-btn) is the
  // only Create New Entry control on these screens.
  document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
  document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none";
  document.getElementById("step2-inline-interaction-canvas").style.display = "block";
}

/**
 * CONTACT CARDS LIST LAYOUT BUILDER
 * Generates interactive summary listings for all employee rows matched under target entities search routes,
 * explicitly pointing to updated column headers schemas.
 */
function buildMultiContactDirectoryInterface(leadsList, targetSearchName, containerId) {
  const container = document.getElementById(containerId || "multi-contact-records-container");
  container.innerHTML = "";
  const sanitizedTargetName = targetSearchName ? targetSearchName.toString().replace(/\s+/g, '').toLowerCase() : "";

  leadsList.sort((a, b) => {
    // FIXED: Shifted lookups to read "Contact Person Name" instead of old "Name" key
    let aNameClean = (a["Contact Person Name"] || "").toString().replace(/\s+/g, '').toLowerCase();
    let bNameClean = (b["Contact Person Name"] || "").toString().replace(/\s+/g, '').toLowerCase();
    let aMatches = (sanitizedTargetName !== "" && aNameClean === sanitizedTargetName);
    let bMatches = (sanitizedTargetName !== "" && bNameClean === sanitizedTargetName);
    if (aMatches && !bMatches) return -1;
    if (!aMatches && bMatches) return 1;
    return parseInt(b["Lead ID"].split("-")[1]) - parseInt(a["Lead ID"].split("-")[1]);
  });

  leadsList.forEach(lead => {
    let tRef = lead["Lead ID"];
    let wrapperCard = document.createElement("div");
    wrapperCard.className = "contact-summary-card-parent";
    wrapperCard.id = `contact-parent-wrapper-${tRef}`;
    
    // FIXED: Use correct column header fields references strings keys
    let cardDisplayName = (lead["Contact Person Name"] && lead["Contact Person Name"].toString().trim() !== "") ? lead["Contact Person Name"] : "Unspecified Name";
    let companyLabelName = lead["Company Name"] || "Unspecified Company";
    
    if (sanitizedTargetName !== "" && cardDisplayName.toString().replace(/\s+/g, '').toLowerCase() === sanitizedTargetName) {
      wrapperCard.className += " search-highlighted-focus-node";
    }

    const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
    const escForOnclick = s => (s || "").toString().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const deleteButtonHtml = isAdminUser 
      ? `<button class="nav-btn-styled" style="font-size:0.92rem; padding:6px 14px; background:var(--warn);" onclick="removeLeadRowEntirely('${tRef}', '${escForOnclick(companyLabelName)}', '${escForOnclick(cardDisplayName)}')">Delete Record</button>` 
      : ""; // Non-admins get absolutely nothing rendered

    wrapperCard.innerHTML = `
      <div class="contact-summary-header-row" style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px;">
        <div class="contact-summary-title-info" style="flex:1; display:grid; grid-template-columns: minmax(220px, 1fr) minmax(200px, 1fr); gap:10px 24px;">
          <div class="meta-pair" style="display:flex; align-items:baseline; gap:8px; min-width:0;">
            <span style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--muted); flex-shrink:0;">Company</span>
            <strong style="font-size:0.95rem; overflow-wrap:anywhere;">${companyLabelName}</strong>
          </div>
          <div class="meta-pair" style="display:flex; align-items:baseline; gap:8px; min-width:0;">
            <span style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--muted); flex-shrink:0;">Status</span>
            <strong id="card-lbl-status-${tRef}" style="font-size:0.95rem;">${lead["Status"] || "N/A"}</strong>
          </div>
          <div class="meta-pair" style="display:flex; align-items:baseline; gap:8px; min-width:0;">
            <span style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--muted); flex-shrink:0;">Name</span>
            <strong id="card-lbl-name-${tRef}" style="font-size:0.95rem; overflow-wrap:anywhere;">${cardDisplayName}</strong>
          </div>
          <div class="meta-pair" style="display:flex; align-items:baseline; gap:8px; min-width:0;">
            <span style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--muted); flex-shrink:0;">Position</span>
            <strong id="card-lbl-pos-${tRef}" style="font-size:0.95rem;">${lead["Position"] || "Unspecified"}</strong>
          </div>
        </div>
        <div class="directory-btn-actions-block" style="display:flex; gap:8px; flex-shrink:0;">
          <button class="nav-btn-styled" style="font-size:0.92rem; padding:6px 14px;" onclick="toggleContactExpansionView('${tRef}', \`${encodeURIComponent(JSON.stringify(lead))}\`)" id="expand-trigger-${tRef}">View Details</button>
          ${deleteButtonHtml}
        </div>
      </div>
      <div class="contact-expanded-workspace-payload-drawer" id="drawer-panel-${tRef}" style="display:none; padding-top:4px;">
        <div class="leads-editable-fields-box-canvas" id="canvas-fields-${tRef}"></div>
        <div class="child-injected-modules-mount-point" id="modules-mount-${tRef}" style="margin-top:10px;"></div>
      </div>
    `;
    container.appendChild(wrapperCard);
  });
}

function toggleContactExpansionView(leadRef, encodedLeadMap) {
  const drawer = document.getElementById(`drawer-panel-${leadRef}`);
  const triggerBtn = document.getElementById(`expand-trigger-${leadRef}`);
  const mountPoint = document.getElementById('modules-mount-' + leadRef);
  
  if (drawer.style.display === "block") {
    drawer.style.display = "none"; triggerBtn.textContent = "View Details"; mountPoint.innerHTML = ""; 
  } else {
    document.querySelectorAll(".contact-expanded-workspace-payload-drawer").forEach(d => d.style.display = "none");
    document.querySelectorAll('[id^="expand-trigger-"]').forEach(b => b.textContent = "View Details");
    document.querySelectorAll(".child-injected-modules-mount-point").forEach(m => m.innerHTML = "");

    // Show the drawer BEFORE building its form — buildTargetedLeadsFormCanvas
    // auto-sizes every textarea off scrollHeight, which is always 0 inside a
    // display:none ancestor. That silently collapsed every text field (Contact
    // Person Name, Position, Phone, City, etc.) to zero height, making populated
    // data look blank even though .value was set correctly the whole time.
    drawer.style.display = "block"; triggerBtn.textContent = "Collapse Details";

    const leadMap = JSON.parse(decodeURIComponent(encodedLeadMap));
    activeSearchRef = leadRef;
    buildTargetedLeadsFormCanvas(leadRef, leadMap);
    
    const templateSource = document.getElementById("reusable-child-modules-template");
    if (!templateSource) {
      console.error("View Details broken: reusable-child-modules-template not found in DOM.");
      return;
    }
    const templateClone = templateSource.cloneNode(true);
    templateClone.style.display = "block"; templateClone.id = 'active-modules-clone-' + leadRef;
    
    setupIsolatedModuleTriggersAndActions(leadRef, templateClone);
    mountPoint.appendChild(templateClone);
    
    currentFollowUpCount = globalFollowUpsCacheMap[leadRef] ? globalFollowUpsCacheMap[leadRef].length : 0;
    renderIsolatedFollowUpTimeline(leadRef, globalFollowUpsCacheMap[leadRef] || [], templateClone);
    renderIsolatedTaskItemsList(leadRef, globalTasksCacheMap[leadRef] || [], templateClone);
    renderIsolatedDocumentInfoSection(leadRef, leadMap["Lead ID"] || leadRef, templateClone);
  }
}

function setupIsolatedModuleTriggersAndActions(leadRef, nodeScope) {
  const fupForm = nodeScope.querySelector(".template-fup-form");
  const fupOpen = nodeScope.querySelector(".trigger-fup-open");
  const fupClose = nodeScope.querySelector(".trigger-fup-close");
  const fupEngSelect = nodeScope.querySelector(".fup-eng-select");
  
  fupEngSelect.innerHTML = '<option value="">— Select Engineer —</option>';
  cachedEngineers.forEach(eng => {
    let o1 = document.createElement("option"); o1.value = eng.email; o1.textContent = eng.name; fupEngSelect.appendChild(o1);
  });
  const fupSelfEngineer = cachedEngineers.find(eng => eng.name === appActiveOperatorIdentityString);
  if (fupSelfEngineer) fupEngSelect.value = fupSelfEngineer.email;

  fupOpen.onclick = function() {
    fupForm.querySelector(".fup-is-edit-flag").value = "false";
    fupForm.querySelector(".fup-num-input").value = currentFollowUpCount + 1;
    fupForm.querySelector(".fup-leadid-input").value = leadRef;
    fupForm.querySelector(".fup-notes-input").value = ""; fupForm.querySelector(".fup-nexttarget-input").value = "";
    fupForm.style.display = "grid"; fupOpen.style.display = "none"; fupClose.style.display = "inline-flex";
    const fupLabel = nodeScope.querySelector(".fup-status-label"); if (fupLabel) fupLabel.style.display = "inline";
  };
  
  fupClose.onclick = function() {
    fupForm.style.display = "none"; fupOpen.style.display = "inline-flex"; fupClose.style.display = "none";
    const fupLabel = nodeScope.querySelector(".fup-status-label"); if (fupLabel) fupLabel.style.display = "none";
  };
  nodeScope.querySelector(".commit-fup-btn-trigger").onclick = function() { commitIsolatedFollowUpItem(leadRef, nodeScope); };

  const taskForm = nodeScope.querySelector(".template-task-form");
  const taskOpen = nodeScope.querySelector(".trigger-task-open");
  const taskClose = nodeScope.querySelector(".trigger-task-close");
  const taskEngSelect = nodeScope.querySelector(".task-eng-select");
  const taskAssignerSelect = nodeScope.querySelector(".task-assigner-select");

  taskEngSelect.innerHTML = '<option value="">— Select Engineer —</option>';
  taskAssignerSelect.innerHTML = '<option value="">— Select Engineer —</option>';
  cachedEngineers.forEach(eng => {
    let o2 = document.createElement("option"); o2.value = eng.email; o2.textContent = eng.name; taskEngSelect.appendChild(o2);
    let o3 = document.createElement("option"); o3.value = eng.email; o3.textContent = eng.name; taskAssignerSelect.appendChild(o3);
  });
  const taskSelfEngineer = cachedEngineers.find(eng => eng.name === appActiveOperatorIdentityString);
  if (taskSelfEngineer) {
    taskEngSelect.value = taskSelfEngineer.email;
    taskAssignerSelect.value = taskSelfEngineer.email;
  }

  taskOpen.onclick = function() {
    taskForm.querySelector(".task-edit-id").value = ""; taskForm.querySelector(".task-desc-input").value = "";
    taskForm.querySelector(".task-targetdate-input").value = ""; taskForm.querySelector(".task-status-select").value = "Assigned";
    taskForm.style.display = "grid"; taskOpen.style.display = "none"; taskClose.style.display = "inline-flex";
    const taskLabel = nodeScope.querySelector(".task-status-label"); if (taskLabel) taskLabel.style.display = "inline";
  };
  taskClose.onclick = function() {
    taskForm.style.display = "none"; taskOpen.style.display = "inline-flex"; taskClose.style.display = "none";
    const taskLabel = nodeScope.querySelector(".task-status-label"); if (taskLabel) taskLabel.style.display = "none";
  };
  nodeScope.querySelector(".commit-task-btn-trigger").onclick = function() { commitIsolatedTaskItem(leadRef, nodeScope); };
}

/**
 * DYNAMIC LEAD COMPONENT CANVAS BUILDER
 * Generates an editable grid interface for a specific account record card,
 * implementing custom field groupings, optimized block alignments, and wide flex constraints.
 */
function buildTargetedLeadsFormCanvas(leadRef, leadMap) {
  const canvas = document.getElementById('canvas-fields-' + leadRef); 
  if (!canvas) return;
  canvas.innerHTML = "";
  
  const gridWrapper = document.createElement("div"); 
  gridWrapper.className = "compact-fields-grid";
  
  // Helper utility to strip core selection pills out of custom data inputs arrays
  const extractOthersValueText = (rawStr, coreOptions) => {
    if (!rawStr) return "";
    const items = rawStr.split(",").map(v => v.trim());
    const lowerCore = coreOptions.map(c => c.toLowerCase());
    const others = items.filter(i => lowerCore.indexOf(i.toLowerCase()) === -1);
    return others.join(", ");
  };
  
  // MATCHED LAYOUT BLUEPRINT Blueprints
  const customSectionLayout = [
    { type: "META", keys: ["Status", "Engineer Name"] },
    { type: "CARD", keys: ["Contact Person Name", "Company Name", "Position", "Phone", "Alt Phone", "Email", "Website", "City", "State", "Country", "Company Address"] },
    { type: "SEC1", keys: ["Date of Meeting", "Time of Meeting", "Meeting Venue", "Venue Name / City", "Additional Meeting Details (if any)"] },
    { type: "SEC2", keys: ["ABPS Business Vertical", "Type of Customer", "Type of Vendor"] }, 
    { type: "SEC3", keys: ["Low Power Factor Issue", "High Electricity Bill Issue", "Harmonics Issue", "Transformer Heating / Breakdown Issue", "Grid Stability Issue", "Tender Inquire", "Existing System Details", "Contract Demand (MVA)", "Voltage Level Requirements"] }, 
    { type: "SEC4", keys: ["Existing Project", "Products Discussed", "Expected Tender / RFQ Date", "Approx Requirement", "Technical Discussion Summary", "Competitor Details", "Approx Business Potential"] },
    { type: "SEC5", keys: ["Send Company Profile", "Send Technical Presentation", "Arrange Site Visit", "Get Enquiry", "Send Offer", "Follow-Up Required"] },

  ];

  customSectionLayout.forEach((sec, secIdx) => {
    if (secIdx > 0) {
      let line = document.createElement("div"); 
      line.className = "section-divider-line"; 
      gridWrapper.appendChild(line);
    }
    
    sec.keys.forEach(key => {
      let cell = document.createElement("div"); 
      cell.className = "grid-cell-item";
      
      // GRID GEOMETRY MANAGEMENT
      if ([
        "Technical Discussion Summary", "Additional Meeting Details (if any)",
        "Company Address"
      ].indexOf(key) !== -1) {
        cell.className += " span-two-units";
      }

      if (key === "Existing Project") cell.style.gridColumn = "span 2";

      // Grid column spans — 6-col desktop grid
      if (key === "ABPS Business Vertical")         cell.style.gridColumn = "span 2";
      if (key === "Type of Customer")               cell.style.gridColumn = "span 2";
      if (key === "Type of Vendor")                 cell.style.gridColumn = "span 2";
      if (key === "Contract Demand (MVA)")          cell.style.gridColumn = "span 2";
      if (key === "Voltage Level Requirements")     cell.style.gridColumn = "span 2";
      if (key === "Existing System Details")        cell.style.gridColumn = "span 2";
      if (key === "Expected Tender / RFQ Date")     cell.style.gridColumn = "span 1";
      if (key === "Approx Requirement")             cell.style.gridColumn = "span 1";
      if (key === "Products Discussed")             cell.style.gridColumn = "span 2";

      let label = document.createElement("label");
      // Display-only relabel — the underlying key/dataset.headerKey stays
      // "Engineer Name" to match the backend's column alias unchanged.
      const displayKeyText = (key === "Engineer Name") ? "ABPS Engineer Name" : key;
      label.textContent = (["Date of Meeting", "ABPS Business Vertical"].indexOf(key) !== -1) ? displayKeyText + " *" : displayKeyText;
      cell.appendChild(label);

      // --- 1. CORE PIPELINE CONTROLLER ROUTINES ---
      if (key === "Status") {
        let sel = document.createElement("select"); sel.className = 'live-lead-field-input-' + leadRef; sel.dataset.headerKey = key;
        [
          "New Lead", "Technical Discussion", "Inquire Received", "Offer Sent", 
          "Order Received", "Order Dispatched", "Product Commissioned", "Lead Failed", "Order not Received"
        ].forEach(st => {
          let op = document.createElement("option"); op.textContent = st; if(leadMap[key] === st) op.selected = true; sel.appendChild(op);
        });
        cell.appendChild(sel);  
      } 
      else if (key === "Date of Meeting") {
        let inp = document.createElement("input"); inp.type = "date"; inp.className = 'live-lead-field-input-' + leadRef; inp.dataset.headerKey = key;
        let rawDate = leadMap[key];
        if (rawDate) { let match = rawDate.toString().match(/(\d{4}-\d{2}-\d{2})/); inp.value = match ? match[1] : ""; }
        cell.appendChild(inp);
      } 
      else if (key === "Time of Meeting") {
        let inp = document.createElement("input"); inp.type = "time"; inp.className = 'live-lead-field-input-' + leadRef; inp.dataset.headerKey = key;
        let rawTime = leadMap[key];
        if (rawTime) { let timeMatch = rawTime.toString().match(/(\d{1,2}:\d{2})/); inp.value = timeMatch ? timeMatch[0] : ""; }
        cell.appendChild(inp);
      } 
      else if (key === "Engineer Name") {
        let sel = document.createElement("select"); sel.className = 'live-lead-field-input-' + leadRef; sel.dataset.headerKey = key;
        // leadMap["Engineer Name"] is now a resolved display name (from the
        // COALESCE in LEAD_CARD_SELECT), so match against eng.name here —
        // but the option's actual value must still be the email, since
        // that's what gets sent back on save.
        cachedEngineers.forEach(eng => {
          let op = document.createElement("option"); op.value = eng.email; op.textContent = eng.name;
          if (leadMap[key] === eng.name) op.selected = true;
          sel.appendChild(op);
        });
        cell.appendChild(sel);
      } 
      else if (key === "Send Offer") {
        let sel = document.createElement("select"); sel.className = 'live-lead-field-input-' + leadRef; sel.dataset.headerKey = key;
        ["No", "Send Budgetary Offer", "Send Techno-Commercial Offer"].forEach(opText => {
          let op = document.createElement("option"); op.textContent = opText; if(leadMap[key] === opText) op.selected = true; sel.appendChild(op);
        });
        cell.appendChild(sel);
      }
      else if (key === "Approx Business Potential") {
        let sel = document.createElement("select"); sel.className = 'live-lead-field-input-' + leadRef; sel.dataset.headerKey = key;
        ["<10L", "10-50L", "50L-2cr", ">2cr"].forEach(opText => {
          let op = document.createElement("option"); op.textContent = opText; if(leadMap[key] === opText) op.selected = true; sel.appendChild(op);
        });
        cell.appendChild(sel);
      }
      
      // FIXED DESIGN BLOCK: Combined vertical dropdown layout fields inputs mapping box
      else if (key === "ABPS Business Vertical") {
        label.style.display = "none";
        cell.style.background = "transparent"; cell.style.border = "none"; cell.style.padding = "0";
        
        let container = document.createElement("div");
        container.style.cssText = "display: flex; flex-direction: column; gap: 8px; width: 100%;";
        
        let subCellBv = document.createElement("div"); subCellBv.className = "grid-cell-item";
        subCellBv.innerHTML = `<label class="field-label" style="margin-top:0;">ABPS Business Vertical *</label>`;
        let sel = document.createElement("select"); sel.className = 'live-lead-field-input-' + leadRef; sel.dataset.headerKey = key;
        const opts = ["Industrial", "Power", "Renewable", "Other"];
        let isOther = leadMap[key] && opts.indexOf(leadMap[key].toString().trim()) === -1 && leadMap[key].toString().trim() !== "";
        opts.forEach(o => {
          let op = document.createElement("option"); op.textContent = o; 
          if(leadMap[key] === o || (o === "Other" && isOther)) op.selected = true; 
          sel.appendChild(op);
        });
        let otherInp = document.createElement("input"); otherInp.type = "text";
        otherInp.id = `live-bv-other-${leadRef}`; otherInp.placeholder = "Specify other vertical...";
        otherInp.style.marginTop = "4px"; otherInp.style.display = isOther ? "block" : "none";
        otherInp.value = isOther ? leadMap[key] : "";
        sel.onchange = function() { otherInp.style.display = (sel.value === "Other") ? "block" : "none"; };
        subCellBv.appendChild(sel); subCellBv.appendChild(otherInp);
        
        let subCellInd = document.createElement("div"); subCellInd.className = "grid-cell-item";
        subCellInd.innerHTML = `<label class="field-label" style="margin-top:0;">Type of Industry</label>
                                <textarea rows="1" class="live-lead-field-input-${leadRef}" data-header-key="Type of Industry" placeholder="e.g. Cement, Steel" oninput="autoGrowPoField(this)" onfocus="autoGrowPoField(this)">${escapeHtml(leadMap["Type of Industry"] || "")}</textarea>`;
        
        container.appendChild(subCellBv); container.appendChild(subCellInd);
        cell.appendChild(container);
      }
      
      else if (["Meeting Venue", "Send Company Profile", "Send Technical Presentation", "Arrange Site Visit", "Get Enquiry", "Send Offer", "Follow-Up Required"].indexOf(key) !== -1) {
        let sel = document.createElement("select"); sel.className = 'live-lead-field-input-' + leadRef; sel.dataset.headerKey = key;
        let opts = ["No", "Yes"];
        if(key === "Meeting Venue") opts = ["ABPS Office", "Exhibition", "Customer's Place", "Other"];
        // Send Company Profile / Send Technical Presentation / Arrange Site
        // Visit / Get Enquiry / Follow-Up Required are real Postgres BOOLEAN
        // columns — pg returns those as JS true/false, not the strings
        // "Yes"/"No" this dropdown compares against. A strict === always
        // failed for both options, so every one of these fields silently
        // rendered as unselected/defaulting to "No" regardless of the real
        // stored value. Normalize to a Yes/No string before comparing so it
        // works for both the boolean columns and Send Offer (a plain TEXT
        // column already storing "Yes"/"No" directly, migration 017).
        const rawVal = leadMap[key];
        const normalizedVal = (typeof rawVal === "boolean") ? (rawVal ? "Yes" : "No") : rawVal;
        opts.forEach(o => {
          let op = document.createElement("option"); op.textContent = o; if(normalizedVal === o) op.selected = true; sel.appendChild(op);
        });
        cell.appendChild(sel);
      } 
      
      // --- 2. REGIONAL FINANCIAL DATA SUBSET SPLIT ---
      else if (key === "Contract Demand (MVA)") {
        label.style.display = "none"; 
        let wrapper = document.createElement("div"); wrapper.style.cssText = "display: flex; flex-direction: column; gap: 6px; padding: 4px 0;";
        wrapper.innerHTML = `
          <div><span style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Contract Demand (MVA)</span><input type="number" step="any" min="0" class="live-lead-field-input-${leadRef}" data-header-key="Contract Demand (MVA)" value="${formatQtyTrimmed(leadMap["Contract Demand (MVA)"])}"></div>
          <div><span style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Running Demand (MVA)</span><input type="number" step="any" min="0" class="live-lead-field-input-${leadRef}" data-header-key="Running Demand (MVA)" value="${formatQtyTrimmed(leadMap["Running Demand (MVA)"])}"></div>
          <div><span style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Monthly Average Power Factor</span><input type="number" step="any" class="live-lead-field-input-${leadRef}" data-header-key="Monthly Average Power Factor" value="${formatQtyTrimmed(leadMap["Monthly Average Power Factor"])}"></div>
        `;
        cell.appendChild(wrapper);
      } 
      
      // --- 3. PROJECT MONITOR TIMELINE TRACKERS ---
      else if (key === "Expected Tender / RFQ Date") {
        label.style.display = "none";
        cell.style.gridColumn = "span 1";
        let wrapper = document.createElement("div"); wrapper.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
        let rawDate = leadMap["Expected Tender / RFQ Date"];
        let cleanDate = "";
        if (rawDate) { let match = rawDate.toString().match(/(\d{4}-\d{2}-\d{2})/); cleanDate = match ? match[1] : ""; }
        
        wrapper.innerHTML = `
          <div><span style="font-size:0.62rem; font-weight:700; color:var(--brand); text-transform:uppercase;">Expected Tender / RFQ Date</span><input type="date" class="live-lead-field-input-${leadRef}" data-header-key="Expected Tender / RFQ Date" value="${cleanDate}"></div>
          <div><span style="font-size:0.62rem; font-weight:700; color:var(--brand); text-transform:uppercase;">Expected Order Timeline</span><textarea rows="1" class="live-lead-field-input-${leadRef}" data-header-key="Expected Order Timeline" oninput="autoGrowPoField(this)" onfocus="autoGrowPoField(this)">${escapeHtml(leadMap["Expected Order Timeline"] || "")}</textarea></div>
        `;
        cell.appendChild(wrapper);
      }

      else if (key === "Existing Project") {
        label.style.display = "none";
        let wrapper = document.createElement("div"); wrapper.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
        wrapper.innerHTML = `
          <div><span style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Existing Project</span><textarea rows="1" class="live-lead-field-input-${leadRef}" data-header-key="Existing Project" oninput="autoGrowPoField(this)" onfocus="autoGrowPoField(this)">${escapeHtml(leadMap["Existing Project"] || "")}</textarea></div>
          <div><span style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Upcoming Project</span><textarea rows="1" class="live-lead-field-input-${leadRef}" data-header-key="Upcoming Project" oninput="autoGrowPoField(this)" onfocus="autoGrowPoField(this)">${escapeHtml(leadMap["Upcoming Project"] || "")}</textarea></div>
        `;
        cell.appendChild(wrapper);
      }

      // FIXED DESIGN BLOCK: Repositioned Tender + Purchase inquiries to line up at the start of the clean row matrix line item
      else if (key === "Tender Inquire") {
        label.style.display = "none";
        let wrapper = document.createElement("div"); wrapper.style.cssText = "display: flex; flex-direction: column; gap: 6px; width:100%;";
        wrapper.innerHTML = `
          <div><span style="font-size:0.58rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Tender Inquire</span><textarea rows="1" class="live-lead-field-input-${leadRef}" data-header-key="Tender Inquire" placeholder="Name of End User" oninput="autoGrowPoField(this)" onfocus="autoGrowPoField(this)">${escapeHtml(leadMap["Tender Inquire"] || "")}</textarea></div>
          <div><span style="font-size:0.58rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Purchase Inquire</span><textarea rows="1" class="live-lead-field-input-${leadRef}" data-header-key="Purchase Inquire" placeholder="Name of End User" oninput="autoGrowPoField(this)" onfocus="autoGrowPoField(this)">${escapeHtml(leadMap["Purchase Inquire"] || "")}</textarea></div>
        `;
        cell.appendChild(wrapper);
      }

      // FIXED DESIGN BLOCK: Positioned directly adjacent to the inquiries cell block wrapper panel element
      else if (key === "Existing System Details") {
        label.style.display = "none";
        let wrapper = document.createElement("div"); wrapper.style.cssText = "display: flex; flex-direction: column; gap: 6px; width:100%;";
        wrapper.innerHTML = `
          <div><span style="font-size:0.58rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Existing System Details</span><textarea rows="1" class="live-lead-field-input-${leadRef}" data-header-key="Existing System Details" oninput="autoGrowPoField(this)" onfocus="autoGrowPoField(this)">${escapeHtml(leadMap["Existing System Details"] || "")}</textarea></div>
          <div><span style="font-size:0.58rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Problem Observed</span><textarea rows="1" class="live-lead-field-input-${leadRef}" data-header-key="Problem Observed" oninput="autoGrowPoField(this)" onfocus="autoGrowPoField(this)">${escapeHtml(leadMap["Problem Observed"] || "")}</textarea></div>
        `;
        cell.appendChild(wrapper);
      }

      // --- 6. SECTION 3 FREE-TEXT DIAGNOSTIC FIELDS ---
      else if (["Low Power Factor Issue", "High Electricity Bill Issue", "Harmonics Issue", "Transformer Heating / Breakdown Issue", "Grid Stability Issue"].indexOf(key) !== -1) {
        let inp = document.createElement("textarea"); inp.rows = 1;
        inp.className = 'live-lead-field-input-' + leadRef; inp.dataset.headerKey = key;
        inp.value = leadMap[key] || "";
        inp.placeholder = "Describe, if any";
        inp.oninput = function() { autoGrowPoField(this); };
        inp.onfocus = function() { autoGrowPoField(this); };
        cell.appendChild(inp);
      }

      // --- 7. VENDOR SELECTION AND CONDITIONAL CONTENT LOOPS ---
      else if (key === "Type of Vendor") {
        label.textContent = "Vendor Specifications";
        let mainWrapper = document.createElement("div"); mainWrapper.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
        let currentValues = (leadMap[key] || "").toString().split(",").map(v => v.trim());
        
        let pillGroup = document.createElement("div"); pillGroup.className = "pill-group"; pillGroup.style.margin = "2px 0";
        const vOptions = ["Raw Materials supplier", "MC Supplier", "Capital Goods Supplier"];
        
        vOptions.forEach(o => {
          const uniqueIdStr = `live_chk_${leadRef}_VendorType_${o.replace(/\s+/g,'_')}`;
          let chk = document.createElement("input"); chk.type = "checkbox"; chk.value = o; chk.id = uniqueIdStr;
          chk.className = `live-lead-check-subset-${leadRef}`; chk.dataset.masterKey = key;
          if (currentValues.indexOf(o) !== -1) chk.checked = true;
          
          let lbl = document.createElement("label"); lbl.htmlFor = uniqueIdStr; lbl.textContent = o;
          pillGroup.appendChild(chk); pillGroup.appendChild(lbl);
        });
        
        const otherIdStr = `live_chk_${leadRef}_VendorType_Others`;
        let otherChk = document.createElement("input"); otherChk.type = "checkbox"; otherChk.value = "Others"; otherChk.id = otherIdStr;
        otherChk.className = `live-lead-check-subset-${leadRef}`; otherChk.dataset.masterKey = key;
        
        let customTextVal = extractOthersValueText(leadMap[key], vOptions);
        if (customTextVal) otherChk.checked = true;
        
        let otherLbl = document.createElement("label"); otherLbl.htmlFor = otherIdStr; otherLbl.textContent = "Others";
        pillGroup.appendChild(otherChk); pillGroup.appendChild(otherLbl);
        mainWrapper.appendChild(pillGroup);

        let txtBox = document.createElement("textarea"); txtBox.rows = 1;
        txtBox.id = `live-subset-other-text-${leadRef}-Type_of_Vendor`;
        txtBox.placeholder = "Specify other vendor details...";
        txtBox.value = customTextVal;
        txtBox.oninput = function() { autoGrowPoField(this); };
        txtBox.onfocus = function() { autoGrowPoField(this); };
        mainWrapper.appendChild(txtBox);

        let conditionalMaterialSubBlock = document.createElement("div");
        conditionalMaterialSubBlock.id = `live-conditional-materials-block-mount-${leadRef}`;

        let matLabel = document.createElement("div"); matLabel.style.cssText = "font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-top:8px; margin-bottom:2px;";
        matLabel.textContent = "Name of Materials Supplied";
        let matInput = document.createElement("textarea"); matInput.rows = 1;
        matInput.className = `live-lead-field-input-${leadRef}`; matInput.dataset.headerKey = "Name of Materials Supplied";
        matInput.value = leadMap["Name of Materials Supplied"] || "";
        matInput.oninput = function() { autoGrowPoField(this); };
        matInput.onfocus = function() { autoGrowPoField(this); };
        
        conditionalMaterialSubBlock.appendChild(matLabel); 
        conditionalMaterialSubBlock.appendChild(matInput);
        mainWrapper.appendChild(conditionalMaterialSubBlock);
        cell.appendChild(mainWrapper);

        const evalVisibilityTrigger = () => {
          const vendorCheckboxParentNode = document.getElementById(`live_chk_${leadRef}_Type_of_Customer_Vendor`);
          if (vendorCheckboxParentNode && vendorCheckboxParentNode.checked) {
            conditionalMaterialSubBlock.style.display = "block";
          } else {
            conditionalMaterialSubBlock.style.display = "none";
          }
        };
        setTimeout(evalVisibilityTrigger, 50);
      } 
      
      // --- 8. MULTI-SELECT PILLED SELECTION TILES ---
      else if (key === "Type of Customer" || key === "Products Discussed" || key === "Voltage Level Requirements") {
        let mainWrapper = document.createElement("div"); mainWrapper.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
        let currentValues = (leadMap[key] || "").toString().split(",").map(v => v.trim());
        
        let rowsData = [];
        let hasOtherInputBox = false;
        
        if (key === "Voltage Level Requirements") {
          rowsData = [
            ["440V", "660V", "3.3KV", "6.6KV"],
            ["11KV", "22KV", "33KV", "66KV"],
            ["132KV", "220KV", "400KV"]
          ];
        } 
        else if (key === "Type of Customer") {
          rowsData = [
            ["Industry", "EPC", "Govt/PSU", "Consultant", "Developer"],
            ["Electrical Contractor", "Dealer", "Vendor", "Others"]
          ];
          hasOtherInputBox = true;
        } 
        else if (key === "Products Discussed") {
          rowsData = [
            ["APFC", "RPTFC", "Harmonic Filter", "SVG"],
            ["MV Capacitor Bank", "Reactor", "Others"]
          ];
          hasOtherInputBox = true;
        }

        rowsData.forEach(rowItems => {
          let pillGroup = document.createElement("div"); pillGroup.className = "pill-group"; pillGroup.style.margin = "2px 0";
          rowItems.forEach(o => {
            const uniqueIdStr = `live_chk_${leadRef}_${key.replace(/\s+/g,'_')}_${o.replace(/\s+/g,'_')}`;
            let chk = document.createElement("input"); chk.type = "checkbox"; chk.value = o;
            chk.id = uniqueIdStr; chk.className = `live-lead-check-subset-${leadRef}`; chk.dataset.masterKey = key;
            
            let matchFound = currentValues.indexOf(o) !== -1;
            if (!matchFound && o === "Others" && extractOthersValueText(leadMap[key], ["Industry","EPC","Govt/PSU","Consultant","Developer","Electrical Contractor","Dealer","Vendor","APFC","RPTFC","Harmonic Filter","SVG","MV Capacitor Bank","Reactor"])) {
              matchFound = true; 
            }
            if (matchFound) chk.checked = true;

            if (key === "Type of Customer" && o === "Vendor") {
               chk.onchange = () => {
                 const mountBlock = document.getElementById(`live-conditional-materials-block-mount-${leadRef}`);
                 if (mountBlock) mountBlock.style.display = chk.checked ? "block" : "none";
               };
            }

            let lbl = document.createElement("label"); lbl.htmlFor = uniqueIdStr; lbl.textContent = o;
            pillGroup.appendChild(chk); pillGroup.appendChild(lbl);
          });
          mainWrapper.appendChild(pillGroup);
        });

        if (hasOtherInputBox) {
          let txtBox = document.createElement("textarea"); txtBox.rows = 1;
          txtBox.id = `live-subset-other-text-${leadRef}-${key.replace(/\s+/g, '_')}`;
          txtBox.placeholder = "Enter custom parameters details...";
          txtBox.style.marginTop = "2px";
          txtBox.oninput = function() { autoGrowPoField(this); };
          txtBox.onfocus = function() { autoGrowPoField(this); };
          
          let excludedKeywords = [];
          if(key === "Type of Customer") excludedKeywords = ["Industry","EPC","Govt/PSU","Consultant","Developer","Electrical Contractor","Dealer","Vendor"];
          if(key === "Products Discussed") excludedKeywords = ["APFC","RPTFC","Harmonic Filter","SVG","MV Capacitor Bank","Reactor"];
          
          txtBox.value = extractOthersValueText(leadMap[key], excludedKeywords);
          mainWrapper.appendChild(txtBox);
        }
        cell.appendChild(mainWrapper);
      } else if (["Technical Discussion Summary", "Company Address", "Company Name", "Problem Observed", "Existing System Details"].indexOf(key) !== -1) {
        let inpTypeElement = document.createElement("textarea"); inpTypeElement.rows = 1;
        inpTypeElement.className = 'live-lead-field-input-' + leadRef; inpTypeElement.dataset.headerKey = key;
        inpTypeElement.value = leadMap[key] || "";
        inpTypeElement.oninput = function() { autoGrowPoField(this); };
        inpTypeElement.onfocus = function() { autoGrowPoField(this); };
        cell.appendChild(inpTypeElement);
      }
      else {
        // Auto-growing textarea instead of a single-line <input> — a long
        // saved value (Competitor Details, Additional Meeting Details,
        // Upcoming Project, etc.) used to be clipped/scrolled inside a
        // fixed-height input instead of wrapping visibly. rows="1" +
        // autoGrowPoField is the same technique already used for the
        // Purchase Order review screen just below in this file.
        let inp = document.createElement("textarea"); inp.rows = 1; inp.className = 'live-lead-field-input-' + leadRef;
        inp.dataset.headerKey = key; inp.value = leadMap[key] || "";
        inp.oninput = function() { autoGrowPoField(this); };
        inp.onfocus = function() { autoGrowPoField(this); };
        cell.appendChild(inp);
      }
      
      // Suppress standalone rendering of child items that are nested into parent compound objects boxes
      if (["Type of Industry", "Purchase Inquire", "Problem Observed"].indexOf(key) === -1) {
        gridWrapper.appendChild(cell);
      }
    });
  });
  canvas.appendChild(gridWrapper);
  // Size every auto-grow textarea to its prefilled value immediately — they
  // only grow on input/focus otherwise, so a long saved value would still
  // render clipped until the user clicks into the field.
  gridWrapper.querySelectorAll('textarea').forEach(autoGrowPoField);

  // Carries the Company ID through to the save handler — this form mixes Company-level
  // fields (City/State/Website/etc.) with Lead-level fields, and the save handler needs
  // this to route the Company-level edits to updateCompany separately.
  let hiddenCompanyIdCarrier = document.createElement("input");
  hiddenCompanyIdCarrier.type = "hidden";
  hiddenCompanyIdCarrier.id = "hidden-companyid-" + leadRef;
  hiddenCompanyIdCarrier.value = leadMap["Company ID"] || "";
  canvas.appendChild(hiddenCompanyIdCarrier);

  let saveBtn = document.createElement("button"); saveBtn.className = "btn btn-sub"; saveBtn.id = 'save-leads-matrix-btn-' + leadRef;
  saveBtn.style.marginTop = "12px"; saveBtn.textContent = "Save Modifications";
  saveBtn.onclick = function() { commitTargetedLeadsMutationsRows(leadRef); }; canvas.appendChild(saveBtn);

  let dividerAfterSave = document.createElement("div");
  dividerAfterSave.style.cssText = "height:3px; background:var(--border); margin:12px 0;";
  canvas.appendChild(dividerAfterSave);
}

async function commitTargetedLeadsMutationsRows(leadRef) {
  const btn = document.getElementById('save-leads-matrix-btn-' + leadRef);
  
  let fieldsPayload = {};
  
  // 1. Gather all default standard form fields inputs
  document.querySelectorAll('.live-lead-field-input-' + leadRef).forEach(el => { 
    if (el.dataset.headerKey) fieldsPayload[el.dataset.headerKey] = el.value; 
  });

  // Compulsory field checks — same rule as lead creation, enforced here too so an
  // edit can't silently blank out a required field.
  if (!fieldsPayload["Date of Meeting"]) { alert("Date of Meeting is compulsory and cannot be left blank."); return; }
  if (!fieldsPayload["ABPS Business Vertical"]) { alert("ABPS Business Vertical is compulsory and cannot be left blank."); return; }

  if(btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...'; }
  
  // Handle ABPS Business Vertical "Other" field override criteria check
  const bvSelect = Array.from(document.querySelectorAll('.live-lead-field-input-' + leadRef)).find(el => el.dataset.headerKey === "ABPS Business Vertical");
  if (bvSelect && bvSelect.value === "Other") {
    const customBvText = document.getElementById(`live-bv-other-${leadRef}`).value.trim();
    fieldsPayload["ABPS Business Vertical"] = customBvText || "Other";
  }
  
  // 2. Map and stitch multi-select arrays context definitions
  const targetCheckKeys = ["Voltage Level Requirements", "Products Discussed", "Type of Customer", "Type of Vendor"];
  
  targetCheckKeys.forEach(masterKey => {
    let selectedPillsList = [];
    // Standardize selection queries variables paths cleanly
    let keySelectorString = masterKey.replace(/\s+/g, '_');
    
    document.querySelectorAll(`.live-lead-check-subset-${leadRef}[data-master-key="${masterKey}"]:checked`).forEach(chk => {
      if (chk.value !== "Others") selectedPillsList.push(chk.value);
    });
    
    const textInputNode = document.getElementById(`live-subset-other-text-${leadRef}-${keySelectorString}`);
    if (textInputNode && textInputNode.value.trim() !== "") {
      selectedPillsList.push(textInputNode.value.trim());
    }
    
    fieldsPayload[masterKey] = selectedPillsList.join(", ");
  });

  // This form mixes Company-level fields (identity, shared across all a company's
  // Leads) with Lead-level fields (this specific project) — split them here so
  // the lead-update save would silently no-op (the header doesn't exist there).
  const companyLevelKeys = ["Company Name", "City", "State", "Country", "Company Address", "Website", "Type of Customer", "Type of Vendor", "Type of Industry", "Name of Materials Supplied"];
  let companyFieldsPayload = {};
  companyLevelKeys.forEach(k => {
    if (fieldsPayload[k] !== undefined) {
      companyFieldsPayload[k] = fieldsPayload[k];
      delete fieldsPayload[k]; // Company Name never goes to the lead-update save regardless — it's a protected, denormalized-copy field there.
    }
  });
  const carrierCompanyId = (document.getElementById(`hidden-companyid-${leadRef}`) || {}).value || "";

  try {
    const r = await apFetch({ 
      action: "updateLeadFull", 
      activeEngineer: appActiveOperatorIdentityString,
      leadId: leadRef, 
      fields: fieldsPayload 
    });

    let companySaveOk = true;
    if (carrierCompanyId && Object.keys(companyFieldsPayload).length > 0) {
      const cr = await apFetch({
        action: "updateCompany",
        activeEngineer: appActiveOperatorIdentityString,
        companyId: carrierCompanyId,
        fields: companyFieldsPayload
      });
      companySaveOk = !!cr.success;
      if (!companySaveOk) alert("Lead details saved, but company details failed: " + (cr.error || "Unknown error"));
    }

    if (r.success) {
      if (companySaveOk) alert("Modifications Saved Successfully.");
      // FIXED: Point to renamed structural data attributes identifiers
      const updatedNameText = fieldsPayload["Contact Person Name"] || "Unspecified Name";
      const updatedPositionText = fieldsPayload["Position"] || "Unspecified";
      const updatedStatusText = fieldsPayload["Status"] || "N/A";
      
      if (document.getElementById(`card-lbl-name-${leadRef}`)) document.getElementById(`card-lbl-name-${leadRef}`).textContent = updatedNameText;
      if (document.getElementById(`card-lbl-pos-${leadRef}`)) document.getElementById(`card-lbl-pos-${leadRef}`).textContent = updatedPositionText;
      if (document.getElementById(`card-lbl-status-${leadRef}`)) document.getElementById(`card-lbl-status-${leadRef}`).textContent = updatedStatusText;
    }
  } catch(e) { alert(e.message); } finally { if(btn) { btn.disabled = false; btn.innerHTML = "Save Modifications"; } }
}

async function removeLeadRowEntirely(leadRef, companyNameForConfirm, contactNameForConfirm) {
    const confirmLabel = [companyNameForConfirm, contactNameForConfirm].filter(Boolean).join(" ") || "this record";
    if (!confirm(`Confirm Delete of ${confirmLabel}?`)) return;
    const btn = event.target; 
    btn.disabled = true;
    btn.innerHTML = 'Deleting...';
    
    try {
        const r = await apFetch({ 
          action: "deleteLeadRow", 
          activeEngineer: appActiveOperatorIdentityString,
          leadId: leadRef 
        });
        
        if (!r.success) {
            alert(r.error || "An unexpected error occurred.");
            btn.disabled = false;
            btn.innerHTML = "Delete Record";
            return;
        }
        
        // If successful, refresh the active results feed viewport container block
        triggerSequentialSearch(currentActiveModuleContext);
        
    } catch(e) { 
        alert("Network request execution failure: " + e.message); 
        btn.disabled = false;
        btn.innerHTML = "Delete Record";
    }
}

async function submitLead() {
  const btn = document.getElementById('submit-btn');
  const statusField = document.getElementById('dropform-status');
  const feedbackBanner = document.getElementById('marketing-lead-creation-inline-feedback-banner');
  const activeFormContainerScopeNode = document.getElementById("step2-new-entry-dropdown");
  const getRadioStrict = n => (activeFormContainerScopeNode.querySelector(`input[name="${n}"]:checked`) || {}).value || "";
  
  if (!statusField.value) { alert("Lead Status is compulsory."); return; }

  const engineerField = document.getElementById('engName');
  if (!engineerField || !engineerField.value) { alert("ABPS Engineer Name is a compulsory question."); return; }

  const meetingDateField = document.getElementById('meetingDate');
  if (!meetingDateField || !meetingDateField.value) { alert("Please select a Date of Meeting."); return; }

  const businessVerticalCheck = getRadioStrict('businessVertical');
  if (!businessVerticalCheck) { alert("ABPS Business Vertical is a compulsory question."); return; }

  const companyNameCheck = document.getElementById('dropform-company-locked').value.trim();
  if (!companyNameCheck) { alert("Company Name is compulsory."); return; }

  const cityCheck = document.getElementById('dropform-city').value.trim() || (document.getElementById('f-city') ? document.getElementById('f-city').value.trim() : "");
  if (!cityCheck) { alert("City is compulsory."); return; }

  const stateCheck = document.getElementById('dropform-state').value.trim() || (document.getElementById('f-state') ? document.getElementById('f-state').value.trim() : "");
  if (!stateCheck) { alert("State is compulsory."); return; }

  const countryCheck = document.getElementById('dropform-country').value.trim() || (document.getElementById('f-country') ? document.getElementById('f-country').value.trim() : "");
  if (!countryCheck) { alert("Country is compulsory."); return; }

  if (feedbackBanner) {
    feedbackBanner.style.display = "none";
  }

  btn.disabled = true; 
  btn.innerHTML = '<div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></div> Saving Lead...';
  showBlockingOverlay("Saving Lead...");
  
  const meetingDate = document.getElementById('meetingDate').value;
  const meetingTime = document.getElementById('meetingTime').value;
  
  const getChecks = n => Array.from(activeFormContainerScopeNode.querySelectorAll(`input[name="${n}"]:checked`)).map(c => c.value);
  const getRadio  = n => (activeFormContainerScopeNode.querySelector(`input[name="${n}"]:checked`) || {}).value || "No";
  
  try {
    const { base64: cardImageBase64, mimeType: cardImageMimeType } = await combineCardImagesToBase64(fileFront, fileBack);

    const lpiNode  = document.getElementById("lpi");  const selLpiNode  = document.getElementById("sel-lpi");
    const hbiNode  = document.getElementById("hbi");  const selHbiNode  = document.getElementById("sel-hbi");
    const hiNode   = document.getElementById("hi");   const selHiNode   = document.getElementById("sel-hi");
    const thiNode  = document.getElementById("thi");  const selThiNode  = document.getElementById("sel-thi");
    const gsiNode  = document.getElementById("gsi");  const selGsiNode  = document.getElementById("sel-gsi");
    const vtoNode  = document.getElementById("vtoText");
    const pdoNode  = document.getElementById("pdoText");
    const qOtherNode = document.getElementById("qualificationOther");

    const qualChecked = getChecks('qualification');
    const qualFinal = qualChecked.map(v => v === 'Others' ? ((qOtherNode && qOtherNode.value) ? qOtherNode.value : 'Others') : v);

    const vtChecked = getChecks('vendorType');
    const vtFinal = vtChecked.map(v => v === 'Others' ? ((vtoNode && vtoNode.value) ? vtoNode.value : 'Others') : v);

    const prodChecked = getChecks('prod');
    const prodFinal = prodChecked.map(v => v === 'Others' ? ((pdoNode && pdoNode.value) ? pdoNode.value : 'Others') : v);

    const fields = {
      status: statusField.value,
      engineerName: engineerField.value, 
      "Contact Person Name": document.getElementById('dropform-name').value.trim() || (document.getElementById('f-name') ? document.getElementById('f-name').value.trim() : ""), 
      "Company Name": document.getElementById('dropform-company-locked').value.trim(),
      position: document.getElementById('dropform-position').value.trim() || (document.getElementById('f-position') ? document.getElementById('f-position').value.trim() : ""), 
      phone: document.getElementById('dropform-phone').value.trim() || (document.getElementById('f-phone') ? document.getElementById('f-phone').value.trim() : ""), 
      altPhone: document.getElementById('dropform-altphone').value.trim() || (document.getElementById('f-altphone') ? document.getElementById('f-altphone').value.trim() : ""),
      email: document.getElementById('dropform-email').value.trim() || (document.getElementById('f-email') ? document.getElementById('f-email').value.trim() : ""), 
      website: document.getElementById('dropform-website').value.trim() || (document.getElementById('f-website') ? document.getElementById('f-website').value.trim() : ""), 
      city: document.getElementById('dropform-city').value.trim() || (document.getElementById('f-city') ? document.getElementById('f-city').value.trim() : ""),
      state: document.getElementById('dropform-state').value.trim() || (document.getElementById('f-state') ? document.getElementById('f-state').value.trim() : ""),
      country: document.getElementById('dropform-country').value.trim() || (document.getElementById('f-country') ? document.getElementById('f-country').value.trim() : ""), 
      address: document.getElementById('dropform-address').value.trim() || (document.getElementById('f-address') ? document.getElementById('f-address').value.trim() : ""),
      meetingDate: meetingDate, 
      meetingTime: meetingTime,
      meetingVenue: getRadioStrict('meetingVenue') === 'Other' ? (document.getElementById('meetingVenueOther') ? document.getElementById('meetingVenueOther').value : 'Other') : getRadioStrict('meetingVenue'),
      venueName: document.getElementById('venueName').value, 
      additionalMeetingDetails: document.getElementById('additionalMeetingDetails').value,
      businessVertical: getRadioStrict('businessVertical') === 'Other' ? (document.getElementById('businessVerticalOther') ? document.getElementById('businessVerticalOther').value : 'Other') : getRadioStrict('businessVertical'),
      industry: document.getElementById('industry').value, 
      "Type of Customer": qualFinal, 
      vendorType: vtFinal,
      "Name of Materials Supplied": document.getElementById('materialsName').value, 
      lpi: document.getElementById("lpi").value.trim(), 
      hbi: document.getElementById("hbi").value.trim(), 
      hi: document.getElementById("hi").value.trim(), 
      thi: document.getElementById("thi").value.trim(), 
      gsi: document.getElementById("gsi").value.trim(),
      purchaseInquire: document.getElementById('purchaseInquire').value.trim(),
      tenderInquire: document.getElementById('tenderInquire').value.trim(),
      esd: document.getElementById('esd').value.trim(),
      "Voltage Level Requirements": getChecks('voltage'), 
      cdMva: document.getElementById('cdMva').value, 
      rdMva: document.getElementById('rdMva').value, 
      avgPf: document.getElementById('avgPf').value,
      problemObserved: document.getElementById('problemObserved').value, 
      techSummary: document.getElementById('techSummary').value,
      existingProject: document.getElementById('epInput').value, 
      upcomingProject: document.getElementById('upInput').value,
      products: prodFinal, 
      approxReq: document.getElementById('approxReq').value, 
      tenderDate: document.getElementById('tenderDate').value,
      orderTimeline: document.getElementById('orderTimeline').value, 
      competitors: document.getElementById('competitors').value, 
      potential: getRadio('pot'),
      sendProfile: document.getElementById('act1').value, 
      sendPresentation: document.getElementById('act2').value, 
      arrangeVisit: document.getElementById('act3').value,
      getEnquiry: document.getElementById('act4').value, 
      sendOffer: document.getElementById('actOffer').value, 
      followUpRequired: document.getElementById('act7').value
    };

    const d = await apFetch({
      action: 'submit',
      activeEngineer: appActiveOperatorIdentityString,
      fields,
      base64Image: cardImageBase64,
      mimeType: cardImageMimeType
    });
    
    if (d.success) { 
      // A. Instantly hide the input form fields below the banner
      const remainingFormBox = document.getElementById('remaining-sections-form');
      if (remainingFormBox) {
        remainingFormBox.style.display = "none";
      }

      if (document.getElementById("missing-trigger-notice-block")) document.getElementById("missing-trigger-notice-block").style.display = "none";
      if (document.getElementById("step2-inline-interaction-canvas")) document.getElementById("step2-inline-interaction-canvas").style.display = "none";
      const step1CardBlock = document.getElementById("step1-card-capture-block");
      if (step1CardBlock) step1CardBlock.style.display = "none";
      // Collapse Form no longer applies once the record is saved — nothing left to collapse.
      const collapseBtn = document.getElementById("global-direct-inline-collapse-entry-btn");
      if (collapseBtn) collapseBtn.style.display = "none";

      // B. Inject full success element view with inline "+ Create New Entry" button action loop
      if (feedbackBanner) {
        feedbackBanner.style.cssText = "display: block; background: #dcfce7; border-color: #15803d; color: #15803d; padding: 16px; margin-bottom: 16px; border-left: 4px solid #15803d; text-align: left;";
        feedbackBanner.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <strong style="font-size: 1rem;">Success! Lead Record Created for ${fields["Company Name"] || companyVal}.</strong><br/>
              <span style="font-size: 0.88rem; font-weight: 600;">Assigned LEAD ID:
                <br/><span style="font-family: monospace; font-weight: 800; background: #fff; padding: 4px 10px; border-radius: 4px; border: 1px solid #15803d; color: #111827; display: inline-block; margin-top: 6px;">${d.leadId}</span>
              </span>
            </div>
            <button class="nav-btn-styled" onclick="
              document.getElementById('marketing-lead-creation-inline-feedback-banner').style.display = 'none';
              document.getElementById('step1-card-capture-block').style.display = 'block';
              document.getElementById('remaining-sections-form').style.display = 'block';
              fileFront = null; fileBack = null;
              const fb = document.getElementById('front-box'); if (fb) { fb.textContent = '📷 Front Side '; fb.classList.remove('done'); }
              const bb = document.getElementById('back-box'); if (bb) { bb.textContent = '📷 Back Side (Optional)'; bb.classList.remove('done'); }
              const fi = document.getElementById('card-front'); if (fi) fi.value = '';
              const bi = document.getElementById('card-back'); if (bi) bi.value = '';
              ['f-company','f-name','f-position','f-phone','f-altphone','f-email','f-website','f-city','f-state','f-country','f-address'].forEach(function(id){ const el=document.getElementById(id); if(el) el.value=''; });
              document.getElementById('step2-new-entry-dropdown').style.display = 'none';
              document.getElementById('step2-inline-interaction-canvas').style.display = 'none';
              document.getElementById('missing-trigger-notice-block').style.display = 'none';
              document.getElementById('global-direct-inline-create-entry-btn').style.display = 'none';
              document.getElementById('global-direct-inline-collapse-entry-btn').style.display = 'none';
              resetSequentialFormState();
            " style="background: #166534; color: white; padding: 8px 16px; font-weight: 700;">
              + Create New Entry
            </button>
          </div>
        `;
      }

      if (activeEmailLeadContextIndex !== null) {
        const mailObject = cachedInboundEmailLeadsArray[activeEmailLeadContextIndex];
        const targetMsgId = mailObject.messageIdReference;
        const cardWrapperNode = document.getElementById(`email-lead-wrapper-node-${activeEmailLeadContextIndex}`);
        
        cachedInboundEmailLeadsArray = cachedInboundEmailLeadsArray.filter(item => item.messageIdReference !== targetMsgId);

        const formTemplateSource = document.getElementById("step2-new-entry-dropdown");
        if (formTemplateSource) {
          formTemplateSource.style.display = "none";
          document.body.appendChild(formTemplateSource);
        }
        if (cardWrapperNode) cardWrapperNode.remove();
        if (document.getElementById("email-leads-inbound-feed-canvas").children.length === 0) {
          renderEmailLeadsFeedInterface([]);
        }
        activeEmailLeadContextIndex = null;
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Run card rendering and updates asynchronously behind the active success view panel card
      setTimeout(async () => {
        try {
          if (currentActiveModuleContext === "CARD" || currentActiveModuleContext === "DROPDOWN") {
            const compParamValue = fields["Company Name"]; 
            const targetPersonNameParam = fields["Contact Person Name"];
            
            const refreshData = await apFetch({ 
              action: "searchCompanyData",
            activeEngineer: appActiveOperatorIdentityString, 
            companyName: compParamValue, 
            contactName: targetPersonNameParam 
          });
          if (refreshData.success) {
            globalFollowUpsCacheMap = refreshData.followups; 
            globalTasksCacheMap = refreshData.tasks;
            
            const canvasNode = document.getElementById("step2-inline-interaction-canvas");
            if (canvasNode) {
              canvasNode.style.display = "block";
              buildMultiContactDirectoryInterface(refreshData.leads, targetPersonNameParam);
              const topFreshCardNode = document.getElementById(`contact-parent-wrapper-${d.leadId}`);
              if (topFreshCardNode) {
                topFreshCardNode.style.cssText = "border: 2.5px solid var(--accent) !important; box-shadow: 0 4px 12px rgba(0, 168, 120, 0.15) !important;";
              }
              // This canvas sits earlier in the DOM than the create-form/success
              // message, so re-showing it here would otherwise land it ABOVE the
              // success banner. Move it below instead, so the confirmation card
              // reads as "here's the record you just created", not as something
              // unrelated floating above the message.
              const dropdownEl = document.getElementById("step2-new-entry-dropdown");
              if (dropdownEl) dropdownEl.after(canvasNode);
            }
            // The contact just submitted now exists — clear the stale "missing person" banner
            // left over from before this lead was created.
            const bannerHookRefresh = document.getElementById("split-missing-person-banner-hook");
            if (bannerHookRefresh) bannerHookRefresh.innerHTML = "";
          }
          await triggerCompanyDropdownArrayFetch();
        }
        } catch(e) {
          if (e.message !== "SESSION_EXPIRED") {
            console.warn("Background card refresh failed silently:", e.message);
          }
        }
      }, 500); 
    }
    else {
      alert("Submission failed: " + (d.error || "Unknown server error."));
    }
  } catch (e) {
    // apFetch already shows its own "session expired, please log in again"
    // message and redirects — an extra "Submission failed" alert on top of
    // that would be redundant and confusing.
    if (e.message !== "SESSION_EXPIRED") {
      alert("Submission failed. Please check your network connection.\n" + e.message);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Submit Lead';
    hideBlockingOverlay();
  }
}

function updateSelectedDisplay() {
  const checked = Array.from(document.querySelectorAll('input[name="searchQual"]:checked')).map(i => i.value);
  document.getElementById("selected-quals-display").textContent = checked.length > 0 ? "Filtering for: " + checked.join(" and ") : "";
}

function handleOthersQualificationToggleDrawer(triggerNode) {
  const drawerPanel = document.getElementById("custom-qualifications-sub-drawer");
  const triggerLabel = triggerNode.nextElementSibling;
  
  if (triggerNode.checked) {
     // Expand the sub-drawer panel and rotate arrow indicator indicator label element
     drawerPanel.style.display = "block";
     if(triggerLabel) triggerLabel.textContent = "Others ▴";
  } else {
     // Collapse the view drawer
     drawerPanel.style.display = "none";
     if(triggerLabel) triggerLabel.textContent = "Others ▾";
     
     // Wipe any active checkbox choices inside the hidden drawer to prevent confusion
     const customCheckboxes = drawerPanel.querySelectorAll('input[name="searchQual"]');
     customCheckboxes.forEach(cb => cb.checked = false);
     updateSelectedDisplay();
  }
}

async function triggerQualificationSearch() {
    document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
    const btn = document.getElementById("qual-search-btn");
    const selected = Array.from(document.querySelectorAll('input[name="searchQual"]:checked')).map(i => i.value);
    if(selected.length === 0) return alert("Select at least one qualification.");
    btn.classList.add("loading"); btn.textContent = "Searching...";
    try {
        const data = await apFetch({ 
          action: "searchByQualifications", 
          activeEngineer: appActiveOperatorIdentityString,
          qualifications: selected 
        });
        if (data.success) {
            const canvas = document.getElementById("step2-inline-interaction-canvas");
            document.getElementById("canvas-back-btn-enclosure-row").innerHTML = `<div class="qualification-status-bar">Types of Customer: ${selected.join(" and ")}</div>`;
            document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
            globalFollowUpsCacheMap = data.followups; globalTasksCacheMap = data.tasks;
            buildMultiContactDirectoryInterface(data.leads, "");
            canvasLastParentWorkspaceId = "workspace-searchQualification";
            canvas.style.display = "block"; document.getElementById("workspace-searchQualification").appendChild(canvas);
        }
    } catch(e) { alert(e.message); } finally { btn.classList.remove("loading"); btn.textContent = "Search Type of Customer"; }
}

async function triggerStatusSearch() {
    document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
    const btn = document.getElementById("status-search-btn");
    const statusVal = document.getElementById("status-filter-select").value;
    if(!statusVal) return alert("Please select a status.");
    btn.classList.add("loading"); btn.textContent = "Searching...";
    try {
        const data = await apFetch({ action: "searchByStatus", activeEngineer: appActiveOperatorIdentityString, statusValue: statusVal });
        if (data.success) {
            const canvas = document.getElementById("step2-inline-interaction-canvas");
            document.getElementById("canvas-back-btn-enclosure-row").innerHTML = `<div class="qualification-status-bar">Status: ${statusVal}</div>`;
            document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
            globalFollowUpsCacheMap = data.followups; globalTasksCacheMap = data.tasks;
            buildMultiContactDirectoryInterface(data.leads, "");
            canvasLastParentWorkspaceId = "workspace-searchStatus";
            canvas.style.display = "block"; document.getElementById("workspace-searchStatus").appendChild(canvas);
        } else { alert(data.error || "No leads found with this status."); }
    } catch(e) { alert(e.message); } finally { btn.classList.remove("loading"); btn.textContent = "Search Leads"; }
}

async function triggerEngineerSearch() {
    const btn = document.getElementById("eng-search-btn");
    const engVal = document.getElementById("engineer-filter-select").value;
    if(!engVal) return alert("Please select an engineer.");
    btn.classList.add("loading"); btn.textContent = "Searching...";
    try {
        const data = await apFetch({ action: "searchByEngineer", activeEngineer: appActiveOperatorIdentityString, engName: engVal });
        if (data.success) {
          const canvas = document.getElementById("step2-inline-interaction-canvas");
          document.getElementById("canvas-back-btn-enclosure-row").innerHTML = `<div class="qualification-status-bar" style="width: 100%;">Engineer: ${engVal}</div>`;
          document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
          globalFollowUpsCacheMap = data.followups; globalTasksCacheMap = data.tasks;
          buildMultiContactDirectoryInterface(data.leads, "");
          canvasLastParentWorkspaceId = "workspace-searchEngineer";
          canvas.style.display = "block"; document.getElementById("workspace-searchEngineer").appendChild(canvas);
        } else { alert("No leads found for this engineer."); }
    } catch(e) { alert(e.message); } finally { btn.classList.remove("loading"); btn.textContent = "Search Leads"; }
}

function renderLeadMatrixEngineerCheckboxes() {
  const mountPoint = document.getElementById("lead-matrix-engineer-checkboxes-mount");
  if (!mountPoint) return;

  mountPoint.innerHTML = '<p style="font-size:0.75rem; color:var(--brand); font-weight:600; margin:0; display:flex; align-items:center; gap:6px;"><span class="spinner" style="display:inline-block; width:10px; height:10px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite;"></span> Loading Engineers...</p>';
  setTimeout(() => {
    mountPoint.innerHTML = "";
    cachedEngineers.forEach(eng => {
      const cleanId = `chk_lm_eng_${eng.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
      mountPoint.innerHTML += `
        <input type="checkbox" name="leadMatrixEngineerFilter" value="${eng.email}" id="${cleanId}">
        <label for="${cleanId}">${eng.name}</label>
      `;
    });
  }, 50);
}

async function executeLeadMatrixFilterSearch() {
  const btn = document.getElementById("lead-matrix-search-submit-btn");
  const checkedEngineers = Array.from(document.querySelectorAll('input[name="leadMatrixEngineerFilter"]:checked')).map(i => i.value);
  const checkedStatuses = Array.from(document.querySelectorAll('input[name="leadMatrixStatusFilter"]:checked')).map(i => i.value);

  if (checkedEngineers.length === 0 && checkedStatuses.length === 0) {
    alert("Please select at least one Engineer or Status filter before searching.");
    return;
  }

  btn.classList.add("loading"); btn.textContent = "Filtering Leads...";
  document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";

  // Show active filters summary
  const filterDisplay = document.getElementById("lead-matrix-active-filters-display");
  if (filterDisplay) {
    const parts = [];
    if (checkedEngineers.length > 0) parts.push("Engineers: " + engineerEmailsToNames(checkedEngineers).join(", "));
    if (checkedStatuses.length > 0) parts.push("Status: " + checkedStatuses.join(", "));
    filterDisplay.textContent = "Filtering for → " + parts.join(" | ");
    filterDisplay.style.display = "block";
    filterDisplay.style.color = "var(--brand)";
    filterDisplay.style.background = "var(--highlight-bg)";
    filterDisplay.style.borderColor = "var(--border)";
  }
  
  try {
    const data = await apFetch({
      action: "searchLeadsMatrixCombination",
      activeEngineer: appActiveOperatorIdentityString,
      engineers: checkedEngineers,
      statuses: checkedStatuses
    });
    
    if (data.success) {
      const canvas = document.getElementById("step2-inline-interaction-canvas");
      
      globalFollowUpsCacheMap = data.followups;
      globalTasksCacheMap = data.tasks;

      if (data.leads.length === 0) {
        // Clear previous results so stale cards don't remain visible
        document.getElementById("multi-contact-records-container").innerHTML = "";
        const canvas = document.getElementById("step2-inline-interaction-canvas");
        canvas.style.display = "none";

        const filterDisplay = document.getElementById("lead-matrix-active-filters-display");
        if (filterDisplay) {
          const parts = [];
          if (checkedEngineers.length > 0) parts.push("Engineers: " + engineerEmailsToNames(checkedEngineers).join(", "));
          if (checkedStatuses.length > 0) parts.push("Status: " + checkedStatuses.join(", "));
          filterDisplay.textContent = "No entries found for → " + parts.join(" | ");
          filterDisplay.style.display = "block";
          filterDisplay.style.color = "var(--warn)";
          filterDisplay.style.background = "#fff5f5";
          filterDisplay.style.borderColor = "#fca5a5";
        }
        btn.classList.remove("loading"); btn.textContent = "Run Leads Search";
        return;
      }

      buildMultiContactDirectoryInterface(data.leads, "");
      document.getElementById("canvas-back-btn-enclosure-row").innerHTML = `
        <button class="nav-btn-styled" onclick="exitCanvasToCardView()" style="background:#4a5568; margin-bottom: 10px; display:none;">Back to Search</button>
      `;
      canvas.style.display = "block";
      canvasLastParentWorkspaceId = "workspace-searchStatus";
      document.getElementById("workspace-searchStatus").appendChild(canvas);
    }
  } catch(e) {
    alert("Leads matrix execution request dropped: " + e.message);
  } finally {
    if (btn.classList.contains("loading")) {
      btn.classList.remove("loading");
    }
    if (btn.textContent !== "Run Leads Search") {
      btn.textContent = "Run Leads Search";
    }
  }
}

async function triggerEmailLeadDatabaseActionPipeline(index) {
  const mailObject = cachedInboundEmailLeadsArray[index];
  const nestedWorkspace = document.getElementById(`email-nested-inline-database-workspace-anchor-${index}`);
  const actionBtn = document.getElementById(`email-form-toggle-btn-text-${index}`);
  if (!nestedWorkspace || !actionBtn) return;

  // Toggle: if already open, collapse
  if (nestedWorkspace.style.display === "block") {
    nestedWorkspace.style.display = "none";
    nestedWorkspace.innerHTML = "";
    actionBtn.textContent = "Check in CRM / Log Follow-up";
    actionBtn.style.display = "inline-flex";
    actionBtn.disabled = false;
    // Ensure global buttons stay hidden — email leads never use them
    document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
    document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none";
    document.getElementById("canvas-back-btn-enclosure-row").innerHTML = "";
    return;
  }

  actionBtn.disabled = true;
  actionBtn.textContent = "Checking Database...";

  try {
    const data = await apFetch({
      action: "searchCompanyData",
      activeEngineer: appActiveOperatorIdentityString,
      companyName: mailObject.extractedCompany,
      contactName: mailObject.extractedContactName
    });

    // SCENARIO A: Company exists in database
    if (data.success) {
      actionBtn.disabled = false;
      actionBtn.style.display = "none"; // hide while form is open

      nestedWorkspace.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid var(--border);">
          <span style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--brand);">🏢 Existing records for ${escapeHtml(mailObject.extractedCompany)}</span>
          <button class="nav-btn-styled" style="background:#718096; font-size:0.72rem; padding:3px 10px;" onclick="
            document.getElementById('email-nested-inline-database-workspace-anchor-${index}').style.display='none';
            document.getElementById('email-nested-inline-database-workspace-anchor-${index}').innerHTML='';
            const ab = document.getElementById('email-form-toggle-btn-text-${index}');
            if(ab){ab.textContent='Check in CRM / Log Follow-up';ab.style.display='inline-flex';ab.disabled=false;}
            document.getElementById('global-direct-inline-create-entry-btn').style.display='none';
            document.getElementById('canvas-back-btn-enclosure-row').innerHTML='';
          ">Collapse</button>
        </div>
        <div id="nested-email-contacts-mount-canvas-${index}" style="max-height:500px; overflow-y:auto;"></div>
      `;
      nestedWorkspace.style.display = "block";

      globalFollowUpsCacheMap = data.followups;
      globalTasksCacheMap = data.tasks;

      // Build contacts inline WITHOUT moving the global canvas
      const targetSubMount = nestedWorkspace.querySelector(`#nested-email-contacts-mount-canvas-${index}`);
      if (targetSubMount) {
        const tempContainer = document.createElement("div");
        tempContainer.id = `nested-multi-contact-records-container-${index}`;
        targetSubMount.appendChild(tempContainer);
        buildMultiContactDirectoryInterface(data.leads, mailObject.extractedContactName, `nested-multi-contact-records-container-${index}`);
      }

      // Keep global buttons hidden
      document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
      document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none";
      document.getElementById("canvas-back-btn-enclosure-row").innerHTML = "";

    }
    // SCENARIO B: New company — open creation form inline
    else {
      activeEmailLeadContextIndex = index;
      actionBtn.disabled = false;
      actionBtn.style.display = "none"; // hide while form is open

      nestedWorkspace.innerHTML = `<div id="nested-email-creation-form-mount-${index}" style="width:100%;"></div>`;
      nestedWorkspace.style.display = "block";

      const formTemplateSource = document.getElementById("step2-new-entry-dropdown");
      const targetFormMountNode = nestedWorkspace.querySelector(`#nested-email-creation-form-mount-${index}`);

      if (formTemplateSource && targetFormMountNode) {
        formTemplateSource.style.display = "block";
        targetFormMountNode.appendChild(formTemplateSource);

        const remainingFormNode = document.getElementById("remaining-sections-form");
        const successScreenNode = document.getElementById("success-screen");
        if (remainingFormNode) remainingFormNode.style.display = "block";
        if (successScreenNode) successScreenNode.style.display = "none";

        // Clear old inputs
        document.querySelectorAll("#remaining-sections-form input, #remaining-sections-form textarea, #remaining-sections-form select").forEach(input => {
          if (input.type === "checkbox" || input.type === "radio") {
            input.checked = false;
          } else if (input.tagName === "SELECT") {
            if (["act1","act2","act3","act4","actOffer","act7"].includes(input.id)) {
              input.value = "No";
            } else if (input.id !== "dropform-status") {
              input.value = "";
            }
          } else if (input.id !== "dropform-company-locked") {
            input.value = "";
          }
        });

        document.querySelectorAll(".other-input, #vendor-fields").forEach(el => el.style.display = "none");

        const dropCompanyLocked = document.getElementById("dropform-company-locked");
        const dropName = document.getElementById("dropform-name");
        const dropEmailField = document.getElementById("dropform-email");
        if (dropCompanyLocked) dropCompanyLocked.value = mailObject.extractedCompany;
        if (dropName) dropName.value = mailObject.extractedContactName;
        if (dropEmailField && mailObject.destinationInboxAccount) dropEmailField.value = mailObject.destinationInboxAccount;

        // Email Leads is always an individual laptop login, never the shared
        // Visiting Card Details phone — force out of any leftover "CARD"
        // context so the Engineer Name field locks to the logged-in user.
        currentActiveModuleContext = "DROPDOWN";
        applyEngineerFieldLockState();

        // Always keep global nav buttons hidden
        document.getElementById("global-direct-inline-create-entry-btn").style.display = "none";
        document.getElementById("global-direct-inline-collapse-entry-btn").style.display = "none";
        document.getElementById("canvas-back-btn-enclosure-row").innerHTML = "";

        // Add a Collapse button at the top of the form
        const collapseBar = document.createElement("div");
        collapseBar.style.cssText = "display:flex; justify-content:flex-end; margin-bottom:8px;";
        collapseBar.innerHTML = `<button class="nav-btn-styled" style="background:#718096; font-size:0.72rem; padding:3px 10px;" onclick="
          document.getElementById('step2-new-entry-dropdown').style.display='none';
          document.getElementById('email-nested-inline-database-workspace-anchor-${index}').style.display='none';
          document.getElementById('email-nested-inline-database-workspace-anchor-${index}').innerHTML='';
          const ab = document.getElementById('email-form-toggle-btn-text-${index}');
          if(ab){ab.textContent='Create New Entry';ab.style.display='inline-flex';ab.disabled=false;}
          document.getElementById('global-direct-inline-create-entry-btn').style.display='none';
          document.getElementById('canvas-back-btn-enclosure-row').innerHTML='';
        ">✕ Cancel</button>`;
        formTemplateSource.prepend(collapseBar);
      }
    }
  } catch(e) {
    alert("Error: " + e.message);
    actionBtn.disabled = false;
    actionBtn.textContent = "Create New Entry";
    actionBtn.style.display = "inline-flex";
  }
}

function handleMatrixMaterialSearchInputSuggestions(query) {
  const dd = document.getElementById("matrix-material-search-dropdown");
  const catalog = window.itemCodeCatalogCache || [];
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const matches = catalog.filter(it => (it.productName||"").toLowerCase().includes(q) || (it.itemCode||"").toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(it => `
    <div onclick="selectMatrixMaterialSuggestion(\`${(it.productName||'').replace(/\`/g,"'")}\`)"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:8px;">${it.itemCode}</span>${it.productName}${it.rating ? ` <span style="color:var(--brand); font-weight:700;">${it.rating}</span>` : ''}
    </div>`).join("");
  dd.style.display = "block";
}
function selectMatrixMaterialSuggestion(productName) {
  document.getElementById("matrix-material-name-search-input").value = productName;
  document.getElementById("matrix-material-search-dropdown").style.display = "none";
  handleMatrixMaterialSearchInput(productName);
}

function handleMatrixProjectSearchInput(rawValue) {
  const query = rawValue.trim().toLowerCase();
  const clearBtn = document.getElementById("matrix-project-search-clear-btn");
  if (clearBtn) clearBtn.style.display = query ? "block" : "none";

  const dd = document.getElementById("matrix-project-search-dropdown");
  if (query) {
    const matches = (window.matrixKnownProjectCodes || []).filter(p => p.toLowerCase().includes(query)).slice(0, 10);
    if (matches.length > 0) {
      dd.innerHTML = matches.map(p => `
        <div onclick="selectMatrixProjectSuggestion('${p.replace(/'/g,"\\'")}')"
          style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
          onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${p}</div>`).join("");
      dd.style.display = "block";
    } else { dd.style.display = "none"; }
  } else { dd.style.display = "none"; }
}
function selectMatrixProjectSuggestion(projectId) {
  document.getElementById("matrix-project-search-input").value = projectId;
  document.getElementById("matrix-project-search-dropdown").style.display = "none";
  const clearBtn = document.getElementById("matrix-project-search-clear-btn");
  if (clearBtn) clearBtn.style.display = "block";
}
function clearMatrixProjectSearch() {
  const input = document.getElementById("matrix-project-search-input");
  if (input) input.value = "";
  const clearBtn = document.getElementById("matrix-project-search-clear-btn");
  if (clearBtn) clearBtn.style.display = "none";
  document.getElementById("matrix-project-search-dropdown").style.display = "none";
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#matrix-material-name-search-input") && !e.target.closest("#matrix-material-search-dropdown")) {
    const d1 = document.getElementById("matrix-material-search-dropdown"); if (d1) d1.style.display = "none";
  }
  if (!e.target.closest("#matrix-project-search-input") && !e.target.closest("#matrix-project-search-dropdown")) {
    const d2 = document.getElementById("matrix-project-search-dropdown"); if (d2) d2.style.display = "none";
  }
});

function handleMatrixMaterialSearchInput(rawValue) {
  handleMatrixMaterialSearchInputSuggestions(rawValue);
  const clearBtn = document.getElementById("matrix-material-search-clear-btn");
  if (clearBtn) clearBtn.style.display = rawValue.trim() ? "block" : "none";
}

function clearMatrixMaterialSearch() {
  const input = document.getElementById("matrix-material-name-search-input");
  if (input) input.value = "";
  const clearBtn = document.getElementById("matrix-material-search-clear-btn");
  if (clearBtn) clearBtn.style.display = "none";
  document.getElementById("matrix-material-search-dropdown").style.display = "none";
}

/**
 * CLIENT HISTORICAL TICKET LOOKUP FILTER ENGINE
 * Searches historical logs by mapping filter filters for stores, action types, 
 * projects, departments, statuses, and material name/item code safely using type-guaranteed parameters lookups.
 */
function triggerStoreTicketMatrixSearch() {
  matrixActiveMaterialSearchDisplay = (document.getElementById("matrix-material-name-search-input")?.value || "").trim();
  matrixActiveProjectSearchDisplay = (document.getElementById("matrix-project-search-input")?.value || "").trim();
  matrixActiveMaterialSearchQuery = matrixActiveMaterialSearchDisplay.toLowerCase();
  matrixActiveProjectSearchQuery = matrixActiveProjectSearchDisplay.toLowerCase();
  document.getElementById("matrix-material-search-dropdown").style.display = "none";
  document.getElementById("matrix-project-search-dropdown").style.display = "none";
  executeClientSideStoreTicketFilterSearch();
}

document.getElementById('commissioning-report-raw-file').onchange = (e) => {
  targetCommissioningReportFileObj = e.target.files[0];
  const box = document.getElementById('commissioning-report-upload-box');
  if (box && targetCommissioningReportFileObj) { box.textContent = "Commissioning Report Document Added ✅"; box.classList.add('done'); }
};

// Purchase Order no longer calls this — it now goes through the two-step
// extractPurchaseOrderForReview() / submitReviewedPurchaseOrder() flow
// below, so every isPO-gated branch here is unreachable dead code (never
// invoked with opsFlagTypeString === "PURCHASE_ORDER" anymore). Left
// in place rather than surgically removed to avoid regressing the still-
// live Dispatch Bill / Commissioning Report paths this function handles.
// Customer Name auto-fill for the Commissioning Report Project ID
// typeahead — same lookup Create BOQ's handleCBOQProjectChange does
// against the shared sharedProjectMeta cache.
function handleCommissioningReportProjectChange(projectId) {
  const meta = window.sharedProjectMeta && window.sharedProjectMeta[projectId];
  const customerNameEl = document.getElementById("commissioning-report-customer-name");
  if (customerNameEl) customerNameEl.value = meta ? (meta.companyName || "") : "";
}

async function executeMarketingOperationsDocumentCommit(opsFlagTypeString) {

  const isPO = opsFlagTypeString === "PURCHASE_ORDER";
  const isDispatch = opsFlagTypeString === "DISPATCH";

  const bannerIds   = { "DISPATCH": "dispatch-bill-feedback-banner", "COMMISSION": "commissioning-report-feedback-banner", "PURCHASE_ORDER": "purchase-order-feedback-banner" };
  const btnIds      = { "DISPATCH": "btn-ops-dispatch-submit",       "COMMISSION": "btn-ops-commission-submit",            "PURCHASE_ORDER": "btn-ops-purchase-order-submit" };
  const containerIds= { "DISPATCH": "dispatch-bill-inputs-container","COMMISSION": "commissioning-report-inputs-container", "PURCHASE_ORDER": "purchase-order-inputs-container" };
  const fileObjects = { "DISPATCH": targetDispatchBillFileObj,        "COMMISSION": targetCommissioningReportFileObj,        "PURCHASE_ORDER": targetPurchaseOrderFileObj };
  const defaultBtnLabels = { "DISPATCH": "Process Dispatch Bill with AI", "COMMISSION": "Process Commissioning Report with AI", "PURCHASE_ORDER": "Process Purchase Order with AI" };

  const feedbackBanner  = document.getElementById(bannerIds[opsFlagTypeString]);
  const targetBtn       = document.getElementById(btnIds[opsFlagTypeString]);
  const inputsContainer = document.getElementById(containerIds[opsFlagTypeString]);
  const activeWorkingFile = fileObjects[opsFlagTypeString];
  
  if (!activeWorkingFile) {
    alert(`Please capture or select the corresponding document before running the AI engine.`);
    return;
  }

  // COMMISSION keys off a Project ID typeahead now, not a Lead dropdown —
  // see handleCommissioningReportProjectChange. The other two doc types
  // are unchanged.
  const isCommission = opsFlagTypeString === "COMMISSION";
  if (isCommission) {
    const projectInput = document.getElementById("commissioning-report-project-ta-input");
    if (!projectInput || !projectInput.value.trim()) {
      showBOQBanner("commissioning-report-feedback-banner", "⚠️ Project ID or Customer Name is required.", "error");
      if (projectInput) projectInput.focus();
      return;
    }
  } else {
    const leadDropdownIds = { "DISPATCH": "dispatch-bill-lead-dropdown", "PURCHASE_ORDER": "purchase-order-lead-dropdown" };
    const leadDropEl = document.getElementById(leadDropdownIds[opsFlagTypeString]);
    if (!leadDropEl || !leadDropEl.value || leadDropEl.value.trim() === "") {
      alert("Please select the Company / Lead this document belongs to before processing.");
      if (leadDropEl) leadDropEl.focus();
      return;
    }
  }

  // Order Acceptance Sent Date and Contract Review doc are compulsory on
  // every PO upload — Special Requirement stays optional.
  let poAcceptanceDate = "", poContractReviewFile = null;
  if (isPO) {
    poAcceptanceDate = document.getElementById("purchase-order-acceptance-date").value.trim();
    if (!poAcceptanceDate) {
      alert("Order Acceptance Sent Date is required.");
      return;
    }
    poContractReviewFile = document.getElementById("purchase-order-contract-review-file").files[0];
    if (!poContractReviewFile) {
      alert("Contract Review document is required.");
      return;
    }
  }

  if (feedbackBanner) feedbackBanner.style.display = "none";
  
  if (targetBtn) {
    targetBtn.disabled = true;
    targetBtn.innerHTML = '<div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></div> AI Processing & Matching Document...';
  }

  const overlayLabels = { "DISPATCH": "Saving Dispatch Bill...", "COMMISSION": "Saving Commissioning Report...", "PURCHASE_ORDER": "Saving Purchase Order..." };
  showBlockingOverlay(overlayLabels[opsFlagTypeString] || "Processing Document...");

  try {
    const fileBase64Raw = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(activeWorkingFile);
    });

    const leadDropdownIdsForSubmit = { "DISPATCH": "dispatch-bill-lead-dropdown", "PURCHASE_ORDER": "purchase-order-lead-dropdown" };
    const selectedLeadIdForSubmit = isCommission ? "" : document.getElementById(leadDropdownIdsForSubmit[opsFlagTypeString]).value.trim();
    const selectedProjectIdForSubmit = isCommission ? document.getElementById("commissioning-report-project-ta-input").value.trim() : "";

    // Owner of Order used to be a manual selection -- now auto-filled from
    // the logged-in operator, matching the same approach used elsewhere
    // (BOQ Prepared By, Job Card Created By, etc.) instead of asking.
    const fields = isPO ? { abps_owner_of_order: appActiveOperatorIdentityString || "" } : {};

    let contractReviewFile = null;
    if (isPO && poContractReviewFile) {
      const crBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(poContractReviewFile);
      });
      contractReviewFile = { fileName: poContractReviewFile.name, base64Data: crBase64, mimeType: poContractReviewFile.type || "application/octet-stream" };
    }

    const data = await apFetch({
      action: "commitMarketingOperationsDocument",
      activeEngineer: appActiveOperatorIdentityString,
      docType: opsFlagTypeString,
      fileName: activeWorkingFile.name,
      base64Data: fileBase64Raw,
      mimeType: activeWorkingFile.type || "application/octet-stream",
      fields,
      leadId: selectedLeadIdForSubmit,
      projectId: isCommission ? selectedProjectIdForSubmit : undefined,
      specialRequirement: isPO ? document.getElementById("purchase-order-special-requirement").value.trim() : undefined,
      orderAcceptanceSentDate: isPO ? poAcceptanceDate : undefined,
      contractReviewFile
    });
    if (data.success) {
      // Hide the file picker input controls on success
      if (inputsContainer) inputsContainer.style.display = "none";

      if (feedbackBanner) {
        feedbackBanner.style.cssText = "display: block; background: #dcfce7; border-color: #15803d; color: #15803d; padding: 14px; margin-bottom: 16px; border-left: 4px solid #15803d;";
        feedbackBanner.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
            <div style="flex:1; min-width:0;">
              <strong style="font-size:1rem;">Upload Successful!</strong><br/>
              <span style="font-size:0.88rem;"><strong>${data.matchedCompany}</strong> status updated to <strong>${isDispatch ? 'Order Dispatched' : (opsFlagTypeString === 'PURCHASE_ORDER' ? 'Order Received' : 'Product Commissioned')}</strong>.</span>

              ${isPO ? `
              <div style="margin-top:10px; background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:10px; font-size:0.82rem; color:#166534;">
                <div style="font-weight:700; font-size:0.78rem; text-transform:uppercase; color:#15803d; margin-bottom:8px; letter-spacing:0.3px;">Please verify the extracted data below is correct:</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                  <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">PO Number</span><br/><strong style="font-family:monospace; color:#111827;">${data.extractedPONumber || '—'}</strong></div>
                  <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">PO Date</span><br/><strong style="color:#111827;">${formatDateDMY(data.extractedPODate) || '—'}</strong></div>
                  <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">Basic Amount (excl. GST)</span><br/><strong style="color:#111827;">${data.extractedBasicAmount ? '₹' + Number(data.extractedBasicAmount).toLocaleString('en-IN') : '—'}</strong></div>
                  <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">Total Amount (incl. GST)</span><br/><strong style="color:#111827;">${data.extractedTotalAmount ? '₹' + Number(data.extractedTotalAmount).toLocaleString('en-IN') : '—'}</strong></div>
                  <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">Line Items Captured</span><br/><strong style="color:#111827;">${data.extractedLineItemCount || 0} items</strong></div>
                  <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">Project ID Assigned</span><br/><strong style="font-family:monospace; color:#111827;">${data.generatedProjectId || '—'}</strong></div>
                </div>
                <div style="margin-top:8px; font-size:0.75rem; color:${data.partialWriteWarning ? '#b45309' : '#15803d'}; border-top:1px dashed ${data.partialWriteWarning ? '#fcd34d' : '#86efac'}; padding-top:6px;">
                  ${data.partialWriteWarning ? '⚠ Core PO data was saved, but see the warning above — some downstream records may be incomplete.' : '✓ All data has been saved to the Purchase Order sheets. If anything looks wrong, check the UploadedDocumentInformation and PurchaseOrderInformation Google Sheets.'}
                </div>
              </div>` : ''}

              ${data.companyCrossCheckWarning ? `
              <div style="margin-top:10px; background:#fef2f2; border:1px solid #fca5a5; border-radius:6px; padding:10px; font-size:0.82rem; color:#991b1b;">
                <div style="font-weight:700; font-size:0.78rem; text-transform:uppercase; color:#b91c1c; margin-bottom:4px; letter-spacing:0.3px;">⚠ Company Mismatch Warning</div>
                ${data.companyCrossCheckWarning}
              </div>` : ''}
              ${data.partialWriteWarning ? `
              <div style="margin-top:10px; background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; padding:10px; font-size:0.82rem; color:#92400e;">
                <div style="font-weight:700; font-size:0.78rem; text-transform:uppercase; color:#b45309; margin-bottom:4px; letter-spacing:0.3px;">⚠ Partial Save Warning</div>
                ${data.partialWriteWarning}
              </div>` : ''}
            </div>
            <button class="nav-btn-styled" onclick="
              targetDispatchBillFileObj = null;
              targetCommissioningReportFileObj = null;
              targetPurchaseOrderFileObj = null;
              document.getElementById('dispatch-bill-raw-file').value = '';
              document.getElementById('commissioning-report-raw-file').value = '';
              document.getElementById('commissioning-report-project-ta-input').value = '';
              document.getElementById('commissioning-report-customer-name').value = '';
              document.getElementById('purchase-order-raw-file').value = '';
              const b1 = document.getElementById('dispatch-bill-upload-box');
              const b2 = document.getElementById('commissioning-report-upload-box');
              const b3 = document.getElementById('purchase-order-upload-box');
              if (b1) { b1.textContent = '📋 Select Dispatch Bill'; b1.classList.remove('done'); }
              if (b2) { b2.textContent = '📋 Select Commissioning Report'; b2.classList.remove('done'); }
              if (b3) { b3.textContent = '📋 Select Purchase Order'; b3.classList.remove('done'); }
              document.getElementById('purchase-order-acceptance-date').value = '';
              document.getElementById('purchase-order-special-requirement').value = '';
              document.getElementById('purchase-order-contract-review-file').value = '';
              const b4 = document.getElementById('purchase-order-contract-review-box');
              if (b4) { b4.textContent = '📋 Select Contract Review Document *'; b4.classList.remove('done'); }
              document.getElementById('dispatch-bill-feedback-banner').style.display = 'none';
              document.getElementById('commissioning-report-feedback-banner').style.display = 'none';
              document.getElementById('purchase-order-feedback-banner').style.display = 'none';
              document.getElementById('dispatch-bill-inputs-container').style.display = 'block';
              document.getElementById('commissioning-report-inputs-container').style.display = 'block';
              document.getElementById('purchase-order-inputs-container').style.display = 'block';
            " style="background:#15803d; color:white; padding:8px 14px; font-weight:700; flex-shrink:0; align-self:flex-start;">+ Process Another</button>
          </div>
        `;
      }
    } else {
      if (feedbackBanner) {
        // Special handling for company mismatch — show what AI detected
        if (data.aiDetectedCompany) {
          feedbackBanner.style.cssText = "display: block; background: #fffbeb; border-color: #b45309; color: #92400e; padding: 14px; margin-bottom: 14px; border-left: 4px solid #b45309;";
          feedbackBanner.innerHTML = `
            <strong>Company not found in your leads database.</strong><br/>
            <span style="font-size:0.85rem;">The document appears to be from: <strong>${data.aiDetectedCompany}</strong></span><br/>
            <span style="font-size:0.82rem; margin-top:6px; display:block; color:#78350f;">${data.suggestion || 'Make sure this company exists in your leads with a matching name, then try again.'}</span>
            <div style="margin-top:10px; font-size:0.8rem; color:#92400e;">
              The file has <strong>NOT</strong> been saved. Fix the company name in your leads first, then re-upload this document.
            </div>
          `;
        } else {
          feedbackBanner.style.cssText = "display: block; background: #fee2e2; border-color: #b91c1c; color: #b91c1c; padding: 12px; margin-bottom: 14px; border-left: 4px solid #b91c1c;";
          feedbackBanner.innerHTML = `<strong>Failed:</strong> ${data.error}`;
        }
      }
      if (targetBtn) {
        targetBtn.disabled = false;
        targetBtn.innerHTML = defaultBtnLabels[opsFlagTypeString];
      }
      }
  } catch(err) {
    if (feedbackBanner) {
      feedbackBanner.style.cssText = "display: block; background: #fee2e2; border-color: #b91c1c; color: #b91c1c; padding: 12px; margin-bottom: 14px; border-left: 4px solid #b91c1c;";
      feedbackBanner.innerHTML = `<strong>Network Exception:</strong> ${err.message}`;
    }
    if (targetBtn) {
      targetBtn.disabled = false;
      targetBtn.innerHTML = defaultBtnLabels[opsFlagTypeString];
    }
  } finally {
    hideBlockingOverlay();
  }
}

// ═══════════════════════════════════════════════════════
// UPLOAD PURCHASE ORDER — extract, review/edit, then commit.
// Two-step flow: extractPurchaseOrderForReview() calls the AI-only
// extraction route and renders an editable review table; nothing is
// saved until submitReviewedPurchaseOrder() is clicked. poReviewState
// holds every editable field plus the line-items array while the user
// edits, same pattern as manufacturing-clearance.js's mcLineItemState.
// ═══════════════════════════════════════════════════════
let poReviewState = null;

async function extractPurchaseOrderForReview() {
  const activeWorkingFile = targetPurchaseOrderFileObj;
  if (!activeWorkingFile) { alert("Please capture or select the Purchase Order document before running the AI engine."); return; }

  const leadDropEl = document.getElementById("purchase-order-lead-dropdown");
  if (!leadDropEl || !leadDropEl.value.trim()) {
    alert("Please select the Company / Lead this document belongs to before processing.");
    if (leadDropEl) leadDropEl.focus();
    return;
  }

  // Order Acceptance Sent Date and Contract Review doc are compulsory on
  // every PO upload — Special Requirement stays optional. Captured now
  // (not asked again in the review screen) since these three are locked
  // passthrough fields per the review screen's design.
  const poAcceptanceDate = document.getElementById("purchase-order-acceptance-date").value.trim();
  if (!poAcceptanceDate) { alert("Order Acceptance Sent Date is required."); return; }
  const poContractReviewFile = document.getElementById("purchase-order-contract-review-file").files[0];
  if (!poContractReviewFile) { alert("Contract Review document is required."); return; }

  const feedbackBanner = document.getElementById("purchase-order-feedback-banner");
  const targetBtn = document.getElementById("btn-ops-purchase-order-submit");
  if (feedbackBanner) feedbackBanner.style.display = "none";
  if (targetBtn) {
    targetBtn.disabled = true;
    targetBtn.innerHTML = '<div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></div> AI Extracting...';
  }
  showBlockingOverlay("Reading Purchase Order...");

  try {
    const fileBase64Raw = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(activeWorkingFile);
    });
    const contractReviewBase64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(poContractReviewFile);
    });

    const data = await apFetch({
      action: "extractPurchaseOrderPreview",
      leadId: leadDropEl.value.trim(),
      fileName: activeWorkingFile.name,
      base64Data: fileBase64Raw,
      mimeType: activeWorkingFile.type || "application/octet-stream",
      contractReviewFile: { fileName: poContractReviewFile.name, base64Data: contractReviewBase64, mimeType: poContractReviewFile.type || "application/octet-stream" },
    });

    if (!data.success) {
      showBOQBanner("purchase-order-feedback-banner", data.error || "Extraction failed.", "error", true);
      return;
    }

    // Everything the review screen needs, plus what's carried through
    // untouched to commit: the PO document itself (re-used, not
    // re-uploaded by the user), the Contract Review file object, and the
    // three locked passthrough values captured just above.
    poReviewState = {
      ...data,
      _poFileName: activeWorkingFile.name, _poBase64: fileBase64Raw,
      _poMimeType: activeWorkingFile.type || "application/octet-stream",
      _leadId: leadDropEl.value.trim(),
      _orderAcceptanceSentDate: poAcceptanceDate,
      _specialRequirement: document.getElementById("purchase-order-special-requirement").value.trim(),
      _contractReviewFileObj: poContractReviewFile,
    };

    document.getElementById("purchase-order-inputs-container").style.display = "none";
    renderPurchaseOrderReview();
  } catch(e) {
    showBOQBanner("purchase-order-feedback-banner", "Network error: " + e.message, "error", true);
  } finally {
    hideBlockingOverlay();
    if (targetBtn) { targetBtn.disabled = false; targetBtn.innerHTML = "Process Purchase Order with AI"; }
  }
}

// Client-side mirror of generateAbpsProjectId (abps-backend/routes/projects.js)
// — live preview only, so the user sees the Project ID update as they edit
// PO Number. The server generates the authoritative value at commit time;
// this is never sent anywhere, purely display.
function computePoReviewProjectIdPreview() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST offset
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  const fyLabel = String(fyStart).slice(-2) + '-' + String(fyStart + 1).slice(-2);
  const monthAbbr = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month - 1];
  const clean = (s) => (s || '').toString().trim().replace(/\s+/g, ' ');
  const poSeg = clean(poReviewState.poNumber) || 'NOPO';
  return `ABPS_${fyLabel}_${monthAbbr}_${clean(poReviewState.companyName)}_${poSeg}`;
}

function updatePoReviewField(key, value) {
  poReviewState[key] = value;
  if (key === 'poNumber') {
    const preview = document.getElementById('po-review-project-id-preview');
    if (preview) preview.textContent = computePoReviewProjectIdPreview();
  }
}

// Indian digit grouping (12,34,567 not 1,234,567) for every rupee-amount
// box in the review screen. Amount fields render as text inputs (not
// type="number", which rejects commas outright) — sanitizeAmountInput
// strips everything but digits/one decimal point as the user types (kept
// unformatted while focused, so commas don't fight cursor position);
// formatIndianCurrencyInput re-applies commas on blur / programmatic
// updates.
function formatIndianCurrencyInput(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const num = Number(raw);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function sanitizeAmountInput(el) {
  let v = el.value.replace(/[^0-9.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
  el.value = v;
  return v;
}

// Total Basic Price and Total Amount are derived, not typed — they recompute
// live from Quantity/Rate and Basic Price/GST respectively. Updated directly
// on the readonly input elements (not a full table re-render) so the field
// the user is actively typing in never loses focus/cursor position.
// GST Amount is *also* re-derived when Quantity or Rate changes: whatever
// GST-to-Basic ratio was in effect before the edit is preserved against the
// new Basic Price, rather than leaving GST frozen at a rupee figure that no
// longer corresponds to the new quantity.
function updatePoReviewLineItem(idx, key, value) {
  const item = poReviewState.lineItems[idx];
  if (!item) return;

  if (key === 'quantity' || key === 'ratePerQuantity') {
    const oldBasic = parseFloat(item.totalBasicPrice);
    const oldGst = parseFloat(item.gstAmount);
    const gstRate = (!isNaN(oldBasic) && oldBasic > 0 && !isNaN(oldGst)) ? (oldGst / oldBasic) : null;

    item[key] = value;
    const qty = parseFloat(item.quantity);
    const rate = parseFloat(item.ratePerQuantity);
    const basic = (!isNaN(qty) && !isNaN(rate)) ? qty * rate : '';
    item.totalBasicPrice = basic === '' ? '' : String(basic);
    if (gstRate !== null && basic !== '') {
      item.gstAmount = String(Math.round(basic * gstRate * 100) / 100);
    }

    const basicEl = document.getElementById(`po-li-totalBasicPrice-${idx}`);
    if (basicEl) basicEl.value = formatIndianCurrencyInput(item.totalBasicPrice);
    const gstEl = document.getElementById(`po-li-gstAmount-${idx}`);
    if (gstEl && document.activeElement !== gstEl) gstEl.value = formatIndianCurrencyInput(item.gstAmount);
  } else {
    item[key] = value;
  }

  if (key === 'quantity' || key === 'ratePerQuantity' || key === 'gstAmount') {
    const basic = parseFloat(item.totalBasicPrice);
    const gst = parseFloat(item.gstAmount);
    const total = (!isNaN(basic) && !isNaN(gst)) ? basic + gst : '';
    item.totalAmount = total === '' ? '' : String(total);
    const totalEl = document.getElementById(`po-li-totalAmount-${idx}`);
    if (totalEl) totalEl.value = formatIndianCurrencyInput(item.totalAmount);
  }
}

// Auto-grow a text-value box so long values wrap instead of clipping.
function autoGrowPoField(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// "Select from a list of companies" for the review screen's Company Name —
// mirrors the Select Lead / Company dropdown from the upload step. Company
// names are parsed off cachedUploadLeadsList's displayLabel
// ("Company — Contact (LEAD-42)" or "Company (LEAD-42)").
function extractCompanyNameFromDisplayLabel(label) {
  const noLeadId = (label || '').replace(/\s*\([^()]*\)\s*$/, '');
  return noLeadId.split(' — ')[0].trim();
}
function poReviewCompanyOptions() {
  const names = new Set();
  (cachedUploadLeadsList || []).forEach(l => {
    const n = extractCompanyNameFromDisplayLabel(l.displayLabel);
    if (n) names.add(n);
  });
  if (poReviewState && poReviewState.companyName) names.add(poReviewState.companyName);
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function addPoReviewLineItem() {
  poReviewState.lineItems.push({ itemCode: '', hsnNumber: '', description: '', quantity: '', unit: '', ratePerQuantity: '', totalBasicPrice: '', gstAmount: '', totalAmount: '' });
  renderPoReviewLineItemsTable();
}

function removePoReviewLineItem(idx) {
  poReviewState.lineItems.splice(idx, 1);
  renderPoReviewLineItemsTable();
}

// Column widths are deliberately unequal: Order Product Description is the
// only free-text field people actually need to read in full, everything
// else is short codes/numbers. Widths are % of table width.
const PO_REVIEW_LI_COLS = [
  ['itemCode', 'Customer Item Code', 'text', 8.6],
  ['hsnNumber', 'HSN Number', 'text', 8.6],
  ['description', 'Order Product Description *', 'text', 30.3],
  ['quantity', 'Order Quantity *', 'number', 5.6],
  ['unit', 'UOM *', 'text', 5.6],
  ['ratePerQuantity', 'Rate / Quantity *', 'number', 9.6],
  ['totalBasicPrice', 'Total Basic Price', 'number', 9.6],
  ['gstAmount', 'GST Amount *', 'number', 9.6],
  ['totalAmount', 'Total Amount (incl. GST)', 'number', 9.6],
];

// Total Basic Price / Total Amount are always derived, never a value
// captured as-is from AI extraction or a prior save — recomputing them here
// (not just on the input handlers in updatePoReviewLineItem) means a line
// item is never displayed with a stale/inconsistent total no matter how it
// entered poReviewState (fresh AI extraction, Add Row, etc).
function recomputePoReviewLineItemTotals(item) {
  const qty = parseFloat(item.quantity);
  const rate = parseFloat(item.ratePerQuantity);
  if (!isNaN(qty) && !isNaN(rate)) item.totalBasicPrice = String(qty * rate);
  const basic = parseFloat(item.totalBasicPrice);
  const gst = parseFloat(item.gstAmount);
  if (!isNaN(basic) && !isNaN(gst)) item.totalAmount = String(basic + gst);
}

function renderPoReviewLineItemsTable() {
  const wrap = document.getElementById("po-review-lineitems-wrap");
  if (!wrap) return;
  const items = poReviewState.lineItems || [];
  items.forEach(recomputePoReviewLineItemTotals);
  const cols = PO_REVIEW_LI_COLS;
  const derivedKeys = ['totalBasicPrice', 'totalAmount'];
  // itemCode/hsnNumber/description/unit are free text and can run longer
  // than their column width — rendered as auto-growing textareas so the
  // full value wraps onto extra lines (row height grows) instead of being
  // clipped. Quantity/Rate/GST/derived totals stay single-line number inputs.
  const wrapKeys = ['itemCode', 'hsnNumber', 'description', 'unit'];
  // Rate/Basic/GST/Total are rupee amounts — rendered with Indian comma
  // grouping (sanitizeAmountInput/formatIndianCurrencyInput, see their
  // definitions above updatePoReviewLineItem). Quantity is a count, not an
  // amount, so it stays a plain number input.
  const amountKeys = ['ratePerQuantity', 'totalBasicPrice', 'gstAmount', 'totalAmount'];
  wrap.innerHTML = `
    <table class="store-basket-data-table" style="width:100%; table-layout:fixed;">
      <colgroup>${cols.map(c => `<col style="width:${c[3]}%;" />`).join('')}<col style="width:3%;" /></colgroup>
      <thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead>
      <tbody>
        ${items.length === 0 ? `<tr><td colspan="${cols.length + 1}" style="text-align:center; color:var(--muted);">No product rows extracted from the PO — click + Add Row to add one manually</td></tr>` : items.map((it, idx) => `
          <tr>
            ${cols.map(([key, , type]) => {
              const isDerived = derivedKeys.includes(key);
              const isDescription = key === 'description';
              const isWrap = wrapKeys.includes(key);
              const isAmount = amountKeys.includes(key);
              const val = (it[key] ?? '').toString();
              const valAttr = val.replace(/"/g, '&quot;');
              const centerStyle = isDescription ? '' : 'text-align:center;';
              if (isAmount) {
                const formattedAttr = formatIndianCurrencyInput(val).replace(/"/g, '&quot;');
                if (isDerived) {
                  return `<td style="vertical-align:middle;"><input id="po-li-${key}-${idx}" type="text" inputmode="decimal" value="${formattedAttr}" readonly disabled
                    style="width:100%; min-width:0; box-sizing:border-box; padding:5px; font-size:0.85rem; ${centerStyle} background:#eef1f5; color:var(--text); border:1px solid var(--border);" /></td>`;
                }
                return `<td style="vertical-align:middle;"><input id="po-li-${key}-${idx}" type="text" inputmode="decimal" value="${formattedAttr}"
                  oninput="updatePoReviewLineItem(${idx}, '${key}', sanitizeAmountInput(this))"
                  onfocus="this.value = (poReviewState.lineItems[${idx}]['${key}'] ?? '').toString();"
                  onblur="this.value = formatIndianCurrencyInput(poReviewState.lineItems[${idx}]['${key}']);"
                  style="width:100%; min-width:0; box-sizing:border-box; padding:5px; font-size:0.85rem; ${centerStyle}" /></td>`;
              }
              if (isWrap) {
                return `<td style="vertical-align:middle;"><textarea rows="1" oninput="updatePoReviewLineItem(${idx}, '${key}', this.value); autoGrowPoField(this);" onfocus="autoGrowPoField(this);"
                  style="width:100%; min-width:0; box-sizing:border-box; padding:5px; font-size:0.85rem; ${centerStyle} resize:none; overflow:hidden; font-family:inherit; min-height:28px;">${val.replace(/</g, '&lt;')}</textarea></td>`;
              }
              return `<td style="vertical-align:middle;"><input type="${type}" value="${valAttr}" oninput="updatePoReviewLineItem(${idx}, '${key}', this.value)"
                style="width:100%; min-width:0; box-sizing:border-box; padding:5px; font-size:0.85rem; ${centerStyle}" /></td>`;
            }).join('')}
            <td style="vertical-align:middle; text-align:center;"><button onclick="removePoReviewLineItem(${idx})" title="Remove row" style="background:none; border:none; color:#b91c1c; font-weight:700; cursor:pointer; font-size:1rem;">✕</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('textarea').forEach(autoGrowPoField);
}

function renderPurchaseOrderReview() {
  const zone = document.getElementById("purchase-order-review-zone");
  const s = poReviewState;
  const fmt = (v) => (v === null || v === undefined) ? '' : v.toString();

  // Forces a hard row break in the auto-flowing grid so each labeled group
  // of fields below the Product List starts on its own row regardless of
  // how many columns the current viewport width gives the grid.
  const poReviewRowBreak = `<div style="grid-column: 1 / -1; height: 0;"></div>`;

  const lockedRow = (label, value, spanStyle) => `
    <div class="grid-cell-item" style="background:#f1f5f9;${spanStyle || ''}">
      <label style="font-size:0.72rem;">${label}</label>
      <div style="padding:6px 4px; font-weight:600; color:var(--text); font-size:0.95rem; white-space:normal; word-break:break-word;">${value || '—'}</div>
    </div>`;

  // Free-text fields render as an auto-growing textarea so a value that
  // doesn't fit the box width wraps instead of clipping — the box grows
  // taller instead of hiding the rest of the value. Number/date fields stay
  // single-line inputs (nothing to wrap).
  const editField = (label, key, type, spanStyle, required) => {
    const raw = s[key];
    const val = type === 'date' ? (raw ? raw.toString().slice(0, 10) : '') : fmt(raw);
    const labelText = required ? `${label} *` : label;
    // Every "number" field on this screen is a rupee amount (Basic/GST/
    // Total PO Amount, ABG/PBG/Advance Amount) — rendered with Indian comma
    // grouping the same way the Product List's amount columns are.
    if (type === 'number') {
      return `
        <div class="grid-cell-item" style="${spanStyle || ''}">
          <label style="font-size:0.72rem;">${labelText}</label>
          <input type="text" inputmode="decimal" value="${formatIndianCurrencyInput(val).replace(/"/g, '&quot;')}"
            oninput="updatePoReviewField('${key}', sanitizeAmountInput(this))"
            onfocus="this.value = (poReviewState['${key}'] ?? '').toString();"
            onblur="this.value = formatIndianCurrencyInput(poReviewState['${key}']);"
            style="font-size:0.95rem; padding:7px 8px;" />
        </div>`;
    }
    if (type === 'date') {
      return `
        <div class="grid-cell-item" style="${spanStyle || ''}">
          <label style="font-size:0.72rem;">${labelText}</label>
          <input type="date" value="${val.replace(/"/g, '&quot;')}" oninput="updatePoReviewField('${key}', this.value)" style="font-size:0.95rem; padding:7px 8px;" />
        </div>`;
    }
    return `
      <div class="grid-cell-item" style="${spanStyle || ''}">
        <label style="font-size:0.72rem;">${labelText}</label>
        <textarea rows="1" oninput="updatePoReviewField('${key}', this.value); autoGrowPoField(this);" onfocus="autoGrowPoField(this);"
          style="font-size:0.95rem; padding:7px 8px; resize:none; overflow:hidden; font-family:inherit; min-height:32px;">${val.replace(/</g, '&lt;')}</textarea>
      </div>`;
  };

  const contractReviewLinkHtml = s.contractReviewUrl
    ? `<a href="${driveLink(s.contractReviewUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open Document ↗</a>`
    : '—';

  const companyNameFieldHtml = `
    <div class="grid-cell-item" style="grid-column: span 4;">
      <label style="font-size:0.72rem;">Company Name</label>
      <select oninput="updatePoReviewField('companyName', this.value)" style="font-size:0.95rem; padding:7px 8px;">
        ${poReviewCompanyOptions().map(name => `<option value="${name.replace(/"/g, '&quot;')}" ${name === s.companyName ? 'selected' : ''}>${name}</option>`).join('')}
      </select>
    </div>`;

  zone.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-top:8px;">
      <div style="font-weight:800; color:var(--brand); margin-bottom:4px; font-size:1.05rem;">Review Extracted Purchase Order</div>
      <div style="font-size:0.88rem; color:var(--muted); margin-bottom:14px;">Edit anything the AI misread, then Submit PO. Nothing is saved until you submit. Fields marked * are required.</div>

      ${s.duplicateWarning ? `<div style="background:#fef3c7; border-left:4px solid #b45309; color:#92400e; padding:10px 12px; border-radius:4px; margin-bottom:14px; font-size:0.92rem;">⚠ ${s.duplicateWarning}</div>` : ''}

      <div class="po-review-fields-grid" style="margin-bottom:14px;">
        <div class="grid-cell-item" style="background:#f1f5f9; grid-column: span 4;">
          <label style="font-size:0.72rem;">Project ID</label>
          <div id="po-review-project-id-preview" style="padding:6px 4px; font-weight:700; color:var(--brand); font-family:monospace; font-size:0.82rem; word-break:break-all;">${computePoReviewProjectIdPreview()}</div>
        </div>
        ${lockedRow('Status', 'Inactive', 'grid-column: span 4;')}
        ${editField('PO Number', 'poNumber', 'text', 'grid-column: span 4;', true)}
        ${editField('PO Date', 'poDate', 'date', 'grid-column: span 4;', true)}
        ${companyNameFieldHtml}
        ${editField('GST Number', 'gstNumber', 'text', 'grid-column: span 4;')}
        ${poReviewRowBreak}

        ${editField('Head Office Address', 'headOfficeAddress', 'text', 'grid-column: span 8;')}
        ${editField('Delivery Address', 'deliveryAddress', 'text', 'grid-column: span 8;')}
        ${editField('Tentative Delivery Date', 'deliveryDate', 'date', 'grid-column: span 4;', true)}
      </div>

      <div style="font-weight:700; color:var(--brand); margin:14px 0 8px; font-size:0.95rem;">Product List</div>
      <div id="po-review-lineitems-wrap"></div>
      <button class="nav-btn-styled" style="background:var(--brand); margin-top:8px; padding:6px 14px; font-size:0.85rem;" onclick="addPoReviewLineItem()">+ Add Row</button>

      <div class="po-review-fields-grid" style="margin-top:16px;">
        ${editField('Freight Scope', 'freightScope', 'text', 'grid-column: span 8;')}
        ${editField('Insurance Scope', 'insuranceScope', 'text', 'grid-column: span 8;')}
        ${editField('Packaging and Forwarding Scope', 'packagingForwardingScope', 'text', 'grid-column: span 8;')}
        ${poReviewRowBreak}

        ${editField('Delivery Schedule as per PO', 'deliverySchedule', 'text', 'grid-column: span 8;')}
        ${editField('Warranty Terms', 'warrantyTerms', 'text', 'grid-column: span 8;')}
        ${editField('Payment Terms', 'paymentTerms', 'text', 'grid-column: span 8;')}
        ${poReviewRowBreak}

        ${editField('ABG Terms', 'abgTerms', 'text', 'grid-column: span 6;')}
        ${editField('ABG Amount', 'abgAmount', 'number', 'grid-column: span 3;')}
        ${editField('PBG Terms', 'pbgTerms', 'text', 'grid-column: span 6;')}
        ${editField('PBG Amount', 'pbgAmount', 'number', 'grid-column: span 3;')}
        ${editField('LD Clause', 'ldClause', 'text', 'grid-column: span 6;')}
        ${poReviewRowBreak}

        ${editField('Inspection Terms', 'inspectionTerms', 'text', 'grid-column: span 8;')}
        ${editField('Special Requirement', '_specialRequirement', 'text', 'grid-column: span 8;')}
        ${editField('Documents Requirement', 'documentsRequirement', 'text', 'grid-column: span 8;')}
        ${poReviewRowBreak}

        ${editField('Basic PO Amount', 'poBasicAmount', 'number', 'grid-column: span 3;', true)}
        ${editField('PO GST Amount', 'poGstAmount', 'number', 'grid-column: span 3;', true)}
        ${editField('PO Total Amount', 'poTotalAmount', 'number', 'grid-column: span 3;', true)}
        ${lockedRow('Contract Review Link', contractReviewLinkHtml, 'grid-column: span 4;')}
        ${editField('Order Acceptance Sent Date', '_orderAcceptanceSentDate', 'date', 'grid-column: span 4;', true)}
        ${editField('Advance Amount', 'advanceAmount', 'number', 'grid-column: span 3;')}
        ${editField('Advance Received Date', 'advanceReceivedDate', 'date', 'grid-column: span 4;')}
      </div>

      <div id="purchase-order-review-feedback" style="display:none; margin-top:14px; padding:12px; border-radius:var(--radius); border-left:4px solid;"></div>

      <button class="nav-btn-styled" id="btn-po-review-submit" style="margin-top:16px; width:100%; padding:12px; background:var(--accent); font-weight:700; font-size:0.95rem;" onclick="submitReviewedPurchaseOrder()">Submit PO</button>
    </div>
  `;
  zone.style.display = "block";
  renderPoReviewLineItemsTable();
  // Grow every textarea to fit its prefilled value on first render.
  zone.querySelectorAll('.grid-cell-item textarea').forEach(autoGrowPoField);
}

// Mirrors Create BOQ's inline-banner validation pattern (no alert()s).
function validatePoReviewBeforeSubmit(s) {
  if (!(s.poNumber || '').toString().trim()) return "PO Number is required.";
  if (!(s.poDate || '').toString().trim()) return "PO Date is required.";
  if (!(s.deliveryDate || '').toString().trim()) return "Tentative Delivery Date is required.";
  const items = s.lineItems || [];
  if (items.length === 0) return "At least one product row is required.";
  const badRow = items.some(it =>
    !(it.description || '').toString().trim() ||
    !(it.quantity !== '' && it.quantity !== null && it.quantity !== undefined && it.quantity.toString().trim() !== '') ||
    !(it.unit || '').toString().trim() ||
    !(it.ratePerQuantity !== '' && it.ratePerQuantity !== null && it.ratePerQuantity !== undefined && it.ratePerQuantity.toString().trim() !== '') ||
    !(it.gstAmount !== '' && it.gstAmount !== null && it.gstAmount !== undefined && it.gstAmount.toString().trim() !== '')
  );
  if (badRow) return "Every product row must have Order Product Description, Order Quantity, UOM, Rate / Quantity, and GST Amount filled in.";
  if (!(s.poBasicAmount !== '' && s.poBasicAmount !== null && s.poBasicAmount !== undefined && s.poBasicAmount.toString().trim() !== '')) return "Basic PO Amount is required.";
  if (!(s.poGstAmount !== '' && s.poGstAmount !== null && s.poGstAmount !== undefined && s.poGstAmount.toString().trim() !== '')) return "PO GST Amount is required.";
  if (!(s.poTotalAmount !== '' && s.poTotalAmount !== null && s.poTotalAmount !== undefined && s.poTotalAmount.toString().trim() !== '')) return "PO Total Amount is required.";
  if (!(s._orderAcceptanceSentDate || '').toString().trim()) return "Order Acceptance Sent Date is required.";
  return null;
}

async function submitReviewedPurchaseOrder() {
  const s = poReviewState;
  if (!s) return;
  const btn = document.getElementById("btn-po-review-submit");
  const fb = document.getElementById("purchase-order-review-feedback");
  if (fb) fb.style.display = "none";

  const validationError = validatePoReviewBeforeSubmit(s);
  if (validationError) {
    showBOQBanner("purchase-order-review-feedback", "⚠️ " + validationError, "error", true);
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></div> Saving...';
  }
  showBlockingOverlay("Saving Purchase Order...");

  try {
    const crBase64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(s._contractReviewFileObj);
    });

    const data = await apFetch({
      action: "commitReviewedPurchaseOrder",
      activeEngineer: appActiveOperatorIdentityString,
      operatorName: appActiveOperatorIdentityString || "Unknown",
      leadId: s._leadId,
      fileName: s._poFileName, base64Data: s._poBase64, mimeType: s._poMimeType,
      specialRequirement: s._specialRequirement,
      orderAcceptanceSentDate: s._orderAcceptanceSentDate,
      contractReviewFile: { fileName: s._contractReviewFileObj.name, base64Data: crBase64, mimeType: s._contractReviewFileObj.type || "application/octet-stream" },
      contractReviewUrl: s.contractReviewUrl,
      companyName: s.companyName, poNumber: s.poNumber, poDate: s.poDate,
      headOfficeAddress: s.headOfficeAddress, deliveryAddress: s.deliveryAddress, gstNumber: s.gstNumber, deliveryDate: s.deliveryDate,
      lineItems: s.lineItems,
      freightScope: s.freightScope, insuranceScope: s.insuranceScope, packagingForwardingScope: s.packagingForwardingScope,
      deliverySchedule: s.deliverySchedule, warrantyTerms: s.warrantyTerms, paymentTerms: s.paymentTerms,
      abgTerms: s.abgTerms, abgAmount: s.abgAmount, pbgTerms: s.pbgTerms, pbgAmount: s.pbgAmount,
      ldClause: s.ldClause, inspectionTerms: s.inspectionTerms, documentsRequirement: s.documentsRequirement,
      poBasicAmount: s.poBasicAmount, poGstAmount: s.poGstAmount, poTotalAmount: s.poTotalAmount,
      advanceAmount: s.advanceAmount, advanceReceivedDate: s.advanceReceivedDate,
      productName: s.productName, summary: s.summary, scopeOfWork: s.scopeOfWork, abgRequired: s.abgRequired,
    });

    if (data.success) {
      renderPurchaseOrderCommitSuccess(data);
    } else {
      // Per design: keep poReviewState and the review screen intact on
      // failure so edits aren't lost — never fall back to the upload inputs.
      showBOQBanner("purchase-order-review-feedback", data.error || "Failed to save Purchase Order.", "error", true);
      if (btn) { btn.disabled = false; btn.innerHTML = "Submit PO"; }
    }
  } catch(e) {
    showBOQBanner("purchase-order-review-feedback", "Network error: " + e.message, "error", true);
    if (btn) { btn.disabled = false; btn.innerHTML = "Submit PO"; }
  } finally {
    hideBlockingOverlay();
  }
}

function renderPurchaseOrderCommitSuccess(data) {
  const zone = document.getElementById("purchase-order-review-zone");
  zone.innerHTML = `
    <div style="background:#f0fdf4; border-left:4px solid #15803d; color:#15803d; padding:14px; border-radius:var(--radius); margin-top:8px;">
      <strong style="font-size:1rem;">Purchase Order Saved!</strong>
      <div style="margin-top:10px; background:#fff; border:1px solid #86efac; border-radius:6px; padding:10px; font-size:0.82rem; color:#166534;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
          <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">PO Number</span><br/><strong style="font-family:monospace; color:#111827;">${data.extractedPONumber || '—'}</strong></div>
          <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">PO Date</span><br/><strong style="color:#111827;">${formatDateDMY(data.extractedPODate) || '—'}</strong></div>
          <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">Basic Amount (excl. GST)</span><br/><strong style="color:#111827;">${data.extractedBasicAmount ? '₹' + Number(data.extractedBasicAmount).toLocaleString('en-IN') : '—'}</strong></div>
          <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">Total Amount (incl. GST)</span><br/><strong style="color:#111827;">${data.extractedTotalAmount ? '₹' + Number(data.extractedTotalAmount).toLocaleString('en-IN') : '—'}</strong></div>
          <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">Line Items Saved</span><br/><strong style="color:#111827;">${data.extractedLineItemCount || 0} items</strong></div>
          <div><span style="color:#6b7a8d; font-size:0.72rem; text-transform:uppercase;">Project ID Assigned</span><br/><strong style="font-family:monospace; color:#111827;">${data.generatedProjectId || '—'}</strong></div>
        </div>
      </div>
      <button class="nav-btn-styled" onclick="resetPurchaseOrderWorkspace()" style="margin-top:12px; background:#15803d; color:#fff; padding:8px 14px; font-weight:700;">+ Process Another</button>
    </div>
  `;
}

function resetPurchaseOrderWorkspace() {
  poReviewState = null;
  targetPurchaseOrderFileObj = null;
  document.getElementById('purchase-order-raw-file').value = '';
  const box = document.getElementById('purchase-order-upload-box');
  if (box) { box.textContent = '📋 Select Purchase Order *'; box.classList.remove('done'); }
  document.getElementById('purchase-order-acceptance-date').value = '';
  document.getElementById('purchase-order-special-requirement').value = '';
  document.getElementById('purchase-order-contract-review-file').value = '';
  const crBox = document.getElementById('purchase-order-contract-review-box');
  if (crBox) { crBox.textContent = '📋 Select Contract Review Document *'; crBox.classList.remove('done'); }
  const leadDrop = document.getElementById('purchase-order-lead-dropdown');
  if (leadDrop) leadDrop.value = '';
  document.getElementById('purchase-order-feedback-banner').style.display = 'none';
  const zone = document.getElementById('purchase-order-review-zone');
  zone.style.display = 'none'; zone.innerHTML = '';
  document.getElementById('purchase-order-inputs-container').style.display = 'block';
}

function handleGateFileSelectionChange(input, boxId, textMsg) {
  const file = input.files[0];
  if (!file) return;
  if (boxId === 'gate-invoice-box') targetGateInvoiceFileObj = file;
  else if (boxId === 'gate-challan-box') targetGateChallanFileObj = file;
  const box = document.getElementById(boxId);
  box.textContent = textMsg; box.classList.add('done');
}

async function renderIsolatedDocumentInfoSection(leadRef, leadId, scopeNode) {
  const mount = scopeNode.querySelector(".doc-info-mount-point");
  if (!mount) return;
  mount.innerHTML = '<p style="color:var(--muted); font-size:0.82rem; padding:8px 0;">Loading Document Information...</p>';

  try {
    const data = await apFetch({ action: "fetchUploadedDocumentInfo", leadId: leadId });

    if (!data.success || !data.row) {
      const renderEmptyPlaceholder = (title, color) => `
        <div style="margin-bottom:12px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:${color}; background:${color}18; padding:4px 10px; border-radius:4px; margin-bottom:8px; letter-spacing:0.5px;">${title}</div>
          <div style="font-size:0.8rem; color:var(--muted); font-style:italic; padding:6px 8px; background:#f8fafc; border:1px dashed #e2e8f0; border-radius:4px;">Not uploaded yet</div>
        </div>`;
      mount.innerHTML = `
        <div style="border-top:2px solid var(--border); padding-top:12px; margin-top:4px;">
          <div style="font-size:0.78rem; font-weight:800; text-transform:uppercase; color:var(--text); margin-bottom:10px; letter-spacing:0.5px;">📄 Documents</div>
          ${renderEmptyPlaceholder("Purchase Order", "#0056b3")}
          ${renderEmptyPlaceholder("Project Invoice", "#059669")}
          ${renderEmptyPlaceholder("Commissioning Report", "#7c3aed")}
        </div>`;
      return;
    }

    const row = data.row;

    const poFields = [
      "Project ID", "Purchase Order Number", "Purchase Order Date", "Committed Delivery Date",
      "Purchase Order Product Name", "Purchase Order Summary", "Basic Purchase Order Amount (in Rs)",
      "Purchase Order GST Amount", "Purchase Order Total Amount", "Payment Terms",
      "Name of ABPS Owner of Order", "Purchase Order Warranty Terms", "ABG Required", "Scope of Work"
    ];
    // "Dispatch Bill" was retired as a standalone upload back in migration
    // 091 — Project Invoice Generation replaced it. These fields are now
    // server-computed from the actual invoice, not typed in (see
    // routes/projects.js's syncProjectInvoiceToMarketing).
    const projectInvoiceFields = [
      "Project Invoice Number", "Project Invoice Date", "Customer PO Number",
      "Customer PO Date", "Basic Project Invoice Amount (in Rs)", "Project Invoice GST Amount",
      "Total Project Invoice Amount"
    ];
    const commissionFields = [
      "Date of Product Commissioning", "Commissioning ABPS Engineer Name",
      "Commissioned Product", "Customer Contact Person"
    ];

    const hasPO         = poFields.some(f => row[f] && row[f] !== "");
    const hasInvoice    = projectInvoiceFields.some(f => row[f] && row[f] !== "");
    const hasCommission = commissionFields.some(f => row[f] && row[f] !== "");

    // Always show the section — with data if available, with placeholder if not

    const renderFieldRow = (label, value) => {
      if (!value || value === "") return "";
      return `<div style="display:flex; flex-direction:column; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:6px 8px; min-width:0; word-break:break-word;">
        <span style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px;">${label}</span>
        <span style="font-size:0.82rem; font-weight:600; color:var(--text);">${value}</span>
      </div>`;
    };

    const renderSection = (title, color, fields, extraHtml) => {
      const hasData = fields.some(f => row[f] && row[f] !== "");
      if (!hasData) return "";
      const fieldsHtml = fields.map(f => renderFieldRow(f, row[f])).join("");
      return `
        <div style="margin-bottom:12px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:${color}; background:${color}18; padding:4px 10px; border-radius:4px; margin-bottom:8px; letter-spacing:0.5px;">
            ${title}
          </div>
          <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px;">
            ${fieldsHtml}
          </div>
          ${extraHtml || ""}
        </div>`;
    };

    const renderEmptySection = (title, color) => `
      <div style="margin-bottom:12px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:${color}; background:${color}18; padding:4px 10px; border-radius:4px; margin-bottom:8px; letter-spacing:0.5px;">
          ${title}
        </div>
        <div style="font-size:0.8rem; color:var(--muted); font-style:italic; padding:6px 8px; background:#f8fafc; border:1px dashed #e2e8f0; border-radius:4px;">
          Not uploaded yet
        </div>
      </div>`;

    // Project Invoice's own PDF, kept live in sync by routes/projects.js —
    // link out to it the same way the Project Review Doc link works
    // elsewhere (driveLink() wraps the private Drive proxy URL).
    const invoiceDocLink = row.projectInvoiceDocumentUrl
      ? `<a href="${driveLink(row.projectInvoiceDocumentUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; font-size:0.8rem; display:inline-block; margin-top:4px;">Open Project Invoice ↗</a>`
      : "";

    mount.innerHTML = `
      <div style="border-top:2px solid var(--border); padding-top:12px; margin-top:4px;">
        <div style="font-size:0.78rem; font-weight:800; text-transform:uppercase; color:var(--text); margin-bottom:10px; letter-spacing:0.5px;">📄 Documents</div>
        ${hasPO         ? renderSection("Purchase Order", "#0056b3", poFields)             : renderEmptySection("Purchase Order", "#0056b3")}
        ${hasInvoice    ? renderSection("Project Invoice", "#059669", projectInvoiceFields, invoiceDocLink) : renderEmptySection("Project Invoice", "#059669")}
        ${hasCommission ? renderSection("Commissioning Report", "#7c3aed", commissionFields) : renderEmptySection("Commissioning Report", "#7c3aed")}
      </div>`;

  } catch(e) {
    mount.innerHTML = '';
  }
}

function handleFGProjectIdChange(selectedProjectId, canvasId) {
  const customerInput = document.getElementById(`fg-customer-${canvasId}`);
  if (!customerInput) return;
  if (!selectedProjectId || !window.fgProjectMetaCache) { customerInput.value = ""; return; }
  const meta = window.fgProjectMetaCache[selectedProjectId];
  customerInput.value = meta ? (meta.companyName || "") : "";
}

// ─── ITEM CODE MODULE ───────────────────────────────────────────

