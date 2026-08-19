let mcCurrentStatus = "Inactive";
// Per-project line-item state for the expanded Active-tab cards, keyed by
// projectId, then by lineId — holds the editable row values between
// re-renders (typeahead selection, New MFC Quantity) so a caret toggle or
// a submit-triggered reload doesn't lose in-progress edits.
let mcLineItemState = {};
// Per-project gating-field state (the 4 fields shown once above the
// table) — keyed by projectId. Mirrors what's persisted on
// project.projects; each field auto-saves individually on change so a
// user can fill one today and the rest tomorrow (migration 113).
let mcGatingState = {};
// Per-project, per-line ORIGINAL description/Current MFC Quantity as last
// loaded from the server — kept separate from mcLineItemState (which holds
// the user's in-progress edits) so submitMcClearance's success summary can
// show "before → after" without the after-value having already clobbered it.
let mcLineItemMeta = {};

function initializeManufacturingClearancePanel() {
  mcCurrentStatus = "Inactive";
  mcLineItemState = {};
  mcGatingState = {};
  mcLineItemMeta = {};
  syncMcStatusPills();
  loadItemCodeCatalogIntoCache().catch(() => {});
  loadManufacturingClearanceList();
}

async function loadManufacturingClearanceList() {
  const table = document.getElementById("mc-list-table");
  const cardsContainer = document.getElementById("mc-active-cards-container");
  const body = document.getElementById("mc-list-body");

  if (mcCurrentStatus === "Active") {
    table.style.display = "none";
    cardsContainer.style.display = "block";
    cardsContainer.innerHTML = '<div style="padding:14px; text-align:center; color:var(--muted);">Loading...</div>';
  } else {
    table.style.display = "";
    cardsContainer.style.display = "none";
    body.innerHTML = '<tr><td colspan="4" style="padding:14px; text-align:center;">Loading...</td></tr>';
  }

  try {
    const data = await apFetch({ action: "fetchProjectsByStatus", status: mcCurrentStatus });
    if (!data.success) {
      const msg = `<div style="padding:14px; text-align:center; color:#b91c1c;">${data.error}</div>`;
      if (mcCurrentStatus === "Active") cardsContainer.innerHTML = msg;
      else body.innerHTML = `<tr><td colspan="4" style="padding:14px; text-align:center; color:#b91c1c;">${data.error}</td></tr>`;
      return;
    }
    if (data.projects.length === 0) {
      const msg = '<div style="padding:14px; text-align:center; color:var(--muted);">No projects with this status.</div>';
      if (mcCurrentStatus === "Active") cardsContainer.innerHTML = msg;
      else body.innerHTML = '<tr><td colspan="4" style="padding:14px; text-align:center; color:var(--muted);">No projects with this status.</td></tr>';
      return;
    }

    if (mcCurrentStatus === "Active") {
      // cardsContainer is rebuilt from scratch every time this tab loads —
      // every previous card's body DOM (including any already-expanded
      // one) is gone. mcLineItemState must be cleared alongside it: it was
      // only ever a "don't re-fetch, DOM already has the data" flag, and
      // without this reset it kept lying that a freshly-rebuilt (empty,
      // stuck on "Loading...") card was already populated, so
      // toggleMcCardBody skipped calling loadMcLineItems for it entirely.
      mcLineItemState = {};
      mcGatingState = {};
      mcLineItemMeta = {};
      cardsContainer.innerHTML = "";
      data.projects.forEach(p => cardsContainer.appendChild(renderMcProjectCard(p)));
      return;
    }

    body.innerHTML = data.projects.map(p => `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-family:monospace;">${p.projectId}</td>
        <td style="padding:8px;">${p.companyName}</td>
        <td style="padding:8px;">${formatDateDMY(p.deliveryDate) || "—"}</td>
        <td style="padding:8px;">
          ${mcCurrentStatus === "Inactive"
            ? `<button class="nav-btn-styled" style="background:#2f9e58; padding:5px 12px; font-size:0.78rem;" onclick="mcActivateProject('${p.projectId}')">Activate</button>`
            : mcCurrentStatus === "Completed"
            ? `<button class="nav-btn-styled" style="background:var(--brand); padding:5px 12px; font-size:0.78rem;" onclick="mcReactivateProject('${p.projectId}')">Reactivate</button>`
            : `<span style="color:var(--muted); font-size:0.78rem;">—</span>`}
        </td>
      </tr>`).join("");
  } catch(e) {
    const msg = `Network error: ${e.message}`;
    if (mcCurrentStatus === "Active") cardsContainer.innerHTML = `<div style="padding:14px; text-align:center; color:#b91c1c;">${msg}</div>`;
    else body.innerHTML = `<tr><td colspan="4" style="padding:14px; text-align:center; color:#b91c1c;">${msg}</td></tr>`;
  }
}

