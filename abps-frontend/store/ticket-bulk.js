// Bulk Material Issue Ticket (17 Oct 2026). Several Job Cards of one BOQ in
// one request: a grid of materials x Job Cards, each cell checked against that
// Job Card's own remaining. The server makes one normal ticket per Job Card,
// tied by a bulk number (TKB_...), approved together on one card.

function ticketBulkSetNormalVisible(show) {
  const scopeRow = document.getElementById("lbl-store-scope-title")?.closest("div[style*='grid']");
  const basketBox = document.getElementById("shopping-basket-preview-table")?.closest(".cmit-box");
  [scopeRow, document.getElementById("wrapper-ticket-add-item-zone"), basketBox,
   document.getElementById("cmit-action-row")].forEach(el => { if (el) el.style.display = show ? "" : "none"; });
}

function ticketBulkClose() {
  const zone = document.getElementById("ticket-bulk-zone");
  if (!zone || zone.style.display === "none") { window._ticketBulk = null; return; }
  zone.style.display = "none";
  zone.innerHTML = "";
  window._ticketBulk = null;
  ticketBulkSetNormalVisible(true);
}

async function ticketBulkOpen() {
  const boqId = document.getElementById("ticket-boq-dropdown")?.value || "";
  const jcs = (window.ticketJobCardsCache || []).filter(jc => jc.boqId === boqId && !jc.hasFgEntry)
    .sort((a, b) => (Number(a.setNumber) || 0) - (Number(b.setNumber) || 0));
  const zone = document.getElementById("ticket-bulk-zone");
  if (!zone || jcs.length < 2) return;
  window._ticketBulk = { boqId, jcs, selected: new Set(jcs.map(j => j.jobCardNumber)), store: "Raw Materials Store", mats: {}, qty: {} };
  ticketBulkSetNormalVisible(false);
  zone.style.display = "block";
  zone.innerHTML = `<div style="padding:16px; color:var(--muted);">Loading Job Card materials...</div>`;
  await ticketBulkLoad();
  ticketBulkRender();
}

async function ticketBulkLoad() {
  const st = window._ticketBulk; if (!st) return;
  const projectId = document.getElementById("ticket-project-id-dropdown-ta-input")?.value || "";
  await Promise.all([...st.selected].filter(jc => !st.mats[jc]).map(async jc => {
    try {
      const d = await apFetch({ action: "fetchJobCardMaterials", jobCardNumber: jc, projectId });
      st.mats[jc] = (d.records || []).filter(r => !r.isConsumable && (r.typeOfStore || "Raw Materials Store") === "Raw Materials Store");
    } catch (e) { st.mats[jc] = []; }
  }));
}

function ticketBulkSetLabel(jc) {
  const row = (window._ticketBulk?.jcs || []).find(j => j.jobCardNumber === jc);
  return row && row.setNumber ? `Set ${row.setNumber}` : jc;
}

function ticketBulkMaterials() {
  const st = window._ticketBulk; const byCode = new Map();
  [...st.selected].forEach(jc => (st.mats[jc] || []).forEach(r => {
    if (!byCode.has(r.itemCode)) byCode.set(r.itemCode, { itemCode: r.itemCode, materialName: r.materialName, unitType: r.unitType });
  }));
  return [...byCode.values()].sort((a, b) => String(a.materialName).localeCompare(String(b.materialName)));
}

function ticketBulkRemaining(jc, code) {
  const r = (window._ticketBulk?.mats[jc] || []).find(m => m.itemCode === code);
  return r ? Number(r.remainingQty) || 0 : null;
}

// Layout: (1) Job Card picker (select all / none / by set range),
// (2) search a material, then fill one row per Job Card showing its own
// Allotted / Used / Remaining, (3) basket of added materials. Works the same
// for 100 materials or 80 Job Cards: nothing scrolls sideways.
function ticketBulkSelectedJcs() {
  const st = window._ticketBulk;
  return st.jcs.filter(j => st.selected.has(j.jobCardNumber)).map(j => j.jobCardNumber);
}

function ticketBulkMatRow(jc, code) {
  return (window._ticketBulk?.mats[jc] || []).find(m => m.itemCode === code) || null;
}

function ticketBulkBasketCodes() {
  const st = window._ticketBulk; const codes = [];
  ticketBulkMaterials().forEach(m => {
    if (ticketBulkSelectedJcs().some(jc => Number(st.qty[jc + "|" + m.itemCode]) > 0)) codes.push(m.itemCode);
  });
  return codes;
}

