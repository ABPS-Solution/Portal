// MIGRATED: was the Apps Script /exec URL. Now points at the Cloud Run
// backend's /exec bridge route (see server.js), which accepts the exact
// same { action, ...payload, sessionToken } POST shape apFetch() already
// sends — so this one-line change is the entire frontend migration for
// every module that's been ported. Replace <YOUR-CLOUD-RUN-URL> with
// your actual deployed Cloud Run service URL once you've deployed.
const GAS_URL = "https://abps-backend-244281871074.asia-south1.run.app/exec";

// Direct REST helper for new modules — per server.js's own comment, new
// modules should call real REST paths, not the /exec legacy-action bridge.
// Derives the backend's base URL from GAS_URL so there's only one place
// (GAS_URL itself) that ever needs to change if the backend URL changes.
async function acFetch(path, payload) {
  const base = GAS_URL.replace(/\/exec$/, "");
  const res  = await fetch(base + "/api/accounts/" + path, {
    method: "POST",
    body: JSON.stringify({ ...payload, sessionToken: localStorage.getItem("sessionToken") }),
  });
  const data = await res.json();
  if (!data.success && data.code === "SESSION_EXPIRED") {
    localStorage.clear();
    document.getElementById("app-container").style.display  = "none";
    document.getElementById("auth-container").style.display = "flex";
    initializeGoogleAuthPlatformEngine();
    throw new Error("SESSION_EXPIRED");
  }
  return data;
}

// driveLink — backend-generated document links (BOQ/PRN/PO PDFs, drawing
// documents, project invoices...) point at this app's own authenticated
// proxy (GET /api/driveFile/:fileId), not a public Drive URL — the files
// carry no public sharing permission, so the proxy requires the viewer's
// own session token as a query param (a plain <a href> navigation can't
// send apFetch's JSON body). Every href/src that renders one of these
// URLs must be wrapped in this, or the link 401s.
function driveLink(url) {
  if (!url) return url;
  const token = localStorage.getItem("sessionToken") || "";
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

async function apFetch(payload) {
  payload.sessionToken = localStorage.getItem("sessionToken");
  const res  = await fetch(GAS_URL, { method: "POST", body: JSON.stringify(payload) });
  const data = await res.json();
  if (!data.success && data.code === "SESSION_EXPIRED") {
    localStorage.clear();
    document.getElementById("app-container").style.display   = "none";
    document.getElementById("auth-container").style.display  = "flex";
    // Show a clean message on the auth card
    const authCard = document.querySelector(".auth-card");
    if (authCard) {
      const msg = document.createElement("div");
      msg.style.cssText = "background:#fff3cd; border:1px solid #ffc107; color:#856404; padding:10px 14px; border-radius:6px; font-size:0.85rem; font-weight:700; margin-bottom:16px; text-align:center;";
      msg.textContent   = "Your session has expired. Please log in again.";
      authCard.insertBefore(msg, authCard.firstChild);
      setTimeout(() => msg.remove(), 6000);
    }
    initializeGoogleAuthPlatformEngine();
    throw new Error("SESSION_EXPIRED");
  }
  return data;
}

/**
 * GLOBAL JS ERROR BOUNDARY
 * Prevents silent UI freezes on uncaught errors.
 */

window.addEventListener("beforeunload", function(e) {
  if (boqFormIsDirty || boqUpdateIsDirty) {
    e.preventDefault();
    e.returnValue = "You have unsaved changes in a BOQ form. Are you sure you want to leave?";
    return e.returnValue;
  }
});

window.onerror = function(message, source, lineno, colno, error) {
  if (message === "SESSION_EXPIRED" || (error && error.message === "SESSION_EXPIRED")) return true;
  console.error("Uncaught error:", message, "at", source, lineno);
  // Only show UI alert for errors that aren't network/session related
  if (!message.includes("fetch") && !message.includes("network")) {
    const appContainer = document.getElementById("app-container");
    if (appContainer && appContainer.style.display !== "none") {
      const banner = document.createElement("div");
      banner.style.cssText = "position:fixed; top:60px; left:50%; transform:translateX(-50%); background:#fee2e2; border:1px solid #fca5a5; color:#b91c1c; padding:10px 20px; border-radius:6px; font-size:0.85rem; font-weight:700; z-index:9999; box-shadow:0 4px 12px rgba(0,0,0,0.1);";
      banner.textContent   = "Something went wrong. Please refresh the page if this keeps happening.";
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 5000);
    }
  }
  return false;
};

