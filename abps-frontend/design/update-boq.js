let uboqSpecFiles = [];
let uboqMaterialRows = [];
let uboqCurrentDraft = null;

// Locked/readonly value box that wraps instead of clipping — a long BOQ
// ID/Project ID/Customer Name/Product Name/Product Rating no longer just
// gets cut off; the box grows taller to show the whole value. `extraStyle`
// carries the box's own visual identity (BOQ ID's monospace blue vs a
// plain locked field); accent/color values are ${}-substituted in, but
// their only inputs are hardcoded literals at each call site, never
// external/user data, so no escaping risk there.
function uboqLockedWrapField(value, extraStyle) {
  // extraStyle goes LAST so a caller can override the color:.../font-size:...
  // defaults below (e.g. Customer Name wants normal text + a larger size,
  // not the same muted/inherit look every other locked field here uses).
  return `<textarea readonly rows="1" style="padding:8px; cursor:not-allowed; border-radius:var(--radius); width:100%; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; box-sizing:border-box; border:1px solid var(--border); font-size:inherit; ${extraStyle || ''}">${(value ?? '').toString().replace(/</g, '&lt;')}</textarea>`;
}

async function toggleBOQRevisionExpansion(updateId) {
  const bodyEl = document.getElementById(`auth-boqrev-body-${updateId}`);
  if (!bodyEl) return;

  if (uboqRevExpandedId === updateId) {
    bodyEl.style.display = "none"; bodyEl.innerHTML = "";
    uboqRevExpandedId = null; return;
  }
  if (uboqRevExpandedId) {
    const prev = document.getElementById(`auth-boqrev-body-${uboqRevExpandedId}`);
    if (prev) { prev.style.display = "none"; prev.innerHTML = ""; }
  }

  uboqRevExpandedId = updateId;
  // update_id is BIGSERIAL — node-postgres serializes BIGINT/BIGSERIAL as
  // strings (not numbers) to avoid precision loss, but the onclick handler
  // passes updateId as a raw numeric literal. Strict === between "5" and 5
  // always failed, which is what "Request not found" actually meant.
  const reqItem = uboqRevList.find(r => String(r.updateId) === String(updateId));

  // Editable working copy of the PROPOSED rows.
  uboqRevRows = (reqItem.newMaterialRows || []).map(r => ({ ...r }));

  // Build a plain-text diff summary from old vs new for the reviewer.
  let summaryText = "Generating change summary...";
  bodyEl.style.display = "block";
  bodyEl.innerHTML = `
    <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:14px; margin-bottom:16px;">
      <div style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:#78350f; margin-bottom:6px;">Change Summary</div>
      <ul id="boqrev-summary-text-${updateId}" style="margin:0; padding-left:18px; font-size:0.86rem; color:#334155; line-height:1.7;"><li>${summaryText}</li></ul>
    </div>
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:16px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">BOQ Header Information</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">Project ID (locked)</label>
          ${uboqLockedWrapField(reqItem.projectId, 'background:#f1f5f9; color:var(--muted);')}
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Customer Name (locked)</label>
          ${uboqLockedWrapField(reqItem.customerName, 'background:#f1f5f9; color:var(--text); font-weight:600; font-size:1rem;')}
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">Product Name (locked)</label>
          ${uboqLockedWrapField(reqItem.productName, 'background:#f1f5f9; color:var(--muted);')}
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Product Rating (locked)</label>
          ${uboqLockedWrapField(reqItem.productRating, 'background:#f1f5f9; color:var(--muted);')}
        </div>
      </div>
      <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px;">
        <div style="position:relative;">
          <label class="field-label" style="margin-top:0;">Description of Material (optional)</label>
          <textarea id="boqrev-desc-input-${updateId}" rows="1" placeholder="Type to search or create a description..." autocomplete="off"
            oninput="handleMaterialDescriptionTypeaheadInput(this.value, 'boqrev-desc-input-${updateId}', 'boqrev-desc-dropdown-${updateId}', 'boqrev-description-id-${updateId}'); autoGrowTextField(this);"
            onkeydown="if(event.key==='Enter') event.preventDefault();"
            style="padding:8px; font-weight:600; border:1.5px solid var(--border); border-radius:var(--radius); width:100%; box-sizing:border-box; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; font-family:inherit; font-size:inherit; min-height:34px;">${(reqItem.newDescriptionOfMaterial || '').toString().replace(/</g, '&lt;')}</textarea>
          <div id="boqrev-desc-dropdown-${updateId}" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:200px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
          <input type="hidden" id="boqrev-description-id-${updateId}" value="${reqItem.newDescriptionId || ''}" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Make</label>
          <input type="text" readonly value="${(() => { const c=(window.itemCodeCatalogCache||[]).find(x=>x.productName===reqItem.productName && (x.rating||'')===(reqItem.productRating||'')); return c ? (c.make||'') : ''; })()}" style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius); width:100%; box-sizing:border-box;" placeholder="Auto-filled from Product Name" />
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">Current Manufacturing Clearance Quantity (No. of Sets) *</label>
          <input type="number" id="boqrev-order-qty-${updateId}" value="${formatQtyTrimmed(reqItem.newOrderQuantity)}" min="1" readonly
            style="padding:8px; background:#f1f5f9; color:var(--text); font-weight:600; cursor:not-allowed; border-radius:var(--radius);" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Date</label>
          <input type="text" value="${formatDateDMY(reqItem.createdAt)}" readonly style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius);" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Department (locked)</label>
          <input type="text" value="${reqItem.department || ''}" readonly style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius);" />
        </div>
      </div>
    </div>
    <div id="boqrev-rows-mount-${updateId}"></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border); padding-top:14px; margin-top:14px;">
      <button class="nav-btn-styled" onclick="rejectBOQRevision(${updateId})" style="background:#dc2626; padding:8px 20px; font-weight:700;" id="boqrev-reject-btn-${updateId}">Reject BOQ Revision</button>
      <button class="nav-btn-styled" onclick="authorizeBOQRevision(${updateId})" style="background:var(--accent); padding:8px 24px; font-weight:700;" id="boqrev-auth-btn-${updateId}">Authorize BOQ Revision</button>
    </div>
  `;
  bodyEl.querySelectorAll('textarea').forEach(autoGrowPoField);

  renderBOQRevisionRows(updateId);

  try {
    const sumData = await apFetch({
      action: "generateBOQUpdateSummary",
      boqId: reqItem.boqId,
      updatedRows: uboqRevRows,
      updatedDepartment: reqItem.department || "",
      updatedOrderQty: parseInt(reqItem.newOrderQuantity) || 0
    });
    const el = document.getElementById(`boqrev-summary-text-${updateId}`);
    if (el) el.innerHTML = renderBOQChangeBullets(sumData.changes);
  } catch (e) {
    const el = document.getElementById(`boqrev-summary-text-${updateId}`);
    if (el) el.innerHTML = "<li>Could not generate summary.</li>";
  }
}

