// ═══════════════════════════════════════════════════════════════════════
// project/daily-timeline.js — Project > Daily Timeline.
//
// Cross-project, department-grouped "what is due today, across
// everything" board — the inverse question of project-timeline.js (which
// answers "where is THIS project?" one project at a time). Two toggles,
// same pattern as Project Timeline: a Steps list grouped by DEPARTMENT
// (not stage) and a Timeline SVG canvas with NO divisions (a continuous
// fan/scatter, department-clustered by sort order + a bracket, not a
// hard divider line). Zoom is deliberately limited to Today (1 day) and
// This Week (6 days) — wider windows put too much on screen at once for
// a cross-project view; volume within a day is handled by a hard
// per-column slot cap (DTL_MAX_SLOTS) + overflow routing back to Steps.
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
// (1 or 6 days, not project-milestone-driven).
// ═══════════════════════════════════════════════════════════════════════

const DTL_MODES = { today: 1, week: 6 };
// Canonical department order (matches admin_db.departments' fixed order,
// restricted to the departments this screen's seven sources ever emit —
// Accounts/HR/Service own no project-dated work today, see the plan's
// §4 "explicitly out of scope").
const DTL_DEPT_ORDER = ['marketing', 'project', 'design', 'purchase', 'store', 'qa', 'production'];
// Hard per-day-column slot cap on the Timeline canvas — content-driven
// height with real vertical scroll (not shrink-to-fit) still needs a
// ceiling, or one unusually busy day would make every OTHER day's
// spacing microscopic. ≈1,850px tall at the cap.
const DTL_MAX_SLOTS = 24;

let dtlAnchorDate = null;          // "YYYY-MM-DD" — the date/week the view is centred on
let dtlMode = 'today';             // 'today' | 'week'
let dtlViewMode = 'steps';         // 'steps' | 'timeline'
let dtlData = null;                // { items, overdue, truncated, holidays }
let dtlItemsById = new Map();      // id -> item, merged from items + overdue, for click routing
let dtlDays = [];                  // array of "YYYY-MM-DD" for the current window
let dtlIndexMap = {};              // iso -> index within dtlDays
let dtlCollapsedDepts = new Set(); // Steps view section collapse state, keyed by dept or '__overdue__'
let dtlActiveDeptFilters = new Set(DTL_DEPT_ORDER); // all on by default — this is a coordination view
let dtlDateFilter = null;          // set by a Timeline "+N more" pill to scope Steps to one date
let dtlFS = 1;                     // font/geometry scale — fixed at 1, no zoom-level control on this screen
let dtlCanvasContainerId = 'dtl-fs-scroller';
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
  dtlViewMode = 'steps';
  dtlData = null;
  dtlItemsById = new Map();
  dtlDays = [];
  dtlIndexMap = {};
  dtlCollapsedDepts = new Set();
  dtlActiveDeptFilters = new Set(DTL_DEPT_ORDER);
  dtlDateFilter = null;

  mount.innerHTML = `
    <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:14px;">
      <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; flex:none;">
        <button type="button" onclick="dtlStep(-1)" title="Previous" style="padding:8px 13px; border:0; background:#fff; cursor:pointer; font-weight:800; font-size:0.95rem;">&lsaquo;</button>
        <span id="dtl-range-label" style="padding:8px 14px; font-weight:700; font-size:0.85rem; background:#f7fafd; white-space:nowrap; border-left:1px solid var(--border); border-right:1px solid var(--border);"></span>
        <button type="button" onclick="dtlStep(1)" title="Next" style="padding:8px 13px; border:0; background:#fff; cursor:pointer; font-weight:800; font-size:0.95rem;">&rsaquo;</button>
      </div>
      <button type="button" onclick="dtlJumpToday()" style="flex:none; padding:8px 14px; font-size:0.82rem; font-weight:700; border:0; border-radius:var(--radius); background:var(--brand); color:#fff; cursor:pointer;">Today</button>
      <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; flex:none;">
        <button type="button" id="dtl-mode-today" onclick="dtlSetMode('today')" style="padding:8px 14px; border:0; cursor:pointer; font-weight:700; font-size:0.82rem;">Today</button>
        <button type="button" id="dtl-mode-week" onclick="dtlSetMode('week')" style="padding:8px 14px; border:0; border-left:1px solid var(--border); cursor:pointer; font-weight:700; font-size:0.82rem;">This Week</button>
      </div>
      <div id="dtl-dept-chips" style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;"></div>
      <div style="flex:1 1 auto;"></div>
      <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; flex:none;">
        <button type="button" id="dtl-tab-steps" onclick="dtlSetViewMode('steps')" style="padding:8px 16px; border:0; cursor:pointer; font-weight:700; font-size:0.82rem;">Steps</button>
        <button type="button" id="dtl-tab-timeline" onclick="dtlSetViewMode('timeline')" style="padding:8px 16px; border:0; border-left:1px solid var(--border); cursor:pointer; font-weight:700; font-size:0.82rem;">Timeline</button>
      </div>
    </div>
    <div id="dtl-feedback" style="display:none; padding:12px; border-radius:var(--radius); margin-bottom:14px; border-left:4px solid;"></div>
    <div id="dtl-counts" style="margin-bottom:10px; font-size:0.8rem; color:var(--muted); display:flex; align-items:center; gap:10px; flex-wrap:wrap;"></div>
    <div id="dtl-steps-wrap"></div>
  `;
  dtlSetViewMode('steps');
  await dtlLoad();
}

