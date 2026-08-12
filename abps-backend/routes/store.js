// ═══════════════════════════════════════════════════════════════════════
// routes/store.js — Gate Entry -> GRN -> Q/A pipeline, Rejected
// Material tracking, Store Tickets (outward), Live stock queries.
// Ports: commitGateEntryPipelineStep, fetchInwardWorkflowQueueStream,
//        commitStoreEntryPipelineStep, fetchStoreQAQueue,
//        commitStoreQAPipelineStep, fetchOpenRejectionsForVendor,
//        fetchRejectedMaterialQueue, commitRejectedMaterialAction,
//        submitEngineerMaterialTicket, actionTicketReleaseApproval,
//        fetchPendingTicketsQueueStream, pullLiveInventoryCounts,
//        getSpareStoreStock, getLiveStockForItem
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool, withTransaction } = require('../db');
const { requirePermission } = require('../auth');
const { writeAuditLog } = require('../lib/audit');
const { syncLiveRow } = require('../lib/liveSync');
const { distributeReceiptFIFO, autoAssignStock,
        applyStoreReservationSplit, recordReceiptAttributions, claimStoreForPRN,
        checkReceiptReversible, reverseReceiptAttributions, findAndBorrowForShortfall, claimRawOnlyForPRN } = require('../lib/prnSync');
const { parseVendorInvoice, rescueInvoiceRates, checkGeminiRateLimit, matchStoreEntryItemCodes } = require('../lib/gemini');
const { uploadFile } = require('../lib/drive');

const router = express.Router();

// store_tickets rows reach the frontend in camelCase — ticket cards read
// ticket.ticketId / storeType / ticketType / requestedBy / itemsJson.
const TICKET_SELECT = `SELECT ticket_id AS "ticketId", request_or_return AS "ticketType",
  type_of_store AS "storeType", type_of_store AS "storeTargetScope", project_id AS "projectId",
  job_card_number AS "jobCardNumber", department, requested_returned_by AS "requestedBy",
  status, items, date_created AS "dateCreated",
  date_actioned AS "dateActioned", actioned_by AS "actionedBy", parent_ticket_id AS "parentTicketId"
  FROM store.store_tickets`;

// Resolves to the logged-in user's actual name, never their email — used
// everywhere a *_person / *_by column is stamped. req.body.operatorName
// was the previous source for this, but it's frontend-supplied and
// wasn't reliably wired up, so gate_entry_person/grn_person/qa_person
// etc. were silently falling back to req.user.email every time.
const { displayName } = require('../lib/displayName');