// ── Active-tab expandable wrapper cards ──────────────────────────────
function renderMcProjectCard(project) {
  const safeId = project.projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const card = document.createElement("div");
  card.className = "contact-summary-card-parent";
  card.id = `mc-card-${safeId}`;

  card.innerHTML = `
    <div class="contact-summary-header-row" onclick="toggleMcCardBody('${project.projectId}')" style="margin-bottom:0; padding-bottom:8px; cursor:pointer;">
      <div class="contact-summary-title-info" style="width:100%;">
        <div class="meta-row-line-block" style="display:flex; align-items:center; flex-wrap:wrap; gap:10px;">
          <span style="font-family:monospace; font-weight:800; background:var(--highlight-bg); color:var(--brand); padding:3px 8px; font-size:0.85rem; border-radius:3px;">${project.projectId}</span>
          <strong style="color:#111827; font-size:0.9rem;">${project.companyName}</strong>
          <span style="font-size:0.85rem;">Delivery Date: <strong style="color:#111827;">${formatDateDMY(project.deliveryDate) || "—"}</strong></span>
          <span id="mc-caret-${safeId}" style="margin-left:auto; font-weight:700; color:var(--muted);">▸</span>
        </div>
      </div>
    </div>
    <div id="mc-body-${safeId}" style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:8px;">
      <div id="mc-body-content-${safeId}" style="font-size:0.85rem; color:var(--muted);">Loading...</div>
    </div>
  `;
  return card;
}

async function toggleMcCardBody(projectId) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const body = document.getElementById(`mc-body-${safeId}`);
  const caret = document.getElementById(`mc-caret-${safeId}`);
  if (!body) return;
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "block";
  if (caret) caret.textContent = isOpen ? "▸" : "▾";
  if (!isOpen && !mcLineItemState[projectId]) {
    await loadMcLineItems(projectId);
  }
}

async function loadMcLineItems(projectId) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const contentEl = document.getElementById(`mc-body-content-${safeId}`);
  try {
    const data = await apFetch({ action: "fetchProjectMfcLineItems", projectId });
    if (!data.success) { contentEl.innerHTML = `<span style="color:#b91c1c;">${data.error}</span>`; return; }
    if (!data.lineItems || data.lineItems.length === 0) {
      contentEl.innerHTML = '<span style="color:var(--muted);">No PO product line items found for this project.</span>';
      return;
    }
    mcLineItemState[projectId] = {};
    mcLineItemMeta[projectId] = {};
    data.lineItems.forEach(li => {
      mcLineItemState[projectId][li.lineId] = {
        standardItemCode: li.standardItemCode || "",
        standardProductName: li.standardProductName || "",
        standardProductRating: li.standardProductRating || "",
        newMfcQuantity: li.mfcQuantity || 0,
      };
      mcLineItemMeta[projectId][li.lineId] = {
        description: li.description,
        currentMfcQuantity: li.mfcQuantity || 0,
      };
    });
    mcGatingState[projectId] = { ...data.gating };
    renderMcLineItemsTable(projectId, data.lineItems);
  } catch(e) {
    contentEl.innerHTML = `<span style="color:#b91c1c;">Network error: ${e.message}</span>`;
  }
}