function renderBOQChangeBullets(changes) {
  if (!changes || changes.length === 0) return "<li>No changes detected.</li>";
  return changes.map(c => {
    let s = c.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Field word right before "changed" (quantity/design rate/make/store type/description of material).
    s = s.replace(/\b(quantity|design rate|make|store type|description of material)\b(?=\s+changed\b)/i,
      `<strong style="color:var(--brand);">$1</strong>`);
    // Action verbs.
    s = s.replace(/\bchanged\b/i, `<strong style="color:var(--brand);">changed</strong>`);
    s = s.replace(/\badded\b/i, `<strong style="color:#15803d;">added</strong>`);
    s = s.replace(/\bremoved\b/i, `<strong style="color:#b91c1c;">removed</strong>`);
    // "from X to Y" — X in grey, Y highlighted. Greedy to the end of the
    // sentence (the trailing "." if present), since X/Y are numbers that
    // legitimately contain their own commas (e.g. "9,83,086.00") — a
    // non-greedy match with comma as a stop character cut off there.
    s = s.replace(/from (.+) to (.+?)\.?$/i,
      (m, from, to) => `from <span style="color:#64748b;">${from}</span> to <span style="font-weight:700; color:#b45309;">${to}</span>.`);
    // "with quantity X" — X highlighted (the "added" case).
    s = s.replace(/with quantity (.+?)\.?$/i,
      (m, q) => `with quantity <span style="font-weight:700; color:#b45309;">${q}</span>.`);
    return `<li>${s}</li>`;
  }).join("");
}