function ticketBulkRender() {
  const st = window._ticketBulk; const zone = document.getElementById("ticket-bulk-zone");
  if (!st || !zone) return;
  const reasonNow = document.getElementById("tbulk-reason")?.value;
  if (reasonNow !== undefined) st.reason = reasonNow;
  const selCount = st.selected.size;
  const pill = j => `
    <label style="display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border:1.5px solid ${st.selected.has(j.jobCardNumber) ? "var(--brand)" : "var(--border)"}; border-radius:999px; font-size:0.78rem; font-weight:700; cursor:pointer; background:${st.selected.has(j.jobCardNumber) ? "#eff6ff" : "#fff"};" title="${escapeHtml(j.jobCardNumber)}">
      <input type="checkbox" ${st.selected.has(j.jobCardNumber) ? "checked" : ""} onchange="ticketBulkToggleJc(${jsArg(j.jobCardNumber)}, this.checked)" style="width:auto; margin:0;"> ${escapeHtml(ticketBulkSetLabel(j.jobCardNumber))}
    </label>`;
  const btnS = "width:auto; padding:6px 12px; font-size:0.78rem; font-weight:700;";
  zone.innerHTML = `
    <div class="cmit-box-title">Bulk Ticket for Several Job Cards</div>
    <p style="margin:0 0 12px; font-size:0.8rem; color:var(--muted);">One ticket is made for each Job Card, each against its own remaining quantity, and Store approves them together.
      A quantity above a Job Card's remaining goes to <strong>Approve Excess Material Request</strong> for that Job Card.</p>

    <div style="background:#fff; border:1px solid var(--border); border-radius:6px; padding:10px 12px; margin-bottom:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
        <span style="font-weight:800; font-size:0.85rem;">Job Cards: ${selCount} of ${st.jcs.length} selected</span>
        <button class="nav-btn-styled" style="${btnS} background:var(--brand);" onclick="ticketBulkSelectRange('all')">Select all</button>
        <button class="nav-btn-styled" style="${btnS} background:#718096;" onclick="ticketBulkSelectRange('none')">Select none</button>
        <input id="tbulk-range" placeholder="Sets e.g. 1-10, 15" style="width:170px; padding:6px 8px; font-size:0.82rem;" onkeydown="if(event.key==='Enter')ticketBulkSelectRange(this.value)">
        <button class="nav-btn-styled" style="${btnS} background:var(--brand);" onclick="ticketBulkSelectRange(document.getElementById('tbulk-range').value)">Select these sets</button>
        <span style="flex:1;"></span>
        <select onchange="ticketBulkSetStore(this.value)" style="width:auto; padding:6px 8px; font-weight:600; border:2px solid #94a3b8; border-radius:var(--radius);">
          <option value="Raw Materials Store" ${st.store === "Raw Materials Store" ? "selected" : ""}>Raw Materials Store</option>
          <option value="Spare Store" ${st.store === "Spare Store" ? "selected" : ""}>Spare Store</option>
        </select>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; max-height:110px; overflow-y:auto;">${st.jcs.map(pill).join("")}</div>
    </div>

    <div style="background:#fff; border:1px solid var(--border); border-radius:6px; padding:10px 12px; margin-bottom:12px;">
      <label class="field-label" style="margin-top:0;">Add Material (search by name, rating, make or item code)</label>
      <div style="position:relative;">
        <input id="tbulk-search" autocomplete="off" placeholder="${selCount ? "Type to search this BOQ's materials..." : "Select at least one Job Card first"}" ${selCount ? "" : "disabled"}
          oninput="ticketBulkSearch(this.value)" onfocus="ticketBulkSearch(this.value)" style="width:100%; box-sizing:border-box; padding:9px;">
        <div id="tbulk-search-list" style="display:none; position:absolute; left:0; right:0; top:100%; z-index:50; background:#fff; border:1px solid var(--border); border-radius:6px; max-height:260px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.12);"></div>
      </div>
      <div id="tbulk-editor" style="margin-top:10px;"></div>
    </div>

    <div style="background:#fff; border:1px solid var(--border); border-radius:6px; padding:10px 12px; margin-bottom:12px;">
      <div style="font-weight:800; font-size:0.85rem; margin-bottom:8px;">Basket</div>
      <div id="tbulk-basket"></div>
    </div>

    <div id="tbulk-reason-wrap" style="display:none; margin-bottom:10px;">
      <label class="field-label" style="margin-top:0; color:#b45309;">Why is the extra material needed? (quantities above a Job Card's remaining) *</label>
      <textarea id="tbulk-reason" rows="2" style="width:100%; box-sizing:border-box; padding:8px; border:2px solid #94a3b8; border-radius:var(--radius);">${escapeHtml(st.reason || "")}</textarea>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border); padding-top:12px;">
      <button class="nav-btn-styled" onclick="ticketBulkClear()" style="width:auto; background:#718096; padding:9px 20px; font-weight:700;">Clear</button>
      <button class="nav-btn-styled" id="tbulk-submit-btn" onclick="ticketBulkSubmit()" style="width:auto; background:var(--accent); padding:9px 20px; font-weight:700;">Generate Bulk Ticket</button>
    </div>`;
  ticketBulkRenderEditor();
  ticketBulkRenderBasket();
}

