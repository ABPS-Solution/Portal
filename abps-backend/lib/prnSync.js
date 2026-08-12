// ═══════════════════════════════════════════════════════════════════════
// lib/prnSync.js — single source of truth for "what does this BOQ's
// current state mean for its PRN". Both previewPRNMaterials (display)
// and createPurchaseRequestNote (authoritative write) call
// computePRNDeltaRows, so the numbers a store person approves are
// produced by exactly the same code that persists them. The client never
// supplies a computed quantity — only its choice of store/purchase split
// on INCREASE rows, which is re-validated server-side against live stock.
// ═══════════════════════════════════════════════════════════════════════
const { pool } = require('../db');
const { buildPRNPdfBuffer } = require('./pdf');
const { ensureNestedFolderPath, uploadFile } = require('./drive');

// Signed delta per item against the BOQ's current buffered requirement.
// Positive = more coverage needed. Negative = unwind. Zero = unchanged
// (omitted). Iterates the UNION of BOQ items and existing PRN items — a
// material removed from the BOQ has no bill_of_quantity row but still has
// coverage to unwind, so iterating the BOQ alone would silently skip it.
async function computePRNDeltaRows(client, boqId) {
  const { rows: [boq] } = await client.query(
    `SELECT order_quantity FROM design.boq_drafts WHERE boq_id = $1`, [boqId]
  );
  if (!boq) throw new Error('BOQ not found.');

  const { rows: [prn] } = await client.query(
    `SELECT prn_id, version, status FROM purchase.purchase_request_notes WHERE boq_id = $1`,
    [boqId]
  );

  const { rows: priorRows } = await client.query(
    `SELECT li.* FROM purchase.prn_line_items li
     JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
     WHERE p.boq_id = $1`,
    [boqId]
  );
  const priorByItemCode = Object.fromEntries(priorRows.map(r => [r.item_code, r]));

  // Finished Goods Store rows are manufactured in-house against their own
  // BOQ, never purchased — including them here would generate a PRN/PO
  // for material that's never actually bought. Same normalization
  // ensureMaterialsInInventory uses, since stored values may vary in
  // casing/spacing ("Raw Materials Store" vs "raw materials store").
  const { rows: materials } = await client.query(
    `SELECT bd.item_code, bd.description_of_material AS material_name, bd.unit_type,
            bd.qty_for_1_set, ic.type_of_material,
            COALESCE(mbp.buffer_percent, 0) AS buffer_percent,
            COALESCE(mi.available_stock, 0) + COALESCE(si.available_stock, 0) AS available_stock,
            COALESCE(si.available_stock, 0) AS spare_available_stock
     FROM design.bill_of_quantity bd
     LEFT JOIN design.item_codes ic ON ic.item_code = bd.item_code
     LEFT JOIN purchase.material_buffer_percentage mbp ON mbp.type_of_material = ic.type_of_material
     LEFT JOIN store.raw_material_store mi ON mi.item_code = bd.item_code
     LEFT JOIN store.spare_store si ON si.item_code = bd.item_code
     WHERE bd.boq_id = $1
       AND lower(regexp_replace(bd.type_of_store, '\\s+', '', 'g')) IN ('rawmaterialsstore', 'rawmaterial')`,
    [boqId]
  );
  const boqByItemCode = Object.fromEntries(materials.map(m => [m.item_code, m]));

  const isDeltaPRN = !!prn;
  const allItemCodes = [...new Set([...Object.keys(boqByItemCode), ...Object.keys(priorByItemCode)])];
  const rows = [];

  for (const code of allItemCodes) {
    const m = boqByItemCode[code];
    const prior = priorByItemCode[code];

    const coveredStore    = prior ? parseFloat(prior.current_unassigned_store_quantity) || 0 : 0;
    const coveredPurchase = prior ? parseFloat(prior.purchase_quantity) || 0 : 0;
    const onOrder         = prior ? parseFloat(prior.on_order_quantity) || 0 : 0;
    const received        = prior ? parseFloat(prior.received_quantity) || 0 : 0;
    const covered         = coveredStore + coveredPurchase;

    const unitType  = (m ? m.unit_type : prior?.unit_type) || '';
    const isCountUnit = unitType.toString().trim().toUpperCase() === 'NOS';
    const bufferPct = m ? parseFloat(m.buffer_percent || 0)
                        : (prior ? parseFloat(prior.buffer_percent) || 0 : 0);
    const boqRequiredQty = m ? parseFloat(m.qty_for_1_set || 0) * parseFloat(boq.order_quantity || 0) : 0;
    // Rounded UP to the next whole number only when a buffer% actually
    // applies — the buffer math is what introduces the messy decimal
    // (390 * 1.06 = 413.4) in the first place, so a material with no
    // buffer (bufferPct === 0) is left exactly as-is (e.g. 0.5 stays 0.5,
    // never bumped to 1).
    const rawBufferedRequirement = boqRequiredQty * (1 + bufferPct / 100);
    const bufferedRequirement = bufferPct > 0 ? Math.ceil(rawBufferedRequirement - 1e-9) : rawBufferedRequirement;
    const availableStock = m ? parseFloat(m.available_stock || 0) : 0;

    const base = {
      itemCode: code,
      materialName: m ? m.material_name : prior.material_name,
      typeOfMaterial: m ? m.type_of_material : prior.type_of_material,
      unit: unitType, bufferPct, boqRequiredQty, bufferedRequirement,
      availableStock, isCountUnit,
      previousStoreQty: coveredStore, previousPurchaseQty: coveredPurchase,
      onOrderQty: onOrder, receivedQty: received,
    };
    const _spareFreeForBase = m ? parseFloat(m.spare_available_stock || 0) : 0;

    if (!isDeltaPRN) {
      const rawPurchase = Math.max(0, bufferedRequirement - availableStock);
      const purchaseQty = isCountUnit ? Math.ceil(rawPurchase - 1e-9) : rawPurchase;
      const suggestSpareNew = Math.min(_spareFreeForBase, availableStock);
      rows.push({
        ...base, changeKind: 'new', editable: true, deferred: false,
        storeDelta: availableStock, purchaseDelta: purchaseQty,
        newStoreTotal: availableStock, newPurchaseTotal: purchaseQty,
        storeFromSpareDelta: suggestSpareNew, storeFromRawDelta: availableStock - suggestSpareNew,
      });
      continue;
    }

    const delta = bufferedRequirement - covered;
    if (Math.abs(delta) < 1e-9) continue;

    if (delta > 0) {
      const suggestedStore = Math.min(availableStock, delta);
      const rawPurchase = delta - suggestedStore;
      const purchaseQty = isCountUnit ? Math.ceil(rawPurchase - 1e-9) : rawPurchase;
      const suggestSpare = Math.min(_spareFreeForBase, suggestedStore);
      rows.push({
        ...base,
        // A positive delta within an existing delta-PRN was always
        // classified 'increase', even when this material never had a
        // prior PRN line at all (prior undefined) — that's a material
        // genuinely new to this BOQ revision, same as the no-prior-PRN
        // case above, not an increase to something that already existed.
        changeKind: prior ? 'increase' : 'new',
        editable: true, deferred: false,
        deltaRequirement: delta,
        storeDelta: suggestedStore, purchaseDelta: purchaseQty,
        newStoreTotal: coveredStore + suggestedStore,
        newPurchaseTotal: coveredPurchase + purchaseQty,
        storeFromSpareDelta: suggestSpare, storeFromRawDelta: suggestedStore - suggestSpare,
        // This row's own currently-held split (0/0 if truly new) — needed
        // for the Create PRN live-stock display to add it back to the
        // live pool, same as decrease rows.
        storeFromRaw: Number(prior?.store_qty_from_raw) || 0,
        storeFromSpare: Number(prior?.store_qty_from_spare) || 0,
      });
    } else {
      // Unwind purchase BEFORE store — an un-ordered purchase line is free
      // to cancel, whereas releasing store stock we might need back risks
      // another PRN claiming it in the meantime.
      const unwind = -delta;
      const purchaseCut = Math.min(unwind, coveredPurchase);
      const storeCut = unwind - purchaseCut;
      const newPurchase = coveredPurchase - purchaseCut;
      const newStore = Math.max(0, coveredStore - storeCut);
      // Blocked when the PO already covers more than we now need: the
      // unwind can't complete until that PO is revised down.
      const deferred = onOrder > newPurchase + 1e-9;

      const releaseAmt = deferred ? 0 : (coveredStore - newStore);
      const releaseSplit = deferred
        ? { fromSpare: 0, fromRaw: 0 }
        : splitStoreRelease(releaseAmt, prior?.store_qty_from_spare, prior?.store_qty_from_raw);

      rows.push({
        ...base,
        changeKind: m ? 'decrease' : 'removed',
        editable: false, deferred,
        deltaRequirement: delta,
        // Store side stays frozen when deferred — the actual release
        // can't happen until the linked PO is revised down. Purchase
        // side moves immediately regardless of deferred: it reflects the
        // true current requirement right away; only the real on-order
        // stock (tracked separately via awaiting_po_revision) stays
        // pinned to what's actually on that PO until it's revised.
        storeDelta: deferred ? 0 : (newStore - coveredStore),
        purchaseDelta: newPurchase - coveredPurchase,
        newStoreTotal: deferred ? coveredStore : newStore,
        newPurchaseTotal: newPurchase,
        storeReleased: releaseAmt,
        storeFromSpareDelta: -releaseSplit.fromSpare, storeFromRawDelta: -releaseSplit.fromRaw,
        // What this row ALREADY holds right now, per pool — needed so the
        // Create PRN live-stock display can add it back to the live pool
        // (same as Revise PRN/Authorize PRN already do), instead of
        // treating the pre-filled Store Quantity as a brand-new claim
        // against stock this PRN already has.
        storeFromRaw: Number(prior?.store_qty_from_raw) || 0,
        storeFromSpare: Number(prior?.store_qty_from_spare) || 0,
      });
    }
  }

  const hasIncrease = rows.some(r => r.changeKind === 'increase' || r.changeKind === 'new');
  return { boq, prn, rows, isDeltaPRN, hasIncrease, pureDecrease: isDeltaPRN && !hasIncrease };
}