window.addEventListener("unhandledrejection", function(event) {
  if (event.reason && event.reason.message === "SESSION_EXPIRED") return;
  console.error("Unhandled Promise rejection:", event.reason);
  const appContainer = document.getElementById("app-container");
  if (appContainer && appContainer.style.display !== "none") {
    const banner = document.createElement("div");
    banner.style.cssText = "position:fixed; top:60px; left:50%; transform:translateX(-50%); background:#fee2e2; border:1px solid #fca5a5; color:#b91c1c; padding:10px 20px; border-radius:6px; font-size:0.85rem; font-weight:700; z-index:9999; box-shadow:0 4px 12px rgba(0,0,0,0.1);";
    banner.textContent = "Network error. Please check your connection and try again.";
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
  }
});
  

let globalPersonnelAuthDirectoryTreePayloadCache = {};
let globalOperatorsDatabasePayloadCache = []
let appActiveOperatorIdentityString = "";
let userPermissions = { cardDetails: false, searchCompany: false, searchStatus: false, searchEngineer: false, searchTasks: false, emailWhatsapp: false, dispatchCommissioning: true }; 
// Force scroll to top immediately — before anything renders
window.scrollTo(0, 0);
document.documentElement.scrollTop = 0;
document.body.scrollTop = 0;
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

window.onload = async function() {
  window.scrollTo(0, 0);
  const token          = localStorage.getItem("sessionToken");
  const expires        = localStorage.getItem("sessionExpiry");
  const savedPerms     = localStorage.getItem("userPermissions");
  const cachedOperator = localStorage.getItem("activeOperatorSignature");

  if (localStorage.getItem("abps_active_email_leads_cache")) {
    try {
      cachedInboundEmailLeadsArray = JSON.parse(localStorage.getItem("abps_active_email_leads_cache"));
    } catch(e) { cachedInboundEmailLeadsArray = []; }
  }

  if (token && expires && new Date() < new Date(expires) && cachedOperator) {
    appActiveOperatorIdentityString = cachedOperator;
    try {
      // D1 — Always fetch permissions fresh from server, never trust localStorage
      const permData = await apFetch({ action: "getSessionPermissions" });
      if (permData.success) {
        userPermissions = permData.permissions;
        // Refresh localStorage with the server's authoritative copy
        localStorage.setItem("userPermissions", JSON.stringify(userPermissions));
        showAppView();
      } else {
        localStorage.clear();
        syncPlatformPersonnelDropdownOptionsList();
        initializeGoogleAuthPlatformEngine();
      }
    } catch(e) {
      if (e.message === "SESSION_EXPIRED") return; // apFetch already handled redirect + clear
      localStorage.clear();
      syncPlatformPersonnelDropdownOptionsList();
      initializeGoogleAuthPlatformEngine();
    }
  } else {
    localStorage.clear();
    syncPlatformPersonnelDropdownOptionsList();
    initializeGoogleAuthPlatformEngine();
  }
};

/**
 * FETCH UN-AUTHENTICATED DEPARTMENTS & PERSONNEL MAP
 * Builds the initial dynamic department and dependent person lookups
 */
