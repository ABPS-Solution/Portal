// ═══════════════════════════════════════════════════════════════════════
// routes/purchase.js — Purchase Request Notes, Vendor PO lifecycle,
// PPS Tracking, Stock Assignment.
// Ports: createPurchaseRequestNote, fetchBOQsNeedingPRNQueue,
//        fetchPRNsForProject, savePRNStoreQuantities, fetchVendorList,
//        commitPurchaseOrderDraft, fetchPendingPOsForAuthorization,
//        authorizePurchaseOrder, fetchPPSByProject, submitStockAssignment,
//        unassignStock
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const { pool, withTransaction } = require('../db');
const { requirePermission } = require('../auth');
const { writeAuditLog } = require('../lib/audit');
const { buildPRNPdfBuffer, generatePOPdf } = require('../lib/pdf');
const { syncLiveRow, removeLiveRow } = require('../lib/liveSync');
const { displayName } = require('../lib/displayName');
const { computePRNDeltaRows, applyPRNRows, refreshPRNCompletion,
        regeneratePRNDocument, applySilentPRNDecrease,
        completeDeferredUnwinds, applyStoreReservationSplit,
        splitStoreClaim, splitStoreRelease,
        claimStoreForPRN, releaseStoreClaimFromPRN } = require('../lib/prnSync');
const { convertHTMLToPDF } = require('../lib/pdfshift');
const { renderPurchaseOrderHTML } = require('../lib/poTemplate');
const { uploadPdf } = require('../lib/storage');
const { ensureNestedFolderPath, uploadFile } = require('../lib/drive');
const { parseRawMaterialPO, checkGeminiRateLimit } = require('../lib/gemini');

const router = express.Router();

