function renderAPOEditRows() {
  const body = document.getElementById("apo-edit-rows-body");
  if (window.apoEditRows.length === 0) {
    body.innerHTML = `<div style="padding:12px; text-align:center; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:var(--radius);">No material rows.</div>`;
    return;
  }
  body.innerHTML = window.apoEditRows.map((row, idx) => {
    const chips = row.projectIds.length
      ? row.projectIds.map(p => `<div style="display:inline-block; background:#e0f2fe; color:var(--brand); font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 4px 3px 0;">${p}</div>`).join("")
      : '<span style="color:#b91c1c; font-size:0.75rem; font-weight:600;">No projects selected</span>';
    return `<div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:12px; margin-bottom:10px;">
      <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
        <div style="font-weight:700; color:var(--brand); padding-bottom:8px; min-width:20px;">${idx+1}</div>
        <div style="flex:1; min-width:220px; position:relative;">
          <label style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Description of Material *</label>
          <input type="text" value="${(row.description||'').replace(/"/g,'&quot;')}" placeholder="Search material name / rating..." autocomplete="off" oninput="handleAPODescSearch(${row.id}, this.value)" style="width:100%; padding:7px; border:1.5px solid ${row.itemCode?'var(--brand)':'#f59e0b'}; border-radius:4px; font-size:0.82rem; margin-top:2px;">
          <div id="apo-desc-dd-${row.id}" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:220px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
        </div>
        <div style="width:95px; flex-shrink:0; text-align:center;"><div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">Item Code</div><div style="font-family:monospace; font-weight:700; color:var(--brand); font-size:0.85rem;">${row.itemCode||'—'}</div></div>
        <div style="width:50px; flex-shrink:0; text-align:center;"><div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">Unit</div><div style="font-family:monospace; color:#475569; font-size:0.85rem; padding-top:2px;">${row.unit||'—'}</div></div>
        <div style="width:80px; flex-shrink:0;"><div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px; text-align:center;">Quantity *</div><input type="number" min="0" step="any" value="${row.quantity}" oninput="updateAPORowField(${row.id},'quantity',this.value)" style="width:100%; text-align:center; padding:7px 4px; border:1px solid var(--border); border-radius:4px;"></div>
        <div style="width:90px; flex-shrink:0;"><div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px; text-align:center;">Rate / Qty *</div><input type="number" min="0" step="any" value="${row.rate}" oninput="updateAPORowField(${row.id},'rate',this.value)" style="width:100%; text-align:right; padding:7px 6px; border:1px solid var(--border); border-radius:4px;"></div>
        <div style="width:70px; flex-shrink:0;"><div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px; text-align:center;">Disc %</div><input type="number" min="0" max="100" step="any" value="${row.discountPercent}" placeholder="0" oninput="updateAPORowField(${row.id},'discountPercent',this.value)" style="width:100%; text-align:center; padding:7px 4px; border:1px solid var(--border); border-radius:4px;"></div>
        <div style="width:120px; flex-shrink:0; text-align:right;"><div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">Amount</div><div style="font-family:monospace; font-weight:800; font-size:1.05rem; color:#0f172a; padding-top:2px;"><span class="apo-amount" data-rowid="${row.id}">0.00</span></div></div>
        <button onclick="removeAPOEditRow(${row.id})" title="Remove row" style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; cursor:pointer; font-size:0.95rem; width:32px; height:36px; border-radius:4px; display:flex; align-items:center; justify-content:center; flex-shrink:0; align-self:flex-end;">✕</button>
      </div>
      <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div style="min-width:180px;"><div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">PRNs using this Material *</div><button onclick="openAPOProjectPicker(${row.id})" style="font-size:0.75rem; padding:5px 12px; background:var(--accent); color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">Select Projects</button></div>
        <div style="flex:1; min-width:200px; padding-top:2px;">${chips}</div>
      </div>
    </div>`;
  }).join("");
  window.apoEditRows.forEach(r => updateAPORowAmount(r.id));
}
function handleAPODescSearch(rowId, query) {
  updateAPORowField(rowId, 'description', query);
  const dd = document.getElementById(`apo-desc-dd-${rowId}`);
  const catalog = window.itemCodeCatalogCache || [];
  if (!query || query.trim().length < 1) { dd.style.display="none"; return; }
  const q = query.toLowerCase();
  const matches = catalog.filter(it => (it.productName||"").toLowerCase().includes(q) || (it.rating||"").toLowerCase().includes(q)).slice(0,10);
  if (matches.length === 0) { dd.style.display="none"; return; }
  dd.innerHTML = matches.map(it => `<div onclick="selectAPOMaterial(${rowId}, '${it.itemCode}', \`${(it.productName||'').replace(/\`/g,"'")}\`, \`${(it.rating||'').replace(/\`/g,"'")}\`, '${(it.unit||'Nos').replace(/'/g,'')}')" style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;" onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'"><span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:6px;">${it.itemCode}</span>${it.productName}${it.rating?` <span style="color:var(--brand); font-weight:700;">${it.rating}</span>`:''}</div>`).join("");
  dd.style.display = "block";
}
function selectAPOMaterial(rowId, itemCode, productName, rating, unit) {
  const row = window.apoEditRows.find(r => r.id === rowId);
  if (!row) return;
  row.description = rating ? `${productName} ${rating}` : productName;
  row.itemCode = itemCode; row.unit = unit || "Nos";
  document.getElementById(`apo-desc-dd-${rowId}`).style.display = "none";
  renderAPOEditRows();
}
function updateAPORowField(rowId, field, value) {
  const row = window.apoEditRows.find(r => r.id === rowId);
  if (!row) return;
  row[field] = value;
  if (field==='quantity'||field==='rate'||field==='discountPercent') { updateAPORowAmount(rowId); recalcAPOTotals(); }
}
function updateAPORowAmount(rowId) {
  const row = window.apoEditRows.find(r => r.id === rowId);
  if (!row) return;
  const amt = (parseFloat(row.quantity)||0) * (parseFloat(row.rate)||0) * (100-(parseFloat(row.discountPercent)||0))/100;
  const span = document.querySelector(`.apo-amount[data-rowid="${rowId}"]`);
  if (span) span.textContent = amt.toLocaleString("en-IN",{maximumFractionDigits:2});
}
function recalcAPOTotals() {
  let sub = 0;
  window.apoEditRows.forEach(r => sub += (parseFloat(r.quantity)||0)*(parseFloat(r.rate)||0)*(100-(parseFloat(r.discountPercent)||0))/100);
  const v = id => parseFloat(document.getElementById(id).value)||0;
  const gt = sub + sub*v("apo-cgst")/100 + sub*v("apo-sgst")/100 + sub*v("apo-igst")/100 + v("apo-packing") + v("apo-freight") + v("apo-other") + v("apo-roundoff");
  const fmt = n => n.toLocaleString("en-IN",{maximumFractionDigits:2});
  document.getElementById("apo-subtotal-disp").textContent = fmt(sub);
  document.getElementById("apo-grandtotal-disp").textContent = fmt(gt);
}
function openAPOProjectPicker(rowId) {
  const row = window.apoEditRows.find(r => r.id === rowId);
  if (!row) return;
  if (window.apoEditProjects.length === 0) { alert("No active projects loaded."); return; }
  const existing = document.getElementById("apo-project-modal"); if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "apo-project-modal";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.55); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;";
  const checks = window.apoEditProjects.map((p,i) => `<label for="apo-proj-cb-${i}" style="display:flex; align-items:center; gap:12px; padding:11px 12px; border:1px solid var(--border); border-radius:6px; margin-bottom:6px; cursor:pointer; font-size:0.85rem;" onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'"><input type="checkbox" id="apo-proj-cb-${i}" value="${p.replace(/"/g,'&quot;')}" ${row.projectIds.includes(p)?'checked':''} style="width:16px; height:16px; flex-shrink:0;"><span style="font-weight:600;">${p}</span></label>`).join("");
  modal.innerHTML = `<div style="background:#fff; border-radius:12px; width:100%; max-width:520px; max-height:80vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.3); overflow:hidden;">
    <div style="padding:18px 20px; border-bottom:1px solid var(--border); background:#f8fafc;"><div style="font-weight:800; font-size:1rem; color:var(--brand);">Select Projects this Material is Used by</div></div>
    <div style="overflow-y:auto; flex:1; padding:16px 20px;">${checks}</div>
    <div style="display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid var(--border); background:#f8fafc;"><button onclick="document.getElementById('apo-project-modal').remove()" style="padding:9px 18px; border:1px solid var(--border); background:#fff; border-radius:6px; cursor:pointer; font-weight:600;">Cancel</button><button onclick="saveAPOProjectPicker(${rowId})" style="padding:9px 22px; background:var(--brand); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">Save Selection</button></div>
  </div>`;
  document.body.appendChild(modal);
}
function saveAPOProjectPicker(rowId) {
  const row = window.apoEditRows.find(r => r.id === rowId);
  const modal = document.getElementById("apo-project-modal");
  if (!row || !modal) return;
  row.projectIds = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  modal.remove(); renderAPOEditRows();
}

async function initializeAuthorizePOPanel() {
  window.cpoExpandedPoNo = null;
  const body = document.getElementById("authorize-po-body");
  body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">Loading pending POs...</div>`;
  try {
    const data = await apFetch({ action: "fetchPendingPOsForAuthorization" });
    if (!data.success) { body.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }
    if (!data.pos || data.pos.length === 0) {
      body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">No Purchase Orders pending authorization.</div>`;
      return;
    }
    const fmt = (n) => (parseFloat(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});
    body.innerHTML = data.pos.map(po => `
      <div class="contact-summary-card-parent" style="margin-bottom:12px;">
        <div class="contact-summary-header-row" onclick="toggleAuthorizePOCard('${po.poNumber}')" style="cursor:pointer; width:100%; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <span style="background:var(--accent); color:#fff; font-weight:700; padding:3px 10px; font-family:monospace;">${po.poNumber}</span>
            <span style="margin-left:8px; font-weight:700;">${po.vendorName}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--muted);">${fmtPODate(po.orderDate)} &nbsp;|&nbsp; Grand Total: <strong style="color:var(--brand);">${fmt(po.grandTotal)}</strong> &nbsp;|&nbsp; Prepared by ${po.preparedBy}</div>
        </div>
        <div id="po-auth-expand-${po.poNumber}" style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;"></div>
      </div>`).join("");
  } catch(e) { body.innerHTML = `<p style="color:var(--warn);">${e.message}</p>`; }
}

