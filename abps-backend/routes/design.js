// ═══════════════════════════════════════════════════════════════════════
// routes/design.js — Item Code catalog + BOQ lifecycle
// Ports: getNextItemCode, createItemCode, fetchItemCodeCatalog,
//        createBOQDraft, fetchBOQsByProject, fetchBOQDraftById,
//        submitBOQAuthorize
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool, withTransaction } = require('../db');
const { requirePermission } = require('../auth');
const { writeAuditLog } = require('../lib/audit');
const { syncLiveRow } = require('../lib/liveSync');
const { applySilentPRNDecrease, regeneratePRNDocument } = require('../lib/prnSync');
const { formatINR, generateBOQPdf, generateBOQNoCostPdf } = require('../lib/pdf');
const { uploadPdf } = require('../lib/storage');
const { ensureProjectFolderStructure, uploadFile, ensureNestedFolderPath, deleteFile, listFilesInFolder } = require('../lib/drive');
const { semanticItemMatch } = require('../lib/gemini');
const { displayName } = require('../lib/displayName');

const router = express.Router();

// BOQ PDF filenames need "RevN" inserted right after the "BOQ" prefix
// (BOQ_Rev2_FY26-27_JUL_..._Product_Rating.pdf), not appended at the
// very end after the full boq_id — this only touches the FILENAME, the
// boq_id column itself is untouched.
function boqFileNameWithRev(boqId, version, suffix = '') {
  const parts = boqId.split('_');
  const withRev = parts.length > 1 ? [parts[0], `Rev${version}`, ...parts.slice(1)].join('_') : `${boqId}_Rev${version}`;
  return `${withRev}${suffix}.pdf`;
}

// ── Item Code Catalog ─────────────────────────────────────────────────

