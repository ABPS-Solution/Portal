// ═══════════════════════════════════════════════════════════════════════
// project/daily-timeline.js — Project > Daily Timeline.
//
// Cross-project, department-grouped "what is due today, across
// everything" board — the inverse question of project-timeline.js (which
// answers "where is THIS project?" one project at a time). A Steps list
// grouped by DEPARTMENT (not stage), with a project/lead badge on every
// row so it's always clear what the item is against. Zoom is limited to
// Today (1 day) and This Week (7 days, Mon-Sun — Sunday is shown,
// colored as a rest day, same as Project Timeline's own canvas) — wider
// windows put too much on screen at once for a cross-project view.
//
// A Timeline SVG canvas view (one column per day, department-clustered)
// used to sit alongside Steps here, faithful to Project Timeline's own
// canvas grammar. Removed 14 Sep 2026 (explicit request): with 40-50+
// items due on a busy day it stopped being readable, and Steps was the
// view actually in use. If a cross-project visual timeline is wanted
// again, don't just restore this — the same volume problem would recur;
// design for the real item counts first.
//
// Every top-level name here is prefixed dtl/DTL_ to avoid colliding with
// project-timeline.js's ptl* globals or any other file — this app is one
// global scope (CLAUDE.md §1), so a duplicate top-level declaration is a
// fatal app-wide SyntaxError. PTL_COLORS/PTL_DEPT_NAME/PTL_SCHEDULED_GREY
// and ptlToday()/ptlIsAdmin() (project-timeline.js) are reused directly
// rather than duplicated — a second palette/clock would only drift.
//
// Do NOT call ptlBuildDayRange/ptlRenderCanvas/ptlPlacer — those read
// ptlData/ptlDays module globals scoped to the single-project screen and
// would be wrong here; this file builds its own, much simpler day range
// (1 or 7 days, not project-milestone-driven).
// ═══════════════════════════════════════════════════════════════════════

const DTL_MODES = { today: 1, week: 7 };
// Canonical department order (matches admin_db.departments' fixed order,
// restricted to the departments this screen's seven sources ever emit —
// Accounts/HR/Service own no project-dated work today, see the plan's
// §4 "explicitly out of scope").
const DTL_DEPT_ORDER = ['marketing', 'project', 'design', 'purchase', 'store', 'qa', 'production'];

let dtlAnchorDate = null;          // "YYYY-MM-DD" — the date/week the view is centred on
let dtlMode = 'today';             // 'today' | 'week'
let dtlData = null;                // { items, overdue, truncated, holidays }
let dtlItemsById = new Map();      // id -> item, merged from items + overdue, for click routing
let dtlDays = [];                  // array of "YYYY-MM-DD" for the current window
let dtlCollapsedDepts = new Set(); // Steps view section collapse state, keyed by dept or '__overdue__'
let dtlActiveDeptFilters = new Set(DTL_DEPT_ORDER); // all on by default — this is a coordination view
let dtlDateFilter = null;          // scopes Steps to one date; currently only ever cleared, no UI sets it since the Timeline "+N more" pill that used to set it was removed
let dtlLastHighlightEl = null;