// Applies computed rows to prn_line_items CUMULATIVELY via signed deltas.
// Deliberately does NOT touch reserved_stock — creation reserves an
// increase up front, authorization adjusts only the difference, and
// rejection releases it, so a reservation move here would double-count.
// Every caller moves stock explicitly at its own site. One stable row per
// item code for the BOQ's whole life — never deleted or re-inserted, so
// on_order_quantity and assigned_quantity (owned by the PO and
// Assign-Store-Stock flows) survive untouched.
async function applyPRNRows(client, prnId, rows, storePerson) {
  for (const row of rows) {
    const { rows: [existing] } = await client.query(
      `SELECT current_unassigned_store_quantity, purchase_quantity, on_order_quantity,
              assigned_quantity, received_quantity, store_qty_from_spare, store_qty_from_raw
       FROM purchase.prn_line_items WHERE prn_id = $1 AND item_code = $2 FOR UPDATE`,
      [prnId, row.itemCode]
    );

    const curStore    = existing ? parseFloat(existing.current_unassigned_store_quantity) || 0 : 0;
    const curPurchase = existing ? parseFloat(existing.purchase_quantity) || 0 : 0;
    const onOrder     = existing ? parseFloat(existing.on_order_quantity) || 0 : 0;
    const assigned    = existing ? parseFloat(existing.assigned_quantity) || 0 : 0;

    const newStore    = Math.max(0, curStore + (row.storeDelta || 0));
    const newPurchase = Math.max(0, curPurchase + (row.purchaseDelta || 0));
    const stillToOrder = Math.max(0, newPurchase - assigned - onOrder);

    const spareDelta = Number(row.storeFromSpareDelta) || 0;
    const rawDelta = Number(row.storeFromRawDelta) || 0;
    const curSpare = existing ? Number(existing.store_qty_from_spare) || 0 : 0;
    const curRaw = existing ? Number(existing.store_qty_from_raw) || 0 : 0;
    const newSpareSplit = Math.max(0, curSpare + spareDelta);
    const newRawSplit = Math.max(0, curRaw + rawDelta);

    if (existing) {
      await client.query(
        `UPDATE purchase.prn_line_items
         SET material_name = $1, type_of_material = $2, unit_type = $3,
             boq_required_quantity = $4, buffer_percent = $5, buffered_purchase_quantity = $6,
             current_unassigned_store_quantity = $7, purchase_quantity = $8,
             still_to_order_quantity = $9, awaiting_po_revision = $10, created_by = $11,
             store_qty_from_spare = $12, store_qty_from_raw = $13
         WHERE prn_id = $14 AND item_code = $15`,
        [row.materialName, row.typeOfMaterial, row.unit, row.boqRequiredQty, row.bufferPct,
         row.bufferedRequirement, newStore, newPurchase, stillToOrder,
         !!row.deferred, storePerson, newSpareSplit, newRawSplit, prnId, row.itemCode]
      );
    } else {
      await client.query(
        `INSERT INTO purchase.prn_line_items
           (prn_id, item_code, material_name, type_of_material, unit_type, boq_required_quantity,
            buffer_percent, buffered_purchase_quantity, current_unassigned_store_quantity,
            purchase_quantity, original_purchased_buffered_quantity, assigned_quantity,
            on_order_quantity, still_to_order_quantity, received_quantity,
            awaiting_po_revision, created_by, store_qty_from_spare, store_qty_from_raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$8,0,0,$10,0,$11,$12,$13,$14)`,
        [prnId, row.itemCode, row.materialName, row.typeOfMaterial, row.unit, row.boqRequiredQty,
         row.bufferPct, row.bufferedRequirement, newStore, newPurchase, !!row.deferred, storePerson,
         newSpareSplit, newRawSplit]
      );
    }
  }
}