function dtlComputeWindow() {
  if (dtlMode === 'today') return [dtlAnchorDate];
  // Monday-anchored, 6 days (Mon-Sat) — this business runs Monday to
  // Saturday (see CLAUDE.md's isBusinessDay note), so "this week" means
  // the 6 working days of the calendar week containing the anchor date,
  // not a floating anchor+5 window.
  const dow = dtlParse(dtlAnchorDate).getUTCDay(); // 0=Sun..6=Sat
  const offsetToMon = dow === 0 ? -6 : (1 - dow);
  const mon = dtlAddDays(dtlAnchorDate, offsetToMon);
  return Array.from({ length: 6 }, (_, i) => dtlAddDays(mon, i));
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
  if (dtlViewMode === 'timeline') dtlRenderCanvas(dtlCanvasContainerId);
}

async function dtlLoad() {
  const wrap = document.getElementById('dtl-steps-wrap');
  if (wrap) wrap.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Loading Daily Timeline...</div>`;
  const fb = document.getElementById('dtl-feedback');
  if (fb) fb.style.display = 'none';

  dtlDays = dtlComputeWindow();
  dtlIndexMap = {};
  dtlDays.forEach((d, i) => { dtlIndexMap[d] = i; });
  dtlUpdateModeButtons();
  const label = document.getElementById('dtl-range-label');
  if (label) label.textContent = dtlRangeLabelText();
  const chipsEl = document.getElementById('dtl-dept-chips');
  if (chipsEl) chipsEl.innerHTML = dtlDeptChipsHtml();

  try {
    const data = await apFetch({ action: 'fetchDailyTimeline', anchorDate: dtlAnchorDate, mode: dtlMode, todayOverride: dtlTodayOverrideValue() });
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
  if (dtlViewMode === 'timeline') dtlRenderCanvas(dtlCanvasContainerId);
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

function dtlSetViewMode(mode) {
  dtlViewMode = mode;
  const stepsWrap = document.getElementById('dtl-steps-wrap');
  const tabTimeline = document.getElementById('dtl-tab-timeline');
  const tabSteps = document.getElementById('dtl-tab-steps');
  if (stepsWrap) stepsWrap.style.display = mode === 'steps' ? 'block' : 'none';
  if (tabTimeline) { tabTimeline.style.background = mode === 'timeline' ? 'var(--brand)' : '#fff'; tabTimeline.style.color = mode === 'timeline' ? '#fff' : 'var(--text)'; }
  if (tabSteps) { tabSteps.style.background = mode === 'steps' ? 'var(--brand)' : '#fff'; tabSteps.style.color = mode === 'steps' ? '#fff' : 'var(--text)'; }
  if (mode === 'timeline') dtlOpenFullscreen();
  else dtlCloseFullscreen();
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

function dtlRenderRow(it, isOverdueRow) {
  const late = !!it.late, done = !!it.done;
  const color = late ? '#e84545' : (done ? 'var(--accent)' : PTL_SCHEDULED_GREY);
  const today = dtlToday();
  const daysOverdue = isOverdueRow
    ? (it.daysOverdue != null ? it.daysOverdue : Math.max(0, Math.round((Date.parse(today) - Date.parse(it.due)) / DTL_DAYMS)))
    : null;
  const contextParts = [];
  if (it.projectId) contextParts.push(escapeHtml(it.projectId));
  if (it.companyName) contextParts.push(escapeHtml(it.companyName));
  if (!contextParts.length && it.context) contextParts.push(escapeHtml(it.context));
  const hue = PTL_COLORS[it.dept] || 'var(--brand)';
  return `<div id="dtl-row-${escapeHtml(String(it.id))}" onclick="dtlOpenItemById('${escapeHtml(String(it.id)).replace(/'/g, "\\'")}')"
      style="display:flex; align-items:center; gap:12px; padding:9px 12px; border-bottom:1px solid var(--border); cursor:pointer;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background=''">
    <span style="flex:none; width:28px; height:28px; border-radius:50%; border:2.5px solid ${color}; background:${done ? color : '#fff'}; display:flex; align-items:center; justify-content:center; font-size:0.85rem; color:#fff; font-weight:800;">${done ? '&#10003;' : ''}</span>
    <span style="flex:none; width:3px; align-self:stretch; border-radius:2px; background:${hue};"></span>
    <span style="flex:1 1 auto; min-width:0;">
      <span style="display:block; font-weight:700; font-size:0.86rem; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(it.label || '')}</span>
      <span style="display:block; font-size:0.76rem; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${contextParts.join(' &middot; ')}</span>
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
      ${collapsed ? '' : `<div>${items.map(it => dtlRenderRow(it, false)).join('')}</div>`}
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
    dtlSetViewMode('steps');
    if (dtlCollapsedDepts.has(it.dept)) dtlCollapsedDepts.delete(it.dept);
    if (dtlCollapsedDepts.has('__overdue__')) dtlCollapsedDepts.delete('__overdue__');
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
      case 'followUp':
      case 'task':
        // Marketing's follow-up/task board isn't a canvas-module screen
        // with a stable id this file can target directly — best-effort
        // via navigateToModule's "searchTasks" workspace panel if the
        // viewer has that permission, else fall back.
        if (typeof navigateToModule === 'function' && userPermissions && userPermissions.searchTasks) {
          navigateToModule('searchTasks');
          return;
        }
        break;
      case 'query':
        if (typeof switchActiveDashboardModule === 'function') { switchActiveDashboardModule('customer-queries'); return; }
        break;
      case 'mrd':
        if (typeof switchActiveDashboardModule === 'function') { switchActiveDashboardModule('assign-material-requirement-date'); return; }
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