function ticketBulkSearch(q) {
  const list = document.getElementById("tbulk-search-list"); if (!list) return;
  const mats = ticketBulkMaterials();
  const hits = String(q || "").trim()
    ? materialSearch(mats, q, 40, m => [m.materialName, m.itemCode])
    : mats.slice(0, 40);
  if (!hits.length) { list.innerHTML = `<div style="padding:10px; color:var(--muted); font-size:0.85rem;">No matching material on the selected Job Cards.</div>`; list.style.display = "block"; return; }
  const st = window._ticketBulk;
  list.innerHTML = hits.map(m => {
    const inBasket = ticketBulkSelectedJcs().some(jc => Number(st.qty[jc + "|" + m.itemCode]) > 0);
    return `<div onmousedown="event.preventDefault(); ticketBulkPick(${jsArg(m.itemCode)})"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.85rem;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background=''">
      <span style="font-weight:600;">${escapeHtml(m.materialName)}</span>
      <span style="color:var(--muted); font-size:0.75rem;"> · ${escapeHtml(m.itemCode)} · ${escapeHtml(m.unitType || "")}</span>
      ${inBasket ? `<span style="font-size:0.7rem; color:#15803d; font-weight:800; margin-left:6px;">IN BASKET</span>` : ""}
    </div>`;
  }).join("");
  list.style.display = "block";
}

document.addEventListener("mousedown", e => {
  const list = document.getElementById("tbulk-search-list");
  if (list && list.style.display !== "none" && !e.target.closest("#tbulk-search-list") && e.target.id !== "tbulk-search") list.style.display = "none";
});

function ticketBulkPick(code) {
  const st = window._ticketBulk; if (!st) return;
  const vals = {};
  ticketBulkSelectedJcs().forEach(jc => { const v = st.qty[jc + "|" + code]; if (v !== undefined) vals[jc] = v; });
  st.edit = { code, vals };
  const list = document.getElementById("tbulk-search-list"); if (list) list.style.display = "none";
  const inp = document.getElementById("tbulk-search"); if (inp) inp.value = "";
  ticketBulkRenderEditor();
}