async function syncPlatformPersonnelDropdownOptionsList() {
  const deptSelect = document.getElementById("app-auth-active-department-identity");
  const nameSelect = document.getElementById("app-auth-active-engineer-identity");
  if (!deptSelect || !nameSelect) return;
  
  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "pullGlobalPersonnelDirectory" })
    });
    const data = await res.json();
    
    if (data.success && data.departmentsList && data.personnelTree) {
      // Cache the full interactive dictionary response locally
      globalPersonnelAuthDirectoryTreePayloadCache = data.personnelTree;
      
      // Populate Department choices option array lines
      deptSelect.innerHTML = '<option value="">— Select Department —</option>';
      data.departmentsList.forEach(deptName => {
        const opt = document.createElement("option");
        opt.value = deptName;
        opt.textContent = deptName;
        deptSelect.appendChild(opt);
      });
      
      nameSelect.innerHTML = '<option value="">— Choose Department First —</option>';
      nameSelect.disabled = true;
    } else {
      deptSelect.innerHTML = '<option value="">Error syncing department parameters</option>';
    }
  } catch (error) {
    console.error("Directory synchronization exception dropped:", error);
    deptSelect.innerHTML = '<option value="">Network connection drop</option>';
  }
}

async function handleGooglePlatformCredentialResponse(response) {
  const selectedEngineer = document.getElementById("app-auth-active-engineer-identity").value;
  if (!selectedEngineer) {
    alert("Identity Verification Failed: You must select your individual Engineer Name before logging in with your Google Account credentials.");
    return;
  }
  
  // UI VISIBILITY STATE SWITCH: Toggle processing view flags
  const googleBtnMount = document.getElementById("google-auth-button-mount-point");
  const processingLoader = document.getElementById("auth-portal-processing-loader");
  
  if (googleBtnMount) googleBtnMount.style.display = "none";
  if (processingLoader) processingLoader.style.display = "flex";
  
  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "googleLogin",
        idToken: response.credential,
        requestedEngineer: selectedEngineer,
        // Location-restricted login (ABPS_SYSTEM_OVERVIEW.md §18.3): a device
        // that's ever logged in from the office network gets a trust token
        // back, stored here and replayed on every subsequent login so it
        // keeps working from mobile data during an office outage. Persists
        // across logout on purpose — see the preserved-key comment in
        // executeLogout().
        deviceToken: localStorage.getItem("abpsDeviceToken") || null,
      })
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem("sessionToken",    data.sessionToken);
      localStorage.setItem("sessionExpiry",   data.expires);
      localStorage.setItem("sessionUser",     data.email);
      localStorage.setItem("userFirstName",   data.firstName);
      localStorage.setItem("userLastName",    data.lastName);
      localStorage.setItem("activeOperatorSignature", selectedEngineer);
      localStorage.setItem("abps_user_raw_departments", data.rawDepartmentsString || "");
      // Write permissions to localStorage only as a session bootstrap cache.
      // On every subsequent page load, permissions are re-fetched from the server (D1).
      localStorage.setItem("userPermissions", JSON.stringify(data.permissions));
      if (data.deviceToken) localStorage.setItem("abpsDeviceToken", data.deviceToken);
      appActiveOperatorIdentityString = selectedEngineer;
      userPermissions = data.permissions;

      const activeDeptRaw = document.getElementById("app-auth-active-department-identity").value || "";
      const isUserAdminGlobal = activeDeptRaw.toLowerCase().includes("admin");
      localStorage.setItem("isUserAdminGlobal", isUserAdminGlobal ? "true" : "false");

      showAppView();
    } else if (data.code === "LOCATION_BLOCKED") {
      alert(data.error);
      if (googleBtnMount) googleBtnMount.style.display = "flex";
      if (processingLoader) processingLoader.style.display = "none";
    } else {
      alert("Authentication Error: " + data.error);
      // RESTORATION FALLBACK: Bring the button back if access is explicitly denied by server row checks
      if (googleBtnMount) googleBtnMount.style.display = "flex";
      if (processingLoader) processingLoader.style.display = "none";
    }
  } catch (e) {
    alert("Connection verification failure: " + e.message);
    // RESTORATION FALLBACK: Bring the button back if the network drops out completely
    if (googleBtnMount) googleBtnMount.style.display = "flex";
    if (processingLoader) processingLoader.style.display = "none";
  }
}

