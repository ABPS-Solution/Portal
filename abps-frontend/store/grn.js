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
              onclick="selectStoreEntryItemCodeMatch('${item.gateNumber}', ${idx}, '${m.itemCode}', ${jsArg(m.productName)}, ${jsArg(m.typeOfMaterial)}, this)"
              style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; border:1.5px solid ${c.border}; border-radius:4px; background:${c.bg}; cursor:pointer; margin-bottom:3px; transition:all 0.15s ease;"
              onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
              <div style="flex:1; min-width:0;">
                <span style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.75rem;">${m.itemCode}</span>
                <span style="font-size:0.75rem; font-weight:600; color:#1e293b; margin-left:6px; word-break:break-word;">${escapeHtml(m.productName)}</span>
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

        trs += `<tr style="border-bottom:1px solid #f1f5f9; vertical-align:middle;">
          <td style="padding:6px; width:100px; text-align:center; vertical-align:middle;">
            <input type="text" class="se-item-code-${item.gateNumber}" data-idx="${idx}"
              value="${existingCode}" placeholder="Not found"
              readonly
              style="${codeStyle}">
          </td>
          <td style="padding:8px; font-size:0.78rem; color:var(--text); white-space:normal; word-wrap:break-word; overflow-wrap:break-word; width:240px; line-height:1.4; text-align:center; vertical-align:middle; border-left:1px solid var(--border);">
            ${rawDesc}
          </td>
          <td style="padding:6px; width:280px; text-align:center; vertical-align:middle; border-left:1px solid var(--border);">
            <div class="se-mat-name-display-${item.gateNumber}" data-idx="${idx}"
              onclick="reopenSEMaterialSearch('${item.gateNumber}', ${idx})"
              title="Click to change"
              style="${isPreFilled ? 'display:flex; justify-content:space-between; align-items:center; gap:6px; cursor:pointer;' : 'display:none; cursor:pointer;'} font-size:0.85rem; font-weight:700; color:var(--brand); padding:5px 6px; min-height:30px; border:1.5px solid var(--accent); border-radius:3px; background:#f0fdf4; line-height:1.4;">
              <span>${escapeHtml(preFilledName)}</span>
              <span style="font-size:0.65rem; font-weight:700; color:var(--muted); white-space:nowrap; flex-shrink:0;">✎ change</span>
            </div>
            <input type="hidden" class="se-mat-name-${item.gateNumber}" data-idx="${idx}" value="${escapeHtml(preFilledName)}" />
            <input type="hidden" class="se-material-type-${item.gateNumber}" data-idx="${idx}" value="${preFilledType}" />
            <div style="position:relative; margin-top:${isPreFilled ? '4px' : '0'};">
              <input type="text" id="${searchId}"
                placeholder="${isPreFilled ? 'Search to change...' : 'Type to search material name...'}"
                oninput="handleSENameSearch(this, '${item.gateNumber}', ${idx})"
                autocomplete="off"
                style="font-size:0.78rem; padding:4px 6px; border:1px solid var(--border); width:100%; border-radius:3px; text-align:center; ${isPreFilled ? 'display:none;' : ''}" />
              <div id="${dropId}" style="display:none; position:fixed; background:#fff; border:1px solid var(--border); border-radius:4px; z-index:9999; max-height:180px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:240px;"></div>
            </div>
            ${isPreFilled ? '' : suggestionHtml}
          </td>
          <td style="width:90px; padding:6px; text-align:center; vertical-align:middle; border-left:1px solid var(--border);">
            <input type="text" class="se-invoice-unit-${item.gateNumber}" data-idx="${idx}" value="${escapeHtml(invoiceUnitVal)}" readonly
              style="width:100%; text-align:center; font-family:monospace; font-weight:700; border:none; background:transparent; color:#1e293b;">
          </td>
          <td style="width:100px; padding:6px; text-align:center; vertical-align:middle; border-left:1px solid var(--border);">
            <input type="text" class="se-item-code-unit-${item.gateNumber}" data-idx="${idx}" value="${escapeHtml(preFilledUnit)}" readonly
              style="width:100%; text-align:center; font-family:monospace; font-weight:700; border:none; background:transparent; color:#1e293b;">
          </td>
          <td style="width:100px; padding:6px; text-align:center; vertical-align:middle; border-left:1px solid var(--border);">
            <input type="number" class="se-unit-converter-${item.gateNumber}" data-idx="${idx}"
              value="${sameUnit ? '1' : ''}" ${sameUnit ? 'readonly' : ''} step="any" min="0"
              placeholder="${sameUnit ? '' : 'Factor'}"
              title="${sameUnit ? 'Locked at 1 — Invoice Unit already matches Item Code Unit' : 'Units differ — enter the factor that converts Invoice Unit to Item Code Unit'}"
              style="width:100%; text-align:center; font-weight:700; padding:5px; font-size:0.85rem; border-radius:3px;${sameUnit ? ' border:1px solid var(--border); background:#f1f5f9; color:var(--muted); cursor:not-allowed;' : ' border:1.5px solid #f59e0b; background:#fffbeb;'}">
          </td>
          <td class="se-invqty-cell-${item.gateNumber}" data-idx="${idx}" style="width:100px; padding:6px; text-align:center; vertical-align:middle; border-left:1px solid var(--border);">
            <input type="number" class="se-invqty-input-${item.gateNumber}" data-idx="${idx}" value="${line.gateQuantity}" step="any" min="0"
              style="width:100%; text-align:center; font-weight:800; font-family:monospace; font-size:1.05rem; border:1px solid var(--border); padding:5px 2px; border-radius:3px;">
          </td>
          <td class="se-recvqty-cell-${item.gateNumber}" data-idx="${idx}" style="text-align:center; width:130px; padding:6px; vertical-align:middle; border-left:1px solid var(--border);">
            <input type="number" class="se-phys-qty-${item.gateNumber}" data-idx="${idx}" value="${line.gateQuantity}" step="any" min="0"
              style="width:100%; font-weight:700; text-align:center; border:1.5px solid var(--brand); padding:5px; font-size:1.05rem; border-radius:3px;">
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
              Vendor: <strong style="color:var(--text); font-weight:700;">${escapeHtml(item.vendorName || "Designated ABPS Supplier Profile")}</strong>
            </div>
          </div>
        </div>
        <div style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;">
          <div style="max-width:300px; margin-bottom:14px;">
            <label class="field-label">PO Number</label>
            <input type="text" id="se-po-number-${item.gateNumber}" value="${item.defaultPoNo || ''}" placeholder="e.g. PO_26-27_00002"
              style="width:100%; padding:6px; background:#f1f5f9; border:1.5px solid var(--border); border-radius:3px;"
              onblur="checkStoreEntryPONumber('${item.gateNumber}');">
            <div id="se-po-check-msg-${item.gateNumber}" style="font-size:0.68rem; font-weight:700; margin-top:3px;"></div>
          </div>
          <div style="max-width:620px; margin:-6px 0 14px;">
            <label class="field-label">Or: Delivery Challan No (returning material)</label>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <input type="text" id="se-processing-dc-${item.gateNumber}" list="se-processing-dc-list-${item.gateNumber}" autocomplete="off"
                placeholder="Type the ABPS Delivery Challan No..."
                onfocus="grnLoadProcessingChallans('${item.gateNumber}')" oninput="grnProcessingChallanChanged('${item.gateNumber}')"
                style="flex:1; min-width:260px; max-width:360px; padding:6px; border:1.5px solid var(--border); border-radius:3px;">
              <datalist id="se-processing-dc-list-${item.gateNumber}"></datalist>
              <span style="font-size:0.75rem; font-weight:700; color:#b45309;">Only for Processing or Service return material.</span>
            </div>
            <div id="se-processing-msg-${item.gateNumber}" style="font-size:0.72rem; font-weight:700; margin-top:3px;"></div>
          </div>
          <div style="overflow-x:auto; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius);">
            <table class="store-basket-data-table row-lined-table" style="width:100%; table-layout:fixed; min-width:1150px; border-collapse:collapse;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="width:100px; text-align:center; font-size:0.68rem; padding:8px 6px; line-height:1.3;">Item Code</th>
                  <th style="width:240px; text-align:center; font-size:0.68rem; padding:8px 6px; line-height:1.3; border-left:1px solid var(--border);">Invoice Material Description</th>
                  <th style="width:280px; text-align:center; font-size:0.68rem; padding:8px 6px; line-height:1.3; border-left:1px solid var(--border);">Standard Material Name *</th>
                  <th style="width:90px; text-align:center; font-size:0.68rem; padding:8px 6px; line-height:1.3; border-left:1px solid var(--border);">Invoice<br>Unit</th>
                  <th style="width:100px; text-align:center; font-size:0.68rem; padding:8px 6px; line-height:1.3; border-left:1px solid var(--border);">Item Code<br>Unit</th>
                  <th style="width:100px; text-align:center; font-size:0.68rem; padding:8px 6px; line-height:1.3; border-left:1px solid var(--border);">Unit<br>Converter</th>
                  <th style="width:100px; text-align:center; font-size:0.68rem; padding:8px 6px; line-height:1.3; border-left:1px solid var(--border);">Invoice<br>Qty</th>
                  <th style="width:130px; text-align:center; font-size:0.68rem; padding:8px 6px; line-height:1.3; border-left:1px solid var(--border);">Received<br>Qty *</th>
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

    // "Suggested matches" (AI item-code pills) removed 29 Sep 2026 — operators pick the material themselves.

  } catch(e) { feed.innerHTML = `<p style="color:var(--warn);">${e.message}</p>`; }
}

// Per-line Purchase Order selection/split was removed (explicit
// request) — a Store Entry now always uses the single "PO Number"
// field for every line on this Gate Entry. If a vendor combines a
// previous PO's shortfall with a new PO's delivery in one document,
// the operator does 2 separate Gate Entries against that same
// document instead (adjusting Invoice Qty and PO Number on each), so
// one Gate Entry/GRN never needs to span more than one PO.



// Returning material: the GRN can be against an ABPS Delivery Challan
// (Processing sent out) instead of a PO. The server splits each line
// across that challan's tickets.
window.grnOpenProcessingChallans = window.grnOpenProcessingChallans || {};
async function grnLoadProcessingChallans(gateNum) {
  const input = document.getElementById(`se-processing-dc-${gateNum}`);
  const list = document.getElementById(`se-processing-dc-list-${gateNum}`);
  if (!input || !list || input.dataset.loaded === "1") return;
  input.dataset.loaded = "1";
  try {
    const data = await apFetch({ action: "fetchOpenProcessingReturns" });
    const byDc = {};
    (data.rows || []).forEach(r => {
      if (!r.challanNumber) return;
      const e = (byDc[r.challanNumber] = byDc[r.challanNumber] || { vendor: r.vendorName, items: {} });
      const k = r.materialName || r.itemCode;
      const it = (e.items[k] = e.items[k] || { rec: 0, exp: 0 });
      it.rec += Number(r.receivedQty) || 0; it.exp += Number(r.expectedQty) || 0;
    });
    window.grnOpenProcessingChallans[gateNum] = byDc;
    list.innerHTML = Object.entries(byDc).map(([dc, v]) =>
      `<option value="${escapeHtml(dc)}">${escapeHtml(v.vendor || "")}</option>`).join("");
    grnProcessingChallanChanged(gateNum);
  } catch (e) { input.dataset.loaded = ""; }
}
function grnProcessingChallanChanged(gateNum) {
  const input = document.getElementById(`se-processing-dc-${gateNum}`);
  const msg = document.getElementById(`se-processing-msg-${gateNum}`);
  if (!input || !msg) return;
  const v = input.value.trim();
  const byDc = window.grnOpenProcessingChallans[gateNum] || {};
  if (!v) { msg.textContent = ""; return; }
  const hit = byDc[v];
  if (!hit) { msg.style.color = "#b91c1c"; msg.textContent = "No open Delivery Challan with material due back matches this number."; return; }
  msg.style.color = "#15803d";
  msg.textContent = `${hit.vendor ? hit.vendor + " · " : ""}` + Object.entries(hit.items).map(([k, x]) => `${k}: ${trimNum(x.rec)}/${trimNum(x.exp)}`).join(", ");
}