function ticketBulkRenderEditor() {
  const st = window._ticketBulk; const box = document.getElementById("tbulk-editor");
  if (!st || !box) return;
  if (!st.edit) { box.innerHTML = ""; return; }
  const m = ticketBulkMaterials().find(x => x.itemCode === st.edit.code);
  if (!m) { st.edit = null; box.innerHTML = ""; return; }
  const th = "padding:7px 8px; font-size:0.76rem; background:#f1f5f9; border-bottom:2px solid #94a3b8; text-align:center; position:sticky; top:0; z-index:1;";
  const td = "padding:5px 8px; border-bottom:1px solid #e2e8f0; text-align:center; vertical-align:middle;";
  const rows = ticketBulkSelectedJcs().map(jc => {
    const r = ticketBulkMatRow(jc, m.itemCode);
    if (!r) return `<tr><td style="${td} font-weight:800; text-align:left;">${escapeHtml(ticketBulkSetLabel(jc))}</td><td colspan="4" style="${td} color:var(--muted);">Not on this Job Card</td></tr>`;
    const rem = Number(r.remainingQty) || 0; const v = st.edit.vals[jc];
    const over = v !== undefined && v !== "" && Number(v) > rem + 1e-9;
    return `<tr style="${over ? "background:#fef3c7;" : ""}">
      <td style="${td} font-weight:800; text-align:left;" title="${escapeHtml(jc)}">${escapeHtml(ticketBulkSetLabel(jc))}</td>
      <td style="${td}">${fmtQty(Number(r.allottedQty) || 0)}</td>
      <td style="${td}">${fmtQty(Number(r.usedQty) || 0)}</td>
      <td style="${td} color:#0369a1; font-weight:800;">${fmtQty(rem)}</td>
      <td style="${td} width:140px;"><input type="number" min="0" step="any" value="${v ?? ""}" placeholder="0" data-jc="${escapeHtml(jc)}" oninput="ticketBulkEditCell(this)"
        style="width:120px; padding:5px; text-align:center; font-weight:700; border:1.5px solid ${over ? "#b45309" : "var(--border)"}; border-radius:4px;"></td>
    </tr>`;
  }).join("");
  const btnS = "width:auto; padding:6px 12px; font-size:0.78rem; font-weight:700;";
  box.innerHTML = `
    <div style="border:2px solid var(--brand); border-radius:6px; padding:10px; background:#f8fbff;">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
        <div><div style="font-weight:800;">${escapeHtml(m.materialName)}</div>
          <div style="font-size:0.75rem; color:var(--muted);">${escapeHtml(m.itemCode)} · Unit ${escapeHtml(m.unitType || "")}</div></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <button class="nav-btn-styled" style="${btnS} background:var(--brand);" onclick="ticketBulkFillRemaining()">Fill each with its remaining</button>
          <input id="tbulk-same-qty" type="number" min="0" step="any" placeholder="Qty" style="width:80px; padding:6px;">
          <button class="nav-btn-styled" style="${btnS} background:var(--brand);" onclick="ticketBulkFillSame()">Same qty for every set</button>
          <button class="nav-btn-styled" style="${btnS} background:#718096;" onclick="ticketBulkEditClearVals()">Clear</button>
        </div>
      </div>
      <div style="max-height:380px; overflow-y:auto; border:1px solid var(--border); border-radius:4px; background:#fff;">
        <table style="width:100%; border-collapse:collapse;">
          <tr><th style="${th} text-align:left;">Job Card</th><th style="${th}">Allotted</th><th style="${th}">Used</th><th style="${th}">Remaining</th><th style="${th}">Qty to Issue</th></tr>
          ${rows}
        </table>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <div style="font-weight:800;">Total: <span id="tbulk-edit-total">0</span> ${escapeHtml(m.unitType || "")}
          <span id="tbulk-edit-over" style="display:none; color:#b45309; font-size:0.8rem; margin-left:8px;">Amber rows go as Excess Material Requests</span></div>
        <div style="display:flex; gap:8px;">
          <button class="nav-btn-styled" style="width:auto; background:#718096; padding:8px 16px; font-weight:700;" onclick="ticketBulkEditCancel()">Cancel</button>
          <button class="nav-btn-styled" style="width:auto; background:var(--accent); padding:8px 16px; font-weight:700;" onclick="ticketBulkEditSave()">Add to Basket</button>
        </div>
      </div>
    </div>`;
  ticketBulkEditRefreshTotal();
}

function ticketBulkEditRefreshTotal() {
  const st = window._ticketBulk; if (!st || !st.edit) return;
  let total = 0, over = false;
  ticketBulkSelectedJcs().forEach(jc => {
    const v = Number(st.edit.vals[jc]) || 0; total += v;
    const r = ticketBulkMatRow(jc, st.edit.code);
    if (r && v > (Number(r.remainingQty) || 0) + 1e-9) over = true;
  });
  const t = document.getElementById("tbulk-edit-total"); if (t) t.textContent = fmtQty(total);
  const o = document.getElementById("tbulk-edit-over"); if (o) o.style.display = over ? "inline" : "none";
}

function ticketBulkEditCell(inp) {
  const st = window._ticketBulk; if (!st || !st.edit) return;
  const jc = inp.dataset.jc;
  if (inp.value === "" || Number(inp.value) <= 0) delete st.edit.vals[jc]; else st.edit.vals[jc] = inp.value;
  const r = ticketBulkMatRow(jc, st.edit.code);
  const over = st.edit.vals[jc] !== undefined && r && Number(st.edit.vals[jc]) > (Number(r.remainingQty) || 0) + 1e-9;
  inp.style.borderColor = over ? "#b45309" : "var(--border)";
  inp.closest("tr").style.background = over ? "#fef3c7" : "";
  ticketBulkEditRefreshTotal();
}

function ticketBulkFillRemaining() {
  const st = window._ticketBulk; if (!st || !st.edit) return;
  ticketBulkSelectedJcs().forEach(jc => {
    const r = ticketBulkMatRow(jc, st.edit.code); const rem = r ? Number(r.remainingQty) || 0 : 0;
    if (rem > 0) st.edit.vals[jc] = String(rem); else delete st.edit.vals[jc];
  });
  ticketBulkRenderEditor();
}

