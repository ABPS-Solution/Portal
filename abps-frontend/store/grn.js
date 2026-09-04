// Per-item-code Authorized-PO options for the Store Entry PO dropdown,
// filled once per queue load (fetchStoreEntryPOOptions), topped up
// lazily whenever a line's item code resolves later via the material
// search (see design/item-codes.js's selectStoreEntryItemCodeMatch).
window._sePoOptionsCache = window._sePoOptionsCache || {};

async function initializeStoreEntryWorkspaceQueue() {
  const feed = document.getElementById("store-entry-queue-cards-feed");
  feed.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); gap:12px; color:var(--brand);">
      <div class="spinner" style="width:28px; height:28px; border:3px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <span style="font-size:0.9rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Loading Pending Store Entry List...</span>
    </div>`;
  try {
    const [, data] = await Promise.all([
      loadItemCodeCatalogIntoCache(),
      apFetch({ action: "fetchInwardWorkflowQueueStream", targetStep: "Gate Entered" })
    ]);
    if (!data.success || data.queue.length === 0) {
      feed.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);background:#fff;border:1px solid var(--border);border-radius:6px;">No records waiting for Raw Materials Store Entry and GRN.</div>';
      return;
    }

    // Batched PO-options lookup for every item code already resolved
    // from Gate Entry, across every card in this queue in one call.
    const allExistingCodes = [...new Set(
      data.queue.flatMap(item => item.lineItems.map(l => (l.itemCode || "").trim()).filter(Boolean))
    )];
    if (allExistingCodes.length > 0) {
      try {
        const poData = await apFetch({ action: "fetchStoreEntryPOOptions", itemCodes: allExistingCodes });
        if (poData.success) Object.assign(window._sePoOptionsCache, poData.optionsByItemCode || {});
      } catch (e) { console.error("fetchStoreEntryPOOptions failed:", e); }
    }

    // ── PASS 1: Render cards immediately with empty matchMap ──────────────
    feed.innerHTML = "";
    const catalog = window.itemCodeCatalogCache || [];
    const matchMap = {};

    data.queue.forEach((item, cardIdx) => {
      let trs = "";
      const matches = matchMap || {};

      item.lineItems.forEach((line, idx) => {
        const lineMatches = matches[`${cardIdx}_${idx}`] || [];
        const hasMatches = lineMatches.length > 0;
        const rawDesc = (line.invoiceDescription || line.materialName || "").replace(/</g,'&lt;').replace(/>/g,'&gt;');

        const confColors = {
          high:   { bg:"#dcfce7", color:"#15803d", border:"#86efac" },
          medium: { bg:"#fef3c7", color:"#b45309", border:"#fcd34d" },
          low:    { bg:"#f1f5f9", color:"#64748b", border:"#cbd5e1" }
        };

        // Search input for manual name lookup (same pattern as PO)
        const searchId = `se-search-${item.gateNumber}-${idx}`;
        const dropId   = `se-drop-${item.gateNumber}-${idx}`;
        const createUrl = window.location.pathname + "?module=design-itemcode";

        let suggestionHtml = "";
        if (hasMatches) {
          const pills = lineMatches.map((m) => {
            const c = confColors[m.confidence] || confColors.low;
            return `<div 
              onclick="selectStoreEntryItemCodeMatch('${item.gateNumber}', ${idx}, '${m.itemCode}', \`${m.productName.replace(/`/g,"'")}\`, '${m.typeOfMaterial}', this)"
              style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; border:1.5px solid ${c.border}; border-radius:4px; background:${c.bg}; cursor:pointer; margin-bottom:3px; transition:all 0.15s ease;"
              onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
              <div style="flex:1; min-width:0;">
                <span style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.75rem;">${m.itemCode}</span>
                <span style="font-size:0.75rem; font-weight:600; color:#1e293b; margin-left:6px; word-break:break-word;">${m.productName}</span>
              </div>
              <span style="font-size:0.63rem; font-weight:700; color:${c.color}; padding:1px 4px; background:#fff; border-radius:3px; border:1px solid ${c.border}; white-space:nowrap; margin-left:6px; flex-shrink:0;">${(m.confidence||"low").toUpperCase()}</span>
            </div>`;
          }).join("");
          suggestionHtml = `<div style="margin-top:5px;">
              <div style="font-size:0.6rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:3px; letter-spacing:0.4px;">Suggested matches:</div>
              ${pills}
            </div>`;
        } else {
          suggestionHtml = "";
        }

        // Pre-resolve if item code already exists from gate entry
        const existingCode = (line.itemCode || "").toString().trim();
        const catalogHit   = existingCode
          ? catalog.find(c => (c.itemCode || "").toUpperCase() === existingCode.toUpperCase())
          : null;
        const preFilledName = catalogHit ? (catalogHit.combinedName || catalogHit.productName) : (line.materialName || "");
        const preFilledType = catalogHit ? (catalogHit.typeOfMaterial || "") : "";
        const preFilledUnit = catalogHit ? (catalogHit.unit || "") : "";
        const isPreFilled   = !!existingCode;

        // Unit Converter: locked at 1 when Invoice Unit already matches
        // Item Code Unit (the common case), otherwise blank and required --
        // see updateSEUnitConverterLock, which re-derives this same
        // same-unit check live as either unit input changes.
        const invoiceUnitVal = (line.unitType || "NOS").toString().trim();
        const sameUnit = preFilledUnit && invoiceUnitVal.toLowerCase() === preFilledUnit.toLowerCase();

        const codeStyle = isPreFilled
          ? "font-size:0.78rem; padding:5px 4px; font-weight:800; border:1.5px solid #86efac; text-align:center; width:100%; background:#f0fdf4; color:var(--brand); border-radius:3px;"
          : "font-size:0.78rem; padding:5px 4px; font-weight:800; border:1.5px solid #fca5a5; text-align:center; width:100%; background:#fff7f7; color:#b91c1c; border-radius:3px;";

        trs += `<tr style="border-bottom:1px solid #f1f5f9; vertical-align:top;">
          <td style="padding:6px; width:140px; vertical-align:middle;">
            <input type="text" class="se-item-code-${item.gateNumber}" data-idx="${idx}"
              value="${existingCode}" placeholder="Not found"
              readonly
              style="${codeStyle}">
          </td>
          <td style="padding:8px; font-size:0.78rem; color:var(--text); white-space:normal; word-wrap:break-word; overflow-wrap:break-word; min-width:150px; max-width:200px; line-height:1.4;">
            ${rawDesc}
          </td>
          <td style="padding:6px; min-width:300px;">
            <div class="se-mat-name-display-${item.gateNumber}" data-idx="${idx}"
              onclick="reopenSEMaterialSearch('${item.gateNumber}', ${idx})"
              title="Click to change"
              style="${isPreFilled ? 'display:flex; justify-content:space-between; align-items:center; gap:6px; cursor:pointer;' : 'display:none; cursor:pointer;'} font-size:0.85rem; font-weight:700; color:var(--brand); padding:5px 6px; min-height:30px; border:1.5px solid var(--accent); border-radius:3px; background:#f0fdf4; line-height:1.4;">
              <span>${preFilledName}</span>
              <span style="font-size:0.65rem; font-weight:700; color:var(--muted); white-space:nowrap; flex-shrink:0;">✎ change</span>
            </div>
            <input type="hidden" class="se-mat-name-${item.gateNumber}" data-idx="${idx}" value="${preFilledName}" />
            <input type="hidden" class="se-material-type-${item.gateNumber}" data-idx="${idx}" value="${preFilledType}" />
            <div style="position:relative; margin-top:${isPreFilled ? '4px' : '0'};">
              <input type="text" id="${searchId}"
                placeholder="${isPreFilled ? 'Search to change...' : 'Type to search material name...'}"
                oninput="handleSENameSearch(this, '${item.gateNumber}', ${idx})"
                autocomplete="off"
                style="font-size:0.78rem; padding:4px 6px; border:1px solid var(--border); width:100%; border-radius:3px; ${isPreFilled ? 'display:none;' : ''}" />
              <div id="${dropId}" style="display:none; position:fixed; background:#fff; border:1px solid var(--border); border-radius:4px; z-index:9999; max-height:180px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:240px;"></div>
            </div>
            ${isPreFilled ? '' : suggestionHtml}
          </td>
          <td style="width:70px; padding:6px; vertical-align:middle;">
            <input type="text" class="se-invoice-unit-${item.gateNumber}" data-idx="${idx}" value="${invoiceUnitVal}"
              style="width:100%; text-align:center; font-family:monospace; font-weight:700; border:1px solid var(--border); padding:5px 2px; border-radius:3px;"
              onblur="updateSEUnitConverterLock('${item.gateNumber}', ${idx})">
          </td>
          <td style="width:70px; padding:6px; text-align:center; vertical-align:middle;">
            <input type="text" class="se-item-code-unit-${item.gateNumber}" data-idx="${idx}" value="${preFilledUnit}" readonly
              style="width:100%; text-align:center; font-family:monospace; font-weight:700; border:none; background:transparent; color:#1e293b;">
          </td>
          <td style="width:85px; padding:6px; text-align:center; vertical-align:middle;">
            <input type="number" class="se-unit-converter-${item.gateNumber}" data-idx="${idx}"
              value="${sameUnit ? '1' : ''}" ${sameUnit ? 'readonly' : ''} step="any" min="0"
              placeholder="${sameUnit ? '' : 'Factor'}"
              title="${sameUnit ? 'Locked at 1 — Invoice Unit already matches Item Code Unit' : 'Units differ — enter the factor that converts Invoice Unit to Item Code Unit'}"
              style="width:100%; text-align:center; font-weight:700; padding:5px; font-size:0.85rem; border-radius:3px;${sameUnit ? ' border:1px solid var(--border); background:#f1f5f9; color:var(--muted); cursor:not-allowed;' : ' border:1.5px solid #f59e0b; background:#fffbeb;'}">
          </td>
          <td class="se-po-cell-${item.gateNumber}" data-idx="${idx}" style="width:190px; padding:6px; vertical-align:top;">
            <div class="se-po-parts-wrap-${item.gateNumber}" data-idx="${idx}">
              ${sePoPartBlockHtml(item.gateNumber, idx, 0, line.poNo || "")}
            </div>
            <div class="se-po-sum-${item.gateNumber}" data-idx="${idx}" style="font-size:0.62rem; font-weight:700; margin-top:2px; display:none;"></div>
            <div style="margin-top:4px;">
              <span onclick="addSEPartRow('${item.gateNumber}', ${idx})" style="font-size:0.65rem; font-weight:700; color:var(--brand); cursor:pointer; text-decoration:underline;">+ Split</span>
            </div>
          </td>
          <td class="se-invqty-cell-${item.gateNumber}" data-idx="${idx}" style="text-align:center; color:#1e293b; font-weight:800; vertical-align:top; width:75px; font-family:monospace; font-size:0.9rem; padding:6px;">
            <div class="se-invqty-parts-wrap-${item.gateNumber}" data-idx="${idx}">
              ${seInvQtyPartBlockHtml(item.gateNumber, idx, 0, line.gateQuantity, true)}
            </div>
            <div class="se-invqty-sum-${item.gateNumber}" data-idx="${idx}" data-total="${line.gateQuantity}" style="font-size:0.58rem; color:var(--muted); margin-top:2px; display:none;"></div>
          </td>
          <td class="se-recvqty-cell-${item.gateNumber}" data-idx="${idx}" style="text-align:center; width:100px; padding:6px 6px 6px 16px; vertical-align:top;">
            <div class="se-recvqty-parts-wrap-${item.gateNumber}" data-idx="${idx}">
              ${seRecvQtyPartBlockHtml(item.gateNumber, idx, 0, line.gateQuantity)}
            </div>
          </td>
        </tr>`;
      });

      // Date formatting
      let cleanDateDisplay = formatOrdinalDateTime(item.invoiceDate) || item.invoiceDate || "";

      let card = document.createElement("div");
      card.className = "contact-summary-card-parent";
      card.innerHTML = `
        <div class="contact-summary-header-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='block'?'none':'block'" style="cursor:pointer; width:100%; padding-bottom:8px;">
          <div class="contact-summary-title-info" style="width:100%;">
            <div class="meta-row-line-block" style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <div>
                <span style="background:var(--brand);color:#fff; padding:3px 8px; font-weight:700;">GATE ID: ${item.gateNumber}</span>
                <span style="background:#e0f2fe;color:#0369a1;font-weight:700; margin-left:4px;">INVOICE: ${item.invoiceNumber}</span>
                ${item.challanNumber ? `<span style="background:#f0fdf4;color:#15803d;font-weight:700; margin-left:4px;">CHALLAN: ${item.challanNumber}</span>` : ''}
              </div>
              <span style="background:#cbd5e1;color:#1e293b;font-weight:700; font-size:0.8rem; padding:3px 8px;">${cleanDateDisplay}</span>
            </div>
            <div style="font-size:0.85rem; margin-top:8px; color:var(--muted); font-weight:600; padding-left:2px;">
              Vendor: <strong style="color:var(--text); font-weight:700;">${item.vendorName || "Designated ABPS Supplier Profile"}</strong>
            </div>
          </div>
        </div>
        <div style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;">
          <div style="max-width:300px; margin-bottom:14px;">
            <label class="field-label">Default PO — applies to any line left unassigned</label>
            <input type="text" id="se-po-number-${item.gateNumber}" value="${item.defaultPoNo || ''}" placeholder="e.g. PO_26-27_00002"
              style="width:100%; padding:6px; background:#f1f5f9; border:1.5px solid var(--border); border-radius:3px;"
              onblur="checkStoreEntryPONumber('${item.gateNumber}'); applyDefaultPOToAllLines('${item.gateNumber}');">
            <div id="se-po-check-msg-${item.gateNumber}" style="font-size:0.68rem; font-weight:700; margin-top:3px;"></div>
          </div>
          <div style="overflow-x:auto; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius);">
            <table class="store-basket-data-table" style="width:100%; table-layout:fixed; min-width:1090px; border-collapse:collapse;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="width:100px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Item Code</th>
                  <th style="width:200px; text-align:left; font-size:0.72rem; padding:8px 6px;">Invoice Material Description</th>
                  <th style="width:230px; text-align:left; font-size:0.72rem; padding:8px 6px;">Standard Material Name *</th>
                  <th style="width:70px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Invoice Unit</th>
                  <th style="width:70px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Item Code Unit</th>
                  <th style="width:80px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Unit Converter</th>
                  <th style="width:190px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Purchase Order *</th>
                  <th style="width:75px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Invoice Qty</th>
                  <th style="width:100px; text-align:center; font-size:0.72rem; padding:8px 6px 8px 16px; white-space:nowrap;">Received Qty *</th>
                </tr>
              </thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
          <div style="display:flex; justify-content:flex-end; margin-top:10px;">
            <button class="nav-btn-styled" style="background:var(--accent);" 
              onclick="commitStoreEntryVerificationToBackend('${item.gateNumber}', \`${encodeURIComponent(JSON.stringify(item))}\`)">
              Submit Store Entry and GRN
            </button>
          </div>
        </div>`;
      feed.appendChild(card);
    });

    // ── PASS 2: Gemini matching in background — inject pills when ready ───
    const allLineItemsFlat = [];
    data.queue.forEach((item, cardIdx) => {
      item.lineItems.forEach((line, lineIdx) => {
        allLineItemsFlat.push({ cardIdx, lineIdx, gateNumber: item.gateNumber, rawDescription: line.materialName || line.rawDescriptionLine || "" });
      });
    });
    const lineItemsWithCandidates = allLineItemsFlat.map(li => ({
      ...li,
      candidatesTop60: fuzzyPreFilterCatalog(li.rawDescription, catalog, 60)
    }));
    try {
      const matchData = await apFetch({
        action: "matchStoreEntryItemCodes",
        lineItems: lineItemsWithCandidates.map(li => ({ rawDescription: li.rawDescription, candidatesTop60: li.candidatesTop60 }))
      });
      if (matchData.success) {
        const confColors = {
          high:   { bg:"#dcfce7", color:"#15803d", border:"#86efac" },
          medium: { bg:"#fef3c7", color:"#b45309", border:"#fcd34d" },
          low:    { bg:"#f1f5f9", color:"#64748b", border:"#cbd5e1" }
        };
        matchData.matches.forEach((result, flatIdx) => {
          const li = lineItemsWithCandidates[flatIdx];
          if (!li || !result.matches || result.matches.length === 0) return;
          // Only inject into rows that are NOT already pre-filled
          const codeInput = document.querySelector(`.se-item-code-${li.gateNumber}[data-idx="${li.lineIdx}"]`);
          if (codeInput && codeInput.value.trim()) return; // already has a code
          // Find the suggestion slot in the rendered card
          const searchInput = document.getElementById(`se-search-${li.gateNumber}-${li.lineIdx}`);
          if (!searchInput) return;
          const nameCell = searchInput.closest("td");
          if (!nameCell) return;
          // Remove any existing suggestion block first
          const existing = nameCell.querySelector(".se-suggestion-block");
          if (existing) existing.remove();
          const pills = result.matches.map((m) => {
            const c = confColors[m.confidence] || confColors.low;
            // Gemini's match result only ever carries {itemCode, confidence}
            // (see lib/gemini.js's matchStoreEntryItemCodes prompt schema) —
            // productName/typeOfMaterial/unit have to be resolved locally
            // against the catalog cache already loaded for this screen.
            const catHit = catalog.find(cc => (cc.itemCode || "").toUpperCase() === (m.itemCode || "").toUpperCase());
            const displayName = catHit ? (catHit.combinedName || catHit.productName) : m.itemCode;
            const typeOfMaterial = catHit ? (catHit.typeOfMaterial || "") : "";
            const unit = catHit ? (catHit.unit || "") : "";
            return `<div
              onclick="selectStoreEntryItemCodeMatch('${li.gateNumber}', ${li.lineIdx}, '${m.itemCode}', \`${displayName.replace(/`/g,"'")}\`, '${typeOfMaterial}', this, '${unit}')"
              style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; border:1.5px solid ${c.border}; border-radius:4px; background:${c.bg}; cursor:pointer; margin-bottom:3px; transition:all 0.15s ease;"
              onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
              <div style="flex:1; min-width:0;">
                <span style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.75rem;">${m.itemCode}</span>
                <span style="font-size:0.75rem; font-weight:600; color:#1e293b; margin-left:6px; word-break:break-word;">${displayName}</span>
              </div>
              <span style="font-size:0.63rem; font-weight:700; color:${c.color}; padding:1px 4px; background:#fff; border-radius:3px; border:1px solid ${c.border}; white-space:nowrap; margin-left:6px; flex-shrink:0;">${(m.confidence||"low").toUpperCase()}</span>
            </div>`;
          }).join("");
          const suggBlock = document.createElement("div");
          suggBlock.className = "se-suggestion-block";
          suggBlock.style.cssText = "margin-top:5px;";
          suggBlock.innerHTML = `<div style="font-size:0.6rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:3px; letter-spacing:0.4px;">Suggested matches:</div>${pills}`;
          nameCell.appendChild(suggBlock);
        });
      }
    } catch(e) {
      console.error("Store Entry ItemCode background matching failed:", e);
    }

  } catch(e) { feed.innerHTML = `<p style="color:var(--warn);">${e.message}</p>`; }
}

// ── Multi-PO Store Entry: PO parts, split, and the shared floating
// PO dropdown ────────────────────────────────────────────────────────
// A GRN can now span multiple POs — each invoice line (or a split piece
// of one line) carries its own PO. Parts live INSIDE the row's PO/
// Invoice Qty/Received Qty cells (never as extra <tr>s), because
// data-idx is the join key every other Store Entry helper
// (updateSEUnitConverterLock, selectStoreEntryItemCodeMatch,
// reopenSEMaterialSearch, handleSENameSearch) uses to find a row —
// duplicating data-idx across sibling <tr>s would make all of those
// silently hit part 0 only.

function sePoPartBlockHtml(gateNum, idx, part, poNo) {
  const trigger = poNo || "Select PO…";
  const borderColor = poNo ? "#86efac" : "#fca5a5";
  return `<div class="se-po-part-${gateNum}" data-idx="${idx}" data-part="${part}" style="margin-bottom:4px; display:flex; align-items:center; gap:4px;">
    <div class="se-po-trigger-${gateNum}" data-idx="${idx}" data-part="${part}"
      onclick="toggleSEPODropdown('${gateNum}', ${idx}, ${part}, this)"
      style="flex:1; cursor:pointer; padding:5px 6px; border:1.5px solid ${borderColor}; border-radius:3px; font-size:0.7rem; font-weight:700; background:#fff; min-height:26px; display:flex; align-items:center; justify-content:space-between; gap:4px; overflow:hidden;">
      <span class="se-po-trigger-label-${gateNum}" data-idx="${idx}" data-part="${part}" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${trigger}</span>
      <span style="font-size:0.6rem; flex-shrink:0;">▾</span>
    </div>
    <input type="hidden" class="se-po-value-${gateNum}" data-idx="${idx}" data-part="${part}" value="${poNo || ''}">
    ${part > 0 ? `<span onclick="removeSEPartRow('${gateNum}', ${idx}, ${part})" title="Remove this split" style="cursor:pointer; color:#b91c1c; font-weight:800; font-size:0.85rem; flex-shrink:0;">✕</span>` : ''}
  </div>`;
}

function seInvQtyPartBlockHtml(gateNum, idx, part, value, readonly) {
  return `<div class="se-invqty-part-${gateNum}" data-idx="${idx}" data-part="${part}" style="margin-bottom:4px;">
    <input type="number" class="se-invqty-input-${gateNum}" data-idx="${idx}" data-part="${part}"
      value="${value}" ${readonly ? 'readonly' : ''} step="any" min="0"
      oninput="recalcSEPartSums('${gateNum}', ${idx})"
      style="width:100%; text-align:center; font-weight:800; font-family:monospace; font-size:0.9rem; border-radius:3px; ${readonly ? 'border:none; background:transparent; color:#1e293b;' : 'border:1px solid var(--border); padding:5px 2px;'}">
  </div>`;
}

function seRecvQtyPartBlockHtml(gateNum, idx, part, value) {
  return `<div class="se-recvqty-part-${gateNum}" data-idx="${idx}" data-part="${part}" style="margin-bottom:4px;">
    <input type="number" class="se-phys-qty-${gateNum}" data-idx="${idx}" data-part="${part}"
      value="${value}" step="any" min="0"
      style="width:100%; font-weight:700; text-align:center; border:1.5px solid var(--brand); padding:5px; font-size:0.9rem; border-radius:3px;">
  </div>`;
}

// addSEPartRow — splits a line into another PO-tagged part. Mutates the
// PO/Invoice Qty/Received Qty cells in place (never re-renders the whole
// table, which would wipe the operator's item-code/material selections).
function addSEPartRow(gateNum, idx) {
  const poWrap = document.querySelector(`.se-po-parts-wrap-${gateNum}[data-idx="${idx}"]`);
  const invWrap = document.querySelector(`.se-invqty-parts-wrap-${gateNum}[data-idx="${idx}"]`);
  const recvWrap = document.querySelector(`.se-recvqty-parts-wrap-${gateNum}[data-idx="${idx}"]`);
  if (!poWrap || !invWrap || !recvWrap) return;

  const existingParts = poWrap.querySelectorAll(`.se-po-part-${gateNum}[data-idx="${idx}"]`).length;
  const newPart = existingParts; // dense 0..n

  // First split: unlock the invoice-qty input on part 0 so it becomes
  // editable (it was a readonly full-line display until now).
  if (existingParts === 1) {
    const part0Input = document.querySelector(`.se-invqty-input-${gateNum}[data-idx="${idx}"][data-part="0"]`);
    if (part0Input) { part0Input.readOnly = false; part0Input.style.border = '1px solid var(--border)'; part0Input.style.background = '#fff'; part0Input.style.padding = '5px 2px'; }
  }

  poWrap.insertAdjacentHTML('beforeend', sePoPartBlockHtml(gateNum, idx, newPart, ""));
  invWrap.insertAdjacentHTML('beforeend', seInvQtyPartBlockHtml(gateNum, idx, newPart, 0, false));
  recvWrap.insertAdjacentHTML('beforeend', seRecvQtyPartBlockHtml(gateNum, idx, newPart, 0));
  recalcSEPartSums(gateNum, idx);
}

function removeSEPartRow(gateNum, idx, part) {
  document.querySelector(`.se-po-part-${gateNum}[data-idx="${idx}"][data-part="${part}"]`)?.remove();
  document.querySelector(`.se-invqty-part-${gateNum}[data-idx="${idx}"][data-part="${part}"]`)?.remove();
  document.querySelector(`.se-recvqty-part-${gateNum}[data-idx="${idx}"][data-part="${part}"]`)?.remove();

  // Re-number remaining parts densely (0..n) so the backend's part index
  // and the "remove" affordance (only shown for part > 0) stay correct.
  const remaining = [...document.querySelectorAll(`.se-po-part-${gateNum}[data-idx="${idx}"]`)]
    .sort((a, b) => Number(a.dataset.part) - Number(b.dataset.part));
  remaining.forEach((el, newIdx) => {
    const oldPart = el.dataset.part;
    if (String(newIdx) === oldPart) return;
    [`.se-po-part-${gateNum}`, `.se-invqty-part-${gateNum}`, `.se-recvqty-part-${gateNum}`].forEach(cls => {
      document.querySelectorAll(`${cls}[data-idx="${idx}"][data-part="${oldPart}"] [data-part]`)
        .forEach(sub => sub.dataset.part = String(newIdx));
      const wrapEl = document.querySelector(`${cls}[data-idx="${idx}"][data-part="${oldPart}"]`);
      if (wrapEl) wrapEl.dataset.part = String(newIdx);
    });
  });

  // Back to a single part: relock the invoice-qty input to the full line total.
  const stillThere = document.querySelectorAll(`.se-po-part-${gateNum}[data-idx="${idx}"]`);
  if (stillThere.length === 1) {
    const totalEl = document.querySelector(`.se-invqty-sum-${gateNum}[data-idx="${idx}"]`);
    const total = totalEl ? Number(totalEl.dataset.total) || 0 : 0;
    const onlyInput = document.querySelector(`.se-invqty-input-${gateNum}[data-idx="${idx}"][data-part="0"]`);
    if (onlyInput) {
      onlyInput.value = total;
      onlyInput.readOnly = true;
      onlyInput.style.border = 'none'; onlyInput.style.background = 'transparent'; onlyInput.style.padding = '';
    }
  }
  recalcSEPartSums(gateNum, idx);
}

// Live "allocated so far / line total" indicator, red on mismatch —
// commitStoreEntryPipelineStep re-validates this sum server-side against
// the ledger row's own quantity_received, so this is purely operator
// feedback, never the actual guard.
function recalcSEPartSums(gateNum, idx) {
  const totalEl = document.querySelector(`.se-invqty-sum-${gateNum}[data-idx="${idx}"]`);
  if (!totalEl) return;
  const total = Number(totalEl.dataset.total) || 0;
  const inputs = document.querySelectorAll(`.se-invqty-input-${gateNum}[data-idx="${idx}"]`);
  if (inputs.length <= 1) { totalEl.style.display = 'none'; return; }
  const sum = [...inputs].reduce((s, el) => s + (Number(el.value) || 0), 0);
  const ok = Math.abs(sum - total) < 1e-9;
  totalEl.style.display = 'block';
  totalEl.style.color = ok ? '#15803d' : '#b91c1c';
  totalEl.textContent = `Σ ${trimNum(sum)} / ${trimNum(total)}`;
}

// The shared floating PO dropdown — single element appended to
// document.body with position:fixed, positioned via the trigger's own
// getBoundingClientRect() on open. Required because the table wrapper is
// overflow-x:auto (see grn.js's card markup) — an absolutely-positioned
// child would get clipped against that wrapper instead of floating over
// the page. Same pattern as production/fg-approval.js's doc-type dropdown.
let _sePoDropdownCtx = null; // { gateNum, idx, part }

function ensureSEPODropdownEl() {
  let dd = document.getElementById("se-po-shared-dd");
  if (!dd) {
    dd = document.createElement("div");
    dd.id = "se-po-shared-dd";
    dd.style.cssText = "display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:240px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15); min-width:260px;";
    document.body.appendChild(dd);
  }
  return dd;
}

function toggleSEPODropdown(gateNum, idx, part, triggerEl) {
  const dd = ensureSEPODropdownEl();
  const alreadyOpenForThisPart = dd.style.display === "block" && _sePoDropdownCtx
    && _sePoDropdownCtx.gateNum === gateNum && _sePoDropdownCtx.idx === idx && _sePoDropdownCtx.part === part;
  if (alreadyOpenForThisPart) { dd.style.display = "none"; _sePoDropdownCtx = null; return; }

  const itemCode = (document.querySelector(`.se-item-code-${gateNum}[data-idx="${idx}"]`)?.value || "").trim();
  const options = (itemCode && window._sePoOptionsCache[itemCode]) || [];
  dd.innerHTML = options.length === 0
    ? `<div style="padding:8px 10px; font-size:0.75rem; color:var(--muted);">${itemCode ? 'No Authorized PO found for this Item Code.' : 'Resolve the Item Code first.'}</div>`
    : options.map(o => {
        const vendorTag = o.vendorMatch ? '' : `<span style="color:#b45309; font-weight:700;">⚠ diff. vendor</span>`;
        const fullyTag = o.fullyReceived ? `<span style="color:var(--muted);">fully received</span>` : '';
        return `<div onclick="selectSEPOOption('${o.poNo}', this)"
            style="padding:6px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.75rem;"
            onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
          <div style="font-weight:800; font-family:monospace; color:var(--brand);">${o.poNo}</div>
          <div style="color:var(--muted); display:flex; justify-content:space-between; gap:6px;">
            <span>Ordered ${trimNum(o.orderedQty)} · Received ${trimNum(o.receivedQty)} · Outstanding ${trimNum(o.outstandingQty)} ${o.unit || ''}</span>
            <span>${vendorTag}${fullyTag}</span>
          </div>
        </div>`;
      }).join("");

  const rect = triggerEl.getBoundingClientRect();
  dd.style.top = rect.bottom + "px";
  dd.style.left = rect.left + "px";
  dd.style.width = Math.max(rect.width, 260) + "px";
  dd.style.display = "block";
  _sePoDropdownCtx = { gateNum, idx, part };
}

function selectSEPOOption(poNo, clickedEl) {
  if (!_sePoDropdownCtx) return;
  const { gateNum, idx, part } = _sePoDropdownCtx;
  const valueInput = document.querySelector(`.se-po-value-${gateNum}[data-idx="${idx}"][data-part="${part}"]`);
  const label = document.querySelector(`.se-po-trigger-label-${gateNum}[data-idx="${idx}"][data-part="${part}"]`);
  const trigger = document.querySelector(`.se-po-trigger-${gateNum}[data-idx="${idx}"][data-part="${part}"]`);
  if (valueInput) valueInput.value = poNo;
  if (label) label.textContent = poNo;
  if (trigger) trigger.style.borderColor = "#86efac";
  ensureSEPODropdownEl().style.display = "none";
  _sePoDropdownCtx = null;
}

// A line whose PO is still unassigned adopts the header's Default PO —
// never overwrites a part that already has an explicit choice.
function applyDefaultPOToAllLines(gateNum) {
  const defaultPo = (document.getElementById(`se-po-number-${gateNum}`)?.value || "").trim();
  if (!defaultPo) return;
  document.querySelectorAll(`.se-po-value-${gateNum}`).forEach(input => {
    if (input.value.trim()) return;
    input.value = defaultPo;
    const idx = input.dataset.idx, part = input.dataset.part;
    const label = document.querySelector(`.se-po-trigger-label-${gateNum}[data-idx="${idx}"][data-part="${part}"]`);
    const trigger = document.querySelector(`.se-po-trigger-${gateNum}[data-idx="${idx}"][data-part="${part}"]`);
    if (label) label.textContent = defaultPo;
    if (trigger) trigger.style.borderColor = "#86efac";
  });
}

// Item-code change invalidates whatever PO was picked for that row (the
// PO options are keyed by item code) — called alongside
// updateSEUnitConverterLock from design/item-codes.js's
// selectStoreEntryItemCodeMatch.
function resetSEPOSelectionsForRow(gateNum, idx) {
  document.querySelectorAll(`.se-po-value-${gateNum}[data-idx="${idx}"]`).forEach(input => {
    input.value = "";
    const part = input.dataset.part;
    const label = document.querySelector(`.se-po-trigger-label-${gateNum}[data-idx="${idx}"][data-part="${part}"]`);
    const trigger = document.querySelector(`.se-po-trigger-${gateNum}[data-idx="${idx}"][data-part="${part}"]`);
    if (label) label.textContent = "Select PO…";
    if (trigger) trigger.style.borderColor = "#fca5a5";
  });
}

document.addEventListener("click", function(e) {
  const dd = document.getElementById("se-po-shared-dd");
  if (!dd || dd.style.display !== "block") return;
  if (e.target.closest && (e.target.closest("#se-po-shared-dd") || e.target.closest("[class^='se-po-trigger-']"))) return;
  dd.style.display = "none";
  _sePoDropdownCtx = null;
});

