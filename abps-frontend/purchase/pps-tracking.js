// DEAD CODE: renderPstatPurchase / renderPstatOnePps rendered the old
// Project Status Purchase zone (per-PRN table with pipe-separated PO text
// crammed into one cell), fed the sequential await-in-loop that fired one
// fetchPPSForPRN call per PRN. Project Status now builds per-BOQ swimlanes
// from fetchProjectPPSBatch instead (see project/project-status.js). Kept
// here rather than deleted per CLAUDE.md rule 6 — nothing calls these two
// functions anymore.
async function renderPstatPurchase(data) {
  const zone = document.getElementById("pstat-purchase-zone");
  if (!data.success) { zone.innerHTML = `<div style="color:var(--warn); padding:12px;">${data.error}</div>`; return; }
  if (!data.prns || data.prns.length === 0) { zone.innerHTML = `<div style="padding:14px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:4px;">No PRNs found for this project.</div>`; return; }
  zone.innerHTML = data.prns.map(p => `<div id="pstat-pps-${p.prnId.replace(/[^a-zA-Z0-9]/g,'_')}" style="margin-bottom:18px;"><div style="padding:14px; color:var(--muted);">Loading PPS...</div></div>`).join("");

  for (const prn of data.prns) {
    const safeId = `pstat-pps-${prn.prnId.replace(/[^a-zA-Z0-9]/g,'_')}`;
    try {
      const ppsData = await apFetch({ action: "fetchPPSForPRN", prnId: prn.prnId });
      renderPstatOnePps(safeId, prn, ppsData);
    } catch (e) {
      const el = document.getElementById(safeId);
      if (el) el.innerHTML = `<div style="color:var(--warn); padding:12px;">Error loading PPS for ${prn.prnId}.</div>`;
    }
  }
}

