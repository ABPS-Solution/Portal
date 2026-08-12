// ═══════════════════════════════════════════════════════════════════════
// routes/projects.js — Projects lifecycle, split out of design.js since
// Projects now lives in its own `project` schema (moved from `design`
// via migration 020) rather than being a Design-department concept.
// Ports: generateAbpsProjectId, createProject, fetchProjectsByStatus,
//        activateProject
//
// company_id, drive_folder_url, and total_material_cost_inr columns
// were dropped from project.projects (migration 021) — createProject no
// longer persists a company link or a stored Drive folder URL. The
// Drive folder is still created for organizational purposes and
// returned in the response, just not written back to the row.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool, withTransaction } = require('../db');
const { requirePermission } = require('../auth');
const { writeAuditLog } = require('../lib/audit');
const { syncLiveRow } = require('../lib/liveSync');
const { ensureProjectFolderStructure } = require('../lib/drive');
const { refreshPRNCompletion, releaseStoreClaimFromPRN } = require('../lib/prnSync');
const { uploadFile } = require('../lib/drive');
const { buildProjectInvoicePdfBuffer } = require('../lib/pdf');

const router = express.Router();

// generateAbpsProjectId — format: ABPS_<FYXX-XX>_<MonthAbbr>_<Company Name>_<PO Number>.
// Literal, like BOQ ID's scheme: no punctuation stripped, spaces kept as
// spaces (only double-spaces collapsed and edges trimmed), underscores
// ONLY separate the four top-level segments. No sequence-number
// disambiguator -- a genuine duplicate (same company + PO number) is
// meant to collide and fail, since that'd indicate the same PO being
// processed twice. poNumber may be blank for manually-created projects
// (the Create Project screen's PO Number field is optional) -- falls
// back to "NOPO" rather than leaving a trailing blank segment.
function cleanProjectIdSegment(str) {
  return (str || '').toString().trim().replace(/\s+/g, ' ');
}

function generateAbpsProjectId(companyName, poNumber) {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST offset
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-indexed
  const fyStart = month >= 4 ? year : year - 1;
  const fyLabel = String(fyStart).slice(-2) + '-' + String(fyStart + 1).slice(-2);
  const monthAbbr = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month - 1];

  const poSegment = cleanProjectIdSegment(poNumber) || 'NOPO';
  return `ABPS_${fyLabel}_${monthAbbr}_${cleanProjectIdSegment(companyName)}_${poSegment}`;
}

