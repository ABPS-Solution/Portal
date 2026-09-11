// ═══════════════════════════════════════════════════════════════════════
// production/production-planning.js — Production > Production Planning
// (Production Planning & Material Requirement Dates group).
//
// This is Stage 4's write surface, moved out of Project Timeline
// (project/project-timeline.js) so the screen and the write-gating agree
// — writes have always been gated by department (Production, matching
// production_sub_dept, or Project, or admin), not by perm_project_timeline.
// Project Timeline still shows the same lane data, but read-only.
//
// Adds the work queue Timeline never had: production_planning_released
// (frozen at MFC + 10 business days by submitManufacturingClearance) is
// now surfaced as Overdue / Due-Upcoming.
//
// Structure mirrors production/material-requirement-dates.js: one file,
// a toggle bar for the two modes (Submit / Update), a shared lane
// renderer underneath. Every function/variable here is prefixed pplan*
// to avoid colliding with project-timeline.js's ptl* globals — both
// files load in the same one-global-scope app (CLAUDE.md §1), so a
// shared name would be a fatal duplicate-declaration SyntaxError.
// ═══════════════════════════════════════════════════════════════════════

let pplanData = null;              // { project, stage3Done, lanes }
let pplanExpandedLanes = new Set();
let pplanActiveTab = "submit";     // "submit" | "update"

// job_card_number is a long composite string ("JC_Set-<n>_<rest>") —
// same shortening convention qa/product-serial-tracking.js's
// psnShortJobCard already established for the same reason (the full
// string is 100+ chars and every other column already carries the rest
// of that information). Kept as this file's own copy rather than
// calling that one directly — this file's own header comment already
// commits to every name here being self-contained/pplan*-prefixed.
function pplanShortJobCard(jobCardNumber) {
  const s = (jobCardNumber || '').toString();
  const m = /^(JC_Set-\d+)/.exec(s);
  return m ? m[1] : s;
}

const PPLAN_DAYMS = 86400000;
const pplanParse = s => new Date(s + "T00:00:00Z");
const PPLAN_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pplanFmt = s => { if (!s) return "-"; const d = pplanParse(s); return d.getUTCDate() + " " + PPLAN_MON[d.getUTCMonth()]; };

const pplanIsAdmin = () => localStorage.getItem("isUserAdminGlobal") === "true";
const pplanAsOfInputHtml = (id, value) => pplanIsAdmin()
  ? `<input type="date" id="pplan-asof-${id}" value="${value || ''}" title="Admin only - set/backdate this completion for testing" style="padding:5px; border:1.5px dashed #f59e0b; border-radius:4px; font-size:0.74rem; width:130px; box-sizing:border-box;" />`
  : "";
const pplanReadAsOf = (id) => { const el = document.getElementById(`pplan-asof-${id}`); return el && el.value ? el.value : undefined; };