function renderPstatOnePps(elId, prn, ppsData) {
  const el = document.getElementById(elId);
  if (!el) return;
  const materials = (ppsData.success && ppsData.materials) ? ppsData.materials : [];
  const header = `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
      ${prn.pdfUrl ? `<a href="${driveLink(prn.pdfUrl)}" target="_blank" style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.9rem;">${prn.prnId}</a>` : `<span style="font-family:monospace; font-weight:800; font-size:0.9rem;">${prn.prnId}</span>`}
      <span style="font-size:0.68rem; font-weight:700; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:3px;">${prn.status || "—"}</span>
    </div>`;
  if (materials.length === 0) {
    el.innerHTML = header + `<div style="padding:10px; color:var(--muted); font-size:0.82rem;">No PPS lines for this PRN.</div>`;
    return;
  }
  const rows = materials.map(m => {
    const pos = m.purchaseOrders || [];
    const poLines = pos.length === 0 ? `<div style="color:var(--muted); font-size:0.78rem;">No PO allocations yet.</div>` : pos.map(po => `
      <div style="font-size:0.78rem; padding:2px 0; border-top:1px dashed #f1f5f9;">
        <strong>${po.poNo}</strong> | Vendor: ${po.vendorName || "—"} | Ordered: ${fmtQty(po.orderedQty)} | Received: ${fmtQty(po.receivedQty)}
        | Expected: ${formatDateDMY(po.expectedDelivery) || "—"} | ${po.actualDelivery ? `Delivered: ${formatDateDMY(po.actualDelivery)}` : "Not delivered"}
        | Link Status: ${po.linkStatus || "—"}
        ${po.actionPlan ? `<div style="color:#0369a1; margin-top:2px;">Action Plan: ${po.actionPlan}</div>` : ""}
      </div>`).join("");
    return `
      <tr style="border-bottom:1px solid var(--border); vertical-align:top;">
        <td style="padding:8px; font-family:monospace;">${m.itemCode}</td>
        <td style="padding:8px; font-size:0.92rem; font-weight:600;">${m.materialName}</td>
        <td style="padding:8px; text-align:center;">${fmtQty(m.boqRequiredQty)}</td>
        <td style="padding:8px; text-align:center;">${fmtQty(m.bufferedPurchaseQty)}</td>
        <td style="padding:8px; text-align:center;">${fmtQty(m.stillToOrder)}</td>
        <td style="padding:8px; text-align:center;">${fmtQty(m.receivedQty)}</td>
        <td style="padding:8px;">${poLines}</td>
      </tr>`;
  }).join("");
  el.innerHTML = header + `
    <table style="width:100%; border-collapse:collapse; font-size:0.82rem; background:#fff; border:1px solid var(--border); border-radius:4px;">
      <thead><tr style="background:var(--highlight-bg); text-align:left;">
        <th style="padding:8px;">Item Code</th><th style="padding:8px;">Material</th>
        <th style="padding:8px; text-align:center;">BOQ Req</th><th style="padding:8px; text-align:center;">Buffered Purchase</th>
        <th style="padding:8px; text-align:center;">Still To Order</th><th style="padding:8px; text-align:center;">Received</th>
        <th style="padding:8px;">PO Allocations</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function initializePPSTrackingPanel() {
  const prnSel = document.getElementById("pps-prn-select");
  if (prnSel) prnSel.innerHTML = `<option value="">— Select a project first —</option>`;
  const header = document.getElementById("pps-prn-header");
  if (header) header.style.display = "none";
  // Previously left the typed Project ID and any prior search results
  // sitting in the DOM on re-entry (only the PRN dropdown/header were
  // reset) — leaving and coming back looked "stuck" on the last search
  // instead of starting fresh, same class of bug as Revise Bill of
  // Quantity's stale Project ID fix.
  const body = document.getElementById("pps-results-body");
  if (body) body.innerHTML = "";
  const fb = document.getElementById("pps-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  window.ppsPrnListCache = {};
  const sel = document.getElementById("pps-project-select-ta-input");
  sel.value = "";
  sel.placeholder = "Loading projects...";
  // Un-hide from a prior Save's "collapse to just the success banner"
  // state (see savePPSDeliverySchedule) — re-entering this panel (either
  // via its own menu card or the "+ Action Another PPS" reset) must
  // always land back on the queues + selector, never a stale hidden state.
  const selectorRow = document.getElementById("pps-selector-row");
  if (selectorRow) selectorRow.style.display = "grid";
  const queueZone = document.getElementById("pps-needqueue-zone");
  if (queueZone) queueZone.style.display = "block";
  try {
    const data = await apFetch({ action: "pullLiveActiveProjectCodes", statusFilter: "Active" });
    // The typeahead input filters/renders from these two globals itself
    // (handleSharedProjectTypeaheadInput) — no <select> to populate here.
    window.sharedActiveProjectCodes = data.success ? (data.projects || []) : [];
    window.sharedProjectMeta = data.success ? (data.projectMeta || {}) : {};
    sel.placeholder = window.sharedActiveProjectCodes.length === 0
      ? "No active projects" : "Type Project ID or Customer Name...";
  } catch(e) {
    sel.placeholder = "Failed to load projects";
  }

  loadPPSNeedQueues();
}

// loadPPSNeedQueues — PPS Tracking's own work queue, same shape as Create
// PRN's loadPRNNeedQueue: two stacked lists (Unscheduled, then Partially
// Scheduled) built from fetchPRNsNeedingDeliverySchedule, which already
// classifies server-side using the exact same rule the Purchase
// Dashboard's stat tiles count by (lib/ppsScheduleStatus.js) — this
// function does no classification of its own, only rendering.
async function loadPPSNeedQueues() {
  const zone = document.getElementById("pps-needqueue-zone");
  if (!zone) return;
  zone.style.display = "block";
  zone.innerHTML = `<div style="text-align:center; padding:12px; color:var(--muted); font-size:0.8rem;">
    <div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>
    Checking which PRNs need a delivery schedule...
  </div>`;
  try {
    const data = await apFetch({ action: "fetchPRNsNeedingDeliverySchedule" });
    if (!data.success) { zone.innerHTML = ""; return; }
    zone.innerHTML =
      ppsRenderNeedQueueList("Unscheduled PRNs — Need a Delivery Schedule", data.unscheduled || [], "✅ No PRNs are unscheduled.") +
      ppsRenderNeedQueueList("Partially Scheduled PRNs — Need a Delivery Schedule", data.partial || [], "✅ No PRNs are partially scheduled.");
  } catch(e) {
    zone.innerHTML = "";
  }
}

function ppsRenderNeedQueueList(title, items, emptyMessage) {
  if (items.length === 0) {
    return `<div style="padding:10px 14px; margin-bottom:10px; background:#f0fff4; border:1px solid #86efac; border-radius:var(--radius); color:#15803d; font-size:0.8rem; font-weight:600;">${emptyMessage}</div>`;
  }
  const rows = items.map(item => {
    const hint = (item.totalItems > 0)
      ? `<div style="font-size:0.85rem; font-weight:600; color:var(--muted); margin-top:2px;">${item.scheduledItems} of ${item.totalItems} items scheduled</div>`
      : "";
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid #f1f5f9;">
        <div style="min-width:0;">
          <span style="font-family:monospace; font-weight:700; font-size:0.8rem; color:var(--brand);">${item.prnId}</span>
          <div style="font-size:0.76rem; color:var(--muted); margin-top:2px;">${item.customerName || item.projectId} <strong> | </strong>  ${item.productName || ""}${item.productRating ? " " + item.productRating : ""}</div>
          ${hint}
        </div>
        <button class="nav-btn-styled" style="background:var(--brand); padding:6px 14px; font-size:0.76rem; font-weight:700; flex-shrink:0;"
          onclick="jumpToPPSFromQueue('${item.projectId.replace(/'/g, "\\'")}', '${item.prnId.replace(/'/g, "\\'")}', this)">
          Action →
        </button>
      </div>`;
  }).join("");

  return `
    <div style="background:#fffbeb; border:1.5px solid #f59e0b; border-radius:var(--radius); overflow:hidden; margin-bottom:12px;">
      <div style="padding:10px 14px; font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#b45309; letter-spacing:0.5px; background:#fef3c7;">
        ${title} (${items.length})
      </div>
      ${rows}
    </div>`;
}

async function jumpToPPSFromQueue(projectId, prnId, btn) {
  const projDrop = document.getElementById("pps-project-select-ta-input");
  const prnSel = document.getElementById("pps-prn-select");
  if (!projDrop) return;

  const originalHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="display:inline-block;width:10px;height:10px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Loading...';
  }

  try {
    projDrop.value = projectId;
    await loadPPSPRNList();
    if (prnSel) {
      prnSel.value = prnId;
      await loadPPSForPRN();
    }
    const selectorRow = document.getElementById("pps-selector-row");
    if (selectorRow) selectorRow.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
  }
}

async function loadPPSPRNList() {
  const projectId = document.getElementById("pps-project-select-ta-input").value;
  const prnSel = document.getElementById("pps-prn-select");
  const body = document.getElementById("pps-results-body");
  const header = document.getElementById("pps-prn-header");
  body.innerHTML = "";
  if (header) header.style.display = "none";
  if (!projectId) { prnSel.innerHTML = `<option value="">— Select a project first —</option>`; return; }

  prnSel.innerHTML = `<option value="">Loading…</option>`;
  try {
    const data = await apFetch({ action: "fetchPRNsByProjectAndStatus", projectId });
    const prns = (data.success ? (data.prns || []) : []);
    window.ppsPrnListCache = {};
    prns.forEach(p => { window.ppsPrnListCache[p.prnId] = p; });
    if (prns.length === 0) {
      prnSel.innerHTML = `<option value="">No PRNs for this project</option>`;
      return;
    }
    prnSel.innerHTML = `<option value="">— Select PRN —</option>` +
      prns.map(p => `<option value="${p.prnId.replace(/"/g,'&quot;')}">${p.productName || ""}${p.productRating ? " " + p.productRating : ""} | ${p.department || "—"}${p.version > 1 ? ` (v${p.version})` : ""}</option>`).join("");
  } catch (e) {
    prnSel.innerHTML = `<option value="">Failed to load PRNs</option>`;
  }
}