// Applies exact signed deltas to each pool's reservation — the CALLER
// always decides the split beforehand; this only executes it.
// spare_store.available_stock is a generated column (total_stock -
// unusable_stock - reserved_stock), same as raw_material_store — only
// reserved_stock needs writing here, available_stock follows on its own.
async function applyStoreReservationSplit(client, itemCode, spareDelta, rawDelta) {
  if (Math.abs(spareDelta) > 1e-9) {
    await client.query(
      `UPDATE store.spare_store
       SET reserved_stock = GREATEST(0, reserved_stock + $1)
       WHERE item_code = $2`,
      [spareDelta, itemCode]
    );
  }
  if (Math.abs(rawDelta) > 1e-9) {
    await client.query(
      `UPDATE store.raw_material_store SET reserved_stock = GREATEST(0, reserved_stock + $1) WHERE item_code = $2`,
      [rawDelta, itemCode]
    );
  }
}

// Splits a POSITIVE claim across spare and raw stock, spare first — per
// explicit decision: requesting 80 against Raw:100/Spare:20 draws 20
// from spare, then 60 from raw. Throws if the combined pools can't
// cover it. Locks both rows (FOR UPDATE) so two concurrent claims on
// the same item code can't both pass validation against the same stock.
async function splitStoreClaim(client, itemCode, qty) {
  if (qty <= 1e-9) return { fromSpare: 0, fromRaw: 0 };
  const { rows: [spare] } = await client.query(
    `SELECT COALESCE(available_stock,0) AS available_stock FROM store.spare_store WHERE item_code = $1 FOR UPDATE`, [itemCode]);
  const { rows: [raw] } = await client.query(
    `SELECT COALESCE(available_stock,0) AS available_stock FROM store.raw_material_store WHERE item_code = $1 FOR UPDATE`, [itemCode]);
  const spareFree = spare ? Number(spare.available_stock) || 0 : 0;
  const rawFree = raw ? Number(raw.available_stock) || 0 : 0;
  if (qty > spareFree + rawFree + 1e-9) {
    throw new Error(`Only ${spareFree + rawFree} of ${itemCode} is free in store (Raw: ${rawFree}, Spare: ${spareFree}) — cannot claim ${qty}.`);
  }
  const fromSpare = Math.min(qty, spareFree);
  const fromRaw = qty - fromSpare;
  return { fromSpare, fromRaw };
}

// Splits a RELEASE against what THIS line actually has recorded per
// pool — spare released first, mirroring claim priority — capped at
// what's really allocated in each, never a live-pool guess.
function splitStoreRelease(qty, storeFromSpare, storeFromRaw) {
  const releaseSpare = Math.min(qty, Number(storeFromSpare) || 0);
  const releaseRaw = Math.min(qty - releaseSpare, Number(storeFromRaw) || 0);
  return { fromSpare: releaseSpare, fromRaw: releaseRaw };
}

// A PRN line is satisfied when its purchase quantity has been received in
// full — a store-only line (purchase 0) is satisfied immediately, which is
// deliberate: "Completed" means procurement is done, not that production
// has consumed the material. Reservations stay held until physical issue.
async function refreshPRNCompletion(client, prnId) {
  const { rows } = await client.query(
    `SELECT purchase_quantity, received_quantity, awaiting_po_revision
     FROM purchase.prn_line_items WHERE prn_id = $1`,
    [prnId]
  );
  if (rows.length === 0) return null;
  const complete = rows.every(r =>
    !r.awaiting_po_revision &&
    (parseFloat(r.received_quantity) || 0) >= (parseFloat(r.purchase_quantity) || 0) - 1e-9
  );
  const newStatus = complete ? 'Completed' : 'PRN Generated';
  await client.query(
    `UPDATE purchase.purchase_request_notes SET status = $1
     WHERE prn_id = $2 AND status IN ('PRN Generated','Completed')`,
    [newStatus, prnId]
  );
  return newStatus;
}

// Regenerates the PRN's document from CURRENT line-item state (not from a
// delta set) and files it under Purchase Root -> Project -> PRN ID, with
// Rev-N naming from v2 onward. Called after authorization AND after a
// silent decrease, so the Drive copy never lags the database.
async function regeneratePRNDocument(prnId, client) {
  const db = client || pool;
  const { rows: [prn] } = await db.query(
    `SELECT p.*, b.customer_name
     FROM purchase.purchase_request_notes p
     LEFT JOIN design.boq_drafts b ON b.boq_id = p.boq_id
     WHERE p.prn_id = $1`,
    [prnId]
  );
  if (!prn) return null;

  const { rows: lineItems } = await db.query(
    `SELECT item_code AS "itemCode", material_name AS "materialName",
            type_of_material AS "typeOfMaterial", unit_type AS "unit",
            boq_required_quantity AS "boqRequiredQty", buffer_percent AS "bufferPct",
            buffered_purchase_quantity AS "bufferedPurchaseQty",
            current_unassigned_store_quantity AS "currentUnassignedStoreQty",
            purchase_quantity AS "purchaseQty"
     FROM purchase.prn_line_items
     WHERE prn_id = $1 AND buffered_purchase_quantity > 0
     ORDER BY item_code`,
    [prnId]
  );

  const version = Number(prn.version) || 1;
  const pdfBytes = await buildPRNPdfBuffer({
    prnId, projectId: prn.project_id, customerName: prn.customer_name || '',
    productName: prn.product_name, productRating: prn.product_rating,
    orderQuantity: prn.order_quantity, storePerson: prn.created_by,
    authorizedBy: prn.authorized_by,
    isDeltaPRN: false, version, lineItems,
  });

  const rootFolderId = process.env.PURCHASE_ROOT_FOLDER_ID;
  if (!rootFolderId) throw new Error('Purchase Drive root folder is not configured on the server.');
  const folderId = await ensureNestedFolderPath(rootFolderId, [prn.project_id, prnId]);
  const fileName = version > 1
    ? `PRN_Rev${version}_${prnId.replace(/^PRN_/, '')}.pdf`
    : `${prnId}.pdf`;

  const { url } = await uploadFile(folderId, Buffer.from(pdfBytes), fileName, 'application/pdf');
  await db.query(`UPDATE purchase.purchase_request_notes SET pdf_url = $1 WHERE prn_id = $2`, [url, prnId]);
  return url;
}

