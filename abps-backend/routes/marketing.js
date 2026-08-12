// ═══════════════════════════════════════════════════════════════════════
// routes/marketing.js — Companies, Enquiries, FollowUps, Tasks,
// Uploaded Document commit (with duplicate PO guard), Offers.
// Ports: searchCompanyData, updateCompany, deleteCompany, updateLeadFull,
//        saveFollowUp, deleteFollowUp, saveTask, deleteTask,
//        searchByQualifications, searchByStatus, searchByEngineer,
//        searchLeadsMatrixCombination, searchTasksMatrix,
//        searchLeadsByCityStateMatrix, commitMarketingOperationsDocument
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool, withTransaction } = require('../db');
const { requirePermission } = require('../auth');
const { writeAuditLog } = require('../lib/audit');
const { syncLiveRow } = require('../lib/liveSync');
const { parseBusinessCard, classifyInboundEmail, summarizeInboundEmail, classifyOutboundEmail, extractOfferDetails, parseCustomerPurchaseOrder, parseDispatchBill, parseCommissionReport, cleanupLeadTextFields, checkGeminiRateLimit } = require('../lib/gemini');
const { fetchUnreadMessages, fetchSentMessagesMatching, markAsRead, listConnectedAccounts } = require('../lib/gmail');
const { ensureProjectFolderStructure } = require('../lib/drive');
const { generateAbpsProjectId } = require('./projects');

// Statuses that outbound offer detection should never downgrade — an
// email classified as "Offer Sent" shouldn't roll a lead backwards if
// it's already progressed further, matching the doNotDowngradeStatuses
// guard in code.js.
const NO_DOWNGRADE_STATUSES = new Set(['Order Received', 'Order Dispatched', 'Product Commissioned']);
const { uploadFile } = require('../lib/drive');
const { displayName } = require('../lib/displayName');

const router = express.Router();

// ── Shared lead-card + follow-up/task assembly ─────────────────────────
// One place building the exact "Capitalized Header" shape the leads UI
// expects (buildMultiContactDirectoryInterface / buildTargetedLeadsFormCanvas)
// and the camelCase shape the follow-up/task timeline UI expects
// (renderIsolatedFollowUpTimeline / renderIsolatedTaskItemsList). Reused
// by every search route so they stay consistent with each other and with
// the frontend's actual (undocumented) contract, instead of drifting
// apart the way they had before this fix — none of the 5 leads-list
// routes previously returned a shape the frontend could actually read.
const LEAD_CARD_SELECT = `
  SELECT e.lead_id AS "Lead ID", e.status AS "Status",
         COALESCE(TRIM(u.first_name || ' ' || u.last_name), e.engineer_name) AS "Engineer Name",
         e.contact_person_name AS "Contact Person Name", c.company_name AS "Company Name",
         e.position AS "Position", e.phone AS "Phone", e.alt_phone AS "Alt Phone", e.email AS "Email",
         c.website AS "Website", c.city AS "City", c.state AS "State", c.country AS "Country",
         c.company_address AS "Company Address",
         e.date_of_meeting AS "Date of Meeting", e.time_of_meeting AS "Time of Meeting",
         e.meeting_venue AS "Meeting Venue", e.venue_name_city AS "Venue Name / City",
         e.additional_meeting_details AS "Additional Meeting Details (if any)",
         e.abps_business_vertical AS "ABPS Business Vertical",
         c.type_of_customer AS "Type of Customer", c.type_of_vendor AS "Type of Vendor",
         e.low_power_factor_issue AS "Low Power Factor Issue",
         e.high_electricity_bill_issue AS "High Electricity Bill Issue",
         e.harmonics_issue AS "Harmonics Issue",
         e.transformer_heating_issue AS "Transformer Heating / Breakdown Issue",
         e.grid_stability_issue AS "Grid Stability Issue", e.tender_inquire AS "Tender Inquire",
         e.existing_system_details AS "Existing System Details",
         e.contract_demand_mva AS "Contract Demand (MVA)",
         e.voltage_level_requirements AS "Voltage Level Requirements",
         e.existing_project AS "Existing Project", e.products_discussed AS "Products Discussed",
         e.expected_tender_rfq_date AS "Expected Tender / RFQ Date",
         e.approx_requirement AS "Approx Requirement",
         e.send_company_profile AS "Send Company Profile",
         e.send_technical_presentation AS "Send Technical Presentation",
         e.arrange_site_visit AS "Arrange Site Visit", e.get_enquiry AS "Get Enquiry",
         e.send_offer AS "Send Offer", e.follow_up_required AS "Follow-Up Required"
  FROM marketing.leads e
  JOIN marketing.companies c ON c.company_id = e.company_id
  LEFT JOIN admin_db.users u ON u.email = e.engineer_name
`;

// Column whitelists — Object.keys(fields) is client-supplied and was
// being interpolated directly into the SET clause.
const COMPANY_UPDATABLE = new Set([
  'company_name','website','city','state','country','company_address',
  'type_of_industry','type_of_customer','type_of_vendor','materials_supplied'
]);
const LEAD_UPDATABLE = new Set([
  'status','engineer_name','contact_person_name','position','phone','alt_phone','email',
  'date_of_meeting','time_of_meeting','meeting_venue','venue_name_city','additional_meeting_details',
  'abps_business_vertical','low_power_factor_issue','high_electricity_bill_issue','harmonics_issue',
  'transformer_heating_issue','grid_stability_issue','purchase_inquire','tender_inquire',
  'existing_system_details','voltage_level_requirements','contract_demand_mva','running_demand_mva',
  'monthly_avg_power_factor','problem_observed','technical_discussion_summary','existing_project',
  'upcoming_project','products_discussed','approx_requirement','expected_tender_rfq_date',
  'expected_order_timeline','competitor_details','approx_business_potential','send_company_profile',
  'send_technical_presentation','arrange_site_visit','get_enquiry','send_offer',
  'follow_up_required','card_image_link'
]);
function buildSetClause(fields, whitelist, label) {
  const keys = Object.keys(fields).filter(k => whitelist.has(k));
  const rejected = Object.keys(fields).filter(k => !whitelist.has(k));
  if (rejected.length) throw new Error(`Unknown ${label} field(s): ${rejected.join(', ')}`);
  if (!keys.length) throw new Error(`No valid ${label} fields to update.`);
  return { clause: keys.map((k, i) => `${k} = $${i + 2}`).join(', '), values: keys.map(k => fields[k]) };
}

