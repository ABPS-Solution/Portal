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

// switchMcStatus / syncMcStatusPills — moved here from
// accounts/tour-expense.js (where they were misfiled) during the Tour
// Expense Tracker rebuild; this is where they actually belong.
function switchMcStatus(status) {
  mcCurrentStatus = status;
  syncMcStatusPills();
  loadManufacturingClearanceList();
}

function syncMcStatusPills() {
  ["Active", "Inactive", "Completed"].forEach(s => {
    const btn = document.getElementById("mc-pill-" + s.toLowerCase());
    if (btn) btn.style.background = (s === mcCurrentStatus) ? "var(--brand)" : "#e2e8f0";
    if (btn) btn.style.color = (s === mcCurrentStatus) ? "#fff" : "#334155";
  });
}

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
    body.innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center;">Loading...</td></tr>';
  }

  try {
    const data = await apFetch({ action: "fetchProjectsByStatus", status: mcCurrentStatus });
    if (!data.success) {
      const msg = `<div style="padding:14px; text-align:center; color:#b91c1c;">${data.error}</div>`;
      if (mcCurrentStatus === "Active") cardsContainer.innerHTML = msg;
      else body.innerHTML = `<tr><td colspan="5" style="padding:14px; text-align:center; color:#b91c1c;">${data.error}</td></tr>`;
      return;
    }
    if (data.projects.length === 0) {
      const msg = '<div style="padding:14px; text-align:center; color:var(--muted);">No projects with this status.</div>';
      if (mcCurrentStatus === "Active") cardsContainer.innerHTML = msg;
      else body.innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center; color:var(--muted);">No projects with this status.</td></tr>';
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
        <td style="padding:8px; font-family:monospace; word-break:break-word;">${p.projectId}</td>
        <td style="padding:8px; word-break:break-word;">${p.companyName}</td>
        <td style="padding:8px; white-space:pre-line; word-break:break-word;">${escapeHtml(p.orderProductDescription) || "—"}</td>
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
    else body.innerHTML = `<tr><td colspan="5" style="padding:14px; text-align:center; color:#b91c1c;">${msg}</td></tr>`;
  }
}

// ── Active-tab expandable wrapper cards ──────────────────────────────
// Hold status takes priority over the Internal MFC given/pending pair —
// a held product needs attention regardless of where MFC stands.
function mcStatusPill(project) {
  const total = Number(project.totalLines) || 0, held = Number(project.heldLines) || 0;
  if (total > 0 && held === total) return { text: "Completely On Hold", color: "#b91c1c" };
  if (held > 0) return { text: "Partially On Hold", color: "#d97706" };
  if (project.mfcInt) return { text: "Internal MFC Given", color: "#2f9e58" };
  return { text: "Internal MFC Pending", color: "var(--muted)" };
}