function ticketBulkFillSame() {
  const st = window._ticketBulk; if (!st || !st.edit) return;
  const q = Number(document.getElementById("tbulk-same-qty")?.value) || 0;
  ticketBulkSelectedJcs().forEach(jc => {
    if (ticketBulkMatRow(jc, st.edit.code) && q > 0) st.edit.vals[jc] = String(q); else delete st.edit.vals[jc];
  });
  ticketBulkRenderEditor();
}

function ticketBulkEditClearVals() {
  const st = window._ticketBulk; if (!st || !st.edit) return;
  st.edit.vals = {}; ticketBulkRenderEditor();
}

function ticketBulkEditCancel() {
  const st = window._ticketBulk; if (!st) return;
  st.edit = null; ticketBulkRenderEditor();
}

function ticketBulkEditSave() {
  const st = window._ticketBulk; if (!st || !st.edit) return;
  const code = st.edit.code;
  Object.keys(st.qty).forEach(k => { if (k.endsWith("|" + code)) delete st.qty[k]; });
  Object.entries(st.edit.vals).forEach(([jc, v]) => { if (Number(v) > 0) st.qty[jc + "|" + code] = v; });
  st.edit = null;
  ticketBulkRenderEditor();
  ticketBulkRenderBasket();
  document.getElementById("tbulk-search")?.focus();
}

function ticketBulkRemove(code) {
  const st = window._ticketBulk; if (!st) return;
  Object.keys(st.qty).forEach(k => { if (k.endsWith("|" + code)) delete st.qty[k]; });
  if (st.edit && st.edit.code === code) st.edit = null;
  ticketBulkRenderEditor();
  ticketBulkRenderBasket();
}

