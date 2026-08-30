function switchRevisePRNTab(tab) {
  const isQueue = tab === "queue";
  document.getElementById("rprn-queue-section").style.display = isQueue ? "block" : "none";
  document.getElementById("rprn-other-section").style.display = isQueue ? "none" : "block";
  const on = (b) => { b.style.color = "var(--brand)"; b.style.borderBottomColor = "var(--brand)"; b.style.fontWeight = "800"; };
  const off = (b) => { b.style.color = "var(--muted)"; b.style.borderBottomColor = "transparent"; b.style.fontWeight = "700"; };
  const q = document.getElementById("rprn-tab-queue"), o = document.getElementById("rprn-tab-other");
  isQueue ? (on(q), off(o)) : (on(o), off(q));
  if (isQueue) loadRPRNQueueTab();
  else initializeRevisePRNOtherTab();
}

async function initializeRevisePRNPanel() {
  const fb = document.getElementById("rprn-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  const tabsBar = document.getElementById("rprn-tabs-bar");
  if (tabsBar) tabsBar.style.display = "flex";
  switchRevisePRNTab('queue');
}

async function loadRPRNQueueTab() {
  const feed = document.getElementById("rprn-queue-feed");
  const deltaZone = document.getElementById("rprn-delta-zone");
  if (deltaZone) deltaZone.innerHTML = "";
  const fb = document.getElementById("rprn-delta-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  window.rprnPendingCreate = null;
  if (window._rprnDeltaStockInterval) { clearInterval(window._rprnDeltaStockInterval); window._rprnDeltaStockInterval = null; }
  window.rprnQueueMeta = {};
  feed.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted);">Loading…</div>`;
  try {
    const data = await apFetch({ action: "fetchBOQsNeedingPRNQueue", badgeFilter: "Revised" });
    const queue = (data.success ? (data.queue || []) : []);
    if (queue.length === 0) {
      feed.innerHTML = `<div style="padding:16px; background:#f0fff4; border:1px solid #86efac; border-radius:var(--radius); color:#15803d; font-size:0.85rem; font-weight:600; text-align:center;">✅ No BOQ revisions are waiting on a PRN revision.</div>`;
      return;
    }
    queue.forEach(item => { window.rprnQueueMeta[item.boqId] = item; });
    feed.innerHTML = queue.map(item => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; background:#fffbeb; border:1.5px solid #f59e0b; border-radius:var(--radius);">
        <div style="min-width:0; padding:6px 0;">
          <span style="font-size:0.68rem; font-weight:800; background:#fef3c7; color:#b45309; padding:2px 7px; border-radius:4px; margin-right:8px;">Revised</span>
          <span style="font-family:monospace; font-weight:700; font-size:0.8rem; color:var(--brand);">${item.boqId}</span>
          <div style="font-size:0.76rem; color:var(--muted); margin-top:2px;">${item.customerName || item.projectId} — ${item.productName || ""} ${item.productRating || ""}</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
          <span style="font-size:0.72rem; color:#78350f; max-width:300px; line-height:1.35;">The BOQ linked to this PRN was revised, which may have increased or decreased quantities for some materials. Revise the PRN to match.</span>
          <button class="nav-btn-styled" style="background:var(--brand); padding:6px 14px; font-size:0.76rem; font-weight:700; flex-shrink:0;"
            onclick="jumpToRPRNDelta('${item.boqId.replace(/'/g, "\\'")}', this)">
            Revise PRN →
          </button>
        </div>
      </div>`).join("");
  } catch (e) {
    feed.innerHTML = `<div style="color:var(--warn); padding:12px;">Network error: ${e.message}</div>`;
  }
}

function renderRPRNDeltaTable() {
  const pending = window.rprnPendingCreate;
  if (!pending) return;
  const zone = document.getElementById("rprn-delta-zone");

  const isDelta = !!pending.isDeltaPRN;
  const revBadge = isDelta
    ? `<span style="background:#fb923c; color:#fff; font-size:0.62rem; padding:2px 6px; border-radius:3px; font-weight:800; margin-left:8px;">REVISION v${pending.nextVersion}</span>`
    : "";

  const hasEditable = pending.lineItems.some(it => it.editable !== false);
  const hasReadOnly = pending.lineItems.some(it => it.editable === false);
  const anyDeferred = pending.lineItems.some(it => it.deferred);

  let rowsHtml = "";
  pending.lineItems.forEach((item, idx) => {
    const qty = Math.round((Number(item.bufferedPurchaseQty) || 0) * 100) / 100;
    const common = `
        <td style="padding:8px; font-family:monospace; font-size:0.78rem; font-weight:700; color:var(--brand);">${item.itemCode}</td>
        <td style="padding:8px; font-size:0.82rem; font-weight:600;">${item.materialName || ""}</td>
        <td style="padding:8px; text-align:center; font-weight:700; font-family:monospace;">${trimNum(item.boqRequiredQty)}</td>
        <td style="padding:8px; text-align:center; font-size:0.82rem; color:#b45309; font-weight:700;">${item.bufferPct || 0}%</td>
        <td style="padding:8px; text-align:center; font-weight:700; font-family:monospace; color:var(--brand);">${trimNum(item.bufferedRequirement)}</td>`;

    if (item.editable !== false) {
      const isIncrease = item.changeKind === "increase";
      const changeBadge = `<div style="font-size:0.7rem; font-weight:800; color:${isIncrease ? "#15803d" : "#2563eb"}; margin-top:3px;">${isIncrease ? "INCREASED" : "NEWLY ADDED"}</div>`;
      const prefillVal = isIncrease ? trimNum(item.previousStoreQty) : "";
      const storeqtyExtraClass = isIncrease ? "rprn-delta-increase-storeqty" : "";
      const bufferedReq = Number(item.bufferedRequirement) || 0;
      const initStoreAbs = isIncrease ? (Number(item.previousStoreQty) || 0) : 0;
      const initPurchaseRaw = Math.max(0, bufferedReq - initStoreAbs);
      const initPurchase = item.isCountUnit ? Math.ceil(initPurchaseRaw - 1e-9) : initPurchaseRaw;
      const rprnRowBg = isIncrease ? '#f0fdf4' : 'transparent';
      rowsHtml += `
      <tr style="border-bottom:1px solid #f1f5f9; background:${rprnRowBg};">${common}
        <td style="padding:8px; text-align:center; font-weight:700; font-family:monospace; font-size:0.95rem; color:var(--brand);">${trimNum(qty)}${changeBadge}</td>
        <td style="padding:8px; text-align:center; font-weight:600; font-family:monospace; font-size:0.85rem; color:#64748b;">${trimNum(item.previousStoreQty)}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#94a3b8; font-weight:700; background:#f8fafc;">${item.unit || "—"}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#6b7a8d; font-weight:600;"><span class="rprn-delta-livestock" data-itemcode="${item.itemCode}">loading…</span></td>
        <td style="padding:8px; text-align:center;">
          <input type="checkbox" class="rprn-delta-checked" data-idx="${idx}" style="width:20px; height:20px; cursor:pointer; accent-color:#9333ea;" />
        </td>
        <td style="padding:8px; text-align:center;">
          <input type="number" min="0" max="${bufferedReq}" value="${prefillVal}" placeholder="0" class="rprn-delta-storeqty ${storeqtyExtraClass}" data-idx="${idx}" data-buffered-req="${bufferedReq}" ${isIncrease ? "" : "disabled"}
            style="width:90px; text-align:center; font-weight:700; padding:5px; border:1.5px solid var(--brand); border-radius:3px; font-size:0.88rem; ${isIncrease ? "" : "opacity:0.5;"}" />
        </td>
        <td id="rprn-delta-purchaseqty-${idx}" style="padding:8px; text-align:center; font-weight:800; font-size:0.9rem; color:#1a2332;">${trimNum(initPurchase)}</td>
      </tr>`;
    } else {
      const removed = item.changeKind === "removed";
      const changeVal = Number(item.bufferedPurchaseQty) || 0;
      const changeBadge = `<div style="font-size:0.7rem; font-weight:800; color:${removed ? "#b91c1c" : "#f59e0b"}; margin-top:3px;">${removed ? "REMOVED FROM BOQ" : "DECREASED"}</div>`;
      const bufferedReq = Number(item.bufferedRequirement) || 0;
      const totalCovered = (Number(item.newStoreTotal) || 0) + (Number(item.newPurchaseTotal) || 0);
      const storeCap = Math.min(totalCovered, bufferedReq);
      const autoStoreQty = Math.min(Number(item.newStoreTotal) || 0, storeCap);
      const initPurchaseRaw = Math.max(0, bufferedReq - autoStoreQty);
      const initPurchase = item.isCountUnit ? Math.ceil(initPurchaseRaw - 1e-9) : initPurchaseRaw;

      rowsHtml += `
      <tr style="border-bottom:1px solid #f1f5f9; background:${removed ? '#fef2f2' : '#fffbeb'};">${common}
        <td style="padding:8px; text-align:center; font-weight:800; font-family:monospace; font-size:0.95rem; color:#b91c1c;">${trimNum(changeVal)}${changeBadge}</td>
        <td style="padding:8px; text-align:center; font-weight:600; font-family:monospace; font-size:0.85rem; color:#64748b;">${trimNum(item.previousStoreQty)}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#94a3b8; font-weight:700; background:#f8fafc;">${item.unit || "—"}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#6b7a8d; font-weight:600;"><span class="rprn-delta-livestock" data-itemcode="${item.itemCode}">loading…</span></td>
        <td style="padding:8px; text-align:center;">
          <input type="checkbox" class="rprn-delta-checked" data-idx="${idx}" style="width:20px; height:20px; cursor:pointer; accent-color:#9333ea;" />
        </td>
        <td style="padding:8px; text-align:center;">
          <input type="number" min="0" max="${storeCap}" value="${Number.isInteger(autoStoreQty) ? autoStoreQty : autoStoreQty.toFixed(2)}"
            class="rprn-delta-storeqty rprn-delta-decrease-storeqty" data-idx="${idx}" data-total-covered="${totalCovered}" data-buffered-req="${bufferedReq}" data-deferred="${item.deferred ? '1' : '0'}"
            oninput="updateRPRNDeltaDecreaseRowPurchaseQty(${idx}, this)"
            style="width:90px; text-align:center; font-weight:700; padding:5px; border:1.5px solid var(--brand); border-radius:3px; font-size:0.88rem;" />
        </td>
        <td id="rprn-delta-purchaseqty-${idx}" style="padding:8px; text-align:center; font-weight:800; font-size:0.9rem; color:#1a2332;">${trimNum(initPurchase)}</td>
      </tr>`;
    }
  });

  zone.innerHTML = `
    <div style="font-size:0.85rem; font-weight:700; color:var(--brand); margin-bottom:12px;">Revised Purchase Request Note for ${pending.boqId}${revBadge}</div>
    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
      <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:1150px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px; font-size:0.7rem; text-align:left;">Item Code</th>
            <th style="padding:8px; font-size:0.7rem; text-align:left; min-width:230px;">Material Name</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">New BOQ Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#b45309;">Buffer %</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:var(--brand); width:100px;">New Buffered BOQ Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:var(--brand);">Change in Req Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#64748b; width:95px;">Current PRN Store Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#94a3b8;">Unit</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#6b7a8d; min-width:150px;">Store Available Stock</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#9333ea; width:80px;">Checked *</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#0369a1; width:105px;">New Store Qty *</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#15803d; width:105px;">New Purchase Qty</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:14px; display:flex; justify-content:flex-end; align-items:center; gap:14px;">
      <button class="nav-btn-styled" id="rprn-delta-generate-btn" onclick="submitRPRNDelta()" style="background:var(--accent); padding:8px 24px; font-weight:700;">Submit for Authorization</button>
    </div>
  `;

  document.querySelectorAll(".rprn-delta-checked").forEach(cb => {
    cb.addEventListener("change", function() {
      const idx = this.dataset.idx;
      const input = document.querySelector(`.rprn-delta-storeqty[data-idx="${idx}"]`);
      if (!input) return;
      const isNewRow = !input.classList.contains("rprn-delta-decrease-storeqty") && !input.classList.contains("rprn-delta-increase-storeqty");
      if (isNewRow) { input.disabled = !this.checked; input.style.opacity = this.checked ? "1" : "0.5"; }
    });
  });

  document.querySelectorAll(".rprn-delta-storeqty").forEach(inp => {
    inp.addEventListener("input", function() {
      if (this.classList.contains("rprn-delta-decrease-storeqty")) return;
      const idx = this.dataset.idx;
      const item = pending.lineItems[idx];
      const bufferedReq = Math.round((Number(item.bufferedRequirement) || 0) * 100) / 100;
      const liveSpan = document.querySelector(`.rprn-delta-livestock[data-itemcode="${item.itemCode}"]`);
      const liveMax  = (liveSpan && liveSpan.dataset.liveTotal !== undefined) ? Number(liveSpan.dataset.liveTotal) || 0 : 0;
      const cap = Math.round(Math.min(bufferedReq, liveMax) * 100) / 100;
      let val = Math.round((parseFloat(this.value) || 0) * 100) / 100;
      if (val > cap) { val = cap; this.value = val; this.style.border = "1.5px solid #ef4444"; }
      else { this.style.border = "1.5px solid var(--brand)"; }

      if (liveSpan && liveSpan.dataset.liveRaw !== undefined) {
        const baseRaw = Number(liveSpan.dataset.liveRaw) || 0;
        const baseSpare = Number(liveSpan.dataset.liveSpare) || 0;
        const split = computeLiveStoreSplit(baseRaw, baseSpare, val);
        liveSpan.textContent = `${split.remainingRaw + split.remainingSpare} (Raw: ${split.remainingRaw}, Spare: ${split.remainingSpare})`;
      }

      const isCountUnit = (item.unit || "").toString().trim().toUpperCase() === "NOS";
      const rawPurchaseQty = Math.max(0, bufferedReq - val);
      const purchaseQty = isCountUnit ? Math.ceil(rawPurchaseQty - 1e-9) : rawPurchaseQty;

      const cell = document.getElementById(`rprn-delta-purchaseqty-${idx}`);
      if (cell) cell.textContent = trimNum(purchaseQty);
    });
  });

  refreshRPRNDeltaLiveStock();
  if (window._rprnDeltaStockInterval) clearInterval(window._rprnDeltaStockInterval);
  window._rprnDeltaStockInterval = setInterval(refreshRPRNDeltaLiveStock, 3000);
}

