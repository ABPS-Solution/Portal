let mcCurrentStatus = "Inactive";
// Per-project line-item state for the expanded Active-tab cards, keyed by
// projectId, then by lineId — holds the editable row values between
// re-renders (typeahead selection, New MFC Quantity) so a caret toggle or
// a submit-triggered reload doesn't lose in-progress edits.
let mcLineItemState = {};

function initializeManufacturingClearancePanel() {
  mcCurrentStatus = "Inactive";
  mcLineItemState = {};
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
    data.lineItems.forEach(li => {
      mcLineItemState[projectId][li.lineId] = {
        standardItemCode: li.standardItemCode || "",
        standardProductName: li.standardProductName || "",
        standardProductRating: li.standardProductRating || "",
        newMfcQuantity: li.mfcQuantity || 0,
      };
    });
    renderMcLineItemsTable(projectId, data.lineItems);
  } catch(e) {
    contentEl.innerHTML = `<span style="color:#b91c1c;">Network error: ${e.message}</span>`;
  }
}

function renderMcLineItemsTable(projectId, lineItems) {
  const safeId = projectId.replace(/[^a-zA-Z0-9]/g, "_");
  const contentEl = document.getElementById(`mc-body-content-${safeId}`);

  const rowsHtml = lineItems.map(li => {
    const state = mcLineItemState[projectId][li.lineId];
    const searchVal = state.standardProductName
      ? `${state.standardProductName}${state.standardProductRating ? " " + state.standardProductRating : ""}`
      : "";
    return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-weight:600; vertical-align:middle;">${li.description}</td>
        <td style="padding:8px; position:relative; vertical-align:middle;">
          <textarea rows="1" id="mc-std-search-${safeId}-${li.lineId}"
            placeholder="Search Item Code..." autocomplete="off"
            oninput="handleMcProductSearch(this.value, '${projectId}', ${li.lineId}); mcAutoGrowField(this);"
            onfocus="mcAutoGrowField(this);"
            onkeydown="if(event.key==='Enter') event.preventDefault();"
            style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; font-size:0.8rem; border:1.5px solid var(--border); border-radius:4px; resize:none; overflow:hidden; font-family:inherit; min-height:32px;">${searchVal.replace(/</g,'&lt;')}</textarea>
          <div id="mc-std-dropdown-${safeId}-${li.lineId}" style="display:none; position:fixed; z-index:9999; background:#fff; border:1.5px solid var(--brand); border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.18); overflow-y:auto; min-width:280px;"></div>
        </td>
        <td style="padding:8px; text-align:center; vertical-align:middle;">${fmtQty(li.quantity)}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle;">${li.unit || "—"}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle; font-weight:700; color:#0369a1;">${fmtQty(li.mfcQuantity)}</td>
        <td style="padding:8px; text-align:center; vertical-align:middle;">
          <input type="number" id="mc-new-mfc-${safeId}-${li.lineId}" value="${trimNum(state.newMfcQuantity)}"
            min="0" max="${li.quantity}" step="any"
            oninput="clampMcNewMfcQty(this, '${projectId}', ${li.lineId})"
            style="width:100px; padding:5px 6px; text-align:center; font-family:monospace; font-weight:700; border:1.5px solid var(--border); border-radius:4px;" />
        </td>
      </tr>`;
  }).join("");

  contentEl.innerHTML = `
    <div style="overflow-x:auto; margin-bottom:14px;">
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem; table-layout:fixed;">
        <colgroup>
          <col style="width:22%;" /><col style="width:34%;" /><col style="width:10%;" />
          <col style="width:8%;" /><col style="width:14%;" /><col style="width:12%;" />
        </colgroup>
        <thead>
          <tr style="background:var(--highlight-bg); text-align:left;">
            <th style="padding:8px;">Order Product Description</th>
            <th style="padding:8px;">Standard Product Name *</th>
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
      <button class="nav-btn-styled" onclick="submitMcClearance('${projectId}')" style="background:var(--accent); padding:8px 20px; font-weight:700;">
        Submit Manufacturing Clearance
      </button>
    </div>
  `;
  contentEl.querySelectorAll('textarea').forEach(mcAutoGrowField);
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

  if (!query || query.trim().length < 1) {
    dropdown.style.display = "none";
    state.standardItemCode = ""; state.standardProductName = ""; state.standardProductRating = "";
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
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div onclick="selectMcProduct('${projectId}', ${lineId}, '${item.itemCode}', '${item.productName.replace(/'/g,"\\'")}', '${(item.rating||'').replace(/'/g,"\\'")}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${item.productName}${item.rating ? ` <span style="color:var(--brand); font-weight:700;">${item.rating}</span>` : ""}
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
  if (searchEl) { searchEl.value = rating ? `${productName} ${rating}` : productName; mcAutoGrowField(searchEl); }
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
      delete mcLineItemState[projectId];
      await loadMcLineItems(projectId);
    } else {
      alert(data.error || "Failed to submit Manufacturing Clearance.");
    }
  } catch(e) {
    alert("Network error: " + e.message);
  } finally {
    hideBlockingOverlay();
  }
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