// Accordion, one PO expanded at a time — reuses the exact same panel
// Create PO uses (initializeCreatePOPanel), just rendered into this
// card's own expand area instead of the Create PO tab, so the whole
// thing stays inside Authorize Raw Material Purchase Order the way
// Auth BOQ / Auth PRN's cards already work. Vendor locked, Authorize PO
// / Reject PO instead of Submit for Authorization / Clear Form.
function toggleAuthorizePOCard(poNo) {
  const expandDiv = document.getElementById(`po-auth-expand-${poNo}`);
  if (!expandDiv) return;

  if (window.cpoExpandedPoNo === poNo) {
    expandDiv.style.display = "none";
    expandDiv.innerHTML = "";
    window.cpoExpandedPoNo = null;
    return;
  }
  if (window.cpoExpandedPoNo) {
    const prev = document.getElementById(`po-auth-expand-${window.cpoExpandedPoNo}`);
    if (prev) { prev.style.display = "none"; prev.innerHTML = ""; }
  }
  window.cpoExpandedPoNo = poNo;
  expandDiv.style.display = "block";
  expandDiv.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading PO…</div>`;
  (async () => {
    try {
      await initializeCreatePOPanel(poNo, `po-auth-expand-${poNo}`);
    } catch (e) {
      expandDiv.innerHTML = `<p style="color:var(--warn);">Failed to load: ${e.message}</p>`;
    }
  })();
}

// ═══════════════════════════════════════════════════════════════════════
// Search Raw Material Purchase Order — deliberately its OWN read-only
// renderer, not a reuse of initializeCreatePOPanel/renderCPOMaterialRows.
// Those two are shared by Create/Authorize/Revise PO and are already
// warned about in the handoff as "trace every call site" risk — adding a
// view-only branch through them would mean threading a 3rd mode through
// every input's disabled-state and every button's visibility. Cheaper and
// safer to just render static divs here from fetchRMPOFullDetail's data.
// ═══════════════════════════════════════════════════════════════════════

async function initializeSearchRMPOPanel() {
  window.srchpoToggle = 'po';
  window.srchpoSelectedItemCode = null;
  window.srchpoSelectedProjectId = null;
  window.srchpoExpandedPoNo = null;
  const poInput = document.getElementById("srchpo-po-input");
  const matInput = document.getElementById("srchpo-material-input");
  const projInput = document.getElementById("srchpo-project-input");
  if (poInput) poInput.value = "";
  if (matInput) matInput.value = "";
  if (projInput) projInput.value = "";
  document.getElementById("srchpo-results").innerHTML = "";
  const fb = document.getElementById("srchpo-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  const lbl = document.getElementById("srchpo-search-label");
  if (lbl) lbl.style.display = "none";
  switchSearchRMPOToggle('po');
  loadItemCodeCatalogIntoCache();
  try {
    const data = await apFetch({ action: "pullLiveActiveProjectCodes", statusFilter: "Active" });
    window.srchpoActiveProjects = (data.success ? (data.projects || []) : []);
  } catch(e) { window.srchpoActiveProjects = []; }
}

function switchSearchRMPOToggle(mode) {
  window.srchpoToggle = mode;
  document.getElementById("srchpo-results").innerHTML = "";
  const lbl = document.getElementById("srchpo-search-label");
  if (lbl) lbl.style.display = "none";
  const poTab = document.getElementById("srchpo-tab-po");
  const vendorTab = document.getElementById("srchpo-tab-vendor");
  const poField = document.getElementById("srchpo-po-field");
  if (mode === 'po') {
    poTab.style.color = "var(--brand)"; poTab.style.borderBottomColor = "var(--brand)"; poTab.style.fontWeight = "800";
    vendorTab.style.color = "var(--muted)"; vendorTab.style.borderBottomColor = "transparent"; vendorTab.style.fontWeight = "700";
    if (poField) poField.style.display = "block";
  } else {
    vendorTab.style.color = "var(--brand)"; vendorTab.style.borderBottomColor = "var(--brand)"; vendorTab.style.fontWeight = "800";
    poTab.style.color = "var(--muted)"; poTab.style.borderBottomColor = "transparent"; poTab.style.fontWeight = "700";
    // PO Number search doesn't apply to vendor lookup — hidden per spec.
    if (poField) poField.style.display = "none";
  }
}

let srchpoPODebounce = null;
function handleSrchPOPoInput(query) {
  clearTimeout(srchpoPODebounce);
  const dd = document.getElementById("srchpo-po-dd");
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  srchpoPODebounce = setTimeout(async () => {
    try {
      const data = await apFetch({ action: "searchRMPOsByPONumber", query });
      if (!dd) return;
      if (!data.success || !data.results.length) { dd.style.display = "none"; return; }
      dd.innerHTML = data.results.map(r => `
        <div onclick="document.getElementById('srchpo-po-input').value='${r.poNo.replace(/'/g,"\\'")}'; document.getElementById('srchpo-po-dd').style.display='none';"
          style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
          onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
          <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:6px;">${r.poNo}</span>${r.vendorName || ''}
        </div>`).join("");
      dd.style.display = "block";
    } catch(e) { dd.style.display = "none"; }
  }, 250);
}

function handleSrchPOMaterialInput(query) {
  window.srchpoSelectedItemCode = null;
  const dd = document.getElementById("srchpo-material-dd");
  const catalog = window.itemCodeCatalogCache || [];
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.toLowerCase();
  const matches = catalog.filter(it => (it.productName||"").toLowerCase().includes(q) || (it.rating||"").toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(it => `
    <div onclick="selectSrchPOMaterial('${it.itemCode}', \`${(it.productName||'').replace(/\`/g,"'")}\`, \`${(it.rating||'').replace(/\`/g,"'")}\`)"
      style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:6px;">${it.itemCode}</span>${it.productName}${it.rating ? ` <span style="color:var(--brand); font-weight:700;">${it.rating}</span>` : ''}
    </div>`).join("");
  dd.style.display = "block";
}

function selectSrchPOMaterial(itemCode, productName, rating) {
  window.srchpoSelectedItemCode = itemCode;
  document.getElementById("srchpo-material-input").value = rating ? `${productName} ${rating}` : productName;
  document.getElementById("srchpo-material-dd").style.display = "none";
}

function handleSrchPOProjectInput(query) {
  window.srchpoSelectedProjectId = null;
  const dd = document.getElementById("srchpo-project-dd");
  const projects = window.srchpoActiveProjects || [];
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.toLowerCase();
  const matches = projects.filter(p => p.toString().toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(p => `
    <div onclick="selectSrchPOProject('${p.toString().replace(/'/g,"")}')"
      style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${p}</div>`).join("");
  dd.style.display = "block";
}

function selectSrchPOProject(projectId) {
  window.srchpoSelectedProjectId = projectId;
  document.getElementById("srchpo-project-input").value = projectId;
  document.getElementById("srchpo-project-dd").style.display = "none";
}

function srchpoSetSearchingLabel(text) {
  const el = document.getElementById("srchpo-search-label");
  if (!el) return;
  el.textContent = text;
  el.style.display = "block";
}

function srchpoShowFeedback(msg, isError) {
  const fb = document.getElementById("srchpo-feedback");
  fb.style.display = "block";
  fb.style.borderLeftColor = isError ? "var(--warn)" : "var(--brand)";
  fb.style.background = isError ? "#fef2f2" : "#eff6ff";
  fb.style.color = isError ? "#b91c1c" : "var(--brand)";
  fb.innerHTML = msg;
}

async function searchByPONumberUI() {
  const q = document.getElementById("srchpo-po-input").value.trim();
  if (!q || q.length < 2) { srchpoShowFeedback("Enter at least 2 characters of a PO number.", true); return; }
  document.getElementById("srchpo-feedback").style.display = "none";
  srchpoSetSearchingLabel(`Searching for "${q}"`);
  const results = document.getElementById("srchpo-results");
  results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Searching...</div>`;
  try {
    const data = await apFetch({ action: "searchRMPOsByPONumber", query: q });
    if (!data.success) { srchpoShowFeedback(data.error, true); results.innerHTML = ""; return; }
    renderSrchPOResultsAsPOCards(data.results || []);
  } catch(e) { srchpoShowFeedback(e.message, true); results.innerHTML = ""; }
}

async function searchByMaterialUI() {
  if (!window.srchpoSelectedItemCode) { srchpoShowFeedback("Select a material from the dropdown list.", true); return; }
  document.getElementById("srchpo-feedback").style.display = "none";
  srchpoSetSearchingLabel(`Searching for "${document.getElementById("srchpo-material-input").value.trim()}"`);
  const results = document.getElementById("srchpo-results");
  results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Searching...</div>`;
  try {
    if (window.srchpoToggle === 'po') {
      const data = await apFetch({ action: "searchRMPOsByMaterial", itemCode: window.srchpoSelectedItemCode });
      if (!data.success) { srchpoShowFeedback(data.error, true); results.innerHTML = ""; return; }
      renderSrchPOResultsAsPOCards(data.results || []);
    } else {
      const data = await apFetch({ action: "searchRMPOVendorsByMaterial", itemCode: window.srchpoSelectedItemCode });
      if (!data.success) { srchpoShowFeedback(data.error, true); results.innerHTML = ""; return; }
      renderSrchPOMaterialVendorTable(data.results || []);
    }
  } catch(e) { srchpoShowFeedback(e.message, true); results.innerHTML = ""; }
}

async function searchByProjectIdUI() {
  const projectId = window.srchpoSelectedProjectId || document.getElementById("srchpo-project-input").value.trim();
  if (!projectId) { srchpoShowFeedback("Select or enter a Project ID.", true); return; }
  document.getElementById("srchpo-feedback").style.display = "none";
  srchpoSetSearchingLabel(`Searching for "${projectId}"`);
  const results = document.getElementById("srchpo-results");
  results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Searching...</div>`;
  try {
    if (window.srchpoToggle === 'po') {
      const data = await apFetch({ action: "searchRMPOsByProjectId", projectId });
      if (!data.success) { srchpoShowFeedback(data.error, true); results.innerHTML = ""; return; }
      renderSrchPOResultsAsPOCards(data.results || []);
    } else {
      const data = await apFetch({ action: "searchRMPOVendorsByProjectId", projectId });
      if (!data.success) { srchpoShowFeedback(data.error, true); results.innerHTML = ""; return; }
      renderSrchPOVendorResults(data.vendors || []);
    }
  } catch(e) { srchpoShowFeedback(e.message, true); results.innerHTML = ""; }
}

function renderSrchPOResultsAsPOCards(list) {
  const results = document.getElementById("srchpo-results");
  window.srchpoExpandedPoNo = null;
  if (list.length === 0) {
    results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">No matching Authorized Purchase Orders found.</div>`;
    return;
  }
  const fmt = (n) => (parseFloat(n)||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});
  results.innerHTML = list.map(po => `
    <div class="contact-summary-card-parent" style="margin-bottom:0;">
      <div class="contact-summary-header-row" onclick="toggleSrchPOCard('${po.poNo}')" style="cursor:pointer; width:100%; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="background:var(--accent); color:#fff; font-weight:700; padding:3px 10px; font-family:monospace;">${po.poNo}</span>
          <span style="margin-left:8px; font-weight:700;">${po.vendorName}</span>
          ${po.revisionNumber ? `<span style="margin-left:8px; font-size:0.72rem; color:var(--muted);">V${po.revisionNumber}</span>` : ""}
        </div>
        <div style="font-size:0.85rem; color:var(--muted);">${fmtPODate(po.orderDate)} &nbsp;|&nbsp; Grand Total: <strong style="color:var(--brand);">${fmt(po.grandTotal)}</strong></div>
      </div>
      <div id="srchpo-expand-${po.poNo}" style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;"></div>
    </div>`).join("");
}

async function toggleSrchPOCard(poNo) {
  const expandDiv = document.getElementById(`srchpo-expand-${poNo}`);
  if (!expandDiv) return;

  if (window.srchpoExpandedPoNo === poNo) {
    expandDiv.style.display = "none";
    expandDiv.innerHTML = "";
    window.srchpoExpandedPoNo = null;
    return;
  }
  if (window.srchpoExpandedPoNo) {
    const prev = document.getElementById(`srchpo-expand-${window.srchpoExpandedPoNo}`);
    if (prev) { prev.style.display = "none"; prev.innerHTML = ""; }
  }
  window.srchpoExpandedPoNo = poNo;
  expandDiv.style.display = "block";
  expandDiv.innerHTML = `<div style="text-align:center; padding:16px; color:var(--muted);">Loading PO detail...</div>`;
  try {
    const data = await apFetch({ action: "fetchRMPOFullDetail", poNo });
    if (!data.success) { expandDiv.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }
    expandDiv.innerHTML = renderRMPOViewOnlyDetail(data.po, data.lineItems || []);
  } catch(e) { expandDiv.innerHTML = `<p style="color:var(--warn);">${e.message}</p>`; }
}

