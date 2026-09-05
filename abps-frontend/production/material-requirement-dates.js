// ═══════════════════════════════════════════════════════════════════════
// production/material-requirement-dates.js — Assign/Revise Material
// Requirement Date (30 Aug 2026). New Production step between PRN
// authorization and PO creation: for every material with a Purchase Qty,
// Production enters date/quantity splits that must total that line's
// full Purchase Qty before the material becomes visible to Purchase at
// all (hard gate — see routes/purchase.js's fetchMaterialListForPurchase).
//
// Assign and Revise's two tabs share one line-editor
// (mrdRenderLinesTable / mrdRenderScheduleEditor / mrdAddTranche /
// mrdRemoveTranche / mrdUpdateTranche / mrdClampTranche), namespaced by
// `ns` ('mrd' for Assign, 'rmrd' for Revise) so their state never
// collides — same idea as PPS Tracking's tranche editor, just with an
// EXACT-sum requirement at submit instead of a cap-only one.
// ═══════════════════════════════════════════════════════════════════════

window.mrdState = window.mrdState || {
  mrd:  { lines: {}, meta: {}, prnId: null, itemCodeByKey: {} },
  rmrd: { lines: {}, meta: {}, prnId: null, itemCodeByKey: {} },
};

// Sanitizes an item code into a safe object-key / DOM-id fragment. The
// REAL item code always travels separately in itemCodeByKey — never
// recovered by reversing this sanitization, which is the exact bug PPS
// Tracking's savePPSDeliverySchedule had before it was fixed (a real
// item code containing "/" or a space silently arrived at the server as
// "_").
function mrdSanitizeKey(itemCode) {
  return (itemCode || "").toString().replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ── Assign Material Requirement Date ──────────────────────────────────

async function initializeAssignMaterialRequirementDatePanel() {
  const fb = document.getElementById("mrd-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  genericDropdownReset("mrd-prn-select", "— Select a project first —");
  genericDropdownSetDisabled("mrd-prn-select", true);
  const header = document.getElementById("mrd-prn-header");
  if (header) header.style.display = "none";
  const body = document.getElementById("mrd-body");
  if (body) body.innerHTML = "";
  const sel = document.getElementById("mrd-project-select-ta-input");
  if (sel) sel.value = "";
  const dd = document.getElementById("mrd-project-select-ta-dropdown");
  if (dd) dd.style.display = "none";
  const selRow = document.getElementById("mrd-selector-row");
  if (selRow) selRow.style.display = "grid";
  window.mrdState.mrd = { lines: {}, meta: {}, prnId: null, itemCodeByKey: {} };
  window.mrdPrnListCache = {};
  try {
    const data = await apFetch({ action: "pullLiveActiveProjectCodes", statusFilter: "Active" });
    window.sharedActiveProjectCodes = data.success ? (data.projects || []) : [];
    window.sharedProjectMeta = data.success ? (data.projectMeta || {}) : {};
  } catch (e) { window.sharedActiveProjectCodes = []; }
  await loadMRDNeedQueue();
}

async function loadMRDNeedQueue() {
  const zone = document.getElementById("mrd-needqueue-zone");
  if (!zone) return;
  zone.style.display = "block";
  zone.innerHTML = `<div style="text-align:center; padding:12px; color:var(--muted); font-size:0.8rem;">
    <div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>
    Checking which PRNs need requirement dates...
  </div>`;
  try {
    const data = await apFetch({ action: "fetchPRNsNeedingRequirementDates", badgeFilter: "New" });
    if (!data.success) { zone.innerHTML = ""; return; }
    const queue = data.queue || [];
    if (queue.length === 0) {
      zone.innerHTML = `<div style="padding:10px 14px; background:#f0fff4; border:1px solid #86efac; border-radius:var(--radius); color:#15803d; font-size:0.8rem; font-weight:600;">✅ No PRNs need requirement dates.</div>`;
      return;
    }
    const rows = queue.map(item => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid #f1f5f9;">
        <div style="min-width:0;">
          <span style="font-family:monospace; font-weight:700; font-size:0.8rem; color:var(--brand);">${item.prnId}</span>
          <div style="font-size:0.76rem; color:var(--muted); margin-top:2px;">${item.customerName || item.projectId} <strong> | </strong> ${item.productName || ""} ${item.productRating || ""}</div>
        </div>
        <button class="nav-btn-styled" style="background:var(--brand); padding:6px 14px; font-size:0.76rem; font-weight:700; flex-shrink:0;"
          onclick="jumpToMRDFromQueue('${item.projectId.replace(/'/g, "\\'")}', '${item.prnId.replace(/'/g, "\\'")}', this)">
          Assign Dates →
        </button>
      </div>`).join("");
    zone.innerHTML = `
      <div style="background:#fffbeb; border:1.5px solid #f59e0b; border-radius:var(--radius); overflow:hidden;">
        <div style="padding:10px 14px; font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#b45309; letter-spacing:0.5px; background:#fef3c7;">
          PRNs Needing Requirement Dates (${queue.length})
        </div>
        ${rows}
      </div>`;
  } catch (e) { zone.innerHTML = ""; }
}

async function jumpToMRDFromQueue(projectId, prnId, btn) {
  const originalHtml = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = "Loading..."; }
  try {
    document.getElementById("mrd-project-select-ta-input").value = projectId;
    await loadMRDPRNList();
    const cached = (window.mrdPrnListCache || {})[prnId];
    const label = cached ? `${cached.productName || ""}${cached.productRating ? " " + cached.productRating : ""} | ${cached.department || "—"}${cached.version > 1 ? ` (v${cached.version})` : ""}` : prnId;
    genericDropdownSelect("mrd-prn-select", prnId, label, null);
    await loadMRDForPRN();
    const bodyZone = document.getElementById("mrd-body");
    if (bodyZone) bodyZone.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
  }
}

async function loadMRDPRNList() {
  const projectId = document.getElementById("mrd-project-select-ta-input").value;
  document.getElementById("mrd-body").innerHTML = "";
  const header = document.getElementById("mrd-prn-header");
  if (header) header.style.display = "none";
  if (!projectId) { genericDropdownReset("mrd-prn-select", "— Select a project first —"); genericDropdownSetDisabled("mrd-prn-select", true); return; }
  genericDropdownReset("mrd-prn-select", "Loading…");
  genericDropdownSetDisabled("mrd-prn-select", true);
  try {
    const data = await apFetch({ action: "fetchPRNsByProjectAndStatus", projectId, scopeToProductionDept: true });
    const prns = (data.success ? (data.prns || []) : []);
    window.mrdPrnListCache = Object.fromEntries(prns.map(p => [p.prnId, p]));
    if (prns.length === 0) {
      genericDropdownReset("mrd-prn-select", "No PRNs for this project");
      return;
    }
    genericDropdownSetDisabled("mrd-prn-select", false);
    genericDropdownReset("mrd-prn-select", "— Select PRN —");
    genericDropdownPopulate("mrd-prn-select", prns.map(p => ({
      value: p.prnId,
      label: `${p.productName || ""}${p.productRating ? " " + p.productRating : ""} | ${p.department || "—"}${p.version > 1 ? ` (v${p.version})` : ""}`
    })), loadMRDForPRN);
  } catch (e) { genericDropdownReset("mrd-prn-select", "Failed to load PRNs"); }
}

async function loadMRDForPRN() {
  const prnId = document.getElementById("mrd-prn-select").value;
  const body = document.getElementById("mrd-body");
  const header = document.getElementById("mrd-prn-header");
  document.getElementById("mrd-feedback").style.display = "none";
  window.mrdState.mrd = { lines: {}, meta: {}, prnId, itemCodeByKey: {} };
  if (!prnId) { body.innerHTML = ""; if (header) header.style.display = "none"; return; }

  if (header) {
    const prn = (window.mrdPrnListCache || {})[prnId];
    header.style.display = "block";
    header.innerHTML = `<span style="font-family:monospace; font-weight:800; color:var(--brand);">${prnId}</span>` +
      (prn && prn.status ? ` <span style="font-size:0.68rem; font-weight:700; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:3px;">${prn.status}</span>` : "");
  }

  body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">Loading materials…</div>`;
  try {
    const data = await apFetch({ action: "fetchMaterialRequirementDatesForPRN", prnId });
    if (!data.success) { body.innerHTML = `<div style="color:#b91c1c; padding:14px; background:#fef2f2; border-radius:6px;">${data.error}</div>`; return; }
    const lines = data.lines || [];
    if (lines.length === 0) { body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">This PRN has no material lines.</div>`; return; }
    body.innerHTML = mrdRenderLinesTable('mrd', prnId, lines, data.alreadySubmitted, 'submitMaterialRequirementDates');
  } catch (e) { body.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`; }
}

async function submitMaterialRequirementDates(ns, prnId, btn) {
  const result = mrdValidateAndCollect(ns);
  if (result.error) { showPurchaseFeedback("mrd-feedback", `⚠️ ${result.error}`, "error"); return; }
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = "Submitting…";
  try {
    const data = await apFetch({ action: "saveMaterialRequirementDates", prnId, updates: result.updates, operatorName: appActiveOperatorIdentityString });
    if (data.success) {
      document.getElementById("mrd-body").innerHTML = "";
      const header = document.getElementById("mrd-prn-header");
      if (header) header.style.display = "none";
      const zone = document.getElementById("mrd-needqueue-zone");
      if (zone) zone.style.display = "none";
      const selRow = document.getElementById("mrd-selector-row");
      if (selRow) selRow.style.display = "none";
      showSuccessWithReset("mrd-feedback", `✅ Production requirement dates submitted for PRN ${prnId}.`, "Assign Another PRN", "initializeAssignMaterialRequirementDatePanel()");
    } else {
      btn.disabled = false; btn.textContent = originalText;
      showPurchaseFeedback("mrd-feedback", data.error || "Failed to save.", "error");
    }
  } catch (e) {
    btn.disabled = false; btn.textContent = originalText;
    showPurchaseFeedback("mrd-feedback", "Network error: " + e.message, "error");
  }
}

// ── Shared line-editor table (Assign + both Revise tabs) ──────────────

function mrdRenderLinesTable(ns, prnId, lines, readOnly, submitFnName) {
  const st = window.mrdState[ns];
  st.prnId = prnId;
  st.itemCodeByKey = st.itemCodeByKey || {};
  const fmt = (n) => (parseFloat(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});
  const esc = (s) => (s==null?"":s.toString().replace(/</g,"&lt;").replace(/>/g,"&gt;"));

  const rows = lines.map(line => {
    const key = mrdSanitizeKey(line.itemCode);
    const purchaseQty = Number(line.purchaseQty) || 0;
    st.meta[key] = purchaseQty;
    st.itemCodeByKey[key] = line.itemCode;
    if (!st.lines[key]) {
      st.lines[key] = (line.tranches || []).map(t => ({
        requirementId: t.requirementId, requiredQty: t.requiredQty, requiredDate: isoFromPODate(t.requiredDate),
      }));
    }
    const editorCell = purchaseQty <= 0
      ? `<span style="font-size:0.95rem; color:#15803d; font-weight:700;">Fully covered from store — no date needed</span>`
      : readOnly
        ? mrdReadOnlyTranches(st.lines[key])
        : `<div id="mrdsched-${ns}-${key}">${mrdRenderScheduleEditor(ns, key)}</div>`;

    return `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:8px; font-family:monospace; font-size:0.78rem; font-weight:700; color:var(--brand);">${esc(line.itemCode)}</td>
        <td style="padding:8px; font-size:0.9rem; font-weight:600;">${esc(line.materialName)}</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-size:1.05rem;">${fmt(line.storeQty)}</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; font-size:1.05rem;">${fmt(line.purchaseQty)}</td>
        <td style="padding:8px; font-size:0.95rem;">${editorCell}</td>
      </tr>`;
  }).join("");

  const submitBtn = readOnly ? "" : `
    <div style="display:flex; justify-content:flex-end; margin-top:12px;">
      <button class="nav-btn-styled" id="${ns}-submit-btn" onclick="${submitFnName}('${ns}', '${prnId.replace(/'/g,"\\'")}', this)" style="background:var(--accent); padding:8px 20px; font-weight:700;">${ns === 'mrd' ? 'Submit Requirement Dates' : 'Save Revised Dates'}</button>
    </div>`;

  const readOnlyNote = readOnly ? `<div style="padding:10px 14px; margin-bottom:12px; background:#f1f5f9; border-radius:var(--radius); color:#475569; font-size:0.82rem; font-weight:600;">These requirement dates are already submitted — view only. Use Revise Material Requirement Date to change them.</div>` : "";

  return `
    ${readOnlyNote}
    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
      <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:900px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:8px; font-size:0.92rem; text-align:left;">Item Code</th>
          <th style="padding:8px; font-size:0.92rem; text-align:left; min-width:200px;">Material Name</th>
          <th style="padding:8px; font-size:0.92rem; text-align:center;">Store Qty</th>
          <th style="padding:8px; font-size:0.92rem; text-align:center;">Purchase Qty</th>
          <th style="padding:8px; font-size:0.92rem; text-align:left; min-width:260px;">Production Requirement Date</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${submitBtn}`;
}

function mrdReadOnlyTranches(list) {
  if (!list || list.length === 0) return `<span style="color:var(--muted); font-size:0.9rem;">—</span>`;
  return list.map(t => `<div style="font-size:0.9rem;">${(parseFloat(t.requiredQty)||0).toLocaleString("en-IN")} on ${formatOrdinalDate(t.requiredDate)}</div>`).join("");
}

function mrdRerenderSchedule(ns, key) {
  const el = document.getElementById(`mrdsched-${ns}-${key}`);
  if (el) el.innerHTML = mrdRenderScheduleEditor(ns, key);
}

function mrdRenderScheduleEditor(ns, key) {
  const st = window.mrdState[ns];
  const list = st.lines[key] || [];
  const purchaseQty = Number(st.meta[key]) || 0;
  const total = list.reduce((s, t) => s + (Number(t.requiredQty) || 0), 0);
  const remaining = Math.max(0, purchaseQty - total);
  const fmt = (n) => (Number(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});

  const rowsHtml = list.map((t, i) => `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
      <input type="number" min="0" step="any" value="${t.requiredQty}" placeholder="Qty"
        oninput="mrdClampTranche('${ns}','${key}', ${i}, this)"
        style="width:90px; padding:6px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem;">
      <input type="date" value="${t.requiredDate || ''}" onchange="mrdUpdateTranche('${ns}','${key}', ${i}, 'requiredDate', this.value)"
        style="padding:6px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem;">
      <button type="button" onclick="mrdRemoveTranche('${ns}','${key}', ${i})" style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; cursor:pointer; width:26px; height:26px; border-radius:4px; font-size:0.85rem;">✕</button>
    </div>`).join("");

  const exact = Math.abs(total - purchaseQty) < 1e-9;
  const sumColor = exact ? "#15803d" : "#b91c1c";
  const sumLine = `<div style="font-size:0.74rem; font-weight:700; color:${sumColor}; margin-bottom:6px;">${fmt(total)} / ${fmt(purchaseQty)} scheduled${exact ? " ✓" : ""}</div>`;

  const addLabel = remaining > 0 ? `+ Add Delivery (${fmt(remaining)} left)` : "+ Add Delivery";
  return `${sumLine}${rowsHtml}
    <button type="button" onclick="mrdAddTranche('${ns}','${key}')" style="margin-top:4px; padding:5px 12px; font-size:0.76rem; font-weight:700; border:1.5px dashed var(--border); border-radius:4px; background:#fff; color:var(--brand); cursor:pointer;">${addLabel}</button>`;
}

function mrdAddTranche(ns, key) {
  const st = window.mrdState[ns];
  const list = st.lines[key] || (st.lines[key] = []);
  const purchaseQty = Number(st.meta[key]) || 0;
  const total = list.reduce((s, t) => s + (Number(t.requiredQty) || 0), 0);
  const remaining = Math.max(0, purchaseQty - total);
  list.push({ requirementId: null, requiredQty: remaining > 0 ? remaining : '', requiredDate: '' });
  mrdRerenderSchedule(ns, key);
}

function mrdRemoveTranche(ns, key, idx) {
  const st = window.mrdState[ns];
  (st.lines[key] || []).splice(idx, 1);
  mrdRerenderSchedule(ns, key);
}

function mrdUpdateTranche(ns, key, idx, field, value) {
  const st = window.mrdState[ns];
  const t = (st.lines[key] || [])[idx];
  if (t) t[field] = value;
}

// Clamp is a soft guard only (can't exceed the line's remaining Purchase
// Qty across all tranches) — the hard EXACT-sum requirement is enforced
// at submit (mrdValidateAndCollect). Deliberately does NOT re-render the
// editor on every keystroke (same as PPS's ppsClampDeliveryQty) — that
// would steal focus out of the input mid-type.
function mrdClampTranche(ns, key, idx, inputEl) {
  const st = window.mrdState[ns];
  const list = st.lines[key] || [];
  let v = parseFloat(inputEl.value);
  if (isNaN(v)) v = 0;
  if (v < 0) v = 0;
  const purchaseQty = Number(st.meta[key]) || 0;
  const othersTotal = list.reduce((s, t, i) => i === idx ? s : s + (Number(t.requiredQty) || 0), 0);
  const cap = Math.max(0, purchaseQty - othersTotal);
  if (v > cap) v = cap;
  inputEl.value = v || '';
  list[idx].requiredQty = v || '';
}

// Validates every line for a namespace and returns either { updates } or
// { error }. Lines with Purchase Qty <= 0 are skipped entirely (fully
// store-covered — nothing to submit). itemCode always comes from
// itemCodeByKey, never reconstructed from the sanitized key.
function mrdValidateAndCollect(ns) {
  const st = window.mrdState[ns];
  const updates = [];
  for (const key of Object.keys(st.meta)) {
    const purchaseQty = Number(st.meta[key]) || 0;
    const itemCode = st.itemCodeByKey[key] || key;
    if (purchaseQty <= 0) continue;
    const tranches = st.lines[key] || [];
    if (tranches.length === 0 || tranches.some(t => !(Number(t.requiredQty) > 0) || !t.requiredDate)) {
      return { error: `${itemCode}: every requirement date needs a quantity and a date.` };
    }
    const sum = tranches.reduce((s, t) => s + (Number(t.requiredQty) || 0), 0);
    if (Math.abs(sum - purchaseQty) > 1e-9) {
      return { error: `${itemCode}: requirement dates must total exactly ${purchaseQty} (currently ${sum}).` };
    }
    updates.push({ itemCode, tranches: tranches.map(t => ({ requirementId: t.requirementId, requiredQty: t.requiredQty, requiredDate: t.requiredDate })) });
  }
  if (updates.length === 0) return { error: "No materials on this PRN need a requirement date." };
  return { updates };
}

// ── Revise Material Requirement Date ──────────────────────────────────

function switchReviseMRDTab(tab) {
  const isQueue = tab === "queue";
  document.getElementById("rmrd-queue-section").style.display = isQueue ? "block" : "none";
  document.getElementById("rmrd-other-section").style.display = isQueue ? "none" : "block";
  const on = (b) => { b.style.color = "var(--brand)"; b.style.borderBottomColor = "var(--brand)"; b.style.fontWeight = "800"; };
  const off = (b) => { b.style.color = "var(--muted)"; b.style.borderBottomColor = "transparent"; b.style.fontWeight = "700"; };
  const q = document.getElementById("rmrd-tab-queue"), o = document.getElementById("rmrd-tab-other");
  isQueue ? (on(q), off(o)) : (on(o), off(q));
  if (isQueue) loadRMRDQueueTab();
  else initializeReviseMRDOtherTab();
}

async function initializeReviseMRDPanel() {
  const fb = document.getElementById("rmrd-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  const tabsBar = document.getElementById("rmrd-tabs-bar");
  if (tabsBar) tabsBar.style.display = "flex";
  switchReviseMRDTab('queue');
}

async function loadRMRDQueueTab() {
  const feed = document.getElementById("rmrd-queue-feed");
  const deltaZone = document.getElementById("rmrd-delta-zone");
  if (deltaZone) deltaZone.innerHTML = "";
  const fb = document.getElementById("rmrd-delta-feedback");
  if (fb) { fb.style.display = "none"; fb.innerHTML = ""; }
  window.mrdState.rmrd = { lines: {}, meta: {}, prnId: null, itemCodeByKey: {} };
  window.rmrdQueueMeta = {};
  feed.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted);">Loading…</div>`;
  try {
    const data = await apFetch({ action: "fetchPRNsNeedingRequirementDates", badgeFilter: "Revised" });
    const queue = (data.success ? (data.queue || []) : []);
    if (queue.length === 0) {
      feed.innerHTML = `<div style="padding:16px; background:#f0fff4; border:1px solid #86efac; border-radius:var(--radius); color:#15803d; font-size:0.85rem; font-weight:600; text-align:center;">✅ No requirement dates are waiting on a revision.</div>`;
      return;
    }
    queue.forEach(item => { window.rmrdQueueMeta[item.prnId] = item; });
    feed.innerHTML = queue.map(item => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; background:#fffbeb; border:1.5px solid #f59e0b; border-radius:var(--radius);">
        <div style="min-width:0; padding:6px 0;">
          <span style="font-size:0.68rem; font-weight:800; background:#fef3c7; color:#b45309; padding:2px 7px; border-radius:4px; margin-right:8px;">Revised</span>
          <span style="font-family:monospace; font-weight:700; font-size:0.8rem; color:var(--brand);">${item.prnId}</span>
          <div style="font-size:0.76rem; color:var(--muted); margin-top:2px;">${item.customerName || item.projectId} — ${item.productName || ""} ${item.productRating || ""}</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
          <span style="font-size:0.72rem; color:#78350f; max-width:300px; line-height:1.35;">A PRN revision changed a Purchase Qty — revise the requirement dates to match.</span>
          <button class="nav-btn-styled" style="background:var(--brand); padding:6px 14px; font-size:0.76rem; font-weight:700; flex-shrink:0;"
            onclick="jumpToRMRDDelta('${item.prnId.replace(/'/g, "\\'")}', this)">
            Revise Dates →
          </button>
        </div>
      </div>`).join("");
  } catch (e) {
    feed.innerHTML = `<div style="color:var(--warn); padding:12px;">Network error: ${e.message}</div>`;
  }
}

async function jumpToRMRDDelta(prnId, btn) {
  const deltaZone = document.getElementById("rmrd-delta-zone");
  const originalHtml = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = "Loading..."; }
  deltaZone.style.display = "block";
  deltaZone.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">Loading materials...</div>`;
  try {
    const data = await apFetch({ action: "fetchMaterialRequirementDatesForPRN", prnId });
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    if (!data.success) {
      deltaZone.innerHTML = `<div style="padding:16px; background:#fef2f2; border:1px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-weight:600;">${data.error || "Failed to load."}</div>`;
      return;
    }
    const lines = data.lines || [];
    deltaZone.innerHTML = mrdRenderLinesTable('rmrd', prnId, lines, false, 'submitReviseMRDQueue');
    deltaZone.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    deltaZone.innerHTML = `<div style="padding:16px; background:#fef2f2; border:1px solid #fca5a5; border-radius:var(--radius); color:#b91c1c; font-weight:600;">Network error: ${e.message}</div>`;
  }
}

async function submitReviseMRDQueue(ns, prnId, btn) {
  const result = mrdValidateAndCollect(ns);
  if (result.error) { showPurchaseFeedback("rmrd-delta-feedback", `⚠️ ${result.error}`, "error"); return; }
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = "Submitting…";
  try {
    const data = await apFetch({ action: "saveMaterialRequirementDates", prnId, updates: result.updates, operatorName: appActiveOperatorIdentityString });
    if (data.success) {
      document.getElementById("rmrd-delta-zone").innerHTML = "";
      document.getElementById("rmrd-queue-feed").innerHTML = "";
      showPurchaseFeedback("rmrd-delta-feedback",
        `✅ Requirement dates for <strong>${prnId}</strong> revised.<br>` +
        `<button onclick="document.getElementById('rmrd-delta-feedback').style.display='none'; loadRMRDQueueTab();" style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">+ Revise Another PRN</button>`,
        "success", true);
    } else {
      btn.disabled = false; btn.textContent = originalText;
      showPurchaseFeedback("rmrd-delta-feedback", data.error || "Failed to save.", "error");
    }
  } catch (e) {
    btn.disabled = false; btn.textContent = originalText;
    showPurchaseFeedback("rmrd-delta-feedback", "Network error: " + e.message, "error");
  }
}

// "Other Requirement Dates Revisions" tab — free search, mirrors
// store/revise-prn.js's "Other PRN Revisions" tab structure.
async function initializeReviseMRDOtherTab() {
  document.getElementById("rmrd-body").innerHTML = "";
  genericDropdownReset("rmrd-prn-select", "— Select a project first —");
  genericDropdownSetDisabled("rmrd-prn-select", true);
  document.getElementById("rmrd-selector-row").style.display = "grid";
  const sel = document.getElementById("rmrd-project-select-ta-input");
  sel.value = "";
  const dd = document.getElementById("rmrd-project-select-ta-dropdown");
  if (dd) dd.style.display = "none";
  try {
    const data = await apFetch({ action: "pullLiveActiveProjectCodes", statusFilter: "Active" });
    window.sharedActiveProjectCodes = data.success ? (data.projects || []) : [];
    window.sharedProjectMeta = data.success ? (data.projectMeta || {}) : {};
  } catch (e) {
    window.sharedActiveProjectCodes = [];
    sel.placeholder = "Failed to load projects";
  }
}

async function loadReviseMRDList() {
  const projectId = document.getElementById("rmrd-project-select-ta-input").value;
  document.getElementById("rmrd-body").innerHTML = "";
  if (!projectId) { genericDropdownReset("rmrd-prn-select", "— Select a project first —"); genericDropdownSetDisabled("rmrd-prn-select", true); return; }
  genericDropdownReset("rmrd-prn-select", "Loading…");
  genericDropdownSetDisabled("rmrd-prn-select", true);
  try {
    const data = await apFetch({ action: "fetchPRNsByProjectAndStatus", projectId, prnStatus: "Pending", scopeToProductionDept: true });
    const prns = (data.success ? (data.prns || []) : []);
    window.rmrdOtherListMeta = Object.fromEntries(prns.map(p => [p.prnId, p]));
    if (prns.length === 0) {
      genericDropdownReset("rmrd-prn-select", "No PRNs for this project");
      return;
    }
    genericDropdownSetDisabled("rmrd-prn-select", false);
    genericDropdownReset("rmrd-prn-select", "— Select PRN —");
    genericDropdownPopulate("rmrd-prn-select", prns.map(p => ({
      value: p.prnId,
      label: `${p.productName || ""}${p.productRating ? " " + p.productRating : ""} | ${p.department || "—"}${p.version > 1 ? ` (v${p.version})` : ""}`
    })), loadReviseMRDForPRN);
  } catch (e) { genericDropdownReset("rmrd-prn-select", "Failed to load PRNs"); }
}

async function loadReviseMRDForPRN() {
  const prnId = document.getElementById("rmrd-prn-select").value;
  const body = document.getElementById("rmrd-body");
  document.getElementById("rmrd-feedback").style.display = "none";
  window.mrdState.rmrd = { lines: {}, meta: {}, prnId: null, itemCodeByKey: {} };
  if (!prnId) { body.innerHTML = ""; return; }
  body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">Loading materials…</div>`;
  try {
    const data = await apFetch({ action: "fetchMaterialRequirementDatesForPRN", prnId });
    if (!data.success) { body.innerHTML = `<div style="color:#b91c1c; padding:14px; background:#fef2f2; border-radius:6px;">${data.error}</div>`; return; }
    const lines = data.lines || [];
    if (lines.length === 0) { body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted);">This PRN has no material lines.</div>`; return; }
    body.innerHTML = mrdRenderLinesTable('rmrd', prnId, lines, false, 'submitReviseMRDOther');
  } catch (e) { body.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`; }
}

async function submitReviseMRDOther(ns, prnId, btn) {
  const result = mrdValidateAndCollect(ns);
  if (result.error) { showPurchaseFeedback("rmrd-feedback", `⚠️ ${result.error}`, "error"); return; }
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = "Submitting…";
  try {
    const data = await apFetch({ action: "saveMaterialRequirementDates", prnId, updates: result.updates, operatorName: appActiveOperatorIdentityString });
    if (data.success) {
      document.getElementById("rmrd-body").innerHTML = "";
      document.getElementById("rmrd-selector-row").style.display = "none";
      const fb = document.getElementById("rmrd-feedback");
      fb.style.cssText = "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:12px; margin-bottom:12px; border-radius:var(--radius);";
      fb.innerHTML = `✅ Requirement dates revised for <strong>${prnId}</strong>.
        <div><button onclick="initializeReviseMRDPanel();" style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">+ Revise Another PRN</button></div>`;
    } else {
      btn.disabled = false; btn.textContent = originalText;
      showPurchaseFeedback("rmrd-feedback", data.error || "Failed to save.", "error");
    }
  } catch (e) {
    btn.disabled = false; btn.textContent = originalText;
    showPurchaseFeedback("rmrd-feedback", "Network error: " + e.message, "error");
  }
}
