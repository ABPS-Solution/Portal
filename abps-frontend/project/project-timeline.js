// project/project-timeline.js — Project Timeline Tracking (Project
// department, after Manufacturing Clearance). Stages 1-3 and 5 render as
// a plain list (Stage 5 has no lanes of its own to branch — the SVG
// schematic from the design exploration earns its keep at Stage 4, which
// has real product lanes). Stage 4 is a real read/write surface: submit
// an initial plan once per BOQ, then revise target dates and tick
// non-terminal steps as work happens; the terminal "Packing and Adding
// to FG" step is derived automatically, never a button here. Stage 5's
// four QA/dispatch milestones take a real entered date (booked ahead or
// logged after the fact), not a same-day "mark done" — Inspection Call
// Release is the one item in the whole screen that's flagged but never
// enterable: it's purely a computed deadline.
//
// Write permission isn't checked client-side beyond perm_project_timeline
// gating the whole screen — every write button is shown to anyone who can
// see the screen, and the real "own department, or admin" gate lives
// server-side in routes/timeline.js. A rejected write surfaces the
// server's message via alert() rather than silently hiding the control,
// same trade-off Stage 3's Mark Done button already made.
//
// Design tokens/engine mirror the ABPS Portal's own :root variables
// (see index.html) rather than inventing a palette — this screen sits
// inside the app, not next to it.

// The portal's CSS vars don't carry one hue per department the way the
// prototype's mock palette did — Stage 1-3 only touches Marketing/
// Project/Design/Store/Purchase, so a small fixed set covers it without
// inventing new tokens.
const PTL_COLORS = {
  marketing: '#be185d', project: '#0056b3', design: '#00a878',
  store: '#0369a1', purchase: '#7c3aed', qa: '#dc2626',
};
const PTL_DEPT_NAME = { marketing: 'Marketing', project: 'Project', design: 'Design', store: 'Store', purchase: 'Purchase', qa: 'Quality Assurance' };
// Dispatch is no longer part of this chain — it's Store's, derived
// automatically from when the Final Project Invoice was generated (see
// routes/timeline.js), never a hand-entered date.
const PTL_QA_CHAIN = new Set(['customer_inspection', 'inspection_clearance_note', 'dispatch_clearance']);

let ptlProjects = [];
let ptlData = null;
let ptlSelected = null;

// Admin-only test backdate — server re-checks perm_admin regardless (see
// resolveAdminBackdate in routes/timeline.js), this just decides whether
// to show the control at all. A blank value means "today", same as
// every non-admin's Mark Done always meant.
const ptlIsAdmin = () => localStorage.getItem("isUserAdminGlobal") === "true";
const ptlAsOfInputHtml = (id, value) => ptlIsAdmin()
  ? `<input type="date" id="ptl-asof-${id}" value="${value || ''}" title="Admin only — set/backdate this completion for testing" style="padding:5px; border:1.5px dashed #f59e0b; border-radius:4px; font-size:0.74rem;" />`
  : "";
const ptlReadAsOf = (id) => { const el = document.getElementById(`ptl-asof-${id}`); return el && el.value ? el.value : undefined; };

// Persistent green highlight on whatever row a Timeline-canvas click just
// jumped to — cleared on the next jump (or lost on the row's own next
// re-render, which is fine: it's a "you clicked this" affordance, not
// stored state).
let ptlLastHighlightEl = null;
function ptlHighlightRow(el) {
  if (ptlLastHighlightEl && ptlLastHighlightEl !== el) {
    ptlLastHighlightEl.style.border = "";
    ptlLastHighlightEl.style.borderRadius = "";
  }
  if (el) {
    el.style.border = "2px solid #16a34a";
    el.style.borderRadius = "8px";
  }
  ptlLastHighlightEl = el;
}

async function initializeProjectTimelinePanel() {
  const mount = document.getElementById("ptl-mount");
  if (!mount) return;
  mount.innerHTML = `
    <div style="margin-bottom:14px; position:relative; max-width:420px;">
      <label class="field-label" style="margin-top:0;">Project ID or Customer Name *</label>
      <input type="text" id="ptl-project-input" placeholder="Type Project ID or Customer Name..." autocomplete="off"
        oninput="handlePtlProjectInput(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();}"
        style="width:100%; padding:9px; border:1.5px solid var(--border); border-radius:var(--radius);" />
      <div id="ptl-project-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:260px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
    </div>
    <div id="ptl-feedback" style="display:none; padding:12px; border-radius:var(--radius); margin-bottom:14px; border-left:4px solid;"></div>
    <div id="ptl-body"></div>
  `;
  document.getElementById("ptl-project-input").value = "";
  document.getElementById("ptl-body").innerHTML = "";
  ptlData = null; ptlSelected = null;

  try {
    const data = await apFetch({ action: "fetchProjectTimelineEligibleProjects" });
    ptlProjects = data.success ? (data.projects || []) : [];
  } catch (e) { ptlProjects = []; }
}

function handlePtlProjectInput(query) {
  const dd = document.getElementById("ptl-project-dropdown");
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const matches = ptlProjects.filter(p =>
    p.projectId.toLowerCase().includes(q) || (p.companyName || "").toLowerCase().includes(q)
  ).slice(0, 12);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(p => `
    <div onmousedown="event.preventDefault();" onclick="selectPtlProject('${p.projectId.replace(/'/g, "\\'")}')"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-weight:700;">${escapeHtml(p.projectId)}</span>
      <span style="color:var(--muted);"> — ${escapeHtml(p.companyName || '')} · ${escapeHtml(p.status)}</span>
    </div>`).join("");
  dd.style.display = "block";
}
document.addEventListener("click", (e) => {
  const dd = document.getElementById("ptl-project-dropdown");
  if (dd && !e.target.closest("#ptl-project-input") && !e.target.closest("#ptl-project-dropdown")) dd.style.display = "none";
});

