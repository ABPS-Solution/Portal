// project/project-timeline.js — Project Timeline Tracking (Project
// department, after Manufacturing Clearance). Phase 1: Stages 1-3 only,
// rendered on the schematic-timeline canvas designed and verified in
// prototype form (business-day math, branching-capable node/label
// renderer, colour-as-state). Stage 4 (production lanes) and Stage 5
// (QA/dispatch) render as a locked placeholder until their own tables
// and screens land — routes/timeline.js's mfcComplete flag is what gates
// that, not a guess made here.
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

  body.innerHTML = header + ptlRenderList(trunk, today) + `
    <div style="margin-top:18px; background:var(--highlight-bg); border:1px dashed var(--border); border-radius:var(--radius); padding:14px; font-size:0.82rem; color:var(--muted);">
      Stage 4 (Production) and Stage 5 (Inspection &amp; Dispatch) are not built yet — they land with their own screens (production planning per product, then QA/dispatch).
    </div>`;
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