function totalCovered_dataset(inp) {
  const v = parseFloat(inp.dataset.totalCovered);
  return isNaN(v) ? Infinity : v;
}

function updateRPRNDeltaDecreaseRowPurchaseQty(idx, input) {
  const totalCovered = parseFloat(input.dataset.totalCovered) || 0;
  const item = window.rprnPendingCreate.lineItems[idx];
  const bufferedReq = Number(item.bufferedRequirement) || 0;
  const tr = input.closest("tr");
  const liveSpan = tr ? tr.querySelector(".rprn-delta-livestock") : null;
  const liveCap = (liveSpan && liveSpan.dataset.liveTotal !== undefined) ? Number(liveSpan.dataset.liveTotal) : totalCovered;
  const realCap = Math.min(totalCovered, bufferedReq, isNaN(liveCap) ? totalCovered : liveCap);
  let val = parseFloat(input.value) || 0;
  if (val < 0) { val = 0; input.value = "0"; }
  if (val > realCap) { val = Math.round(realCap * 100) / 100; input.value = val; }
  const purchaseCell = document.getElementById(`rprn-delta-purchaseqty-${idx}`);
  if (!purchaseCell) return;
  const purchaseQty = Math.max(0, bufferedReq - val);
  const rounded = item.isCountUnit ? Math.ceil(purchaseQty - 1e-9) : purchaseQty;
  purchaseCell.textContent = trimNum(rounded);
}