// Applies a BOQ revision to its PRN WITHOUT maker-checker, but only when
// it is unambiguously safe to do so. Returns null (a no-op) unless every
// condition holds:
//   * a PRN exists and is not mid-authorization — auto-editing rows an
//     authorizer is currently reviewing would change what they approve
//   * the revision is decreases/removals ONLY — any increase means real
//     judgement is needed (which store stock to claim), so the whole
//     revision goes through one authorized delta PRN instead
//   * the PRN is exactly one BOQ version behind — if it is further
//     behind there is an unapplied increase in flight, and applying the
//     decrease would advance boq_version_applied past it and hide that
//     increase from the needs-a-PRN queue forever
// Runs inside the caller's transaction; the PDF is regenerated after
// commit, matching how every other document in this system is handled.
async function applySilentPRNDecrease(client, boqId, actor) {
  const { rows: [boq] } = await client.query(
    `SELECT version FROM design.boq_drafts WHERE boq_id = $1`, [boqId]
  );
  if (!boq) return null;

  const { rows: [prn] } = await client.query(
    `SELECT prn_id, version, status, boq_version_applied
     FROM purchase.purchase_request_notes WHERE boq_id = $1 FOR UPDATE`,
    [boqId]
  );
  if (!prn) return null;
  if (prn.status === 'Pending Authorization') return null;

  const applied = Number(prn.boq_version_applied) || 0;
  if (applied !== Number(boq.version) - 1) return null;

  const computed = await computePRNDeltaRows(client, boqId);
  if (computed.rows.length === 0) return null;
  if (!computed.pureDecrease) return null;

  // Release the store stock each unwind frees, using the exact
  // spare/raw split computePRNDeltaRows already worked out for each
  // decrease row. Deferred rows release nothing — their storeDelta is 0
  // until the blocking PO is revised.
  for (const row of computed.rows) {
    if ((Number(row.storeDelta) || 0) < 0) {
      const spareQty = Number(row.storeFromSpareDelta) || 0;
      const rawQty = Number(row.storeFromRawDelta) || 0;
      await applyStoreReservationSplit(client, row.itemCode, spareQty, rawQty);
    }
  }

  await applyPRNRows(client, prn.prn_id, computed.rows, prn.created_by || actor || null);

  const newVersion = (Number(prn.version) || 1) + 1;
  await client.query(
    `UPDATE purchase.purchase_request_notes
     SET version = $1, boq_version_applied = $2, draft_line_items = $3
     WHERE prn_id = $4`,
    [newVersion, boq.version, JSON.stringify(computed.rows), prn.prn_id]
  );

  await refreshPRNCompletion(client, prn.prn_id);

  const deferredItems = computed.rows.filter(r => r.deferred).map(r => r.itemCode);
  const released = computed.rows
    .filter(r => (Number(r.storeReleased) || 0) > 0)
    .map(r => `${r.itemCode}: ${r.storeReleased}`);

  return {
    prnId: prn.prn_id, version: newVersion, boqVersion: boq.version,
    itemsChanged: computed.rows.map(r => r.itemCode),
    deferredItems, released,
  };
}

// Distributes a QA-passed receipt across a PO line's PRN allocations,
// FIFO by PRN authorization date, each capped at what that PRN was
// actually allocated. Anything left over after every allocation is
// satisfied is excess — it stays in stock UNRESERVED and available to
// anyone, which is the whole point of deliberate over-ordering.
//
// Replaces a blanket `WHERE po_no = $1 AND item_code = $2` update that
// added the full received quantity to every matching allocation — so a
// 40-unit delivery against three PRNs credited 120 units.
//
// Only OK quantity is ever passed here. Rejected material credits nothing
// until it is replaced (fresh gate entry -> QA) or repaired and released,
// at which point this runs again and fills whoever is next in line.
async function distributeReceiptFIFO(client, poNo, itemCode, okQty) {
  let remaining = Number(okQty) || 0;
  if (remaining <= 1e-9) return { credited: [], excess: 0 };

  const { rows: allocations } = await client.query(
    `SELECT t.pps_id, t.prn_id, t.purchased_quantity, t.actual_received_quantity
     FROM purchase.pps_tracking t
     JOIN purchase.purchase_request_notes p ON p.prn_id = t.prn_id
     WHERE t.po_no = $1 AND t.item_code = $2
     ORDER BY p.authorized_at ASC NULLS LAST, p.created_date ASC
     FOR UPDATE OF t`,
    [poNo, itemCode]
  );

  const credited = [];
  for (const alloc of allocations) {
    if (remaining <= 1e-9) break;
    const capacity = (Number(alloc.purchased_quantity) || 0)
                   - (Number(alloc.actual_received_quantity) || 0);
    if (capacity <= 1e-9) continue;

    const take = Math.min(remaining, capacity);

    await client.query(
      `UPDATE purchase.pps_tracking
       SET actual_received_quantity = COALESCE(actual_received_quantity, 0) + $1,
           actual_delivery_date = CURRENT_DATE,
           link_status = CASE
             WHEN COALESCE(actual_received_quantity, 0) + $1 >= purchased_quantity - 1e-9
             THEN 'Delivered' ELSE 'Partially Delivered' END
       WHERE pps_id = $2`,
      [take, alloc.pps_id]
    );

    await client.query(
      `UPDATE purchase.prn_line_items
       SET received_quantity = received_quantity + $1,
           on_order_quantity = GREATEST(0, on_order_quantity - $1)
       WHERE prn_id = $2 AND item_code = $3`,
      [take, alloc.prn_id, itemCode]
    );
    // Reservation no longer happens here — autoAssignStock (called by the
    // caller against the full received quantity) is now the single place
    // reserved_stock gets touched, so it isn't double-counted.

    credited.push({ prnId: alloc.prn_id, quantity: take });
    remaining -= take;
  }

  for (const c of credited) await refreshPRNCompletion(client, c.prnId);

  return { credited, excess: Math.max(0, remaining) };
}

