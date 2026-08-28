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
const PTL_QA_CHAIN = new Set(['customer_inspection', 'inspection_clearance_note', 'dispatch_clearance', 'dispatched']);

let ptlProjects = [];
let ptlData = null;
let ptlSelected = null;

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
        <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(project.companyName || '—')} · <strong>${escapeHtml(project.status)}</strong>${project.mfcInt ? ` · Internal MFC <strong>${ptlFmtFull(project.mfcInt)}</strong>` : ''}</div>
      </div>
    </div>`;

  const canvasSlot = `<div id="ptl-canvas-wrap" style="display:none; margin-bottom:18px; padding-bottom:16px; border-bottom:1px solid var(--border);"></div>`;

  if (!mfcComplete) {
    body.innerHTML = header + canvasSlot + `
      <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:var(--radius); padding:14px; font-size:0.85rem; color:#92400e;">
        Stage 3 onward unlocks once Manufacturing Clearance sets this project's Internal MFC date — nothing has been cleared yet, so only Stages 1-2 are shown below.
      </div>
      <div style="margin-top:16px;">${ptlRenderList(trunk.filter(n => n.stage <= 2), today)}</div>`;
    ptlRenderCanvas();
    return;
  }

  // prodPlan (Stage 3/4 boundary) renders before the lanes it summarizes;
  // inspCall + the QA chain (Stage 4/5 boundary onward) render after —
  // they depend on the lanes' own terminal-step dates.
  const preLanes = trunk.filter(n => n.stage <= 3 || n.id === 'prodPlan');
  const postLanes = trunk.filter(n => n.id === 'inspCall' || n.stage === 5);
  body.innerHTML = header + canvasSlot + ptlRenderList(preLanes, today)
    + ptlRenderLanes(ptlData.lanes || [])
    + `<div style="margin-top:20px; font-weight:800; font-size:0.95rem; color:var(--text); margin-bottom:4px;">Stage 5 — Inspection &amp; Dispatch</div>`
    + ptlRenderList(postLanes, today);
  ptlRenderCanvas();
}

/* ── Stage 4 — one card per in-scope BOQ. ─────────────────────────── */
const PTL_LANE_COLOR = { Reactor: '#b45309', Capacitor: '#047857', Panel: '#c2410c' };

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

function ptlRenderLane(lane) {
  const c = PTL_LANE_COLOR[lane.ownerDept] || 'var(--muted)';
  const doneCount = lane.steps.filter(s => !!s.actual).length;
  return `
    <div style="border:1px solid var(--border); border-radius:var(--radius); margin-bottom:14px; overflow:hidden;">
      <div style="padding:10px 14px; background:${c}14; border-left:4px solid ${c}; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div>
          <span style="font-weight:800; color:${c};">${escapeHtml(lane.name)}</span>
          <span style="color:var(--muted); font-size:0.82rem;"> — ${escapeHtml(lane.productName || '')} ${escapeHtml(lane.productRating || '')}</span>
          <span style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:${c}; margin-left:6px;">${escapeHtml(lane.ownerDept)} Production</span>
        </div>
        <span style="font-size:0.72rem; font-weight:700; font-family:monospace; color:${c};">${doneCount}/${lane.steps.length} steps done</span>
      </div>
      <div style="padding:12px 14px;">
        ${lane.planInitialized ? ptlRenderLaneSteps(lane, c) : ptlRenderLaneInitialPlanForm(lane)}
      </div>
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
      rightCell = `<span style="font-size:0.78rem; color:${c}; font-weight:700;">Done ${ptlFmt(s.actual)}</span>`;
    } else {
      rightCell = `
        <input type="date" value="${s.target || ''}" onchange="ptlUpdateTarget('${lane.boqId}','${s.id}', this.value)"
          style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem;" />
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
    const data = await apFetch({ action: "markProductPlanStepDone", operatorName: appActiveOperatorIdentityString, boqId, stepKey });
    if (!data.success) { alert(data.error || "Could not mark this step done."); return; }
    const lane = ptlData.lanes.find(l => l.boqId === boqId);
    const step = lane && lane.steps.find(s => s.id === stepKey);
    if (step) step.actual = data.actualDate;
    ptlRender();
  } catch (e) { alert("Network error: " + e.message); }
}

// A plain, honest list — the branching SVG schematic from the design
// exploration is Stage 4's job (it needs the product lanes to be worth
// drawing); Stages 1-3 are a single line, so a list reads better than a
// canvas here and ships without carrying that engine's full weight.
function ptlRenderList(nodes, today) {
  return `<div style="display:flex; flex-direction:column; gap:0;">` + nodes.map(n => {
    const c = PTL_COLORS[n.dept] || 'var(--muted)';
    const done = !!n.actual || n.done === true;
    const late = ptlLate(n);
    const eff = ptlEff(n);
    const dateTxt = n.actual ? ptlFmtFull(n.actual) : (n.done ? `On or before ${ptlFmtFull(eff)} (exact date not tracked)` : eff ? `Due ${ptlFmtFull(eff)}` : 'Not yet scheduled');
    const dotColor = late ? 'var(--warn)' : c;
    return `
      <div id="ptl-row-${n.id}" style="display:flex; align-items:flex-start; gap:12px; padding:10px 4px; border-bottom:1px solid var(--border); border-radius:4px;">
        <div style="flex:none; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center;
          background:${done ? dotColor : '#fff'}; border:2.5px solid ${dotColor}; margin-top:2px;">
          ${done ? '<span style="color:#fff; font-weight:900; font-size:0.85rem;">✓</span>' : ''}
        </div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;">
            <span style="font-weight:700; font-size:0.92rem; color:${late ? 'var(--warn)' : 'var(--text)'};">${escapeHtml(n.label)}</span>
            <span style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:${c};">${escapeHtml(PTL_DEPT_NAME[n.dept] || n.dept)}</span>
            ${n.kind === 'manual' ? '<span style="font-size:0.68rem; color:var(--muted);">· ticked by hand</span>' : ''}
          </div>
          <div style="font-size:0.8rem; color:${late ? 'var(--warn)' : 'var(--muted)'}; margin-top:2px;">${escapeHtml(dateTxt)}${late ? ` · ${Math.abs(ptlBdBetween(eff, today))} business days late` : ''}</div>
          ${n.chip ? `<span style="display:inline-block; margin-top:5px; font-size:0.72rem; font-family:monospace; font-weight:700; color:${c}; background:${c}22; padding:2px 8px; border-radius:10px;">${escapeHtml(n.chip)}</span>` : ''}
          ${n.kind === 'manual' && !n.actual && !PTL_QA_CHAIN.has(n.id) ? `<div style="margin-top:7px;"><button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlMarkMilestoneDone('${n.id}')">Mark Done</button></div>` : ''}
          ${PTL_QA_CHAIN.has(n.id) && !n.actual ? `
            <div style="margin-top:7px; display:flex; align-items:center; gap:8px;">
              <input type="date" id="ptl-qa-date-${n.id}" style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem;" />
              <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlSetQaMilestoneDate('${n.id}')">Set Date</button>
            </div>` : ''}
        </div>
      </div>`;
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
const PTL_FONT_SCALE = { week: 1.05, days15: 0.94, month: 0.86 };
let ptlMode = "days15", ptlDayW = 30, ptlFS = 0.94;
let ptlDays = [], ptlIndexMap = {};
const PTL_LANE_HEX = { Reactor: '#b45309', Capacitor: '#047857', Panel: '#c2410c' };
const PTL_TRUNK_HEX = { marketing: '#be185d', project: '#0056b3', design: '#00a878', store: '#0369a1', purchase: '#7c3aed', qa: '#dc2626' };

function ptlBuildDayRange() {
  const dates = [];
  (ptlData.trunk || []).forEach(n => { const e = ptlEff(n); if (e) dates.push(e); });
  (ptlData.lanes || []).forEach(l => l.steps.forEach(s => { const e = s.actual || s.target || s.planned; if (e) dates.push(e); }));
  dates.push(ptlToday());
  if (dates.length === 0) return false;
  dates.sort();
  const from = new Date(ptlParse(dates[0]).getTime() - 5 * PTL_DAYMS);
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
  const tailIds = ['inspCall', 'customer_inspection', 'inspection_clearance_note', 'dispatch_clearance', 'dispatched'];
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

function ptlPlacer() {
  const taken = [];
  const clear = b => !taken.some(p => b.x0 < p.x1 - 2 && p.x0 < b.x1 - 2 && b.y0 < p.y1 - 2 && p.y0 < b.y1 - 2);
  return {
    block: b => taken.push(b),
    place(mk) {
      for (let k = 0; k < 5; k++) { const b = mk(k); if (clear(b)) { taken.push(b); return k; } }
      taken.push(mk(4)); return 4;
    },
  };
}

function ptlRenderCanvas() {
  const wrap = document.getElementById("ptl-canvas-wrap");
  if (!wrap) return;
  if (!ptlBuildDayRange()) { wrap.style.display = "none"; return; }
  const { spine, tail, lanes } = ptlCanvasNodes();
  if (spine.length < 2) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";

  ptlFS = PTL_FONT_SCALE[ptlMode];
  const scroller = document.getElementById("ptl-scroller");
  const availW = Math.max(600, scroller ? scroller.clientWidth : 900);
  const longestName = Math.max(16, ...lanes.map(l => (l.name || '').length));
  const PAD_L = Math.round(56 + longestName * 5.3 * ptlFS);
  const PAD_R = 60;
  ptlDayW = Math.max(12, Math.min(280, (availW - PAD_L - PAD_R) / PTL_MODES[ptlMode]));

  const RULER_H = Math.round(36 * ptlFS);
  const SLOT_UP = 20 * ptlFS, SLOT_DN = 24 * ptlFS, LINE_H = 10.5 * ptlFS;
  const R = 6.5 * ptlFS;

  const laneCount = lanes.length;
  const topY = RULER_H + 56 * ptlFS;
  const gap = 82 * ptlFS;
  const laneYs = lanes.map((_, i) => topY + i * gap);
  const spineY = laneCount ? (laneYs[0] + laneYs[laneCount - 1]) / 2 : topY;
  const H = Math.max(200, (laneCount ? laneYs[laneCount - 1] : spineY) + 60 * ptlFS);

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
    return PAD_L + (i ?? 0) * ptlDayW;
  };
  const W = PAD_L + ptlDays.length * ptlDayW + PAD_R;
  const today = ptlToday();
  const todayX = xOf(today in ptlIndexMap ? today : ptlDays[ptlDays.length - 1]);

  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const P = [];

  // Ruler + week gridlines
  P.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="var(--bg,#f0f4f8)"/>`);
  ptlDays.forEach((d, i) => {
    if (ptlParse(d).getUTCDay() !== 1) return;
    const x = PAD_L + i * ptlDayW;
    P.push(`<line x1="${x}" y1="${RULER_H}" x2="${x}" y2="${H}" stroke="var(--border)" stroke-width="1" opacity=".5"/>`);
  });
  P.push(`<rect x="0" y="0" width="${W}" height="${RULER_H}" fill="var(--card)"/>`);
  P.push(`<line x1="0" y1="${RULER_H}" x2="${W}" y2="${RULER_H}" stroke="var(--border)" stroke-width="1.5"/>`);
  let lastM = -1;
  ptlDays.forEach((d, i) => {
    const x = PAD_L + i * ptlDayW, dt = ptlParse(d), m = dt.getUTCMonth(), mon = dt.getUTCDay() === 1;
    if (m !== lastM) { lastM = m; P.push(`<text x="${x}" y="${11 * ptlFS}" font-size="${9.5 * ptlFS}" font-weight="800" letter-spacing="1" fill="var(--muted)">${PTL_MON[m].toUpperCase()}</text>`); }
    if (ptlDayW >= 20 || mon) P.push(`<text x="${x}" y="${RULER_H - 9 * ptlFS}" text-anchor="middle" font-size="${9 * ptlFS}" font-family="monospace" font-weight="${mon ? 700 : 400}" fill="${mon ? 'var(--text)' : 'var(--muted)'}">${dt.getUTCDate()}</text>`);
  });

  // Today
  P.push(`<line x1="${todayX}" y1="${RULER_H}" x2="${todayX}" y2="${H}" stroke="var(--brand)" stroke-width="2" opacity=".8"/>`);

  // Traces: spine (split at prodPlan into lanes, rejoin at tail[0])
  const pos = {};
  spine.forEach(n => { pos[n.id] = { x: xOf(ptlEff(n)), y: spineY }; });
  tail.forEach(n => { pos[n.id] = { x: xOf(ptlEff(n)), y: spineY }; });
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
      const stepPts = l.steps.map(s => ({ x: xOf(s.actual || s.target || s.planned), y }));
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
  lanes.forEach((l, i) => l.steps.forEach(s => laid.push({ n: { ...s, dept: l.ownerDept === 'Reactor' ? 'lane_r' : l.ownerDept === 'Capacitor' ? 'lane_c' : 'lane_p' }, x: xOf(s.actual || s.target || s.planned), y: laneYs[i], laneColor: PTL_LANE_HEX[l.ownerDept], boqId: l.boqId })));
  laid.sort((a, b) => a.x - b.x);

  const PL = ptlPlacer();
  laid.forEach(({ x, y }) => PL.block({ x0: x - R * 1.4, x1: x + R * 1.4, y0: y - R * 1.4, y1: y + R * 1.4 }));

  const clickMap = [];
  laid.forEach(({ n, x, y, laneColor, boqId }) => {
    const c = laneColor || PTL_TRUNK_HEX[n.dept] || 'var(--muted)';
    const eff = n.actual || n.target || n.planned;
    const done = !!n.actual || n.done === true;
    const late = !done && eff && eff < today;
    const ring = late ? '#e84545' : c;
    P.push(`<circle cx="${x}" cy="${y}" r="${R}" fill="${done ? c : 'var(--card)'}" stroke="${ring}" stroke-width="${late ? 2.6 : 2}"/>`);
    if (done) P.push(`<path d="M${x - R * 0.4} ${y} l${R * 0.3} ${R * 0.32} l${R * 0.55} -${R * 0.6}" fill="none" stroke="var(--card)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`);

    const lines = ptlWrapLbl(n.label, 15);
    const lw = Math.max(...lines.map(ptlWLbl));
    const kU = PL.place(k => { const b = y - R - 10 * ptlFS - k * (SLOT_UP + LINE_H); return { x0: x - lw / 2, x1: x + lw / 2, y0: b - (lines.length - 1) * LINE_H - 8, y1: b + 3 }; });
    const base = y - R - 10 * ptlFS - kU * (SLOT_UP + LINE_H);
    lines.forEach((ln, i) => P.push(`<text x="${x}" y="${base - (lines.length - 1 - i) * LINE_H}" text-anchor="middle" font-size="${9.5 * ptlFS}" font-weight="600" fill="${late ? '#e84545' : 'var(--text)'}" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="3">${esc(ln)}</text>`));

    const dtx = ptlFmt(eff);
    const bw = ptlWMono(dtx, 9);
    const kD = PL.place(k => { const d = y + R + 10 * ptlFS + k * SLOT_DN; return { x0: x - bw / 2, x1: x + bw / 2, y0: d - 8, y1: d + 3 }; });
    const dy = y + R + 10 * ptlFS + kD * SLOT_DN;
    P.push(`<text x="${x}" y="${dy}" text-anchor="middle" font-size="${8.5 * ptlFS}" font-family="monospace" fill="${late ? '#e84545' : 'var(--muted)'}" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="3">${esc(dtx)}</text>`);

    const anchorId = boqId ? `ptl-step-${boqId}-${n.id}` : `ptl-row-${n.id}`;
    clickMap.push({ x, y, id: anchorId, label: n.label, dept: boqId ? null : (PTL_DEPT_NAME[n.dept] || n.dept), date: dtx });
    P.push(`<circle cx="${x}" cy="${y}" r="${R * 2}" fill="transparent" class="ptl-hit" data-anchor="${anchorId}" data-tip="${esc(n.label)} — ${esc(dtx)}"/>`);
  });

  // Gutter (sticky lane labels)
  if (laneCount) {
    const G = [`<g id="ptl-gutter">`, `<rect x="0" y="${RULER_H}" width="${PAD_L - 10}" height="${H - RULER_H}" fill="var(--bg,#f0f4f8)"/>`, `<line x1="${PAD_L - 10}" y1="${RULER_H}" x2="${PAD_L - 10}" y2="${H}" stroke="var(--border)" stroke-width="1"/>`];
    lanes.forEach((l, i) => {
      const c = PTL_LANE_HEX[l.ownerDept] || 'var(--muted)', y = laneYs[i];
      G.push(`<rect x="10" y="${y - 3}" width="4" height="${20 * ptlFS}" rx="2" fill="${c}"/>`);
      G.push(`<text x="20" y="${y + 5}" font-size="${10.5 * ptlFS}" font-weight="800" fill="${c}">${esc(l.name)}</text>`);
    });
    G.push(`</g>`);
    P.push(G.join(""));
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block;">${P.join("")}</svg>`;
  wrap.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
      <div style="font-weight:800; font-size:0.85rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">Timeline Overview</div>
      <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;">
        ${Object.keys(PTL_MODES).map(m => `<button type="button" onclick="ptlSetMode('${m}')" style="padding:5px 10px; font-size:0.76rem; border:0; border-right:1px solid var(--border); cursor:pointer; background:${m === ptlMode ? 'var(--brand)' : '#fff'}; color:${m === ptlMode ? '#fff' : 'var(--muted)'};">${m === 'week' ? 'This Week' : m === 'days15' ? '15 Days' : 'This Month'}</button>`).join("")}
      </div>
    </div>
    <div id="ptl-scroller" style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius); cursor:grab;">${svg}</div>
    <div style="font-size:0.72rem; color:var(--muted); margin-top:5px;">Click a point to jump to it below. Hover for its date.</div>`;

  ptlWireCanvasInteractions(clickMap);

  // Land the horizontal scroll on today.
  const sc = document.getElementById("ptl-scroller");
  if (sc) sc.scrollLeft = Math.max(0, todayX - sc.clientWidth / 2);
}

function ptlSetMode(m) { ptlMode = m; ptlRenderCanvas(); }

function ptlWireCanvasInteractions(clickMap) {
  const sc = document.getElementById("ptl-scroller");
  if (!sc) return;
  let tip = document.getElementById("ptl-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "ptl-tip";
    tip.style.cssText = "position:fixed; z-index:200; pointer-events:none; opacity:0; transition:opacity .1s; background:var(--card); border:1px solid var(--border); border-radius:6px; padding:6px 9px; font-size:0.76rem; box-shadow:0 6px 16px rgba(0,0,0,0.15);";
    document.body.appendChild(tip);
  }
  sc.querySelectorAll(".ptl-hit").forEach(el => {
    el.style.cursor = "pointer";
    el.addEventListener("mouseenter", (e) => {
      tip.textContent = el.dataset.tip; tip.style.opacity = "1";
    });
    el.addEventListener("mousemove", (e) => { tip.style.left = (e.clientX + 12) + "px"; tip.style.top = (e.clientY + 12) + "px"; });
    el.addEventListener("mouseleave", () => { tip.style.opacity = "0"; });
    el.addEventListener("click", () => {
      const target = document.getElementById(el.dataset.anchor);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.style.transition = "background .2s";
        target.style.background = "var(--highlight-bg)";
        setTimeout(() => { target.style.background = ""; }, 1200);
      }
    });
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
    const data = await apFetch({ action: "saveTimelineManualMilestone", operatorName: appActiveOperatorIdentityString, projectId, milestoneKey });
    if (!data.success) { alert(data.error || "Could not mark this done."); return; }
    const node = ptlData.trunk.find(n => n.id === nodeId);
    if (node) node.actual = data.actualDate;
    ptlRender();
  } catch (e) {
    alert("Network error: " + e.message);
  }
}
