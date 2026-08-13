async function ensureSharedProjectTypeaheadData(forceRefresh = false) {
  if (window._sharedProjectTypeaheadLoaded && !forceRefresh) return;
  try {
    const data = await apFetch({ action: "pullLiveActiveProjectCodes" });
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
    window._sharedProjectTypeaheadLoaded = true;
  } catch(e) {
    window.sharedActiveProjectCodes = [];
    window.sharedProjectMeta = {};
  }
}

function handleSharedProjectTypeaheadInput(query, inputId, dropdownId) {
  const dd = document.getElementById(dropdownId);
  if (!dd) return;
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const meta = window.sharedProjectMeta || {};
  // meta[p] is { companyName } — pullLiveActiveProjectCodes (utility.js) is
  // the only source that ever populates sharedProjectMeta, and it has
  // always used companyName, never customerName. Reading .customerName
  // here meant the placeholder's "...or Customer Name" search never
  // actually matched anything on ANY screen using this shared component —
  // it always fell through to "" and silently only matched on Project ID.
  const matches = (window.sharedActiveProjectCodes || []).filter(p => {
    const companyName = (meta[p] && meta[p].companyName) || "";
    return p.toLowerCase().includes(q) || companyName.toLowerCase().includes(q);
  }).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(p => {
    const companyName = (meta[p] && meta[p].companyName) || "";
    return `<div onclick="selectSharedProjectTypeahead('${p.replace(/'/g,"\\'")}', '${inputId}', '${dropdownId}')"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;">${p}</span>${companyName ? ` <span style="color:var(--muted);">— ${companyName}</span>` : ''}
    </div>`;
  }).join("");
  dd.style.display = "block";
}

function selectSharedProjectTypeahead(projectId, inputId, dropdownId) {
  const input = document.getElementById(inputId);
  input.value = projectId;
  document.getElementById(dropdownId).style.display = "none";
  input.dispatchEvent(new Event('change'));
}