// Claims store stock for a specific PRN line — the exact same mechanism
// (spare-first split, reserved_stock, and purchase_quantity reduced by
// the same amount) a human manually increasing Store Qty in Revise PRN
// uses. Every path that gives stock to an already-authorized, not-yet-
// ordered PRN — Assign Current Stock, Stock Sweep, QA-excess
// auto-assignment — goes through this one function so none of them can
// diverge from what the manual screen would have produced.
async function claimStoreForPRN(client, prnId, itemCode, materialName, take, assignedBy) {
  if (take <= 1e-9) return null;
  const { fromSpare, fromRaw } = await splitStoreClaim(client, itemCode, take);
  await applyStoreReservationSplit(client, itemCode, fromSpare, fromRaw);

  await client.query(
    `UPDATE purchase.prn_line_items
     SET current_unassigned_store_quantity = current_unassigned_store_quantity + $1,
         purchase_quantity = GREATEST(0, purchase_quantity - $1),
         still_to_order_quantity = GREATEST(0, still_to_order_quantity - $1),
         store_qty_from_spare = store_qty_from_spare + $2,
         store_qty_from_raw = store_qty_from_raw + $3,
         spare_pool_remaining = spare_pool_remaining + $2,
         raw_pool_remaining = raw_pool_remaining + $3
     WHERE prn_id = $4 AND item_code = $5`,
    [take, fromSpare, fromRaw, prnId, itemCode]
  );

  const { rows: [prnRow] } = await client.query(`SELECT boq_id, project_id FROM purchase.purchase_request_notes WHERE prn_id = $1`, [prnId]);
  const { rows: [assign] } = await client.query(
    `INSERT INTO store.stock_reservations (item_code, material_name, prn_id, boq_id, project_id, assigned_quantity, from_spare, from_raw, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING assignment_id`,
    [itemCode, materialName || null, prnId, prnRow?.boq_id || null, prnRow?.project_id || null, take, fromSpare, fromRaw, assignedBy]
  );

  await regeneratePRNDocument(prnId, client);
  await refreshPRNCompletion(client, prnId);
  return assign.assignment_id;
}

// Reverses claimStoreForPRN — releases a specific spare/raw split back
// (never a live-pool guess) and restores purchase_quantity by the same
// amount, so an unassign/reassign is indistinguishable from a manual
// Revise PRN decrease.
// Earmarks part of a BOQ's claim for a specific ticket at creation time —
// the claim shrinks immediately (so the breakdown modal reflects the
// pending draw), but reserved_stock does NOT move: the material was
// already held via the claim, this only re-attributes why, not whether.
// reserved_stock only actually releases at approval (see the ticket
// route), when total_stock drops with it — the real departure.
async function earmarkClaimForTicket(client, prnId, itemCode, qty, fromSpare, fromRaw) {
  if (qty <= 1e-9) return;
  await client.query(
    `UPDATE purchase.prn_line_items
     SET current_unassigned_store_quantity = GREATEST(0, current_unassigned_store_quantity - $1),
         store_qty_from_spare = GREATEST(0, store_qty_from_spare - $2),
         store_qty_from_raw = GREATEST(0, store_qty_from_raw - $3)
     WHERE prn_id = $4 AND item_code = $5`,
    [qty, fromSpare, fromRaw, prnId, itemCode]
  );
}

// Reverses earmarkClaimForTicket — a rejected ticket never drew
// anything, so the claim goes straight back onto that same PRN line.
async function restoreEarmarkedClaim(client, prnId, itemCode, qty, fromSpare, fromRaw) {
  if (qty <= 1e-9) return;
  await applyStoreReservationSplit(client, itemCode, fromSpare, fromRaw);
  await client.query(
    `UPDATE purchase.prn_line_items
     SET current_unassigned_store_quantity = current_unassigned_store_quantity + $1,
         store_qty_from_spare = store_qty_from_spare + $2,
         store_qty_from_raw = store_qty_from_raw + $3
     WHERE prn_id = $4 AND item_code = $5`,
    [qty, fromSpare, fromRaw, prnId, itemCode]
  );
}
// Raw-only variant of claimStoreForPRN — the normal function calls
// splitStoreClaim(), which claims from Spare first whenever it has free
// stock, which would silently violate the Raw-tickets-never-touch-Spare
// rule if reused for a Raw-to-Raw cross-BOQ reallocation. This claims
// only from raw_material_store, with everything else (PRN line update,
// stock_assignments record, PDF regen, completion refresh) identical.
async function claimRawOnlyForPRN(client, prnId, itemCode, materialName, take, assignedBy) {
  if (take <= 1e-9) return null;
  const { rows: [raw] } = await client.query(
    `SELECT COALESCE(available_stock,0) AS available_stock FROM store.raw_material_store WHERE item_code = $1 FOR UPDATE`, [itemCode]
  );
  const rawFree = raw ? Number(raw.available_stock) || 0 : 0;
  if (take > rawFree + 1e-9) {
    throw new Error(`Only ${rawFree} of ${itemCode} is free in Raw Material Store — cannot claim ${take}.`);
  }
  await client.query(
    `UPDATE store.raw_material_store SET reserved_stock = reserved_stock + $1 WHERE item_code = $2`,
    [take, itemCode]
  );

  await client.query(
    `UPDATE purchase.prn_line_items
     SET current_unassigned_store_quantity = current_unassigned_store_quantity + $1,
         purchase_quantity = GREATEST(0, purchase_quantity - $1),
         still_to_order_quantity = GREATEST(0, still_to_order_quantity - $1),
         store_qty_from_raw = store_qty_from_raw + $1,
         raw_pool_remaining = raw_pool_remaining + $1
     WHERE prn_id = $2 AND item_code = $3`,
    [take, prnId, itemCode]
  );

  const { rows: [prnRow] } = await client.query(`SELECT boq_id, project_id FROM purchase.purchase_request_notes WHERE prn_id = $1`, [prnId]);
  const { rows: [assign] } = await client.query(
    `INSERT INTO store.stock_reservations (item_code, material_name, prn_id, boq_id, project_id, assigned_quantity, from_spare, from_raw, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $6, $7) RETURNING assignment_id`,
    [itemCode, materialName || null, prnId, prnRow?.boq_id || null, prnRow?.project_id || null, take, assignedBy]
  );

  await regeneratePRNDocument(prnId, client);
  await refreshPRNCompletion(client, prnId);
  return assign.assignment_id;
}