async function submitRPRNDelta() {
  const pending = window.rprnPendingCreate;
  if (!pending) return;

  const submittedItems = pending.lineItems.map((item, idx) => {
    const cb = document.querySelector(`.rprn-delta-checked[data-idx="${idx}"]`);
    const storeQtyInput = document.querySelector(`.rprn-delta-storeqty[data-idx="${idx}"]`);
    const checkedVal = cb && cb.checked ? "Yes" : "No";
    const storeQty    = storeQtyInput ? (parseFloat(storeQtyInput.value) || 0) : 0;
    return {
      itemCode: item.itemCode, materialName: item.materialName, typeOfMaterial: item.typeOfMaterial,
      unit: item.unit,
      boqRequiredQty: item.boqRequiredQty, bufferPct: item.bufferPct, bufferedPurchaseQty: item.bufferedPurchaseQty,
      currentUnassignedStoreQty: storeQty, checkedByStorePerson: checkedVal,
      editable: item.editable !== false, changeKind: item.changeKind
    };
  });

  const unchecked = submittedItems.find(it => it.checkedByStorePerson !== "Yes");
  if (unchecked) return showPurchaseFeedback("rprn-delta-feedback", `⚠️ All rows must be "Checked". "${unchecked.materialName}" is not checked yet.`, "error");

  const btn = document.getElementById("rprn-delta-generate-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Submitting...';
  showBlockingOverlay("Submitting Purchase Request Note Revision...");

  try {
    const meta = pending.boqMeta || {};
    const data = await apFetch({
      action: "createPurchaseRequestNote",
      activeEngineer: appActiveOperatorIdentityString,
      projectId: pending.projectId, boqId: pending.boqId,
      productName: meta.productName || "", productRating: meta.productRating || "",
      orderQuantity: meta.orderQuantity || pending.orderQty || 0,
      customerName: meta.customerName || "",
      lineItems: submittedItems
    });

    hideBlockingOverlay();
    if (!data.success) {
      showPurchaseFeedback("rprn-delta-feedback", data.error || "Failed to submit PRN revision.", "error");
      btn.disabled = false; btn.textContent = "Submit for Authorization";
      return;
    }

    document.getElementById("rprn-delta-zone").innerHTML = "";
    // Also clears the stale queue card for THIS BOQ — it's the same PRN
    // that was just submitted, and left visible otherwise (still reading
    // "Revised... Revise PRN →") behind the success banner. Stopping the
    // poll and nulling the pending state too, since both were left
    // running/set after a successful submit with nothing left to refresh.
    document.getElementById("rprn-queue-feed").innerHTML = "";
    if (window._rprnDeltaStockInterval) { clearInterval(window._rprnDeltaStockInterval); window._rprnDeltaStockInterval = null; }
    window.rprnPendingCreate = null;
    showPurchaseFeedback("rprn-delta-feedback",
      `✅ PRN revision: <strong>${data.prnId}</strong> submitted and sent for authorization.<br>` +
      `<button onclick="document.getElementById('rprn-delta-feedback').style.display='none'; loadRPRNQueueTab();" style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">+ Revise Another PRN</button>`,
      "success", true);
  } catch (e) {
    hideBlockingOverlay();
    showPurchaseFeedback("rprn-delta-feedback", "Network error: " + e.message, "error");
    btn.disabled = false; btn.textContent = "Submit for Authorization";
  }
}

async function initializeRevisePRNOtherTab() {
  document.getElementById("rprn-body").innerHTML = "";
  document.getElementById("rprn-prn-select").innerHTML = `<option value="">— Select a project first —</option>`;
  document.getElementById("rprn-selector-row").style.display = "grid";
  const sel = document.getElementById("rprn-project-select-ta-input");
  sel.value = "";
  const selDropList = document.getElementById("rprn-project-select-ta-dropdown");
  if (selDropList) selDropList.style.display = "none";
  try {
    const data = await apFetch({ action: "pullLiveActiveProjectCodes", statusFilter: "Active" });
    window.sharedActiveProjectCodes = data.success ? (data.projects || []) : [];
    window.sharedProjectMeta = data.success ? (data.projectMeta || {}) : {};
  } catch (e) {
    window.sharedActiveProjectCodes = [];
    sel.placeholder = "Failed to load projects";
  }
}

async function loadRevisePRNList() {
  const projectId = document.getElementById("rprn-project-select-ta-input").value;
  const prnSel = document.getElementById("rprn-prn-select");
  document.getElementById("rprn-body").innerHTML = "";
  if (!projectId) { prnSel.innerHTML = `<option value="">— Select a project first —</option>`; return; }
  prnSel.innerHTML = `<option value="">Loading…</option>`;
  try {
    // Only "Pending" PRNs — a Completed PRN has nothing left to procure,
    // so there is no split left to change.
    const data = await apFetch({ action: "fetchPRNsByProjectAndStatus", projectId, prnStatus: "Pending" });
    const prns = (data.success ? (data.prns || []) : []);
    window.rprnOtherListMeta = Object.fromEntries(prns.map(p => [p.prnId, p]));
    prnSel.innerHTML = prns.length === 0
      ? `<option value="">No open PRNs for this project</option>`
      : `<option value="">— Select PRN —</option>` + prns.map(p =>
          `<option value="${p.prnId.replace(/"/g,'&quot;')}">${p.productName || ""}${p.productRating ? " " + p.productRating : ""} | ${p.department || "—"}${p.version > 1 ? ` (v${p.version})` : ""}${p.revisionPending ? " — REVISION PENDING AUTHORIZATION" : ""}</option>`).join("");
  } catch (e) { prnSel.innerHTML = `<option value="">Failed to load PRNs</option>`; }
}

async function loadPRNForRevision() {
  const prnId = document.getElementById("rprn-prn-select").value;
  const body = document.getElementById("rprn-body");
  document.getElementById("rprn-feedback").style.display = "none";
  if (!prnId) { body.innerHTML = ""; window.rprnState = null; return; }
  const meta = (window.rprnOtherListMeta || {})[prnId];
  if (meta && meta.revisionPending) {
    body.innerHTML = `<div style="background:#fffbeb; border-left:4px solid #b45309; color:#78350f; padding:14px; border-radius:var(--radius);">This PRN has already been submitted for revision and is waiting for authorization.</div>`;
    window.rprnState = null;
    return;
  }
  body.innerHTML = `<div style="text-align:center; padding:26px; color:var(--muted);">Loading PRN…</div>`;
  try {
    const data = await apFetch({ action: "fetchPRNForRevision", prnId });
    if (!data.success) { body.innerHTML = `<div style="color:#b91c1c; padding:14px; background:#fef2f2; border-radius:6px;">${data.error}</div>`; return; }
    window.rprnState = { prn: data.prn, lineItems: data.lineItems || [] };
    renderRevisePRNTable();
  } catch (e) { body.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`; }
}

function renderRevisePRNTable() {
  const st = window.rprnState;
  if (!st) return;
  const fmt = (n) => (Number(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});

  const rows = st.lineItems.map((li, idx) => {
    const blocked = !!li.awaitingPoRevision;
    const minStore = Math.max(0, (Number(li.bufferedRequirement)||0) - (Number(li.onOrderQty)||0));
    // Store Available Stock = live free stock (raw+spare) + whatever this
    // PRN already has reserved — its own reservation is effectively
    // "available to itself" for re-splitting, on top of anything free.
    // Starts from the one-time backend figure (raw only) and gets
    // corrected to raw+spare the moment the live poll below returns.
    const maxStore = (Number(li.storeQty)||0) + (Number(li.availableStock)||0);
    const cap = Math.min(Number(li.bufferedRequirement)||0, maxStore);
    return `
      <tr style="border-bottom:1px solid #f1f5f9; ${blocked ? "background:#fffbeb;" : ""}">
        <td style="padding:8px; font-family:monospace; font-size:0.76rem; font-weight:700; color:var(--brand);">${li.itemCode}</td>
        <td style="padding:8px; font-size:0.8rem; font-weight:600;">${li.materialName || ""}</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:var(--brand);">${fmt(li.bufferedRequirement)}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#94a3b8; font-weight:700; background:#f8fafc;">${li.unit || "—"}</td>
        <td style="padding:8px; text-align:center; font-family:monospace;">${fmt(li.storeQty)}</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700;">${fmt(li.purchaseQty)}</td>
        <td style="padding:8px; text-align:center; font-size:0.74rem; color:${Number(li.onOrderQty) > 0 ? "#b45309" : "var(--muted)"}; font-weight:700;">${fmt(li.onOrderQty)}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#6b7a8d; font-weight:600;"><span class="rprn-livestock" data-itemcode="${li.itemCode}" data-idx="${idx}">loading…</span></td>
        <td style="padding:8px; text-align:center;">
          ${blocked
            ? `<span style="font-size:0.62rem; font-weight:800; color:#b45309;">⏳ AWAITING PO REVISION</span>`
            : `<input type="number" min="${minStore}" max="${cap}" step="any" class="rprn-store" data-idx="${idx}"
                 value="${Number(li.storeQty)||0}" oninput="updateRevisePRNRow(${idx})"
                 style="width:100px; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--brand); border-radius:4px; font-size:0.85rem;">`}
        </td>
        <td id="rprn-newpurch-${idx}" style="padding:8px; text-align:center; font-weight:800; font-size:0.88rem;">${fmt(li.purchaseQty)}</td>
      </tr>`;
  }).join("");

  document.getElementById("rprn-body").innerHTML = `
    <div style="font-size:0.85rem; font-weight:700; color:var(--muted); margin-bottom:10px;">PRN ID: <span style="font-family:monospace; color:var(--brand);">${st.prn.prnId}</span>${st.prn.version > 1 ? ` (v${st.prn.version})` : ""}</div>
    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius); margin-bottom:14px;">
      <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:1050px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:8px; font-size:0.68rem; text-align:left;">Item Code</th>
          <th style="padding:8px; font-size:0.68rem; text-align:left; min-width:190px;">Material Name</th>
          <th style="padding:8px; font-size:0.68rem; text-align:center; color:var(--brand);">New Buffered BOQ Qty</th>
          <th style="padding:8px; font-size:0.68rem; text-align:center; color:#94a3b8;">Unit</th>
          <th style="padding:8px; font-size:0.68rem; text-align:center;">Current PRN Store Qty</th>
          <th style="padding:8px; font-size:0.68rem; text-align:center;">Current PRN Purchase Qty</th>
          <th style="padding:8px; font-size:0.68rem; text-align:center;">P.O. On Order Qty</th>
          <th style="padding:8px; font-size:0.68rem; text-align:center; color:#6b7a8d; min-width:130px;">Store Available Stock</th>
          <th style="padding:8px; font-size:0.68rem; text-align:center; color:#0369a1;">New Store Qty *</th>
          <th style="padding:8px; font-size:0.68rem; text-align:center; color:#15803d;">New Purchase Qty</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:14px; display:flex; justify-content:flex-end;">
      <button class="nav-btn-styled" id="rprn-submit-btn" onclick="submitRevisePRN()" style="background:var(--accent); color:#fff; font-weight:700; padding:8px 22px;">Submit for Authorization</button>
    </div>`;

  if (window._rprnStockInterval) clearInterval(window._rprnStockInterval);
  refreshRevisePRNLiveStock();
  window._rprnStockInterval = setInterval(refreshRevisePRNLiveStock, 5000);
}

async function submitRevisePRN() {
  const st = window.rprnState;
  if (!st) return;
  const changed = [];
  for (const [idx, li] of st.lineItems.entries()) {
    const inp = document.querySelector(`.rprn-store[data-idx="${idx}"]`);
    if (!inp) continue;
    const newStore = parseFloat(inp.value) || 0;
    if (Math.abs(newStore - (Number(li.storeQty)||0)) < 1e-9) continue;
    const req = Number(li.bufferedRequirement) || 0;
    if (newStore > req + 1e-9) return showPurchaseFeedback("rprn-feedback", `⚠️ ${li.itemCode}: store cannot exceed the requirement of ${req}.`, "error");
    changed.push({ itemCode: li.itemCode, newStoreQty: newStore });
  }
  if (changed.length === 0) return showPurchaseFeedback("rprn-feedback", "⚠️ Nothing changed — adjust at least one store quantity.", "error");

  const btn = document.getElementById("rprn-submit-btn");
  btn.disabled = true; btn.textContent = "Submitting…";
  if (window._rprnStockInterval) { clearInterval(window._rprnStockInterval); window._rprnStockInterval = null; }
  showBlockingOverlay("Submitting PRN revision…");
  try {
    const data = await apFetch({ action: "submitPRNRevision", prnId: st.prn.prnId, lineItems: changed,
      operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("rprn-body").innerHTML = "";
      document.getElementById("rprn-selector-row").style.display = "none";
      document.getElementById("rprn-tabs-bar").style.display = "none";
      document.getElementById("rprn-queue-section").style.display = "none";
      window.rprnState = null;
      const fb = document.getElementById("rprn-feedback");
      if (fb) {
        fb.style.cssText = "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:12px; margin-bottom:12px; border-radius:var(--radius);";
        fb.innerHTML = `✅ PRN Revision submitted for <strong>${data.prnId}</strong>. ${data.changed.length} material(s) changed, pending authorization. 
          <div>
            <button onclick="initializeRevisePRNPanel();" style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">
              + Revise Another PRN
            </button>
          </div>`;
      }
    } else {
      btn.disabled = false; btn.textContent = "Submit for Authorization";
      showPurchaseFeedback("rprn-feedback", data.error || "Submission failed.", "error");
    }
  } catch (e) {
    hideBlockingOverlay();
    btn.disabled = false; btn.textContent = "Submit for Authorization";
    showPurchaseFeedback("rprn-feedback", "Network error: " + e.message, "error");
  }
}

// The authorize screen serves both kinds — a delta PRN from a BOQ change
// and a store/purchase re-split — since both sit in the same pending state
// on the same row. The menu card chooses which to show.
function openAuthorizePRNPanel(kind) {
  window.aprnKindFilter = kind || null;
  navigateToPurchaseWorkspacePanel('purchase-authorize-prn');
}

// DB status → user-facing label. The stored values stay as they are;
// only the wording changes, so nothing in the backend depends on this.
function prnStatusLabel(status, stillToOrder) {
  if (status === "Completed") return { text: "Completed", bg: "#dcfce7", fg: "#15803d" };
  if (status === "Pending Authorization") return { text: "Awaiting Authorization", bg: "#fef3c7", fg: "#78350f" };
  if (status === "PRN Generated") {
    return Number(stillToOrder) > 0
      ? { text: "Pending — Partially Ordered", bg: "#e0f2fe", fg: "#075985" }
      : { text: "Pending — Awaiting Delivery", bg: "#ede9fe", fg: "#5b21b6" };
  }
  return { text: status || "—", bg: "#f1f5f9", fg: "#475569" };
}

function prnStatusChip(status, stillToOrder) {
  const s = prnStatusLabel(status, stillToOrder);
  return `<span style="display:inline-block; font-size:0.68rem; font-weight:800; padding:3px 9px; border-radius:4px; background:${s.bg}; color:${s.fg};">${s.text}</span>`;
}

// ═══════════════════════════════════════════════════════
// DESIGN DASHBOARD ENGINE
// ═══════════════════════════════════════════════════════
let ddCurrentPeriod = "today";
let ddCurrentCustomType = "customday";
let ddChartDept = null, ddChartVersion = null, ddChartTrend = null;
let mdChartFunnel = null, mdChartPotential = null, mdChartVertical = null;
let mdCurrentPeriod = "today", mdCurrentCustomType = "customday";