async function selectPtlProject(projectId) {
  document.getElementById("ptl-project-input").value = projectId;
  document.getElementById("ptl-project-dropdown").style.display = "none";
  const body = document.getElementById("ptl-body");
  body.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Loading timeline...</div>`;
  const fb = document.getElementById("ptl-feedback");
  fb.style.display = "none";
  try {
    const data = await apFetch({ action: "fetchProjectTimeline", projectId });
    if (!data.success) {
      body.innerHTML = "";
      fb.style.cssText = "display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:12px; margin-bottom:14px; border-left:4px solid #b91c1c;";
      fb.innerHTML = `<strong>Failed:</strong> ${escapeHtml(data.error || 'Could not load this project.')}`;
      return;
    }
    ptlData = data; ptlSelected = null;
    ptlRender();
  } catch (e) {
    body.innerHTML = "";
    fb.style.cssText = "display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:12px; margin-bottom:14px; border-left:4px solid #b91c1c;";
    fb.innerHTML = `<strong>Network error:</strong> ${escapeHtml(e.message)}`;
  }
}

/* ── Business-day engine — same convention as lib/businessDays.js:
   dates as "YYYY-MM-DD" strings, parsed as UTC midnight, so this can
   never drift a day depending on the viewer's own timezone. ─────────── */
const PTL_DAYMS = 86400000;
const ptlParse = s => new Date(s + "T00:00:00Z");
const ptlIso = d => d.toISOString().slice(0, 10);
function ptlBdBetween(a, b) {
  if (!a || !b) return null;
  const dir = ptlParse(b) >= ptlParse(a) ? 1 : -1;
  let d = ptlParse(a), count = 0;
  while (ptlIso(d) !== b) {
    d = new Date(d.getTime() + dir * PTL_DAYMS);
    if (d.getUTCDay() !== 0) count += dir; // holidays not fetched client-side yet — Sunday-only here, server is authoritative for freezing
  }
  return count;
}
const PTL_MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ptlFmt = s => { if (!s) return "—"; const d = ptlParse(s); return d.getUTCDate() + " " + PTL_MON[d.getUTCMonth()]; };
const ptlFmtFull = s => { if (!s) return "—"; const d = ptlParse(s); return d.getUTCDate() + " " + PTL_MON[d.getUTCMonth()] + " " + d.getUTCFullYear(); };

function ptlToday() {
  // Server timezone is Asia/Kolkata (db.js) — match it here so "today"
  // agrees with what the backend just froze/derived, rather than the
  // viewer's own local clock.
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// Same convention as Manufacturing Clearance's wrapper header: Tentative
// (projects.delivery_date, from the customer PO) until Internal MFC is
// given, then Expected (projects.mfc_actual_delivery_date, a gating field
// entered at clearance time — column is named "actual" in the schema,
// but it's never a record of an already-happened delivery, so the
// screen calls it Expected everywhere, not Actual).
const ptlDeliveryLabel = p => p.mfcInt ? "Expected Delivery" : "Tentative Delivery";
const ptlDeliveryValue = p => p.mfcInt ? p.actualDelivery : p.tentativeDelivery;

const ptlEff = n => n.actual || n.target || n.planned;
const ptlLate = n => !n.actual && !n.done && ptlEff(n) && ptlEff(n) < ptlToday();

function ptlRender() {
  const body = document.getElementById("ptl-body");
  const { project, mfcComplete, trunk } = ptlData;
  const today = ptlToday();

  const header = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:800; font-size:1.05rem; color:var(--text);">${escapeHtml(project.projectId)}</div>
        <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(project.companyName || '—')} · <strong>${escapeHtml(project.status)}</strong>${project.mfcInt ? ` · Internal MFC <strong>${ptlFmtFull(project.mfcInt)}</strong>` : ''} · ${ptlDeliveryLabel(project)} <strong>${ptlFmtFull(ptlDeliveryValue(project))}</strong></div>
      </div>
    </div>`;

  // Two full views, not a canvas strip glued above a list: Timeline is
  // the schematic overview (big — real screen space, not a sidebar
  // widget); Steps is where the actual Mark Done / Set Date / target
  // editing happens. Both render into the DOM always; only visibility
  // toggles, so a canvas click can jump straight into Steps.
  const tabs = `
    <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; margin-bottom:16px;">
      <button type="button" id="ptl-tab-timeline" onclick="ptlSetViewMode('timeline')" style="padding:9px 18px; font-size:0.85rem; font-weight:700; border:0; border-right:1px solid var(--border); cursor:pointer;">Timeline</button>
      <button type="button" id="ptl-tab-steps" onclick="ptlSetViewMode('steps')" style="padding:9px 18px; font-size:0.85rem; font-weight:700; border:0; cursor:pointer;">Steps</button>
    </div>`;
  const stepsOpen = `<div id="ptl-steps-wrap" style="display:none;">`;

  if (!mfcComplete) {
    body.innerHTML = header + tabs + stepsOpen + `
      <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:var(--radius); padding:14px; font-size:0.85rem; color:#92400e;">
        Stage 3 onward unlocks once Manufacturing Clearance sets this project's Internal MFC date — nothing has been cleared yet, so only Stages 1-2 are shown below.
      </div>
      <div style="margin-top:16px;">${ptlRenderList(trunk.filter(n => n.stage <= 2), today)}</div>
      </div>`;
    ptlSetViewMode(ptlViewMode);
    return;
  }

  // prodPlan (Stage 3/4 boundary) renders before the lanes it summarizes;
  // inspCall + the QA chain (Stage 4/5 boundary onward) render after —
  // they depend on the lanes' own terminal-step dates.
  const preLanes = trunk.filter(n => n.stage <= 3 || n.id === 'prodPlan');
  const postLanes = trunk.filter(n => n.id === 'inspCall' || n.stage === 5);
  body.innerHTML = header + tabs + stepsOpen + ptlRenderList(preLanes, today)
    + ptlRenderLanes(ptlData.lanes || [])
    + `<div style="margin-top:20px; font-weight:800; font-size:0.95rem; color:var(--text); margin-bottom:4px;">Stage 5 — Inspection &amp; Dispatch</div>`
    + ptlRenderList(postLanes, today)
    + `</div>`;
  ptlSetViewMode(ptlViewMode);
}

/* ── Stage 4 — one card per in-scope BOQ, collapsed to its header
   (product + current stage) until clicked. Expansion state is kept in a
   module-level Set (not per-render local state) so it survives the
   re-renders every Mark Done / Submit Plan action triggers, and so a
   Timeline-canvas click can force a lane open before scrolling to it
   (see ptlSetViewMode's focusAnchorId handling). ─────────────────────── */
const PTL_LANE_COLOR = { Reactor: '#b45309', Capacitor: '#047857', Panel: '#c2410c' };
let ptlExpandedLanes = new Set();

function ptlRenderLanes(lanes) {
  if (lanes.length === 0) {
    return `<div style="margin-top:18px; background:var(--highlight-bg); border:1px dashed var(--border); border-radius:var(--radius); padding:14px; font-size:0.82rem; color:var(--muted);">
      Stage 4 — Production Planning: no Authorized BOQ on this project falls under Reactor, Capacitor, or Panel Production yet.
    </div>`;
  }
  return `<div style="margin-top:20px;">
    <div style="font-weight:800; font-size:0.95rem; color:var(--text); margin-bottom:10px;">Stage 4 — Production Planning</div>
    ${lanes.map(ptlRenderLane).join("")}
  </div>`;
}

function ptlLaneStageLabel(lane) {
  if (!lane.planInitialized) return "Not planned yet";
  const doneCount = lane.steps.filter(s => !!s.actual).length;
  if (doneCount === lane.steps.length) return "Complete";
  return `In progress — ${doneCount}/${lane.steps.length} steps done`;
}

function ptlToggleLane(boqId) {
  if (ptlExpandedLanes.has(boqId)) ptlExpandedLanes.delete(boqId);
  else ptlExpandedLanes.add(boqId);
  ptlRender();
}

function ptlRenderLane(lane) {
  const c = PTL_LANE_COLOR[lane.ownerDept] || 'var(--muted)';
  const expanded = ptlExpandedLanes.has(lane.boqId);
  const title = [lane.productName, lane.productRating, lane.descriptionOfMaterial].filter(Boolean).join(" — ");
  return `
    <div id="ptl-lane-${lane.boqId}" style="border:1px solid var(--border); border-radius:var(--radius); margin-bottom:14px; overflow:hidden;">
      <div onclick="ptlToggleLane('${lane.boqId}')" style="padding:10px 14px; background:${c}14; border-left:4px solid ${c}; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; cursor:pointer;">
        <div>
          <span style="display:inline-block; width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:6px solid ${c}; margin-right:8px; transform:rotate(${expanded ? 90 : 0}deg); transition:transform .15s;"></span>
          <span style="font-weight:800; color:${c};">${escapeHtml(lane.name)}</span>
          <span style="color:var(--muted); font-size:0.82rem;"> — ${escapeHtml(title)}</span>
          <span style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:${c}; margin-left:6px;">${escapeHtml(lane.ownerDept)} Production</span>
        </div>
        <span style="font-size:0.72rem; font-weight:700; font-family:monospace; color:${c};">${escapeHtml(ptlLaneStageLabel(lane))}</span>
      </div>
      ${expanded ? `<div style="padding:12px 14px;">
        ${lane.planInitialized ? ptlRenderLaneSteps(lane, c) : ptlRenderLaneInitialPlanForm(lane)}
      </div>` : ''}
    </div>`;
}

function ptlRenderLaneInitialPlanForm(lane) {
  return `
    <div style="font-size:0.82rem; color:var(--muted); margin-bottom:10px;">
      No plan submitted yet. ${escapeHtml(lane.ownerDept)} Production enters a planned date for every step below, including Packing and Adding to FG — Material Issue Tickets for this product's Job Cards stay blocked until then. Only its completion is automatic; the planned/target date is entered like any other step.
    </div>
    <div style="display:flex; flex-direction:column; gap:7px;">
      ${lane.steps.map(s => `
        <div style="display:flex; align-items:center; gap:10px;">
          <label style="flex:1; font-size:0.85rem;">${escapeHtml(s.label)}</label>
          <input type="date" id="ptl-plan-${lane.boqId}-${s.id}" style="padding:6px; border:1.5px solid var(--border); border-radius:var(--radius);" />
        </div>`).join("")}
    </div>
    <div style="margin-top:12px;">
      <button class="nav-btn-styled" onclick="ptlSubmitInitialPlan('${lane.boqId}')">Submit Initial Plan</button>
    </div>`;
}

