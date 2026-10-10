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
function openMaterialChangePopup(ctx) {
  closeMaterialChangePopup();
  const kept = Math.max(0, Math.min(ctx.totalStock, ctx.requestedTotal));
  const shortfall = mcrRound(ctx.requestedTotal - kept);
  const maxReplace = Math.max(0, mcrRound(Math.min(shortfall, (Number(ctx.jcRemaining) || 0) - kept)));
  const alreadyChanging = (dynamicTicketShoppingBasketArray || []).some(r => r.isMaterialChange && r.changeFromItemCode === ctx.itemCode);
  mcrState = { ...ctx, kept, shortfall, maxReplace, alreadyChanging, rows: [{ itemCode: "", materialName: "", unitType: "", quantity: "" }] };

  const ov = document.createElement("div");
  ov.id = "mcr-overlay";
  ov.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.45); z-index:9000; display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto;";
  ov.innerHTML = `
    <div style="background:#fff; border-radius:8px; width:100%; max-width:820px; box-shadow:0 10px 30px rgba(0,0,0,0.25); border-top:5px solid #b45309;">
      <div style="padding:16px 20px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div>
          <h3 style="margin:0 0 6px 0; color:#b45309; font-size:1.05rem;">Not enough stock</h3>
          <div style="font-size:0.9rem; color:#1f2937;">${escapeHtml(ctx.materialName)} requested quantity (<strong>${fmtQty(ctx.requestedTotal)}</strong>) exceeds the current total stock in Raw Materials Store (<strong>${fmtQty(ctx.totalStock)}</strong>). Reduce the quantity, or check with Purchase Department on when more will arrive.</div>
        </div>
        <button type="button" onclick="closeMaterialChangePopup()" style="background:none; border:none; font-size:1.4rem; cursor:pointer; color:#64748b; width:auto;">×</button>
      </div>
      <div style="padding:16px 20px;">
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:6px; padding:12px 14px; margin-bottom:14px;">
          <div style="font-weight:700; margin-bottom:8px;">Wait for more stock</div>
          <div style="font-size:0.85rem; color:#475569; margin-bottom:10px;">${kept > 0 ? `Add only the ${fmtQty(kept)} ${escapeHtml(ctx.unitType || "")} that is in stock now, or close this and change the quantity.` : "There is none in stock now. Close this and wait, or use an alternate material below."}</div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            ${kept > 0 ? `<button type="button" class="nav-btn-styled" style="width:auto; background:#475569; padding:7px 16px;" onclick="mcrAddKeptOnly()">Add ${fmtQty(kept)} only</button>` : ""}
            <button type="button" class="nav-btn-styled" style="width:auto; background:#94a3b8; padding:7px 16px;" onclick="closeMaterialChangePopup()">No, close</button>
          </div>
        </div>
        <div style="border:1px solid #fcd34d; background:#fffbeb; border-radius:6px; padding:12px 14px;">
          <div style="font-weight:700; margin-bottom:6px;">Use alternate material for the shortfall (Material Change Request)</div>
          ${mcrChangeSectionHtml()}
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  if (!alreadyChanging && maxReplace > 0) mcrRenderRows();
}

function mcrChangeSectionHtml() {
  const s = mcrState;
  if (s.alreadyChanging) return `<div style="color:#b45309; font-size:0.85rem;">This basket already has a material change for ${escapeHtml(s.materialName)}. Delete it from the basket first to make a new one.</div>`;
  if (s.maxReplace <= 0) return `<div style="color:#b45309; font-size:0.85rem;">This Job Card has nothing left of ${escapeHtml(s.materialName)} beyond what is in stock, so there is nothing to replace. More than the Job Card allows needs an Excess Material Request.</div>`;
  const note = s.maxReplace < s.shortfall
    ? `<div style="font-size:0.8rem; color:#b45309; margin-top:4px;">Short by ${fmtQty(s.shortfall)}, but this Job Card has only ${fmtQty(s.maxReplace)} left after the ${fmtQty(s.kept)} in stock. The rest needs an Excess Material Request.</div>` : "";
  return `
    <div style="font-size:0.85rem; color:#475569; margin-bottom:10px;">${s.kept > 0 ? `${fmtQty(s.kept)} of ${escapeHtml(s.materialName)} will be issued from stock. ` : ""}Pick what will be used in place of the rest. Approval is needed in Approve Production Material Change Request.</div>
    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
      <label style="font-weight:600; font-size:0.85rem; margin:0;">Quantity of ${escapeHtml(s.materialName)} being replaced</label>
      <input type="number" id="mcr-from-qty" min="0" max="${s.maxReplace}" step="any" value="${s.maxReplace}" oninput="mcrClampFromQty(this)"
        style="width:110px; padding:6px; text-align:center; font-weight:700;"> <span style="font-size:0.85rem; color:#475569;">${escapeHtml(s.unitType || "")} (max ${fmtQty(s.maxReplace)})</span>
    </div>
    ${note}
    <table style="width:100%; border-collapse:collapse; font-size:0.85rem; table-layout:fixed; margin-top:6px;">
      <colgroup><col style="width:52%"><col style="width:18%"><col style="width:20%"><col style="width:10%"></colgroup>
      <thead><tr style="background:#fef3c7;">
        <th style="border:1px solid var(--border); padding:6px; text-align:left;">Alternate Material</th>
        <th style="border:1px solid var(--border); padding:6px;">Available</th>
        <th style="border:1px solid var(--border); padding:6px;">Required Qty</th>
        <th style="border:1px solid var(--border); padding:6px;"></th>
      </tr></thead>
      <tbody id="mcr-rows"></tbody>
    </table>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; gap:10px; flex-wrap:wrap;">
      <button type="button" class="nav-btn-styled" style="width:auto; background:#64748b; padding:6px 14px; font-size:0.8rem;" onclick="mcrAddRow()">+ Add Alternate Row</button>
      <button type="button" class="nav-btn-styled" style="width:auto; background:#b45309; padding:8px 18px; font-weight:700;" onclick="mcrAddChangeToBasket()">Add to Basket (Change Approval Pending)</button>
    </div>
    <div id="mcr-error" style="display:none; margin-top:10px; color:#b91c1c; font-weight:700; font-size:0.85rem;"></div>`;
}

function mcrRenderRows() {
  const tb = document.getElementById("mcr-rows");
  if (!tb) return;
  tb.innerHTML = mcrState.rows.map((r, i) => {
    const avail = r.itemCode ? mcrFreeFor(r.itemCode) : null;
    return `<tr>
      <td style="border:1px solid var(--border); padding:6px;">
        <input type="text" id="mcr-search-${i}" value="${escapeHtml(r.materialName)}" placeholder="Type to search material..." autocomplete="off"
          oninput="mcrSearch(${i}, this.value)" onfocus="mcrSearch(${i}, this.value)" style="width:100%; padding:6px;">
      </td>
      <td style="border:1px solid var(--border); padding:6px; text-align:center; font-weight:700; color:#0369a1;">${avail === null ? "—" : fmtQty(avail) + " " + escapeHtml(r.unitType || "")}</td>
      <td style="border:1px solid var(--border); padding:6px; text-align:center;">
        <input type="number" id="mcr-qty-${i}" min="0" step="any" value="${escapeHtml(String(r.quantity))}" ${r.itemCode ? "" : "disabled"}
          oninput="mcrQtyInput(${i}, this)" style="width:90px; padding:5px; text-align:center; font-weight:700;">
      </td>
      <td style="border:1px solid var(--border); padding:6px; text-align:center;">
        <button type="button" class="nav-btn-styled" style="width:auto; background:#e53e3e; padding:2px 8px; font-size:0.75rem;" onclick="mcrRemoveRow(${i})">Remove</button>
      </td>
    </tr>`;
  }).join("");
}

function mcrClampFromQty(inp) {
  let v = mcrNum(inp.value);
  if (v > mcrState.maxReplace) { v = mcrState.maxReplace; inp.value = v; }
  if (v < 0) { inp.value = 0; }
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
    dd.style.cssText = "position:fixed; z-index:9100; background:#fff; border:1px solid var(--border); border-radius:6px; box-shadow:0 6px 18px rgba(0,0,0,0.18); max-height:260px; overflow-y:auto; display:none;";
    document.body.appendChild(dd);
  }
  return dd;
}
function mcrHideDropdown() { const dd = document.getElementById("mcr-search-dropdown"); if (dd) dd.style.display = "none"; }

function mcrSearch(i, text) {
  const inp = document.getElementById("mcr-search-" + i);
  if (!inp || !mcrState) return;
  const used = new Set(mcrState.rows.filter((r, j) => j !== i && r.itemCode).map(r => r.itemCode));
  const pool = (window.cachedInventoryStockCollection || cachedInventoryStockCollection || [])
    .filter(it => it.itemCode && it.itemCode !== mcrState.itemCode && !used.has(it.itemCode) && mcrFreeFor(it.itemCode) > 0);
  const list = (text || "").trim()
    ? materialSearch(pool, text, 40, it => [it.materialName, it.make, it.itemCode])
    : pool.slice(0, 40);
  const dd = mcrDropdownEl();
  if (list.length === 0) {
    dd.innerHTML = `<div style="padding:10px; color:var(--muted); font-size:0.85rem;">No material with free stock matches.</div>`;
  } else {
    dd.innerHTML = list.map(it => `<div onmousedown="mcrPick(${i}, ${jsArg(it.itemCode)})" style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.85rem;"
        onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''">
        <div style="font-weight:600;">${escapeHtml(it.materialName)}${it.make ? ` <span style="color:#64748b;">- Make: ${escapeHtml(it.make)}</span>` : ""}</div>
        <div style="color:#64748b; font-size:0.78rem;">${escapeHtml(it.itemCode)} · Free: ${fmtQty(mcrFreeFor(it.itemCode))} ${escapeHtml(it.unitType || "")}</div>
      </div>`).join("");
  }
  const rect = inp.getBoundingClientRect();
  dd.style.left = rect.left + "px";
  dd.style.top = (rect.bottom + 2) + "px";
  dd.style.width = Math.max(rect.width, 320) + "px";
  dd.style.display = "block";
}

function mcrPick(i, itemCode) {
  const it = (window.cachedInventoryStockCollection || cachedInventoryStockCollection || []).find(x => x.itemCode === itemCode);
  if (!it) return;
  const r = mcrState.rows[i];
  r.itemCode = it.itemCode;
  r.materialName = it.materialName + (it.make ? " - Make: " + it.make : "");
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

// Puts the in-stock part of the original material into the basket as a normal line.
function mcrPutKeptLine() {
  const s = mcrState;
  if (s.kept <= 0) {
    if (s.existingLine) dynamicTicketShoppingBasketArray.splice(dynamicTicketShoppingBasketArray.indexOf(s.existingLine), 1);
    return;
  }
  const over = s.kept > (Number(s.jcRemaining) || 0);
  if (s.existingLine) {
    s.existingLine.quantity = s.kept;
    s.existingLine.requiresBOQIncreaseFlag = over;
    s.existingLine.allottedRemainingLimit = Number(s.jcRemaining) || 0;
  } else {
    dynamicTicketShoppingBasketArray.push({
      materialName: s.materialName, quantity: s.kept, unitType: s.unitType || "NOS",
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

function mcrAddKeptOnly() { mcrPutKeptLine(); mcrFinish(); }

function mcrAddChangeToBasket() {
  const s = mcrState;
  const err = document.getElementById("mcr-error");
  const fail = (m) => { err.textContent = m; err.style.display = "block"; };
  err.style.display = "none";
  const fromQty = mcrRound(mcrNum(document.getElementById("mcr-from-qty").value));
  if (!(fromQty > 0)) return fail("Enter the quantity being replaced.");
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
  mcrPutKeptLine();
  dynamicTicketShoppingBasketArray.push({
    isMaterialChange: true, changeFromItemCode: s.itemCode, changeFromMaterialName: s.materialName,
    changeFromUnit: s.unitType || "", changeFromQty: fromQty, alternates: alts,
    materialName: s.materialName, itemCode: "", quantity: 0, unitType: s.unitType || "", requiresBOQIncreaseFlag: false,
  });
  mcrFinish();
}

// Basket row HTML for a change entry (used by renderDraftBasketTableViewportRows).
function materialChangeBasketRowHtml(rowItem, arrayIdx) {
  const alts = (rowItem.alternates || []).map(a =>
    `<div style="margin-top:3px;">→ ${escapeHtml(a.materialName)} <strong style="font-family:monospace;">${fmtQty(a.quantity)}</strong> ${escapeHtml(a.unitType || "")}</div>`).join("");
  return `
    <td style="font-weight:600; padding:10px 8px;">
      <div>Replace ${escapeHtml(rowItem.changeFromMaterialName)} <strong style="font-family:monospace;">${fmtQty(rowItem.changeFromQty)}</strong> ${escapeHtml(rowItem.changeFromUnit || "")}
        <span style="font-size:0.65rem; background:#fef3c7; color:#b45309; padding:1px 5px; border-radius:3px; font-weight:bold; margin-left:4px;">Material Change Approval Pending</span></div>
      <div style="font-size:0.85rem; color:#92400e;">${alts}</div>
    </td>
    <td style="text-align:center; font-weight:700; font-size:0.95rem;">—</td>
    <td style="font-family:monospace; font-weight:700; font-size:1.05rem; text-align:center;">—</td>
    <td style="text-align:center;">
      <button class="nav-btn-styled" onclick="removeSingleBasketItemLineAtIndex(${arrayIdx})" style="background:#e53e3e; padding:2px 8px; font-size:0.75rem;">Delete</button>
    </td>`;
}

// Submit helpers.
function basketNormalItems() { return (dynamicTicketShoppingBasketArray || []).filter(r => !r.isMaterialChange); }
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
  const th = (txt, al) => `<th style="border:1px solid var(--border); padding:8px; text-align:${al || "center"};">${txt}</th>`;
  const td = (html, al, extra) => `<td style="border:1px solid var(--border); padding:8px; text-align:${al || "center"}; ${extra || ""}">${html}</td>`;
  const groupsHtml = (t.groups || []).map(g => {
    const rows = g.alternates.map((a, ai) => `<tr>
      ${ai === 0 ? td(`<div style="font-weight:700;">${escapeHtml(g.fromMaterialName)}</div><div style="font-size:0.78rem; color:#64748b;">Store now: ${fmtQty(g.fromStockNow)} · JC Allotted ${fmtQty(g.jcAllotted)} · Used ${fmtQty(g.jcUsed)} · Remaining ${fmtQty(g.jcRemaining)}</div>`, "left", `vertical-align:top;" rowspan="${g.alternates.length}`) : ""}
      ${ai === 0 ? td(`<strong>${fmtQty(g.fromQty)}</strong> ${escapeHtml(g.fromUnit || "")}`, "center", `vertical-align:top;" rowspan="${g.alternates.length}`) : ""}
      ${td(`<div style="font-weight:600;">${escapeHtml(a.materialName)}</div><div style="font-size:0.78rem; color:#64748b;">${escapeHtml(a.itemCode)}</div>`, "left")}
      ${td(`${fmtQty(a.quantity)} ${escapeHtml(a.unitType || "")}`)}
      ${td(`<input type="number" min="0" max="${a.quantity}" step="any" value="${a.quantity}" data-group="${g.group}" data-itemcode="${escapeHtml(a.itemCode)}"
            class="mcr-approve-qty" oninput="if(parseFloat(this.value)>${a.quantity})this.value=${a.quantity}; if(parseFloat(this.value)<0)this.value=0;"
            style="width:90px; padding:5px; text-align:center; font-weight:700; border:2px solid #64748b; border-radius:4px;">`)}
      ${ai === 0 ? td(`<label style="display:flex; align-items:center; gap:6px; justify-content:center; margin:0; font-weight:700;">
            <input type="checkbox" class="mcr-approve-group" data-group="${g.group}" checked style="width:auto;"> Approve</label>`, "center", `vertical-align:top;" rowspan="${g.alternates.length}`) : ""}
    </tr>`).join("");
    return rows;
  }).join("");
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
          <colgroup><col style="width:28%"><col style="width:10%"><col style="width:28%"><col style="width:11%"><col style="width:12%"><col style="width:11%"></colgroup>
          <thead><tr style="background:var(--highlight-bg);">
            ${th("Change From", "left")}${th("Qty")}${th("Change To", "left")}${th("Asked Qty")}${th("Approved Qty")}${th("Decision")}
          </tr></thead>
          <tbody>${groupsHtml}</tbody>
        </table>
      </div>
      <div style="font-size:0.8rem; color:#475569; margin-bottom:10px;">Untick Approve to reject that change. Approved Qty can be lowered, not raised. Approved changes go to Approve Material Issue Tickets for Store to hand over.</div>
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
  card.querySelectorAll(".mcr-approve-group").forEach(cb => {
    const group = Number(cb.dataset.group);
    const approve = useTicks && cb.checked;
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