function renderMcLineItemsTable(projectId, lineItems) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const contentEl = document.getElementById(`mc-body-content-${safeId}`);
  const gating = mcGatingState[projectId] || {};
  const gatingComplete = !!gating.complete;
  const disabledAttr = gatingComplete ? "" : "disabled";

  const rowsHtml = lineItems.map(li => {
    const state = mcLineItemState[projectId][li.lineId];
    // Product Name and Rating are stored as separate columns on the item
    // code catalog (design.item_codes: material_name, rating) and on this
    // line's own state — shown as two separate fields here, same split as
    // Create BOQ's Product Name / Product Rating, not jammed into one box.
    const searchVal = state.standardProductName || "";
    const ratingVal = state.standardProductRating || "";
    return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-weight:600; vertical-align:middle;">${li.description}</td>
        <td style="padding:8px; position:relative; vertical-align:middle;">
          <textarea rows="1" id="mc-std-search-${safeId}-${li.lineId}" ${disabledAttr}
            placeholder="Search Item Code..." autocomplete="off"
            oninput="handleMcProductSearch(this.value, '${projectId}', ${li.lineId}); mcAutoGrowField(this);"
            onfocus="mcAutoGrowField(this);"
            onkeydown="if(event.key==='Enter') event.preventDefault();"
            style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; font-size:0.8rem; border:1.5px solid var(--border); border-radius:4px; resize:none; overflow:hidden; font-family:inherit; min-height:32px;${gatingComplete ? "" : " background:#f1f5f9; cursor:not-allowed;"}">${searchVal.replace(/</g,'&lt;')}</textarea>
          <div id="mc-std-dropdown-${safeId}-${li.lineId}" style="display:none; position:fixed; z-index:9999; background:#fff; border:1.5px solid var(--brand); border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.18); overflow-y:auto; min-width:280px;"></div>
        </td>
        <td style="padding:8px; vertical-align:middle;">
          <textarea rows="1" id="mc-std-rating-${safeId}-${li.lineId}" readonly
            style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; font-size:0.8rem; border:1.5px solid var(--border); border-radius:4px; resize:none; overflow:hidden; font-family:inherit; min-height:32px; background:#f1f5f9; color:var(--muted); cursor:not-allowed;"
            placeholder="Auto-filled from Product Name">${ratingVal.replace(/</g,'&lt;')}</textarea>
        </td>
        <td style="padding:8px; text-align:center; vertical-align:middle;">${fmtQty(li.quantity)}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle;">${li.unit || "—"}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle; font-weight:700; color:#0369a1;">${fmtQty(li.mfcQuantity)}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle;">
          <input type="number" id="mc-new-mfc-${safeId}-${li.lineId}" value="${trimNum(state.newMfcQuantity)}" ${disabledAttr}
            min="0" max="${li.quantity}" step="any"
            oninput="clampMcNewMfcQty(this, '${projectId}', ${li.lineId})"
            style="width:100px; padding:5px 6px; text-align:center; font-family:monospace; font-weight:700; border:1.5px solid var(--border); border-radius:4px;${gatingComplete ? "" : " background:#f1f5f9; cursor:not-allowed;"}" />
        </td>
      </tr>`;
  }).join("");

  contentEl.innerHTML = `
    <div id="mc-gating-panel-${safeId}">${buildMcGatingPanelHtml(projectId, gating)}</div>
    <div id="mc-table-wrap-${safeId}">
      <div style="overflow-x:auto; margin-bottom:14px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; table-layout:fixed;">
          <colgroup>
            <col style="width:24%;" /><col style="width:24%;" /><col style="width:14%;" /><col style="width:7%;" />
            <col style="width:6%;" /><col style="width:10%;" /><col style="width:9%;" />
          </colgroup>
          <thead>
            <tr style="background:var(--highlight-bg); text-align:left;">
              <th style="padding:8px;">Order Product Description</th>
              <th style="padding:8px;">Standard Product Name *</th>
              <th style="padding:8px;">Standard Product Rating</th>
              <th style="padding:8px; text-align:center;">Order Quantity</th>
              <th style="padding:8px; text-align:center;">UOM</th>
              <th style="padding:8px; text-align:center;">Current MFC Quantity</th>
              <th style="padding:8px; text-align:center;">New MFC Quantity</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:flex-end;">
        <button class="nav-btn-styled" onclick="submitMcClearance('${projectId}')" style="background:var(--accent); padding:8px 20px; font-weight:700;" ${disabledAttr}>
          Submit Manufacturing Clearance
        </button>
      </div>
    </div>
  `;
  contentEl.querySelectorAll('textarea').forEach(mcAutoGrowField);
}

// setMcTableEnabled — toggles the product table's inputs/Submit button
// between locked and unlocked without rebuilding the table DOM, so a
// gating-field save (which can happen after some table edits are already
// in progress, e.g. a typeahead selection not yet submitted) never
// discards unsaved in-progress row state the way a full re-render would.
function setMcTableEnabled(projectId, enabled) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const wrap = document.getElementById(`mc-table-wrap-${safeId}`);
  if (!wrap) return;
  wrap.querySelectorAll('textarea:not([readonly]), input[type="number"], button').forEach(el => {
    el.disabled = !enabled;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.style.background = enabled ? '' : '#f1f5f9';
      el.style.cursor = enabled ? '' : 'not-allowed';
    }
  });
}

// buildMcGatingPanelHtml — the 4 project-level fields shown once above the
// product table (migration 113). Each field auto-saves on change via
// saveMcGatingField so partial progress survives a logout/return-tomorrow;
// the banner text and the table below only unlock once all 4 are filled.
function buildMcGatingPanelHtml(projectId, gating) {
  const complete = !!gating.complete;
  const bannerColor = complete ? "#15803d" : "#b91c1c";
  const bannerText = complete
    ? "Project is Eligible for Manufacturing Clearance"
    : "Complete All of the Tasks before Project is Eligible for Manufacturing Clearance";
  const sentYes = gating.drawingSentForApproval === "Yes" ? "selected" : "";
  const sentNo = gating.drawingSentForApproval !== "Yes" ? "selected" : "";

  return `
    <div style="background:var(--highlight-bg); border:1px solid var(--border); border-radius:6px; padding:14px; margin-bottom:16px;">
      <div style="font-weight:800; font-size:0.9rem; color:${bannerColor}; margin-bottom:12px;">${bannerText}</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
        <div>
          <label style="display:block; font-size:0.78rem; font-weight:600; color:var(--muted); margin-bottom:4px;">Drawing Sent for Approval</label>
          <select onchange="saveMcGatingField('${projectId}', 'drawingSentForApproval', this.value)"
            style="width:100%; padding:7px 8px; font-size:0.82rem; border:1.5px solid var(--border); border-radius:4px;">
            <option value="No" ${sentNo}>No</option>
            <option value="Yes" ${sentYes}>Yes</option>
          </select>
        </div>
        <div>
          <label style="display:block; font-size:0.78rem; font-weight:600; color:var(--muted); margin-bottom:4px;">Drawing Sent Date</label>
          <input type="date" value="${gating.drawingSentDate ? gating.drawingSentDate.slice(0,10) : ""}"
            onchange="saveMcGatingField('${projectId}', 'drawingSentDate', this.value)"
            style="width:100%; padding:6px 8px; font-size:0.82rem; border:1.5px solid var(--border); border-radius:4px;" />
        </div>
        <div>
          <label style="display:block; font-size:0.78rem; font-weight:600; color:var(--muted); margin-bottom:4px;">Drawing Approval Received Date</label>
          <input type="date" value="${gating.drawingApprovalReceivedDate ? gating.drawingApprovalReceivedDate.slice(0,10) : ""}"
            onchange="saveMcGatingField('${projectId}', 'drawingApprovalReceivedDate', this.value)"
            style="width:100%; padding:6px 8px; font-size:0.82rem; border:1.5px solid var(--border); border-radius:4px;" />
        </div>
        <div>
          <label style="display:block; font-size:0.78rem; font-weight:600; color:var(--muted); margin-bottom:4px;">Date of MFC Received from Customer</label>
          <input type="date" value="${gating.dateOfMfcReceivedFromCustomer ? gating.dateOfMfcReceivedFromCustomer.slice(0,10) : ""}"
            onchange="saveMcGatingField('${projectId}', 'dateOfMfcReceivedFromCustomer', this.value)"
            style="width:100%; padding:6px 8px; font-size:0.82rem; border:1.5px solid var(--border); border-radius:4px;" />
        </div>
      </div>
    </div>
  `;
}

async function saveMcGatingField(projectId, field, value) {
  try {
    const data = await apFetch({ action: "saveMcGatingField", projectId, field, value });
    if (!data.success) {
      alert(data.error || "Failed to save.");
      return;
    }
    mcGatingState[projectId] = { ...mcGatingState[projectId], [field]: value, complete: data.complete };
    // Update the banner + table lock in place rather than reloading —
    // reloading would refetch line items from the server and discard any
    // in-progress (not-yet-submitted) typeahead/quantity edits in the table.
    const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
    const panelEl = document.getElementById(`mc-gating-panel-${safeId}`);
    if (panelEl) panelEl.innerHTML = buildMcGatingPanelHtml(projectId, mcGatingState[projectId]);
    setMcTableEnabled(projectId, data.complete);
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

// Auto-grow the Standard Product Name search box so a long selected value
// wraps onto extra lines (row height grows) instead of clipping — same
// technique as the Upload Purchase Order review screen's autoGrowPoField.
function mcAutoGrowField(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Fixed-position dropdown, same reasoning/pattern as Create BOQ's material
// typeahead (design/create-boq.js: handleBOQRowMaterialSearch) — the row is
// inside a table wrapped in an overflow-x:auto scroller, so an
// absolutely-positioned dropdown clips against that scroller instead of
// floating over the rest of the page. Fixed positioning computed off the
// input's own screen rect escapes that clip entirely.
if (!window._mcDropdownScrollHandlerInstalled) {
  window._mcDropdownScrollHandlerInstalled = true;
  window.addEventListener('scroll', (e) => {
    if (e.target && e.target.id && e.target.id.includes('mc-std-dropdown-')) return;
    document.querySelectorAll('[id*="mc-std-dropdown-"]').forEach(dd => {
      if (dd.style.display === 'block') dd.style.display = 'none';
    });
  }, true);
}

function handleMcProductSearch(query, projectId, lineId) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const dropdown = document.getElementById(`mc-std-dropdown-${safeId}-${lineId}`);
  if (!dropdown) return;
  const catalog = window.itemCodeCatalogCache || [];
  const state = mcLineItemState[projectId][lineId];

  const inputEl = document.getElementById(`mc-std-search-${safeId}-${lineId}`);
  const inputRect = (inputEl || dropdown.parentElement).getBoundingClientRect();
  const availableHeight = window.innerHeight - inputRect.bottom - 12;
  dropdown.style.left = inputRect.left + "px";
  dropdown.style.top = inputRect.bottom + "px";
  dropdown.style.width = Math.max(inputRect.width, 280) + "px";
  dropdown.style.maxHeight = Math.min(Math.max(availableHeight, 180), 280) + "px";

  const ratingEl = document.getElementById(`mc-std-rating-${safeId}-${lineId}`);
  const clearRating = () => { if (ratingEl) { ratingEl.value = ""; mcAutoGrowField(ratingEl); } };

  if (!query || query.trim().length < 1) {
    dropdown.style.display = "none";
    state.standardItemCode = ""; state.standardProductName = ""; state.standardProductRating = "";
    clearRating();
    return;
  }

  const q = query.toLowerCase();
  const matches = catalog.filter(item => {
    const name = (item.productName || "").toLowerCase();
    const combined = `${name} ${(item.rating || "").toLowerCase()}`.trim();
    return name.includes(q) || combined.includes(q);
  }).slice(0, 10);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#b91c1c; font-weight:600;">
      No matching product found. <a href="${window.location.pathname}?module=design-itemcode&q=${encodeURIComponent(query)}" target="_blank" style="color:var(--brand); font-weight:700;">Create Item Code first →</a>
    </div>`;
    dropdown.style.display = "block";
    state.standardItemCode = ""; state.standardProductName = ""; state.standardProductRating = "";
    clearRating();
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div onclick="selectMcProduct('${projectId}', ${lineId}, '${item.itemCode}', '${item.productName.replace(/'/g,"\\'")}', '${(item.rating||'').replace(/'/g,"\\'")}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${item.productName}${item.rating ? ` - <span style="color:var(--brand); font-weight:700;">${item.rating}</span>` : ""}
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectMcProduct(projectId, lineId, itemCode, productName, rating) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const state = mcLineItemState[projectId][lineId];
  state.standardItemCode = itemCode;
  state.standardProductName = productName;
  state.standardProductRating = rating || "";

  const searchEl = document.getElementById(`mc-std-search-${safeId}-${lineId}`);
  if (searchEl) { searchEl.value = productName; mcAutoGrowField(searchEl); }
  const ratingEl = document.getElementById(`mc-std-rating-${safeId}-${lineId}`);
  if (ratingEl) { ratingEl.value = rating || ""; mcAutoGrowField(ratingEl); }
  const dropdown = document.getElementById(`mc-std-dropdown-${safeId}-${lineId}`);
  if (dropdown) dropdown.style.display = "none";
}