function ticketBulkRenderBasket() {
  const st = window._ticketBulk; const box = document.getElementById("tbulk-basket");
  if (!st || !box) return;
  const codes = ticketBulkBasketCodes();
  const mats = ticketBulkMaterials();
  const reasonWrap = document.getElementById("tbulk-reason-wrap");
  if (reasonWrap) reasonWrap.style.display = ticketBulkHasOver() ? "block" : "none";
  if (!codes.length) { box.innerHTML = `<div style="padding:10px; color:var(--muted); font-size:0.85rem;">No materials added yet. Search a material above.</div>`; return; }
  const th = "padding:7px 8px; font-size:0.76rem; background:#f1f5f9; border:1px solid #cbd5e1; text-align:center;";
  const td = "padding:6px 8px; border:1px solid #cbd5e1; vertical-align:middle;";
  box.innerHTML = `<table style="width:100%; border-collapse:collapse;">
    <tr><th style="${th} text-align:left;">Material</th><th style="${th}">Unit</th><th style="${th} text-align:left;">Per Job Card</th><th style="${th}">Total</th><th style="${th}"></th></tr>
    ${codes.map(code => {
      const m = mats.find(x => x.itemCode === code) || { materialName: code };
      let total = 0;
      const parts = ticketBulkSelectedJcs().filter(jc => Number(st.qty[jc + "|" + code]) > 0).map(jc => {
        const q = Number(st.qty[jc + "|" + code]); total += q;
        const r = ticketBulkMatRow(jc, code); const over = r && q > (Number(r.remainingQty) || 0) + 1e-9;
        return `<span style="display:inline-block; margin:1px 6px 1px 0; ${over ? "color:#b45309; font-weight:800;" : ""}">${escapeHtml(ticketBulkSetLabel(jc))}: ${fmtQty(q)}${over ? " (excess)" : ""}</span>`;
      });
      return `<tr>
        <td style="${td} font-weight:600;">${escapeHtml(m.materialName)}<div style="font-size:0.72rem; color:var(--muted);">${escapeHtml(code)}</div></td>
        <td style="${td} text-align:center;">${escapeHtml(m.unitType || "")}</td>
        <td style="${td} font-size:0.78rem;"><div style="max-height:66px; overflow-y:auto;">${parts.join("")}</div></td>
        <td style="${td} text-align:center; font-weight:800;">${fmtQty(total)}</td>
        <td style="${td} text-align:center; white-space:nowrap;">
          <button class="nav-btn-styled" style="width:auto; padding:5px 10px; font-size:0.75rem; background:var(--brand);" onclick="ticketBulkPick(${jsArg(code)})">Edit</button>
          <button class="nav-btn-styled" style="width:auto; padding:5px 10px; font-size:0.75rem; background:#b91c1c;" onclick="ticketBulkRemove(${jsArg(code)})">Remove</button>
        </td></tr>`;
    }).join("")}</table>`;
}

function ticketBulkHasOver() {
  const st = window._ticketBulk; if (!st) return false;
  return Object.entries(st.qty).some(([k, v]) => {
    const i = k.lastIndexOf("|"); const jc = k.slice(0, i), code = k.slice(i + 1);
    if (!st.selected.has(jc)) return false;
    const rem = ticketBulkRemaining(jc, code);
    return rem !== null && Number(v) > rem + 1e-9;
  });
}

async function ticketBulkToggleJc(jc, on) {
  const st = window._ticketBulk; if (!st) return;
  if (on) st.selected.add(jc); else st.selected.delete(jc);
  await ticketBulkLoad();
  ticketBulkRender();
}

async function ticketBulkSelectRange(spec) {
  const st = window._ticketBulk; if (!st) return;
  if (spec === "all") st.selected = new Set(st.jcs.map(j => j.jobCardNumber));
  else if (spec === "none") st.selected = new Set();
  else {
    const want = new Set();
    String(spec || "").split(/[,\s]+/).forEach(p => {
      const m = /^(\d+)(?:-(\d+))?$/.exec(p.trim()); if (!m) return;
      const lo = Number(m[1]), hi = Number(m[2] || m[1]);
      for (let n = Math.min(lo, hi); n <= Math.max(lo, hi); n++) want.add(n);
    });
    if (!want.size) return ticketBulkFeedback("Type set numbers like <strong>1-10, 15</strong>.");
    st.selected = new Set(st.jcs.filter(j => want.has(Number(j.setNumber))).map(j => j.jobCardNumber));
  }
  await ticketBulkLoad();
  ticketBulkRender();
}

function ticketBulkSetStore(v) {
  const st = window._ticketBulk; if (!st) return;
  st.store = v;
}

function ticketBulkClear() {
  const st = window._ticketBulk; if (!st) return;
  st.qty = {}; st.reason = ""; st.edit = null;
  ticketBulkRender();
}

function ticketBulkFeedback(html, ok) {
  const b = document.getElementById("store-ticket-runtime-inline-feedback-banner");
  if (!b) return;
  b.style.cssText = ok
    ? "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:12px; margin-bottom:12px;"
    : "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:12px; margin-bottom:12px; text-align:left;";
  b.innerHTML = html;
  b.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function ticketBulkSubmit() {
  const st = window._ticketBulk; if (!st) return;
  const reason = (document.getElementById("tbulk-reason")?.value || "").trim();
  if (ticketBulkHasOver() && !reason) return ticketBulkFeedback("<strong>Compulsory Input Missing:</strong> Explain why the extra material is needed (cells above a Job Card's remaining).");
  const mats = ticketBulkMaterials();
  const jobCards = st.jcs.filter(j => st.selected.has(j.jobCardNumber)).map(j => {
    const jc = j.jobCardNumber, items = [], excessItems = [];
    mats.forEach(m => {
      const q = Number(st.qty[jc + "|" + m.itemCode]) || 0;
      if (q <= 0) return;
      const rem = ticketBulkRemaining(jc, m.itemCode) || 0;
      const line = { itemCode: m.itemCode, materialName: m.materialName, quantity: q, unitType: m.unitType, allottedRemainingLimit: rem };
      if (q > rem + 1e-9 && st.store === "Raw Materials Store") excessItems.push({ ...line, requiresBOQIncreaseFlag: true });
      else items.push(line);
    });
    return { jobCardNumber: jc, items, excessItems };
  }).filter(j => j.items.length || j.excessItems.length);
  if (jobCards.length < 2) return ticketBulkFeedback("<strong>Enter quantities for at least two Job Cards.</strong> For one Job Card, use a normal ticket.");

  const panel = document.getElementById("canvas-module-store-material-request");
  if (panel && !window.storeCreateTicketOriginalTemplateCacheHTML) {
    // Cache the form in its normal (non-bulk) state for "+ Create New Ticket".
    const clone = panel.cloneNode(true);
    const z = clone.querySelector("#ticket-bulk-zone"); if (z) { z.style.display = "none"; z.innerHTML = ""; }
    ["#wrapper-ticket-add-item-zone", "#cmit-action-row"].forEach(sel => { const el = clone.querySelector(sel); if (el) el.style.display = ""; });
    const basketBox = clone.querySelector("#shopping-basket-preview-table")?.closest(".cmit-box"); if (basketBox) basketBox.style.display = "";
    const scopeRow = clone.querySelector("#lbl-store-scope-title")?.closest("div[style*='grid']"); if (scopeRow) scopeRow.style.display = "";
    window.storeCreateTicketOriginalTemplateCacheHTML = clone.innerHTML;
  }
  const btn = document.getElementById("tbulk-submit-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Generating Bulk Ticket..."; }
  showBlockingOverlay("Submitting Bulk Material Issue Ticket...");
  try {
    const data = await apFetch({
      action: "submitBulkMaterialTicket", requestOrReturn: "Request", typeOfStore: st.store,
      projectId: document.getElementById("ticket-project-id-dropdown-ta-input")?.value || "",
      boqId: st.boqId, department: document.getElementById("ticket-department-outgoing-dropdown")?.value || "",
      requestedBy: appActiveOperatorIdentityString, operatorName: appActiveOperatorIdentityString,
      justificationNotesText: reason, jobCards,
    });
    hideBlockingOverlay();
    if (!data.success) {
      if (btn) { btn.disabled = false; btn.textContent = "Generate Bulk Ticket"; }
      return ticketBulkFeedback(`<strong>Submission Rejected by Server:</strong> ${escapeHtml(data.error || "")}`);
    }
    if (typeof cmitDraftClearAll === "function") cmitDraftClearAll();
    const rowsHtml = (data.tickets || []).map(t => `
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:8px 12px; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <span style="font-weight:800; min-width:70px;">${escapeHtml(ticketBulkSetLabel(t.jobCardNumber))}</span>
        ${t.ticketId ? `<span style="font-family:monospace; font-weight:700;">${escapeHtml(t.ticketId)}</span>` : ""}
        ${t.excessTicketId ? `<span style="font-size:0.8rem; color:#b45309; font-weight:700;">Excess request ${escapeHtml(t.excessTicketId)}</span>` : ""}
      </div>`).join("");
    panel.style.padding = "20px";
    panel.innerHTML = `
      <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; margin:10px 0;">
        <div style="background:#15803d; color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
          <div><div style="font-size:1.05rem; font-weight:800;">Bulk ticket ${escapeHtml(data.batchId)} created</div>
            <div style="font-size:0.85rem; opacity:0.9; margin-top:2px;">${(data.tickets || []).length} Job Cards · waiting in <strong>Approve Material Issue Tickets</strong> as one card</div></div>
          <button class="nav-btn-styled" style="width:auto; background:#fff; color:#15803d; padding:9px 18px; font-weight:800;" onclick="resetStoreCreateTicketToInitialState()">+ Create New Ticket</button>
        </div>
        <div style="padding:14px 18px; display:flex; flex-direction:column; gap:8px; background:#f0fdf4;">${rowsHtml}</div>
      </div>`;
    window._ticketBulk = null;
  } catch (e) {
    hideBlockingOverlay();
    if (btn) { btn.disabled = false; btn.textContent = "Generate Bulk Ticket"; }
    if (e.message !== "SESSION_EXPIRED") ticketBulkFeedback(`<strong>Network Error:</strong> ${escapeHtml(e.message)}`);
  }
}

// ── Approve Material Issue Tickets: one card per bulk ticket ──
function ticketBatchCardsHtml(tickets) {
  const groups = new Map();
  tickets.forEach(t => { if (!groups.has(t.batchId)) groups.set(t.batchId, []); groups.get(t.batchId).push(t); });
  const setOf = (jc) => { const m = /JC_Set-(\d+)/.exec(jc || ""); return m ? "Set " + m[1] : (jc || ""); };
  const th = "padding:7px; font-size:0.76rem; background:#f1f5f9; border:2px solid #94a3b8; text-align:center;";
  const td = "padding:6px; border:2px solid #94a3b8; vertical-align:middle; text-align:center;";
  return [...groups.entries()].map(([batchId, list]) => {
    const f = list[0];
    const rows = list.flatMap(t => (t.items || []).map(item => {
      const req = Number(item.quantity) || 0;
      const rem = item.jcRemainingQty;
      return `<tr>
        <td style="${td} text-align:left; font-weight:600;">${escapeHtml(item.materialName || item.itemCode)}</td>
        <td style="${td} font-weight:800;" title="${escapeHtml(t.jobCardNumber || "")}">${escapeHtml(setOf(t.jobCardNumber))}</td>
        <td style="${td}">${escapeHtml(item.unitType || "")}</td>
        <td style="${td} color:#0369a1; font-weight:700;">${rem !== null && rem !== undefined ? fmtQty(rem) : "—"}</td>
        <td style="${td} font-family:monospace; font-weight:700; color:var(--brand);">${fmtQty(req)}</td>
        <td style="${td}"><input type="number" class="tbatch-actual" data-ticket="${escapeHtml(t.ticketId)}" data-code="${escapeHtml(item.itemCode)}"
          value="${req}" min="0" max="${req}" step="any" oninput="if(Number(this.value)>${req})this.value=${req}"
          style="width:100%; box-sizing:border-box; padding:5px; text-align:center; font-family:monospace; font-weight:700; border:1.5px solid var(--border); border-radius:4px;" /></td>
      </tr>`;
    })).join("");
    const bid = escapeHtml(batchId);
    return `
      <div class="contact-summary-card-parent" id="tbatch-card-${bid}" style="border-left:5px solid var(--brand);">
        <div style="padding:12px 14px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
          <div>
            <div style="font-weight:800; color:var(--brand);">Bulk Ticket <span style="font-family:monospace;">${bid}</span>
              <span style="font-size:0.7rem; background:#dbeafe; color:#1e40af; padding:2px 8px; border-radius:999px; margin-left:6px;">${list.length} JOB CARDS</span></div>
            <div style="font-size:0.82rem; color:#475569; margin-top:4px;">${escapeHtml(f.projectId || "")} · ${escapeHtml(f.department || "")} · ${escapeHtml(f.storeTargetScope || "Raw Materials Store")} · by ${escapeHtml(f.requestedBy || "")}</div>
            <div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">Tickets: ${list.map(t => escapeHtml(t.ticketId)).join(", ")}</div>
          </div>
        </div>
        <div style="padding:0 14px 12px; overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; background:#fff;">
            <tr><th style="${th} text-align:left;">Material</th><th style="${th}">Job Card</th><th style="${th}">Unit</th><th style="${th}">JC Remaining</th><th style="${th}">Requested</th><th style="${th}">Actual Quantity</th></tr>
            ${rows}
          </table>
          <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">
            <button class="nav-btn-styled" onclick="ticketBatchAction(${jsArg(batchId)}, 'REJECT')" style="width:auto; background:#b91c1c; padding:8px 18px; font-weight:700;">Reject All</button>
            <button class="nav-btn-styled" onclick="ticketBatchAction(${jsArg(batchId)}, 'APPROVE')" style="width:auto; background:var(--accent); padding:8px 18px; font-weight:700;">Approve All</button>
          </div>
        </div>
      </div>`;
  }).join("");
}

async function ticketBatchAction(batchId, cmd) {
  const ok = await abpsConfirm(cmd === "APPROVE"
    ? `Approve and release every Job Card in bulk ticket ${batchId}?` : `Reject every Job Card in bulk ticket ${batchId}?`);
  if (!ok) return;
  const tickets = {};
  if (cmd === "APPROVE") {
    document.querySelectorAll(`#tbatch-card-${CSS.escape(batchId)} .tbatch-actual`).forEach(inp => {
      const t = inp.dataset.ticket;
      tickets[t] = tickets[t] || { actualQuantities: {} };
      tickets[t].actualQuantities[inp.dataset.code] = Number(inp.value) || 0;
    });
  }
  const banner = document.getElementById("store-approvals-runtime-inline-feedback-banner");
  showBlockingOverlay(cmd === "APPROVE" ? "Releasing bulk ticket..." : "Rejecting bulk ticket...");
  try {
    const data = await apFetch({ action: "actionTicketBatchApproval", batchId, managerDecisionCommand: cmd, tickets });
    hideBlockingOverlay();
    if (banner) {
      banner.style.cssText = data.success
        ? "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:12px; margin-bottom:12px;"
        : "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:12px; margin-bottom:12px;";
      banner.innerHTML = data.success
        ? `Bulk ticket ${escapeHtml(batchId)} ${cmd === "APPROVE" ? "approved and released" : "rejected"} (${data.count} Job Cards).${data.pdfUrl ? ` <a href="${driveLink(data.pdfUrl)}" target="_blank" rel="noopener">View Material Issue Ticket ↗</a>` : ""}`
        : `<strong>Could not ${cmd === "APPROVE" ? "approve" : "reject"}:</strong> ${escapeHtml(data.error || "")}`;
      banner.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (data.success && typeof initializeStoreManagerApprovalsWorkspace === "function") initializeStoreManagerApprovalsWorkspace();
  } catch (e) {
    hideBlockingOverlay();
    if (e.message !== "SESSION_EXPIRED" && banner) { banner.style.display = "block"; banner.textContent = e.message; }
  }
}
