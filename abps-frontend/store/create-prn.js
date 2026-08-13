async function openCPOAllocationPicker(rowId) {
  const row = window.cpoMaterialRows.find(r => r.id === rowId);
  if (!row) return;
  if (!row.itemCode) { alert("Select the material for this row first — the PRN list depends on which item code is being purchased."); return; }

  let prns = [];
  try {
    const res = await apFetch({ action: "fetchOpenPRNsForItemCode", itemCode: row.itemCode });
    prns = (res && res.success) ? (res.prns || []) : [];
  } catch (e) {
    alert("Could not load the PRN list for this material: " + e.message);
    return;
  }
  // Read back by saveCPOAllocationPicker to derive the row's Design Rate /
  // Qty (lowest design_rate_per_quantity among the PRNs actually chosen)
  // without a second round trip — only one allocation modal is ever open.
  window._cpoAllocOpenPrns = prns;

  const existing = document.getElementById("cpo-alloc-modal");
  if (existing) existing.remove();

  const lineQty = parseFloat(row.quantity) || 0;
  const fmtQty = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const existingByPrn = Object.fromEntries((row.allocations || []).map(a => [a.prnId, a.quantity]));
  let remaining = lineQty;
  const prefilled = prns.map(p => {
    if (existingByPrn[p.prnId] !== undefined) {
      const q = Number(existingByPrn[p.prnId]) || 0;
      remaining = Math.max(0, remaining - q);
      return { ...p, suggested: q };
    }
    const take = Math.min(remaining, Number(p.stillToOrder) || 0);
    remaining = Math.max(0, remaining - take);
    return { ...p, suggested: take };
  });

  const modal = document.createElement("div");
  modal.id = "cpo-alloc-modal";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.55); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;";

  const rowsHtml = prefilled.map((p) => `
    <div style="display:flex; align-items:center; gap:12px; padding:11px 12px; border:1px solid var(--border); border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:0.78rem; color:var(--brand); white-space:normal; line-height:1.4;">${p.productName || ""}${p.productRating ? " " + p.productRating : ""}</div>
        <div style="font-size:0.72rem; color:var(--muted);">${p.projectId || ""}</div>
      </div>
      <span style="font-size:0.7rem; font-weight:700; color:#15803d; background:#dcfce7; padding:2px 8px; border-radius:4px; white-space:nowrap;">Needs ${fmtQty(p.stillToOrder)}</span>
      <input type="number" min="0" max="${Number(p.stillToOrder) || 0}" step="any"
        class="cpo-alloc-input" data-prnid="${p.prnId}" data-max="${Number(p.stillToOrder) || 0}"
        value="${p.suggested > 0 ? p.suggested : ""}" placeholder="0"
        oninput="handleCPOAllocInput(this, ${lineQty})"
        style="width:100px; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--brand); border-radius:4px; font-size:0.85rem;">
    </div>`).join("");

  const noPrnNotice = prns.length === 0
    ? `<div style="padding:10px 12px; margin-bottom:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; font-size:0.8rem; color:#78350f;">No authorized PRN currently needs "${row.itemCode}". This line will be ordered entirely as extra available stock unless you add allocations to PRNs.</div>`
    : "";

  // Extra is always shown, never a manual input — it's just whatever's
  // left on the line after real PRN allocations, computed live. There's
  // nothing meaningful to type into it independently: the line quantity
  // is fixed by the material row, so "extra" can only ever be a
  // remainder, not an independent value.
  const extraRowHtml = `
    <div id="cpo-alloc-extra-row" style="display:flex; align-items:center; gap:12px; padding:11px 12px; border:1px dashed #f59e0b; border-radius:6px; margin-bottom:6px; font-size:0.85rem; background:#fffbeb;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:0.78rem; color:#78350f;">Extra</div>
      </div>
      <div id="cpo-alloc-extra-value" style="width:100px; text-align:center; font-weight:700; padding:6px; border:1.5px solid #f59e0b; border-radius:4px; font-size:0.85rem; background:#fff; color:#78350f;">0</div>
    </div>`;

  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; width:100%; max-width:600px; max-height:82vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.3); overflow:hidden;">
      <div style="padding:18px 20px; border-bottom:1px solid var(--border); background:#f8fafc;">
        <div style="font-weight:800; font-size:1rem; color:var(--brand);">Allocate ${fmtQty(lineQty)} ${row.unit || ""} of ${row.itemCode} to PRNs</div>
      </div>
      <div style="overflow-y:auto; flex:1; padding:16px 20px;">${noPrnNotice}${rowsHtml}${extraRowHtml}</div>
      <div id="cpo-alloc-summary" style="padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700;"></div>
      <div style="display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid var(--border); background:#f8fafc;">
        <button onclick="document.getElementById('cpo-alloc-modal').remove()" style="padding:9px 18px; border:1px solid var(--border); background:#fff; border-radius:6px; cursor:pointer; font-weight:600;">Cancel</button>
        <button onclick="saveCPOAllocationPicker(${rowId})" style="padding:9px 22px; background:var(--brand); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">Save Allocation</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  updateCPOAllocTotals(lineQty);
}

// Live-clamps whatever's being typed so the total across every PRN input
// (including this one) can never exceed the line quantity — the field
// currently being edited is capped to its own need AND to "line qty
// minus every OTHER field's current value", so e.g. typing 60 into a
// second row when a first row already holds 80 (line qty 100) clamps
// down to 20, the genuine remainder.
function handleCPOAllocInput(inputEl, lineQty) {
  const allInputs = Array.from(document.querySelectorAll(".cpo-alloc-input"));
  const sumOthers = allInputs.filter(i => i !== inputEl).reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
  const ownNeedCap = parseFloat(inputEl.dataset.max) || 0;
  const remainingForThis = Math.max(0, lineQty - sumOthers);
  const effectiveCap = Math.min(ownNeedCap, remainingForThis);
  const typed = parseFloat(inputEl.value) || 0;
  if (typed > effectiveCap + 1e-9) {
    inputEl.value = Math.round(effectiveCap * 100) / 100;
  }
  updateCPOAllocTotals(lineQty);
}