async function fetchFollowupsAndTasksMaps(leadIds) {
  const followups = {};
  const tasks = {};
  if (!leadIds.length) return { followups, tasks };

  const { rows: fupRows } = await pool.query(
    `SELECT f.follow_up_id, f.lead_id, f.follow_up_status, f.event_date,
            COALESCE(TRIM(u.first_name || ' ' || u.last_name), f.engineer_name) AS engineer_display,
            f.next_follow_up_date, f.next_follow_up_time, f.interaction_outcome, f.interaction_mode,
            f.next_action_type, f.objection_raised, f.interaction_notes
     FROM marketing.follow_ups f LEFT JOIN admin_db.users u ON u.email = f.engineer_name
     WHERE f.lead_id = ANY($1::text[]) ORDER BY f.event_date ASC`,
    [leadIds]
  );
  fupRows.forEach(f => {
    if (!followups[f.lead_id]) followups[f.lead_id] = [];
    followups[f.lead_id].push({
      num: f.follow_up_id, date: f.event_date, time: f.event_date, status: f.follow_up_status,
      leadId: f.lead_id, eng: f.engineer_display, nextDate: f.next_follow_up_date,
      nextTime: f.next_follow_up_time, outcome: f.interaction_outcome, mode: f.interaction_mode,
      nextActionType: f.next_action_type, objectionRaised: f.objection_raised, notes: f.interaction_notes,
    });
  });

  const { rows: taskRows } = await pool.query(
    `SELECT t.task_id, t.lead_id, t.task_status, t.task_priority, t.task_type,
            COALESCE(TRIM(u.first_name || ' ' || u.last_name), t.engineer_name) AS engineer_display,
            t.target_time, t.target_date, t.task_description, t.completion_notes,
            COALESCE(TRIM(au.first_name || ' ' || au.last_name), t.assigning_engineer) AS assigner_display,
            c.company_name, e.contact_person_name
     FROM marketing.tasks t
     LEFT JOIN admin_db.users u ON u.email = t.engineer_name
     LEFT JOIN admin_db.users au ON au.email = t.assigning_engineer
     LEFT JOIN marketing.leads e ON e.lead_id = t.lead_id
     LEFT JOIN marketing.companies c ON c.company_id = e.company_id
     WHERE t.lead_id = ANY($1::text[]) ORDER BY t.target_date ASC`,
    [leadIds]
  );
  taskRows.forEach(t => {
    if (!tasks[t.lead_id]) tasks[t.lead_id] = [];
    tasks[t.lead_id].push({
      id: t.task_id, priority: t.task_priority, type: t.task_type, eng: t.engineer_display,
      shift: t.target_time, targetDate: t.target_date, desc: t.task_description,
      completionNotes: t.completion_notes, status: t.task_status, assigner: t.assigner_display,
      companyName: t.company_name, personName: t.contact_person_name,
    });
  });

  return { followups, tasks };
}