// ── Job Card material borrowing (donor-JC reallocation) ─────────────────
// Finds a donor for a raw-material shortfall on one Job Card, preferring
// (a) a later, not-yet-started Set within the SAME BOQ (same PRN, no
// cross-BOQ document effects — just re-slicing job_card_materials between
// two JCs sharing one pool), falling back to (b) another BOQ entirely,
// but only once the requesting JC is on the last Set of its own BOQ (no
// same-BOQ donor can possibly exist). Cross-BOQ candidates are ranked by
// estimated real time-to-need, using each BOQ's own historical average
// days-per-completed-Set — falls back to raw Sets-remaining when a BOQ
// doesn't have at least 2 completed Sets to compute a meaningful average.
// Returns { covered, stillShort } — covered may be less than requested if
// no combination of donors can fully cover it; caller decides what that
// means (e.g. approval must fail).
async function findAndBorrowForShortfall(client, { itemCode, materialName, jobCardNumber, boqId, prnId, shortfallQty, actionedBy }) {
  let remaining = Number(shortfallQty) || 0;
  if (remaining <= 1e-9) return { covered: 0, stillShort: 0 };

  const { rows: [requesterJc] } = await client.query(
    `SELECT set_number FROM production.job_cards WHERE job_card_number = $1`, [jobCardNumber]
  );
  const requesterSet = requesterJc ? Number(requesterJc.set_number) : null;
  let covered = 0;

  // ── (a) Same-BOQ donors first — later Sets, latest first. A later Set
  // that hasn't created its own ticket yet has never drawn from
  // raw_pool_remaining — its "share" is still physically sitting in the
  // shared pool, just paper-earmarked in job_card_materials. So this
  // isn't a physical transfer: release the donor's paper claim and top up
  // raw_pool_remaining by the same amount, so the requester's own draw
  // (already computed as min(requested, raw_pool_remaining) at ticket
  // creation) succeeds against a now-larger pool. ──
  if (requesterSet !== null) {
    const { rows: laterSets } = await client.query(
      `SELECT jc.job_card_number AS "jobCardNumber", jc.set_number AS "setNumber", m.remaining_quantity AS "remainingQty"
       FROM production.job_cards jc
       JOIN production.job_card_materials m ON m.job_card_number = jc.job_card_number AND m.item_code = $1
       WHERE jc.boq_id = $2 AND jc.set_number > $3
       ORDER BY jc.set_number DESC`,
      [itemCode, boqId, requesterSet]
    );
    for (const donor of laterSets) {
      if (remaining <= 1e-9) break;
      const donorAvail = Number(donor.remainingQty) || 0;
      if (donorAvail <= 1e-9) continue;
      const take = Math.min(remaining, donorAvail);
      await client.query(
        `UPDATE production.job_card_materials SET allotted_quantity = allotted_quantity - $1, remaining_quantity = remaining_quantity - $1
         WHERE job_card_number = $2 AND item_code = $3`,
        [take, donor.jobCardNumber, itemCode]
      );
      await client.query(
        `UPDATE production.job_card_materials SET allotted_quantity = allotted_quantity + $1, remaining_quantity = remaining_quantity + $1
         WHERE job_card_number = $2 AND item_code = $3`,
        [take, jobCardNumber, itemCode]
      );
      if (prnId) {
        await client.query(
          `UPDATE purchase.prn_line_items SET raw_pool_remaining = raw_pool_remaining + $1 WHERE prn_id = $2 AND item_code = $3`,
          [take, prnId, itemCode]
        );
      }
      remaining -= take;
      covered += take;
    }
  }

  // ── (b) Cross-BOQ — only once same-BOQ donors are exhausted (their
  // combined capacity couldn't cover the full shortfall), regardless of
  // which Set the requester itself is on. This one IS a physical
  // transfer — a different BOQ means a different PRN's actual reserved
  // stock. ──
  if (remaining > 1e-9) {
    {
      const { rows: candidates } = await client.query(
        `SELECT jc.job_card_number AS "jobCardNumber", jc.boq_id AS "boqId", jc.set_number AS "setNumber",
                m.remaining_quantity AS "remainingQty", p.prn_id AS "prnId"
         FROM production.job_cards jc
         JOIN production.job_card_materials m ON m.job_card_number = jc.job_card_number AND m.item_code = $1
         JOIN purchase.purchase_request_notes p ON p.boq_id = jc.boq_id
         WHERE jc.boq_id <> $2 AND m.remaining_quantity > 0
         ORDER BY jc.boq_id, jc.set_number ASC`,
        [itemCode, boqId]
      );
      // Rank by estimated real days-until-needed per BOQ, using that
      // BOQ's own completed-Set history where available.
      const byBoq = {};
      candidates.forEach(c => { (byBoq[c.boqId] = byBoq[c.boqId] || []).push(c); });
      const ranked = [];
      for (const [candidateBoqId, jcs] of Object.entries(byBoq)) {
        const { rows: fgDates } = await client.query(
          `SELECT jc.set_number AS "setNumber", MIN(fg.fg_date) AS "fgDate"
           FROM production.job_cards jc
           JOIN production.finished_goods_inventory fg ON fg.job_card_number = jc.job_card_number
           WHERE jc.boq_id = $1 GROUP BY jc.set_number ORDER BY jc.set_number ASC`,
          [candidateBoqId]
        );
        let avgDaysPerSet = null;
        if (fgDates.length >= 2) {
          const first = new Date(fgDates[0].fgDate), last = new Date(fgDates[fgDates.length - 1].fgDate);
          const spanDays = (last - first) / 86400000;
          avgDaysPerSet = spanDays / (fgDates.length - 1);
        }
        const currentSet = fgDates.length > 0 ? Number(fgDates[fgDates.length - 1].setNumber) + 1 : 1;
        jcs.forEach(jc => {
          const setsAway = Number(jc.setNumber) - currentSet + 1;
          const estimatedDays = avgDaysPerSet !== null ? setsAway * avgDaysPerSet : setsAway * 1000; // no history -> treat as far away, sets-remaining tiebreak only
          ranked.push({ ...jc, estimatedDays, setsAway });
        });
      }
      ranked.sort((a, b) => b.estimatedDays - a.estimatedDays || b.setsAway - a.setsAway);

      for (const donor of ranked) {
        if (remaining <= 1e-9) break;
        const donorAvail = Number(donor.remainingQty) || 0;
        if (donorAvail <= 1e-9) continue;
        const take = Math.min(remaining, donorAvail);
        await releaseStoreClaimFromPRN(client, donor.prnId, itemCode, take, 0, take);
        await claimRawOnlyForPRN(client, prnId, itemCode, materialName, take, actionedBy);
        await client.query(
          `UPDATE production.job_card_materials SET allotted_quantity = allotted_quantity - $1, remaining_quantity = remaining_quantity - $1
           WHERE job_card_number = $2 AND item_code = $3`,
          [take, donor.jobCardNumber, itemCode]
        );
        await client.query(
          `UPDATE production.job_card_materials SET allotted_quantity = allotted_quantity + $1, remaining_quantity = remaining_quantity + $1
           WHERE job_card_number = $2 AND item_code = $3`,
          [take, jobCardNumber, itemCode]
        );
        remaining -= take;
        covered += take;
      }
    }
  }

  return { covered, stillShort: remaining };
}