// createProject — auto-generates the Project ID. New projects start
// Inactive — Manufacturing Clearance is the one-directional Inactive ->
// Active gate (see activateProject below), same as legacy behavior.
// NOTE: as of the PO-upload auto-creation feature, this manual route is
// now the SECONDARY path -- most projects get created automatically by
// marketing.js's commitMarketingOperationsDocument when a PO is
// uploaded, extracting Company Name/PO Number/Delivery Date via OCR
// instead of asking someone to type them here.
router.post('/createProject', requirePermission('perm_create_boq'), async (req, res) => {
  const { companyName, poNumber, deliveryDate } = req.body;
  if (!companyName?.trim()) return res.json({ success: false, error: 'Company Name is required.' });

  try {
    const projectId = await withTransaction(async (client) => {
      const projectId = generateAbpsProjectId(companyName, poNumber);
      await client.query(
        `INSERT INTO project.projects (project_id, company_name, project_status, po_number, delivery_date)
         VALUES ($1,$2,'Inactive',$3,$4)`,
        [projectId, companyName, poNumber || null, deliveryDate || null]
      );
      return projectId;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'Projects', 'CREATE', projectId,
      `Created project for "${companyName}".`);
    syncLiveRow('projects', projectId);
    res.json({ success: true, projectId });
  } catch (err) {
    console.error('createProject error:', err);
    res.status(500).json({ success: false, error: 'Project creation failed: ' + err.message });
  }
});

// ── Manufacturing Clearance ──────────────────────────────────────────
// fetchProjectsByStatus — feeds the clearance screen's queue.
router.post('/fetchProjectsByStatus', requirePermission('perm_manufacturing_clearance'), async (req, res) => {
  const status = req.body.status || 'Inactive';
  const normalizedStatus = status === 'Completed' ? 'Complete' : status;
  try {
    const { rows } = await pool.query(
      `SELECT project_id, company_name, delivery_date FROM project.projects WHERE lower(project_status) = lower($1)`,
      [normalizedStatus]
    );
    res.json({ success: true, projects: rows.map(r => ({ projectId: r.project_id, companyName: r.company_name, deliveryDate: r.delivery_date })) });
  } catch (err) {
    console.error('fetchProjectsByStatus error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// activateProject — Inactive -> Active ONLY. Deliberately one-directional
// — once cleared for manufacturing, this screen cannot send it back.
router.post('/activateProject', requirePermission('perm_manufacturing_clearance'), async (req, res) => {
  const { projectId } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE project.projects SET project_status = 'Active'
       WHERE project_id = $1 AND lower(project_status) = 'inactive'
       RETURNING project_id, company_name`,
      [projectId]
    );
    if (rows.length === 0) {
      return res.json({ success: false, error: 'Only Inactive projects can be activated here, or the project was not found.' });
    }

    // Drive folder is only created now, on activation, per explicit
    // decision -- not at project creation (which happens while still
    // Inactive, potentially long before or never followed by activation).
    let driveFolderUrl = null;
    try {
      const rootFolderId = process.env.DESIGN_ROOT_FOLDER_ID;
      if (rootFolderId) {
        const { projectFolderId } = await ensureProjectFolderStructure(rootFolderId, projectId, rows[0].company_name);
        driveFolderUrl = `https://drive.google.com/drive/folders/${projectFolderId}`;
      }
    } catch (driveErr) {
      console.error('Drive folder creation failed on activation (non-fatal):', driveErr);
    }

    await writeAuditLog(req.user.email, req.body.operatorName, 'Projects', 'ACTIVATE', projectId,
      'Manufacturing clearance granted — status changed Inactive -> Active, Drive folder created.');
    syncLiveRow('projects', projectId);
    res.json({ success: true, driveFolderUrl });
  } catch (err) {
    console.error('activateProject error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reactivate (Manufacturing Clearance section)

router.post('/reactivateCompletedProject', requirePermission('perm_manufacturing_clearance'), async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'Project ID is required.' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE project.projects SET project_status = 'Active' WHERE project_id = $1 AND project_status = 'Complete'`, [projectId]
    );
    if (rowCount === 0) return res.json({ success: false, error: 'Project not found or not currently Complete.' });
    syncLiveRow('projects', projectId);
    await writeAuditLog(req.user.email, req.body.operatorName, 'Projects', 'REACTIVATE', projectId, 'Project reactivated from Complete to Active.');
    res.json({ success: true });
  } catch (err) {
    console.error('reactivateCompletedProject error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Project Status (view-only cross-department report) ─────────────────
router.post('/fetchProjectDesignStatus', requirePermission('perm_project_status'), async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'Project ID is required.' });
  try {
    const { rows } = await pool.query(
      `SELECT boq_id AS "boqId", department, order_quantity AS "orderQuantity", status,
              version, boq_date AS "createdAt", updated_at AS "updatedAt", pdf_url AS "pdfUrl"
       FROM design.boq_drafts WHERE project_id = $1 ORDER BY boq_date DESC`,
      [projectId]
    );
    res.json({ success: true, boqs: rows });
  } catch (err) {
    console.error('fetchProjectDesignStatus error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchProjectPurchaseStatus', requirePermission('perm_project_status'), async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'Project ID is required.' });
  try {
    const { rows } = await pool.query(
      `SELECT prn_id AS "prnId", boq_id AS "boqId", status, version, pdf_url AS "pdfUrl"
       FROM purchase.purchase_request_notes WHERE project_id = $1 ORDER BY prn_id ASC`,
      [projectId]
    );
    res.json({ success: true, prns: rows });
  } catch (err) {
    console.error('fetchProjectPurchaseStatus error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Value-weighted progress — weights each material's contribution by its
// last known rate (store.raw_material_store.latest_rate_per_quantity),
// not raw quantity or material count, so a handful of expensive parts
// aren't drowned out by a large count of cheap ones. The rate lookup is
// keyed by item_code regardless of which store pool (Raw/Spare) the
// material happens to be drawn from — the rate is a property of the
// material itself, not of which pool holds it. A JC with an FG Store row
// already against it is reported as Completed outright, overriding
// whatever the weighted number computes (it may not hit exactly 100% if
// any material's rate was ever missing).
router.post('/fetchProjectProductionStatus', requirePermission('perm_project_status'), async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'Project ID is required.' });
  try {
    const { rows } = await pool.query(
      `SELECT jc.job_card_number AS "jobCardNumber", jc.boq_id AS "boqId", jc.set_number AS "setNumber",
              EXISTS(SELECT 1 FROM production.finished_goods_inventory fg WHERE fg.job_card_number = jc.job_card_number) AS "isCompleted",
              agg.weighted_used AS "weightedUsed", agg.weighted_allotted AS "weightedAllotted"
       FROM production.job_cards jc
       LEFT JOIN LATERAL (
         SELECT SUM(m.used_quantity * COALESCE(r.latest_rate_per_quantity, 0)) AS weighted_used,
                SUM(m.allotted_quantity * COALESCE(r.latest_rate_per_quantity, 0)) AS weighted_allotted
         FROM production.job_card_materials m
         LEFT JOIN store.raw_material_store r ON r.item_code = m.item_code
         WHERE m.job_card_number = jc.job_card_number
       ) agg ON true
       WHERE jc.project_id = $1
       ORDER BY jc.boq_id, jc.set_number ASC`,
      [projectId]
    );
    res.json({ success: true, jobCards: rows });
  } catch (err) {
    console.error('fetchProjectProductionStatus error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eligibility list

router.post('/fetchInvoiceEligibleProjects', requirePermission('perm_project_invoice_generation'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.project_id AS "projectId", p.company_name AS "companyName"
      FROM project.projects p
      WHERE p.project_status = 'Active'
        AND EXISTS (SELECT 1 FROM design.boq_drafts bd WHERE bd.project_id = p.project_id)
        AND NOT EXISTS (
          SELECT 1 FROM design.boq_drafts bd
          WHERE bd.project_id = p.project_id
            AND NOT EXISTS (SELECT 1 FROM production.job_cards jc WHERE jc.boq_id = bd.boq_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM production.job_cards jc
          JOIN design.boq_drafts bd2 ON bd2.boq_id = jc.boq_id
          WHERE bd2.project_id = p.project_id
            AND NOT EXISTS (SELECT 1 FROM production.finished_goods_inventory fg WHERE fg.job_card_number = jc.job_card_number)
        )
      ORDER BY p.project_id`);
    res.json({ success: true, projects: rows });
  } catch (err) {
    console.error('fetchInvoiceEligibleProjects error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchProjectInvoiceDetail', requirePermission('perm_project_invoice_generation'), async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'Project ID is required.' });
  try {
    const { rows: boqs } = await pool.query(
      `SELECT boq_id AS "boqId", product_name AS "productName", product_rating AS "productRating"
       FROM design.boq_drafts WHERE project_id = $1 ORDER BY boq_id`, [projectId]
    );
    const boqIds = boqs.map(b => b.boqId);
    const { rows: jcs } = boqIds.length ? await pool.query(
      `SELECT jc.job_card_number AS "jobCardNumber", jc.boq_id AS "boqId", jc.set_number AS "setNumber",
              fg.finished_good_use AS "finishedGoodUse"
       FROM production.job_cards jc
       LEFT JOIN production.finished_goods_inventory fg ON fg.job_card_number = jc.job_card_number
       WHERE jc.boq_id = ANY($1::text[])
       ORDER BY jc.boq_id, jc.set_number`, [boqIds]
    ) : { rows: [] };
    const jcNumbers = jcs.map(j => j.jobCardNumber);
    const { rows: blockers } = jcNumbers.length ? await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM store.store_tickets
       WHERE job_card_number = ANY($1::text[]) AND status IN ('Pending','Approved','Pending BOQ Increase Review')
       GROUP BY status`, [jcNumbers]
    ) : { rows: [] };
    const pendingTicketsCount = blockers.filter(b => b.status !== 'Pending BOQ Increase Review').reduce((s, b) => s + b.count, 0);
    const pendingBoqIncreaseCount = blockers.filter(b => b.status === 'Pending BOQ Increase Review').reduce((s, b) => s + b.count, 0);
    res.json({ success: true, projectId, boqs, jobCards: jcs, pendingTicketsCount, pendingBoqIncreaseCount });
  } catch (err) {
    console.error('fetchProjectInvoiceDetail error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/generateProjectInvoiceAndComplete', requirePermission('perm_project_invoice_generation'), async (req, res) => {
  const { projectId, confirmProjectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'Project ID is required.' });
  if (confirmProjectId !== projectId) return res.json({ success: false, error: 'Confirmation text does not match the Project ID.' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows: boqs } = await client.query(
        `SELECT boq_id, product_name, product_rating FROM design.boq_drafts WHERE project_id = $1 ORDER BY boq_id`, [projectId]
      );
      const boqIds = boqs.map(b => b.boq_id);
      if (boqIds.length === 0) throw new Error('No BOQs found for this project.');

      const { rows: jcs } = await client.query(
        `SELECT jc.job_card_number, jc.boq_id, jc.set_number, fg.finished_good_use
         FROM production.job_cards jc
         LEFT JOIN production.finished_goods_inventory fg ON fg.job_card_number = jc.job_card_number
         WHERE jc.boq_id = ANY($1::text[]) ORDER BY jc.boq_id, jc.set_number`, [boqIds]
      );
      const jcNumbers = jcs.map(j => j.job_card_number);

      const { rows: blockers } = jcNumbers.length ? await client.query(
        `SELECT ticket_id FROM store.store_tickets
         WHERE job_card_number = ANY($1::text[]) AND status IN ('Pending','Approved','Pending BOQ Increase Review')`, [jcNumbers]
      ) : { rows: [] };
      if (blockers.length > 0) throw new Error('Pending store tickets or BOQ Increase requests still exist for this project. Resolve them first.');

      const { rows: prns } = await client.query(
        `SELECT prn_id, status FROM purchase.purchase_request_notes WHERE boq_id = ANY($1::text[]) AND status != 'Completed'`, [boqIds]
      );
      for (const prn of prns) {
        if (prn.status === 'Pending Authorization') {
          await client.query(`UPDATE purchase.purchase_request_notes SET status = 'Rejected' WHERE prn_id = $1`, [prn.prn_id]);
          continue;
        }
        await client.query(
          `UPDATE purchase.prn_line_items SET purchase_quantity = received_quantity, still_to_order_quantity = 0
           WHERE prn_id = $1 AND received_quantity < purchase_quantity`, [prn.prn_id]
        );
        await refreshPRNCompletion(client, prn.prn_id);
      }

      const { rows: freeLines } = await client.query(
        `SELECT li.prn_id, li.item_code, li.raw_pool_remaining, li.spare_pool_remaining
         FROM purchase.prn_line_items li
         JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
         WHERE p.boq_id = ANY($1::text[]) AND (li.raw_pool_remaining > 1e-9 OR li.spare_pool_remaining > 1e-9)`, [boqIds]
      );
      for (const line of freeLines) {
        const raw = Number(line.raw_pool_remaining) || 0;
        const spare = Number(line.spare_pool_remaining) || 0;
        await releaseStoreClaimFromPRN(client, line.prn_id, line.item_code, raw + spare, spare, raw);
      }

      const { rows: [projRow] } = await client.query(
        `SELECT invoice_revision FROM project.projects WHERE project_id = $1 FOR UPDATE`, [projectId]
      );
      const newRevision = (Number(projRow?.invoice_revision) || 0) + 1;

      const pdfBytes = await buildProjectInvoicePdfBuffer({ projectId, boqs, jobCards: jcs });
      const rootFolderId = process.env.PROJECT_INVOICE_FOLDER_ID;
      if (!rootFolderId) throw new Error('Project Invoice Drive folder is not configured on the server.');
      const fileName = newRevision <= 1 ? `Project_Invoice_${projectId}.pdf` : `Project_Invoice_Rev${newRevision}_${projectId}.pdf`;
      const { url } = await uploadFile(rootFolderId, Buffer.from(pdfBytes), fileName, 'application/pdf');

      await client.query(
        `UPDATE project.projects SET project_status = 'Complete', invoice_url = $1, invoice_revision = $2 WHERE project_id = $3`,
        [url, newRevision, projectId]
      );
      return { url, revision: newRevision };
    });

    syncLiveRow('projects', projectId);
    await writeAuditLog(req.user.email, req.body.operatorName, 'Projects', 'INVOICE_GENERATED', projectId,
      `Project Invoice generated (Rev ${result.revision}) and project marked Complete.`);
    res.json({ success: true, url: result.url });
  } catch (err) {
    console.error('generateProjectInvoiceAndComplete error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.generateAbpsProjectId = generateAbpsProjectId;