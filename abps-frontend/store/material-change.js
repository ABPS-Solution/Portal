// Material Change Request (migration 248).
// Create Material Issue Ticket: when more is asked than the store holds, a popup
// lets the person wait (add only what is in stock) or pick alternate
// material(s) for the shortfall. A change goes into the basket as its own row
// (isMaterialChange) and is sent as `materialChanges` on submit; the server
// raises it as a separate ticket for "Approve Production Material Change Request".

let mcrState = null;

function mcrNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function mcrRound(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

// Free stock of an item left after what this basket already asks for.
function mcrFreeFor(itemCode) {
  const inv = (window.cachedInventoryStockCollection || cachedInventoryStockCollection || []).find(i => i.itemCode === itemCode);
  let free = inv ? Number(inv.availableStock) || 0 : 0;
  (dynamicTicketShoppingBasketArray || []).forEach(r => {
    if (r.isMaterialChange) (r.alternates || []).forEach(a => { if (a.itemCode === itemCode) free -= Number(a.quantity) || 0; });
    else if (r.itemCode === itemCode) free -= Number(r.quantity) || 0;
  });
  return Math.max(0, mcrRound(free));
}

// ctx: { materialName, itemCode, unitType, requestedTotal, totalStock, jcRemaining, existingLine, boqId, restoreAddBtn }
// The person may replace just the shortfall (rest issued from stock) or the
// whole request (nothing of the original issued). Replaced qty is capped by
// what this Job Card still has left of the original material.
function openMaterialChangePopup(ctx) {
  closeMaterialChangePopup();
  const inStock = Math.max(0, Math.min(ctx.totalStock, ctx.requestedTotal));
  const minReplace = mcrRound(ctx.requestedTotal - inStock);
  const maxReplace = Math.max(0, mcrRound(Math.min(ctx.requestedTotal, Number(ctx.jcRemaining) || 0)));
  const alreadyChanging = (dynamicTicketShoppingBasketArray || []).some(r => r.isMaterialChange && r.changeFromItemCode === ctx.itemCode);
  mcrState = { ...ctx, inStock, minReplace, maxReplace, alreadyChanging, replaceQty: Math.min(minReplace, maxReplace),
    rows: [{ itemCode: "", materialName: "", unitType: "", quantity: "" }] };

  const unit = escapeHtml(ctx.unitType || "");
  const ov = document.createElement("div");
  ov.id = "mcr-overlay";
  ov.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.5); z-index:9000; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto;";
  ov.innerHTML = `
    <div style="background:var(--card, #fff); border-radius:var(--radius, 8px); width:100%; max-width:880px; box-shadow:0 12px 32px rgba(0,0,0,0.25); overflow:hidden;">
      <div style="background:var(--brand); color:#fff; padding:14px 20px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.05rem; color:#fff;">Not enough stock</h3>
        <button type="button" onclick="closeMaterialChangePopup()" aria-label="Close" style="background:none; border:none; font-size:1.5rem; line-height:1; cursor:pointer; color:#fff; width:auto; padding:0;">×</button>
      </div>
      <div style="padding:16px 20px;">
        <div style="background:#fff8e6; border-left:4px solid #d97706; border-radius:4px; padding:10px 14px; color:#92400e; font-size:0.9rem; margin-bottom:16px;">
          <strong>${escapeHtml(ctx.materialName)}</strong> requested quantity (<strong>${fmtQty(ctx.requestedTotal)}</strong>) exceeds the current total stock in Raw Materials Store (<strong>${fmtQty(ctx.totalStock)}</strong>). Reduce the quantity, or check with Purchase Department on when more will arrive.
        </div>

        <div style="border:1px solid var(--border); border-radius:var(--radius, 6px); padding:14px; margin-bottom:16px;">
          <div class="sec-label" style="margin:0 0 6px 0;">Option 1: Wait for more stock</div>
          <div style="font-size:0.85rem; color:#475569; margin-bottom:10px;">${inStock > 0 ? `Add only the ${fmtQty(inStock)} ${unit} in stock now, or close this and change the quantity.` : "None is in stock now. Close this and wait, or use Option 2."}</div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            ${inStock > 0 ? `<button type="button" class="nav-btn-styled" style="width:auto; background:var(--accent); padding:8px 18px; font-weight:700;" onclick="mcrAddKeptOnly()">Add ${fmtQty(inStock)} only</button>` : ""}
            <button type="button" class="nav-btn-styled" style="width:auto; background:#718096; padding:8px 18px; font-weight:700;" onclick="closeMaterialChangePopup()">No, close</button>
          </div>
        </div>

        <div style="border:1px solid var(--border); border-radius:var(--radius, 6px); padding:14px;">
          <div class="sec-label" style="margin:0 0 6px 0;">Option 2: Use alternate material (Material Change Request)</div>
          ${mcrChangeSectionHtml()}
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  if (!alreadyChanging && maxReplace >= minReplace && maxReplace > 0) { mcrRenderRows(); mcrRefreshSplit(); }
}

function mcrChangeSectionHtml() {
  const s = mcrState;
  const unit = escapeHtml(s.unitType || "");
  if (s.alreadyChanging) return `<div style="color:#b45309; font-size:0.85rem;">This basket already has a material change for ${escapeHtml(s.materialName)}. Delete it from the basket first to make a new one.</div>`;
  if (s.maxReplace <= 0 || s.maxReplace < s.minReplace) return `<div style="color:#b45309; font-size:0.85rem;">This Job Card has only ${fmtQty(Math.max(0, s.maxReplace))} ${unit} of ${escapeHtml(s.materialName)} left, which is not enough to cover the shortfall of ${fmtQty(s.minReplace)}. More than the Job Card allows needs an Excess Material Request.</div>`;
  const choices = s.inStock > 0 && s.maxReplace > s.minReplace
    ? `<div style="display:flex; gap:18px; flex-wrap:wrap; margin-bottom:10px; font-size:0.88rem;">
        <label style="display:flex; align-items:center; gap:6px; margin:0; cursor:pointer;"><input type="radio" name="mcr-mode" value="short" checked onchange="mcrSetMode('short')" style="width:auto;"> Replace only the shortfall (${fmtQty(s.minReplace)} ${unit}), use the ${fmtQty(s.inStock)} in stock</label>
        <label style="display:flex; align-items:center; gap:6px; margin:0; cursor:pointer;"><input type="radio" name="mcr-mode" value="all" onchange="mcrSetMode('all')" style="width:auto;"> Replace ${fmtQty(s.maxReplace)} ${unit} (${s.requestedTotal - s.maxReplace > 0 ? `issue only ${fmtQty(mcrRound(s.requestedTotal - s.maxReplace))} from stock` : `use none of ${escapeHtml(s.materialName)}`})</label>
      </div>` : "";
  return `
    <div style="font-size:0.85rem; color:#475569; margin-bottom:10px;">Pick what will be used instead. Approval is needed in Approve Production Material Change Request.</div>
    ${choices}
    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
      <label class="field-label" style="margin:0;">Quantity of ${escapeHtml(s.materialName)} being replaced</label>
      <input type="number" id="mcr-from-qty" min="${s.minReplace}" max="${s.maxReplace}" step="any" value="${s.replaceQty}" oninput="mcrFromQtyInput(this)" onblur="mcrFromQtyBlur(this)"
        style="width:110px; padding:6px; text-align:center; font-weight:700;"> <span style="font-size:0.85rem; color:#475569;">${unit} (${fmtQty(s.minReplace)} to ${fmtQty(s.maxReplace)})</span>
    </div>
    <div id="mcr-split-note" style="font-size:0.82rem; color:#0369a1; font-weight:600; margin-bottom:10px;"></div>
    <div style="overflow-x:auto;">
    <table style="width:100%; border-collapse:collapse; font-size:0.85rem; table-layout:fixed; min-width:620px;">
      <colgroup><col style="width:46%"><col style="width:10%"><col style="width:15%"><col style="width:17%"><col style="width:12%"></colgroup>
      <thead><tr style="background:var(--highlight-bg);">
        <th style="border:1px solid var(--border); padding:8px; text-align:left;">Alternate Material</th>
        <th style="border:1px solid var(--border); padding:8px;">Unit</th>
        <th style="border:1px solid var(--border); padding:8px;">Available Qty</th>
        <th style="border:1px solid var(--border); padding:8px;">Required Qty</th>
        <th style="border:1px solid var(--border); padding:8px;"></th>
      </tr></thead>
      <tbody id="mcr-rows"></tbody>
    </table>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; gap:10px; flex-wrap:wrap;">
      <button type="button" class="nav-btn-styled" style="width:auto; background:var(--brand); padding:7px 16px; font-weight:700;" onclick="mcrAddRow()">+ Add Alternate Row</button>
      <button type="button" class="nav-btn-styled" style="width:auto; background:var(--accent); padding:9px 20px; font-weight:700;" onclick="mcrAddChangeToBasket()">Add to Basket (Change Approval Pending)</button>
    </div>
    <div id="mcr-error" style="display:none; margin-top:10px; padding:8px 12px; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; font-weight:700; font-size:0.85rem; border-radius:4px;"></div>`;
}

function mcrSetMode(mode) {
  const s = mcrState;
  s.replaceQty = mode === "all" ? s.maxReplace : Math.min(s.minReplace, s.maxReplace);
  const inp = document.getElementById("mcr-from-qty");
  if (inp) inp.value = s.replaceQty;
  mcrRefreshSplit();
}

function mcrRefreshSplit() {
  const s = mcrState, note = document.getElementById("mcr-split-note");
  if (!s || !note) return;
  const kept = mcrRound(Math.max(0, s.requestedTotal - s.replaceQty));
  const unit = s.unitType || "";
  note.textContent = kept > 0
    ? `${fmtQty(kept)} ${unit} of ${s.materialName} will be issued from stock; ${fmtQty(s.replaceQty)} ${unit} replaced.`
    : `None of ${s.materialName} will be issued; all ${fmtQty(s.replaceQty)} ${unit} replaced.`;
}

function mcrRenderRows() {
  const tb = document.getElementById("mcr-rows");
  if (!tb) return;
  const cell = "border:1px solid var(--border); padding:6px;";
  tb.innerHTML = mcrState.rows.map((r, i) => {
    const avail = r.itemCode ? mcrFreeFor(r.itemCode) : null;
    return `<tr>
      <td style="${cell}">
        <input type="text" id="mcr-search-${i}" value="${escapeHtml(r.materialName)}" placeholder="Type to search material..." autocomplete="off"
          oninput="mcrSearch(${i}, this.value)" onfocus="mcrSearch(${i}, this.value)" onclick="mcrSearch(${i}, this.value)" style="width:100%; padding:6px;">
      </td>
      <td style="${cell} text-align:center; font-weight:600;">${r.unitType ? escapeHtml(r.unitType) : "—"}</td>
      <td style="${cell} text-align:center; font-weight:700; color:#0369a1;">${avail === null ? "—" : fmtQty(avail)}</td>
      <td style="${cell} text-align:center;">
        <input type="number" id="mcr-qty-${i}" min="0" step="any" value="${escapeHtml(String(r.quantity))}" ${r.itemCode ? "" : "disabled"}
          oninput="mcrQtyInput(${i}, this)" style="width:95px; padding:5px; text-align:center; font-weight:700;">
      </td>
      <td style="${cell} text-align:center;">
        <button type="button" class="nav-btn-styled" style="width:auto; background:#e53e3e; padding:3px 10px; font-size:0.75rem;" onclick="mcrRemoveRow(${i})">Remove</button>
      </td>
    </tr>`;
  }).join("");
}

function mcrFromQtyInput(inp) {
  const v = mcrNum(inp.value);
  if (v > mcrState.maxReplace) inp.value = mcrState.maxReplace;
  mcrState.replaceQty = Math.min(Math.max(mcrNum(inp.value), 0), mcrState.maxReplace);
  mcrRefreshSplit();
}
function mcrFromQtyBlur(inp) {
  let v = mcrNum(inp.value);
  if (v < mcrState.minReplace) v = mcrState.minReplace;
  if (v > mcrState.maxReplace) v = mcrState.maxReplace;
  inp.value = v; mcrState.replaceQty = v;
  const all = document.querySelector('input[name="mcr-mode"][value="all"]');
  const sh = document.querySelector('input[name="mcr-mode"][value="short"]');
  if (all && sh) { all.checked = v === mcrState.maxReplace; sh.checked = v === mcrState.minReplace; }
  mcrRefreshSplit();
}

function mcrQtyInput(i, inp) {
  const r = mcrState.rows[i];
  const cap = r.itemCode ? mcrFreeFor(r.itemCode) : 0;
  let v = mcrNum(inp.value);
  if (v > cap) { v = cap; inp.value = cap; }
  r.quantity = inp.value === "" ? "" : v;
}

function mcrAddRow() { mcrState.rows.push({ itemCode: "", materialName: "", unitType: "", quantity: "" }); mcrRenderRows(); }
function mcrRemoveRow(i) {
  mcrState.rows.splice(i, 1);
  if (mcrState.rows.length === 0) mcrState.rows.push({ itemCode: "", materialName: "", unitType: "", quantity: "" });
  mcrHideDropdown();
  mcrRenderRows();
}

function mcrDropdownEl() {
  let dd = document.getElementById("mcr-search-dropdown");
  if (!dd) {
    dd = document.createElement("div");
    dd.id = "mcr-search-dropdown";
    dd.style.cssText = "position:fixed; z-index:9100; background:#fff; border:1.5px solid var(--brand); border-radius:6px; box-shadow:0 6px 18px rgba(0,0,0,0.18); max-height:280px; overflow-y:auto; display:none;";
    document.body.appendChild(dd);
  }
  return dd;
}
function mcrHideDropdown() { const dd = document.getElementById("mcr-search-dropdown"); if (dd) dd.style.display = "none"; }

// Lists every Raw Materials Store material matching the text; those with no
// free stock are shown greyed out so the person can see why they can't pick them.
function mcrSearch(i, text) {
  const inp = document.getElementById("mcr-search-" + i);
  if (!inp || !mcrState) return;
  const used = new Set(mcrState.rows.filter((r, j) => j !== i && r.itemCode).map(r => r.itemCode));
  const pool = (window.cachedInventoryStockCollection || cachedInventoryStockCollection || [])
    .filter(it => it.itemCode && it.itemCode !== mcrState.itemCode && !used.has(it.itemCode));
  const q = (text || "").trim();
  let list = q ? materialSearch(pool, q, 60, it => [it.materialName, it.make, it.itemCode]) : pool.slice();
  list = list.map(it => ({ it, free: mcrFreeFor(it.itemCode) }));
  list.sort((a, b) => (b.free > 0) - (a.free > 0));
  list = list.slice(0, 50);
  const dd = mcrDropdownEl();
  if (list.length === 0) {
    dd.innerHTML = `<div style="padding:10px; color:var(--muted); font-size:0.85rem;">${q ? "No material in Raw Materials Store matches." : "Raw Materials Store has no other material."}</div>`;
  } else {
    dd.innerHTML = list.map(({ it, free }) => {
      const ok = free > 0;
      return `<div ${ok ? `onmousedown="mcrPick(${i}, ${jsArg(it.itemCode)})"` : ""} style="padding:8px 10px; border-bottom:1px solid #f1f5f9; font-size:0.85rem; ${ok ? "cursor:pointer;" : "cursor:not-allowed; opacity:0.55;"}"
        ${ok ? `onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''"` : ""}>
        <div style="font-weight:600;">${escapeHtml(it.materialName)}${it.make ? ` <span style="color:#64748b;">- Make: ${escapeHtml(it.make)}</span>` : ""}</div>
        <div style="color:${ok ? "#15803d" : "#b91c1c"}; font-size:0.78rem; font-weight:600;">${escapeHtml(it.itemCode)} · ${ok ? `Free: ${fmtQty(free)} ${escapeHtml(it.unitType || "")}` : "No free stock"}</div>
      </div>`;
    }).join("");
  }
  const rect = inp.getBoundingClientRect();
  dd.style.left = rect.left + "px";
  dd.style.top = (rect.bottom + 2) + "px";
  dd.style.width = Math.max(rect.width, 360) + "px";
  dd.style.display = "block";
}

function mcrPick(i, itemCode) {
  const it = (window.cachedInventoryStockCollection || cachedInventoryStockCollection || []).find(x => x.itemCode === itemCode);
  if (!it || mcrFreeFor(itemCode) <= 0) return;
  const r = mcrState.rows[i];
  r.itemCode = it.itemCode;
  r.materialName = it.materialName + (it.make && !/Make:/i.test(it.materialName) ? " - Make: " + it.make : "");
  r.unitType = it.unitType || "";
  r.quantity = "";
  mcrHideDropdown();
  mcrRenderRows();
  const q = document.getElementById("mcr-qty-" + i);
  if (q) q.focus();
}

document.addEventListener("mousedown", (e) => {
  const dd = document.getElementById("mcr-search-dropdown");
  if (dd && dd.style.display !== "none" && !dd.contains(e.target) && !(e.target.id || "").startsWith("mcr-search-")) mcrHideDropdown();
});

function closeMaterialChangePopup() {
  mcrHideDropdown();
  const ov = document.getElementById("mcr-overlay");
  if (ov) ov.remove();
  if (mcrState && typeof mcrState.restoreAddBtn === "function") mcrState.restoreAddBtn();
  mcrState = null;
}

// Puts `kept` of the original material into the basket as a normal line
// (or removes the existing line when nothing of it is kept).
function mcrPutKeptLine(kept) {
  const s = mcrState;
  if (kept <= 0) {
    if (s.existingLine) dynamicTicketShoppingBasketArray.splice(dynamicTicketShoppingBasketArray.indexOf(s.existingLine), 1);
    return;
  }
  const over = kept > (Number(s.jcRemaining) || 0);
  if (s.existingLine) {
    s.existingLine.quantity = kept;
    s.existingLine.requiresBOQIncreaseFlag = over;
    s.existingLine.allottedRemainingLimit = Number(s.jcRemaining) || 0;
  } else {
    dynamicTicketShoppingBasketArray.push({
      materialName: s.materialName, quantity: kept, unitType: s.unitType || "NOS",
      requiresBOQIncreaseFlag: over, allottedRemainingLimit: Number(s.jcRemaining) || 0,
      itemCode: s.itemCode, boqId: s.boqId || "",
    });
  }
}

function mcrFinish() {
  const qtyInput = document.getElementById("ticket-item-quantity-input");
  if (qtyInput) qtyInput.value = "";
  if (typeof ticketItemTaClear === "function") ticketItemTaClear();
  closeMaterialChangePopup();
  renderDraftBasketTableViewportRows();
  if (typeof cmitDraftSaveSoon === "function") cmitDraftSaveSoon();
}

function mcrAddKeptOnly() { mcrPutKeptLine(mcrState.inStock); mcrFinish(); }

function mcrAddChangeToBasket() {
  const s = mcrState;
  const err = document.getElementById("mcr-error");
  const fail = (m) => { err.textContent = m; err.style.display = "block"; };
  err.style.display = "none";
  const fromQty = mcrRound(mcrNum(document.getElementById("mcr-from-qty").value));
  if (!(fromQty > 0)) return fail("Enter the quantity being replaced.");
  if (fromQty < s.minReplace - 1e-9) return fail(`At least ${fmtQty(s.minReplace)} must be replaced (that is what is short).`);
  if (fromQty > s.maxReplace + 1e-9) return fail(`At most ${fmtQty(s.maxReplace)} can be replaced.`);
  const alts = [];
  for (const r of s.rows) {
    if (!r.itemCode && (r.quantity === "" || r.quantity === 0)) continue;
    if (!r.itemCode) return fail("Pick a material in every alternate row, or remove the empty row.");
    const q = mcrRound(mcrNum(r.quantity));
    if (!(q > 0)) return fail(`Enter a Required Qty for ${r.materialName}.`);
    if (q > mcrFreeFor(r.itemCode) + 1e-9) return fail(`Only ${fmtQty(mcrFreeFor(r.itemCode))} of ${r.materialName} is free.`);
    alts.push({ itemCode: r.itemCode, materialName: r.materialName, unitType: r.unitType, quantity: q });
  }
  if (alts.length === 0) return fail("Add at least one alternate material.");
  mcrPutKeptLine(mcrRound(Math.max(0, s.requestedTotal - fromQty)));
  dynamicTicketShoppingBasketArray.push({
    isMaterialChange: true, changeFromItemCode: s.itemCode, changeFromMaterialName: s.materialName,
    changeFromUnit: s.unitType || "", changeFromQty: fromQty, alternates: alts,
    materialName: s.materialName, itemCode: "", quantity: 0, unitType: s.unitType || "", requiresBOQIncreaseFlag: false,
  });
  mcrFinish();
}

// Basket rows for a change entry: one row per alternate material (its own
// unit and quantity), tagged, with the replaced material below the name.
function materialChangeBasketRowsHtml(rowItem, arrayIdx) {
  const alts = rowItem.alternates || [];
  const replaceLine = `Replace ${escapeHtml(rowItem.changeFromMaterialName)} <strong style="font-family:monospace;">${fmtQty(rowItem.changeFromQty)}</strong> ${escapeHtml(rowItem.changeFromUnit || "")}`;
  return alts.map((a, k) => `
    <td style="font-weight:600; padding:10px 8px;">
      <div>${escapeHtml(a.materialName)}
        <span style="font-size:0.65rem; background:#fef3c7; color:#b45309; padding:1px 5px; border-radius:3px; font-weight:bold; margin-left:4px;">Material Change Approval Pending</span></div>
      <div style="font-size:0.85rem; color:#92400e; margin-top:3px;">${replaceLine}${alts.length > 1 ? ` (with ${alts.length - 1} other material${alts.length > 2 ? "s" : ""})` : ""}</div>
    </td>
    <td style="text-align:center; font-weight:700; font-size:0.95rem;">${escapeHtml(a.unitType || "")}</td>
    <td style="font-family:monospace; font-weight:700; font-size:1.05rem; text-align:center;">${fmtQty(a.quantity)}</td>
    ${k === 0 ? `<td style="text-align:center;" rowspan="${alts.length}">
      <button class="nav-btn-styled" onclick="removeSingleBasketItemLineAtIndex(${arrayIdx})" style="background:#e53e3e; padding:2px 8px; font-size:0.75rem;">Delete</button>
    </td>` : ""}`);
}

// Adding the original material as a normal row while a change for it is in
// the basket: issued + replaced must still fit the Job Card's remaining qty.
function materialChangeConflictMessage(itemCode, newNormalTotal, jcRemaining) {
  const ch = (dynamicTicketShoppingBasketArray || []).find(r => r.isMaterialChange && r.changeFromItemCode === itemCode);
  if (!ch) return "";
  const total = (Number(newNormalTotal) || 0) + (Number(ch.changeFromQty) || 0);
  if (total <= (Number(jcRemaining) || 0) + 1e-9) return "";
  return `This basket already replaces ${fmtQty(ch.changeFromQty)} ${ch.changeFromUnit || ""} of ${ch.changeFromMaterialName}. Issuing ${fmtQty(newNormalTotal)} more would take this Job Card to ${fmtQty(total)}, but it has only ${fmtQty(jcRemaining)} left. Reduce the quantity, or delete the material change and make it again.`;
}

// Submit helpers. Raw Materials Store rows over the Job Card limit go as an
// Excess Material Request; memo rows as Production Memo purchase requests.
function basketNormalItems() { return (dynamicTicketShoppingBasketArray || []).filter(r => !r.isMaterialChange && !r.isMemoPurchase); }
function basketIsExcessRow(r, store) { return !!r.requiresBOQIncreaseFlag && (store || "Raw Materials Store") === "Raw Materials Store"; }
function basketIssueItems(store) {
  return basketNormalItems().filter(r => !basketIsExcessRow(r, store) && Number(r.quantity) > 0)
    .map(r => { const c = { ...r }; delete c.memoQty; return c; });
}
function basketExcessItems(store) { return basketNormalItems().filter(r => basketIsExcessRow(r, store)); }
function basketMemoPurchaseItems() {
  return (dynamicTicketShoppingBasketArray || []).filter(r => r.isMemoPurchase || Number(r.memoQty) > 0)
    .map(r => ({ itemCode: r.itemCode, quantity: r.isMemoPurchase ? r.quantity : r.memoQty }));
}
function basketMaterialChanges() {
  return (dynamicTicketShoppingBasketArray || []).filter(r => r.isMaterialChange).map(r => ({
    fromItemCode: r.changeFromItemCode, fromQty: r.changeFromQty,
    alternates: (r.alternates || []).map(a => ({ itemCode: a.itemCode, quantity: a.quantity })),
  }));
}

// ── Approve Production Material Change Request ───────────────────────────
async function initializeMaterialChangeApprovalsWorkspace() {
  const feed = document.getElementById("material-change-approvals-feed");
  const fb = document.getElementById("material-change-approvals-feedback");
  if (!feed) return;
  if (fb) fb.style.display = "none";
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading Material Change Requests...</div>`;
  try {
    const data = await apFetch({ action: "fetchPendingMaterialChangeRequests" });
    if (!data.success) { feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">${escapeHtml(data.error)}</div>`; return; }
    if (!data.requests || data.requests.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;"><h3 style="color:var(--accent);">No Pending Material Change Requests</h3></div>`;
      return;
    }
    window._mcrRequests = data.requests;
    feed.innerHTML = "";
    data.requests.forEach(t => feed.appendChild(renderMaterialChangeCard(t)));
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Network error: ${escapeHtml(e.message)}</div>`;
  }
}

function renderMaterialChangeCard(t) {
  const card = document.createElement("div");
  card.className = "contact-summary-card-parent";
  card.id = `mcr-card-${t.ticketId}`;
  card.style.borderLeft = "4px solid #b45309";
  const th = (txt, al) => `<th style="border:1px solid var(--border); padding:8px; text-align:${al || "center"}; vertical-align:middle;">${txt}</th>`;
  const td = (html, al, rowspan) => `<td ${rowspan > 1 ? `rowspan="${rowspan}"` : ""} style="border:1px solid var(--border); padding:8px; text-align:${al || "center"}; vertical-align:middle;">${html}</td>`;
  const groupsHtml = (t.groups || []).map(g => g.alternates.map((a, ai) => `<tr>
      ${ai === 0 ? td(`<div style="font-weight:700;">${escapeHtml(g.fromMaterialName)}</div><div style="font-size:0.78rem; color:#64748b; margin-top:2px;">JC Allotted ${fmtQty(g.jcAllotted)} · Used ${fmtQty(g.jcUsed)} · Remaining ${fmtQty(g.jcRemaining)}</div>`, "left", g.alternates.length) : ""}
      ${ai === 0 ? td(`<strong>${fmtQty(g.fromQty)}</strong> ${escapeHtml(g.fromUnit || "")}`, "center", g.alternates.length) : ""}
      ${td(`<div style="font-weight:700;">${escapeHtml(a.materialName)}</div>`, "left")}
      ${td(`<strong>${fmtQty(a.quantity)}</strong> ${escapeHtml(a.unitType || "")}`)}
      ${td(`<input type="number" min="0" max="${a.quantity}" step="any" value="${a.quantity}" data-group="${g.group}" data-itemcode="${escapeHtml(a.itemCode)}"
            class="mcr-approve-qty" oninput="if(parseFloat(this.value)>${a.quantity})this.value=${a.quantity}; if(parseFloat(this.value)<0)this.value=0;"
            style="width:100px; padding:5px 6px; text-align:center; font-family:monospace; font-weight:700; border:2px solid #64748b; border-radius:4px;">`)}
    </tr>`).join("")).join("");
  card.innerHTML = `
    <div class="contact-summary-header-row" onclick="toggleMaterialChangeCardBody(${jsArg(t.ticketId)})" style="margin-bottom:0; padding-bottom:8px; cursor:pointer;">
      <div class="contact-summary-title-info" style="width:100%;">
        <div class="meta-row-line-block">
          <span style="font-family:monospace; font-weight:800; background:#fef3c7; color:#b45309; padding:3px 8px; font-size:0.85rem; border-radius:3px;">${escapeHtml(t.ticketId)}</span>
          <strong style="margin-left:10px; color:var(--brand); font-size:0.9rem;">${escapeHtml(t.jobCardNumber || "—")}</strong>
        </div>
        <div class="meta-row-line-block" style="margin-top:8px; font-size:0.85rem;">
          <span>Project ID:</span> <strong style="color:#111827; font-family:monospace;">${escapeHtml(t.projectId || "—")}</strong>
          ${t.companyName ? `<span style="margin-left:8px;">|</span> <strong style="color:#111827; margin-left:8px;">${escapeHtml(t.companyName)}</strong>` : ""}
          <span style="margin-left:8px;">|</span>
          <span style="margin-left:8px;">By:</span> <strong style="color:#111827;">${escapeHtml(t.requestedBy || "")}</strong>
          <span style="margin-left:8px;">|</span>
          <strong style="color:#111827; margin-left:8px;">${formatOrdinalDateTime(t.dateCreated)}</strong>
          <span style="margin-left:12px;">Dept:</span> <strong style="color:#111827;">${escapeHtml(t.department || "—")}</strong>
        </div>
      </div>
    </div>
    <div id="mcr-body-${t.ticketId}" style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:8px;">
      <div style="overflow-x:auto; margin-bottom:14px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; table-layout:fixed; min-width:760px;">
          <colgroup><col style="width:34%"><col style="width:11%"><col style="width:31%"><col style="width:12%"><col style="width:12%"></colgroup>
          <thead><tr style="background:var(--highlight-bg);">
            ${th("Change From Material", "left")}${th("Qty")}${th("Change To Material", "left")}${th("Asked Qty")}${th("Approved Qty")}
          </tr></thead>
          <tbody>${groupsHtml}</tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="nav-btn-styled" onclick="submitMaterialChangeDecision(${jsArg(t.ticketId)}, false)" style="width:auto; background:#b91c1c; padding:8px 20px; font-weight:700;">Reject All</button>
        <button class="nav-btn-styled" onclick="submitMaterialChangeDecision(${jsArg(t.ticketId)}, true)" style="width:auto; background:var(--accent); padding:8px 20px; font-weight:700;">Submit Decision</button>
      </div>
    </div>`;
  return card;
}

function toggleMaterialChangeCardBody(ticketId) {
  const b = document.getElementById("mcr-body-" + ticketId);
  if (b) b.style.display = b.style.display === "none" ? "block" : "none";
}

async function submitMaterialChangeDecision(ticketId, useTicks) {
  const card = document.getElementById("mcr-card-" + ticketId);
  const fb = document.getElementById("material-change-approvals-feedback");
  const show = (ok, msg) => {
    fb.style.cssText = ok
      ? "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:12px; margin-bottom:12px; font-weight:700;"
      : "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:12px; margin-bottom:12px; font-weight:700;";
    fb.textContent = msg;
    fb.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const decisions = [];
  const groups = [...new Set([...card.querySelectorAll(".mcr-approve-qty")].map(i => Number(i.dataset.group)))];
  groups.forEach(group => {
    const approve = !!useTicks;
    const alternates = [];
    card.querySelectorAll(`.mcr-approve-qty[data-group="${group}"]`).forEach(inp => {
      alternates.push({ itemCode: inp.dataset.itemcode, quantity: parseFloat(inp.value) || 0 });
    });
    decisions.push({ group, approve, alternates });
  });
  const anyApproved = decisions.some(d => d.approve && d.alternates.some(a => a.quantity > 0));
  const ok = await abpsConfirm(anyApproved ? "Submit this decision? Approved changes go to Store for release." : "Reject this whole material change request?");
  if (!ok) return;
  showBlockingOverlay("Submitting decision…");
  try {
    const data = await apFetch({ action: "decideMaterialChangeRequest", ticketId, decisions });
    hideBlockingOverlay();
    if (!data.success) return show(false, data.error || "Submission failed.");
    if (data.cancelled) show(false, `${ticketId} was cancelled: ${data.reason}`);
    else show(true, data.releaseTicketId
      ? `${ticketId} approved. Release ticket ${data.releaseTicketId} is waiting in Approve Material Issue Tickets.`
      : `${ticketId} rejected. The held stock is free again.`);
    card.remove();
    if (!document.getElementById("material-change-approvals-feed").children.length) initializeMaterialChangeApprovalsWorkspace();
  } catch (e) {
    hideBlockingOverlay();
    if (e.message !== "SESSION_EXPIRED") show(false, "Network error: " + e.message);
  }
}