window._sharedProjectTypeaheadLoaded = false;
function executeLogout() {
  if (liveStockSyncIntervalId) { clearInterval(liveStockSyncIntervalId); liveStockSyncIntervalId = null; }
  // 1. Force the Google Identity library script to kill any cached silent-sign-in listeners on phones
  try {
    if (google && google.accounts && google.accounts.id) {
      google.accounts.id.cancel();
    }
  } catch(e) {
    console.warn("Google identity platform context cleanup skip:", e.message);
  }

  // 1b. Invalidate the session server-side (fire-and-forget) — previously
  // logout only cleared localStorage, leaving the DB session_token valid
  // for up to the remaining 12h (ABPS_SYSTEM_OVERVIEW.md §18.2, finding H-2).
  const outgoingSessionToken = localStorage.getItem("sessionToken");
  if (outgoingSessionToken) {
    fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "logout", sessionToken: outgoingSessionToken }),
    }).catch(e => console.warn("Server-side logout call failed (session will still expire naturally):", e.message));
  }

  // 2. Clear out local data maps entirely, EXCEPT the device-trust token —
  // that represents "this browser has been on the office network before",
  // which stays true across a logout and is what keeps a later login
  // working from mobile data during an office outage.
  const deviceTokenToKeep = localStorage.getItem("abpsDeviceToken");
  localStorage.clear();
  if (deviceTokenToKeep) localStorage.setItem("abpsDeviceToken", deviceTokenToKeep);
  appActiveOperatorIdentityString = "";
  
  // 3. Reset the dashboard workspace visibilities
  document.getElementById("app-container").style.display = "none"; 
  
  // 4. Force a clean rendering re-initialization
  initializeGoogleAuthPlatformEngine();
}

/**
 * FULL STRUCTURAL VIEWPORT CONTROLLER
 * Initializes backend lookups, registers engineers lists across panel dropdowns,
 * validates access roles gateways, and sets dynamic metric dashboard cards.
 */