// ═══════════════════════════════════════════════════════════════════════
// Timeline view — the SVG fan. Faithful to Project Timeline's canvas
// (same hover/tooltip/drag-to-pan grammar) but with the project spine,
// Stage-4 lanes, sticky gutter, trace lines, stage dividers, clipPath
// past/future split, row-mode and ptlPlacer all DROPPED — none of them
// mean anything cross-project. Instead: one column per day, department-
// clustered top-to-bottom (not alternating), content-driven height with
// real vertical scroll.
// ═══════════════════════════════════════════════════════════════════════

let dtlMeasureCtx = null;
function dtlMeasureTextWidth(text, fontPx, weight) {
  if (!dtlMeasureCtx) dtlMeasureCtx = document.createElement('canvas').getContext('2d');
  dtlMeasureCtx.font = `${weight || 400} ${fontPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  return dtlMeasureCtx.measureText(text).width;
}
function dtlEllipsize(text, maxW, fontPx, weight) {
  if (!text) return '';
  if (dtlMeasureTextWidth(text, fontPx, weight) <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const cand = text.slice(0, mid) + '…';
    if (dtlMeasureTextWidth(cand, fontPx, weight) <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function dtlNodeLabelText(it) {
  if (dtlMode !== 'today') return it.label || '';
  const extra = [it.context, it.owner].filter(Boolean).join(' · ');
  return extra ? `${it.label} · ${extra}` : (it.label || '');
}

// Priority-first selection (late, then open, then done) BEFORE the
// display sort, so an overdue item can never be the one dropped by the
// slot cap — only the reserved last slot becomes the "+N more" pill.
function dtlSortForDisplay(items) {
  return items.slice().sort((a, b) => {
    const da = DTL_DEPT_ORDER.indexOf(a.dept), db = DTL_DEPT_ORDER.indexOf(b.dept);
    if (da !== db) return da - db;
    const sa = a.subDept || '', sb = b.subDept || '';
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ra = a.late ? 0 : (a.done ? 2 : 1), rb = b.late ? 0 : (b.done ? 2 : 1);
    if (ra !== rb) return ra - rb;
    if (a.due !== b.due) return (a.due || '') < (b.due || '') ? -1 : 1;
    return (a.label || '').localeCompare(b.label || '');
  });
}
function dtlSelectColumnItems(items) {
  if (items.length <= DTL_MAX_SLOTS) return { shown: dtlSortForDisplay(items), truncated: 0, total: items.length };
  const late = items.filter(it => it.late);
  const open = items.filter(it => !it.late && !it.done);
  const done = items.filter(it => !it.late && it.done);
  const priorityOrdered = late.concat(open, done);
  const keep = priorityOrdered.slice(0, DTL_MAX_SLOTS - 1); // reserve the last slot for the "+N more" pill
  return { shown: dtlSortForDisplay(keep), truncated: items.length - keep.length, total: items.length };
}

function dtlOpenFullscreen() {
  let ov = document.getElementById('dtl-fs-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'dtl-fs-overlay';
    ov.style.cssText = 'position:fixed; inset:0; z-index:9000; background:var(--bg,#f0f4f8); display:flex; flex-direction:column;';
    document.body.appendChild(ov);
  }
  if (!document.getElementById('dtl-fs-style')) {
    const style = document.createElement('style');
    style.id = 'dtl-fs-style';
    style.textContent = `#dtl-fs-scroller{scrollbar-width:thin; scrollbar-color:var(--muted) transparent;}
#dtl-fs-scroller::-webkit-scrollbar{width:12px; height:12px;}
#dtl-fs-scroller::-webkit-scrollbar-track{background:transparent;}
#dtl-fs-scroller::-webkit-scrollbar-thumb{background:var(--muted); border-radius:7px; border:3px solid var(--bg,#f0f4f8); background-clip:padding-box;}
#dtl-fs-scroller::-webkit-scrollbar-thumb:hover{background:var(--text);}
#dtl-fs-scroller::-webkit-scrollbar-corner{background:transparent;}`;
    document.head.appendChild(style);
  }
  ov.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  dtlRenderFullscreen();
}
function dtlCloseFullscreen() {
  const ov = document.getElementById('dtl-fs-overlay');
  if (ov) ov.style.display = 'none';
  document.body.style.overflow = '';
}