// ── Gate Entry (Step 1 of inward pipeline) ──────────────────────────────
// storeProcessAIInvoiceBlob — extracts header + line items from a
// photographed vendor invoice (+optional challan) to pre-fill the Gate
// Entry form. Extraction only — nothing written to the DB here, the
// operator reviews/corrects before commitGateEntryPipelineStep actually
// saves it, same two-step flow as code.js.
router.post('/storeProcessAIInvoiceBlob', requirePermission('perm_gate_entry'), async (req, res) => {
  const { invoiceBase64, invoiceMimeType, challanBase64, challanMimeType } = req.body;
  if (!invoiceBase64) return res.json({ success: false, error: 'Invoice image is required.' });

  try {
    await checkGeminiRateLimit(pool, req.user.email, 'storeProcessAIInvoiceBlob');
    const extractedData = await parseVendorInvoice(invoiceBase64, invoiceMimeType, challanBase64, challanMimeType);

    // Invoice Rate Rescue — secondary targeted call, only fired for the
    // subset of line items the primary extraction returned a zero rate
    // for (~25% of Gate Entry invoices per the cost sheet). Cheaper than
    // re-running the whole invoice, and non-fatal: if the rescue call
    // itself fails, the operator still gets the original extraction and
    // can correct the zero-rate rows by hand, same as today.
    const zeroRateIdx = (extractedData.lineItems || [])
      .map((li, idx) => ({ li, idx }))
      .filter(({ li }) => !li.ratePerQuantity || Number(li.ratePerQuantity) === 0);
    if (zeroRateIdx.length > 0) {
      try {
        const { rescued } = await rescueInvoiceRates(invoiceBase64, invoiceMimeType, zeroRateIdx.map(({ li }) => li));
        for (const r of (rescued || [])) {
          const target = zeroRateIdx[r.lineIndex];
          if (target && r.ratePerQuantity) {
            extractedData.lineItems[target.idx].ratePerQuantity = r.ratePerQuantity;
            if (r.quantity) extractedData.lineItems[target.idx].quantity = r.quantity;
          }
        }
      } catch (rescueErr) {
        console.error('rescueInvoiceRates failed (non-fatal, zero-rate rows left for manual correction):', rescueErr);
      }
    }

    // Drive upload deliberately does NOT happen here — this route runs on
    // every "Process Documents with AI" click, so if the operator re-selects
    // a clearer image and re-processes, uploading at this step saved every
    // attempt, not just the final one. The image is only persisted once at
    // commitGateEntryPipelineStep (final submit), which already receives
    // the base64 data — see that route.
    res.json({ success: true, extractedData });
  } catch (err) {
    console.error('storeProcessAIInvoiceBlob error:', err);
    const status = err.isRateLimit ? 429 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/commitGateEntryPipelineStep', requirePermission('perm_gate_entry'), async (req, res) => {
  const { metadata, lineItems } = req.body;
  if (!metadata?.vendorName || !lineItems?.length) {
    return res.json({ success: false, error: 'Vendor Name and at least one line item are required.' });
  }
  try {
    // Gate Entry has no dedicated "PO Number" field — po_no is what links
    // this GRN to Expected Deliveries and PPS Tracking (the QA-step credit
    // logic explicitly requires it, see commitStoreQAPipelineStep), and it
    // was never being set at all. Best-effort resolve: if the operator
    // typed the actual PO number into the Invoice Number field (as in
    // testing, where the invoice itself had no separate invoice number),
    // match it against an Authorized PO. If nothing matches, po_no stays
    // NULL and this GRN simply won't be linkable — same as before, not
    // a regression, just no longer silently wrong for the common case.
    // PO number now comes directly from the operator-entered/validated
    // Gate Entry field. The old fallback matched po_no against the
    // vendor's own invoice number — a different identifier entirely —
    // and silently never resolved anything.
    let resolvedPoNo = metadata.poNo || null;
    if (resolvedPoNo) {
      const { rows: [poMatch] } = await pool.query(
        `SELECT po_no FROM purchase.raw_material_purchase_orders WHERE po_no = $1 AND status = 'Authorized'`,
        [resolvedPoNo]
      );
      if (!poMatch) resolvedPoNo = null; // typo'd/unauthorized PO — don't save a bad reference
    }
    // Gate Number is generated server-side, same as code.js's original
    // "GT-" + 6 random digits — the frontend's payload never included
    // one, and this route never generated one either, so every
    // submission was failing its own validation before anything got written.
    const gateNumber = 'GT-' + Math.floor(100000 + Math.random() * 900000);

    // Images are uploaded/saved HERE, and only here — this is the actual
    // final submit, not the AI-process step. If the operator re-selected a
    // clearer image and re-ran "Process Documents with AI" several times
    // before submitting, only whatever was attached at THIS moment gets
    // persisted; earlier attempts were never uploaded at all.
    const fileTag = metadata.invoiceNumber || metadata.vendorName || `gate_${Date.now()}`;
    let invoiceUrl = null, challanUrl = null;
    try {
      if (metadata.invoiceImageBase64Raw && process.env.INVOICE_FOLDER_ID) {
        const buf = Buffer.from(metadata.invoiceImageBase64Raw, 'base64');
        const uploaded = await uploadFile(process.env.INVOICE_FOLDER_ID, buf, `${fileTag}_invoice.jpg`, 'image/jpeg');
        invoiceUrl = uploaded.url;
      }
      if (metadata.challanImageBase64Raw && process.env.CHALLAN_FOLDER_ID) {
        const buf = Buffer.from(metadata.challanImageBase64Raw, 'base64');
        const uploaded = await uploadFile(process.env.CHALLAN_FOLDER_ID, buf, `${fileTag}_challan.jpg`, 'image/jpeg');
        challanUrl = uploaded.url;
      }
    } catch (driveErr) {
      console.error('Invoice/challan image upload failed (non-fatal, gate entry still saves):', driveErr);
    }
    const driveImageUrl = [invoiceUrl, challanUrl].filter(Boolean).join(', ') || null;

    const rows = await withTransaction(async (client) => {
      const inserted = [];
      for (const item of lineItems) {
        // item_code has a foreign-key constraint against design.item_codes —
        // an unmatched invoice row correctly extracts as empty string (no
        // ABPS code was actually printed on it), but an empty string isn't
        // a valid FK value and isn't NULL either. Coerce blank to NULL.
        const { rows: [row] } = await client.query(
          `INSERT INTO store.inbound_store_ledger
             (transaction_status, vendor_name, invoice_number, challan_number_desc, item_code, material_name,
              invoice_description, unit_type, quantity_received, missing_quantity, rate_per_quantity, gst_percent,
              gate_entry_person, gate_number, po_no, drive_image_url)
           VALUES ('Gate Entered',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING ledger_id`,
          [metadata.vendorName, metadata.invoiceNumber, metadata.challanNumber, item.itemCode || null, item.materialName,
           item.rawDescriptionLine || null, item.unitType, item.gateQuantity, item.transitRejected || 0,
           item.ratePerQuantity, item.gstPercent || 18, displayName(req),
           gateNumber, resolvedPoNo, driveImageUrl]
        );
        inserted.push(row.ledger_id);
      }
      return inserted;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'InboundStoreLedger', 'GATE_ENTRY', gateNumber,
      `Gate entry recorded for ${lineItems.length} items from vendor "${metadata.vendorName}".`);
    rows.forEach(ledgerId => syncLiveRow('inbound_store_ledger', ledgerId));
    res.json({ success: true, gateNumber, ledgerIds: rows });
  } catch (err) {
    console.error('commitGateEntryPipelineStep error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/validateGatePONumber', requirePermission('perm_gate_entry'), async (req, res) => {
  const { poNo } = req.body;
  try {
    const { rows: [po] } = await pool.query(
      `SELECT po_no, vendor_name FROM purchase.raw_material_purchase_orders WHERE po_no = $1 AND status = 'Authorized'`,
      [(poNo || '').trim()]
    );
    res.json({ success: true, found: !!po, vendorName: po ? po.vendor_name : null });
  } catch (err) {
    console.error('validateGatePONumber error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Groups gate-entered rows by Gate Number for the Store Entry (GRN) queue.
router.post('/fetchInwardWorkflowQueueStream', async (req, res) => {
  const { targetStep } = req.body; // 'Gate Entered' | 'GRN Done' | etc.
  try {
    // ledgerId is now included and ordered deterministically — Store Entry's
    // resolved item code/material name per line needs a stable way to be
    // matched back to its exact ledger row on submit (see
    // commitStoreEntryPipelineStep). json_agg has no guaranteed internal
    // order without an explicit ORDER BY inside it either.
    const { rows } = await pool.query(
      `SELECT gate_number AS "gateNumber", vendor_name AS "vendorName", invoice_number AS "invoiceNumber",
              challan_number_desc AS "challanNumber", ts AS "invoiceDate", MAX(po_no) AS "poNo",
              json_agg(json_build_object(
                'ledgerId', ledger_id, 'itemCode', item_code, 'materialName', material_name,
                'invoiceDescription', invoice_description,
                'gateQuantity', quantity_received, 'transitRejected', missing_quantity,
                'ratePerQuantity', rate_per_quantity, 'gstPercent', gst_percent, 'unitType', unit_type
              ) ORDER BY ledger_id) AS "lineItems"
       FROM store.inbound_store_ledger
       WHERE transaction_status = $1
       GROUP BY gate_number, vendor_name, invoice_number, challan_number_desc, ts`,
      [targetStep || 'Gate Entered']
    );
    res.json({ success: true, queue: rows });
  } catch (err) {
    console.error('fetchInwardWorkflowQueueStream error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Store Entry / GRN (Step 2) ──────────────────────────────────────────
// Generates GRN number, moves matched gate-entry rows to 'GRN Done', and
// ensures each item_code exists in raw_material_store — same as
// ensureMaterialsInInventory in code.js. Transactional: GRN number
// generation + status update + inventory upsert all succeed together.
router.post('/commitStoreEntryPipelineStep', requirePermission('perm_store_entry_and_grn'), async (req, res) => {
  const { payload } = req.body;
  if (!payload?.gateNumber) return res.json({ success: false, error: 'Gate Number is required.' });
  const resolvedLines = payload.lineItems || [];
  const newResolvedRejectionIds = [];

  // PO Number is mandatory here — QA silently skips crediting
  // prn_line_items/pps_tracking when the ledger row has no po_no.
  const poNo = (payload.poNo || '').toString().trim();
  if (!poNo) return res.json({ success: false, error: 'PO Number is required before GRN can be generated.' });
  const { rows: [poCheck] } = await pool.query(
    `SELECT po_no FROM purchase.raw_material_purchase_orders WHERE po_no = $1 AND status = 'Authorized'`,
    [poNo]
  );
  if (!poCheck) return res.json({ success: false, error: `PO Number "${poNo}" was not found as an Authorized Purchase Order.` });

  try {
    const grnNumber = await withTransaction(async (client) => {
      const grnNumber = 'GRN-' + Date.now().toString(36).toUpperCase();

      // Bulk status flip first (matches every Gate Entered row for this
      // gate number, same as before).
      const { rows: affectedIds } = await client.query(
        `UPDATE store.inbound_store_ledger
         SET transaction_status = 'GRN Done', grn_person = $1, grn_number = $2
         WHERE gate_number = $3 AND transaction_status = 'Gate Entered'
         RETURNING ledger_id`,
        [displayName(req), grnNumber, payload.gateNumber]
      );
      if (affectedIds.length === 0) throw new Error('No matching gate-entered items found for this Gate Number.');

      // Apply the operator's resolved item code / material name / rate /
      // GST per specific row — THIS was missing entirely before: the bulk
      // UPDATE above only ever touched status/grn fields, so whatever
      // Store Entry resolved on screen was silently discarded and every
      // row downstream (QA, Master Inventory) kept Gate Entry's original
      // (often NULL) values. Matched by ledgerId, not position, so a
      // mismatched line order can't silently write the wrong row.
      const byLedgerId = new Map(resolvedLines.filter(l => l.ledgerId).map(l => [String(l.ledgerId), l]));
      const applied = [];
      for (const { ledger_id } of affectedIds) {
        const resolved = byLedgerId.get(String(ledger_id));
        if (!resolved) continue; // no matching resolved line — leave as-is rather than guess
        // total_basic_amount / total_invoice_amount_incl_gst were never
        // computed anywhere — set them here. type_of_material is pulled
        // from design.item_codes (authoritative source, not AI-guessed)
        // once the item code is actually resolved.
        //
        // Quantity source is verifiedPhysicalQuantity — the frontend's
        // "Received Qty" input captures edits into THAT field name, not
        // gateQuantity (gateQuantity is only ever the original, unedited
        // invoice/gate quantity). Using gateQuantity here meant any
        // correction the operator made to the received quantity on this
        // screen was captured by the frontend, sent to the backend, and
        // then silently discarded — quantity_received in the ledger
        // never changed, so QA (which reads quantity_received directly)
        // kept showing the original invoice quantity instead.
        const gstPct = resolved.gstPercent || 18;
        const receivedQty = resolved.verifiedPhysicalQuantity ?? resolved.gateQuantity ?? 0;
        // Shortfall between what the invoice/gate said arrived and what the
        // operator actually counted here — this is the ONLY point in the
        // pipeline that knows both numbers, so it's the only place that can
        // compute it. Never negative: an upward correction isn't "missing".
        const originalGateQty = Number(resolved.gateQuantity) || 0;
        const missingQty = Math.max(0, originalGateQty - receivedQty);
        const basicAmt = receivedQty * (resolved.ratePerQuantity || 0);
        const { rows: [row] } = await client.query(
          `UPDATE store.inbound_store_ledger
           SET item_code = $1, material_name = $2, unit_type = $3,
               rate_per_quantity = $4, gst_percent = $5,
               type_of_material = (SELECT type_of_material FROM design.item_codes WHERE item_code = $1),
               total_basic_amount = $6, total_invoice_amount_incl_gst = $7,
               quantity_received = $8, po_no = $9, missing_quantity = $10
           WHERE ledger_id = $11
           RETURNING item_code, material_name, unit_type, rate_per_quantity`,
          [resolved.itemCode || null, resolved.materialName || null, resolved.unitType || 'NOS',
           resolved.ratePerQuantity || 0, gstPct, basicAmt, basicAmt * (1 + gstPct / 100), receivedQty, poNo, missingQty, ledger_id]
        );
        applied.push(row);

        if (resolved.resolvesRejectionId) {
          const linkedQty = Number(resolved.resolvedQuantity) || 0;
          const { rows: [rej] } = await client.query(
            `SELECT pending_quantity FROM store.rejected_missing_material_tracking WHERE rejection_id = $1 FOR UPDATE`,
            [resolved.resolvesRejectionId]
          );
          if (rej) {
            const remaining = Math.max(0, Number(rej.pending_quantity) - linkedQty);
            await client.query(
              `UPDATE store.rejected_missing_material_tracking
               SET pending_quantity = $1,
                   status = CASE WHEN $1 = 0 THEN 'Resolved' ELSE status END,
                   resolved_timestamp = CASE WHEN $1 = 0 THEN now() ELSE resolved_timestamp END
               WHERE rejection_id = $2`,
              [remaining, resolved.resolvesRejectionId]
            );
            newResolvedRejectionIds.push(resolved.resolvesRejectionId);
          }
        }
      }

      for (const row of applied) {
        // Rows can legitimately still have item_code = NULL — an invoice
        // line the operator couldn't resolve to an ABPS code even
        // manually. Those need a person to assign a code later before
        // they can be tracked in inventory at all; skip rather than
        // violate raw_material_store's NOT NULL constraint on item_code.
        if (!row.item_code) continue;
        await client.query(
          `INSERT INTO store.raw_material_store
             (item_code, material_name, total_stock, unit_type, latest_rate_per_quantity, type_of_material)
           VALUES ($1, $2, 0, $3, $4, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
           ON CONFLICT (item_code) DO UPDATE
             SET latest_rate_per_quantity = EXCLUDED.latest_rate_per_quantity
           WHERE store.raw_material_store.latest_rate_per_quantity IS DISTINCT FROM EXCLUDED.latest_rate_per_quantity`,
          [row.item_code, row.material_name, row.unit_type, row.rate_per_quantity]
        );
        // A brand-new material needs a Spare Store bin to exist too, even
        // at zero — otherwise the first time anyone tries to view/transfer
        // spare stock for it, there's simply no row. Created once, at
        // whichever point first introduces the item code; a no-op for
        // materials that already have one.
        await client.query(
          `INSERT INTO store.spare_store
             (item_code, material_name, total_stock, unit_type, type_of_material)
           VALUES ($1, $2, 0, $3, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
           ON CONFLICT (item_code) DO NOTHING`,
          [row.item_code, row.material_name, row.unit_type]
        );
      }
      return grnNumber;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'InboundStoreLedger', 'GRN', grnNumber,
      `GRN generated for Gate Number ${payload.gateNumber}.`);
    newResolvedRejectionIds.forEach(id => syncLiveRow('rejected_missing_material_tracking', id));
    res.json({ success: true, grnNumber });
  } catch (err) {
    console.error('commitStoreEntryPipelineStep error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Q/A Check (Step 3) ────────────────────────────────────────────────
router.post('/fetchStoreQAQueue', requirePermission('perm_qa_check'), async (req, res) => {
  const { toggle } = req.body; // 'pending' | 'repair'

  if (toggle === 'repair') {
    // Repair queue reads from rejected_missing_material_tracking (items sent
    // "At ABPS - Under Repair"), not the inbound ledger — a distinct
    // data source from the standard GRN-based QA queue below.
    try {
      const { rows } = await pool.query(
        `SELECT grn_number AS "grnNumber", vendor_name AS "vendorName", MIN(set_timestamp) AS "invoiceDate",
                json_agg(json_build_object(
                  'rejectionId', rejection_id, 'itemCode', item_code, 'materialName', material_name,
                  'unitType', unit_type, 'outstandingQty', pending_quantity,
                  'notOkQuantity', not_ok_quantity, 'action', action_for_rejected_material
                )) AS "lineItems"
         FROM store.rejected_missing_material_tracking
         WHERE status = 'At ABPS - Under Repair'
         GROUP BY grn_number, vendor_name`
      );
      return res.json({ success: true, queue: rows });
    } catch (err) {
      console.error('fetchStoreQAQueue (repair) error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  const statusFilter = 'GRN Done';
  try {
    const { rows } = await pool.query(
      `SELECT grn_number AS "grnNumber", vendor_name AS "vendorName", invoice_number AS "invoiceNumber", MIN(ts) AS "invoiceDate",
              json_agg(json_build_object(
                'ledgerId', ledger_id, 'itemCode', item_code, 'materialName', material_name,
                'invoiceDescription', invoice_description,
                'unitType', unit_type, 'quantityReceived', quantity_received,
                'missingQuantity', missing_quantity
              ) ORDER BY ledger_id) AS "lineItems"
       FROM store.inbound_store_ledger
       WHERE transaction_status = $1
       GROUP BY grn_number, vendor_name, invoice_number`,
      [statusFilter]
    );
    res.json({ success: true, queue: rows });
  } catch (err) {
    console.error('fetchStoreQAQueue error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// commitStoreQAPipelineStep — F0 compulsory-action validation runs BEFORE
// any write. On pass, updates raw_material_store.total_stock for OK
// quantity and opens a rejected_missing_material_tracking row for any
// Not OK or Missing quantity — one transaction.
router.post('/commitStoreQAPipelineStep', requirePermission('perm_qa_check'), async (req, res) => {
  const { payload } = req.body;
  const items = payload?.lineItems || [];
  if (!payload?.grnNumber || items.length === 0) {
    return res.json({ success: false, error: 'GRN Number and line items are required.' });
  }

  // F0 — validate before any writes
  for (const item of items) {
    const notOkQty = parseFloat(item.notOkQuantity) || 0;
    if (notOkQty > 0 && !(item.actionForRejectedMaterial || '').toString().trim()) {
      return res.json({ success: false, error: `Action for Rejected Material is required for item ${item.itemCode} — it has ${notOkQty} Not OK units.` });
    }
    const received = parseFloat(item.quantityReceived) || 0;
    if ((parseFloat(item.okQuantity) || 0) + notOkQty !== received) {
      return res.json({ success: false, error: `Quantity mismatch for ${item.itemCode}: OK + Not OK must equal Received Quantity.` });
    }
  }

  try {
    const newRejectionIds = [];
    const newStockAssignmentIds = [];
    await withTransaction(async (client) => {
      for (const item of items) {
        const okQty = parseFloat(item.okQuantity) || 0;
        const notOkQty = parseFloat(item.notOkQuantity) || 0;

        await client.query(
          `UPDATE store.inbound_store_ledger
           SET transaction_status = 'QA Passed', ok_quantity = $1, not_ok_quantity = $2,
               reason_for_not_ok = $3, action_for_rejected_material = $4, qa_person = $5, qa_timestamp = now()
           WHERE ledger_id = $6`,
          [okQty, notOkQty, item.reasonForNotOk, item.actionForRejectedMaterial, displayName(req), item.ledgerId]
        );

        if (okQty > 0) {
          // Upsert, not a plain UPDATE — if this item code somehow has no
          // raw_material_store row yet at QA time (Store Entry's own upsert
          // should normally have created it, but this is the actual point
          // where real stock exists, so it shouldn't silently depend on
          // that having already happened), the row gets created here with
          // okQty as its starting stock instead of the credit vanishing
          // into a 0-row UPDATE.
          await client.query(
            `INSERT INTO store.raw_material_store (item_code, material_name, total_stock, unit_type, type_of_material)
             VALUES ($1, $2, $3, $4, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
             ON CONFLICT (item_code) DO UPDATE
               SET total_stock = store.raw_material_store.total_stock + EXCLUDED.total_stock`,
            [item.itemCode, item.materialName || null, okQty, item.unitType || 'NOS']
          );
          await client.query(
            `INSERT INTO store.spare_store
               (item_code, material_name, total_stock, unit_type, type_of_material)
             VALUES ($1, $2, 0, $3, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
             ON CONFLICT (item_code) DO NOTHING`,
            [item.itemCode, item.materialName || null, item.unitType || 'NOS']
          );

          // PPS Tracking auto-update — material physically arrived, so
          // record actual delivery date/quantity against the PO that
          // ordered it (linked via the ledger row's po_no, captured at
          // Gate Entry). Best-effort: not every GRN traces back to a
          // tracked PO (e.g. legacy/manual entries without po_no).
          // Credit the PRNs this material was ordered for. No longer
          // best-effort: pps_tracking is the allocation record that PRN
          // closure and the revision queue read, so silently skipping it
          // would leave a PRN permanently short on paper while the stock
          // sits on the shelf. A GRN with no po_no (manual/legacy entry)
          // simply has nothing to credit and all of it stays free.
          const { rows: [ledgerRow] } = await client.query(
            `SELECT po_no FROM store.inbound_store_ledger WHERE ledger_id = $1`, [item.ledgerId]
          );
          const attrCtx = { eventType: 'QA', ledgerId: item.ledgerId, grnNumber: payload.grnNumber,
                            itemCode: item.itemCode, poNo: ledgerRow?.po_no || null, createdBy: displayName(req) };
          let excessQty = okQty;
          if (ledgerRow?.po_no) {
            const { credited, excess } = await distributeReceiptFIFO(client, ledgerRow.po_no, item.itemCode, okQty);
            excessQty = excess;
            // still_to_order_quantity was already zeroed for these PRNs at
            // PO authorization — reserve+assign directly, don't re-touch it.
            const creditAttrs = [];
            for (const c of credited) {
              // Same claim mechanism as every other path — records the
              // spare/raw split so this can later be unassigned or reversed.
              const id = await claimStoreForPRN(client, c.prnId, item.itemCode, item.materialName, c.quantity, displayName(req));
              if (id) newStockAssignmentIds.push(id);
              creditAttrs.push({ prnId: c.prnId, kind: 'po_credit', quantity: c.quantity, assignmentId: id });
            }
            await recordReceiptAttributions(client, attrCtx, creditAttrs);
          }

          // Leftover with no specific PO/PRN tie goes through generic FIFO.
          const { assignmentIds, assigned, unassigned } = await autoAssignStock(client, item.itemCode, item.materialName, excessQty, req.user.email);
          newStockAssignmentIds.push(...assignmentIds);
          await recordReceiptAttributions(client, attrCtx, [
            ...assigned.map(a => ({ prnId: a.prnId, kind: 'auto_assign', quantity: a.quantity, assignmentId: a.assignmentId })),
            { prnId: null, kind: 'free_stock', quantity: unassigned },
          ]);
        }

        const { rows: [existingRej] } = await client.query(
          `SELECT rejection_id, not_ok_quantity, pending_quantity, status FROM store.rejected_missing_material_tracking
           WHERE grn_number = $1 AND item_code = $2 AND not_ok_quantity > 0 FOR UPDATE`,
          [payload.grnNumber, item.itemCode]
        );
        if (existingRej) {
          if (notOkQty > 0) {
            const delta = notOkQty - Number(existingRej.not_ok_quantity);
            const newPending = Math.max(0, Number(existingRej.pending_quantity) + delta);
            await client.query(
              `UPDATE store.rejected_missing_material_tracking
               SET not_ok_quantity = $1, pending_quantity = $2, reason_for_not_ok = $3,
                   action_for_rejected_material = $4,
                   status = CASE WHEN $2 = 0 THEN 'Resolved' ELSE status END,
                   resolved_timestamp = CASE WHEN $2 = 0 THEN now() ELSE resolved_timestamp END
               WHERE rejection_id = $5`,
              [notOkQty, newPending, item.reasonForNotOk, item.actionForRejectedMaterial, existingRej.rejection_id]
            );
            newRejectionIds.push(existingRej.rejection_id);
          } else if (Number(existingRej.pending_quantity) === Number(existingRej.not_ok_quantity) && existingRej.status === 'Open') {
            await client.query(`DELETE FROM store.rejected_missing_material_tracking WHERE rejection_id = $1`, [existingRej.rejection_id]);
          }
        } else if (notOkQty > 0) {
          const { rows: [rejRow] } = await client.query(
            `INSERT INTO store.rejected_missing_material_tracking
               (grn_number, item_code, material_name, unit_type, vendor_name, not_ok_quantity, pending_quantity,
                reason_for_not_ok, action_for_rejected_material, status, set_by_store)
             VALUES ($1,$2,$3,$4,(SELECT vendor_name FROM store.inbound_store_ledger WHERE ledger_id = $5),
                     $6,$6,$7,$8,'Open',$9)
             RETURNING rejection_id`,
            [payload.grnNumber, item.itemCode, item.materialName, item.unitType, item.ledgerId,
             notOkQty, item.reasonForNotOk, item.actionForRejectedMaterial, displayName(req)]
          );
          newRejectionIds.push(rejRow.rejection_id);
        }
        const missingQty = Number(item.missingQuantity) || 0;
        if (missingQty > 0) {
          const { rows: [missRow] } = await client.query(
            `INSERT INTO store.rejected_missing_material_tracking
               (grn_number, item_code, material_name, unit_type, vendor_name, missing_quantity, pending_quantity,
                status, set_by_store)
             VALUES ($1,$2,$3,$4,(SELECT vendor_name FROM store.inbound_store_ledger WHERE ledger_id = $5),
                     $6,$6,'Open',$7)
             RETURNING rejection_id`,
            [payload.grnNumber, item.itemCode, item.materialName, item.unitType, item.ledgerId,
             missingQty, displayName(req)]
          );
          newRejectionIds.push(missRow.rejection_id);
        }
      }
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'InboundStoreLedger', 'QA_CHECK', payload.grnNumber,
      `Q/A completed for GRN ${payload.grnNumber} — ${items.length} items processed.`);
    items.forEach(item => {
      syncLiveRow('inbound_store_ledger', item.ledgerId);
      syncLiveRow('raw_material_store', item.itemCode);
    });
    newRejectionIds.forEach(id => syncLiveRow('rejected_missing_material_tracking', id));
    newStockAssignmentIds.forEach(id => syncLiveRow('stock_reservations', id));
    res.json({ success: true });
  } catch (err) {
    console.error('commitStoreQAPipelineStep error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── QA Revision ────────────────────────────────────────────────────────
router.post('/fetchQARevisionSearch', requirePermission('perm_qa_check'), async (req, res) => {
  const { grnNumber, vendorName, productName, qaDateFrom, qaDateTo } = req.body;
  try {
    const clauses = [`transaction_status = 'QA Passed'`];
    const params = [];
    let i = 1;
    if (grnNumber)   { clauses.push(`grn_number ILIKE $${i++}`); params.push(`%${grnNumber}%`); }
    if (vendorName)  { clauses.push(`vendor_name = $${i++}`); params.push(vendorName); }
    if (productName) { clauses.push(`(material_name ILIKE $${i} OR item_code ILIKE $${i})`); params.push(`%${productName}%`); i++; }
    if (qaDateFrom)  { clauses.push(`qa_timestamp >= $${i++}`); params.push(qaDateFrom); }
    if (qaDateTo)    { clauses.push(`qa_timestamp < ($${i++}::date + 1)`); params.push(qaDateTo); }

    const { rows } = await pool.query(
      `SELECT grn_number AS "grnNumber", vendor_name AS "vendorName", MAX(po_no) AS "poNo",
              MIN(qa_timestamp) AS "qaTimestamp", MAX(qa_person) AS "qaPerson", COUNT(*) AS "lineCount"
       FROM store.inbound_store_ledger
       WHERE ${clauses.join(' AND ')}
       GROUP BY grn_number, vendor_name
       ORDER BY MIN(qa_timestamp) DESC LIMIT 100`,
      params
    );
    res.json({ success: true, results: rows });
  } catch (err) {
    console.error('fetchQARevisionSearch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchQARevisionDetail', requirePermission('perm_qa_check'), async (req, res) => {
  const { grnNumber } = req.body;
  try {
    const { rows: lines } = await pool.query(
      `SELECT ledger_id AS "ledgerId", item_code AS "itemCode", material_name AS "materialName",
              invoice_description AS "invoiceDescription", unit_type AS "unitType",
              quantity_received AS "quantityReceived", ok_quantity AS "okQuantity",
              not_ok_quantity AS "notOkQuantity", reason_for_not_ok AS "reasonForNotOk",
              action_for_rejected_material AS "actionForRejectedMaterial"
       FROM store.inbound_store_ledger
       WHERE grn_number = $1 AND transaction_status = 'QA Passed' ORDER BY ledger_id`,
      [grnNumber]
    );
    if (lines.length === 0) return res.json({ success: false, error: 'No QA-passed lines found for this GRN.' });

    const blockers = [];
    for (const line of lines) {
      const { rows: attrs } = await pool.query(
        `SELECT * FROM store.receipt_attributions WHERE ledger_id = $1 AND reversed = FALSE`, [line.ledgerId]
      );
      if (attrs.length === 0 && Number(line.okQuantity) > 0) {
        blockers.push(`${line.itemCode}: QA'd before attribution tracking existed — not revisable.`);
        continue;
      }
      const client = await pool.connect();
      try { blockers.push(...await checkReceiptReversible(client, attrs)); } finally { client.release(); }

      const { rows: [rej] } = await pool.query(
        `SELECT status, pending_quantity, not_ok_quantity FROM store.rejected_missing_material_tracking
         WHERE grn_number = $1 AND item_code = $2 AND not_ok_quantity > 0`, [grnNumber, line.itemCode]
      );
      if (rej && rej.status === 'Resolved') {
        blockers.push(`${line.itemCode}: its rejection is already Resolved — the GRN is closed for this item.`);
      }
    }
    res.json({ success: true, grnNumber, lineItems: lines, blockers });
  } catch (err) {
    console.error('fetchQARevisionDetail error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/commitQARevision', requirePermission('perm_qa_check'), async (req, res) => {
  const { payload } = req.body;
  const items = payload?.lineItems || [];
  if (!payload?.grnNumber || items.length === 0) return res.json({ success: false, error: 'GRN Number and line items are required.' });

  for (const item of items) {
    const ok = parseFloat(item.okQuantity) || 0, notOk = parseFloat(item.notOkQuantity) || 0;
    if (Math.abs((ok + notOk) - (parseFloat(item.quantityReceived) || 0)) > 0.001) {
      return res.json({ success: false, error: `OK + Not OK must equal Received for ${item.itemCode}.` });
    }
    if (notOk > 0 && !item.actionForRejectedMaterial) {
      return res.json({ success: false, error: `Action for Rejected Material is required for ${item.itemCode}.` });
    }
  }

  try {
    const newRejectionIds = [], newStockAssignmentIds = [], touchedItemCodes = new Set();
    await withTransaction(async (client) => {
      for (const item of items) {
        const { rows: [prev] } = await client.query(
          `SELECT item_code, ok_quantity, po_no FROM store.inbound_store_ledger WHERE ledger_id = $1 FOR UPDATE`,
          [item.ledgerId]
        );
        if (!prev) throw new Error(`Ledger row ${item.ledgerId} not found.`);

        const { rows: attrs } = await client.query(
          `SELECT * FROM store.receipt_attributions WHERE ledger_id = $1 AND reversed = FALSE FOR UPDATE`,
          [item.ledgerId]
        );
        const blockers = await checkReceiptReversible(client, attrs);
        if (blockers.length) throw new Error(`Cannot revise: ${blockers.join(' ')}`);

        // 1. Undo the original event completely.
        await reverseReceiptAttributions(client, attrs);
        await client.query(
          `UPDATE store.raw_material_store SET total_stock = GREATEST(0, total_stock - $1) WHERE item_code = $2`,
          [Number(prev.ok_quantity) || 0, prev.item_code]
        );
        const { rows: [existingRej] } = await client.query(
          `SELECT rejection_id, not_ok_quantity, pending_quantity, status FROM store.rejected_missing_material_tracking
           WHERE grn_number = $1 AND item_code = $2 AND not_ok_quantity > 0 FOR UPDATE`,
          [payload.grnNumber, prev.item_code]
        );
        if (existingRej && existingRej.status === 'Resolved') {
          throw new Error(`${prev.item_code}: rejection is already Resolved — cannot revise.`);
        }
        touchedItemCodes.add(prev.item_code);
        touchedItemCodes.add(item.itemCode);

        // 2. Re-apply with the corrected values, exactly as a fresh QA would.
        const okQty = parseFloat(item.okQuantity) || 0, notOkQty = parseFloat(item.notOkQuantity) || 0;
        await client.query(
          `UPDATE store.inbound_store_ledger
           SET item_code = $1, material_name = $2, invoice_description = $3, unit_type = $4,
               ok_quantity = $5, not_ok_quantity = $6, reason_for_not_ok = $7,
               action_for_rejected_material = $8, qa_person = $9, qa_timestamp = now(),
               type_of_material = (SELECT type_of_material FROM design.item_codes WHERE item_code = $1)
           WHERE ledger_id = $10`,
          [item.itemCode, item.materialName, item.invoiceDescription || null, item.unitType,
           okQty, notOkQty, item.reasonForNotOk || null, item.actionForRejectedMaterial || null,
           displayName(req), item.ledgerId]
        );

        if (okQty > 0) {
          await client.query(
            `INSERT INTO store.raw_material_store (item_code, material_name, total_stock, unit_type, type_of_material)
             VALUES ($1, $2, $3, $4, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
             ON CONFLICT (item_code) DO UPDATE
               SET total_stock = store.raw_material_store.total_stock + EXCLUDED.total_stock`,
            [item.itemCode, item.materialName || null, okQty, item.unitType || 'NOS']
          );
          await client.query(
            `INSERT INTO store.spare_store
               (item_code, material_name, total_stock, unit_type, type_of_material)
             VALUES ($1, $2, 0, $3, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
             ON CONFLICT (item_code) DO NOTHING`,
            [item.itemCode, item.materialName || null, item.unitType || 'NOS']
          );
          const attrCtx = { eventType: 'QA', ledgerId: item.ledgerId, grnNumber: payload.grnNumber,
                            itemCode: item.itemCode, poNo: prev.po_no || null, createdBy: displayName(req) };
          let excessQty = okQty;
          if (prev.po_no) {
            const { credited, excess } = await distributeReceiptFIFO(client, prev.po_no, item.itemCode, okQty);
            excessQty = excess;
            await recordReceiptAttributions(client, attrCtx,
              credited.map(c => ({ prnId: c.prnId, kind: 'po_credit', quantity: c.quantity })));
          }
          const { assignmentIds, assigned, unassigned } = await autoAssignStock(client, item.itemCode, item.materialName, excessQty, req.user.email);
          newStockAssignmentIds.push(...assignmentIds);
          await recordReceiptAttributions(client, attrCtx, [
            ...assigned.map(a => ({ prnId: a.prnId, kind: 'auto_assign', quantity: a.quantity, assignmentId: a.assignmentId })),
            { prnId: null, kind: 'free_stock', quantity: unassigned },
          ]);
        }

        if (existingRej) {
          if (notOkQty > 0) {
            const delta = notOkQty - Number(existingRej.not_ok_quantity);
            const newPending = Math.max(0, Number(existingRej.pending_quantity) + delta);
            await client.query(
              `UPDATE store.rejected_missing_material_tracking
               SET not_ok_quantity = $1, pending_quantity = $2, reason_for_not_ok = $3,
                   action_for_rejected_material = $4,
                   status = CASE WHEN $2 = 0 THEN 'Resolved' ELSE status END,
                   resolved_timestamp = CASE WHEN $2 = 0 THEN now() ELSE resolved_timestamp END
               WHERE rejection_id = $5`,
              [notOkQty, newPending, item.reasonForNotOk, item.actionForRejectedMaterial, existingRej.rejection_id]
            );
            newRejectionIds.push(existingRej.rejection_id);
          } else if (Number(existingRej.pending_quantity) === Number(existingRej.not_ok_quantity) && existingRej.status === 'Open') {
            await client.query(`DELETE FROM store.rejected_missing_material_tracking WHERE rejection_id = $1`, [existingRej.rejection_id]);
          }
        } else if (notOkQty > 0) {
          const { rows: [rejRow] } = await client.query(
            `INSERT INTO store.rejected_missing_material_tracking
               (grn_number, item_code, material_name, unit_type, vendor_name, not_ok_quantity, pending_quantity,
                reason_for_not_ok, action_for_rejected_material, status, set_by_store)
             VALUES ($1,$2,$3,$4,(SELECT vendor_name FROM store.inbound_store_ledger WHERE ledger_id = $5),
                     $6,$6,$7,$8,'Open',$9)
             RETURNING rejection_id`,
            [payload.grnNumber, item.itemCode, item.materialName, item.unitType, item.ledgerId,
             notOkQty, item.reasonForNotOk, item.actionForRejectedMaterial, displayName(req)]
          );
          newRejectionIds.push(rejRow.rejection_id);
        }
        const missingQty = Number(item.missingQuantity) || 0;
        if (missingQty > 0) {
          // Never arrived at the gate at all — vendor always replaces it,
          // no repair/return decision to make. Sits Open until a fresh
          // Gate Entry against the same PO resolves it via resolvesRejectionId.
          const { rows: [rejRow] } = await client.query(
            `INSERT INTO store.rejected_missing_material_tracking
               (grn_number, item_code, material_name, unit_type, vendor_name, missing_quantity, pending_quantity,
                status, set_by_store)
             VALUES ($1,$2,$3,$4,(SELECT vendor_name FROM store.inbound_store_ledger WHERE ledger_id = $5),
                     $6,$6,'Open',$7)
             RETURNING rejection_id`,
            [payload.grnNumber, item.itemCode, item.materialName, item.unitType, item.ledgerId,
             missingQty, displayName(req)]
          );
          newRejectionIds.push(rejRow.rejection_id);
        }
      }
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'InboundStoreLedger', 'QA_CHECK', payload.grnNumber,
      `Q/A completed for GRN ${payload.grnNumber} — ${items.length} items processed.`);
    items.forEach(item => {
      syncLiveRow('inbound_store_ledger', item.ledgerId);
      syncLiveRow('raw_material_store', item.itemCode);
    });
    newRejectionIds.forEach(id => syncLiveRow('rejected_missing_material_tracking', id));
    newStockAssignmentIds.forEach(id => syncLiveRow('stock_reservations', id));
    res.json({ success: true });
  } catch (err) {
    console.error('commitQARevision error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Rejected Material ────────────────────────────────────────────────

router.post('/fetchOpenRejectionsForVendor', requirePermission('perm_gate_entry'), async (req, res) => {
  const { vendorName } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT rejection_id AS "rejectionId", grn_number AS "grnNumber", item_code AS "itemCode",
              material_name AS "materialName", unit_type AS "unitType", not_ok_quantity AS "notOkQuantity",
              pending_quantity AS "outstandingQuantity", reason_for_not_ok AS "reasonForNotOk",
              action_for_rejected_material AS "action", status, set_timestamp AS "setTimestamp"
       FROM store.rejected_missing_material_tracking WHERE vendor_name = $1 AND status != 'Resolved' ORDER BY set_timestamp DESC`,
      [vendorName]
    );
    res.json({ success: true, rejections: rows });
  } catch (err) {
    console.error('fetchOpenRejectionsForVendor error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchVendorNamesForRejectedMaterial', requirePermission('perm_store_inward_rejected'), async (req, res) => {
  const { query } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT vendor_name FROM purchase.vendor_information WHERE vendor_name ILIKE $1 ORDER BY vendor_name LIMIT 10`,
      [`%${(query || '').trim()}%`]
    );
    res.json({ success: true, vendors: rows.map(r => r.vendor_name) });
  } catch (err) {
    console.error('searchVendorNamesForRejectedMaterial error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchRejectedMaterialQueue', requirePermission('perm_store_inward_rejected'), async (req, res) => {
  const { toggle, vendorName, actions } = req.body;
  try {
    const clauses = ['1=1'];
    const params = [];
    let i = 1;
    if (toggle === 'completed') { clauses.push(`status <> 'Open'`); }
    else if (toggle === 'pending' || !toggle) { clauses.push(`status = 'Open'`); }
    if (vendorName) { clauses.push(`vendor_name = $${i++}`); params.push(vendorName); }
    if (Array.isArray(actions) && actions.length > 0) { clauses.push(`action_for_rejected_material = ANY($${i++})`); params.push(actions); }
    // Grouped by GRN into cards — the frontend expects one card per GRN
    // with a lineItems[] array (item.lineItems.forEach(...)), same shape
    // as the QA queue. This was returning flat ungrouped rows instead,
    // so item.lineItems was undefined on every row.
    const { rows } = await pool.query(
      `SELECT r.grn_number AS "grnNumber", r.vendor_name AS "vendorName", MIN(r.set_timestamp) AS "invoiceDate",
              MAX(l.po_no) AS "poNo", po.delivery_date AS "deliveryDate",
              json_agg(json_build_object(
                'rejectionId', r.rejection_id, 'itemCode', r.item_code, 'materialName', r.material_name,
                'notOkQuantity', r.not_ok_quantity, 'missingQuantity', r.missing_quantity,
                'outstandingQuantity', r.pending_quantity,
                'reasonForNotOk', r.reason_for_not_ok, 'actionForRejectedMaterial', r.action_for_rejected_material,
                'status', r.status
              ) ORDER BY r.rejection_id) AS "lineItems"
       FROM store.rejected_missing_material_tracking r
       LEFT JOIN store.inbound_store_ledger l ON l.grn_number = r.grn_number AND l.item_code = r.item_code
       LEFT JOIN purchase.raw_material_purchase_orders po ON po.po_no = l.po_no
       WHERE ${clauses.map(c => c.replace(/(?<!\.)status/, 'r.status').replace(/(?<!\.)vendor_name/, 'r.vendor_name').replace(/(?<!\.)action_for_rejected_material/, 'r.action_for_rejected_material')).join(' AND ')}
       GROUP BY r.grn_number, r.vendor_name, po.delivery_date
       ORDER BY MIN(r.set_timestamp) DESC`,
      params
    );
    res.json({ success: true, queue: rows });
  } catch (err) {
    console.error('fetchRejectedMaterialQueue error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/commitRejectedMaterialAction', requirePermission('perm_store_inward_rejected'), async (req, res) => {
  // Frontend actually submits a BATCH -- one entry per rejected item,
  // each with its own chosen action (Return to Vendor for
  // Replacement/Repair, Ask Vendor/Ask ABPS to Repair at ABPS) -- not a
  // single rejectionId/newStatus pair. Every row in the batch moves to
  // 'Under Review' with a purchase-review stamp, matching what the
  // original single-row design did for that status.
  const { payload } = req.body;
  const lineItems = payload?.lineItems || [];
  if (lineItems.length === 0) return res.json({ success: false, error: 'No line items to submit.' });

  try {
    const reviewedBy = displayName(req);
    await withTransaction(async (client) => {
      for (const item of lineItems) {
        // Only the internal-repair path resolves on its own (via Being
        // Repaired at ABPS). Vendor-facing actions aren't actually done
        // until the vendor's replacement/repair physically arrives —
        // that's a NEW Gate Entry linked back to this rejection_id,
        // which is what finally sets 'Resolved' (see
        // commitStoreEntryPipelineStep). This step only records Purchase's
        // decision and moves it out of "needs a decision".
        // Material physically stays at ABPS for both — vendor-performed
        // or ABPS-performed, it's the same custody and the same
        // completion mechanism (commitRepairQAPipelineStep) either way.
        const isABPSRepair = item.actionForRejectedMaterial === 'Ask ABPS to Repair at ABPS'
          || item.actionForRejectedMaterial === 'Ask Vendor to repair at ABPS';
        const newStatus = isABPSRepair ? 'At ABPS - Under Repair' : 'Awaiting Vendor Action';
        await client.query(
          `UPDATE store.rejected_missing_material_tracking
           SET action_for_rejected_material = $1, status = $2,
               purchase_reviewed_by = $3, purchase_reviewed_timestamp = now()
           WHERE rejection_id = $4 AND status <> 'Resolved'`,
          [item.actionForRejectedMaterial, newStatus, reviewedBy, item.rejectionId]
        );
      }
    });
    await writeAuditLog(req.user.email, req.body.operatorName, 'RejectedMaterialTracking', 'UPDATE',
      lineItems.map(i => i.rejectionId).join(', '),
      `Purchase action set for ${lineItems.length} rejected material item(s), moved to Under Review.`);
    lineItems.forEach(item => syncLiveRow('rejected_missing_material_tracking', item.rejectionId));
    res.json({ success: true });
  } catch (err) {
    console.error('commitRejectedMaterialAction error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Store Tickets (outward) ─────────────────────────────────────────────

router.post('/submitEngineerMaterialTicket', requirePermission('perm_create_store_ticket'), async (req, res) => {
  const { requestOrReturn, typeOfStore, projectId, jobCardNumber, department, items, requestedBy } = req.body;
  // Return tickets are retired — production returns come in via Stock
  // Sweep. The old Spare → Raw transfer routes (submitSpareToRawTransfer
  // and their approve/action counterparts) were dead, never wired up on
  // the frontend, and had an unguarded write to a generated column —
  // deleted rather than fixed; Stock Sweep is the only supported path now.
  if (requestOrReturn === 'Return' || requestOrReturn === 'Return Material') {
    return res.json({ success: false, error: 'Return tickets have been replaced by Stock Sweep.' });
  }
  try {
    const ticketId = 'TKT-' + Date.now().toString(36).toUpperCase();
    let storedItems;
    await withTransaction(async (client) => {
      const { rows: [jc] } = await client.query(`SELECT boq_id FROM production.job_cards WHERE job_card_number = $1`, [jobCardNumber]);
      const boqId = jc?.boq_id || null;
      storedItems = [];

      // Only Raw Materials Store draws against raw_material_store. Spare has
      // its own table. Finished Goods is neither — each unit is a
      // serial-numbered physical row, not a fungible quantity, so
      // "reserving" means FIFO-claiming N specific rows here (preventing
      // two tickets oversubscribing the same shelf), with the exact
      // serials confirmed later at release (see actionTicketReleaseApproval).
      const reservesRawStock = (typeOfStore || 'Raw Materials Store') === 'Raw Materials Store';

      const isSpareStore = (typeOfStore || '') === 'Spare Store';
      const isFGStore = (typeOfStore || '') === 'Finished Goods Store';

      for (const item of items || []) {
        if (!item.itemCode) throw new Error(`"${item.materialName || 'An item'}" has no Item Code and cannot be ticketed.`);

        // The JC's remaining allotment is the ultimate ceiling regardless of
        // store type — recomputed server-side rather than trusting whatever
        // the client sent, since that flag drives the Approve screen's
        // over-limit handling and a stale/bypassed client value would make
        // that highlighting meaningless.
        if (jobCardNumber && !isFGStore) {
          const { rows: [jcm] } = await client.query(
            `SELECT remaining_quantity FROM production.job_card_materials WHERE job_card_number = $1 AND item_code = $2`,
            [jobCardNumber, item.itemCode]
          );
          item.requiresBOQIncreaseFlag = jcm ? Number(item.quantity) > Number(jcm.remaining_quantity) : false;
        }

        if (isSpareStore) {
          const { rows: [sp] } = await client.query(
            `SELECT available_stock FROM store.spare_store WHERE item_code = $1 FOR UPDATE`, [item.itemCode]
          );
          const avail = sp ? Number(sp.available_stock) : 0;
          if (avail < Number(item.quantity)) {
            throw new Error(`Only ${avail} of ${item.itemCode} is available in Spare Store — cannot request ${item.quantity}.`);
          }
          await client.query(
            `UPDATE store.spare_store
             SET reserved_stock = reserved_stock + $1
             WHERE item_code = $2`,
            [item.quantity, item.itemCode]
          );
          // Captured now so approval can find this BOQ line's spare pool
          // for the rebalance — a Spare ticket never draws from raw_pool,
          // but over-drawing spare_pool releases raw's now-unneeded hold.
          let spareTicketPrnId = null;
          if (boqId) {
            const { rows: [spareLine] } = await client.query(
              `SELECT li.prn_id FROM purchase.prn_line_items li
               JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
               WHERE p.boq_id = $1 AND li.item_code = $2`,
              [boqId, item.itemCode]
            );
            spareTicketPrnId = spareLine ? spareLine.prn_id : null;
          }
          storedItems.push({ ...item, spareReserved: Number(item.quantity), prnId: spareTicketPrnId });
          continue;
        }

        if (isFGStore) {
          const needQty = Math.round(Number(item.quantity) || 0);
          const { rows: candidates } = await client.query(
            `SELECT fg_id FROM production.finished_goods_inventory
             WHERE item_or_dispatch_code = $1 AND status = 'In Store'
               AND finished_good_use IN ('Use in other Product', 'Keep in FG Store')
             ORDER BY fg_date ASC LIMIT $2 FOR UPDATE`,
            [item.itemCode, needQty]
          );
          if (candidates.length < needQty) {
            throw new Error(`Only ${candidates.length} of ${item.itemCode} is available in Finished Goods Store — cannot request ${needQty}.`);
          }
          const fgIds = candidates.map(r => r.fg_id);
          await client.query(
            `UPDATE production.finished_goods_inventory SET status = 'Reserved / On Ticket', ticket_id = $1 WHERE fg_id = ANY($2)`,
            [ticketId, fgIds]
          );
          storedItems.push({ ...item, fgReservedIds: fgIds });
          continue;
        }

        if (!reservesRawStock) { storedItems.push({ ...item }); continue; }
        // Raw tickets only ever draw raw stock — never spare, no matter how
        // a BOQ line's claim happened to be split at PRN authorization. The
        // claimed portion (boqDrawQty) draws down this BOQ's own running
        // raw_pool_remaining counter; store_qty_from_spare/store_qty_from_raw
        // on prn_line_items are never touched by ticket activity.
        let boqDrawQty = 0, prnId = null, sparePoolRemainingSnapshot = 0;

        if (boqId) {
          const { rows: [line] } = await client.query(
            `SELECT li.prn_id, li.raw_pool_remaining, li.spare_pool_remaining
             FROM purchase.prn_line_items li
             JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
             WHERE p.boq_id = $1 AND li.item_code = $2
             FOR UPDATE OF li`,
            [boqId, item.itemCode]
          );
          if (line) {
            prnId = line.prn_id;
            sparePoolRemainingSnapshot = Number(line.spare_pool_remaining) || 0;
            boqDrawQty = Math.min(Number(item.quantity), Number(line.raw_pool_remaining) || 0);
            if (boqDrawQty > 1e-9) {
              await client.query(
                `UPDATE purchase.prn_line_items SET raw_pool_remaining = raw_pool_remaining - $1 WHERE prn_id = $2 AND item_code = $3`,
                [boqDrawQty, prnId, item.itemCode]
              );
            }
          }
        }

        const genericQty = Math.max(0, Number(item.quantity) - boqDrawQty);
        let pendingReallocationQty = 0;
        if (genericQty > 1e-9) {
          const { rows: [inv] } = await client.query(
            `SELECT available_stock, total_stock FROM store.raw_material_store WHERE item_code = $1 FOR UPDATE`, [item.itemCode]
          );
          const available = inv ? Number(inv.available_stock) : 0;
          const totalStock = inv ? Number(inv.total_stock) : 0;
          if (available < genericQty) {
            // Not enough truly free stock, but the shortfall may still be
            // coverable by borrowing from another Job Card's claim at
            // approval time — that decision isn't made here. The only
            // thing creation must rule out is a request that's physically
            // impossible even with full reallocation (exceeds everything
            // this item has anywhere in the store).
            if (genericQty > totalStock) {
              throw new Error(`Requested ${item.quantity} of ${item.materialName || item.itemCode} exceeds the total stock physically held (${totalStock}) — this can never be fulfilled, with or without reallocation from another Job Card.`);
            }
            pendingReallocationQty = genericQty - available;
            if (available > 1e-9) {
              await client.query(
                `UPDATE store.raw_material_store SET reserved_stock = reserved_stock + $1 WHERE item_code = $2`,
                [available, item.itemCode]
              );
            }
          } else {
          await client.query(
            `UPDATE store.raw_material_store SET reserved_stock = reserved_stock + $1 WHERE item_code = $2`,
            [genericQty, item.itemCode]
          );
          }
        }

        // Recorded on the ticket itself so approval/rejection never have
        // to re-derive anything — they just unwind exactly this.
        // pendingReallocationQty > 0 means approval must find a donor
        // Job Card's claim to cover the rest before it can proceed.
        storedItems.push({ ...item, prnId, boqDrawQty, genericQty, pendingReallocationQty });
      }

      await client.query(
        `INSERT INTO store.store_tickets
           (ticket_id, request_or_return, type_of_store, project_id, job_card_number, department,
            requested_returned_by, status, items)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending',$8)`,
        [ticketId, requestOrReturn, typeOfStore, projectId, jobCardNumber, department, requestedBy || req.body.operatorName || displayName(req), JSON.stringify(storedItems)]
      );
    });
    await writeAuditLog(req.user.email, req.body.operatorName, 'StoreTickets', 'CREATE', ticketId, 'Submitted material ticket.');
    syncLiveRow('store_tickets', ticketId);
    (storedItems || []).forEach(item => {
      syncLiveRow(item.spareReserved ? 'spare_store' : 'raw_material_store', item.itemCode);
    });
    res.json({ success: true, ticketId });
  } catch (err) {
    console.error('submitEngineerMaterialTicket error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/fetchPendingTicketsQueueStream', requirePermission('perm_approve_store_tickets'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ticket_id AS "ticketId", request_or_return AS "ticketType", type_of_store AS "storeTargetScope",
              project_id AS "projectId", job_card_number AS "jobCardNumber", department,
              requested_returned_by AS "requestedBy", items, date_created AS "dateCreated"
       FROM store.store_tickets WHERE status = 'Pending' ORDER BY date_created ASC`
    );
    // Enrich each item with the Job Card's LIVE allotted/remaining — read
    // fresh on every fetch (not cached on the ticket) so the queue reflects
    // approvals another user just made against the same Job Card.
    const jobCardNumbers = [...new Set(rows.map(r => r.jobCardNumber).filter(Boolean))];
    let jcmByJobCard = {};
    if (jobCardNumbers.length > 0) {
      const { rows: jcmRows } = await pool.query(
        `SELECT job_card_number, item_code, allotted_quantity, remaining_quantity
         FROM production.job_card_materials WHERE job_card_number = ANY($1)`,
        [jobCardNumbers]
      );
      jcmRows.forEach(r => {
        if (!jcmByJobCard[r.job_card_number]) jcmByJobCard[r.job_card_number] = {};
        jcmByJobCard[r.job_card_number][r.item_code] = {
          allotted: Number(r.allotted_quantity) || 0,
          remaining: Number(r.remaining_quantity) || 0,
        };
      });
    }
    rows.forEach(ticket => {
      const jcmMap = jcmByJobCard[ticket.jobCardNumber] || {};
      ticket.items = (ticket.items || []).map(item => ({
        ...item,
        jcAllottedQty: jcmMap[item.itemCode] ? jcmMap[item.itemCode].allotted : null,
        jcRemainingQty: jcmMap[item.itemCode] ? jcmMap[item.itemCode].remaining : null,
      }));
    });
    res.json({ success: true, queue: rows });
  } catch (err) {
    console.error('fetchPendingTicketsQueueStream error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// checkStockCoverageForTicket — read-only pre-check before approval,
// used by the frontend to branch: no shortfall -> straight approve,
// shortfall -> show the partial/reallocate resolution dialog.
router.post('/checkStockCoverageForTicket', requirePermission('perm_approve_store_tickets'), async (req, res) => {
  const { ticketId } = req.body;
  try {
    const { rows: [ticket] } = await pool.query(`SELECT items FROM store.store_tickets WHERE ticket_id = $1`, [ticketId]);
    if (!ticket) return res.json({ success: false, error: 'Ticket not found.' });

    // Stock is hard-blocked and reserved at ticket creation, so a pending
    // ticket is always covered — this stays as a defensive check only.
    const shortfallItems = [];
    for (const item of ticket.items || []) {
      if (item.spareReserved > 0 || item.boqDrawQty > 0 || item.genericQty > 0) continue;
      const { rows: [inv] } = await pool.query(`SELECT available_stock FROM store.raw_material_store WHERE item_code = $1`, [item.itemCode]);
      const available = inv ? Number(inv.available_stock) : 0;
      if (available < Number(item.quantity)) {
        shortfallItems.push({ itemCode: item.itemCode, materialName: item.materialName, requested: item.quantity, available, shortfall: item.quantity - available });
      }
    }
    res.json({ success: true, hasShortfall: shortfallItems.length > 0, shortfallItems });
  } catch (err) {
    console.error('checkStockCoverageForTicket error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// resolveTicketShortfall — 'partial': releases what's available now,
// logs the remainder as backorder_quantity on the ticket (to surface on
// the next GRN). Any other resolutionType is treated as a full release
// after manual reallocation elsewhere already resolved the shortfall —
// reallocations[] is logged to the audit trail for traceability even
// though the actual stock movement for reallocation happens via
// reassignStockBetweenPRNs beforehand, not here.
router.post('/resolveTicketShortfall', requirePermission('perm_approve_store_tickets'), async (req, res) => {
  const { ticketId, resolutionType, reallocations } = req.body;
  const partialJcmRowIds = [];
  const partialLedgerIds = [];
  try {
    const result = await withTransaction(async (client) => {
      const { rows: [ticket] } = await client.query(`SELECT * FROM store.store_tickets WHERE ticket_id = $1 FOR UPDATE`, [ticketId]);
      if (!ticket) throw new Error('Ticket not found.');

      if ((ticket.type_of_store || 'Raw Materials Store') !== 'Raw Materials Store') {
        throw new Error('Shortfall resolution only applies to Raw Materials Store tickets.');
      }
      let totalBackorder = 0;
      const finalizedItems = [];
      for (const item of ticket.items || []) {
        const { rows: [inv] } = await client.query(`SELECT available_stock FROM store.raw_material_store WHERE item_code = $1 FOR UPDATE`, [item.itemCode]);
        const available = inv ? Number(inv.available_stock) : 0;
        const releaseQty = resolutionType === 'partial' ? Math.min(available, item.quantity) : item.quantity;
        const backorder = item.quantity - releaseQty;
        totalBackorder += backorder;

        if (releaseQty > 0) {
          await client.query(
            `UPDATE store.raw_material_store SET total_stock = GREATEST(0, total_stock - $1), reserved_stock = GREATEST(0, reserved_stock - $1) WHERE item_code = $2`,
            [releaseQty, item.itemCode]
          );
          const { rows: jcmPartialRows } = await client.query(
            `UPDATE production.job_card_materials
             SET used_quantity = used_quantity + $1, remaining_quantity = GREATEST(0, remaining_quantity - $1)
             WHERE job_card_number = $2 AND item_code = $3
             RETURNING row_id`,
            [releaseQty, ticket.job_card_number, item.itemCode]
          );
          jcmPartialRows.forEach(r => partialJcmRowIds.push(r.row_id));
          const { rows: [ledgerRowPartial] } = await client.query(
            `INSERT INTO store.outbound_store_ledger
               (transaction_type, type_of_store, project_id, job_card_number, department, requested_by, reference_id, item_code, material_name, quantity_removed, authorized_by)
             VALUES ('Ticket Release (Partial)',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING ledger_id`,
            [ticket.type_of_store, ticket.project_id, ticket.job_card_number, ticket.department,
             ticket.requested_returned_by, ticketId, item.itemCode, item.materialName, releaseQty, req.body.approverName || req.body.operatorName || displayName(req)]
          );
          partialLedgerIds.push(ledgerRowPartial.ledger_id);
        }
        finalizedItems.push({ ...item, released: releaseQty, backordered: backorder });
      }

      await client.query(
        `UPDATE store.store_tickets SET status = 'Approved', items = $1, backorder_quantity = $2, actioned_by = $3, date_actioned = now() WHERE ticket_id = $4`,
        [JSON.stringify(finalizedItems), totalBackorder, req.body.approverName || req.body.operatorName || displayName(req), ticketId]
      );
      return { totalBackorder, releasedItemCodes: finalizedItems.filter(i => i.released > 0).map(i => i.itemCode) };
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'StoreTickets', 'RESOLVE_SHORTFALL', ticketId,
      `Shortfall resolved (${resolutionType}). Backorder: ${result.totalBackorder}.`, { reallocations });
    syncLiveRow('store_tickets', ticketId);
    [...new Set(result.releasedItemCodes || [])].forEach(code => syncLiveRow('raw_material_store', code));
    partialJcmRowIds.forEach(rowId => syncLiveRow('job_card_materials', rowId));
    partialLedgerIds.forEach(ledgerId => syncLiveRow('outbound_store_ledger', ledgerId));
    res.json({ success: true, message: resolutionType === 'partial' ? 'Partial release completed, backorder logged.' : 'Stock reallocated and ticket fully released.' });
  } catch (err) {
    console.error('resolveTicketShortfall error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});


// outbound_store_ledger + raw_material_store, all one transaction.
router.post('/fetchTicketFGReservationDetails', requirePermission('perm_approve_store_tickets'), async (req, res) => {
  const { ticketId } = req.body;
  try {
    const { rows: [ticket] } = await pool.query(`SELECT items FROM store.store_tickets WHERE ticket_id = $1`, [ticketId]);
    if (!ticket) return res.json({ success: false, error: 'Ticket not found.' });
    const items = ticket.items || [];
    const result = [];
    for (const item of items) {
      if (!item.fgReservedIds || item.fgReservedIds.length === 0) continue;
      const { rows: reserved } = await pool.query(
        `SELECT fg_id AS "fgId", product_serial_number AS "serial", fg_date AS "fgDate"
         FROM production.finished_goods_inventory WHERE fg_id = ANY($1) ORDER BY fg_date ASC`,
        [item.fgReservedIds]
      );
      const { rows: candidates } = await pool.query(
        `SELECT fg_id AS "fgId", product_serial_number AS "serial", fg_date AS "fgDate"
         FROM production.finished_goods_inventory
         WHERE item_or_dispatch_code = $1 AND status = 'In Store'
           AND finished_good_use IN ('Use in other Product', 'Keep in FG Store')
         ORDER BY fg_date ASC`,
        [item.itemCode]
      );
      result.push({ itemCode: item.itemCode, materialName: item.materialName, quantity: item.quantity, reserved, swapCandidates: candidates });
    }
    res.json({ success: true, items: result });
  } catch (err) {
    console.error('fetchTicketFGReservationDetails error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/actionTicketReleaseApproval', requirePermission('perm_approve_store_tickets'), async (req, res) => {
  // Frontend sends managerDecisionCommand: 'APPROVE'/'REJECT', not a
  // boolean `approve` — reading req.body.approve directly meant this was
  // always undefined/falsy, so every ticket silently took the reject
  // branch regardless of what was actually clicked.
  const { ticketId, managerDecisionCommand, fgFinalSelections, actualQuantities, spareAllocations } = req.body;
  const approve = managerDecisionCommand === 'APPROVE';
  const actionedBy = req.body.operatorName || displayName(req);
  const touchedJcmRowIds = [];
  const touchedLedgerIds = [];
  const touchedSpareItemCodes = [];
  try {
    const syncedItems = await withTransaction(async (client) => {
      const { rows: [ticket] } = await client.query(`SELECT * FROM store.store_tickets WHERE ticket_id = $1 FOR UPDATE`, [ticketId]);
      if (!ticket) throw new Error('Ticket not found.');
      if (ticket.status !== 'Pending') throw new Error('Ticket is not in Pending state.');

      if (!approve) {
        // Nothing physically left — undo exactly what creation did:
        // restore the BOQ's claim, release the generic top-up.
        const rawTicket = (ticket.type_of_store || 'Raw Materials Store') === 'Raw Materials Store';
        for (const item of ticket.items || []) {
          if (item.spareReserved > 0) {
            await client.query(
              `UPDATE store.spare_store
               SET reserved_stock = GREATEST(0, reserved_stock - $1)
               WHERE item_code = $2`,
              [item.spareReserved, item.itemCode]
            );
            continue;
          }
          if (item.fgReservedIds && item.fgReservedIds.length > 0) {
            await client.query(
              `UPDATE production.finished_goods_inventory SET status = 'In Store', ticket_id = NULL
               WHERE fg_id = ANY($1) AND status = 'Reserved / On Ticket'`,
              [item.fgReservedIds]
            );
            continue;
          }
          if (!rawTicket) continue;
          if (item.prnId && item.boqDrawQty > 0) {
            // A rejected ticket never drew anything — give this BOQ line's
            // raw pool the claimed amount back so a future ticket can draw
            // it again. raw_material_store.reserved_stock was never touched
            // for this portion (it's held since PRN authorization, not
            // ticket creation), so there's nothing to release here.
            await client.query(
              `UPDATE purchase.prn_line_items SET raw_pool_remaining = raw_pool_remaining + $1 WHERE prn_id = $2 AND item_code = $3`,
              [item.boqDrawQty, item.prnId, item.itemCode]
            );
          }
          if (item.genericQty > 0) {
            // Only the portion that was actually reserved at creation needs
            // releasing — if part of genericQty was left as an unresolved
            // pendingReallocationQty (no donor found/needed yet), nothing
            // was ever reserved for that part.
            const actuallyReserved = Math.max(0, Number(item.genericQty) - Number(item.pendingReallocationQty || 0));
            if (actuallyReserved > 0) {
              await client.query(`UPDATE store.raw_material_store SET reserved_stock = GREATEST(0, reserved_stock - $1) WHERE item_code = $2`,
                [actuallyReserved, item.itemCode]);
            }
          }
        }
        await client.query(`UPDATE store.store_tickets SET status = 'Rejected', actioned_by = $1, date_actioned = now() WHERE ticket_id = $2`,
          [actionedBy, ticketId]);
        return ticket.items || [];
      }

      // The claim already shrank at creation — this is where the actual
      // departure happens, so reserved_stock releases for BOTH portions
      // now, together with total_stock dropping by the full quantity.
      const items = ticket.items || [];
      const reservesRawStock = (ticket.type_of_store || 'Raw Materials Store') === 'Raw Materials Store';
      for (const item of items) {
        // Actual Quantity — what the store worker actually handed out, capped
        // at Requested Quantity (never allowed to exceed it, since anything
        // above was never validated against available stock). The full
        // reservation always releases regardless; available_stock (a
        // generated column) absorbs the unused portion automatically once
        // total_stock only drops by the actual amount below.
        const requestedQty = Number(item.quantity) || 0;
        let releaseQty = requestedQty;
        if (actualQuantities && Object.prototype.hasOwnProperty.call(actualQuantities, item.itemCode)) {
          const proposed = Number(actualQuantities[item.itemCode]);
          if (!isNaN(proposed) && proposed >= 0) releaseQty = Math.min(proposed, requestedQty);
        }
        item.__releaseQty = releaseQty;
        if (releaseQty > 0) {
          // Row-locked, authoritative check — the frontend already warns the
          // approver, but a second ticket against the same Job Card/item can
          // be approved in the gap between page-load and this exact click,
          // so the real enforcement has to happen here, not just client-side.
          const { rows: [jcmCheckRow] } = await client.query(
            `SELECT remaining_quantity FROM production.job_card_materials
             WHERE job_card_number = $1 AND item_code = $2 FOR UPDATE`,
            [ticket.job_card_number, item.itemCode]
          );
          if (jcmCheckRow && releaseQty > Number(jcmCheckRow.remaining_quantity)) {
            throw new Error(`Actual Quantity for ${item.materialName} (${releaseQty}) exceeds the Job Card's remaining allotment (${Number(jcmCheckRow.remaining_quantity)}). Reduce Actual Quantity to match, or reject this ticket and submit a Job Card Increase Request instead.`);
          }
          const { rows: jcmRows } = await client.query(
            `UPDATE production.job_card_materials
             SET used_quantity = used_quantity + $1, remaining_quantity = remaining_quantity - $1
             WHERE job_card_number = $2 AND item_code = $3
             RETURNING row_id`,
            [releaseQty, ticket.job_card_number, item.itemCode]
          );
          jcmRows.forEach(r => touchedJcmRowIds.push(r.row_id));
        }
        if (item.spareReserved > 0) {
          // available_stock is generated (total_stock - unusable_stock -
          // reserved_stock) — dropping total_stock by releaseQty and
          // reserved_stock by the full original reservation makes the
          // generated column land exactly where the old manual
          // "+ unusedSpare" correction used to put it, with no extra write.
          await client.query(
            `UPDATE store.spare_store
             SET total_stock = total_stock - $1, reserved_stock = GREATEST(0, reserved_stock - $2)
             WHERE item_code = $3`,
            [releaseQty, item.spareReserved, item.itemCode]
          );
          // BOQ spare-pool rebalance — if this ticket drew more than the
          // BOQ's own remaining spare claim, the excess is spare stock
          // covering what was "supposed" to come from raw. Give that
          // portion of raw's hold back since it's no longer needed.
          if (item.prnId && releaseQty > 0) {
            const { rows: [poolLine] } = await client.query(
              `SELECT spare_pool_remaining FROM purchase.prn_line_items WHERE prn_id = $1 AND item_code = $2 FOR UPDATE`,
              [item.prnId, item.itemCode]
            );
            if (poolLine) {
              const sparePoolRemaining = Number(poolLine.spare_pool_remaining) || 0;
              const fromPool = Math.min(releaseQty, sparePoolRemaining);
              const excess = releaseQty - fromPool;
              await client.query(
                `UPDATE purchase.prn_line_items SET spare_pool_remaining = GREATEST(0, spare_pool_remaining - $1) WHERE prn_id = $2 AND item_code = $3`,
                [fromPool, item.prnId, item.itemCode]
              );
              if (excess > 1e-9) {
                await client.query(
                  `UPDATE purchase.prn_line_items SET raw_pool_remaining = GREATEST(0, raw_pool_remaining - $1) WHERE prn_id = $2 AND item_code = $3`,
                  [excess, item.prnId, item.itemCode]
                );
                await client.query(
                  `UPDATE store.raw_material_store SET reserved_stock = GREATEST(0, reserved_stock - $1) WHERE item_code = $2`,
                  [excess, item.itemCode]
                );
              }
            }
          }
        } else if (item.fgReservedIds && item.fgReservedIds.length > 0) {
          // Finalize which physical units actually left — defaults to
          // whatever was FIFO-reserved at creation, but the releasing store
          // worker may have swapped specific serials at the release screen
          // (fgFinalSelections). Anything reserved-but-not-finalized goes
          // back to In Store; nothing to swap into isn't a shortfall since
          // the request-time count already guaranteed enough units existed.
          const finalIds = (fgFinalSelections && fgFinalSelections[item.itemCode]) || item.fgReservedIds;
          const { rows: verifyRows } = await client.query(
            `SELECT fg_id FROM production.finished_goods_inventory
             WHERE fg_id = ANY($1) AND item_or_dispatch_code = $2
               AND (ticket_id = $3 OR status = 'In Store') FOR UPDATE`,
            [finalIds, item.itemCode, ticketId]
          );
          if (verifyRows.length < finalIds.length) {
            throw new Error(`One or more selected Finished Goods units for ${item.itemCode} are no longer available. Refresh and try again.`);
          }
          await client.query(
            `UPDATE production.finished_goods_inventory
             SET status = 'Consumed in Production', ticket_id = $1, consumed_date = now()
             WHERE fg_id = ANY($2)`,
            [ticketId, finalIds]
          );
          const releasedBack = item.fgReservedIds.filter(id => !finalIds.includes(id));
          if (releasedBack.length > 0) {
            await client.query(
              `UPDATE production.finished_goods_inventory SET status = 'In Store', ticket_id = NULL
               WHERE fg_id = ANY($1) AND status = 'Reserved / On Ticket'`,
              [releasedBack]
            );
          }
        
        
        } else if (reservesRawStock) {
        // If creation left part of this item's genericQty un-reserved
        // (pendingReallocationQty), try to cover it now by borrowing from
        // another Job Card's claim — fully automatic, no user input.
        // Runs BEFORE the existing release logic below: if this succeeds,
        // the borrowed amount lands in reserved_stock exactly where the
        // reserved_stock -= item.genericQty line already expects it, so
        // nothing else in this block needs to change. If it can't fully
        // cover the shortfall, the whole approval aborts rather than
        // partially applying.
        if (item.pendingReallocationQty > 0) {
          let donorBoqId = null;
          if (item.prnId) {
            const { rows: [prnRow] } = await client.query(`SELECT boq_id FROM purchase.purchase_request_notes WHERE prn_id = $1`, [item.prnId]);
            donorBoqId = prnRow ? prnRow.boq_id : null;
          }
          const { covered, stillShort } = await findAndBorrowForShortfall(client, {
            itemCode: item.itemCode, materialName: item.materialName, jobCardNumber: ticket.job_card_number,
            boqId: donorBoqId, prnId: item.prnId, shortfallQty: item.pendingReallocationQty, actionedBy,
          });
          if (stillShort > 1e-9) {
            throw new Error(`Cannot approve — ${item.materialName || item.itemCode} is still short by ${stillShort} even after checking other Job Cards for available stock. Reduce Actual Quantity, or resolve via Assign Current Stock.`);
          }
        }
        // Raw tickets never touch spare — boqDrawQty is raw-only now, so
        // this is a plain release, no cross-pool split.
        if (item.boqDrawQty > 0) {
          await client.query(`UPDATE store.raw_material_store SET reserved_stock = GREATEST(0, reserved_stock - $1) WHERE item_code = $2`,
            [item.boqDrawQty, item.itemCode]);
        }
        if (item.genericQty > 0) {
          await client.query(`UPDATE store.raw_material_store SET reserved_stock = GREATEST(0, reserved_stock - $1) WHERE item_code = $2`,
            [item.genericQty, item.itemCode]);
        }
        // Spare Store Qty — physical overage the store worker had to take
        // (e.g. a whole 50kg bag to cover a 10kg requirement) that can't
        // return to RM stock. Approver-entered, never derived — the system
        // has no way to know the physical unit size of what was issued.
        const spareInfo = (spareAllocations && spareAllocations[item.itemCode]) || null;
        const spareQty = spareInfo ? Math.max(0, Number(spareInfo.qty) || 0) : 0;
        const spareNeeded = spareInfo ? spareInfo.needed : 'No';
        const physicalIssued = releaseQty + spareQty;
        if (physicalIssued > 0) {
          const { rows: [rawRow] } = await client.query(
            `SELECT total_stock FROM store.raw_material_store WHERE item_code = $1 FOR UPDATE`, [item.itemCode]
          );
          const currentTotal = rawRow ? Number(rawRow.total_stock) : 0;
          if (physicalIssued > currentTotal + 1e-9) {
            throw new Error(`Cannot approve — ${item.materialName || item.itemCode}: physical issuance (${physicalIssued} = Actual Quantity + Spare Store Qty) exceeds what's physically in Raw Materials Store (${currentTotal}). This shouldn't be reachable if reservations were tracked correctly — check for stale/inconsistent stock data on this item.`);
          }
          await client.query(`UPDATE store.raw_material_store SET total_stock = total_stock - $1 WHERE item_code = $2`,
            [physicalIssued, item.itemCode]);
        }
        if (spareQty > 1e-9 && spareNeeded === 'Blocked') {
          await client.query(`UPDATE store.spare_store SET total_stock = total_stock + $1, unusable_stock = unusable_stock + $1 WHERE item_code = $2`,
            [spareQty, item.itemCode]);
          await client.query(
            `INSERT INTO store.spare_blocked_allocations (item_code, material_name, job_card_number, quantity, created_by)
             VALUES ($1,$2,$3,$4,$5)`,
            [item.itemCode, item.materialName, ticket.job_card_number, spareQty, actionedBy]
          );
          touchedSpareItemCodes.push(item.itemCode);
        } else if (spareQty > 1e-9 && spareNeeded === 'Restricted') {
          await client.query(`UPDATE store.spare_store SET total_stock = total_stock + $1 WHERE item_code = $2`,
            [spareQty, item.itemCode]);
          touchedSpareItemCodes.push(item.itemCode);
        }
        item.__spareStoreQty = spareQty;
        item.__spareStockNeeded = spareNeeded;
        }
        await client.query(
          `INSERT INTO store.outbound_store_ledger
             (transaction_type, type_of_store, project_id, job_card_number, department, requested_by, reference_id,
              item_code, material_name, quantity_removed, authorized_by)
           VALUES ('Ticket Release',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [ticket.type_of_store, ticket.project_id, ticket.job_card_number, ticket.department,
           ticket.requested_returned_by, ticketId, item.itemCode, item.materialName, releaseQty, actionedBy]
        );
      }
      const finalizedItems = items.map(item => ({ ...item, released: item.__releaseQty ?? item.quantity }));
      await client.query(`UPDATE store.store_tickets SET status = 'Approved', actioned_by = $1, date_actioned = now(), items = $3 WHERE ticket_id = $2`,
        [actionedBy, ticketId, JSON.stringify(finalizedItems)]);
      return finalizedItems;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'StoreTickets', approve ? 'APPROVE' : 'REJECT', ticketId,
      `Ticket ${approve ? 'approved and released' : 'rejected'}.`);
    syncLiveRow('store_tickets', ticketId);
    (syncedItems || []).forEach(item => {
      if (item.fgReservedIds && item.fgReservedIds.length > 0) {
        item.fgReservedIds.forEach(fgId => syncLiveRow('finished_goods_inventory', fgId));
      } else if (item.spareReserved > 0) {
        syncLiveRow('spare_store', item.itemCode);
      } else {
        // A Raw ticket only ever moves raw stock directly, but approval can
        // also divert physical overage into Spare Store (Spare Store Qty) —
        // sync that pool too when it happened.
        if ((Number(item.__spareStoreQty) || 0) > 0) syncLiveRow('spare_store', item.itemCode);
        syncLiveRow('raw_material_store', item.itemCode);
      }
    });
    touchedJcmRowIds.forEach(rowId => syncLiveRow('job_card_materials', rowId));
    touchedLedgerIds.forEach(ledgerId => syncLiveRow('outbound_store_ledger', ledgerId));
    [...new Set(touchedSpareItemCodes)].forEach(code => syncLiveRow('spare_store', code));
    res.json({ success: true });
  } catch (err) {
    console.error('actionTicketReleaseApproval error:', err);
    const friendlyMessage = err.message.includes('chk_stock_nonneg')
      ? 'Cannot approve as this would release more of a material than is physically available in the store. Reject this ticket and ask the requester to create a fresh one.'
      : err.message;
    res.status(400).json({ success: false, error: friendlyMessage });
  }
});

// ── Live Stock ────────────────────────────────────────────────────────

router.post('/pullLiveInventoryCounts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT item_code, material_name, total_stock, reserved_stock, available_stock, unit_type, type_of_material
       FROM store.raw_material_store ORDER BY material_name`
    );
    // Frontend reads data.inventory with camelCase fields (Live Raw Materials
    // Stock, Material Request init, FG sync) — must match, not "stock"/snake_case.
    const inventory = rows.map(r => ({
      itemCode: r.item_code,
      materialName: r.material_name,
      totalStock: Number(r.total_stock) || 0,
      reservedStock: Number(r.reserved_stock) || 0,
      availableStock: Number(r.available_stock) || 0,
      unitType: r.unit_type,
      typeOfMaterial: r.type_of_material
    }));
    res.json({ success: true, inventory });
  } catch (err) {
    console.error('pullLiveInventoryCounts error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/getSpareStoreStock', requirePermission('perm_live_spare_stock'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT item_code, material_name, total_stock, reserved_stock, available_stock, unit_type, type_of_material
       FROM store.spare_store ORDER BY material_name`
    );
    const stock = rows.map(r => ({
      itemCode: r.item_code,
      materialName: r.material_name,
      totalStock: Number(r.total_stock) || 0,
      reservedStock: Number(r.reserved_stock) || 0,
      availableStock: Number(r.available_stock) || 0,
      unitType: r.unit_type,
      typeOfMaterial: r.type_of_material
    }));
    res.json({ success: true, stock });
  } catch (err) {
    console.error('getSpareStoreStock error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchStockAssignmentBreakdown', async (req, res) => {
  const { itemCode, storeType } = req.body;
  if (!itemCode) return res.json({ success: false, error: 'Item Code is required.' });
  try {
    // store_qty_from_raw/spare is now the single source for "currently
    // claimed for this PRN" — every claim path (manual Revise PRN,
    // Assign Current Stock, Stock Sweep, QA-excess) writes here.
    // stock_assignments is audit/undo history only, not live totals.
    const claimedCol = storeType === 'spare' ? 'store_qty_from_spare' : 'store_qty_from_raw';
    const { rows } = await pool.query(
      `SELECT p.boq_id AS "boqId", SUM(li.${claimedCol}) AS "assignedQty"
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
       WHERE li.item_code = $1 AND li.${claimedCol} > 0
       GROUP BY p.boq_id
       HAVING SUM(li.${claimedCol}) > 0
       ORDER BY p.boq_id`,
      [itemCode]
    );
    res.json({ success: true, breakdown: rows });
  } catch (err) {
    console.error('fetchStockAssignmentBreakdown error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/getLiveStockForItem', async (req, res) => {
  const { itemCode, jobCardNumber } = req.body;
  try {
    const { rows: [rawRow] } = await pool.query(
      `SELECT available_stock, reserved_stock, unit_type FROM store.raw_material_store WHERE item_code = $1`, [itemCode]
    );
    const { rows: [spareRow] } = await pool.query(
      `SELECT available_stock, reserved_stock, unit_type FROM store.spare_store WHERE item_code = $1`, [itemCode]
    );
    // Each finished_goods_inventory row is one physical, serial-numbered unit
    // — not a fungible quantity — so "available" is a row count, not a sum.
    // 'In Store' is the only status this table currently ever holds (nothing
    // marks a row consumed when a ticket draws one yet), and dispatch-only
    // units ("Ready for Dispatch") are never available to a Store Ticket.
    const { rows: [fgRow] } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM production.finished_goods_inventory
       WHERE item_or_dispatch_code = $1 AND status = 'In Store'
         AND finished_good_use IN ('Use in other Product', 'Keep in FG Store')`,
      [itemCode]
    );
    // Surface this BOQ line's raw/spare pool balance up front, so a store
    // worker can see a near-exhausted raw pool (with spare still holding
    // stock) before they submit and hit the ticket-creation error instead.
    let rawPoolRemaining = null, sparePoolRemaining = null;
    if (jobCardNumber) {
      const { rows: [poolLine] } = await pool.query(
        `SELECT li.raw_pool_remaining, li.spare_pool_remaining
         FROM production.job_cards jc
         JOIN purchase.prn_line_items li ON li.item_code = $2
         JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id AND p.boq_id = jc.boq_id
         WHERE jc.job_card_number = $1`,
        [jobCardNumber, itemCode]
      );
      if (poolLine) {
        rawPoolRemaining = Number(poolLine.raw_pool_remaining) || 0;
        sparePoolRemaining = Number(poolLine.spare_pool_remaining) || 0;
      }
    }
    if (!rawRow && !spareRow && !fgRow) return res.json({ success: true, stock: null });
    res.json({
      success: true,
      stock: {
        availableStock: rawRow ? Number(rawRow.available_stock) || 0 : 0,
        reservedStock: rawRow ? Number(rawRow.reserved_stock) || 0 : 0,
        unitType: (rawRow && rawRow.unit_type) || (spareRow && spareRow.unit_type) || 'NOS',
        spareStock: spareRow ? Number(spareRow.available_stock) || 0 : 0,
        spareReservedStock: spareRow ? Number(spareRow.reserved_stock) || 0 : 0,
        fgInStockCount: (fgRow && fgRow.cnt) || 0,
        rawPoolRemaining, sparePoolRemaining,
      }
    });
  } catch (err) {
    console.error('getLiveStockForItem error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function handleBOQIncreaseDecision(req, res) {
  const { ticketId, adminAction, itemDecisions } = req.body; // adminAction: 'approve' | 'reject'
  const decisionMaker = req.body.operatorName || req.body.activeEngineer || displayName(req);

  try {
    const result = await withTransaction(async (client) => {
      const { rows: [ticket] } = await client.query(
        `SELECT * FROM store.store_tickets WHERE ticket_id = $1 AND status = 'Pending BOQ Increase Review' FOR UPDATE`,
        [ticketId]
      );
      if (!ticket) throw new Error('Ticket not found, or not in Pending BOQ Increase Review status.');

      // Frontend sends 'accept' | 'partial' | 'reject' — only 'reject'
      // is a rejection. 'approve' kept for any older caller.
      if (adminAction === 'reject') {
        // Release every hold this ticket placed at creation — the request
        // dies here, same as code.js's reject branch.
        for (const item of ticket.items || []) {
          if (item.prnId && item.boqDrawQty > 0) {
            await client.query(
              `UPDATE purchase.prn_line_items SET raw_pool_remaining = raw_pool_remaining + $1 WHERE prn_id = $2 AND item_code = $3`,
              [item.boqDrawQty, item.prnId, item.itemCode]
            );
          }
          if (item.genericQty > 0) {
            await client.query(`UPDATE store.raw_material_store SET reserved_stock = GREATEST(0, reserved_stock - $1) WHERE item_code = $2`,
              [item.genericQty, item.itemCode]);
          }
        }
        await client.query(
          `UPDATE store.store_tickets SET status = 'Rejected by Admin', actioned_by = $1, date_actioned = now() WHERE ticket_id = $2`,
          [decisionMaker, ticketId]
        );
        return { rejected: true, releasedItems: ticket.items || [] };
      }

      const decisionByCode = Object.fromEntries((itemDecisions || []).map(d => [d.itemCode, d]));
      const items = ticket.items || [];
      const finalizedItems = [];

      const { rows: [jcRow] } = await client.query(`SELECT boq_id FROM production.job_cards WHERE job_card_number = $1`, [ticket.job_card_number]);
      const jcBoqId = jcRow ? jcRow.boq_id : null;

      for (const item of items) {
        const decision = decisionByCode[item.itemCode];
        const oldRemainingQty = Number(item.boqRemainingQty || 0);
        // Final Ticket Qty is an ABSOLUTE final total the admin sets, not a
        // delta to add — clamped server-side (never trust the client-side
        // cap alone) so it can never go below what this JC already has.
        const requestedFinalQty = decision ? Number(decision.finalTicketQty) : oldRemainingQty;
        const finalQty = isNaN(requestedFinalQty) ? oldRemainingQty : Math.max(oldRemainingQty, requestedFinalQty);
        const permittedQty = Math.max(0, finalQty - oldRemainingQty);

        if (permittedQty > 0) {
          await client.query(
            `UPDATE production.job_card_materials
             SET allotted_quantity = allotted_quantity + $1,
                 remaining_quantity = remaining_quantity + $1,
                 increase_approved_quantity = increase_approved_quantity + $1,
                 last_updated = now()
             WHERE job_card_number = $2 AND item_code = $3`,
            [permittedQty, ticket.job_card_number, item.itemCode]
          );
        }

        // Reserve the FULL final quantity now, for EVERY item on this
        // request — not just the ones that needed an increase. Every item
        // on the follow-up release ticket needs to be physically backed
        // when it's released, regardless of whether its own quantity
        // happened to already fit within the old allotment. Try truly
        // free stock first, then borrow from another Job Card's claim.
        let itemPrnId = null, totalNowReserved = 0;
        if (jcBoqId && finalQty > 0) {
          const { rows: [prnRow] } = await client.query(
            `SELECT li.prn_id FROM purchase.prn_line_items li
             JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
             WHERE p.boq_id = $1 AND li.item_code = $2`,
            [jcBoqId, item.itemCode]
          );
          itemPrnId = prnRow ? prnRow.prn_id : null;
        }
        if (itemPrnId) {
          const { rows: [inv] } = await client.query(
            `SELECT available_stock FROM store.raw_material_store WHERE item_code = $1 FOR UPDATE`, [item.itemCode]
          );
          const available = inv ? Number(inv.available_stock) : 0;
          const directClaim = Math.min(finalQty, available);
          if (directClaim > 0) {
            await claimRawOnlyForPRN(client, itemPrnId, item.itemCode, item.materialName, directClaim, decisionMaker);
            totalNowReserved += directClaim;
          }
          const shortfall = finalQty - directClaim;
          if (shortfall > 1e-9) {
            const { covered, stillShort } = await findAndBorrowForShortfall(client, {
              itemCode: item.itemCode, materialName: item.materialName, jobCardNumber: ticket.job_card_number,
              boqId: jcBoqId, prnId: itemPrnId, shortfallQty: shortfall, actionedBy: decisionMaker,
            });
            totalNowReserved += covered;
            if (stillShort > 1e-9) {
              throw new Error(`Cannot grant this request — ${item.materialName || item.itemCode} is still short by ${stillShort} even after checking other Job Cards for available stock.`);
            }
          }
        }

        finalizedItems.push({
          ...item, boqIncreasePermittedQty: permittedQty, requestedQty: finalQty, quantity: finalQty,
          requiresBOQIncreaseFlag: false, prnId: itemPrnId, boqDrawQty: totalNowReserved, genericQty: 0,
        });
      }

      await client.query(
        `UPDATE store.store_tickets SET status = 'Approved & Released', items = $1, actioned_by = $2, date_actioned = now()
         WHERE ticket_id = $3`,
        [JSON.stringify(finalizedItems), decisionMaker, ticketId]
      );

      // Follow-up release ticket so the store manager still does the
      // physical release step — matches code.js's two-stage design
      // (increase approval != material handed over yet).
      const releaseTicketId = 'TK-BOQ-RELEASED-' + Math.floor(100000 + Math.random() * 900000);
      await client.query(
        `INSERT INTO store.store_tickets
           (ticket_id, request_or_return, type_of_store, project_id, job_card_number, department,
            requested_returned_by, status, items, parent_ticket_id)
         VALUES ($1,'Request','Raw Materials Store',$2,$3,$4,$5,'Pending',$6,$7)`,
        [releaseTicketId, ticket.project_id, ticket.job_card_number, ticket.department,
         ticket.requested_returned_by, JSON.stringify(finalizedItems), ticketId]
      );

      return { approved: true, releaseTicketId };
    });

    await writeAuditLog(req.user.email, decisionMaker, 'StoreTickets',
      `BOQ_INCREASE_${adminAction.toUpperCase()}`, ticketId,
      `Admin actioned BOQ Increase request: ${adminAction}.`);
    syncLiveRow('store_tickets', ticketId);
    if (result.releaseTicketId) syncLiveRow('store_tickets', result.releaseTicketId);
    (result.releasedItems || []).forEach(item => syncLiveRow('raw_material_store', item.itemCode));
    res.json({ success: true, ticketId, ...result });
  } catch (err) {
    console.error('commitBOQLimitIncreaseRequestTicket error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
}

// ── Job Card Increase Request — creation ─────────────────────────────
// This was previously wired to handleBOQIncreaseDecision (the ADMIN
// approve/reject handler) by mistake — both the creation screen and the
// admin decision screen sent the same action name, so a brand-new
// request (no ticketId yet) always failed the "ticket not found" check
// meant for an existing one. This is the actual missing creation step:
// no stock reservation happens here — that's the whole point, nothing
// moves until an admin raises the allotment via handleBOQIncreaseDecision.
router.post('/createBOQLimitIncreaseRequestTicket', requirePermission('perm_create_store_ticket'), async (req, res) => {
  const { projectId, jobCardNumber, justificationNotesText, itemsClusterArray } = req.body;
  const department = req.body.department || req.body.departmentOutgoing || null;
  const requestedBy = req.body.requestedBy || req.body.operatorName || req.body.activeEngineer || displayName(req);

  if (!jobCardNumber) return res.json({ success: false, error: 'Job Card Number is required.' });
  if (!itemsClusterArray?.length) return res.json({ success: false, error: 'At least one item is required.' });
  if (!justificationNotesText?.trim()) return res.json({ success: false, error: 'Justification notes are required.' });

  try {
    const ticketId = 'TKT-' + Date.now().toString(36).toUpperCase();
    const enrichedItems = [];
    for (const item of itemsClusterArray) {
      const { rows: [jcm] } = await pool.query(
        `SELECT allotted_quantity, used_quantity, remaining_quantity, unit_type
         FROM production.job_card_materials WHERE job_card_number = $1 AND item_code = $2`,
        [jobCardNumber, item.itemCode]
      );
      // Total Stock feasibility check — reserved_stock already aggregates
      // every BOQ's claim on this item in one column, so total_stock
      // (reserved + available) is the true ceiling of what could ever be
      // granted, even with full reallocation from another Job Card at
      // approval time. Nothing routes to an admin that can never be
      // fulfilled.
      const requestedIncreaseQty = Number(item.quantity ?? item.boqIncreaseRequestedQty ?? 0);
      if (requestedIncreaseQty > 0) {
        const { rows: [inv] } = await pool.query(
          `SELECT total_stock FROM store.raw_material_store WHERE item_code = $1`, [item.itemCode]
        );
        const totalStock = inv ? Number(inv.total_stock) : 0;
        if (requestedIncreaseQty > totalStock) {
          return res.json({ success: false, error: `Requested increase of ${requestedIncreaseQty} for ${item.materialName || item.itemCode} exceeds the total stock physically held (${totalStock}) — this can never be fulfilled, with or without reallocation from another Job Card.` });
        }
      }
      const boqRemainingQty = jcm ? Number(jcm.remaining_quantity) || 0 : 0;
      const boqAllottedQty = jcm ? Number(jcm.allotted_quantity) || 0 : 0;
      const boqUsedQty = jcm ? Number(jcm.used_quantity) || 0 : 0;
      // Stored under the exact field names the admin approval queue reads
      // (fetchPendingBOQIncreaseTickets / renderBOQIncreaseTicketCard) —
      // itemDescription/requestedQty/boqExceedAmount/boqIncreaseNotes/
      // boqExceeded, not the Create Store Ticket basket's own field names.
      enrichedItems.push({
        ...item,
        boqRemainingQty, boqAllottedQty, boqUsedQty,
        unitType: item.unitType || (jcm ? jcm.unit_type : null),
        itemDescription: item.materialName,
        requestedQty: requestedIncreaseQty,
        boqExceedAmount: Math.max(0, requestedIncreaseQty - boqRemainingQty),
        boqIncreaseNotes: justificationNotesText.trim(),
        boqExceeded: requestedIncreaseQty > boqRemainingQty,
      });
    }

    await pool.query(
      `INSERT INTO store.store_tickets
         (ticket_id, request_or_return, type_of_store, project_id, job_card_number, department,
          requested_returned_by, status, items, justification_notes)
       VALUES ($1,'Request','Raw Materials Store',$2,$3,$4,$5,'Pending BOQ Increase Review',$6,$7)`,
      [ticketId, projectId, jobCardNumber, department, requestedBy, JSON.stringify(enrichedItems), justificationNotesText.trim()]
    );

    await writeAuditLog(req.user.email, req.body.operatorName, 'StoreTickets', 'CREATE_BOQ_INCREASE_REQUEST', ticketId,
      'Submitted BOQ limit increase request.');
    syncLiveRow('store_tickets', ticketId);
    res.json({ success: true, ticketId });
  } catch (err) {
    console.error('createBOQLimitIncreaseRequestTicket error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Job Card Increase Approval ───────────────────────────────────────
// handleBOQIncreaseDecision — ARCHITECTURAL RULE FROM code.js, preserved
// exactly: this affects ONLY the one Job Card's job_card_materials row.
// It must NEVER touch bill_of_quantity, boq_drafts, create a new BOQ
// version, or regenerate the BOQ PDF. Cascading a change to every Job
// Card under a BOQ is exclusively the Design-side "Update BOQ" flow
// built in routes/design.js.
router.post('/commitBOQLimitIncreaseRequestTicket', requirePermission('perm_approve_job_card_increase'), handleBOQIncreaseDecision);

// processOverrideMaterialReallocation — code.js explicitly delegates
// this to the same handler ("Delegates to BOQ increase handler — same
// logic"), so it's a direct alias to the same function here too.
router.post('/processOverrideMaterialReallocation', requirePermission('perm_approve_job_card_increase'), handleBOQIncreaseDecision);



// ── Historical / Approved ticket views ────────────────────────────────
router.post('/fetchAllHistoricalStoreTicketsStream', requirePermission('perm_search_store_tickets'), async (req, res) => {
  try {
    const { rows } = await pool.query(`${TICKET_SELECT} ORDER BY date_created DESC LIMIT 2000`);
    res.json({ success: true, tickets: rows });
  } catch (err) {
    console.error('fetchAllHistoricalStoreTicketsStream error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// commitRepairQAPipelineStep — closes out an "At ABPS - Under Repair"
// rejection: repaired quantity goes back into raw_material_store as usable
// stock, any remaining unrepaired quantity stays tracked, one transaction.
router.post('/commitRepairQAPipelineStep', requirePermission('perm_qa_check'), async (req, res) => {
  const { payload } = req.body;
  const items = payload?.lineItems || [];
  if (items.length === 0) return res.json({ success: false, error: 'No line items provided.' });

  try {
    const newStockAssignmentIds = [];
    await withTransaction(async (client) => {
      for (const item of items) {
        const repairedQty = Number(item.repairedQuantity) || 0;
        const { rows: [rej] } = await client.query(
          `SELECT pending_quantity, item_code, material_name, grn_number FROM store.rejected_missing_material_tracking WHERE rejection_id = $1 FOR UPDATE`,
          [item.rejectionId]
        );
        if (!rej) continue;

        const remaining = Math.max(0, Number(rej.pending_quantity) - repairedQty);
        await client.query(
          `UPDATE store.rejected_missing_material_tracking
           SET pending_quantity = $1::numeric, status = $2, resolved_timestamp = CASE WHEN $1::numeric = 0 THEN now() ELSE NULL END
           WHERE rejection_id = $3`,
          [remaining, remaining === 0 ? 'Resolved' : 'At ABPS - Under Repair', item.rejectionId]
        );

        if (repairedQty > 0) {
          await client.query(
            `UPDATE store.raw_material_store SET total_stock = total_stock + $1 WHERE item_code = $2`,
            [repairedQty, rej.item_code]
          );
          // Same crediting as a fresh QA pass — PO traced via the
          // rejection's GRN number since the rejection record itself
          // has no po_no. Leftover beyond that PO's own PRN need goes
          // through the same generic FIFO assignment as everywhere else.
          const { rows: [src] } = await client.query(
            `SELECT po_no FROM store.inbound_store_ledger WHERE grn_number = $1 AND item_code = $2 AND po_no IS NOT NULL LIMIT 1`,
            [rej.grn_number, rej.item_code]
          );
          const attrCtx = { eventType: 'REPAIR_QA', rejectionId: item.rejectionId, grnNumber: rej.grn_number,
                            itemCode: rej.item_code, poNo: src?.po_no || null, createdBy: displayName(req) };
          let excessQty = repairedQty;
          if (src?.po_no) {
            const { credited, excess } = await distributeReceiptFIFO(client, src.po_no, rej.item_code, repairedQty);
            excessQty = excess;
            const creditAttrs = [];
            for (const c of credited) {
              const id = await claimStoreForPRN(client, c.prnId, rej.item_code, rej.material_name, c.quantity, displayName(req));
              if (id) newStockAssignmentIds.push(id);
              creditAttrs.push({ prnId: c.prnId, kind: 'po_credit', quantity: c.quantity, assignmentId: id });
            }
            await recordReceiptAttributions(client, attrCtx, creditAttrs);
          }
          const { assignmentIds, assigned, unassigned } = await autoAssignStock(client, rej.item_code, rej.material_name, excessQty, displayName(req));
          newStockAssignmentIds.push(...assignmentIds);
          await recordReceiptAttributions(client, attrCtx, [
            ...assigned.map(a => ({ prnId: a.prnId, kind: 'auto_assign', quantity: a.quantity, assignmentId: a.assignmentId })),
            { prnId: null, kind: 'free_stock', quantity: unassigned },
          ]);
        }
      }
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'RejectedMaterialTracking', 'REPAIR_QA', null,
      `Repair QA processed for ${items.length} item(s).`);
    newStockAssignmentIds.forEach(id => syncLiveRow('stock_reservations', id));
    res.json({ success: true });
  } catch (err) {
    console.error('commitRepairQAPipelineStep error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Reporting / Historical ──────────────────────────────────────────────

router.post('/fetchApprovedTicketsMatrix', requirePermission('perm_search_store_tickets'), async (req, res) => {
  const { lookbackDays } = req.body;
  try {
    const { rows } = await pool.query(
      `${TICKET_SELECT}
       WHERE status IN ('Approved','Approved & Released','Fulfilled')
         AND date_created >= now() - ($1 || ' days')::interval
       ORDER BY date_created DESC`,
      [lookbackDays || 30]
    );
    res.json({ success: true, tickets: rows });
  } catch (err) {
    console.error('fetchApprovedTicketsMatrix error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// triggerLowStockReorderDraft — flags items where available stock has
// fallen below 10% of total stock. NOTE: your original MasterInventory
// sheet didn't have an explicit reorder-point column either, so this
// uses the same relative-threshold heuristic rather than a fixed
// per-item reorder point — flag if you want a real per-item threshold
// column added, this is an approximation matching available data.
router.post('/triggerLowStockReorderDraft', requirePermission('perm_search_store_tickets'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT item_code, material_name, total_stock, available_stock, unit_type
       FROM store.raw_material_store
       WHERE total_stock > 0 AND available_stock <= total_stock * 0.1
       ORDER BY available_stock ASC`
    );
    res.json({ success: true, lowStockItems: rows });
  } catch (err) {
    console.error('triggerLowStockReorderDraft error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// matchStoreEntryItemCodes — batch fuzzy-matches raw GRN description
// lines against pre-filtered candidates, one Gemini call for the whole
// invoice rather than per-line.
router.post('/matchStoreEntryItemCodes', requirePermission('perm_store_entry_and_grn'), async (req, res) => {
  const { lineItems } = req.body;
  if (!lineItems?.length) return res.json({ success: false, error: 'Line items are required.' });

  try {
    await checkGeminiRateLimit(pool, req.user.email, 'matchStoreEntryItemCodes');
    const { results } = await matchStoreEntryItemCodes(lineItems);
    res.json({ success: true, matches: results || [] });
  } catch (err) {
    console.error('matchStoreEntryItemCodes error:', err);
    const status = err.isRateLimit ? 429 : 200;
    res.status(status).json({ success: true, matches: [], error: 'Semantic matching unavailable.' });
  }
});

// fetchLiveMaterialStock — batch lookup across Raw + Spare for a set of
// item codes, used by the PRN creation screen's live-refresh polling.
router.post('/fetchLiveMaterialStock', async (req, res) => {
  const { itemCodes } = req.body;
  if (!itemCodes?.length) return res.json({ success: true, stock: {} });
  try {
    const { rows: rawRows } = await pool.query(
      `SELECT item_code, available_stock FROM store.raw_material_store WHERE item_code = ANY($1::text[])`, [itemCodes]
    );
    const { rows: spareRows } = await pool.query(
      `SELECT item_code, available_stock FROM store.spare_store WHERE item_code = ANY($1::text[])`, [itemCodes]
    );
    const rawByCode = Object.fromEntries(rawRows.map(r => [r.item_code.toUpperCase(), Number(r.available_stock)]));
    const spareByCode = Object.fromEntries(spareRows.map(r => [r.item_code.toUpperCase(), Number(r.available_stock)]));
    const stock = {};
    itemCodes.forEach(code => {
      const upper = code.toUpperCase();
      stock[upper] = { raw: rawByCode[upper] || 0, spare: spareByCode[upper] || 0 };
    });
    res.json({ success: true, stock });
  } catch (err) {
    console.error('fetchLiveMaterialStock error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// fetchStockAssignmentsForItem — current assignments per PRN, plus
// eligible reassignment targets (other open PRN lines still needing
// this item code).
router.post('/fetchStockAssignmentsForItem', requirePermission('perm_reserve_store_stock'), async (req, res) => {
  const { itemCode } = req.body;
  try {
    const { rows: [totals] } = await pool.query(
      `SELECT total_stock AS "totalStock", reserved_stock AS "reservedStock", available_stock AS "availableStock", unit_type AS "unitType"
       FROM store.raw_material_store WHERE item_code = $1`,
      [itemCode]
    );
    const { rows: assignments } = await pool.query(
      `SELECT li.prn_id AS "prnId", prn.boq_id AS "boqId",
              li.raw_pool_remaining AS "assignedQty",
              bd.order_quantity AS "numberOfJobCards"
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes prn ON prn.prn_id = li.prn_id
       LEFT JOIN design.boq_drafts bd ON bd.boq_id = prn.boq_id
       WHERE li.item_code = $1 AND li.raw_pool_remaining > 1e-9
       ORDER BY li.prn_id`,
      [itemCode]
    );
    res.json({ success: true, itemCode, totals: totals || { totalStock: 0, reservedStock: 0, availableStock: 0, unitType: '' }, assignments });
  } catch (err) {
    console.error('fetchStockAssignmentsForItem error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// commitStockSweep — bulk "found stock" entry (physical stock-take),
// adds to total_stock and auto-distributes to the oldest open PRN lines
// still needing that item code, up to the swept quantity.
router.post('/fetchUnfreedSpareBlockedAllocations', requirePermission('perm_reserve_store_stock'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT allocation_id AS "allocationId", item_code AS "itemCode", material_name AS "materialName",
              job_card_number AS "jobCardNumber", quantity, created_date AS "createdDate"
       FROM store.spare_blocked_allocations
       WHERE freed_date IS NULL
       ORDER BY created_date ASC`
    );
    res.json({ success: true, allocations: rows });
  } catch (err) {
    console.error('fetchUnfreedSpareBlockedAllocations error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/commitStockSweep', requirePermission('perm_reserve_store_stock'), async (req, res) => {
  const { sweepItems } = req.body;
  if (!sweepItems?.length) return res.json({ success: false, error: 'No items to sweep.' });

  const VALID_TYPES = ['Production Return', 'Count Correction', 'Found Stock', 'Blocked → Restricted', 'Blocked → RM Store'];
  for (const item of sweepItems) {
    const isBlockedExit = item.sweepType === 'Blocked → Restricted' || item.sweepType === 'Blocked → RM Store';
    if (isBlockedExit) {
      if (!item.allocationId) return res.json({ success: false, error: `${item.sweepType} requires a Blocked allocation to be selected.` });
      continue; // quantity is derived from the allocation itself, not user-entered
    }
    if (!(Number(item.quantity) > 0)) {
      return res.json({ success: false, error: `Quantity must be greater than zero for ${item.itemCode}. Stock Sweep is add-only.` });
    }
    if (item.sweepType && !VALID_TYPES.includes(item.sweepType)) {
      return res.json({ success: false, error: `Unknown sweep type "${item.sweepType}" for ${item.itemCode}.` });
    }
  }

  try {
    let itemsProcessed = 0;
    const notFound = [];
    const batchId = 'SWP-' + Date.now().toString(36).toUpperCase();
    const sweptBy = displayName(req);
    const sweepIds = [], touchedItemCodes = new Set(), newAssignmentIds = [];
    const touchedSpareItemCodes = new Set();

    await withTransaction(async (client) => {
      for (const item of sweepItems) {
        if (item.sweepType === 'Blocked → Restricted' || item.sweepType === 'Blocked → RM Store') {
          const { rows: [alloc] } = await client.query(
            `SELECT * FROM store.spare_blocked_allocations WHERE allocation_id = $1 AND freed_date IS NULL FOR UPDATE`,
            [item.allocationId]
          );
          if (!alloc) { notFound.push(`Allocation #${item.allocationId} (already freed or missing)`); continue; }
          const qty = Number(alloc.quantity);

          if (item.sweepType === 'Blocked → Restricted') {
            // Freed but still can't leave Spare Store — total_stock is
            // unchanged, only unusable_stock drops, so available_stock
            // (generated) picks up the difference automatically.
            await client.query(
              `UPDATE store.spare_store SET unusable_stock = GREATEST(0, unusable_stock - $1) WHERE item_code = $2`,
              [qty, alloc.item_code]
            );
            await client.query(
              `UPDATE store.spare_blocked_allocations SET freed_date = now(), freed_to = 'Restricted', freed_by = $1 WHERE allocation_id = $2`,
              [sweptBy, item.allocationId]
            );
            touchedSpareItemCodes.add(alloc.item_code);
            itemsProcessed++;
            continue;
          }

          // Blocked → RM Store: fully freed and returnable — leaves Spare
          // Store entirely and re-enters Raw stock the normal way, same as
          // any other sweep (auto-assigned against open BOQ claims first).
          await client.query(
            `UPDATE store.spare_store SET total_stock = GREATEST(0, total_stock - $1), unusable_stock = GREATEST(0, unusable_stock - $1) WHERE item_code = $2`,
            [qty, alloc.item_code]
          );
          await client.query(
            `UPDATE store.spare_blocked_allocations SET freed_date = now(), freed_to = 'RM Store', freed_by = $1 WHERE allocation_id = $2`,
            [sweptBy, item.allocationId]
          );
          touchedSpareItemCodes.add(alloc.item_code);

          const { rows: [ic] } = await client.query(
            `SELECT item_code, material_name, unit FROM design.item_codes WHERE item_code = $1`, [alloc.item_code]
          );
          if (!ic) { notFound.push(alloc.item_code); continue; }

          await client.query(
            `INSERT INTO store.raw_material_store (item_code, material_name, total_stock, unit_type, type_of_material)
             VALUES ($1, $2, $3, $4, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
             ON CONFLICT (item_code) DO UPDATE
               SET total_stock = store.raw_material_store.total_stock + EXCLUDED.total_stock`,
            [alloc.item_code, ic.material_name, qty, ic.unit || 'NOS']
          );
          const { assignmentIds, assigned, unassigned } =
            await autoAssignStock(client, alloc.item_code, ic.material_name, qty, sweptBy);
          const assignedTotal = assigned.reduce((s, a) => s + Number(a.quantity), 0);

          const { rows: [sweepRow] } = await client.query(
            `INSERT INTO store.stock_sweeps
               (batch_id, item_code, material_name, quantity, sweep_type, assigned_qty, swept_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING sweep_id`,
            [batchId, alloc.item_code, ic.material_name, qty, 'Blocked → RM Store', assignedTotal, sweptBy]
          );
          await recordReceiptAttributions(client,
            { eventType: 'SWEEP', sweepId: sweepRow.sweep_id, itemCode: alloc.item_code, createdBy: sweptBy },
            [
              ...assigned.map(a => ({ prnId: a.prnId, kind: 'auto_assign', quantity: a.quantity, assignmentId: a.assignmentId })),
              { prnId: null, kind: 'free_stock', quantity: unassigned },
            ]
          );
          sweepIds.push(sweepRow.sweep_id);
          newAssignmentIds.push(...assignmentIds);
          touchedItemCodes.add(alloc.item_code);
          itemsProcessed++;
          continue;
        }
        const { rows: [ic] } = await client.query(
          `SELECT item_code, material_name, unit FROM design.item_codes WHERE item_code = $1`, [item.itemCode]
        );
        if (!ic) { notFound.push(item.itemCode); continue; }

        const qty = Number(item.quantity);
        await client.query(
          `INSERT INTO store.raw_material_store (item_code, material_name, total_stock, unit_type, type_of_material)
           VALUES ($1, $2, $3, $4, (SELECT type_of_material FROM design.item_codes WHERE item_code = $1))
           ON CONFLICT (item_code) DO UPDATE
             SET total_stock = store.raw_material_store.total_stock + EXCLUDED.total_stock`,
          [item.itemCode, ic.material_name, qty, ic.unit || 'NOS']
        );

        const { assignmentIds, assigned, unassigned } =
          await autoAssignStock(client, item.itemCode, ic.material_name, qty, sweptBy);
        const assignedTotal = assigned.reduce((s, a) => s + Number(a.quantity), 0);

        const { rows: [sweepRow] } = await client.query(
          `INSERT INTO store.stock_sweeps
             (batch_id, item_code, material_name, quantity, sweep_type, assigned_qty, swept_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING sweep_id`,
          [batchId, item.itemCode, ic.material_name, qty, item.sweepType || 'Found Stock', assignedTotal, sweptBy]
        );

        // Same attribution trail QA writes, so Q/A Revision's
        // reversibility check can account for sweep-assigned stock
        // instead of seeing unexplained stock_assignments rows.
        await recordReceiptAttributions(client,
          { eventType: 'SWEEP', sweepId: sweepRow.sweep_id, itemCode: item.itemCode, createdBy: sweptBy },
          [
            ...assigned.map(a => ({ prnId: a.prnId, kind: 'auto_assign', quantity: a.quantity, assignmentId: a.assignmentId })),
            { prnId: null, kind: 'free_stock', quantity: unassigned },
          ]
        );

        sweepIds.push(sweepRow.sweep_id);
        newAssignmentIds.push(...assignmentIds);
        touchedItemCodes.add(item.itemCode);
        itemsProcessed++;
      }
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'StockSweeps', 'STOCK_SWEEP', batchId,
      `Stock sweep ${batchId}: ${itemsProcessed} item(s) processed, ${notFound.length} not found.`);
    newAssignmentIds.forEach(id => syncLiveRow('stock_reservations', id));
    touchedItemCodes.forEach(code => syncLiveRow('raw_material_store', code));
    touchedSpareItemCodes.forEach(code => syncLiveRow('spare_store', code));
    res.json({ success: true, batchId, itemsProcessed, notFound });
  } catch (err) {
    console.error('commitStockSweep error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// fetchExpectedDeliveries — reads PO delivery dates via PPS Tracking,
// bucketed into today/overdue/upcoming(7 days), auto-excluding lines
// that are fully settled (received + repaired, nothing outstanding).
// Received Qty = ledger ok_quantity (covers every GRN against this PO,
// including a second Gate Entry sent to replace missing/returned stock)
// PLUS whatever has already been repaired-and-restocked at ABPS — that
// credit lands straight in raw_material_store via commitRepairQAPipelineStep
// and never touches the ledger, so it has to be added here explicitly or
// a fully-repaired line stays stuck showing "Partial" forever.
// Being Repaired / Return-Missing buckets both read
// rejected_missing_material_tracking.pending_quantity, split by
// action_for_rejected_material — an ABPS-repair action means the pending
// qty is physically at ABPS being fixed; anything else (Return-to-Vendor
// actions, or a Missing row with no action at all) means it's outstanding
// with/from the vendor. Both buckets shrink automatically as pending_quantity
// drops — whether from an actual repair, an action being changed on the
// Action in Progress screen, or a Q/A Revision.
router.post('/searchPONumbersForExpectedDeliveries', requirePermission('perm_expected_deliveries'), async (req, res) => {
  const { query } = req.body;
  if (!query || query.toString().trim().length < 1) return res.json({ success: true, results: [] });
  try {
    const { rows } = await pool.query(
      `SELECT po_no AS "poNo", vendor_name AS "vendorName" FROM purchase.raw_material_purchase_orders
       WHERE status = 'Authorized' AND po_no ILIKE $1 ORDER BY order_date DESC LIMIT 10`,
      [`%${query.toString().trim()}%`]
    );
    res.json({ success: true, results: rows });
  } catch (err) {
    console.error('searchPONumbersForExpectedDeliveries error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchVendorNamesForExpectedDeliveries', requirePermission('perm_expected_deliveries'), async (req, res) => {
  const { query } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT vendor_name FROM purchase.vendor_information WHERE vendor_name ILIKE $1 ORDER BY vendor_name LIMIT 10`,
      [`%${(query || '').toString().trim()}%`]
    );
    res.json({ success: true, vendors: rows.map(r => r.vendor_name) });
  } catch (err) {
    console.error('searchVendorNamesForExpectedDeliveries error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchExpectedDeliveries', requirePermission('perm_expected_deliveries'), async (req, res) => {
  try {
    const filterMode = (req.body?.filterMode || '7').toString();
    const ABPS_REPAIR_ACTIONS = ['Ask ABPS to Repair at ABPS', 'Ask Vendor to repair at ABPS'];
    const { rows } = await pool.query(
      `SELECT po.po_no AS "poNo", po.vendor_name AS "vendorName", po.order_date AS "poDate",
              li.item_code AS "itemCode", li.description_of_material AS "materialName",
              li.unit AS "unit", li.quantity AS "orderedQty", li.delivery_date AS "expectedDelivery",
              COALESCE((SELECT SUM(l.ok_quantity) FROM store.inbound_store_ledger l
                        WHERE l.po_no = po.po_no AND l.item_code = li.item_code AND l.transaction_status = 'QA Passed'), 0) AS "ledgerOkQty",
              COALESCE((SELECT SUM(r.not_ok_quantity - r.pending_quantity)
                        FROM store.rejected_missing_material_tracking r
                        JOIN store.inbound_store_ledger l2 ON l2.grn_number = r.grn_number AND l2.item_code = r.item_code
                        WHERE l2.po_no = po.po_no AND r.item_code = li.item_code
                          AND r.action_for_rejected_material = ANY($1)), 0) AS "repairedSoFar",
              COALESCE((SELECT SUM(r.pending_quantity)
                        FROM store.rejected_missing_material_tracking r
                        JOIN store.inbound_store_ledger l2 ON l2.grn_number = r.grn_number AND l2.item_code = r.item_code
                        WHERE l2.po_no = po.po_no AND r.item_code = li.item_code
                          AND r.status <> 'Resolved' AND r.action_for_rejected_material = ANY($1)), 0) AS "repairPendingQty",
              COALESCE((SELECT SUM(r.pending_quantity)
                        FROM store.rejected_missing_material_tracking r
                        JOIN store.inbound_store_ledger l2 ON l2.grn_number = r.grn_number AND l2.item_code = r.item_code
                        WHERE l2.po_no = po.po_no AND r.item_code = li.item_code
                          AND r.status <> 'Resolved'
                          AND (r.action_for_rejected_material IS NULL OR NOT (r.action_for_rejected_material = ANY($1)))), 0) AS "returnMissingQty",
              COALESCE((SELECT MAX(l.qa_timestamp) FROM store.inbound_store_ledger l
                        WHERE l.po_no = po.po_no AND l.item_code = li.item_code AND l.transaction_status = 'QA Passed'), NULL) AS "lastLedgerQaTs",
              COALESCE((SELECT MAX(r.resolved_timestamp)
                        FROM store.rejected_missing_material_tracking r
                        JOIN store.inbound_store_ledger l2 ON l2.grn_number = r.grn_number AND l2.item_code = r.item_code
                        WHERE l2.po_no = po.po_no AND r.item_code = li.item_code), NULL) AS "lastRepairResolvedTs"
       FROM purchase.raw_material_po_line_items li
       JOIN purchase.raw_material_purchase_orders po ON po.po_no = li.po_no
       WHERE po.status = 'Authorized' AND li.delivery_date IS NOT NULL`,
      [ABPS_REPAIR_ACTIONS]
    );

    const now = new Date(); now.setHours(0, 0, 0, 0);
    const fmtDMY = (d) => {
      if (!d) return null;
      const x = new Date(d);
      return `${String(x.getDate()).padStart(2, '0')}-${String(x.getMonth() + 1).padStart(2, '0')}-${x.getFullYear()}`;
    };

    const byPo = {};
    rows.forEach(r => {
      if (!byPo[r.poNo]) byPo[r.poNo] = { poNo: r.poNo, vendorName: r.vendorName, poDate: r.poDate, lines: [] };
      byPo[r.poNo].lines.push(r);
    });

    const today = [], overdue = [], upcoming = [], delivered = [];
    const searchPoNo = (req.body?.poNumber || '').toString().trim().toLowerCase();
    const searchVendor = (req.body?.vendorName || '').toString().trim().toLowerCase();
    const searchMaterial = (req.body?.materialName || '').toString().trim().toLowerCase();

    Object.values(byPo).forEach(po => {
      const lineItems = po.lines.map(l => {
        const ordered = Number(l.orderedQty) || 0;
        const received = (Number(l.ledgerOkQty) || 0) + (Number(l.repairedSoFar) || 0);
        const repairQty = Number(l.repairPendingQty) || 0;
        const returnMissingQty = Number(l.returnMissingQty) || 0;
        const fullyReceived = repairQty === 0 && returnMissingQty === 0 && received >= ordered && ordered > 0;
        const lastQa = l.lastLedgerQaTs ? new Date(l.lastLedgerQaTs) : null;
        const lastRepair = l.lastRepairResolvedTs ? new Date(l.lastRepairResolvedTs) : null;
        const actualDeliveryDate = fullyReceived
          ? ((lastRepair && (!lastQa || lastRepair > lastQa)) ? lastRepair : lastQa)
          : null;
        return {
          itemCode: l.itemCode, materialName: l.materialName, orderedQty: ordered, receivedQty: received,
          repairQty, returnMissingQty, unit: l.unit || 'NOS', fullyReceived, actualDeliveryDate,
          partialReceived: !fullyReceived && (received > 0 || repairQty > 0 || returnMissingQty > 0),
        };
      });

      const allFullyReceived = lineItems.every(l => l.fullyReceived);

      if (filterMode === 'delivered') {
        if (!allFullyReceived) return;
        if (searchPoNo && !po.poNo.toLowerCase().includes(searchPoNo)) return;
        if (searchVendor && !(po.vendorName || '').toLowerCase().includes(searchVendor)) return;
        if (searchMaterial && !lineItems.some(l =>
              (l.materialName || '').toLowerCase().includes(searchMaterial) ||
              (l.itemCode || '').toLowerCase().includes(searchMaterial))) return;

        const allDates = po.lines.map(l => new Date(l.expectedDelivery)).filter(d => !isNaN(d));
        const earliestAll = allDates.length ? new Date(Math.min(...allDates.map(d => d.getTime()))) : null;
        const actualTimes = lineItems.map(l => l.actualDeliveryDate ? l.actualDeliveryDate.getTime() : 0);
        const actualDeliveryDate = actualTimes.length ? new Date(Math.max(...actualTimes)) : null;

        delivered.push({
          purchaseOrderId: po.poNo, poNumber: po.poNo, vendorName: po.vendorName,
          orderDate: fmtDMY(po.poDate),
          deliveryDate: earliestAll ? earliestAll.toISOString().slice(0, 10) : null,
          actualDeliveryDate: actualDeliveryDate ? actualDeliveryDate.toISOString().slice(0, 10) : null,
          lineItems, receivedCount: lineItems.length, totalCount: lineItems.length,
        });
        return;
      }

      if (allFullyReceived) return; // hide fully received POs from pending buckets

      // Even mid-flight, some lines may already be fully resolved (e.g. one
      // item repaired/replaced while another is still outstanding) — surface
      // the latest such activity now rather than waiting for the whole PO.
      const resolvedTimes = lineItems.filter(l => l.actualDeliveryDate).map(l => l.actualDeliveryDate.getTime());
      const partialActualDeliveryDate = resolvedTimes.length ? new Date(Math.max(...resolvedTimes)) : null;

      // Bucket the whole PO by the earliest expected date among its still-pending lines.
      const pendingDates = po.lines
        .filter((l, i) => !lineItems[i].fullyReceived)
        .map(l => new Date(l.expectedDelivery))
        .filter(d => !isNaN(d));
      if (pendingDates.length === 0) return;
      const earliest = new Date(Math.min(...pendingDates.map(d => d.getTime())));
      earliest.setHours(0, 0, 0, 0);
      const diffDays = Math.round((earliest - now) / (1000 * 60 * 60 * 24));
      const isToday = diffDays === 0, isOverdue = diffDays < 0, isUpcoming = diffDays > 0;

      let include;
      if (filterMode === 'overdue') include = isOverdue;
      else if (filterMode === 'today') include = isToday;
      else { const windowDays = parseInt(filterMode, 10) || 7; include = isOverdue || isToday || (isUpcoming && diffDays <= windowDays); }
      if (!include) return;

      const receivedCount = lineItems.filter(l => l.fullyReceived).length;
      const poObj = {
        purchaseOrderId: po.poNo, poNumber: po.poNo, vendorName: po.vendorName,
        orderDate: fmtDMY(po.poDate), deliveryDate: earliest.toISOString().slice(0, 10),
        actualDeliveryDate: partialActualDeliveryDate ? partialActualDeliveryDate.toISOString().slice(0, 10) : null,
        daysOverdue: isOverdue ? -diffDays : 0, daysRemaining: isUpcoming ? diffDays : 0,
        lineItems, receivedCount, totalCount: lineItems.length,
      };
      if (isToday) today.push(poObj);
      else if (isOverdue) overdue.push(poObj);
      else upcoming.push(poObj);
    });

    delivered.sort((a, b) => new Date(b.actualDeliveryDate || 0) - new Date(a.actualDeliveryDate || 0));

    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
    upcoming.sort((a, b) => a.daysRemaining - b.daysRemaining);

    res.json({ success: true, today, overdue, upcoming, delivered });
  } catch (err) {
    console.error('fetchExpectedDeliveries error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;