async function releaseStoreClaimFromPRN(client, prnId, itemCode, releaseQty, fromSpare, fromRaw) {
  if (releaseQty <= 1e-9) return;
  await applyStoreReservationSplit(client, itemCode, -fromSpare, -fromRaw);
  await client.query(
    `UPDATE purchase.prn_line_items
     SET current_unassigned_store_quantity = GREATEST(0, current_unassigned_store_quantity - $1),
         purchase_quantity = purchase_quantity + $1,
         still_to_order_quantity = still_to_order_quantity + $1,
         store_qty_from_spare = GREATEST(0, store_qty_from_spare - $2),
         store_qty_from_raw = GREATEST(0, store_qty_from_raw - $3),
         spare_pool_remaining = GREATEST(0, spare_pool_remaining - $2),
         raw_pool_remaining = GREATEST(0, raw_pool_remaining - $3)
     WHERE prn_id = $4 AND item_code = $5`,
    [releaseQty, fromSpare, fromRaw, prnId, itemCode]
  );
  await regeneratePRNDocument(prnId, client);
  await refreshPRNCompletion(client, prnId);
}

// Distributes newly-added stock (QA pass, Stock Sweep) across open PRN
// lines needing that item code, oldest PRN first, up to what each still
// needs, via claimStoreForPRN. Leftover beyond open demand is left free.
async function autoAssignStock(client, itemCode, materialName, qty, assignedBy) {
  let remaining = Number(qty) || 0;
  if (remaining <= 1e-9) return { assignmentIds: [], assigned: [], assignedTotal: 0, unassigned: 0 };

  const { rows: openLines } = await client.query(
    `SELECT li.prn_id, li.still_to_order_quantity FROM purchase.prn_line_items li
     JOIN purchase.purchase_request_notes p ON p.prn_id = li.prn_id
     WHERE li.item_code = $1 AND li.still_to_order_quantity > 0 AND p.status = 'PRN Generated'
     ORDER BY p.created_date ASC
     FOR UPDATE OF li`,
    [itemCode]
  );

  const assignmentIds = [];
  const assigned = [];
  let assignedTotal = 0;
  for (const line of openLines) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, Number(line.still_to_order_quantity) || 0);
    if (take <= 1e-9) continue;
    const id = await claimStoreForPRN(client, line.prn_id, itemCode, materialName, take, assignedBy);
    if (id) assignmentIds.push(id);
    assigned.push({ prnId: line.prn_id, quantity: take, assignmentId: id });
    assignedTotal += take;
    remaining -= take;
  }

  // `assigned` lets callers record per-PRN attribution; `remaining` is
  // what stayed genuinely free after all open demand was satisfied.
  return { assignmentIds, assigned, assignedTotal, unassigned: Math.max(0, remaining) };
}

// After a PO revision reduces on_order, any unwind that was deferred
// because the PO covered more than the PRN needed can finally complete.
// Rather than storing what was deferred, this recomputes from the BOQ's
// current state — so a BOQ revised again while the unwind sat deferred
// resolves to the LATEST requirement, not a stale snapshot.
async function completeDeferredUnwinds(client, prnId) {
  const { rows: [prn] } = await client.query(
    `SELECT prn_id, boq_id, created_by FROM purchase.purchase_request_notes WHERE prn_id = $1`,
    [prnId]
  );
  if (!prn) return [];

  const { rows: flagged } = await client.query(
    `SELECT item_code FROM purchase.prn_line_items
     WHERE prn_id = $1 AND awaiting_po_revision = TRUE`,
    [prnId]
  );
  if (flagged.length === 0) return [];
  const flaggedSet = new Set(flagged.map(f => f.item_code));

  const computed = await computePRNDeltaRows(client, prn.boq_id);
  // Still deferred = the PO revision didn't cut deep enough; leave flagged.
  const ready = computed.rows.filter(r => flaggedSet.has(r.itemCode) && !r.deferred);

  for (const row of ready) {
    if ((Number(row.storeDelta) || 0) < 0) {
      const spareQty = Number(row.storeFromSpareDelta) || 0;
      const rawQty = Number(row.storeFromRawDelta) || 0;
      await applyStoreReservationSplit(client, row.itemCode, spareQty, rawQty);
    }
  }
  // applyPRNRows writes awaiting_po_revision = !!row.deferred, so these
  // rows clear their own flag as a side effect of settling.
  if (ready.length > 0) {
    await applyPRNRows(client, prnId, ready, prn.created_by);
  }

  // Direct fallback for rows computePRNDeltaRows no longer reports at
  // all — this happens once the PRN-side change (purchase_quantity) was
  // already applied immediately at PRN-authorize time, leaving nothing
  // but the PO side still catching up. Once on_order_quantity has
  // caught down to purchase_quantity, the flag is stale and needs
  // clearing directly rather than waiting on a delta that no longer exists.
  const readyCodes = new Set(ready.map(r => r.itemCode));
  const stillFlagged = [...flaggedSet].filter(code => !readyCodes.has(code));
  const unwoundDirect = [];
  if (stillFlagged.length > 0) {
    const { rows: stuck } = await client.query(
      `SELECT item_code, purchase_quantity, assigned_quantity, on_order_quantity
       FROM purchase.prn_line_items
       WHERE prn_id = $1 AND item_code = ANY($2::text[])
         AND awaiting_po_revision = TRUE AND on_order_quantity <= purchase_quantity + 0.01`,
      [prnId, stillFlagged]
    );
    for (const row of stuck) {
      const stillToOrder = Math.max(0, (Number(row.purchase_quantity)||0) - (Number(row.assigned_quantity)||0) - (Number(row.on_order_quantity)||0));
      await client.query(
        `UPDATE purchase.prn_line_items SET awaiting_po_revision = FALSE, still_to_order_quantity = $1
         WHERE prn_id = $2 AND item_code = $3`,
        [stillToOrder, prnId, row.item_code]
      );
      unwoundDirect.push(row.item_code);
    }
  }

  const allUnwound = ready.map(r => r.itemCode).concat(unwoundDirect);
  if (allUnwound.length === 0) return [];
  await refreshPRNCompletion(client, prnId);
  return allUnwound;
}