async function loadPPSForPRN() {
  const prnId = document.getElementById("pps-prn-select").value;
  const body = document.getElementById("pps-results-body");
  const header = document.getElementById("pps-prn-header");
  document.getElementById("pps-feedback").style.display = "none";
  // Fresh load — drop any in-progress (unsaved) schedule edits from
  // whichever PRN was showing before, same as every other reset-on-
  // navigate pattern in this app.
  window.ppsScheduleState = {};
  if (!prnId) { body.innerHTML = ""; if (header) header.style.display = "none"; return; }

  if (header) {
    const prn = (window.ppsPrnListCache || {})[prnId];
    header.style.display = "block";
    const prnIdHtml = (prn && prn.pdfUrl)
      ? `<a href="${driveLink(prn.pdfUrl)}" target="_blank" style="font-family:monospace; font-weight:800; color:var(--brand); text-decoration:underline;">${prnId}</a>`
      : `<span style="font-family:monospace; font-weight:800; color:var(--brand);">${prnId}</span>`;
    header.innerHTML = prnIdHtml +
      (prn && prn.status ? ` <span style="font-size:0.68rem; font-weight:700; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:3px;">${prn.status}</span>` : "");
  }

  body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">Loading PPS tracking...</div>`;
  try {
    const data = await apFetch({ action: "fetchPPSForPRN", prnId });
    if (!data.success) { body.innerHTML = `<p style="color:var(--warn);">${data.error}</p>`; return; }
    const materials = data.materials || [];
    if (materials.length === 0) {
      body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">This PRN has no material lines.</div>`;
      return;
    }

    const fmt = (n) => (parseFloat(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});
    const esc = (s) => (s==null?"":s.toString().replace(/</g,"&lt;").replace(/>/g,"&gt;"));

    const rowsHtml = materials.map(m => {
      const pos = m.purchaseOrders || [];
      const purchaseNeeded = Number(m.purchaseQty) || 0;
      // "Received / PO Qty" means received against what's actually been
      // PLACED on a purchase order — summed from the PO allocations
      // themselves, not the line's full purchase requirement
      // (m.purchaseQty). Using purchaseQty as the denominator understated
      // this as "under-received" for any line that's fully received
      // against the POs placed so far but still has more still_to_order
      // left to be put on a future PO — that was the actual bug.
      const orderedOnPO = pos.reduce((s, po) => s + (Number(po.orderedQty) || 0), 0);
      const receivedOnPO = pos.reduce((s, po) => s + (Number(po.receivedQty) || 0), 0);
      const pct = orderedOnPO > 0 ? Math.min(100, (receivedOnPO / orderedOnPO) * 100) : 0;
      // Status reads received/ordered — a purchase quantity of 0 means the
      // line is fully covered from store and has nothing to wait for.
      const statusCell = purchaseNeeded <= 0
        ? `<span style="font-size:0.72rem; font-weight:700; color:#15803d; background:#dcfce7; padding:2px 8px; border-radius:4px;">From store</span>`
        : orderedOnPO <= 0
        ? `<span style="font-size:0.72rem; font-weight:700; color:#b91c1c; background:#fee2e2; padding:2px 8px; border-radius:4px;">Not yet ordered</span>`
        : `<div style="font-weight:800; font-family:monospace; font-size:0.98rem; color:${receivedOnPO >= orderedOnPO ? "#15803d" : "#b45309"};">${fmt(receivedOnPO)} / ${fmt(orderedOnPO)}</div>
           <div style="height:4px; background:#e2e8f0; border-radius:2px; margin-top:4px; overflow:hidden;"><div style="height:100%; width:${pct}%; background:${receivedOnPO >= orderedOnPO ? "#15803d" : "#f59e0b"};"></div></div>`;

      const poCell = pos.length === 0
        ? (Number(m.stillToOrder) > 0
            ? `<span style="font-size:0.72rem; font-weight:700; color:#b91c1c; background:#fee2e2; padding:2px 8px; border-radius:4px;">Not yet ordered</span>`
            : `<span style="color:var(--muted); font-size:0.75rem;">—</span>`)
        : pos.map(po => `<div style="font-family:monospace; font-size:0.72rem; font-weight:700;">${po.pdfUrl ? `<a href="${driveLink(po.pdfUrl)}" target="_blank" style="color:var(--brand); text-decoration:underline;">${esc(po.poNo)}</a>` : `<span style="color:var(--brand);">${esc(po.poNo)}</span>`} <span style="color:var(--muted); font-weight:700; font-size:0.98rem;">(${fmt(po.orderedQty)})</span></div>`).join("");

      // Expected Delivery is now an editable, per-tranche delivery
      // schedule (migration 112) — a single PO allocation can be split
      // into several planned quantity+date tranches that the user fills
      // in themselves and Saves, rather than one system-guessed date. See
      // ppsRenderScheduleEditor / savePPSDeliverySchedule below.
      const dateCell = pos.length === 0
        ? `<span style="color:var(--muted); font-size:0.75rem;">—</span>`
        : pos.map(po => {
            const key = ppsScheduleKey(prnId, m.itemCode, po.poNo);
            // Refreshed every render (unlike ppsScheduleState, which is
            // seeded once so in-progress edits survive a re-render) — the
            // deliveries planned against this PO line can never add up to
            // more than what was actually ordered on it.
            window.ppsScheduleMeta[key] = Number(po.orderedQty) || 0;
            if (!window.ppsScheduleState[key]) {
              window.ppsScheduleState[key] = (po.schedule || []).map(s => ({
                scheduleId: s.scheduleId, plannedQty: s.plannedQty, plannedDate: isoFromPODate(s.plannedDate),
                originalPlannedDate: isoFromPODate(s.originalPlannedDate), fulfilledQty: s.fulfilledQty, status: s.status
              }));
            }
            return `<div id="ppssched-${key}">${ppsRenderScheduleEditor(key)}</div>`;
          }).join("");

      const flag = m.awaitingPoRevision
        ? `<div style="font-size:0.6rem; font-weight:800; color:#b45309; margin-top:3px;">⏳ AWAITING PO REVISION</div>` : "";

      // Production's own requirement-date splits for this line — read-only
      // here (Production sets these on Assign/Revise Material Requirement
      // Date), shown so Purchase can see what drove the PO delivery
      // schedule below. '[]' (no rows) means a legacy/backfilled line.
      const reqDates = m.requirementDates || [];
      const reqDateCell = reqDates.length === 0
        ? `<span style="color:var(--muted); font-size:0.75rem;">—</span>`
        : reqDates.map(r => `<div style="font-size:0.92rem; font-weight:700;">${fmt(r.qty)} on ${formatDateDMY(r.date)}</div>`).join("");

      return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px; font-size:0.92rem; font-weight:600;">${esc(m.materialName)}${flag}</td>
          <td style="padding:8px; text-align:center; font-family:monospace; font-size:0.98rem;">${fmt(m.boqRequiredQty)}</td>
          <td style="padding:8px; text-align:center; color:#b45309; font-weight:700;">${fmt(m.bufferPct)}%</td>
          <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:var(--brand); font-size:0.98rem;">${fmt(m.bufferedPurchaseQty)}</td>
          <td style="padding:8px; text-align:center; font-family:monospace; font-size:0.98rem;">${fmt(m.storeQty)}</td>
          <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; font-size:0.98rem;">${fmt(m.purchaseQty)}</td>
          <td style="padding:8px; text-align:center;">${poCell}</td>
          <td style="padding:8px; text-align:center;">${reqDateCell}</td>
          <td style="padding:8px; text-align:center;">${dateCell}</td>
          <td style="padding:8px; text-align:center; min-width:110px;">${statusCell}</td>
        </tr>`;
    }).join("");

    body.innerHTML = `
      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
        <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:1200px;">
          <thead><tr style="background:#f8fafc;">
            <th style="padding:8px; font-size:0.7rem; text-align:left; min-width:200px;">Material Name</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">BOQ Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#b45309;">Buffer %</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:var(--brand);">Buffered Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">Store Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">Purchase Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; min-width:120px;">Purchase Order(s)</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; min-width:130px;">Production Requirement Date</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; min-width:120px;">Expected Delivery</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">Received / PO Qty</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <button class="nav-btn-styled" id="pps-save-schedule-btn" onclick="savePPSDeliverySchedule('${prnId}', this)" style="background:var(--accent); padding:8px 20px; font-weight:700;">Save Delivery Schedule</button>
      </div>`;
  } catch (e) {
    body.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`;
  }
}

// ═══════════════════════════════════════════════════════
// DELIVERY SCHEDULE EDITOR (migration 112) — replaces the single
// system-guessed "Expected Delivery" date with a per-PO-allocation set of
// planned quantity+date tranches that Purchase fills in themselves.
// Starts blank (no tranches) until a human plans it — that's deliberate,
// see routes/purchase.js:savePODeliverySchedule's own comment.
// State lives in window.ppsScheduleState, keyed by
// "<prnId>|<itemCode>|<poNo>" -> array of {scheduleId, plannedQty,
// plannedDate, originalPlannedDate, fulfilledQty, status}, seeded once
// per key from the server response the first time that cell renders
// (see loadPPSForPRN above) so repeated re-renders while editing don't
// stomp on unsaved changes.
// ═══════════════════════════════════════════════════════
window.ppsScheduleState = window.ppsScheduleState || {};
// orderedQty per key ("<prnId>|<itemCode>|<poNo>") — the cap every
// delivery's quantity is checked against, see ppsClampDeliveryQty.
window.ppsScheduleMeta = window.ppsScheduleMeta || {};

function ppsScheduleKey(prnId, itemCode, poNo) {
  return `${prnId}|${itemCode}|${poNo}`.replace(/[^a-zA-Z0-9|_-]/g, "_");
}

function ppsRenderScheduleEditor(key) {
  const deliveries = window.ppsScheduleState[key] || [];
  const orderedQty = Number(window.ppsScheduleMeta[key]) || 0;
  const fmt = (n) => (parseFloat(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const rows = deliveries.map((t, i) => {
    const slipped = t.originalPlannedDate && t.plannedDate && t.originalPlannedDate !== t.plannedDate;
    const isReceived = t.status === 'Received';
    const note = t.fulfilledQty > 0 || slipped
      ? `<div style="font-size:0.62rem; margin:2px 0 0 2px;">
           ${t.fulfilledQty > 0 ? `<span style="color:#15803d; font-weight:700;">${fmt(t.fulfilledQty)} received</span>` : ""}
           ${slipped ? `<span style="color:#b45309; margin-left:6px;" title="Originally planned ${t.originalPlannedDate}">slipped from ${t.originalPlannedDate}</span>` : ""}
         </div>` : "";
    return `
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:5px; padding:5px 6px; margin-bottom:5px;">
        <div style="display:flex; align-items:center; gap:5px;">
          <input type="number" min="0" step="any" max="${orderedQty}" value="${t.plannedQty ?? ''}" ${isReceived ? "disabled" : ""}
            oninput="ppsClampDeliveryQty('${key}', ${i}, this)"
            style="width:64px; padding:4px 5px; font-size:0.95rem; font-weight:700; border:1px solid var(--border); border-radius:3px; text-align:center; background:#fff; box-sizing:border-box;" placeholder="Qty" />
          <input type="date" value="${t.plannedDate || ''}" ${isReceived ? "disabled" : ""}
            onchange="ppsUpdateDeliveryField('${key}', ${i}, 'plannedDate', this.value)"
            style="flex:1; min-width:0; padding:4px 5px; font-size:0.7rem; border:1px solid var(--border); border-radius:3px; background:#fff; box-sizing:border-box;" />
          ${!isReceived ? `<button type="button" onclick="ppsRemoveDelivery('${key}', ${i})" title="Remove this delivery" style="flex-shrink:0; background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:3px; font-size:0.7rem; font-weight:700; padding:3px 7px; cursor:pointer; line-height:1;">✕</button>` : ""}
        </div>
        ${note}
      </div>`;
  }).join("");
  const empty = deliveries.length === 0
    ? `<div style="font-size:0.68rem; color:var(--muted); font-style:italic; margin-bottom:4px;">Not yet scheduled</div>` : "";
  const usedQty = deliveries.reduce((s, t) => s + (Number(t.plannedQty) || 0), 0);
  const remaining = Math.max(0, orderedQty - usedQty);
  const addLabel = deliveries.length > 0 && remaining > 0 ? `+ Add Delivery (${fmt(remaining)} left)` : "+ Add Delivery";
  return `<div style="min-width:200px;">${empty}${rows}<button type="button" onclick="ppsAddDelivery('${key}')" style="display:block; width:100%; background:none; border:1.5px dashed var(--brand); color:var(--brand); border-radius:4px; font-size:0.68rem; font-weight:700; padding:5px 6px; cursor:pointer; box-sizing:border-box;">${addLabel}</button></div>`;
}

function ppsRerenderSchedule(key) {
  const el = document.getElementById(`ppssched-${key}`);
  if (el) el.innerHTML = ppsRenderScheduleEditor(key);
}

function ppsAddDelivery(key) {
  window.ppsScheduleState[key] = window.ppsScheduleState[key] || [];
  const list = window.ppsScheduleState[key];
  const orderedQty = Number(window.ppsScheduleMeta[key]) || 0;
  const used = list.reduce((s, t) => s + (Number(t.plannedQty) || 0), 0);
  const remaining = Math.max(0, orderedQty - used);
  list.push({ scheduleId: null, plannedQty: remaining > 0 ? remaining : '', plannedDate: '', originalPlannedDate: null, fulfilledQty: 0, status: 'Planned' });
  ppsRerenderSchedule(key);
}

function ppsRemoveDelivery(key, idx) {
  const list = window.ppsScheduleState[key];
  if (!list) return;
  list.splice(idx, 1);
  ppsRerenderSchedule(key);
}

function ppsUpdateDeliveryField(key, idx, field, value) {
  const list = window.ppsScheduleState[key];
  if (!list || !list[idx]) return;
  list[idx][field] = value;
}

// Clamps a delivery's quantity so every delivery for this PO line
// together never exceeds what was actually ordered on it — typing over
// the remaining amount silently caps back down to it, and each
// subsequently-added delivery starts prefilled with whatever's left.
function ppsClampDeliveryQty(key, idx, inputEl) {
  const list = window.ppsScheduleState[key];
  if (!list || !list[idx]) return;
  let v = parseFloat(inputEl.value) || 0;
  if (v < 0) v = 0;
  const orderedQty = Number(window.ppsScheduleMeta[key]) || 0;
  const othersTotal = list.reduce((sum, t, i) => i === idx ? sum : sum + (Number(t.plannedQty) || 0), 0);
  const cap = Math.max(0, orderedQty - othersTotal);
  if (v > cap) v = cap;
  inputEl.value = v || '';
  list[idx].plannedQty = v || '';
}

// Saves every schedule currently in window.ppsScheduleState for this PRN
// in one batch — matches savePODeliverySchedule's "send the FULL desired
// tranche list per row" contract (not a delta).
async function savePPSDeliverySchedule(prnId, btn) {
  const updates = [];
  // ppsScheduleKey sanitizes the WHOLE combined key (spaces/slashes/colons
  // in a real PRN ID all become "_"), so the prefix check here has to
  // sanitize prnId the exact same way before comparing — matching against
  // the raw prnId never found anything, since every real PRN ID contains
  // exactly those characters, which is why this silently always reported
  // "No delivery schedule changes to save" regardless of what was edited.
  const safePrnId = prnId.replace(/[^a-zA-Z0-9|_-]/g, "_");
  const keys = Object.keys(window.ppsScheduleState).filter(key => key.startsWith(safePrnId + "|"));
  for (const key of keys) {
    const [, itemCode, poNo] = key.split("|");
    const tranches = window.ppsScheduleState[key];
    if (tranches.some(t => !(Number(t.plannedQty) > 0) || !t.plannedDate)) {
      showBOQBanner("pps-feedback", `⚠️ ${itemCode}: every delivery needs a quantity and a date before saving.`, "error");
      return;
    }
    updates.push({
      prnId, itemCode, poNo,
      tranches: tranches.map(t => ({ scheduleId: t.scheduleId, plannedQty: t.plannedQty, plannedDate: t.plannedDate }))
    });
  }
  if (updates.length === 0) { showBOQBanner("pps-feedback", "No delivery schedule changes to save.", "error"); return; }

  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving...";
  try {
    const data = await apFetch({ action: "savePODeliverySchedule", updates, operatorName: appActiveOperatorIdentityString });
    if (data.success) {
      // Persistent success banner + "+ View Another PPS" reset, matching
      // Create BOQ's convention — was a plain auto-hiding banner behind an
      // await'd reload (which existed only to satisfy this same banner's
      // ordering against loadPPSForPRN's own hide-on-load reset). The
      // reload is now redundant AND harmful: it would repaint the table
      // under a banner whose own button resets the whole panel anyway.
      window.ppsScheduleState = {};
      window.ppsScheduleMeta = {};
      document.getElementById("pps-results-body").innerHTML = "";
      const header = document.getElementById("pps-prn-header");
      if (header) header.style.display = "none";
      // Collapse to just the header + success banner, same as Create
      // PRN/Assign Material Requirement Date's own success state —
      // initializePPSTrackingPanel() (called by the reset button) un-hides
      // both zones again and rebuilds the queues, so the just-saved PRN
      // naturally moves between/out of the Unscheduled/Partial lists with
      // no special-case logic here.
      const selectorRow = document.getElementById("pps-selector-row");
      if (selectorRow) selectorRow.style.display = "none";
      const queueZone = document.getElementById("pps-needqueue-zone");
      if (queueZone) queueZone.style.display = "none";
      // PRN IDs bake the full product description into the id string
      // itself (e.g. "PRN_26-27_AUG_<customer>_<code> / <product
      // description>"), which reads as an unbroken run-on sentence when
      // dropped inline into prose — same reasoning pps-prn-header already
      // renders it as its own separate, monospace, word-wrapped block
      // rather than plain text; this success message follows that
      // convention instead of "for PRN <id>." in one line.
      showSuccessWithReset(
        "pps-feedback",
        `✅ Delivery schedule saved.<div style="margin-top:8px; padding:8px 10px; background:#fff; border:1px solid #86efac; border-radius:6px; font-family:monospace; font-weight:800; font-size:0.8rem; color:var(--brand); line-height:1.4; word-break:break-word;">${prnId}</div>`,
        "Action Another PPS", "initializePPSTrackingPanel()"
      );
    } else {
      showBOQBanner("pps-feedback", data.error || "Failed to save delivery schedule.", "error");
    }
  } catch (e) {
    showBOQBanner("pps-feedback", "Network error: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = originalText;
  }
}

// ── Global date/time formatting — DD-MM-YYYY dates, 12-hour times ─────
// Never show raw ISO strings (2026-08-15T00:00:00.000Z) or timezone
// offsets to users. Pure calendar dates (Postgres DATE columns, which
// arrive as "YYYY-MM-DDT00:00:00.000Z") are parsed from the date part
// directly rather than through a Date object, to avoid a local-timezone
// shift silently rolling the date back/forward a day. Real timestamps
// (created_at, ts, etc.) DO go through Date object conversion, since
// localizing time-of-day is the correct behavior there.

function formatTime12h(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function formatDateTimeDMY(value) {
  if (!value) return "";
  return `${formatDateDMY(value)}, ${formatTime12h(value)}`;
}

function fmtPODate(raw) {
  if (!raw) return "";
  return formatDateDMY(raw);
}

function isoFromPODate(raw) {
  // Convert "15-Feb-2026" or a Date string to yyyy-mm-dd for <input type=date>
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