// Same task shape as above, but as a flat array rather than grouped by
// lead — used by the Task Matrix search, which lists tasks across
// many enquiries at once rather than within one lead's accordion.
async function fetchTaskMatrixList(engineers, statuses) {
  const clauses = [];
  const params = [];
  let i = 1;
  if (engineers?.length) { clauses.push(`t.engineer_name = ANY($${i++}::text[])`); params.push(engineers); }
  if (statuses?.length)  { clauses.push(`t.task_status = ANY($${i++}::text[])`);   params.push(statuses); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT t.task_id, t.task_status, t.task_priority, t.task_type,
            COALESCE(TRIM(u.first_name || ' ' || u.last_name), t.engineer_name) AS engineer_display,
            t.target_time, t.target_date, t.task_description, t.completion_notes,
            COALESCE(TRIM(au.first_name || ' ' || au.last_name), t.assigning_engineer) AS assigner_display,
            c.company_name, e.contact_person_name
     FROM marketing.tasks t
     LEFT JOIN admin_db.users u ON u.email = t.engineer_name
     LEFT JOIN admin_db.users au ON au.email = t.assigning_engineer
     LEFT JOIN marketing.leads e ON e.lead_id = t.lead_id
     LEFT JOIN marketing.companies c ON c.company_id = e.company_id
     ${where} ORDER BY t.target_date ASC`,
    params
  );
  return rows.map(t => ({
    id: t.task_id, priority: t.task_priority, type: t.task_type, eng: t.engineer_display,
    shift: t.target_time, targetDate: t.target_date, desc: t.task_description,
    completionNotes: t.completion_notes, status: t.task_status, assigner: t.assigner_display,
    companyName: t.company_name, personName: t.contact_person_name,
  }));
}

// ── Companies ────────────────────────────────────────────────────────

// Wildcard search — any blank field is skipped, matching the "empty
// fields = wildcard filter" behavior from the narrative doc.
router.post('/searchCompanyData', requirePermission('perm_search_company'), async (req, res) => {
  const { companyName, city, state, country, typeOfCustomer, contactName } = req.body;
  try {
    const clauses = [];
    const params = [];
    let i = 1;
    if (companyName) { clauses.push(`c.company_name ILIKE $${i++}`); params.push(`%${companyName}%`); }
    if (city)         { clauses.push(`c.city ILIKE $${i++}`);         params.push(`%${city}%`); }
    if (state)        { clauses.push(`c.state ILIKE $${i++}`);        params.push(`%${state}%`); }
    if (country)       { clauses.push(`c.country ILIKE $${i++}`);       params.push(`%${country}%`); }
    if (typeOfCustomer) { clauses.push(`c.type_of_customer ILIKE $${i++}`); params.push(`%${typeOfCustomer}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows: leads } = await pool.query(
      `${LEAD_CARD_SELECT} ${where} ORDER BY e.ts DESC LIMIT 500`, params
    );

    if (leads.length === 0) {
      return res.json({ success: false, error: `No records found for: ${companyName || ''}` });
    }

    const { followups, tasks } = await fetchFollowupsAndTasksMaps(leads.map(l => l["Lead ID"]));

    const normalizeNameText = (s) => (s || '').toString()
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[.,]+$/g, '')
      .toLowerCase();
    let nameMatchFound = true;
    if (contactName && contactName.toString().trim() !== '') {
      const sanitizedTarget = normalizeNameText(contactName);
      nameMatchFound = leads.some(lead => normalizeNameText(lead["Contact Person Name"]) === sanitizedTarget);
    }

    res.json({ success: true, leads, followups, tasks, nameMatchFound });
  } catch (err) {
    console.error('searchCompanyData error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// updateCompany — cascades the company name to every child Lead row
// when renamed, matching the RENAME_CASCADE audit action in code.js.
// Wrapped in a transaction so the cascade can never half-apply.
router.post('/updateCompany', requirePermission('perm_card_details'), async (req, res) => {
  const { companyId, fields } = req.body;
  if (!companyId || !fields) return res.json({ success: false, error: 'Company ID and fields are required.' });

  try {
    await withTransaction(async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT company_name FROM marketing.companies WHERE company_id = $1`, [companyId]
      );
      if (!existing) throw new Error('Company not found.');

      const { clause, values } = buildSetClause(fields, COMPANY_UPDATABLE, 'company');
      await client.query(
        `UPDATE marketing.companies SET ${clause} WHERE company_id = $1`,
        [companyId, ...values]
      );

      // NOTE: enquiries.company_name doesn't exist in the schema — company
      // name lives only in marketing.companies, and enquiries reference it
      // via company_id, always joined fresh. So a rename here needs no
      // cascade at all; the "cascade" comment above was based on an
      // incorrect assumption about the schema shape, caught and fixed here.
      if (fields.company_name && fields.company_name !== existing.company_name) {
        await writeAuditLog(req.user.email, req.body.operatorName, 'Companies', 'RENAME', companyId,
          'Company renamed.', { from: existing.company_name, to: fields.company_name });
      }
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'Companies', 'UPDATE', companyId, 'Modified company profile values.', fields);
    syncLiveRow('companies', companyId);
    res.json({ success: true });
  } catch (err) {
    console.error('updateCompany error:', err);
    res.status(400).json({ success: false, error: 'Update failed: ' + err.message });
  }
});

// deleteCompany — admin-only, matching verifyIsSystemAdministrator gate.
router.post('/deleteCompany', requirePermission('perm_admin'), async (req, res) => {
  const { companyId } = req.body;
  try {
    await pool.query(`DELETE FROM marketing.companies WHERE company_id = $1`, [companyId]);
    await writeAuditLog(req.user.email, req.body.operatorName, 'Companies', 'DELETE', companyId, 'Deleted company record.');
    syncLiveRow('companies', companyId);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteCompany error:', err);
    // FK constraint will block deletion if enquiries still reference it —
    // surfaced here instead of silently orphaning records like Sheets could.
    res.status(400).json({ success: false, error: 'Delete failed — company likely still has linked Enquiries: ' + err.message });
  }
});

// ── Enquiries ────────────────────────────────────────────────────────

router.post('/updateLeadFull', requirePermission('perm_card_details'), async (req, res) => {
  const { leadId } = req.body;
  let { fields } = req.body;
  if (!leadId || !fields) return res.json({ success: false, error: 'Lead ID and fields are required.' });
  try {
    try { fields = await cleanupLeadTextFields(fields); }
    catch (cleanupErr) { console.error('cleanupLeadTextFields failed (non-fatal, using raw fields):', cleanupErr); }
    const { clause, values } = buildSetClause(fields, LEAD_UPDATABLE, 'lead');
    const { rowCount } = await pool.query(
      `UPDATE marketing.leads SET ${clause} WHERE lead_id = $1`,
      [leadId, ...values]
    );
    if (rowCount === 0) return res.json({ success: false, error: 'Lead not found.' });

    await writeAuditLog(req.user.email, req.body.operatorName, 'Leads', 'UPDATE', leadId, 'Modified lead fields.', fields);
    syncLiveRow('leads', leadId);
    res.json({ success: true });
  } catch (err) {
    console.error('updateLeadFull error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/deleteLeadRow', requirePermission('perm_admin'), async (req, res) => {
  const { leadId } = req.body;
  try {
    await pool.query(`DELETE FROM marketing.leads WHERE lead_id = $1`, [leadId]);
    await writeAuditLog(req.user.email, req.body.operatorName, 'Leads', 'DELETE', leadId, 'Deleted lead record.');
    syncLiveRow('leads', leadId);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteLeadRow error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Search variants ─────────────────────────────────────────────────────
// Each of these existed as its own Apps Script function against a full
// sheet scan; here they're just parameterized WHERE clauses hitting an
// indexed column — orders of magnitude faster as row count grows.

router.post('/searchByStatus', requirePermission('perm_search_status'), async (req, res) => {
  const { statusValue } = req.body;
  try {
    const { rows: leads } = await pool.query(`${LEAD_CARD_SELECT} WHERE e.status = $1 ORDER BY e.ts DESC`, [statusValue]);
    const { followups, tasks } = await fetchFollowupsAndTasksMaps(leads.map(l => l["Lead ID"]));
    res.json({ success: true, leads, followups, tasks });
  } catch (err) {
    console.error('searchByStatus error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchByEngineer', requirePermission('perm_search_status'), async (req, res) => {
  const { engName } = req.body;
  try {
    const { rows: leads } = await pool.query(`${LEAD_CARD_SELECT} WHERE e.engineer_name = $1 ORDER BY e.ts DESC`, [engName]);
    const { followups, tasks } = await fetchFollowupsAndTasksMaps(leads.map(l => l["Lead ID"]));
    res.json({ success: true, leads, followups, tasks });
  } catch (err) {
    console.error('searchByEngineer error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchLeadsMatrixCombination', requirePermission('perm_search_status'), async (req, res) => {
  const { engineers, statuses } = req.body; // arrays; empty array = wildcard (no filter on that dimension)
  try {
    const clauses = [];
    const params = [];
    let i = 1;
    if (engineers?.length) { clauses.push(`e.engineer_name = ANY($${i++}::text[])`); params.push(engineers); }
    if (statuses?.length)  { clauses.push(`e.status = ANY($${i++}::text[])`);        params.push(statuses); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows: leads } = await pool.query(`${LEAD_CARD_SELECT} ${where} ORDER BY e.ts DESC`, params);
    const { followups, tasks } = await fetchFollowupsAndTasksMaps(leads.map(l => l["Lead ID"]));
    res.json({ success: true, leads, followups, tasks });
  } catch (err) {
    console.error('searchLeadsMatrixCombination error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchLeadsByCityStateMatrix', requirePermission('perm_search_city_state'), async (req, res) => {
  const { states, cities } = req.body;
  try {
    const clauses = [];
    const params = [];
    let i = 1;
    if (states?.length) { clauses.push(`c.state = ANY($${i++}::text[])`); params.push(states); }
    if (cities?.length) { clauses.push(`c.city = ANY($${i++}::text[])`);  params.push(cities); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows: leads } = await pool.query(`${LEAD_CARD_SELECT} ${where} ORDER BY e.ts DESC`, params);
    const { followups, tasks } = await fetchFollowupsAndTasksMaps(leads.map(l => l["Lead ID"]));
    res.json({ success: true, leads, followups, tasks });
  } catch (err) {
    console.error('searchLeadsByCityStateMatrix error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchByQualifications', requirePermission('perm_search_qualification'), async (req, res) => {
  const { qualifications } = req.body; // e.g. type_of_customer values — must ALL be present (AND, not OR)
  if (!qualifications?.length) return res.json({ success: false, error: 'Select at least one Type of Customer.' });
  try {
    const { rows: leads } = await pool.query(
      `${LEAD_CARD_SELECT} WHERE string_to_array(c.type_of_customer, ', ') @> $1::text[] ORDER BY e.ts DESC`,
      [qualifications]
    );
    const { followups, tasks } = await fetchFollowupsAndTasksMaps(leads.map(l => l["Lead ID"]));
    res.json({ success: true, leads, followups, tasks });
  } catch (err) {
    console.error('searchByQualifications error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── FollowUps ────────────────────────────────────────────────────────

router.post('/saveFollowUp', requirePermission('perm_card_details'), async (req, res) => {
  const { followUpData } = req.body;
  // The frontend's edit form reuses its "num" field to carry the real
  // follow_up_id when editing (see index.html renderIsolatedFollowUpTimeline/
  // editIsolatedFollowUpItem) — isEdit tells us whether to treat it as
  // an update target or ignore it entirely for a fresh insert.
  const followUpId = followUpData.isEdit ? followUpData.num : null;
  try {
    let id = followUpId;
    if (id) {
      const { rowCount: fupRows } = await pool.query(
        `UPDATE marketing.follow_ups SET follow_up_status=$1, interaction_notes=$2, interaction_outcome=$3,
           interaction_mode=$4, next_follow_up_date=$5, next_follow_up_time=$6, next_action_type=$7, objection_raised=$8
         WHERE follow_up_id = $9`,
        [followUpData.status, followUpData.notes, followUpData.outcome, followUpData.mode,
         followUpData.nextDate, followUpData.nextTime, followUpData.nextActionType, followUpData.objectionRaised, id]
      );
    } else {
      const { rows } = await pool.query(
        `INSERT INTO marketing.follow_ups
           (follow_up_status, lead_id, engineer_name, interaction_notes, interaction_outcome,
            interaction_mode, next_follow_up_date, next_follow_up_time, next_action_type, objection_raised)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING follow_up_id`,
        [followUpData.status || 'Pending', followUpData.leadRef, displayName(req), followUpData.notes,
         followUpData.outcome, followUpData.mode, followUpData.nextDate, followUpData.nextTime,
         followUpData.nextActionType, followUpData.objectionRaised]
      );
      id = rows[0].follow_up_id;
    }
    await writeAuditLog(req.user.email, req.body.operatorName, 'FollowUps', followUpId ? 'UPDATE' : 'CREATE', id, 'Saved follow-up.');
    syncLiveRow('follow_ups', id);
    res.json({ success: true, followUpId: id });
  } catch (err) {
    console.error('saveFollowUp error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/deleteFollowUp', requirePermission('perm_admin'), async (req, res) => {
  const { fupId } = req.body;
  try {
    await pool.query(`DELETE FROM marketing.follow_ups WHERE follow_up_id = $1`, [fupId]);
    await writeAuditLog(req.user.email, req.body.operatorName, 'FollowUps', 'DELETE', fupId, 'Deleted follow-up.');
    syncLiveRow('follow_ups', fupId);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteFollowUp error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Tasks ────────────────────────────────────────────────────────────

router.post('/saveTask', requirePermission('perm_search_tasks'), async (req, res) => {
  const { taskData } = req.body;
  // Frontend sends id: "NEW" (string) for a fresh task, or the real
  // task_id for an edit — see index.html commitIsolatedTaskItem.
  const taskId = (taskData.id && taskData.id !== 'NEW') ? taskData.id : null;
  try {
    let id = taskId;
    if (id) {
      await pool.query(
        `UPDATE marketing.tasks SET task_status=$1, task_description=$2, task_priority=$3,
           target_time=$4, target_date=$5, completion_notes=$6
         WHERE task_id = $7`,
        [taskData.status, taskData.desc, taskData.priority, taskData.shift,
         taskData.targetDate, taskData.completionNotes, id]
      );
    } else {
      const { rows } = await pool.query(
        `INSERT INTO marketing.tasks
           (task_status, lead_id, engineer_name, assigning_engineer, task_type, task_description,
            task_priority, target_time, target_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING task_id`,
        [taskData.status || 'Pending', taskData.leadRef, taskData.engineer, taskData.assigner,
         taskData.type, taskData.desc, taskData.priority, taskData.shift, taskData.targetDate]
      );
      id = rows[0].task_id;
    }
    await writeAuditLog(req.user.email, req.body.operatorName, 'Tasks', taskId ? 'UPDATE' : 'CREATE', id, 'Saved task.');
    syncLiveRow('tasks', id);
    res.json({ success: true, taskId: id });
  } catch (err) {
    console.error('saveTask error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/deleteTask', requirePermission('perm_admin'), async (req, res) => {
  const { taskId } = req.body;
  try {
    await pool.query(`DELETE FROM marketing.tasks WHERE task_id = $1`, [taskId]);
    await writeAuditLog(req.user.email, req.body.operatorName, 'Tasks', 'DELETE', taskId, 'Deleted task.');
    syncLiveRow('tasks', taskId);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteTask error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchTasksMatrix', requirePermission('perm_search_tasks'), async (req, res) => {
  const { engineers, statuses } = req.body;
  try {
    const tasks = await fetchTaskMatrixList(engineers, statuses);
    res.json({ success: true, tasks });
  } catch (err) {
    console.error('searchTasksMatrix error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Column whitelist — same reasoning as COMPANY_UPDATABLE/LEAD_UPDATABLE
// above: `fields` here is client-supplied (req.body.fields, merged with
// AI-extracted values) and was being interpolated directly into the SET/
// INSERT column list with no validation, letting any caller with one of
// the 3 department permissions below write to arbitrary columns (or break
// out of the column-name position entirely) on this table. doc_id/lead_id/
// status/*_document_url are written by dedicated code paths elsewhere in
// this route, not through `fields` — excluded here on purpose.
const UPLOADED_DOC_UPDATABLE = new Set([
  'contact_person_name', 'company_name', 'project_id',
  'purchase_order_number', 'purchase_order_date', 'committed_delivery_date',
  'purchase_order_product_name', 'purchase_order_summary',
  'basic_po_amount', 'po_gst_amount', 'po_total_amount',
  'payment_terms', 'abps_owner_of_order', 'po_warranty_terms',
  'abg_required', 'scope_of_work',
  'dispatch_bill_invoice_number', 'dispatch_bill_invoice_date',
  'customer_po_number', 'customer_po_date',
  'basic_dispatch_bill_amount', 'dispatch_bill_gst_amount', 'total_dispatch_bill_amount',
  'date_of_product_commissioning', 'commissioning_engineer_name',
  'commissioned_product', 'customer_contact_person',
]);

// ── Document upload commit (PO / Dispatch Bill / Commissioning Report) ──
// commitMarketingOperationsDocument — the L1 duplicate-PO guard from
// code.js runs FIRST, inside the transaction, before any status change,
// so a rejected duplicate can never leave a partial write. This was a
// manually-ordered check in Apps Script; here it's enforced by the
// UNIQUE constraint on (purchase_order_number, dispatch_bill_invoice_number)
// in the schema PLUS this explicit pre-check for a clean error message.
router.post('/commitMarketingOperationsDocument', async (req, res) => {
  const { docType, leadId, fields: rawFields, fileName, base64Data, mimeType } = req.body; // docType: 'PURCHASE_ORDER' | 'DISPATCH' | 'COMMISSION'
  const fields = rawFields || {}; // DISPATCH/COMMISSION currently have no metadata fields at all -- only PURCHASE_ORDER sends abps_owner_of_order
  const REQUIRED_PERM_BY_TYPE = { PURCHASE_ORDER: 'perm_purchase_order', DISPATCH: 'perm_dispatch_bill', COMMISSION: 'perm_commissioning_report' };
  const requiredPerm = REQUIRED_PERM_BY_TYPE[docType];
  if (!requiredPerm || !req.user || !req.user[requiredPerm]) {
    return res.status(403).json({ success: false, error: 'Access Denied: insufficient permissions for this action.' });
  }
  const FOLDER_BY_TYPE = {
    PURCHASE_ORDER: process.env.PO_FOLDER_ID,
    DISPATCH: process.env.DISPATCH_FOLDER_ID,
    COMMISSION: process.env.COMMISSION_FOLDER_ID,
  };
  const URL_FIELD_BY_TYPE = {
    PURCHASE_ORDER: 'po_document_url',
    DISPATCH: 'dispatch_document_url',
    COMMISSION: 'commission_document_url',
  };

  // Customer PO extraction -- Company Name, PO Number, and Delivery Date
  // are read off the document itself via AI, not typed by hand. This also
  // makes the pre-existing duplicate-PO guard below actually fire (it
  // checks fields.purchase_order_number, which was never populated before).
  let extractedPO = null;
  if (docType === 'PURCHASE_ORDER' && base64Data) {
    try {
      await checkGeminiRateLimit(pool, req.user.email, 'parseCustomerPurchaseOrder');
      extractedPO = await parseCustomerPurchaseOrder(base64Data, mimeType);
      if (extractedPO?.companyName) fields.company_name = extractedPO.companyName;
      if (extractedPO?.poNumber) fields.purchase_order_number = extractedPO.poNumber;
      if (extractedPO?.poDate) fields.purchase_order_date = extractedPO.poDate;
      if (extractedPO?.deliveryDate) fields.committed_delivery_date = extractedPO.deliveryDate;
      if (extractedPO?.productName) fields.purchase_order_product_name = extractedPO.productName;
      if (extractedPO?.summary) fields.purchase_order_summary = extractedPO.summary;
      if (extractedPO?.scopeOfWork) fields.scope_of_work = extractedPO.scopeOfWork;
      if (extractedPO?.basicAmount) fields.basic_po_amount = extractedPO.basicAmount;
      if (extractedPO?.gstAmount) fields.po_gst_amount = extractedPO.gstAmount;
      if (extractedPO?.totalAmount) fields.po_total_amount = extractedPO.totalAmount;
      if (extractedPO?.paymentTerms) fields.payment_terms = extractedPO.paymentTerms;
      if (extractedPO?.warrantyTerms) fields.po_warranty_terms = extractedPO.warrantyTerms;
      if (typeof extractedPO?.abgRequired === 'boolean') fields.abg_required = extractedPO.abgRequired;
    } catch (extractErr) {
      console.error('parseCustomerPurchaseOrder failed (non-fatal, continuing without auto-extracted fields):', extractErr);
    }
  }

  // Dispatch Bill Matching — fuzzy-matches the client company on the
  // dispatch/transport invoice against our leads database and extracts
  // invoice-level fields. NOTE: unlike the PURCHASE_ORDER block above,
  // this deliberately does NOT write extracted values onto `fields`/the
  // DB — marketing.uploaded_document_information's full column set
  // (beyond the *_url columns added in migration 010) hasn't been
  // verified against the live schema, and guessing column names here
  // risks a 500 on every dispatch upload instead of failing gracefully.
  // Extracted data is returned in the response for now; once the real
  // column names (or a decision to add new ones) are confirmed via
  // information_schema, this can persist directly like the PO block does.
  let extractedDispatch = null;
  if (docType === 'DISPATCH' && base64Data) {
    try {
      await checkGeminiRateLimit(pool, req.user.email, 'parseDispatchBill');
      const { rows: companies } = await pool.query(`SELECT company_id, company_name FROM marketing.companies`);
      extractedDispatch = await parseDispatchBill(base64Data, mimeType, companies);
      if (extractedDispatch?.invoiceNumber) fields.dispatch_bill_invoice_number = extractedDispatch.invoiceNumber;
      if (extractedDispatch?.invoiceDate) fields.dispatch_bill_invoice_date = extractedDispatch.invoiceDate;
      if (extractedDispatch?.customerPO) fields.customer_po_number = extractedDispatch.customerPO;
      if (extractedDispatch?.customerPODate) fields.customer_po_date = extractedDispatch.customerPODate;
      if (extractedDispatch?.subTotal) fields.basic_dispatch_bill_amount = extractedDispatch.subTotal;
      if (extractedDispatch?.gst) fields.dispatch_bill_gst_amount = extractedDispatch.gst;
      if (extractedDispatch?.grandTotal) fields.total_dispatch_bill_amount = extractedDispatch.grandTotal;
    } catch (extractErr) {
      console.error('parseDispatchBill failed (non-fatal, continuing without auto-extracted fields):', extractErr);
    }
  }

  // Commission Report Matching — same fuzzy-match pattern and same
  // "return, don't guess-persist" caveat as Dispatch Bill Matching above.
  let extractedCommission = null;
  if (docType === 'COMMISSION' && base64Data) {
    try {
      await checkGeminiRateLimit(pool, req.user.email, 'parseCommissionReport');
      const { rows: companies } = await pool.query(`SELECT company_id, company_name FROM marketing.companies`);
      extractedCommission = await parseCommissionReport(base64Data, mimeType, companies);
      if (extractedCommission?.commissioningDate) fields.date_of_product_commissioning = extractedCommission.commissioningDate;
      if (extractedCommission?.engineerNames) fields.commissioning_engineer_name = extractedCommission.engineerNames;
      if (extractedCommission?.commissionedProduct) fields.commissioned_product = extractedCommission.commissionedProduct;
      if (extractedCommission?.customerContactPerson) fields.customer_contact_person = extractedCommission.customerContactPerson;
    } catch (extractErr) {
      console.error('parseCommissionReport failed (non-fatal, continuing without auto-extracted fields):', extractErr);
    }
  }

  try {
    const { docId, newProjectId } = await withTransaction(async (client) => {
      if (docType === 'PURCHASE_ORDER' && fields.purchase_order_number) {
        const { rows: dupes } = await client.query(
          `SELECT 1 FROM marketing.uploaded_document_information
           WHERE lower(purchase_order_number) = lower($1)`,
          [fields.purchase_order_number]
        );
        if (dupes.length > 0) {
          throw new Error(`A record already exists for PO number "${fields.purchase_order_number}". Duplicate upload blocked.`);
        }
      }

      // Auto-create the Project, per PO upload -> Project (Inactive)
      // workflow -- only when extraction actually found a usable company
      // name (a garbled/empty-name project would be worse than none).
      let newProjectId = null;
      if (docType === 'PURCHASE_ORDER' && fields.company_name?.trim()) {
        newProjectId = generateAbpsProjectId(fields.company_name, fields.purchase_order_number);
        await client.query(
          `INSERT INTO project.projects (project_id, company_name, project_status, po_number, delivery_date)
           VALUES ($1,$2,'Inactive',$3,$4)
           ON CONFLICT (project_id) DO NOTHING`,
          [newProjectId, fields.company_name, fields.purchase_order_number || null, fields.committed_delivery_date || null]
        );
        fields.project_id = newProjectId;
      }

      // Upsert onto the lead's document row — one row per lead,
      // progressively filled in as PO / Dispatch / Commission stages complete.
      const { rows: [existing] } = await client.query(
        `SELECT doc_id FROM marketing.uploaded_document_information WHERE lead_id = $1`, [leadId]
      );

      let docId;
      // Whitelist-filtered — see UPLOADED_DOC_UPDATABLE. `fields` mixes
      // server-derived values (AI extraction, project_id above) with the
      // raw client payload; only known real columns are ever allowed into
      // the SET/INSERT column list, never the client-supplied key text itself.
      const fieldKeys = Object.keys(fields).filter(k => UPLOADED_DOC_UPDATABLE.has(k));
      const fieldValues = fieldKeys.map(k => fields[k]);
      if (existing) {
        // DISPATCH/COMMISSION send no fields at all -- nothing to SET,
        // just reuse the existing row (an empty SET clause is invalid SQL).
        if (fieldKeys.length > 0) {
          const setClauses = fieldKeys.map((k, idx) => `${k} = $${idx + 2}`).join(', ');
          await client.query(
            `UPDATE marketing.uploaded_document_information SET ${setClauses} WHERE doc_id = $1`,
            [existing.doc_id, ...fieldValues]
          );
        }
        docId = existing.doc_id;
      } else {
        const cols = ['lead_id', ...fieldKeys];
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
        const { rows } = await client.query(
          `INSERT INTO marketing.uploaded_document_information (${cols.join(', ')}) VALUES (${placeholders}) RETURNING doc_id`,
          [leadId, ...fieldValues]
        );
        docId = rows[0].doc_id;
      }

      // Status pipeline transition, per narrative doc: Order Received ->
      // Order Dispatched -> Product Commissioned
      const statusMap = { PURCHASE_ORDER: 'Order Received', DISPATCH: 'Order Dispatched', COMMISSION: 'Product Commissioned' };
      if (statusMap[docType]) {
        await client.query(`UPDATE marketing.leads SET status = $1 WHERE lead_id = $2`, [statusMap[docType], leadId]);
      }

      return { docId, newProjectId };
    });

    if (newProjectId) {
      // Drive folder creation deliberately deferred to activateProject
      // (Manufacturing Clearance) -- not created here at auto-creation
      // time, matching the same rule as the manual Create Project path.
      await writeAuditLog(req.user.email, req.body.operatorName, 'Projects', 'CREATE', newProjectId,
        `Auto-created from PO upload for "${fields.company_name}" (PO ${fields.purchase_order_number || 'unknown'}).`);
      syncLiveRow('projects', newProjectId);
    }

    await writeAuditLog(req.user.email, req.body.operatorName, 'UploadedDocumentInformation', 'COMMIT', docId,
      `Committed ${docType} document for lead ${leadId}.`);
    syncLiveRow('uploaded_document_information', docId);

    let fileUrl = null;
    if (base64Data && fileName && FOLDER_BY_TYPE[docType]) {
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        const uploaded = await uploadFile(FOLDER_BY_TYPE[docType], buffer, fileName, mimeType || 'application/octet-stream');
        fileUrl = uploaded.url;
        await pool.query(
          `UPDATE marketing.uploaded_document_information SET ${URL_FIELD_BY_TYPE[docType]} = $1 WHERE doc_id = $2`,
          [fileUrl, docId]
        );
        syncLiveRow('uploaded_document_information', docId);
      } catch (driveErr) {
        console.error('Document upload to Drive failed (non-fatal):', driveErr);
      }
    }

    res.json({ success: true, docId, fileUrl, extractedDispatch, extractedCommission });
    syncLiveRow('leads', leadId);
  } catch (err) {
    console.error('commitMarketingOperationsDocument error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/fetchUploadedDocumentInfo', requirePermission('perm_search_company'), async (req, res) => {
  const { leadId } = req.body;
  try {
    const { rows: [row] } = await pool.query(
      `SELECT * FROM marketing.uploaded_document_information WHERE lead_id = $1`, [leadId]
    );
    res.json({ success: true, row: row || null });
  } catch (err) {
    console.error('fetchUploadedDocumentInfo error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Business Card OCR (Gemini) ──────────────────────────────────────────
// "parse" — image in, structured fields back for the user to review/edit
// before committing. Nothing is written to the DB at this stage, matching
// the original two-step parse-then-submit flow.
router.post('/parse', requirePermission('perm_card_details'), async (req, res) => {
  const { base64Image, mimeType, base64ImageBack, mimeTypeBack } = req.body;
  if (!base64Image) return res.json({ success: false, error: 'Image data is required.' });
  try {
    const parsed = await parseBusinessCard(base64Image, mimeType, base64ImageBack, mimeTypeBack);
    res.json({ success: true, parsed });
  } catch (err) {
    console.error('parse (business card OCR) error:', err);
    res.status(500).json({ success: false, error: 'Card parsing failed: ' + err.message });
  }
});

// "submit" — commits the (possibly user-edited) parsed fields as a new
// Company + Lead, and uploads the card image to Drive if configured.
// One transaction: company + lead creation succeed or fail together,
// same as the earlier createBOQDraft-style pattern.
router.post('/submit', requirePermission('perm_card_details'), async (req, res) => {
  // This route was previously only saving 8 of the ~35+ fields the "New
  // Lead" form actually collects (no meeting details, no technical
  // section, no Section 5 action plan) — all of that was silently
  // discarded on every submission. Also used req.user.email (the shared
  // department login) instead of the operator's actually-selected
  // engineer name. Rewritten to persist everything and use the real
  // field key names the frontend sends (fields["Company Name"] etc, not
  // fields.companyName).
  let { fields, base64Image, mimeType } = req.body;
  if (fields) {
    try { fields = await cleanupLeadTextFields(fields); }
    catch (cleanupErr) { console.error('cleanupLeadTextFields failed (non-fatal, using raw fields):', cleanupErr); }
  }
  const companyName = fields?.["Company Name"];
  if (!companyName) return res.json({ success: false, error: 'Company Name is required.' });

  const yn = (v) => v === 'Yes'; // only for the 5 real yes/no columns
  const joinArr = (v) => Array.isArray(v) ? v.join(', ') : (v || null);
  const orNull = (v) => (v && String(v).trim()) || null; // free-text issue/inquire fields

  try {
    const result = await withTransaction(async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT company_id FROM marketing.companies WHERE lower(company_name) = lower($1)`, [companyName]
      );
      let companyId;
      if (existing) {
        companyId = existing.company_id;
      } else {
        const { rows: [company] } = await client.query(
          `INSERT INTO marketing.companies
             (company_name, website, city, state, country, company_address, type_of_industry,
              type_of_customer, type_of_vendor, materials_supplied, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING company_id`,
          [companyName, fields.website, fields.city, fields.state, fields.country, fields.address,
           fields.industry, joinArr(fields["Type of Customer"]), joinArr(fields.vendorType),
           fields["Name of Materials Supplied"], req.body.operatorName || displayName(req)]
        );
        companyId = company.company_id;
      }

      const { rows: [lead] } = await client.query(
        `INSERT INTO marketing.leads
           (company_id, status, engineer_name, contact_person_name, position, phone, alt_phone, email,
            date_of_meeting, time_of_meeting, meeting_venue, venue_name_city, additional_meeting_details,
            abps_business_vertical, low_power_factor_issue, high_electricity_bill_issue, harmonics_issue,
            transformer_heating_issue, grid_stability_issue, purchase_inquire, tender_inquire,
            existing_system_details, voltage_level_requirements, contract_demand_mva, running_demand_mva,
            monthly_avg_power_factor, problem_observed, technical_discussion_summary, existing_project,
            upcoming_project, products_discussed, approx_requirement, expected_tender_rfq_date,
            expected_order_timeline, competitor_details, approx_business_potential, send_company_profile,
            send_technical_presentation, arrange_site_visit, get_enquiry, send_offer, follow_up_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
                 $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42)
         RETURNING lead_id`,
         [companyId, fields.status || 'New Lead', fields.engineerName || req.body.operatorName || displayName(req),
         fields["Contact Person Name"], fields.position, fields.phone, fields.altPhone, fields.email,
         fields.meetingDate || null, fields.meetingTime || null, fields.meetingVenue, fields.venueName, fields.additionalMeetingDetails,
         fields.businessVertical, orNull(fields.lpi), orNull(fields.hbi), orNull(fields.hi), orNull(fields.thi), orNull(fields.gsi),
         orNull(fields.purchaseInquire), orNull(fields.tenderInquire), fields.esd, joinArr(fields["Voltage Level Requirements"]),
         fields.cdMva || null, fields.rdMva || null, fields.avgPf || null, fields.problemObserved, fields.techSummary,
         fields.existingProject, fields.upcomingProject, joinArr(fields.products), fields.approxReq,
         fields.tenderDate || null, fields.orderTimeline, fields.competitors, fields.potential,
         yn(fields.sendProfile), yn(fields.sendPresentation), yn(fields.arrangeVisit), yn(fields.getEnquiry),
         fields.sendOffer || 'No', yn(fields.followUpRequired)]
      );

      return { companyId, leadId: lead.lead_id };
    });

    let cardImageLink = null;
    if (base64Image && process.env.VISITING_CARDS_FOLDER_ID) {
      try {
        const buffer = Buffer.from(base64Image, 'base64');
        const uploaded = await uploadFile(process.env.VISITING_CARDS_FOLDER_ID, buffer, `card_${result.leadId}.jpg`, mimeType || 'image/jpeg');
        cardImageLink = uploaded.url;
        await pool.query(`UPDATE marketing.leads SET card_image_link = $1 WHERE lead_id = $2`, [cardImageLink, result.leadId]);
      } catch (driveErr) {
        console.error('Card image upload failed (non-fatal):', driveErr);
      }
    }

    await writeAuditLog(req.user.email, req.body.operatorName, 'Leads', 'CREATE', result.leadId,
      `Created lead from business card scan for "${companyName}".`);
    syncLiveRow('companies', result.companyId);
    syncLiveRow('leads', result.leadId);
    res.json({ success: true, ...result, cardImageLink });
  } catch (err) {
    console.error('submit (business card commit) error:', err);
    res.status(500).json({ success: false, error: 'Save failed: ' + err.message });
  }
});

// ── Inbound Email Lead Processing (Gemini + Gmail) ──────────────────────
// fetchAndProcessInboundEmailLeads — pulls the list of connected accounts
// from admin_db.gmail_connections (populated via the /api/gmailAuth/connect
// one-time consent flow), not a static env var, so adding the 6th, 7th...
// 10th account is self-serve — no redeploy needed.
// Extracted so both the user-facing button (POST /fetchAndProcessInboundEmailLeads)
// and the Cloud Scheduler-triggered internal route can call the same logic
// without duplicating it.
async function pollAllInboxes(triggeredBy) {
  const results = { processed: 0, leads: 0, errors: [] };
  const connectedAccounts = await listConnectedAccounts();

  for (const account of connectedAccounts) {
    try {
      const messages = await fetchUnreadMessages(account, 10);
      await pool.query(`UPDATE admin_db.gmail_connections SET last_used_at = now() WHERE email = $1`, [account]);
      for (const msg of messages) {
        try {
          const { rows: dupe } = await pool.query(`SELECT 1 FROM marketing.processed_emails WHERE message_id = $1`, [msg.messageId]);
          if (dupe.length > 0) continue; // already processed — safe to re-run this endpoint

          const classification = await classifyInboundEmail(msg.subject, msg.body, msg.from);
          let companyName = classification.companyName;
          let contactPerson = classification.contactPerson;
          let summary = null;

          if (classification.isLead) {
            const details = await summarizeInboundEmail(msg.subject, msg.body, msg.from);
            companyName = details.companyName || companyName;
            contactPerson = details.contactPerson || contactPerson;
            summary = details.summary;
          }

          await pool.query(
            `INSERT INTO marketing.processed_emails
               (message_id, notes, creator_of_note, is_lead, company, contact_person, ai_summary, subject,
                received_date, inbox_account)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [msg.messageId, null, triggeredBy, classification.isLead, companyName, contactPerson,
             summary, msg.subject, msg.date, account]
          );

          await markAsRead(account, msg.messageId);
          results.processed++;
          if (classification.isLead) results.leads++;
        } catch (msgErr) {
          console.error(`Error processing message ${msg.messageId}:`, msgErr);
          results.errors.push({ messageId: msg.messageId, error: msgErr.message });
        }
      }
    } catch (accountErr) {
      console.error(`Error polling account ${account}:`, accountErr);
      results.errors.push({ account, error: accountErr.message });
    }
  }
  return results;
}

router.post('/fetchAndProcessInboundEmailLeads', requirePermission('perm_email_leads'), async (req, res) => {
  const results = await pollAllInboxes(req.user.email);
  res.json({ success: true, ...results });
});

// ── Outbound Sent-Offer Detection (Gemini + Gmail Sent search) ──────────
// pollOutboundOffers — scans each connected account's Sent folder for
// likely quote/offer/proposal emails from the last 2 days (matching
// code.js's lookback window), classifies each with the cheap Step 1
// model, and only runs the fuller Step 2 extraction on genuine offers.
async function pollOutboundOffers(triggeredBy) {
  const results = { scanned: 0, offersLogged: 0, coldOutreachLogged: 0, errors: [] };
  const connectedAccounts = await listConnectedAccounts();

  const { rows: companies } = await pool.query(`SELECT company_id, company_name FROM marketing.companies`);

  for (const account of connectedAccounts) {
    try {
      const query = 'in:sent subject:(quote OR offer OR commercial OR budgetary OR proposal) newer_than:2d';
      const messages = await fetchSentMessagesMatching(account, query, 50);

      for (const msg of messages) {
        try {
          const { rows: dupe } = await pool.query(`SELECT 1 FROM marketing.processed_emails WHERE message_id = $1`, [msg.messageId]);
          if (dupe.length > 0) continue;

          // Skip internal-only recipients — zero AI cost, matches code.js
          const isInternalOnly = msg.to.split(',').every(addr => addr.trim().toLowerCase().includes('abpssolutions.com'));
          if (isInternalOnly) {
            await pool.query(
              `INSERT INTO marketing.processed_emails (message_id, subject, inbox_account, thread_link)
               VALUES ($1,$2,$3,$4) ON CONFLICT (message_id) DO NOTHING`,
              [msg.messageId, msg.subject, account, `https://mail.google.com/mail/u/0/#sent/${msg.threadId}`]
            );
            continue;
          }

          results.scanned++;
          const { classification } = await classifyOutboundEmail(msg.subject, msg.body);

          if (classification === 'OFFER') {
            const details = await extractOfferDetails(msg.subject, msg.body, companies);
            const threadLink = `https://mail.google.com/mail/u/0/#sent/${msg.threadId}`;

            if (details.matchedCompanyId) {
              const { rows: [enq] } = await pool.query(
                `SELECT lead_id, status FROM marketing.leads WHERE company_id = $1 ORDER BY ts DESC LIMIT 1`,
                [details.matchedCompanyId]
              );
              if (enq && !NO_DOWNGRADE_STATUSES.has(enq.status)) {
                await pool.query(`UPDATE marketing.leads SET status = 'Offer Sent' WHERE lead_id = $1`, [enq.lead_id]);
              }

              const { rows: [{ next_version }] } = await pool.query(
                `SELECT COALESCE(MAX(offer_version), 0) + 1 AS next_version FROM marketing.offers_sent WHERE lead_id = $1`,
                [enq?.lead_id || null]
              );

              if (enq) {
                const { rows: [offerRow] } = await pool.query(
                  `INSERT INTO marketing.offers_sent
                     (lead_id, company_name, engineer_name, offer_version, email_subject, email_sent_date,
                      email_sent_time, ai_offer_summary, products_mentioned, estimated_value, gmail_thread_link)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING offer_id`,
                  [enq.lead_id, companies.find(c => c.company_id === details.matchedCompanyId)?.company_name,
                   account, next_version, msg.subject, msg.date, msg.date, details.summary,
                   details.productsMentioned, details.estimatedValue, threadLink]
                );
                syncLiveRow('offers_sent', offerRow.offer_id);
                results.offersLogged++;
              }
            }
          } else if (classification === 'COLD_OUTREACH') {
            const toEmail = (msg.to.split(',')[0] || '').trim();
            await pool.query(
              `INSERT INTO marketing.cold_introductory_emails_sent
                 (recipient_email, sent_by, first_contacted_date, last_contacted_date, times_contacted, last_subject, last_thread_link)
               VALUES ($1,$2,$3,$3,1,$4,$5)
               ON CONFLICT (recipient_email) DO UPDATE SET
                 last_contacted_date = $3, times_contacted = marketing.cold_introductory_emails_sent.times_contacted + 1,
                 last_subject = $4, last_thread_link = $5`,
              [toEmail, account, msg.date, msg.subject, `https://mail.google.com/mail/u/0/#sent/${msg.threadId}`]
            );
            syncLiveRow('cold_introductory_emails_sent', toEmail);
            results.coldOutreachLogged++;
          }

          await pool.query(
            `INSERT INTO marketing.processed_emails (message_id, subject, inbox_account, thread_link)
             VALUES ($1,$2,$3,$4) ON CONFLICT (message_id) DO NOTHING`,
            [msg.messageId, msg.subject, account, `https://mail.google.com/mail/u/0/#sent/${msg.threadId}`]
          );
        } catch (msgErr) {
          console.error(`Error processing outbound message ${msg.messageId}:`, msgErr);
          results.errors.push({ messageId: msg.messageId, error: msgErr.message });
        }
      }
    } catch (accountErr) {
      console.error(`Error scanning outbound for ${account}:`, accountErr);
      results.errors.push({ account, error: accountErr.message });
    }
  }
  return results;
}