async function showAppView() {
  document.getElementById("auth-container").style.display = "none"; 
  document.getElementById("app-container").style.display = "block";
  document.getElementById("dashboard-view").style.display = "block"; 
  document.getElementById("module-workspace-container").style.display = "none";
  
  document.getElementById("display-full-name").textContent = localStorage.getItem("userFirstName") + " " + localStorage.getItem("userLastName");
  document.getElementById("display-username").textContent = "@" + localStorage.getItem("sessionUser");
  
  // DIAGNOSTIC: surface exactly what permissions object the dashboard is being built
  // from. If this ever logs an empty object, every menu card will silently stay hidden
  // with no thrown error — that's the failure mode this guards against.
  if (!userPermissions || Object.keys(userPermissions).length === 0) {
    console.error("showAppView: userPermissions is empty or missing — dashboard will render with all cards hidden.", userPermissions);
  } else {
    console.log("showAppView: rendering with permissions for", Object.keys(userPermissions).length, "keys.");
  }
  enforceDynamicModuleRoleGateways(userPermissions || {});
  // Pre-load ItemCodes catalog into memory (fire-and-forget, suppress unhandled rejection)
  loadItemCodeCatalogIntoCache().catch(() => {});
  
  loadQualFilter();

  const menuPermissions = [
    { id: "mod-card", key: "cardDetails" },
    { id: "mod-company", key: "searchCompany" },
    { id: "mod-email-whatsapp", key: "emailLeads" },
    { id: "mod-dispatch-commissioning", key: "dispatchCommissioning" },
    { id: "mod-tasks", key: "searchTasks" },
    { id: "mod-status", key: "searchStatus" },
    { id: "mod-qual", key: "searchQualification" },
    { id: "mod-city-state", key: "searchCityState" } 
  ];

  menuPermissions.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) el.classList.toggle("locked", !userPermissions[item.key]);
  });

  try {
    const data = await apFetch({ 
      action: "getEngineers",
      activeEngineer: appActiveOperatorIdentityString
    });
    
    if (data.success) { 
      cachedEngineers = data.engineers;
      populateEngineerDropdowns(); 
      fetchAndPopulateUploadLeadDropdowns();
      
      // 1. MASTER LEAD ENTRY DROPDOWN PATCH
      const targetFormEngSelector = document.getElementById("engName");
      if (targetFormEngSelector) {
        targetFormEngSelector.innerHTML = '<option value="">— Select Engineer Name —</option>';
        cachedEngineers.forEach(eng => {
          let opt = document.createElement("option");
          opt.value = eng.email; opt.textContent = eng.name;
          targetFormEngSelector.appendChild(opt);
        });
        // Only auto-select the current operator if their name is an exact match in the list —
        // otherwise leave the placeholder showing instead of a blank selection.
        // appActiveOperatorIdentityString is a display name (from the login
        // dropdown), so it has to be matched against eng.name here, but the
        // value actually set on the select must still be the email.
        const matchedSelfEngineer = cachedEngineers.find(eng => eng.name === appActiveOperatorIdentityString);
        if (matchedSelfEngineer) {
          targetFormEngSelector.value = matchedSelfEngineer.email;
        }
      }
      
      // 2. SEARCH BY ENGINEER FILTER DROPDOWN
      const engDrop = document.getElementById("engineer-filter-select");
      if (engDrop) {
        engDrop.innerHTML = '<option value="">— Select Engineer —</option>';
        cachedEngineers.forEach(eng => {
          let opt = document.createElement("option"); opt.value = eng.email; opt.textContent = eng.name; engDrop.appendChild(opt);
        });
      }

      // 3. SEARCH TASKS ENGINE COMBINATION CHECKBOX MATRIX
      const matrixEngBoxEnclosure = document.getElementById("task-matrix-engineer-checkboxes");
      if (matrixEngBoxEnclosure) {
        matrixEngBoxEnclosure.innerHTML = '<p style="font-size:0.75rem; color:var(--brand); font-weight:600; margin:0; display:flex; align-items:center; gap:6px;"><span class="spinner" style="display:inline-block; width:10px; height:10px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite;"></span> Loading Engineers...</p>';
        setTimeout(() => {
          matrixEngBoxEnclosure.innerHTML = "";
          cachedEngineers.forEach(eng => {
            const safeId = `chk_tm_eng_${eng.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
            matrixEngBoxEnclosure.innerHTML += `
              <input type="checkbox" name="taskMatrixEngineer" value="${eng.email}" id="${safeId}">
              <label for="${safeId}">${eng.name}</label>
            `;
          });
        }, 50);
      }

      // 4. SEARCH LEADS STATUS MATRIX CHECKBOXES
      renderLeadMatrixEngineerCheckboxes();
    }
  } catch(e) { 
    console.error("Engineer profile listing lookups sync initialization error dropped: ", e.message); 
  }

  triggerCompanyDropdownArrayFetch();
  loadCityStateFilterOptions();

  // Auto-navigate if opened via ?module= deep link (e.g. from new tab)
  const urlParams = new URLSearchParams(window.location.search);
  const deepModule = urlParams.get("module");
  const deepQuery = urlParams.get("q");
  if (deepModule) {
    setTimeout(() => {
      switchActiveDashboardModule(deepModule);
      if (deepQuery && deepModule === "design-itemcode") {
        setTimeout(() => {
          const input = document.getElementById("itemcode-search-input");
          if (input) {
            input.value = deepQuery;
            if (typeof executeItemCodeSearch === "function") executeItemCodeSearch();
          }
        }, 300);
      }
    }, 300);
  }
}

async function triggerCompanyDropdownArrayFetch() {
  try {
    const dropdown = document.getElementById("lookup-module-company-dropdown");
    // Cache the currently selected value before the network request drops
    const previousSelectedValue = dropdown ? dropdown.value : "";

    const d = await apFetch({ 
      action: "getUniqueCompaniesList",
      activeEngineer: appActiveOperatorIdentityString
    });
    if (d.success && dropdown) {
      dropdown.innerHTML = '<option value="">— Select Company —</option>';
      d.companies.forEach(item => {
        let opt = document.createElement("option"); 
        opt.value = item.companyValue; 
        opt.textContent = item.displayLabel; 
        dropdown.appendChild(opt);
      });
      
      // RESTORATION FIX: Restore the selection value index if it exists in the new listing
      if (previousSelectedValue) {
        dropdown.value = previousSelectedValue;
      }
    }
  } catch(e) { console.error("Dropdown refresh layout fail:", e.message); }
}

async function loadQualFilter() {
  const container = document.getElementById("qual-filter-checkboxes"); 
  if (!container) return;
  
  container.innerHTML = '<p style="font-size:0.75rem; color:var(--brand); font-weight:600; margin:0; display:flex; align-items:center; gap:6px;"><span class="spinner" style="display:inline-block; width:10px; height:10px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite;"></span> Loading Other Types of Customer...</p>';
  
  try {
    const data = await apFetch({ 
      action: "getUniqueQualifications",
      activeEngineer: appActiveOperatorIdentityString
    });
    if (data.success) {
      // Baseline core options to strip from the 'Others' sub-drawer completely
      const baselineCoreQualifications = [
        "industry", "epc", "govt/psu", "consultant", 
        "developer", "electrical contractor", "dealer", "vendor"
      ];
      
      // Use a local Set to deduplicate raw text values coming from rows
      let uniqueCustomQualsSet = new Set();
      data.quals.forEach(q => {
        let cleanQual = q.toString().trim();
        if (!cleanQual) return;
        
        if (baselineCoreQualifications.indexOf(cleanQual.toLowerCase()) === -1) {
          uniqueCustomQualsSet.add(cleanQual);
        }
      });
      
      // CRITICAL OVERWRITE FIX: Empty the container right before rendering 
      // This stops multiple navigateToModule clicks from stacking copies back-to-back!
      container.innerHTML = "";
      let customOptionsCount = 0;
      
      uniqueCustomQualsSet.forEach(cleanQual => {
        const cleanId = "custom_q_" + cleanQual.replace(/\s+/g, '_');
        
        container.innerHTML += `
          <input type="checkbox" name="searchQual" value="${cleanQual}" id="${cleanId}" onchange="updateSelectedDisplay()">
          <label for="${cleanId}">${cleanQual}</label>
        `;
        customOptionsCount++;
      });
      
      if (customOptionsCount === 0) {
        container.innerHTML = '<p style="font-size:0.75rem; color:var(--muted); font-weight:600; padding:4px 0;">No unlisted custom Type of Customer yet.</p>';
      }
    }
  } catch(e) { console.error("Custom Types of Customer load failed:", e.message); }
}

async function loadDesignPersonnelIntoSelect(selectId) {
  const selectEl = document.getElementById(selectId);
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Loading...</option>';

  try {
    const data = await apFetch({ action:"getStoreOperatorsList" });
    window.cboqAllPersonnel = data.fullPersonnelDataRecordsTree || [];
    // Don't populate yet — wait for department selection
    selectEl.innerHTML = '<option value="">— Select Department First —</option>';
  } catch(e) {
    selectEl.innerHTML = '<option value="">Error loading personnel</option>';
  }
}

// Department selection no longer drives a "Prepared By" picker -- that
// field was removed (Prepared By is now silently set to the logged-in
// operator's name at submit time, not chosen from a select). This
// handler is now a no-op, kept only because the <select> in the HTML
// still has onchange="handleCBOQDepartmentChange(this.value)" wired to
// it. It used to reach into #cboq-prepared-by directly with no
// null-check, which threw on every Department change once that element
// was removed -- surfaced to users as a misleading "Network error"
// banner via the global unhandledrejection handler.
function handleCBOQDepartmentChange(department) {
  // Intentionally empty.
}

