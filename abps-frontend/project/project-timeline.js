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
  store: '#0369a1', purchase: '#7c3aed', qa: '#dc2626', production: '#b45309',
};
const PTL_DEPT_NAME = { marketing: 'Marketing', project: 'Project', design: 'Design', store: 'Store', purchase: 'Purchase', qa: 'Quality Assurance', production: 'Production' };
// Shared completion-status circle color, used identically by the canvas
// map and the Steps list (30 Aug 2026) — department no longer drives
// circle color anywhere; grey = scheduled/on-track, green = done, red =
// late is the only meaning a circle's color carries now.
const PTL_SCHEDULED_GREY = '#94a3b8';
// Per-lane (per-PRODUCT, not per-department — two products under the same
// Reactor/Capacitor/Panel department get different colors here) trace
// line color, so multiple products running in parallel through Stage 4
// are visually distinguishable. Deliberately excludes red/reddish/green/
// blue/black (reserved: red=late, green=TODAY line/done-state, blue=
// brand/spine, black=text) — cycles if there are ever more lanes than
// colors. Node circles stay the shared green/grey/red completion scheme
// regardless of lane; only the connecting line (and its gutter label)
// carries this color.
const PTL_LANE_TRACE_PALETTE = ['#7c3aed', '#0d9488', '#be185d', '#92400e', '#c026d3', '#c2410c'];
const ptlLaneTraceColor = (i) => PTL_LANE_TRACE_PALETTE[i % PTL_LANE_TRACE_PALETTE.length];
// Dispatch is no longer part of this chain — it's Store's, derived
// automatically from when the Final Project Invoice was generated (see
// routes/timeline.js), never a hand-entered date.
const PTL_QA_CHAIN = new Set(['customer_inspection', 'inspection_clearance_note', 'dispatch_clearance']);
// Stage 2's two "system" trunk nodes have no dedicated owning department
// (activated_at flips when a project leaves Inactive; date_of_internal_mfc
// is set once by Manufacturing Clearance) — admin-only test backdate via
// adminBackdateSystemDate, same resolveAdminBackdate gate as everything
// else on this screen.
const PTL_ADMIN_SYSTEM_DATE_IDS = new Set(['activated', 'mfcInt']);
// Stage 3's four "system" trunk nodes are normally computed live off real
// BOQ/PRN/PO/PPS rows, so — unlike Stage 2's two above — there's no
// column to backdate. adminOverrideSystemMilestone writes a testing-only
// actual_date into the same project.timeline_milestones row Stage 3's
// planned dates already live in; fetchProjectTimeline prefers it over the
// live computation. adminClearSystemMilestoneOverride removes it again
// once real data should take back over.
const PTL_ADMIN_MILESTONE_OVERRIDE_KEY = { boqs: 'boqs_released', prns: 'prns_released', mrdates: 'production_requirement_dates_released', rmpos: 'rmpos_released', pps: 'pps_released', wdesign: 'working_designs_released' };
// Stage 3 re-baseline (1 Sep 2026, migration 161) — planned_date freezes
// forever at first Internal MFC (that's the whole point — slippage stays
// measurable against the ORIGINAL commitment), but when the original plan
// itself turns out wrong there was no way to correct it. This writes
// timeline_milestones.target_date via reviseTimelineMilestoneTarget
// (routes/timeline.js), audited into timeline_milestone_target_history.
// Gated server-side to Project department or admin — shown to everyone
// with perm_project_timeline here, same as saveTimelineManualMilestone's
// own department check, so a non-Project user just sees the server's
// rejection message rather than the button being hidden client-side.
const PTL_STAGE3_MILESTONE_KEY = { ...PTL_ADMIN_MILESTONE_OVERRIDE_KEY, prodPlan: 'production_planning_released' };
// Stage headers — ptlRenderList inserts one automatically whenever a
// node's stage differs from the previous one, so Stage 1/2/3 get the same
// section labeling Stage 4/5 already had (those two used to be hardcoded
// separately by the caller; now folded into the same mechanism).
const PTL_STAGE_LABEL = { 1: 'Order Acceptance', 2: 'Approvals', 3: 'Pre Production', 4: 'Production', 5: 'Inspection & Dispatch' };

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
    <div style="display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; margin-bottom:14px;">
      <div style="position:relative; flex:1 1 320px;">
        <label class="field-label" style="margin-top:0;">Project ID or Customer Name *</label>
        <input type="text" id="ptl-project-input" placeholder="Type Project ID or Customer Name..." autocomplete="off"
          oninput="handlePtlProjectInput(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();}"
          style="width:100%; padding:9px; border:1.5px solid var(--border); border-radius:var(--radius);" />
        <div id="ptl-project-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; background:#fff; border:1.5px solid var(--brand); border-top:none; border-radius:0 0 4px 4px; max-height:260px; overflow-y:auto; z-index:200; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
      </div>
      <button type="button" onclick="ptlOpenLdBoard()" style="padding:9px 16px; font-size:0.85rem; font-weight:700; border:1.5px solid #b45309; border-radius:var(--radius); background:#fffbeb; color:#92400e; cursor:pointer;">₹ LD Exposure Board</button>
    </div>
    <div id="ptl-feedback" style="display:none; padding:12px; border-radius:var(--radius); margin-bottom:14px; border-left:4px solid;"></div>
    <div id="ptl-body"></div>
  `;
  document.getElementById("ptl-project-input").value = "";
  document.getElementById("ptl-body").innerHTML = "";
  const elHeaderLeft0 = document.getElementById("ptl-header-left");
  if (elHeaderLeft0) elHeaderLeft0.innerHTML = "";
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

// Holidays (31 Aug 2026) — fetched once per page load and cached module-wide
// (admin_db.holidays has no admin UI, changes are rare direct-SQL edits, so
// there's no need to re-fetch per project the way ptlData itself is).
// Display-only: marks a Sunday/holiday's date in green on the canvas axis
// and improves ptlBdBetween's own estimate — every REAL business-day
// freeze/calculation still happens server-side via lib/businessDays.js,
// unchanged either way.
let ptlHolidaySet = new Set();
let ptlHolidaysLoaded = false;
async function ptlEnsureHolidaysLoaded() {
  if (ptlHolidaysLoaded) return;
  ptlHolidaysLoaded = true; // set first — a failed fetch shouldn't retry on every render
  try {
    const data = await apFetch({ action: "fetchTimelineHolidays" });
    if (data.success) {
      ptlHolidaySet = new Set(data.holidays || []);
      // The canvas's first paint likely already happened before this
      // resolved (fired in parallel with the timeline fetch, not awaited)
      // — re-render once so holiday shading isn't missing until the next
      // unrelated interaction. Cheap: ptlRender() is already the standard
      // re-render call used throughout this file.
      if (ptlData && typeof ptlRender === 'function') ptlRender();
    }
  } catch (e) { /* non-critical — canvas still works, just without holiday shading */ }
}
function ptlDayIsRest(dateStr) {
  return ptlParse(dateStr).getUTCDay() === 0 || ptlHolidaySet.has(dateStr);
}

async function selectPtlProject(projectId) {
  document.getElementById("ptl-project-input").value = projectId;
  document.getElementById("ptl-project-dropdown").style.display = "none";
  const body = document.getElementById("ptl-body");
  body.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Loading timeline...</div>`;
  const fb = document.getElementById("ptl-feedback");
  fb.style.display = "none";
  ptlEnsureHolidaysLoaded(); // fire-and-forget, in parallel with the timeline fetch below
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
    // Holidays are now fetched client-side (ptlHolidaySet, 31 Aug 2026) so
    // this can skip them too, not just Sundays — still just a DISPLAY
    // estimate, the server (lib/businessDays.js) is authoritative for any
    // real freezing/calculation.
    if (!ptlDayIsRest(ptlIso(d))) count += dir;
  }
  return count;
}
const PTL_MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ptlFmt = s => { if (!s) return "—"; const d = ptlParse(s); return d.getUTCDate() + " " + PTL_MON[d.getUTCMonth()]; };
const ptlFmtFull = s => { if (!s) return "—"; const d = ptlParse(s); return d.getUTCDate() + " " + PTL_MON[d.getUTCMonth()] + " " + d.getUTCFullYear(); };

// Admin-only test override for "today" — every late/overdue flag, the
// canvas's TODAY marker, and the flags rail all key off ptlToday(), so
// overriding it here is enough to test a whole multi-week scenario
// (backdated milestones + a moved "today") without waiting out real
// calendar days. Client-side only (localStorage), never sent to the
// server — every real write still stamps the server's own CURRENT_DATE
// unless explicitly backdated via resolveAdminBackdate. Non-admins never
// see the control and always get the real date.
const PTL_TODAY_OVERRIDE_KEY = "ptlTodayOverride";
function ptlToday() {
  const override = ptlIsAdmin() ? localStorage.getItem(PTL_TODAY_OVERRIDE_KEY) : null;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  // Server timezone is Asia/Kolkata (db.js) — match it here so "today"
  // agrees with what the backend just froze/derived, rather than the
  // viewer's own local clock.
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}
function ptlSetTodayOverride(value) {
  if (value) localStorage.setItem(PTL_TODAY_OVERRIDE_KEY, value);
  else localStorage.removeItem(PTL_TODAY_OVERRIDE_KEY);
  ptlRender();
  if (document.getElementById("ptl-fs-overlay")?.style.display !== "none") ptlRenderFullscreen();
}

// Same convention as Manufacturing Clearance's wrapper header: Tentative
// (projects.delivery_date, from the customer PO) until Internal MFC is
// given, then Expected (projects.mfc_actual_delivery_date, a gating field
// entered at clearance time — column is named "actual" in the schema,
// but it's never a record of an already-happened delivery, so the
// screen calls it Expected everywhere, not Actual).
// mfc_actual_delivery_date (Expected Delivery Date) is one of the
// Manufacturing Clearance gating fields — it's entered before Internal MFC
// itself is ever given, so this switches the moment THAT value exists,
// not on mfcInt (which can lag it by however long clearance takes).
const ptlDeliveryLabel = p => p.actualDelivery ? "Expected Delivery" : "Tentative Delivery";
const ptlDeliveryValue = p => p.actualDelivery || p.tentativeDelivery;

const ptlEff = n => n.actual || n.target || n.planned;
const ptlLate = n => !n.actual && !n.done && ptlEff(n) && ptlEff(n) < ptlToday();

// Per-stage fractions — used for the "Stage N of 5" label, the segmented
// strip's per-block fill, and the late/on-time color. Stage 4 averages
// each BOQ LANE rather than pooling every lane's steps together, since a
// Reactor flow and a Panel flow don't have the same step count
// (lib/productionFlows.js) — pooling would let whichever flow type has
// more BOQs/steps on this project dominate Stage 4's own fraction.
function ptlComputeStageFractions() {
  const { trunk, lanes } = ptlData;
  return [1, 2, 3, 4, 5].map(k => {
    if (k === 4) {
      const laneFracs = (lanes || []).map(l => {
        const total = l.steps.length;
        const done = l.steps.filter(n => !!n.actual || n.done === true).length;
        return { total, done, frac: total ? done / total : 0, late: l.steps.some(n => ptlLate(n)) };
      });
      const total = laneFracs.reduce((a, l) => a + l.total, 0);
      const done = laneFracs.reduce((a, l) => a + l.done, 0);
      const frac = laneFracs.length ? laneFracs.reduce((a, l) => a + l.frac, 0) / laneFracs.length : 0;
      return { stage: k, total, done, frac, late: laneFracs.some(l => l.late) };
    }
    const nodes = (trunk || []).filter(n => n.stage === k);
    const total = nodes.length;
    const done = nodes.filter(n => !!n.actual || n.done === true).length;
    const late = nodes.some(n => ptlLate(n));
    return { stage: k, total, done, frac: total ? done / total : 0, late };
  });
}

