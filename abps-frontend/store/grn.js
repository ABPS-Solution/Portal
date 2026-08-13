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
        const isPreFilled   = !!existingCode;

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
          <td style="text-align:center; color:#64748b; font-weight:700; vertical-align:middle; width:55px; font-family:monospace; font-size:0.9rem;">
            ${line.unitType || "NOS"}
          </td>
          <td style="text-align:center; color:#1e293b; font-weight:800; vertical-align:middle; width:65px; font-family:monospace; font-size:0.95rem;">
            ${line.gateQuantity}
          </td>
          <td style="text-align:center; width:85px; padding:6px 6px 6px 16px; vertical-align:middle;">
            <input type="number" class="se-phys-qty-${item.gateNumber}" data-idx="${idx}"
              value="${line.gateQuantity}"
              style="width:100%; font-weight:700; text-align:center; border:1.5px solid var(--brand); padding:5px; font-size:0.9rem; border-radius:3px;"
              oninput="updateSERowAmounts('${item.gateNumber}', ${idx})">
          </td>
          <td style="text-align:center; width:75px; padding:6px; vertical-align:middle;">
            <input type="number" class="se-rate-${item.gateNumber}" data-idx="${idx}"
              value="${line.ratePerQuantity || ''}" placeholder="Rate" readonly title="Locked — calculated from the invoice's Rate/Qty and Disc %"
              style="width:100%; text-align:center; font-weight:700; border:1.5px solid ${line.ratePerQuantity > 0 ? '#86efac' : '#f59e0b'}; background:#f0fdf4; color:#15803d; cursor:not-allowed; padding:5px; font-size:0.9rem; border-radius:3px;">
          </td>
          <td style="text-align:center; width:70px; padding:6px; vertical-align:middle;">
            <input type="number" class="se-gst-${item.gateNumber}" data-idx="${idx}"
              value="${line.gstPercent || 18}" placeholder="GST%"
              style="width:100%; text-align:center; font-weight:700; border:1px solid var(--border); padding:5px; font-size:0.9rem; border-radius:3px;"
              oninput="updateSERowAmounts('${item.gateNumber}', ${idx})">
          </td>
          <td style="text-align:right; width:100px; padding:6px; vertical-align:middle; font-family:monospace; font-size:0.95rem; font-weight:700;">
            <span class="se-amount-display-${item.gateNumber}" data-idx="${idx}">${(((line.gateQuantity || 0) * (line.ratePerQuantity || 0)) * (1 + (line.gstPercent || 18) / 100)).toLocaleString("en-IN",{maximumFractionDigits:2})}</span>
            <input type="hidden" class="se-basic-amt-${item.gateNumber}" data-idx="${idx}" value="${((line.gateQuantity || 0) * (line.ratePerQuantity || 0)).toFixed(2)}" />
            <input type="hidden" class="se-inv-amt-${item.gateNumber}" data-idx="${idx}" value="${(((line.gateQuantity || 0) * (line.ratePerQuantity || 0)) * (1 + (line.gstPercent || 18) / 100)).toFixed(2)}" />
          </td>
        </tr>`;
      });

      // Date formatting
      let cleanDateDisplay = formatDateTimeDMY(item.invoiceDate) || item.invoiceDate || "";

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
            <label class="field-label">PO Number *</label>
            <input type="text" id="se-po-number-${item.gateNumber}" value="${item.poNo || ''}" placeholder="e.g. PO_26-27_00002"
              style="width:100%; padding:6px; background:#f1f5f9; border:1.5px solid ${item.poNo ? '#86efac' : '#fca5a5'}; border-radius:3px;"
              onblur="checkStoreEntryPONumber('${item.gateNumber}')">
            <div id="se-po-check-msg-${item.gateNumber}" style="font-size:0.68rem; font-weight:700; margin-top:3px;"></div>
          </div>
          <div style="overflow-x:auto; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius);">
            <table class="store-basket-data-table" style="width:100%; table-layout:fixed; min-width:900px; border-collapse:collapse;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="width:95px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Item Code</th>
                  <th style="width:250px; text-align:left; font-size:0.72rem; padding:8px 6px;">Invoice Material Description</th>
                  <th style="width:280px; text-align:left; font-size:0.72rem; padding:8px 6px;">Standard Material Name *</th>
                  <th style="width:55px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Unit</th>
                  <th style="width:65px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Invoice Qty</th>
                  <th style="width:85px; text-align:center; font-size:0.72rem; padding:8px 6px 8px 16px; white-space:nowrap;">Received Qty *</th>
                  <th style="width:75px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Rate / Qty</th>
                  <th style="width:60px; text-align:center; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">GST %</th>
                  <th style="width:95px; text-align:right; font-size:0.72rem; padding:8px 6px; white-space:nowrap;">Amount (Incl. GST)</th>
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
            return `<div 
              onclick="selectStoreEntryItemCodeMatch('${li.gateNumber}', ${li.lineIdx}, '${m.itemCode}', \`${m.productName.replace(/`/g,"'")}\`, '${m.typeOfMaterial}', this)"
              style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; border:1.5px solid ${c.border}; border-radius:4px; background:${c.bg}; cursor:pointer; margin-bottom:3px; transition:all 0.15s ease;"
              onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
              <div style="flex:1; min-width:0;">
                <span style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.75rem;">${m.itemCode}</span>
                <span style="font-size:0.75rem; font-weight:600; color:#1e293b; margin-left:6px; word-break:break-word;">${m.productName}</span>
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