function renderRMPOViewOnlyDetail(po, lineItems) {
  const fmt = (n) => (parseFloat(n)||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});
  const field = (label, val) => `
    <div>
      <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:3px;">${label}</div>
      <div style="font-size:0.85rem; color:#0f172a;">${val || '—'}</div>
    </div>`;

  const rowsHtml = lineItems.map((l) => {
    const allocs = l.allocations || [];
    // Extra = ordered qty not tied to any PRN, mirroring Create PO's allot chips.
    const allocSum = allocs.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    const extraQty = Math.round(((parseFloat(l.quantity) || 0) - allocSum) * 100) / 100;
    const projectChips = allocs.length
      ? allocs.map(a => `<div style="display:inline-block; background:#e0f2fe; color:var(--brand); font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 4px 3px 0;" title="${a.prnId}">${(a.prnId||'').replace(/^PRN_/, "")}: <strong>${fmt(a.quantity)}</strong></div>`).join("")
        + (extraQty > 0 ? `<div style="display:inline-block; background:#fef3c7; color:#78350f; font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 0 3px 0;">Extra: <strong>${fmt(extraQty)}</strong></div>` : "")
      : (extraQty > 0
          ? `<div style="display:inline-block; background:#fef3c7; color:#78350f; font-size:0.72rem; padding:2px 8px; border-radius:4px;">Extra: <strong>${fmt(extraQty)}</strong></div>`
          : '<span style="color:var(--muted); font-size:0.75rem;">No allocation on record</span>');
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px;">${l.description || ''}<div style="font-family:monospace; color:var(--brand); font-size:0.75rem;">${l.itemCode || ''}</div></td>
      <td style="padding:8px; text-align:center;">${l.unit || '—'}</td>
      <td style="padding:8px; text-align:right;">${fmt(l.quantity)}</td>
      <td style="padding:8px; text-align:right;">${fmt(l.rate)}</td>
      <td style="padding:8px; text-align:center;">${fmt(l.discountPercent)}%</td>
      <td style="padding:8px; text-align:right; font-weight:700;">${fmt(l.amount)}</td>
      <td style="padding:8px;">${projectChips}</td>
    </tr>`;
  }).join("");

  return `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:16px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px; letter-spacing:0.5px;">Purchase Order Header (View Only)</div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:14px;">
        ${field("Vendor Name", po.vendorName)}
        ${field("Supplier Offer No", po.supplierRef)}
        ${field("Order Date", fmtPODate(po.orderDate))}
        ${field("Delivery Date", fmtPODate(po.deliveryDate))}
        ${field("Prepared By", po.preparedBy)}
        ${field("Authorized By", po.authorizedBy)}
        ${field("Revision Number", po.revisionNumber || 0)}
        ${field("Status", po.status)}
      </div>
    </div>

    <div style="margin-bottom:16px; overflow-x:auto;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:10px; letter-spacing:0.5px;">Material Rows</div>
      <table style="width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--border); font-size:0.82rem; table-layout:fixed;">
        <colgroup>
          <col style="width:23%;">
          <col style="width:4%;">
          <col style="width:7%;">
          <col style="width:7%;">
          <col style="width:5%;">
          <col style="width:9%;">
          <col style="width:43%;">
        </colgroup>
        <thead>
          <tr style="background:#f1f5f9; text-align:left;">
            <th style="padding:8px;">Description of Material</th>
            <th style="padding:8px; text-align:center;">Unit</th>
            <th style="padding:8px; text-align:right;">Quantity</th>
            <th style="padding:8px; text-align:right;">Rate/Qty</th>
            <th style="padding:8px; text-align:center;">Disc %</th>
            <th style="padding:8px; text-align:right;">Amount</th>
            <th style="padding:8px;">PRNs / Projects</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" style="padding:14px; text-align:center; color:var(--muted);">No line items.</td></tr>`}</tbody>
      </table>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Taxes & Charges</div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
          ${field("CGST %", fmt(po.cgstPercent))}
          ${field("SGST %", fmt(po.sgstPercent))}
          ${field("IGST %", fmt(po.igstPercent))}
          ${field("Packing", fmt(po.packing))}
          ${field("Freight", fmt(po.freight))}
          ${field("Other", fmt(po.other))}
          ${field("Round Off", fmt(po.roundOff))}
        </div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Terms</div>
        ${field("Warranty", po.warranty)}
        <div style="margin-top:8px;">${field("Payment Terms", po.paymentTerms)}</div>
        <div style="margin-top:8px;">${field("Freight Terms", po.freightTerms)}</div>
      </div>
    </div>

    <div style="display:flex; justify-content:flex-end; background:#f0f9ff; border:1px solid #bae6fd; border-radius:var(--radius); padding:14px;">
      <div style="font-size:0.85rem; text-align:right;">
        <div>Sub Total: <strong>${fmt(po.subTotal)}</strong></div>
        <div style="font-size:1.05rem; margin-top:4px;">Grand Total: <strong style="color:var(--brand);">${fmt(po.grandTotal)}</strong></div>
      </div>
    </div>
  `;
}

function renderSrchPOVendorResults(vendors) {
  const results = document.getElementById("srchpo-results");
  if (vendors.length === 0) {
    results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">No matching vendors found.</div>`;
    return;
  }
  results.innerHTML = vendors.map(v => `
    <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:14px;">
      <div style="font-weight:700; font-size:0.95rem; color:var(--brand); margin-bottom:8px;">${v.vendorName} ${v.status ? `<span style="font-size:0.7rem; font-weight:600; color:${v.status === 'Active' ? '#16a34a' : '#b91c1c'};">(${v.status})</span>` : ""}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; font-size:0.82rem;">
        <div><span style="color:var(--muted);">GSTIN/UIN:</span> ${v.gstinUin || '—'}</div>
        <div><span style="color:var(--muted);">Type:</span> ${v.typeOfVendor || '—'}</div>
        <div><span style="color:var(--muted);">Contact Person:</span> ${v.contactPerson || '—'}</div>
        <div><span style="color:var(--muted);">Phone:</span> ${v.phoneNumber || '—'}</div>
        <div><span style="color:var(--muted);">Email:</span> ${v.email || '—'}</div>
        <div><span style="color:var(--muted);">City/State:</span> ${v.city || '—'}${v.state ? ', ' + v.state : ''} ${v.stateCode ? `(${v.stateCode})` : ''}</div>
        <div style="grid-column:1 / -1;"><span style="color:var(--muted);">Address:</span> ${v.address || '—'}</div>
      </div>
    </div>`).join("");
}