router.post('/checkOutboundSentOffers', requirePermission('perm_email_leads'), async (req, res) => {
  const results = await pollOutboundOffers(req.user.email);
  res.json({ success: true, ...results });
});

// getLeadsForDocumentUploadDropdown — feeds the PO/Dispatch/Commissioning
// upload screens' company dropdown. Response shape matches the frontend's
// exact expectation: {success, leads: [{leadId, displayLabel}]}.
router.post('/getLeadsForDocumentUploadDropdown', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.lead_id, c.company_name, e.contact_person_name
       FROM marketing.leads e
       LEFT JOIN marketing.companies c ON c.company_id = e.company_id
       ORDER BY e.ts DESC LIMIT 500`
    );
    const leads = rows.map(r => ({
      leadId: r.lead_id,
      displayLabel: `${r.company_name || 'Unknown Company'}${r.contact_person_name ? ' — ' + r.contact_person_name : ''} (${r.lead_id})`,
    }));
    res.json({ success: true, leads });
  } catch (err) {
    console.error('getLeadsForDocumentUploadDropdown error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/saveEmailLeadNote', async (req, res) => {
  const { messageId, noteText } = req.body;
  if (!messageId) return res.json({ success: false, error: 'Message ID is required.' });
  try {
    await pool.query(
      `UPDATE marketing.processed_emails SET notes = $1, creator_of_note = $2 WHERE message_id = $3`,
      [noteText, displayName(req), messageId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('saveEmailLeadNote error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.pollAllInboxes = pollAllInboxes; // exposed for the internal scheduler route
module.exports.pollOutboundOffers = pollOutboundOffers; // exposed for the internal scheduler route