router.post('/fetchItemCodeCatalog', async (req, res) => {
  try {
    // combinedName = Material Name + Rating — every consumer of this
    // catalog (BOQ search, Store Entry matching, FG Add search) displays
    // and stores this, not the bare productName. This route was never
    // computing it at all, so every "c.combinedName || c.productName"
    // fallback across the frontend was silently resolving to just the
    // bare name this whole time.
    const { rows } = await pool.query(
      `SELECT item_code AS "itemCode", material_name AS "productName", rating,
              CASE WHEN rating IS NOT NULL AND TRIM(rating) <> ''
                   THEN material_name || ' ' || TRIM(rating)
                   ELSE material_name END AS "combinedName",
              type_of_material AS "typeOfMaterial", unit
       FROM design.item_codes ORDER BY created_date DESC LIMIT 2000`
    );
    res.json({ success: true, catalog: rows });
  } catch (err) {
    console.error('fetchItemCodeCatalog error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fast text-filter pass — same "narrow candidates first" idea as the
// Apps Script version's character-overlap prefilter before it hands the
// shortlist to Gemini. Real semantic ranking stays a follow-up call to
// searchItemCodeSemantic, not duplicated here.
router.post('/searchItemCodeCandidates', requirePermission('perm_item_code_access'), async (req, res) => {
  const { query } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT item_code, material_name, rating, type_of_material, unit
       FROM design.item_codes
       WHERE to_tsvector('simple', material_name) @@ plainto_tsquery('simple', $1)
          OR material_name ILIKE '%' || $1 || '%'
       LIMIT 30`,
      [query]
    );
    res.json({ success: true, candidates: rows });
  } catch (err) {
    console.error('searchItemCodeCandidates error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchItemCodeSemantic', requirePermission('perm_item_code_access'), async (req, res) => {
  const { query } = req.body;
  if (!query?.trim()) return res.json({ success: false, error: 'Search query is required.' });

  try {
    // Stage 1: fast text-overlap prefilter (same query the candidates
    // route uses) — keeps the Gemini prompt small and cheap.
    const { rows: candidates } = await pool.query(
      `SELECT item_code, material_name, rating, type_of_material
       FROM design.item_codes
       WHERE to_tsvector('simple', material_name) @@ plainto_tsquery('simple', $1)
          OR material_name ILIKE '%' || $1 || '%'
       LIMIT 30`,
      [query]
    );
    if (candidates.length === 0) {
      return res.json({ success: true, matches: [], noResults: true });
    }

    // Stage 2: semantic ranking via Gemini
    const { matches } = await semanticItemMatch(query, candidates);
    res.json({ success: true, matches: matches || [] });
  } catch (err) {
    console.error('searchItemCodeSemantic error:', err);
    // Fall back to the unranked candidate list rather than a hard
    // failure — an AI-ranking outage shouldn't block item lookup.
    res.status(200).json({ success: true, matches: [], error: 'Semantic ranking unavailable, showing text-match results only.' });
  }
});

// getNextItemCode — PREVIEWS what the next auto-generated item code will
// be, without consuming the sequence (createItemCode's DEFAULT clause
// does the actual consumption on insert). Using last_value directly
// (not nextval()) is what makes this a safe preview rather than a
// side-effecting call — nextval() would burn a sequence value even if
// the user cancels and never submits.
router.post('/getNextItemCode', requirePermission('perm_item_code_access'), async (req, res) => {
  try {
    // Mirrors the real column default set by migration 022 —
    // 'ABPS' || lpad(nextval(...), 5, '0') — this preview must match it
    // exactly, or a shown "next code" doesn't match what actually gets
    // assigned on create.
    const { rows: [row] } = await pool.query(
      `SELECT 'ABPS' || lpad((last_value + CASE WHEN is_called THEN 1 ELSE 0 END)::text, 5, '0') AS next_code
       FROM design.item_code_seq`
    );
    res.json({ success: true, nextCode: row.next_code });
  } catch (err) {
    console.error('getNextItemCode error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/createItemCode', requirePermission('perm_item_code_access'), async (req, res) => {
  const { materialName, rating, typeOfMaterial, unit } = req.body;
  if (!materialName?.trim()) {
    return res.json({ success: false, error: 'Material Name is required.' });
  }
  // Always the logged-in user's resolved name, never their email — same
  // decision already made for created_by (purchase_request_notes) /
  // created_by (prn_line_items, formerly checked_by_store_person).
  const createdBy = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim();
  try {
    const { rows } = await pool.query(
      `INSERT INTO design.item_codes (material_name, rating, type_of_material, unit, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING item_code`,
      [materialName.trim(), rating || null, typeOfMaterial || null, unit || null, createdBy]
    );
    await writeAuditLog(req.user.email, req.body.operatorName, 'ItemCodes', 'CREATE', rows[0].item_code,
      `Created new item code for "${materialName}".`);
    syncLiveRow('item_codes', rows[0].item_code);
    res.json({ success: true, itemCode: rows[0].item_code });
  } catch (err) {
    console.error('createItemCode error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BOQ Lifecycle ──────────────────────────────────────────────────────

router.post('/fetchBOQsByProject', async (req, res) => {
  const { projectId } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT boq_id, product_name, product_rating, status, order_quantity,
              total_cost, version, boq_date
       FROM design.boq_drafts WHERE project_id = $1 ORDER BY boq_date DESC`,
      [projectId]
    );
    res.json({ success: true, boqs: rows });
  } catch (err) {
    console.error('fetchBOQsByProject error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchBOQDraftById', async (req, res) => {
  const { boqId } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT boq_id AS "boqId", project_id AS "projectId", customer_name AS "customerName",
              product_name AS "productName", product_rating AS "productRating", department,
              order_quantity AS "orderQuantity", boq_date AS "date", prepared_by AS "preparedBy",
              authorized_by AS "authorizedBy", status, material_rows AS "materialRows", version,
              total_cost_per_set AS "totalCostPerSet", total_cost AS "totalCost",
              pdf_url AS "pdfUrl", pdf_url_no_cost AS "pdfUrlNoCost"
       FROM design.boq_drafts WHERE boq_id = $1`, [boqId]
    );
    if (rows.length === 0) return res.json({ success: false, error: 'BOQ not found.' });
    res.json({ success: true, draft: rows[0] });
  } catch (err) {
    console.error('fetchBOQDraftById error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// generateBOQId — format: BOQ_<FYXX-XX>_<MonthAbbr>_<Company Name>_<Product Name>_<Rating>.
// Company/Product/Rating are kept LITERAL -- no punctuation stripped, no
// underscores substituted for spaces (per explicit decision: only accidental
// double-spaces get collapsed and leading/trailing whitespace trimmed).
// Underscores are ONLY the separators between the five top-level segments;
// within a segment, spaces stay as spaces. No trailing sequence number --
// a collision (two BOQs with identical Company+Product+Rating) would fail
// on the boq_id primary key, accepted as a known, low-probability risk
// per explicit decision rather than adding a disambiguator suffix.
function cleanBOQIdSegment(str) {
  return (str || '').toString().trim().replace(/\s+/g, ' ');
}

async function generateBOQId(client, companyName, poNumber, productName, productRating) {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST offset
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  const fyLabel = String(fyStart).slice(-2) + '-' + String(fyStart + 1).slice(-2);
  const monthAbbr = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month - 1];

  const poSegment = cleanBOQIdSegment(poNumber) || 'NOPO';
  return `BOQ_${fyLabel}_${monthAbbr}_${cleanBOQIdSegment(companyName)}_${poSegment}_${cleanBOQIdSegment(productName)}_${cleanBOQIdSegment(productRating)}`;
}

// syncBillOfQuantityMaterialRows — design.bill_of_quantity is now the
// one-row-per-material-line table (post table-name swap). Whenever a
// BOQ's material_rows JSON changes (initial creation, or a Revision gets
// authorized), this deletes whatever rows exist for that boq_id and
// re-inserts fresh ones from the current material_rows array -- simple
// full-replace sync rather than diffing, since these rows have no
// independent identity of their own (they're a flattened projection of
// the JSON, not user-edited directly).
async function syncBillOfQuantityMaterialRows(client, { boqId, projectId, customerName, department, productName, productRating, orderQuantity, materialRows, preparedBy, authorizedBy }) {
  await client.query(`DELETE FROM design.bill_of_quantity WHERE boq_id = $1`, [boqId]);
  for (const row of materialRows) {
    const totalProductQuantity = (Number(row.quantityFor1Set) || 0) * (Number(orderQuantity) || 0);
    const totalMaterialRate = (Number(row.quantityFor1Set) || 0) * (Number(row.designRatePerQuantity) || 0);
    await client.query(
      `INSERT INTO design.bill_of_quantity
         (boq_id, customer_name, project_id, production_department, product_name, product_rating,
          description_of_material, total_product_quantity, unit_type, type_of_store, item_code, make,
          qty_for_1_set, order_quantity, design_rate_per_quantity, total_material_rate, prepared_by, authorized_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [boqId, customerName, projectId, department, productName, productRating,
       row.descriptionOfMaterial, totalProductQuantity, row.unit, row.typeOfStore, row.itemCode, row.make || '',
       row.quantityFor1Set, orderQuantity, row.designRatePerQuantity, totalMaterialRate, preparedBy || null, authorizedBy || null]
    );
  }
}

// ensureMaterialsInInventory — ports code.js's function of the same
// name. Any Raw Materials Store item code appearing on a BOQ must exist
// in BOTH raw_material_store and spare_store (at zero stock) so
// Store/Purchase screens and spare-part ticket fulfillment can find it
// later; without this, newly-added materials are invisible to those
// modules until someone happens to receive stock against them.
// type_of_material is looked up from design.item_codes on every call —
// harmless if it's already correct, and self-healing for any row that
// was created before this lookup existed.
// ON CONFLICT DO NOTHING makes this safe to call on every authorization —
// stock levels already recorded are never touched by this function.
async function ensureMaterialsInInventory(client, materialRows) {
  for (const row of (materialRows || [])) {
    const itemCode = (row.itemCode || '').toString().trim();
    if (!itemCode) continue;
    const storeType = (row.typeOfStore || '').toString().trim().toLowerCase().replace(/\s+/g, '');
    if (storeType !== 'rawmaterialsstore' && storeType !== 'rawmaterial') continue;

    await client.query(
      `INSERT INTO store.raw_material_store (item_code, material_name, total_stock, unit_type, type_of_material)
       VALUES ($1, $2, 0, $3, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
       ON CONFLICT (item_code) DO NOTHING`,
      [itemCode, row.descriptionOfMaterial || '', row.unit || 'NOS']
    );

    await client.query(
      `INSERT INTO store.spare_store
         (item_code, material_name, total_stock, unit_type, type_of_material, last_updated)
       VALUES ($1, $2, 0, $3, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1), now())
       ON CONFLICT (item_code) DO NOTHING`,
      [itemCode, row.descriptionOfMaterial || '', row.unit || 'NOS']
    );

    syncLiveRow('raw_material_store', itemCode);
    syncLiveRow('spare_store', itemCode);
  }
}

// createBOQDraft — mirrors the workflow doc: draft is written with
// status 'Pending Authorization' and materialRows frozen as JSONB.
router.post('/createBOQDraft', requirePermission('perm_create_boq'), async (req, res) => {
  const { projectId, customerName, productName, productRating, department,
          orderQuantity, materialRowsList: materialRows, totalCostPerSet, totalCost, preparedBy } = req.body;

  if (!projectId || !productName || !materialRows?.length) {
    return res.json({ success: false, error: 'Project, Product Name, and at least one material row are required.' });
  }

  // Same duplicate-material guard as submitBOQUpdate (ports code.js).
  const _seenC = new Set();
  for (const r of materialRows) {
    if (!r.itemCode) continue;
    const key = r.itemCode.toString().trim().toUpperCase() + '|' + (r.typeOfStore || '').toString().trim();
    if (_seenC.has(key)) {
      return res.json({ success: false, error: `Duplicate material: "${r.descriptionOfMaterial || r.itemCode}" appears more than once in the same store type. Merge quantities into one row.` });
    }
    _seenC.add(key);
  }

  try {
     const preparedByResolved = preparedBy || req.body.operatorName || displayName(req);
    const result = await withTransaction(async (client) => {
      const { rows: [projForPO] } = await client.query(`SELECT po_number FROM project.projects WHERE project_id = $1`, [projectId]);
      const boqId = await generateBOQId(client, customerName, projForPO?.po_number, productName, productRating);
      await client.query(
        `INSERT INTO design.boq_drafts
           (boq_id, project_id, customer_name, product_name, product_rating, department,
            order_quantity, prepared_by, status, material_rows, total_cost_per_set, total_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Pending Authorization',$9,$10,$11)`,
        [boqId, projectId, customerName, productName, productRating, department,
         orderQuantity, preparedByResolved, JSON.stringify(materialRows), totalCostPerSet, totalCost]
      );
      return boqId;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'BillOfQuantity', 'CREATE', result,
      `Created BOQ draft for "${productName}" on project ${projectId}, pending authorization.`);
    res.json({ success: true, boqId: result });
  } catch (err) {
    console.error('createBOQDraft error:', err);
    // BOQ IDs are deterministic (built from company + product + rating +
    // PO), so a unique-violation here always means this exact
    // Product Name + Product Rating combination already has a BOQ on
    // this project — surface that plainly instead of the raw constraint
    // name (which, from migration 024's table swap, still confusingly
    // reads "bill_of_quantity_pkey" even though it's boq_drafts' key).
    if (err.code === '23505') {
      return res.status(400).json({
        success: false,
        error: `A BOQ for "${productName}" (${productRating || 'no rating specified'}) already exists on this project. Use "Update Bill of Quantity" to modify it, or change the Product Name / Rating to create a distinct BOQ.`,
      });
    }
    res.status(500).json({ success: false, error: 'BOQ creation failed: ' + err.message });
  }
});

// fetchBOQDraftsQueue — everything sitting in Pending Authorization,
// for the authorizing engineer's review screen.
router.post('/fetchBOQDraftsQueue', async (req, res) => {
  const status = req.body.status || 'Pending Authorization';
  try {
    const { rows } = await pool.query(
      `SELECT boq_id AS "boqId", project_id AS "projectId", customer_name AS "customerName",
              product_name AS "productName", product_rating AS "productRating", department,
              order_quantity AS "orderQuantity", prepared_by AS "preparedBy",
              boq_date AS "date", total_cost AS "totalCost"
       FROM design.boq_drafts
       WHERE status = $1
       ORDER BY boq_date ASC`,
      [status]
    );
    res.json({ success: true, drafts: rows });
  } catch (err) {
    console.error('fetchBOQDraftsQueue error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// submitBOQAuthorize — the critical lock-down step from the narrative
// doc: "status transitions to Authorized, which automatically locks
// down the record, blocks direct editing tools, and opens up the
// approved quantities to the purchasing department." The status CHECK
// constraint in the schema already prevents invalid transitions; this
// transaction adds the audit trail atomically with the status flip —
// something Sheets could not guarantee together.
//
// Fully atomic by explicit requirement: BOQ status flip, bill_of_quantity
// resync, Job Card + Job Card Materials creation (one Job Card per set),
// each Job Card's Drive folder, and both BOQ PDFs (generate + upload +
// URL persist) ALL happen inside one DB transaction. If anything fails —
// including the Drive/PDF external calls — everything rolls back and the
// BOQ stays in 'Pending Authorization' for a clean retry. No partial
// job cards, no orphaned folders, no BOQ stuck half-authorized.
router.post('/submitBOQAuthorize', requirePermission('perm_authorize_boq'), async (req, res) => {
  const { boqId, authorizedBy, productName: editedProductName, productRating: editedProductRating,
          department: editedDepartment, orderQuantity: editedOrderQuantity, materialRowsList: editedMaterialRowsList } = req.body;
  // Captured outside the transaction so the catch block below can still
  // reference them if the UPDATE itself throws — e.g. a unique-violation
  // when the edited Product Name/Rating collides with a BOQ that already
  // exists elsewhere on this project.
  let finalProductNameForError = editedProductName || '';
  let finalProductRatingForError = editedProductRating || '';
  try {
    const result = await withTransaction(async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT prepared_by, product_name FROM design.boq_drafts WHERE boq_id = $1 AND status = 'Pending Authorization'`,
        [boqId]
      );
      if (!existing) throw new Error('BOQ is not in Pending Authorization state, or does not exist. It may have already been authorized.');

      // Preparer cannot authorize their own BOQ, unless they're Admin.
      // Compares selected NAMES, not the shared login email — under the
      // shared-department-login model, comparing req.user.email here
      // would always match (everyone shares the same login), silently
      // disabling this check entirely.
      if (existing.prepared_by === authorizedBy && !req.user.perm_admin) {
        throw new Error('The person who prepared this BOQ cannot also authorize it. Please have a different authorized person confirm this.');
      }

      // This screen is explicitly "review, edit if needed, and authorize"
      // — the frontend sends possibly-edited productName/productRating/
      // department/orderQuantity/materialRowsList, which previously were
      // silently ignored here (only authorizedBy was ever read). Use the
      // submitted values as the source of truth, falling back to the
      // existing draft's product name only if nothing was sent.
      const finalProductName = (editedProductName || '').trim() || existing.product_name;
      const finalProductRating = editedProductRating !== undefined ? (editedProductRating || '').trim() : undefined;
      finalProductNameForError = finalProductName;
      finalProductRatingForError = finalProductRating !== undefined ? finalProductRating : finalProductRatingForError;
      const finalMaterialRows = Array.isArray(editedMaterialRowsList) && editedMaterialRowsList.length
        ? editedMaterialRowsList : undefined;

      // If Product Name/Rating changed, the BOQ ID itself must change —
      // it's deterministically built from them. This is ONLY safe to do
      // here, at first-time authorization: nothing yet references this
      // boq_id anywhere else (no Job Cards, no PRNs, no revision
      // requests can exist for a BOQ that was never authorized). Keep
      // the original ID's fixed prefix (BOQ / FY / Month / Company / PO
      // — never containing underscores per generateBOQId's convention)
      // and swap in the new Product/Rating segments; if they're
      // unchanged, this reproduces the exact original ID (idempotent).
      const idParts = boqId.split('_');
      let finalBoqId = boqId;
      if (idParts.length >= 7 && finalProductRating !== undefined) {
        const prefix = idParts.slice(0, 5).join('_');
        finalBoqId = `${prefix}_${cleanBOQIdSegment(finalProductName)}_${cleanBOQIdSegment(finalProductRating)}`;
      }

      const { rows } = await client.query(
        `UPDATE design.boq_drafts
         SET boq_id = $1, status = 'Authorized', authorized_by = $2, product_name = $3,
             product_rating = COALESCE($4, product_rating), department = COALESCE($5, department),
             order_quantity = COALESCE($6, order_quantity), material_rows = COALESCE($7, material_rows)
         WHERE boq_id = $8 AND status = 'Pending Authorization'
         RETURNING boq_id, product_name, project_id, customer_name, department, product_name AS pn, product_rating, order_quantity, prepared_by, material_rows, authorized_by, version`,
        [finalBoqId, authorizedBy || req.body.operatorName || displayName(req), finalProductName,
         finalProductRating, (editedDepartment || '').trim() || null,
         editedOrderQuantity || null, finalMaterialRows ? JSON.stringify(finalMaterialRows) : null, boqId]
      );
      if (!rows[0]) throw new Error(`A BOQ with ID "${finalBoqId}" already exists — this Product Name + Rating combination is already in use on this project.`);
      const authorizedRow = rows[0];
      const newBoqId = authorizedRow.boq_id; // may differ from the original `boqId` param if product/rating changed

      await syncBillOfQuantityMaterialRows(client, {
        boqId: newBoqId, projectId: authorizedRow.project_id, customerName: authorizedRow.customer_name,
        department: authorizedRow.department, productName: authorizedRow.product_name, productRating: authorizedRow.product_rating,
        orderQuantity: authorizedRow.order_quantity, materialRows: authorizedRow.material_rows,
         preparedBy: authorizedRow.prepared_by, authorizedBy: authorizedBy || req.body.operatorName || displayName(req),
      });

      // ── Auto-create Job Cards + Job Card Materials — one Job Card per
      // set (order_quantity), each seeded with this BOQ's material rows
      // (allotted_quantity = qty for ONE set, since each card IS one set).
      // Job Card number mirrors the (possibly renamed) BOQ ID, "BOQ"
      // swapped for "JC", with "Set-N" inserted right after the "JC" prefix.
      const setCount = Number(authorizedRow.order_quantity) || 0;
      const materialRows = authorizedRow.material_rows || [];
      const newJobCardNumbers = [];
      const newJobCardMaterialRowIds = [];
      const boqSuffix = newBoqId.replace(/^BOQ_/, '');

      for (let setNum = 1; setNum <= setCount; setNum++) {
        const jobCardNumber = `JC_Set-${setNum}_${boqSuffix}`;
        const { rows: [jc] } = await client.query(
          `INSERT INTO production.job_cards
             (job_card_number, project_id, customer_name, product_name, product_rating, boq_id, set_number, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Open')
           RETURNING job_card_number`,
          [jobCardNumber, authorizedRow.project_id, authorizedRow.customer_name, authorizedRow.product_name,
           authorizedRow.product_rating, newBoqId, setNum]
        );
        newJobCardNumbers.push(jc.job_card_number);

        for (const row of materialRows) {
          if (!row.itemCode) continue;
          const { rows: [insertedMat] } = await client.query(
            `INSERT INTO production.job_card_materials
               (job_card_number, boq_id, project_id, item_code, material_name, unit_type, type_of_store,
                allotted_quantity, used_quantity, remaining_quantity)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8)
             RETURNING row_id`,
            [jc.job_card_number, newBoqId, authorizedRow.project_id, row.itemCode, row.descriptionOfMaterial,
             row.unit, row.typeOfStore, Number(row.quantityFor1Set) || 0]
          );
          newJobCardMaterialRowIds.push(insertedMat.row_id);
        }
      }

      // Any new Raw Material item codes must exist in raw_material_store
      // so Store/Purchase can see them (ports code.js's
      // ensureMaterialsInInventory, called on authorize there too).
      await ensureMaterialsInInventory(client, materialRows);

      // ── BOQ PDFs — generated, saved to Drive (the canonical, user-
      // facing copy — same "Bill of Quantity" / "Bill of Quantity with
      // Costing" folder structure code.js used), Rev-N filenames, and
      // mirrored to Cloud Storage as a secondary internal copy.
      const designRootFolderId = process.env.DESIGN_ROOT_FOLDER_ID;
      if (!designRootFolderId) throw new Error('Design Drive root folder is not configured on the server.');
      const { subFolderIds } = await ensureProjectFolderStructure(designRootFolderId, authorizedRow.project_id, authorizedRow.customer_name);

      const pdfBytes = await generateBOQPdf({
        projectId: authorizedRow.project_id, customerName: authorizedRow.customer_name,
        productName: authorizedRow.product_name, productRating: authorizedRow.product_rating,
        department: authorizedRow.department, orderQuantity: authorizedRow.order_quantity,
        materialRows, preparedBy: authorizedRow.prepared_by, authorizedBy: authorizedRow.authorized_by, version: authorizedRow.version,
      });
      const costedFolderId = await ensureNestedFolderPath(subFolderIds['Bill of Quantity with Costing'], [newBoqId]);
      const { url: pdfUrl } = await uploadFile(costedFolderId, Buffer.from(pdfBytes), boqFileNameWithRev(newBoqId, authorizedRow.version, '_with Costing'), 'application/pdf');
      await uploadPdf(pdfBytes, `boq/${boqFileNameWithRev(newBoqId, authorizedRow.version, '_costed')}`); // secondary internal copy, not returned/stored

      const noCostBytes = await generateBOQNoCostPdf({
        projectId: authorizedRow.project_id, customerName: authorizedRow.customer_name,
        productName: authorizedRow.product_name, productRating: authorizedRow.product_rating,
        department: authorizedRow.department, orderQuantity: authorizedRow.order_quantity,
        materialRows, preparedBy: authorizedRow.prepared_by, authorizedBy: authorizedRow.authorized_by, version: authorizedRow.version,
      });
      const noCostFolderId = await ensureNestedFolderPath(subFolderIds['Bill of Quantity'], [newBoqId]);
      const { url: pdfUrlNoCost } = await uploadFile(noCostFolderId, Buffer.from(noCostBytes), boqFileNameWithRev(newBoqId, authorizedRow.version), 'application/pdf');
      await uploadPdf(noCostBytes, `boq/${boqFileNameWithRev(newBoqId, authorizedRow.version, '_nocost')}`); // secondary internal copy, not returned/stored

      await client.query(`UPDATE design.boq_drafts SET pdf_url = $1, pdf_url_no_cost = $2 WHERE boq_id = $3`, [pdfUrl, pdfUrlNoCost, newBoqId]);

      // ── Job Card Drive folders — created LAST, after the PDF step
      // (historically the more fragile external call) has already
      // succeeded, so a PDF failure never leaves orphan folders behind.
      // If folder creation itself fails partway through, best-effort
      // delete whatever folders THIS attempt already created before
      // rethrowing, rather than leaking them on every retry.
      const rootFolderId = process.env.PRODUCTION_DRIVE_FOLDER_ID;
      if (!rootFolderId) throw new Error('Production Drive root folder is not configured on the server.');
      const createdFolderIds = [];
      try {
        for (const jobCardNumber of newJobCardNumbers) {
          const folderId = await ensureNestedFolderPath(rootFolderId, [authorizedRow.project_id, newBoqId, jobCardNumber]);
          createdFolderIds.push(folderId);
        }
      } catch (folderErr) {
        for (const folderId of createdFolderIds) await deleteFile(folderId);
        throw folderErr;
      }

      return { ...authorizedRow, pdfUrl, pdfUrlNoCost, jobCardNumbers: newJobCardNumbers, jobCardMaterialRowIds: newJobCardMaterialRowIds };
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'BillOfQuantity', 'AUTHORIZE', result.boq_id,
      `Authorized BOQ for "${result.product_name}" — now locked, ${result.jobCardNumbers.length} Job Card(s) created, available to Purchase.`);
    result.jobCardMaterialRowIds.forEach(rowId => syncLiveRow('job_card_materials', rowId));
    result.jobCardNumbers.forEach(jc => syncLiveRow('job_card_number', jc));

    res.json({ success: true, boqId: result.boq_id, productName: result.product_name, productRating: result.product_rating,
      pdfUrl: result.pdfUrl, pdfUrlNoCost: result.pdfUrlNoCost, jobCardNumbers: result.jobCardNumbers });
  } catch (err) {
    console.error('submitBOQAuthorize error:', err);
    // BOQ IDs are deterministic (built from company + product + rating +
    // PO) — a unique-violation here always means the edited Product
    // Name + Rating now matches a BOQ that already exists on this
    // project. Same friendly translation createBOQDraft already applies
    // for the equivalent case at creation time.
    if (err.code === '23505') {
      return res.status(400).json({
        success: false,
        error: `A BOQ for "${finalProductNameForError}" (${finalProductRatingForError || 'no rating specified'}) already exists on this project. Use "Update Bill of Quantity" to modify it, or change the Product Name / Rating to create a distinct BOQ.`,
      });
    }
    res.status(400).json({ success: false, error: 'Authorization failed and was fully rolled back: ' + err.message });
  }
});

// ── Drawings ─────────────────────────────────────────────────────────
// uploadDrawingDocument — routes into the project's "Drawings" subfolder,
// created on demand if the project's folder structure doesn't exist yet
// (matches getOrCreateDrawingDocumentsFolder's lazy-create behavior).
// NOTE: Project creation, Project ID generation, and Manufacturing
// Clearance (fetchProjectsByStatus / activateProject) moved to
// routes/projects.js — Projects now lives in the `project` schema,
// not `design`. This route still needs the project's company name, so
// it queries project.projects directly.
router.post('/uploadDrawingDocument', requirePermission('perm_upload_drawings'), async (req, res) => {
  const { projectId, fileName, base64Data, mimeType } = req.body;
  if (!projectId || !fileName || !base64Data) {
    return res.json({ success: false, error: 'Project ID, file name, and file data are required.' });
  }

  try {
    const { rows: [proj] } = await pool.query(`SELECT company_name FROM project.projects WHERE project_id = $1`, [projectId]);
    if (!proj) return res.json({ success: false, error: 'Project not found.' });

    const rootFolderId = process.env.DESIGN_ROOT_FOLDER_ID;
    if (!rootFolderId) return res.json({ success: false, error: 'Drive root folder is not configured on the server.' });

    const { subFolderIds } = await ensureProjectFolderStructure(rootFolderId, projectId, proj.company_name);
    const buffer = Buffer.from(base64Data, 'base64');
    const { url, fileId } = await uploadFile(subFolderIds['Drawings'], buffer, fileName, mimeType || 'application/octet-stream');

    await writeAuditLog(req.user.email, req.body.operatorName, 'Projects', 'UPLOAD_DRAWING', projectId,
      `Uploaded drawing "${fileName}".`);
    res.json({ success: true, url, fileId, fileName });
  } catch (err) {
    console.error('uploadDrawingDocument error:', err);
    res.status(500).json({ success: false, error: 'Upload failed: ' + err.message });
  }
});

// fetchDrawingDocumentsList — reads directly from Drive rather than a DB
// table, so it's genuinely live: a file added or deleted straight in
// Drive (outside this app) shows up immediately, since there is no
// separate record to fall out of sync with reality.
router.post('/fetchDrawingDocumentsList', requirePermission('perm_upload_drawings'), async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'Project ID is required.' });
  try {
    const { rows: [proj] } = await pool.query(`SELECT company_name FROM project.projects WHERE project_id = $1`, [projectId]);
    if (!proj) return res.json({ success: false, error: 'Project not found.' });

    const rootFolderId = process.env.DESIGN_ROOT_FOLDER_ID;
    if (!rootFolderId) return res.json({ success: false, error: 'Drive root folder is not configured on the server.' });

    const { subFolderIds } = await ensureProjectFolderStructure(rootFolderId, projectId, proj.company_name);
    const files = await listFilesInFolder(subFolderIds['Drawings']);

    const documents = files.map(f => ({ name: f.name, url: f.url, lastUpdated: f.modifiedTime }));
    res.json({ success: true, documents });
  } catch (err) {
    console.error('fetchDrawingDocumentsList error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BOQ Engineering Change Management (Amendments) ──────────────────────
// fetchAuthorizedBOQsForUpdate — feeds the "Update BOQ" screen's picker.
router.post('/fetchAuthorizedBOQsForUpdate', requirePermission('perm_update_boq'), async (req, res) => {
  const { projectId } = req.body;
  try {
    const clauses = [`status = 'Authorized'`];
    const params = [];
    if (projectId) { clauses.push(`project_id = $1`); params.push(projectId); }
    const { rows } = await pool.query(
      `SELECT b.boq_id AS "boqId", b.project_id AS "projectId", b.customer_name AS "customerName",
              b.product_name AS "productName", b.product_rating AS "productRating", b.department,
              b.order_quantity AS "orderQuantity", b.material_rows AS "materialRows", b.version,
              b.prepared_by AS "preparedBy", b.boq_date AS "date",
              EXISTS (
                SELECT 1 FROM design.boq_update_requests u
                WHERE u.boq_id = b.boq_id AND u.status = 'Pending Authorization Update'
              ) AS "hasPendingRevision"
       FROM design.boq_drafts b WHERE ${clauses.join(' AND ')} ORDER BY b.boq_date DESC`,
      params
    );
    res.json({ success: true, drafts: rows });
  } catch (err) {
    console.error('fetchAuthorizedBOQsForUpdate error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// generateBOQUpdateSummary — read-only diff between the current
// authorized material rows and the proposed new rows, keyed by item
// code, so the reviewer sees "old qty -> new qty" per line, matching
// the narrative doc: "displaying the initial quantity alongside the
// newly proposed targets."
router.post('/generateBOQUpdateSummary', requirePermission('perm_update_boq'), async (req, res) => {
  const { boqId, updatedRows, updatedDepartment, updatedOrderQty } = req.body;
  try {
    const { rows: [boq] } = await pool.query(
      `SELECT material_rows, department, order_quantity FROM design.boq_drafts WHERE boq_id = $1`, [boqId]);
    if (!boq) return res.json({ success: false, error: 'BOQ not found.' });

    const originalRows = boq.material_rows || [];
    if (originalRows.length === 0) {
      return res.json({ success: true, summary: 'No previous authorized version found to compare against.' });
    }

    // Normalize store-type labels so "Raw Material" vs "Raw Materials
    // Store" don't report as a false store-type change (mirrors legacy).
    const normalizeStore = (val) => {
      const v = (val || '').toString().trim().toLowerCase().replace(/\s+/g, '');
      if (v === 'rawmaterialsstore' || v === 'rawmaterial') return 'Raw Materials Store';
      if (v === 'finishedgoodsstore' || v === 'finishedgoods') return 'Finished Goods Store';
      if (v === 'sparestore' || v === 'spare') return 'Spare Store';
      return (val || '').toString().trim();
    };

    // Match by itemCode, falling back to description when itemCode is blank.
    const keyOf = (r) => (r.itemCode || r.descriptionOfMaterial || '').toString().trim().toUpperCase();
    const origByCode = {};
    originalRows.forEach(r => { const k = keyOf(r); if (k) origByCode[k] = { ...r, typeOfStore: normalizeStore(r.typeOfStore) }; });
    const updByCode = {};
    (updatedRows || []).forEach(r => { const k = keyOf(r); if (k) updByCode[k] = { ...r, typeOfStore: normalizeStore(r.typeOfStore) }; });

    const materialChanges = [];
    Object.keys(origByCode).forEach(k => {
      if (!(k in updByCode)) materialChanges.push(`${origByCode[k].descriptionOfMaterial || k} was removed.`);
    });
    Object.keys(updByCode).forEach(k => {
      if (!(k in origByCode)) {
        const r = updByCode[k];
        materialChanges.push(`${r.descriptionOfMaterial || k} was added with quantity ${r.quantityFor1Set} ${r.unit || 'NOS'}.`);
      }
    });
    Object.keys(updByCode).forEach(k => {
      if (!(k in origByCode)) return;
      const before = origByCode[k], after = updByCode[k];
      const label = after.descriptionOfMaterial || before.descriptionOfMaterial || k;
      const bQty = Number(before.quantityFor1Set) || 0, aQty = Number(after.quantityFor1Set) || 0;
      if (Math.round(bQty * 1000) !== Math.round(aQty * 1000))
        materialChanges.push(`${label} quantity changed from ${bQty} to ${aQty} ${after.unit || before.unit || 'NOS'}.`);
      const bRate = Number(before.designRatePerQuantity) || 0, aRate = Number(after.designRatePerQuantity) || 0;
      if (Math.round(bRate * 100) !== Math.round(aRate * 100))
        materialChanges.push(`${label} design rate changed from ${bRate} to ${aRate}.`);
      const bMake = (before.make || '').trim(), aMake = (after.make || '').trim();
      if (aMake && bMake !== aMake) materialChanges.push(`${label} make changed from ${bMake || '\u2014'} to ${aMake}.`);
      if (before.typeOfStore && after.typeOfStore && before.typeOfStore !== after.typeOfStore)
        materialChanges.push(`${label} store type changed from ${before.typeOfStore} to ${after.typeOfStore}.`);
    });

    // Header-level + cost changes.
    const origOrderQty = Number(boq.order_quantity) || 0;
    const effOrderQty = Number(updatedOrderQty) || origOrderQty;
    const sumPerSet = (rows) => rows.reduce((acc, r) =>
      (normalizeStore(r.typeOfStore) === 'Spare Store') ? acc
        : acc + (Number(r.quantityFor1Set) || 0) * (Number(r.designRatePerQuantity) || 0), 0);
    const origPerSet = sumPerSet(originalRows), updPerSet = sumPerSet(updatedRows || []);

    const headerChanges = [];
    if (updatedDepartment && boq.department && boq.department !== updatedDepartment)
      headerChanges.push(`Department changed from ${boq.department} to ${updatedDepartment}.`);
    if (updatedOrderQty && origOrderQty && origOrderQty !== effOrderQty)
      headerChanges.push(`Order Quantity changed from ${origOrderQty} Sets to ${effOrderQty} Sets.`);
    if (Math.round(origPerSet * 100) !== Math.round(updPerSet * 100))
      headerChanges.push(`Total BOQ Cost Per Set changed from ${formatINR(origPerSet)} to ${formatINR(updPerSet)}.`);
    if (Math.round(origPerSet * origOrderQty * 100) !== Math.round(updPerSet * effOrderQty * 100))
      headerChanges.push(`Total BOQ Cost changed from ${formatINR(origPerSet * origOrderQty)} to ${formatINR(updPerSet * effOrderQty)}.`);

    const all = materialChanges.concat(headerChanges);
    res.json({ success: true, summary: all.length ? all.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'No changes detected.', changes: all });
  } catch (err) {
    console.error('generateBOQUpdateSummary error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// submitBOQUpdate — creates the amendment request. Does NOT touch the
// live authorized bill_of_quantity row — it stays locked, exactly as
// the narrative doc describes, until an admin signs off below.
router.post('/submitBOQUpdate', requirePermission('perm_update_boq'), async (req, res) => {
  const { boqId, newMaterialRows, newOrderQuantity } = req.body;
  if (!newMaterialRows?.length) return res.json({ success: false, error: 'At least one material row is required.' });

  // Reject the same item code appearing twice under the same store type
  // (ports code.js's _seenU check). Not cosmetic: the Job Card cascade
  // keys material rows by itemCode, so a duplicate would silently
  // overwrite the earlier row and the Job Card would receive only the
  // last one's quantity.
  const _seenU = new Set();
  for (const r of newMaterialRows) {
    if (!r.itemCode) continue;
    const key = r.itemCode.toString().trim().toUpperCase() + '|' + (r.typeOfStore || '').toString().trim();
    if (_seenU.has(key)) {
      return res.json({ success: false, error: `Duplicate material: "${r.descriptionOfMaterial || r.itemCode}" appears more than once in the same store type. Merge quantities into one row.` });
    }
    _seenU.add(key);
  }

  try {
    const { rows: [boq] } = await pool.query(
      `SELECT material_rows, order_quantity FROM design.boq_drafts WHERE boq_id = $1 AND status = 'Authorized'`, [boqId]
    );
    if (!boq) return res.json({ success: false, error: 'BOQ not found, or is not currently Authorized.' });

    // Only one open revision request per BOQ at a time — otherwise two
    // people could file competing amendments and both get authorized in
    // sequence, the second silently clobbering the first. (A DB-level
    // partial unique index also enforces this, as a race backstop.)
    const { rows: [openReq] } = await pool.query(
      `SELECT update_id, requested_by FROM design.boq_update_requests
       WHERE boq_id = $1 AND status = 'Pending Authorization Update' LIMIT 1`, [boqId]
    );
    if (openReq) {
      return res.status(400).json({ success: false,
        error: `This BOQ already has a revision request awaiting authorization (raised by ${openReq.requested_by || 'someone'}). That one must be authorized or rejected before a new revision can be proposed.` });
    }

    const { rows: [update] } = await pool.query(
      `INSERT INTO design.boq_update_requests
         (boq_id, requested_by, old_material_rows, new_material_rows, old_order_quantity, new_order_quantity)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING update_id`,
       [boqId, req.body.operatorName || displayName(req), JSON.stringify(boq.material_rows), JSON.stringify(newMaterialRows),
       boq.order_quantity, newOrderQuantity || boq.order_quantity]
    );

    await writeAuditLog(req.user.email, req.body.operatorName, 'BOQUpdateRequests', 'CREATE', update.update_id,
      `Proposed update to BOQ ${boqId}.`);
    res.json({ success: true, updateId: update.update_id });
  } catch (err) {
    console.error('submitBOQUpdate error:', err);
    res.status(500).json({ success: false, error: 'Update request failed: ' + err.message });
  }
});

// fetchPendingBOQUpdateRequests — feeds the "Authorize BOQ Revision"
// queue: every revision request still awaiting sign-off, with the
// requester's proposed changes and enough header context to render a
// review card.
router.post('/fetchPendingBOQUpdateRequests', requirePermission('perm_authorize_boq_update'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.update_id AS "updateId", r.boq_id AS "boqId",
              COALESCE(TRIM(u.first_name || ' ' || u.last_name), r.requested_by) AS "requestedBy",
              r.old_material_rows AS "oldMaterialRows", r.new_material_rows AS "newMaterialRows",
              r.old_order_quantity AS "oldOrderQuantity", r.new_order_quantity AS "newOrderQuantity",
              r.created_at AS "createdAt",
              b.product_name AS "productName", b.product_rating AS "productRating",
              b.project_id AS "projectId", b.customer_name AS "customerName", b.department
       FROM design.boq_update_requests r
       JOIN design.boq_drafts b ON b.boq_id = r.boq_id
       LEFT JOIN admin_db.users u ON u.email = r.requested_by
       WHERE r.status = 'Pending Authorization Update'
       ORDER BY r.created_at ASC`
    );
    res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('fetchPendingBOQUpdateRequests error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// submitBOQUpdateAuthorize — the sign-off step. The authorizer may edit
// the proposed rows/order-qty before approving (editedMaterialRows /
// editedOrderQuantity), so those — not the original request — are what
// get committed; the request row is updated to reflect what was really
// approved. Commits the new quantities to the live bill_of_quantity row,
// bumps version, cascades to every existing Job Card's material
// allotment (never lowering below what's already been used), saves new
// Rev-N PDFs to Drive, and appends full change tracking to the audit
// log — all in one transaction.
router.post('/submitBOQUpdateAuthorize', requirePermission('perm_authorize_boq_update'), async (req, res) => {
  const { updateId, editedMaterialRows, editedOrderQuantity } = req.body;
  try {
    const result = await withTransaction(async (client) => {
      const { rows: [update] } = await client.query(
        `SELECT * FROM design.boq_update_requests WHERE update_id = $1 AND status = 'Pending Authorization Update'`,
        [updateId]
      );
      if (!update) throw new Error('Update request not found, or already actioned.');

      if (update.requested_by === (req.body.operatorName || displayName(req)) && !req.user.perm_admin) {
        throw new Error('The person who requested this update cannot also authorize it.');
      }

      const committedRows = Array.isArray(editedMaterialRows) && editedMaterialRows.length
        ? editedMaterialRows : update.new_material_rows;
      const committedOrderQty = (editedOrderQuantity !== undefined && editedOrderQuantity !== null && editedOrderQuantity !== '')
        ? editedOrderQuantity : update.new_order_quantity;

      const { rows: [bumped] } = await client.query(
        `UPDATE design.boq_drafts
         SET material_rows = $1, order_quantity = $2, version = version + 1
         WHERE boq_id = $3
         RETURNING version, authorized_by, prepared_by`,
        [JSON.stringify(committedRows), committedOrderQty, update.boq_id]
      );
      await client.query(
        `UPDATE design.boq_update_requests
         SET status = 'Authorized', authorized_by = $1, authorized_at = now(),
             new_material_rows = $2, new_order_quantity = $3
         WHERE update_id = $4`,
        [req.body.operatorName || displayName(req), JSON.stringify(committedRows), committedOrderQty, updateId]
      );

      // If nothing PRN-relevant actually changed (item codes, per-set
      // quantities, or Order Quantity — NOT Rate/Make, which are purely
      // costing/labeling), sync boq_version_applied forward to match
      // right now. Otherwise version just bumped unconditionally above
      // (as it always does, for Rev-N document tracking) while nothing
      // material changed, and "BOQs Needing a PRN Revision" would flag
      // this BOQ purely because of a Rate/Make edit — a false positive
      // with no real PRN action for anyone to take.
      const oldRowsForCompare = update.old_material_rows || [];
      const oldByItemCode = Object.fromEntries(
        oldRowsForCompare.map(r => [(r.itemCode || '').trim(), Number(r.quantityFor1Set) || 0])
      );
      const newByItemCode = Object.fromEntries(
        (committedRows || []).map(r => [(r.itemCode || '').trim(), Number(r.quantityFor1Set) || 0])
      );
      const oldCodes = Object.keys(oldByItemCode).sort();
      const newCodes = Object.keys(newByItemCode).sort();
      const sameItemCodes = oldCodes.length === newCodes.length && oldCodes.every((c, i) => c === newCodes[i]);
      const sameQuantities = sameItemCodes && oldCodes.every(c => Math.abs(oldByItemCode[c] - newByItemCode[c]) < 1e-9);
      const sameOrderQty = Math.abs((Number(update.old_order_quantity) || 0) - (Number(committedOrderQty) || 0)) < 1e-9;
      const prnRelevantChange = !(sameItemCodes && sameQuantities && sameOrderQty);

      if (!prnRelevantChange) {
        await client.query(
          `UPDATE purchase.purchase_request_notes SET boq_version_applied = $1 WHERE boq_id = $2`,
          [bumped.version, update.boq_id]
        );
      }

      const { rows: [boqAfterUpdate] } = await client.query(
        `SELECT project_id, customer_name, department, product_name, product_rating, prepared_by
         FROM design.boq_drafts WHERE boq_id = $1`, [update.boq_id]
      );
      await syncBillOfQuantityMaterialRows(client, {
        boqId: update.boq_id, projectId: boqAfterUpdate.project_id, customerName: boqAfterUpdate.customer_name,
        department: boqAfterUpdate.department, productName: boqAfterUpdate.product_name, productRating: boqAfterUpdate.product_rating,
        orderQuantity: committedOrderQty, materialRows: committedRows,
        preparedBy: boqAfterUpdate.prepared_by, authorizedBy: req.body.operatorName || displayName(req),
      });

      // ── Cascade to existing Job Cards ──────────────────────────────
      // Each Job Card represents ONE set, so its allotment for a material
      // is that material's new per-set quantity. remaining is recomputed
      // from the new allotment + any admin-approved increase, minus what's
      // already used — floored at 0 so a downward revision can never go
      // negative or erase quantities a card has already consumed.
      // Materials newly ADDED in the revision are inserted into every
      // existing Job Card; materials REMOVED are left in place (a card
      // may already have consumed them — deleting would lose that history).
      const { rows: existingJobCards } = await client.query(
        `SELECT job_card_number, set_number, status FROM production.job_cards WHERE boq_id = $1 ORDER BY set_number ASC`, [update.boq_id]
      );
      const newRowsByCode = {};
      for (const r of (committedRows || [])) {
        if (r.itemCode) newRowsByCode[r.itemCode] = r;
      }
      const cascadedRowIds = [];
      for (const jc of existingJobCards) {
        const { rows: cardMats } = await client.query(
          `SELECT item_code FROM production.job_card_materials WHERE job_card_number = $1`, [jc.job_card_number]
        );
        const existingCodes = new Set(cardMats.map(m => m.item_code));

        for (const [itemCode, r] of Object.entries(newRowsByCode)) {
          const perSetQty = Number(r.quantityFor1Set) || 0;
          if (existingCodes.has(itemCode)) {
            const { rows: [upd] } = await client.query(
              `UPDATE production.job_card_materials
               SET allotted_quantity = $1,
                   remaining_quantity = GREATEST(0, $1 + COALESCE(increase_approved_quantity, 0) - COALESCE(used_quantity, 0)),
                   last_updated = now()
               WHERE job_card_number = $2 AND item_code = $3
               RETURNING row_id`,
              [perSetQty, jc.job_card_number, itemCode]
            );
            if (upd) cascadedRowIds.push(upd.row_id);
          } else {
            const { rows: [ins] } = await client.query(
              `INSERT INTO production.job_card_materials
                 (job_card_number, boq_id, project_id, item_code, material_name, unit_type, type_of_store,
                  allotted_quantity, used_quantity, remaining_quantity)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8)
               RETURNING row_id`,
              [jc.job_card_number, update.boq_id, boqAfterUpdate.project_id, itemCode, r.descriptionOfMaterial,
               r.unit, r.typeOfStore, perSetQty]
            );
            if (ins) cascadedRowIds.push(ins.row_id);
          }
        }
      }

      // Materials newly added by this revision need inventory rows too.
      await ensureMaterialsInInventory(client, committedRows);

      // ── Order Quantity change → Job Card count sync ─────────────────
      // Increase: append new Job Cards for the newly added sets, seeded
      // with the (possibly also-revised) material rows, with a Drive
      // folder each. Decrease: for sets beyond the new target, delete
      // the Job Card ONLY if it has zero consumption anywhere on it;
      // if it has ANY used_quantity > 0, it is NEVER deleted — instead
      // marked status = 'Excess/Orphaned' so consumption history is
      // preserved and it's visibly flagged rather than silently kept
      // as if still active. (Legacy code.js's syncJobCardNumbers_
      // deleted unconditionally on decrease — this deliberately does
      // not replicate that, per explicit decision.)
      const targetSetCount = Number(committedOrderQty) || 0;
      const currentMaxSet = existingJobCards.length ? Math.max(...existingJobCards.map(jc => jc.set_number)) : 0;
      const newlyCreatedJobCardNumbers = [];

      if (targetSetCount > currentMaxSet) {
        const boqSuffix = update.boq_id.replace(/^BOQ_/, '');
        for (let setNum = currentMaxSet + 1; setNum <= targetSetCount; setNum++) {
          const jobCardNumber = `JC_Set-${setNum}_${boqSuffix}`;
          await client.query(
            `INSERT INTO production.job_cards
               (job_card_number, project_id, customer_name, product_name, product_rating, boq_id, set_number, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'Open')`,
            [jobCardNumber, boqAfterUpdate.project_id, boqAfterUpdate.customer_name, boqAfterUpdate.product_name,
             boqAfterUpdate.product_rating, update.boq_id, setNum]
          );
          newlyCreatedJobCardNumbers.push(jobCardNumber);

          for (const row of (committedRows || [])) {
            if (!row.itemCode) continue;
            const { rows: [insertedMat] } = await client.query(
              `INSERT INTO production.job_card_materials
                 (job_card_number, boq_id, project_id, item_code, material_name, unit_type, type_of_store,
                  allotted_quantity, used_quantity, remaining_quantity)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8)
               RETURNING row_id`,
              [jobCardNumber, update.boq_id, boqAfterUpdate.project_id, row.itemCode, row.descriptionOfMaterial,
               row.unit, row.typeOfStore, Number(row.quantityFor1Set) || 0]
            );
            cascadedRowIds.push(insertedMat.row_id);
          }
        }
      } else if (targetSetCount < currentMaxSet) {
        const cardsToRemove = existingJobCards.filter(jc => jc.set_number > targetSetCount);
        for (const jc of cardsToRemove) {
          const { rows: [usage] } = await client.query(
            `SELECT COALESCE(SUM(used_quantity), 0) AS total_used FROM production.job_card_materials WHERE job_card_number = $1`,
            [jc.job_card_number]
          );
          if (Number(usage.total_used) > 0) {
            await client.query(`UPDATE production.job_cards SET status = 'Excess/Orphaned' WHERE job_card_number = $1`, [jc.job_card_number]);
          } else {
            await client.query(`DELETE FROM production.job_card_materials WHERE job_card_number = $1`, [jc.job_card_number]);
            await client.query(`DELETE FROM production.job_cards WHERE job_card_number = $1`, [jc.job_card_number]);
          }
        }
      }

      // Drive folders for newly created Job Cards only (deletion of a
      // removed card's folder is intentionally NOT done here — Drive
      // history for a deleted-while-unused card is harmless clutter,
      // not worth the extra external-call risk inside this transaction).
      if (newlyCreatedJobCardNumbers.length) {
        const rootFolderId = process.env.PRODUCTION_DRIVE_FOLDER_ID;
        if (rootFolderId) {
          const createdFolderIds = [];
          try {
            for (const jobCardNumber of newlyCreatedJobCardNumbers) {
              const folderId = await ensureNestedFolderPath(rootFolderId, [boqAfterUpdate.project_id, update.boq_id, jobCardNumber]);
              createdFolderIds.push(folderId);
            }
          } catch (folderErr) {
            for (const folderId of createdFolderIds) await deleteFile(folderId);
            throw folderErr;
          }
        }
      }

      // Pure decreases/removals apply to the PRN with no maker-checker —
      // there is nothing to decide, only stock to release. Anything with
      // an increase in it returns null here and surfaces in the
      // needs-a-PRN queue as one authorized delta PRN instead. Runs
      // inside this transaction so a BOQ update and its PRN trim can
      // never be half-applied.
      const silentPrn = await applySilentPRNDecrease(client, update.boq_id, displayName(req));

      return { ...update, new_material_rows: committedRows, new_order_quantity: committedOrderQty,
        version: bumped.version, cascadedRowIds, newlyCreatedJobCardNumbers, silentPrn };
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'BillOfQuantity', 'UPDATE_AUTHORIZE', result.boq_id,
      `Authorized BOQ update.`,
      { oldMaterialRows: result.old_material_rows, newMaterialRows: result.new_material_rows });
    (result.cascadedRowIds || []).forEach(rowId => syncLiveRow('job_card_materials', rowId));
    // Only newly-created cards are synced here — the decrease branch of
    // this same cascade can DELETE job_cards rows outright (unused
    // excess cards) or UPDATE their status to 'Excess/Orphaned'.
    // liveSync only ever upserts; it never removes a row from the sheet
    // that's since been deleted from the DB, and the status-only change
    // has no dedicated sync call either. Both stay stale in the sheet
    // until the next full resync — not fixed here, flagging it.
    (result.newlyCreatedJobCardNumbers || []).forEach(jc => syncLiveRow('job_card_number', jc));

    // Silent PRN trim: audit + document, after commit. "Silent" means no
    // approval step, NOT invisible — stock moved and quantities changed
    // with nobody approving it, so it must be traceable afterwards.
    if (result.silentPrn) {
      const s = result.silentPrn;
      await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseRequestNotes', 'AUTO_REVISE', s.prnId,
        `Auto-revised to v${s.version} by BOQ revision v${s.boqVersion} (decrease/removal only). ` +
        `Items: ${s.itemsChanged.join(', ')}.` +
        (s.released.length ? ` Store released — ${s.released.join('; ')}.` : '') +
        (s.deferredItems.length ? ` Awaiting PO revision: ${s.deferredItems.join(', ')}.` : ''));
      syncLiveRow('purchase_request_notes', s.prnId);
      try {
        await regeneratePRNDocument(s.prnId);
      } catch (pdfErr) {
        console.error('Silent PRN revision PDF regeneration failed (non-fatal):', pdfErr);
      }
    }

    // Regenerate the BOQ PDFs against the new committed values, as new
    // Rev-N files (result.version is already the post-increment number)
    // saved to Drive — earlier revisions' files are never touched.
    let pdfUrl = null;
    let pdfUrlNoCost = null;
    try {
      const { rows: [boq] } = await pool.query(`SELECT * FROM design.boq_drafts WHERE boq_id = $1`, [result.boq_id]);
      const designRootFolderId = process.env.DESIGN_ROOT_FOLDER_ID;
      if (!designRootFolderId) throw new Error('Design Drive root folder is not configured on the server.');
      const { subFolderIds } = await ensureProjectFolderStructure(designRootFolderId, boq.project_id, boq.customer_name);

      const pdfBytes = await generateBOQPdf({
        projectId: boq.project_id, customerName: boq.customer_name, productName: boq.product_name,
        productRating: boq.product_rating, department: boq.department, orderQuantity: boq.order_quantity,
        materialRows: boq.material_rows, preparedBy: boq.prepared_by, authorizedBy: boq.authorized_by, version: boq.version,
      });
      const costedFolderId = await ensureNestedFolderPath(subFolderIds['Bill of Quantity with Costing'], [result.boq_id]);
      ({ url: pdfUrl } = await uploadFile(costedFolderId, Buffer.from(pdfBytes), boqFileNameWithRev(result.boq_id, boq.version, '_with Costing'), 'application/pdf'));

      const noCostBytes = await generateBOQNoCostPdf({
        projectId: boq.project_id, customerName: boq.customer_name, productName: boq.product_name,
        productRating: boq.product_rating, department: boq.department, orderQuantity: boq.order_quantity,
        materialRows: boq.material_rows, preparedBy: boq.prepared_by, authorizedBy: boq.authorized_by, version: boq.version,
      });
      const noCostFolderId = await ensureNestedFolderPath(subFolderIds['Bill of Quantity'], [result.boq_id]);
      ({ url: pdfUrlNoCost } = await uploadFile(noCostFolderId, Buffer.from(noCostBytes), boqFileNameWithRev(result.boq_id, boq.version), 'application/pdf'));

      await pool.query(`UPDATE design.boq_drafts SET pdf_url = $1, pdf_url_no_cost = $2 WHERE boq_id = $3`, [pdfUrl, pdfUrlNoCost, result.boq_id]);
    } catch (pdfErr) {
      console.error('BOQ update PDF regeneration failed (non-fatal):', pdfErr);
    }

    res.json({ success: true, boqId: result.boq_id, pdfUrl, pdfUrlNoCost });
  } catch (err) {
    console.error('submitBOQUpdateAuthorize error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// submitBOQUpdateReject — closes an open revision request without
// committing it, freeing the BOQ for a corrected request. Same
// maker-checker separation as authorize: the requester can't reject
// their own request (unless admin).
router.post('/submitBOQUpdateReject', requirePermission('perm_authorize_boq_update'), async (req, res) => {
  const { updateId, rejectionReason } = req.body;
  try {
    const { rows: [update] } = await pool.query(
      `SELECT requested_by, boq_id FROM design.boq_update_requests
       WHERE update_id = $1 AND status = 'Pending Authorization Update'`, [updateId]
    );
    if (!update) return res.json({ success: false, error: 'Update request not found, or already actioned.' });
    if (update.requested_by === (req.body.operatorName || displayName(req)) && !req.user.perm_admin) {
      return res.json({ success: false, error: 'The person who requested this update cannot also reject it.' });
    }

    await pool.query(
      `UPDATE design.boq_update_requests
       SET status = 'Rejected', authorized_by = $1, authorized_at = now() WHERE update_id = $2`,
      [req.body.operatorName || displayName(req), updateId]
    );
    await writeAuditLog(req.user.email, req.body.operatorName, 'BOQUpdateRequests', 'REJECT', update.boq_id,
      `Rejected BOQ revision request ${updateId}.${rejectionReason ? ' Reason: ' + rejectionReason : ''}`);
    res.json({ success: true });
  } catch (err) {
    console.error('submitBOQUpdateReject error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BOQ Import/Clone (Create BOQ screen's "import from existing" feature) ──
router.post('/fetchBOQsForImport', requirePermission('perm_create_boq'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT boq_id AS "boqId", product_name AS "productName", product_rating AS "productRating",
              project_id AS "projectId", order_quantity AS "orderQuantity"
       FROM design.boq_drafts WHERE status = 'Authorized' ORDER BY boq_date DESC LIMIT 500`
    );
    res.json({ success: true, boqs: rows });
  } catch (err) {
    console.error('fetchBOQsForImport error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchBOQMaterialRowsForImport', requirePermission('perm_create_boq'), async (req, res) => {
  const { boqId } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT type_of_store AS "typeOfStore", description_of_material AS "descriptionOfMaterial",
              item_code AS "itemCode", make, qty_for_1_set AS "quantityFor1Set",
              unit_type AS "unit", design_rate_per_quantity AS "designRatePerQuantity"
       FROM design.bill_of_quantity WHERE boq_id = $1`,
      [boqId]
    );
    if (rows.length === 0) return res.json({ success: false, error: 'No material rows found for this BOQ.' });

    // Source header info — needed for the "imported from..." banner and
    // to auto-fill Product Name/Rating on the new BOQ.
    const { rows: [source] } = await pool.query(
      `SELECT project_id AS "sourceProjectId", product_name AS "sourceProductName",
              product_rating AS "sourceProductRating"
       FROM design.boq_drafts WHERE boq_id = $1`,
      [boqId]
    );

    res.json({ success: true, materialRows: rows, ...source });
  } catch (err) {
    console.error('fetchBOQMaterialRowsForImport error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;