// Renders the editable proposed-rows table — now byte-for-byte the same
// column set, locked Item Code/Unit, and search-typeahead Description of
// Material as Create/Authorize/Update BOQ's own material-rows tables
// (see renderEBOQMaterialRows), instead of the simplified free-text
// version this used to be.
function updateBOQRevisionTotalsOnly(updateId) {
  const totalPerSet = uboqRevRows.reduce((sum, row) => {
    return sum + ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0));
  }, 0);
  const orderQtyEl = document.getElementById(`boqrev-order-qty-${updateId}`);
  const orderQty = parseInt(orderQtyEl?.value) || 0;
  const totalCost = totalPerSet * orderQty;
  const perSetEl = document.getElementById(`boqrev-total-per-set-${updateId}`);
  const totalEl  = document.getElementById(`boqrev-total-cost-${updateId}`);
  if (perSetEl) perSetEl.textContent = "₹" + totalPerSet.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (totalEl)  totalEl.textContent  = "₹" + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function renderBOQRevisionRows(updateId) {
  const mount = document.getElementById(`boqrev-rows-mount-${updateId}`);
  if (!mount) return;

  const totalPerSet = uboqRevRows.reduce((sum, row) => {
    return sum + ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0));
  }, 0);
  const orderQtyEl = document.getElementById(`boqrev-order-qty-${updateId}`);
  const orderQty = parseInt(orderQtyEl?.value) || 0;
  const totalCost = totalPerSet * orderQty;

  const rowsHtml = uboqRevRows.length === 0
    ? `<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--muted); font-size:0.82rem;">No material rows. Click "+ Add Row".</td></tr>`
    : uboqRevRows.map((row, idx) => {
        const isRawMaterial = row.typeOfStore !== "Spare Store";
        const isFgRow = row.typeOfStore === "Finished Goods Store";
        const totalMaterialRate = isRawMaterial ? ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0)) : 0;
        return `
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="text-align:center; padding:6px; font-weight:700; color:var(--muted);">${idx + 1}</td>
      <td style="padding:4px;">
        <select onchange="uboqRevRows[${idx}].typeOfStore=this.value; renderBOQRevisionRows(${updateId});" style="padding:4px; font-size:0.8rem; width:100%;">
          <option value="Raw Materials Store" ${row.typeOfStore==="Raw Materials Store"?"selected":""}>Raw Material</option>
          <option value="Finished Goods Store" ${row.typeOfStore==="Finished Goods Store"?"selected":""}>Finished Goods</option>
        </select>
      </td>
      <td style="padding:4px; position:relative;">
        <textarea rows="1" placeholder="Type to search..." autocomplete="off"
          oninput="handleBOQRowMaterialSearch(this.value, ${idx}, 'boqrev'); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
          onfocus="handleBOQRowMaterialSearch(this.value, ${idx}, 'boqrev'); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
          style="padding:5px; font-size:0.82rem; width:100%; border:1px solid var(--border); border-radius:3px; resize:none; overflow:hidden; font-family:inherit; line-height:1.3; display:block;"
        >${boqRowMaterialDisplayText(row)}</textarea>
        <div id="boqrev-mat-dropdown-${idx}" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:6px; overflow-y:auto; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.18); min-width:320px;"></div>
      </td>
      <td style="padding:4px;">
        <input type="text" value="${row.itemCode || ""}" readonly
          style="padding:5px; font-size:0.78rem; font-family:monospace; font-weight:700; background:#e0f2fe; color:var(--brand); cursor:not-allowed; border-radius:3px; border:1px solid #bae6fd; width:100%;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="number" value="${row.quantityFor1Set || ""}" min="0" placeholder="0"
          oninput="uboqRevRows[${idx}].quantityFor1Set=parseFloat(this.value)||0; const r=document.getElementById('boqrev-rate-${idx}'); if(r) { const v=uboqRevRows[${idx}].quantityFor1Set*(Number(uboqRevRows[${idx}].designRatePerQuantity)||0); r.value=v.toLocaleString('en-IN',{maximumFractionDigits:2}); } updateBOQRevisionTotalsOnly(${updateId}); recomputeBOQRevisionSummary(${updateId});"
          style="padding:5px; font-size:0.85rem; text-align:center; width:100%; border:1px solid var(--border); border-radius:3px;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="text" value="${row.unit || "—"}" readonly
          style="padding:4px; font-size:0.8rem; width:100%; background:#f1f5f9; color:var(--text); font-weight:600; cursor:not-allowed; text-align:center; border-radius:3px; border:1px solid var(--border);" />
      </td>
      <td style="padding:4px;">
        <input type="number" class="boq-center-num" value="${row.designRatePerQuantity || ""}" min="0" placeholder="0.00"
          oninput="uboqRevRows[${idx}].designRatePerQuantity=parseFloat(this.value)||0; const r=document.getElementById('boqrev-rate-${idx}'); if(r) { const v=(Number(uboqRevRows[${idx}].quantityFor1Set)||0)*(Number(uboqRevRows[${idx}].designRatePerQuantity)||0); r.value=v.toLocaleString('en-IN',{maximumFractionDigits:2}); } updateBOQRevisionTotalsOnly(${updateId}); recomputeBOQRevisionSummary(${updateId});"
          ${isFgRow ? `title="Provisional — replaced automatically when this Finished Goods material's own BOQ is authorized" style="padding:5px; font-size:0.85rem; width:100%; border:1.5px solid #f59e0b; background:#fffbeb; border-radius:3px;"` : `style="padding:5px; font-size:0.85rem; width:100%; border:1px solid var(--border); border-radius:3px;"`} />
      </td>
      <td style="padding:4px;">
        <input type="text" id="boqrev-rate-${idx}" value="${isRawMaterial ? totalMaterialRate.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}" readonly
          style="padding:5px; font-size:0.85rem; font-weight:700; text-align:center; width:100%; background:#f0fdf4; color:var(--accent); cursor:not-allowed; border-radius:3px; border:1px solid #86efac;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <button onclick="uboqRevRows.splice(${idx},1); renderBOQRevisionRows(${updateId}); recomputeBOQRevisionSummary(${updateId});" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:3px 8px; border-radius:3px; cursor:pointer; font-size:0.75rem; font-weight:700;">✕</button>
      </td>
    </tr>${isFgRow ? `
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td></td>
      <td colspan="8" style="padding:4px 4px 8px 4px; position:relative;">
        <label style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; display:block; margin-bottom:3px;">Description of Material (optional, for this Finished Goods row)</label>
        <input type="text" id="boqrev-row-desc-${idx}" value="${row.descriptionOfMaterial || ""}" placeholder="Type to search or create a description..." autocomplete="off"
          oninput="handleMaterialDescriptionTypeaheadInput(this.value, 'boqrev-row-desc-${idx}', 'boqrev-row-desc-dropdown-${idx}', 'boqrev-row-desc-id-${idx}', 'boqRowDescOnSelect', 'boqrev:${idx}'); uboqRevRows[${idx}].descriptionOfMaterial=this.value; uboqRevRows[${idx}].descriptionId=null;"
          style="padding:6px; font-size:0.82rem; width:60%; border:1px solid var(--border); border-radius:3px;" />
        <div id="boqrev-row-desc-dropdown-${idx}" style="display:none; position:absolute; background:#fff; border:1.5px solid var(--brand); border-radius:6px; overflow-y:auto; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.18); min-width:280px;"></div>
        <input type="hidden" id="boqrev-row-desc-id-${idx}" value="${row.descriptionId || ""}" />
      </td>
    </tr>` : ''}`;
      }).join("");

  mount.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand);">Material Rows *</div>
      <button onclick="uboqRevRows.push({typeOfStore:'Raw Materials Store',materialName:'',itemCode:'',make:'',quantityFor1Set:'',unit:'NOS',designRatePerQuantity:''}); renderBOQRevisionRows(${updateId});" style="background:var(--accent); color:#fff; border:none; border-radius:4px; padding:5px 12px; font-size:0.78rem; font-weight:700; cursor:pointer;">+ Add Row</button>
    </div>
    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
      <table class="store-basket-data-table" style="width:100%; min-width:1050px; border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="width:40px; text-align:center; padding:8px; font-size:0.7rem;">Sr No</th>
            <th style="width:110px; padding:8px; font-size:0.7rem;">Type of Store *</th>
            <th style="width:350px; padding:8px; font-size:0.7rem;">Material Name *</th>
            <th style="width:80px; padding:8px; font-size:0.7rem;">Item Code</th>
            <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Qty / Set *</th>
            <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Unit *</th>
            <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Design Rate / Qty</th>
            <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Total Material Cost / Set</th>
            <th style="width:40px; padding:8px; font-size:0.7rem; text-align:center;">Del</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div style="border:1px solid var(--border); border-radius:var(--radius); padding:14px; margin-top:14px; display:flex; justify-content:flex-end; gap:32px;">
      <div style="text-align:right;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:var(--muted);">Total BOQ Cost Per Set</div>
        <div id="boqrev-total-per-set-${updateId}" style="font-size:1.1rem; font-weight:800; color:var(--accent);">₹${totalPerSet.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:var(--muted);">Total BOQ Cost</div>
        <div id="boqrev-total-cost-${updateId}" style="font-size:1.1rem; font-weight:800; color:var(--accent);">₹${totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
      </div>
    </div>
  `;
  mount.querySelectorAll("textarea").forEach(ta => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  });
}

// Debounced-ish live re-diff as the authorizer edits, so the summary
// reflects THEIR edits, not just the original proposal.
let _boqRevSummaryTimer = null;
function recomputeBOQRevisionSummary(updateId) {
  clearTimeout(_boqRevSummaryTimer);
  _boqRevSummaryTimer = setTimeout(async () => {
    const reqItem = uboqRevList.find(r => String(r.updateId) === String(updateId));
    if (!reqItem) return;
    try {
      const sumData = await apFetch({
        action: "generateBOQUpdateSummary",
        boqId: reqItem.boqId, updatedRows: uboqRevRows,
        updatedDepartment: reqItem.department || "",
        updatedOrderQty: parseInt(reqItem.newOrderQuantity) || 0
      });
      const el = document.getElementById(`boqrev-summary-text-${updateId}`);
      if (el) el.innerHTML = renderBOQChangeBullets(sumData.changes);
    } catch (_) {}
  }, 600);
}

async function initializeUpdateBOQPanel() {
  eboqMode = "";
  uboqCurrentDraft = null;
  uboqMaterialRows = [];

  // Reset DOM immediately — before any async calls. projDrop previously
  // looked up "update-boq-project", an id that doesn't exist anywhere in
  // index.html (the real field is the shared typeahead input
  // "update-boq-project-ta-input") — every block guarded by `if (projDrop)`
  // silently no-op'd, so re-entering this panel never cleared the
  // previously typed/selected Project ID, never refreshed
  // sharedActiveProjectCodes/sharedProjectMeta, and the screen looked
  // "stuck" on whatever was there the first time instead of starting fresh.
  const selectorZone = document.getElementById("update-boq-selector-zone");
  const projInput    = document.getElementById("update-boq-project-ta-input");
  const projDropdown = document.getElementById("update-boq-project-ta-dropdown");
  const boqDrop      = document.getElementById("update-boq-select");
  const formEl       = document.getElementById("update-boq-form");
  const fbEl         = document.getElementById("update-boq-feedback");

  if (selectorZone) { selectorZone.style.display = "grid"; selectorZone.style.gridTemplateColumns = "1fr 2fr"; }
  if (projInput)  { projInput.value = ""; projInput.placeholder = "Type Project ID or Customer Name..."; }
  if (projDropdown) projDropdown.style.display = "none";
  if (boqDrop)  { boqDrop.innerHTML   = '<option value="">— Select Project First —</option>'; boqDrop.disabled = true; }
  if (formEl)     formEl.style.display  = "none";
  if (fbEl)     { fbEl.style.display    = "none"; fbEl.innerHTML = ""; }

  await loadItemCodeCatalogIntoCache().catch(() => {});
  await loadMaterialDescriptionsIntoCache().catch(() => {});
  try {
    const data = await apFetch({ action:"pullLiveActiveProjectCodes", statusFilter: "Active" });
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
    window.uboqProjectMeta = data.projectMeta || {};
  } catch(e) {
    if (projInput) projInput.placeholder = "Error loading projects";
  }
}

async function handleUpdateBOQStatusChange(selectedStatus) {
  const projDrop = document.getElementById("update-boq-project-ta-input");
  const boqDrop  = document.getElementById("update-boq-select");
  const formEl   = document.getElementById("update-boq-form");

  if (projDrop) projDrop.innerHTML = '<option value="">Loading...</option>';
  if (boqDrop)  { boqDrop.innerHTML = '<option value="">— Select Project First —</option>'; boqDrop.disabled = true; }
  if (formEl)   formEl.style.display = "none";

  try {
    const data = await apFetch({ action:"pullLiveActiveProjectCodes", statusFilter: selectedStatus });
    if (projDrop) {
      window.sharedActiveProjectCodes = data.projects || [];
      window.sharedProjectMeta = data.projectMeta || {};
      projDrop.value = "";
      projDrop.placeholder = (data.projects || []).length === 0 ? `No projects with status: ${selectedStatus}` : "Type Project ID or Customer Name...";
    }
    window.uboqProjectMeta = data.projectMeta || {};
  } catch(e) {
    if (projDrop) projDrop.placeholder = "Error loading projects";
  }
}

async function loadAuthorizedBOQsForProject(projectId) {
  const boqDrop = document.getElementById("update-boq-select");
  document.getElementById("update-boq-form").style.display = "none";
  if (!projectId) { boqDrop.innerHTML = '<option value="">— Select Project First —</option>'; boqDrop.disabled = true; return; }

  boqDrop.innerHTML = '<option value="">Loading...</option>';
  boqDrop.disabled  = true;

  try {
    const data = await apFetch({ action:"fetchAuthorizedBOQsForUpdate", projectId });
    boqDrop.innerHTML = '<option value="">— Select BOQ —</option>';
    window.uboqDraftsMeta = {};
    (data.drafts || []).forEach(draft => {
      const opt = document.createElement("option");
      opt.value = draft.boqId;
      const pendingTag = draft.hasPendingRevision ? " — REVISION PENDING AUTHORIZATION" : "";
      opt.textContent = `${draft.productName || ""}${draft.productRating ? " " + draft.productRating : ""} | ${draft.department}${pendingTag}`;
      window.uboqDraftsMeta[draft.boqId] = draft;
      boqDrop.appendChild(opt);
    });
    boqDrop.disabled = false;
  } catch(e) {
    boqDrop.innerHTML = '<option value="">Error loading BOQs</option>';
  }
}

async function loadBOQForUpdate(boqId) {
  const formEl = document.getElementById("update-boq-form");
  const fbEl   = document.getElementById("update-boq-feedback");
  if (!boqId) { if (formEl) formEl.style.display = "none"; return; }
  const meta = (window.uboqDraftsMeta || {})[boqId];
  if (meta && meta.hasPendingRevision) {
    if (formEl) formEl.style.display = "none";
    if (fbEl) {
      fbEl.style.display = "block";
      fbEl.style.cssText = "display:block; background:#fffbeb; border-left:4px solid #b45309; color:#78350f; padding:12px; margin-bottom:12px; border-radius:var(--radius);";
      fbEl.innerHTML = "This BOQ has already been submitted for revision and is waiting for authorization.";
    }
    return;
  }
  if (fbEl) fbEl.style.display = "none";

  if (formEl) { formEl.style.display = "block"; formEl.innerHTML = '<div style="padding:20px; text-align:center; color:var(--muted);"><div class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--brand);border-radius:50%;animation:spin 0.8s linear infinite;margin-right:8px;vertical-align:middle;"></div>Loading BOQ...</div>'; }

  const data = await apFetch({ action:"fetchBOQDraftById", boqId });
  if (!data.success) return showBOQBanner("update-boq-feedback", data.error, "error");

  uboqCurrentDraft = data.draft;
  uboqMaterialRows = (data.draft.materialRows || []).map(r => ({ ...r }));
  uboqSpecFiles    = [];

  renderUBOQForm();
  document.getElementById("update-boq-form").style.display = "block";
}

function renderUBOQForm() {
  const draft     = uboqCurrentDraft;
  const container = document.getElementById("update-boq-form");
  container.innerHTML = `
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:16px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">BOQ Header</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">BOQ ID</label>
          ${uboqLockedWrapField(draft.boqId, 'font-family:monospace; font-weight:800; background:#e0f2fe; color:var(--brand);')}
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Prepared By (locked)</label>
          <input type="text" value="${draft.preparedBy}" readonly style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius);" />
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">Project ID (locked)</label>
          ${uboqLockedWrapField(draft.projectId, 'background:#f1f5f9; color:var(--muted);')}
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Customer Name (locked)</label>
          ${uboqLockedWrapField(draft.customerName, 'background:#f1f5f9; color:var(--text); font-weight:600; font-size:1rem;')}
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">Product Name (locked)</label>
          <textarea id="uboq-product-name" readonly rows="1" style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius); width:100%; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; box-sizing:border-box; border:1px solid var(--border); font-size:inherit;">${(draft.productName || '').toString().replace(/</g, '&lt;')}</textarea>
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Product Rating (locked)</label>
          <textarea id="uboq-product-rating" readonly rows="1" style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius); width:100%; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; box-sizing:border-box; border:1px solid var(--border); font-size:inherit;">${(draft.productRating || '').toString().replace(/</g, '&lt;')}</textarea>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px;">
        <div style="position:relative;">
          <label class="field-label" style="margin-top:0;">Description of Material (optional)</label>
          <textarea id="uboq-desc-input" rows="1" placeholder="Type to search or create a description..." autocomplete="off"
            oninput="handleMaterialDescriptionTypeaheadInput(this.value, 'uboq-desc-input', 'uboq-desc-dropdown', 'uboq-description-id'); autoGrowTextField(this);"
            onkeydown="if(event.key==='Enter') event.preventDefault();"
            style="padding:8px; font-weight:600; border:1.5px solid var(--border); border-radius:var(--radius); width:100%; box-sizing:border-box; resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word; line-height:1.4; font-family:inherit; font-size:inherit; min-height:34px;">${(draft.descriptionOfMaterial || '').toString().replace(/</g, '&lt;')}</textarea>
          <div id="uboq-desc-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:200px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
          <input type="hidden" id="uboq-description-id" value="${draft.descriptionId || ''}" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Make</label>
          <input type="text" id="uboq-header-make" readonly value="${(() => { const c=(window.itemCodeCatalogCache||[]).find(x=>x.productName===draft.productName && (x.rating||'')===(draft.productRating||'')); return c ? (c.make||'') : ''; })()}" style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius); width:100%; box-sizing:border-box;" placeholder="Auto-filled from Product Name" />
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="field-label" style="margin-top:0;">Current Manufacturing Clearance Quantity (No. of Sets) *</label>
          <input type="number" id="uboq-order-qty" value="${Math.round(Number(draft.orderQuantity) || 0)}" min="1" readonly style="padding:8px; background:#f1f5f9; color:var(--text); font-weight:600; cursor:not-allowed; border-radius:var(--radius);" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Date</label>
          <input type="text" value="${formatDateDMY(draft.date)}" readonly style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius);" />
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Department (locked)</label>
          <input type="text" id="uboq-department" value="${draft.department}" readonly style="padding:8px; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:var(--radius);" />
        </div>
      </div>
    </div>

    <!-- Material Rows -->
    <div style="margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand);">Material Rows *</span>
        <button class="nav-btn-styled" onclick="addUBOQMaterialRow()" style="background:var(--accent); padding:5px 14px; font-size:0.78rem;">+ Add Row</button>
      </div>
      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
        <table class="store-basket-data-table" style="width:100%; min-width:1050px; border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="width:40px; text-align:center; padding:8px; font-size:0.7rem;">Sr No</th>
              <th style="width:110px; padding:8px; font-size:0.7rem;">Type of Store *</th>
              <th style="width:350px; padding:8px; font-size:0.7rem;">Material Name *</th>
              <th style="width:80px; padding:8px; font-size:0.7rem;">Item Code</th>
              <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Qty / Set *</th>
              <th style="width:80px; padding:8px; font-size:0.7rem; text-align:center;">Unit *</th>
              <th style="width:90px; padding:8px; font-size:0.7rem; text-align:center;">Design Rate / Qty</th>
              <th style="width:90px; padding:8px; font-size:0.7rem; text-align:center;">Total Material Cost / Set</th>
              <th style="width:40px; padding:8px; font-size:0.7rem; text-align:center;">Del</th>
            </tr>
          </thead>
          <tbody id="uboq-material-rows-body"></tbody>
        </table>
      </div>
    </div>

    <div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:var(--radius); padding:14px; margin-bottom:16px; display:flex; justify-content:flex-end; gap:32px;">
      <div style="text-align:right;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:var(--muted);">Total BOQ Cost Per Set</div>
        <div id="uboq-total-per-set" style="font-size:1.1rem; font-weight:800; color:var(--accent);">₹0.00</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:var(--muted);">Total BOQ Cost</div>
        <div id="uboq-total-cost" style="font-size:1.1rem; font-weight:800; color:var(--accent);">₹0.00</div>
      </div>
    </div>

    <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border); padding-top:14px;">
      <button class="nav-btn-styled" onclick="submitUpdateBOQ()" style="background:var(--accent); padding:8px 24px; font-weight:700;" id="uboq-submit-btn">Submit BOQ Revision for Authorization</button>
    </div>
  `;
  container.querySelectorAll('textarea').forEach(autoGrowPoField);

  renderUBOQMaterialRows();
}

function addUBOQMaterialRow() {
  uboqMaterialRows.push({ typeOfStore:"Raw Materials Store", materialName:"", itemCode:"", make:"", quantityFor1Set:"", unit:"", designRatePerQuantity:"" });
  renderUBOQMaterialRows();
}

function deleteUBOQMaterialRow(idx) {
  uboqMaterialRows.splice(idx, 1);
  renderUBOQMaterialRows();
}

function renderUBOQMaterialRows() {
  const tbody = document.getElementById("uboq-material-rows-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (uboqMaterialRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--muted); font-size:0.82rem;">No material rows. Click "+ Add Row".</td></tr>';
    updateUBOQTotals();
    return;
  }
  uboqMaterialRows.forEach((row, idx) => {
    const isRawMaterial = row.typeOfStore !== "Spare Store";
    const isFgRow = row.typeOfStore === "Finished Goods Store";
    const totalMaterialRate = isRawMaterial ? ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0)) : 0;
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #f1f5f9";
    tr.innerHTML = `
      <td style="text-align:center; padding:6px; font-weight:700; color:var(--muted);">${idx + 1}</td>
      <td style="padding:4px;">
        <select onchange="uboqMaterialRows[${idx}].typeOfStore=this.value; renderUBOQMaterialRows();" style="padding:4px; font-size:0.8rem; width:100%;">
          <option value="Raw Materials Store" ${row.typeOfStore==="Raw Materials Store"?"selected":""}>Raw Material</option>
          <option value="Finished Goods Store" ${row.typeOfStore==="Finished Goods Store"?"selected":""}>Finished Goods</option>
        </select>
      </td>
      <td style="padding:4px; position:relative;">
        <textarea rows="1" placeholder="Type to search..." autocomplete="off"
          oninput="handleBOQRowMaterialSearch(this.value, ${idx}, 'uboq'); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
          onfocus="handleBOQRowMaterialSearch(this.value, ${idx}, 'uboq'); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
          style="padding:5px; font-size:0.82rem; width:100%; border:1px solid var(--border); border-radius:3px; resize:none; overflow:hidden; font-family:inherit; line-height:1.3; display:block;"
        >${boqRowMaterialDisplayText(row)}</textarea>
        <div id="uboq-mat-dropdown-${idx}" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:6px; overflow-y:auto; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.18); min-width:320px;"></div>
      </td>
      <td style="padding:4px;">
        <input type="text" value="${row.itemCode || ""}" readonly
          style="padding:5px; font-size:0.78rem; font-family:monospace; font-weight:700; background:#e0f2fe; color:var(--brand); cursor:not-allowed; border-radius:3px; border:1px solid #bae6fd; width:100%;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="number" value="${row.quantityFor1Set || ""}" min="0" placeholder="0"
          oninput="uboqMaterialRows[${idx}].quantityFor1Set=parseFloat(this.value)||0; updateUBOQTotals(); const r=document.getElementById('uboq-rate-${idx}'); if(r) { const v=uboqMaterialRows[${idx}].quantityFor1Set*(Number(uboqMaterialRows[${idx}].designRatePerQuantity)||0); r.value=v.toLocaleString('en-IN',{maximumFractionDigits:2}); }"
          style="padding:5px; font-size:0.85rem; text-align:center; width:100%; border:1px solid var(--border); border-radius:3px;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="text" value="${row.unit || "—"}" readonly
          style="padding:4px; font-size:0.8rem; width:100%; background:#f1f5f9; color:var(--text); font-weight:600; cursor:not-allowed; text-align:center; border-radius:3px; border:1px solid var(--border);" />
      </td>
      <td style="padding:4px; text-align:center;">
        ${isRawMaterial ? `
        <input type="number" value="${row.designRatePerQuantity || ""}" min="0" step="0.01" placeholder="0.00"
          oninput="uboqMaterialRows[${idx}].designRatePerQuantity=parseFloat(this.value)||0; updateUBOQTotals(); const r=document.getElementById('uboq-rate-${idx}'); if(r) { const v=(Number(uboqMaterialRows[${idx}].quantityFor1Set)||0)*(parseFloat(this.value)||0); r.value=v.toLocaleString('en-IN',{maximumFractionDigits:2}); }"
          ${isFgRow ? `title="Provisional — replaced automatically when this Finished Goods material's own BOQ is authorized" style="padding:5px; font-size:0.85rem; text-align:center; width:100%; border:1.5px solid #f59e0b; background:#fffbeb; border-radius:3px;"` : `style="padding:5px; font-size:0.85rem; text-align:center; width:100%; border:1px solid var(--border); border-radius:3px;"`} />
        ` : `<input type="text" value="—" readonly style="padding:5px; font-size:0.85rem; text-align:center; width:100%; background:#f1f5f9; color:var(--muted); cursor:not-allowed; border-radius:3px; border:1px solid var(--border);" />`}
      </td>
      <td style="padding:4px; text-align:center;">
        <input type="text" id="uboq-rate-${idx}" value="${isRawMaterial ? totalMaterialRate.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}" readonly
          style="padding:5px; font-size:0.85rem; font-weight:700; text-align:center; width:100%; background:#f0fdf4; color:var(--accent); cursor:not-allowed; border-radius:3px; border:1px solid #86efac;" />
      </td>
      <td style="padding:4px; text-align:center;">
        <button onclick="deleteUBOQMaterialRow(${idx})" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:3px 8px; border-radius:3px; cursor:pointer; font-size:0.75rem; font-weight:700;">✕</button>
      </td>`;
    tbody.appendChild(tr);

    if (isFgRow) {
      const descTr = document.createElement("tr");
      descTr.style.borderBottom = "1px solid #f1f5f9";
      descTr.innerHTML = `
        <td></td>
        <td colspan="8" style="padding:4px 4px 8px 4px; position:relative;">
          <label style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; display:block; margin-bottom:3px;">Description of Material (optional, for this Finished Goods row)${row.descriptionLocked ? ' — locked: this item already has its own Authorized BOQ' : ''}</label>
          ${row.descriptionLocked ? `
          <input type="text" value="${row.descriptionOfMaterial || ""}" readonly title="Revise this item's own BOQ instead — this parent will auto-update." style="padding:6px; font-size:0.82rem; width:60%; border:1px solid var(--border); border-radius:3px; background:#f1f5f9; color:var(--muted); cursor:not-allowed;" />
          ` : `
          <input type="text" id="uboq-row-desc-${idx}" value="${row.descriptionOfMaterial || ""}" placeholder="Type to search or create a description..." autocomplete="off"
            oninput="handleMaterialDescriptionTypeaheadInput(this.value, 'uboq-row-desc-${idx}', 'uboq-row-desc-dropdown-${idx}', 'uboq-row-desc-id-${idx}', 'boqRowDescOnSelect', 'uboq:${idx}'); uboqMaterialRows[${idx}].descriptionOfMaterial=this.value; uboqMaterialRows[${idx}].descriptionId=null;"
            style="padding:6px; font-size:0.82rem; width:60%; border:1px solid var(--border); border-radius:3px;" />
          <div id="uboq-row-desc-dropdown-${idx}" style="display:none; position:absolute; background:#fff; border:1.5px solid var(--brand); border-radius:6px; overflow-y:auto; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.18); min-width:280px;"></div>
          <input type="hidden" id="uboq-row-desc-id-${idx}" value="${row.descriptionId || ""}" />
          `}
        </td>`;
      tbody.appendChild(descTr);
    }
  });

  tbody.querySelectorAll("textarea").forEach(ta => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  });

  updateUBOQTotals();
}

function updateUBOQTotals() {
  const totalPerSet = uboqMaterialRows.reduce((sum, row) => {
    return sum + ((Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0));
  }, 0);
  const orderQty = parseInt(document.getElementById("uboq-order-qty")?.value) || 0;
  const totalCost = totalPerSet * orderQty;

  const perSetEl = document.getElementById("uboq-total-per-set");
  const totalEl  = document.getElementById("uboq-total-cost");
  if (perSetEl) perSetEl.textContent = "₹" + totalPerSet.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (totalEl)  totalEl.textContent  = "₹" + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Add uboq to selectBOQRowMaterial
// Find existing selectBOQRowMaterial and add uboq branch:
function selectBOQRowMaterial(rowIdx, productName, itemCode, formPrefix) {
  const rowsMap = { cboq: cboqMaterialRows, eboq: eboqMaterialRows, uboq: uboqMaterialRows, boqrev: uboqRevRows };
  const renderMap = { cboq: renderCBOQMaterialRows, eboq: renderEBOQMaterialRows, uboq: renderUBOQMaterialRows, boqrev: () => renderBOQRevisionRows(uboqRevExpandedId) };
  const feedbackMap = { cboq: "create-boq-feedback", eboq: "auth-boq-feedback", uboq: "update-boq-feedback", boqrev: "auth-boq-upd-feedback" };

  const rows = rowsMap[formPrefix];
  if (rows) {
    // Check for duplicate item code in same store type
    const thisStoreType = rows[rowIdx].typeOfStore;
    const duplicate = rows.find((r, i) =>
      i !== rowIdx && r.itemCode === itemCode && r.typeOfStore === thisStoreType
    );
    if (duplicate) {
      showBOQBanner(feedbackMap[formPrefix],
        `⚠️ "${productName}" (${itemCode}) is already added in row ${rows.indexOf(duplicate) + 1} with the same store type. Consider updating that row's quantity instead.`,
        "error");
      const dropdown = document.getElementById(formPrefix + "-mat-dropdown-" + rowIdx);
      if (dropdown) dropdown.style.display = "none";
      return; // Block the selection
    }
    rows[rowIdx].materialName = productName;
    rows[rowIdx].itemCode = itemCode;
    // Auto-fill unit + Make from catalog cache — Make is now locked to
    // whatever's on the Item Code (18 Aug 2026), never freely typed per row.
    const catalogEntry = (window.itemCodeCatalogCache || []).find(c => c.itemCode === itemCode);
    if (catalogEntry && catalogEntry.unit) {
      rows[rowIdx].unit = catalogEntry.unit;
    }
    rows[rowIdx].make = (catalogEntry && catalogEntry.make) || "";
    renderMap[formPrefix]();
  }

  const dropdown = document.getElementById(formPrefix + "-mat-dropdown-" + rowIdx);
  if (dropdown) dropdown.style.display = "none";
}