function clampMcNewMfcQty(inp, projectId, lineId) {
  const max = Number(inp.max) || 0;
  let val = parseFloat(inp.value);
  if (isNaN(val)) val = 0;
  if (val < 0) val = 0;
  if (val > max) val = max;
  inp.value = val;
  mcLineItemState[projectId][lineId].newMfcQuantity = val;
}

async function submitMcClearance(projectId) {
  const state = mcLineItemState[projectId];
  if (!state) return;

  const rows = Object.keys(state).map(lineId => ({
    lineId: Number(lineId),
    standardItemCode: state[lineId].standardItemCode,
    standardProductName: state[lineId].standardProductName,
    standardProductRating: state[lineId].standardProductRating,
    newMfcQuantity: state[lineId].newMfcQuantity,
  }));

  const missing = rows.filter(r => !r.standardItemCode);
  if (missing.length > 0) {
    alert("Standard Product Name is required for every product row before submitting.");
    return;
  }

  const anyDecrease = rows.some(r => {
    const original = document.getElementById(`mc-new-mfc-${projectId.replace(/[^a-zA-Z0-9]/g, "_")}-${r.lineId}`);
    return original && Number(original.defaultValue) > r.newMfcQuantity;
  });
  const warning = anyDecrease
    ? "\n\nWARNING: One or more products have a REDUCED MFC Quantity. Job Cards beyond the new count will be deleted (or marked Excess/Orphaned if already partially consumed), and any Finished Goods BOQs depending on these products will have their quantities reduced too."
    : "";
  if (!confirm(`Submit Manufacturing Clearance for ${projectId}?${warning}`)) return;

  showBlockingOverlay("Submitting Manufacturing Clearance...");
  try {
    const data = await apFetch({ action: "submitManufacturingClearance", projectId, rows });
    if (data.success) {
      // Build the before→after summary off mcLineItemMeta (the
      // as-loaded-from-server snapshot) + rows (what was just submitted) —
      // both are still intact here, submitManufacturingClearance's success
      // wipes neither until we explicitly clear state below.
      const meta = mcLineItemMeta[projectId] || {};
      const summaryRows = rows.map(r => {
        const before = meta[r.lineId] ? meta[r.lineId].currentMfcQuantity : 0;
        const label = r.standardProductName || (meta[r.lineId] && meta[r.lineId].description) || `Line ${r.lineId}`;
        return { label, before, after: r.newMfcQuantity };
      });
      delete mcLineItemState[projectId];
      delete mcLineItemMeta[projectId];
      renderMcSubmitSuccess(projectId, summaryRows);
    } else {
      alert(data.error || "Failed to submit Manufacturing Clearance.");
    }
  } catch(e) {
    alert("Network error: " + e.message);
  } finally {
    hideBlockingOverlay();
  }
}

