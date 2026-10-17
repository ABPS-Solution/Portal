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

function ticketBulkRender() {
  const st = window._ticketBulk; const zone = document.getElementById("ticket-bulk-zone");
  if (!st || !zone) return;
  const sel = st.jcs.filter(j => st.selected.has(j.jobCardNumber)).map(j => j.jobCardNumber);
  const mats = ticketBulkMaterials();
  const th = "padding:8px; font-size:0.78rem; background:#f1f5f9; border:2px solid #94a3b8; text-align:center; vertical-align:middle;";
  const td = "padding:6px; border:2px solid #94a3b8; vertical-align:middle;";
  const head = `<tr><th style="${th} text-align:left; min-width:220px;">Material</th><th style="${th}">Unit</th>${sel.map(jc =>
    `<th style="${th} min-width:90px;" title="${escapeHtml(jc)}">${escapeHtml(ticketBulkSetLabel(jc))}</th>`).join("")}<th style="${th}">Total</th></tr>`;
  const rows = mats.map(m => {
    let total = 0;
    const cells = sel.map(jc => {
      const rem = ticketBulkRemaining(jc, m.itemCode);
      if (rem === null) return `<td style="${td} text-align:center; color:var(--muted); background:#f8fafc;">—</td>`;
      const v = st.qty[jc + "|" + m.itemCode];
      total += Number(v) || 0;
      const over = v !== undefined && v !== "" && Number(v) > rem + 1e-9;
      return `<td style="${td} ${over ? "background:#fef3c7;" : ""}">
        <input type="number" min="0" step="any" value="${v ?? ""}" placeholder="${fmtQty(rem)} left"
          data-jc="${escapeHtml(jc)}" data-code="${escapeHtml(m.itemCode)}" oninput="ticketBulkCell(this)"
          style="width:100%; box-sizing:border-box; padding:6px; text-align:center; font-weight:700; border:1.5px solid ${over ? "#b45309" : "var(--border)"}; border-radius:4px;" /></td>`;
    }).join("");
    return `<tr><td style="${td} font-weight:600;">${escapeHtml(m.materialName)}</td><td style="${td} text-align:center;">${escapeHtml(m.unitType || "")}</td>${cells}<td style="${td} text-align:center; font-weight:800;" id="tbulk-total-${escapeHtml(m.itemCode)}">${total ? fmtQty(total) : ""}</td></tr>`;
  }).join("");
  const anyOver = ticketBulkHasOver();
  zone.innerHTML = `
    <div class="cmit-box-title">Bulk Ticket — Several Job Cards</div>
    <p style="margin:0 0 10px; font-size:0.8rem; color:var(--muted);">One ticket is made for each Job Card, each against its own remaining quantity, and Store approves them together.
      A quantity above a Job Card's remaining goes to <strong>Approve Excess Material Request</strong> for that Job Card. Material Change and Production Memo purchase are done on a single Job Card ticket.</p>
    <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">${st.jcs.map(j => `
        <label style="display:flex; align-items:center; gap:5px; padding:5px 10px; border:1.5px solid ${st.selected.has(j.jobCardNumber) ? "var(--brand)" : "var(--border)"}; border-radius:999px; font-size:0.82rem; font-weight:700; cursor:pointer; background:#fff;">
          <input type="checkbox" ${st.selected.has(j.jobCardNumber) ? "checked" : ""} onchange="ticketBulkToggleJc(${jsArg(j.jobCardNumber)}, this.checked)" style="width:auto; margin:0;"> ${escapeHtml(ticketBulkSetLabel(j.jobCardNumber))}
        </label>`).join("")}</div>
      <select onchange="ticketBulkSetStore(this.value)" style="width:auto; padding:6px 8px; font-weight:600; border:2px solid #94a3b8; border-radius:var(--radius);">
        <option value="Raw Materials Store" ${st.store === "Raw Materials Store" ? "selected" : ""}>Raw Materials Store</option>
        <option value="Spare Store" ${st.store === "Spare Store" ? "selected" : ""}>Spare Store</option>
      </select>
    </div>
    <div style="overflow-x:auto; margin-bottom:10px;">
      ${mats.length ? `<table style="width:100%; border-collapse:collapse; background:#fff;">${head}${rows}</table>`
        : `<div style="padding:14px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">No materials on the chosen Job Cards.</div>`}
    </div>
    <div id="tbulk-reason-wrap" style="display:${anyOver ? "block" : "none"}; margin-bottom:10px;">
      <label class="field-label" style="margin-top:0; color:#b45309;">Why is the extra material needed? (cells above a Job Card's remaining) *</label>
      <textarea id="tbulk-reason" rows="2" style="width:100%; box-sizing:border-box; padding:8px; border:2px solid #94a3b8; border-radius:var(--radius);">${escapeHtml(st.reason || "")}</textarea>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border); padding-top:12px;">
      <button class="nav-btn-styled" onclick="ticketBulkClear()" style="width:auto; background:#718096; padding:9px 20px; font-weight:700;">Clear</button>
      <button class="nav-btn-styled" id="tbulk-submit-btn" onclick="ticketBulkSubmit()" style="width:auto; background:var(--accent); padding:9px 20px; font-weight:700;">Generate Bulk Ticket</button>
    </div>`;
}

function ticketBulkHasOver() {
  const st = window._ticketBulk; if (!st) return false;
  return Object.entries(st.qty).some(([k, v]) => {
    const [jc, code] = k.split("|");
    if (!st.selected.has(jc)) return false;
    const rem = ticketBulkRemaining(jc, code);
    return rem !== null && Number(v) > rem + 1e-9;
  });
}

function ticketBulkCell(inp) {
  const st = window._ticketBulk; if (!st) return;
  const key = inp.dataset.jc + "|" + inp.dataset.code;
  if (inp.value === "" || Number(inp.value) <= 0) delete st.qty[key]; else st.qty[key] = inp.value;
  const rem = ticketBulkRemaining(inp.dataset.jc, inp.dataset.code);
  const over = st.qty[key] !== undefined && rem !== null && Number(st.qty[key]) > rem + 1e-9;
  inp.style.borderColor = over ? "#b45309" : "var(--border)";
  inp.parentElement.style.background = over ? "#fef3c7" : "";
  const total = [...st.selected].reduce((s, jc) => s + (Number(st.qty[jc + "|" + inp.dataset.code]) || 0), 0);
  const tEl = document.getElementById("tbulk-total-" + inp.dataset.code);
  if (tEl) tEl.textContent = total ? fmtQty(total) : "";
  const reasonWrap = document.getElementById("tbulk-reason-wrap");
  if (reasonWrap) reasonWrap.style.display = ticketBulkHasOver() ? "block" : "none";
}

async function ticketBulkToggleJc(jc, on) {
  const st = window._ticketBulk; if (!st) return;
  st.reason = document.getElementById("tbulk-reason")?.value || st.reason;
  if (on) st.selected.add(jc); else st.selected.delete(jc);
  await ticketBulkLoad();
  ticketBulkRender();
}

function ticketBulkSetStore(v) {
  const st = window._ticketBulk; if (!st) return;
  st.store = v;
}

function ticketBulkClear() {
  const st = window._ticketBulk; if (!st) return;
  st.qty = {}; st.reason = "";
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