let _submitUpdateBOQInProgress = false;
async function submitUpdateBOQ() {
  if (_submitUpdateBOQInProgress) return;
  _submitUpdateBOQInProgress = true;
  const btn      = document.getElementById("uboq-submit-btn");
  const feedbackId = "update-boq-feedback";

  const productName  = document.getElementById("uboq-product-name")?.value.trim() || "";
  const productRating= document.getElementById("uboq-product-rating")?.value.trim() || "";
  const department   = document.getElementById("uboq-department")?.value.trim() || "";
  const orderQty     = parseInt(document.getElementById("uboq-order-qty")?.value) || 0;
  const descriptionOfMaterial = document.getElementById("uboq-desc-input")?.value.trim() || null;
  const descriptionIdRaw = document.getElementById("uboq-description-id")?.value.trim() || "";
  const descriptionId = descriptionIdRaw ? parseInt(descriptionIdRaw) : null;

  const _uValidationFail = (msg) => { _submitUpdateBOQInProgress = false; showBOQBanner(feedbackId, msg, "error"); };

  if (!productName)   { _uValidationFail("⚠️ Product Name is required."); return; }
  if (!productRating) { _uValidationFail("⚠️ Product Rating is required."); return; }
  if (!department)    { _uValidationFail("⚠️ Department is required."); return; }
  if (orderQty < 1)   { _uValidationFail("⚠️ Order Quantity must be at least 1."); return; }
  if (uboqMaterialRows.length === 0) { _uValidationFail("⚠️ At least one material row is required."); return; }

  const invalidRow = uboqMaterialRows.find(r => !r.materialName || !r.quantityFor1Set);
  if (invalidRow) { _uValidationFail("⚠️ All rows must have Description and Quantity."); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting...';
  showBlockingOverlay("Saving Bill of Quantity Revision...");

  try {
    const data = await apFetch({
      action: "submitBOQUpdate",
      boqId: uboqCurrentDraft.boqId,
      newMaterialRows: uboqMaterialRows,
      newOrderQuantity: orderQty,
      descriptionId, descriptionOfMaterial
    });
    hideBlockingOverlay();

    if (data.success) {
      const _lastDraft = uboqCurrentDraft;
      uboqCurrentDraft = null;
      uboqMaterialRows = [];
      const formEl = document.getElementById("update-boq-form");
      if (formEl) formEl.style.display = "none";

      const selectorZone = document.getElementById("update-boq-selector-zone");
      if (selectorZone) selectorZone.style.display = "none";

      const fb = document.getElementById(feedbackId);
      if (fb) {
        fb.style.borderLeftColor = "var(--accent)";
        fb.style.background      = "#f0fff4";
        fb.style.color           = "#276749";
        fb.style.display         = "block";
        fb.innerHTML = `
          <div style="font-size:0.85rem; font-weight:800; margin-bottom:10px;">✅ Bill of Quantity Revision Submitted for Re-Authorization!</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; font-size:0.8rem; margin-bottom:14px;">
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">BOQ ID</span><span style="font-family:monospace; font-weight:800;">${_lastDraft?.boqId || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Status</span><span style="font-weight:700;">Awaiting Authorization</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Project ID</span><span style="font-weight:700;">${_lastDraft?.projectId || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Customer</span><span style="font-weight:700;">${_lastDraft?.customerName || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Name</span><span style="font-weight:700;">${_lastDraft?.productName || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product Rating</span><span style="font-weight:700;">${_lastDraft?.productRating || ""}</span></div>
          </div>
          <button onclick="const sz=document.getElementById('update-boq-selector-zone'); if(sz) sz.style.display='grid'; initializeUpdateBOQPanel().catch(()=>{});"
            style="background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">
            + Revise Another Bill of Quantity
          </button>`;
      }
    } else {
      showBOQBanner(feedbackId, data.error || "Revision submission failed.", "error");
    }
  } catch(e) {
    hideBlockingOverlay();
    showBOQBanner(feedbackId, "Network error: " + e.message, "error");
  } finally {
    _submitUpdateBOQInProgress = false;
    btn.disabled = false;
    btn.textContent = "Submit BOQ Revision for Authorization";
  }
}

// ═══════════════════════════════════════════════════════
// JOB CARD LETTERHEAD
// ═══════════════════════════════════════════════════════

let jclhWorkspaceInitInProgress = false;
let jclhAllJobCardsForProject = []; // cache: full job-card list for the selected project
let jclhSubmitInProgress = false;