async function jumpToRPRNDelta(boqId, btn) {
  const meta = (window.rprnQueueMeta || {})[boqId];
  if (!meta) return;
  const projectId = meta.projectId;
  const deltaZone = document.getElementById("rprn-delta-zone");
  const originalHtml = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = "Loading..."; }
  deltaZone.style.display = "block";
  deltaZone.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">
    <div class="spinner" style="display:inline-block; width:18px; height:18px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:10px; vertical-align:middle;"></div>
    Loading materials for this BOQ...
  </div>`;
  try {
    const [previewData, personnelData] = await Promise.all([
      apFetch({ action: "previewPRNMaterials", projectId, boqId }),
      apFetch({ action: "getStoreOperatorsList" })
    ]);
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    if (!previewData.success) {
      deltaZone.innerHTML = `<div style="padding:16px; background:#fef2f2; border:1px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-weight:600;">${previewData.error || "Failed to load preview."}</div>`;
      return;
    }
    window.rprnPendingCreate = {
      projectId, boqId,
      lineItems: previewData.lineItems,
      isDeltaPRN: previewData.isDeltaPRN,
      nextVersion: previewData.nextVersion,
      orderQty: previewData.orderQty,
      boqMeta: meta, // captured directly from the queue row, not from window.prnBOQMeta (that's Create PRN's own dropdown-populated cache, unavailable here)
    };
    window.rprnAllPersonnel = personnelData.fullPersonnelDataRecordsTree || [];
    renderRPRNDeltaTable();
    deltaZone.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    deltaZone.innerHTML = `<div style="padding:16px; background:#fef2f2; border:1px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-weight:600;">Network error: ${e.message}</div>`;
  }
}

async function initializePRNPanel() {
  if (window._prnStockRefreshInterval) { clearInterval(window._prnStockRefreshInterval); window._prnStockRefreshInterval = null; }
  if (window._prnCreateStockInterval)  { clearInterval(window._prnCreateStockInterval);  window._prnCreateStockInterval  = null; }
  const projDrop = document.getElementById("prn-project-select-ta-input");
  const boqDrop  = document.getElementById("prn-boq-select");
  projDrop.placeholder = "Loading...";
  boqDrop.innerHTML  = '<option value="">— Select Project First —</option>';
  boqDrop.disabled   = true;
  boqDrop.style.opacity  = "0.5";
  boqDrop.style.cursor   = "not-allowed";
  document.getElementById("prn-details-zone").style.display = "none";
  document.getElementById("prn-feedback").style.display     = "none";
  const bodyZoneInit = document.getElementById("prn-body-zone");
  if (bodyZoneInit) bodyZoneInit.style.display = "grid";
  const successZoneInit = document.getElementById("prn-success-zone");
  if (successZoneInit) { successZoneInit.style.display = "none"; successZoneInit.innerHTML = ""; }
  const createZoneInit = document.getElementById("prn-create-zone");
  if (createZoneInit) { createZoneInit.style.display = "none"; createZoneInit.innerHTML = ""; }
  const noPrnZoneInit2 = document.getElementById("prn-none-found-zone");
  if (noPrnZoneInit2) { noPrnZoneInit2.style.display = "none"; noPrnZoneInit2.innerHTML = ""; }
  const boqUpdatedBadgeInit = document.getElementById("prn-boq-updated-badge");
  if (boqUpdatedBadgeInit) boqUpdatedBadgeInit.style.display = "none";
  window.prnPendingCreate = null;
  window.prnBOQMeta = {};
  window.prnAllPersonnel = [];
  prnCurrentData    = null;
  prnStoreQtyLocked = false;

  try {
    const data = await apFetch({ action:"pullLiveActiveProjectCodes" });
    if (!data || !data.success) {
      projDrop.placeholder = "Error loading projects";
      showPurchaseFeedback("prn-feedback", (data && data.error) ? data.error : "Failed to load project list. Please refresh.", "error");
      return;
    }
    // The typeahead input filters/renders from these two globals itself
    // (handleSharedProjectTypeaheadInput) — no <select> to populate here.
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
    projDrop.placeholder = "Type Project ID or Customer Name...";
  } catch(e) {
    projDrop.placeholder = "Error loading projects";
    showPurchaseFeedback("prn-feedback", "Failed to load project list: " + e.message, "error");
  }

  loadPRNNeedQueue();
}

async function loadPRNNeedQueue() {
  const zone = document.getElementById("prn-needqueue-zone");
  if (!zone) return;
  zone.style.display = "block"; // undo the "hide after success" state from a prior PRN creation
  zone.innerHTML = `<div style="text-align:center; padding:12px; color:var(--muted); font-size:0.8rem;">
    <div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>
    Checking which BOQs need a PRN...
  </div>`;
  try {
    // Only 'New' BOQs (never had a PRN) show here — a 'Revised' BOQ
    // (already has a PRN whose linked BOQ changed) now lives entirely
    // under Revise PRN's "BOQ Revisions Needing PRN Revision" tab, not
    // duplicated here.
    const data = await apFetch({ action: "fetchBOQsNeedingPRNQueue", badgeFilter: "New" });
    if (!data.success) { zone.innerHTML = ""; return; }
    const queue = data.queue || [];
    if (queue.length === 0) {
      zone.innerHTML = `<div style="padding:10px 14px; background:#f0fff4; border:1px solid #86efac; border-radius:var(--radius); color:#15803d; font-size:0.8rem; font-weight:600;">✅ No new BOQs need a PRN.</div>`;
      return;
    }
    const rows = queue.map(item => {
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid #f1f5f9;">
          <div style="min-width:0;">
            <span style="font-family:monospace; font-weight:700; font-size:0.8rem; color:var(--brand);">${item.boqId}</span>
            <div style="font-size:0.76rem; color:var(--muted); margin-top:2px;">${item.customerName || item.projectId} <strong> | </strong>  ${item.productName || ""} ${item.productRating || ""}</div>
          </div>
          <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
            <button class="nav-btn-styled prn-queue-create-btn" data-boqid="${item.boqId.replace(/"/g,"&quot;")}" style="background:var(--brand); padding:6px 14px; font-size:0.76rem; font-weight:700; flex-shrink:0;"
              onclick="jumpToPRNFromQueue('${item.projectId.replace(/'/g, "\\'")}', '${item.boqId.replace(/'/g, "\\'")}', this)">
              Create PRN →
            </button>
          </div>
        </div>`;
    }).join("");

    zone.innerHTML = `
      <div style="background:#fffbeb; border:1.5px solid #f59e0b; border-radius:var(--radius); overflow:hidden;">
        <div style="padding:10px 14px; font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#b45309; letter-spacing:0.5px; background:#fef3c7;">
          BOQs Needing a PRN (${queue.length})
        </div>
        ${rows}
      </div>`;
  } catch(e) {
    zone.innerHTML = "";
  }
}

async function jumpToPRNFromQueue(projectId, boqId, btn) {
  const projDrop = document.getElementById("prn-project-select-ta-input");
  const boqDrop  = document.getElementById("prn-boq-select");
  if (!projDrop) return;

  const originalHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="display:inline-block;width:10px;height:10px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Loading...';
  }

  try {
    projDrop.value = projectId;
    await handlePRNProjectChange(projectId);
    if (boqDrop) {
      boqDrop.value = boqId;
      await handlePRNBOQChange(boqId, true);
    }
    const bodyZone = document.getElementById("prn-body-zone");
    if (bodyZone) bodyZone.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
  }
}

async function handlePRNProjectChange(projectId) {
  const boqDrop = document.getElementById("prn-boq-select");
  document.getElementById("prn-details-zone").style.display = "none";
  document.getElementById("prn-feedback").style.display     = "none";
  prnCurrentData = null;

  if (!projectId) {
    boqDrop.innerHTML = '<option value="">— Select Project First —</option>';
    boqDrop.disabled  = true; boqDrop.style.opacity = "0.5"; boqDrop.style.cursor = "not-allowed";
    return;
  }

  boqDrop.innerHTML = '<option value="">Loading...</option>';
  boqDrop.disabled  = true;

  try {
    const data = await apFetch({ action:"fetchAuthorizedBOQsForUpdate", projectId });
    boqDrop.innerHTML = '<option value="">— Select BOQ —</option>';
    window.prnBOQMeta = {};
    (data.drafts || []).forEach(draft => {
      const opt = document.createElement("option");
      opt.value = draft.boqId;
      opt.textContent = draft.boqId;
      boqDrop.appendChild(opt);
      window.prnBOQMeta[draft.boqId] = { productName: draft.productName, productRating: draft.productRating, orderQuantity: draft.orderQuantity, customerName: draft.customerName };
    });
    boqDrop.disabled = false; boqDrop.style.opacity = "1"; boqDrop.style.cursor = "pointer";
  } catch(e) {
    boqDrop.innerHTML = '<option value="">Error loading BOQs</option>';
  }
}

function togglePRNCardExpanded(expandId, toggleTextId) {
  const zone = document.getElementById(expandId);
  const txt  = document.getElementById(toggleTextId);
  if (!zone) return;
  const isOpen = zone.style.display !== "none";
  zone.style.display = isOpen ? "none" : "block";
  if (txt) txt.textContent = isOpen ? "expand and view materials" : "collapse";
}

function togglePRNExpanded() {
  const expandedZone = document.getElementById("prn-expanded-zone");
  const toggleText    = document.getElementById("prn-expand-toggle-text");
  if (!expandedZone) return;
  const isOpen = expandedZone.style.display !== "none";
  expandedZone.style.display = isOpen ? "none" : "block";
  if (toggleText) toggleText.textContent = isOpen ? "expand and view materials" : "collapse";
}

function syncPRNQueueButtonState() {
  const activeBoqId = (window.prnPendingCreate && window.prnPendingCreate.lineItems) ? window.prnPendingCreate.boqId : null;
  document.querySelectorAll(".prn-queue-create-btn").forEach(btn => {
    btn.style.display = (btn.dataset.boqid === activeBoqId) ? "none" : "";
  });
}