// Material Name search inside Search Vendor Information — one row per PO
// carrying the material (not one row per vendor), so rate/quantity can be
// compared PO-to-PO. Already sorted by the backend (order date desc, then
// po_no desc as the same-date tiebreak).
function renderSrchPOMaterialVendorTable(list) {
  const results = document.getElementById("srchpo-results");
  if (list.length === 0) {
    results.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">No matching Authorized Purchase Orders found.</div>`;
    return;
  }
  const rows = list.map(r => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:8px; font-family:monospace; font-weight:700; color:var(--brand);">${r.poNo}</td>
      <td style="padding:8px; font-weight:600;">${r.vendorName || "—"}</td>
      <td style="padding:8px;">${r.city || "—"}${r.state ? ', ' + r.state : ''}</td>
      <td style="padding:8px; text-align:center; font-family:monospace;">${fmtQty(r.poQuantity)}</td>
      <td style="padding:8px; text-align:center; font-family:monospace;">${fmtQty(r.ratePerQty)}</td>
      <td style="padding:8px;">${fmtPODate(r.orderDate) || "—"}</td>
      <td style="padding:8px;">${fmtPODate(r.deliveryDate) || "—"}</td>
    </tr>`).join("");
  results.innerHTML = `
    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
      <table style="width:100%; border-collapse:collapse; min-width:760px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:8px; font-size:0.7rem; text-align:left; text-transform:uppercase; color:var(--muted);">PO Number</th>
          <th style="padding:8px; font-size:0.7rem; text-align:left; text-transform:uppercase; color:var(--muted);">Vendor Name</th>
          <th style="padding:8px; font-size:0.7rem; text-align:left; text-transform:uppercase; color:var(--muted);">City/State</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; text-transform:uppercase; color:var(--muted);">PO Quantity</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; text-transform:uppercase; color:var(--muted);">Rate / Qty</th>
          <th style="padding:8px; font-size:0.7rem; text-align:left; text-transform:uppercase; color:var(--muted);">Order Date</th>
          <th style="padding:8px; font-size:0.7rem; text-align:left; text-transform:uppercase; color:var(--muted);">Delivery Date</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function initializeCreatePOPanel(authorizePoNo = null, containerId = "create-po-body") {
  window.cpoMode = authorizePoNo ? 'authorize' : 'create';
  window.cpoEditingPoNo = authorizePoNo || null;

  // Guards against two overlapping calls for the same container (e.g. a
  // fast double-click on the same PO card) — without this, a slower call
  // that started first can resolve LAST and reset the form's HTML right
  // after a faster call already populated it, wiping fields like Delivery
  // Date even though the data was fetched correctly.
  window._cpoPanelGeneration = (window._cpoPanelGeneration || 0) + 1;
  const myGeneration = window._cpoPanelGeneration;
  const isStale = () => myGeneration !== window._cpoPanelGeneration;

  const body = document.getElementById(containerId);
  if (!body) return;
  body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">Loading vendors and projects...</div>`;

  // A local create-draft is only relevant to brand-new POs — editing an
  // existing pending PO for authorization always starts from the PO's
  // own saved data (fetched below), never from localStorage.
  const draft = (window.cpoMode === 'create') ? loadCPODraft() : null;
  window.cpoMaterialRows = (draft && draft.materialRows) || [];
  window.cpoRowSeq = (draft && draft.rowSeq) || 0;

  const [vendorRes, projRes] = await Promise.allSettled([
    apFetch({ action: "fetchVendorList" }),
    apFetch({ action: "pullLiveActiveProjectCodes", statusFilter: "Active" })
  ]);
  if (isStale()) return;
  loadItemCodeCatalogIntoCache();

  window.cpoVendors = (vendorRes.status === "fulfilled" && vendorRes.value.success) ? vendorRes.value.vendors : [];
  window.cpoActiveProjects = (projRes.status === "fulfilled" && projRes.value.success)
    ? (projRes.value.projects || projRes.value.projectCodes || []).map(p => (typeof p === "string" ? p : (p.projectId || p.projectCode || ""))).filter(Boolean)
    : [];

  const vendorOptions = window.cpoVendors.filter(v => v.vendorName).map(v => `<option value="${v.vendorName.replace(/"/g,'&quot;')}">${v.vendorName}</option>`).join("");

  const today = new Date();
  const dd = String(today.getDate()).padStart(2,'0');
  const mmm = today.toLocaleString('en-US',{month:'short'});
  const orderDateStr = `${dd}-${mmm}-${today.getFullYear()}`;

  const isAuth = window.cpoMode === 'authorize';

  body.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:16px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px; letter-spacing:0.5px;">Purchase Order Header</div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-bottom:14px;">
        <div>
          <label class="field-label" style="margin-top:0;">Vendor Name *</label>
          <select id="cpo-vendor" onchange="handleCPOVendorChange()" ${isAuth ? "disabled" : ""} style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%; ${isAuth ? "background:#f1f5f9; color:#475569;" : ""}">
            <option value="">— Select Vendor —</option>${vendorOptions}
          </select>
          ${isAuth ? `<div style="font-size:0.7rem; color:var(--muted); margin-top:3px;">Locked</div>` : ""}
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Supplier Offer No</label>
          <input type="text" id="cpo-supplier-ref" placeholder="e.g. SEW/OFF/2026/0042" oninput="persistCPODraft()" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius);" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Delivery Date *</label>
          <input type="date" lang="en-GB" id="cpo-delivery-date" oninput="persistCPODraft()" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        </div>
      </div>
      <div id="cpo-vendor-preview" style="display:none; font-size:0.8rem; color:var(--muted); background:#fff; border:1px dashed var(--border); border-radius:var(--radius); padding:10px;"></div>
      <input type="hidden" id="cpo-order-date" value="${orderDateStr}" />
    </div>

    <div style="margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); letter-spacing:0.5px;">Material Rows</div>
        <button class="nav-btn-styled" id="cpo-add-row-btn" onclick="addCPOMaterialRow()" style="background:var(--accent); color:#fff; font-weight:700; padding:6px 14px;">+ Add Material Row</button>
      </div>
      <div id="cpo-rows-body"></div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Taxes & Charges</div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
          <div><label class="field-label" style="margin-top:0;">CGST %</label><input type="number" id="cpo-cgst" placeholder="9" oninput="recalcCPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">SGST %</label><input type="number" id="cpo-sgst" placeholder="9" oninput="recalcCPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">IGST %</label><input type="number" id="cpo-igst" placeholder="0" oninput="recalcCPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Packing</label><input type="number" id="cpo-packing" placeholder="0" oninput="recalcCPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Freight</label><input type="number" id="cpo-freight" placeholder="0" oninput="recalcCPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Other</label><input type="number" id="cpo-other" placeholder="0" oninput="recalcCPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Round Off</label><input type="number" id="cpo-roundoff" placeholder="0" step="any" oninput="recalcCPOTotals()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        </div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Terms</div>
        <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Warranty</label><input type="text" id="cpo-warranty" placeholder="e.g. 24 Months From Date Of Commissioning" oninput="persistCPODraft()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Payment Terms</label><input type="text" id="cpo-payment" placeholder="e.g. 60 Days Credit PDC" oninput="persistCPODraft()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        <div><label class="field-label" style="margin-top:0;">Freight Terms</label><input type="text" id="cpo-freight-terms" placeholder="e.g. To Pay" oninput="persistCPODraft()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
      </div>
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; grid-column:1 / -1;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Notes (optional)</div>
        <textarea id="cpo-notes" rows="2" placeholder="Anything worth printing on the PO document below the material rows — left blank, nothing extra appears on the document." oninput="persistCPODraft()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%; font-family:inherit; font-size:0.85rem;"></textarea>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; background:#f0f9ff; border:1px solid #bae6fd; border-radius:var(--radius); padding:14px; margin-bottom:16px;">
      <div style="font-size:0.85rem;">
        <div>Sub Total: <strong id="cpo-subtotal-disp">0.00</strong></div>
        <div style="font-size:1.05rem; margin-top:4px;">Grand Total: <strong id="cpo-grandtotal-disp" style="color:var(--brand);">0.00</strong></div>
      </div>
      <div style="display:flex; gap:10px;">
        ${isAuth
          ? `<button class="nav-btn-styled" onclick="rejectPOFromForm()" style="background:#dc2626;">Reject PO</button>
             <button class="nav-btn-styled" id="cpo-submit-btn" onclick="authorizePOFromForm()" style="background:var(--brand); color:#fff; font-weight:700; padding:10px 24px;">Authorize PO</button>`
          : `<button class="nav-btn-styled" onclick="clearCPOForm()" style="background:#718096;">Clear PO</button>
             <button class="nav-btn-styled" id="cpo-submit-btn" onclick="submitCreatePO()" style="background:var(--brand); color:#fff; font-weight:700; padding:10px 24px;">Submit for Authorization</button>`}
      </div>
    </div>
  `;

  if (isAuth) {
    // Load the PO's own saved data — not a local draft. Vendor is
    // pre-selected but the select stays disabled (set above), so it
    // displays correctly without being editable.
    try {
      const data = await apFetch({ action: "fetchPODraftById", poNo: authorizePoNo });
      if (isStale()) return;
      if (data.success && data.po) {
        const po = data.po;
        document.getElementById("cpo-vendor").value = po.vendorName || "";
        handleCPOVendorChange();
        if (po.supplierRef) document.getElementById("cpo-supplier-ref").value = po.supplierRef;
        if (po.deliveryDate) document.getElementById("cpo-delivery-date").value = new Date(po.deliveryDate).toISOString().slice(0,10);
        if (po.cgstPercent != null) document.getElementById("cpo-cgst").value = Number(po.cgstPercent) || 0;
        if (po.sgstPercent != null) document.getElementById("cpo-sgst").value = Number(po.sgstPercent) || 0;
        if (po.igstPercent != null) document.getElementById("cpo-igst").value = Number(po.igstPercent) || 0;
        if (po.packing != null) document.getElementById("cpo-packing").value = Number(po.packing) || 0;
        if (po.freight != null) document.getElementById("cpo-freight").value = Number(po.freight) || 0;
        if (po.other != null) document.getElementById("cpo-other").value = Number(po.other) || 0;
        if (po.roundOff != null) document.getElementById("cpo-roundoff").value = Number(po.roundOff) || 0;
        if (po.warranty) document.getElementById("cpo-warranty").value = po.warranty;
        if (po.paymentTerms) document.getElementById("cpo-payment").value = po.paymentTerms;
        if (po.freightTerms) document.getElementById("cpo-freight-terms").value = po.freightTerms;
        if (po.notes) document.getElementById("cpo-notes").value = po.notes;

        // These rows already went through allocation once at creation —
        // marking them touched avoids re-triggering the "must allocate"
        // gate on rows the authorizer hasn't actually changed.
        window.cpoMaterialRows = (po.lineItems || []).map(li => {
          window.cpoRowSeq = (window.cpoRowSeq || 0) + 1;
          const qty = Number(li.quantity) || 0;
          return {
            id: window.cpoRowSeq, description: li.description || "", itemCode: li.itemCode || "",
            quantity: li.quantity, unit: li.unit || "", rate: li.rate, discountPercent: li.discountPercent || 0,
            projectIds: [], allocations: li.allocations || [],
            _allocationTouched: true, _allocatedForQty: qty,
            designRatePerQuantity: li.designRatePerQuantity != null ? Number(li.designRatePerQuantity) : null,
          };
        });
      } else {
        body.innerHTML = `<div style="padding:20px; color:#b91c1c;">Could not load ${authorizePoNo}: ${data.error || "not found"}</div>`;
        return;
      }
    } catch (e) {
      body.innerHTML = `<div style="padding:20px; color:#b91c1c;">Network error loading ${authorizePoNo}: ${e.message}</div>`;
      return;
    }
  } else if (draft) {
    // Restore whatever was saved — Return to Main Dashboard (or an
    // accidental reload) shouldn't lose an in-progress PO. Only the
    // material rows come from state (window.cpoMaterialRows, restored
    // above); everything else is a plain field value re-applied here.
    if (draft.vendor) { document.getElementById("cpo-vendor").value = draft.vendor; handleCPOVendorChange(); }
    if (draft.supplierRef) document.getElementById("cpo-supplier-ref").value = draft.supplierRef;
    if (draft.deliveryDate) document.getElementById("cpo-delivery-date").value = draft.deliveryDate;
    if (draft.cgst) document.getElementById("cpo-cgst").value = draft.cgst;
    if (draft.sgst) document.getElementById("cpo-sgst").value = draft.sgst;
    if (draft.igst) document.getElementById("cpo-igst").value = draft.igst;
    if (draft.packing) document.getElementById("cpo-packing").value = draft.packing;
    if (draft.freight) document.getElementById("cpo-freight").value = draft.freight;
    if (draft.other) document.getElementById("cpo-other").value = draft.other;
    if (draft.roundoff) document.getElementById("cpo-roundoff").value = draft.roundoff;
    if (draft.warranty) document.getElementById("cpo-warranty").value = draft.warranty;
    if (draft.payment) document.getElementById("cpo-payment").value = draft.payment;
    if (draft.freightTerms) document.getElementById("cpo-freight-terms").value = draft.freightTerms;
    if (draft.notes) document.getElementById("cpo-notes").value = draft.notes;
  }
  renderCPOMaterialRows();
  recalcCPOTotals();
}

// ── Create PO draft persistence ─────────────────────────────────────────
// Return to Main Dashboard (or an accidental tab reload) shouldn't lose
// an in-progress PO — every field write calls persistCPODraft(), and
// initializeCreatePOPanel restores from it on next entry. Cleared only
// on a successful submit or an explicit Clear Form.
const CPO_DRAFT_STORAGE_KEY = 'abps_cpo_draft_v1';

function persistCPODraft() {
  if (window.cpoMode === 'authorize') return; // editing an existing PO, not a local draft
  const vendorEl = document.getElementById("cpo-vendor");
  if (!vendorEl) return; // panel not mounted — nothing to save
  try {
    const draft = {
      vendor: vendorEl.value,
      supplierRef: document.getElementById("cpo-supplier-ref").value,
      deliveryDate: document.getElementById("cpo-delivery-date").value,
      cgst: document.getElementById("cpo-cgst").value,
      sgst: document.getElementById("cpo-sgst").value,
      igst: document.getElementById("cpo-igst").value,
      packing: document.getElementById("cpo-packing").value,
      freight: document.getElementById("cpo-freight").value,
      other: document.getElementById("cpo-other").value,
      roundoff: document.getElementById("cpo-roundoff").value,
      warranty: document.getElementById("cpo-warranty").value,
      payment: document.getElementById("cpo-payment").value,
      freightTerms: document.getElementById("cpo-freight-terms").value,
      notes: document.getElementById("cpo-notes").value,
      materialRows: window.cpoMaterialRows || [],
      rowSeq: window.cpoRowSeq || 0,
    };
    localStorage.setItem(CPO_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch (e) { /* storage unavailable/full — resume just won't work, not fatal */ }
}

function loadCPODraft() {
  try {
    const raw = localStorage.getItem(CPO_DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearCPODraftStorage() {
  try { localStorage.removeItem(CPO_DRAFT_STORAGE_KEY); } catch (e) { /* ignore */ }
}

function clearCPOForm() {
  if (!confirm("Clear the entire Purchase Order form: Header, Material Rows, and Allocations?")) return;
  clearCPODraftStorage();
  initializeCreatePOPanel();
}

function handleCPOVendorChange() {
  const name = document.getElementById("cpo-vendor").value;
  const preview = document.getElementById("cpo-vendor-preview");
  const v = window.cpoVendors.find(x => x.vendorName === name);
  if (!v) { preview.style.display = "none"; persistCPODraft(); return; }
  preview.style.display = "block";
  preview.innerHTML = `<strong>${v.vendorName}</strong> &nbsp;|&nbsp; ${v.address || "(no address)"} &nbsp;|&nbsp; GSTIN: ${v.gstin || "—"} &nbsp;|&nbsp; ${v.state || "—"} (Code ${v.stateCode || "—"}) &nbsp;|&nbsp; ${v.email || "—"}`;
  // Prefilled from the vendor's own record — still a normal editable
  // input afterward, this just sets the starting value.
  const cgstEl = document.getElementById("cpo-cgst");
  const sgstEl = document.getElementById("cpo-sgst");
  const igstEl = document.getElementById("cpo-igst");
  if (cgstEl && v.cgstPercent != null) cgstEl.value = v.cgstPercent;
  if (sgstEl && v.sgstPercent != null) sgstEl.value = v.sgstPercent;
  if (igstEl && v.igstPercent != null) igstEl.value = v.igstPercent;
  recalcCPOTotals();
  persistCPODraft();
}

function addCPOMaterialRow() {
  const id = ++window.cpoRowSeq;
  window.cpoMaterialRows.push({ id, description: "", itemCode: "", quantity: "", unit: "", rate: "", discountPercent: "", projectIds: [], allocations: [], designRatePerQuantity: null });
  renderCPOMaterialRows();
  persistCPODraft();
}

function removeCPOMaterialRow(id) {
  window.cpoMaterialRows = window.cpoMaterialRows.filter(r => r.id !== id);
  renderCPOMaterialRows();
  recalcCPOTotals();
  persistCPODraft();
}

function renderCPOMaterialRows() {
  const body = document.getElementById("cpo-rows-body");
  if (window.cpoMaterialRows.length === 0) {
    body.innerHTML = `<div style="padding:14px; text-align:center; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:var(--radius);">No material rows yet. Click "+ Add Material Row".</div>`;
    return;
  }
  body.innerHTML = window.cpoMaterialRows.map((row, idx) => {
    const allocList = row.allocations || [];
    const allocSum = allocList.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    const lineQtyNow = parseFloat(row.quantity) || 0;
    const unallocNow = Math.round((lineQtyNow - allocSum) * 100) / 100;
    const projectChips = (allocList.length || row._allocationTouched)
      ? allocList.map(a => `<div style="display:inline-block; background:#e0f2fe; color:var(--brand); font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 4px 3px 0;" title="${a.prnId}">${a.prnId}: <strong>${a.quantity}</strong></div>`).join("")
        + (unallocNow > 0 ? `<div style="display:inline-block; background:#fef3c7; color:#78350f; font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 0 3px 0;">Extra: <strong>${unallocNow}</strong></div>` : "")
      : '<span style="color:#b91c1c; font-size:0.75rem; font-weight:600;">No PRNs allocated</span>';

    // Rate / Qty is locked (can't be typed) until Quantity has a real value
    // AND the row has actually been through Allocate to PRNs at least once
    // — typing a rate before the material/quantity/PRN split is settled
    // invites entering a number against the wrong basis. Re-locks itself
    // automatically if Quantity later changes enough to invalidate real
    // allocations (handleCPOQtyBlur clears _allocationTouched in that case).
    const rateLocked = !(row._allocationTouched && lineQtyNow > 0);

    // Design Rate / Qty = lowest design_rate_per_quantity among only the
    // PRNs this row is actually allocated to (see saveCPOAllocationPicker
    // / fetchPODraftById). Costing Difference compares against the
    // EFFECTIVE rate (after Disc %), not the raw Rate/Qty typed — a 100
    // rate at 10% discount is really a 90 rate for costing purposes, and
    // must track live as Disc % changes. Also only ever shown once Rate/
    // Qty actually has a value — an empty/locked rate has nothing
    // meaningful to compare yet, not "some rate is 0".
    const discNow = parseFloat(row.discountPercent) || 0;
    const rateNow = parseFloat(row.rate) || 0;
    const hasRateValue = row.rate !== '' && row.rate !== null && row.rate !== undefined && !isNaN(parseFloat(row.rate));
    const effectiveRate = rateNow * (100 - discNow) / 100;
    const designRate = row.designRatePerQuantity;
    const hasDesignRate = designRate != null;
    const isOverRate = hasRateValue && hasDesignRate && effectiveRate > Number(designRate) + 1e-9;
    const costingDiff = (hasRateValue && hasDesignRate) ? (effectiveRate - Number(designRate)) * lineQtyNow : null;
    const isAuthMode = window.cpoMode === 'authorize';
    const rowBg = (isAuthMode && isOverRate) ? "#fef2f2" : "#fff";
    const rowBorderColor = (isAuthMode && isOverRate) ? "#fca5a5" : "var(--border)";
    const overRateWarning = isOverRate
      ? `<div style="margin-top:10px; padding:7px 10px; background:${isAuthMode ? "#fee2e2" : "#fffbeb"}; border:1px solid ${isAuthMode ? "#fca5a5" : "#fde68a"}; border-radius:4px; font-size:0.75rem; font-weight:700; color:${isAuthMode ? "#b91c1c" : "#78350f"};">
          ⚠️ Rate / Qty after Disc % (${fmtQty(effectiveRate)}) is higher than Design Rate / Qty (${fmtQty(designRate)}).${isAuthMode ? " Only an admin can authorize this PO as-is." : ""}
        </div>`
      : "";

    return `<div data-rowid="${row.id}" style="background:${rowBg}; border:1px solid ${rowBorderColor}; border-radius:var(--radius); padding:12px; margin-bottom:10px;">
      <div style="display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap;">
        <div style="font-weight:700; color:var(--brand); padding-bottom:8px; min-width:20px;">${idx + 1}</div>

        <div style="flex:1; min-width:190px; position:relative;">
          <label style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; display:block;">Description of Material *</label>
          <input type="text" class="cpo-desc-search" data-rowid="${row.id}" value="${(row.description||'').replace(/"/g,'&quot;')}" placeholder="Search material name / rating..." autocomplete="off"
            oninput="handleCPODescSearch(${row.id}, this.value)"
            style="width:100%; height:36px; box-sizing:border-box; padding:7px; border:1.5px solid ${row.itemCode ? 'var(--brand)' : '#f59e0b'}; border-radius:4px; font-size:0.82rem;">
          <div id="cpo-desc-dd-${row.id}" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:220px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
        </div>

        <div style="width:95px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Item Code</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; font-weight:700; color:var(--brand); font-size:0.85rem;">${row.itemCode || '—'}</div>
        </div>
        <div style="width:50px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Unit</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; color:#475569; font-size:0.85rem;">${row.unit || '—'}</div>
        </div>
        <div style="width:80px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Quantity *</div>
          <input type="number" min="0" step="any" class="cpo-qty" data-rowid="${row.id}" value="${row.quantity}" oninput="updateCPORowField(${row.id},'quantity',this.value)" onblur="handleCPOQtyBlur(${row.id})" style="width:100%; height:36px; box-sizing:border-box; text-align:center; padding:7px 4px; border:1.5px solid var(--border); border-radius:4px;">
        </div>
        <div style="width:100px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Design Rate / Qty</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; font-weight:700; color:#475569; font-size:0.85rem;">${hasDesignRate ? fmtQty(designRate) : '—'}</div>
        </div>
        <div style="width:90px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Rate / Qty *</div>
          <input type="number" min="0" step="any" class="cpo-rate" data-rowid="${row.id}" value="${row.rate}" oninput="updateCPORowField(${row.id},'rate',this.value)"
            ${rateLocked ? 'disabled title="Enter Quantity and Allocate to PRNs first"' : ''}
            style="width:100%; height:36px; box-sizing:border-box; text-align:right; padding:7px 6px; border:1.5px solid ${isOverRate ? '#dc2626' : 'var(--border)'}; border-radius:4px; ${isOverRate ? 'background:#fef2f2;' : (rateLocked ? 'background:#f1f5f9; cursor:not-allowed;' : '')}">
        </div>
        <div style="width:70px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Disc %</div>
          <input type="number" min="0" max="100" step="any" class="cpo-disc" data-rowid="${row.id}" value="${row.discountPercent}" placeholder="0" oninput="updateCPORowField(${row.id},'discountPercent',this.value)" style="width:100%; height:36px; box-sizing:border-box; text-align:center; padding:7px 4px; border:1.5px solid var(--border); border-radius:4px;">
        </div>
        <div style="width:110px; flex-shrink:0; text-align:right;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Costing Diff</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:flex-end; font-family:monospace; font-weight:700; font-size:0.85rem; color:${costingDiff > 0 ? '#dc2626' : (costingDiff < 0 ? '#15803d' : '#475569')};"><span class="cpo-costing-diff">${costingDiff != null ? costingDiff.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</span></div>
        </div>
        <div style="width:120px; flex-shrink:0; text-align:right;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Amount</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:flex-end; font-family:monospace; font-weight:800; font-size:1.05rem; color:#0f172a;"><span class="cpo-amount" data-rowid="${row.id}">0</span></div>
        </div>

        <button onclick="removeCPOMaterialRow(${row.id})" title="Remove row" style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; cursor:pointer; font-size:0.95rem; width:32px; height:36px; border-radius:4px; display:flex; align-items:center; justify-content:center; flex-shrink:0; align-self:flex-end;">✕</button>
      </div>

      <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div style="min-width:180px;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">PRNs using this Material *</div>
          <button onclick="openCPOAllocationPicker(${row.id})" style="font-size:0.75rem; padding:5px 12px; background:var(--accent); color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">Allocate to PRNs</button>
        </div>
        <div style="flex:1; min-width:200px; padding-top:2px;">${projectChips}</div>
      </div>
      ${overRateWarning}
    </div>`;
  }).join("");
  window.cpoMaterialRows.forEach(r => updateCPORowAmount(r.id));
}

function handleCPODescSearch(rowId, query) {
  updateCPORowField(rowId, 'description', query);
  const dd = document.getElementById(`cpo-desc-dd-${rowId}`);
  const catalog = window.itemCodeCatalogCache || [];
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.toLowerCase();
  const matches = catalog.filter(it => (it.productName||"").toLowerCase().includes(q) || (it.rating||"").toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(it => `
    <div onclick="selectCPOMaterial(${rowId}, '${it.itemCode}', \`${(it.productName||'').replace(/\`/g,"'")}\`, \`${(it.rating||'').replace(/\`/g,"'")}\`, '${(it.unit||'Nos').replace(/'/g,'')}')"
      style="padding:7px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.8rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:6px;">${it.itemCode}</span>${it.productName}${it.rating ? ` <span style="color:var(--brand); font-weight:700;">${it.rating}</span>` : ''}
    </div>`).join("");
  dd.style.display = "block";
}

function selectCPOMaterial(rowId, itemCode, productName, rating, unitType) {
  const row = window.cpoMaterialRows.find(r => r.id === rowId);
  if (!row) return;
  row.description = rating ? `${productName} ${rating}` : productName;
  row.itemCode = itemCode;
  row.unit = unitType || "Nos";
  row.allocations = []; // old allocations were tied to the previous item code
  row._allocationTouched = false;
  row.designRatePerQuantity = null; // was derived from the old item code's allocated PRNs
  document.getElementById(`cpo-desc-dd-${rowId}`).style.display = "none";
  renderCPOMaterialRows();
  persistCPODraft();
}

function updateCPORowField(rowId, field, value) {
  const row = window.cpoMaterialRows.find(r => r.id === rowId);
  if (!row) return;
  row[field] = value;
  if (field === 'itemCode') {
    // The valid project list is material-specific, so any previously
    // chosen projects no longer necessarily apply.
    row.projectIds = [];
  }
  if (field === 'quantity' || field === 'rate' || field === 'discountPercent') {
    updateCPORowAmount(rowId);
    recalcCPOTotals();
  }
  persistCPODraft();
}

// Quantity is handled on blur (not on every keystroke) so allocations
// aren't wiped mid-typing — only once the operator has actually settled
// on a new value that no longer matches what the allocation was made
// against. A full re-render is fine here since typing has finished.
function handleCPOQtyBlur(rowId) {
  const row = window.cpoMaterialRows.find(r => r.id === rowId);
  if (!row || !row._allocationTouched) return;
  const newQty = parseFloat(row.quantity) || 0;
  if (newQty === row._allocatedForQty) return;
  if ((row.allocations || []).length > 0) {
    // Real PRN allocations no longer necessarily make sense against a
    // different quantity — clear them and force the operator to
    // re-confirm via Allocate to PRNs.
    row.allocations = [];
    row._allocationTouched = false;
    row.designRatePerQuantity = null;
  } else {
    // All-extra: extra is just "whatever's left after real PRN
    // allocations" (here, all of it), which stays automatically valid
    // no matter how the quantity changes — just re-track what it's
    // now confirmed against so the Extra chip updates.
    row._allocatedForQty = newQty;
  }
  renderCPOMaterialRows();
  persistCPODraft();
}

function updateCPORowAmount(rowId) {
  const row = window.cpoMaterialRows.find(r => r.id === rowId);
  if (!row) return;
  const qty = parseFloat(row.quantity) || 0;
  const rate = parseFloat(row.rate) || 0;
  const disc = parseFloat(row.discountPercent) || 0;
  const amount = qty * rate * (100 - disc) / 100;
  row.amount = amount;
  const span = document.querySelector(`.cpo-amount[data-rowid="${rowId}"]`);
  if (span) span.textContent = amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  // Costing Diff / over-rate flag are Rate-dependent — updated here (not
  // just at render time) so typing a new Rate (or Disc %) reflects live
  // without a full re-render mid-keystroke (which would drop input focus).
  // Compared against the EFFECTIVE rate (after Disc %), and only once
  // Rate/Qty actually has a value — same rule as the render-time version.
  const hasRateValue = row.rate !== '' && row.rate !== null && row.rate !== undefined && !isNaN(parseFloat(row.rate));
  const effectiveRate = rate * (100 - disc) / 100;
  const designRate = row.designRatePerQuantity;
  const hasDesignRate = designRate != null;
  const isOverRate = hasRateValue && hasDesignRate && effectiveRate > Number(designRate) + 1e-9;
  const costingDiff = (hasRateValue && hasDesignRate) ? (effectiveRate - Number(designRate)) * qty : null;
  const rowEl = document.querySelector(`[data-rowid="${rowId}"]`);
  const diffSpan = rowEl ? rowEl.querySelector(".cpo-costing-diff") : null;
  if (diffSpan) {
    diffSpan.textContent = costingDiff != null ? costingDiff.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : "—";
    diffSpan.style.color = costingDiff > 0 ? "#dc2626" : (costingDiff < 0 ? "#15803d" : "#475569");
  }
  const rateInput = document.querySelector(`.cpo-rate[data-rowid="${rowId}"]`);
  if (rateInput) {
    rateInput.style.borderColor = isOverRate ? "#dc2626" : "var(--border)";
    rateInput.style.background = isOverRate ? "#fef2f2" : "";
  }
  // The row-level red background and the warning strip below the row are
  // static-render-only (they'd need a full re-render to move/appear) —
  // acceptable since Authorize's authoritative block re-checks on submit
  // regardless of whether the strip has refreshed live.
}

function recalcCPOTotals() {
  let subTotal = 0;
  window.cpoMaterialRows.forEach(row => {
    const qty = parseFloat(row.quantity) || 0;
    const rate = parseFloat(row.rate) || 0;
    const disc = parseFloat(row.discountPercent) || 0;
    subTotal += qty * rate * (100 - disc) / 100;
  });
  // CGST/SGST default to 9 when left blank (the placeholder is a real
  // default, not just a hint) — everything else genuinely defaults to 0.
  const cgstPct = document.getElementById("cpo-cgst").value.trim() === "" ? 9 : (parseFloat(document.getElementById("cpo-cgst").value) || 0);
  const sgstPct = document.getElementById("cpo-sgst").value.trim() === "" ? 9 : (parseFloat(document.getElementById("cpo-sgst").value) || 0);
  const cgst = subTotal * cgstPct / 100;
  const sgst = subTotal * sgstPct / 100;
  const igst = subTotal * (parseFloat(document.getElementById("cpo-igst").value) || 0) / 100;
  const packing = parseFloat(document.getElementById("cpo-packing").value) || 0;
  const freight = parseFloat(document.getElementById("cpo-freight").value) || 0;
  const other = parseFloat(document.getElementById("cpo-other").value) || 0;
  const roundOff = parseFloat(document.getElementById("cpo-roundoff").value) || 0;
  const grandTotal = subTotal + cgst + sgst + igst + packing + freight + other + roundOff;
  const fmt = (n) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  document.getElementById("cpo-subtotal-disp").textContent = fmt(subTotal);
  document.getElementById("cpo-grandtotal-disp").textContent = fmt(grandTotal);
  persistCPODraft();
}

function updateCPOAllocTotals(lineQty) {
  const inputs = Array.from(document.querySelectorAll(".cpo-alloc-input"));
  let sum = 0, overCap = [];
  inputs.forEach(inp => {
    const v = parseFloat(inp.value) || 0;
    const cap = parseFloat(inp.dataset.max) || 0;
    sum += v;
    if (v > cap + 1e-9) overCap.push(inp.dataset.prnid);
    inp.style.borderColor = v > cap + 1e-9 ? "#b91c1c" : "var(--brand)";
  });
  const unalloc = Math.round((lineQty - sum) * 100) / 100;
  const extraEl = document.getElementById("cpo-alloc-extra-value");
  if (extraEl) extraEl.textContent = (Math.max(0, unalloc)).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const el = document.getElementById("cpo-alloc-summary");
  if (!el) return;
  const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (overCap.length) {
    el.style.cssText = "padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700; background:#fef2f2; color:#b91c1c;";
    el.textContent = `${overCap.length} PRN(s) allocated more than they still need.`;
  } else if (sum > lineQty + 1e-9) {
    el.style.cssText = "padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700; background:#fef2f2; color:#b91c1c;";
    el.textContent = `Allocated ${fmt(sum)}, but the Vendor Discussed Qty is only ${fmt(lineQty)}.`;
  } else {
    el.style.cssText = `padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700; background:${unalloc > 0 ? "#fffbeb" : "#f0fdf4"}; color:${unalloc > 0 ? "#78350f" : "#15803d"};`;
    el.textContent = unalloc > 0
      ? `Allocated ${fmt(sum)} of ${fmt(lineQty)}. Unallocated ${fmt(unalloc)} will be extra stock.`
      : `All ${fmt(lineQty)} allocated.`;
  }
}

function saveCPOAllocationPicker(rowId) {
  const row = window.cpoMaterialRows.find(r => r.id === rowId);
  const modal = document.getElementById("cpo-alloc-modal");
  if (!row || !modal) return;
  const lineQty = parseFloat(row.quantity) || 0;
  const allocs = [];
  let sum = 0;
  for (const inp of modal.querySelectorAll(".cpo-alloc-input")) {
    const q = parseFloat(inp.value) || 0;
    if (q <= 0) continue;
    const cap = parseFloat(inp.dataset.max) || 0;
    if (q > cap + 1e-9) {
      alert(`${inp.dataset.prnid} only needs ${cap} more of this material, cannot allocate ${q}.`);
      return;
    }
    sum += q;
    allocs.push({ prnId: inp.dataset.prnid, quantity: q });
  }
  if (sum > lineQty + 1e-9) {
    alert(`Allocated ${sum} across PRNs but the ordered quantity is only ${lineQty}.`);
    return;
  }
  row.allocations = allocs;
  row._allocatedForQty = lineQty;
  row._allocationTouched = true;
  // Design Rate / Qty = the lowest design_rate_per_quantity (from the
  // allocated PRN's own BOQ, same item code) among only the PRNs this
  // row actually got allocated to — not every open PRN for the material.
  const openPrns = window._cpoAllocOpenPrns || [];
  const rates = allocs
    .map(a => openPrns.find(p => p.prnId === a.prnId))
    .map(p => p && p.designRatePerQuantity)
    .filter(r => r != null)
    .map(Number);
  row.designRatePerQuantity = rates.length ? Math.min(...rates) : null;
  modal.remove();
  renderCPOMaterialRows();
  persistCPODraft();
}

async function submitCreatePO() {
  const banner = document.getElementById("create-po-feedback");
  banner.style.display = "none";
  const showErr = (msg) => {
    banner.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #dc2626; background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-weight:600;";
    banner.textContent = msg;
    banner.scrollIntoView({ behavior:"smooth", block:"center" });
  };

  const vendorName = document.getElementById("cpo-vendor").value.trim();
  const deliveryDateRaw = document.getElementById("cpo-delivery-date").value.trim();
  let deliveryDate = deliveryDateRaw;
  if (deliveryDateRaw) {
    const d = new Date(deliveryDateRaw + "T00:00:00");
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2,'0');
      const mmm = d.toLocaleString('en-US',{month:'short'});
      deliveryDate = `${dd}-${mmm}-${d.getFullYear()}`;
    }
  }
  if (!vendorName) return showErr("Please select a Vendor.");
  if (!deliveryDate) return showErr("Please enter a Delivery Date.");
  if (window.cpoMaterialRows.length === 0) return showErr("Add at least one material row.");

  for (let i = 0; i < window.cpoMaterialRows.length; i++) {
    const row = window.cpoMaterialRows[i];
    const n = i + 1;
    if (!row.itemCode) return showErr(`Row ${n}: select a material from the search (item code required).`);
    if (!(parseFloat(row.quantity) > 0)) return showErr(`Row ${n}: Quantity must be greater than 0.`);
    if (!(parseFloat(row.rate) > 0)) return showErr(`Row ${n}: Rate must be greater than 0.`);
    // Every row must have been through "Allocate to PRNs" at least once
    // — ending up with zero real PRN allocations is fine (a deliberate
    // stock-building purchase), but it must be an explicit confirmation
    // via Save Allocation, not silently defaulted by never opening it.
    if (!row._allocationTouched) {
      return showErr(`Row ${n}: click "Allocate to PRNs" and confirm the split (or Extra) before submitting.`);
    }
    const aSum = (row.allocations || []).reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    if (aSum > (parseFloat(row.quantity) || 0) + 1e-9) {
      return showErr(`Row ${n}: allocated ${aSum} across PRNs but only ${row.quantity} is being ordered.`);
    }
  }

  const payload = {
    vendorName,
    supplierRef: document.getElementById("cpo-supplier-ref").value.trim(),
    orderDate: document.getElementById("cpo-order-date").value.trim(),
    deliveryDate,
    lineItems: window.cpoMaterialRows.map(r => ({
      description: r.description, itemCode: r.itemCode, quantity: parseFloat(r.quantity) || 0,
      unit: r.unit, rate: parseFloat(r.rate) || 0, discountPercent: parseFloat(r.discountPercent) || 0,
      amount: Number(r.amount) || 0,
      deliveryDate: r.deliveryDate || null,
      allocations: (r.allocations || []).map(a => ({ prnId: a.prnId, quantity: Number(a.quantity) || 0 }))
    })),
    cgstPercent: document.getElementById("cpo-cgst").value.trim() === "" ? 9 : (parseFloat(document.getElementById("cpo-cgst").value) || 0),
    sgstPercent: document.getElementById("cpo-sgst").value.trim() === "" ? 9 : (parseFloat(document.getElementById("cpo-sgst").value) || 0),
    igstPercent: parseFloat(document.getElementById("cpo-igst").value) || 0,
    packing: parseFloat(document.getElementById("cpo-packing").value) || 0,
    freight: parseFloat(document.getElementById("cpo-freight").value) || 0,
    other: parseFloat(document.getElementById("cpo-other").value) || 0,
    roundOff: parseFloat(document.getElementById("cpo-roundoff").value) || 0,
    warranty: document.getElementById("cpo-warranty").value.trim(),
    paymentTerms: document.getElementById("cpo-payment").value.trim(),
    freightTerms: document.getElementById("cpo-freight-terms").value.trim(),
    notes: document.getElementById("cpo-notes").value.trim(),
    preparedBy: appActiveOperatorIdentityString || ""
  };

  const btn = document.getElementById("cpo-submit-btn");
  btn.disabled = true; btn.textContent = "Submitting...";
  showBlockingOverlay("Creating Purchase Order...");
  try {
    const data = await apFetch({ action: "commitPurchaseOrderDraft", activeEngineer: appActiveOperatorIdentityString, ...payload, operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (data.success) {
      clearCPODraftStorage();
      document.getElementById("create-po-body").innerHTML = "";
      banner.style.cssText = "display:block; padding:16px; margin-bottom:12px; border-left:4px solid #15803d; background:#dcfce7; color:#15803d; border-radius:var(--radius);";
      banner.innerHTML = `<strong>PO Draft Created: ${data.poNo}</strong><br/>It has been sent for Authorization. <button class="nav-btn-styled" onclick="document.getElementById('create-po-feedback').style.display='none'; initializeCreatePOPanel();" style="background:#15803d; color:#fff; margin-top:8px; padding:6px 14px;">+ Create Another PO</button>`;
      banner.scrollIntoView({ behavior:"smooth", block:"center" });
    } else {
      btn.disabled = false; btn.textContent = "Submit for Authorization";
      showErr("Server error: " + data.error);
    }
  } catch(e) {
    hideBlockingOverlay();
    btn.disabled = false; btn.textContent = "Submit for Authorization";
    showErr("Network error: " + e.message);
  }
}

window.activeRejectedMaterialToggle = "pending";
window.rejMaterialVendorFilter = "";
window.rejMaterialActionFilter = [];

// authorizePOFromForm / rejectPOFromForm — the Authorize-mode counterparts
// of submitCreatePO/clearCPOForm. Same panel, same DOM ids, same
// validation and payload shape (vendor omitted — it's locked, the server
// always uses the PO's own regardless of what's sent).
async function authorizePOFromForm() {
  const banner = document.getElementById("authorize-po-feedback");
  banner.style.display = "none";
  const showErr = (msg) => {
    banner.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #dc2626; background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-weight:600;";
    banner.textContent = msg;
    banner.scrollIntoView({ behavior:"smooth", block:"center" });
  };

  const poNo = window.cpoEditingPoNo;
  if (!poNo) return showErr("No PO is loaded for authorization.");

  const deliveryDateRaw = document.getElementById("cpo-delivery-date").value.trim();
  let deliveryDate = deliveryDateRaw;
  if (deliveryDateRaw) {
    const d = new Date(deliveryDateRaw + "T00:00:00");
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2,'0');
      const mmm = d.toLocaleString('en-US',{month:'short'});
      deliveryDate = `${dd}-${mmm}-${d.getFullYear()}`;
    }
  }
  if (!deliveryDate) return showErr("Please enter a Delivery Date.");
  if (window.cpoMaterialRows.length === 0) return showErr("Add at least one material row.");

  for (let i = 0; i < window.cpoMaterialRows.length; i++) {
    const row = window.cpoMaterialRows[i];
    const n = i + 1;
    if (!row.itemCode) return showErr(`Row ${n}: select a material from the search (item code required).`);
    if (!(parseFloat(row.quantity) > 0)) return showErr(`Row ${n}: Quantity must be greater than 0.`);
    if (!(parseFloat(row.rate) > 0)) return showErr(`Row ${n}: Rate must be greater than 0.`);
    if (!row._allocationTouched) {
      return showErr(`Row ${n}: click "Allocate to PRNs" and confirm the split (or Extra) before authorizing.`);
    }
    const aSum = (row.allocations || []).reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    if (aSum > (parseFloat(row.quantity) || 0) + 1e-9) {
      return showErr(`Row ${n}: allocated ${aSum} across PRNs but only ${row.quantity} is being ordered.`);
    }
    // Non-admins cannot push through a rate above the BOQ's Design Rate /
    // Qty — the server enforces this authoritatively too (see
    // authorizePurchaseOrder), this is just the earlier, friendlier stop.
    const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
    const dr = row.designRatePerQuantity;
    if (!isAdminUser && dr != null && (parseFloat(row.rate) || 0) > Number(dr) + 1e-9) {
      return showErr(`Row ${n}: Rate / Qty (${row.rate}) is higher than Design Rate / Qty (${dr}). Only an admin can authorize this PO. Hand it off to an admin.`);
    }
  }

  const payload = {
    poNo,
    supplierRef: document.getElementById("cpo-supplier-ref").value.trim(),
    deliveryDate,
    lineItems: window.cpoMaterialRows.map(r => ({
      description: r.description, itemCode: r.itemCode, quantity: parseFloat(r.quantity) || 0,
      unit: r.unit, rate: parseFloat(r.rate) || 0, discountPercent: parseFloat(r.discountPercent) || 0,
      amount: Number(r.amount) || 0,
      deliveryDate: r.deliveryDate || null,
      allocations: (r.allocations || []).map(a => ({ prnId: a.prnId, quantity: Number(a.quantity) || 0 }))
    })),
    cgstPercent: document.getElementById("cpo-cgst").value.trim() === "" ? 9 : (parseFloat(document.getElementById("cpo-cgst").value) || 0),
    sgstPercent: document.getElementById("cpo-sgst").value.trim() === "" ? 9 : (parseFloat(document.getElementById("cpo-sgst").value) || 0),
    igstPercent: parseFloat(document.getElementById("cpo-igst").value) || 0,
    packing: parseFloat(document.getElementById("cpo-packing").value) || 0,
    freight: parseFloat(document.getElementById("cpo-freight").value) || 0,
    other: parseFloat(document.getElementById("cpo-other").value) || 0,
    roundOff: parseFloat(document.getElementById("cpo-roundoff").value) || 0,
    warranty: document.getElementById("cpo-warranty").value.trim(),
    paymentTerms: document.getElementById("cpo-payment").value.trim(),
    freightTerms: document.getElementById("cpo-freight-terms").value.trim(),
    notes: document.getElementById("cpo-notes").value.trim(),
  };

  const btn = document.getElementById("cpo-submit-btn");
  btn.disabled = true; btn.textContent = "Authorizing...";
  showBlockingOverlay("Authorizing PO & generating PDF...");
  try {
    const data = await apFetch({ action: "authorizePurchaseOrder", activeEngineer: appActiveOperatorIdentityString, ...payload, operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (data.success) {
      window.cpoExpandedPoNo = null;
      const body = document.getElementById("authorize-po-body");
      if (body) body.innerHTML = "";
      banner.style.cssText = "display:block; padding:16px; margin-bottom:12px; border-left:4px solid #15803d; background:#dcfce7; color:#15803d; border-radius:var(--radius);";
      let msg = `<div style="font-size:0.85rem; font-weight:800; margin-bottom:8px;">✅ ${poNo} Authorized Successfully!</div>`;
      if (data.pdfUrl) msg += `<a href="${driveLink(data.pdfUrl)}" target="_blank" style="display:inline-block; margin-top:8px; margin-right:10px; background:#fff; color:var(--brand); border:1.5px solid var(--brand); padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; text-decoration:none;">📄 Open PO PDF</a>`;
      else if (data.pdfWarning) msg += `<div style="font-size:0.78rem; color:#b45309; margin-top:6px;">⚠️ PDF could not be generated — PO is authorized. Contact admin to verify Drive folder setup.</div>`;
      msg += `<button onclick="document.getElementById('authorize-po-feedback').style.display='none'; initializeAuthorizePOPanel();" style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">+ Authorize Another PO</button>`;
      banner.innerHTML = msg;
      banner.scrollIntoView({ behavior:"smooth", block:"center" });
    } else {
      btn.disabled = false; btn.textContent = "Authorize PO";
      showErr("Server error: " + data.error);
    }
  } catch (e) {
    hideBlockingOverlay();
    btn.disabled = false; btn.textContent = "Authorize PO";
    showErr("Network error: " + e.message);
  }
}