function pplanToday() {
  // Server timezone is Asia/Kolkata (db.js) — match it here so "late"
  // flags agree with whatever the backend just computed.
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// Display-only mirror of the real server-side gate (admin OR department
// 'Project' OR department 'Production' with a matching production_sub_dept)
// — the server re-checks this independently on every write; this only
// decides whether to render editable controls at all.
function pplanCanWriteLane(lane) {
  if (localStorage.getItem("isUserAdminGlobal") === "true") return true;
  const dept = localStorage.getItem("userDepartment") || "";
  if (dept === "Project") return true;
  if (dept === "Production" && (localStorage.getItem("userProductionSubDept") || "") === lane.ownerDept) return true;
  return false;
}

async function initializeProductionPlanningPanel() {
  pplanActiveTab = "submit";
  pplanData = null;
  pplanExpandedLanes = new Set();
  const input = document.getElementById("pplan-project-select-ta-input");
  if (input) input.value = "";
  const body = document.getElementById("pplan-body");
  if (body) body.innerHTML = "";
  const fb = document.getElementById("pplan-feedback");
  if (fb) fb.style.display = "none";
  switchProductionPlanningTab("submit");
  pplanLoadEligibleProjects();
  loadProductionPlanningQueue();
}

// Swaps window.sharedActiveProjectCodes/sharedProjectMeta (the generic
// shared typeahead's data source, see shared/typeahead.js) to a set
// scoped to THIS screen's real eligibility — Stage 3 (all BOQs/PRNs/RM
// POs/PPS) fully released for the project, not merely "a BOQ exists" —
// same swap-the-shared-globals pattern store/tickets.js's
// ticketLoadProjectListForDepartment_ already uses for its own
// Active-vs-Service eligible-project split. Not cached across visits (no
// window._pplanEligibleProjectsCache) since Stage 3 completion changes
// underneath this screen constantly and a stale cache would silently let
// an ineligible project back into the search results.
async function pplanLoadEligibleProjects() {
  try {
    const data = await apFetch({ action: "fetchProductionPlanningEligibleProjects" });
    window.sharedActiveProjectCodes = data.success ? (data.projects || []) : [];
    window.sharedProjectMeta = data.success ? (data.projectMeta || {}) : {};
  } catch (e) {
    window.sharedActiveProjectCodes = [];
    window.sharedProjectMeta = {};
  }
}

function switchProductionPlanningTab(tab) {
  pplanActiveTab = tab;
  const submitBtn = document.getElementById("pplan-tab-submit");
  const updateBtn = document.getElementById("pplan-tab-update");
  // Explicit background/color on BOTH states, never reset to '' — the
  // shared .nav-btn-styled default is brand-colored, so resetting an
  // unselected tab to '' renders it looking selected (real bug fixed
  // elsewhere in this app, see CLAUDE.md §31.1).
  if (submitBtn) { submitBtn.style.background = tab === "submit" ? "var(--brand)" : "#e2e8f0"; submitBtn.style.color = tab === "submit" ? "#fff" : "#334155"; }
  if (updateBtn) { updateBtn.style.background = tab === "update" ? "var(--brand)" : "#e2e8f0"; updateBtn.style.color = tab === "update" ? "#fff" : "#334155"; }
  if (pplanData) pplanRenderLanes();
}

// ── Work queue ───────────────────────────────────────────────────────────
async function loadProductionPlanningQueue() {
  const zone = document.getElementById("pplan-needqueue-zone");
  if (!zone) return;
  zone.innerHTML = `<div style="text-align:center; padding:12px; color:var(--muted); font-size:0.8rem;">
    <div class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle;"></div>
    Checking which products need Production Planning...
  </div>`;
  try {
    const data = await apFetch({ action: "fetchProductionPlanningQueue" });
    if (!data.success) { zone.innerHTML = ""; return; }
    zone.innerHTML =
      pplanRenderNeedQueueList("Overdue — Production Planning", data.overdue || [], "✅ Nothing overdue.") +
      pplanRenderNeedQueueList("Due / Upcoming — Production Planning", data.due || [], "✅ Nothing else due yet.");
    if (typeof checkProductionPlanningReminder === "function") checkProductionPlanningReminder();
  } catch (e) {
    zone.innerHTML = "";
  }
}

function pplanRenderNeedQueueList(title, items, emptyMessage) {
  if (items.length === 0) {
    return `<div style="padding:10px 14px; margin-bottom:10px; background:#f0fff4; border:1px solid #86efac; border-radius:var(--radius); color:#15803d; font-size:0.8rem; font-weight:600;">${emptyMessage}</div>`;
  }
  const rows = items.map(item => {
    const dueLine = item.dueDate
      ? `<div style="font-size:0.76rem; color:var(--muted); margin-top:2px;">Due ${escapeHtml(pplanFmt(item.dueDate))}${item.daysOverdue ? ` — <strong style="color:#b91c1c;">${item.daysOverdue}d overdue</strong>` : ""}</div>`
      : "";
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid #f1f5f9;">
        <div style="min-width:0;">
          <span style="font-family:monospace; font-weight:700; font-size:0.8rem; color:var(--brand);">${escapeHtml(item.projectId)}</span>
          <div style="font-size:0.76rem; color:var(--muted); margin-top:2px;">${escapeHtml(item.companyName || "")} <strong> | </strong> ${escapeHtml((item.products || []).join(", "))}</div>
          ${dueLine}
        </div>
        <button class="nav-btn-styled" style="background:var(--brand); padding:6px 14px; font-size:0.76rem; font-weight:700; flex-shrink:0;"
          onclick="jumpToProductionPlanFromQueue('${item.projectId.replace(/'/g, "\\'")}')">
          Plan Now →
        </button>
      </div>`;
  }).join("");
  return `
    <div style="background:#fffbeb; border:1.5px solid #f59e0b; border-radius:var(--radius); overflow:hidden; margin-bottom:12px;">
      <div style="padding:10px 14px; font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#b45309; letter-spacing:0.5px; background:#fef3c7;">
        ${escapeHtml(title)} (${items.length})
      </div>
      ${rows}
    </div>`;
}

async function jumpToProductionPlanFromQueue(projectId) {
  const input = document.getElementById("pplan-project-select-ta-input");
  if (input) input.value = projectId;
  switchProductionPlanningTab("submit");
  await loadProductionPlanForProject();
  const panel = document.getElementById("canvas-module-production-planning");
  if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── One project's lanes ──────────────────────────────────────────────────
async function loadProductionPlanForProject() {
  const input = document.getElementById("pplan-project-select-ta-input");
  const projectId = input ? input.value.trim() : "";
  if (!projectId) return;
  const body = document.getElementById("pplan-body");
  if (body) body.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Loading production plan...</div>`;
  const fb = document.getElementById("pplan-feedback");
  if (fb) fb.style.display = "none";
  try {
    const data = await apFetch({ action: "fetchProductionPlanForProject", projectId });
    if (!data.success) {
      if (body) body.innerHTML = "";
      if (fb) {
        fb.style.cssText = "display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:12px; margin-bottom:14px; border-left:4px solid #b91c1c;";
        fb.innerHTML = `<strong>Failed:</strong> ${escapeHtml(data.error || "Could not load this project.")}`;
      }
      return;
    }
    pplanData = data;
    pplanExpandedLanes = new Set();
    pplanRenderLanes();
  } catch (e) {
    if (body) body.innerHTML = "";
    if (fb) {
      fb.style.cssText = "display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:12px; margin-bottom:14px; border-left:4px solid #b91c1c;";
      fb.innerHTML = `<strong>Network error:</strong> ${escapeHtml(e.message)}`;
    }
  }
}

const PPLAN_LANE_COLOR = { Reactor: '#b45309', Capacitor: '#047857', Panel: '#c2410c' };

function pplanLaneStageLabel(lane) {
  if (!lane.planInitialized) return "Not planned yet";
  const doneCount = lane.steps.filter(s => !!s.actual).length;
  if (doneCount === lane.steps.length) return "Complete";
  return `In progress - ${doneCount}/${lane.steps.length} steps done`;
}

function pplanToggleLane(boqId) {
  if (pplanExpandedLanes.has(boqId)) pplanExpandedLanes.delete(boqId);
  else pplanExpandedLanes.add(boqId);
  pplanRenderLanes();
}

// Submit tab shows only products with no plan yet; Update tab shows only
// already-planned products — same split logic Assign/Revise Material
// Requirement Date uses, just expressed as a client-side filter over one
// fetched lane list rather than two separate server queues (the server
// route already returns every in-scope lane regardless of state).
function pplanRenderLanes() {
  const body = document.getElementById("pplan-body");
  if (!body || !pplanData) return;

  if (!pplanData.stage3Done && !pplanIsAdmin()) {
    body.innerHTML = `<div style="margin-top:14px; background:#fffbeb; border:1px solid #fde68a; border-radius:var(--radius); padding:14px; font-size:0.85rem; color:#92400e;">
      Stage 3 — Pre Production isn't fully done yet for this project. Production Planning opens once every BOQ, drawing, PRN, RM PO and PPS schedule is complete.
    </div>`;
    return;
  }

  const allLanes = pplanData.lanes || [];
  if (allLanes.length === 0) {
    body.innerHTML = `<div style="margin-top:14px; background:var(--highlight-bg); border:1px dashed var(--border); border-radius:var(--radius); padding:14px; font-size:0.82rem; color:var(--muted);">
      No Authorized BOQ on this project falls under Reactor, Capacitor, or Panel Production yet.
    </div>`;
    return;
  }

  const lanes = allLanes.filter(l => pplanActiveTab === "submit" ? !l.planInitialized : l.planInitialized);
  if (lanes.length === 0) {
    body.innerHTML = `<div style="margin-top:14px; background:var(--highlight-bg); border:1px dashed var(--border); border-radius:var(--radius); padding:14px; font-size:0.82rem; color:var(--muted);">
      ${pplanActiveTab === "submit" ? "Every in-scope product on this project already has an initial plan — switch to Update Plan." : "No product on this project has been planned yet — switch to Submit Initial Plan."}
    </div>`;
    return;
  }
  body.innerHTML = `<div style="margin-top:14px;">${lanes.map(pplanRenderLane).join("")}</div>`;
}

function pplanRenderLane(lane) {
  const c = PPLAN_LANE_COLOR[lane.ownerDept] || 'var(--muted)';
  const expanded = pplanExpandedLanes.has(lane.boqId);
  const title = [lane.productName, lane.productRating, lane.descriptionOfMaterial].filter(Boolean).join(" - ");
  return `
    <div id="pplan-lane-${lane.boqId}" style="border:1px solid var(--border); border-radius:var(--radius); margin-bottom:14px; overflow:hidden;">
      <div onclick="pplanToggleLane('${lane.boqId}')" style="padding:10px 14px; background:${c}14; border-left:4px solid ${c}; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; cursor:pointer;">
        <div>
          <span style="display:inline-block; width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:6px solid ${c}; margin-right:8px; transform:rotate(${expanded ? 90 : 0}deg); transition:transform .15s;"></span>
          <span style="font-weight:800; color:${c};">${escapeHtml(lane.name)}</span>
          <span style="color:var(--text); font-size:0.82rem;"> - ${escapeHtml(title)}</span>
          <span style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:${c}; margin-left:6px;">${escapeHtml(lane.ownerDept)} Production</span>
        </div>
        <span style="font-size:0.88rem; font-weight:700; font-family:monospace; color:${c};">${escapeHtml(pplanLaneStageLabel(lane))}</span>
      </div>
      ${expanded ? `<div style="padding:12px 14px;">
        ${lane.planInitialized ? pplanRenderLaneSteps(lane, c, pplanCanWriteLane(lane)) : pplanRenderLaneInitialPlanForm(lane)}
      </div>` : ''}
    </div>`;
}

function pplanRenderLaneInitialPlanForm(lane) {
  const canWrite = pplanCanWriteLane(lane);
  const dis = !canWrite ? 'disabled' : '';
  const colBorder = "border-left:1px solid var(--border);";
  const rows = lane.steps.map(s => `
    <tr style="border-bottom:1px solid var(--border);">
      <td style="width:40%; padding:6px 8px; font-size:0.98rem; font-weight:600; color:var(--text); text-align:center;">${escapeHtml(s.label)}</td>
      <td style="width:30%; padding:5px 8px; text-align:center; ${colBorder}">
        <div style="max-width:170px; margin:0 auto;">
          <input type="date" ${dis} id="pplan-start-${lane.boqId}-${s.id}"
            style="padding:4px; border:1.5px solid var(--border); border-radius:4px; font-size:0.74rem; width:100%; box-sizing:border-box; text-align:center;${!canWrite ? ' background:#f1f5f9; cursor:not-allowed;' : ''}" />
        </div>
      </td>
      <td style="width:30%; padding:5px 8px; text-align:center; ${colBorder}">
        <div style="max-width:170px; margin:0 auto;">
          <input type="date" ${dis} id="pplan-plan-${lane.boqId}-${s.id}"
            style="padding:4px; border:1.5px solid var(--border); border-radius:4px; font-size:0.74rem; width:100%; box-sizing:border-box; text-align:center;${!canWrite ? ' background:#f1f5f9; cursor:not-allowed;' : ''}" />
        </div>
      </td>
    </tr>`).join("");
  return `
    <div style="font-size:0.82rem; color:var(--muted); margin-bottom:10px;">
      No plan submitted yet. ${escapeHtml(lane.ownerDept)} Production enters a completion date for every step below, including Packing and Adding to FG. Material Issue Tickets for this product's Job Cards stay blocked until then. Only its completion is automatic; the planned/target date is entered like any other step. Starting Date is optional and purely informational — it never affects this timeline, and can be changed anytime once the plan is submitted.
    </div>
    ${!canWrite ? `<div style="font-size:0.95rem; font-weight:700; color:#000; background:var(--highlight-bg); border:1px solid var(--border); border-radius:var(--radius); padding:9px 12px; margin-bottom:10px;">View only. Only ${escapeHtml(lane.ownerDept)} Production or Project can enter this plan.</div>` : ''}
    <div style="border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;">
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
        <thead><tr style="background:var(--highlight-bg); border-bottom:1px solid var(--border);">
          <th style="width:40%; padding:6px 8px; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center;">Production Stage</th>
          <th style="width:30%; padding:6px 8px; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center; ${colBorder}">Production Planning Starting Date</th>
          <th style="width:30%; padding:6px 8px; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center; ${colBorder}">Production Planning Completion Date</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:12px;">
      <button class="nav-btn-styled" ${dis} style="${!canWrite ? 'opacity:0.5; cursor:not-allowed;' : ''}" onclick="pplanSubmitInitialPlan('${lane.boqId}')">Submit Initial Plan</button>
    </div>`;
}

// Table form — Process Name / Initial Planning Date (frozen) / Current
// Target Date (display-only, s.target || s.planned) / New Target Date
// (the only editable date column) / Mark Done or Mark Undone. `canWrite`
// additionally decides whether the New Target Date / Mark Done-Undone
// controls render at all — a viewer outside this lane's own department
// gets the same table as pure read-only display, no inputs, no buttons.
function pplanRenderLaneSteps(lane, c, canWrite) {
  const today = pplanToday();
  const allJcs = lane.allJobCards || [];
  const rows = lane.steps.map(s => {
    const done = !!s.actual;
    const eff = s.actual || s.target || s.planned;
    const late = !done && eff && eff < today;
    const currentTarget = s.target || s.planned;

    // Per-Job-Card progress (11 Sep 2026, migration 192; pills moved
    // into the action cell 11 Sep 2026 — no more click-to-expand, every
    // Job Card's toggle pill is always visible so marking one doesn't
    // need a two-step "expand, then click" interaction). s.planned gates
    // this — an unplanned step has no meaningful Job Card list to show.
    const progressChip = !s.terminal && s.planned
      ? `<span style="display:inline-flex; align-items:center; gap:3px; font-size:0.68rem; font-family:monospace; font-weight:700; color:${c}; background:${c}22; padding:2px 7px; border-radius:10px; margin-left:6px; white-space:nowrap;">${s.jcDone}/${s.jcTotal} done</span>`
      : '';

    let actionCell;
    if (s.terminal) {
      // Real completion is still fully automatic (derived off Job Cards
      // actually reaching FG Store) — this admin control is a
      // testing-only override so a realistic multi-week test pass
      // doesn't need real Job Card/FG Store activity to exist.
      const chip = `<span style="font-size:0.72rem; font-family:monospace; font-weight:700; color:${c}; background:${c}22; padding:2px 8px; border-radius:10px;">${escapeHtml(s.chip || '')}</span>`;
      const adminCtl = pplanIsAdmin() ? `<span style="display:inline-flex; align-items:center; gap:6px;">${pplanAsOfInputHtml(`${lane.boqId}-${s.id}`, s.actual)}<button class="nav-btn-styled" style="padding:4px 10px; font-size:0.72rem;" onclick="pplanAdminSetPackingFgDate('${lane.boqId}')">${s.actual ? 'Update (admin)' : 'Set date (admin)'}</button>${s.actual ? `<button class="nav-btn-styled" style="padding:4px 10px; font-size:0.72rem; background:#fff; color:var(--muted); border:1px solid var(--border);" onclick="pplanAdminClearPackingFgDate('${lane.boqId}')">Clear</button>` : ''}</span>` : '';
      actionCell = `${chip}${adminCtl}`;
    } else if (!s.planned) {
      actionCell = `<span style="font-size:0.78rem; color:var(--muted);">-</span>`;
    } else {
      // One toggle pill per in-scope Job Card, always visible — click
      // marks/unmarks just that one Job Card on this step
      // (pplanMarkStepJcDone/pplanUnmarkStepJcDone). No more bulk
      // "Mark Done (all)"/"Mark Undone (all)" button.
      const pills = allJcs.length > 0
        ? `<div style="display:flex; flex-wrap:wrap; gap:5px; justify-content:center;">${allJcs.map(jc => {
            const jcIsDone = (s.doneJobCards || []).includes(jc);
            const shortJc = escapeHtml(pplanShortJobCard(jc));
            const onclick = !canWrite ? '' : jcIsDone
              ? `onclick="pplanUnmarkStepJcDone('${lane.boqId}','${s.id}','${jc.replace(/'/g, "\\'")}')"`
              : `onclick="pplanMarkStepJcDone('${lane.boqId}','${s.id}','${jc.replace(/'/g, "\\'")}')"`;
            return `<span ${onclick} title="${escapeHtml(jc)}" style="font-size:0.68rem; font-weight:700; font-family:monospace; padding:3px 8px; border-radius:12px; ${canWrite ? 'cursor:pointer;' : ''} background:${jcIsDone ? c : '#fff'}; color:${jcIsDone ? '#fff' : c}; border:1.5px solid ${c};">${jcIsDone ? '✓ ' : ''}${shortJc}</span>`;
          }).join('')}</div>`
        : `<span style="font-size:0.78rem; color:var(--muted);">-</span>`;
      const doneLabel = done ? `<div style="font-size:0.74rem; color:${c}; font-weight:700; margin-bottom:4px;">Done ${pplanFmt(s.actual)}</div>` : '';
      const adminAsOf = (canWrite && pplanIsAdmin()) ? `<div style="margin-top:4px; display:flex; justify-content:center;">${pplanAsOfInputHtml(`${lane.boqId}-${s.id}`, s.actual)}</div>` : '';
      actionCell = `${doneLabel}${pills}${adminAsOf}`;
    }

    // Current Starting Date — same editable-window gating as Current
    // Target Completion Date (canWrite && (terminal || !done)), but
    // purely informational: no "already done" business meaning, just
    // reusing the same window so the two stay visually consistent.
    // pplanUpdateStartDate never rejects on step status server-side.
    const startCell = canWrite && (s.terminal || !done)
      ? `<div style="max-width:150px; margin:0 auto;"><input type="date" value="${s.startDate || ''}" onchange="pplanUpdateStartDate('${lane.boqId}','${s.id}', this.value)"
              style="padding:4px; border:1.5px solid var(--border); border-radius:4px; font-size:0.74rem; width:100%; box-sizing:border-box; text-align:center;" /></div>`
      : `<span style="color:var(--muted); font-size:0.8rem;">${s.startDate ? pplanFmt(s.startDate) : '-'}</span>`;

    // Current Target Completion Date — one editable field pre-filled with
    // the current value (was two columns: a read-only "Current Target
    // Date" display plus a separate blank "New Target Date" input;
    // merged 11 Sep 2026 into a single in-place-editable field).
    const targetCell = canWrite && (s.terminal || !done)
      ? `<div style="max-width:150px; margin:0 auto;"><input type="date" value="${s.target || ''}" onchange="pplanUpdateTarget('${lane.boqId}','${s.id}', this.value)"
              style="padding:4px; border:1.5px solid var(--border); border-radius:4px; font-size:0.74rem; width:100%; box-sizing:border-box; text-align:center;" /></div>`
      : `<span style="color:var(--muted); font-size:0.8rem;">${pplanFmt(currentTarget)}</span>`;

    const colBorder = "border-left:1px solid var(--border);";
    const mainRow = `
      <tr id="pplan-step-${lane.boqId}-${s.id}" style="border-bottom:1px solid var(--border);">
        <td style="width:22%; padding:5px 8px; font-size:0.98rem; font-weight:600; color:${late ? 'var(--warn)' : 'var(--text)'}; text-align:center;">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; background:${done ? c : '#fff'}; border:2px solid ${late ? 'var(--warn)' : c}; vertical-align:middle;"></span>
          ${escapeHtml(s.label)}${s.terminal ? ' <span style="font-weight:400; color:var(--muted); font-size:0.78rem;">(automatic)</span>' : ''}${progressChip}
        </td>
        <td style="width:14%; padding:5px 8px; font-size:0.95rem; font-weight:700; color:#15803d; font-family:monospace; text-align:center; ${colBorder}">
          ${pplanFmt(s.planned)}
          ${pplanIsAdmin() && s.planned ? `<div style="margin-top:4px; display:flex; flex-direction:column; align-items:center; gap:3px;">${pplanAsOfInputHtml(`planned-${lane.boqId}-${s.id}`, s.planned)}<button class="nav-btn-styled" style="padding:2px 8px; font-size:0.65rem;" onclick="pplanAdminOverridePlanned('${lane.boqId}','${s.id}')">Update (admin)</button></div>` : ''}
        </td>
        <td style="width:14%; padding:5px 8px; text-align:center; ${colBorder}">${startCell}</td>
        <td style="width:20%; padding:5px 8px; text-align:center; ${colBorder}">${targetCell}</td>
        <td style="width:30%; padding:5px 8px; text-align:center; ${colBorder}">
          ${actionCell}
        </td>
      </tr>`;

    return mainRow;
  }).join("");

  const colBorder = "border-left:1px solid var(--border);";
  return `
    <div style="border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;">
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
        <thead><tr style="background:${c}14; border-bottom:1px solid var(--border);">
          <th style="width:22%; padding:6px 8px; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center;">Process Name</th>
          <th style="width:14%; padding:6px 8px; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center; ${colBorder}">Initial Planning Completion Date</th>
          <th style="width:14%; padding:6px 8px; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center; ${colBorder}">Current Starting Date</th>
          <th style="width:20%; padding:6px 8px; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center; ${colBorder}">Current Target Completion Date</th>
          <th style="width:30%; padding:6px 8px; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center; ${colBorder}">Completion Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Writes ───────────────────────────────────────────────────────────────
async function pplanSubmitInitialPlan(boqId) {
  const lane = (pplanData.lanes || []).find(l => l.boqId === boqId);
  if (!lane) return;
  const steps = [];
  for (const s of lane.steps) {
    const el = document.getElementById(`pplan-plan-${boqId}-${s.id}`);
    const val = el ? el.value : "";
    if (!val) { alert(`Enter a completion date for "${s.label}".`); return; }
    // Starting Date is optional (informational only, never gates submission).
    const startEl = document.getElementById(`pplan-start-${boqId}-${s.id}`);
    const startVal = startEl ? startEl.value : "";
    steps.push({ stepKey: s.id, plannedDate: val, startDate: startVal || null });
  }
  try {
    const data = await apFetch({ action: "submitInitialProductPlan", operatorName: appActiveOperatorIdentityString, boqId, steps });
    if (!data.success) { alert(data.error || "Could not submit the plan."); return; }
    await loadProductionPlanForProject(); // reload real server state rather than guess it locally
    loadProductionPlanningQueue();
  } catch (e) { alert("Network error: " + e.message); }
}

async function pplanUpdateTarget(boqId, stepKey, targetDate) {
  if (!targetDate) return;
  try {
    const data = await apFetch({ action: "updateProductPlanStepTarget", boqId, stepKey, targetDate });
    if (!data.success) { alert(data.error || "Could not update the target date."); pplanRenderLanes(); return; }
    const lane = pplanData.lanes.find(l => l.boqId === boqId);
    const step = lane && lane.steps.find(s => s.id === stepKey);
    if (step) step.target = data.targetDate;
  } catch (e) { alert("Network error: " + e.message); }
}

// Starting Date (11 Sep 2026) — purely informational, never gates
// anything downstream. Directly editable in place, any time, unlike
// Target Date's "already done" restriction.
async function pplanUpdateStartDate(boqId, stepKey, startDate) {
  try {
    const data = await apFetch({ action: "updateProductPlanStepStartDate", boqId, stepKey, startDate });
    if (!data.success) { alert(data.error || "Could not update the starting date."); pplanRenderLanes(); return; }
    const lane = pplanData.lanes.find(l => l.boqId === boqId);
    const step = lane && lane.steps.find(s => s.id === stepKey);
    if (step) step.startDate = data.startDate;
  } catch (e) { alert("Network error: " + e.message); }
}

// Admin-only testing override for the frozen Initial Planning Date.
async function pplanAdminOverridePlanned(boqId, stepKey) {
  try {
    const date = pplanReadAsOf(`planned-${boqId}-${stepKey}`);
    if (!date) { alert('Pick a date.'); return; }
    const data = await apFetch({ action: "adminOverridePlannedDate", operatorName: appActiveOperatorIdentityString, boqId, stepKey, date });
    if (!data.success) { alert(data.error || "Could not override the Initial Planning Date."); return; }
    await loadProductionPlanForProject();
  } catch (e) { alert("Network error: " + e.message); }
}

// Per-Job-Card mark/unmark (11 Sep 2026, migration 192; the only way to
// mark a step done since 11 Sep 2026 — the bulk "Mark Done (all)"/"Mark
// Undone (all)" buttons and their pplanMarkStepDone/pplanUnmarkStepDone
// handlers were removed the same day in favor of always-visible per-JC
// pills, one click each). The backend's bulk markProductPlanStepDone/
// unmarkProductPlanStepDone routes are unused by this screen now but
// left in place (flagged, not deleted).
async function pplanMarkStepJcDone(boqId, stepKey, jobCardNumber) {
  try {
    const asOfDate = pplanReadAsOf(`${boqId}-${stepKey}`);
    const data = await apFetch({ action: "markProductPlanStepJobCardDone", operatorName: appActiveOperatorIdentityString, boqId, stepKey, jobCardNumber, asOfDate });
    if (!data.success) { alert(data.error || "Could not mark this Job Card done."); return; }
    const lane = pplanData.lanes.find(l => l.boqId === boqId);
    const step = lane && lane.steps.find(s => s.id === stepKey);
    if (step) {
      step.actual = data.actualDate;
      step.jcTotal = data.jcTotal; step.jcDone = data.jcDone;
      const set = new Set(step.doneJobCards || []); set.add(jobCardNumber);
      step.doneJobCards = Array.from(set);
    }
    pplanRenderLanes();
  } catch (e) { alert("Network error: " + e.message); }
}

async function pplanUnmarkStepJcDone(boqId, stepKey, jobCardNumber) {
  try {
    const data = await apFetch({ action: "unmarkProductPlanStepJobCardDone", operatorName: appActiveOperatorIdentityString, boqId, stepKey, jobCardNumber });
    if (!data.success) { alert(data.error || "Could not mark this Job Card undone."); return; }
    const lane = pplanData.lanes.find(l => l.boqId === boqId);
    const step = lane && lane.steps.find(s => s.id === stepKey);
    if (step) {
      step.actual = data.complete ? step.actual : null;
      step.jcTotal = data.jcTotal; step.jcDone = data.jcDone;
      step.doneJobCards = (step.doneJobCards || []).filter(j => j !== jobCardNumber);
    }
    pplanRenderLanes();
  } catch (e) { alert("Network error: " + e.message); }
}

async function pplanAdminSetPackingFgDate(boqId) {
  const date = pplanReadAsOf(`${boqId}-packing_add_fg`);
  if (!date) { alert("Pick a date first."); return; }
  try {
    const data = await apFetch({ action: "adminSetPackingFgDate", operatorName: appActiveOperatorIdentityString, boqId, date });
    if (!data.success) { alert(data.error || "Could not set this date."); return; }
    await loadProductionPlanForProject();
  } catch (e) { alert("Network error: " + e.message); }
}

async function pplanAdminClearPackingFgDate(boqId) {
  try {
    const data = await apFetch({ action: "adminClearPackingFgDate", operatorName: appActiveOperatorIdentityString, boqId });
    if (!data.success) { alert(data.error || "Could not clear this override."); return; }
    await loadProductionPlanForProject();
  } catch (e) { alert("Network error: " + e.message); }
}