function ptlRenderLaneSteps(lane, c) {
  const today = ptlToday();
  return lane.steps.map(s => {
    const done = !!s.actual;
    const eff = s.actual || s.target || s.planned;
    const late = !done && eff && eff < today;
    const dotBorder = late ? 'var(--warn)' : c;
    let rightCell;
    if (s.terminal) {
      // Target stays revisable (same input as any step) — only "Mark
      // Done" is withheld, since completion here is always derived from
      // Finished Goods Store, never a manual click.
      rightCell = `
        ${!done ? `<input type="date" value="${s.target || ''}" onchange="ptlUpdateTarget('${lane.boqId}','${s.id}', this.value)"
              style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem;" />` : ''}
        <span style="font-size:0.72rem; font-family:monospace; font-weight:700; color:${c}; background:${c}22; padding:2px 8px; border-radius:10px;">${escapeHtml(s.chip || '')}</span>`;
    } else if (done) {
      rightCell = `<span style="font-size:0.78rem; color:${c}; font-weight:700;">Done ${ptlFmt(s.actual)}</span>` +
        (ptlIsAdmin() ? `<span style="display:inline-flex; align-items:center; gap:6px; margin-left:4px;">${ptlAsOfInputHtml(`${lane.boqId}-${s.id}`, s.actual)}<button class="nav-btn-styled" style="padding:4px 10px; font-size:0.72rem;" onclick="ptlMarkStepDone('${lane.boqId}','${s.id}')">Update (admin)</button></span>` : '');
    } else {
      rightCell = `
        <input type="date" value="${s.target || ''}" onchange="ptlUpdateTarget('${lane.boqId}','${s.id}', this.value)"
          style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem;" />
        ${ptlAsOfInputHtml(`${lane.boqId}-${s.id}`)}
        <button class="nav-btn-styled" style="padding:4px 10px; font-size:0.74rem;" onclick="ptlMarkStepDone('${lane.boqId}','${s.id}')">Mark Done</button>`;
    }
    return `
      <div id="ptl-step-${lane.boqId}-${s.id}" style="display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid #f1f5f9; flex-wrap:wrap; border-radius:4px;">
        <div style="width:14px; height:14px; border-radius:50%; flex:none; background:${done ? c : '#fff'}; border:2px solid ${dotBorder};"></div>
        <div style="flex:1; min-width:170px; font-size:0.85rem; font-weight:600; color:${late ? 'var(--warn)' : 'var(--text)'};">${escapeHtml(s.label)}${s.terminal ? ' <span style="font-weight:400; color:var(--muted); font-size:0.72rem;">(automatic)</span>' : ''}</div>
        <div style="font-size:0.72rem; color:var(--muted); font-family:monospace;">Planned ${ptlFmt(s.planned)}</div>
        ${rightCell}
      </div>`;
  }).join("");
}

async function ptlSubmitInitialPlan(boqId) {
  const lane = (ptlData.lanes || []).find(l => l.boqId === boqId);
  if (!lane) return;
  const steps = [];
  for (const s of lane.steps) {
    const el = document.getElementById(`ptl-plan-${boqId}-${s.id}`);
    const val = el ? el.value : "";
    if (!val) { alert(`Enter a planned date for "${s.label}".`); return; }
    steps.push({ stepKey: s.id, plannedDate: val });
  }
  try {
    const data = await apFetch({ action: "submitInitialProductPlan", operatorName: appActiveOperatorIdentityString, boqId, steps });
    if (!data.success) { alert(data.error || "Could not submit the plan."); return; }
    await selectPtlProject(ptlData.project.projectId); // reload real server state rather than guess it locally
  } catch (e) { alert("Network error: " + e.message); }
}

async function ptlUpdateTarget(boqId, stepKey, targetDate) {
  if (!targetDate) return;
  try {
    const data = await apFetch({ action: "updateProductPlanStepTarget", boqId, stepKey, targetDate });
    if (!data.success) { alert(data.error || "Could not update the target date."); ptlRender(); return; }
    const lane = ptlData.lanes.find(l => l.boqId === boqId);
    const step = lane && lane.steps.find(s => s.id === stepKey);
    if (step) step.target = data.targetDate;
  } catch (e) { alert("Network error: " + e.message); }
}

async function ptlMarkStepDone(boqId, stepKey) {
  try {
    const asOfDate = ptlReadAsOf(`${boqId}-${stepKey}`);
    const data = await apFetch({ action: "markProductPlanStepDone", operatorName: appActiveOperatorIdentityString, boqId, stepKey, asOfDate });
    if (!data.success) { alert(data.error || "Could not mark this step done."); return; }
    const lane = ptlData.lanes.find(l => l.boqId === boqId);
    const step = lane && lane.steps.find(s => s.id === stepKey);
    if (step) step.actual = data.actualDate;
    ptlRender();
  } catch (e) { alert("Network error: " + e.message); }
}

// Which system nodes carry a "what's left" drill-down — the backend
// attaches n.detail (a plain array of strings, empty = nothing
// outstanding) to boqs/prns/rmpos/pps/prodPlan only, see routes/timeline.js.
let ptlExpandedNodes = new Set();
function ptlToggleNodeDetail(nodeId) {
  if (ptlExpandedNodes.has(nodeId)) ptlExpandedNodes.delete(nodeId);
  else ptlExpandedNodes.add(nodeId);
  ptlRender();
}

// A plain, honest list — the branching SVG schematic from the design
// exploration is Stage 4's job (it needs the product lanes to be worth
// drawing); Stages 1-3 are a single line, so a list reads better than a
// canvas here and ships without carrying that engine's full weight.
function ptlRenderList(nodes, today) {
  // Stage 5's QA dates are refused server-side until every in-scope
  // product has a Stage 4 plan on file (routes/timeline.js) — reflect
  // that client-side too, rather than letting the input take a value
  // that only surfaces as an alert() after Set Date is clicked.
  const prodPlanNode = ptlData && ptlData.trunk && ptlData.trunk.find(n => n.id === 'prodPlan');
  const prodPlanDone = !!(prodPlanNode && prodPlanNode.done);
  return `<div style="display:flex; flex-direction:column; gap:0;">` + nodes.map(n => {
    const c = PTL_COLORS[n.dept] || 'var(--muted)';
    const done = !!n.actual || n.done === true;
    const late = ptlLate(n);
    const eff = ptlEff(n);
    const dateTxt = n.actual ? ptlFmtFull(n.actual) : (n.done ? `On or before ${ptlFmtFull(eff)} (exact date not tracked)` : eff ? `Due ${ptlFmtFull(eff)}` : 'Not yet scheduled');
    const dotColor = late ? 'var(--warn)' : c;
    const hasDetail = Array.isArray(n.detail);
    const expanded = hasDetail && ptlExpandedNodes.has(n.id);
    const manualCanEdit = n.kind === 'manual' && !PTL_QA_CHAIN.has(n.id) && (!n.actual || ptlIsAdmin());
    const qaCanEdit = PTL_QA_CHAIN.has(n.id) && prodPlanDone && (!n.actual || ptlIsAdmin());
    const qaBlockedByPlan = PTL_QA_CHAIN.has(n.id) && !n.actual && !prodPlanDone;
    return `
      <div id="ptl-row-${n.id}" ${hasDetail ? `onclick="ptlToggleNodeDetail('${n.id}')"` : ''} style="display:flex; align-items:flex-start; gap:12px; padding:10px 4px; border-bottom:1px solid var(--border); border-radius:4px;${hasDetail ? ' cursor:pointer;' : ''}">
        <div style="flex:none; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center;
          background:${done ? dotColor : '#fff'}; border:2.5px solid ${dotColor}; margin-top:2px;">
          ${done ? '<span style="color:#fff; font-weight:900; font-size:0.85rem;">✓</span>' : ''}
        </div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;">
            <span style="font-weight:700; font-size:0.92rem; color:${late ? 'var(--warn)' : 'var(--text)'};">${escapeHtml(n.label)}</span>
            <span style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:${c};">${escapeHtml(PTL_DEPT_NAME[n.dept] || n.dept)}</span>
            ${n.kind === 'manual' ? '<span style="font-size:0.68rem; color:var(--muted);">· ticked by hand</span>' : ''}
            ${n.kind === 'derived' ? '<span style="font-size:0.68rem; color:var(--muted);">· automatic</span>' : ''}
          </div>
          <div style="font-size:0.8rem; color:${late ? 'var(--warn)' : 'var(--muted)'}; margin-top:2px;">${escapeHtml(dateTxt)}${late ? ` · ${Math.abs(ptlBdBetween(eff, today))} business days late` : ''}</div>
          ${n.chip ? `<span style="display:inline-block; margin-top:5px; font-size:0.72rem; font-family:monospace; font-weight:700; color:${c}; background:${c}22; padding:2px 8px; border-radius:10px;">${escapeHtml(n.chip)}</span>` : ''}
          ${hasDetail ? `<div style="font-size:0.72rem; color:var(--brand); margin-top:5px; font-weight:600;">${expanded ? '▾ Hide' : '▸ Show'} what's left</div>` : ''}
          ${manualCanEdit ? `<div onclick="event.stopPropagation()" style="margin-top:7px; display:flex; align-items:center; gap:8px;">${ptlAsOfInputHtml(n.id, n.actual)}<button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlMarkMilestoneDone('${n.id}')">${n.actual ? 'Update (admin)' : 'Mark Done'}</button></div>` : ''}
          ${qaCanEdit ? `
            <div onclick="event.stopPropagation()" style="margin-top:7px; display:flex; align-items:center; gap:8px;">
              <input type="date" id="ptl-qa-date-${n.id}" value="${n.actual || ''}" style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem;" />
              <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlSetQaMilestoneDate('${n.id}')">${n.actual ? 'Update (admin)' : 'Set Date'}</button>
            </div>` : ''}
          ${qaBlockedByPlan ? `<div style="margin-top:7px; font-size:0.76rem; color:var(--muted); font-style:italic;">Stage 4 Production Planning has to be submitted for every in-scope product before this can be entered.</div>` : ''}
        </div>
      </div>
      ${hasDetail && expanded ? `<div style="margin:0 0 10px 40px; padding:10px 12px; background:var(--highlight-bg); border:1px solid var(--border); border-radius:var(--radius); font-size:0.8rem; color:var(--text);">
        ${n.detail.length ? `<ul style="margin:0; padding-left:18px;">${n.detail.map(d => `<li>${escapeHtml(d)}</li>`).join("")}</ul>` : `<span style="color:var(--muted);">${escapeHtml(n.blocked || 'Nothing left — this row is fully covered.')}</span>`}
      </div>` : ''}`;
  }).join("") + `</div>`;
}

const PTL_MILESTONE_KEY = { costing: 'costing_released', wdesign: 'working_designs_released' };

async function ptlSetQaMilestoneDate(milestoneKey) {
  if (!ptlData) return;
  const el = document.getElementById(`ptl-qa-date-${milestoneKey}`);
  const date = el ? el.value : "";
  if (!date) { alert("Pick a date first."); return; }
  const projectId = ptlData.project.projectId;
  try {
    const data = await apFetch({ action: "saveTimelineMilestoneDate", operatorName: appActiveOperatorIdentityString, projectId, milestoneKey, date });
    if (!data.success) { alert(data.error || "Could not set this date."); return; }
    const node = ptlData.trunk.find(n => n.id === milestoneKey);
    if (node) node.actual = data.actualDate;
    ptlRender();
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

/* ══════════════════════════════════════════════════════════════════
   Canvas — the schematic overview from the design exploration, now fed
   by ptlData instead of sample data. Read-only: hover a node for its
   detail, click it to jump to the matching row below, where the actual
   Mark Done / Set Date / target-revision controls live (same
   client-side-permission stance as the rest of this file — the canvas
   doesn't try to duplicate that write surface inline).

   Only DATED points get plotted — a step with no planned/target/actual
   yet has no x position to place it at, so it simply doesn't appear on
   the canvas; the list below still shows it as "Not yet scheduled".
   A lane only appears once its initial plan is submitted (every step,
   including the terminal one, has a planned date at that point — see
   submitInitialProductPlan).
   ══════════════════════════════════════════════════════════════════ */
const PTL_MODES = { week: 6, days15: 15, month: 26 };
const PTL_FONT_SCALE = { week: 1.32, days15: 1.14, month: 1.05 };
let ptlMode = "days15", ptlDayW = 30, ptlFS = 1.14;
let ptlDays = [], ptlIndexMap = {};
let ptlLastTodayX = 0;
let ptlFsRailOpen = true;
const PTL_LANE_HEX = { Reactor: '#b45309', Capacitor: '#047857', Panel: '#c2410c' };
const PTL_TRUNK_HEX = { marketing: '#be185d', project: '#0056b3', design: '#00a878', store: '#0369a1', purchase: '#7c3aed', qa: '#dc2626' };

function ptlBuildDayRange() {
  const dates = [];
  (ptlData.trunk || []).forEach(n => { const e = ptlEff(n); if (e) dates.push(e); });
  (ptlData.lanes || []).forEach(l => l.steps.forEach(s => { const e = s.actual || s.target || s.planned; if (e) dates.push(e); }));
  dates.push(ptlToday());
  if (dates.length === 0) return false;
  dates.sort();
  // Starts right on the earliest dated point — no multi-day dead zone to
  // scroll into before Stage 1's own first node (LEAD below still leaves
  // a small margin so that node's label/circle isn't flush against the edge).
  const from = ptlParse(dates[0]);
  const to = new Date(ptlParse(dates[dates.length - 1]).getTime() + 6 * PTL_DAYMS);
  ptlDays = []; ptlIndexMap = {};
  for (let t = from.getTime(); t <= to.getTime(); t += PTL_DAYMS) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0) { ptlIndexMap[ptlIso(d)] = ptlDays.length; ptlDays.push(ptlIso(d)); }
  }
  return true;
}

function ptlCanvasNodes() {
  const spineIds = ['oa', 'po', 'activated', 'dwgSent', 'dwgAppr', 'mfcCust', 'mfcInt', 'boqs', 'costing', 'wdesign', 'prns', 'rmpos', 'pps', 'prodPlan'];
  const tailIds = ['inspCall', 'customer_inspection', 'inspection_clearance_note', 'dispatch_clearance', 'dispatched', 'delivery'];
  const byId = id => (ptlData.trunk || []).find(n => n.id === id);
  const dated = id => { const n = byId(id); return n && ptlEff(n) ? n : null; };
  return {
    spine: spineIds.map(dated).filter(Boolean),
    tail: tailIds.map(dated).filter(Boolean),
    lanes: (ptlData.lanes || []).filter(l => l.planInitialized),
  };
}

function ptlWrapLbl(t, max) {
  const out = []; let cur = "";
  t.split(" ").forEach(w => {
    if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  });
  if (cur) out.push(cur);
  return out.slice(0, 2);
}
const ptlWLbl = s => s.length * 5.8 * ptlFS;
const ptlWMono = (s, px) => s.length * px * 0.6 * ptlFS;

const PTL_MAX_SLOT = 6;
function ptlPlacer() {
  const taken = [];
  const clear = b => !taken.some(p => b.x0 < p.x1 - 2 && p.x0 < b.x1 - 2 && b.y0 < p.y1 - 2 && p.y0 < b.y1 - 2);
  return {
    block: b => taken.push(b),
    place(mk) {
      for (let k = 0; k < PTL_MAX_SLOT; k++) { const b = mk(k); if (clear(b)) { taken.push(b); return k; } }
      taken.push(mk(PTL_MAX_SLOT - 1)); return PTL_MAX_SLOT - 1;
    },
  };
}
const PTL_STAGE_NAMES = { 1: 'Order Intake', 2: 'Clearance', 3: 'Pre Production', 4: 'Production', 5: 'Inspection & Dispatch' };

function ptlRenderCanvas(containerId) {
  const wrap = document.getElementById(containerId || ptlCanvasContainerId);
  if (!wrap) return;
  if (!ptlBuildDayRange()) { wrap.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Nothing dated yet to draw a timeline from.</div>`; return; }
  const { spine, tail, lanes } = ptlCanvasNodes();
  if (spine.length < 2) { wrap.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Nothing dated yet to draw a timeline from.</div>`; return; }

  ptlFS = PTL_FONT_SCALE[ptlMode];
  // Full-width, full-height surface — this is the primary view, not a
  // strip squeezed above a list, so it gets real screen real estate.
  const availW = Math.max(900, (wrap.clientWidth || window.innerWidth) - 4);
  const longestName = Math.max(16, ...lanes.map(l => (l.name || '').length));
  const LEAD = Math.round(64 * ptlFS);
  const PAD_L = Math.round(70 + longestName * 6.6 * ptlFS);
  const PAD_R = 90;
  ptlDayW = Math.max(16, Math.min(320, (availW - PAD_L - LEAD - PAD_R) / PTL_MODES[ptlMode]));
  const DENSE = ptlDayW < 38;

  const RULER_H = Math.round(56 * ptlFS);
  const SLOT_UP = 26 * ptlFS, SLOT_DN = 30 * ptlFS, LINE_H = 12 * ptlFS;
  const R = 7.5 * (1 + (ptlFS - 1) * 0.55);

  // The spine sits at the vertical centre of the whole surface, always —
  // Stage 1-3 have nothing to branch, so it's just a straight line down
  // the middle. Lanes (once Production Planning is submitted) fan out
  // symmetrically above and below that same centre, never displacing it.
  // Hard container height, and the container never scrolls vertically
  // (see ptl-fs-scroller's overflow-y:hidden) — so FAN below MUST adapt
  // to how many nodes actually share the busiest date, or a 4-way
  // same-day cluster (e.g. MFC from Customer landing on the same day
  // Stage 3's +3-business-day offsets do) needs more vertical room than
  // exists and either clips or forces a scrollbar.
  const H = Math.max(480, wrap.clientHeight || 520);
  const top = RULER_H + (DENSE ? 120 : 90) * ptlFS;
  const bot = H - 46 * ptlFS;
  const gap = Math.max(90 * ptlFS, Math.min(220 * ptlFS, (bot - top) / 2.4));
  const dateGroupSizes = {};
  [...spine, ...tail].forEach(n => { const d = ptlEff(n); if (d) dateGroupSizes[d] = (dateGroupSizes[d] || 0) + 1; });
  const maxGroupSize = Math.max(1, ...Object.values(dateGroupSizes));
  // Leave room above/below the fanned group for its own label + date
  // stacks, then fit within whatever's left.
  const vertRoomForFan = Math.max(80, (bot - top) - 150 * ptlFS);
  const FAN = maxGroupSize > 1
    ? Math.min(96 * ptlFS, gap * 0.86, vertRoomForFan / (maxGroupSize - 1))
    : Math.min(96 * ptlFS, gap * 0.86);
  const spineY = (top + bot) / 2;
  const laneCount = lanes.length;
  const laneYs = lanes.map((_, i) => spineY + (i - (laneCount - 1) / 2) * gap);

  // If the exact date isn't in the index (a Sunday slipped through — the
  // backend now refuses new ones, but old data or a holiday-adjacent edge
  // could still land here), snap forward to the next day that IS, rather
  // than silently plotting at day zero.
  const xOf = (d) => {
    let i = ptlIndexMap[d];
    if (i === undefined) {
      let dt = ptlParse(d);
      for (let guard = 0; guard < 7 && i === undefined; guard++) {
        dt = new Date(dt.getTime() + PTL_DAYMS);
        i = ptlIndexMap[ptlIso(dt)];
      }
    }
    return PAD_L + LEAD + (i ?? 0) * ptlDayW;
  };
  const W = PAD_L + LEAD + ptlDays.length * ptlDayW + PAD_R;
  const today = ptlToday();
  const todayX = xOf(today in ptlIndexMap ? today : ptlDays[ptlDays.length - 1]);

  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const P = [];
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  // Ruler + week gridlines
  P.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="var(--bg,#f0f4f8)"/>`);
  ptlDays.forEach((d, i) => {
    if (ptlParse(d).getUTCDay() !== 1) return;
    const x = PAD_L + LEAD + i * ptlDayW;
    P.push(`<line x1="${x}" y1="${RULER_H}" x2="${x}" y2="${H}" stroke="var(--border)" stroke-width="1.5"/>`);
  });
  P.push(`<rect x="0" y="0" width="${W}" height="${RULER_H}" fill="var(--card)"/>`);
  P.push(`<line x1="0" y1="${RULER_H}" x2="${W}" y2="${RULER_H}" stroke="var(--border)" stroke-width="1.5"/>`);
  let lastM = -1;
  ptlDays.forEach((d, i) => {
    const x = PAD_L + LEAD + i * ptlDayW, dt = ptlParse(d), m = dt.getUTCMonth(), mon = dt.getUTCDay() === 1;
    if (m !== lastM) { lastM = m; P.push(`<text x="${x}" y="${14 * ptlFS}" font-size="${11 * ptlFS}" font-weight="800" letter-spacing="1.5" fill="var(--muted)">${PTL_MON[m].toUpperCase()} ${dt.getUTCFullYear()}</text>`); }
    if (!DENSE || mon) {
      P.push(`<text x="${x}" y="${RULER_H - 15 * ptlFS}" text-anchor="middle" font-size="${11.5 * ptlFS}" font-family="monospace" font-weight="${mon ? 800 : 600}" fill="${mon ? 'var(--text)' : 'var(--muted)'}">${dt.getUTCDate()}</text>`);
      P.push(`<text x="${x}" y="${RULER_H - 5 * ptlFS}" text-anchor="middle" font-size="${9 * ptlFS}" font-family="monospace" font-weight="600" fill="var(--muted)">${DOW[dt.getUTCDay()]}</text>`);
    }
  });

  // Stage dividers — a real rule with the stage name against it, same as
  // the design prototype, so the schematic reads as five stages rather
  // than one unbroken run of dots.
  const stageXs = {};
  [...spine, ...tail].forEach(n => { if (n.stage) (stageXs[n.stage] = stageXs[n.stage] || []).push(xOf(ptlEff(n))); });
  lanes.forEach(l => l.steps.forEach(s => (stageXs[4] = stageXs[4] || []).push(xOf(s.actual || s.target || s.planned))));
  // Skip a stage's label (never the divider line itself) when the next
  // stage starts too close after it for the text to fit — a small Stage
  // 4 window otherwise collided with Stage 5's label right after it.
  const stageKeys = Object.keys(stageXs).sort((a, b) => a - b);
  const stageX0s = stageKeys.map(st => Math.min(...stageXs[st]) - ptlDayW * 0.75);
  stageKeys.forEach((st, i) => {
    const x0 = stageX0s[i];
    P.push(`<line x1="${x0}" y1="${RULER_H}" x2="${x0}" y2="${H}" stroke="var(--text)" stroke-width="2.5" opacity=".55"/>`);
    const label = `STAGE ${st} · ${(PTL_STAGE_NAMES[st] || '').toUpperCase()}`;
    const estWidth = label.length * 6.4 * ptlFS;
    const nextX0 = i + 1 < stageX0s.length ? stageX0s[i + 1] : Infinity;
    if (nextX0 - (x0 + 9 * ptlFS) > estWidth) {
      P.push(`<text x="${x0 + 9 * ptlFS}" y="${RULER_H + 17 * ptlFS}" font-size="${10.5 * ptlFS}" font-weight="800" letter-spacing="1.2" fill="var(--text)" opacity=".75">${esc(label)}</text>`);
    }
  });

  // Today
  P.push(`<line x1="${todayX}" y1="${RULER_H}" x2="${todayX}" y2="${H}" stroke="var(--brand)" stroke-width="2.5" opacity=".85"/>`);

  // Traces: spine (split at prodPlan into lanes, rejoin at tail[0]).
  // Nodes sharing the exact same date (e.g. BOQs/Costing/Working Designs,
  // all frozen +3 business days from Internal MFC) would otherwise land
  // on the identical (x, spineY) point and render as one merged dot —
  // fan them vertically around the spine instead, same as the design
  // prototype did.
  const pos = {};
  const byDate = {};
  [...spine, ...tail].forEach(n => { (byDate[ptlEff(n)] = byDate[ptlEff(n)] || []).push(n); });
  Object.values(byDate).forEach(group => {
    const x = xOf(ptlEff(group[0]));
    group.forEach((n, i) => { pos[n.id] = { x, y: spineY + (i - (group.length - 1) / 2) * FAN }; });
  });
  // Two steps in the same lane sharing a date (an operator entered the
  // same day for both) get a small vertical fan around that lane's own
  // row, same idea as the spine fan above, so they never merge into one
  // dot. Computed once, reused for both the trace path and the nodes.
  const laneStepY = lanes.map((l, i) => {
    const y = laneYs[i], byX = {}, out = {};
    l.steps.forEach(s => { const x = xOf(s.actual || s.target || s.planned); (byX[x] = byX[x] || []).push(s); });
    Object.values(byX).forEach(group => group.forEach((s, gi) => { out[s.id] = y + (gi - (group.length - 1) / 2) * (FAN * 0.7); }));
    return out;
  });

  const poly = pts => pts.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const traces = [];
  if (laneCount === 0) {
    traces.push({ d: poly([...spine, ...tail].map(n => pos[n.id])), c: 'var(--brand)' });
  } else {
    traces.push({ d: poly(spine.map(n => pos[n.id])), c: 'var(--brand)' });
    const split = pos[spine[spine.length - 1].id];
    const merge = tail.length ? pos[tail[0].id] : split;
    lanes.forEach((l, i) => {
      const c = PTL_LANE_HEX[l.ownerDept] || 'var(--muted)';
      const y = laneYs[i];
      const stepPts = l.steps.map(s => ({ x: xOf(s.actual || s.target || s.planned), y: laneStepY[i][s.id] }));
      const fx = stepPts[0].x, lx = stepPts[stepPts.length - 1].x;
      traces.push({ d: `M${split.x} ${split.y} C${(split.x + fx) / 2} ${split.y}, ${(split.x + fx) / 2} ${y}, ${fx} ${y}`, c });
      traces.push({ d: poly(stepPts), c });
      traces.push({ d: `M${lx} ${y} C${(lx + merge.x) / 2} ${y}, ${(lx + merge.x) / 2} ${merge.y}, ${merge.x} ${merge.y}`, c });
    });
    if (tail.length) traces.push({ d: poly(tail.map(n => pos[n.id])), c: PTL_TRUNK_HEX.qa });
  }
  const clipId = "ptlclip" + Math.random().toString(36).slice(2, 8);
  P.push(`<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${todayX}" height="${H}"/></clipPath></defs>`);
  traces.forEach(t => P.push(`<path d="${t.d}" fill="none" stroke="${t.c}" stroke-width="1.8" stroke-dasharray="4 5" opacity=".4" stroke-linecap="round"/>`));
  P.push(`<g clip-path="url(#${clipId})">`);
  traces.forEach(t => P.push(`<path d="${t.d}" fill="none" stroke="${t.c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`));
  P.push(`</g>`);

  // Nodes
  const laid = [];
  spine.forEach(n => laid.push({ n, x: pos[n.id].x, y: pos[n.id].y }));
  tail.forEach(n => laid.push({ n, x: pos[n.id].x, y: pos[n.id].y }));
  lanes.forEach((l, i) => l.steps.forEach(s => laid.push({ n: { ...s, dept: l.ownerDept === 'Reactor' ? 'lane_r' : l.ownerDept === 'Capacitor' ? 'lane_c' : 'lane_p' }, x: xOf(s.actual || s.target || s.planned), y: laneStepY[i][s.id], laneColor: PTL_LANE_HEX[l.ownerDept], boqId: l.boqId, ownerLabel: `${l.ownerDept} Production` })));
  laid.sort((a, b) => a.x - b.x);

  const PL = ptlPlacer();
  laid.forEach(({ x, y }) => PL.block({ x0: x - R * 1.4, x1: x + R * 1.4, y0: y - R * 1.4, y1: y + R * 1.4 }));

  const clickMap = [];
  laid.forEach(({ n, x, y, laneColor, boqId, ownerLabel }) => {
    const c = laneColor || PTL_TRUNK_HEX[n.dept] || 'var(--muted)';
    const eff = n.actual || n.target || n.planned;
    const done = !!n.actual || n.done === true;
    const late = !done && eff && eff < today;
    const bd = late ? Math.abs(ptlBdBetween(eff, today) || 0) : null;
    const ring = late ? '#e84545' : c;

    const lines = ptlWrapLbl(n.label, 16);
    const lw = Math.max(...lines.map(ptlWLbl));
    const GAP = 12 * ptlFS, ASC = 9 * ptlFS;
    const kU = PL.place(k => { const b = y - R - GAP - k * (SLOT_UP + LINE_H); return { x0: x - lw / 2, x1: x + lw / 2, y0: b - (lines.length - 1) * LINE_H - ASC, y1: b + 3 }; });
    const base = y - R - GAP - kU * (SLOT_UP + LINE_H);
    if (kU > 0) P.push(`<line x1="${x}" y1="${y - R}" x2="${x}" y2="${base + 4}" stroke="${ring}" stroke-width="1" opacity=".3"/>`);
    lines.forEach((ln, i) => P.push(`<text x="${x}" y="${base - (lines.length - 1 - i) * LINE_H}" text-anchor="middle" font-size="${11 * ptlFS}" font-weight="600" fill="${late ? '#e84545' : 'var(--text)'}" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="3.5">${esc(ln)}</text>`));

    const dtx = ptlFmt(eff);
    const bw = ptlWMono(dtx, 10.5);
    const kD = PL.place(k => { const d = y + R + GAP + k * SLOT_DN; return { x0: x - bw / 2, x1: x + bw / 2, y0: d - ASC, y1: d + 3 }; });
    const dy = y + R + GAP + kD * SLOT_DN;
    if (kD > 0) P.push(`<line x1="${x}" y1="${y + R}" x2="${x}" y2="${dy - ASC}" stroke="${ring}" stroke-width="1" opacity=".3"/>`);
    P.push(`<text x="${x}" y="${dy}" text-anchor="middle" font-size="${10.5 * ptlFS}" font-weight="700" font-family="monospace" fill="${late ? '#e84545' : 'var(--muted)'}" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="3.5">${esc(dtx)}</text>`);

    P.push(`<circle cx="${x}" cy="${y}" r="${R}" fill="${done ? c : 'var(--card)'}" stroke="${ring}" stroke-width="${(late ? 2.6 : 2.2) * ptlFS}"/>`);
    if (done) P.push(`<path d="M${x - R * 0.43} ${y} l${R * 0.31} ${R * 0.32} l${R * 0.55} -${R * 0.61}" fill="none" stroke="var(--card)" stroke-width="${1.8 * ptlFS}" stroke-linecap="round" stroke-linejoin="round"/>`);

    const anchorId = boqId ? `ptl-step-${boqId}-${n.id}` : `ptl-row-${n.id}`;
    const idx = clickMap.length;
    clickMap.push({
      label: n.label, owner: ownerLabel || (PTL_DEPT_NAME[n.dept] || n.dept),
      planned: n.planned, eff, actual: n.actual, late: bd,
    });
    P.push(`<circle cx="${x}" cy="${y}" r="${R * 2.2}" fill="transparent" class="ptl-hit" data-anchor="${anchorId}" data-idx="${idx}"/>`);
  });

  // Gutter (sticky lane labels)
  if (laneCount) {
    const gutterW = PAD_L + LEAD - 10;
    const G = [`<g id="ptl-gutter">`, `<rect x="0" y="${RULER_H}" width="${gutterW}" height="${H - RULER_H}" fill="var(--bg,#f0f4f8)"/>`, `<line x1="${gutterW}" y1="${RULER_H}" x2="${gutterW}" y2="${H}" stroke="var(--border)" stroke-width="1"/>`];
    lanes.forEach((l, i) => {
      const c = PTL_LANE_HEX[l.ownerDept] || 'var(--muted)', y = laneYs[i];
      G.push(`<rect x="16" y="${y - 12 * ptlFS}" width="4" height="${24 * ptlFS}" rx="2" fill="${c}"/>`);
      G.push(`<text x="28" y="${y + 4.5 * ptlFS}" font-size="${13 * ptlFS}" font-weight="800" fill="${c}">${esc(l.name)}</text>`);
    });
    G.push(`</g>`);
    P.push(G.join(""));
  }

  // Last of all, so nothing can cover it. Sits at the BOTTOM of the line,
  // not the top — the top is where stage-divider labels live, and the two
  // used to collide right where Today happened to fall inside a stage.
  P.push(`<text x="${todayX}" y="${H - 10 * ptlFS}" text-anchor="middle" font-size="${10 * ptlFS}" font-weight="800" letter-spacing="1" fill="var(--brand)" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="5">TODAY · ${esc(ptlFmt(today))}</text>`);

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block;">${P.join("")}</svg>`;
  ptlLastTodayX = todayX;
  wrap.innerHTML = svg;
  ptlWireCanvasInteractions(wrap, clickMap);

  // Land the horizontal scroll on today.
  wrap.scrollLeft = Math.max(0, todayX - wrap.clientWidth / 2);
}

let ptlCanvasContainerId = "ptl-fs-scroller";
function ptlSetMode(m) { ptlMode = m; ptlRenderFullscreen(); }

/* ── View toggle: Timeline (the canvas above) vs Steps (the existing
   lists/lane-cards with the actual Mark Done / Set Date / target-editing
   controls). Both are always rendered into the DOM — only visibility
   toggles — so a canvas click can switch to Steps and immediately
   scrollIntoView its target without waiting on a re-render. ─────────── */
// Default is Steps: the actual read/write surface. Timeline is the
// schematic overview — opened full-screen (see ptlOpenFullscreen below),
// matching the ABPS-Project-Timeline-Demo prototype, rather than squeezed
// inline above the list.
let ptlViewMode = "steps";

function ptlSetViewMode(mode, focusAnchorId) {
  ptlViewMode = mode;
  const stepsWrap = document.getElementById("ptl-steps-wrap");
  const tabTimeline = document.getElementById("ptl-tab-timeline");
  const tabSteps = document.getElementById("ptl-tab-steps");
  if (stepsWrap) stepsWrap.style.display = mode === "steps" ? "block" : "none";
  if (tabTimeline) { tabTimeline.style.background = mode === "timeline" ? "var(--brand)" : "#fff"; tabTimeline.style.color = mode === "timeline" ? "#fff" : "var(--text)"; }
  if (tabSteps) { tabSteps.style.background = mode === "steps" ? "var(--brand)" : "#fff"; tabSteps.style.color = mode === "steps" ? "#fff" : "var(--text)"; }

  if (mode === "timeline") {
    ptlOpenFullscreen();
  } else {
    ptlCloseFullscreen();
  }
  if (focusAnchorId) {
    // A lane step's anchor is "ptl-step-<boqId>-<stepId>" — expand that
    // product's card first (it renders collapsed by default) or the
    // target element won't exist yet to scroll to.
    const laneMatch = /^ptl-step-(.+)-([a-z0-9_]+)$/.exec(focusAnchorId);
    if (laneMatch && !ptlExpandedLanes.has(laneMatch[1])) {
      ptlExpandedLanes.add(laneMatch[1]);
      ptlRender();
    }
    setTimeout(() => {
      const target = document.getElementById(focusAnchorId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      ptlHighlightRow(target);
    }, 30);
  }
}

/* ── Full-screen Timeline overlay — the same layout as the
   ABPS-Project-Timeline-Demo prototype (topbar with project info, zoom
   segment, Today jump, flags rail toggle; a full-bleed scroller below;
   a dismissible Flags rail on the right), fed by live ptlData instead of
   the demo's sample data. Opened by the Timeline tab, closed by the
   Steps button inside it (or the Steps tab underneath, same handler). ── */
function ptlOpenFullscreen() {
  let ov = document.getElementById("ptl-fs-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "ptl-fs-overlay";
    ov.style.cssText = "position:fixed; inset:0; z-index:9000; background:var(--bg,#f0f4f8); display:flex; flex-direction:column;";
    document.body.appendChild(ov);
  }
  if (!document.getElementById("ptl-fs-style")) {
    // The scroller still scrolls left/right (drag, wheel, trackpad) —
    // this only hides the native scrollbar track, which sat as a bare
    // grey bar under the legend and read as leftover chrome.
    const style = document.createElement("style");
    style.id = "ptl-fs-style";
    style.textContent = `#ptl-fs-scroller{scrollbar-width:none;}#ptl-fs-scroller::-webkit-scrollbar{display:none;}`;
    document.head.appendChild(style);
  }
  ov.style.display = "flex";
  document.body.style.overflow = "hidden";
  ptlRenderFullscreen();
}

function ptlCloseFullscreen() {
  const ov = document.getElementById("ptl-fs-overlay");
  if (ov) ov.style.display = "none";
  document.body.style.overflow = "";
}

function ptlSeverity(n, today) {
  if (!ptlLate(n)) return null;
  if (n.sev) return n.sev;
  const d = Math.abs(ptlBdBetween(ptlEff(n), today) || 0);
  if (n.terminal) return "critical";
  return d > 3 ? "high" : "normal";
}

// Every entry states something already true against live data — no
// hardcoded scenario the way the design-exploration prototype had one.
function ptlBuildFlags() {
  if (!ptlData) return [];
  const today = ptlToday();
  const nodes = [];
  (ptlData.trunk || []).forEach(n => nodes.push(n));
  (ptlData.lanes || []).forEach(l => l.steps.forEach(s => nodes.push(Object.assign({}, s, { dept: l.ownerDept, laneBoqId: l.boqId }))));

  const out = [];
  const ownerOf = n => n.laneBoqId ? `${n.dept} Production` : (PTL_DEPT_NAME[n.dept] || n.dept);
  ["critical", "high", "normal"].forEach(sev => {
    nodes.filter(n => ptlSeverity(n, today) === sev).forEach(n => {
      const d = Math.abs(ptlBdBetween(ptlEff(n), today) || 0);
      out.push({
        sev, nodeId: n.id, boqId: n.laneBoqId,
        title: `${n.label} is ${d} working day${d === 1 ? "" : "s"} late`,
        msg: `Due ${ptlFmtFull(ptlEff(n))}.${n.chip ? ` So far: ${n.chip}.` : ""}`,
        owner: ownerOf(n),
      });
    });
  });
  nodes.filter(n => !n.actual && !n.done && ptlEff(n) === today).forEach(n => out.push({
    sev: "due", nodeId: n.id, boqId: n.laneBoqId,
    title: `${n.label} is due today`,
    msg: `Due ${ptlFmtFull(ptlEff(n))}.`,
    owner: ownerOf(n),
  }));
  const rank = { critical: 0, high: 1, normal: 2, due: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}

function ptlGotoFlag(nodeId, boqId) {
  ptlSetViewMode("steps", boqId ? `ptl-step-${boqId}-${nodeId}` : `ptl-row-${nodeId}`);
}

function ptlRenderFsRailBody(flags) {
  const body = document.getElementById("ptl-fs-rail-body");
  if (!body) return;
  const GRP = { critical: "Critical", high: "Needs attention", normal: "Watch", due: "Due today" };
  const SEV_COLOR = { critical: "#e84545", high: "#d97706", normal: "#6b7a8d", due: "var(--brand)" };
  let html = "";
  ["critical", "high", "normal", "due"].forEach(sev => {
    const items = flags.filter(f => f.sev === sev);
    if (!items.length) return;
    html += `<div style="font-size:0.68rem; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; margin:15px 0 7px; color:${SEV_COLOR[sev]};">${escapeHtml(GRP[sev])} · ${items.length}</div>`;
    items.forEach(f => {
      html += `<button type="button" onclick="ptlGotoFlag('${f.nodeId}','${f.boqId || ''}')"
        style="display:block; width:100%; text-align:left; font:inherit; color:inherit; background:#f7fafd; border:1px solid var(--border); border-left:3px solid ${SEV_COLOR[sev]}; border-radius:var(--radius); padding:9px 11px; margin-bottom:7px; cursor:pointer;">
        <b style="display:block; font-size:0.8rem; font-weight:700; margin-bottom:3px; line-height:1.35;">${escapeHtml(f.title)}</b>
        <span style="display:block; font-size:0.74rem; color:var(--muted); line-height:1.45;">${escapeHtml(f.msg)}</span>
        <em style="display:block; font-style:normal; margin-top:5px; font-size:0.68rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:${SEV_COLOR[sev]};">${escapeHtml(f.owner)}</em>
      </button>`;
    });
  });
  body.innerHTML = html || `<div style="padding:20px; text-align:center; color:var(--muted); font-size:0.85rem;">Nothing flagged.</div>`;
}

function ptlToggleFsRail() {
  ptlFsRailOpen = !ptlFsRailOpen;
  const rail = document.getElementById("ptl-fs-rail");
  if (rail) rail.style.display = ptlFsRailOpen ? "flex" : "none";
  ptlUpdateFsFlagsToggleBtn();
}

// Show Flags (rail hidden) is red — something is hidden that needs a
// look. Hide Flags (rail open) is green — the state is fine to tuck away.
function ptlUpdateFsFlagsToggleBtn() {
  const btn = document.getElementById("ptl-fs-flags-toggle");
  if (!btn) return;
  if (ptlFsRailOpen) { btn.textContent = "Hide Flags"; btn.style.background = "#16a34a"; }
  else { btn.textContent = "Show Flags"; btn.style.background = "#dc2626"; }
}

function ptlJumpToday() {
  const sc = document.getElementById(ptlCanvasContainerId);
  if (!sc) return;
  sc.scrollTo({ left: Math.max(0, ptlLastTodayX - sc.clientWidth / 2), behavior: "smooth" });
}

function ptlRenderFullscreen() {
  const ov = document.getElementById("ptl-fs-overlay");
  if (!ov || !ptlData) return;
  const { project } = ptlData;
  const flags = ptlBuildFlags();
  const overdueCount = flags.filter(f => f.sev !== "due").length;

  ov.innerHTML = `
    <div style="flex:none; background:var(--card); border-bottom:1px solid var(--border); padding:12px 18px; display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px;">
      <button type="button" onclick="ptlSetViewMode('steps')" title="Back to Steps" style="flex:none; display:flex; align-items:center; gap:5px; padding:7px 12px; font-size:0.82rem; font-weight:700; border:1px solid var(--border); border-radius:var(--radius); background:#fff; color:var(--muted); cursor:pointer;">&lsaquo; Steps</button>
      <div style="width:1px; align-self:stretch; background:var(--border); flex:none;"></div>
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <div style="width:5px; height:30px; border-radius:2px; background:var(--brand); flex:none;"></div>
        <div style="min-width:0;">
          <div style="font-weight:800; font-size:1.1rem; color:var(--brand); white-space:nowrap;">Project Timeline</div>
          <div style="font-size:0.75rem; color:var(--muted); font-family:monospace; white-space:nowrap;">${escapeHtml(project.projectId)} — ${escapeHtml(project.companyName || '')} · <strong style="color:var(--text)">${escapeHtml(project.status)}</strong>${project.mfcInt ? ` · Internal MFC <strong style="color:var(--text)">${ptlFmtFull(project.mfcInt)}</strong>` : ''} · ${ptlDeliveryLabel(project)} <strong style="color:var(--text)">${ptlFmtFull(ptlDeliveryValue(project))}</strong></div>
        </div>
      </div>
      <div style="flex:1 1 auto;"></div>
      <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;">
        ${Object.keys(PTL_MODES).map(m => `<button type="button" onclick="ptlSetMode('${m}')" style="padding:7px 14px; font-size:0.82rem; font-weight:600; border:0; border-right:1px solid var(--border); cursor:pointer; background:${m === ptlMode ? 'var(--brand)' : '#fff'}; color:${m === ptlMode ? '#fff' : 'var(--muted)'};">${m === 'week' ? 'This Week' : m === 'days15' ? '15 Days' : 'This Month'}</button>`).join("")}
      </div>
      <button type="button" onclick="ptlJumpToday()" style="padding:7px 14px; font-size:0.82rem; font-weight:700; border:0; border-radius:var(--radius); cursor:pointer; background:var(--brand); color:#fff;">Today</button>
      <button type="button" id="ptl-fs-flags-toggle" onclick="ptlToggleFsRail()" style="padding:7px 14px; font-size:0.82rem; font-weight:700; border:0; border-radius:var(--radius); cursor:pointer; color:#fff;"></button>
    </div>
    <div style="flex:1 1 auto; display:flex; min-height:0;">
      <div style="flex:1 1 auto; min-width:0; display:flex; flex-direction:column;">
        <div id="ptl-fs-scroller" style="flex:1 1 auto; min-height:0; overflow-x:auto; overflow-y:hidden; cursor:grab; background:var(--bg,#f0f4f8);"></div>
        <div style="flex:none; border-top:1px solid var(--border); background:var(--card); padding:8px 18px; display:flex; flex-wrap:wrap; align-items:center; gap:6px 20px; font-size:0.74rem; color:var(--muted);">
          <span>● Complete</span><span>○ Scheduled</span><span style="color:#e84545;">○ Overdue</span><span>— Done so far</span><span style="opacity:.6;">┄ Still to come</span>
          <span style="margin-left:auto;">Click a point to jump to it in Steps. Hover for its date.</span>
        </div>
      </div>
      <aside id="ptl-fs-rail" style="width:320px; flex:none; background:var(--card); border-left:1px solid var(--border); display:flex; flex-direction:column; min-height:0;">
        <div style="flex:none; padding:12px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:9px;">
          <h2 style="font-size:0.95rem; font-weight:800; margin:0; flex:1 1 auto; color:var(--text);">Flags</h2>
          <span style="font-size:0.7rem; font-weight:700; padding:2px 8px; border-radius:10px; background:#e84545; color:#fff;">${overdueCount}</span>
        </div>
        <div id="ptl-fs-rail-body" style="flex:1 1 auto; overflow-y:auto; padding:12px 14px 20px;"></div>
      </aside>
    </div>`;

  ptlUpdateFsFlagsToggleBtn();
  ptlRenderFsRailBody(flags);
  document.getElementById("ptl-fs-rail").style.display = ptlFsRailOpen ? "flex" : "none";
  ptlCanvasContainerId = "ptl-fs-scroller";
  ptlRenderCanvas("ptl-fs-scroller");
}

// Compact hover card — same shape as the design-exploration prototype's
// #tip: title, then Owner/Planned/Target/Actual rows, plus a lateness
// line when it applies.
function ptlTipHtml(info) {
  const row = (k, v) => `<div style="display:flex; justify-content:space-between; gap:14px; font-size:0.74rem; color:var(--muted); font-family:ui-monospace,SFMono-Regular,Menlo,monospace;"><span>${k}</span><span style="color:var(--text);">${escapeHtml(v)}</span></div>`;
  let h = `<b style="display:block; font-size:0.82rem; font-weight:700; margin-bottom:6px;">${escapeHtml(info.label)}</b>`;
  h += row("Department", info.owner || "—");
  h += row("Planned", info.planned ? ptlFmt(info.planned) : "—");
  h += row("New Target", info.eff ? ptlFmt(info.eff) : "—");
  h += row("Actual", info.actual ? ptlFmt(info.actual) : "—");
  if (info.late) h += `<div style="margin-top:5px; font-size:0.74rem; font-weight:700; color:#e84545;">${info.late} business day${info.late === 1 ? "" : "s"} late</div>`;
  return h;
}

function ptlWireCanvasInteractions(sc, clickMap) {
  if (!sc) return;
  let tip = document.getElementById("ptl-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "ptl-tip";
    tip.style.cssText = "position:fixed; z-index:9500; pointer-events:none; opacity:0; transition:opacity .1s linear; background:var(--card); border:1px solid var(--border); border-radius:6px; padding:9px 11px; max-width:250px; box-shadow:0 6px 20px -6px rgba(0,0,0,.28);";
    document.body.appendChild(tip);
  }
  sc.querySelectorAll(".ptl-hit").forEach(el => {
    el.style.cursor = "pointer";
    el.addEventListener("mouseenter", () => {
      const info = clickMap[+el.dataset.idx];
      if (info) tip.innerHTML = ptlTipHtml(info);
      tip.style.opacity = "1";
    });
    el.addEventListener("mousemove", (e) => { tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY + 14) + "px"; });
    el.addEventListener("mouseleave", () => { tip.style.opacity = "0"; });
    el.addEventListener("click", () => ptlSetViewMode("steps", el.dataset.anchor));
  });
  let down = false, sx = 0, sl = 0;
  sc.addEventListener("mousedown", e => { if (e.target.closest(".ptl-hit")) return; down = true; sx = e.pageX; sl = sc.scrollLeft; sc.style.cursor = "grabbing"; });
  addEventListener("mouseup", () => { down = false; sc.style.cursor = "grab"; });
  addEventListener("mousemove", e => { if (down) sc.scrollLeft = sl - (e.pageX - sx); });
}

async function ptlMarkMilestoneDone(nodeId) {
  const milestoneKey = PTL_MILESTONE_KEY[nodeId];
  if (!milestoneKey || !ptlData) return;
  const projectId = ptlData.project.projectId;
  try {
    const asOfDate = ptlReadAsOf(nodeId);
    const data = await apFetch({ action: "saveTimelineManualMilestone", operatorName: appActiveOperatorIdentityString, projectId, milestoneKey, asOfDate });
    if (!data.success) { alert(data.error || "Could not mark this done."); return; }
    const node = ptlData.trunk.find(n => n.id === nodeId);
    if (node) node.actual = data.actualDate;
    ptlRender();
  } catch (e) {
    alert("Network error: " + e.message);
  }
}