// Records where a receipt's units landed. One row per attribution, never
// aggregated — QA Revision reverses by reading these back exactly.
async function recordReceiptAttributions(client, ctx, entries) {
  for (const e of entries) {
    if (!e.quantity || e.quantity <= 1e-9) continue;
    await client.query(
      `INSERT INTO store.receipt_attributions
         (event_type, ledger_id, rejection_id, sweep_id, grn_number, item_code, po_no, prn_id, kind, quantity, assignment_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [ctx.eventType, ctx.ledgerId || null, ctx.rejectionId || null, ctx.sweepId || null,
       ctx.grnNumber || null, ctx.itemCode, ctx.poNo || null, e.prnId || null, e.kind,
       e.quantity, e.assignmentId || null, ctx.createdBy || null]
    );
  }
}

// Checks whether a receipt event can still be cleanly reversed. Returns
// [] if safe, or a list of human-readable blockers. Anything already
// consumed or moved on downstream can't be un-done arithmetically —
// better to refuse than to silently produce wrong numbers.
async function checkReceiptReversible(client, attributions) {
  const blockers = [];
  for (const a of attributions) {
    if (a.kind === 'auto_assign' && a.assignment_id) {
      const { rows: [assign] } = await client.query(
        `SELECT assigned_quantity, utilized_quantity, prn_id FROM store.stock_reservations WHERE assignment_id = $1`,
        [a.assignment_id]
      );
      if (!assign) {
        blockers.push(`${a.item_code}: stock assigned to ${a.prn_id} was since reassigned or removed.`);
      } else if (Number(assign.utilized_quantity || 0) > 0) {
        blockers.push(`${a.item_code}: ${assign.utilized_quantity} already consumed against ${a.prn_id}.`);
      } else if (Number(assign.assigned_quantity) + 1e-9 < Number(a.quantity)) {
        blockers.push(`${a.item_code}: only ${assign.assigned_quantity} of the original ${a.quantity} is still assigned to ${a.prn_id}.`);
      }
    }
    if (a.kind === 'po_credit' && a.prn_id) {
      const { rows: [li] } = await client.query(
        `SELECT received_quantity FROM purchase.prn_line_items WHERE prn_id = $1 AND item_code = $2`,
        [a.prn_id, a.item_code]
      );
      if (!li || Number(li.received_quantity) + 1e-9 < Number(a.quantity)) {
        blockers.push(`${a.item_code}: ${a.prn_id} no longer shows the ${a.quantity} originally received.`);
      }
    }
  }
  return blockers;
}

// Precisely undoes what a receipt event did, using its recorded
// attributions — never a recomputation or a guess.
async function reverseReceiptAttributions(client, attributions) {
  for (const a of attributions) {
    const qty = Number(a.quantity);
    if (a.kind === 'po_credit') {
      await client.query(
        `UPDATE purchase.prn_line_items
         SET received_quantity = GREATEST(0, received_quantity - $1), on_order_quantity = on_order_quantity + $1
         WHERE prn_id = $2 AND item_code = $3`,
        [qty, a.prn_id, a.item_code]
      );
      await client.query(
        `UPDATE purchase.pps_tracking
         SET actual_received_quantity = GREATEST(0, actual_received_quantity - $1), link_status = 'Partially Delivered'
         WHERE prn_id = $2 AND item_code = $3 AND po_no = $4`,
        [qty, a.prn_id, a.item_code, a.po_no]
      );
      await refreshPRNCompletion(client, a.prn_id);
    } else if (a.kind === 'auto_assign' && a.assignment_id) {
      const { rows: [assign] } = await client.query(
        `SELECT * FROM store.stock_reservations WHERE assignment_id = $1 FOR UPDATE`, [a.assignment_id]
      );
      if (assign) {
        const frac = qty / (Number(assign.assigned_quantity) || 1);
        await releaseStoreClaimFromPRN(client, assign.prn_id, a.item_code, qty,
          (Number(assign.from_spare) || 0) * frac, (Number(assign.from_raw) || 0) * frac);
        if (Number(assign.assigned_quantity) - qty <= 1e-9) {
          await client.query(`DELETE FROM store.stock_reservations WHERE assignment_id = $1`, [a.assignment_id]);
        } else {
          await client.query(
            `UPDATE store.stock_reservations SET assigned_quantity = assigned_quantity - $1,
                    from_spare = from_spare - $2, from_raw = from_raw - $3 WHERE assignment_id = $4`,
            [qty, (Number(assign.from_spare) || 0) * frac, (Number(assign.from_raw) || 0) * frac, a.assignment_id]
          );
        }
      }
    }
    // 'free_stock' has no downstream effect — total_stock is handled by the caller.
    await client.query(
      `UPDATE store.receipt_attributions SET reversed = TRUE, reversed_at = now() WHERE attribution_id = $1`,
      [a.attribution_id]
    );
  }
}

module.exports = {
  computePRNDeltaRows, applyPRNRows, refreshPRNCompletion,
  regeneratePRNDocument, applySilentPRNDecrease, distributeReceiptFIFO, completeDeferredUnwinds,
  applyStoreReservationSplit, splitStoreClaim, splitStoreRelease, autoAssignStock,
  claimStoreForPRN, claimRawOnlyForPRN, releaseStoreClaimFromPRN, earmarkClaimForTicket, restoreEarmarkedClaim,
  findAndBorrowForShortfall,
  recordReceiptAttributions, checkReceiptReversible, reverseReceiptAttributions,
};