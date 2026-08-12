// ═══════════════════════════════════════════════════════════════════════
// routes/dashboards.js — the 5 module dashboards your frontend calls
// immediately on navigating to each section. This is a FIRST PASS: the
// `stats` object in each response is real data from live queries, but
// the chart/trend/breakdown arrays (byDept, trendData, dailyTrend, etc.)
// are returned as empty arrays rather than fully computed — enough that
// the frontend's rendering code doesn't crash on `undefined.forEach`,
// but the charts themselves will show "no data" until those are filled
// in with real aggregation queries as a follow-up pass.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool } = require('../db');
const { requirePermission } = require('../auth');

const router = express.Router();

// ── IST-aware date helpers ───────────────────────────────────────────
// JS Date methods (getDate/getDay/setHours/toISOString) always operate
// in either raw UTC or the process's own local timezone — on Cloud Run
// that's UTC, 5.5 hours behind IST. Every calendar day/week/month
// boundary and bucket key below is computed from the IST calendar date
// explicitly, or anything happening between 12:00am and 5:30am IST gets
// attributed to the previous day.
function istParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(new Date(date));
  const get = (t) => parts.find(p => p.type === t).value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: +get('year'), month: +get('month'), day: +get('day'), weekday: weekdayMap[get('weekday')] };
}
function istDayKey(date) {
  const p = istParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
function istMidnight(y, m, d) {
  // IST midnight of y-m-d, expressed as the correct UTC instant.
  return new Date(Date.UTC(y, m - 1, d) - 5.5 * 3600000);
}
function istWeekMonday(date) {
  const p = istParts(date);
  const diff = (p.weekday + 6) % 7; // days since Monday, IST
  const mondayMs = Date.UTC(p.year, p.month - 1, p.day) - diff * 86400000;
  const m = new Date(mondayMs);
  return istMidnight(m.getUTCFullYear(), m.getUTCMonth() + 1, m.getUTCDate());
}
function istWeekKey(date) { return istDayKey(istWeekMonday(date)); }
function istMonthKey(date) { const p = istParts(date); return `${p.year}-${String(p.month).padStart(2, '0')}`; }

// ── Shared period-bounds calculator, rewritten for IST — the previous
// version deliberately never applied IST correction, which this fixes.
function getPeriodBounds(type, value) {
  const now = new Date();
  const p = istParts(now);
  const today = istMidnight(p.year, p.month, p.day);
  if (type === "today") return { start: today, end: now };
  if (type === "yesterday") {
    const y = new Date(today.getTime() - 86400000);
    const ye = new Date(today.getTime() - 1);
    return { start: y, end: ye };
  }
  if (type === "thisweek") return { start: istWeekMonday(today), end: now };
  if (type === "thismonth") return { start: istMidnight(p.year, p.month, 1), end: now };
  if (type === "thisquarter") {
    const m = p.month; // 1-12
    const fyStart = m >= 4 ? p.year : p.year - 1;
    const qStarts = [4, 7, 10, 1]; let qs = 4;
    for (let i = qStarts.length - 1; i >= 0; i--) { if (((m - qStarts[i] + 12) % 12) < 3) { qs = qStarts[i]; break; } }
    const qYear = qs === 1 ? fyStart + 1 : fyStart;
    return { start: istMidnight(qYear, qs, 1), end: now };
  }
  if (type === "thisyear") {
    const fy = p.month >= 4 ? p.year : p.year - 1;
    return { start: istMidnight(fy, 4, 1), end: now };
  }
  if (type === "customday") {
    const dp = istParts(value);
    const dayStart = istMidnight(dp.year, dp.month, dp.day);
    return { start: dayStart, end: new Date(dayStart.getTime() + 86400000 - 1) };
  }
  if (type === "customweek") {
    const monday = istWeekMonday(value);
    return { start: monday, end: new Date(monday.getTime() + 7 * 86400000 - 1) };
  }
  if (type === "custommonth") {
    const [y, mo] = value.split("-").map(Number);
    const nextMonth = mo === 12 ? istMidnight(y + 1, 1, 1) : istMidnight(y, mo + 1, 1);
    return { start: istMidnight(y, mo, 1), end: new Date(nextMonth.getTime() - 1) };
  }
  if (type === "customquarter") {
    const [fy, q] = value.split("-Q").map(Number);
    const qm = [4, 7, 10, 1][q - 1];
    const yr = q === 4 ? fy + 1 : fy;
    const endMonth = qm + 3 > 12 ? qm + 3 - 12 : qm + 3;
    const endYear = qm + 3 > 12 ? yr + 1 : yr;
    const endD = istMidnight(endYear, endMonth, 1);
    return { start: istMidnight(yr, qm, 1), end: new Date(endD.getTime() - 1) };
  }
  if (type === "customyear") {
    const y = +value;
    return { start: istMidnight(y, 4, 1), end: new Date(istMidnight(y + 1, 4, 1).getTime() - 1) };
  }
  return { start: today, end: now };
}

router.post('/fetchDesignDashboardData', requirePermission('perm_design_dashboard'), async (req, res) => {
  try {
    const { periodType, periodValue } = req.body;
    const { start, end } = getPeriodBounds(periodType || 'today', periodValue);

    // Querying design.boq_drafts, NOT design.bill_of_quantity — migration
    // 024 swapped those table names; boq_drafts is the one-row-per-BOQ
    // header table (status/project_id/cost live here). See the comment
    // block above getPeriodBounds for why avgAuthTime stays null.
    const { rows: [c] } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE boq_date BETWEEN $1 AND $2) AS total_created,
         COUNT(*) FILTER (WHERE status = 'Pending Authorization' AND boq_date BETWEEN $1 AND $2) AS total_pending,
         COUNT(*) FILTER (WHERE status = 'Authorized' AND boq_date BETWEEN $1 AND $2) AS total_authorized,
         COALESCE(SUM(total_cost) FILTER (WHERE status = 'Authorized' AND boq_date BETWEEN $1 AND $2), 0) AS total_auth_value
       FROM design.boq_drafts`,
      [start, end]
    );

    const { rows: deptRows } = await pool.query(
      `SELECT COALESCE(department, '(Unassigned)') AS dept,
              COUNT(*) FILTER (WHERE boq_date BETWEEN $1 AND $2) AS count,
              COALESCE(SUM(total_cost) FILTER (WHERE status = 'Authorized' AND boq_date BETWEEN $1 AND $2), 0) AS value
       FROM design.boq_drafts
       GROUP BY department
       HAVING COUNT(*) FILTER (WHERE boq_date BETWEEN $1 AND $2) > 0
           OR COALESCE(SUM(total_cost) FILTER (WHERE status = 'Authorized' AND boq_date BETWEEN $1 AND $2), 0) > 0`,
      [start, end]
    );
    const byDept = {};
    deptRows.forEach(r => { byDept[r.dept] = { count: parseInt(r.count, 10), value: parseFloat(r.value) }; });

    const { rows: versionRows } = await pool.query(
      `SELECT CASE WHEN COALESCE(version,1) = 1 THEN 'v1' WHEN version = 2 THEN 'v2' ELSE 'v3+' END AS vk, COUNT(*) AS c
       FROM design.boq_drafts WHERE boq_date BETWEEN $1 AND $2 GROUP BY vk`,
      [start, end]
    );
    const versionDist = { "v1": 0, "v2": 0, "v3+": 0 };
    versionRows.forEach(r => { versionDist[r.vk] = parseInt(r.c, 10); });

    const { rows: [itemCodeCount] } = await pool.query(
      `SELECT COUNT(*) AS c FROM design.item_codes WHERE created_date BETWEEN $1 AND $2`,
      [start, end]
    );

    // Trend — weekly buckets for periods <= 31 days, monthly otherwise, same threshold as code.js.
    const { rows: trendRows } = await pool.query(
      `SELECT boq_date, total_cost FROM design.boq_drafts
       WHERE status = 'Authorized' AND boq_date BETWEEN $1 AND $2`,
      [start, end]
    );
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let bucketFn, labelFn;
    if (diffDays <= 31) {
      bucketFn = istWeekKey;
      labelFn = k => "Wk " + k.slice(5);
    } else {
      bucketFn = istMonthKey;
      labelFn = k => { const [y, m] = k.split("-"); return monthNames[+m - 1] + " " + y.slice(2); };
    }
    const trendMap = {};
    trendRows.forEach(r => {
      const bk = bucketFn(new Date(r.boq_date));
      trendMap[bk] = (trendMap[bk] || 0) + (parseFloat(r.total_cost) || 0);
    });
    const trendData = Object.keys(trendMap).sort().map(k => ({ label: labelFn(k), value: trendMap[k] }));

    // Project health — ALL BOQs regardless of period, per code.js.
    const { rows: healthRows } = await pool.query(
      `SELECT project_id AS "projId", MAX(customer_name) AS customer,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'Authorized') AS authorized,
              COUNT(*) FILTER (WHERE status = 'Pending Authorization') AS pending,
              COALESCE(SUM(total_cost) FILTER (WHERE status = 'Authorized'), 0) AS value
       FROM design.boq_drafts
       GROUP BY project_id`
    );
    const { rows: prnProjectRows } = await pool.query(`SELECT DISTINCT project_id FROM purchase.purchase_request_notes`);
    const prnProjects = new Set(prnProjectRows.map(r => r.project_id));
    const projectHealth = healthRows.map(r => ({
      projId: r.projId, customer: r.customer,
      total: parseInt(r.total, 10), authorized: parseInt(r.authorized, 10),
      pending: parseInt(r.pending, 10), value: parseFloat(r.value),
      prnRaised: prnProjects.has(r.projId),
    }));

    res.json({
      success: true,
      stats: {
        totalCreated: parseInt(c.total_created, 10),
        totalAuthorized: parseInt(c.total_authorized, 10),
        totalPending: parseInt(c.total_pending, 10),
        avgAuthTime: null,
        totalAuthValue: parseFloat(c.total_auth_value),
        newItemCodes: parseInt(itemCodeCount.c, 10),
      },
      byDept, versionDist, trendData,
      // pendingList/updatePendingList intentionally empty — ddRenderDashboard
      // on the frontend doesn't render either (see its "Pending list removed
      // from this dashboard" comment), so computing them here would be dead work.
      pendingList: [], updatePendingList: [],
      projectHealth, showTrend: !["today", "yesterday"].includes(periodType),
    });
  } catch (err) {
    console.error('fetchDesignDashboardData error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchMarketingDashboardData', requirePermission('perm_marketing_dashboard'), async (req, res) => {
  try {
    const { periodType, periodValue } = req.body;
    const { start, end } = getPeriodBounds(periodType || 'today', periodValue);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const STALE_DAYS = 7;
    // Querying marketing.leads, NOT marketing.enquiries — migration 016
    // renamed the table (enquiries -> leads, enquiry_id -> lead_id)
    // a session before this one. The old table name no longer exists.
    const terminalStatuses = ['Order Dispatched', 'Product Commissioned', 'Lead Failed', 'Order not Received', 'Order Received'];
    const inProgressStatuses = ['Technical Discussion', 'Inquire Received', 'Offer Sent'];
    const failedStatuses = ['Lead Failed', 'Order not Received'];

    // 1. Leads created in period, by status (cohort-anchored on leads.ts,
    // the creation timestamp column — confirmed via its use elsewhere as
    // "ORDER BY ts DESC" since it has no explicit INSERT column, just a
    // DB default).
    const { rows: statusRows } = await pool.query(
      `SELECT status, COUNT(*) AS c FROM marketing.leads WHERE ts BETWEEN $1 AND $2 GROUP BY status`,
      [start, end]
    );
    const statusCounts = {};
    let newLeads = 0, inProgress = 0, leadsFailed = 0;
    statusRows.forEach(r => {
      const n = parseInt(r.c, 10);
      statusCounts[r.status] = n;
      newLeads += n;
      if (inProgressStatuses.includes(r.status)) inProgress += n;
      if (failedStatuses.includes(r.status)) leadsFailed += n;
    });

    // 2. Orders Received / PO Uploads in period + conversion days + recent wins.
    // uploaded_document_information.purchase_order_date is the AI-extracted
    // date printed on the customer's PO (see commitMarketingOperationsDocument) —
    // same conversion-event anchor code.js used.
    const { rows: winRows } = await pool.query(
      `SELECT d.lead_id AS "leadId", COALESCE(d.company_name, c.company_name) AS company,
              COALESCE(TRIM(u.first_name || ' ' || u.last_name), e.engineer_name) AS engineer,
              d.purchase_order_date AS "poDate", e.ts AS "leadCreated"
       FROM marketing.uploaded_document_information d
       JOIN marketing.leads e ON e.lead_id = d.lead_id
       LEFT JOIN marketing.companies c ON c.company_id = e.company_id
       LEFT JOIN admin_db.users u ON u.email = e.engineer_name
       WHERE d.purchase_order_date BETWEEN $1 AND $2
       ORDER BY d.purchase_order_date DESC`,
      [start, end]
    );
    const ordersReceived = winRows.length;
    const poUploads = winRows.length;
    const conversionDays = winRows
      .filter(r => r.leadCreated)
      .map(r => (new Date(r.poDate) - new Date(r.leadCreated)) / (1000 * 60 * 60 * 24));
    const avgConversionDays = conversionDays.length
      ? Math.round((conversionDays.reduce((a, b) => a + b, 0) / conversionDays.length) * 10) / 10
      : null;
    const recentWins = winRows.map(r => ({
      leadId: r.leadId, company: r.company || '', engineer: r.engineer || '',
      date: istDayKey(r.poDate),
    }));

    // 3. Follow-ups due/overdue — live snapshot, not period-filtered.
    const { rows: [f] } = await pool.query(
      `SELECT COUNT(*) AS c FROM marketing.follow_ups
       WHERE COALESCE(follow_up_status, '') <> 'Completed' AND next_follow_up_date <= NOW()`
    );

    // 4. Open tasks — live snapshot.
    const { rows: [t] } = await pool.query(
      `SELECT COUNT(*) AS c FROM marketing.tasks
       WHERE task_status IS NOT NULL AND task_status <> '' AND task_status <> 'Resolved'`
    );

    // 5. Distinct offers sent in period (deduped by lead).
    const { rows: [o] } = await pool.query(
      `SELECT COUNT(DISTINCT lead_id) AS c FROM marketing.offers_sent WHERE email_sent_date BETWEEN $1 AND $2`,
      [start, end]
    );

    // 6. Stale leads — open leads (not terminal status) with no follow-up
    // activity in STALE_DAYS+, live snapshot.
    const { rows: staleCandidates } = await pool.query(
      `SELECT e.lead_id AS "leadId", e.status, e.ts AS created, c.company_name AS company,
              COALESCE(TRIM(u.first_name || ' ' || u.last_name), e.engineer_name) AS engineer,
              (SELECT MAX(f2.event_date) FROM marketing.follow_ups f2 WHERE f2.lead_id = e.lead_id) AS "lastActivity"
       FROM marketing.leads e
       LEFT JOIN marketing.companies c ON c.company_id = e.company_id
       LEFT JOIN admin_db.users u ON u.email = e.engineer_name
       WHERE e.status NOT IN ('Order Dispatched','Product Commissioned','Lead Failed','Order not Received','Order Received')`
    );
    const staleLeads = [];
    staleCandidates.forEach(r => {
      const lastActivity = r.lastActivity || r.created;
      if (!lastActivity) return;
      const laP = istParts(lastActivity);
      const la = istMidnight(laP.year, laP.month, laP.day);
      const daysSince = Math.floor((todayStart - la) / (1000 * 60 * 60 * 24));
      if (daysSince >= STALE_DAYS) {
        staleLeads.push({ leadId: r.leadId, company: r.company || '', engineer: r.engineer || '', status: r.status, daysSince });
      }
    });
    staleLeads.sort((a, b) => b.daysSince - a.daysSince);

    // 7. Zero follow-up leads — open leads with no follow_ups row at all.
    const { rows: [z] } = await pool.query(
      `SELECT COUNT(*) AS c FROM marketing.leads e
       WHERE e.status NOT IN ('Order Dispatched','Product Commissioned','Lead Failed','Order not Received','Order Received')
         AND NOT EXISTS (SELECT 1 FROM marketing.follow_ups f3 WHERE f3.lead_id = e.lead_id)`
    );

    // 8. Trend — New Leads vs Orders Received, weekly/monthly buckets, same threshold as code.js.
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let bucketFn, labelFn;
    if (diffDays <= 31) {
      bucketFn = istWeekKey;
      labelFn = k => "Wk " + k.slice(5);
    } else {
      bucketFn = istMonthKey;
      labelFn = k => { const [y, m] = k.split("-"); return monthNames[+m - 1] + " " + y.slice(2); };
    }
    const trendMap = {};
    const { rows: leadTsRows } = await pool.query(`SELECT ts FROM marketing.leads WHERE ts BETWEEN $1 AND $2`, [start, end]);
    leadTsRows.forEach(r => {
      const bk = bucketFn(new Date(r.ts));
      if (!trendMap[bk]) trendMap[bk] = { newLeads: 0, ordersReceived: 0 };
      trendMap[bk].newLeads++;
    });
    winRows.forEach(r => {
      const bk = bucketFn(new Date(r.poDate));
      if (!trendMap[bk]) trendMap[bk] = { newLeads: 0, ordersReceived: 0 };
      trendMap[bk].ordersReceived++;
    });
    const trendData = Object.keys(trendMap).sort().map(k => ({ label: labelFn(k), newLeads: trendMap[k].newLeads, ordersReceived: trendMap[k].ordersReceived }));

    res.json({
      success: true,
      stats: {
        newLeads, inProgress, ordersReceived, leadsFailed, avgConversionDays,
        followUpsDueOverdue: parseInt(f.c, 10),
        openTasks: parseInt(t.c, 10),
        zeroFollowUpLeads: parseInt(z.c, 10),
        poUploads, distinctOffersSent: parseInt(o.c, 10),
      },
      statusCounts, trendData, staleLeads, recentWins,
      showTrend: !["today", "yesterday"].includes(periodType),
    });
  } catch (err) {
    console.error('fetchMarketingDashboardData error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchPurchaseDashboardData', requirePermission('perm_purchase_dashboard'), async (req, res) => {
  try {
    const { periodType, periodValue } = req.body;
    const { start, end } = getPeriodBounds(periodType || 'today', periodValue);
    const now = new Date();

    // Legacy code.js used a flat Active/Closed PRN status model. The
    // current schema's real lifecycle is Pending Authorization -> PRN
    // Generated -> Closed (see purchase.js's requirePermission-gated
    // routes) — "PRN Generated" is the modern equivalent of legacy's
    // "Active". purchase_request_notes' timestamp column is created_date,
    // not created_at (confirmed via sheetsRegistry.js's PRN sheet mapping).
    const { rows: [c] } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_date BETWEEN $1 AND $2) AS total_prns,
         COUNT(*) FILTER (WHERE status = 'PRN Generated' AND created_date BETWEEN $1 AND $2) AS active_prns,
         COUNT(*) FILTER (WHERE status = 'Closed' AND created_date BETWEEN $1 AND $2) AS closed_prns
       FROM purchase.purchase_request_notes`,
      [start, end]
    );

    // Age of ALL currently active (PRN Generated) PRNs — live, not period-filtered.
    const { rows: ageRows } = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - created_date)) / 86400 AS age_days
       FROM purchase.purchase_request_notes WHERE status = 'PRN Generated'`
    );
    const activeAgeDays = ageRows.map(r => Math.floor(parseFloat(r.age_days)));
    const avgPRNAgeDays = activeAgeDays.length > 0
      ? (activeAgeDays.reduce((a, b) => a + b, 0) / activeAgeDays.length).toFixed(1)
      : null;
    const ageBuckets = { "0-7": 0, "8-14": 0, "15-30": 0, "30+": 0 };
    activeAgeDays.forEach(d => {
      if (d <= 7) ageBuckets["0-7"]++;
      else if (d <= 14) ageBuckets["8-14"]++;
      else if (d <= 30) ageBuckets["15-30"]++;
      else ageBuckets["30+"]++;
    });

    // PRN trend (chart 1) — bucket by week/month, same threshold as code.js.
    const { rows: prnRows } = await pool.query(
      `SELECT status, created_date FROM purchase.purchase_request_notes WHERE created_date BETWEEN $1 AND $2`,
      [start, end]
    );
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const bucketFn = diffDays <= 31 ? istWeekKey : istMonthKey;
    const labelFn = diffDays <= 31
      ? k => "Wk " + k.slice(5)
      : k => { const [y, m] = k.split("-"); return monthNames[+m - 1] + " " + y.slice(2); };
    const prnStatusByPeriod = {};
    prnRows.forEach(r => {
      const bk = bucketFn(new Date(r.created_date));
      if (!prnStatusByPeriod[bk]) prnStatusByPeriod[bk] = { active: 0, closed: 0 };
      if (r.status === 'PRN Generated') prnStatusByPeriod[bk].active++;
      if (r.status === 'Closed') prnStatusByPeriod[bk].closed++;
    });
    const prnTrend = Object.keys(prnStatusByPeriod).sort().map(k => ({ label: labelFn(k), active: prnStatusByPeriod[k].active, closed: prnStatusByPeriod[k].closed }));

    // byType (chart 2) — aggregated across active (PRN Generated) PRNs only.
    // still_to_order_quantity is trusted as a maintained column here, not
    // recomputed from buffered/assigned/onOrder — the modern schema keeps
    // it live via the purchase-flow routes rather than deriving it ad hoc
    // the way code.js had to.
    const { rows: typeRows } = await pool.query(
      `SELECT COALESCE(li.type_of_material, '(Unspecified)') AS type,
              SUM(li.buffered_purchase_quantity) AS buffered,
              SUM(li.on_order_quantity) AS on_order,
              SUM(li.assigned_quantity) AS assigned,
              SUM(li.still_to_order_quantity) AS still_to_order
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
       WHERE p.status = 'PRN Generated'
       GROUP BY type`
    );
    const byType = {};
    typeRows.forEach(r => {
      byType[r.type] = {
        buffered: parseFloat(r.buffered) || 0, onOrder: parseFloat(r.on_order) || 0,
        assigned: parseFloat(r.assigned) || 0, stillToOrder: parseFloat(r.still_to_order) || 0,
      };
    });

    // Materials Covered / Total — unique item codes on active PRNs.
    const { rows: [matCov] } = await pool.query(
      `SELECT COUNT(DISTINCT li.item_code) AS total,
              COUNT(DISTINCT li.item_code) FILTER (WHERE li.on_order_quantity > 0) AS covered
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
       WHERE p.status = 'PRN Generated'`
    );

    // PRN Assignment Health — per active PRN, fully covered (every line's
    // assigned >= buffered) vs. still pending assignment.
    const { rows: prnCoverageRows } = await pool.query(
      `SELECT p.prn_id AS "prnId", COUNT(*) AS total_lines,
              COUNT(*) FILTER (WHERE li.assigned_quantity >= li.buffered_purchase_quantity) AS covered_lines
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
       WHERE p.status = 'PRN Generated'
       GROUP BY p.prn_id`
    );
    let prnPendingAssignment = 0, prnFullyCovered = 0;
    prnCoverageRows.forEach(r => {
      const total = parseInt(r.total_lines, 10), covered = parseInt(r.covered_lines, 10);
      if (total > 0 && covered === total) prnFullyCovered++; else prnPendingAssignment++;
    });

    // No-PO-yet items — still_to_order > 0 and nothing on order, aggregated by item code.
    const { rows: noPoItems } = await pool.query(
      `SELECT li.item_code AS "itemCode", li.material_name AS "matName", li.type_of_material AS type,
              SUM(li.still_to_order_quantity) AS "stillToOrder", COUNT(*) AS "prnCount",
              MAX(EXTRACT(EPOCH FROM (NOW() - p.created_date)) / 86400) AS "maxAgeRaw"
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
       WHERE p.status = 'PRN Generated' AND li.still_to_order_quantity > 0 AND li.on_order_quantity = 0
       GROUP BY li.item_code, li.material_name, li.type_of_material
       ORDER BY "maxAgeRaw" DESC LIMIT 20`
    );
    const noPoItemsClean = noPoItems.map(r => ({
      itemCode: r.itemCode, matName: r.matName, type: r.type,
      stillToOrder: parseFloat(r.stillToOrder) || 0, prnCount: parseInt(r.prnCount, 10),
      maxAge: Math.floor(parseFloat(r.maxAgeRaw)),
    }));

    // PO data — restricted to status = 'Authorized', the modern equivalent
    // of code.js's flat PO list (which had no draft/pending concept the
    // "no trace until authorized" architecture introduced later).
    const { rows: [po] } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE order_date BETWEEN $1 AND $2) AS total_pos,
         COALESCE(SUM(grand_total) FILTER (WHERE order_date BETWEEN $1 AND $2), 0) AS total_po_value
       FROM purchase.raw_material_purchase_orders WHERE status = 'Authorized'`,
      [start, end]
    );

    // Overdue list + delivery timeline — live, all Authorized POs with a delivery date.
    const { rows: poDeliveryRows } = await pool.query(
      `SELECT po_no AS "poId", vendor_name AS vendor, delivery_date AS "deliveryDate", grand_total AS grand
       FROM purchase.raw_material_purchase_orders WHERE status = 'Authorized' AND delivery_date IS NOT NULL`
    );
    const overdueList = [];
    const deliveryTimeline = { overdue: 0, thisWeek: 0, thisMonth: 0, later: 0 };
    const nowP = istParts(now);
    const weekEnd = new Date(istWeekMonday(now).getTime() + 7 * 86400000 - 1);
    const monthEndNextMonth = nowP.month === 12 ? istMidnight(nowP.year + 1, 1, 1) : istMidnight(nowP.year, nowP.month + 1, 1);
    const monthEnd = new Date(monthEndNextMonth.getTime() - 1);
    poDeliveryRows.forEach(r => {
      const delivery = new Date(r.deliveryDate);
      if (delivery < now) {
        const daysOverdue = Math.floor((now - delivery) / (1000 * 60 * 60 * 24));
        overdueList.push({ poId: r.poId, vendor: r.vendor, deliveryDate: r.deliveryDate, daysOverdue, grand: parseFloat(r.grand) || 0 });
        deliveryTimeline.overdue++;
      } else if (delivery <= weekEnd) deliveryTimeline.thisWeek++;
      else if (delivery <= monthEnd) deliveryTimeline.thisMonth++;
      else deliveryTimeline.later++;
    });
    overdueList.sort((a, b) => b.daysOverdue - a.daysOverdue);

    res.json({
      success: true,
      stats: {
        totalPRNs: parseInt(c.total_prns, 10),
        activePRNs: parseInt(c.active_prns, 10),
        closedPRNs: parseInt(c.closed_prns, 10),
        avgPRNAgeDays,
        totalPOs: parseInt(po.total_pos, 10),
        totalPOValue: parseFloat(po.total_po_value),
        materialsCovered: parseInt(matCov.covered, 10),
        materialsTotal: parseInt(matCov.total, 10),
        prnPendingAssignment, prnFullyCovered,
      },
      prnTrend, ageBuckets, byType, deliveryTimeline,
      // poValueTrend/projectCoverageList intentionally empty — pdRenderDashboard
      // destructures both but never actually reads either one, so computing
      // them here (each needs its own query) would be dead work.
      poValueTrend: [], projectCoverageList: [],
      noPoItems: noPoItemsClean, overdueList, showTrend: !["today", "yesterday"].includes(periodType),
    });
  } catch (err) {
    console.error('fetchPurchaseDashboardData error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchStoreDashboardData', requirePermission('perm_store_dashboard'), async (req, res) => {
  try {
    const { periodType, periodValue } = req.body;
    const { start, end } = getPeriodBounds(periodType || 'today', periodValue);

    // Ticket rows in period — driving totalTickets/byDept/dailyTrend/returnTickets/
    // boqOverruns/avg-approval-time, same multi-purpose pass as code.js.
    // request_or_return's real value is 'Return Material', not 'Return' —
    // the stub filtered on the wrong string.
    const { rows: tkRows } = await pool.query(
      `SELECT status, department, date_created, date_actioned, request_or_return
       FROM store.store_tickets WHERE date_created BETWEEN $1 AND $2`,
      [start, end]
    );
    let totalTickets = 0, returnTickets = 0, boqOverruns = 0;
    const approvalTimes = [];
    const byDept = {};
    const dailyMap = {};
    tkRows.forEach(r => {
      totalTickets++;
      if (r.request_or_return === 'Return Material') returnTickets++;
      if (r.status === 'Pending BOQ Increase Review') boqOverruns++;
      const dept = r.department || '(Unassigned)';
      byDept[dept] = (byDept[dept] || 0) + 1;
      const dayKey = istDayKey(r.date_created);
      dailyMap[dayKey] = (dailyMap[dayKey] || 0) + 1;
      if (r.status === 'Approved & Released' && r.date_actioned) {
        approvalTimes.push((new Date(r.date_actioned) - new Date(r.date_created)) / (1000 * 60));
      }
    });

    // Daily trend — fill zero days for <=60 day ranges, weekly buckets otherwise, same as code.js.
    const dailyTrend = [];
    const diffDaysCeil = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (diffDaysCeil <= 60) {
      let cur = new Date(start);
      while (cur <= end) {
        const key = istDayKey(cur);
        dailyTrend.push({ label: key.slice(5), count: dailyMap[key] || 0 });
        cur = new Date(cur.getTime() + 86400000);
      }
    } else {
      const weekMap = {};
      Object.keys(dailyMap).forEach(day => {
        const wk = istWeekKey(day);
        weekMap[wk] = (weekMap[wk] || 0) + dailyMap[day];
      });
      Object.keys(weekMap).sort().forEach(k => dailyTrend.push({ label: "Wk " + k.slice(5), count: weekMap[k] }));
    }

    // Live snapshots (not period-bound).
    const { rows: [t] } = await pool.query(`SELECT COUNT(*) AS c FROM store.store_tickets WHERE status = 'Pending'`);
    const { rows: [bi] } = await pool.query(`SELECT COUNT(*) AS c FROM store.store_tickets WHERE status = 'Pending BOQ Increase Review'`);

    // GRN stats — transaction_status = 'QA Passed' is the real completion
    // state (confirmed via commitStoreQAPipelineStep), not the stub's bare
    // "grn_number IS NOT NULL" (grn_number gets set at the earlier GRN
    // step too, before QA is done). qa_timestamp anchors the period filter
    // since that's when the GRN is actually considered complete;
    // type_of_material isn't a column on the ledger itself, so it's
    // resolved via design.item_codes.
    const { rows: grnRows } = await pool.query(
      `SELECT l.grn_number AS "grnNumber", COALESCE(ic.type_of_material, 'Unknown') AS type, l.ok_quantity AS "okQty"
       FROM store.inbound_store_ledger l
       LEFT JOIN design.item_codes ic ON ic.item_code = l.item_code
       WHERE l.transaction_status = 'QA Passed' AND l.qa_timestamp BETWEEN $1 AND $2`,
      [start, end]
    );
    const grnByType = {};
    const grnNumbers = new Set();
    grnRows.forEach(r => {
      grnNumbers.add(r.grnNumber);
      grnByType[r.type] = (grnByType[r.type] || 0) + (parseFloat(r.okQty) || 0);
    });

    const { rows: [s] } = await pool.query(`SELECT COUNT(*) AS c FROM store.spare_store`);

    // Recent tickets feed — last 10, all statuses.
    const { rows: recentTickets } = await pool.query(
      `SELECT ticket_id AS "ticketId", project_id AS "projectId", department,
              requested_returned_by AS "requestedBy", status, date_created AS "dateCreated"
       FROM store.store_tickets ORDER BY date_created DESC LIMIT 10`
    );

    // Project health — ALL tickets regardless of period, per code.js.
    const { rows: healthRows } = await pool.query(
      `SELECT project_id AS "projId", status, items
       FROM store.store_tickets WHERE project_id IS NOT NULL AND project_id <> ''`
    );
    const projectMap = {};
    healthRows.forEach(r => {
      if (!projectMap[r.projId]) projectMap[r.projId] = { customer: r.projId, totalTickets: 0, approved: 0, pending: 0, qtyConsumed: 0 };
      const p = projectMap[r.projId];
      p.totalTickets++;
      if (r.status === 'Approved & Released') {
        p.approved++;
        const items = Array.isArray(r.items) ? r.items : [];
        items.forEach(it => { p.qtyConsumed += parseFloat(it.quantity || it.requestedQty || 0) || 0; });
      }
      if (r.status === 'Pending') p.pending++;
    });
    const { rows: projRows } = await pool.query(`SELECT project_id AS "projId", company_name AS customer FROM project.projects`);
    projRows.forEach(r => { if (projectMap[r.projId]) projectMap[r.projId].customer = r.customer || r.projId; });
    const projectHealth = Object.keys(projectMap).map(projId => ({
      projId, customer: projectMap[projId].customer, totalTickets: projectMap[projId].totalTickets,
      approved: projectMap[projId].approved, pending: projectMap[projId].pending,
      qtyConsumed: Math.round(projectMap[projId].qtyConsumed * 100) / 100,
    })).sort((a, b) => b.totalTickets - a.totalTickets);

    // BOQs Needing PRN (live) — Authorized BOQ whose boq_date is newer than
    // the latest non-Closed PRN raised against it (or no PRN at all yet).
    // Same caveat as the Design Dashboard port: boq_drafts only has
    // boq_date, not a separate "last updated" timestamp, so this is an
    // approximation of code.js's lastUpdatedTimestamp comparison.
    const { rows: prnByBoq } = await pool.query(
      `SELECT boq_id AS "boqId", MAX(created_date) AS "latestPrnDate"
       FROM purchase.purchase_request_notes WHERE status <> 'Closed' AND boq_id IS NOT NULL
       GROUP BY boq_id`
    );
    const latestPrnDateByBoq = {};
    prnByBoq.forEach(r => { latestPrnDateByBoq[r.boqId] = new Date(r.latestPrnDate); });
    const { rows: authBoqs } = await pool.query(`SELECT boq_id AS "boqId", boq_date AS "boqDate" FROM design.boq_drafts WHERE status = 'Authorized'`);
    let boqsNeedingPRN = 0;
    authBoqs.forEach(r => {
      const existing = latestPrnDateByBoq[r.boqId];
      if (!existing || (r.boqDate && new Date(r.boqDate) > existing)) boqsNeedingPRN++;
    });

    res.json({
      success: true,
      stats: {
        totalTickets, pendingApprovals: parseInt(t.c, 10), totalGRNs: grnNumbers.size,
        spareStoreItems: parseInt(s.c, 10), boqsNeedingPRN,
        pendingBOQIncrease: parseInt(bi.c, 10), returnTickets, boqOverruns,
      },
      byDept, dailyTrend, grnByType, projectHealth, recentTickets,
    });
  } catch (err) {
    console.error('fetchStoreDashboardData error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchProductionDashboardData', requirePermission('perm_production_dashboard'), async (req, res) => {
  try {
    const { periodType, periodValue } = req.body;
    const { start, end } = getPeriodBounds(periodType || 'today', periodValue);

    // production.job_cards status is Open / Completed / Excess-Orphaned only
    // (confirmed via design.js) — 'Active' from code.js maps to 'Open'.
    // Department isn't a column on job_cards at all; it only lives on
    // finished_goods_inventory (each FG row), matching how code.js actually
    // built byDept from the FG sheet, not the JobCardNumber sheet.
    const { rows: jcRows } = await pool.query(
      `SELECT job_card_number AS jcn, project_id AS "projectId", product_name AS "productName",
              product_rating AS "productRating", customer_name AS "customerName", status
       FROM production.job_cards`
    );
    const activeJCNs = jcRows.filter(r => r.status === 'Open').length;
    const jcnMetaMap = {};
    const activeJCNSet = new Set();
    jcRows.forEach(r => {
      if (r.status === 'Open') {
        activeJCNSet.add(r.jcn);
        jcnMetaMap[r.jcn] = r;
      }
    });
    const uniqueProjectsActive = new Set(
      jcRows.filter(r => r.status === 'Open').map(r => r.projectId).filter(Boolean)
    ).size;

    // Finished Goods pass — finishedThisPeriod/byDept/dailyTrend/recentFG all
    // anchor on fg_date, and finishedJCNSet drives the in-progress dedupe below.
    const { rows: fgRows } = await pool.query(
      `SELECT job_card_number AS jcn, department, fg_date AS "fgDate", project_id AS "projectId",
              product_name AS "productName", product_rating AS "productRating", qa_done AS "qaDone"
       FROM production.finished_goods_inventory`
    );
    const finishedJCNSet = new Set(fgRows.map(r => r.jcn).filter(Boolean));
    let finishedThisPeriod = 0;
    const byDept = {};
    const dailyMap = {};
    const recentFGAll = [];
    fgRows.forEach(r => {
      if (!r.fgDate) return;
      const dt = new Date(r.fgDate);
      const inPeriod = dt >= start && dt <= end;
      if (inPeriod) {
        finishedThisPeriod++;
        const dept = r.department || '(Unassigned)';
        byDept[dept] = (byDept[dept] || 0) + 1;
        const dayKey = istDayKey(dt);
        dailyMap[dayKey] = (dailyMap[dayKey] || 0) + 1;
      }
      recentFGAll.push({
        date: istDayKey(dt), department: r.department || '',
        projectId: r.projectId || '', jobCardNumber: r.jcn || '',
        productName: r.productName || '', productRating: r.productRating || '',
        qaDone: r.qaDone ? 'Yes' : 'No', _ts: dt.getTime(),
      });
    });
    const recentFG = recentFGAll.sort((a, b) => b._ts - a._ts).slice(0, 10).map(({ _ts, ...rest }) => rest);

    // Daily trend — same fill-zero-days pattern as the other dashboards.
    const dailyTrend = [];
    const diffDaysCeil = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (diffDaysCeil <= 60) {
      let cur = new Date(start);
      while (cur <= end) {
        const key = istDayKey(cur);
        dailyTrend.push({ label: key.slice(5), count: dailyMap[key] || 0 });
        cur = new Date(cur.getTime() + 86400000);
      }
    } else {
      const weekMap = {};
      Object.keys(dailyMap).forEach(day => {
        const wk = istWeekKey(day);
        weekMap[wk] = (weekMap[wk] || 0) + dailyMap[day];
      });
      Object.keys(weekMap).sort().forEach(k => dailyTrend.push({ label: "Wk " + k.slice(5), count: weekMap[k] }));
    }

    // Store tickets — period count + per-JCN approved-ticket activity map
    // (drives inProgressJCNs below). 'Pending' / 'Pending BOQ Increase Review'
    // are the real status strings (confirmed on the Store Dashboard pass),
    // not code.js's 'Pending Approval'.
    const { rows: tkRows } = await pool.query(
      `SELECT job_card_number AS jcn, status, date_created AS "dateCreated", date_actioned AS "dateActioned"
       FROM store.store_tickets WHERE job_card_number IS NOT NULL`
    );
    let storeTickets = 0;
    const jcnTicketMap = {};
    tkRows.forEach(r => {
      const created = r.dateCreated ? new Date(r.dateCreated) : null;
      if (created && created >= start && created <= end) storeTickets++;
      if (r.status === 'Approved & Released') {
        const actioned = r.dateActioned ? new Date(r.dateActioned) : created;
        if (!jcnTicketMap[r.jcn]) jcnTicketMap[r.jcn] = { count: 0, lastActivity: actioned };
        jcnTicketMap[r.jcn].count++;
        if (actioned > jcnTicketMap[r.jcn].lastActivity) jcnTicketMap[r.jcn].lastActivity = actioned;
      }
    });
    const { rows: [live] } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'Pending') AS pending,
              COUNT(*) FILTER (WHERE status = 'Pending BOQ Increase Review') AS jc_increase
       FROM store.store_tickets`
    );

    // In-progress JCNs — Open + has approved ticket activity + not yet in FG.
    const inProgressJCNs = [];
    activeJCNSet.forEach(jcn => {
      if (finishedJCNSet.has(jcn)) return;
      const tk = jcnTicketMap[jcn];
      if (!tk) return;
      const meta = jcnMetaMap[jcn] || {};
      inProgressJCNs.push({
        jcn, projectId: meta.projectId || '', productName: meta.productName || '',
        productRating: meta.productRating || '', department: '', // not tracked on job_cards
        ticketCount: tk.count, lastActivity: tk.lastActivity ? istDayKey(tk.lastActivity) : '—',
      });
    });
    inProgressJCNs.sort((a, b) => (b.lastActivity > a.lastActivity ? 1 : -1));

    // Project Completion — finished vs in-progress per project. customer_name
    // is denormalized directly onto job_cards, so no separate Projects lookup
    // is needed the way code.js required.
    const projCompMap = {};
    finishedJCNSet.forEach(jcn => {
      const meta = jcRows.find(r => r.jcn === jcn);
      if (!meta || !meta.projectId) return;
      if (!projCompMap[meta.projectId]) projCompMap[meta.projectId] = { customerName: meta.customerName || meta.projectId, finished: 0, inProgress: 0 };
      projCompMap[meta.projectId].finished++;
    });
    activeJCNSet.forEach(jcn => {
      if (finishedJCNSet.has(jcn)) return;
      const meta = jcnMetaMap[jcn];
      if (!meta || !meta.projectId) return;
      if (!projCompMap[meta.projectId]) projCompMap[meta.projectId] = { customerName: meta.customerName || meta.projectId, finished: 0, inProgress: 0 };
      projCompMap[meta.projectId].inProgress++;
    });
    const projectCompletion = Object.values(projCompMap)
      .filter(p => (p.finished + p.inProgress) > 0)
      .sort((a, b) => (b.finished + b.inProgress) - (a.finished + a.inProgress));

    res.json({
      success: true,
      stats: {
        activeJCNs, finishedThisPeriod, inProgress: inProgressJCNs.length,
        pendingStoreApprovals: parseInt(live.pending, 10),
        uniqueProjectsActive,
        storeTickets,
        jcIncreaseRequestsPending: parseInt(live.jc_increase, 10),
        // boqUtilPct can't be computed — migration 024 dropped the
        // total/used product quantity columns on design.bill_of_quantity
        // ("never wired to anything live"), so there's no source of truth
        // for utilization anymore. Left null on purpose, not an oversight.
        boqUtilPct: null,
      },
      byDept, dailyTrend, inProgressJCNs, recentFG, projectCompletion,
    });
  } catch (err) {
    console.error('fetchProductionDashboardData error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;