function dtlRenderFullscreen() {
  const ov = document.getElementById('dtl-fs-overlay');
  if (!ov) return;
  ov.innerHTML = `
    <div style="flex:none; background:var(--card); border-bottom:1px solid var(--border); padding:8px 18px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
        <button type="button" onclick="dtlSetViewMode('steps')" title="Back to Steps" style="flex:none; display:inline-flex; align-items:center; gap:5px; padding:7px 12px; font-size:0.82rem; font-weight:800; border:0; border-radius:var(--radius); background:var(--brand); color:#fff; cursor:pointer;">&lsaquo; Steps</button>
        <div style="width:1px; align-self:stretch; background:var(--border); flex:none;"></div>
        <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;">
          <button type="button" onclick="dtlStep(-1)" style="padding:6px 11px; border:0; background:#fff; cursor:pointer; font-weight:800;">&lsaquo;</button>
          <span style="padding:6px 12px; font-weight:700; font-size:0.82rem; background:#f7fafd; white-space:nowrap;">${escapeHtml(dtlRangeLabelText())}</span>
          <button type="button" onclick="dtlStep(1)" style="padding:6px 11px; border:0; border-left:1px solid var(--border); background:#fff; cursor:pointer; font-weight:800;">&rsaquo;</button>
        </div>
        <button type="button" onclick="dtlJumpToday()" style="flex:none; padding:7px 14px; font-size:0.82rem; font-weight:700; border:0; border-radius:var(--radius); background:var(--brand); color:#fff; cursor:pointer;">Today</button>
        <div style="display:inline-flex; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden;">
          <button type="button" onclick="dtlSetMode('today')" style="padding:7px 13px; font-size:0.82rem; font-weight:700; border:0; cursor:pointer; background:${dtlMode === 'today' ? 'var(--brand)' : '#fff'}; color:${dtlMode === 'today' ? '#fff' : 'var(--text)'};">Today</button>
          <button type="button" onclick="dtlSetMode('week')" style="padding:7px 13px; font-size:0.82rem; font-weight:700; border:0; border-left:1px solid var(--border); cursor:pointer; background:${dtlMode === 'week' ? 'var(--brand)' : '#fff'}; color:${dtlMode === 'week' ? '#fff' : 'var(--text)'};">This Week</button>
        </div>
        <div style="flex:1 1 auto;"></div>
        <div id="dtl-fs-dept-chips" style="display:flex; gap:6px; flex-wrap:wrap;">${dtlDeptChipsHtml()}</div>
    </div>
    <div style="flex:1 1 auto; display:flex; min-height:0;">
      <div id="dtl-fs-scroller" style="flex:1 1 auto; min-width:0; min-height:0; overflow-x:auto; overflow-y:auto; cursor:grab; background:var(--bg,#f0f4f8);"></div>
    </div>
    <div style="flex:none; border-top:1px solid var(--border); background:var(--card); padding:8px 18px; display:flex; flex-wrap:wrap; align-items:center; gap:6px 20px; font-size:0.74rem; color:var(--muted);">
      <span style="color:var(--accent);">● Done</span><span style="color:#e84545;">● Late</span><span>○ Scheduled</span>
      <span style="margin-left:auto;">Click a point to jump to its screen. Hover for detail. Drag to pan.</span>
    </div>`;
  const chipsWrap = document.getElementById('dtl-fs-dept-chips');
  if (chipsWrap) {
    // Re-wire the chip buttons in the fullscreen header to also refresh
    // the mount's own chip row (kept in sync, both are the same filter set).
    chipsWrap.querySelectorAll('button').forEach((btn, i) => {
      const dept = DTL_DEPT_ORDER[i];
      btn.onclick = () => dtlToggleDeptFilter(dept);
    });
  }
  dtlCanvasContainerId = 'dtl-fs-scroller';
  dtlRenderCanvas('dtl-fs-scroller');
}