document.addEventListener("click", (e) => {
  document.querySelectorAll("[id$='-ta-dropdown']").forEach(dd => {
    const inputId = dd.id.replace('-ta-dropdown', '-ta-input');
    if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${dd.id}`)) dd.style.display = "none";
  });
});

async function initializeProjectStatusPanel() {
  document.getElementById("pstat-project-input").value = "";
  document.getElementById("pstat-results").style.display = "none";
  try {
    const data = await apFetch({ action: "pullLiveActiveProjectCodes" });
    window.pstatKnownProjectCodes = (data.success && data.projects) ? data.projects : [];
    window.pstatProjectMeta = data.projectMeta || {};
  } catch (e) { window.pstatKnownProjectCodes = []; window.pstatProjectMeta = {}; }
}

/**
 * INITIALIZE FINISHED GOODS ADD WORKSPACE
 * Populates engineer dropdown from cached staff list.
 */
async function initializeFinishedGoodsAddWorkspace(department, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  canvas.innerHTML = `
    <h2 class="panel-title">${department} Department: Add Material to Finished Goods Store</h2>
    <div id="fg-feedback-${canvasId}" style="display:none; padding:16px; border-radius:var(--radius); margin-bottom:16px; border-left:4px solid;"></div>
    <div id="fg-form-${canvasId}">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div>
          <label class="field-label">Date *</label>
          <input type="date" id="fg-date-${canvasId}" style="padding:9px;" />
        </div>
        <div>
          <label class="field-label">Project ID *</label>
          <select id="fg-project-${canvasId}" onchange="handleFGProjectIdChange(this.value, '${canvasId}')" style="padding:9px; font-weight:600;">
            <option value="">Loading...</option>
          </select>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div>
          <label class="field-label">Customer Name</label>
          <input type="text" id="fg-customer-${canvasId}" readonly style="padding:9px; background:#f1f5f9; color:var(--muted); cursor:not-allowed;" placeholder="Auto-filled from Project ID" />
        </div>
        <div>
          <label class="field-label">Product Serial Number</label>
          <input type="text" id="fg-serial-${canvasId}" style="padding:9px;" />
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div>
          <label class="field-label">Job Card Number</label>
          <input type="text" id="fg-jobcard-${canvasId}" style="padding:9px;" />
        </div>
        <div>
          <label class="field-label">Product Rating</label>
          <input type="text" id="fg-rating-${canvasId}" style="padding:9px;" />
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <label class="field-label">Product Details</label>
        <textarea id="fg-details-${canvasId}" style="padding:9px; min-height:50px;" ></textarea>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div>
          <label class="field-label">Product Quantity *</label>
          <input type="number" id="fg-qty-${canvasId}" min="1" placeholder="Enter quantity" style="padding:9px;" />
        </div>
        <div>
          <label class="field-label">Production Department Responsible Person</label>
          <select id="fg-prod-${canvasId}" style="padding:9px; font-weight:600;">
            <option value="">— Select Person —</option>
          </select>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div>
          <label class="field-label">Finished Goods Store Incharge Person *</label>
          <select id="fg-store-${canvasId}" style="padding:9px; font-weight:600;">
            <option value="">— Select Person —</option>
          </select>
        </div>
        <div>
          <label class="field-label">Additional Remarks</label>
          <input type="text" id="fg-remarks-${canvasId}" style="padding:9px;" placeholder="Any notes..." />
        </div>
      </div>
      <button class="btn btn-sub" id="fg-submit-${canvasId}" onclick="submitFinishedGoodsAddEntry('${department}', '${canvasId}')" style="background:var(--accent); padding:12px; font-weight:700;">
        Add to Finished Goods Store
      </button>
    </div>
  `;

  // Set today as default date
  const dateEl = document.getElementById(`fg-date-${canvasId}`);
  if (dateEl) dateEl.value = new Date().toISOString().split("T")[0];

  // Fetch projects and staff in parallel
  const [projData, staffData] = await Promise.all([
    apFetch({ action:"pullLiveActiveProjectCodes" }),
    apFetch({ action:"getStoreOperatorsList" })
  ]);

  window.fgProjectMetaCache = projData.projectMeta || {};

  // Populate project dropdown
  const projDrop = document.getElementById(`fg-project-${canvasId}`);
  if (projDrop) {
    projDrop.innerHTML = '<option value="">— Select Project ID —</option>';
    (projData.projects || []).forEach(code => {
      const opt = document.createElement("option");
      opt.value = code; opt.textContent = code;
      projDrop.appendChild(opt);
    });
  }

  // Production — Production or Admin
  const prodDrop = document.getElementById(`fg-prod-${canvasId}`);
  if (prodDrop) {
    (staffData.fullPersonnelDataRecordsTree || [])
      .filter(u => u.departmentsList.some(d => ["production","admin"].includes(d.toLowerCase().trim())))
      .forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.fullName; opt.textContent = u.fullName;
        prodDrop.appendChild(opt);
      });
  }

  // Store Incharge — Store or Admin
  const storeDrop = document.getElementById(`fg-store-${canvasId}`);
  if (storeDrop) {
    (staffData.fullPersonnelDataRecordsTree || [])
      .filter(u => u.departmentsList.some(d => ["store","admin"].includes(d.toLowerCase().trim())))
      .forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.fullName; opt.textContent = u.fullName;
        storeDrop.appendChild(opt);
      });
    if (appActiveOperatorIdentityString) storeDrop.value = appActiveOperatorIdentityString;
  }
}

async function initializeCreateBOQPanel() {
  // Every OTHER Design screen resets fully on re-entry -- Create BOQ is the
  // deliberate exception: leaving via "Return to Main Dashboard" and coming
  // back should NOT lose whatever was already typed/added. isFirstVisit
  // gates the one-time destructive reset (only runs the very first time
  // this screen opens in the session); everything after that only
  // refreshes the async dropdown DATA (projects list, catalog, personnel)
  // without touching whatever the person already entered.
  const isFirstVisit = !window._cboqInitializedOnce;
  window._cboqInitializedOnce = true;

  const _g = id => document.getElementById(id);

  if (isFirstVisit) {
    const today = new Date().toLocaleDateString('en-GB');
    const dateEl = _g("cboq-date"); if (dateEl) dateEl.value = today;

    cboqMaterialRows = [];
    cboqSpecFiles    = [];
    if (_g("cboq-customer-name"))  _g("cboq-customer-name").value  = "";
    if (_g("cboq-product-select")) _g("cboq-product-select").innerHTML = '<option value="">— Select Project First —</option>';
    if (_g("cboq-product-name"))   _g("cboq-product-name").value   = "";
    if (_g("cboq-source-po-line-id")) _g("cboq-source-po-line-id").value = "";
    if (_g("cboq-product-rating")) { _g("cboq-product-rating").value = ""; _g("cboq-product-rating").style.height = "auto"; }
    if (_g("cboq-department"))     _g("cboq-department").value     = "";
    if (_g("cboq-order-qty"))      _g("cboq-order-qty").value      = "";
    if (_g("cboq-spec-doc-list"))  _g("cboq-spec-doc-list").innerHTML = "";
    if (_g("cboq-import-banner"))  { _g("cboq-import-banner").style.display = "none"; _g("cboq-import-banner").innerHTML = ""; }
    window.cboqImportSourceInfo = null;
    resetCBOQImportSearch();
  }

  const formBody = _g("cboq-form-body");
  if (formBody) formBody.style.display = "";
  renderCBOQMaterialRows();
  if (_g("create-boq-feedback")) _g("create-boq-feedback").style.display = "none";

  // Load Project IDs + item code catalog + personnel all in parallel
  const projDrop = _g("cboq-project-id-ta-input");
  if (!projDrop) return;
  const previouslySelectedProject = isFirstVisit ? "" : projDrop.value;
  if (isFirstVisit) projDrop.innerHTML = '<option value="">Loading projects...</option>';

  const [projResult, , personnelResult, importListResult] = await Promise.allSettled([
    apFetch({ action: "pullLiveActiveProjectCodes" }),
    loadItemCodeCatalogIntoCache(),
    apFetch({ action: "getStoreOperatorsList" }),
    apFetch({ action: "fetchBOQsForImport" })
  ]);

  // Cached raw, not rendered into one giant <select> — with many BOQs
  // that list becomes unusable. handleCBOQImportProductSearch filters this
  // client-side as a typeahead instead (Product Name + Rating first, then
  // only the Project IDs that actually have that BOQ).
  window.cboqImportBOQList = (importListResult.status === "fulfilled" && importListResult.value.success)
    ? (importListResult.value.boqs || []) : [];

  // Cache personnel for Prepared By (used when department is selected)
  if (personnelResult.status === "fulfilled" && personnelResult.value.fullPersonnelDataRecordsTree) {
    window.cboqAllPersonnel = personnelResult.value.fullPersonnelDataRecordsTree;
  }

  if (projResult.status === "fulfilled" && projResult.value && projResult.value.projects) {
    window.sharedActiveProjectCodes = projResult.value.projects;
    window.sharedProjectMeta = projResult.value.projectMeta || {};
    window.cboqProjectMeta = projResult.value.projectMeta || {};
    if (previouslySelectedProject && projResult.value.projects.includes(previouslySelectedProject)) {
      projDrop.value = previouslySelectedProject;
    }
  } else {
    projDrop.placeholder = "Error loading projects";
  }
}

async function initializeJCLHWorkspace() {
  jclhWorkspaceInitInProgress = false; // clear any stuck guard from an abandoned prior load
  resetJCLHWorkspace();                // guarantee first-time-like state on every entry
  jclhWorkspaceInitInProgress = true;
  try {
    const projDrop = document.getElementById("jclh-project");
    projDrop.innerHTML = '<option value="">Loading...</option>';
    const data = await apFetch({ action: "pullLiveActiveProjectCodes" });
    window.jclhProjectMeta = data.projectMeta || {};
    projDrop.innerHTML = '<option value="">— Select Project ID —</option>';
    (data.projects || []).forEach(code => {
      const opt = document.createElement("option");
      opt.value = code; opt.textContent = code;
      projDrop.appendChild(opt);
    });
    handleJCLHProjectChange("");
  } catch(e) {
    document.getElementById("jclh-project").innerHTML = '<option value="">Error loading projects</option>';
  } finally {
    jclhWorkspaceInitInProgress = false;
  }
}

async function enterPOEditMode(poNumber) {
  const detail = document.getElementById(`po-auth-detail-${poNumber}`);
  detail.innerHTML = `<div style="padding:14px; text-align:center; color:var(--muted);">Loading editable form...</div>`;

  // Ensure catalog + active projects are loaded for editing
  if (!window.itemCodeCatalogCache || window.itemCodeCatalogCache.length === 0) {
    await loadItemCodeCatalogIntoCache().catch(()=>{});
  }
  const projRes = await apFetch({ action: "pullLiveActiveProjectCodes", statusFilter: "Active" });
  window.apoEditProjects = (projRes.success ? (projRes.projects || []) : []).map(p => p.toString());

  const data = await apFetch({ action: "fetchPODraftById", poNo: poNumber });
  if (!data.success) { detail.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }
  const po = data.po;
  window.apoEditPO = po;

  // Seed editable rows from the draft
  window.apoEditRows = (po.lineItems || []).map(it => {
    const id = ++window.apoEditRowSeq;
    return { id, description: it.description||"", itemCode: it.itemCode||"", quantity: it.quantity||"", unit: it.unit||"", rate: it.rate||"", discountPercent: it.discountPercent||"", projectIds: Array.isArray(it.projectIds)?it.projectIds:[] };
  });

  detail.innerHTML = `
    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:var(--radius); padding:10px 14px; margin-bottom:14px; font-size:0.82rem; color:#92400e;">
      <strong>Edit Mode.</strong> P.O. No., Vendor, and Order Date are locked. Edit anything else, then Authorize to finalize with your changes.
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-bottom:14px;">
      <div><label class="field-label" style="margin-top:0;">P.O. No. (locked)</label><div style="padding:9px; background:#f1f5f9; border-radius:var(--radius); font-family:monospace; font-weight:700;">${po.poNumber}</div></div>
      <div><label class="field-label" style="margin-top:0;">Vendor (locked)</label><div style="padding:9px; background:#f1f5f9; border-radius:var(--radius); font-weight:600;">${po.vendorName}</div></div>
      <div><label class="field-label" style="margin-top:0;">Order Date (locked)</label><div style="padding:9px; background:#f1f5f9; border-radius:var(--radius);">${fmtPODate(po.orderDate)}</div></div>
      <div><label class="field-label" style="margin-top:0;">Supplier Offer No</label><input type="text" id="apo-supplier-ref" value="${(po.supplierRef||'').replace(/"/g,'&quot;')}" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;"></div>
      <div><label class="field-label" style="margin-top:0;">Delivery Date *</label><input type="date" id="apo-delivery-date" value="${isoFromPODate(po.deliveryDate)}" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;"></div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin:16px 0 10px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand);">Material Rows</div>
      <button class="nav-btn-styled" onclick="addAPOEditRow()" style="background:var(--accent); color:#fff; font-weight:700; padding:6px 14px;">+ Add Material Row</button>
    </div>
    <div id="apo-edit-rows-body"></div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:16px 0;">
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Taxes & Charges</div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
          <div><label class="field-label" style="margin-top:0;">CGST %</label><input type="number" id="apo-cgst" value="${Number(po.cgstPercent)||0}" oninput="recalcAPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">SGST %</label><input type="number" id="apo-sgst" value="${Number(po.sgstPercent)||0}" oninput="recalcAPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">IGST %</label><input type="number" id="apo-igst" value="${Number(po.igstPercent)||0}" oninput="recalcAPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Packing</label><input type="number" id="apo-packing" value="${Number(po.packing)||0}" oninput="recalcAPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Freight</label><input type="number" id="apo-freight" value="${Number(po.freight)||0}" oninput="recalcAPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Other</label><input type="number" id="apo-other" value="${Number(po.other)||0}" oninput="recalcAPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Round Off</label><input type="number" id="apo-roundoff" value="${Number(po.roundOff)||0}" step="any" oninput="recalcAPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        </div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Terms</div>
        <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Warranty</label><input type="text" id="apo-warranty" value="${(po.warranty||'').replace(/"/g,'&quot;')}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Payment Terms</label><input type="text" id="apo-payment" value="${(po.paymentTerms||'').replace(/"/g,'&quot;')}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        <div><label class="field-label" style="margin-top:0;">Freight Terms</label><input type="text" id="apo-freight-terms" value="${(po.freightTerms||'').replace(/"/g,'&quot;')}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; background:#f0f9ff; border:1px solid #bae6fd; border-radius:var(--radius); padding:14px;">
      <div style="font-size:0.9rem;">
        Sub Total: <strong id="apo-subtotal-disp">0.00</strong><br/>
        <span style="font-size:1.05rem;">Grand Total: <strong id="apo-grandtotal-disp" style="color:var(--brand);">0</strong></span>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="nav-btn-styled" onclick="togglePOAuthDetail('${poNumber}')" style="background:#e2e8f0; color:#334155; font-weight:700; padding:10px 18px;">Cancel Edit</button>
        <button class="nav-btn-styled" onclick="authorizePONow('${poNumber}', this, true)" style="background:var(--brand); color:#fff; font-weight:700; padding:10px 24px;">Authorize with Changes</button>
      </div>
    </div>
  `;
  renderAPOEditRows();
  recalcAPOTotals();
}

function addAPOEditRow() {
  const id = ++window.apoEditRowSeq;
  window.apoEditRows.push({ id, description:"", itemCode:"", quantity:"", unit:"", rate:"", discountPercent:"", projectIds:[] });
  renderAPOEditRows();
}
function removeAPOEditRow(id) {
  window.apoEditRows = window.apoEditRows.filter(r => r.id !== id);
  renderAPOEditRows(); recalcAPOTotals();
}
