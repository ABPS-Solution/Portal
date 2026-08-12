// ═══════════════════════════════════════════════════════════════════════
// routes/production.js — Dispatch Product Codes, Job Cards, Job Card
// Materials consumption, Finished Goods store.
// Ports: getNextDispatchCode-equivalent, fetchJobCardsForProject,
//        fetchBOQProductsForJobCard, validateJobCardBOQConsumption,
//        addFinishedGoodsItem
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool, withTransaction } = require('../db');
const { requirePermission } = require('../auth');
const { writeAuditLog } = require('../lib/audit');
const { syncLiveRow } = require('../lib/liveSync');
const { ensureNestedFolderPath, uploadFile } = require('../lib/drive');
const { checkGeminiRateLimit } = require('../lib/gemini');
const { displayName } = require('../lib/displayName');

const router = express.Router();

// ── Job Cards ───────────────────────────────────────────────────────────

router.post('/fetchJobCardsForProject', async (req, res) => {
  const { projectId } = req.body;
  try {
    // camelCase + department joined from the BOQ — the frontend's BOQ
    // dropdown reads jc.boqId/productName/department, and department
    // isn't a job_cards column.
    // design.bill_of_quantity has one row PER MATERIAL LINE, not one per
    // BOQ — a plain join on boq_id multiplies every job card by however
    // many material rows its BOQ has. DISTINCT ON collapses that back to
    // one row per job card before the outer query restores date order.
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (jc.job_card_number)
                jc.job_card_number AS "jobCardNumber", jc.project_id AS "projectId",
                jc.customer_name AS "customerName", jc.product_name AS "productName",
                jc.product_rating AS "productRating", jc.boq_id AS "boqId",
                jc.set_number AS "setNumber", jc.date_created AS "dateCreated", jc.status,
                b.production_department AS "department"
         FROM production.job_cards jc
         LEFT JOIN design.bill_of_quantity b ON b.boq_id = jc.boq_id
         WHERE jc.project_id = $1
         ORDER BY jc.job_card_number, jc.date_created DESC
       ) sub
       ORDER BY sub."boqId", (sub."setNumber")::int ASC`,
      [projectId]
    );
    res.json({ success: true, jobCards: rows });
  } catch (err) {
    console.error('fetchJobCardsForProject error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// fetchBOQProductsForJobCard — feeds the "pick a BOQ to build this Job
// Card against" step. Groups Authorized BOQs by project. This route was
// previously ported with different (unrelated, unused) logic querying
// job_card_materials by job card number -- that table/purpose belongs
// to fetching materials of an EXISTING job card, not this screen's
// actual need (picking from a project's BOQs to create a NEW one).
// Restored to match the original code.js behavior: one row per BOQ ID,
// but now also filtered to only Authorized BOQs (job cards should only
// be buildable against an authorized bill of quantity).
router.post('/fetchBOQProductsForJobCard', async (req, res) => {
  const { projectId } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT boq_id AS "boqId", product_name AS "productName", product_rating AS "productRating",
              order_quantity AS "orderQuantity", customer_name AS "customerName", department
       FROM design.bill_of_quantity
       WHERE project_id = $1 AND status = 'Authorized'
       ORDER BY boq_id`,
      [projectId]
    );
    res.json({ success: true, boqGroups: rows });
  } catch (err) {
    console.error('fetchBOQProductsForJobCard error:', err);
    res.status(500).json({ success: false, error: err.message, boqGroups: [] });
  }
});