async function startNewPRNCreation() {
  const projDrop = document.getElementById("prn-project-select-ta-input");
  const boqDrop  = document.getElementById("prn-boq-select");
  const projectId = projDrop ? projDrop.value : "";
  const boqId     = boqDrop  ? boqDrop.value  : "";
  if (!projectId || !boqId) return;

  document.getElementById("prn-details-zone").style.display = "none";
  document.getElementById("prn-feedback").style.display     = "none";
  const noPrnZoneInit = document.getElementById("prn-none-found-zone");
  if (noPrnZoneInit) noPrnZoneInit.style.display = "none";

  const createZone = document.getElementById("prn-create-zone");
  createZone.style.display = "block";
  createZone.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">
    <div class="spinner" style="display:inline-block; width:18px; height:18px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:10px; vertical-align:middle;"></div>
    Loading materials for this BOQ...
  </div>`;

  try {
    const [previewData, personnelData, boqMetaCheck] = await Promise.all([
      apFetch({ action: "previewPRNMaterials", projectId, boqId }),
      apFetch({ action: "getStoreOperatorsList" }),
      Promise.resolve((window.prnBOQMeta || {})[boqId] || {})
    ]);

    if (!previewData.success) {
      createZone.innerHTML = `<div style="padding:16px; background:#fef2f2; border:1px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-weight:600;">${previewData.error || "Failed to load preview."}</div>`;
      return;
    }

    window.prnPendingCreate = {
      projectId, boqId,
      lineItems: previewData.lineItems,
      isDeltaPRN: previewData.isDeltaPRN,
      nextVersion: previewData.nextVersion,
      orderQty: previewData.orderQty
    };
    window.prnAllPersonnel = personnelData.fullPersonnelDataRecordsTree || [];

    renderPRNCreateTable();
    syncPRNQueueButtonState();
  } catch(e) {
    createZone.innerHTML = `<div style="padding:16px; background:#fef2f2; border:1px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-weight:600;">Network error: ${e.message}</div>`;
  }
}

async function handlePRNBOQChange(boqId, skipToCreate) {
  const detailsZone = document.getElementById("prn-details-zone");
  const createZone  = document.getElementById("prn-create-zone");
  const noPrnZone   = document.getElementById("prn-none-found-zone");

  detailsZone.style.display = "none";
  if (createZone) createZone.style.display = "none";
  if (noPrnZone)  noPrnZone.style.display  = "none";
  document.getElementById("prn-feedback").style.display = "none";
  prnCurrentData = null;
  // Switching away from whatever BOQ was mid-edit means that button in
  // the queue should reappear — clearing prnPendingCreate before this
  // resync makes syncPRNQueueButtonState treat everything as inactive.
  window.prnPendingCreate = null;
  syncPRNQueueButtonState();
  if (!boqId) return;

  const projectId = document.getElementById("prn-project-select-ta-input").value;

  // Show a loading indicator while we check for an existing PRN
  if (noPrnZone) {
    noPrnZone.style.display = "block";
    noPrnZone.innerHTML = `<div style="text-align:center; padding:16px; color:var(--muted);">
      <div class="spinner" style="display:inline-block; width:14px; height:14px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>
      Checking for existing PRNs...
    </div>`;
  }

  try {
    // Step 1: Check if a PRN already exists for this BOQ
    const fetchData = await apFetch({ action: "fetchPRNsForProject", projectId });

    if (!fetchData.success) {
      if (noPrnZone) noPrnZone.style.display = "none";
      showPurchaseFeedback("prn-feedback", fetchData.error || "Failed to load PRNs.", "error");
      return;
    }

    const existingPRN = (fetchData.prns || []).find(p => p.boqId === boqId && p.status !== "Closed");

    if (noPrnZone) noPrnZone.style.display = "none";

    const activePRNs = (fetchData.prns || []).filter(p => p.boqId === boqId && p.status !== "Closed");

    if (activePRNs.length > 0) {
      detailsZone.style.display = "block";
      prnCurrentData = activePRNs[activePRNs.length - 1]; // latest is the anchor for delta
      renderAllPRNCards(activePRNs, boqId);
      return;
    }

    // No PRN exists. Coming here via the "BOQs Needing a PRN" queue's
    // own "Create PRN →" button means the user has already effectively
    // decided to create one — skip the intermediate confirmation step
    // and go straight to the material table. A manually searched BOQ
    // still gets the confirmation step, since that path wasn't an
    // explicit "create" action.
    window.prnPendingCreate = { projectId, boqId };
    if (skipToCreate) {
      await startNewPRNCreation();
      return;
    }
    if (noPrnZone) {
      noPrnZone.style.display = "block";
      noPrnZone.innerHTML = `<div style="text-align:center; padding:16px; background:#fff7ed; border:1.5px solid #fb923c; border-radius:var(--radius); color:#9a3412; font-weight:700;">No PRN exists yet for this BOQ ID.</div>
        <div style="text-align:center; margin-top:12px;">
          <button class=\"nav-btn-styled\" onclick=\"startNewPRNCreation();\" style=\"background:var(--brand); padding:8px 24px; font-weight:700;\">+ Create New PRN for this BOQ</button>
        </div>`;
    }
    return;
  } catch(e) {
    document.getElementById("prn-feedback").style.display = "block";
    document.getElementById("prn-feedback").textContent = "Network error: " + e.message;
  }
}

// ── Authorize Purchase Request Note ──────────────────────────────────
// Mirrors the BOQ authorize pattern: a queue of pending PRNs, each
// expandable into an editable review. Only Store Quantity is editable;
// Purchase Qty recomputes from it live (purchase = buffered − store,
// rounded up for NOS units, exactly as the backend recomputes it).
let aprnList = [];
let aprnExpandedId = null;
let aprnRows = [];

async function initializeAuthorizePRNPanel() {
  const feed = document.getElementById("aprn-cards-feed");
  const fb = document.getElementById("aprn-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  if (!feed) return;

  const isRevision = window.aprnKindFilter === 'Revision';
  const titleEl = document.getElementById("aprn-panel-title");
  const subtitleEl = document.getElementById("aprn-panel-subtitle");
  if (titleEl) titleEl.textContent = isRevision ? "Authorize Purchase Request Note (PRN) Revision" : "Authorize Purchase Request Note (PRN)";
  if (subtitleEl) subtitleEl.textContent = isRevision
    ? "Review each pending PRN re-split, adjust Store Quantity if needed, then authorize or reject."
    : "Review each pending PRN, adjust Store Quantity if needed, then authorize or reject.";

  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);"><div class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>Loading pending PRNs...</div>`;
  aprnExpandedId = null; aprnRows = [];

  try {
    const data = await apFetch({ action: "fetchPendingPRNsForAuthorization" });
    const allPrns = Array.isArray(data && data.prns) ? data.prns : [];
    // fetchPendingPRNsForAuthorization already computes pendingKind
    // ('Revision' when draft_line_items only carries resplit rows, else
    // 'Delta') — filter client-side to whichever menu card was used.
    aprnList = window.aprnKindFilter ? allPrns.filter(p => p.pendingKind === window.aprnKindFilter) : allPrns;

    if (aprnList.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:30px; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <h3 style="color:var(--accent); margin:0 0 6px 0;">No PRN${isRevision ? " Revisions" : ""} Pending Authorization</h3>
      </div>`;
      return;
    }

    feed.innerHTML = "";
    aprnList.forEach(p => {
      const card = document.createElement("div");
      card.className = "contact-summary-card-parent";
      card.innerHTML = `
        <div class="contact-summary-header-row" onclick="toggleAPRNExpansion('${p.prnId}')" style="cursor:pointer; width:100%; padding-bottom:8px;">
          <div class="contact-summary-title-info" style="width:100%;">
            <div class="meta-row-line-block" style="margin-bottom:6px;">
              <span style="background:#edf2f7;">Customer:</span><strong style="margin-right:15px;">${p.customerName || ""}</strong>
              <span style="background:#edf2f7;">Project ID:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:700; color:var(--brand); margin-right:15px;">${p.projectId || ""}</span>
              <span style="background:#edf2f7;">Created By:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827;">${p.storePerson || ""}</span>
            </div>
            <div class="meta-row-line-block" style="margin-bottom:6px;">
              <span style="background:#e2e8f0;">Product:</span><strong style="margin-right:15px;">${p.productName || ""} ${p.productRating || ""}</strong>
              <span style="background:#edf2f7;">Date:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827; margin-right:15px;">${formatDateDMY(p.createdDate)}</span>
              <span style="background:#edf2f7;">Version:</span><span style="background:none; text-transform:none; padding:0; font-size:0.95rem; font-weight:400; color:#111827;">v${p.version}</span>
            </div>
            </div>
        </div>
        <div id="aprn-body-${p.prnId}" style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;"></div>`;
      feed.appendChild(card);
    });
  } catch (e) {
    feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Sync Error: ${e.message}</div>`;
  } finally {
    // Never leave the feed blank — any silent early exit still shows something.
    if (feed && !feed.innerHTML.trim()) {
      feed.innerHTML = `<div style="text-align:center; padding:30px; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <h3 style="color:var(--accent); margin:0;">No PRN${window.aprnKindFilter === 'Revision' ? " Revisions" : "s"} Pending Authorization</h3>
      </div>`;
    }
  }
}

function toggleAPRNExpansion(prnId) {
  const body = document.getElementById(`aprn-body-${prnId}`);
  if (!body) return;
  if (aprnExpandedId === prnId) { body.style.display = "none"; body.innerHTML = ""; aprnExpandedId = null; return; }
  if (aprnExpandedId) {
    const prev = document.getElementById(`aprn-body-${aprnExpandedId}`);
    if (prev) { prev.style.display = "none"; prev.innerHTML = ""; }
  }
  aprnExpandedId = prnId;
  const prn = aprnList.find(p => p.prnId === prnId);
  if (!prn) return;
  aprnRows = (prn.draftLineItems || []).map(r => ({ ...r }));

  const isRevision = window.aprnKindFilter === 'Revision';
  body.style.display = "block";
  body.innerHTML = `
    <div style="font-size:0.82rem; font-weight:700; color:var(--brand); margin-bottom:12px;">PRN: <span style="font-family:monospace;">${prnId}</span></div>
    <div id="aprn-rows-mount-${prnId}"></div>
    <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border); padding-top:14px; margin-top:14px;">
      <button class="nav-btn-styled" id="aprn-reject-btn-${prnId}" onclick="rejectPRN('${prnId}')" style="background:#dc2626; padding:8px 20px; font-weight:700;">Reject PRN${isRevision ? " Revision" : ""}</button>
      <button class="nav-btn-styled" id="aprn-auth-btn-${prnId}" onclick="authorizePRN('${prnId}')" style="background:var(--accent); padding:8px 24px; font-weight:700;">Authorize PRN${isRevision ? " Revision" : ""}</button>
    </div>`;
  renderAPRNRows(prnId);
}

function renderAPRNRows(prnId) {
  const mount = document.getElementById(`aprn-rows-mount-${prnId}`);
  if (!mount) return;
  const isRevision = window.aprnKindFilter === 'Revision';

  if (isRevision) {
    // Revision mode mirrors Revise PRN's exact column set and order —
    // every row shown (not just changed ones), New Store Qty * seeded
    // with whatever was actually submitted there (newStoreTotal, an
    // ABSOLUTE total — not the incremental storeDelta a Delta PRN's
    // 'new'/'increase' rows use), and every row editable since a resplit
    // never produces a non-editable (awaiting-PO) row in its draft.
    const fmt = (n) => (Number(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});
    const hasDeltaRows = aprnRows.some(r => r.changeKind && r.changeKind !== 'resplit');
    const anyDeferred = aprnRows.some(r => r.deferred);
    // Purchase side computed live from bufferedRequirement/newStoreTotal —
    // both already correct on screen — rather than trusting the stored
    // purchaseDelta/newPurchaseTotal fields, which can lag the true
    // requirement for a removed/resized item.
    const liveNewPurchase = (r) => Math.max(0, (Number(r.bufferedRequirement) || 0) - (Number(r.newStoreTotal) || 0));
    const changedRows = aprnRows.filter(r => {
      const storeChanged = Math.abs((Number(r.newStoreTotal) || 0) - (Number(r.previousStoreQty) || 0)) > 1e-9;
      const purchaseChanged = Math.abs(liveNewPurchase(r) - (Number(r.previousPurchaseQty) || 0)) > 1e-9;
      return storeChanged || purchaseChanged;
    });
    const changeSummary = changedRows.length > 0 ? `
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:4px; padding:10px 14px; margin-bottom:10px;">
        <div style="font-size:0.82rem; font-weight:1000; color:var(--brand); margin-bottom:6px;">Change Summary</div>
        ${changedRows.map(r => `<div style="font-size:0.86rem; color:#334155; margin-bottom:4px;">
          <strong>${r.materialName || ""}:</strong> ${r.deltaRequirement !== undefined ? `Change in BOQ Qty: <strong> ${fmt(r.deltaRequirement)}` : ""} </strong>  |  Store QTY: <strong> ${fmt(r.previousStoreQty)} → ${fmt(r.newStoreTotal)} </strong>  |  Purchase QTY: <strong>${fmt(r.previousPurchaseQty)} → ${fmt(liveNewPurchase(r))}</strong>
        </div>`).join("")}
      </div>` : "";
    const rowsHtml = aprnRows.map((r, idx) => {
      const isDecreaseOrRemoved = r.changeKind === 'decrease' || r.changeKind === 'removed';
      const totalCovered = (Number(r.previousStoreQty) || 0) + (Number(r.previousPurchaseQty) || 0);
      const buffered = Number(r.bufferedRequirement) || 0;
      const storeCap = isDecreaseOrRemoved ? Math.min(totalCovered, buffered) : buffered;
      const minStore = isDecreaseOrRemoved ? 0 : Math.max(0, buffered - (Number(r.onOrderQty) || 0));
      const changeBadge = r.changeKind === 'increase' ? `<div style="font-size:0.65rem; font-weight:800; color:#15803d; margin-top:2px;">INCREASED</div>`
        : r.changeKind === 'new' ? `<div style="font-size:0.65rem; font-weight:800; color:#2563eb; margin-top:2px;">NEWLY ADDED</div>`
        : r.changeKind === 'decrease' ? `<div style="font-size:0.65rem; font-weight:800; color:#f59e0b; margin-top:2px;">DECREASED</div>`
        : r.changeKind === 'removed' ? `<div style="font-size:0.65rem; font-weight:800; color:#b91c1c; margin-top:2px;">REMOVED FROM BOQ</div>`
        : "";
      const deferredNote = "";
      const rowBg = r.changeKind === 'decrease' ? '#fffbeb'
        : r.changeKind === 'removed' ? '#fef2f2'
        : r.changeKind === 'increase' ? '#f0fdf4'
        : 'transparent';
      return `
        <tr style="border-bottom:1px solid #f1f5f9; background:${rowBg};">
          <td style="padding:8px; font-family:monospace; font-size:0.78rem; font-weight:700; color:var(--brand);">${r.itemCode || ""}</td>
          <td style="padding:8px; font-size:0.82rem; font-weight:600;">${r.materialName || ""}</td>
          <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:var(--brand);">${fmt(buffered)}${changeBadge}</td>
          <td style="padding:8px; text-align:center; font-size:0.78rem; color:#94a3b8; font-weight:700; background:#f8fafc;">${r.unit || "—"}</td>
          <td style="padding:8px; text-align:center; font-family:monospace;">${fmt(r.previousStoreQty)}</td>
          <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700;">${fmt(r.previousPurchaseQty)}</td>
          <td style="padding:8px; text-align:center; font-size:0.74rem; color:${Number(r.onOrderQty) > 0 ? "#b45309" : "var(--muted)"}; font-weight:700;">${fmt(r.onOrderQty)}</td>
          <td style="padding:8px; text-align:center; font-size:0.78rem; color:#6b7a8d; font-weight:600;"><span class="aprn-livestock" data-itemcode="${r.itemCode}">loading…</span></td>
          <td style="padding:8px; text-align:center;">
            <input type="number" min="${minStore}" max="${storeCap}" value="${Number(r.newStoreTotal) || 0}"
              class="aprn-storeqty" data-idx="${idx}" data-decrease-row="${isDecreaseOrRemoved ? '1' : '0'}" data-total-covered="${totalCovered}" data-deferred="${r.deferred ? '1' : '0'}"
              oninput="updateAPRNRow(${idx}, this.value, '${prnId}')"
              style="width:90px; text-align:center; font-weight:700; padding:5px; border:1.5px solid var(--brand); border-radius:3px; font-size:0.88rem;" />
          </td>
          <td id="aprn-purchaseqty-${idx}" style="padding:8px; text-align:center; font-weight:800; font-size:0.9rem; color:#1a2332;">${trimNum(Math.max(0, buffered - (Number(r.newStoreTotal) || 0)))}${deferredNote}</td>
        </tr>`;
    }).join("");

    mount.innerHTML = `
      ${changeSummary}
      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
        <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:1050px;">
          <thead><tr style="background:#f8fafc;">
            <th style="padding:8px; font-size:0.7rem; text-align:left;">Item Code</th>
            <th style="padding:8px; font-size:0.7rem; text-align:left; min-width:190px;">Material Name</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:var(--brand);">New Buffered BOQ Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#94a3b8;">Unit</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">Current PRN Store Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">Current PRN Purchase Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">P.O. On Order Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#6b7a8d; min-width:130px;">Store Available Stock</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#0369a1;">New Store Qty *</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#15803d;">New Purchase Qty</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    if (window._aprnStockInterval) clearInterval(window._aprnStockInterval);
    refreshAPRNLiveStock();
    window._aprnStockInterval = setInterval(refreshAPRNLiveStock, 5000);
    return;
  }

  const rowsHtml = aprnRows.map((r, idx) => {
  // editable rows (new/increase) store the full requirement in
  // bufferedRequirement; decrease/removed rows are computed and
  // store the signed change in deltaRequirement instead.
  const buffered = r.editable !== false ? (Number(r.bufferedRequirement) || 0) : Math.abs(Number(r.deltaRequirement) || 0);
  const trimN = (n) => { const x = Number(n) || 0; return Number.isInteger(x) ? String(x) : x.toFixed(2); };
    return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:8px; font-family:monospace; font-size:0.78rem; font-weight:700; color:var(--brand);">${r.itemCode || ""}</td>
        <td style="padding:8px; font-size:0.82rem; font-weight:600;">${r.materialName || ""}</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700;">${trimN(r.boqRequiredQty)}</td>
        <td style="padding:8px; text-align:center; color:#b45309; font-weight:700;">${r.bufferPct || 0}%</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:var(--brand);">${trimN(buffered)}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#94a3b8; font-weight:700; background:#f8fafc;">${r.unit || "—"}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#6b7a8d; font-weight:600;"><span class="aprn-livestock" data-itemcode="${r.itemCode}">loading…</span></td>
        <td style="padding:8px; text-align:center;">
          ${r.editable === false
            ? `<span style="font-family:monospace; font-weight:700;">${trimN(r.newStoreTotal ?? r.currentUnassignedStoreQty ?? 0)}</span>
               <div style="font-size:0.6rem; color:#94a3b8; font-weight:700;">AUTO</div>`
            : `<input type="number" min="0" max="${buffered}" value="${Number(r.storeDelta) || 0}"
                 class="aprn-storeqty" data-idx="${idx}"
                 oninput="updateAPRNRow(${idx}, this.value, '${prnId}')"
                 style="width:90px; text-align:center; font-weight:700; padding:5px; border:1.5px solid var(--brand); border-radius:3px; font-size:0.88rem;" />`}
        </td>
        <td id="aprn-purchaseqty-${idx}" style="padding:8px; text-align:center; font-weight:800; font-size:0.9rem; color:#1a2332;">${trimN(r.editable !== false ? Number(r.purchaseDelta || 0) : Number(r.newPurchaseTotal || 0))}</td>
      </tr>`;
  }).join("");

  mount.innerHTML = `
    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
      <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:1000px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:8px; font-size:0.7rem; text-align:left;">Item Code</th>
          <th style="padding:8px; font-size:0.7rem; text-align:left; min-width:240px;">Material Name</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center;">BOQ Qty</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; color:#b45309;">Buffer %</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; color:var(--brand);">Buffered BOQ Qty</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; color:#94a3b8;">Unit</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; color:#6b7a8d; min-width:130px;">Store Available Stock</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; color:#0369a1;">Store Quantity *</th>
          <th style="padding:8px; font-size:0.7rem; text-align:center; color:#15803d;">Purchase Qty</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;

  if (window._aprnStockInterval) clearInterval(window._aprnStockInterval);
  refreshAPRNLiveStock();
  window._aprnStockInterval = setInterval(refreshAPRNLiveStock, 5000);
}

async function authorizePRN(prnId) {
  const authBtn = document.getElementById(`aprn-auth-btn-${prnId}`);
  const rejBtn = document.getElementById(`aprn-reject-btn-${prnId}`);
  if (authBtn) { authBtn.disabled = true; authBtn.textContent = "Authorizing..."; }
  if (rejBtn) rejBtn.disabled = true;
  // The commit can land server-side before this request's response comes
  // back (PDF generation happens after commit, adding latency) — if the
  // 5s poll fires in that window it fetches already-updated live stock
  // but combines it with stale pre-commit "what this row holds" data,
  // producing a display-only inflated number with no bearing on the
  // actual (correct) committed math. Stop polling before it can race.
  if (window._aprnStockInterval) { clearInterval(window._aprnStockInterval); window._aprnStockInterval = null; }
  showBlockingOverlay("Authorizing Purchase Request Note...");

  // Grab display fields before the queue gets wiped/reloaded.
  const prn = aprnList.find(p => p.prnId === prnId) || {};

  try {
    const data = await apFetch({
      action: "authorizePurchaseRequestNote",
      prnId,
      editedLineItems: aprnRows,
      authorizedBy: appActiveOperatorIdentityString || ""
    });
    hideBlockingOverlay();
    if (data.success) {
      checkStorePRNRevisionReminder();
      checkPurchasePORevisionReminder();
      const feed = document.getElementById("aprn-cards-feed");
      if (feed) feed.style.display = "none";

      const pdfNote = data.pdfUrl ? `<div style="font-size:0.78rem; margin-top:6px;">📄 <a href="${driveLink(data.pdfUrl)}" target="_blank" style="color:var(--accent); font-weight:700;">View PRN PDF</a></div>` : ``;

      const fb = document.getElementById("aprn-feedback");
      if (fb) {
        fb.style.borderLeftColor = "var(--accent)";
        fb.style.background      = "#f0fff4";
        fb.style.color           = "#276749";
        fb.style.display         = "block";
        fb.innerHTML = `
          <div style="font-size:0.85rem; font-weight:800; margin-bottom:10px;">✅ Purchase Request Note Authorized Successfully!</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; font-size:0.8rem; margin-bottom:14px;">
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">PRN ID</span><span style="font-family:monospace; font-weight:800;">${prnId}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Project ID</span><span style="font-weight:700;">${prn.projectId || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Customer</span><span style="font-weight:700;">${prn.customerName || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Product</span><span style="font-weight:700;">${prn.productName || ""} ${prn.productRating || ""}</span></div>
            <div><span style="font-size:0.65rem; font-weight:700; color:#276749; text-transform:uppercase; display:block;">Order Qty (Sets)</span><span style="font-weight:700;">${Math.round(Number(prn.orderQuantity) || 0)}</span></div>
          </div>
          ${pdfNote}
          <button onclick="
            const _cf=document.getElementById('aprn-cards-feed');
            if(_cf){_cf.innerHTML='';_cf.style.display='';}
            document.getElementById('aprn-feedback').style.display='none';
            initializeAuthorizePRNPanel();"
            style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">
            + Authorize Another PRN
          </button>`;
      }
    } else {
      if (authBtn) { authBtn.disabled = false; authBtn.textContent = window.aprnKindFilter === 'Revision' ? "Authorize PRN Revision" : "Authorize PRN"; }
      if (rejBtn) rejBtn.disabled = false;
      showPurchaseFeedback("aprn-feedback", data.error || "Authorization failed.", "error");
    }
  } catch (e) {
    hideBlockingOverlay();
    if (authBtn) { authBtn.disabled = false; authBtn.textContent = window.aprnKindFilter === 'Revision' ? "Authorize PRN Revision" : "Authorize PRN"; }
    if (rejBtn) rejBtn.disabled = false;
    showPurchaseFeedback("aprn-feedback", "Network error: " + e.message, "error");
  }
}

async function rejectPRN(prnId) {
  if (!confirm(`Reject PRN ${prnId}? Reserved store quantities will be released and no purchase lines will be created.`)) return;
  const authBtn = document.getElementById(`aprn-auth-btn-${prnId}`);
  const rejBtn = document.getElementById(`aprn-reject-btn-${prnId}`);
  if (rejBtn) { rejBtn.disabled = true; rejBtn.textContent = "Rejecting..."; }
  if (authBtn) authBtn.disabled = true;
  if (window._aprnStockInterval) { clearInterval(window._aprnStockInterval); window._aprnStockInterval = null; }

  try {
    const data = await apFetch({ action: "rejectPurchaseRequestNote", prnId });
    if (data.success) {
      showPurchaseFeedback("aprn-feedback", `PRN ${prnId} was rejected and its store reservations released.`, "success");
      await initializeAuthorizePRNPanel();
    } else {
      if (rejBtn) { rejBtn.disabled = false; rejBtn.textContent = window.aprnKindFilter === 'Revision' ? "Reject PRN Revision" : "Reject PRN"; }
      if (authBtn) authBtn.disabled = false;
      showPurchaseFeedback("aprn-feedback", data.error || "Rejection failed.", "error");
    }
  } catch (e) {
    if (rejBtn) { rejBtn.disabled = false; rejBtn.textContent = window.aprnKindFilter === 'Revision' ? "Reject PRN Revision" : "Reject PRN"; }
    if (authBtn) authBtn.disabled = false;
    showPurchaseFeedback("aprn-feedback", "Network error: " + e.message, "error");
  }
}

function renderPRNCreateTable() {
  const pending = window.prnPendingCreate;
  if (!pending) return;
  const createZone = document.getElementById("prn-create-zone");

  const isDelta = !!pending.isDeltaPRN;
  const revBadge = isDelta
    ? `<span style="background:#fb923c; color:#fff; font-size:0.62rem; padding:2px 6px; border-radius:3px; font-weight:800; margin-left:8px;">REVISION v${pending.nextVersion}</span>`
    : "";

  const hasEditable = pending.lineItems.some(it => it.editable !== false);
  const hasReadOnly = pending.lineItems.some(it => it.editable === false);
  const anyDeferred = pending.lineItems.some(it => it.deferred);

  let rowsHtml = "";
  pending.lineItems.forEach((item, idx) => {
    const trimNum = (n) => { const x = Number(n) || 0; return Number.isInteger(x) ? String(x) : x.toFixed(2); };
    const common = `
        <td style="padding:8px; font-family:monospace; font-size:0.78rem; font-weight:700; color:var(--brand);">${item.itemCode}</td>
        <td style="padding:8px; font-size:0.82rem; font-weight:600;">${item.materialName || ""}</td>
        <td style="padding:8px; font-size:0.8rem; color:#475569;">${item.typeOfMaterial || "—"}</td>
        <td style="padding:8px; text-align:center; font-weight:700; font-family:monospace;">${trimNum(item.boqRequiredQty)}</td>
        <td style="padding:8px; text-align:center; font-size:0.82rem; color:#b45309; font-weight:700;">${item.bufferPct || 0}%</td>
        <td style="padding:8px; text-align:center; font-weight:700; font-family:monospace; color:var(--brand);">${trimNum(item.bufferedRequirement)}</td>`;

    if (item.editable !== false) {
      // New / increased coverage. "increase" rows pre-fill with their
      // Current PRN Store Qty (this PRN already holds that much) and start
      // enabled immediately — consistent with Revise PRN. "new" rows
      // (truly new to the BOQ, nothing held yet) stay empty and gated
      // behind the checkbox, as before.
      const isIncrease = item.changeKind === "increase";
      const prefillVal = isIncrease ? trimNum(item.previousStoreQty) : "";
      const storeqtyExtraClass = isIncrease ? "prn-create-increase-storeqty" : "";
      const bufferedReq = Number(item.bufferedRequirement) || 0;
      const initStoreAbs = isIncrease ? (Number(item.previousStoreQty) || 0) : 0;
      const initPurchaseRaw = Math.max(0, bufferedReq - initStoreAbs);
      const initPurchase = item.isCountUnit ? Math.ceil(initPurchaseRaw - 1e-9) : initPurchaseRaw;
      rowsHtml += `
      <tr style="border-bottom:1px solid #f1f5f9;">${common}
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#94a3b8; font-weight:700; background:#f8fafc;">${item.unit || "—"}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#6b7a8d; font-weight:600;"><span class="prn-create-livestock" data-itemcode="${item.itemCode}">loading…</span></td>
        <td style="padding:8px; text-align:center;">
          <input type="checkbox" class="prn-create-checked" data-idx="${idx}" style="width:20px; height:20px; cursor:pointer; accent-color:#9333ea;" />
        </td>
        <td style="padding:8px; text-align:center;">
          <input type="number" min="0" max="${bufferedReq}" value="${prefillVal}" placeholder="0" class="prn-create-storeqty ${storeqtyExtraClass}" data-idx="${idx}" data-buffered-req="${bufferedReq}" ${isIncrease ? "" : "disabled"}
            style="width:90px; text-align:center; font-weight:700; padding:5px; border:1.5px solid var(--brand); border-radius:3px; font-size:0.88rem; ${isIncrease ? "" : "opacity:0.5;"}" />
        </td>
        <td id="prn-create-purchaseqty-${idx}" style="padding:8px; text-align:center; font-weight:800; font-size:0.9rem; color:#1a2332;">${trimNum(initPurchase)}</td>
      </tr>`;
    } else {
      // Reduction or removal — editable, same cell COUNT and ORDER as the
      // branch above (this is what was actually broken before: this
      // branch rendered one fewer real cell than the header expects — a
      // static badge sat where the live-stock span belongs — which
      // shifted every subsequent cell, making Store Quantity visually
      // show the Change-in-Qty number instead of its own value).
      const bufferedReq = Number(item.bufferedRequirement) || 0;
      const totalCovered = (Number(item.newStoreTotal) || 0) + (Number(item.newPurchaseTotal) || 0);
      const storeCap = Math.min(totalCovered, bufferedReq);
      const autoStoreQty = Math.min(Number(item.newStoreTotal) || 0, storeCap);
      const initPurchaseRaw = Math.max(0, bufferedReq - autoStoreQty);
      const initPurchase = item.isCountUnit ? Math.ceil(initPurchaseRaw - 1e-9) : initPurchaseRaw;

      rowsHtml += `
      <tr style="border-bottom:1px solid #f1f5f9; background:${item.deferred ? "#fffbeb" : "#fef2f2"};">${common}
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#94a3b8; font-weight:700; background:#f8fafc;">${item.unit || "—"}</td>
        <td style="padding:8px; text-align:center; font-size:0.78rem; color:#6b7a8d; font-weight:600;"><span class="prn-create-livestock" data-itemcode="${item.itemCode}">loading…</span></td>
        <td style="padding:8px; text-align:center;">
          <input type="checkbox" class="prn-create-checked" data-idx="${idx}" style="width:20px; height:20px; cursor:pointer; accent-color:#9333ea;" />
        </td>
        <td style="padding:8px; text-align:center;">
          <input type="number" min="0" max="${storeCap}" value="${Number.isInteger(autoStoreQty) ? autoStoreQty : autoStoreQty.toFixed(2)}"
            class="prn-create-storeqty prn-create-decrease-storeqty" data-idx="${idx}" data-total-covered="${totalCovered}" data-buffered-req="${bufferedReq}" data-deferred="${item.deferred ? '1' : '0'}"
            oninput="updatePRNDecreaseRowPurchaseQty(${idx}, this)"
            style="width:90px; text-align:center; font-weight:700; padding:5px; border:1.5px solid var(--brand); border-radius:3px; font-size:0.88rem;" />
        </td>
        <td id="prn-create-purchaseqty-${idx}" style="padding:8px; text-align:center; font-weight:800; font-size:0.9rem; color:#1a2332;">${trimNum(initPurchase)}</td>
      </tr>`;
    }
  });

  createZone.innerHTML = `
    <div style="font-size:0.85rem; font-weight:700; color:var(--brand); margin-bottom:12px;">${isDelta ? "Revised" : "New"} Purchase Request Note for ${pending.boqId} ${revBadge}</div>
    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius); margin-bottom:16px;">
      <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:1050px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px; font-size:0.7rem; text-align:left;">Item Code</th>
            <th style="padding:8px; font-size:0.7rem; text-align:left; min-width:230px;">Material Name</th>
            <th style="padding:8px; font-size:0.7rem; text-align:left;">Type</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">BOQ Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#b45309;">Buffer %</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:var(--brand);">Buffered BOQ Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#94a3b8;">Unit</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#6b7a8d; min-width:100px;">Store Available Stock</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#9333ea; width:80px;">Checked *</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#0369a1; min-width:120px;">Store Quantity *</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#15803d; min-width:110px;">Purchase Qty</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:14px; display:flex; justify-content:flex-end; align-items:center; gap:14px;">
      <button class="nav-btn-styled" id="prn-create-generate-btn" onclick="submitNewPRNCreation()" style="background:var(--accent); padding:8px 24px; font-weight:700;">Save & Submit for Authorization</button>
    </div>
  `;

  // Wire up checked-checkbox → enable store qty input
  document.querySelectorAll(".prn-create-checked").forEach(cb => {
    cb.addEventListener("change", function() {
      const idx = this.dataset.idx;
      const input = document.querySelector(`.prn-create-storeqty[data-idx="${idx}"]`);
      if (input) { input.disabled = !this.checked; input.style.opacity = this.checked ? "1" : "0.5"; }
    });
  });

  document.querySelectorAll(".prn-create-storeqty").forEach(inp => {
    inp.addEventListener("input", function() {
      // Decrease/removed rows have their own cap logic
      // (updatePRNDecreaseRowPurchaseQty, wired via oninput on the
      // element itself) — this generic listener's cap is based on
      // bufferedPurchaseQty, which for these rows is the NEGATIVE
      // deltaRequirement, not a usable ceiling.
      if (this.classList.contains("prn-create-decrease-storeqty")) return;
      const idx = this.dataset.idx;
      const item = pending.lineItems[idx];
      const bufferedReq = Math.round((Number(item.bufferedRequirement) || 0) * 100) / 100;
      const liveSpan = document.querySelector(`.prn-create-livestock[data-itemcode="${item.itemCode}"]`);
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

      const cell = document.getElementById(`prn-create-purchaseqty-${idx}`);
      if (cell) cell.textContent = isCountUnit ? String(purchaseQty) : (Number.isInteger(purchaseQty) ? String(purchaseQty) : purchaseQty.toFixed(2));
    });
  });
  
  refreshPRNCreateLiveStock();
  if (window._prnCreateStockInterval) clearInterval(window._prnCreateStockInterval);
  window._prnCreateStockInterval = setInterval(refreshPRNCreateLiveStock, 8000);
}

async function submitNewPRNCreation() {
  const pending = window.prnPendingCreate;
  if (!pending) return;

  // Looked up by data-idx, NOT array position — rows that are
  // auto-computed (decrease/removed, no checkbox rendered at all) are
  // skipped when the DOM is queried, so the Nth checkbox in the DOM
  // does not correspond to the Nth row in pending.lineItems whenever any
  // non-editable rows sit before it. Indexing positionally grabbed the
  // wrong row's checkbox state for every editable row after the first
  // AUTO row — which is exactly why a visibly-checked "Container Box"
  // still failed validation.
  const submittedItems = pending.lineItems.map((item, idx) => {
    const cb = document.querySelector(`.prn-create-checked[data-idx="${idx}"]`);
    const storeQtyInput = document.querySelector(`.prn-create-storeqty[data-idx="${idx}"]`);
    const checkedVal = cb && cb.checked ? "Yes" : "No";
    const storeQty    = storeQtyInput ? (parseFloat(storeQtyInput.value) || 0) : 0;
    return {
      itemCode: item.itemCode, materialName: item.materialName, typeOfMaterial: item.typeOfMaterial,
      unit: item.unit,
      boqRequiredQty: item.boqRequiredQty, bufferPct: item.bufferPct, bufferedPurchaseQty: item.bufferedPurchaseQty,
      currentUnassignedStoreQty: storeQty, checkedByStorePerson: checkedVal,
      // Echoed so the server knows which rows carried an operator choice.
      // Decrease/removed rows are recomputed server-side regardless — the
      // values sent for them are display-only and are never trusted.
      editable: item.editable !== false, changeKind: item.changeKind
    };
  });

  // Only operator-editable rows carry a checkbox; reductions are automatic.
  const unchecked = submittedItems.find(it => it.editable && it.checkedByStorePerson !== "Yes");
  if (unchecked) return showPurchaseFeedback("prn-feedback", `⚠️ All rows must be marked "Checked = Yes". "${unchecked.materialName}" is not checked yet.`, "error");

  const bodyZone = document.getElementById("prn-body-zone");
  if (bodyZone) bodyZone.style.display = "none";
  const btn = document.getElementById("prn-create-generate-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Creating PRN...';
  showBlockingOverlay("Creating Purchase Request Note...");

  try {
    const boqMeta = (window.prnBOQMeta || {})[pending.boqId] || {};
    const data = await apFetch({
      action: "createPurchaseRequestNote",
      activeEngineer: appActiveOperatorIdentityString,
      projectId: pending.projectId, boqId: pending.boqId,
      productName: boqMeta.productName || "", productRating: boqMeta.productRating || "",
      orderQuantity: boqMeta.orderQuantity || pending.orderQty || 0,
      customerName: boqMeta.customerName || "",
      lineItems: submittedItems
    });

    if (!data.success) {
      hideBlockingOverlay();
      showPurchaseFeedback("prn-feedback", data.error || "Failed to create PRN.", "error");
      btn.disabled = false; btn.textContent = "Save & Submit for Authorization";
      return;
    }
    document.getElementById("prn-feedback").style.display = "none";
    if (data.pendingAuthorization) {
      hideBlockingOverlay();
      const createZone = document.getElementById("prn-create-zone");
      if (createZone) createZone.style.display = "none";
      const bodyZoneEl = document.getElementById("prn-body-zone");
      if (bodyZoneEl) bodyZoneEl.style.display = "none";
      const needQueueZone = document.getElementById("prn-needqueue-zone");
      if (needQueueZone) { needQueueZone.style.display = "none"; needQueueZone.innerHTML = ""; }
      showPurchaseFeedback("prn-feedback",
        `✅ PRN <strong>${data.prnId}</strong> created and sent for authorization. Store quantities are reserved.` +
        `<br><button onclick="document.getElementById('prn-feedback').style.display='none'; window.prnPendingCreate=null; initializePRNPanel();" style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">+ Create Another PRN</button>`,
        "success", true);
      return;
    }

    if (window._prnCreateStockInterval) clearInterval(window._prnCreateStockInterval);
    window.prnPendingCreate = null;

    // Refresh the newly created PRN data WHILE the overlay is still up —
    // hide table + create-zone now so nothing stale is visible once overlay drops
    const bodyZone    = document.getElementById("prn-body-zone");
    const successZone = document.getElementById("prn-success-zone");
    document.getElementById("prn-create-zone").style.display = "none";
    if (bodyZone) bodyZone.style.display = "none";

    const refetchData = await apFetch({ action: "fetchPRNsForProject", projectId: pending.projectId });
    const newPRN = (refetchData.prns || []).find(p => p.boqId === pending.boqId && p.status !== "Closed");

    hideBlockingOverlay(); // only now — table is already hidden, success zone renders next

    const pdfNote = data.pdfWarning
      ? `<div style="font-size:0.78rem; color:#b45309; margin-top:6px;">⚠️ PDF could not be generated — PRN is saved. Contact admin to verify Drive folder setup.</div>`
      : (data.pdfUrl ? `<div style="font-size:0.78rem; margin-top:6px;">📄 <a href="${driveLink(data.pdfUrl)}" target="_blank" style="color:var(--accent); font-weight:700;">View PRN PDF</a></div>` : "");

    if (successZone) {
      successZone.style.display = "block";
      successZone.innerHTML = `
        <div style="background:#f0fff4; border-left:4px solid var(--accent); border-radius:var(--radius); padding:14px 16px; margin-bottom:16px;">
          <div style="font-size:0.85rem; font-weight:800; color:#276749; margin-bottom:8px;">✅ PRN Created Successfully for ${boqMeta.customerName || "this customer"}!</div>
          <div style="font-size:0.82rem; color:#276749; font-family:monospace; font-weight:700;">${data.prnId}</div>
          ${pdfNote}
          <button onclick="resetPRNPanelForNewEntry();" 
            style="margin-top:12px; background:var(--brand); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">
            + Create New PRN for this BOQ
          </button>
        </div>`;
    }

    // Hide the stale "Needing a PRN" queue now that this BOQ is fulfilled —
    // it will re-fetch fresh (correctly excluding this BOQ) next time the
    // panel initializes, via resetPRNPanelForNewEntry → initializePRNPanel.
    const needQueueZone = document.getElementById("prn-needqueue-zone");
    if (needQueueZone) { needQueueZone.style.display = "none"; needQueueZone.innerHTML = ""; }

  } catch(e) {
    hideBlockingOverlay();
    if (bodyZone) bodyZone.style.display = "grid";
    showPurchaseFeedback("prn-feedback", "Network error: " + e.message, "error");
    btn.disabled = false; btn.textContent = "Save & Submit for Authorization";
  }
}

function renderPRNDetails(data) {
  // Legacy stub — multi-card view now handled by renderAllPRNCards
  if (data) renderAllPRNCards([data], data.boqId);
}

function resetPRNPanelForNewEntry() {
  const successZone = document.getElementById("prn-success-zone");
  const bodyZone     = document.getElementById("prn-body-zone");
  if (successZone) { successZone.style.display = "none"; successZone.innerHTML = ""; }
  if (bodyZone) bodyZone.style.display = "grid";
  initializePRNPanel();
}

function renderAllPRNCards(prns, boqId) {
  const feed = document.getElementById("prn-cards-feed");
  const actionBar = document.getElementById("prn-bottom-action-bar");
  const badge = document.getElementById("prn-boq-updated-badge");
  if (!feed) return;
  feed.innerHTML = "";

  prns.forEach((data, idx) => {
    const cardId = "prn-card-" + idx;
    const expandId = "prn-expand-" + idx;
    const toggleId = "prn-toggle-text-" + idx;
    const isPending = data.status === "Pending Authorization";
    const pdfHtml = isPending
      ? `<span style="color:#b45309; font-size:0.8rem; font-weight:700;">Pending — no PDF yet</span>`
      : (data.pdfUrl
          ? `<a href="${driveLink(data.pdfUrl)}" target="_blank" style="color:var(--brand); font-weight:700; font-size:0.82rem;" onclick="event.stopPropagation();">View PDF ↗</a>`
          : `<span style="color:var(--muted); font-size:0.8rem;">Not generated</span>`);

    // Trims trailing zeros the same way the PDF's formatRateSmart does —
    // 270 stays "270", 280.8 stays "280.8", nothing shows as "270.00".
    const fmtSmart = (n) => {
      const num = Number(n) || 0;
      return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
    };
    let rowsHtml = "";
    (data.lineItems || []).forEach(li => {
      rowsHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:8px; font-family:monospace; font-size:0.78rem; font-weight:700; color:var(--brand);">${li.itemCode}</td>
        <td style="padding:8px; font-size:0.82rem; font-weight:600;">${li.materialName}</td>
        <td style="padding:8px; font-size:0.75rem; color:var(--muted);">${li.typeOfMaterial || "—"}</td>
        <td style="padding:8px; text-align:center; font-weight:700; font-family:monospace;">${fmtSmart(li.boqRequiredQty)}</td>
        <td style="padding:8px; text-align:center; font-weight:700; color:#b45309;">${fmtSmart(li.bufferPct)}%</td>
        <td style="padding:8px; text-align:center; font-weight:800; color:var(--brand); font-family:monospace;">${fmtSmart(li.bufferedPurchaseQty)}</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-size:0.92rem; font-weight:700;">${li.currentUnassignedStoreQty !== "" ? fmtSmart(li.currentUnassignedStoreQty) : "0"}</td>
        <td style="padding:8px; text-align:center; font-weight:800; font-family:monospace; font-size:0.95rem; color:#15803d;">${li.purchaseQty !== "" ? fmtSmart(li.purchaseQty) : "—"}</td>
      </tr>`;
    });

    const card = document.createElement("div");
    card.innerHTML = `
      <div id="${cardId}" onclick="togglePRNCardExpanded('${expandId}','${toggleId}')" style="cursor:pointer; background:${isPending ? "#fffbeb" : "var(--highlight-bg)"}; border:1.5px solid ${isPending ? "#f59e0b" : "var(--brand)"}; border-radius:var(--radius); padding:12px;">
        ${isPending ? `<div style="font-size:0.72rem; font-weight:800; color:#b45309; margin-bottom:8px;">⏳ This PRN is waiting for authorization.</div>` : ""}
        <div style="display:flex; gap:24px; flex-wrap:wrap; align-items:flex-start; margin-bottom:4px;">
          <div><div style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px;">Customer Name</div>
            <div style="font-weight:700; color:var(--text); font-size:0.85rem;">${data.customerName || "—"}</div></div>
          <div><div style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px;">Product Name</div>
            <div style="font-weight:700; color:var(--text); font-size:0.85rem;">${data.productName || "—"}</div></div>
          <div><div style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px;">Product Rating</div>
            <div style="font-weight:700; color:var(--text); font-size:0.85rem;">${data.productRating || "—"}</div></div>
          <div><div style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px;">Order Quantity</div>
            <div style="font-weight:700; color:var(--text); font-size:0.85rem;">${Math.round(Number(data.orderQuantity) || 0) + " Sets"}</div></div>
          <div><div style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px;">Created By</div>
            <div style="font-weight:700; color:var(--text); font-size:0.85rem;">${data.storePerson || "—"}</div></div>
          <div><div style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px;">PRN PDF</div>
            <div style="font-size:0.82rem;" onclick="event.stopPropagation();">${pdfHtml}</div></div>
        </div>
        <div style="font-size:0.72rem; color:var(--brand); font-weight:700;">▾ Click to <span id="${toggleId}">expand and view materials</span></div>
        <div id="${expandId}" style="display:none; margin-top:12px;">
          <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
            <table style="width:100%; border-collapse:collapse; min-width:1000px;">
              <thead><tr style="background:#f8fafc;">
                <th style="padding:8px; font-size:0.7rem; text-align:left;">Item Code</th>
                <th style="padding:8px; font-size:0.7rem; text-align:left; min-width:240px;">Material Name</th>
                <th style="padding:8px; font-size:0.7rem; text-align:left; min-width:60px;">Type</th>
                <th style="padding:8px; font-size:0.7rem; text-align:center;">BOQ Qty</th>
                <th style="padding:8px; font-size:0.7rem; text-align:center; color:#b45309;">Buffer %</th>
                <th style="padding:8px; font-size:0.7rem; text-align:center; color:var(--brand);">Buffered BOQ Qty</th>
                <th style="padding:8px; font-size:0.7rem; text-align:center; color:#0369a1;">Store Quantity</th>
                <th style="padding:8px; font-size:0.7rem; text-align:center; color:#15803d;">Purchase Qty</th>
              </tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    feed.appendChild(card);
  });

  // Bottom action bar — only show if latest PRN's BOQ was updated after it
  const latest = prns[prns.length - 1];
  const boqUpdatedAfterLatestPRN = latest.boqUpdatedSincePRN && latest.boqStatus !== "Pending Authorization Update";
  const boqPendingAuth = latest.boqUpdatedSincePRN && latest.boqStatus === "Pending Authorization Update";

  if (actionBar) {
    if (boqUpdatedAfterLatestPRN || boqPendingAuth) {
      actionBar.style.display = "flex";
      if (badge) {
        if (boqPendingAuth) {
          badge.style.display = "inline-block";
          badge.textContent = "BOQ update pending authorization — create new PRN after it is authorized";
          badge.style.background = "#fef9c3"; badge.style.borderColor = "#ca8a04"; badge.style.color = "#713f12";
        } else {
          badge.style.display = "none";
        }
      }
      // Create PRN is view-only once a PRN already exists — a revised
      // BOQ's delta now belongs entirely to Revise PRN's own tab, so no
      // button here at all, just the explanation pointing there.
      const createBtn = document.getElementById("prn-create-new-btn");
      if (createBtn) createBtn.style.display = "none";
      if (badge) {
        if (boqUpdatedAfterLatestPRN) {
          badge.style.display = "inline-block";
          badge.textContent = "The BOQ linked to this PRN was revised, which may have increased or decreased quantities for some materials. Revise the PRN to match.";
          badge.style.background = "#fef3c7"; badge.style.borderColor = "#f59e0b"; badge.style.color = "#78350f";
        } else if (boqPendingAuth) {
          badge.style.display = "inline-block";
          badge.textContent = "BOQ update pending authorization — this PRN can be revised after it is authorized.";
          badge.style.background = "#fef9c3"; badge.style.borderColor = "#ca8a04"; badge.style.color = "#713f12";
        } else {
          badge.style.display = "none";
        }
      }
    } else {
      actionBar.style.display = "none";
      if (badge) badge.style.display = "none";
    }
  }
}

// Spare-first allocation of a typed claim against the combined pool —
// mirrors exactly how the backend actually reserves it (splitStoreClaim),
// so "Store Available Stock" updating live as you type shows the truth.
function computeLiveStoreSplit(baseRaw, baseSpare, claimQty) {
  const qty = Math.max(0, Number(claimQty) || 0);
  const spareUsed = Math.min(qty, baseSpare);
  const rawUsed = Math.max(0, qty - baseSpare);
  return {
    remainingRaw: Math.max(0, baseRaw - rawUsed),
    remainingSpare: Math.max(0, baseSpare - spareUsed),
  };
}

// Revise PRN's directional formula — genuinely different from claiming
// fresh stock. Increasing beyond the CURRENT reservation draws the
// EXTRA amount spare-first (matching claim priority everywhere else in
// the system). Decreasing BELOW the current reservation releases the
// difference raw-first — explicit decision, opposite of claim priority.
function computeRevisePRNStoreDisplay(baseRaw, baseSpare, reservedRawAtCurrent, reservedSpareAtCurrent, typed) {
  const currentTotal = reservedRawAtCurrent + reservedSpareAtCurrent;
  const target = Math.max(0, Number(typed) || 0);
  let newReservedRaw, newReservedSpare;

  if (target >= currentTotal) {
    const extra = target - currentTotal;
    const remainingSpareCapacity = baseSpare - reservedSpareAtCurrent; // == live free spare
    const extraSpare = Math.min(extra, remainingSpareCapacity);
    const extraRaw = extra - extraSpare;
    newReservedSpare = reservedSpareAtCurrent + extraSpare;
    newReservedRaw = reservedRawAtCurrent + extraRaw;
  } else {
    const release = currentTotal - target;
    const releaseRaw = Math.min(release, reservedRawAtCurrent);
    const releaseSpare = release - releaseRaw;
    newReservedRaw = reservedRawAtCurrent - releaseRaw;
    newReservedSpare = reservedSpareAtCurrent - releaseSpare;
  }

  return {
    remainingRaw: Math.max(0, baseRaw - newReservedRaw),
    remainingSpare: Math.max(0, baseSpare - newReservedSpare),
  };
}

function updatePRNCheckedByStorePerson(selectEl, idx) {
  if (!prnCurrentData || !prnCurrentData.lineItems[idx]) return;
  prnCurrentData.lineItems[idx].checkedByStorePerson = selectEl.value;
  selectEl.style.color = selectEl.value === "Yes" ? "#15803d" : "#b91c1c";
}

async function generatePRNPDF() {
  if (!prnCurrentData) return;
  const btn = document.getElementById("prn-generate-pdf-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Generating PDF...';

  // Capture any unsaved store qty + checked-by inputs first
  document.querySelectorAll(".prn-store-qty-input").forEach(inp => {
    const idx = parseInt(inp.dataset.idx, 10);
    if (prnCurrentData.lineItems[idx]) prnCurrentData.lineItems[idx].currentUnassignedStoreQty = parseFloat(inp.value) || 0;
  });
  document.querySelectorAll(".prn-checked-select").forEach(sel => {
    const idx = parseInt(sel.dataset.idx, 10);
    if (prnCurrentData.lineItems[idx]) prnCurrentData.lineItems[idx].checkedByStorePerson = sel.value;
  });

  const uncheckedRow = prnCurrentData.lineItems.find(it => (it.checkedByStorePerson || "No") !== "Yes");
  if (uncheckedRow) {
    showPurchaseFeedback("prn-feedback", `⚠️ All rows must be marked "Checked = Yes" before submitting. "${uncheckedRow.materialName}" is not checked yet.`, "error");
    btn.disabled = false; btn.textContent = "Generate & Save PRN PDF";
    return;
  }

  try {
    const data = await apFetch({
      action: "generateAndSavePRNPdf",
      activeEngineer: appActiveOperatorIdentityString,
      prnId: prnCurrentData.prnId,
      lineItems: prnCurrentData.lineItems
    });
    if (data.success) {
      prnStoreQtyLocked = true;
      prnCurrentData.storeQtyLocked = true;
      renderPRNDetails(prnCurrentData);
      showPurchaseFeedback("prn-feedback", `Store quantities saved. This PRN's PDF will be generated once it is authorized.`, "success");
    } else {
      showPurchaseFeedback("prn-feedback", data.error || "PDF generation failed.", "error");
    }
  } catch(e) {
    showPurchaseFeedback("prn-feedback", "Network error: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Generate & Save PDF";
  }
}

// ═══════════════════════════════════════════════════════
// MATERIAL LIST FOR PURCHASE
// ═══════════════════════════════════════════════════════

let materialListCache = [];
let materialListSelectedProjectId = null; // null = ALL Active Projects