// renderMcSubmitSuccess — replaces the card body (table + gating panel)
// with a confirmation once Submit Manufacturing Clearance succeeds, since
// reloading straight back into the (now-consumed) editable table gave no
// feedback on what was actually just changed. "+ Another Manufacturing
// Clearance" hands the user back to the Active Projects list rather than
// re-opening this same card, since the whole point is picking a DIFFERENT
// project next.
function renderMcSubmitSuccess(projectId, summaryRows) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const contentEl = document.getElementById(`mc-body-content-${safeId}`);
  if (!contentEl) return;

  const bulletsHtml = summaryRows.map(r =>
    `<li style="margin-bottom:4px;">${r.label}: <strong>${trimNum(r.before)}</strong> → <strong style="color:#15803d;">${trimNum(r.after)}</strong></li>`
  ).join("");

  contentEl.innerHTML = `
    <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:16px;">
      <div style="font-weight:800; font-size:0.92rem; color:#15803d; margin-bottom:6px;">
        Manufacturing Clearance submitted for <span style="font-family:monospace;">${projectId}</span>
      </div>
      <ul style="margin:8px 0 14px 18px; padding:0; font-size:0.85rem; color:#111827;">${bulletsHtml}</ul>
      <button class="nav-btn-styled" onclick="mcAnotherClearance('${projectId}')" style="background:var(--brand); padding:8px 20px; font-weight:700;">
        + Another Manufacturing Clearance
      </button>
    </div>
  `;
}

