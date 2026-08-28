// project/project-timeline.js — Project Timeline Tracking (Project
// department, after Manufacturing Clearance). Stages 1-3 render as a
// plain list (single line, nothing to branch — the SVG schematic from
// the design exploration earns its keep starting at Stage 4, which has
// real product lanes). Stage 4 is a real read/write surface: submit an
// initial plan once per BOQ, then revise target dates and tick
// non-terminal steps as work happens; the terminal "Packing and Adding
// to FG" step is derived automatically, never a button here. Stage 5
// (QA/dispatch) still has no table — routes/timeline.js's mfcComplete
// flag (not a guess made here) is what the placeholder is keyed on.
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
  store: '#0369a1', purchase: '#7c3aed',
};
const PTL_DEPT_NAME = { marketing: 'Marketing', project: 'Project', design: 'Design', store: 'Store', purchase: 'Purchase' };

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

  if (!mfcComplete) {
    body.innerHTML = header + `
      <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:var(--radius); padding:14px; font-size:0.85rem; color:#92400e;">
        Stage 3 onward unlocks once Manufacturing Clearance sets this project's Internal MFC date — nothing has been cleared yet, so only Stages 1-2 are shown below.
      </div>
      <div style="margin-top:16px;">${ptlRenderList(trunk.filter(n => n.stage <= 2), today)}</div>`;
    return;
  }

  body.innerHTML = header + ptlRenderList(trunk, today)
    + ptlRenderLanes(ptlData.lanes || [])
    + `<div style="margin-top:18px; background:var(--highlight-bg); border:1px dashed var(--border); border-radius:var(--radius); padding:14px; font-size:0.82rem; color:var(--muted);">
        Stage 5 (Inspection &amp; Dispatch) is not built yet — it lands with its own screen once Stage 4 has run for a while.
      </div>`;
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
  const nonTerminal = lane.steps.filter(s => !s.terminal);
  return `
    <div style="font-size:0.82rem; color:var(--muted); margin-bottom:10px;">
      No plan submitted yet. ${escapeHtml(lane.ownerDept)} Production enters a planned date for every step below, all at once — Material Issue Tickets for this product's Job Cards stay blocked until then.
    </div>
    <div style="display:flex; flex-direction:column; gap:7px;">
      ${nonTerminal.map(s => `
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
      rightCell = `<span style="font-size:0.72rem; font-family:monospace; font-weight:700; color:${c}; background:${c}22; padding:2px 8px; border-radius:10px;">${escapeHtml(s.chip || '')}</span>`;
    } else if (done) {
      rightCell = `<span style="font-size:0.78rem; color:${c}; font-weight:700;">Done ${ptlFmt(s.actual)}</span>`;
    } else {
      rightCell = `
        <input type="date" value="${s.target || ''}" onchange="ptlUpdateTarget('${lane.boqId}','${s.id}', this.value)"
          style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem;" />
        <button class="nav-btn-styled" style="padding:4px 10px; font-size:0.74rem;" onclick="ptlMarkStepDone('${lane.boqId}','${s.id}')">Mark Done</button>`;
    }
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid #f1f5f9; flex-wrap:wrap;">
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
  for (const s of lane.steps.filter(x => !x.terminal)) {
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
      <div style="display:flex; align-items:flex-start; gap:12px; padding:10px 4px; border-bottom:1px solid var(--border);">
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
          ${n.kind === 'manual' && !n.actual ? `<div style="margin-top:7px;"><button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlMarkMilestoneDone('${n.id}')">Mark Done</button></div>` : ''}
        </div>
      </div>`;
  }).join("") + `</div>`;
}

const PTL_MILESTONE_KEY = { costing: 'costing_released', wdesign: 'working_designs_released' };

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