// Overall progress % — schedule-weighted, not a flat stage/milestone
// count. Equal-weighting the 5 stages (the earlier version of this)
// looked wrong in practice: 2 of 5 stages fully done read as "40%" even
// though Stages 1-2 (a couple of weeks) are nowhere near as much real
// project time as Stages 3-5 (which run for months). Instead, every
// trunk/lane node's own EFFECTIVE date (ptlEff — actual once done, else
// its current target/planned estimate) is plotted on one timeline, and
// each node is credited with the business-day GAP since the previous
// dated node — so a milestone representing 6 weeks of work counts for
// far more than one immediately next to another. Nodes with no date yet
// (e.g. Stage 5's QA milestones before anything's scheduled, or Stage 4
// steps before a plan is submitted) simply don't exist as separate
// points yet; that time is not lost, it's absorbed into the gap leading
// up to the next node that DOES have a date — which, worst case, is
// trunk's 'delivery' node (always known — the PO's own delivery date,
// or the MFC-set one once that happens), so an early-stage project
// correctly shows only a small sliver of a still-mostly-open timeline
// rather than jumping ahead just because a couple of quick early stages
// are checked off. Nodes sharing the exact same date (several Stage 3
// milestones often land on the same planned day) split that shared
// gap's credit by how many of that same-day cluster are actually done.
function ptlComputeScheduleWeightedPct() {
  const { trunk, lanes } = ptlData;
  const dated = [];
  (trunk || []).forEach(n => { const d = ptlEff(n); if (d) dated.push({ date: d, done: !!n.actual || n.done === true }); });
  (lanes || []).forEach(l => l.steps.forEach(s => { const d = ptlEff(s); if (d) dated.push({ date: d, done: !!s.actual || s.done === true }); }));
  if (dated.length < 2) return 0;

  // Floor at the earliest node that's actually DONE — a planned/target/
  // tentative estimate dated earlier than the project's own first real
  // milestone is bad data (e.g. a delivery date typo'd a year early), and
  // without this guard it sorts to the very front of the timeline; the
  // whole gap up to the next done milestone then gets credited as "done"
  // purely because it's chronologically ahead of that (wrong) date —
  // this is what produced 96% on a brand-new project with nothing past
  // Order Acceptance/PO Upload done. Any node dated before that floor is
  // dropped from the weighting entirely rather than trusted.
  const earliestDoneDate = dated.filter(d => d.done).map(d => d.date).sort()[0];
  const scoped = earliestDoneDate ? dated.filter(d => d.date >= earliestDoneDate) : dated;
  if (scoped.length < 2) return 0;
  scoped.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  // Group same-date entries into clusters so a tied gap's weight splits
  // by the cluster's own done-fraction instead of being all-or-nothing
  // on whichever tied node happened to sort first/last.
  const clusters = [];
  scoped.forEach(n => {
    const last = clusters[clusters.length - 1];
    if (last && last.date === n.date) last.nodes.push(n); else clusters.push({ date: n.date, nodes: [n] });
  });

  let totalW = 0, doneW = 0;
  for (let i = 1; i < clusters.length; i++) {
    const w = Math.max(0, ptlBdBetween(clusters[i - 1].date, clusters[i].date) || 0);
    const cluster = clusters[i].nodes;
    const doneFrac = cluster.filter(n => n.done).length / cluster.length;
    totalW += w;
    doneW += w * doneFrac;
  }
  return totalW ? Math.round((doneW / totalW) * 100) : (clusters[0].nodes.every(n => n.done) ? 100 : 0);
}

function ptlComputeStageProgress() {
  if (!ptlData) return null;
  const stages = ptlComputeStageFractions();
  const overallPct = ptlComputeScheduleWeightedPct();
  return { stages, overallPct };
}

function ptlProgressStageInfo(p) {
  const currentStage = p.stages.find(s => s.frac > 0 && s.frac < 1) || p.stages.find(s => s.frac === 0) || p.stages[p.stages.length - 1];
  const stageIdx = p.stages.filter(s => s.frac >= 1).length + (p.stages.some(s => s.frac > 0 && s.frac < 1) ? 1 : 0);
  const late = !!(currentStage && currentStage.late);
  return { stageIdx, late, color: late ? '#e84545' : 'var(--brand)' };
}

// Fullscreen Timeline header — the ring. A single continuous shape reads
// well at the larger size this header has room for.
function ptlStageProgressHtml() {
  const p = ptlComputeStageProgress();
  if (!p) return '';
  const { stageIdx, color } = ptlProgressStageInfo(p);
  const d = 58, sw = 5;
  const r = (d - sw) / 2, cx = d / 2, cy = d / 2, circ = 2 * Math.PI * r;
  const offset = circ * (1 - p.overallPct / 100);
  const title = `Stage ${stageIdx} of 5 · ${p.overallPct}% milestones done`;
  const ring = `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}" style="display:block; flex:none; transform:rotate(-90deg);">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
  </svg>`;
  return `<div style="position:relative; width:${d}px; height:${d}px; flex:none;" title="${title}">
    ${ring}
    <span style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.85rem; font-weight:800; color:var(--text); line-height:1;">${p.overallPct}%</span>
  </div>`;
}

// Steps header (compact, inline next to Today override) — a 5-segment
// strip instead of the ring, one block per Stage 1-5, so it stays legible
// at a small inline size and doubles as a "which stage am I in" glance
// rather than needing the ring's more precise arc-reading.
function ptlStageProgressStripHtml() {
  const p = ptlComputeStageProgress();
  if (!p) return '';
  const { stageIdx, color } = ptlProgressStageInfo(p);
  const w = 22, h = 14, gap = 4;
  const blocks = p.stages.map(s => {
    const complete = s.total > 0 && s.frac >= 1;
    const started = s.frac > 0 && !complete;
    const c = s.late ? '#e84545' : 'var(--brand)';
    let inner;
    if (complete) inner = `<rect x="0" y="0" width="${w}" height="${h}" rx="3" fill="${c}"/>`;
    else if (started) inner = `<rect x="0" y="0" width="${w}" height="${h}" rx="3" fill="none" stroke="${c}" stroke-width="1.6" opacity=".5"/><rect x="0" y="0" width="${Math.max(3, w * s.frac)}" height="${h}" rx="3" fill="${c}"/>`;
    else inner = `<rect x="0" y="0" width="${w}" height="${h}" rx="3" fill="none" stroke="var(--border)" stroke-width="1.6"/>`;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block; flex:none;">${inner}</svg>`;
  }).join(`<div style="width:${gap}px;"></div>`);
  const title = `Stage ${stageIdx} of 5 · ${p.overallPct}% milestones done`;
  return `<div style="display:flex; align-items:center; gap:10px;" title="${title}">
    <div style="display:flex; align-items:center;">${blocks}</div>
    <span style="font-size:0.88rem; font-weight:800; color:${color};">${p.overallPct}%</span>
  </div>`;
}

function ptlRender() {
  const body = document.getElementById("ptl-body");
  const { project, mfcComplete, trunk } = ptlData;
  const today = ptlToday();

  const header = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:800; font-size:1.05rem; color:var(--text);">${escapeHtml(project.projectId)}</div>
        <div style="font-size:0.82rem; color:var(--muted);">${escapeHtml(project.companyName || '—')} · <strong>${escapeHtml(project.status)}</strong> · ${ptlDeliveryLabel(project)} <strong>${ptlFmtFull(ptlDeliveryValue(project))}</strong></div>
        ${ptlLdSummaryHtml()}
      </div>
      <div style="display:flex; align-items:center; gap:14px;">
        ${ptlIsAdmin() ? `<div style="display:flex; align-items:center; gap:6px;" title="Admin only — overrides 'today' everywhere on this screen for testing">
          <span style="font-size:0.72rem; font-weight:700; color:#b45309;">Today override:</span>
          <input type="date" value="${localStorage.getItem(PTL_TODAY_OVERRIDE_KEY) || ''}" onchange="ptlSetTodayOverride(this.value)" style="padding:5px; border:1.5px dashed #f59e0b; border-radius:4px; font-size:0.78rem;" />
          ${localStorage.getItem(PTL_TODAY_OVERRIDE_KEY) ? `<button type="button" onclick="ptlSetTodayOverride('')" style="padding:5px 10px; font-size:0.72rem; font-weight:700; border:1px solid var(--border); border-radius:4px; background:#fff; color:var(--muted); cursor:pointer;">Reset</button>` : ''}
        </div>` : ''}
        ${ptlStageProgressStripHtml()}
      </div>
    </div>`;

  // Two full views, not a canvas strip glued above a list: Timeline is
  // the schematic overview (big — real screen space, its own fullscreen
  // overlay); Steps is where the actual Mark Done / Set Date / target
  // editing happens, and is the default landing view. Rather than a
  // two-tab toggle inline in the body (redundant once you're already
  // looking at Steps), a single "Timeline" entry button lives in the
  // panel's top-left, next to Return to Main Dashboard — the fullscreen
  // overlay's own "‹ Steps" button is the way back.
  const elHeaderLeft = document.getElementById("ptl-header-left");
  if (elHeaderLeft) elHeaderLeft.innerHTML = `<button type="button" onclick="ptlSetViewMode('timeline')" title="Open Timeline" style="display:inline-flex; align-items:center; gap:5px; padding:7px 12px; font-size:0.82rem; font-weight:700; border:1px solid var(--border); border-radius:var(--radius); background:#fff; color:var(--muted); cursor:pointer;">Timeline &rsaquo;</button>`;
  const stepsOpen = `<div id="ptl-steps-wrap" style="display:none;">`;

  if (!mfcComplete) {
    body.innerHTML = header + stepsOpen + `
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
  body.innerHTML = header + stepsOpen + ptlRenderList(preLanes, today)
    + ptlRenderLanes(ptlData.lanes || [])
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
// Stage 4 doesn't take values until Stage 3 (Pre Production) is done —
// same reasoning Stage 5 already applies against Stage 4. The server is
// the real gate (submitInitialProductPlan refuses non-admins outright);
// this only decides whether to show the form as usable or locked, so a
// non-admin doesn't fill it out only to get refused on Submit. Derived
// from the trunk's own 6 Stage 3 nodes rather than a separate flag from
// the server, so it can never disagree with what's actually displayed.
function ptlIsStage3Done() {
  if (!ptlData || !ptlData.trunk) return false;
  const keys = ['boqs', 'wdesign', 'prns', 'mrdates', 'rmpos', 'pps'];
  return keys.every(id => {
    const n = ptlData.trunk.find(t => t.id === id);
    return n && (!!n.actual || n.done === true);
  });
}
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
  // Locked for anyone but an admin until Stage 3 — Pre Production is
  // fully done — the form still shows (so Production can see what's
  // coming), it just can't take values yet. Server-side
  // submitInitialProductPlan is the real gate; this only avoids letting a
  // non-admin fill the whole thing out only to get refused on Submit.
  const locked = !ptlIsAdmin() && !ptlIsStage3Done();
  const dis = locked ? 'disabled' : '';
  return `
    <div style="font-size:0.82rem; color:var(--muted); margin-bottom:10px;">
      No plan submitted yet. ${escapeHtml(lane.ownerDept)} Production enters a planned date for every step below, including Packing and Adding to FG — Material Issue Tickets for this product's Job Cards stay blocked until then. Only its completion is automatic; the planned/target date is entered like any other step.
    </div>
    ${locked ? `<div style="font-size:0.8rem; color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:var(--radius); padding:8px 12px; margin-bottom:10px;">Locked until Stage 3 — Pre Production is fully done.</div>` : ''}
    <div style="display:grid; grid-template-columns:minmax(160px,260px) minmax(180px,220px); gap:4px 16px; align-items:center;">
      <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); padding-bottom:4px; border-bottom:1px solid var(--border);">Production Stage</div>
      <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); padding-bottom:4px; border-bottom:1px solid var(--border);">Production Planning Date</div>
      ${lane.steps.map(s => `
        <label style="font-size:0.85rem; padding:5px 0;">${escapeHtml(s.label)}</label>
        <input type="date" ${dis} id="ptl-plan-${lane.boqId}-${s.id}" style="padding:6px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%; box-sizing:border-box;${locked ? ' background:#f1f5f9; cursor:not-allowed;' : ''}" />`).join("")}
    </div>
    <div style="margin-top:12px;">
      <button class="nav-btn-styled" ${dis} style="${locked ? 'opacity:0.5; cursor:not-allowed;' : ''}" onclick="ptlSubmitInitialPlan('${lane.boqId}')">Submit Initial Plan</button>
    </div>`;
}