// previewPRNMaterials — computes what createPurchaseRequestNote will need
// BEFORE the store person commits: per-material buffer math + delta
// detection. If a PRN already exists for this BOQ (nextVersion > 1),
// this is a "delta" PRN — required quantity is reduced by whatever this
// BOQ's requirement has ALREADY been covered by, life-to-date, across all
// prior rounds. "Covered" = store-assigned + purchase-committed, NOT just
// purchase-committed — the store portion is just as much "already handled"
// as the purchase portion (e.g. 50 store + 129 purchase = 179 already
// covered, not 129). prn_line_items is one row per item code for the
// whole life of the BOQ (never re-inserted per version), so this is a
// direct read of that row's cumulative totals, not a SUM across rows.
router.post('/previewPRNMaterials', requirePermission('perm_purchase_request_note'), async (req, res) => {
  const { projectId, boqId } = req.body;
  if (!projectId || !boqId) return res.json({ success: false, error: 'Project ID and BOQ ID are required.' });

  try {
    const { boq, prn, rows, isDeltaPRN, pureDecrease } = await computePRNDeltaRows(pool, boqId);

    const lineItems = rows.map(r => ({
      itemCode: r.itemCode, materialName: r.materialName, typeOfMaterial: r.typeOfMaterial,
      unit: r.unit, boqRequiredQty: r.boqRequiredQty, bufferPct: r.bufferPct,
      bufferedPurchaseQty: r.changeKind === 'new' ? r.bufferedRequirement : r.deltaRequirement,
      bufferedRequirement: r.bufferedRequirement,
      currentUnassignedStoreQty: r.changeKind === 'new' || r.changeKind === 'increase'
        ? r.storeDelta : r.newStoreTotal,
      purchaseQty: r.changeKind === 'new' || r.changeKind === 'increase'
        ? r.purchaseDelta : r.newPurchaseTotal,
      previousStoreQty: r.previousStoreQty, previousPurchaseQty: r.previousPurchaseQty,
      newStoreTotal: r.newStoreTotal, newPurchaseTotal: r.newPurchaseTotal,
      onOrderQty: r.onOrderQty, receivedQty: r.receivedQty, storeReleased: r.storeReleased || 0,
      availableStock: r.availableStock, changeKind: r.changeKind,
      storeFromRaw: r.storeFromRaw || 0, storeFromSpare: r.storeFromSpare || 0,
      editable: r.editable, deferred: r.deferred,
      checkedByStorePerson: r.editable ? 'No' : 'Yes',
    }));

    res.json({
      success: true, lineItems, isDeltaPRN, pureDecrease,
      nextVersion: prn ? (Number(prn.version) || 0) + 1 : 1,
      orderQty: boq.order_quantity,
    });
  } catch (err) {
    console.error('previewPRNMaterials error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// generateAndSavePRNPdf — persists the store person's final edits
// (checkedByStorePerson, adjusted store quantities) to prn_line_items,
// THEN generates and saves the PDF — one transaction so the PDF always
// reflects exactly what got committed, never a stale in-between state.
router.post('/generateAndSavePRNPdf', requirePermission('perm_purchase_request_note'), async (req, res) => {
  const { prnId, lineItems } = req.body;
  if (!prnId || !lineItems?.length) return res.json({ success: false, error: 'PRN ID and line items are required.' });

  const uncheckedRow = lineItems.find(it => (it.checkedByStorePerson || 'No') !== 'Yes');
  if (uncheckedRow) {
    return res.json({ success: false, error: `All rows must be marked "Checked by Store Person = Yes" before generating. "${uncheckedRow.materialName}" is not checked yet.` });
  }

  try {
    const { rows: [prn] } = await pool.query(`SELECT * FROM purchase.purchase_request_notes WHERE prn_id = $1`, [prnId]);
    if (!prn) return res.json({ success: false, error: 'PRN not found.' });

    await pool.query(
      `UPDATE purchase.purchase_request_notes SET draft_line_items = $1 WHERE prn_id = $2 AND status = 'Pending Authorization'`,
      [JSON.stringify(lineItems), prnId]
    );

    // PDF generation intentionally removed from this route — PRN PDFs
    // are now generated exactly once, at authorization (authorizePRN
    // below), matching legacy's single-PDF-per-lifecycle model. This
    // route only persists the store person's edits pre-authorization.
    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseRequestNotes', 'SAVE_STORE_QUANTITIES', prnId,
      'Store quantities confirmed and saved, pending authorization.');
    res.json({ success: true });
  } catch (err) {
    console.error('generateAndSavePRNPdf error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// BOQs that are Authorized but don't yet have an open PRN, or where the
// BOQ order quantity increased since the last PRN version (delta case).
router.post('/fetchBOQsNeedingPRNQueue', requirePermission('perm_purchase_request_note'), async (req, res) => {
  const { badgeFilter } = req.body; // 'New' | 'Revised' | undefined (both)
  try {
    // Only surface BOQs that genuinely need PRN action: no PRN yet at
    // all ("New"), or the BOQ has been revised since its last PRN
    // ("Updated" — a delta PRN is available). Previously this had no
    // such filter at all (every Authorized BOQ showed up forever, even
    // ones already fully covered), AND the columns weren't aliased to
    // camelCase — the frontend's row renderer calls .replace() on
    // item.projectId, which was always undefined, throwing inside the
    // .map() and silently emptying the whole queue via the outer catch.
    const { rows } = await pool.query(
      `SELECT b.boq_id AS "boqId", b.project_id AS "projectId", b.product_name AS "productName",
              b.product_rating AS "productRating", b.order_quantity AS "orderQuantity",
              b.customer_name AS "customerName", b.version AS "boqVersion",
              COALESCE(p.boq_version_applied, 0) AS "latestPrnVersion"
       FROM design.boq_drafts b
       LEFT JOIN purchase.purchase_request_notes p ON p.boq_id = b.boq_id
       WHERE b.status = 'Authorized' AND b.version > COALESCE(p.boq_version_applied, 0)
       ORDER BY b.project_id`
    );
    let queue = rows.map(r => ({
      ...r,
      badge: r.latestPrnVersion === 0 ? 'New' : 'Revised',
    }));
    if (badgeFilter) queue = queue.filter(q => q.badge === badgeFilter);
    res.json({ success: true, queue });
  } catch (err) {
    console.error('fetchBOQsNeedingPRNQueue error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// createPurchaseRequestNote — computes buffered quantity per line item
// (BOQ required qty × (1 + buffer%)) and writes the PRN + line items
// atomically. Mirrors the buffer math + count-unit rounding (NOS items
// round up) from code.js's computePRNLineItemsPreview.
router.post('/createPurchaseRequestNote', requirePermission('perm_purchase_request_note'), async (req, res) => {
  const { projectId, boqId, productName, productRating, orderQuantity, customerName,
          lineItems } = req.body;
  // created_by is the raising user's own name, resolved server-side from
  // their session (never a client-supplied value, never their email — per
  // explicit decision, admin_db.users.email must never be stored or shown
  // here). The FK to admin_db.users(email) was dropped for this reason;
  // duplicate names across users are an accepted, low-probability risk.
  const storePerson = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim();

  if (!projectId || !boqId) {
    return res.json({ success: false, error: 'Project ID and BOQ ID are required.' });
  }
  if (!lineItems?.length) {
    return res.json({ success: false, error: 'No material rows to save.' });
  }
  // All rows now require confirmation — decrease/removed rows became
  // operator-editable too (they can proactively free store stock ahead
  // of a PO revision), so they need the same sign-off as any other row.
  const unchecked = lineItems.find(it =>
    (it.checkedByStorePerson || '').toString().trim().toLowerCase() !== 'yes');
  if (unchecked) {
    return res.json({
      success: false,
      error: `All material rows must be marked "Checked by Store Person = Yes". "${unchecked.materialName || unchecked.itemCode}" is not checked yet.`,
    });
  }

  try {
    const prnId = await withTransaction(async (client) => {
      // prn_id is now stable and deterministic — same format as boqId,
      // PRN_ prefix instead of BOQ_ — so ONE row exists per BOQ for its
      // whole lifecycle (mirrors boq_drafts being one row per boq_id).
      // A second/delta PRN for the same BOQ UPDATEs this row in place
      // instead of inserting a new one.
      const prnId = 'PRN_' + String(boqId || '').replace(/^BOQ_/, '');

      const { rows: [existing] } = await client.query(
        `SELECT * FROM purchase.purchase_request_notes WHERE prn_id = $1 FOR UPDATE`,
        [prnId]
      );
      if (existing && existing.status === 'Pending Authorization') {
        throw new Error(`This BOQ already has a PRN awaiting authorization (${existing.prn_id}, raised by ${existing.created_by || 'someone'}). It must be authorized or rejected before another PRN can be created.`);
      }
      const version = existing ? (Number(existing.version) || 0) + 1 : 1;

      // Recomputed from live BOQ + PRN state, NOT taken from the client.
      // The only client-controlled value is the store/purchase split on
      // increase rows — and that is re-clamped against stock that is
      // actually free right now, under FOR UPDATE, because the preview
      // the operator saw may be minutes stale and another PRN may have
      // claimed the same units in between.
      const computed = await computePRNDeltaRows(client, boqId);
      const clientByItemCode = Object.fromEntries((lineItems || []).map(it => [it.itemCode, it]));

      const draftRows = [];
      for (const row of computed.rows) {
        if (!row.editable) {
          // Decrease/removed rows are editable in the Revise PRN screen
          // too — the store person can claim MORE than the automatic
          // unwind gives, or release further. This used to unconditionally
          // discard whatever was sent for these rows and keep only the
          // server's auto-computed values — any edit made to a
          // DECREASED/REMOVED row was silently thrown away here.
          const sent = clientByItemCode[row.itemCode];
          const autoTotal = Number(row.newStoreTotal) || 0;
          const editedTotal = sent && sent.currentUnassignedStoreQty !== undefined && sent.currentUnassignedStoreQty !== null
            ? Math.max(0, parseFloat(sent.currentUnassignedStoreQty) || 0)
            : autoTotal;

          if (Math.abs(editedTotal - autoTotal) < 1e-9) { draftRows.push(row); continue; }

          const priorSpare = Number(row.storeFromSpare) || 0;
          const priorRaw = Number(row.storeFromRaw) || 0;
          const priorTotal = priorSpare + priorRaw;

          let newSpare, newRaw;
          if (editedTotal >= priorTotal) {
            // Net claim beyond what this row already holds — reserved
            // IMMEDIATELY, same as any 'increase' row just below, so
            // another PRN can't take the same stock while this one sits
            // pending authorization.
            const extra = editedTotal - priorTotal;
            const split = await splitStoreClaim(client, row.itemCode, extra);
            newSpare = priorSpare + split.fromSpare;
            newRaw = priorRaw + split.fromRaw;
            await applyStoreReservationSplit(client, row.itemCode, newSpare - priorSpare, newRaw - priorRaw);
          } else {
            // Net release beyond the automatic unwind — raw-first,
            // deliberately left for the SAME deferred-release mechanism
            // every ordinary decrease already uses (applied later, at
            // authorize/applySilentPRNDecrease), not applied here.
            const release = priorTotal - editedTotal;
            const releaseRaw = Math.min(release, priorRaw);
            const releaseSpare = Math.min(release - releaseRaw, priorSpare);
            newSpare = priorSpare - releaseSpare;
            newRaw = priorRaw - releaseRaw;
          }

          const isClaim = editedTotal >= priorTotal;

          // Recomputed against the true buffered BOQ requirement, even
          // when deferred — the DB purchase_quantity moves with it right
          // away; only the actual on-order stock stays pinned until a PO
          // revision, tracked separately via awaiting_po_revision, which
          // completeDeferredUnwinds recomputes fresh each time rather
          // than trusting this stored value as a sentinel.
          const bufferedReq = Number(row.bufferedRequirement) || 0;
          const rawPurchase = Math.max(0, bufferedReq - editedTotal);
          const newPurchaseTotal = row.isCountUnit ? Math.ceil(rawPurchase - 1e-9) : rawPurchase;

          draftRows.push({
            ...row,
            storeDelta: editedTotal - priorTotal,
            purchaseDelta: newPurchaseTotal - (Number(row.previousPurchaseQty) || 0),
            newStoreTotal: editedTotal,
            newPurchaseTotal,
            storeFromSpareDelta: newSpare - priorSpare,
            storeFromRawDelta: newRaw - priorRaw,
            // A release is deferred (not actually applied until
            // authorization), so this row's TRUE currently-held split is
            // still priorRaw/priorSpare, not the reduced target — only a
            // real immediate CLAIM changes what's actually held right now.
            storeFromRaw: isClaim ? newRaw : priorRaw,
            storeFromSpare: isClaim ? newSpare : priorSpare,
            reservationApplied: isClaim,
            alreadyReserved: true,
          });
          continue;
        }

        const sent = clientByItemCode[row.itemCode];
        const target = row.changeKind === 'new' ? row.bufferedRequirement : row.deltaRequirement;

        // sent.currentUnassignedStoreQty is the ABSOLUTE final Store
        // Quantity the screen shows/pre-fills (previousStoreQty already
        // included) — NOT an incremental add-on. A 'new' row's
        // previousStoreQty is always 0, so this collapses to the same
        // thing for that case; an 'increase' row (previousStoreQty > 0,
        // this PRN already holds that much) needs it subtracted out to
        // get the real NEW claim, or "70 already held + wants 120 total"
        // gets misread as "wants 120 MORE units", requiring 120 live
        // free stock instead of the actual 50 needed.
        let storeDelta = row.storeDelta;
        if (sent && sent.currentUnassignedStoreQty !== undefined && sent.currentUnassignedStoreQty !== null) {
          const absoluteRequested = Math.max(0, parseFloat(sent.currentUnassignedStoreQty) || 0);
          storeDelta = absoluteRequested - (Number(row.previousStoreQty) || 0);
        }

        // Raw + spare combined — matches what the screen actually shows
        // and caps against. The real reservation split (spare first,
        // then raw) happens later via splitStoreClaim; this is purely
        // the re-validation gate before that point, and must use the
        // same combined total or it can reject a claim the later step
        // would have happily fulfilled.
        const { rows: [invRaw] } = await client.query(
          `SELECT COALESCE(available_stock, 0) AS available_stock
           FROM store.raw_material_store WHERE item_code = $1 FOR UPDATE`,
          [row.itemCode]
        );
        const { rows: [invSpare] } = await client.query(
          `SELECT COALESCE(available_stock, 0) AS available_stock
           FROM store.spare_store WHERE item_code = $1 FOR UPDATE`,
          [row.itemCode]
        );
        const freeNow = (invRaw ? parseFloat(invRaw.available_stock) || 0 : 0)
                       + (invSpare ? parseFloat(invSpare.available_stock) || 0 : 0);
        if (storeDelta > freeNow + 1e-9) {
          throw new Error(`Only ${freeNow} of ${row.itemCode} is still free in store (you asked for ${storeDelta}). Someone else may have claimed it. Reopen the screen to see current stock.`);
        }
        if (storeDelta > target + 1e-9) storeDelta = target;

        const rawPurchase = Math.max(0, target - storeDelta);
        const purchaseDelta = row.isCountUnit ? Math.ceil(rawPurchase - 1e-9) : rawPurchase;

        draftRows.push({
          ...row,
          storeDelta, purchaseDelta,
          newStoreTotal: row.previousStoreQty + storeDelta,
          newPurchaseTotal: row.previousPurchaseQty + purchaseDelta,
        });
      }
      if (draftRows.length === 0) throw new Error('Nothing to record — this BOQ is already fully covered by its PRN.');

      // Stock IS reserved at creation (per explicit decision) so a
      // pending PRN holds its store quantity and a second requester
      // can't claim the same stock. Spare stock is drawn from FIRST,
      // then raw — this MUST run before draft_line_items is persisted
      // below, not after: computed.rows carries only computePRNDeltaRows'
      // SUGGESTED split (against the full available pool), which is
      // stale the moment the store person edits the quantity down. If
      // the DB write captured that stale suggestion instead of the real
      // reservation split, the Authorize screen would display numbers
      // that don't match what was actually reserved — the reservation
      // itself would still be correct, only the displayed figures wrong.
      for (const row of draftRows) {
        if (row.alreadyReserved) continue;
        if ((row.storeDelta || 0) > 0) {
          const split = await splitStoreClaim(client, row.itemCode, row.storeDelta);
          await applyStoreReservationSplit(client, row.itemCode, split.fromSpare, split.fromRaw);
          row.storeFromSpareDelta = split.fromSpare;
          row.storeFromRawDelta = split.fromRaw;
          row.storeFromRaw = (Number(row.storeFromRaw) || 0) + split.fromRaw;
          row.storeFromSpare = (Number(row.storeFromSpare) || 0) + split.fromSpare;
          row.reservationApplied = true;
        } else {
          row.storeFromSpareDelta = 0;
          row.storeFromRawDelta = 0;
          row.reservationApplied = false;
        }
      }

      if (existing) {
        // Delta PRN: this row already holds a previously-authorized,
        // authoritative PRN. Snapshot its current state before
        // overwriting so rejectPurchaseRequestNote can restore it
        // exactly, rather than destroying real history.
        // boq_version_applied is captured in the snapshot too — this is
        // what was actually missing. It gets bumped to the NEW BOQ
        // version right here, immediately, before this delta PRN is ever
        // authorized. Without it in the snapshot, rejecting the delta
        // correctly restored everything else but left boq_version_applied
        // stuck at the new version forever, permanently hiding the BOQ
        // from "BOQs Needing a PRN" even though nothing was ever applied.
        const snapshot = {
          project_id: existing.project_id, product_name: existing.product_name, product_rating: existing.product_rating,
          order_quantity: existing.order_quantity, created_by: existing.created_by, status: existing.status,
          version: existing.version, draft_line_items: existing.draft_line_items,
          authorized_by: existing.authorized_by, authorized_at: existing.authorized_at, pdf_url: existing.pdf_url,
          boq_version_applied: existing.boq_version_applied,
        };
        await client.query(
          `UPDATE purchase.purchase_request_notes
           SET project_id = $1, product_name = $2, product_rating = $3, order_quantity = $4,
               created_by = $5, status = 'Pending Authorization', version = $6,
               draft_line_items = $7, previous_snapshot = $8,
               boq_version_applied = (SELECT version FROM design.boq_drafts WHERE boq_id = purchase.purchase_request_notes.boq_id)
           WHERE prn_id = $9`,
          [projectId, productName, productRating, orderQuantity, storePerson, version,
           JSON.stringify(draftRows), JSON.stringify(snapshot), prnId]
        );
      } else {
        await client.query(
          `INSERT INTO purchase.purchase_request_notes
             (prn_id, project_id, boq_id, product_name, product_rating, order_quantity, created_by, status, version, draft_line_items, boq_version_applied)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending Authorization',$8,$9,
                   (SELECT version FROM design.boq_drafts WHERE boq_id = $3))`,
          [prnId, projectId, boqId, productName, productRating, orderQuantity, storePerson, version, JSON.stringify(draftRows)]
        );
      }

      return prnId;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseRequestNotes', 'CREATE', prnId,
      `PRN created for BOQ ${boqId} with ${lineItems.length} line items — pending authorization.`);
    syncLiveRow('purchase_request_notes', prnId);

    // No PDF at this stage: the PRN isn't final until authorized, and
    // the authorizer may still change store quantities. The PDF is
    // generated in authorizePurchaseRequestNote instead.
    res.json({ success: true, prnId, pendingAuthorization: true });
  } catch (err) {
    console.error('createPurchaseRequestNote error:', err);
    res.status(500).json({ success: false, error: 'PRN creation failed: ' + err.message });
  }
});

// fetchPendingPRNsForAuthorization — the authorize queue. draft_line_items
// carries the proposed rows (prn_line_items doesn't exist yet at this
// stage), so the authorize screen can render and edit them. pendingKind
// distinguishes a BOQ-driven delta from a store/purchase re-split — both
// sit in the same pending state on the same row.
router.post('/fetchPendingPRNsForAuthorization', requirePermission('perm_authorize_prn'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.prn_id AS "prnId", p.project_id AS "projectId", p.boq_id AS "boqId",
              p.product_name AS "productName", p.product_rating AS "productRating",
              p.order_quantity AS "orderQuantity", p.created_by AS "storePerson",
              p.version, p.draft_line_items AS "draftLineItems", p.created_date AS "createdDate",
              b.customer_name AS "customerName",
              CASE WHEN p.previous_snapshot IS NOT NULL THEN 'Revision' ELSE 'Delta' END AS "pendingKind",
              COALESCE((SELECT SUM(li.still_to_order_quantity)
                        FROM purchase.prn_line_items li WHERE li.prn_id = p.prn_id), 0) AS "stillToOrder"
       FROM purchase.purchase_request_notes p
       LEFT JOIN design.boq_drafts b ON b.boq_id = p.boq_id
       WHERE p.status = 'Pending Authorization'
       ORDER BY p.created_date ASC`
    );
    res.json({ success: true, prns: rows });
  } catch (err) {
    console.error('fetchPendingPRNsForAuthorization error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// authorizePurchaseRequestNote — the sign-off step. The authorizer may
// edit each line's store quantity (which recomputes purchase quantity);
// those edited values are what get committed. Only here do
// prn_line_items rows come into existence, which is also what makes
// this PRN's quantities visible to future delta-PRN calculations.
router.post('/authorizePurchaseRequestNote', requirePermission('perm_authorize_prn'), async (req, res) => {
  const { prnId, editedLineItems, authorizedBy } = req.body;
  if (!prnId) return res.json({ success: false, error: 'PRN ID is required.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows: [prn] } = await client.query(
        `SELECT * FROM purchase.purchase_request_notes
         WHERE prn_id = $1 AND status = 'Pending Authorization' FOR UPDATE`,
        [prnId]
      );
      if (!prn) throw new Error('PRN not found, or it is no longer pending authorization.');

      // Maker-checker: the Store Person who raised the PRN cannot also
      // authorize it, unless they're Admin. created_by holds a name
      // (never an email), so compare against the authorizing session's
      // own resolved name.
      const authorizerName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim();
      if (prn.created_by && prn.created_by === authorizerName && !req.user.perm_admin) {
        throw new Error('The Store Person who raised this PRN cannot also authorize it. Please have a different authorized person confirm this.');
      }

      const draftRows = prn.draft_line_items || [];
      const editedByItemCode = Object.fromEntries((editedLineItems || []).map(it => [it.itemCode, it]));

      const finalRows = [];
      for (const draft of draftRows) {
        // Decrease/removed rows are now editable too — the authorizer can
        // claim MORE than the automatic unwind gives, or release further
        // beyond it. Recomputed from scratch relative to what this row
        // ACTUALLY holds right now in prn_line_items (not layered as an
        // "extra" on top of the auto amount) — this exactly matches
        // Revise PRN's resplit math and lets the existing deferred-release
        // step below apply the result in one step with no double-count.
        if (draft.editable === false) {
          const edited = editedByItemCode[draft.itemCode];
          const editedTotal = edited && edited.currentUnassignedStoreQty !== undefined && edited.currentUnassignedStoreQty !== null
            ? Math.max(0, parseFloat(edited.currentUnassignedStoreQty) || 0)
            : Number(draft.newStoreTotal) || 0;
          const autoTotal = Number(draft.newStoreTotal) || 0;

          if (Math.abs(editedTotal - autoTotal) < 1e-9) { finalRows.push(draft); continue; }

          const { rows: [curLi] } = await client.query(
            `SELECT store_qty_from_spare, store_qty_from_raw, purchase_quantity
             FROM purchase.prn_line_items WHERE prn_id = $1 AND item_code = $2 FOR UPDATE`,
            [prnId, draft.itemCode]
          );
          const priorSpare = curLi ? Number(curLi.store_qty_from_spare) || 0 : 0;
          const priorRaw = curLi ? Number(curLi.store_qty_from_raw) || 0 : 0;
          const priorTotal = priorSpare + priorRaw;
          const curPurchase = curLi ? Number(curLi.purchase_quantity) || 0 : 0;

          let newSpare, newRaw;
          const isClaim = editedTotal >= priorTotal;
          if (isClaim) {
            const extra = editedTotal - priorTotal;
            const split = await splitStoreClaim(client, draft.itemCode, extra);
            newSpare = priorSpare + split.fromSpare;
            newRaw = priorRaw + split.fromRaw;
            // Net claim — apply immediately (same as any other claim), so
            // another PRN can't take the same stock meanwhile. The
            // deferred-release loop further below only fires when
            // storeDelta < 0, so this can never double-apply.
            await applyStoreReservationSplit(client, draft.itemCode, newSpare - priorSpare, newRaw - priorRaw);
          } else {
            const release = priorTotal - editedTotal;
            const releaseRaw = Math.min(release, priorRaw);
            const releaseSpare = Math.min(release - releaseRaw, priorSpare);
            newSpare = priorSpare - releaseSpare;
            newRaw = priorRaw - releaseRaw;
            // Net release — deliberately left for the deferred post-loop
            // step below, same as every ordinary decrease, so a rejection
            // never has to re-acquire stock another PRN may have claimed.
          }

          // Recomputed against the true buffered BOQ requirement, even
          // when deferred — see the matching comment in
          // createPurchaseRequestNote. The actual on-order stock stays
          // pinned until a PO revision; only purchase_quantity itself
          // moves immediately to reflect what's really needed now.
          const bufferedReq = Number(draft.bufferedRequirement) || 0;
          const newPurchaseTotalRaw = Math.max(0, bufferedReq - editedTotal);
          const newPurchaseTotal = draft.isCountUnit ? Math.ceil(newPurchaseTotalRaw - 1e-9) : newPurchaseTotalRaw;

          // A material fully zeroed out both ways (store freed entirely,
          // no purchase pending/frozen) drops off this PRN completely —
          // nothing left to track here. If it's deferred with a nonzero
          // frozen purchase, it still needs a row so the PO-revision
          // unwind has something to find later, even at Store Qty 0.
          if (editedTotal < 1e-9 && newPurchaseTotal < 1e-9) { continue; }

          finalRows.push({
            ...draft,
            storeDelta: editedTotal - priorTotal,
            purchaseDelta: newPurchaseTotal - curPurchase,
            newStoreTotal: editedTotal,
            newPurchaseTotal,
            storeFromSpareDelta: newSpare - priorSpare,
            storeFromRawDelta: newRaw - priorRaw,
            // Same rule as createPurchaseRequestNote: a release here is
            // still deferred (not applied to raw_material_store), so this
            // row's true currently-held split stays priorRaw/priorSpare
            // unless this was an immediate claim.
            storeFromRaw: isClaim ? newRaw : priorRaw,
            storeFromSpare: isClaim ? newSpare : priorSpare,
            reservationApplied: isClaim,
          });
          continue;
        }

        const edited = editedByItemCode[draft.itemCode];
        const isResplit = draft.changeKind === 'resplit';
        // 'new' and 'resplit' rows both use bufferedRequirement as an
        // ABSOLUTE cap (the full requirement); 'increase' rows use
        // deltaRequirement, an incremental cap for this round only.
        const target = (draft.changeKind === 'new' || isResplit) ? draft.bufferedRequirement : draft.deltaRequirement;
        const prevStore = Number(draft.previousStoreQty) || 0;

        // storeDelta always ends up meaning "change vs previousStoreQty"
        // below, but the authorizer's EDITED INPUT means something
        // different depending on changeKind: for new/increase rows the
        // Store Quantity field is itself an incremental amount (0..target);
        // for a resplit row (Revise PRN re-split) it's the ABSOLUTE new
        // store total, same convention the Revise PRN screen itself uses.
        let storeDelta;
        if (isResplit) {
          let absoluteStore = Number(draft.newStoreTotal) || 0;
          if (edited && edited.currentUnassignedStoreQty !== undefined && edited.currentUnassignedStoreQty !== null) {
            absoluteStore = Math.max(0, parseFloat(edited.currentUnassignedStoreQty) || 0);
          }
          if (absoluteStore > (Number(target) || 0) + 1e-9) absoluteStore = Number(target) || 0;
          storeDelta = absoluteStore - prevStore;
        } else {
          storeDelta = Number(draft.storeDelta) || 0;
          if (edited && edited.currentUnassignedStoreQty !== undefined && edited.currentUnassignedStoreQty !== null) {
            // The frontend input holds the ABSOLUTE new store total
            // (matching Revise PRN's own convention), not an incremental
            // add-on — subtract prevStore to get the real marginal claim,
            // or "70 already held, typed 120 total" gets misread as
            // "claim 120 more", requiring far more free stock than the
            // actual 50 needed.
            const absoluteRequested = Math.max(0, parseFloat(edited.currentUnassignedStoreQty) || 0);
            storeDelta = absoluteRequested - prevStore;
          }
          if (storeDelta > (Number(target) || 0) + 1e-9) storeDelta = Number(target) || 0;
        }

        // Creation already reserved draft's own spare/raw split. Only
        // the DIFFERENCE the authorizer introduced needs moving.
        const reservationDelta = storeDelta - (Number(draft.storeDelta) || 0);
        let adjSpareDelta = 0, adjRawDelta = 0;
        if (reservationDelta > 1e-9) {
          const split = await splitStoreClaim(client, draft.itemCode, reservationDelta);
          adjSpareDelta = split.fromSpare; adjRawDelta = split.fromRaw;
        } else if (reservationDelta < -1e-9) {
          const releaseAmt = -reservationDelta;
          if (isResplit) {
            // Matches Revise PRN's own raw-first release convention —
            // release from what this row ACTUALLY holds right now
            // (newStoreFromRaw/newStoreFromSpare, the absolute split),
            // not the delta recorded at submission. Releasing against
            // the delta here would be wrong the moment the authorizer's
            // further edit differs from what was originally submitted.
            const curRaw = Number(draft.newStoreFromRaw) || 0;
            const curSpare = Number(draft.newStoreFromSpare) || 0;
            const releaseRaw = Math.min(releaseAmt, curRaw);
            const releaseSpare = Math.min(releaseAmt - releaseRaw, curSpare);
            adjRawDelta = -releaseRaw; adjSpareDelta = -releaseSpare;
          } else {
            // Raw-first release, NOT splitStoreRelease() (which is
            // spare-first) — matching the resplit branch just above and
            // the explicit priority decision: a reduction always tops
            // Raw back up first, only spilling into Spare once Raw is
            // fully restored to what this PRN originally drew from it.
            // Using splitStoreRelease() here previously released Spare
            // first instead, which is why a reduced Store Quantity was
            // freeing less Spare than expected.
            const priorSpare = Number(draft.storeFromSpareDelta) || 0;
            const priorRaw = Number(draft.storeFromRawDelta) || 0;
            const releaseRaw = Math.min(releaseAmt, priorRaw);
            const releaseSpare = Math.min(releaseAmt - releaseRaw, priorSpare);
            adjSpareDelta = -releaseSpare; adjRawDelta = -releaseRaw;
          }
        }
        if (Math.abs(reservationDelta) > 1e-9) {
          await applyStoreReservationSplit(client, draft.itemCode, adjSpareDelta, adjRawDelta);
        }

        const newStoreTotal = prevStore + storeDelta;
        // Resplit's target is the ABSOLUTE requirement, so purchase is
        // target minus the absolute new store total. New/increase rows'
        // target is itself incremental, so purchase is target minus the
        // incremental store amount — unchanged from before.
        const rawPurchase = isResplit
          ? Math.max(0, (Number(target) || 0) - newStoreTotal)
          : Math.max(0, (Number(target) || 0) - storeDelta);
        const purchaseAbs = draft.isCountUnit ? Math.ceil(rawPurchase - 1e-9) : rawPurchase;
        const newPurchaseTotal = isResplit ? purchaseAbs : (Number(draft.previousPurchaseQty) || 0) + purchaseAbs;
        const purchaseDelta = isResplit ? (newPurchaseTotal - (Number(draft.previousPurchaseQty) || 0)) : purchaseAbs;

        finalRows.push({
          ...draft, storeDelta, purchaseDelta,
          newStoreTotal, newPurchaseTotal,
          storeFromSpareDelta: (Number(draft.storeFromSpareDelta) || 0) + adjSpareDelta,
          storeFromRawDelta: (Number(draft.storeFromRawDelta) || 0) + adjRawDelta,
          newStoreFromRaw: (Number(draft.newStoreFromRaw) || 0) + adjRawDelta,
          newStoreFromSpare: (Number(draft.newStoreFromSpare) || 0) + adjSpareDelta,
        });
      }

      // Decrease rows release their freed store stock now — deliberately
      // NOT at creation, so a rejected decrease never has to re-acquire
      // units another PRN may have claimed while it sat pending.
      for (const row of finalRows) {
        if (row.editable === false && (Number(row.storeDelta) || 0) < 0) {
          const spareQty = Number(row.storeFromSpareDelta) || 0;
          const rawQty = Number(row.storeFromRawDelta) || 0;
          await applyStoreReservationSplit(client, row.itemCode, spareQty, rawQty);
        }
      }

      await applyPRNRows(client, prnId, finalRows, prn.created_by);

      // Reuses authorizerName already resolved above for the
      // maker-checker check — never client-supplied, guaranteed a name
      // not an email, and declaring it a second time here would collide
      // with that existing const in the same function scope.
      await client.query(
        `UPDATE purchase.purchase_request_notes
         SET status = 'PRN Generated', authorized_by = $1, authorized_at = now(),
             draft_line_items = $2, previous_snapshot = NULL
         WHERE prn_id = $3`,
        [authorizerName, JSON.stringify(finalRows), prnId]
      );

      // A store-only PRN (every line purchase 0) is procurement-complete
      // the moment it authorizes — nothing will ever be ordered or GRNed
      // against it, so waiting for a receipt would leave it open forever.
      await refreshPRNCompletion(client, prnId);

      // A BOQ decrease that arrived while this PRN was pending was
      // skipped rather than stored. Re-run it now the PRN is settled —
      // deriving it fresh means nothing can be lost if the PRN had been
      // rejected instead, and no reconciliation job is needed.
      await applySilentPRNDecrease(client, prn.boq_id, displayName(req));

      // PDF generated INSIDE the transaction, on the same client — a
      // failure here throws and rolls back the entire authorization
      // (reservations, prn_line_items, status change, all of it) rather
      // than leaving an "authorized but undocumented" partial state.
      const pdfUrl = await regeneratePRNDocument(prnId, client);

      return { prn, finalRows, pdfUrl };
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseRequestNotes', 'AUTHORIZE', prnId,
      `PRN authorized for BOQ ${result.prn.boq_id} with ${result.finalRows.length} line items.`);
    syncLiveRow('purchase_request_notes', prnId);

    res.json({ success: true, prnId, pdfUrl: result.pdfUrl });
  } catch (err) {
    console.error('authorizePurchaseRequestNote error:', err);
    res.status(400).json({ success: false, error: 'PRN authorization failed and was fully rolled back: ' + err.message });
  }
});

router.post('/fetchOpenPRNsForItemCode', requirePermission('perm_create_rm_po'), async (req, res) => {
  const { itemCode } = req.body;
  if (!itemCode) return res.json({ success: true, prns: [] });
  try {
    const { rows } = await pool.query(
      `SELECT p.prn_id AS "prnId", p.project_id AS "projectId", p.boq_id AS "boqId",
              p.product_name AS "productName", p.product_rating AS "productRating", p.authorized_at AS "authorizedAt",
              li.material_name AS "materialName",
              li.still_to_order_quantity AS "stillToOrder"
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
       WHERE li.item_code = $1 AND p.status = 'PRN Generated' AND li.still_to_order_quantity > 0
       ORDER BY p.authorized_at ASC NULLS LAST, p.created_date ASC`,
      [itemCode]
    );
    res.json({ success: true, prns: rows });
  } catch (err) {
    console.error('fetchOpenPRNsForItemCode error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// rejectPurchaseRequestNote — closes a pending PRN without creating any
// line items, and releases the full store reservation taken at creation.
// The BOQ is then free for a corrected PRN.
router.post('/rejectPurchaseRequestNote', requirePermission('perm_authorize_prn'), async (req, res) => {
  const { prnId, rejectionReason } = req.body;
  if (!prnId) return res.json({ success: false, error: 'PRN ID is required.' });

  try {
    const boqId = await withTransaction(async (client) => {
      const { rows: [prn] } = await client.query(
        `SELECT * FROM purchase.purchase_request_notes
         WHERE prn_id = $1 AND status = 'Pending Authorization' FOR UPDATE`,
        [prnId]
      );
      if (!prn) throw new Error('PRN not found, or it is no longer pending authorization.');

      for (const row of (prn.draft_line_items || [])) {
        // A resplit revision's rows are always applied immediately in
        // BOTH directions (claim or release), so those always reverse.
        // A delta PRN's row only reverses if reservationApplied says it
        // was actually applied — a claim (storeDelta > 0). A delta PRN's
        // decrease/removed RELEASE is deliberately deferred, never
        // touching raw_material_store at creation; reversing it here
        // double-applies a release that never happened, pushing
        // reserved_stock past total_stock and tripping chk_stock_nonneg.
        // Drafts saved before this flag existed fall back to the sign of
        // storeDelta, which has always correctly implied claim-vs-release
        // for every delta PRN row historically.
        const wasApplied = row.changeKind === 'resplit' ? true
          : (row.reservationApplied !== undefined ? row.reservationApplied : (Number(row.storeDelta) || 0) > 0);
        if (!wasApplied) continue;
        const spareQty = Number(row.storeFromSpareDelta) || 0;
        const rawQty = Number(row.storeFromRawDelta) || 0;
        if (Math.abs(spareQty) > 1e-9 || Math.abs(rawQty) > 1e-9) {
          await applyStoreReservationSplit(client, row.itemCode, -spareQty, -rawQty);
        }
      }

      if (prn.previous_snapshot) {
        // Delta PRN rejected — restore the prior authoritative state
        // exactly (the row already existed as an authorized PRN before
        // this pending edit overwrote it) rather than deleting real history.
        // boq_version_applied restored too — see the comment at the
        // snapshot's creation site in createPurchaseRequestNote.
        const snap = prn.previous_snapshot;
        await client.query(
          `UPDATE purchase.purchase_request_notes
           SET project_id = $1, product_name = $2, product_rating = $3, order_quantity = $4,
               created_by = $5, status = $6, version = $7, draft_line_items = $8,
               authorized_by = $9, authorized_at = $10, pdf_url = $11, previous_snapshot = NULL,
               boq_version_applied = $12
           WHERE prn_id = $13`,
          [snap.project_id, snap.product_name, snap.product_rating, snap.order_quantity, snap.created_by,
           snap.status, snap.version, JSON.stringify(snap.draft_line_items), snap.authorized_by, snap.authorized_at,
           snap.pdf_url, snap.boq_version_applied, prnId]
        );
      } else {
        // First-ever PRN for this BOQ — nothing authoritative existed
        // before it, so reject means exactly what it says: as if it
        // was never created.
        await client.query(`DELETE FROM purchase.purchase_request_notes WHERE prn_id = $1`, [prnId]);
      }
      return prn.boq_id;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseRequestNotes', 'REJECT', prnId,
      `PRN rejected for BOQ ${boqId}; store reservations released.${rejectionReason ? ' Reason: ' + rejectionReason : ''}`);
    // Harmless no-op if this was a first-ever PRN that got hard-deleted —
    // syncLiveRow finds zero rows and returns quietly. Real limitation
    // worth knowing: liveSync only ever upserts, it never deletes a row
    // that's since vanished from Sheets, so a deleted PRN's old
    // "Pending Authorization" line stays visible in the sheet until the
    // next full partial/scheduled resync overwrites the whole tab.
    syncLiveRow('purchase_request_notes', prnId);
    res.json({ success: true });
  } catch (err) {
    console.error('rejectPurchaseRequestNote error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/fetchPRNsForProject', async (req, res) => {
  const { projectId } = req.body;
  try {
    // Was `SELECT *` with no aliasing — every frontend field read as
    // p.boqId/p.status/etc. was silently undefined (snake_case columns,
    // camelCase reads), so "does a PRN already exist for this BOQ" could
    // never match and the screen always fell through to "No PRN exists
    // yet", regardless of what was actually in the table.
    const { rows: prns } = await pool.query(
      `SELECT p.prn_id AS "prnId", p.project_id AS "projectId", p.boq_id AS "boqId",
              p.product_name AS "productName", p.product_rating AS "productRating",
              p.order_quantity AS "orderQuantity", p.created_by AS "storePerson",
              p.status, p.version, p.pdf_url AS "pdfUrl", p.draft_line_items AS "draftLineItems",
              b.customer_name AS "customerName", b.version AS "boqVersion", b.status AS "boqDraftStatus",
              (b.version > COALESCE(p.boq_version_applied, 0)) AS "boqUpdatedSincePRN",
              EXISTS (SELECT 1 FROM design.boq_update_requests u
                      WHERE u.boq_id = p.boq_id AND u.status = 'Pending Authorization Update') AS "hasPendingBoqUpdate"
       FROM purchase.purchase_request_notes p
       LEFT JOIN design.boq_drafts b ON b.boq_id = p.boq_id
       WHERE p.project_id = $1
       ORDER BY p.created_date DESC`,
      [projectId]
    );
    for (const prn of prns) {
      // boqStatus drives the frontend's "pending vs already-updated"
      // badge: a pending update request takes priority over the plain
      // version-behind comparison, since the update itself isn't
      // authorized yet and a delta PRN shouldn't be started against it.
      prn.boqStatus = prn.hasPendingBoqUpdate ? 'Pending Authorization Update' : (prn.boqDraftStatus || 'Authorized');

      const { rows: lineItems } = await pool.query(
        `SELECT item_code AS "itemCode", material_name AS "materialName",
                type_of_material AS "typeOfMaterial", unit_type AS "unit",
                boq_required_quantity AS "boqRequiredQty", buffer_percent AS "bufferPct",
                buffered_purchase_quantity AS "bufferedPurchaseQty",
                current_unassigned_store_quantity AS "currentUnassignedStoreQty",
                purchase_quantity AS "purchaseQty"
         FROM purchase.prn_line_items WHERE prn_id = $1 AND buffered_purchase_quantity > 0
         ORDER BY item_code`,
        [prn.prnId]
      );
      // prn_line_items is genuinely empty while a PRN is Pending
      // Authorization — that table is only populated on authorize. For
      // the view-only card, fall back to the pending draft, normalized
      // into the SAME field shape as the authoritative rows above, so
      // the frontend needs only one rendering path regardless of status.
      if (prn.status === 'Pending Authorization') {
        prn.lineItems = (prn.draftLineItems || []).map(r => ({
          itemCode: r.itemCode, materialName: r.materialName, typeOfMaterial: r.typeOfMaterial,
          unit: r.unit,
          boqRequiredQty: r.boqRequiredQty,
          bufferPct: r.bufferPct,
          bufferedPurchaseQty: r.bufferedRequirement ?? Math.abs(r.deltaRequirement ?? 0),
          currentUnassignedStoreQty: r.newStoreTotal ?? r.storeDelta ?? 0,
          purchaseQty: r.newPurchaseTotal ?? r.purchaseDelta ?? 0,
        }));
      } else {
        prn.lineItems = lineItems;
      }
    }
    res.json({ success: true, prns });
  } catch (err) {
    console.error('fetchPRNsForProject error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Revise PRN (store ↔ purchase re-split) ───────────────────────────────
// Distinct from a delta PRN: the BOQ requirement has NOT changed, only how
// it is being covered. The classic case is stock coming back from
// production — more is free in store, so less needs buying.
//
// Only store quantity is editable; purchase is always the remainder of the
// buffered requirement. Version bumps, but boq_version_applied does NOT —
// this is not a response to a BOQ revision, and treating it as one would
// mask a genuinely unapplied BOQ change from the needs-a-PRN queue.

router.post('/fetchPRNForRevision', requirePermission('perm_revise_prn'), async (req, res) => {
  const { prnId } = req.body;
  if (!prnId) return res.json({ success: false, error: 'PRN ID is required.' });
  try {
    const { rows: [prn] } = await pool.query(
      `SELECT p.prn_id AS "prnId", p.project_id AS "projectId", p.boq_id AS "boqId",
              p.product_name AS "productName", p.product_rating AS "productRating",
              p.order_quantity AS "orderQuantity", p.version, p.status,
              b.customer_name AS "customerName"
       FROM purchase.purchase_request_notes p
       LEFT JOIN design.boq_drafts b ON b.boq_id = p.boq_id
       WHERE p.prn_id = $1`, [prnId]
    );
    if (!prn) return res.json({ success: false, error: 'PRN not found.' });
    if (prn.status !== 'PRN Generated') {
      return res.json({ success: false, error: `This PRN is "${prn.status}" — only an authorized, still-open PRN can be revised.` });
    }

    const { rows: lineItems } = await pool.query(
      `SELECT li.item_code AS "itemCode", li.material_name AS "materialName",
              li.unit_type AS "unit", li.buffer_percent AS "bufferPct",
              li.boq_required_quantity AS "boqRequiredQty",
              li.buffered_purchase_quantity AS "bufferedRequirement",
              li.current_unassigned_store_quantity AS "storeQty",
              li.purchase_quantity AS "purchaseQty",
              li.on_order_quantity AS "onOrderQty",
              li.received_quantity AS "receivedQty",
              li.awaiting_po_revision AS "awaitingPoRevision",
              li.store_qty_from_raw AS "storeFromRaw", li.store_qty_from_spare AS "storeFromSpare",
              COALESCE(mi.available_stock, 0) AS "availableStock"
       FROM purchase.prn_line_items li
       LEFT JOIN store.raw_material_store mi ON mi.item_code = li.item_code
       WHERE li.prn_id = $1 AND li.buffered_purchase_quantity > 0
       ORDER BY li.item_code`, [prnId]
    );
    res.json({ success: true, prn, lineItems });
  } catch (err) {
    console.error('fetchPRNForRevision error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/submitPRNRevision', requirePermission('perm_revise_prn'), async (req, res) => {
  const { prnId, lineItems, reason } = req.body;
  if (!prnId || !lineItems?.length) {
    return res.json({ success: false, error: 'PRN ID and at least one revised line are required.' });
  }
  const revisedBy = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim();

  try {
    const allDraftRows = await withTransaction(async (client) => {
      const { rows: [prn] } = await client.query(
        `SELECT * FROM purchase.purchase_request_notes WHERE prn_id = $1 FOR UPDATE`, [prnId]);
      if (!prn) throw new Error('PRN not found.');
      if (prn.status !== 'PRN Generated') {
        throw new Error(`This PRN is "${prn.status}" — only an authorized, still-open PRN can be revised.`);
      }

      const sentByItemCode = Object.fromEntries(lineItems.map(li => [li.itemCode, li]));

      // Every open line item on the PRN is carried into draft_line_items,
      // not just the ones the store person actually touched — the
      // Authorize PRN Revision screen needs full context (what didn't
      // change matters just as much to a reviewer as what did). Untouched
      // lines pass through with wasChanged:false and no reservation
      // movement at all.
      const { rows: allLineItems } = await client.query(
        `SELECT * FROM purchase.prn_line_items WHERE prn_id = $1 AND buffered_purchase_quantity > 0 FOR UPDATE`,
        [prnId]);

      // buffered_purchase_quantity on this row is whatever was last
      // committed — it does NOT auto-update when the BOQ changes.
      // Queried directly against the current BOQ's own material list
      // rather than routed through computePRNDeltaRows — that function
      // is built to report DELTAS relative to what's already applied,
      // and can omit an item entirely once it considers nothing further
      // pending for it, which silently produced the stale answer here.
      // A material with no entry at all in the current BOQ (fully
      // removed) unambiguously has a true requirement of 0.
      const { rows: currentBoqMaterials } = await client.query(
        `SELECT bd.item_code, bd.qty_for_1_set, COALESCE(mbp.buffer_percent, 0) AS buffer_percent
         FROM design.bill_of_quantity bd
         LEFT JOIN design.item_codes ic ON ic.item_code = bd.item_code
         LEFT JOIN purchase.material_buffer_percentage mbp ON mbp.type_of_material = ic.type_of_material
         WHERE bd.boq_id = $1
           AND lower(regexp_replace(bd.type_of_store, '\\s+', '', 'g')) IN ('rawmaterialsstore', 'rawmaterial')`,
        [prn.boq_id]
      );
      const { rows: [boqHeader] } = await client.query(
        `SELECT order_quantity FROM design.boq_drafts WHERE boq_id = $1`, [prn.boq_id]
      );
      const boqOrderQty = Number(boqHeader?.order_quantity) || 0;
      const freshByItemCode = {};
      currentBoqMaterials.forEach(m => {
        const boqReq = (Number(m.qty_for_1_set) || 0) * boqOrderQty;
        const bufferPct = Number(m.buffer_percent) || 0;
        const raw = boqReq * (1 + bufferPct / 100);
        freshByItemCode[m.item_code] = bufferPct > 0 ? Math.ceil(raw - 1e-9) : raw;
      });

      for (const itemCode of Object.keys(sentByItemCode)) {
        if (!allLineItems.some(li => li.item_code === itemCode)) {
          throw new Error(`${itemCode} is not on this PRN. A revision cannot add or remove materials — that only happens through a BOQ revision.`);
        }
      }

      const draftRows = [];
      for (const li of allLineItems) {
        const itemCode = li.item_code;
        const sent = sentByItemCode[itemCode];

        // Fresh BOQ-driven requirement when this item still has an active
        // delta relative to what's applied; otherwise nothing changed on
        // the BOQ side for it, so the currently-committed column is correct.
        // A material fully removed from the current BOQ has no entry
        // here at all — that's a real, unambiguous requirement of 0,
        // not "unknown, fall back to the stale column".
        const requirement = freshByItemCode[itemCode] !== undefined ? freshByItemCode[itemCode] : 0;
        const curStore    = Number(li.current_unassigned_store_quantity) || 0;
        const curPurchase = Number(li.purchase_quantity) || 0;
        const onOrder     = Number(li.on_order_quantity) || 0;
        const isCountUnit = (li.unit_type || '').toString().trim().toUpperCase() === 'NOS';

        // No change requested for this line — carry it through as
        // context, still editable on the Authorize Revision screen, just
        // with nothing to reserve/release at submission.
        if (!sent) {
          // Nothing typed for this item doesn't mean nothing changed —
          // the fresh BOQ-driven requirement can differ from what's
          // currently committed even with Store Qty untouched (e.g. an
          // item removed from the BOQ entirely, where there's nothing to
          // type since the box already shows 0). Recompute against the
          // fresh requirement with the store side held at its current
          // value, rather than blindly carrying forward the old purchase
          // quantity.
          const untouchedRawPurchase = Math.max(0, requirement - curStore);
          const untouchedNewPurchase = isCountUnit ? Math.ceil(untouchedRawPurchase - 1e-9) : untouchedRawPurchase;
          const untouchedPurchaseDelta = untouchedNewPurchase - curPurchase;
          draftRows.push({
            itemCode, materialName: li.material_name, typeOfMaterial: li.type_of_material,
            unit: li.unit_type, bufferPct: Number(li.buffer_percent) || 0,
            boqRequiredQty: Number(li.boq_required_quantity) || 0,
            bufferedRequirement: requirement, isCountUnit,
            changeKind: 'resplit', editable: true, deferred: false,
            wasChanged: Math.abs(untouchedPurchaseDelta) > 1e-9,
            previousStoreQty: curStore, previousPurchaseQty: curPurchase,
            storeDelta: 0, purchaseDelta: untouchedPurchaseDelta,
            storeFromSpareDelta: 0, storeFromRawDelta: 0,
            newStoreFromRaw: Number(li.store_qty_from_raw) || 0,
            newStoreFromSpare: Number(li.store_qty_from_spare) || 0,
            newStoreTotal: curStore, newPurchaseTotal: untouchedNewPurchase,
            onOrderQty: onOrder, receivedQty: Number(li.received_quantity) || 0,
            storeReleased: 0,
          });
          continue;
        }

        if (li.awaiting_po_revision) {
          throw new Error(`${itemCode} is awaiting a PO revision from an earlier BOQ change — resolve that first.`);
        }

        const newStore = Math.max(0, Number(sent.newStoreQty) || 0);
        if (newStore > requirement + 1e-9) {
          throw new Error(`${itemCode}: store quantity ${newStore} exceeds the requirement of ${requirement}.`);
        }

        const rawPurchase = Math.max(0, requirement - newStore);
        const newPurchase = isCountUnit ? Math.ceil(rawPurchase - 1e-9) : rawPurchase;

        const storeDelta = newStore - curStore;
        const purchaseDelta = newPurchase - curPurchase;
        const wasChanged = Math.abs(storeDelta) > 1e-9 || Math.abs(purchaseDelta) > 1e-9;

        // A re-split CAN cut purchase below what is already on order —
        // the intended workflow is to revise the PRN first and reconcile
        // the linked PO afterward. This is safe to allow: submitting this
        // revision bumps the PRN's version regardless of the reason, and
        // fetchPOsNeedingRevision's "PRN Revisions Needing PO Revision"
        // queue triggers purely on that version number moving past what
        // the PO last reconciled against — so the linked PO always
        // correctly surfaces there afterward, needing no special-casing
        // for "why" the version changed.

        // Claiming more reserves it now, spare-first — matching every
        // other claim in the system, and exactly what the Revise PRN
        // screen already shows live as it's being typed. Releasing
        // happens immediately too (unlike a delta PRN's decrease, a
        // re-split's release has nowhere to be deferred to), raw-first
        // per explicit decision — capped at what THIS line actually
        // holds in each pool, never a live-pool guess.
        const priorSpare = Number(li.store_qty_from_spare) || 0;
        const priorRaw = Number(li.store_qty_from_raw) || 0;
        let storeFromSpareDelta = 0, storeFromRawDelta = 0;
        if (storeDelta > 1e-9) {
          const split = await splitStoreClaim(client, itemCode, storeDelta);
          await applyStoreReservationSplit(client, itemCode, split.fromSpare, split.fromRaw);
          storeFromSpareDelta = split.fromSpare;
          storeFromRawDelta = split.fromRaw;
        } else if (storeDelta < -1e-9) {
          const releaseAmt = -storeDelta;
          const releaseRaw = Math.min(releaseAmt, priorRaw);
          const releaseSpare = Math.min(releaseAmt - releaseRaw, priorSpare);
          await applyStoreReservationSplit(client, itemCode, -releaseSpare, -releaseRaw);
          storeFromSpareDelta = -releaseSpare;
          storeFromRawDelta = -releaseRaw;
        }

        draftRows.push({
          itemCode, materialName: li.material_name, typeOfMaterial: li.type_of_material,
          unit: li.unit_type, bufferPct: Number(li.buffer_percent) || 0,
          boqRequiredQty: Number(li.boq_required_quantity) || 0,
          bufferedRequirement: requirement, isCountUnit,
          changeKind: 'resplit', editable: true, deferred: false, wasChanged,
          previousStoreQty: curStore, previousPurchaseQty: curPurchase,
          storeDelta, purchaseDelta,
          storeFromSpareDelta, storeFromRawDelta,
          newStoreFromRaw: priorRaw + storeFromRawDelta,
          newStoreFromSpare: priorSpare + storeFromSpareDelta,
          newStoreTotal: newStore, newPurchaseTotal: newPurchase,
          onOrderQty: onOrder, receivedQty: Number(li.received_quantity) || 0,
          storeReleased: storeDelta < 0 ? -storeDelta : 0,
          reservationApplied: true,
        });
      }

      if (!draftRows.some(r => r.wasChanged)) throw new Error('Nothing changed — every line still has its current store quantity.');

      // Same pending mechanism as a delta PRN, deliberately: one pending
      // change per PRN at a time. editable:true now (unlike before) so
      // the authorizer can adjust any line, changed or not, exactly like
      // a Delta PRN's authorize screen.
      const snapshot = {
        project_id: prn.project_id, product_name: prn.product_name, product_rating: prn.product_rating,
        order_quantity: prn.order_quantity, created_by: prn.created_by, status: prn.status,
        version: prn.version, draft_line_items: prn.draft_line_items,
        authorized_by: prn.authorized_by, authorized_at: prn.authorized_at, pdf_url: prn.pdf_url,
      };
      await client.query(
        `UPDATE purchase.purchase_request_notes
         SET status = 'Pending Authorization', version = $1, created_by = $2,
             draft_line_items = $3, previous_snapshot = $4
         WHERE prn_id = $5`,
        [(Number(prn.version) || 1) + 1, revisedBy, JSON.stringify(draftRows),
         JSON.stringify(snapshot), prnId]);

      return draftRows;
    });

    const changed = allDraftRows.filter(r => r.wasChanged);
    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseRequestNotes', 'REVISE_SUBMIT', prnId,
      `Store/purchase re-split submitted for ${changed.length} material(s): ` +
      changed.map(c => `${c.itemCode} store ${c.previousStoreQty}→${c.newStoreTotal}, purchase ${c.previousPurchaseQty}→${c.newPurchaseTotal}`).join('; ') +
      (reason ? `. Reason: ${reason}` : ''));
    syncLiveRow('purchase_request_notes', prnId);

    res.json({ success: true, prnId, changed });
  } catch (err) {
    console.error('submitPRNRevision error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Aggregated bulk purchase ledger ─────────────────────────────────────
// Groups open PRN line items by item code across all projects — the
// "aggregated purchasing structure" from the narrative doc, so a
// purchasing agent sees one line for a component across every project
// shortfall instead of chasing separate PRNs.
router.post('/fetchMaterialListForPurchase', requirePermission('perm_material_list_purchase'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH pending_allocs AS (
         -- Quantities already committed in a PO that's drafted but not yet
         -- authorized. on_order_quantity/still_to_order_quantity on
         -- prn_line_items don't reflect this yet (deliberately — see
         -- authorizePurchaseOrder/rejectPurchaseOrder — a rejected PO
         -- must leave zero trace there), so without this a second
         -- purchaser would see the full still-to-order amount as if
         -- nothing were already being bought and could duplicate-order
         -- it. This is display-only: nothing here writes to
         -- prn_line_items, so the "reject leaves no trace" guarantee
         -- is untouched.
         SELECT (alloc->>'prnId') AS prn_id,
                (li->>'itemCode') AS item_code,
                SUM((alloc->>'quantity')::numeric) AS pending_qty
         FROM purchase.raw_material_purchase_orders p,
              jsonb_array_elements(p.material_rows::jsonb) AS li,
              jsonb_array_elements(COALESCE(li->'allocations', '[]'::jsonb)) AS alloc
         WHERE p.status = 'Pending Authorization'
         GROUP BY 1, 2
       )
       SELECT li.item_code AS "itemCode", li.material_name AS "materialName",
              li.type_of_material AS "typeOfMaterial", li.unit_type AS "unit",
              p.project_id AS "projectId", li.prn_id AS "prnId",
              SUM(li.boq_required_quantity) AS "boqRequiredQty",
              SUM(li.buffered_purchase_quantity) AS "bufferedPurchaseQty",
              SUM(li.assigned_quantity) AS "assignedQty",
              SUM(li.on_order_quantity) AS "onOrderQty",
              SUM(GREATEST(0, li.still_to_order_quantity - COALESCE(pa.pending_qty, 0))) AS "stillToOrderQty"
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
       LEFT JOIN pending_allocs pa ON pa.prn_id = li.prn_id AND pa.item_code = li.item_code
       WHERE p.status = 'PRN Generated'
       GROUP BY li.item_code, li.material_name, li.type_of_material, li.unit_type, p.project_id, li.prn_id
       HAVING SUM(GREATEST(0, li.still_to_order_quantity - COALESCE(pa.pending_qty, 0))) > 0
       ORDER BY li.item_code`
    );
    res.json({ success: true, materials: rows });
  } catch (err) {
    console.error('fetchMaterialListForPurchase error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Vendor + Purchase Order ─────────────────────────────────────────────

// fetchProjectsAwaitingMaterial — for the Create PO screen's per-row
// project picker. Returns only projects that genuinely still need THIS
// item code purchased: i.e. they have an authorized, not-yet-closed PRN
// whose line for this item still has quantity outstanding.
// still_to_order_quantity is the live "not yet covered by a PO" figure
// (seeded to purchase_quantity at PRN authorization and decremented as
// POs are raised), so a project drops off the list once fully ordered.
router.post('/fetchProjectsAwaitingMaterial', requirePermission('perm_create_rm_po'), async (req, res) => {
  const { itemCode } = req.body;
  if (!itemCode) return res.json({ success: true, prns: [] });
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT p.project_id AS "projectId",
              SUM(li.still_to_order_quantity) AS "outstandingQty"
       FROM purchase.prn_line_items li
       JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
       WHERE li.item_code = $1 AND p.status NOT IN ('Closed', 'Rejected', 'Pending Authorization')
         AND COALESCE(li.still_to_order_quantity, 0) > 0
       GROUP BY p.project_id
       ORDER BY p.project_id`,
      [itemCode]
    );
    res.json({ success: true, prns: rows });
  } catch (err) {
    console.error('fetchOpenPRNsForItemCode error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchVendorList', requirePermission('perm_create_rm_po'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT vendor_name AS "vendorName", gstin_uin AS "gstin", type_of_vendor AS "typeOfVendor",
              contact_person AS "contactPerson", phone_number AS "phoneNumber", email,
              city, state, state_code AS "stateCode",
              cgst_percent AS "cgstPercent", sgst_percent AS "sgstPercent", igst_percent AS "igstPercent",
              address, status
       FROM purchase.vendor_information WHERE status = 'Active' ORDER BY vendor_name`
    );
    res.json({ success: true, vendors: rows });
  } catch (err) {
    console.error('fetchVendorList error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PO_{FY}_{5-digit seq}, resetting per financial year — ported from the
// legacy code.js reference implementation (generatePONumber_ /
// getCurrentFinancialYearLabel_), which documented this exact format but
// was never carried over when this route moved to Postgres; until now
// po_no came from a plain DB sequence default ("PO-1", "PO-2", ...).
function getCurrentFinancialYearLabel() {
  // Indian FY: Apr-Mar. Returns e.g. "25-26" for a date in Jan 2026.
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0=Jan
  const startYY = (m >= 3) ? (y % 100) : ((y - 1) % 100);
  const endYY = (startYY + 1) % 100;
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return `${pad(startYY)}-${pad(endYY)}`;
}

async function generatePONumber(client) {
  // Serializes concurrent PO creation so two simultaneous requests can't
  // read the same max sequence and collide — pg_advisory_xact_lock
  // auto-releases at transaction end/rollback, no separate unlock call.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('po_number_gen'))`);
  const fy = getCurrentFinancialYearLabel();
  const prefix = `PO_${fy}_`;
  const { rows } = await client.query(
    `SELECT po_no FROM purchase.raw_material_purchase_orders WHERE po_no LIKE $1`,
    [`${prefix}%`]
  );
  let maxSeq = 0;
  for (const { po_no } of rows) {
    const seq = parseInt(po_no.slice(prefix.length), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(5, '0')}`;
}

// commitPurchaseOrderDraft — creates ONLY the PO header row, as a draft
// awaiting authorization. Line items, PRN allocations (pps_tracking),
// and on_order_quantity flagging do NOT happen here anymore — they only
// happen at authorization (see authorizePurchaseOrder below), so that a
// rejected/never-authorized PO leaves zero trace anywhere except its own
// now-deleted header row. Allocation validation still runs here too, for
// early feedback, but it's advisory only — the real, lock-protected
// commit happens again at authorize time regardless.
router.post('/commitPurchaseOrderDraft', requirePermission('perm_create_rm_po'), async (req, res) => {
  // Each line item now carries its own deliveryDate and an explicit
  // allocations array — [{ prnId, quantity }] — replacing the old single
  // sourcePrnId. One PO routinely covers several PRNs (and several
  // projects), and how much of the ordered quantity belongs to each is a
  // purchasing decision, not something the system can infer.
  const { vendorName, orderDate, deliveryDate, lineItems, warranty, paymentTerms, freightTerms,
          preparedBy, supplierRef,
          cgstPercent, sgstPercent, igstPercent, packing, freight, other, roundOff } = req.body;

  if (!vendorName || !lineItems?.length) {
    return res.json({ success: false, error: 'Vendor and at least one line item are required.' });
  }

  // Never fall back to req.user.email here — this becomes the "Prepared
  // By" signature on the PO PDF a vendor actually sees, same "always a
  // name, never an email" standard the PRN documents follow. The client
  // always sends preparedBy (the operator's resolved display name), so
  // this only matters in a degraded edge case, but the fallback chain
  // should still end at a name, not an account identifier.
  const resolvedPreparedBy = preparedBy || req.body.operatorName ||
    `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Unknown';

  try {
    const poNo = await withTransaction(async (client) => {
      // Advisory validation only — nothing is locked or committed here.
      // Re-validated for real (under FOR UPDATE) at authorize time, which
      // is the actual commit point now.
      for (const li of lineItems) {
        const lineQty = Number(li.quantity) || 0;
        const allocs = (li.allocations || [])
          .filter(a => a && a.prnId && (Number(a.quantity) || 0) > 0);
        const allocSum = allocs.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
        if (allocSum > lineQty + 1e-9) {
          throw new Error(`${li.itemCode}: allocated ${allocSum} across PRNs, but the PO line is only ${lineQty}. Reduce the allocations or raise the ordered quantity.`);
        }
      }

      // Line amount is computed here, not taken from the payload: the
      // frontend sends quantity/rate/discountPercent but no `amount`
      // field, so the previous `li.amount || 0` summed undefined and
      // stored sub_total = 0 on every PO. Formula matches code.js:
      // amount = qty x rate x (100 - discount) / 100.
      const lineAmount = (li) =>
        (Number(li.quantity) || 0) * (Number(li.rate) || 0) * (100 - (Number(li.discountPercent) || 0)) / 100;
      const subTotal = lineItems.reduce((sum, li) => sum + lineAmount(li), 0);

      const cgstP = Number(cgstPercent) || 0, sgstP = Number(sgstPercent) || 0, igstP = Number(igstPercent) || 0;
      const cgstAmt = subTotal * cgstP / 100, sgstAmt = subTotal * sgstP / 100, igstAmt = subTotal * igstP / 100;
      const packingAmt = Number(packing) || 0, freightAmt = Number(freight) || 0;
      const otherAmt = Number(other) || 0, roundOffAmt = Number(roundOff) || 0;
      const grandTotal = subTotal + cgstAmt + sgstAmt + igstAmt + packingAmt + freightAmt + otherAmt + roundOffAmt;

      const poNo = await generatePONumber(client);
      await client.query(
        `INSERT INTO purchase.raw_material_purchase_orders
           (po_no, vendor_name, order_date, delivery_date, material_rows, sub_total, grand_total, warranty,
            payment_terms, freight_terms, prepared_by, supplier_ref_offer_no,
            cgst_percent, cgst_amount, sgst_percent, sgst_amount, igst_percent, igst_amount,
            packing_amount, freight_amount, other_amount, round_off, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'Pending Authorization')`,
        [poNo, vendorName, orderDate, deliveryDate, JSON.stringify(lineItems), subTotal, grandTotal,
         warranty, paymentTerms, freightTerms, resolvedPreparedBy, supplierRef || null,
         cgstP, cgstAmt, sgstP, sgstAmt, igstP, igstAmt, packingAmt, freightAmt, otherAmt, roundOffAmt]
      );
      syncLiveRow('raw_material_purchase_orders', poNo);

      return poNo;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'RawMaterialPurchaseOrders', 'CREATE', poNo,
      `PO drafted for vendor "${vendorName}" with ${lineItems.length} line items, pending authorization.`);

    // No PDF is generated at draft stage — the document doesn't exist
    // until the PO is actually authorized (see authorizePurchaseOrder ->
    // regeneratePODocument), which is also the only place it's ever
    // written to Drive with the real folder/file naming. A draft-stage
    // PDF was previously rendered here and pushed to a flat GCS path,
    // but that's gone now — deliberately, not an oversight.
    res.json({ success: true, poNo });
  } catch (err) {
    console.error('commitPurchaseOrderDraft error:', err);
    res.status(500).json({ success: false, error: 'PO creation failed: ' + err.message });
  }
});

router.post('/fetchPendingPOsForAuthorization', requirePermission('perm_authorize_rm_po'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT po_no AS "poNumber", vendor_name AS "vendorName", order_date AS "orderDate",
              grand_total AS "grandTotal", prepared_by AS "preparedBy", created_at AS "createdAt"
       FROM purchase.raw_material_purchase_orders
       WHERE status = 'Pending Authorization' ORDER BY created_at ASC`
    );
    res.json({ success: true, pos: rows });
  } catch (err) {
    console.error('fetchPendingPOsForAuthorization error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fetchPODraftById', requirePermission('perm_authorize_rm_po'), async (req, res) => {
  const { poNo } = req.body;
  try {
    const { rows: [po] } = await pool.query(
      `SELECT po_no AS "poNumber", vendor_name AS "vendorName", supplier_ref_offer_no AS "supplierRef",
              order_date AS "orderDate", delivery_date AS "deliveryDate", status, material_rows AS "materialRows",
              cgst_percent AS "cgstPercent", sgst_percent AS "sgstPercent", igst_percent AS "igstPercent",
              packing_amount AS "packing", freight_amount AS "freight", other_amount AS "other",
              round_off AS "roundOff", warranty, payment_terms AS "paymentTerms", freight_terms AS "freightTerms",
              prepared_by AS "preparedBy", authorized_by AS "authorizedBy", revision_number AS "revisionNumber"
       FROM purchase.raw_material_purchase_orders WHERE po_no = $1`, [poNo]);
    if (!po) return res.json({ success: false, error: 'PO not found.' });
    // material_rows is the source of truth here, not the physical line
    // items table — a Pending Authorization PO has no rows there at all
    // (line items only get written at authorize time now), and unlike
    // the physical table, material_rows already carries each line's
    // `allocations` array, so this is also how PRN allocations survive
    // into the edit form instead of always coming back empty.
    const lineItems = Array.isArray(po.materialRows) ? po.materialRows : [];
    delete po.materialRows;
    res.json({ success: true, po: { ...po, lineItems } });
  } catch (err) {
    console.error('fetchPODraftById error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// authorizePurchaseOrder — this is now the REAL commit point, not just a
// status flip. Line items, PRN allocations (pps_tracking), and
// on_order_quantity flagging all happen here for the first time — a
// draft PO (commitPurchaseOrderDraft) never touched any of that, so an
// operator can freely edit everything except the vendor (locked, since
// changing vendor mid-flow would orphan whatever was already reviewed
// against it) right up until the moment of authorization. Accepts the
// same shape as commitPurchaseOrderDraft, plus poNo to identify which
// pending PO this commits.
router.post('/authorizePurchaseOrder', requirePermission('perm_authorize_rm_po'), async (req, res) => {
  const { poNo, orderDate, deliveryDate, lineItems, warranty, paymentTerms, freightTerms,
          supplierRef, cgstPercent, sgstPercent, igstPercent, packing, freight, other, roundOff } = req.body;
  if (!poNo || !lineItems?.length) {
    return res.json({ success: false, error: 'PO number and at least one line item are required.' });
  }

  // Same "never an email on the document" standard as prepared_by above
  // and as PRN's authorized_by — this is the signature a vendor sees.
  const resolvedAuthorizedBy = req.body.operatorName ||
    `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Unknown';

  try {
    const result = await withTransaction(async (client) => {
      const { rows: [po] } = await client.query(
        `SELECT * FROM purchase.raw_material_purchase_orders WHERE po_no = $1 AND status = 'Pending Authorization' FOR UPDATE`,
        [poNo]
      );
      if (!po) throw new Error('PO is not in Pending Authorization state, or does not exist.');
      // Vendor is locked — always the PO's own, never trusted from the
      // client, so it can't be swapped out from under an already-created
      // draft on its way to authorization.
      const vendorName = po.vendor_name;
      const effectiveOrderDate = orderDate || po.order_date;

      // ── Allocation validation, under lock, for real this time ──
      // still_to_order is read here and decremented below, so it must be
      // locked across both or two purchasers authorizing against the
      // same PRN concurrently would each pass validation and jointly
      // over-order.
      const allocationRows = [];
      for (const li of lineItems) {
        const lineQty = Number(li.quantity) || 0;
        const allocs = (li.allocations || [])
          .filter(a => a && a.prnId && (Number(a.quantity) || 0) > 0);
        const allocSum = allocs.reduce((s, a) => s + (Number(a.quantity) || 0), 0);

        if (allocSum > lineQty + 1e-9) {
          throw new Error(`${li.itemCode}: allocated ${allocSum} across PRNs, but the PO line is only ${lineQty}. Reduce the allocations or raise the ordered quantity.`);
        }

        for (const a of allocs) {
          const { rows: [prnLine] } = await client.query(
            `SELECT li.still_to_order_quantity, p.status, p.project_id, p.version
             FROM purchase.prn_line_items li
             JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
             WHERE li.prn_id = $1 AND li.item_code = $2
             FOR UPDATE OF li`,
            [a.prnId, li.itemCode]
          );
          if (!prnLine) throw new Error(`${a.prnId} has no line for ${li.itemCode}.`);
          if (prnLine.status !== 'PRN Generated') {
            throw new Error(`${a.prnId} is "${prnLine.status}" — only authorized PRNs can be ordered against.`);
          }
          const qty = Number(a.quantity) || 0;
          const stillToOrder = Number(prnLine.still_to_order_quantity) || 0;
          if (qty > stillToOrder + 1e-9) {
            throw new Error(`${a.prnId} / ${li.itemCode}: only ${stillToOrder} still needs ordering, cannot allocate ${qty}.`);
          }
          allocationRows.push({
            itemCode: li.itemCode, materialName: li.description, prnId: a.prnId,
            quantity: qty, projectId: prnLine.project_id, prnVersion: prnLine.version,
            deliveryDate: li.deliveryDate || deliveryDate || null,
          });
        }
      }

      const lineAmount = (li) =>
        (Number(li.quantity) || 0) * (Number(li.rate) || 0) * (100 - (Number(li.discountPercent) || 0)) / 100;
      const subTotal = lineItems.reduce((sum, li) => sum + lineAmount(li), 0);

      const cgstP = Number(cgstPercent) || 0, sgstP = Number(sgstPercent) || 0, igstP = Number(igstPercent) || 0;
      const cgstAmt = subTotal * cgstP / 100, sgstAmt = subTotal * sgstP / 100, igstAmt = subTotal * igstP / 100;
      const packingAmt = Number(packing) || 0, freightAmt = Number(freight) || 0;
      const otherAmt = Number(other) || 0, roundOffAmt = Number(roundOff) || 0;
      const grandTotal = subTotal + cgstAmt + sgstAmt + igstAmt + packingAmt + freightAmt + otherAmt + roundOffAmt;

      const { rows: [updatedPo] } = await client.query(
        `UPDATE purchase.raw_material_purchase_orders
         SET status = 'Authorized', authorized_by = $1, folder_dated_at = now(),
             order_date = $2, delivery_date = $3, material_rows = $4,
             sub_total = $5, grand_total = $6, warranty = $7, payment_terms = $8, freight_terms = $9,
             supplier_ref_offer_no = $10,
             cgst_percent = $11, cgst_amount = $12, sgst_percent = $13, sgst_amount = $14,
             igst_percent = $15, igst_amount = $16,
             packing_amount = $17, freight_amount = $18, other_amount = $19, round_off = $20
         WHERE po_no = $21
         RETURNING *`,
        [resolvedAuthorizedBy, effectiveOrderDate, deliveryDate || po.delivery_date, JSON.stringify(lineItems),
         subTotal, grandTotal, warranty, paymentTerms, freightTerms, supplierRef || null,
         cgstP, cgstAmt, sgstP, sgstAmt, igstP, igstAmt, packingAmt, freightAmt, otherAmt, roundOffAmt, poNo]
      );

      // ── Line items, PRN allocations, and on_order flagging — all for
      // the first time, now that this PO is actually being committed.
      for (const li of lineItems) {
        await client.query(
          `INSERT INTO purchase.raw_material_po_line_items
             (po_no, description_of_material, item_code, quantity, unit, rate_per_quantity, discount_percent, amount, delivery_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [poNo, li.description, li.itemCode, li.quantity, li.unit, li.rate,
           li.discountPercent || 0, lineAmount(li), li.deliveryDate || deliveryDate || null]
        );
      }

      const reconciled = {};
      for (const a of allocationRows) {
        await client.query(
          `INSERT INTO purchase.pps_tracking
             (project_id, prn_id, item_code, material_name, purchased_quantity, po_no, po_date,
              vendor_name, expected_delivery_date, prn_created_date, link_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),'Ordered')
           ON CONFLICT (prn_id, item_code, po_no)
           DO UPDATE SET purchased_quantity = purchase.pps_tracking.purchased_quantity + EXCLUDED.purchased_quantity,
                         expected_delivery_date = EXCLUDED.expected_delivery_date`,
          [a.projectId, a.prnId, a.itemCode, a.materialName, a.quantity, poNo,
           effectiveOrderDate, vendorName, a.deliveryDate]
        );

        await client.query(
          `UPDATE purchase.prn_line_items
           SET on_order_quantity = on_order_quantity + $1,
               still_to_order_quantity = GREATEST(0, still_to_order_quantity - $1)
           WHERE prn_id = $2 AND item_code = $3`,
          [a.quantity, a.prnId, a.itemCode]
        );

        reconciled[a.prnId] = a.prnVersion;
      }

      await client.query(
        `UPDATE purchase.raw_material_purchase_orders
         SET reconciled_prn_versions = $1 WHERE po_no = $2`,
        [JSON.stringify(reconciled), poNo]
      );

      // Bump vendor_performance.total_pos_raised — upsert since a vendor
      // may not have a performance row yet.
      await client.query(
        `INSERT INTO purchase.vendor_performance (vendor_name, total_pos_raised)
         VALUES ($1, 1)
         ON CONFLICT (vendor_name) DO UPDATE SET total_pos_raised = purchase.vendor_performance.total_pos_raised + 1`,
        [vendorName]
      );
      syncLiveRow('vendor_performance', vendorName);

      return updatedPo;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'RawMaterialPurchaseOrders', 'AUTHORIZE', poNo,
      `Authorized PO for vendor "${result.vendor_name}".`);

    // Single generator shared with the revision path, so the original and
    // every later revision are rendered by identical code from identical
    // sources — reads the line-items table, not the material_rows blob.
    let pdfUrl = null;
    try {
      pdfUrl = await regeneratePODocument(poNo);
    } catch (pdfErr) {
      console.error('PO document generation on authorize failed (non-fatal):', pdfErr);
    }

    syncLiveRow('raw_material_purchase_orders', poNo);

    res.json({ success: true, poNo: result.po_no, pdfUrl, pdfWarning: !pdfUrl });
  } catch (err) {
    console.error('authorizePurchaseOrder error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// rejectPurchaseOrder — a rejected draft leaves no trace: the header row
// is deleted outright (not soft-status'd, since a Pending-Authorization
// PO never wrote line items, pps_tracking, or on_order_quantity in the
// first place under the current flow — commitPurchaseOrderDraft only
// writes the header now). The pps_tracking/on_order reversal below is
// defensive, not load-bearing, for any PO created before this change
// shipped that might still be sitting in Pending Authorization with
// those side effects already applied from the old flow.
router.post('/rejectPurchaseOrder', requirePermission('perm_authorize_rm_po'), async (req, res) => {
  const { poNo, reason } = req.body;
  if (!poNo) return res.json({ success: false, error: 'PO number is required.' });

  try {
    const rows = await withTransaction(async (client) => {
      const { rows: [po] } = await client.query(
        `SELECT vendor_name FROM purchase.raw_material_purchase_orders WHERE po_no = $1 AND status = 'Pending Authorization' FOR UPDATE`,
        [poNo]
      );
      if (!po) throw new Error('PO is not in Pending Authorization state, or does not exist.');

      const { rows: staleAllocs } = await client.query(
        `SELECT prn_id, item_code, purchased_quantity FROM purchase.pps_tracking WHERE po_no = $1`, [poNo]
      );
      for (const a of staleAllocs) {
        await client.query(
          `UPDATE purchase.prn_line_items
           SET on_order_quantity = GREATEST(0, on_order_quantity - $1),
               still_to_order_quantity = still_to_order_quantity + $1
           WHERE prn_id = $2 AND item_code = $3`,
          [a.purchased_quantity, a.prn_id, a.item_code]
        );
      }
      await client.query(`DELETE FROM purchase.pps_tracking WHERE po_no = $1`, [poNo]);
      await client.query(`DELETE FROM purchase.raw_material_po_line_items WHERE po_no = $1`, [poNo]);

      const del = await client.query(
        `DELETE FROM purchase.raw_material_purchase_orders WHERE po_no = $1 AND status = 'Pending Authorization' RETURNING po_no`,
        [poNo]
      );
      return del.rows;
    });

    if (rows.length === 0) throw new Error('PO is not in Pending Authorization state, or does not exist.');

    await writeAuditLog(req.user.email, req.body.operatorName, 'RawMaterialPurchaseOrders', 'REJECT', poNo,
      `PO rejected and removed.${reason ? ` Reason: ${reason}` : ''}`);
    removeLiveRow('raw_material_purchase_orders', poNo);

    res.json({ success: true });
  } catch (err) {
    console.error('rejectPurchaseOrder error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// submitPORevisionDraft — writes to po_revision_requests ONLY. The live
// PO is never touched until authorization, which is required here rather
// than merely tidy: material can still be received against a PO while its
// revision is pending, so mutating the live row would corrupt receipts
// that arrive mid-review. It also makes rejection a no-op — nothing to
// snapshot and restore, unlike the PRN path.
router.post('/submitPORevisionDraft', requirePermission('perm_revise_rm_po'), async (req, res) => {
  const { poNo, revisionKind, lineItems, reason,
          supplierRef, deliveryDate, cgstPercent, sgstPercent, igstPercent,
          packing, freight, other, roundOff, warranty, paymentTerms, freightTerms } = req.body;
  if (!poNo) return res.json({ success: false, error: 'PO Number is required.' });
  const kind = ['PRN Driven', 'Standalone', 'Cancellation'].includes(revisionKind) ? revisionKind : 'PRN Driven';
  if (kind !== 'Cancellation' && !lineItems?.length) {
    return res.json({ success: false, error: 'At least one line item is required.' });
  }
  // Header fields are optional on every revisionKind — a PRN-driven
  // revision may only touch allocations and never open these fields at
  // all, so absent means "no change" rather than "clear it out".
  const headerChanges = {
    supplierRef: supplierRef ?? null, deliveryDate: deliveryDate || null,
    cgstPercent: cgstPercent != null ? Number(cgstPercent) : null,
    sgstPercent: sgstPercent != null ? Number(sgstPercent) : null,
    igstPercent: igstPercent != null ? Number(igstPercent) : null,
    packing: packing != null ? Number(packing) : null, freight: freight != null ? Number(freight) : null,
    other: other != null ? Number(other) : null, roundOff: roundOff != null ? Number(roundOff) : null,
    warranty: warranty ?? null, paymentTerms: paymentTerms ?? null, freightTerms: freightTerms ?? null,
  };

  try {
    const requestId = await withTransaction(async (client) => {
      const { rows: [po] } = await client.query(
        `SELECT po_no, status FROM purchase.raw_material_purchase_orders WHERE po_no = $1 FOR UPDATE`,
        [poNo]
      );
      if (!po) throw new Error('PO not found.');
      if (po.status !== 'Authorized') throw new Error(`PO is "${po.status}" — only an authorized PO can be revised.`);

      const { rows: [pending] } = await client.query(
        `SELECT request_id FROM purchase.po_revision_requests
         WHERE po_no = $1 AND status = 'Pending Authorization'`, [poNo]
      );
      if (pending) throw new Error('This PO already has a revision awaiting authorization.');

      const draftedVersions = {};
      const validated = [];

      for (const li of (lineItems || [])) {
        const newQty = kind === 'Cancellation' ? 0 : Number(li.vendorDiscussedQty);
        if (kind !== 'Cancellation' && (li.vendorDiscussedQty === undefined || li.vendorDiscussedQty === null || isNaN(newQty))) {
          throw new Error(`${li.itemCode}: Vendor Discussed Purchase Quantity is required on every row being revised.`);
        }

        // Floor at what has already physically arrived — you cannot
        // un-receive material by revising the paperwork downward.
        const { rows: [rec] } = await client.query(
          `SELECT COALESCE(SUM(actual_received_quantity), 0) AS received
           FROM purchase.pps_tracking WHERE po_no = $1 AND item_code = $2`,
          [poNo, li.itemCode]
        );
        const received = Number(rec.received) || 0;
        if (newQty < received - 1e-9) {
          throw new Error(`${li.itemCode}: ${received} has already been received — the revised quantity cannot be below that.`);
        }

        const allocs = (li.allocations || []).filter(a => a && a.prnId && (Number(a.quantity) || 0) > 0);
        const allocSum = allocs.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
        if (allocSum > newQty + 1e-9) {
          throw new Error(`${li.itemCode}: allocated ${allocSum} across PRNs but the revised line is only ${newQty}.`);
        }

        for (const a of allocs) {
          const { rows: [prnLine] } = await client.query(
            `SELECT p.version, p.status,
                    li2.purchase_quantity,
                    COALESCE((SELECT SUM(t2.purchased_quantity) FROM purchase.pps_tracking t2
                              WHERE t2.prn_id = li2.prn_id AND t2.item_code = li2.item_code
                                AND t2.po_no <> $3), 0) AS covered_elsewhere
             FROM purchase.prn_line_items li2
             JOIN purchase.purchase_request_notes p ON p.prn_id = li2.prn_id
             WHERE li2.prn_id = $1 AND li2.item_code = $2`,
            [a.prnId, li.itemCode, poNo]
          );
          if (!prnLine) throw new Error(`${a.prnId} has no line for ${li.itemCode}.`);
          if (prnLine.status !== 'PRN Generated') {
            throw new Error(`${a.prnId} is "${prnLine.status}" — only authorized PRNs can be allocated to.`);
          }
          const needFromThisPO = Math.max(0,
            (Number(prnLine.purchase_quantity) || 0) - (Number(prnLine.covered_elsewhere) || 0));
          if ((Number(a.quantity) || 0) > needFromThisPO + 1e-9) {
            throw new Error(`${a.prnId} / ${li.itemCode}: needs only ${needFromThisPO} from this PO, cannot allocate ${a.quantity}.`);
          }
          draftedVersions[a.prnId] = prnLine.version;
        }

        validated.push({
          itemCode: li.itemCode, srNo: li.srNo, description: li.description,
          unit: li.unit, quantity: newQty,
          rate: Number(li.rate) || 0, discountPercent: Number(li.discountPercent) || 0,
          deliveryDate: li.deliveryDate || null,
          allocations: allocs.map(a => ({ prnId: a.prnId, quantity: Number(a.quantity) || 0 })),
        });
      }

      const { rows: [reqRow] } = await client.query(
        `INSERT INTO purchase.po_revision_requests
           (po_no, revision_kind, revised_line_items, allocations, drafted_prn_versions, requested_by, rejection_reason, header_changes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING request_id`,
        [poNo, kind, JSON.stringify(validated),
         JSON.stringify(validated.flatMap(v => v.allocations.map(a => ({ ...a, itemCode: v.itemCode })))),
         JSON.stringify(draftedVersions),
          req.body.operatorName || displayName(req), reason || null, JSON.stringify(headerChanges)]
      );
      return reqRow.request_id;
    });

    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseOrderRevisions', 'SUBMIT', poNo,
      `${kind} revision drafted for ${poNo}, pending authorization.`);
    res.json({ success: true, requestId });
  } catch (err) {
    console.error('submitPORevisionDraft error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// authorizePORevision — re-validates against LIVE PRN state before
// applying. A PRN that moved on since the draft was written makes its
// allocation stale; rather than rejecting the whole draft (throwing away
// the purchaser's vendor negotiation), allocations are re-clamped to what
// each PRN can still absorb and the surplus becomes unallocated excess —
// but only after the authorizer has seen exactly that and re-confirmed.
router.post('/authorizePORevision', requirePermission('perm_authorize_rm_po_revision'), async (req, res) => {
  const { requestId, confirmStale, editedLineItems, editedHeader } = req.body;
  if (!requestId) return res.json({ success: false, error: 'Request ID is required.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows: [reqRow] } = await client.query(
        `SELECT * FROM purchase.po_revision_requests
         WHERE request_id = $1 AND status = 'Pending Authorization' FOR UPDATE`,
        [requestId]
      );
      if (!reqRow) throw new Error('Revision not found, or it is no longer pending authorization.');

      const drafter = reqRow.requested_by;
      const authorizerName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim();
      if (drafter && (drafter === authorizerName || drafter === displayName(req)) && !req.user.perm_admin) {
        throw new Error('The person who drafted this PO revision cannot also authorize it.');
      }

      const poNo = reqRow.po_no;
      const drafted = reqRow.drafted_prn_versions || {};
      // The authorizer's own edits (Vendor Discussed Qty, Rate, Disc%,
      // allocations) take precedence over the original draft when
      // present — same "edited beats drafted" convention as
      // authorizePurchaseRequestNote's editedLineItems. Falls back to
      // exactly what was drafted when the authorizer changed nothing.
      const revisedLines = (editedLineItems && editedLineItems.length) ? editedLineItems : (reqRow.revised_line_items || []);

      // ── Staleness + floor re-validation against live state ──
      const staleNotes = [];
      for (const line of revisedLines) {
        const { rows: [rec] } = await client.query(
          `SELECT COALESCE(SUM(actual_received_quantity), 0) AS received
           FROM purchase.pps_tracking WHERE po_no = $1 AND item_code = $2`,
          [poNo, line.itemCode]
        );
        const received = Number(rec.received) || 0;
        if (Number(line.quantity) < received - 1e-9) {
          throw new Error(`${line.itemCode}: ${received} has been received since this revision was drafted — it can no longer be cut to ${line.quantity}. Redraft the revision.`);
        }

        for (const a of (line.allocations || [])) {
          const { rows: [prnLine] } = await client.query(
            `SELECT p.version, li2.purchase_quantity,
                    COALESCE((SELECT SUM(t2.purchased_quantity) FROM purchase.pps_tracking t2
                              WHERE t2.prn_id = li2.prn_id AND t2.item_code = li2.item_code
                                AND t2.po_no <> $3), 0) AS covered_elsewhere
             FROM purchase.prn_line_items li2
             JOIN purchase.purchase_request_notes p ON p.prn_id = li2.prn_id
             WHERE li2.prn_id = $1 AND li2.item_code = $2 FOR UPDATE OF li2`,
            [a.prnId, line.itemCode, poNo]
          );
          if (!prnLine) throw new Error(`${a.prnId} no longer has a line for ${line.itemCode}.`);

          const draftedVersion = Number(drafted[a.prnId] || 0);
          const needNow = Math.max(0,
            (Number(prnLine.purchase_quantity) || 0) - (Number(prnLine.covered_elsewhere) || 0));

          if (Number(prnLine.version) !== draftedVersion && a.quantity > needNow + 1e-9) {
            staleNotes.push({
              prnId: a.prnId, itemCode: line.itemCode,
              drafted: a.quantity, canAbsorb: needNow,
              surplus: Number((a.quantity - needNow).toFixed(4)),
            });
            a.quantity = needNow;   // re-clamp; surplus falls out as excess
          }
        }
      }
      if (staleNotes.length > 0 && !confirmStale) {
        return { needsConfirmation: true, staleNotes, poNo };
      }

      // ── Apply to the live PO ──
      const isCancellation = reqRow.revision_kind === 'Cancellation';
      for (const line of revisedLines) {
        const amount = (Number(line.quantity) || 0) * (Number(line.rate) || 0)
                     * (100 - (Number(line.discountPercent) || 0)) / 100;
        if (Number(line.quantity) <= 1e-9) {
          // Zeroed out entirely — the earlier floor check already
          // guarantees nothing's been received against it, so the line
          // drops off the PO (and its document) completely, rather than
          // lingering as a 0-quantity/0-amount row.
          await client.query(
            `DELETE FROM purchase.raw_material_po_line_items WHERE po_no = $1 AND item_code = $2`,
            [poNo, line.itemCode]
          );
        } else {
          await client.query(
            `UPDATE purchase.raw_material_po_line_items
             SET quantity = $1, rate_per_quantity = $2, discount_percent = $3,
                 amount = $4, delivery_date = COALESCE($5, delivery_date)
             WHERE po_no = $6 AND item_code = $7`,
            [line.quantity, line.rate, line.discountPercent, amount, line.deliveryDate, poNo, line.itemCode]
          );
        }

        // Re-point allocations. A PRN whose allocation drops to zero has
        // its row removed ONLY if nothing was received against it —
        // otherwise the receipt history would vanish with it.
        const { rows: existingAllocs } = await client.query(
          `SELECT prn_id, purchased_quantity, COALESCE(actual_received_quantity,0) AS received
           FROM purchase.pps_tracking WHERE po_no = $1 AND item_code = $2 FOR UPDATE`,
          [poNo, line.itemCode]
        );
        const newByPrn = Object.fromEntries((line.allocations || []).map(a => [a.prnId, Number(a.quantity) || 0]));

        for (const ex of existingAllocs) {
          const newQty = newByPrn[ex.prn_id] !== undefined ? newByPrn[ex.prn_id] : 0;
          const delta = newQty - (Number(ex.purchased_quantity) || 0);
          if (Math.abs(delta) > 1e-9) {
            // still_to_order_quantity and awaiting_po_revision recomputed
            // FRESH from purchase_quantity/assigned/on_order right after
            // the on_order change, not adjusted incrementally against
            // whatever they already were — an incremental adjustment on
            // top of an already-stale baseline just compounds the
            // staleness instead of correcting it.
            const { rows: [updated] } = await client.query(
              `UPDATE purchase.prn_line_items
               SET on_order_quantity = GREATEST(0, on_order_quantity + $1)
               WHERE prn_id = $2 AND item_code = $3
               RETURNING purchase_quantity, assigned_quantity, on_order_quantity`,
              [delta, ex.prn_id, line.itemCode]
            );
            if (updated) {
              const stillToOrder = Math.max(0, (Number(updated.purchase_quantity) || 0)
                - (Number(updated.assigned_quantity) || 0) - (Number(updated.on_order_quantity) || 0));
              const stillDeferred = Number(updated.on_order_quantity) > Number(updated.purchase_quantity) + 1e-9;
              await client.query(
                `UPDATE purchase.prn_line_items SET still_to_order_quantity = $1, awaiting_po_revision = $2
                 WHERE prn_id = $3 AND item_code = $4`,
                [stillToOrder, stillDeferred, ex.prn_id, line.itemCode]
              );
            }
          }
          if (newQty <= 1e-9 && Number(ex.received) <= 1e-9) {
            await client.query(
              `DELETE FROM purchase.pps_tracking WHERE po_no = $1 AND item_code = $2 AND prn_id = $3`,
              [poNo, line.itemCode, ex.prn_id]
            );
          } else {
            await client.query(
              `UPDATE purchase.pps_tracking SET purchased_quantity = $1
               WHERE po_no = $2 AND item_code = $3 AND prn_id = $4`,
              [newQty, poNo, line.itemCode, ex.prn_id]
            );
          }
          delete newByPrn[ex.prn_id];
        }

        // PRNs newly added to this line (your Q9 case — vendor overshot,
        // so hand the surplus to another PRN that needs the material).
        for (const [prnId, qty] of Object.entries(newByPrn)) {
          if (qty <= 1e-9) continue;
          const { rows: [meta] } = await client.query(
            `SELECT project_id FROM purchase.purchase_request_notes WHERE prn_id = $1`, [prnId]);
          await client.query(
            `INSERT INTO purchase.pps_tracking
               (project_id, prn_id, item_code, material_name, purchased_quantity, po_no, po_date,
                vendor_name, expected_delivery_date, prn_created_date, link_status)
             SELECT $1,$2,$3,$4,$5,$6,po.order_date,po.vendor_name,$7,now(),'Ordered'
             FROM purchase.raw_material_purchase_orders po WHERE po.po_no = $6
             ON CONFLICT (prn_id, item_code, po_no)
             DO UPDATE SET purchased_quantity = EXCLUDED.purchased_quantity`,
            [meta?.project_id || null, prnId, line.itemCode, line.description, qty, poNo, line.deliveryDate]
          );
          {
            const { rows: [updated] } = await client.query(
              `UPDATE purchase.prn_line_items
               SET on_order_quantity = on_order_quantity + $1
               WHERE prn_id = $2 AND item_code = $3
               RETURNING purchase_quantity, assigned_quantity, on_order_quantity`,
              [qty, prnId, line.itemCode]
            );
            if (updated) {
              const stillToOrder = Math.max(0, (Number(updated.purchase_quantity) || 0)
                - (Number(updated.assigned_quantity) || 0) - (Number(updated.on_order_quantity) || 0));
              const stillDeferred = Number(updated.on_order_quantity) > Number(updated.purchase_quantity) + 1e-9;
              await client.query(
                `UPDATE purchase.prn_line_items SET still_to_order_quantity = $1, awaiting_po_revision = $2
                 WHERE prn_id = $3 AND item_code = $4`,
                [stillToOrder, stillDeferred, prnId, line.itemCode]
              );
            }
          }
        }
      }

      // Totals from the live line items, not the draft — untouched lines
      // must carry forward unchanged into the new revision.
      const { rows: [tot] } = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS sub_total
         FROM purchase.raw_material_po_line_items WHERE po_no = $1`, [poNo]);
      const { rows: [poRow] } = await client.query(
        `SELECT supplier_ref_offer_no, delivery_date, cgst_percent, sgst_percent, igst_percent,
                packing_amount, freight_amount, other_amount, round_off,
                warranty, payment_terms, freight_terms
         FROM purchase.raw_material_purchase_orders WHERE po_no = $1 FOR UPDATE`, [poNo]);

      // header_changes is null-means-"no change" per field — any field
      // the revision form never touched falls back to what's already
      // stored, exactly like an untouched line item carries forward
      // unchanged above.
      // Same override convention as line items — the authorizer's own
      // header/tax/term edits take precedence over what was drafted.
      const hc = { ...(reqRow.header_changes || {}), ...(editedHeader || {}) };
      const eff = {
        supplierRef: hc.supplierRef != null ? hc.supplierRef : poRow.supplier_ref_offer_no,
        deliveryDate: hc.deliveryDate || poRow.delivery_date,
        cgstPercent: hc.cgstPercent != null ? hc.cgstPercent : (Number(poRow.cgst_percent) || 0),
        sgstPercent: hc.sgstPercent != null ? hc.sgstPercent : (Number(poRow.sgst_percent) || 0),
        igstPercent: hc.igstPercent != null ? hc.igstPercent : (Number(poRow.igst_percent) || 0),
        packing: hc.packing != null ? hc.packing : (Number(poRow.packing_amount) || 0),
        freight: hc.freight != null ? hc.freight : (Number(poRow.freight_amount) || 0),
        other: hc.other != null ? hc.other : (Number(poRow.other_amount) || 0),
        roundOff: hc.roundOff != null ? hc.roundOff : (Number(poRow.round_off) || 0),
        warranty: hc.warranty != null ? hc.warranty : poRow.warranty,
        paymentTerms: hc.paymentTerms != null ? hc.paymentTerms : poRow.payment_terms,
        freightTerms: hc.freightTerms != null ? hc.freightTerms : poRow.freight_terms,
      };

      const subTotal = Number(tot.sub_total) || 0;
      const cgstAmt = subTotal * eff.cgstPercent / 100;
      const sgstAmt = subTotal * eff.sgstPercent / 100;
      const igstAmt = subTotal * eff.igstPercent / 100;
      const grandTotal = subTotal + cgstAmt + sgstAmt + igstAmt + eff.packing + eff.freight + eff.other + eff.roundOff;

      // Re-stamp every allocated PRN at its CURRENT version — this is what
      // drops the PO out of the revision queue.
      const { rows: liveAllocs } = await client.query(
        `SELECT DISTINCT t.prn_id, p.version FROM purchase.pps_tracking t
         JOIN purchase.purchase_request_notes p ON p.prn_id = t.prn_id
         WHERE t.po_no = $1`, [poNo]);
      const reconciled = Object.fromEntries(liveAllocs.map(r => [r.prn_id, r.version]));

      const { rows: [updatedPo] } = await client.query(
        `UPDATE purchase.raw_material_purchase_orders
         SET sub_total = $1, grand_total = $2, revision_number = revision_number + 1,
             reconciled_prn_versions = $3,
             cgst_amount = $6, sgst_amount = $7, igst_amount = $8,
             supplier_ref_offer_no = $9, delivery_date = $10,
             cgst_percent = $11, sgst_percent = $12, igst_percent = $13,
             packing_amount = $14, freight_amount = $15, other_amount = $16, round_off = $17,
             warranty = $18, payment_terms = $19, freight_terms = $20,
             status = CASE WHEN $4 THEN 'Cancelled' ELSE status END
         WHERE po_no = $5 RETURNING *`,
        [subTotal, grandTotal, JSON.stringify(reconciled), isCancellation, poNo, cgstAmt, sgstAmt, igstAmt,
         eff.supplierRef, eff.deliveryDate, eff.cgstPercent, eff.sgstPercent, eff.igstPercent,
         eff.packing, eff.freight, eff.other, eff.roundOff, eff.warranty, eff.paymentTerms, eff.freightTerms]);

      // Any line that didn't specify its OWN delivery date (i.e. only the
      // header delivery date changed on this revision) was left holding
      // its stale line-level date by the per-line UPDATE above
      // (`COALESCE($5, delivery_date)` — falls back to the OLD value,
      // not the new header date). Same story for pps_tracking's
      // expected_delivery_date, which Expected Deliveries / PPS Tracking
      // both read. Sync both down to the new effective header date now
      // that it's known, for every line the revision left unspecified.
      const linesWithoutOwnDate = revisedLines.filter(l => !l.deliveryDate).map(l => l.itemCode);
      if (linesWithoutOwnDate.length > 0 && eff.deliveryDate) {
        await client.query(
          `UPDATE purchase.raw_material_po_line_items
           SET delivery_date = $1
           WHERE po_no = $2 AND item_code = ANY($3::text[])`,
          [eff.deliveryDate, poNo, linesWithoutOwnDate]
        );
        await client.query(
          `UPDATE purchase.pps_tracking
           SET expected_delivery_date = $1
           WHERE po_no = $2 AND item_code = ANY($3::text[])`,
          [eff.deliveryDate, poNo, linesWithoutOwnDate]
        );
      }

      // Deferred unwinds can now complete for every PRN this PO touches.
      const unwound = [];
      for (const prnId of Object.keys(reconciled)) {
        const items = await completeDeferredUnwinds(client, prnId);
        if (items.length) unwound.push({ prnId, items });
      }
      for (const prnId of Object.keys(reconciled)) await refreshPRNCompletion(client, prnId);

      await client.query(
        `UPDATE purchase.po_revision_requests
         SET status = 'Authorized', authorized_by = $1, authorized_at = now()
         WHERE request_id = $2`,
        [req.body.operatorName || displayName(req), requestId]);

      // Document generated INSIDE the transaction — a rendering/upload
      // failure throws and rolls back the entire authorization (PO
      // update, allocations, deferred unwinds, all of it) rather than
      // leaving an "authorized but undocumented" partial state.
      const docUrl = await regeneratePODocument(poNo, client);

      return { po: updatedPo, poNo, revisionNumber: updatedPo.revision_number, staleNotes, unwound, isCancellation, docUrl };
    });

    if (result.needsConfirmation) {
      return res.json({ success: false, needsConfirmation: true, staleNotes: result.staleNotes,
        error: 'One or more PRNs changed since this revision was drafted. Review the adjustments and confirm to proceed.' });
    }

    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseOrderRevisions', 'AUTHORIZE', result.poNo,
      `PO revision ${result.revisionNumber} authorized.` +
      (result.staleNotes.length ? ` Re-clamped: ${result.staleNotes.map(s => `${s.prnId}/${s.itemCode} -${s.surplus}`).join(', ')}.` : '') +
      (result.unwound.length ? ` Deferred unwinds completed for ${result.unwound.map(u => u.prnId).join(', ')}.` : ''));
    syncLiveRow('raw_material_purchase_orders', result.poNo);
    Object.keys(result.po.reconciled_prn_versions || {}).forEach(p => syncLiveRow('purchase_request_notes', p));

    res.json({ success: true, poNo: result.poNo, revisionNumber: result.revisionNumber,
      staleNotes: result.staleNotes, unwound: result.unwound, pdfUrl: result.docUrl });
  } catch (err) {
    console.error('authorizePORevision error:', err);
    res.status(400).json({ success: false, error: 'PO revision failed and was fully rolled back: ' + err.message });
  }
});

// Rejection is a no-op on the live PO — nothing was ever mutated, so
// there is nothing to restore. The PO simply returns to the revision
// queue on the next read, since its stamped versions are still behind.
router.post('/rejectPORevision', requirePermission('perm_authorize_rm_po_revision'), async (req, res) => {
  const { requestId, rejectionReason } = req.body;
  if (!requestId) return res.json({ success: false, error: 'Request ID is required.' });
  try {
    const { rows: [row] } = await pool.query(
      `UPDATE purchase.po_revision_requests
       SET status = 'Rejected', authorized_by = $1, authorized_at = now(), rejection_reason = $2
       WHERE request_id = $3 AND status = 'Pending Authorization'
       RETURNING po_no`,
      [req.body.operatorName || displayName(req), rejectionReason || null, requestId]);
    if (!row) return res.json({ success: false, error: 'Revision not found, or it is no longer pending.' });

    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseOrderRevisions', 'REJECT', row.po_no,
      `PO revision rejected.${rejectionReason ? ' Reason: ' + rejectionReason : ''}`);
    res.json({ success: true, poNo: row.po_no });
  } catch (err) {
    console.error('rejectPORevision error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// "No revision needed" — the purchaser resolved the PRN change by raising
// a NEW PO instead. Re-stamping to current versions is the entire
// dismissal: the queue derives membership from that comparison, so there
// is no separate dismissal state that could drift out of sync with it.
router.post('/dismissPORevisionQueue', requirePermission('perm_revise_rm_po'), async (req, res) => {
  const { poNo, reason } = req.body;
  if (!poNo) return res.json({ success: false, error: 'PO Number is required.' });
  try {
    await withTransaction(async (client) => {
      const { rows: [po] } = await client.query(
        `SELECT po_no FROM purchase.raw_material_purchase_orders WHERE po_no = $1 FOR UPDATE`, [poNo]);
      if (!po) throw new Error('PO not found.');
      const { rows: allocs } = await client.query(
        `SELECT DISTINCT t.prn_id, p.version FROM purchase.pps_tracking t
         JOIN purchase.purchase_request_notes p ON p.prn_id = t.prn_id
         WHERE t.po_no = $1`, [poNo]);
      await client.query(
        `UPDATE purchase.raw_material_purchase_orders SET reconciled_prn_versions = $1 WHERE po_no = $2`,
        [JSON.stringify(Object.fromEntries(allocs.map(a => [a.prn_id, a.version]))), poNo]);
    });
    await writeAuditLog(req.user.email, req.body.operatorName, 'PurchaseOrderRevisions', 'DISMISS', poNo,
      `Marked as needing no revision.${reason ? ' Reason: ' + reason : ''}`);
    res.json({ success: true });
  } catch (err) {
    console.error('dismissPORevisionQueue error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── PPS Tracking ─────────────────────────────────────────────────────────

// PRN picker for PPS — project + status, mirroring the Create PRN
// selectors. "Pending" and "Completed" are the user-facing labels for
// PRN Generated and Completed respectively.
router.post('/fetchPRNsByProjectAndStatus', requirePermission('perm_pps_tracking'), async (req, res) => {
  const { projectId, prnStatus } = req.body;
  if (!projectId) return res.json({ success: false, error: 'Project ID is required.' });
  const dbStatus = (prnStatus || 'Pending') === 'Completed' ? 'Completed' : 'PRN Generated';
  try {
    // A PRN already mid-revision sits at status 'Pending Authorization',
    // not 'PRN Generated' — excluding it here (as before) hid it from
    // this picker entirely instead of showing it with a blocked state,
    // same gap fetchPOsNeedingRevision's sibling already avoided for POs.
    const statusList = dbStatus === 'PRN Generated' ? [dbStatus, 'Pending Authorization'] : [dbStatus];
    const { rows } = await pool.query(
      `SELECT p.prn_id AS "prnId", p.boq_id AS "boqId", p.product_name AS "productName",
              p.product_rating AS "productRating", p.version, p.authorized_at AS "authorizedAt",
              b.customer_name AS "customerName",
              (p.status = 'Pending Authorization') AS "revisionPending"
       FROM purchase.purchase_request_notes p
       LEFT JOIN design.boq_drafts b ON b.boq_id = p.boq_id
       WHERE p.project_id = $1 AND p.status = ANY($2::text[])
       ORDER BY p.authorized_at DESC NULLS LAST`,
      [projectId, statusList]
    );
    res.json({ success: true, prns: rows });
  } catch (err) {
    console.error('fetchPRNsByProjectAndStatus error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PPS detail for one PRN. Each material carries its PO allocations
// (a PRN+item can draw from several POs over time), their expected
// delivery dates, and received-vs-ordered progress. Aggregated as JSON
// per line so one row renders one material regardless of PO count.
router.post('/fetchPPSForPRN', requirePermission(['perm_pps_tracking', 'perm_project_status']), async (req, res) => {
  const { prnId } = req.body;
  if (!prnId) return res.json({ success: false, error: 'PRN ID is required.' });
  try {
    const { rows } = await pool.query(
      `SELECT li.item_code AS "itemCode", li.material_name AS "materialName",
              li.boq_required_quantity AS "boqRequiredQty", li.buffer_percent AS "bufferPct",
              li.buffered_purchase_quantity AS "bufferedPurchaseQty",
              li.current_unassigned_store_quantity AS "storeQty",
              li.purchase_quantity AS "purchaseQty",
              li.on_order_quantity AS "onOrderQty",
              li.still_to_order_quantity AS "stillToOrder",
              li.received_quantity AS "receivedQty",
              li.awaiting_po_revision AS "awaitingPoRevision",
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'poNo', t.po_no,
                          'orderedQty', t.purchased_quantity,
                          'receivedQty', COALESCE(t.actual_received_quantity, 0),
                          'expectedDelivery', t.expected_delivery_date,
                          'actualDelivery', t.actual_delivery_date,
                          'vendorName', t.vendor_name,
                          'linkStatus', t.link_status,
                          'actionPlan', t.action_plan)
                        ORDER BY t.expected_delivery_date NULLS LAST)
                 FROM purchase.pps_tracking t
                 WHERE t.prn_id = li.prn_id AND t.item_code = li.item_code),
                '[]'::json) AS "purchaseOrders"
       FROM purchase.prn_line_items li
       WHERE li.prn_id = $1 AND li.buffered_purchase_quantity > 0
       ORDER BY li.item_code`,
      [prnId]
    );
    res.json({ success: true, materials: rows });
  } catch (err) {
    console.error('fetchPPSForPRN error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/updatePPSActionPlan', requirePermission('perm_pps_tracking'), async (req, res) => {
  // Frontend sends a batch — one entry per PPS row being edited on
  // screen at once, identified by prnId + itemCode (pps_tracking has no
  // per-row ID exposed to the frontend for this screen).
  const { updates } = req.body;
  if (!updates?.length) return res.json({ success: false, error: 'No action plan updates were provided.' });
  try {
    for (const u of updates) {
      await pool.query(
        `UPDATE purchase.pps_tracking SET action_plan = $1
         WHERE prn_id = $2 AND item_code = $3 AND po_no = $4`,
        [u.actionPlan, u.prnId, u.itemCode, u.poNo]
      );
    }
    await writeAuditLog(req.user.email, req.body.operatorName, 'PPSTracking', 'UPDATE', null,
      `Updated action plan for ${updates.length} PPS row(s).`);
    res.json({ success: true });
  } catch (err) {
    console.error('updatePPSActionPlan error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Revise PO ────────────────────────────────────────────────────────────

// Section 1: "PRN revisions needing PO revision". Membership is DERIVED,
// never stored — a PO qualifies when any PRN it is allocated to has moved
// past the version this PO was last reconciled against. That means
// dismissing an entry is just a re-stamp, and a PO whose PRN reverts
// (rejected revision) drops out on its own with nothing to clean up.
// POs with a revision already pending are suppressed: they are being
// worked on, and their draft will re-queue them if it goes stale.
router.post('/fetchPOsNeedingRevision', requirePermission('perm_revise_rm_po'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT po.po_no AS "poNo", po.vendor_name AS "vendorName", po.order_date AS "orderDate",
              po.delivery_date AS "deliveryDate", po.grand_total AS "grandTotal",
              po.revision_number AS "revisionNumber",
              json_agg(DISTINCT jsonb_build_object(
                'prnId', p.prn_id,
                'projectId', p.project_id,
                'stampedVersion', (po.reconciled_prn_versions ->> p.prn_id)::int,
                'currentVersion', p.version)) AS "changedPrns"
       FROM purchase.raw_material_purchase_orders po
       JOIN purchase.purchase_request_notes p
         ON po.reconciled_prn_versions ? p.prn_id
       WHERE po.status = 'Authorized'
         AND p.version > (po.reconciled_prn_versions ->> p.prn_id)::int
         AND NOT EXISTS (
           SELECT 1 FROM purchase.po_revision_requests r
           WHERE r.po_no = po.po_no AND r.status = 'Pending Authorization')
       GROUP BY po.po_no, po.vendor_name, po.order_date, po.delivery_date,
                po.grand_total, po.revision_number
       ORDER BY po.order_date DESC`
    );
    res.json({ success: true, queue: rows });
  } catch (err) {
    console.error('fetchPOsNeedingRevision error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Section 2: "Other PO revisions" — vendor delay, price change, vendor
// asked to change quantity, or outright cancellation. Searched rather
// than queued, since nothing upstream flags them.
router.post('/searchPOsForRevision', requirePermission('perm_revise_rm_po'), async (req, res) => {
  const { query } = req.body;
  if (!query || query.toString().trim().length < 2) {
    return res.json({ success: false, error: 'Enter at least 2 characters of a PO number or vendor name.' });
  }
  try {
    const like = `%${query.toString().trim()}%`;
    const { rows } = await pool.query(
      `SELECT po.po_no AS "poNo", po.vendor_name AS "vendorName", po.order_date AS "orderDate",
              po.delivery_date AS "deliveryDate", po.grand_total AS "grandTotal",
              po.status, po.revision_number AS "revisionNumber",
              EXISTS (SELECT 1 FROM purchase.po_revision_requests r
                      WHERE r.po_no = po.po_no AND r.status = 'Pending Authorization') AS "revisionPending"
       FROM purchase.raw_material_purchase_orders po
       WHERE po.status = 'Authorized'
         AND (po.po_no ILIKE $1 OR po.vendor_name ILIKE $1)
       ORDER BY po.order_date DESC LIMIT 50`,
      [like]
    );
    res.json({ success: true, results: rows });
  } catch (err) {
    console.error('searchPOsForRevision error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// The expanded revision card. Numbers are computed LIVE from current PRN
// state rather than snapshotted when the PO entered the queue, so a
// second PRN revising while this sat unopened is folded in automatically.
//
// "New required" is each allocated PRN's CURRENT need from THIS PO —
// its purchase quantity minus whatever other POs already cover — so a
// material split across two vendors isn't double-counted.
//
// changedOnly=true returns just the materials whose requirement moved
// (the PRN-driven view). Standalone revisions pass false to edit any line.
router.post('/fetchPOForRevision', requirePermission('perm_revise_rm_po'), async (req, res) => {
  const { poNo, changedOnly } = req.body;
  if (!poNo) return res.json({ success: false, error: 'PO Number is required.' });
  try {
    const { rows: [po] } = await pool.query(
      `SELECT po_no AS "poNo", vendor_name AS "vendorName", supplier_ref_offer_no AS "supplierRef",
              order_date AS "orderDate", delivery_date AS "deliveryDate", status,
              revision_number AS "revisionNumber", reconciled_prn_versions AS "reconciledPrnVersions",
              cgst_percent AS "cgstPercent", sgst_percent AS "sgstPercent", igst_percent AS "igstPercent",
              packing_amount AS "packing", freight_amount AS "freight",
              other_amount AS "other", round_off AS "roundOff",
              warranty, payment_terms AS "paymentTerms", freight_terms AS "freightTerms"
       FROM purchase.raw_material_purchase_orders WHERE po_no = $1`,
      [poNo]
    );
    if (!po) return res.json({ success: false, error: 'PO not found.' });

    const { rows: [pending] } = await pool.query(
      `SELECT request_id FROM purchase.po_revision_requests
       WHERE po_no = $1 AND status = 'Pending Authorization'`, [poNo]
    );
    if (pending) {
      return res.json({ success: false, error: `PO ${poNo} already has a revision awaiting authorization. It must be authorized or rejected first.` });
    }

    const { rows: lines } = await pool.query(
      `SELECT l.line_id AS "srNo", l.item_code AS "itemCode",
              l.description_of_material AS "description", l.quantity AS "orderedQty",
              l.unit, l.rate_per_quantity AS "rate", l.discount_percent AS "discountPercent",
              l.amount, l.delivery_date AS "deliveryDate",
              COALESCE((SELECT SUM(t.actual_received_quantity) FROM purchase.pps_tracking t
                        WHERE t.po_no = l.po_no AND t.item_code = l.item_code), 0) AS "receivedQty",
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'prnId', t.prn_id,
                          'projectId', t.project_id,
                          'allocatedQty', t.purchased_quantity,
                          'receivedQty', COALESCE(t.actual_received_quantity, 0),
                          'prnVersion', p.version,
                          'stampedVersion', (po.reconciled_prn_versions ->> t.prn_id)::int,
                          'bufferedRequirement', li.buffered_purchase_quantity,
                          'currentPurchaseQty', li.purchase_quantity,
                          'coveredByOtherPOs', COALESCE((
                            SELECT SUM(t2.purchased_quantity) FROM purchase.pps_tracking t2
                            WHERE t2.prn_id = t.prn_id AND t2.item_code = t.item_code
                              AND t2.po_no <> l.po_no), 0))
                        ORDER BY p.authorized_at NULLS LAST)
                 FROM purchase.pps_tracking t
                 JOIN purchase.purchase_request_notes p ON p.prn_id = t.prn_id
                 LEFT JOIN purchase.prn_line_items li
                        ON li.prn_id = t.prn_id AND li.item_code = t.item_code
                 WHERE t.po_no = l.po_no AND t.item_code = l.item_code),
                '[]'::json) AS "allocations"
       FROM purchase.raw_material_po_line_items l
       JOIN purchase.raw_material_purchase_orders po ON po.po_no = l.po_no
       WHERE l.po_no = $1
       ORDER BY l.line_id`,
      [poNo]
    );

    // New required per line = sum over allocated PRNs of
    // max(0, current purchase qty - what other POs already cover).
    const lineItems = lines.map(l => {
      const allocs = l.allocations || [];
      const newRequired = allocs.reduce((sum, a) => {
        const need = (Number(a.currentPurchaseQty) || 0) - (Number(a.coveredByOtherPOs) || 0);
        return sum + Math.max(0, need);
      }, 0);
      // Item-level, not PRN-level: compares what THIS PO's own allocation
      // record (pps_tracking.allocatedQty) still claims from a PRN
      // against what that PRN actually needs from this PO right now —
      // not "did the PRN's version number move at all", which would
      // flag every item on a PRN as changed just because ONE item on it
      // did.
      const changed = allocs.some(a => {
        const need = Math.max(0, (Number(a.currentPurchaseQty) || 0) - (Number(a.coveredByOtherPOs) || 0));
        return Math.abs((Number(a.allocatedQty) || 0) - need) > 1e-9;
      });
      return { ...l, newRequiredQty: newRequired, changed };
    });
    // changedOnly no longer filters server-side — the frontend needs
    // every line's amount to compute a true whole-PO Sub Total/Grand
    // Total (including untouched rows it doesn't render as editable
    // inputs), so it does its own filtering for DISPLAY using the
    // `changed` flag on each line instead.

    res.json({ success: true, po, lineItems });
  } catch (err) {
    console.error('fetchPOForRevision error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Search by Raw Material Purchase Order — read-only lookup section.
// Only ever looks at status = 'Authorized' POs (matches the Revise PO
// "Other PO Revisions" search pattern) and reads the physical
// raw_material_po_line_items / pps_tracking tables, NOT material_rows —
// material_rows is draft-only and is gone by the time a PO is Authorized
// (see fetchPODraftById's comment above). Nothing here writes anything.
// ═══════════════════════════════════════════════════════════════════════

router.post('/searchRMPOsByPONumber', requirePermission('perm_search_rm_po'), async (req, res) => {
  const { query } = req.body;
  if (!query || query.toString().trim().length < 2) {
    return res.json({ success: false, error: 'Enter at least 2 characters of a PO number.' });
  }
  try {
    const like = `%${query.toString().trim()}%`;
    const { rows } = await pool.query(
      `SELECT po_no AS "poNo", vendor_name AS "vendorName", order_date AS "orderDate",
              delivery_date AS "deliveryDate", grand_total AS "grandTotal", revision_number AS "revisionNumber"
       FROM purchase.raw_material_purchase_orders
       WHERE status = 'Authorized' AND po_no ILIKE $1
       ORDER BY order_date DESC LIMIT 50`,
      [like]
    );
    res.json({ success: true, results: rows });
  } catch (err) {
    console.error('searchRMPOsByPONumber error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchRMPOsByMaterial', requirePermission('perm_search_rm_po'), async (req, res) => {
  const { itemCode } = req.body;
  if (!itemCode) return res.json({ success: false, error: 'A material is required.' });
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT po.po_no AS "poNo", po.vendor_name AS "vendorName", po.order_date AS "orderDate",
              po.delivery_date AS "deliveryDate", po.grand_total AS "grandTotal", po.revision_number AS "revisionNumber"
       FROM purchase.raw_material_purchase_orders po
       JOIN purchase.raw_material_po_line_items l ON l.po_no = po.po_no
       WHERE po.status = 'Authorized' AND l.item_code = $1
       ORDER BY po.order_date DESC LIMIT 100`,
      [itemCode]
    );
    res.json({ success: true, results: rows });
  } catch (err) {
    console.error('searchRMPOsByMaterial error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchRMPOsByProjectId', requirePermission('perm_search_rm_po'), async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'A Project ID is required.' });
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT po.po_no AS "poNo", po.vendor_name AS "vendorName", po.order_date AS "orderDate",
              po.delivery_date AS "deliveryDate", po.grand_total AS "grandTotal", po.revision_number AS "revisionNumber"
       FROM purchase.raw_material_purchase_orders po
       JOIN purchase.pps_tracking t ON t.po_no = po.po_no
       WHERE po.status = 'Authorized' AND t.project_id = $1
       ORDER BY po.order_date DESC LIMIT 100`,
      [projectId]
    );
    res.json({ success: true, results: rows });
  } catch (err) {
    console.error('searchRMPOsByProjectId error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// The expand-card detail fetch — full header + line items + terms/taxes,
// same fields Create PO/Authorize PO show, but purely for display. No
// revision-diff/"changed" logic here (that's fetchPOForRevision's job).
router.post('/fetchRMPOFullDetail', requirePermission('perm_search_rm_po'), async (req, res) => {
  const { poNo } = req.body;
  if (!poNo) return res.json({ success: false, error: 'PO Number is required.' });
  try {
    const { rows: [po] } = await pool.query(
      `SELECT po_no AS "poNo", vendor_name AS "vendorName", supplier_ref_offer_no AS "supplierRef",
              order_date AS "orderDate", delivery_date AS "deliveryDate", status,
              revision_number AS "revisionNumber",
              cgst_percent AS "cgstPercent", sgst_percent AS "sgstPercent", igst_percent AS "igstPercent",
              packing_amount AS "packing", freight_amount AS "freight", other_amount AS "other",
              round_off AS "roundOff", warranty, payment_terms AS "paymentTerms", freight_terms AS "freightTerms",
              sub_total AS "subTotal", grand_total AS "grandTotal", prepared_by AS "preparedBy",
              authorized_by AS "authorizedBy"
       FROM purchase.raw_material_purchase_orders WHERE po_no = $1 AND status = 'Authorized'`,
      [poNo]
    );
    if (!po) return res.json({ success: false, error: 'PO not found or not Authorized.' });

    const { rows: lineItems } = await pool.query(
      `SELECT l.line_id AS "srNo", l.item_code AS "itemCode", l.description_of_material AS "description",
              l.unit, l.quantity, l.rate_per_quantity AS "rate", l.discount_percent AS "discountPercent",
              l.amount, l.delivery_date AS "deliveryDate",
              COALESCE((SELECT json_agg(json_build_object('prnId', t.prn_id, 'projectId', t.project_id,
                          'quantity', t.purchased_quantity))
                        FROM purchase.pps_tracking t
                        WHERE t.po_no = l.po_no AND t.item_code = l.item_code),
                       '[]'::json) AS "allocations"
       FROM purchase.raw_material_po_line_items l
       WHERE l.po_no = $1
       ORDER BY l.line_id`,
      [poNo]
    );

    res.json({ success: true, po, lineItems });
  } catch (err) {
    console.error('fetchRMPOFullDetail error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchRMPOVendorsByMaterial', requirePermission('perm_search_rm_po'), async (req, res) => {
  const { itemCode } = req.body;
  if (!itemCode) return res.json({ success: false, error: 'A material is required.' });
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT v.vendor_name AS "vendorName", v.gstin_uin AS "gstinUin",
              v.type_of_vendor AS "typeOfVendor", v.contact_person AS "contactPerson",
              v.phone_number AS "phoneNumber", v.email, v.city, v.state, v.state_code AS "stateCode",
              v.address, v.status
       FROM purchase.vendor_information v
       JOIN purchase.raw_material_purchase_orders po ON po.vendor_name = v.vendor_name
       JOIN purchase.raw_material_po_line_items l ON l.po_no = po.po_no
       WHERE po.status = 'Authorized' AND l.item_code = $1
       ORDER BY v.vendor_name`,
      [itemCode]
    );
    res.json({ success: true, vendors: rows });
  } catch (err) {
    console.error('searchRMPOVendorsByMaterial error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/searchRMPOVendorsByProjectId', requirePermission('perm_search_rm_po'), async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.json({ success: false, error: 'A Project ID is required.' });
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT v.vendor_name AS "vendorName", v.gstin_uin AS "gstinUin",
              v.type_of_vendor AS "typeOfVendor", v.contact_person AS "contactPerson",
              v.phone_number AS "phoneNumber", v.email, v.city, v.state, v.state_code AS "stateCode",
              v.address, v.status
       FROM purchase.vendor_information v
       JOIN purchase.raw_material_purchase_orders po ON po.vendor_name = v.vendor_name
       JOIN purchase.pps_tracking t ON t.po_no = po.po_no
       WHERE po.status = 'Authorized' AND t.project_id = $1
       ORDER BY v.vendor_name`,
      [projectId]
    );
    res.json({ success: true, vendors: rows });
  } catch (err) {
    console.error('searchRMPOVendorsByProjectId error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pending PO revisions awaiting authorization. Returns the drafted lines
// alongside the PO's CURRENT lines so the screen can render a true
// before/after change summary — the live PO is untouched while a revision
// is pending, so "current" really is what the revision would replace.
router.post('/fetchPendingPORevisions', requirePermission('perm_authorize_rm_po_revision'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.request_id AS "requestId", r.po_no AS "poNo", r.revision_kind AS "revisionKind",
              r.requested_by AS "requestedBy", r.requested_at AS "requestedAt",
              r.revised_line_items AS "revisedLineItems", r.drafted_prn_versions AS "draftedPrnVersions",
              r.rejection_reason AS "reason", r.header_changes AS "headerChanges",
              po.vendor_name AS "vendorName", po.order_date AS "orderDate",
              po.delivery_date AS "deliveryDate", po.revision_number AS "revisionNumber",
              po.sub_total AS "subTotal", po.grand_total AS "grandTotal",
              po.supplier_ref_offer_no AS "supplierRef",
              po.cgst_percent AS "cgstPercent", po.sgst_percent AS "sgstPercent", po.igst_percent AS "igstPercent",
              po.packing_amount AS "packing", po.freight_amount AS "freight",
              po.other_amount AS "other", po.round_off AS "roundOff",
              po.warranty, po.payment_terms AS "paymentTerms", po.freight_terms AS "freightTerms",
              COALESCE((SELECT json_agg(json_build_object(
                          'itemCode', l.item_code, 'description', l.description_of_material,
                          'quantity', l.quantity, 'rate', l.rate_per_quantity,
                          'discountPercent', l.discount_percent, 'amount', l.amount,
                          'received', COALESCE((SELECT SUM(t.actual_received_quantity)
                                                FROM purchase.pps_tracking t
                                                WHERE t.po_no = l.po_no AND t.item_code = l.item_code), 0)))
                        FROM purchase.raw_material_po_line_items l WHERE l.po_no = r.po_no),
                       '[]'::json) AS "currentLines"
       FROM purchase.po_revision_requests r
       JOIN purchase.raw_material_purchase_orders po ON po.po_no = r.po_no
       WHERE r.status = 'Pending Authorization'
       ORDER BY r.requested_at ASC`
    );
    res.json({ success: true, revisions: rows });
  } catch (err) {
    console.error('fetchPendingPORevisions error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Renders the PO document from the LINE ITEMS TABLE, never from
// material_rows — that JSONB blob is written once at creation and is not
// updated by revisions, so rendering from it would silently produce a
// document showing pre-revision quantities and rates.
// One subfolder per PO number+date under RAW_MATERIAL_PO_FOLDER_ID,
// holding the original PDF and every later revision together.
// Folder name and the rev-1 file both use the ORIGINAL authorization
// date (po.folder_dated_at, set once at first authorization and never
// touched again — see authorizePurchaseOrder) so the folder name stays
// stable across every future revision; ensureNestedFolderPath matches by
// exact name, so a drifting folder name would silently create a new
// folder per revision instead of reusing one. Revision files (Rev2+)
// are dated to when THAT SPECIFIC revision was authorized instead,
// pulled from the matching po_revision_requests row.
async function regeneratePODocument(poNo, client) {
  const db = client || pool;
  const { rows: [po] } = await db.query(
    `SELECT * FROM purchase.raw_material_purchase_orders WHERE po_no = $1`, [poNo]);
  if (!po) return null;

  const { rows: lineItems } = await db.query(
    `SELECT description_of_material AS "description", item_code AS "itemCode",
            quantity, unit, rate_per_quantity AS "rate",
            discount_percent AS "discountPercent", amount, delivery_date AS "deliveryDate"
     FROM purchase.raw_material_po_line_items WHERE po_no = $1 ORDER BY line_id`, [poNo]);

  const { rows: [vendor] } = await db.query(
    `SELECT * FROM purchase.vendor_information WHERE vendor_name = $1 LIMIT 1`, [po.vendor_name]);

  const revision = Number(po.revision_number) || 1;
  const html = renderPurchaseOrderHTML({
    poNumber: po.po_no, supplierRef: po.supplier_ref_offer_no, orderDate: po.order_date,
    deliveryDate: po.delivery_date, lineItems, vendorName: po.vendor_name,
    vendorAddress: vendor?.address || vendor?.vendor_address || '',
    vendorGstin: vendor?.gstin_uin || vendor?.gstin || vendor?.gst_number || vendor?.vendor_gstin || '',
    vendorState: vendor?.state || vendor?.state_name || '',
    vendorCode: vendor?.state_code || '',
    vendorEmail: vendor?.email || vendor?.vendor_email || '',
    cgstPercent: po.cgst_percent, sgstPercent: po.sgst_percent, igstPercent: po.igst_percent,
    packing: po.packing_amount, freight: po.freight_amount,
    other: po.other_amount, roundOff: po.round_off,
    warranty: po.warranty, paymentTerms: po.payment_terms, freightTerms: po.freight_terms,
    preparedBy: po.prepared_by || '', authorizedBy: po.authorized_by || '',
  });
  const pdfBytes = await convertHTMLToPDF(html);

  const fmtDate = (d) => {
    const dt = d ? new Date(d) : new Date();
    const dd = String(dt.getDate()).padStart(2, '0');
    const mmm = dt.toLocaleString('en-US', { month: 'short' });
    return `${dd}-${mmm}-${dt.getFullYear()}`;
  };

  const folderBaseName = `${poNo}_${fmtDate(po.folder_dated_at)}`;
  let fileName = `${folderBaseName}.pdf`;
  if (revision > 1) {
    const { rows: [latestRevReq] } = await db.query(
      `SELECT authorized_at FROM purchase.po_revision_requests
       WHERE po_no = $1 AND status = 'Authorized'
       ORDER BY authorized_at DESC NULLS LAST LIMIT 1`, [poNo]);
    fileName = `${poNo}_${fmtDate(latestRevReq?.authorized_at)}_Rev${revision}.pdf`;
  }

  const rootFolderId = process.env.RAW_MATERIAL_PO_FOLDER_ID;
  if (!rootFolderId) throw new Error('RAW_MATERIAL_PO_FOLDER_ID is not configured on the server.');
  const poFolderId = await ensureNestedFolderPath(rootFolderId, [folderBaseName]);
  const { url } = await uploadFile(poFolderId, Buffer.from(pdfBytes), fileName, 'application/pdf');

  await db.query(
    `UPDATE purchase.raw_material_purchase_orders SET drive_file_url = $1 WHERE po_no = $2`,
    [url, poNo]);
  return url;
}

// ── Stock Assignment ──────────────────────────────────────────────────────

// reassignStockBetweenPRNs — moves a claimed quantity from one PRN's
// line to another's. Releases the exact recorded spare/raw split from
// the source, then claims fresh for the target — same mechanism as
// every other assignment path, so both PRNs' purchase_quantity,
// documents, and completion status stay correct on both ends.
router.post('/submitReserveStockChanges', requirePermission('perm_reserve_store_stock'), async (req, res) => {
  const { itemCode, changes } = req.body;
  if (!itemCode || !changes?.length) return res.json({ success: false, error: 'Item code and changes are required.' });
  try {
    const { rows: [matRow] } = await pool.query(`SELECT material_name FROM store.raw_material_store WHERE item_code = $1`, [itemCode]);
    const materialName = matRow?.material_name || null;

    await withTransaction(async (client) => {
      for (const c of changes) {
        const { rows: [li] } = await client.query(
          `SELECT raw_pool_remaining FROM purchase.prn_line_items WHERE prn_id = $1 AND item_code = $2 FOR UPDATE`,
          [c.prnId, itemCode]
        );
        if (!li) throw new Error(`No line item found for ${c.prnId} / ${itemCode}.`);
        const currentRaw = Number(li.raw_pool_remaining) || 0;
        const diff = Number(c.newQty) - currentRaw;
        if (Math.abs(diff) < 1e-9) continue;

        if (diff > 0) {
          const id = await claimStoreForPRN(client, c.prnId, itemCode, materialName, diff, req.body.operatorName || displayName(req));
          if (id) syncLiveRow('stock_reservations', id);
        } else {
          const release = Math.abs(diff);
          if (release > currentRaw + 1e-9) {
            throw new Error(`Cannot reduce ${c.prnId} below 0 (currently ${currentRaw}).`);
          }
          await releaseStoreClaimFromPRN(client, c.prnId, itemCode, release, 0, release);
        }
      }
    });
    await writeAuditLog(req.user.email, req.body.operatorName, 'StockAssignments', 'RESERVE_UPDATE', itemCode,
      `Updated reserved quantities for ${changes.length} BOQ row(s) on ${itemCode}.`);
    res.json({ success: true });
  } catch (err) {
    console.error('submitReserveStockChanges error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// parseRawMaterialPurchaseOrder — extraction-only, mirrors the
// business-card-scan two-step pattern: parse first, operator reviews
// and corrects, THEN uploadRawMaterialPurchaseOrder actually commits it.
router.post('/parseRawMaterialPurchaseOrder', requirePermission('perm_create_rm_po'), async (req, res) => {
  const { fileData64, mimeType } = req.body;
  if (!fileData64) return res.json({ success: false, error: 'File data is required.' });

  try {
    await checkGeminiRateLimit(pool, req.user.email, 'parseRawMaterialPurchaseOrder');
    const { rows: catalog } = await pool.query(`SELECT item_code AS "itemCode", material_name AS "materialName" FROM design.item_codes LIMIT 500`);
    const extractedData = await parseRawMaterialPO(fileData64, mimeType, catalog);
    res.json({ success: true, extractedData });
  } catch (err) {
    console.error('parseRawMaterialPurchaseOrder error:', err);
    const status = err.isRateLimit ? 429 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// uploadRawMaterialPurchaseOrder — commits the (operator-reviewed) parsed
// PO, uploads the original file to the flat RAW_MATERIAL_PO_FOLDER_ID,
// and flags any line items that never got a confident item code match.
router.post('/uploadRawMaterialPurchaseOrder', requirePermission('perm_create_rm_po'), async (req, res) => {
  const { vendorName, poNumber, orderDate, deliveryDate, grandTotal, lineItems, fileData64, fileName, mimeType, uploadedBy } = req.body;
  if (!vendorName || !lineItems?.length) return res.json({ success: false, error: 'Vendor and line items are required.' });

  try {
    const unmatchedItems = lineItems.filter(li => !li.itemCode).map(li => li.description);

    const poNo = await withTransaction(async (client) => {
      const computedAmounts = lineItems.map(li => (parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0));
      const subTotal = computedAmounts.reduce((sum, a) => sum + a, 0);
      const resolvedUploadedBy = uploadedBy || req.body.operatorName ||
        `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Unknown';
      const { rows: [poRow] } = await client.query(
        `INSERT INTO purchase.raw_material_purchase_orders
           (vendor_name, order_date, delivery_date, material_rows, sub_total, grand_total, prepared_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending Authorization')
         RETURNING po_no`,
        [vendorName, orderDate, deliveryDate, JSON.stringify(lineItems), subTotal, grandTotal || subTotal, resolvedUploadedBy]
      );
      const poNo = poRow.po_no;

      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i];
        await client.query(
          `INSERT INTO purchase.raw_material_po_line_items
             (po_no, description_of_material, item_code, quantity, unit, rate_per_quantity, amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [poNo, li.description, li.itemCode || null, li.quantity, li.unit, li.rate, computedAmounts[i]]
        );
      }
      return poNo;
    });
    syncLiveRow('raw_material_purchase_orders', poNo);

    await writeAuditLog(req.user.email, req.body.operatorName, 'RawMaterialPurchaseOrders', 'AI_UPLOAD', poNo,
      `AI-parsed PO uploaded for vendor "${vendorName}" (${lineItems.length} items, ${unmatchedItems.length} unmatched).`);
    res.json({ success: true, poNo, unmatchedCount: unmatchedItems.length, unmatchedItems });
  } catch (err) {
    console.error('uploadRawMaterialPurchaseOrder error:', err);
    res.status(500).json({ success: false, error: 'Upload failed: ' + err.message });
  }
});

module.exports = router;
