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
        <td style="padding:8px;">${m.materialName}</td>
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
        : `<div style="font-weight:800; font-family:monospace; font-size:0.85rem; color:${receivedOnPO >= orderedOnPO ? "#15803d" : "#b45309"};">${fmt(receivedOnPO)} / ${fmt(orderedOnPO)}</div>
           <div style="height:4px; background:#e2e8f0; border-radius:2px; margin-top:4px; overflow:hidden;"><div style="height:100%; width:${pct}%; background:${receivedOnPO >= orderedOnPO ? "#15803d" : "#f59e0b"};"></div></div>`;

      const poCell = pos.length === 0
        ? (Number(m.stillToOrder) > 0
            ? `<span style="font-size:0.72rem; font-weight:700; color:#b91c1c; background:#fee2e2; padding:2px 8px; border-radius:4px;">Not yet ordered</span>`
            : `<span style="color:var(--muted); font-size:0.75rem;">—</span>`)
        : pos.map(po => `<div style="font-family:monospace; font-size:0.72rem; font-weight:700;">${po.pdfUrl ? `<a href="${driveLink(po.pdfUrl)}" target="_blank" style="color:var(--brand); text-decoration:underline;">${esc(po.poNo)}</a>` : `<span style="color:var(--brand);">${esc(po.poNo)}</span>`} <span style="color:var(--muted); font-weight:600;">(${fmt(po.orderedQty)})</span></div>`).join("");

      // Expected Delivery is now an editable, per-tranche delivery
      // schedule (migration 112) — a single PO allocation can be split
      // into several planned quantity+date tranches that the user fills
      // in themselves and Saves, rather than one system-guessed date. See
      // ppsRenderScheduleEditor / savePPSDeliverySchedule below.
      const dateCell = pos.length === 0
        ? `<span style="color:var(--muted); font-size:0.75rem;">—</span>`
        : pos.map(po => {
            const key = ppsScheduleKey(prnId, m.itemCode, po.poNo);
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

      return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px; font-family:monospace; font-size:0.78rem; font-weight:700; color:var(--brand);">${esc(m.itemCode)}${flag}</td>
          <td style="padding:8px; font-size:0.82rem; font-weight:600;">${esc(m.materialName)}</td>
          <td style="padding:8px; text-align:center; font-family:monospace;">${fmt(m.boqRequiredQty)}</td>
          <td style="padding:8px; text-align:center; color:#b45309; font-weight:700;">${fmt(m.bufferPct)}%</td>
          <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:var(--brand);">${fmt(m.bufferedPurchaseQty)}</td>
          <td style="padding:8px; text-align:center; font-family:monospace;">${fmt(m.storeQty)}</td>
          <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700;">${fmt(m.purchaseQty)}</td>
          <td style="padding:8px; text-align:center;">${poCell}</td>
          <td style="padding:8px; text-align:center;">${dateCell}</td>
          <td style="padding:8px; text-align:center; min-width:110px;">${statusCell}</td>
        </tr>`;
    }).join("");

    body.innerHTML = `
      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
        <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:1150px;">
          <thead><tr style="background:#f8fafc;">
            <th style="padding:8px; font-size:0.7rem; text-align:left;">Item Code</th>
            <th style="padding:8px; font-size:0.7rem; text-align:left; min-width:200px;">Material Name</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">BOQ Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:#b45309;">Buffer %</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; color:var(--brand);">Buffered Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">Store Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center;">Purchase Qty</th>
            <th style="padding:8px; font-size:0.7rem; text-align:center; min-width:120px;">Purchase Order(s)</th>
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

function ppsScheduleKey(prnId, itemCode, poNo) {
  return `${prnId}|${itemCode}|${poNo}`.replace(/[^a-zA-Z0-9|_-]/g, "_");
}

function ppsRenderScheduleEditor(key) {
  const tranches = window.ppsScheduleState[key] || [];
  const fmt = (n) => (parseFloat(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const rows = tranches.map((t, i) => {
    const slipped = t.originalPlannedDate && t.plannedDate && t.originalPlannedDate !== t.plannedDate;
    const isReceived = t.status === 'Received';
    return `
      <div style="display:flex; align-items:center; gap:4px; margin-bottom:3px;">
        <input type="number" min="0" step="any" value="${t.plannedQty ?? ''}" ${isReceived ? "disabled" : ""}
          oninput="ppsUpdateTrancheField('${key}', ${i}, 'plannedQty', this.value)"
          style="width:60px; padding:3px 4px; font-size:0.72rem; border:1px solid var(--border); border-radius:3px;" placeholder="Qty" />
        <input type="date" value="${t.plannedDate || ''}" ${isReceived ? "disabled" : ""}
          onchange="ppsUpdateTrancheField('${key}', ${i}, 'plannedDate', this.value)"
          style="padding:3px 4px; font-size:0.7rem; border:1px solid var(--border); border-radius:3px;" />
        ${!isReceived ? `<button type="button" onclick="ppsRemoveTranche('${key}', ${i})" title="Remove tranche" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:3px; font-size:0.65rem; font-weight:700; padding:1px 5px; cursor:pointer;">✕</button>` : ""}
        ${t.fulfilledQty > 0 ? `<span style="font-size:0.62rem; color:#15803d; font-weight:700;">${fmt(t.fulfilledQty)} recv'd</span>` : ""}
        ${slipped ? `<span style="font-size:0.6rem; color:#b45309;" title="Originally planned ${t.originalPlannedDate}">slipped from ${t.originalPlannedDate}</span>` : ""}
      </div>`;
  }).join("");
  const empty = tranches.length === 0
    ? `<div style="font-size:0.68rem; color:var(--muted); font-style:italic; margin-bottom:3px;">Not yet scheduled</div>` : "";
  return `${empty}${rows}<button type="button" onclick="ppsAddTranche('${key}')" style="background:none; border:1px dashed var(--brand); color:var(--brand); border-radius:3px; font-size:0.65rem; font-weight:700; padding:2px 6px; cursor:pointer; margin-top:2px;">+ Add Tranche</button>`;
}

function ppsRerenderSchedule(key) {
  const el = document.getElementById(`ppssched-${key}`);
  if (el) el.innerHTML = ppsRenderScheduleEditor(key);
}

function ppsAddTranche(key) {
  window.ppsScheduleState[key] = window.ppsScheduleState[key] || [];
  window.ppsScheduleState[key].push({ scheduleId: null, plannedQty: '', plannedDate: '', originalPlannedDate: null, fulfilledQty: 0, status: 'Planned' });
  ppsRerenderSchedule(key);
}

function ppsRemoveTranche(key, idx) {
  const list = window.ppsScheduleState[key];
  if (!list) return;
  list.splice(idx, 1);
  ppsRerenderSchedule(key);
}

function ppsUpdateTrancheField(key, idx, field, value) {
  const list = window.ppsScheduleState[key];
  if (!list || !list[idx]) return;
  list[idx][field] = field === 'plannedQty' ? (parseFloat(value) || '') : value;
}

// Saves every schedule currently in window.ppsScheduleState for this PRN
// in one batch — matches savePODeliverySchedule's "send the FULL desired
// tranche list per row" contract (not a delta).
async function savePPSDeliverySchedule(prnId, btn) {
  const updates = [];
  const keys = Object.keys(window.ppsScheduleState).filter(key => key.startsWith(prnId + "|"));
  for (const key of keys) {
    const [, itemCode, poNo] = key.split("|");
    const tranches = window.ppsScheduleState[key];
    if (tranches.some(t => !(Number(t.plannedQty) > 0) || !t.plannedDate)) {
      showBOQBanner("pps-feedback", `⚠️ ${itemCode}: every tranche needs a quantity and a date before saving.`, "error");
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
      showBOQBanner("pps-feedback", "✅ Delivery schedule saved.", "success");
      loadPPSForPRN();
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

// ── Editable Authorize PO state (standalone, apo* prefix) ──
window.apoEditRows = [];
window.apoEditRowSeq = 0;
window.apoEditProjects = [];
window.apoEditPO = null;

function isoFromPODate(raw) {
  // Convert "15-Feb-2026" or a Date string to yyyy-mm-dd for <input type=date>
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