// Table form (30 Aug 2026) — Process Name / Initial Planning Date (frozen,
// = s.planned) / Current Target Date (the currently-committed date: the
// most recent New Target Date if one was ever set, else the initial
// planning date itself — a plain display of s.target || s.planned, never
// edited directly) / New Target Date (the only editable date column,
// same updateProductPlanStepTarget call as before) / Mark Done or Mark
// Undone. Mark Undone is NOT admin-only — it's everyday mistake
// correction (see unmarkProductPlanStepDone's own header comment), not a
// testing override.
function ptlRenderLaneSteps(lane, c) {
  const today = ptlToday();
  const rows = lane.steps.map(s => {
    const done = !!s.actual;
    const eff = s.actual || s.target || s.planned;
    const late = !done && eff && eff < today;
    const currentTarget = s.target || s.planned;

    let actionCell;
    if (s.terminal) {
      actionCell = `<span style="font-size:0.72rem; font-family:monospace; font-weight:700; color:${c}; background:${c}22; padding:2px 8px; border-radius:10px;">${escapeHtml(s.chip || '')}</span>`;
    } else if (done) {
      actionCell = `
        <span style="font-size:0.78rem; color:${c}; font-weight:700;">Done ${ptlFmt(s.actual)}</span>
        <button class="nav-btn-styled" style="padding:4px 10px; font-size:0.72rem; background:#fff; color:var(--muted); border:1px solid var(--border);" onclick="ptlUnmarkStepDone('${lane.boqId}','${s.id}')">Mark Undone</button>
        ${ptlIsAdmin() ? `<span style="display:inline-flex; align-items:center; gap:6px; margin-left:4px;">${ptlAsOfInputHtml(`${lane.boqId}-${s.id}`, s.actual)}<button class="nav-btn-styled" style="padding:4px 10px; font-size:0.72rem;" onclick="ptlMarkStepDone('${lane.boqId}','${s.id}')">Update (admin)</button></span>` : ''}`;
    } else {
      actionCell = `
        ${ptlAsOfInputHtml(`${lane.boqId}-${s.id}`)}
        <button class="nav-btn-styled" style="padding:4px 10px; font-size:0.74rem;" onclick="ptlMarkStepDone('${lane.boqId}','${s.id}')">Mark Done</button>`;
    }

    return `
      <tr id="ptl-step-${lane.boqId}-${s.id}" style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:7px 8px; font-size:0.85rem; font-weight:600; color:${late ? 'var(--warn)' : 'var(--text)'};">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; background:${done ? c : '#fff'}; border:2px solid ${late ? 'var(--warn)' : c};"></span>
          ${escapeHtml(s.label)}${s.terminal ? ' <span style="font-weight:400; color:var(--muted); font-size:0.72rem;">(automatic)</span>' : ''}
        </td>
        <td style="padding:7px 8px; font-size:0.68rem; color:var(--muted); font-family:monospace; text-align:center;">${ptlFmt(s.planned)}</td>
        <td style="padding:7px 8px; font-size:0.68rem; font-weight:700; color:var(--text); font-family:monospace; text-align:center;">${ptlFmt(currentTarget)}</td>
        <td style="padding:7px 8px; text-align:center;">${s.terminal || !done ? `<input type="date" value="${s.target || ''}" onchange="ptlUpdateTarget('${lane.boqId}','${s.id}', this.value)"
              style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.74rem; width:118px; box-sizing:border-box;" />` : `<span style="color:var(--muted); font-size:0.78rem;">—</span>`}</td>
        <td style="padding:7px 8px; text-align:right; white-space:nowrap;">${actionCell}</td>
      </tr>`;
  }).join("");

  return `
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; min-width:600px; table-layout:fixed;">
        <colgroup><col style="width:auto;"><col style="width:110px;"><col style="width:110px;"><col style="width:130px;"><col style="width:auto;"></colgroup>
        <thead><tr style="border-bottom:2px solid var(--border);">
          <th style="padding:6px 8px; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:left;">Process Name</th>
          <th style="padding:6px 8px; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center;">Initial Planning Date</th>
          <th style="padding:6px 8px; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center;">Current Target Date</th>
          <th style="padding:6px 8px; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:center;">New Target Date</th>
          <th style="padding:6px 8px; font-size:0.68rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); text-align:right;"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
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

// Undoes an accidental/wrong Mark Done — everyday mistake correction,
// not admin-only (see unmarkProductPlanStepDone's own header comment).
async function ptlUnmarkStepDone(boqId, stepKey) {
  try {
    const data = await apFetch({ action: "unmarkProductPlanStepDone", operatorName: appActiveOperatorIdentityString, boqId, stepKey });
    if (!data.success) { alert(data.error || "Could not mark this step undone."); return; }
    const lane = ptlData.lanes.find(l => l.boqId === boqId);
    const step = lane && lane.steps.find(s => s.id === stepKey);
    if (step) step.actual = null;
    ptlRender();
  } catch (e) { alert("Network error: " + e.message); }
}

// A detail line is untrusted text (material names, etc.) so it must
// always go through escapeHtml — but some backend-built lines (see
// routes/timeline.js's "All RM POs Released" detail, 31 Aug 2026) want
// one span bold (the qty+unit). Sending real <strong> tags isn't safe
// here since the whole line still needs escaping; instead the backend
// wraps that span in \x02...\x03 control-character markers (can't occur
// in normal text), and this splits on them, escaping each piece
// independently before wrapping the marked one in a real <strong>. A
// line with no markers just falls through to plain escapeHtml.
function ptlEscapeWithOptionalBold(text) {
  const start = text.indexOf('\x02');
  const end = text.indexOf('\x03');
  if (start === -1 || end === -1 || end <= start) return escapeHtml(text);
  const before = text.slice(0, start);
  const bold = text.slice(start + 1, end);
  const after = text.slice(end + 1);
  return `${escapeHtml(before)}<strong>${escapeHtml(bold)}</strong>${escapeHtml(after)}`;
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
  let lastStage = null;
  return `<div style="display:flex; flex-direction:column; gap:0;">` + nodes.map(n => {
    const stageHeader = n.stage !== lastStage
      ? `<div style="margin-top:${lastStage === null ? '0' : '20px'}; font-weight:800; font-size:0.95rem; color:var(--text); margin-bottom:4px;">Stage ${n.stage} — ${PTL_STAGE_LABEL[n.stage] || ''}</div>`
      : '';
    lastStage = n.stage;
    const c = PTL_COLORS[n.dept] || 'var(--muted)';
    const done = !!n.actual || n.done === true;
    const late = ptlLate(n);
    const eff = ptlEff(n);
    const dateTxt = n.actual ? ptlFmtFull(n.actual) : (n.done ? `On or before ${ptlFmtFull(eff)} (exact date not tracked)` : eff ? `Due ${ptlFmtFull(eff)}` : 'Not yet scheduled');
    // Same completion-status coloring as the canvas map (30 Aug 2026) —
    // grey scheduled / green done / red late, not department. `c` is
    // kept only for the department name badge text just below.
    const dotColor = late ? 'var(--warn)' : (done ? 'var(--accent)' : PTL_SCHEDULED_GREY);
    const hasDetail = Array.isArray(n.detail);
    const expanded = hasDetail && ptlExpandedNodes.has(n.id);
    const manualCanEdit = n.kind === 'manual' && !PTL_QA_CHAIN.has(n.id) && (!n.actual || ptlIsAdmin());
    const qaCanEdit = PTL_QA_CHAIN.has(n.id) && prodPlanDone && (!n.actual || ptlIsAdmin());
    const qaBlockedByPlan = PTL_QA_CHAIN.has(n.id) && !n.actual && !prodPlanDone;
    const systemDateCanEdit = PTL_ADMIN_SYSTEM_DATE_IDS.has(n.id) && ptlIsAdmin();
    const milestoneOverrideCanEdit = !!PTL_ADMIN_MILESTONE_OVERRIDE_KEY[n.id] && ptlIsAdmin();
    const stage3RebaselineKey = PTL_STAGE3_MILESTONE_KEY[n.id];
    return stageHeader + `
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
          ${n.chip ? `<span style="display:inline-block; margin-top:5px; font-size:0.72rem; font-family:monospace; font-weight:700; color:var(--text); background:var(--highlight-bg); padding:2px 8px; border-radius:10px;">${escapeHtml(n.chip)}</span>` : ''}
          ${hasDetail ? `<div style="font-size:0.72rem; color:var(--brand); margin-top:5px; font-weight:600;">${expanded ? '▾ Hide' : '▸ Show'} what's left</div>` : ''}
          ${manualCanEdit ? `<div onclick="event.stopPropagation()" style="margin-top:7px; display:flex; align-items:center; gap:8px;">${ptlAsOfInputHtml(n.id, n.actual)}<button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlMarkMilestoneDone('${n.id}')">${n.actual ? 'Update (admin)' : 'Mark Done'}</button></div>` : ''}
          ${qaCanEdit ? `
            <div onclick="event.stopPropagation()" style="margin-top:7px; display:flex; align-items:center; gap:8px;">
              <input type="date" id="ptl-qa-date-${n.id}" value="${n.actual || ''}" style="padding:5px; border:1.5px solid var(--border); border-radius:4px; font-size:0.78rem;" />
              <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlSetQaMilestoneDate('${n.id}')">${n.actual ? 'Update (admin)' : 'Set Date'}</button>
            </div>` : ''}
          ${qaBlockedByPlan ? `<div style="margin-top:7px; font-size:0.76rem; color:var(--muted); font-style:italic;">Stage 4 Production Planning has to be submitted for every in-scope product before this can be entered.</div>` : ''}
          ${systemDateCanEdit ? `
            <div onclick="event.stopPropagation()" style="margin-top:7px; display:flex; align-items:center; gap:8px;">
              <input type="date" id="ptl-sysdate-${n.id}" value="${n.actual || ''}" title="Admin only — set/backdate this for testing" style="padding:5px; border:1.5px dashed #f59e0b; border-radius:4px; font-size:0.78rem;" />
              <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlSetSystemDate('${n.id}')">${n.actual ? 'Update (admin)' : 'Set (admin)'}</button>
            </div>` : ''}
          ${milestoneOverrideCanEdit ? `
            <div onclick="event.stopPropagation()" style="margin-top:7px; display:flex; align-items:center; gap:8px;">
              <input type="date" id="ptl-msoverride-${n.id}" value="${n.actual || ''}" title="Admin only — override this milestone's date for testing (normally computed live)" style="padding:5px; border:1.5px dashed #f59e0b; border-radius:4px; font-size:0.78rem;" />
              <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="ptlSetMilestoneOverride('${n.id}')">${n.actual ? 'Update (admin)' : 'Set (admin)'}</button>
              ${n.actual ? `<button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem; background:#fff; color:var(--muted); border:1px solid var(--border);" onclick="ptlClearMilestoneOverride('${n.id}')">Clear override</button>` : ''}
            </div>` : ''}
          ${stage3RebaselineKey && !done ? `
            <div onclick="event.stopPropagation()" style="margin-top:5px;">
              <button class="nav-btn-styled" style="padding:4px 10px; font-size:0.72rem; background:#fff; color:var(--brand); border:1px solid var(--border);" onclick="ptlRevisePlannedTarget('${n.id}', '${stage3RebaselineKey}')">Revise Target Date</button>
            </div>` : ''}
        </div>
      </div>
      ${hasDetail && expanded ? `<div style="margin:0 0 10px 40px; padding:10px 12px; background:var(--highlight-bg); border:1px solid var(--border); border-radius:var(--radius); font-size:0.8rem; color:var(--text);">
        ${n.detail.length ? `<ul style="margin:0; padding-left:18px;">${n.detail.map(d => {
          // Backend joins the item's identity and the trailing "still
          // has no..." sentence with \n — split them onto their own
          // lines within the SAME bullet, rather than reading as if the
          // sentence were its own separate list item.
          const parts = d.split("\n");
          return `<li style="margin-bottom:4px;">${ptlEscapeWithOptionalBold(parts[0])}${parts[1] ? `<div style="color:var(--muted);">${ptlEscapeWithOptionalBold(parts[1])}</div>` : ''}</li>`;
        }).join("")}</ul>` : `<span style="color:var(--muted);">${escapeHtml(n.blocked || 'Nothing left — this row is fully covered.')}</span>`}
      </div>` : ''}`;
  }).join("") + `</div>`;
}

// ptlRevisePlannedTarget — Stage 3 re-baseline (routes/timeline.js's
// reviseTimelineMilestoneTarget). Kept to plain prompt() dialogs
// deliberately, same trade-off Stage 3's Mark Done button already made —
// this is a rare, deliberate correction, not a routine data-entry flow
// that needs its own form.
async function ptlRevisePlannedTarget(nodeId, milestoneKey) {
  if (!ptlData) return;
  const newTargetDate = prompt("New target date for this milestone (YYYY-MM-DD):");
  if (!newTargetDate) return;
  const reason = prompt("Reason for re-baselining this date (required, shown in the audit history):");
  if (!reason || !reason.trim()) { alert("A reason is required."); return; }
  const projectId = ptlData.project.projectId;
  try {
    const data = await apFetch({ action: "reviseTimelineMilestoneTarget", operatorName: appActiveOperatorIdentityString, projectId, milestoneKey, newTargetDate, reason });
    if (!data.success) { alert(data.error || "Could not revise this target date."); return; }
    await selectPtlProject(projectId);
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

async function ptlSetMilestoneOverride(nodeId) {
  if (!ptlData) return;
  const el = document.getElementById(`ptl-msoverride-${nodeId}`);
  const date = el ? el.value : "";
  if (!date) { alert("Pick a date first."); return; }
  const projectId = ptlData.project.projectId;
  const milestoneKey = PTL_ADMIN_MILESTONE_OVERRIDE_KEY[nodeId];
  try {
    const data = await apFetch({ action: "adminOverrideSystemMilestone", operatorName: appActiveOperatorIdentityString, projectId, milestoneKey, date });
    if (!data.success) { alert(data.error || "Could not set this date."); return; }
    await selectPtlProject(projectId);
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

async function ptlClearMilestoneOverride(nodeId) {
  if (!ptlData) return;
  const projectId = ptlData.project.projectId;
  const milestoneKey = PTL_ADMIN_MILESTONE_OVERRIDE_KEY[nodeId];
  try {
    const data = await apFetch({ action: "adminClearSystemMilestoneOverride", operatorName: appActiveOperatorIdentityString, projectId, milestoneKey });
    if (!data.success) { alert(data.error || "Could not clear this override."); return; }
    await selectPtlProject(projectId);
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

async function ptlSetSystemDate(fieldId) {
  if (!ptlData) return;
  const el = document.getElementById(`ptl-sysdate-${fieldId}`);
  const date = el ? el.value : "";
  if (!date) { alert("Pick a date first."); return; }
  const projectId = ptlData.project.projectId;
  try {
    const data = await apFetch({ action: "adminBackdateSystemDate", operatorName: appActiveOperatorIdentityString, projectId, fieldId, date });
    if (!data.success) { alert(data.error || "Could not set this date."); return; }
    const node = ptlData.trunk.find(n => n.id === fieldId);
    if (node) node.actual = data.actualDate;
    ptlRender();
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

// wdesign dropped 29 Aug 2026 — Working Designs & Drawings is now
// kind:'derived' (first drawing upload), no longer a manual tick, so
// ptlMarkMilestoneDone's button for it no longer renders. costing dropped
// 30 Aug 2026 — folded into 'boqs' (All BOQs and Final Costing Released),
// no manual-tick Stage 3 milestone is left.
const PTL_MILESTONE_KEY = {};

async function ptlSetQaMilestoneDate(milestoneKey) {
  if (!ptlData) return;
  const el = document.getElementById(`ptl-qa-date-${milestoneKey}`);
  const date = el ? el.value : "";
  if (!date) { alert("Pick a date first."); return; }
  const projectId = ptlData.project.projectId;
  try {
    const data = await apFetch({ action: "saveTimelineMilestoneDate", operatorName: appActiveOperatorIdentityString, projectId, milestoneKey, date });
    if (!data.success) { alert(data.error || "Could not set this date."); return; }
    // A full reload, not a local patch — the rest of the QA chain
    // (Inspection Clearance Note -> Dispatch Clearance -> Predicted
    // Delivery) is a live server-side projection off whichever of these
    // dates are now real (computeQaChainProjection), so setting just
    // THIS node's actual locally left every downstream estimate frozen
    // on its old value instead of cascading forward.
    await selectPtlProject(projectId);
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
// DEAD as of 30 Aug 2026 — canvas node/trace coloring dropped department
// hues entirely (green on-track / red late only, see ptlCanvasNodes).
// Flagged, not deleted, per repo convention.
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
  // Every calendar day is plotted now (31 Aug 2026, was Sunday-skipped) —
  // for date-continuity: something can genuinely happen on a Sunday or
  // holiday (this business does sometimes work them), and omitting that
  // day from the axis entirely would make such an action look like it
  // happened on the wrong date, or vanish. Sunday/holiday columns are
  // still excluded from all BUSINESS-DAY math (ptlBdBetween above,
  // lib/businessDays.js server-side) — this only widens what's DRAWN.
  ptlDays = []; ptlIndexMap = {};
  for (let t = from.getTime(); t <= to.getTime(); t += PTL_DAYMS) {
    const d = new Date(t);
    ptlIndexMap[ptlIso(d)] = ptlDays.length; ptlDays.push(ptlIso(d));
  }
  return true;
}

function ptlCanvasNodes() {
  const spineIds = ['oa', 'po', 'activated', 'dwgSent', 'dwgAppr', 'mfcCust', 'mfcInt', 'boqs', 'wdesign', 'prns', 'mrdates', 'rmpos', 'pps', 'prodPlan'];
  // 'dispatched' merged into 'delivery' 29 Aug 2026 — see routes/timeline.js.
  // The connecting trunk line now ends at 'predictedDelivery' (the QA
  // chain's own realistic projection), not 'delivery' (the PO's
  // contractual/promised date) — 'delivery' moved to `standalone` (30 Aug
  // 2026) so it renders as its own point without implying it's just
  // another step in the same sequence; the two dates can legitimately
  // diverge and that divergence is the point of showing both.
  const tailIds = ['inspCall', 'customer_inspection', 'inspection_clearance_note', 'dispatch_clearance', 'predictedDelivery'];
  const standaloneIds = ['delivery'];
  const byId = id => (ptlData.trunk || []).find(n => n.id === id);
  const dated = id => { const n = byId(id); return n && ptlEff(n) ? n : null; };
  return {
    spine: spineIds.map(dated).filter(Boolean),
    tail: tailIds.map(dated).filter(Boolean),
    standalone: standaloneIds.map(dated).filter(Boolean),
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
// 5.8px/char under-measured real (bold, mixed-case) rendered text widths
// enough that adjacent close-dated nodes' labels ("Drawing Approved" /
// "MFC from Customer") were passing the collision check and overlapping
// on screen instead of stacking — bumped, plus PTL_LBL_PAD below adds a
// visible gap rather than letting blocks just touch.
const ptlWLbl = s => s.length * 7.2 * ptlFS;
const PTL_LBL_PAD = 6;
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
const PTL_STAGE_NAMES = { 1: 'Order Acceptance', 2: 'Approvals', 3: 'Pre Production', 4: 'Production', 5: 'Inspection & Dispatch' };

function ptlRenderCanvas(containerId) {
  const wrap = document.getElementById(containerId || ptlCanvasContainerId);
  if (!wrap) return;
  if (!ptlBuildDayRange()) { wrap.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Nothing dated yet to draw a timeline from.</div>`; return; }
  const { spine, tail, standalone, lanes } = ptlCanvasNodes();
  if (spine.length < 2) { wrap.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Nothing dated yet to draw a timeline from.</div>`; return; }

  ptlFS = PTL_FONT_SCALE[ptlMode];
  // Full-width, full-height surface — this is the primary view, not a
  // strip squeezed above a list, so it gets real screen real estate.
  const availW = Math.max(900, (wrap.clientWidth || window.innerWidth) - 4);
  // Gutter now shows each lane's full "Product Name - Rating -
  // Description" (not just the flow name like "Reactor"), so its width is
  // a fixed, generous wrap column rather than scaling with content —
  // scaling to the full label's raw length would make the gutter
  // enormous for a long description. See the gutter block below for the
  // actual line-wrapping (reuses ptlWrapLbl, same as node labels).
  const longestName = 24;
  // LEAD is pure breathing room between the gutter's right edge and the
  // first plotted day — kept separate from the gutter's own width (see
  // gutterW below, which is PAD_L-based only) so widening this doesn't
  // widen the side panel, just gives the earliest nodes (Order Acceptance
  // Sent etc.) room to not sit flush against the gutter when scrolled all
  // the way left.
  const LEAD = Math.round(110 * ptlFS);
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
  [...spine, ...tail, ...standalone].forEach(n => { const d = ptlEff(n); if (d) dateGroupSizes[d] = (dateGroupSizes[d] || 0) + 1; });
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

  // Every date within ptlBuildDayRange's from/to span is now in the index
  // (Sundays/holidays included, 31 Aug 2026) — this fallback is purely
  // defensive for a date outside that span, which shouldn't happen given
  // how `to`/`from` are derived from the same dated points this draws,
  // but snapping forward beats silently plotting at day zero.
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
  // Sunday/holiday columns (31 Aug 2026) render their date+day-name in the
  // same green as the TODAY line (#15803d) so they read as "day off" at a
  // glance, distinct from the normal text/muted greys AND from Monday's
  // own bold-black emphasis — a rest day still shows even when DENSE mode
  // would otherwise only label Mondays, since it's the whole point of
  // marking it.
  const PTL_REST_GREEN = '#15803d';
  ptlDays.forEach((d, i) => {
    const x = PAD_L + LEAD + i * ptlDayW, dt = ptlParse(d), m = dt.getUTCMonth(), mon = dt.getUTCDay() === 1;
    const isRest = ptlDayIsRest(d);
    if (m !== lastM) { lastM = m; P.push(`<text x="${x}" y="${14 * ptlFS}" font-size="${11 * ptlFS}" font-weight="800" letter-spacing="1.5" fill="var(--muted)">${PTL_MON[m].toUpperCase()} ${dt.getUTCFullYear()}</text>`); }
    if (!DENSE || mon || isRest) {
      const dateColor = isRest ? PTL_REST_GREEN : (mon ? 'var(--text)' : 'var(--muted)');
      const dowColor = isRest ? PTL_REST_GREEN : 'var(--muted)';
      P.push(`<text x="${x}" y="${RULER_H - 15 * ptlFS}" text-anchor="middle" font-size="${11.5 * ptlFS}" font-family="monospace" font-weight="${mon || isRest ? 800 : 600}" fill="${dateColor}">${dt.getUTCDate()}</text>`);
      P.push(`<text x="${x}" y="${RULER_H - 5 * ptlFS}" text-anchor="middle" font-size="${9 * ptlFS}" font-family="monospace" font-weight="600" fill="${dowColor}">${DOW[dt.getUTCDay()]}</text>`);
    }
  });

  // Stage dividers — a real rule with the stage name against it, same as
  // the design prototype, so the schematic reads as five stages rather
  // than one unbroken run of dots.
  const stageXs = {};
  [...spine, ...tail, ...standalone].forEach(n => { if (n.stage) (stageXs[n.stage] = stageXs[n.stage] || []).push(xOf(ptlEff(n))); });
  lanes.forEach(l => l.steps.forEach(s => (stageXs[4] = stageXs[4] || []).push(xOf(s.actual || s.target || s.planned))));
  // Skip a stage's label (never the divider line itself) when the next
  // stage starts too close after it for the text to fit — a small Stage
  // 4 window otherwise collided with Stage 5's label right after it.
  const stageKeys = Object.keys(stageXs).sort((a, b) => a - b);
  const stageX0s = stageKeys.map(st => Math.min(...stageXs[st]) - ptlDayW * 0.75);
  stageKeys.forEach((st, i) => {
    const x0 = stageX0s[i];
    const x1 = i + 1 < stageX0s.length ? stageX0s[i + 1] : W;
    if (i % 2 === 0) P.push(`<rect x="${x0}" y="${RULER_H}" width="${x1 - x0}" height="${H - RULER_H}" fill="color-mix(in srgb, var(--text) 3%, transparent)"/>`);
    P.push(`<line x1="${x0}" y1="${RULER_H}" x2="${x0}" y2="${H}" stroke="var(--text)" stroke-width="2.5" opacity=".55"/>`);
    const label = `STAGE ${st} · ${(PTL_STAGE_NAMES[st] || '').toUpperCase()}`;
    const estWidth = label.length * 6.4 * ptlFS;
    const nextX0 = i + 1 < stageX0s.length ? stageX0s[i + 1] : Infinity;
    if (nextX0 - (x0 + 9 * ptlFS) > estWidth) {
      P.push(`<rect x="${x0 + 4 * ptlFS}" y="${RULER_H + 5 * ptlFS}" width="${estWidth + 10 * ptlFS}" height="${16 * ptlFS}" rx="4" fill="var(--card)" opacity=".8"/>`);
      P.push(`<text x="${x0 + 9 * ptlFS}" y="${RULER_H + 17 * ptlFS}" font-size="${10.5 * ptlFS}" font-weight="800" letter-spacing="1.2" fill="var(--text)" opacity=".8">${esc(label)}</text>`);
    }
  });

  // Today
  P.push(`<line x1="${todayX}" y1="${RULER_H}" x2="${todayX}" y2="${H}" stroke="#15803d" stroke-width="2.5" opacity=".85"/>`);

  // Traces: spine (split at prodPlan into lanes, rejoin at tail[0]).
  // Nodes sharing the exact same date (e.g. BOQs/Costing/Working Designs,
  // all frozen +3 business days from Internal MFC) would otherwise land
  // on the identical (x, spineY) point and render as one merged dot —
  // fan them vertically around the spine instead, same as the design
  // prototype did.
  const pos = {};
  const byDate = {};
  [...spine, ...tail, ...standalone].forEach(n => { (byDate[ptlEff(n)] = byDate[ptlEff(n)] || []).push(n); });
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
      const c = ptlLaneTraceColor(i);
      const y = laneYs[i];
      const stepPts = l.steps.map(s => ({ x: xOf(s.actual || s.target || s.planned), y: laneStepY[i][s.id] }));
      const fx = stepPts[0].x, lx = stepPts[stepPts.length - 1].x;
      traces.push({ d: `M${split.x} ${split.y} C${(split.x + fx) / 2} ${split.y}, ${(split.x + fx) / 2} ${y}, ${fx} ${y}`, c });
      traces.push({ d: poly(stepPts), c });
      traces.push({ d: `M${lx} ${y} C${(lx + merge.x) / 2} ${y}, ${(lx + merge.x) / 2} ${merge.y}, ${merge.x} ${merge.y}`, c });
    });
    if (tail.length) traces.push({ d: poly(tail.map(n => pos[n.id])), c: 'var(--brand)' });
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
  standalone.forEach(n => laid.push({ n, x: pos[n.id].x, y: pos[n.id].y }));
  lanes.forEach((l, i) => l.steps.forEach(s => laid.push({ n: { ...s, dept: l.ownerDept === 'Reactor' ? 'lane_r' : l.ownerDept === 'Capacitor' ? 'lane_c' : 'lane_p' }, x: xOf(s.actual || s.target || s.planned), y: laneStepY[i][s.id], boqId: l.boqId, ownerLabel: `${l.ownerDept} Production` })));
  laid.sort((a, b) => a.x - b.x);

  const PL = ptlPlacer();
  laid.forEach(({ x, y }) => PL.block({ x0: x - R * 1.4, x1: x + R * 1.4, y0: y - R * 1.4, y1: y + R * 1.4 }));

  // Color is now purely a completion/lateness signal, not a department
  // one (dropped 30 Aug 2026) — green filled+checked once done, grey
  // hollow while still scheduled/on-track, red hollow reserved
  // exclusively for something open past its own due date. Department is
  // still readable from the label text / lane gutter, just not color.
  const clickMap = [];
  laid.forEach(({ n, x, y, boqId, ownerLabel }) => {
    const c = 'var(--accent)';
    const eff = n.actual || n.target || n.planned;
    const done = !!n.actual || n.done === true;
    const late = !done && eff && eff < today;
    const bd = late ? Math.abs(ptlBdBetween(eff, today) || 0) : null;
    const ring = late ? '#e84545' : (done ? c : PTL_SCHEDULED_GREY);

    const lines = ptlWrapLbl(n.label, 16);
    const lw = Math.max(...lines.map(ptlWLbl));
    const GAP = 12 * ptlFS, ASC = 9 * ptlFS;
    const kU = PL.place(k => { const b = y - R - GAP - k * (SLOT_UP + LINE_H); return { x0: x - lw / 2 - PTL_LBL_PAD, x1: x + lw / 2 + PTL_LBL_PAD, y0: b - (lines.length - 1) * LINE_H - ASC, y1: b + 3 }; });
    const base = y - R - GAP - kU * (SLOT_UP + LINE_H);
    if (kU > 0) P.push(`<line x1="${x}" y1="${y - R}" x2="${x}" y2="${base + 4}" stroke="${ring}" stroke-width="1" opacity=".3"/>`);
    lines.forEach((ln, i) => P.push(`<text x="${x}" y="${base - (lines.length - 1 - i) * LINE_H}" text-anchor="middle" font-size="${11 * ptlFS}" font-weight="600" fill="${late ? '#e84545' : 'var(--text)'}" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="3.5">${esc(ln)}</text>`));

    const dtx = ptlFmt(eff);
    // Stage 3's progress chip (e.g. "3/4 PRNs") — was only ever rendered in
    // the Steps list, never on the canvas map, despite being exactly the
    // kind of at-a-glance progress the map is for. Rendered as a second
    // line under the date, reserved as part of the same placer slot so it
    // can't collide with a neighboring node's stacked label/date.
    const chipTxt = n.chip || '';
    const bw = Math.max(ptlWMono(dtx, 10.5), chipTxt ? ptlWMono(chipTxt, 9.5) : 0);
    const chipExtra = chipTxt ? LINE_H : 0;
    const kD = PL.place(k => { const d = y + R + GAP + k * SLOT_DN; return { x0: x - bw / 2 - PTL_LBL_PAD, x1: x + bw / 2 + PTL_LBL_PAD, y0: d - ASC, y1: d + 3 + chipExtra }; });
    const dy = y + R + GAP + kD * SLOT_DN;
    if (kD > 0) P.push(`<line x1="${x}" y1="${y + R}" x2="${x}" y2="${dy - ASC}" stroke="${ring}" stroke-width="1" opacity=".3"/>`);
    P.push(`<text x="${x}" y="${dy}" text-anchor="middle" font-size="${10.5 * ptlFS}" font-weight="700" font-family="monospace" fill="${late ? '#e84545' : 'var(--muted)'}" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="3.5">${esc(dtx)}</text>`);
    if (chipTxt) P.push(`<text x="${x}" y="${dy + LINE_H}" text-anchor="middle" font-size="${9.5 * ptlFS}" font-weight="700" font-family="monospace" fill="var(--text)" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="3.5">${esc(chipTxt)}</text>`);

    P.push(`<circle cx="${x}" cy="${y}" r="${R}" fill="${done ? c : 'var(--card)'}" stroke="${ring}" stroke-width="${(late ? 2.6 : 2.2) * ptlFS}"/>`);
    if (done) P.push(`<path d="M${x - R * 0.43} ${y} l${R * 0.31} ${R * 0.32} l${R * 0.55} -${R * 0.61}" fill="none" stroke="var(--card)" stroke-width="${1.8 * ptlFS}" stroke-linecap="round" stroke-linejoin="round"/>`);

    const anchorId = boqId ? `ptl-step-${boqId}-${n.id}` : `ptl-row-${n.id}`;
    const idx = clickMap.length;
    clickMap.push({
      label: n.label, owner: ownerLabel || (PTL_DEPT_NAME[n.dept] || n.dept),
      planned: n.planned, eff, actual: n.actual, late: bd, stage: boqId ? 4 : n.stage,
    });
    P.push(`<circle cx="${x}" cy="${y}" r="${R * 2.2}" fill="transparent" class="ptl-hit" data-anchor="${anchorId}" data-idx="${idx}"/>`);
  });

  // Gutter — shows each lane's full "Product Name - Rating - Description"
  // (not just the bare flow name), colored to match that lane's own
  // trace line (ptlLaneTraceColor). Pinned to the left edge of the
  // viewport via a scroll-compensating transform (see the scroll
  // listener wired below), same technique as the design prototype's own
  // pinGutter() — drawing it as ordinary SVG content with no pinning at
  // all let it scroll away with everything else instead of staying put.
  if (laneCount) {
    // Frozen at the ORIGINAL lead value (64), not the new wider LEAD above
    // — the visible panel itself must stay exactly the width it was;
    // LEAD growing is what creates the extra gap between this edge and
    // the first plotted day, not a wider gutter.
    const gutterW = PAD_L + (64 * ptlFS) - 10;
    const G = [`<g id="ptl-gutter">`, `<rect x="0" y="${RULER_H}" width="${gutterW}" height="${H - RULER_H}" fill="var(--bg,#f0f4f8)"/>`, `<line x1="${gutterW}" y1="${RULER_H}" x2="${gutterW}" y2="${H}" stroke="var(--border)" stroke-width="1"/>`];
    lanes.forEach((l, i) => {
      const y = laneYs[i];
      const lc = ptlLaneTraceColor(i);
      const fullLabel = [l.productName, l.productRating, l.descriptionOfMaterial].filter(Boolean).join(' - ') || l.name;
      const labelLines = ptlWrapLbl(fullLabel, longestName);
      G.push(`<rect x="16" y="${y - 12 * ptlFS}" width="4" height="${24 * ptlFS}" rx="2" fill="${lc}"/>`);
      labelLines.forEach((ln, li) => {
        G.push(`<text x="28" y="${y + 4.5 * ptlFS + (li - (labelLines.length - 1) / 2) * 13 * ptlFS}" font-size="${11.5 * ptlFS}" font-weight="800" fill="${lc}">${esc(ln)}</text>`);
      });
    });
    G.push(`</g>`);
    P.push(G.join(""));
  }

  // Last of all, so nothing can cover it. Sits at the BOTTOM of the line,
  // not the top — the top is where stage-divider labels live, and the two
  // used to collide right where Today happened to fall inside a stage.
  P.push(`<text x="${todayX}" y="${H - 10 * ptlFS}" text-anchor="middle" font-size="${10 * ptlFS}" font-weight="800" letter-spacing="1" fill="#15803d" paint-order="stroke" stroke="var(--bg,#f0f4f8)" stroke-width="5">TODAY · ${esc(ptlFmt(today))}</text>`);

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block;">${P.join("")}</svg>`;
  ptlLastTodayX = todayX;
  wrap.innerHTML = svg;
  ptlWireCanvasInteractions(wrap, clickMap);

  // Pin the gutter to the viewport's left edge — it's ordinary content
  // inside the same horizontally-scrolling SVG, so without this it would
  // just scroll away like everything else. `.onscroll` (not
  // addEventListener) deliberately overwrites any previous handler
  // rather than stacking one per re-render.
  const pinGutter = () => {
    const g = wrap.querySelector('#ptl-gutter');
    if (g) g.setAttribute('transform', `translate(${wrap.scrollLeft},0)`);
  };
  wrap.onscroll = pinGutter;

  // Land the horizontal scroll on today — except in "This Week" mode,
  // where centering today gave a floating 6-day window (e.g. Wed-Mon)
  // instead of the actual calendar week. There, anchor on that week's
  // Monday instead, so the 6-wide view always reads as Monday-Saturday.
  if (ptlMode === 'week') {
    const todayDow = ptlParse(today).getUTCDay(); // 0=Sun..6=Sat
    const mondayOffset = todayDow === 0 ? 6 : todayDow - 1;
    const mondayIso = ptlIso(new Date(ptlParse(today).getTime() - mondayOffset * PTL_DAYMS));
    wrap.scrollLeft = Math.max(0, xOf(mondayIso) - PAD_L);
  } else {
    wrap.scrollLeft = Math.max(0, todayX - wrap.clientWidth / 2);
  }
  pinGutter();
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

  // LD (Liquidated Damages) — nodeId '__ld__' is a special case ptlGotoFlag
  // routes to the LD panel instead of a Steps-view jump. Severity here is
  // urgency-of-action (how soon exposure gets worse), not size of the
  // rupee figure — an uncapped clause is flagged "high" even at ₹0 today,
  // since the absence of a cap is itself the risk.
  const ld = ptlData.ld;
  if (ld) {
    if (ld.status === 'uncapped') {
      out.push({ sev: 'high', nodeId: '__ld__', title: `${ptlData.project.projectId} has an uncapped LD clause`,
        msg: `${ptlFmtINR(ld.ld)} accruing, no cap stated — every week of delay adds more.`, owner: 'Project' });
    } else if (ld.status === 'accruing_projected' || ld.status === 'accrued_final') {
      const soon = ld.daysToNextStep != null && ld.daysToNextStep <= 3;
      out.push({ sev: soon ? 'high' : 'normal', nodeId: '__ld__',
        title: `${ptlData.project.projectId} is accruing LD — ${ptlFmtINR(ld.ld)}${ld.dispatchMode === 'actual' ? ' (final)' : ' (projected)'}`,
        msg: ld.daysToNextStep != null
          ? `Next LD step in ${ld.daysToNextStep} day${ld.daysToNextStep === 1 ? '' : 's'} — beating it saves ${ptlFmtINR(ld.marginal)}.`
          : `Contractual delivery was ${ptlFmtFull(ld.graceEnd)}.`,
        owner: 'Project' });
    } else if (ld.status === 'at_cap') {
      out.push({ sev: 'normal', nodeId: '__ld__', title: `${ptlData.project.projectId} is at its LD cap — ${ptlFmtINR(ld.ld)}`,
        msg: `Expediting this project recovers nothing further under this clause.`, owner: 'Project' });
    } else if (ld.status === 'pending_review') {
      out.push({ sev: 'normal', nodeId: '__ld__', title: `${ptlData.project.projectId}'s LD clause hasn't been reviewed`,
        msg: `A parsed candidate is waiting for confirmation.`, owner: 'Project' });
    }
  }

  const rank = { critical: 0, high: 1, normal: 2, due: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}

function ptlGotoFlag(nodeId, boqId) {
  if (nodeId === '__ld__') { ptlOpenLdPanel(); return; }
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
let ptlLastFlagsCount = 0;
function ptlUpdateFsFlagsToggleBtn() {
  const btn = document.getElementById("ptl-fs-flags-toggle");
  if (!btn) return;
  if (ptlFsRailOpen) { btn.textContent = `Hide Flags (${ptlLastFlagsCount})`; btn.style.background = "#16a34a"; }
  else { btn.textContent = `Show Flags (${ptlLastFlagsCount})`; btn.style.background = "#dc2626"; }
}

function ptlJumpToday() {
  const sc = document.getElementById(ptlCanvasContainerId);
  if (!sc) return;
  // In "This Week" mode, re-render rather than smooth-scroll to
  // ptlLastTodayX (centered) — that would undo ptlRenderCanvas's own
  // Monday-anchored positioning for this mode and go back to a floating
  // 6-day window instead of the actual calendar week.
  if (ptlMode === 'week') { ptlRenderCanvas(ptlCanvasContainerId); return; }
  sc.scrollTo({ left: Math.max(0, ptlLastTodayX - sc.clientWidth / 2), behavior: "smooth" });
}

function ptlRenderFullscreen() {
  const ov = document.getElementById("ptl-fs-overlay");
  if (!ov || !ptlData) return;
  const { project } = ptlData;
  const flags = ptlBuildFlags();
  const overdueCount = flags.filter(f => f.sev !== "due").length;
  ptlLastFlagsCount = flags.length;

  ov.innerHTML = `
    <div style="flex:none; background:var(--card); border-bottom:1px solid var(--border); padding:12px 18px; display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; align-items:center; gap:16px;">
        <button type="button" onclick="ptlSetViewMode('steps')" title="Back to Steps" style="flex:none; display:inline-flex; align-items:center; gap:5px; padding:7px 12px; font-size:0.82rem; font-weight:700; border:1px solid var(--border); border-radius:var(--radius); background:#fff; color:var(--muted); cursor:pointer;">&lsaquo; Steps</button>
        <div style="width:1px; align-self:stretch; background:var(--border); flex:none;"></div>
        <div style="display:flex; align-items:center; gap:12px; min-width:0;">
          <div style="width:5px; height:30px; border-radius:2px; background:var(--brand); flex:none;"></div>
          <div style="font-weight:800; font-size:1.1rem; color:var(--brand); white-space:nowrap;">Project Timeline</div>
        </div>
        ${ptlLdChipHtml()}
        <div style="flex:1 1 auto;"></div>
        ${ptlStageProgressHtml()}
        <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; flex:none;">
          ${Object.keys(PTL_MODES).map(m => `<button type="button" onclick="ptlSetMode('${m}')" style="padding:7px 14px; font-size:0.82rem; font-weight:600; border:0; border-right:1px solid var(--border); cursor:pointer; background:${m === ptlMode ? 'var(--brand)' : '#fff'}; color:${m === ptlMode ? '#fff' : 'var(--muted)'};">${m === 'week' ? 'This Week' : m === 'days15' ? '15 Days' : 'This Month'}</button>`).join("")}
        </div>
        <button type="button" onclick="ptlJumpToday()" style="flex:none; padding:7px 14px; font-size:0.82rem; font-weight:700; border:0; border-radius:var(--radius); cursor:pointer; background:var(--brand); color:#fff;">Today</button>
        <button type="button" id="ptl-fs-flags-toggle" onclick="ptlToggleFsRail()" style="flex:none; padding:7px 14px; font-size:0.82rem; font-weight:700; border:0; border-radius:var(--radius); cursor:pointer; color:#fff;"></button>
      </div>
      <div style="font-size:0.92rem; color:var(--muted); font-family:monospace; padding-left:38px;">${escapeHtml(project.projectId)} · <strong style="color:var(--text)">${escapeHtml(project.status)}</strong> · ${ptlDeliveryLabel(project)} <strong style="color:var(--text)">${ptlFmtFull(ptlDeliveryValue(project))}</strong></div>
    </div>
    <div style="flex:1 1 auto; display:flex; min-height:0;">
      <div style="flex:1 1 auto; min-width:0; display:flex; flex-direction:column;">
        <div id="ptl-fs-scroller" style="flex:1 1 auto; min-height:0; overflow-x:auto; overflow-y:hidden; cursor:grab; background:var(--bg,#f0f4f8);"></div>
        <div style="flex:none; border-top:1px solid var(--border); background:var(--card); padding:8px 18px; display:flex; flex-wrap:wrap; align-items:center; gap:6px 20px; font-size:0.74rem; color:var(--muted);">
          <span style="color:var(--accent);">● Complete</span><span style="color:var(--accent);">○ Scheduled</span><span style="color:#e84545;">○ Overdue</span><span>— Done so far</span><span style="opacity:.6;">┄ Still to come</span>
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
  // Planned is omitted entirely for the handful of Stage 1/2 nodes that
  // have no planned/estimate concept at all (Order Acceptance Sent, PO
  // Uploaded, Project Activated, MFC from Customer, Internal MFC) —
  // showing "Planned: —" there implied a value that was never coming.
  // New Target only ever applies to Stage 4 (Production's own steps),
  // and even there only when it's actually been revised off Planned —
  // every other stage (Drawing Sent/Approved, all of Stage 3, all of
  // Stage 5) has no separate "target" concept, just Planned vs Actual.
  if (info.planned) h += row("Planned", ptlFmt(info.planned));
  if (info.stage === 4 && info.eff && info.eff !== info.planned) h += row("New Target", ptlFmt(info.eff));
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

/* ═══════════════════════════════════════════════════════════════════════
   LD (Liquidated Damages) — per-project panel + cross-project board.
   Money is only ever computed server-side (lib/ld.js) from a CONFIRMED
   project.ld_terms row — this file only displays what the server sends
   and collects a human's review before calling saveLdTerms. No shared
   INR formatter exists in this codebase (see shared/format.js) — house
   pattern is inline toLocaleString('en-IN'), same as everywhere else.
   ═══════════════════════════════════════════════════════════════════════ */
const ptlFmtINR = (n) => (n == null ? "—" : "₹" + Math.round(Number(n)).toLocaleString("en-IN"));

const PTL_LD_STATUS_META = {
  unknown:             { label: "LD terms not reviewed",                    color: "#92400e", bg: "#fffbeb" },
  pending_review:      { label: "LD candidate awaiting confirmation",       color: "#92400e", bg: "#fffbeb" },
  not_applicable:      { label: "No LD clause on this PO",                  color: "#6b7a8d", bg: "#f1f5f9" },
  no_basis:            { label: "LD terms confirmed — PO value unresolved", color: "#92400e", bg: "#fffbeb" },
  on_time:             { label: "No LD exposure at current projection",     color: "#15803d", bg: "#f0fdf4" },
  accruing_projected:  { label: "LD accruing (projected)",                  color: "#b45309", bg: "#fff7ed" },
  accrued_final:       { label: "LD accrued (final)",                      color: "#b91c1c", bg: "#fef2f2" },
  at_cap:              { label: "LD at cap",                               color: "#b91c1c", bg: "#fef2f2" },
  uncapped:            { label: "LD accruing — uncapped clause",           color: "#b91c1c", bg: "#fef2f2" },
};
const PTL_LD_MONEY_STATUSES = new Set(["accruing_projected", "accrued_final", "at_cap", "uncapped"]);

function ptlLdSummaryHtml() {
  if (!ptlData || !ptlData.ld) return "";
  const meta = PTL_LD_STATUS_META[ptlData.ld.status] || PTL_LD_STATUS_META.unknown;
  const amount = PTL_LD_MONEY_STATUSES.has(ptlData.ld.status) ? ptlFmtINR(ptlData.ld.ld) + " — " : "";
  return `<div style="margin-top:8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
    <span style="font-size:0.74rem; font-weight:700; padding:3px 10px; border-radius:12px; background:${meta.bg}; color:${meta.color};">${amount}${escapeHtml(meta.label)}</span>
    <button type="button" onclick="ptlOpenLdPanel()" style="font-size:0.72rem; font-weight:700; padding:3px 10px; border:1px solid ${meta.color}; border-radius:12px; background:#fff; color:${meta.color}; cursor:pointer;">LD Terms</button>
  </div>`;
}

function ptlLdChipHtml() {
  if (!ptlData || !ptlData.ld || !PTL_LD_MONEY_STATUSES.has(ptlData.ld.status)) return "";
  const meta = PTL_LD_STATUS_META[ptlData.ld.status];
  return `<button type="button" onclick="ptlOpenLdPanel()" title="${escapeHtml(meta.label)}" style="flex:none; font-size:0.78rem; font-weight:700; padding:6px 12px; border-radius:var(--radius); border:1px solid ${meta.color}; background:${meta.bg}; color:${meta.color}; cursor:pointer;">LD ${ptlFmtINR(ptlData.ld.ld)}</button>`;
}

/* ── LD Terms review/confirm panel ────────────────────────────────────── */
let ptlLdPanelState = null;

async function ptlOpenLdPanel() {
  if (!ptlData) return;
  let ov = document.getElementById("ptl-ld-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "ptl-ld-overlay";
    ov.style.cssText = "position:fixed; inset:0; z-index:9600; background:rgba(15,23,42,0.5); display:flex; align-items:center; justify-content:center; padding:20px;";
    ov.addEventListener("click", (e) => { if (e.target === ov) ptlCloseLdPanel(); });
    document.body.appendChild(ov);
  }
  ov.style.display = "flex";
  ov.innerHTML = `<div style="background:var(--card); border-radius:var(--radius); max-width:660px; width:100%; max-height:88vh; overflow-y:auto; box-shadow:0 20px 60px -12px rgba(0,0,0,.4);"><div id="ptl-ld-panel-body" style="padding:22px;"></div></div>`;

  const t = ptlData.ldTerms;
  ptlLdPanelState = {
    projectId: ptlData.project.projectId,
    form: t ? {
      ldApplicable: t.ldApplicable, ratePercent: t.ratePercent, periodUnit: t.periodUnit || "week",
      periodBasis: t.periodBasis || "calendar", partPeriodRule: t.partPeriodRule || "part_thereof",
      capPercent: t.capPercent, basisKind: t.basisKind || "whole_po_basic", graceDays: t.graceDays || 0,
      currency: t.currency || "INR", usdRate: t.usdRate,
      contractualDateManual: t.contractualDateSource === "manual" ? t.contractualDate : "",
      basisAmountInr: t.basisAmountInr, basisAmountSource: t.basisAmountSource, sourceText: t.sourceText || "",
      parseProvenance: t.parseProvenance, parseModel: t.parseModel, notes: t.notes || "",
    } : {
      ldApplicable: true, periodUnit: "week", periodBasis: "calendar", partPeriodRule: "part_thereof",
      capPercent: null, basisKind: "whole_po_basic", graceDays: 0, currency: "INR", usdRate: null,
      // Defaults to the LD clause text already extracted off this PO at
      // upload time (project.projects.ld_clause) — shown up front so the
      // reviewer can see/edit it before ever clicking Process, rather than
      // it only being used invisibly server-side as extractLdTermsPreview's
      // own fallback when no clauseText is sent.
      contractualDateManual: "", basisAmountInr: null, basisAmountSource: null, sourceText: ptlData.project.ldClause || "",
      parseProvenance: "manual", parseModel: null, notes: "",
    },
    candidateQuotes: [], candidateUnresolved: [], candidateConfidence: null,
    basisCandidates: null, loadingBasis: true, loadingParse: false,
  };
  ptlRenderLdPanel();

  try {
    const bd = await apFetch({ action: "resolveLdBasisAmount", projectId: ptlLdPanelState.projectId });
    if (bd.success) ptlLdPanelState.basisCandidates = bd;
  } catch (e) { /* non-fatal — panel still works with manual entry */ }
  ptlLdPanelState.loadingBasis = false;
  ptlRenderLdPanel();
}

function ptlCloseLdPanel() {
  const ov = document.getElementById("ptl-ld-overlay");
  if (ov) ov.style.display = "none";
  ptlLdPanelState = null;
}

function ptlLdFormSet(key, value) {
  if (!ptlLdPanelState) return;
  ptlLdPanelState.form[key] = value;
}

async function ptlParseLdClauseNow() {
  if (!ptlLdPanelState) return;
  ptlLdPanelState.loadingParse = true;
  ptlRenderLdPanel();
  try {
    const clauseText = ptlLdPanelState.form.sourceText && ptlLdPanelState.form.sourceText.trim()
      ? ptlLdPanelState.form.sourceText : undefined;
    const data = await apFetch({ action: "extractLdTermsPreview", projectId: ptlLdPanelState.projectId, clauseText });
    if (!data.success) { alert(data.error || "Could not parse this clause."); ptlLdPanelState.loadingParse = false; ptlRenderLdPanel(); return; }
    const c = data.candidate;
    Object.assign(ptlLdPanelState.form, {
      ldApplicable: c.ldApplicable, ratePercent: c.ratePercent, periodUnit: c.periodUnit,
      periodBasis: c.periodBasis, partPeriodRule: c.partPeriodRule, capPercent: c.capPercent,
      basisKind: c.basisKind, graceDays: c.graceDays, currency: c.currency, sourceText: data.sourceText,
      parseProvenance: "gemini", parseModel: data.parseModel,
    });
    ptlLdPanelState.candidateQuotes = c.quotes || [];
    ptlLdPanelState.candidateUnresolved = c.unresolved || [];
    ptlLdPanelState.candidateConfidence = c.confidence;
    ptlLdPanelState.parseRaw = c;
  } catch (e) {
    alert("Network error: " + e.message);
  }
  ptlLdPanelState.loadingParse = false;
  ptlRenderLdPanel();
}

async function ptlSaveLdTerms() {
  if (!ptlLdPanelState) return;
  const f = ptlLdPanelState.form;
  if (f.ldApplicable && !(Number(f.ratePercent) > 0)) { alert("Rate percent is required."); return; }
  try {
    const data = await apFetch({
      action: "saveLdTerms", operatorName: appActiveOperatorIdentityString, projectId: ptlLdPanelState.projectId,
      ldApplicable: f.ldApplicable, ratePercent: f.ratePercent, periodUnit: f.periodUnit, periodBasis: f.periodBasis,
      partPeriodRule: f.partPeriodRule, capPercent: f.capPercent || null, basisKind: f.basisKind, graceDays: f.graceDays,
      currency: f.currency, usdRate: f.usdRate || null, contractualDateManual: f.contractualDateManual || null,
      basisAmountInr: f.basisAmountInr || null, basisAmountSource: f.basisAmountSource,
      sourceText: f.sourceText, parseProvenance: f.parseProvenance, parseModel: f.parseModel,
      parseRaw: ptlLdPanelState.parseRaw || null, notes: f.notes,
    });
    if (!data.success) { alert(data.error || "Could not save LD terms."); return; }
    ptlCloseLdPanel();
    await selectPtlProject(ptlData.project.projectId);
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

async function ptlExtendLdDate() {
  const newDate = document.getElementById("ptl-ld-extend-date")?.value;
  const reason = document.getElementById("ptl-ld-extend-reason")?.value;
  const documentRef = document.getElementById("ptl-ld-extend-docref")?.value;
  if (!newDate || !reason || !reason.trim()) { alert("A new date and a reason are both required."); return; }
  try {
    const data = await apFetch({
      action: "extendLdContractualDate", operatorName: appActiveOperatorIdentityString,
      projectId: ptlLdPanelState.projectId, newDate, reason: reason.trim(), documentRef,
    });
    if (!data.success) { alert(data.error || "Could not extend this date."); return; }
    ptlCloseLdPanel();
    await selectPtlProject(ptlData.project.projectId);
  } catch (e) {
    alert("Network error: " + e.message);
  }
}

function ptlRenderLdPanel() {
  const body = document.getElementById("ptl-ld-panel-body");
  if (!body || !ptlLdPanelState) return;
  const f = ptlLdPanelState.form;
  const canWrite = !!ptlData.canWriteLd;
  const t = ptlData.ldTerms;
  const isConfirmed = !!(t && t.confirmedAt);

  const field = (label, inputHtml) => `<div style="margin-bottom:10px;"><label style="display:block; font-size:0.72rem; font-weight:700; color:var(--muted); margin-bottom:3px;">${label}</label>${inputHtml}</div>`;
  const inputStyle = "width:100%; padding:7px 9px; border:1.5px solid var(--border); border-radius:6px; font-size:0.82rem; box-sizing:border-box;";
  const dis = canWrite ? "" : "disabled";

  let html = `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
    <h2 style="margin:0; font-size:1rem; font-weight:800; color:var(--text);">LD Terms — ${escapeHtml(ptlLdPanelState.projectId)}</h2>
    <button type="button" onclick="ptlCloseLdPanel()" style="border:0; background:none; font-size:1.3rem; line-height:1; cursor:pointer; color:var(--muted);">&times;</button>
  </div>`;

  if (!canWrite) {
    html += `<div style="background:#f1f5f9; border-radius:6px; padding:8px 12px; font-size:0.78rem; color:var(--muted); margin-bottom:14px;">View only — only Marketing, Project, or an admin can confirm LD terms.</div>`;
  }

  html += field("This PO has an LD clause",
    `<label style="display:flex; align-items:center; gap:8px; font-size:0.82rem;">
      <input type="checkbox" style="width:auto;" ${f.ldApplicable ? "checked" : ""} ${dis} onchange="ptlLdFormSet('ldApplicable', this.checked); ptlRenderLdPanel();" /> Applicable
    </label>`);

  if (f.ldApplicable) {
    html += field("Clause text (source, or paste terms captured outside the PO)",
      `<textarea ${dis} rows="3" style="${inputStyle} resize:vertical;" oninput="ptlLdFormSet('sourceText', this.value)">${escapeHtml(f.sourceText || "")}</textarea>`);
    if (canWrite) {
      html += `<button type="button" onclick="ptlParseLdClauseNow()" ${ptlLdPanelState.loadingParse ? "disabled" : ""} style="margin-bottom:12px; padding:6px 12px; font-size:0.78rem; font-weight:700; border:1.5px solid var(--brand); border-radius:6px; background:#fff; color:var(--brand); cursor:pointer;">${ptlLdPanelState.loadingParse ? "Processing..." : "Process with AI"}</button>`;
    }
    if (ptlLdPanelState.candidateQuotes.length || ptlLdPanelState.candidateUnresolved.length) {
      html += `<div style="background:#f7fafd; border:1px solid var(--border); border-radius:6px; padding:10px 12px; margin-bottom:12px; font-size:0.76rem;">
        <div style="font-weight:700; margin-bottom:4px;">AI read (confidence: ${escapeHtml(ptlLdPanelState.candidateConfidence || "—")})</div>
        ${ptlLdPanelState.candidateQuotes.map(q => `<div style="color:var(--muted); font-style:italic; margin-bottom:2px;">"${escapeHtml(q)}"</div>`).join("")}
        ${ptlLdPanelState.candidateUnresolved.map(u => `<div style="color:#b45309; margin-top:4px;">⚠ ${escapeHtml(u)}</div>`).join("")}
      </div>`;
    }

    html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:0 12px;">`
      + field("Rate %", `<input type="number" step="0.001" ${dis} value="${f.ratePercent ?? ""}" style="${inputStyle}" oninput="ptlLdFormSet('ratePercent', this.value)" />`)
      + field("Per", `<select ${dis} style="${inputStyle}" onchange="ptlLdFormSet('periodUnit', this.value)">
          ${["week","day","month"].map(u => `<option value="${u}" ${f.periodUnit === u ? "selected" : ""}>${u}</option>`).join("")}
        </select>`)
      + field("Counted in", `<select ${dis} style="${inputStyle}" onchange="ptlLdFormSet('periodBasis', this.value)">
          <option value="calendar" ${f.periodBasis === "calendar" ? "selected" : ""}>Calendar days/weeks</option>
          <option value="business" ${f.periodBasis === "business" ? "selected" : ""}>Business days/weeks</option>
        </select>`)
      + field("Part period", `<select ${dis} style="${inputStyle}" onchange="ptlLdFormSet('partPeriodRule', this.value)">
          <option value="part_thereof" ${f.partPeriodRule === "part_thereof" ? "selected" : ""}>Or part thereof</option>
          <option value="completed_only" ${f.partPeriodRule === "completed_only" ? "selected" : ""}>Completed periods only</option>
          <option value="pro_rata" ${f.partPeriodRule === "pro_rata" ? "selected" : ""}>Pro-rata</option>
        </select>`)
      + field("Cap % (blank = uncapped)", `<input type="number" step="0.001" ${dis} value="${f.capPercent ?? ""}" style="${inputStyle}" oninput="ptlLdFormSet('capPercent', this.value)" placeholder="Uncapped" />`)
      + field("Grace days", `<input type="number" ${dis} value="${f.graceDays ?? 0}" style="${inputStyle}" oninput="ptlLdFormSet('graceDays', this.value)" />`)
      + field("Basis", `<select ${dis} style="${inputStyle}" onchange="ptlLdFormSet('basisKind', this.value)">
          <option value="whole_po_basic" ${f.basisKind === "whole_po_basic" ? "selected" : ""}>Whole PO value</option>
          <option value="delayed_goods_basic" ${f.basisKind === "delayed_goods_basic" ? "selected" : ""}>Delayed goods only (not yet supported — falls back to whole PO)</option>
        </select>`)
      + field("Currency", `<select ${dis} style="${inputStyle}" onchange="ptlLdFormSet('currency', this.value); ptlRenderLdPanel();">
          <option value="INR" ${f.currency === "INR" ? "selected" : ""}>INR</option>
          <option value="USD" ${f.currency === "USD" ? "selected" : ""}>USD</option>
        </select>`)
      + (f.currency !== "INR" ? field("INR per unit", `<input type="number" step="0.0001" ${dis} value="${f.usdRate ?? ""}" style="${inputStyle}" oninput="ptlLdFormSet('usdRate', this.value)" />`) : "")
      + `</div>`;

    const currentContractual = t?.contractualDate || ptlData.project.tentativeDelivery;
    html += field(`Contractual delivery date${t?.contractualDateSource === "po_delivery_date" ? " (from PO Tentative Delivery Date)" : ""}`,
      isConfirmed
        ? `<div style="padding:7px 0; font-size:0.85rem; font-weight:700;">${ptlFmtFull(currentContractual)} — frozen once confirmed; use "Extend Date" below to change it.</div>`
        : `<input type="date" ${dis} value="${f.contractualDateManual || currentContractual || ""}" style="${inputStyle}" oninput="ptlLdFormSet('contractualDateManual', this.value)" />`);

    // Basis amount — two independently-typed candidates that are NOT
    // guaranteed to agree (see routes/timeline.js's resolveLdBasisAmount) —
    // never auto-pick one.
    const bc = ptlLdPanelState.basisCandidates;
    html += `<div style="margin:12px 0;"><label style="display:block; font-size:0.72rem; font-weight:700; color:var(--muted); margin-bottom:5px;">PO basis value</label>`;
    if (ptlLdPanelState.loadingBasis) {
      html += `<div style="font-size:0.8rem; color:var(--muted);">Resolving PO value…</div>`;
    } else if (bc) {
      const opt = (source, amount, label) => amount == null ? "" : `<label style="display:flex; align-items:center; gap:8px; font-size:0.82rem; margin-bottom:6px; cursor:pointer;">
        <input type="radio" name="ptl-ld-basis" style="width:auto; flex:none;" ${dis} ${f.basisAmountSource === source ? "checked" : ""}
          onchange="ptlLdFormSet('basisAmountSource','${source}'); ptlLdFormSet('basisAmountInr', ${amount}); ptlRenderLdPanel();" />
        <span>${label}: <strong>${ptlFmtINR(amount)}</strong></span>
      </label>`;
      html += opt("po_line_items_sum", bc.candidates.poLineItemsSum, "Sum of PO line items");
      html += opt("basic_po_amount", bc.candidates.basicPoAmount, "Basic PO Amount (as typed on PO upload)");
      if (bc.delta != null && bc.delta > 0) {
        html += `<div style="font-size:0.76rem; color:#b45309; margin:4px 0 8px;">⚠ These two figures differ by ${ptlFmtINR(bc.delta)} — pick the correct one.</div>`;
      }
      html += `<label style="display:flex; align-items:center; gap:8px; font-size:0.82rem; cursor:pointer;">
        <input type="radio" name="ptl-ld-basis" style="width:auto; flex:none;" ${dis} ${f.basisAmountSource === "manual" ? "checked" : ""}
          onchange="ptlLdFormSet('basisAmountSource','manual'); ptlRenderLdPanel();" /> Manual:
        <input type="number" ${dis} value="${f.basisAmountSource === "manual" ? (f.basisAmountInr ?? "") : ""}" style="width:160px; flex:none; padding:5px 8px; border:1.5px solid var(--border); border-radius:6px; font-size:0.8rem;"
          oninput="ptlLdFormSet('basisAmountSource','manual'); ptlLdFormSet('basisAmountInr', this.value)" />
      </label>`;
    }
    html += `</div>`;

    html += field("Notes", `<textarea ${dis} rows="2" style="${inputStyle} resize:vertical;" oninput="ptlLdFormSet('notes', this.value)">${escapeHtml(f.notes || "")}</textarea>`);
  }

  if (canWrite) {
    html += `<button type="button" onclick="ptlSaveLdTerms()" style="margin-top:8px; padding:9px 18px; font-size:0.85rem; font-weight:700; border:0; border-radius:var(--radius); background:var(--brand); color:#fff; cursor:pointer;">${isConfirmed ? "Save changes" : "Confirm LD Terms"}</button>`;
  }

  if (isConfirmed && f.ldApplicable && canWrite) {
    html += `<div style="margin-top:22px; padding-top:16px; border-top:1px solid var(--border);">
      <h3 style="margin:0 0 8px; font-size:0.85rem; font-weight:800; color:var(--text);">Extend contractual date</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 12px;">
        ${field("New date", `<input type="date" id="ptl-ld-extend-date" style="${inputStyle}" />`)}
        ${field("Reference (amendment/LOI, optional)", `<input type="text" id="ptl-ld-extend-docref" style="${inputStyle}" />`)}
      </div>
      ${field("Reason (required)", `<textarea id="ptl-ld-extend-reason" rows="2" style="${inputStyle} resize:vertical;"></textarea>`)}
      <button type="button" onclick="ptlExtendLdDate()" style="padding:8px 16px; font-size:0.82rem; font-weight:700; border:1.5px solid var(--brand); border-radius:var(--radius); background:#fff; color:var(--brand); cursor:pointer;">Extend Date</button>
    </div>`;
  }

  if ((ptlData.ldHistory || []).length) {
    html += `<div style="margin-top:18px; padding-top:12px; border-top:1px solid var(--border);">
      <h3 style="margin:0 0 8px; font-size:0.82rem; font-weight:800; color:var(--text);">Date extension history</h3>
      ${ptlData.ldHistory.map(h => `<div style="font-size:0.76rem; color:var(--muted); margin-bottom:6px;">
        ${ptlFmt(h.oldDate)} → <strong style="color:var(--text)">${ptlFmt(h.newDate)}</strong> — ${escapeHtml(h.reason)}
        <span style="opacity:0.7;"> (${escapeHtml(h.changedBy || "")}, ${ptlFmt(h.changedAt)})</span>
      </div>`).join("")}
    </div>`;
  }

  body.innerHTML = html;
}

/* ── LD Exposure Board — cross-project, ranked by MARGINAL value (what
   expediting is actually worth), not total exposure. A project sitting
   at its LD cap is worth ₹0 to expedite even if its total figure is the
   largest on the board — see lib/ld.js's header for why. ─────────────── */
async function ptlOpenLdBoard() {
  let ov = document.getElementById("ptl-ldboard-overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "ptl-ldboard-overlay";
    ov.style.cssText = "position:fixed; inset:0; z-index:9600; background:rgba(15,23,42,0.5); display:flex; align-items:center; justify-content:center; padding:20px;";
    ov.addEventListener("click", (e) => { if (e.target === ov) ptlCloseLdBoard(); });
    document.body.appendChild(ov);
  }
  ov.style.display = "flex";
  ov.innerHTML = `<div style="background:var(--card); border-radius:var(--radius); max-width:960px; width:100%; max-height:88vh; overflow-y:auto; box-shadow:0 20px 60px -12px rgba(0,0,0,.4);"><div id="ptl-ldboard-body" style="padding:22px;">Loading…</div></div>`;

  try {
    const data = await apFetch({ action: "fetchLdExposureBoard" });
    if (!data.success) { document.getElementById("ptl-ldboard-body").innerHTML = `<div style="color:#b91c1c;">${escapeHtml(data.error || "Could not load the LD board.")}</div>`; return; }
    ptlRenderLdBoard(data.board || [], data.realised || []);
  } catch (e) {
    document.getElementById("ptl-ldboard-body").innerHTML = `<div style="color:#b91c1c;">Network error: ${escapeHtml(e.message)}</div>`;
  }
}

function ptlCloseLdBoard() {
  const ov = document.getElementById("ptl-ldboard-overlay");
  if (ov) ov.style.display = "none";
}

function ptlRenderLdBoard(board, realised) {
  const body = document.getElementById("ptl-ldboard-body");
  if (!body) return;

  const expeditable = board.filter(r => r.ld.marginal > 0);
  const atCap = board.filter(r => !(r.ld.marginal > 0));

  const row = (r, showMarginal) => `<tr style="border-bottom:1px solid var(--border);">
    <td style="padding:8px 10px; font-weight:700; cursor:pointer; color:var(--brand);" onclick="ptlCloseLdBoard(); selectPtlProject('${r.projectId.replace(/'/g, "\\'")}');">${escapeHtml(r.projectId)}</td>
    <td style="padding:8px 10px; font-size:0.82rem; color:var(--muted);">${escapeHtml(r.companyName || "—")}</td>
    <td style="padding:8px 10px; text-align:right;">${ptlFmtINR(r.ld.ld)}</td>
    ${showMarginal ? `<td style="padding:8px 10px; text-align:right; font-weight:700; color:#15803d;">${ptlFmtINR(r.ld.marginal)}</td>
    <td style="padding:8px 10px; text-align:right;">${r.ld.daysToNextStep != null ? r.ld.daysToNextStep + "d" : "—"}</td>
    <td style="padding:8px 10px; text-align:right; font-size:0.82rem; color:var(--muted);">${r.ld.rupeesPerDaySaved ? ptlFmtINR(r.ld.rupeesPerDaySaved) + "/day" : "—"}</td>` : `<td style="padding:8px 10px; text-align:right; color:var(--muted);">—</td><td></td><td></td>`}
  </tr>`;

  let html = `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
    <h2 style="margin:0; font-size:1.05rem; font-weight:800; color:var(--text);">LD Exposure Board</h2>
    <button type="button" onclick="ptlCloseLdBoard()" style="border:0; background:none; font-size:1.3rem; line-height:1; cursor:pointer; color:var(--muted);">&times;</button>
  </div>
  <p style="font-size:0.8rem; color:var(--muted); margin:0 0 14px;">Ranked by what expediting each project is actually worth — the rupees recoverable by beating the next LD step — not by total exposure. A project already at its LD cap recovers nothing further and is listed separately.</p>`;

  if (!expeditable.length && !atCap.length) {
    html += `<div style="padding:24px; text-align:center; color:var(--muted); font-size:0.85rem;">No active project has confirmed, applicable LD terms yet.</div>`;
  } else {
    html += `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
      <thead><tr style="border-bottom:2px solid var(--border); text-align:left;">
        <th style="padding:8px 10px;">Project</th><th style="padding:8px 10px;">Company</th>
        <th style="padding:8px 10px; text-align:right;">Current exposure</th>
        <th style="padding:8px 10px; text-align:right;">Value of expediting</th>
        <th style="padding:8px 10px; text-align:right;">Next step in</th>
        <th style="padding:8px 10px; text-align:right;">₹/day</th>
      </tr></thead><tbody>${expeditable.map(r => row(r, true)).join("")}</tbody></table>`;
  }

  if (atCap.length) {
    html += `<h3 style="margin:20px 0 8px; font-size:0.85rem; font-weight:800; color:var(--muted);">At LD cap — nothing further recoverable</h3>
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <tbody>${atCap.map(r => row(r, false)).join("")}</tbody></table>`;
  }

  if (realised.length) {
    html += `<h3 style="margin:20px 0 8px; font-size:0.85rem; font-weight:800; color:var(--muted);">Already dispatched — realised LD</h3>
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <tbody>${realised.map(r => row(r, false)).join("")}</tbody></table>`;
  }

  body.innerHTML = html;
}