function dtlRenderCanvas(containerId) {
  const wrap = document.getElementById(containerId || dtlCanvasContainerId);
  if (!wrap || !dtlData) return;

  const PAD_L = 28, LEAD = 40, PAD_R = 90, PAD_B = 40, RULER_H = 56;
  const availW = wrap.clientWidth || (window.innerWidth - 400) || 900;
  const dayCount = DTL_MODES[dtlMode];
  const dtlDayW = Math.min(1400, Math.max(160, (availW - PAD_L - LEAD - PAD_R) / dayCount));
  const R = 7.5 * (1 + (dtlFS - 1) * 0.55);
  const SLOT_PITCH = 34;   // 2R + one text line — collision is impossible
  const FIRST_OFF = 30;    // centre line -> first slot centre
  const colL = i => PAD_L + LEAD + i * dtlDayW;
  const nodeXOf = i => colL(i) + Math.min(140, dtlDayW * 0.18);
  const labelMaxW = dtlDayW - Math.min(140, dtlDayW * 0.18) - R - 26;

  const today = dtlToday();
  const inScope = (dtlData.items || []).filter(it => dtlActiveDeptFilters.has(it.dept) && dtlIndexMap[it.due] != null);
  const columns = dtlDays.map((day, i) => {
    const dayItems = inScope.filter(it => it.due === day);
    const sel = dtlSelectColumnItems(dayItems);
    const entries = sel.shown.slice();
    if (sel.truncated > 0) entries.push({ pill: true, count: sel.truncated, total: sel.total, date: day });
    return { day, i, entries, truncated: sel.truncated, total: sel.total };
  });

  const N = Math.max(1, ...columns.map(c => c.entries.length));
  const half = Math.ceil(N / 2);
  const halfH = FIRST_OFF + (half - 1) * SLOT_PITCH + 34;
  const H = Math.max(wrap.clientHeight || 520, RULER_H + 2 * halfH + PAD_B);
  const spineY = RULER_H + (H - RULER_H - PAD_B) / 2;
  const W = PAD_L + LEAD + dayCount * dtlDayW + PAD_R;

  const posOf = (n, r) => {
    const h = Math.ceil(n / 2);
    return r < h ? spineY - FIRST_OFF - (h - 1 - r) * SLOT_PITCH : spineY + FIRST_OFF + (r - h) * SLOT_PITCH;
  };

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`;

  // Today-mode full-column wash (no TODAY rule line at this zoom — a
  // faint wash across the single visible day reads better than a
  // redundant vertical rule right next to the day's own header).
  if (dtlMode === 'today') {
    svg += `<rect x="${colL(0)}" y="${RULER_H}" width="${dtlDayW}" height="${H - RULER_H - PAD_B}" fill="#dbeafe" opacity="0.35"/>`;
  }

  // Centre line, full width.
  svg += `<line x1="${PAD_L}" y1="${spineY}" x2="${W - PAD_R}" y2="${spineY}" stroke="${PTL_SCHEDULED_GREY}" stroke-width="1.5"/>`;

  // Ruler group — pinned via translate(0, scrollTop) on scroll (wired below).
  svg += `<g id="dtl-ruler">`;
  columns.forEach(col => {
    const rest = dtlDayIsRest(col.day);
    const cx = colL(col.i) + dtlDayW / 2;
    const color = col.day === today ? '#15803d' : (rest ? '#15803d' : 'var(--text)');
    svg += `<rect x="${colL(col.i)}" y="0" width="${dtlDayW}" height="${RULER_H}" fill="var(--card)"/>`;
    svg += `<text x="${cx}" y="22" text-anchor="middle" font-size="12" font-weight="800" fill="${color}">${escapeHtml(dtlFmtDayShort(col.day))}</text>`;
    svg += `<text x="${cx}" y="38" text-anchor="middle" font-size="10" fill="${color === '#15803d' ? '#15803d' : 'var(--muted)'}">${escapeHtml(dtlWeekdayShort(col.day))}${col.day === today ? ' · TODAY' : ''}</text>`;
    svg += `<line x1="${colL(col.i)}" y1="${RULER_H - 2}" x2="${colL(col.i)}" y2="${RULER_H - 2}" stroke="var(--border)"/>`;
  });
  svg += `<line x1="0" y1="${RULER_H}" x2="${W}" y2="${RULER_H}" stroke="var(--border)" stroke-width="1"/>`;
  svg += `</g>`;

  // TODAY vertical line, week mode only.
  if (dtlMode === 'week' && dtlIndexMap[today] != null) {
    const tx = colL(dtlIndexMap[today]) + dtlDayW / 2;
    svg += `<line x1="${tx}" y1="${RULER_H}" x2="${tx}" y2="${H - PAD_B}" stroke="#15803d" stroke-width="2" stroke-dasharray="2,3"/>`;
  }

  const clickMap = [];
  let idx = 0;

  columns.forEach(col => {
    const nodeX = nodeXOf(col.i);
    // Department-run brackets — a run of >=2 contiguous same-dept entries
    // (excluding the trailing pill) gets a hue-tinted bracket just left
    // of the node column, never crossing the centre line. Not a divider —
    // it clusters without separating.
    let runStart = 0;
    for (let r = 0; r <= col.entries.length; r++) {
      const atEnd = r === col.entries.length;
      const cur = atEnd ? null : col.entries[r];
      const prev = col.entries[runStart];
      const sameDept = !atEnd && prev && !prev.pill && !cur.pill && cur.dept === prev.dept;
      if (!sameDept) {
        const runLen = r - runStart;
        if (runLen >= 2 && prev && !prev.pill) {
          const y0 = posOf(col.entries.length, runStart) - R;
          const y1 = posOf(col.entries.length, r - 1) + R;
          const hue = PTL_COLORS[prev.dept] || 'var(--brand)';
          svg += `<rect x="${nodeX - R - 10}" y="${y0}" width="3" height="${y1 - y0}" rx="1.5" fill="${hue}"/>`;
          svg += `<text x="${nodeX - R - 14}" y="${y0 + 8}" text-anchor="end" font-size="8.5" font-weight="800" letter-spacing="0.05em" fill="${hue}" transform="rotate(-90 ${nodeX - R - 14} ${y0 + 8})" style="text-transform:uppercase;">${escapeHtml((PTL_DEPT_NAME[prev.dept] || prev.dept).slice(0, 3))}</text>`;
        }
        runStart = r;
      }
    }

    col.entries.forEach((it, r) => {
      const y = posOf(col.entries.length, r);
      if (it.pill) {
        svg += `<g class="dtl-pill-hit" data-date="${escapeHtml(it.date)}" style="cursor:pointer;">
          <rect x="${nodeX - R}" y="${y - 9}" width="${R * 2 + 100}" height="18" rx="9" fill="#475569"/>
          <text x="${nodeX - R + 8}" y="${y + 4}" font-size="10.5" font-weight="700" fill="#fff">+${it.count} more &rsaquo;</text>
        </g>`;
        svg += `<text x="${nodeX - R}" y="${y + 24}" font-size="9" fill="var(--muted)">Showing ${it.total - it.count} of ${it.total}</text>`;
        return;
      }
      const hue = PTL_COLORS[it.dept] || 'var(--brand)';
      const late = !!it.late, done = !!it.done;
      const fill = done ? hue : hue;
      const opacity = done ? 0.35 : 1;
      const stroke = late ? '#e84545' : 'none';
      const strokeW = late ? 2 : 0;
      const label = dtlEllipsize(dtlNodeLabelText(it), labelMaxW, 11, done ? 400 : 700);
      const anchorId = 'dtl-canvas-' + idx;
      clickMap[idx] = { it, label: dtlNodeLabelText(it) };
      svg += `<circle class="dtl-hit" data-idx="${idx}" cx="${nodeX}" cy="${y}" r="${R * 2.2}" fill="transparent"/>`;
      svg += `<circle cx="${nodeX}" cy="${y}" r="${R}" fill="${fill}" opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeW}"/>`;
      if (done) svg += `<text x="${nodeX}" y="${y + 3}" text-anchor="middle" font-size="9" fill="#fff">&#10003;</text>`;
      svg += `<text x="${nodeX + R + 8}" y="${y + 4}" font-size="11" font-weight="${done ? 400 : 700}" fill="${late ? '#e84545' : 'var(--text)'}">${escapeHtml(label)}</text>`;
      idx++;
    });
  });

  svg += `</svg>`;
  wrap.innerHTML = svg;
  dtlWireCanvasInteractions(wrap, clickMap);
}