async function rejectPOFromForm() {
  const poNo = window.cpoEditingPoNo;
  if (!poNo) return;
  if (!confirm(`Reject ${poNo}? This deletes the PO entirely.`)) return;

  const banner = document.getElementById("authorize-po-feedback");
  showBlockingOverlay("Rejecting PO...");
  try {
    const data = await apFetch({ action: "rejectPurchaseOrder", activeEngineer: appActiveOperatorIdentityString, poNo, operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (data.success) {
      banner.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #15803d; background:#dcfce7; color:#15803d; border-radius:var(--radius); font-weight:600;";
      banner.textContent = `${poNo} rejected and removed.`;
      banner.scrollIntoView({ behavior:"smooth", block:"center" });
      window.cpoExpandedPoNo = null;
      initializeAuthorizePOPanel(); // refresh queue — this PO drops off
    } else {
      banner.style.display = "block";
      banner.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #dc2626; background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-weight:600;";
      banner.textContent = "Error: " + data.error;
      banner.scrollIntoView({ behavior:"smooth", block:"center" });
    }
  } catch (e) {
    hideBlockingOverlay();
    banner.style.display = "block";
    banner.style.cssText = "display:block; padding:12px; margin-bottom:12px; border-left:4px solid #dc2626; background:#fef2f2; color:#b91c1c; border-radius:var(--radius); font-weight:600;";
    banner.textContent = "Network error: " + e.message;
    banner.scrollIntoView({ behavior:"smooth", block:"center" });
  }
}

let rejVendorSearchDebounce = null;
async function initializeRMPOUploadPanel() {
  resetRMPOUploadState();
  document.getElementById("rm-po-feedback").style.display = "none";
  document.getElementById("rm-po-upload-zone").style.display = "block";

  const uploadedByDrop = document.getElementById("rm-po-uploaded-by");
  uploadedByDrop.innerHTML = '<option value="">— Select Person —</option>';
  try {
    const res  = await fetch(GAS_URL, { method:"POST", body: JSON.stringify({ action:"getStoreOperatorsList", sessionToken: localStorage.getItem("sessionToken") }) });
    const data = await res.json();
    const purchasePeople = (data.fullPersonnelDataRecordsTree || []).filter(p =>
      p.departmentsList.some(d => d.toLowerCase().trim() === "purchase")
    );
    uploadedByDrop.innerHTML = '<option value="">— Select Person —</option>';
    purchasePeople.forEach(p => {
      const opt = document.createElement("option"); opt.value = p.fullName; opt.textContent = p.fullName;
      uploadedByDrop.appendChild(opt);
    });
    const matchExists = purchasePeople.some(p => p.fullName === appActiveOperatorIdentityString);
    uploadedByDrop.value = (appActiveOperatorIdentityString && matchExists) ? appActiveOperatorIdentityString : "";
  } catch(e) {
    uploadedByDrop.innerHTML = '<option value="">Error loading personnel</option>';
  }
}

function handleRMPOFileSelection(input) {
  targetRMPOFileObj = input.files[0];
  if (targetRMPOFileObj) {
    const box = document.getElementById("rm-po-file-dropzone");
    box.textContent = "📄 " + targetRMPOFileObj.name + " ✅";
    box.classList.add("done");
  }
}

function resetRMPOUploadState() {
  targetRMPOFileObj       = null;
  activeParsedRMPOPayload = null;
  const fileInput = document.getElementById("rm-po-file-input");
  if (fileInput) fileInput.value = "";
  const box = document.getElementById("rm-po-file-dropzone");
  if (box) { box.textContent = "📄 Select Raw Material Purchase Order (PDF or Image)"; box.classList.remove("done"); }
  document.getElementById("rm-po-verification-zone").style.display = "none";
  document.getElementById("rm-po-verification-table-body").innerHTML = "";
  ["rm-po-vendor-name","rm-po-number","rm-po-order-date","rm-po-delivery-date","rm-po-grand-total"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
}

async function parseRawMaterialPOWithAI() {
  if (!targetRMPOFileObj) { showPurchaseFeedback("rm-po-feedback", "⚠️ Please select a PO document first.", "error"); return; }
  const MAX_RMPO = 15 * 1024 * 1024; // 15MB
  if (targetRMPOFileObj.size > MAX_RMPO) { showPurchaseFeedback("rm-po-feedback", "⚠️ PO file is too large (max 15MB). Please use a compressed PDF or image.", "error"); return; }
  const btn = document.getElementById("rm-po-parse-btn");
  btn.disabled = true; btn.innerHTML = 'AI Processing...';

  try {
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(targetRMPOFileObj); });
    await loadItemCodeCatalogIntoCache();
    const catalog = window.itemCodeCatalogCache || [];

    const res  = await apFetch({
      action: "parseRawMaterialPurchaseOrder",
      fileData64: b64,
      mimeType: targetRMPOFileObj.type || "application/pdf"
    });
    const data = res;

    if (!data.success) { showPurchaseFeedback("rm-po-feedback", "⚠️ AI Processing failed: " + (data.error || "Unknown error"), "error"); return; }

    activeParsedRMPOPayload = data.extractedData;

    document.getElementById("rm-po-number").value        = data.extractedData.poNumber    || "";
    document.getElementById("rm-po-order-date").value    = data.extractedData.orderDate   || "";
    document.getElementById("rm-po-delivery-date").value = data.extractedData.deliveryDate|| "";
    document.getElementById("rm-po-grand-total").value   = data.extractedData.grandTotal  || "";

    const vendorInput = document.getElementById("rm-po-vendor-name");
    if (vendorInput) vendorInput.value = data.extractedData.vendorName || "";

    // match colors removed — status column replaced with inline indicators

    const tbody = document.getElementById("rm-po-verification-table-body");
    tbody.innerHTML = "";
    (data.extractedData.lineItems || []).forEach((item, idx) => {
      // Resolve item code: printed on doc > catalog match from AI > empty
      const rawCode     = (item.itemCode    || "").toString().trim();
      const matchSource = (item.matchSource || "none");

      // Loose normalize — handles OCR misreads: O vs 0, spaces, dashes
      const normalizeCode = s => s.toString().toUpperCase().replace(/[\s\-]/g, "").replace(/O/g, "0");

      let resolvedCode = "";
      let resolvedName = "";
      let resolvedUnit = "";
      if (rawCode && matchSource === "printed") {
        // Strict match first, loose fallback for OCR errors
        const strictHit = catalog.find(c => (c.itemCode || "").toUpperCase() === rawCode.toUpperCase());
        const looseHit  = strictHit ?
          null : catalog.find(c => normalizeCode(c.itemCode) === normalizeCode(rawCode));
        const hit = strictHit || looseHit;
        if (hit) {
          resolvedCode = hit.itemCode;
          resolvedName = hit.productName;
          resolvedUnit = hit.unit || "";
        } else {
          // Printed but not in catalog — show as-is, user must verify
          resolvedCode = rawCode;
          resolvedName = "";
        }
      }
      // Note: matchSource "catalog" is no longer used — AI no longer does catalog lookup
      // Unit is ALWAYS sourced from the Item Code catalog, never from the PO

      const notFound = !resolvedCode;
      const itemCodeCellContent = notFound
        ? `<input type="text" class="rm-po-item-code-input" data-idx="${idx}" value=""
             placeholder="Not found"
             style="font-weight:700; color:#b91c1c; font-size:0.78rem; padding:6px 4px; border:1.5px solid #fca5a5; text-align:center; width:100%; border-radius:3px; background:#fff7f7;" readonly />`
        : `<input type="text" class="rm-po-item-code-input" data-idx="${idx}" value="${resolvedCode}"
             style="font-weight:700; color:var(--brand); font-size:0.8rem; padding:6px 4px; border:1.5px solid #86efac; text-align:center; width:100%; border-radius:3px; background:#f0fdf4;" readonly />`;

      const nameSearchCell = notFound
        ? `<div style="position:relative;">
             <input type="text" class="rm-po-mat-name-input rm-po-name-search" data-idx="${idx}" value=""
               placeholder="Type to search material name..."
               oninput="handleRMPONameSearch(this, ${idx})"
               autocomplete="off"
               style="font-size:0.82rem; font-weight:600; padding:4px; border:1.5px solid #fca5a5; width:100%; border-radius:3px; background:#fff7f7;" />
             <div id="rmpo-name-dropdown-${idx}" style="display:none; position:fixed; background:#fff; border:1px solid var(--border); border-radius:4px; z-index:9999; max-height:200px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:280px;"></div>
           </div>`
        : `<div style="position:relative;">
             <div class="rm-po-mat-name-locked" data-idx="${idx}"
               onclick="reopenRMPONameSearch(${idx})"
               title="Click to change"
               style="display:flex; justify-content:space-between; align-items:center; gap:6px; cursor:pointer; font-size:0.82rem; font-weight:600; padding:4px; border:1px solid #86efac; border-radius:3px; background:#f0fdf4;">
               <span class="rm-po-mat-name-locked-text">${resolvedName}</span>
               <span style="font-size:0.62rem; font-weight:700; color:var(--muted); white-space:nowrap; flex-shrink:0;">✎ change</span>
             </div>
             <input type="text" class="rm-po-mat-name-input rm-po-name-search" data-idx="${idx}" value="${resolvedName}"
               placeholder="Type to search material name..."
               oninput="handleRMPONameSearch(this, ${idx})"
               autocomplete="off"
               style="display:none; font-size:0.82rem; font-weight:600; padding:4px; border:1.5px solid var(--brand); width:100%; border-radius:3px;" />
             <div id="rmpo-name-dropdown-${idx}" style="display:none; position:fixed; background:#fff; border:1px solid var(--border); border-radius:4px; z-index:9999; max-height:200px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:280px;"></div>
           </div>`;

      tbody.innerHTML += `<tr style="border-bottom:1px solid #f1f5f9; vertical-align:middle;">
    <td style="padding:6px; width:140px;">${itemCodeCellContent}</td>
    <td style="padding:6px; font-size:0.78rem; color:#64748b; word-break:break-word; width:260px;">${item.rawDescription || ""}</td>
    <td style="padding:6px; width:200px;">${nameSearchCell}</td>
    <td style="padding:6px; text-align:center; font-weight:700; font-family:monospace; width:80px;">${item.orderedQty || 0}</td>
    <td style="padding:6px; text-align:center; width:70px;">
      <input type="text" class="rm-po-unit-input" data-idx="${idx}" value="${resolvedUnit}" readonly
        placeholder="—"
        style="font-size:0.78rem; font-weight:700; padding:4px 2px; text-align:center; width:100%; border-radius:3px; border:1px solid ${resolvedUnit ? '#86efac' : '#fca5a5'}; background:${resolvedUnit ? '#f0fdf4' : '#fff7f7'}; color:${resolvedUnit ? 'var(--brand)' : '#b91c1c'};" />
    </td>
    <td style="padding:6px; text-align:right; font-family:monospace; font-size:0.82rem; width:100px;">₹${Number.isInteger(Number(item.rate||0)) ? Number(item.rate||0) : Number(item.rate||0).toFixed(2)}</td>
    <td style="padding:6px; text-align:right; font-family:monospace; font-size:0.82rem; width:120px;">₹${Number.isInteger(Number(item.amount||0)) ? Number(item.amount||0) : Number(item.amount||0).toFixed(2)}</td>
  </tr>`;
    });

    document.getElementById("rm-po-verification-zone").style.display = "block";

  } catch(e) {
    showPurchaseFeedback("rm-po-feedback", "⚠️ Parse error: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Process PO with AI";
  }
}

async function commitRawMaterialPOToBackend() {
  if (!activeParsedRMPOPayload) { showPurchaseFeedback("rm-po-feedback", "⚠️ Please process a PO document first.", "error"); return; }
  const vendorName   = (document.getElementById("rm-po-vendor-name")?.value   || "").trim();
  const uploadedBy   = appActiveOperatorIdentityString || "";
  const poNumber     = (document.getElementById("rm-po-number")?.value        || "").trim();
  const orderDate    = (document.getElementById("rm-po-order-date")?.value    || "").trim();
  const deliveryDate = (document.getElementById("rm-po-delivery-date")?.value || "").trim();
  const grandTotal   = (document.getElementById("rm-po-grand-total")?.value   || "").trim();
  const btn          = document.getElementById("rm-po-submit-btn");
  const feedback     = document.getElementById("rm-po-feedback");

  if (!vendorName) { showPurchaseFeedback("rm-po-feedback", "⚠️ Vendor Name could not be extracted from the document. Please re-process the PO.", "error"); return; }
  if (!uploadedBy) { showPurchaseFeedback("rm-po-feedback", "⚠️ Uploaded By is required.", "error"); return; }
  if (!poNumber)   { showPurchaseFeedback("rm-po-feedback", "⚠️ PO Number is required.", "error"); return; }

  // Sync current input values back into payload
  const codeInputs = document.querySelectorAll(".rm-po-item-code-input");
  const nameInputs = document.querySelectorAll(".rm-po-mat-name-input");
  const unitInputs = document.querySelectorAll(".rm-po-unit-input");
  (activeParsedRMPOPayload.lineItems || []).forEach((item, idx) => {
    item.itemCode     = codeInputs[idx] ? codeInputs[idx].value.trim() : item.itemCode;
    item.materialName = nameInputs[idx] ? nameInputs[idx].value.trim() : item.materialName;
    // Unit always comes from the Item Code catalog resolution, never the PO document itself
    item.unit         = unitInputs[idx] ? unitInputs[idx].value.trim() : item.unit;
  });

  // Validate all rows have item code, material name, AND a resolved unit — unit
  // is never typed manually, so a blank unit here means the Item Code
  // sheet's Unit column is blank for that material and needs fixing at the source.
  const incompleteRows = (activeParsedRMPOPayload.lineItems || []).reduce((acc, item, idx) => {
    const missingCode = !item.itemCode;
    const missingName = !item.materialName;
    const missingUnit = !item.unit;
    if (missingCode || missingName || missingUnit) {
      const desc = item.rawDescription || ("Row " + (idx + 1));
      const missingLabels = [];
      if (missingCode) missingLabels.push("Item Code");
      if (missingName) missingLabels.push("Standard Material Name");
      if (missingUnit) missingLabels.push("Unit (check Item Code sheet — this material's Unit column may be blank)");
      acc.push("• Row " + (idx+1) + " (" + desc.substring(0,40) + "…): missing " + missingLabels.join(" and "));
      // Highlight the offending inputs in red
      if (missingCode && codeInputs[idx]) { codeInputs[idx].style.border = "2px solid #b91c1c"; codeInputs[idx].style.background = "#fff7f7"; }
      if (missingName && nameInputs[idx]) { nameInputs[idx].style.border = "2px solid #b91c1c"; nameInputs[idx].style.background = "#fff7f7"; }
      if (missingUnit && unitInputs[idx]) { unitInputs[idx].style.border = "2px solid #b91c1c"; unitInputs[idx].style.background = "#fff7f7"; }
    }
    return acc;
  }, []);

  if (incompleteRows.length > 0) {
    const rowSummary = incompleteRows.map(r => r.replace(/^•\s*/, "")).join(" | ");
    showPurchaseFeedback("rm-po-feedback", "⚠️ Cannot submit — incomplete rows: " + rowSummary + ". Please search and select the Standard Material Name for each incomplete row.", "error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting...';
  showBlockingOverlay("Saving Purchase Order...");

  let fileBase64 = "";
  let fileName   = "";
  if (targetRMPOFileObj) {
    fileBase64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(targetRMPOFileObj); });
    fileName = targetRMPOFileObj.name;
  }

  try {
    const data = await apFetch({
      action: "uploadRawMaterialPurchaseOrder",
      activeEngineer: appActiveOperatorIdentityString,
      vendorName, uploadedBy, poNumber, orderDate, deliveryDate, grandTotal,
      lineItems: activeParsedRMPOPayload.lineItems || [],
      fileData64: fileBase64, fileName,
      mimeType: targetRMPOFileObj ? targetRMPOFileObj.type : ""
    });

    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("rm-po-upload-zone").style.display = "none";
      document.getElementById("rm-po-verification-zone").style.display = "none";
      feedback.style.cssText = "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:16px; border-radius:var(--radius); margin-bottom:12px;";
      const unmatchedWarning = (data.unmatchedCount > 0)
        ? `<br/><span style="color:#b45309; font-size:0.82rem;">⚠️ ${data.unmatchedCount} item(s) had no Item Code match and were not tracked against any PRN: <em>${data.unmatchedItems.join(", ")}</em>. Please assign item codes manually.</span>`
        : "";
      feedback.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <strong>PO uploaded successfully!</strong><br/>
            <span style="font-size:0.88rem; font-weight:600;">PO ID: <strong style="font-family:monospace;">${data.purchaseOrderId}</strong> | On Order quantities updated.</span>
            ${unmatchedWarning}
          </div>
          <button class="nav-btn-styled" onclick="
            document.getElementById('rm-po-upload-zone').style.display='block';
            document.getElementById('rm-po-feedback').style.display='none';
            resetRMPOUploadState();
          " style="background:#15803d; padding:8px 16px; font-weight:700;">+ Upload Another PO</button>
        </div>`;
    } else {
      feedback.style.cssText = "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:12px; border-radius:var(--radius); margin-bottom:12px;";
      feedback.textContent = "Failed: " + (data.error || "Unknown error.");
    }
  } catch(e) {
    hideBlockingOverlay();
    feedback.style.cssText = "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:12px; border-radius:var(--radius); margin-bottom:12px;";
    feedback.textContent = "Network error: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Submit Purchase Order";
  }
}

// ═══════════════════════════════════════════════════════
// RMPO NAME SEARCH (for unmatched rows)
// ═══════════════════════════════════════════════════════
function handleRMPONameSearch(inputEl, idx) {
  const query    = inputEl.value.trim().toLowerCase();
  const dropdown = document.getElementById("rmpo-name-dropdown-" + idx);
  const catalog  = window.itemCodeCatalogCache || [];
  if (!dropdown) return;
  if (query.length < 2) { dropdown.style.display = "none"; return; }

  // Position dropdown using fixed coordinates from input rect
  const rect = inputEl.getBoundingClientRect();
  dropdown.style.top    = (rect.bottom + 2) + "px";
  dropdown.style.left   = rect.left + "px";
  dropdown.style.width  = rect.width + "px";

  const matches = catalog.filter(c => (c.productName || "").toLowerCase().includes(query)).slice(0, 10);
  if (matches.length === 0) {
    dropdown.innerHTML = `<div style="padding:8px 10px; font-size:0.78rem; color:var(--muted); display:flex; justify-content:space-between; align-items:center;">
      <span>No match found</span>
      <a href="${window.location.pathname}?module=design-itemcode" target="_blank" style="color:var(--brand); font-weight:700; font-size:0.75rem; white-space:nowrap; margin-left:8px;">+ Create Item Code →</a>
    </div>`;
    dropdown.style.display = "block";
    return;
  }
  dropdown.innerHTML = matches.map(c => `
    <div onclick="selectRMPONameMatch(${idx}, '${c.itemCode}', '${c.productName.replace(/'/g, "\\'")}', '${(c.unit || '').replace(/'/g, "\\'")}')"
      style="padding:8px 10px; cursor:pointer; font-size:0.8rem; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;"
      onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:600;">${c.productName}</span>
      <span style="font-size:0.7rem; color:var(--muted); background:#f1f5f9; padding:2px 6px; border-radius:3px;">${c.itemCode}</span>
    </div>`).join("");
  dropdown.style.display = "block";
}

function reopenRMPONameSearch(idx) {
  const lockedBox    = document.querySelector(`.rm-po-mat-name-locked[data-idx="${idx}"]`);
  const searchInput  = document.querySelector(`.rm-po-mat-name-input.rm-po-name-search[data-idx="${idx}"]`);
  if (lockedBox)   lockedBox.style.display = "none";
  if (searchInput) { searchInput.style.display = "block"; searchInput.value = ""; searchInput.focus(); }
  // Item Code / Unit stay as-is until a new match is picked — same "no silent blanking" behavior
  // as Store Entry, so clicking away without selecting doesn't lose the original match.
}

function selectRMPONameMatch(idx, itemCode, productName, unit) {
  const dropdown   = document.getElementById("rmpo-name-dropdown-" + idx);
  const nameInput  = document.querySelector(`.rm-po-mat-name-input[data-idx="${idx}"]`);
  const codeInput  = document.querySelector(`.rm-po-item-code-input[data-idx="${idx}"]`);
  const unitInput  = document.querySelector(`.rm-po-unit-input[data-idx="${idx}"]`);
  const lockedBox  = document.querySelector(`.rm-po-mat-name-locked[data-idx="${idx}"]`);
  const lockedText = document.querySelector(`.rm-po-mat-name-locked-text[data-idx="${idx}"]`) || lockedBox?.querySelector(".rm-po-mat-name-locked-text");
  if (nameInput) { nameInput.value = productName; nameInput.style.border = "1.5px solid #86efac"; nameInput.style.background = "#f0fdf4"; nameInput.style.color = "var(--text)"; }
  if (codeInput) { codeInput.value = itemCode; codeInput.placeholder = ""; codeInput.style.border = "1.5px solid #86efac"; codeInput.style.background = "#f0fdf4"; codeInput.style.color = "var(--brand)"; }
  if (unitInput) { unitInput.value = unit || ""; unitInput.style.border = "1px solid #86efac"; unitInput.style.background = "#f0fdf4"; unitInput.style.color = "var(--brand)"; }
  if (dropdown)  dropdown.style.display = "none";
  // If this row started as a locked auto-match (has a locked-box), swap back to the locked
  // display showing the newly chosen name, instead of leaving the raw search input visible.
  if (lockedBox) {
    if (lockedText) lockedText.textContent = productName;
    if (nameInput)  nameInput.style.display = "none";
    lockedBox.style.display = "flex";
  }
  // Update the payload cache
  if (activeParsedRMPOPayload && activeParsedRMPOPayload.lineItems && activeParsedRMPOPayload.lineItems[idx]) {
    activeParsedRMPOPayload.lineItems[idx].itemCode     = itemCode;
    activeParsedRMPOPayload.lineItems[idx].materialName = productName;
    activeParsedRMPOPayload.lineItems[idx].unit         = unit || "";
  }
}

// Close RMPO dropdowns when clicking outside
document.addEventListener("click", function(e) {
  if (!e.target.classList.contains("rm-po-name-search")) {
    document.querySelectorAll("[id^='rmpo-name-dropdown-']").forEach(d => d.style.display = "none");
  }
});