// mcAnotherClearance — collapses back out to the Active Projects list
// (re-fetched fresh) so the user can expand a different project's card.
async function mcAnotherClearance(projectId) {
  mcCurrentStatus = "Active";
  syncMcStatusPills();
  await loadManufacturingClearanceList();
}

async function mcActivateProject(projectId) {
  if (!confirm(`Activate ${projectId}? This clears it for manufacturing and makes it visible to all departments. This cannot be undone from this screen.`)) return;
  showBlockingOverlay("Activating project...");
  try {
    const data = await apFetch({ action: "activateProject", projectId });
    if (data.success) { loadManufacturingClearanceList(); }
    else alert(data.error || "Failed to activate.");
  } catch(e) {
    alert("Network error: " + e.message);
  } finally {
    hideBlockingOverlay();
  }
}

async function mcReactivateProject(projectId) {
  if (!confirm(`Reactivate ${projectId}? This moves it back to Active. Its PRNs stay Completed and any resumed production will need a fresh Excess Material Request or new PRN.`)) return;
  showBlockingOverlay("Reactivating project...");
  try {
    const data = await apFetch({ action: "reactivateCompletedProject", projectId });
    if (data.success) { loadManufacturingClearanceList(); }
    else alert(data.error || "Failed to reactivate.");
  } catch(e) {
    alert("Network error: " + e.message);
  } finally {
    hideBlockingOverlay();
  }
}

let sweepBlockedAllocationsCache = [];