let dtlDragMouseUpHandler = null, dtlDragMouseMoveHandler = null;
function dtlWireCanvasInteractions(sc, clickMap) {
  if (!sc) return;
  let tip = document.getElementById('dtl-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'dtl-tip';
    tip.style.cssText = 'position:fixed; z-index:9500; pointer-events:none; opacity:0; transition:opacity .1s linear; background:var(--card); border:1px solid var(--border); border-radius:6px; padding:9px 11px; max-width:280px; box-shadow:0 6px 20px -6px rgba(0,0,0,.28);';
    document.body.appendChild(tip);
  }

  sc.querySelectorAll('.dtl-hit').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('mouseenter', () => {
      const info = clickMap[+el.dataset.idx];
      if (info) {
        const it = info.it;
        tip.innerHTML = `<b style="display:block; font-size:0.82rem; font-weight:700; margin-bottom:6px;">${escapeHtml(info.label)}</b>
          <div style="font-size:0.74rem; color:var(--muted);">Department: <span style="color:var(--text);">${escapeHtml(PTL_DEPT_NAME[it.dept] || it.dept)}</span></div>
          <div style="font-size:0.74rem; color:var(--muted);">Due: <span style="color:var(--text);">${escapeHtml(formatOrdinalDate(it.due))}</span></div>
          ${it.owner ? `<div style="font-size:0.74rem; color:var(--muted);">Owner: <span style="color:var(--text);">${escapeHtml(it.owner)}</span></div>` : ''}
          ${it.late ? `<div style="margin-top:5px; font-size:0.74rem; font-weight:700; color:#e84545;">Late</div>` : (it.done ? `<div style="margin-top:5px; font-size:0.74rem; font-weight:700; color:#15803d;">Done</div>` : '')}`;
      }
      tip.style.opacity = '1';
    });
    el.addEventListener('mousemove', e => { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; });
    el.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
    el.addEventListener('click', () => { const info = clickMap[+el.dataset.idx]; if (info) dtlOpenItem(info.it); });
  });

  sc.querySelectorAll('.dtl-pill-hit').forEach(el => {
    el.addEventListener('click', () => { dtlDateFilter = el.dataset.date; dtlSetViewMode('steps'); });
  });

  // Pin the ruler group against vertical scroll.
  const ruler = sc.querySelector('#dtl-ruler');
  const onScroll = () => { if (ruler) ruler.setAttribute('transform', `translate(0, ${sc.scrollTop})`); };
  sc.onscroll = onScroll;
  onScroll();

  // Drag-to-pan, both axes — vertical is load-bearing at this content-driven height.
  sc.style.userSelect = 'none';
  let down = false, sx = 0, sy = 0, sl = 0, st = 0;
  sc.onmousedown = e => {
    if (e.target.closest('.dtl-hit') || e.target.closest('.dtl-pill-hit')) return;
    e.preventDefault();
    down = true; sx = e.pageX; sy = e.pageY; sl = sc.scrollLeft; st = sc.scrollTop; sc.style.cursor = 'grabbing';
  };
  if (dtlDragMouseUpHandler) removeEventListener('mouseup', dtlDragMouseUpHandler);
  if (dtlDragMouseMoveHandler) removeEventListener('mousemove', dtlDragMouseMoveHandler);
  dtlDragMouseUpHandler = () => { down = false; sc.style.cursor = 'grab'; };
  dtlDragMouseMoveHandler = e => { if (down) { e.preventDefault(); sc.scrollLeft = sl - (e.pageX - sx); sc.scrollTop = st - (e.pageY - sy); onScroll(); } };
  addEventListener('mouseup', dtlDragMouseUpHandler);
  addEventListener('mousemove', dtlDragMouseMoveHandler);
}

// ═══════════════════════════════════════════════════════════════════════
// Exit
// ═══════════════════════════════════════════════════════════════════════

function exitDailyTimelineBackToMenu() {
  dtlCloseFullscreen();
  document.getElementById('canvas-module-daily-timeline').style.display = 'none';
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById('dashboard-view').style.display = 'flex';
}