function renderMcProjectCard(project) {
  const safeId = project.projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const card = document.createElement("div");
  card.className = "contact-summary-card-parent";
  card.id = `mc-card-${safeId}`;

  const status = mcStatusPill(project);
  const deliveryLabel = project.mfcInt ? "Expected Delivery Date" : "Tentative Delivery Date";
  const deliveryValue = project.mfcInt ? project.actualDeliveryDate : project.deliveryDate;

  card.innerHTML = `
    <div class="contact-summary-header-row" onclick="toggleMcCardBody('${project.projectId}')" style="margin-bottom:0; padding-bottom:8px; cursor:pointer;">
      <div class="contact-summary-title-info" style="width:100%;">
        <div class="meta-row-line-block" style="display:flex; align-items:center; flex-wrap:wrap; gap:10px;">
          <span style="font-family:monospace; font-weight:800; background:var(--highlight-bg); color:var(--brand); padding:3px 8px; font-size:0.85rem; border-radius:3px;">${project.projectId}</span>
          <strong style="color:#111827; font-size:0.9rem;">${project.companyName}</strong>
          <span style="font-size:0.85rem;">${deliveryLabel}: <strong style="color:#111827;">${formatDateDMY(deliveryValue) || "—"}</strong></span>
          <span style="margin-left:auto; font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#fff; background:${status.color}; padding:3px 8px; border-radius:10px;">${status.text}</span>
          <span id="mc-caret-${safeId}" style="font-weight:700; color:var(--muted);">▸</span>
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
    await loadItemCodeCatalogIntoCache().catch(() => {});
    const data = await apFetch({ action: "fetchProjectMfcLineItems", projectId });
    if (!data.success) { contentEl.innerHTML = `<span style="color:#b91c1c;">${data.error}</span>`; return; }
    if (!data.lineItems || data.lineItems.length === 0) {
      contentEl.innerHTML = '<span style="color:var(--muted);">No PO product line items found for this project.</span>';
      return;
    }
    mcLineItemState[projectId] = {};
    mcLineItemMeta[projectId] = {};
    data.lineItems.forEach(li => {
      // Make/Item Code UOM aren't stored on customer_po_line_items — they're
      // resolved live from the matching item code catalog entry, same as a
      // fresh selectMcProduct pick, so a project reopened after a prior
      // clearance still shows them for its already-mapped rows.
      const catalogMatch = (window.itemCodeCatalogCache || []).find(c => c.itemCode === li.standardItemCode);
      mcLineItemState[projectId][li.lineId] = {
        standardItemCode: li.standardItemCode || "",
        standardProductName: li.standardProductName || "",
        standardProductRating: li.standardProductRating || "",
        make: (catalogMatch && catalogMatch.make) || "",
        itemCodeUnit: (catalogMatch && catalogMatch.unit) || "",
        newMfcQuantity: li.mfcQuantity || 0,
        onHold: !!li.onHold, holdReason: li.holdReason || "",
        boqIds: li.boqIds || [],
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

  const isAdmin = localStorage.getItem("isUserAdminGlobal") === "true"; // server re-checks perm_admin regardless

  const rowsHtml = lineItems.map(li => {
    const state = mcLineItemState[projectId][li.lineId];
    // Product Name and Rating are stored as separate columns on the item
    // code catalog (design.item_codes: material_name, rating) and on this
    // line's own state — shown as two separate fields here, same split as
    // Create BOQ's Product Name / Product Rating, not jammed into one box.
    const searchVal = state.standardProductName || "";
    const ratingVal = state.standardProductRating || "";
    const makeVal = state.make || "";
    const itemCodeUnitVal = state.itemCodeUnit || "";
    // Hold Product — a held row is parked entirely: every input disables
    // regardless of the project-level gating state, greyed, with the
    // reason as a tooltip on the badge. Only an admin sees the Hold/Un-hold
    // button (server re-checks perm_admin regardless — same convention as
    // design/item-codes.js's isAdmin usage).
    const isHeld = !!state.onHold;
    const rowDisabledAttr = (gatingComplete && !isHeld) ? "" : "disabled";
    const rowBg = isHeld ? " background:#fef2f2;" : "";
    // Once a BOQ exists, the product name is baked into boq_id/prn_id/
    // job_card_number — the plain search field is locked (server also
    // refuses a plain re-submit, see submitManufacturingClearance's
    // guard) and only renameStandardProduct (admin-only, via the "Change
    // Product" button below) can change it from here on.
    const hasBoq = (state.boqIds || []).length > 0;
    const productSearchDisabledAttr = hasBoq ? "disabled" : rowDisabledAttr;
    const productSearchStyleExtra = hasBoq ? " background:#f1f5f9; cursor:not-allowed;" : ((gatingComplete && !isHeld) ? "" : " background:#f1f5f9; cursor:not-allowed;");
    return `
      <tr data-line-id="${li.lineId}" style="border-bottom:1px solid var(--border); color:#111827;${rowBg}">
        <td style="padding:8px; font-weight:600; vertical-align:middle; color:#111827;">
          ${li.description}
          ${isHeld ? `<div style="margin-top:4px;"><span style="display:inline-block; background:#fee2e2; color:#b91c1c; font-size:0.68rem; font-weight:800; padding:2px 7px; border-radius:10px; text-transform:uppercase; letter-spacing:0.3px;" title="${(state.holdReason || '').replace(/"/g,'&quot;')}">⏸ On Hold</span></div>` : ''}
        </td>
        <td style="padding:8px; position:relative; vertical-align:middle;">
          <textarea rows="1" id="mc-std-search-${safeId}-${li.lineId}" ${productSearchDisabledAttr}
            placeholder="Search Item Code..." autocomplete="off"
            oninput="handleMcProductSearch(this.value, '${projectId}', ${li.lineId}); mcAutoGrowField(this);"
            onfocus="mcAutoGrowField(this);"
            onkeydown="if(event.key==='Enter') event.preventDefault();"
            style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; font-size:0.8rem; border:1.5px solid var(--border); border-radius:4px; resize:none; overflow:hidden; font-family:inherit; min-height:32px; color:#111827;${productSearchStyleExtra}">${searchVal.replace(/</g,'&lt;')}</textarea>
          <div id="mc-std-dropdown-${safeId}-${li.lineId}" style="display:none; position:fixed; z-index:9999; background:#fff; border:1.5px solid var(--brand); border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.18); overflow-y:auto; min-width:280px;"></div>
          ${hasBoq && isAdmin ? `<button class="nav-btn-styled" onclick="openProductRenameModal('${projectId}', ${li.lineId})" style="margin-top:4px; background:#7c3aed; padding:3px 8px; font-size:0.68rem;">Change Product</button>` : ''}
        </td>
        <td style="padding:8px; vertical-align:middle;">
          <textarea rows="1" id="mc-std-rating-${safeId}-${li.lineId}" readonly
            style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; font-size:0.8rem; border:1.5px solid var(--border); border-radius:4px; resize:none; overflow:hidden; font-family:inherit; min-height:32px; background:#f1f5f9; color:#111827; cursor:not-allowed;"
            placeholder="Auto-filled from Product Name">${ratingVal.replace(/</g,'&lt;')}</textarea>
        </td>
        <td style="padding:8px; vertical-align:middle;">
          <textarea rows="1" id="mc-std-make-${safeId}-${li.lineId}" readonly
            style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; font-size:0.8rem; border:1.5px solid var(--border); border-radius:4px; resize:none; overflow:hidden; font-family:inherit; min-height:32px; background:#f1f5f9; color:#111827; cursor:not-allowed;"
            placeholder="Auto-filled from Item Code">${makeVal.replace(/</g,'&lt;')}</textarea>
        </td>
        <td style="padding:8px; text-align:center; vertical-align:middle; font-size:1rem; font-weight:600; color:#111827;">${fmtQty(li.quantity)}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle; color:#111827;">${li.unit || "—"}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle; font-size:1rem; font-weight:600; color:#111827;" id="mc-std-itemcode-unit-${safeId}-${li.lineId}">${itemCodeUnitVal || "—"}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle; font-size:1rem; font-weight:700; color:#111827;">${fmtQty(li.mfcQuantity)}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle;">
          <input type="number" id="mc-new-mfc-${safeId}-${li.lineId}" value="${trimNum(state.newMfcQuantity)}" ${rowDisabledAttr}
            min="0" max="${li.quantity}" step="any"
            oninput="clampMcNewMfcQty(this, '${projectId}', ${li.lineId})"
            style="width:100px; padding:5px 6px; text-align:center; font-family:monospace; font-size:1rem; font-weight:700; color:#111827; border:1.5px solid var(--border); border-radius:4px;${(gatingComplete && !isHeld) ? "" : " background:#f1f5f9; cursor:not-allowed;"}" />
        </td>
        <td style="padding:8px; text-align:center; vertical-align:middle;">
          ${isAdmin ? (isHeld
            ? `<button class="nav-btn-styled" data-mc-hold-btn onclick="unholdMcProduct('${projectId}', ${li.lineId})" style="background:#15803d; padding:5px 10px; font-size:0.72rem;">Un-hold</button>`
            : `<button class="nav-btn-styled" data-mc-hold-btn onclick="holdMcProduct('${projectId}', ${li.lineId})" style="background:#b91c1c; padding:5px 10px; font-size:0.72rem;">Hold</button>`)
            : '<span style="color:var(--muted); font-size:0.72rem;">—</span>'}
        </td>
      </tr>`;
  }).join("");

  contentEl.innerHTML = `
    <div id="mc-gating-panel-${safeId}">${buildMcGatingPanelHtml(projectId, gating)}</div>
    <div id="mc-table-wrap-${safeId}">
      <div style="overflow-x:auto; margin-bottom:14px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; table-layout:fixed;">
          <colgroup>
            <col style="width:16%;" /><col style="width:16%;" /><col style="width:10%;" /><col style="width:10%;" />
            <col style="width:6%;" /><col style="width:7%;" /><col style="width:7%;" />
            <col style="width:8%;" /><col style="width:8%;" /><col style="width:8%;" />
          </colgroup>
          <thead>
            <tr style="background:var(--highlight-bg); text-align:left;">
              <th style="padding:8px;">Order Product Description</th>
              <th style="padding:8px;">Standard Product Name *</th>
              <th style="padding:8px;">Standard Product Rating</th>
              <th style="padding:8px;">Make</th>
              <th style="padding:8px; text-align:center;">Order Quantity</th>
              <th style="padding:8px; text-align:center;">Order Product UOM</th>
              <th style="padding:8px; text-align:center;">Item Code UOM</th>
              <th style="padding:8px; text-align:center;">Current MFC Quantity</th>
              <th style="padding:8px; text-align:center;">New MFC Quantity</th>
              <th style="padding:8px; text-align:center;">Hold</th>
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
// Hold/Un-hold buttons ([data-mc-hold-btn]) are deliberately excluded —
// they're a separate admin action, not gated by MFC gating completeness,
// so they must stay clickable even while the rest of the table is locked.
// Rows whose product is On Hold are skipped entirely: they stay
// disabled/greyed regardless of `enabled`, since Hold parks the row
// independent of the project-level gating state.
function setMcTableEnabled(projectId, enabled) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const wrap = document.getElementById(`mc-table-wrap-${safeId}`);
  if (!wrap) return;
  const state = mcLineItemState[projectId] || {};
  wrap.querySelectorAll('tr[data-line-id]').forEach(tr => {
    const lineId = tr.dataset.lineId;
    const rowHeld = !!(state[lineId] && state[lineId].onHold);
    const rowEnabled = enabled && !rowHeld;
    tr.querySelectorAll('textarea:not([readonly]), input[type="number"]').forEach(el => {
      el.disabled = !rowEnabled;
      el.style.background = rowEnabled ? '' : '#f1f5f9';
      el.style.cursor = rowEnabled ? '' : 'not-allowed';
    });
  });
  wrap.querySelectorAll('button:not([data-mc-hold-btn])').forEach(el => { el.disabled = !enabled; });
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
        <div>
          <label style="display:block; font-size:0.78rem; font-weight:600; color:var(--muted); margin-bottom:4px;">Expected Delivery Date</label>
          <input type="date" value="${gating.actualDeliveryDate ? gating.actualDeliveryDate.slice(0,10) : ""}"
            onchange="saveMcGatingField('${projectId}', 'actualDeliveryDate', this.value)"
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
  const makeEl = document.getElementById(`mc-std-make-${safeId}-${lineId}`);
  const itemCodeUnitEl = document.getElementById(`mc-std-itemcode-unit-${safeId}-${lineId}`);
  const clearRating = () => {
    if (ratingEl) { ratingEl.value = ""; mcAutoGrowField(ratingEl); }
    if (makeEl) { makeEl.value = ""; mcAutoGrowField(makeEl); }
    if (itemCodeUnitEl) itemCodeUnitEl.textContent = "—";
  };

  if (!query || query.trim().length < 1) {
    dropdown.style.display = "none";
    state.standardItemCode = ""; state.standardProductName = ""; state.standardProductRating = ""; state.make = ""; state.itemCodeUnit = "";
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
    state.standardItemCode = ""; state.standardProductName = ""; state.standardProductRating = ""; state.make = ""; state.itemCodeUnit = "";
    clearRating();
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div onclick="selectMcProduct('${projectId}', ${lineId}, '${item.itemCode}', '${item.productName.replace(/'/g,"\\'")}', '${(item.rating||'').replace(/'/g,"\\'")}', '${(item.make||'').replace(/'/g,"\\'")}', '${(item.unit||'').replace(/'/g,"\\'")}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${item.productName}${item.rating ? ` - <span style="color:var(--brand); font-weight:700;">${item.rating}</span>` : ""}
    </div>`).join("");
  dropdown.style.display = "block";
}

function selectMcProduct(projectId, lineId, itemCode, productName, rating, make, itemCodeUnit) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const state = mcLineItemState[projectId][lineId];
  state.standardItemCode = itemCode;
  state.standardProductName = productName;
  state.standardProductRating = rating || "";
  state.make = make || "";
  state.itemCodeUnit = itemCodeUnit || "";

  const searchEl = document.getElementById(`mc-std-search-${safeId}-${lineId}`);
  if (searchEl) { searchEl.value = productName; mcAutoGrowField(searchEl); }
  const ratingEl = document.getElementById(`mc-std-rating-${safeId}-${lineId}`);
  if (ratingEl) { ratingEl.value = rating || ""; mcAutoGrowField(ratingEl); }
  const makeEl = document.getElementById(`mc-std-make-${safeId}-${lineId}`);
  if (makeEl) { makeEl.value = make || ""; mcAutoGrowField(makeEl); }
  const itemCodeUnitEl = document.getElementById(`mc-std-itemcode-unit-${safeId}-${lineId}`);
  if (itemCodeUnitEl) itemCodeUnitEl.textContent = itemCodeUnit || "—";
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

  // Held rows are excluded entirely — the server rejects a submission that
  // includes one anyway (submitManufacturingClearance), but skipping them
  // here means a held row never blocks submitting clearance for every
  // OTHER product on the project.
  const rows = Object.keys(state).filter(lineId => !state[lineId].onHold).map(lineId => ({
    lineId: Number(lineId),
    standardItemCode: state[lineId].standardItemCode,
    standardProductName: state[lineId].standardProductName,
    standardProductRating: state[lineId].standardProductRating,
    newMfcQuantity: state[lineId].newMfcQuantity,
  }));
  if (rows.length === 0) {
    alert("Every product row on this project is currently On Hold — nothing to submit.");
    return;
  }

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

// holdMcProduct / unholdMcProduct — admin-only (server re-checks
// perm_admin regardless of the isAdmin check that renders this button at
// all). Hold releases this product's reserved store stock back to the
// free pool and blocks new BOQ/PRN/PO/Job Card/Store Ticket work for it;
// work already in flight (an Authorized PO's GRN/QA receipt, an approved
// ticket, an open Job Card) is untouched. See routes/projects.js's
// holdProjectProduct/unholdProjectProduct and lib/productHold.js.
// ═══════════════════════════════════════════════════════════════════════
// Change Standard Product (admin-only) — the only supported way to fix a
// wrong Standard Product Name once a BOQ already exists for the line.
// Self-contained overlay (appended to document.body once, reused after)
// rather than static index.html markup — same rationale as any
// clipped-dropdown-style injected element elsewhere in this codebase.
// Server re-checks perm_admin regardless of what this UI shows.
// ═══════════════════════════════════════════════════════════════════════
function ensureProductRenameModalEl() {
  let el = document.getElementById("mc-product-rename-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "mc-product-rename-modal";
  el.style.cssText = "display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:600; align-items:center; justify-content:center;";
  el.innerHTML = `<div style="background:var(--card); border-radius:var(--radius); padding:22px; width:min(640px, 92vw); max-height:88vh; overflow-y:auto;">
    <div id="mc-product-rename-modal-body"></div>
  </div>`;
  document.body.appendChild(el);
  return el;
}

function openProductRenameModal(projectId, lineId) {
  window._mcRenameTarget = { projectId, lineId };
  window._mcRenamePreview = null;
  const el = ensureProductRenameModalEl();
  const body = document.getElementById("mc-product-rename-modal-body");
  const state = mcLineItemState[projectId][lineId];
  body.innerHTML = `
    <h3 style="margin-top:0;">Change Standard Product</h3>
    <p style="color:var(--muted); font-size:0.85rem;">Current: <strong>${escapeHtml(state.standardProductName || '')}${state.standardProductRating ? ' - ' + escapeHtml(state.standardProductRating) : ''}</strong></p>
    <p style="color:#b45309; font-size:0.8rem; background:#fffbeb; padding:8px 10px; border-radius:4px;">
      This BOQ already has downstream work. Renaming rewrites its BOQ ID, PRN ID, and every Job Card number,
      and everywhere they're stored — only allowed until Production Planning is released for it.
    </p>
    <input type="text" id="mc-rename-search-input" placeholder="Search new Item Code / Product Name..." autocomplete="off"
      oninput="handleProductRenameSearch(this.value)"
      style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius); margin-bottom:8px;" />
    <div id="mc-rename-search-results" style="max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:4px;"></div>
    <div id="mc-rename-preview-zone" style="margin-top:14px;"></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
      <button class="nav-btn-styled" style="background:#718096;" onclick="closeProductRenameModal()">Cancel</button>
    </div>
  `;
  el.style.display = "flex";
}

function closeProductRenameModal() {
  const el = document.getElementById("mc-product-rename-modal");
  if (el) el.style.display = "none";
  window._mcRenameTarget = null;
  window._mcRenamePreview = null;
}

function handleProductRenameSearch(query) {
  const results = document.getElementById("mc-rename-search-results");
  if (!results) return;
  document.getElementById("mc-rename-preview-zone").innerHTML = "";
  if (!query || query.trim().length < 1) { results.innerHTML = ""; return; }
  const q = query.toLowerCase();
  const catalog = window.itemCodeCatalogCache || [];
  const matches = catalog.filter(item => {
    const name = (item.productName || "").toLowerCase();
    return name.includes(q) || `${name} ${(item.rating||"").toLowerCase()}`.includes(q);
  }).slice(0, 10);
  results.innerHTML = matches.map(item => `
    <div onclick="selectProductRenameCandidate('${item.itemCode}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${escapeHtml(item.productName)}${item.rating ? ` - <span style="color:var(--brand); font-weight:700;">${escapeHtml(item.rating)}</span>` : ""}
    </div>`).join("") || `<div style="padding:8px 12px; font-size:0.8rem; color:var(--muted);">No matches.</div>`;
}

async function selectProductRenameCandidate(newItemCode) {
  const target = window._mcRenameTarget;
  if (!target) return;
  const previewZone = document.getElementById("mc-rename-preview-zone");
  previewZone.innerHTML = `<div style="color:var(--muted); font-size:0.85rem;">Checking what will change...</div>`;
  try {
    const data = await apFetch({ action: "previewStandardProductRename", projectId: target.projectId, lineId: target.lineId, newItemCode });
    if (!data.success) { previewZone.innerHTML = `<div style="color:#b91c1c; font-size:0.85rem;">${escapeHtml(data.error)}</div>`; return; }
    window._mcRenamePreview = { ...data, newItemCode };
    const boqRows = (data.boqs || []).map(b => `
      <div style="padding:8px; border:1px solid var(--border); border-radius:4px; margin-top:6px; font-size:0.78rem;">
        <div><strong>BOQ:</strong> ${escapeHtml(b.oldBoqId)} → ${escapeHtml(b.newBoqId)}</div>
        ${b.newPrnId ? `<div><strong>PRN:</strong> ${escapeHtml(b.newPrnId)}</div>` : ''}
        ${b.jobCards.length ? `<div><strong>Job Cards:</strong> ${b.jobCards.map(jc => `${escapeHtml(jc.old)} → ${escapeHtml(jc.new)}`).join(', ')}</div>` : ''}
        ${b.fgConsumerBoqIds.length ? `<div style="color:#b45309;"><strong>Also re-points:</strong> ${b.fgConsumerBoqIds.map(escapeHtml).join(', ')} (consumes this as a Finished Good material)</div>` : ''}
      </div>`).join("") || `<div style="color:var(--muted); font-size:0.8rem; margin-top:6px;">No BOQ exists yet for this line — this will just update the product mapping.</div>`;

    previewZone.innerHTML = `
      <div style="font-weight:700; font-size:0.9rem; margin-bottom:4px;">${escapeHtml(data.oldProductName)} → ${escapeHtml(data.newProductName)}${data.newRating ? ' - ' + escapeHtml(data.newRating) : ''}</div>
      ${boqRows}
      <label class="field-label" style="margin-top:12px;">Type the Project ID (<strong>${escapeHtml(target.projectId)}</strong>) to confirm *</label>
      <input type="text" id="mc-rename-confirm-input" oninput="document.getElementById('mc-rename-confirm-btn').disabled = (this.value.trim() !== '${target.projectId.replace(/'/g,"\\'")}');"
        style="width:100%; padding:8px; border:1.5px solid var(--border); border-radius:var(--radius); margin-top:6px;" />
      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <button class="nav-btn-styled" id="mc-rename-confirm-btn" disabled style="background:var(--danger); opacity:0.5; cursor:not-allowed;" onclick="commitProductRename()">Confirm Rename</button>
      </div>`;
  } catch (e) {
    previewZone.innerHTML = `<div style="color:#b91c1c; font-size:0.85rem;">Network error: ${escapeHtml(e.message)}</div>`;
  }
}

async function commitProductRename() {
  const target = window._mcRenameTarget;
  const preview = window._mcRenamePreview;
  if (!target || !preview) return;
  const btn = document.getElementById("mc-rename-confirm-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Renaming..."; }
  try {
    const data = await apFetch({
      action: "renameStandardProduct", projectId: target.projectId, lineId: target.lineId,
      newItemCode: preview.newItemCode, operatorName: appActiveOperatorIdentityString,
    });
    if (!data.success) {
      alert(data.error || "Rename failed.");
      if (btn) { btn.disabled = false; btn.textContent = "Confirm Rename"; }
      return;
    }
    closeProductRenameModal();
    await loadMcLineItems(target.projectId);
  } catch (e) {
    alert("Network error: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Confirm Rename"; }
  }
}

async function holdMcProduct(projectId, lineId) {
  const reason = prompt("Reason for placing this product On Hold (required):");
  if (reason === null) return; // cancelled
  if (!reason.trim()) { alert("A reason is required to place a Hold."); return; }
  if (!confirm(`Hold this product on ${projectId}?\n\nThis releases its currently-reserved store stock back to the free pool — the material becomes claimable by other projects' PRNs. No new BOQ/PRN/PO/Job Card/Store Ticket can be raised for it until un-held. Work already in progress (open POs, approved tickets, open Job Cards) is not affected.`)) return;

  showBlockingOverlay("Placing Hold...");
  try {
    const data = await apFetch({ action: "holdProjectProduct", projectId, lineId, reason: reason.trim(), operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (!data.success) { alert(data.error || "Failed to place Hold."); return; }
    const releasedSummary = (data.released || []).map(r => `${r.materialName || r.itemCode}: ${trimNum(r.releasedQty)}`).join("\n");
    if (releasedSummary) alert(`Hold placed. Released back to free stock:\n${releasedSummary}`);
    await loadMcLineItems(projectId);
  } catch(e) {
    hideBlockingOverlay();
    alert("Network error: " + e.message);
  }
}

async function unholdMcProduct(projectId, lineId) {
  if (!confirm(`Remove the Hold on this product for ${projectId}? This tries to re-reserve its stock from whatever is currently free — if another project has since claimed it, only part (or none) may come back.`)) return;

  showBlockingOverlay("Removing Hold...");
  try {
    const data = await apFetch({ action: "unholdProjectProduct", projectId, lineId, operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (!data.success) { alert(data.error || "Failed to remove Hold."); return; }
    const shortfalls = (data.reclaimed || []).filter(r => r.shortfall > 1e-9);
    if (shortfalls.length > 0) {
      const msg = shortfalls.map(r => `${r.materialName || r.itemCode}: reclaimed ${trimNum(r.reclaimed)} of ${trimNum(r.wanted)} — ${trimNum(r.shortfall)} already claimed elsewhere`).join("\n");
      alert(`Hold removed. Some stock could not be fully reclaimed:\n${msg}`);
    }
    await loadMcLineItems(projectId);
  } catch(e) {
    hideBlockingOverlay();
    alert("Network error: " + e.message);
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