// validateJobCardBOQConsumption — compares each BOQ material's per-set
// quantity against net consumption (used_quantity) for this job card.
// Read-only check, used by the Finished Goods add-item screen before
// allowing a unit to be marked complete.
router.post('/validateJobCardBOQConsumption', requirePermission('perm_create_store_ticket'), async (req, res) => {
  const { jobCardNumber } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT material_name, type_of_store, allotted_quantity, used_quantity, unit_type,
              (allotted_quantity = used_quantity) AS matched
       FROM production.job_card_materials WHERE job_card_number = $1`,
      [jobCardNumber]
    );
    if (rows.length === 0) {
      return res.json({ success: true, matched: false, error: 'No material allotment found for this Job Card.', details: [] });
    }
    const matched = rows.every(r => r.matched);
    res.json({
      success: true, matched,
      details: rows.map(r => ({
        materialName: r.material_name, typeOfStore: r.type_of_store,
        required: r.allotted_quantity, consumed: r.used_quantity, unitType: r.unit_type, matched: r.matched,
      })),
    });
  } catch (err) {
    console.error('validateJobCardBOQConsumption error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Finished Goods ────────────────────────────────────────────────────
// addFinishedGoodsItem — requires the job card's BOQ consumption to
// already match (frontend gates this via validateJobCardBOQConsumption,
// but we re-check server-side too — never trust a client-only gate for
// something that flips a Job Card to Completed).
router.post('/addFinishedGoodsItem', requirePermission('perm_add_finished_goods_store'), async (req, res) => {
  // Real frontend field names (see index.html's addFinishedGoodsItem call)
  // didn't match what this route destructured at all — production_responsible_person,
  // fg_store_incharge_person, additional_remarks, qa_person, qa_done, and
  // all 4 document URLs were silently never saved despite being required
  // and uploaded on the frontend. Fixed to match the real payload shape.
  const { projectId, customerName, itemCode, finishedGoodUse, jobCardNumber,
          productSerialNumber, productName, productRating, unit, department,
          prodResponsible, additionalRemarks, qaPersonName, qaDone,
          jobCardSheetUrl, testCertUrl, inspectionClearanceUrl, inProcessInspUrl,
          warrantyCardUrl, otherDocumentsUrl } = req.body;

  if (!jobCardNumber) return res.json({ success: false, error: 'Job Card Number is required.' });

  try {
    const fgId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT (allotted_quantity = used_quantity) AS matched FROM production.job_card_materials WHERE job_card_number = $1`,
        [jobCardNumber]
      );
      if (rows.length === 0 || !rows.every(r => r.matched)) {
        throw new Error('BOQ material consumption does not match for this Job Card. Cannot add to Finished Goods.');
      }

      if (!warrantyCardUrl) throw new Error('Warranty Card upload is required.');

      const { rows: [fg] } = await client.query(
        `INSERT INTO production.finished_goods_inventory
           (department, project_id, customer_name, item_or_dispatch_code, finished_good_use, job_card_number,
            product_serial_number, product_name, product_rating, unit, status, production_responsible_person,
            additional_remarks, qa_person, qa_done,
            job_card_sheet_url, certificate_url, inspection_clearance_url, in_process_inspection_url,
            warranty_card_url, other_documents_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'In Store',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING fg_id`,
        [department, projectId, customerName, itemCode, finishedGoodUse, jobCardNumber,
         productSerialNumber, productName, productRating, unit,
         prodResponsible || req.body.operatorName || displayName(req),
         additionalRemarks, qaPersonName, qaDone === 'Yes',
         jobCardSheetUrl || null, testCertUrl || null, inspectionClearanceUrl || null, inProcessInspUrl || null,
         warrantyCardUrl || null, otherDocumentsUrl || null]
      );

      await client.query(`UPDATE production.job_cards SET status = 'Completed' WHERE job_card_number = $1`, [jobCardNumber]);

      return fg.fg_id;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'FinishedGoodsInventory', 'CREATE', fgId,
      `Added finished good for job card ${jobCardNumber}.`);
    syncLiveRow('finished_goods_inventory', fgId);
    syncLiveRow('job_card_number', jobCardNumber);
    res.json({ success: true, fgId });
  } catch (err) {
    console.error('addFinishedGoodsItem error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/getLiveFinishedGoodsInventory', requirePermission('perm_live_fg_stock'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT fg_id AS "fgId", fg_date AS "date", department, project_id AS "projectId",
              customer_name AS "customerName", item_or_dispatch_code AS "itemCode",
              finished_good_use AS "finishedGoodUse", job_card_number AS "jobCardNumber",
              product_serial_number AS "productSerialNumber", product_name AS "productName",
              product_rating AS "productRating", unit, status,
              production_responsible_person AS "prodResponsible",
              additional_remarks AS "additionalRemarks", qa_person AS "qaPerson", qa_done AS "qaDone"
       FROM production.finished_goods_inventory ORDER BY fg_date DESC LIMIT 1000`
    );
    res.json({ success: true, inventory: rows });
  } catch (err) {
    console.error('getLiveFinishedGoodsInventory error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// uploadJobCardDocument — routes into PRODUCTION_DRIVE_FOLDER_ID /
// "Company ProjectID" / BOQ-ID / JobCardNumber, matching
// ensureProductionFolderStructure_ from code.js. Deletes any existing
// file with the same name in that folder first (setTrashed pattern),
// avoiding duplicate uploads on re-submission.
router.post('/uploadJobCardDocument', requirePermission('perm_job_card_letterhead'), async (req, res) => {
  const { jobCardNumber, fileName, base64Data, mimeType } = req.body;
  if (!jobCardNumber || !fileName || !base64Data) {
    return res.json({ success: false, error: 'Job Card Number, file name, and file data are required.' });
  }

  try {
    const { rows: [jc] } = await pool.query(
      `SELECT project_id, customer_name, boq_id FROM production.job_cards WHERE job_card_number = $1`,
      [jobCardNumber]
    );
    if (!jc) return res.json({ success: false, error: 'Job Card not found.' });

    const rootFolderId = process.env.PRODUCTION_DRIVE_FOLDER_ID;
    if (!rootFolderId) return res.json({ success: false, error: 'Production Drive root folder is not configured on the server.' });

    const projectLabel = `${jc.customer_name || ''} ${jc.project_id}`.trim();
    const folderId = await ensureNestedFolderPath(rootFolderId, [projectLabel, jc.boq_id, jobCardNumber]);
    const buffer = Buffer.from(base64Data, 'base64');
    const { url } = await uploadFile(folderId, buffer, fileName, mimeType || 'application/octet-stream');

    await pool.query(`UPDATE production.job_cards SET drive_image_url = $1 WHERE job_card_number = $2`, [url, jobCardNumber]);
    await writeAuditLog(req.user.email, req.body.operatorName, 'JobCardNumber', 'UPLOAD_DOCUMENT', jobCardNumber,
      `Uploaded document "${fileName}" for job card.`);
    syncLiveRow('job_card_number', jobCardNumber);
    res.json({ success: true, url });
  } catch (err) {
    console.error('uploadJobCardDocument error:', err);
    res.status(500).json({ success: false, error: 'Upload failed: ' + err.message });
  }
});

// fetchJobCardMaterials — same underlying data as fetchBOQProductsForJobCard
// but a different response key (`records` not `materials`) since this is
// called from the ticket-creation screen's client-side cache, which
// expects that exact shape.
router.post('/fetchJobCardMaterials', async (req, res) => {
  const { jobCardNumber } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT item_code AS "itemCode", material_name AS "materialName", unit_type AS "unitType",
              type_of_store AS "typeOfStore", allotted_quantity AS "allottedQty",
              used_quantity AS "usedQty", remaining_quantity AS "remainingQty"
       FROM production.job_card_materials WHERE job_card_number = $1`,
      [jobCardNumber]
    );
    res.json({ success: true, records: rows });
  } catch (err) {
    console.error('fetchJobCardMaterials error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// fetchPendingBOQIncreaseTickets — feeds the admin approval queue for
// Job Card Increase requests (see routes/store.js's
// commitBOQLimitIncreaseRequestTicket for the approval side).
router.post('/fetchPendingBOQIncreaseTickets', requirePermission('perm_approve_job_card_increase'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ticket_id AS "ticketId", request_or_return AS "ticketType", type_of_store AS "storeType",
              project_id AS "projectId", job_card_number AS "jobCardNumber", department,
              requested_returned_by AS "requestedBy", status, items,
              date_created AS "dateCreated"
       FROM store.store_tickets WHERE status = 'Pending BOQ Increase Review' ORDER BY date_created ASC`
    );
    // items is JSONB — already a real array via pg, not a string to parse.
    // exceededItems was never actually derived here before; the frontend
    // card renderer reads this field specifically, not items directly.
    rows.forEach(r => { r.exceededItems = (Array.isArray(r.items) ? r.items : []).filter(it => it.boqExceeded); });
    res.json({ success: true, tickets: rows });
  } catch (err) {
    console.error('fetchPendingBOQIncreaseTickets error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// generateJobCardLetterheadPdf — returned as base64 directly for
// client-side download, not saved to Drive (matches the frontend's
// data:application/pdf;base64 download-link pattern).
router.post('/generateJobCardLetterheadPdf', requirePermission('perm_job_card_letterhead'), async (req, res) => {
  const { projectId, customerName, productName, productRating, department, jobCardNumber } = req.body;
  try {
    const { generateJobCardLetterheadPdf } = require('../lib/pdf');
    const pdfBytes = await generateJobCardLetterheadPdf({
      projectId, customerName, productName, productRating, department, jobCardNumber,
    });
    res.json({
      success: true,
      base64: Buffer.from(pdfBytes).toString('base64'),
      fileName: `JobCard_${jobCardNumber}_Letterhead.pdf`,
    });
  } catch (err) {
    console.error('generateJobCardLetterheadPdf error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// uploadProductionJobCardDocument — accepts the frontend's nested
// `file: {fileName, base64Data, mimeType}` shape, routes into
// PRODUCTION_DRIVE_FOLDER_ID / "Company ProjectID" / BOQ / JobCard,
// same folder structure as uploadJobCardDocument.
router.post('/uploadProductionJobCardDocument', requirePermission('perm_job_card_letterhead'), async (req, res) => {
  const { projectId, customerName, boqId, jobCardNumber, docLabel, file } = req.body;
  if (!jobCardNumber || !file?.base64Data) {
    return res.json({ success: false, error: 'Job Card Number and file data are required.' });
  }

  try {
    const rootFolderId = process.env.PRODUCTION_DRIVE_FOLDER_ID;
    if (!rootFolderId) return res.json({ success: false, error: 'Production Drive root folder is not configured on the server.' });

    // boqId from the client is unreliable (the FG screen passes its item
    // code) — resolve the real one from the job card instead.
    const { rows: [jcRow] } = await pool.query(
      `SELECT boq_id, project_id, customer_name FROM production.job_cards WHERE job_card_number = $1`, [jobCardNumber]
    );
    const resolvedBoqId = jcRow?.boq_id || boqId || 'Unassigned BOQ';
    const projectLabel = `${jcRow?.customer_name || customerName || ''} ${jcRow?.project_id || projectId}`.trim();
    const folderId = await ensureNestedFolderPath(rootFolderId, [projectLabel, resolvedBoqId, jobCardNumber]);
    const buffer = Buffer.from(file.base64Data, 'base64');
    const { url } = await uploadFile(folderId, buffer, file.fileName || `${docLabel || 'document'}.pdf`, file.mimeType || 'application/octet-stream');

    await writeAuditLog(req.user.email, req.body.operatorName, 'JobCardNumber', 'UPLOAD_DOCUMENT', jobCardNumber,
      `Uploaded "${docLabel || file.fileName}" for job card.`);
    res.json({ success: true, url });
  } catch (err) {
    console.error('uploadProductionJobCardDocument error:', err);
    res.status(500).json({ success: false, error: 'Upload failed: ' + err.message });
  }
});

module.exports = router;