// ── Small local helpers (deliberately not sharing ptl*'s versions — those
//    are correct for this too, but keeping this file self-contained means
//    a future edit to project-timeline.js's date math can't silently
//    change this screen's behaviour underneath it). ─────────────────────
const DTL_DAYMS = 86400000;
const dtlParse = s => new Date(s + 'T00:00:00Z');
const dtlIsoOf = d => d.toISOString().slice(0, 10);
function dtlAddDays(iso, n) {
  const d = dtlParse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return dtlIsoOf(d);
}
function dtlToday() {
  // ptlToday() already handles the admin ptlTodayOverride localStorage key
  // + IST correctly — reuse it rather than re-deriving "today" a second
  // way. Falls back to a plain IST-shifted clock if project-timeline.js
  // hasn't loaded yet for some reason.
  if (typeof ptlToday === 'function') return ptlToday();
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}
function dtlTodayOverrideValue() {
  return (typeof ptlIsAdmin === 'function' && ptlIsAdmin()) ? localStorage.getItem('ptlTodayOverride') : null;
}
function dtlFmtDayShort(iso) {
  // "10th Sep" — same ordinal convention as the rest of the app
  // (formatOrdinalDate, shared/format.js), year stripped since the ruler
  // never spans more than 6 days.
  return formatOrdinalDate(iso).replace(/ \d{4}$/, '');
}
function dtlWeekdayShort(iso) {
  return dtlParse(iso).toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
function dtlDayIsRest(iso) {
  return dtlParse(iso).getUTCDay() === 0 || (dtlData && (dtlData.holidays || []).includes(iso));
}

// ═══════════════════════════════════════════════════════════════════════
// Shell + range control
// ═══════════════════════════════════════════════════════════════════════

async function initializeDailyTimelinePanel() {
  const mount = document.getElementById('dtl-mount');
  if (!mount) return;
  dtlAnchorDate = dtlToday();
  dtlMode = 'today';
  dtlData = null;
  dtlItemsById = new Map();
  dtlDays = [];
  dtlCollapsedDepts = new Set();
  dtlActiveDeptFilters = new Set(DTL_DEPT_ORDER);
  dtlDateFilter = null;

  // The Timeline SVG canvas view was removed 14 Sep 2026 (explicit
  // request) — with 40-50+ items due on a busy day, the fan-out canvas
  // stopped being readable, and Steps (grouped by department, one row
  // per item) is the view that's actually used. Steps is now the only
  // view; dtl-header-left is left empty rather than removed from
  // index.html, in case a different header-left action is wanted later.
  const elHeaderLeft = document.getElementById('dtl-header-left');
  if (elHeaderLeft) elHeaderLeft.innerHTML = '';
  mount.innerHTML = `
    <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:14px;">
      <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; flex:none;">
        <button type="button" onclick="dtlStep(-1)" title="Previous" style="padding:8px 13px; border:0; background:#fff; cursor:pointer; font-weight:800; font-size:0.95rem;">&lsaquo;</button>
        <span id="dtl-range-label" style="padding:8px 14px; font-weight:700; font-size:0.85rem; background:#f7fafd; white-space:nowrap; border-left:1px solid var(--border); border-right:1px solid var(--border);"></span>
        <button type="button" onclick="dtlStep(1)" title="Next" style="padding:8px 13px; border:0; background:#fff; cursor:pointer; font-weight:800; font-size:0.95rem;">&rsaquo;</button>
      </div>
      <button type="button" onclick="dtlJumpToday()" style="flex:none; padding:8px 14px; font-size:0.82rem; font-weight:700; border:0; border-radius:var(--radius); background:var(--brand); color:#fff; cursor:pointer;">Today</button>
      <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; flex:none;">
        <button type="button" id="dtl-mode-today" onclick="dtlSetMode('today')" style="padding:8px 14px; border:0; cursor:pointer; font-weight:700; font-size:0.82rem;">Day</button>
        <button type="button" id="dtl-mode-week" onclick="dtlSetMode('week')" style="padding:8px 14px; border:0; border-left:1px solid var(--border); cursor:pointer; font-weight:700; font-size:0.82rem;">This Week</button>
      </div>
      <div id="dtl-dept-chips" style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;"></div>
    </div>
    <div id="dtl-feedback" style="display:none; padding:12px; border-radius:var(--radius); margin-bottom:14px; border-left:4px solid;"></div>
    <div id="dtl-counts" style="margin-bottom:10px; font-size:0.8rem; color:var(--muted); display:flex; align-items:center; gap:10px; flex-wrap:wrap;"></div>
    <div id="dtl-steps-wrap"></div>
  `;
  await dtlLoad();
}

function dtlComputeWindow() {
  if (dtlMode === 'today') return [dtlAnchorDate];
  // Monday-anchored, 7 days (Mon-Sun) — this business runs Monday to
  // Saturday for BUSINESS-DAY purposes (see CLAUDE.md's isBusinessDay
  // note, unchanged), but something can still genuinely be due/marked
  // done on a Sunday (see Project Timeline's own "draws every calendar
  // day" precedent) — Sunday is shown here too, same reasoning, just
  // colored as a rest day (dtlDayIsRest) rather than dropped from the
  // week entirely.
  const dow = dtlParse(dtlAnchorDate).getUTCDay(); // 0=Sun..6=Sat
  const offsetToMon = dow === 0 ? -6 : (1 - dow);
  const mon = dtlAddDays(dtlAnchorDate, offsetToMon);
  return Array.from({ length: 7 }, (_, i) => dtlAddDays(mon, i));
}

function dtlRangeLabelText() {
  if (dtlMode === 'today') return dtlFmtDayShort(dtlAnchorDate) + (dtlAnchorDate === dtlToday() ? ' (Today)' : '');
  const days = dtlDays.length ? dtlDays : dtlComputeWindow();
  return `${dtlFmtDayShort(days[0])} – ${dtlFmtDayShort(days[days.length - 1])}`;
}

function dtlStep(dir) {
  dtlAnchorDate = dtlAddDays(dtlAnchorDate, dir * DTL_MODES[dtlMode]);
  dtlLoad();
}
function dtlJumpToday() {
  dtlAnchorDate = dtlToday();
  dtlLoad();
}
function dtlSetMode(mode) {
  if (mode === dtlMode) return;
  dtlMode = mode;
  dtlLoad();
}
function dtlUpdateModeButtons() {
  const t = document.getElementById('dtl-mode-today');
  const w = document.getElementById('dtl-mode-week');
  if (t) { t.style.background = dtlMode === 'today' ? 'var(--brand)' : '#fff'; t.style.color = dtlMode === 'today' ? '#fff' : 'var(--text)'; }
  if (w) { w.style.background = dtlMode === 'week' ? 'var(--brand)' : '#fff'; w.style.color = dtlMode === 'week' ? '#fff' : 'var(--text)'; }
}

function dtlDeptChipsHtml() {
  return DTL_DEPT_ORDER.map(dept => {
    const active = dtlActiveDeptFilters.has(dept);
    const hue = PTL_COLORS[dept] || 'var(--brand)';
    return `<button type="button" onclick="dtlToggleDeptFilter('${dept}')"
      style="padding:5px 12px; font-size:0.74rem; font-weight:700; border-radius:14px; cursor:pointer; border:1.5px solid ${hue}; background:${active ? hue : '#fff'}; color:${active ? '#fff' : hue};">
      ${escapeHtml(PTL_DEPT_NAME[dept] || dept)}</button>`;
  }).join('');
}
function dtlToggleDeptFilter(dept) {
  if (dtlActiveDeptFilters.has(dept)) dtlActiveDeptFilters.delete(dept);
  else dtlActiveDeptFilters.add(dept);
  const chipsEl = document.getElementById('dtl-dept-chips');
  if (chipsEl) chipsEl.innerHTML = dtlDeptChipsHtml();
  dtlRenderCounts();
  dtlRenderSteps();
}

async function dtlLoad() {
  const wrap = document.getElementById('dtl-steps-wrap');
  if (wrap) wrap.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Loading Daily Timeline...</div>`;
  const fb = document.getElementById('dtl-feedback');
  if (fb) fb.style.display = 'none';

  dtlDays = dtlComputeWindow();
  dtlUpdateModeButtons();
  const label = document.getElementById('dtl-range-label');
  if (label) label.textContent = dtlRangeLabelText();
  const chipsEl = document.getElementById('dtl-dept-chips');
  if (chipsEl) chipsEl.innerHTML = dtlDeptChipsHtml();

  try {
    // fromIso/toIso are the exact window dtlDays just computed (Monday-
    // anchored in week mode) — sent explicitly rather than making the
    // backend re-derive a window from bare anchorDate+mode, which used to
    // silently disagree with this file's own Monday-snap whenever "today"
    // wasn't a Monday (backend was fetching anchorDate..anchorDate+5,
    // frontend was rendering Mon-Sat of that week — two different
    // windows, so items due earlier in the week never got fetched at all
    // and items due after the fetched range vanished with no explanation).
    const data = await apFetch({ action: 'fetchDailyTimeline', fromIso: dtlDays[0], toIso: dtlDays[dtlDays.length - 1], anchorDate: dtlAnchorDate, mode: dtlMode, todayOverride: dtlTodayOverrideValue() });
    if (!data.success) {
      dtlData = { items: [], overdue: [], truncated: { overdue: null }, holidays: [] };
      if (fb) {
        fb.style.cssText = 'display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:12px; margin-bottom:14px; border-left:4px solid #b91c1c;';
        fb.innerHTML = `<strong>Failed:</strong> ${escapeHtml(data.error || 'Could not load Daily Timeline.')}`;
      }
    } else {
      dtlData = data;
    }
  } catch (e) {
    dtlData = { items: [], overdue: [], truncated: { overdue: null }, holidays: [] };
    if (fb) {
      fb.style.cssText = 'display:block; background:#fee2e2; border-color:#b91c1c; color:#b91c1c; padding:12px; margin-bottom:14px; border-left:4px solid #b91c1c;';
      fb.innerHTML = `<strong>Network error:</strong> ${escapeHtml(e.message)}`;
    }
  }

  dtlItemsById = new Map();
  (dtlData.items || []).forEach(it => dtlItemsById.set(it.id, it));
  (dtlData.overdue || []).forEach(it => dtlItemsById.set(it.id, it));

  dtlRenderCounts();
  dtlRenderSteps();
}

function dtlRenderCounts() {
  const el = document.getElementById('dtl-counts');
  if (!el || !dtlData) return;
  const items = (dtlData.items || []).filter(it => dtlActiveDeptFilters.has(it.dept));
  const overdue = (dtlData.overdue || []).filter(it => dtlActiveDeptFilters.has(it.dept));
  const late = items.filter(it => it.late).length;
  let html = `<span>${items.length} item${items.length === 1 ? '' : 's'} in this window (${late} late) &middot; ${overdue.length} overdue &amp; still open</span>`;
  if (dtlDateFilter) {
    html += `<span style="display:inline-flex; align-items:center; gap:6px; padding:3px 10px; border-radius:12px; background:#eef2ff; color:#3730a3; font-weight:700;">
      Showing ${escapeHtml(formatOrdinalDate(dtlDateFilter))} only
      <a href="javascript:void(0)" onclick="dtlClearDateFilter()" style="color:#3730a3; text-decoration:underline; font-weight:700;">Clear</a>
    </span>`;
  }
  el.innerHTML = html;
}
function dtlClearDateFilter() {
  dtlDateFilter = null;
  dtlRenderCounts();
  dtlRenderSteps();
}

// ═══════════════════════════════════════════════════════════════════════
// Steps view — grouped by department (mirrors ptlRenderList/
// ptlRenderStageRows structurally, department substituted for stage)
// ═══════════════════════════════════════════════════════════════════════

function dtlToggleDeptCollapse(key) {
  if (dtlCollapsedDepts.has(key)) dtlCollapsedDepts.delete(key);
  else dtlCollapsedDepts.add(key);
  dtlRenderSteps();
}

// Production items carry subDept (Reactor/Capacitor/Panel, off
// design.boq_drafts.department — see lib/dailyTimeline.js's
// gatherPlanStepItems) matching admin_db.users.production_sub_dept, the
// same per-user attribute Production Planning's own write-gate uses
// (CLAUDE.md's Reactor/Capacitor/Panel fold-back note). Sub-grouping the
// Production section by this makes the board usable for someone who only
// owns one of the three — the "Production Planning" trunk milestone has
// no sub-department (it's a per-project gate, not sub-department-
// specific) and falls into its own General bucket.
const DTL_PROD_SUBDEPT_ORDER = ['Reactor', 'Capacitor', 'Panel'];
function dtlRenderProductionSubgroups(items) {
  const buckets = new Map([['General', []], ['Reactor', []], ['Capacitor', []], ['Panel', []]]);
  items.forEach(it => buckets.get(DTL_PROD_SUBDEPT_ORDER.includes(it.subDept) ? it.subDept : 'General').push(it));
  return ['General', ...DTL_PROD_SUBDEPT_ORDER].map(key => {
    const bucket = buckets.get(key);
    if (!bucket.length) return '';
    const subKey = 'production:' + key;
    const collapsed = dtlCollapsedDepts.has(subKey);
    const lateCount = bucket.filter(it => it.late).length;
    return `<div style="margin-left:14px; border-left:2px solid var(--border); margin-bottom:2px;">
      <div style="display:flex; align-items:center; gap:8px; padding:6px 10px; cursor:pointer; font-weight:700; font-size:0.78rem; color:var(--muted);" onclick="dtlToggleDeptCollapse('${subKey}')">
        <span>${collapsed ? '&#9656;' : '&#9662;'}</span>
        <span>${escapeHtml(key)} &middot; ${bucket.length}</span>
        ${lateCount ? `<span style="margin-left:auto; font-size:0.72rem; font-weight:700; color:#e84545;">${lateCount} late</span>` : ''}
      </div>
      ${collapsed ? '' : bucket.map(it => dtlRenderRow(it, false)).join('')}
    </div>`;
  }).join('');
}

// dtlStripToken — every source builds `context` by gluing projectId and/or
// companyName onto some descriptive text (see lib/dailyTimeline.js — the
// glue order varies per source: "projectId · companyName" for milestones,
// "companyName · contactPerson" for tasks/follow-ups, "productName rating
// · projectId" for planStep). Since projectId/companyName now get their
// own badge below, strip a leading/trailing exact match of either out of
// context before showing it, so the same id/name doesn't appear twice in
// one row — this was the actual cause of a BOQ id showing up twice on a
// planStep row (once as itself, once baked into the end of its context).
function dtlStripToken(ctx, token) {
  if (!token || !ctx) return ctx;
  const prefix = token + ' · ', suffix = ' · ' + token;
  if (ctx.startsWith(prefix)) return ctx.slice(prefix.length);
  if (ctx.endsWith(suffix)) return ctx.slice(0, -suffix.length);
  if (ctx === token) return '';
  return ctx;
}

function dtlRenderRow(it, isOverdueRow) {
  const late = !!it.late, done = !!it.done;
  const color = late ? '#e84545' : (done ? 'var(--accent)' : PTL_SCHEDULED_GREY);
  const today = dtlToday();
  const daysOverdue = isOverdueRow
    ? (it.daysOverdue != null ? it.daysOverdue : Math.max(0, Math.round((Date.parse(today) - Date.parse(it.due)) / DTL_DAYMS)))
    : null;

  // The one thing every row must make instantly clear: what project (or,
  // for lead-scoped Marketing items with no project yet, what company/
  // lead) this is against. projectId wins when present; companyName is
  // the practical stand-in for task/follow-up items, which have no
  // separate lead-id string in this dataset's shape.
  const badgeText = it.projectId || it.companyName || '';
  const badgeIsProject = !!it.projectId;

  const descParts = [];
  if (it.companyName && it.companyName !== badgeText) descParts.push(escapeHtml(it.companyName));
  let ctx = dtlStripToken(dtlStripToken(it.context || '', it.projectId), it.companyName).trim();
  if (ctx) descParts.push(escapeHtml(ctx));

  const hue = PTL_COLORS[it.dept] || 'var(--brand)';
  return `<div id="dtl-row-${escapeHtml(String(it.id))}" onclick="dtlOpenItemById('${escapeHtml(String(it.id)).replace(/'/g, "\\'")}')"
      style="display:flex; align-items:center; gap:12px; padding:9px 12px; border-bottom:1px solid var(--border); cursor:pointer;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background=''">
    <span style="flex:none; width:28px; height:28px; border-radius:50%; border:2.5px solid ${color}; background:${done ? color : '#fff'}; display:flex; align-items:center; justify-content:center; font-size:0.85rem; color:#fff; font-weight:800;">${done ? '&#10003;' : ''}</span>
    <span style="flex:none; width:3px; align-self:stretch; border-radius:2px; background:${hue};"></span>
    <span style="flex:1 1 auto; min-width:0;">
      <span style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span style="font-weight:700; font-size:0.86rem; color:var(--text); overflow-wrap:break-word;">${escapeHtml(it.label || '')}</span>
        ${badgeText ? `<span style="flex:none; font-size:0.68rem; font-weight:800; padding:2px 9px; border-radius:8px; background:${badgeIsProject ? '#eef2ff' : '#f0fdf4'}; color:${badgeIsProject ? '#3730a3' : '#15803d'}; ${badgeIsProject ? 'font-family:ui-monospace, SFMono-Regular, Menlo, monospace;' : ''} white-space:nowrap;">${escapeHtml(badgeText)}</span>` : ''}
      </span>
      ${descParts.length ? `<span style="display:block; font-size:0.76rem; color:var(--muted); overflow-wrap:break-word; margin-top:2px;">${descParts.join(' &middot; ')}</span>` : ''}
      ${it.detail ? `<span style="display:block; font-size:0.74rem; color:var(--muted); overflow-wrap:break-word; margin-top:2px;">${escapeHtml(it.detail)}</span>` : ''}
    </span>
    <span style="flex:none; font-size:0.76rem; font-weight:700; color:${late || isOverdueRow ? '#e84545' : 'var(--muted)'};">${isOverdueRow ? `${daysOverdue}d overdue` : `Due ${formatOrdinalDate(it.due)}`}</span>
    ${it.owner ? `<span style="flex:none; font-size:0.68rem; font-weight:700; padding:3px 9px; border-radius:10px; background:#eef2ff; color:#3730a3; white-space:nowrap;">${escapeHtml(it.owner)}</span>` : ''}
  </div>`;
}

function dtlRenderSteps() {
  const wrap = document.getElementById('dtl-steps-wrap');
  if (!wrap || !dtlData) return;

  let html = '';

  // Pinned "Overdue & still open" section, first, outside the selected window.
  let overdueAll = (dtlData.overdue || []).filter(it => dtlActiveDeptFilters.has(it.dept));
  if (dtlDateFilter) overdueAll = overdueAll.filter(it => it.due === dtlDateFilter);
  if (overdueAll.length) {
    overdueAll = overdueAll.slice().sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    const collapsed = dtlCollapsedDepts.has('__overdue__');
    const truncNote = (dtlData.truncated && dtlData.truncated.overdue)
      ? `<span style="font-weight:600; color:#7f1d1d; font-size:0.74rem;">&mdash; showing ${overdueAll.length} of ${dtlData.truncated.overdue}</span>`
      : '';
    html += `<div style="margin-bottom:18px;">
      <div style="display:flex; align-items:center; gap:8px; padding:9px 12px; background:#fee2e2; border-left:4px solid #b91c1c; border-radius:var(--radius); font-weight:800; color:#b91c1c; cursor:pointer;" onclick="dtlToggleDeptCollapse('__overdue__')">
        <span>${collapsed ? '&#9656;' : '&#9662;'}</span>
        <span>Overdue &amp; still open &middot; ${overdueAll.length}</span>
        ${truncNote}
      </div>
      ${collapsed ? '' : `<div>${overdueAll.map(it => dtlRenderRow(it, true)).join('')}</div>`}
    </div>`;
  }

  DTL_DEPT_ORDER.forEach(dept => {
    if (!dtlActiveDeptFilters.has(dept)) return;
    let items = (dtlData.items || []).filter(it => it.dept === dept);
    if (dtlDateFilter) items = items.filter(it => it.due === dtlDateFilter);
    if (!items.length) return;
    items = items.slice().sort((a, b) => (a.due || '').localeCompare(b.due || '') || (a.label || '').localeCompare(b.label || ''));
    const lateCount = items.filter(it => it.late).length;
    const dueCount = items.filter(it => !it.done && !it.late).length;
    const allDone = items.every(it => it.done);
    const collapsed = dtlCollapsedDepts.has(dept);
    const hue = PTL_COLORS[dept] || 'var(--brand)';
    html += `<div style="margin-bottom:14px;">
      <div style="display:flex; align-items:center; gap:8px; padding:9px 12px; background:${allDone ? '#f0fdf4' : '#f7fafd'}; border-left:4px solid ${allDone ? '#15803d' : hue}; border-radius:var(--radius); font-weight:800; color:${allDone ? '#15803d' : 'var(--text)'}; cursor:pointer;" onclick="dtlToggleDeptCollapse('${dept}')">
        <span>${collapsed ? '&#9656;' : '&#9662;'}</span>
        <span>${escapeHtml(PTL_DEPT_NAME[dept] || dept)} &middot; ${items.length}</span>
        ${allDone ? '<span style="margin-left:auto; font-size:0.74rem; font-weight:700; color:#15803d;">All done</span>'
          : lateCount ? `<span style="margin-left:auto; font-size:0.74rem; font-weight:700; color:#e84545;">${lateCount} late</span>`
          : dueCount ? `<span style="margin-left:auto; font-size:0.74rem; font-weight:700; color:var(--muted);">${dueCount} due</span>` : ''}
      </div>
      ${collapsed ? '' : `<div>${dept === 'production' ? dtlRenderProductionSubgroups(items) : items.map(it => dtlRenderRow(it, false)).join('')}</div>`}
    </div>`;
  });

  if (!html) html = `<div style="padding:30px; text-align:center; color:var(--muted);">Nothing due in this window.</div>`;
  wrap.innerHTML = html;
}

function dtlHighlightRow(el) {
  if (dtlLastHighlightEl && dtlLastHighlightEl !== el) {
    dtlLastHighlightEl.style.border = '';
    dtlLastHighlightEl.style.borderRadius = '';
  }
  if (el) { el.style.border = '2px solid #16a34a'; el.style.borderRadius = '8px'; }
  dtlLastHighlightEl = el;
}
function dtlFlashRow(id) {
  setTimeout(() => {
    const el = document.getElementById('dtl-row-' + id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    dtlHighlightRow(el);
  }, 30);
}

// ═══════════════════════════════════════════════════════════════════════
// Click routing — never a no-op. Known kinds route to their owning
// screen; anything else (or a screen this session can't reach) falls
// back to the Steps view with the row flashed, which always works.
// ═══════════════════════════════════════════════════════════════════════

function dtlOpenItemById(id) {
  dtlOpenItem(dtlItemsById.get(id));
}

function dtlOpenItem(it) {
  if (!it) return;
  const fallback = () => {
    if (dtlCollapsedDepts.has(it.dept)) dtlCollapsedDepts.delete(it.dept);
    if (dtlCollapsedDepts.has('__overdue__')) dtlCollapsedDepts.delete('__overdue__');
    if (it.dept === 'production') {
      const subKey = 'production:' + (DTL_PROD_SUBDEPT_ORDER.includes(it.subDept) ? it.subDept : 'General');
      dtlCollapsedDepts.delete(subKey);
    }
    dtlRenderSteps();
    dtlFlashRow(it.id);
  };
  try {
    switch (it.kind) {
      case 'milestone':
      case 'planStep':
        if (it.projectId && typeof switchActiveDashboardModule === 'function') {
          switchActiveDashboardModule('project-timeline');
          setTimeout(() => { if (typeof selectPtlProject === 'function') selectPtlProject(it.projectId); }, 60);
          return;
        }
        break;
      case 'task':
        // Marketing's Task board isn't a canvas-module screen with a
        // stable id this file can target directly — navigate to Search
        // Tasks by ABPS Engineer Name and Status, then actually set its
        // filters (engineer + Assigned) and run the search, rather than
        // leaving the viewer on a blank screen to re-filter by hand.
        if (typeof navigateToModule === 'function' && userPermissions && userPermissions.searchTasks) {
          navigateToModule('searchTasks');
          dtlApplyTaskFilterAndSearch(it);
          return;
        }
        break;
      case 'followUp':
        // Follow-ups live inside a Lead's own View Details, not a
        // dedicated board — the closest real screen is Search Leads by
        // ABPS Engineer Name and Status, filtered to this follow-up's
        // owner so the right Lead is easy to find among the results.
        if (typeof navigateToModule === 'function' && userPermissions && userPermissions.searchStatus) {
          navigateToModule('searchStatus');
          dtlApplyLeadEngineerFilterAndSearch(it);
          return;
        }
        break;
      case 'query':
        // Land on Current Pending Queries specifically, not whatever tab
        // the screen defaults to — that's where an open, undone query
        // (the only kind this board ever shows) actually lives.
        if (typeof switchActiveDashboardModule === 'function') {
          switchActiveDashboardModule('customer-queries');
          setTimeout(() => { if (typeof switchCqMode === 'function') switchCqMode('pending'); }, 60);
          return;
        }
        break;
      case 'poTranche':
        // PPS Tracking isn't a canvas-module screen either (it lives under
        // Purchase's workspace enclosure) — no stable direct-open id known
        // from this file, so this always falls through to Steps.
        break;
      default:
        break;
    }
  } catch (e) { /* fall through to Steps */ }
  fallback();
}

// dtlWaitForCheckboxes — the target screen's own engineer checkboxes are
// built once at login (shared/apFetch.js), not re-rendered on every
// navigateToModule call, so they're normally already there by the time
// this runs. Polls briefly anyway rather than assuming, since the very
// first navigation in a session can still be mid-render.
function dtlWaitForCheckboxes(selector, cb, triesLeft = 20) {
  if (document.querySelectorAll(selector).length > 0 || triesLeft <= 0) { cb(); return; }
  setTimeout(() => dtlWaitForCheckboxes(selector, cb, triesLeft - 1), 100);
}

// Pre-fills Search Tasks by ABPS Engineer Name and Status with this
// task's own owner (engineer) and the Assigned status, then runs the
// search — clicking a task card used to land on a completely blank
// screen the viewer had to re-filter by hand to see anything at all.
function dtlApplyTaskFilterAndSearch(it) {
  dtlWaitForCheckboxes('input[name="taskMatrixEngineer"]', () => {
    document.querySelectorAll('input[name="taskMatrixEngineer"]').forEach(cb => { cb.checked = !!it.ownerKey && cb.value === it.ownerKey; });
    document.querySelectorAll('input[name="taskMatrixStatus"]').forEach(cb => { cb.checked = (cb.value === 'Assigned'); });
    document.querySelectorAll('input[name="taskMatrixDate"]').forEach(cb => { cb.checked = false; });
    if (typeof executeTaskMatrixSearch === 'function') executeTaskMatrixSearch();
  });
}

// Same idea for Search Leads by ABPS Engineer Name and Status, used for a
// Follow-up card (Follow-ups don't have their own board — the Lead they
// belong to is the closest real screen). Status is left unchecked
// (matches on engineer alone) since a Follow-up's own status doesn't map
// onto a single Lead status.
function dtlApplyLeadEngineerFilterAndSearch(it) {
  dtlWaitForCheckboxes('input[name="leadMatrixEngineerFilter"]', () => {
    document.querySelectorAll('input[name="leadMatrixEngineerFilter"]').forEach(cb => { cb.checked = !!it.ownerKey && cb.value === it.ownerKey; });
    document.querySelectorAll('input[name="leadMatrixStatusFilter"]').forEach(cb => { cb.checked = false; });
    if (it.ownerKey && typeof executeLeadMatrixFilterSearch === 'function') executeLeadMatrixFilterSearch();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Exit
// ═══════════════════════════════════════════════════════════════════════

function exitDailyTimelineBackToMenu() {
  document.getElementById('canvas-module-daily-timeline').style.display = 'none';
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById('dashboard-view').style.display = 'flex';
}
