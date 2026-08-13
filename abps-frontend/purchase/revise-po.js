function navigateToPurchaseWorkspacePanel(targetModuleId, extraArg = null) {
  // Both Authorize PRN's and Revise PRN's live-stock polls only stop
  // when their own screen explicitly clears them (a card collapsing, a
  // row re-rendering) — neither of those fires when the user instead
  // switches straight to a DIFFERENT panel, so without this the interval
  // keeps polling in the background indefinitely for a screen that's no
  // longer visible.
  if (window._aprnStockInterval) { clearInterval(window._aprnStockInterval); window._aprnStockInterval = null; }
  if (window._rprnStockInterval) { clearInterval(window._rprnStockInterval); window._rprnStockInterval = null; }

  // The "A PRN has been revised — check Revise PO" banner is Purchase-
  // department work only, but purchase-prn/purchase-revise-prn/
  // purchase-authorize-prn (Create/Revise/Authorize PRN) are Store-
  // department screens that happen to share this same enclosure/banner
  // element — showing it there was misleading Store staff into thinking
  // a Purchase Order needed attention from them.
  if (["purchase-prn", "purchase-revise-prn", "purchase-authorize-prn"].includes(targetModuleId)) {
    const banner = document.getElementById("purchase-po-revision-reminder-banner");
    if (banner) banner.style.display = "none";
  } else {
    checkPurchasePORevisionReminder();
  }
  window.scrollTo(0, 0);
  setTimeout(() => window.scrollTo(0, 0), 50);
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.getElementById("module-store-workspace-enclosure-panel").style.display = "none";
  document.getElementById("module-design-workspace-enclosure-panel").style.display = "none";

  ["canvas-module-purchase-prn","canvas-module-purchase-material-list","canvas-module-purchase-upload-rm-po","canvas-module-purchase-rejected-material","canvas-module-purchase-create-po","canvas-module-purchase-authorize-prn","canvas-module-purchase-authorize-po","canvas-module-purchase-pps-tracking","canvas-module-purchase-revise-po","canvas-module-purchase-authorize-po-revision","canvas-module-purchase-revise-prn","canvas-module-purchase-search-po"].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = "none";
  });

  document.getElementById("module-purchase-workspace-enclosure-panel").style.display = "block";

  if (targetModuleId === "purchase-prn") {
    document.getElementById("canvas-module-purchase-prn").style.display = "block";
    initializePRNPanel().catch(e => { if (e?.message !== "SESSION_EXPIRED") console.error("PRN panel init error:", e); });
  } else if (targetModuleId === "purchase-material-list") {
    document.getElementById("canvas-module-purchase-material-list").style.display = "block";
    document.getElementById("material-list-sync-btn").style.display = "inline-flex";
    document.getElementById("purchase-top-bar-title").style.display = "inline";
    initializeMaterialListPanel();
  } else if (targetModuleId === "purchase-upload-rm-po") {
    document.getElementById("canvas-module-purchase-upload-rm-po").style.display = "block";
    initializeRMPOUploadPanel();
  } else if (targetModuleId === "purchase-create-po") {
    document.getElementById("canvas-module-purchase-create-po").style.display = "block";
    const cpoBanner = document.getElementById("create-po-feedback");
    if (cpoBanner) { cpoBanner.style.display = "none"; cpoBanner.innerHTML = ""; }
    initializeCreatePOPanel(extraArg);
  } else if (targetModuleId === "purchase-authorize-prn") {
    document.getElementById("canvas-module-purchase-authorize-prn").style.display = "block";
    initializeAuthorizePRNPanel().catch(e => { if (e?.message !== "SESSION_EXPIRED") console.error("Authorize PRN panel init error:", e); });
  } else if (targetModuleId === "purchase-authorize-po") {
    document.getElementById("canvas-module-purchase-authorize-po").style.display = "block";
    const apoBanner = document.getElementById("authorize-po-feedback");
    if (apoBanner) { apoBanner.style.display = "none"; apoBanner.innerHTML = ""; }
    initializeAuthorizePOPanel();
  } else if (targetModuleId === "purchase-revise-prn") {
    document.getElementById("canvas-module-purchase-revise-prn").style.display = "block";
    initializeRevisePRNPanel();
  } else if (targetModuleId === "purchase-authorize-po-revision") {
    document.getElementById("canvas-module-purchase-authorize-po-revision").style.display = "block";
    const aporBanner = document.getElementById("apor-feedback");
    if (aporBanner) { aporBanner.style.display = "none"; aporBanner.innerHTML = ""; }
    initializeAuthorizePORevisionPanel();
  } else if (targetModuleId === "purchase-revise-po") {
    document.getElementById("canvas-module-purchase-revise-po").style.display = "block";
    // switchRevisePOTab('queue') resets everything a plain
    // initializeRevisePOPanel() call didn't: which tab is visually
    // active, the "Other PO Revisions" search box + its results, and
    // rpo-detail-zone/rpoActive — without this, leaving on the "Other"
    // tab mid-search and coming back re-entered into that exact stale
    // state instead of a fresh screen.
    const otherSearchInput = document.getElementById("rpo-other-search-input");
    if (otherSearchInput) otherSearchInput.value = "";
    const otherResults = document.getElementById("rpo-other-results");
    if (otherResults) otherResults.innerHTML = "";
    const rpoFb = document.getElementById("rpo-feedback");
    if (rpoFb) { rpoFb.style.display = "none"; rpoFb.innerHTML = ""; }
    switchRevisePOTab('queue');
  } else if (targetModuleId === "purchase-pps-tracking") {
    document.getElementById("canvas-module-purchase-pps-tracking").style.display = "block";
    const ppsBanner = document.getElementById("pps-feedback");
    if (ppsBanner) { ppsBanner.style.display = "none"; ppsBanner.innerHTML = ""; }
    document.getElementById("pps-results-body").innerHTML = "";
    initializePPSTrackingPanel();
  } else if (targetModuleId === "purchase-rejected-material") {
    document.getElementById("canvas-module-purchase-rejected-material").style.display = "block";
    const rejBanner = document.getElementById("rejected-material-feedback-banner");
    if (rejBanner) { rejBanner.style.display = "none"; rejBanner.innerHTML = ""; }
    window.rejMaterialVendorFilter = "";
    window.rejMaterialActionFilter = [];
    initializeRejectedMaterialPanel('pending');
  } else if (targetModuleId === "purchase-search-po") {
    document.getElementById("canvas-module-purchase-search-po").style.display = "block";
    initializeSearchRMPOPanel();
  }
}

// ── Revise PO ────────────────────────────────────────────────────────────
window.rpoActive = null;   // { po, lineItems, kind }

function switchRevisePOTab(tab) {
  const isQueue = tab === "queue";
  document.getElementById("rpo-queue-section").style.display = isQueue ? "block" : "none";
  document.getElementById("rpo-other-section").style.display = isQueue ? "none" : "block";
  document.getElementById("rpo-detail-zone").innerHTML = "";
  window.rpoActive = null;
  const on = (b) => { b.style.color = "var(--brand)"; b.style.borderBottomColor = "var(--brand)"; b.style.fontWeight = "800"; };
  const off = (b) => { b.style.color = "var(--muted)"; b.style.borderBottomColor = "transparent"; b.style.fontWeight = "700"; };
  const q = document.getElementById("rpo-tab-queue"), o = document.getElementById("rpo-tab-other");
  isQueue ? (on(q), off(o)) : (on(o), off(q));
  if (isQueue) initializeRevisePOPanel();
}

async function initializeRevisePOPanel() {
  const feed = document.getElementById("rpo-queue-feed");
  const tabsZone = document.getElementById("rpo-tabs-and-lists");
  if (tabsZone) tabsZone.style.display = "";
  const fb = document.getElementById("rpo-feedback");
  if (fb) fb.style.display = "none";
  document.getElementById("rpo-detail-zone").innerHTML = "";
  feed.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted);">Loading…</div>`;
  try {
    const data = await apFetch({ action: "fetchPOsNeedingRevision" });
    const queue = (data.success ? (data.queue || []) : []);
    if (queue.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:26px; color:var(--muted); background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px;">✅ No PO needs a Revision based on a PRN revision.</div>`;
      return;
    }
    feed.innerHTML = queue.map(po => {
      return `
        <div style="background:#fff; border:1px solid var(--border); border-left:3px solid #f59e0b; border-radius:var(--radius); padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap;">
            <div style="flex:1; min-width:240px;">
              <div style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.9rem;">${po.poNo}${po.revisionNumber > 1 ? ` <span style="font-size:0.7rem; color:var(--muted);">(V${po.revisionNumber})</span>` : ""}</div>
              <div style="font-size:0.8rem; font-weight:600; margin-top:2px;">${po.vendorName || ""}</div>
              <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Ordered ${po.orderDate ? formatDateDMY(po.orderDate) : "—"} · Delivery ${po.deliveryDate ? formatDateDMY(po.deliveryDate) : "—"}</div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink:0;">
              <button onclick="dismissPORevision('${po.poNo}')" style="padding:7px 14px; border:1px solid var(--border); background:#fff; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.8rem;">No Revision Needed</button>
              <button class="nav-btn-styled" onclick="openPORevision('${po.poNo}', true)" style="background:var(--brand); color:#fff; font-weight:700; padding:7px 18px; font-size:0.8rem;">Revise →</button>
            </div>
          </div>
        </div>`;
    }).join("");
  } catch (e) {
    feed.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`;
  }
}

async function searchPOsForRevisionUI() {
  const query = document.getElementById("rpo-search-input").value.trim();
  const feed = document.getElementById("rpo-search-feed");
  document.getElementById("rpo-detail-zone").innerHTML = "";
  if (query.length < 2) { feed.innerHTML = `<div style="color:#b91c1c; font-size:0.8rem;">Enter at least 2 characters.</div>`; return; }
  feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Searching…</div>`;
  try {
    const data = await apFetch({ action: "searchPOsForRevision", query });
    const results = (data.success ? (data.results || []) : []);
    if (results.length === 0) { feed.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">No authorized PO matched.</div>`; return; }
    feed.innerHTML = results.map(po => `
      <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:12px; display:flex; justify-content:space-between; align-items:center; gap:14px; flex-wrap:wrap;">
        <div>
          <div style="font-family:monospace; font-weight:800; color:var(--brand);">${po.poNo}${po.revisionNumber > 1 ? ` <span style="font-size:0.7rem; color:var(--muted);">(V${po.revisionNumber})</span>` : ""}</div>
          <div style="font-size:0.8rem; font-weight:600;">${po.vendorName || ""}</div>
          <div style="font-size:0.72rem; color:var(--muted);">Delivery ${po.deliveryDate ? formatDateDMY(po.deliveryDate) : "—"}</div>
        </div>
        ${po.revisionPending
          ? `<span style="font-size:0.72rem; font-weight:700; color:#b45309; background:#fef3c7; padding:4px 10px; border-radius:4px;">Revision already pending</span>`
          : `<button class="nav-btn-styled" onclick="openPORevision('${po.poNo}', false)" style="background:var(--brand); color:#fff; font-weight:700; padding:7px 18px; font-size:0.8rem;">Revise →</button>`}
      </div>`).join("");
  } catch (e) {
    feed.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`;
  }
}

async function openPORevision(poNo, changedOnly) {
  const zone = document.getElementById("rpo-detail-zone");
  zone.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted);">Loading PO…</div>`;
  try {
    const data = await apFetch({ action: "fetchPOForRevision", poNo, changedOnly });
    if (!data.success) { zone.innerHTML = `<div style="color:#b91c1c; padding:14px; background:#fef2f2; border-radius:6px;">${data.error}</div>`; return; }
    const lineItems = (data.lineItems || []).map(li => ({
      ...li,
      quantity: li.orderedQty, // Vendor Discussed Qty starts at the PO's existing ordered qty, editable from there
      // Rate/Disc already carry the PO's real committed values (unlike a
      // brand-new Create PO row), so — unlike Create PO — nothing here is
      // locked pending an allocation decision.
      _workingAllocations: (li.allocations || []).map(a => ({ prnId: a.prnId, quantity: Number(a.allocatedQty) || 0 })),
      _allocationTouched: (li.allocations || []).length > 0,
    }));
    window.rpoActive = { po: data.po, lineItems, kind: changedOnly ? "PRN Driven" : "Standalone" };
    renderPORevisionCard();
  } catch (e) {
    zone.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`;
  }
}

function renderPORevisionCard() {
  const st = window.rpoActive;
  if (!st) return;
  const { po, lineItems, kind } = st;
  const fmt = (n) => (Number(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});

  const rowsHtml = lineItems.map((li, idx) => {
    if (kind === "PRN Driven" && !li.changed) return ""; // unchanged — not shown, but still counted in the totals below

    // Chips below the row — same "Allocate to PRNs" button + chip-list
    // pattern as Create PO, sourced from li._workingAllocations (edited
    // via the modal, see openRPOAllocationModal) instead of a fresh fetch,
    // since the PRN list + each one's "need" is already loaded upfront here.
    const workingAllocs = li._workingAllocations || [];
    const vdqNow = parseFloat(li.quantity) || 0;
    const allocSum = workingAllocs.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    const unallocNow = Math.round((vdqNow - allocSum) * 100) / 100;
    const chipsHtml = (workingAllocs.length || li._allocationTouched)
      ? workingAllocs.map(a => `<div style="display:inline-block; background:#e0f2fe; color:var(--brand); font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 4px 3px 0;" title="${a.prnId}">${a.prnId.replace(/^PRN_/,"")}: <strong>${a.quantity}</strong></div>`).join("")
        + (unallocNow > 0 ? `<div style="display:inline-block; background:#fef3c7; color:#78350f; font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 0 3px 0;">Extra: <strong>${unallocNow}</strong></div>` : "")
      : '<span style="color:#b91c1c; font-size:0.75rem; font-weight:600;">No PRNs allocated</span>';

    // Design Rate/Qty, Costing Diff, over-rate flag — same formulas as
    // Create PO's row (see po.js renderCPOMaterialRows), just sourced from
    // this line's own state instead of a freshly-typed row. Warn-only,
    // same as Create PO — Revise PO doesn't block submission on this,
    // only Authorize (PO / PO Revision) does.
    const discNow = parseFloat(li.discountPercent) || 0;
    const rateNow = parseFloat(li.rate) || 0;
    const hasRateValue = li.rate !== '' && li.rate !== null && li.rate !== undefined && !isNaN(parseFloat(li.rate));
    const effectiveRate = rateNow * (100 - discNow) / 100;
    const designRate = li.designRatePerQuantity;
    const hasDesignRate = designRate != null;
    const isOverRate = hasRateValue && hasDesignRate && effectiveRate > Number(designRate) + 1e-9;
    const costingDiff = (hasRateValue && hasDesignRate) ? (effectiveRate - Number(designRate)) * vdqNow : null;
    const overRateWarning = isOverRate
      ? `<div style="margin-top:10px; padding:7px 10px; background:#fffbeb; border:1px solid #fde68a; border-radius:4px; font-size:0.75rem; font-weight:700; color:#78350f;">
          ⚠️ Rate / Qty after Disc % (${fmt(effectiveRate)}) is higher than Design Rate / Qty (${fmt(designRate)}).
        </div>`
      : "";

    const rpoRowBg = li.changed
      ? (Number(li.newRequiredQty) > Number(li.orderedQty) ? "#f0fdf4" : "#fffbeb")
      : "#fff";
    return `
    <div data-lineidx="${idx}" style="background:${isOverRate ? "#fef2f2" : rpoRowBg}; border:1px solid ${isOverRate ? "#fca5a5" : "var(--border)"}; border-radius:var(--radius); padding:12px; margin-bottom:10px;">
      <div style="display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap;">
        <div style="font-weight:700; color:var(--brand); padding-bottom:8px; min-width:20px;">${idx + 1}</div>

        <div style="flex:1; min-width:140px;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Description of Material</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; font-size:0.82rem; font-weight:600; padding:0 4px;">${li.description || ""}</div>
        </div>
        <div style="width:70px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Old PO Qty</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; font-weight:700; color:#1a2332; font-size:0.85rem;">${fmt(li.orderedQty)}</div>
        </div>
        <div style="width:75px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">New Required Qty</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; font-weight:800; font-size:0.85rem; color:${Number(li.newRequiredQty) > Number(li.orderedQty) ? "#15803d" : "#b91c1c"};">${fmt(li.newRequiredQty)}</div>
        </div>
        <div style="width:70px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Already Received</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-size:0.78rem; font-weight:700; color:${Number(li.receivedQty) > 0 ? "#b45309" : "var(--muted)"};">${fmt(li.receivedQty)}</div>
        </div>
        <div style="width:50px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Unit</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; color:#475569; font-size:0.85rem;">${li.unit || '—'}</div>
        </div>
        <div style="width:90px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Vendor Discussed Qty *</div>
          <input type="number" min="${Number(li.receivedQty)||0}" step="any" class="rpo-vdq" data-idx="${idx}" value="${li.quantity}"
            oninput="updateRPORowField(${idx},'quantity',this.value)"
            style="width:100%; height:36px; box-sizing:border-box; text-align:center; font-weight:800; padding:6px; border:1.5px solid #15803d; border-radius:4px; font-size:0.85rem;">
        </div>
        <div style="width:90px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Design Rate / Qty</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; font-weight:700; color:#475569; font-size:0.85rem;">${hasDesignRate ? fmt(designRate) : '—'}</div>
        </div>
        <div style="width:90px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Rate / Qty *</div>
          <input type="number" min="0" step="any" class="rpo-rate" data-idx="${idx}" value="${li.rate}"
            oninput="updateRPORowField(${idx},'rate',this.value)"
            style="width:100%; height:36px; box-sizing:border-box; text-align:center; font-weight:700; padding:6px; border:1.5px solid ${isOverRate ? '#dc2626' : 'var(--border)'}; border-radius:4px; font-size:0.82rem; ${isOverRate ? 'background:#fef2f2;' : ''}">
        </div>
        <div style="width:65px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Disc %</div>
          <input type="number" min="0" max="100" step="any" class="rpo-disc" data-idx="${idx}" value="${li.discountPercent}"
            oninput="updateRPORowField(${idx},'discountPercent',this.value)"
            style="width:100%; height:36px; box-sizing:border-box; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem;">
        </div>
        <div style="width:100px; flex-shrink:0; text-align:right;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Costing Diff</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:flex-end; font-family:monospace; font-weight:700; font-size:0.85rem; color:${costingDiff > 0 ? '#dc2626' : (costingDiff < 0 ? '#15803d' : '#475569')};"><span class="rpo-costing-diff" data-idx="${idx}">${costingDiff != null ? costingDiff.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</span></div>
        </div>
        <div style="width:110px; flex-shrink:0; text-align:right;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Amount</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:flex-end; font-family:monospace; font-weight:800; font-size:1.05rem; color:#0f172a;"><span id="rpo-amount-${idx}">0.00</span></div>
        </div>
      </div>

      <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div style="min-width:180px;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">PRNs using this Material *</div>
          <button onclick="openRPOAllocationModal(${idx})" style="font-size:0.75rem; padding:5px 12px; background:var(--accent); color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">Allocate to PRNs</button>
        </div>
        <div style="flex:1; min-width:200px; padding-top:2px;">${chipsHtml}</div>
      </div>
      ${overRateWarning}
    </div>`;
  }).filter(Boolean).join("");

  // PRN Change Summary — what changed in the PRN(s) that's PROMPTING this
  // PO revision, as opposed to Authorize PO Revision's own "Change
  // Summary" (what the purchaser is about to change ON the PO). Gated on
  // li.changed — the same item-level "does this PO's allocation record
  // still match what the PRN actually needs" signal the backend uses to
  // decide which rows even appear in the table below, so the two stay
  // consistent (a material that's genuinely untouched never shows up in
  // either place, even if some OTHER item on the same PRN did change).
  let prnSummaryHtml = "";
  if (kind === "PRN Driven") {
    const bullets = lineItems.filter(li => li.changed).map(li => {
      const delta = (Number(li.newRequiredQty)||0) - (Number(li.orderedQty)||0);
      const dirColor = delta > 0 ? "#15803d" : "#b91c1c";
      return `<li> <strong> ${li.description || li.itemCode}: </strong> ${fmt(li.orderedQty)} → <span style="font-weight:700; color:${dirColor};">${fmt(li.newRequiredQty)}</span> (${delta > 0 ? "+" : ""}${fmt(delta)})</li>`;
    });
    if (bullets.length) {
      prnSummaryHtml = `
      <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:10px 14px; margin-bottom:12px;">
        <div style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:#78350f; margin-bottom:6px;">PRN Change Summary</div>
        <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#334155; line-height:1.7;">${bullets.join("")}</ul>
      </div>`;
    }
  }

  document.getElementById("rpo-detail-zone").innerHTML = `
    <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:14px; padding-bottom:12px; border-bottom:1px dashed var(--border);">
        <div>
          <div style="font-family:monospace; font-weight:800; color:var(--brand); font-size:1rem;">${po.poNo}</div>
          <div style="font-size:0.85rem; font-weight:700;">${po.vendorName || ""}</div>
          <div style="font-size:0.74rem; color:var(--muted);">Ordered ${po.orderDate ? formatDateDMY(po.orderDate) : "—"} · Currently V${po.revisionNumber || 1}</div>
        </div>
        <span style="font-size:0.7rem; font-weight:800; padding:4px 10px; border-radius:4px; background:${kind === "PRN Driven" ? "#fef3c7" : "#e0f2fe"}; color:${kind === "PRN Driven" ? "#78350f" : "#075985"};">${kind === "PRN Driven" ? "PRN-DRIVEN REVISION" : "STANDALONE REVISION"}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div>
          <label class="field-label" style="margin-top:0;">Supplier Offer No</label>
          <input type="text" id="rpo-supplier-ref" value="${(po.supplierRef||"").replace(/"/g,"&quot;")}" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Delivery Date *</label>
          <input type="date" lang="en-GB" id="rpo-delivery-date" value="${po.deliveryDate ? new Date(po.deliveryDate).toISOString().slice(0,10) : ""}" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        </div>
      </div>

      ${prnSummaryHtml}

      <div style="background:#f8fafc; border-left:3px solid var(--brand); padding:9px 12px; border-radius:4px; font-size:0.75rem; color:#334155; margin-bottom:12px;">
        <strong>Vendor Discussed Purchase Quantity</strong> is what you actually agreed with the vendor, and is required on every row. It cannot go below what has already been received. Anything you don't allocate to a PRN is ordered as extra stock and lands in the Raw Material store.
      </div>

      ${kind === "PRN Driven" ? `<div style="font-size:0.72rem; color:var(--muted); margin-bottom:8px;">Showing only materials whose required quantity changed and not every material in this PO.</div>` : ""}
      <div id="rpo-lines-wrap">${rowsHtml}</div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Taxes & Charges</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
            <div><label class="field-label" style="margin-top:0;">CGST %</label><input type="number" id="rpo-cgst" value="${Number(po.cgstPercent)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">SGST %</label><input type="number" id="rpo-sgst" value="${Number(po.sgstPercent)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">IGST %</label><input type="number" id="rpo-igst" value="${Number(po.igstPercent)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Packing</label><input type="number" id="rpo-packing" value="${Number(po.packing)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Freight</label><input type="number" id="rpo-freight" value="${Number(po.freight)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Other</label><input type="number" id="rpo-other" value="${Number(po.other)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Round Off</label><input type="number" id="rpo-roundoff" value="${Number(po.roundOff)||0}" step="any" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          </div>
        </div>
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Terms</div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Warranty</label><input type="text" id="rpo-warranty" value="${(po.warranty||"").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Payment Terms</label><input type="text" id="rpo-payment" value="${(po.paymentTerms||"").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Freight Terms</label><input type="text" id="rpo-freight-terms" value="${(po.freightTerms||"").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; background:#f0f9ff; border:1px solid #bae6fd; border-radius:var(--radius); padding:14px; margin-top:14px;">
        <div style="font-size:0.85rem;">
          <div>Sub Total: <strong id="rpo-subtotal-disp">0.00</strong></div>
          <div style="font-size:1.05rem; margin-top:4px;">Grand Total: <strong id="rpo-grandtotal-disp" style="color:var(--brand);">0.00</strong></div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:14px; flex-wrap:wrap;">
        <button onclick="cancelPOEntirely('${po.poNo}')" class="nav-btn-styled" style="background:#dc2626;">Cancel this PO entirely</button>
        <div style="display:flex; gap:10px;">
          <button onclick="document.getElementById('rpo-detail-zone').innerHTML=''; window.rpoActive=null;" style="padding:8px 16px; border:1px solid var(--border); background:#fff; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.8rem;">Close</button>
          <button class="nav-btn-styled" id="rpo-submit-btn" onclick="submitPORevisionUI()" style="background:var(--brand); color:#fff; font-weight:700; padding:10px 24px;">Submit Revision for Authorization</button>
        </div>
      </div>
    </div>`;

  lineItems.forEach((_, idx) => updateRPORowAmount(idx));
  updateRPOGrandTotal();
}

// updateRPORowField — same role as Create PO's updateCPORowField: keeps
// the line's own state (li.quantity/rate/discountPercent) in sync on
// every keystroke, so a later full re-render (e.g. after saving the
// Allocate to PRNs modal on a DIFFERENT row) never loses an in-progress
// edit on this one — nothing here is ever read back out of the DOM.
function updateRPORowField(idx, field, value) {
  const li = window.rpoActive?.lineItems[idx];
  if (!li) return;
  li[field] = value;
  updateRPORowAmount(idx);
  updateRPOGrandTotal();
}

function updateRPORowAmount(idx) {
  const li = window.rpoActive?.lineItems[idx];
  if (!li) return;
  const vdq = parseFloat(li.quantity) || 0;
  const rate = parseFloat(li.rate) || 0;
  const disc = parseFloat(li.discountPercent) || 0;
  const amountEl = document.getElementById(`rpo-amount-${idx}`);
  if (amountEl) amountEl.textContent = (vdq * rate * (100 - disc) / 100).toLocaleString("en-IN",{maximumFractionDigits:2});

  // Costing Diff / over-rate border — same effective-rate (after Disc %)
  // logic as the render-time version, updated live without a full
  // re-render mid-keystroke.
  const hasRateValue = li.rate !== '' && li.rate !== null && li.rate !== undefined && !isNaN(parseFloat(li.rate));
  const effectiveRate = rate * (100 - disc) / 100;
  const designRate = li.designRatePerQuantity;
  const hasDesignRate = designRate != null;
  const isOverRate = hasRateValue && hasDesignRate && effectiveRate > Number(designRate) + 1e-9;
  const costingDiff = (hasRateValue && hasDesignRate) ? (effectiveRate - Number(designRate)) * vdq : null;
  const diffSpan = document.querySelector(`.rpo-costing-diff[data-idx="${idx}"]`);
  if (diffSpan) {
    diffSpan.textContent = costingDiff != null ? costingDiff.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : "—";
    diffSpan.style.color = costingDiff > 0 ? "#dc2626" : (costingDiff < 0 ? "#15803d" : "#475569");
  }
  const rateInput = document.querySelector(`.rpo-rate[data-idx="${idx}"]`);
  if (rateInput) {
    rateInput.style.borderColor = isOverRate ? "#dc2626" : "var(--border)";
    rateInput.style.background = isOverRate ? "#fef2f2" : "";
  }
  // Row background / warning strip are static-render-only (same tradeoff
  // Create PO makes) — a full re-render is needed to move/show them,
  // which happens naturally the next time this card re-renders.
}

function updateRPOGrandTotal() {
  let subTotal = 0;
  (window.rpoActive?.lineItems || []).forEach((li, idx) => {
    const rendered = document.getElementById(`rpo-amount-${idx}`);
    if (rendered) {
      const vdq = parseFloat(li.quantity) || 0;
      const rate = parseFloat(li.rate) || 0;
      const disc = parseFloat(li.discountPercent) || 0;
      subTotal += vdq * rate * (100 - disc) / 100;
    } else {
      // Unchanged line, not rendered in PRN-driven mode — still part of
      // the PO, so its stored amount still counts toward the total.
      subTotal += Number(li.amount) || ((Number(li.orderedQty)||0) * (Number(li.rate)||0) * (100 - (Number(li.discountPercent)||0)) / 100);
    }
  });
  const cgstP = parseFloat(document.getElementById("rpo-cgst")?.value) || 0;
  const sgstP = parseFloat(document.getElementById("rpo-sgst")?.value) || 0;
  const igstP = parseFloat(document.getElementById("rpo-igst")?.value) || 0;
  const packing = parseFloat(document.getElementById("rpo-packing")?.value) || 0;
  const freight = parseFloat(document.getElementById("rpo-freight")?.value) || 0;
  const other = parseFloat(document.getElementById("rpo-other")?.value) || 0;
  const roundOff = parseFloat(document.getElementById("rpo-roundoff")?.value) || 0;
  const grandTotal = subTotal + subTotal*cgstP/100 + subTotal*sgstP/100 + subTotal*igstP/100 + packing + freight + other + roundOff;
  const fmt = (n) => n.toLocaleString("en-IN",{maximumFractionDigits:2});
  const stEl = document.getElementById("rpo-subtotal-disp");
  const gtEl = document.getElementById("rpo-grandtotal-disp");
  if (stEl) stEl.textContent = fmt(subTotal);
  if (gtEl) gtEl.textContent = fmt(grandTotal);
}

// ── Allocate to PRNs modal — same UX as Create PO's openCPOAllocationPicker
// / saveCPOAllocationPicker, sourced from this line's own li.allocations
// (already loaded with fetchPOForRevision) instead of a fresh fetch, since
// Revise PO already knows every open PRN for this item + PO combination.
function openRPOAllocationModal(idx) {
  const li = window.rpoActive?.lineItems[idx];
  if (!li) return;
  const vdq = parseFloat(li.quantity) || 0;
  const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const existing = document.getElementById("rpo-alloc-modal");
  if (existing) existing.remove();

  const prns = (li.allocations || []).map(a => ({
    prnId: a.prnId,
    need: Math.max(0, (Number(a.currentPurchaseQty) || 0) - (Number(a.coveredByOtherPOs) || 0)),
    stale: Number(a.prnVersion) > Number(a.stampedVersion || 0),
  }));
  const workingByPrn = Object.fromEntries((li._workingAllocations || []).map(a => [a.prnId, a.quantity]));

  const modal = document.createElement("div");
  modal.id = "rpo-alloc-modal";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.55); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;";
  modal.innerHTML = `
    <div style="background:#fff; border-radius:var(--radius); max-width:560px; width:100%; max-height:85vh; overflow-y:auto; box-shadow:0 20px 50px rgba(0,0,0,0.3);">
      <div style="padding:16px 20px; border-bottom:1px solid var(--border);">
        <div style="font-size:0.95rem; font-weight:800; color:var(--brand);">Allocate to PRNs — ${li.description || ""}</div>
        <div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">Vendor Discussed Qty: <strong>${fmt(vdq)}</strong></div>
      </div>
      <div style="padding:14px 20px;">
        ${prns.length === 0 ? `<div style="font-size:0.82rem; color:var(--muted);">No PRN currently needs this material from this PO.</div>` :
          prns.map(p => `
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
            <span style="flex:1; font-family:monospace; font-size:0.8rem; font-weight:700; color:${p.stale ? "#b45309" : "var(--brand)"};">${p.prnId.replace(/^PRN_/,"")}${p.stale ? " ●" : ""}</span>
            <span style="font-size:0.72rem; color:#334155; font-weight:600; white-space:nowrap;">needs ${fmt(p.need)}</span>
            <input type="number" min="0" max="${p.need}" step="any" class="rpo-alloc-modal-input" data-prnid="${p.prnId}" data-need="${p.need}"
              value="${workingByPrn[p.prnId] !== undefined ? Math.min(workingByPrn[p.prnId], p.need) : p.need}"
              oninput="updateRPOAllocModalSummary(${idx})"
              style="width:90px; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--brand); border-radius:4px; font-size:0.85rem;">
          </div>`).join("")}
      </div>
      <div id="rpo-alloc-modal-summary" style="padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700;"></div>
      <div style="padding:14px 20px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:10px;">
        <button onclick="document.getElementById('rpo-alloc-modal').remove()" style="padding:8px 16px; border:1px solid var(--border); background:#fff; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.8rem;">Cancel</button>
        <button class="nav-btn-styled" onclick="saveRPOAllocationModal(${idx})" style="background:var(--accent); color:#fff; font-weight:700; padding:8px 18px;">Save Allocation</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  updateRPOAllocModalSummary(idx);
}

function updateRPOAllocModalSummary(idx) {
  const li = window.rpoActive?.lineItems[idx];
  if (!li) return;
  const vdq = parseFloat(li.quantity) || 0;
  const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const inputs = Array.from(document.querySelectorAll(".rpo-alloc-modal-input"));
  let sum = 0, overCap = [];
  inputs.forEach(inp => {
    let v = parseFloat(inp.value) || 0;
    const need = parseFloat(inp.dataset.need) || 0;
    if (v < 0) { v = 0; inp.value = "0"; }
    if (v > need + 1e-9) { overCap.push(inp.dataset.prnid); }
    sum += v;
  });
  const el = document.getElementById("rpo-alloc-modal-summary");
  if (!el) return;
  const unalloc = Math.max(0, Math.round((vdq - sum) * 100) / 100);
  if (overCap.length) {
    el.style.color = "#b91c1c"; el.textContent = `${overCap.length} PRN(s) allocated more than they still need.`;
  } else if (sum > vdq + 1e-9) {
    el.style.color = "#b91c1c"; el.textContent = `Allocated ${fmt(sum)}, but the Vendor Discussed Qty is only ${fmt(vdq)}.`;
  } else {
    el.style.color = unalloc > 0 ? "#b45309" : "#15803d";
    el.textContent = unalloc > 0 ? `Allocated ${fmt(sum)} of ${fmt(vdq)}. Unallocated ${fmt(unalloc)} will be extra stock.` : `All ${fmt(vdq)} allocated.`;
  }
}

function saveRPOAllocationModal(idx) {
  const li = window.rpoActive?.lineItems[idx];
  const modal = document.getElementById("rpo-alloc-modal");
  if (!li || !modal) return;
  const vdq = parseFloat(li.quantity) || 0;
  const allocs = [];
  let sum = 0;
  for (const inp of modal.querySelectorAll(".rpo-alloc-modal-input")) {
    const q = parseFloat(inp.value) || 0;
    if (q <= 0) continue;
    const cap = parseFloat(inp.dataset.need) || 0;
    if (q > cap + 1e-9) { alert(`${inp.dataset.prnid.replace(/^PRN_/,"")} only needs ${cap} more from this PO, cannot allocate ${q}.`); return; }
    sum += q;
    allocs.push({ prnId: inp.dataset.prnid, quantity: q });
  }
  if (sum > vdq + 1e-9) { alert(`Allocated ${sum} across PRNs but the Vendor Discussed Qty is only ${vdq}.`); return; }
  li._workingAllocations = allocs;
  li._allocationTouched = true;
  modal.remove();
  renderPORevisionCard();
}

function collectRPOLines() {
  const st = window.rpoActive;
  return st.lineItems
    .map((li, idx) => ({ li, idx }))
    .filter(({ idx }) => document.getElementById(`rpo-amount-${idx}`)) // skip unchanged/unrendered lines
    .map(({ li, idx }) => {
      const vdq = parseFloat(li.quantity);
      const rate = parseFloat(li.rate) || 0;
      const discountPercent = parseFloat(li.discountPercent) || 0;
      const allocations = (li._workingAllocations || []).filter(a => a.quantity > 0);
      return { itemCode: li.itemCode, srNo: li.srNo, description: li.description, unit: li.unit,
               vendorDiscussedQty: vdq, rate, discountPercent,
               deliveryDate: li.deliveryDate || null, allocations, _received: Number(li.receivedQty) || 0, _idx: idx,
               _designRate: li.designRatePerQuantity, _sourceAllocations: li.allocations || [], _allocationTouched: li._allocationTouched };
    });
}

async function submitPORevisionUI() {
  const st = window.rpoActive;
  if (!st) return;
  const lines = collectRPOLines();

  for (const l of lines) {
    if (l.vendorDiscussedQty === undefined || l.vendorDiscussedQty === null || isNaN(l.vendorDiscussedQty)) {
      return showPurchaseFeedback("rpo-feedback", `⚠️ ${l.itemCode}: Vendor Discussed Purchase Quantity is required.`, "error");
    }
    if (l.vendorDiscussedQty < l._received - 1e-9) {
      return showPurchaseFeedback("rpo-feedback", `⚠️ ${l.itemCode}: ${l._received} already received, cannot revise below that.`, "error");
    }
    const sum = l.allocations.reduce((s, a) => s + a.quantity, 0);
    if (sum > l.vendorDiscussedQty + 1e-9) {
      return showPurchaseFeedback("rpo-feedback", `⚠️ ${l.itemCode}: allocated ${sum} but the revised line is ${l.vendorDiscussedQty}.`, "error");
    }
    // Per-PRN over-allocation — the modal already validates this before
    // Save, but checking it here too so a stale saved allocation (the
    // PRN's own need may have shifted since) is never silently sent.
    for (const a of l.allocations) {
      const src = l._sourceAllocations.find(s => s.prnId === a.prnId);
      const need = src ? Math.max(0, (Number(src.currentPurchaseQty) || 0) - (Number(src.coveredByOtherPOs) || 0)) : Infinity;
      if (a.quantity > need + 1e-9) {
        return showPurchaseFeedback("rpo-feedback", `⚠️ ${l.itemCode} / ${a.prnId.replace(/^PRN_/,"")}: needs only ${need} from this PO, cannot allocate ${a.quantity}.`, "error");
      }
    }
    // Rate/Qty vs Design Rate/Qty — same non-blocking warning Create PO
    // shows (the row itself already flags it visually); Revise PO doesn't
    // block on this, only Authorize does. Nothing to check/block here.
  }

  const deliveryDateRaw = document.getElementById("rpo-delivery-date")?.value.trim();
  let deliveryDate = deliveryDateRaw || null;
  if (deliveryDateRaw) {
    const d = new Date(deliveryDateRaw + "T00:00:00");
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2,'0');
      const mmm = d.toLocaleString('en-US',{month:'short'});
      deliveryDate = `${dd}-${mmm}-${d.getFullYear()}`;
    }
  }

  const btn = document.getElementById("rpo-submit-btn");
  btn.disabled = true; btn.textContent = "Submitting…";
  showBlockingOverlay("Submitting PO revision…");
  try {
    const data = await apFetch({ action: "submitPORevisionDraft", poNo: st.po.poNo,
      revisionKind: st.kind, lineItems: lines, operatorName: appActiveOperatorIdentityString,
      supplierRef: document.getElementById("rpo-supplier-ref")?.value.trim() || null,
      deliveryDate,
      cgstPercent: parseFloat(document.getElementById("rpo-cgst")?.value) || 0,
      sgstPercent: parseFloat(document.getElementById("rpo-sgst")?.value) || 0,
      igstPercent: parseFloat(document.getElementById("rpo-igst")?.value) || 0,
      packing: parseFloat(document.getElementById("rpo-packing")?.value) || 0,
      freight: parseFloat(document.getElementById("rpo-freight")?.value) || 0,
      other: parseFloat(document.getElementById("rpo-other")?.value) || 0,
      roundOff: parseFloat(document.getElementById("rpo-roundoff")?.value) || 0,
      warranty: document.getElementById("rpo-warranty")?.value.trim() || null,
      paymentTerms: document.getElementById("rpo-payment")?.value.trim() || null,
      freightTerms: document.getElementById("rpo-freight-terms")?.value.trim() || null,
    });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("rpo-detail-zone").innerHTML = "";
      window.rpoActive = null;
      const tabsZone = document.getElementById("rpo-tabs-and-lists");
      if (tabsZone) tabsZone.style.display = "none";
      showPurchaseFeedback("rpo-feedback", `✅ Revision for <strong>${st.po.poNo}</strong> submitted and is pending authorization. The PO is unchanged until it is authorized.<br><button onclick="document.getElementById('rpo-feedback').style.display='none'; initializeRevisePOPanel();" style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">+ Revise Another PO</button>`, "success", true);
    } else {
      btn.disabled = false; btn.textContent = "Submit Revision for Authorization";
      showPurchaseFeedback("rpo-feedback", data.error || "Submission failed.", "error");
    }
  } catch (e) {
    hideBlockingOverlay();
    btn.disabled = false; btn.textContent = "Submit Revision for Authorization";
    showPurchaseFeedback("rpo-feedback", "Network error: " + e.message, "error");
  }
}

async function cancelPOEntirely(poNo) {
  const st = window.rpoActive;
  if (!st) return;
  if (!confirm(`Cancel PO ${poNo} entirely?\n\nEvery line goes to zero and all PRN allocations are released back to "still to order". This still requires authorization.`)) return;
  const lines = st.lineItems.map(li => ({
    itemCode: li.itemCode, srNo: li.srNo, description: li.description, unit: li.unit,
    vendorDiscussedQty: 0, rate: Number(li.rate) || 0, discountPercent: Number(li.discountPercent) || 0,
    allocations: []
  }));
  try {
    const data = await apFetch({ action: "submitPORevisionDraft", poNo, revisionKind: "Cancellation",
      lineItems: lines, reason: "Full PO cancellation", operatorName: appActiveOperatorIdentityString });
    if (data.success) {
      document.getElementById("rpo-detail-zone").innerHTML = "";
      window.rpoActive = null;
      showPurchaseFeedback("rpo-feedback", `Cancellation of <strong>${poNo}</strong> submitted and is pending authorization.`, "success");
      initializeRevisePOPanel();
    } else {
      showPurchaseFeedback("rpo-feedback", data.error || "Cancellation failed.", "error");
    }
  } catch (e) {
    showPurchaseFeedback("rpo-feedback", "Network error: " + e.message, "error");
  }
}

async function dismissPORevision(poNo) {
  const reason = prompt(`Mark ${poNo} as needing no revision?\n\nUse this when you covered the PRN change with a NEW purchase order instead. Optionally note why:`);
  if (reason === null) return;
  try {
    const data = await apFetch({ action: "dismissPORevisionQueue", poNo, reason, operatorName: appActiveOperatorIdentityString });
    if (data.success) {
      showPurchaseFeedback("rpo-feedback", `${poNo} removed from the revision queue.`, "success");
      initializeRevisePOPanel();
    } else {
      showPurchaseFeedback("rpo-feedback", data.error || "Failed.", "error");
    }
  } catch (e) {
    showPurchaseFeedback("rpo-feedback", "Network error: " + e.message, "error");
  }
}

// ── Authorize PO Revision ────────────────────────────────────────────────
async function initializeAuthorizePORevisionPanel() {
  const feed = document.getElementById("apor-cards-feed");
  feed.style.display = "";
  feed.innerHTML = `<div style="text-align:center; padding:26px; color:var(--muted);">Loading pending revisions…</div>`;
  window.aporExpandedId = null;
  try {
    const data = await apFetch({ action: "fetchPendingPORevisions" });
    const revs = (data.success ? (data.revisions || []) : []);
    window.aporList = revs;
    if (revs.length === 0) {
      feed.innerHTML = `<div style="text-align:center; padding:26px; color:var(--muted); background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px;">✅ No PO revisions are awaiting authorization.</div>`;
      return;
    }
    feed.innerHTML = revs.map(r => `
      <div style="background:#fff; border:1px solid var(--border); border-left:3px solid ${r.revisionKind === "Cancellation" ? "#b91c1c" : "var(--accent)"}; border-radius:var(--radius); padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:14px; flex-wrap:wrap; cursor:pointer;" onclick="toggleAPORCard(${r.requestId})">
          <div>
            <div style="font-family:monospace; font-weight:800; color:var(--brand); font-size:0.95rem;">${r.poNo} <span style="font-size:0.7rem; color:var(--muted);">→ V${(Number(r.revisionNumber)||1) + 1}</span></div>
            <div style="font-size:0.82rem; font-weight:700;">${r.vendorName || ""}</div>
            <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Drafted by ${r.requestedBy || "—"} · ${r.requestedAt ? formatDateDMY(r.requestedAt) : ""}</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:0.68rem; font-weight:800; padding:4px 10px; border-radius:4px; background:${r.revisionKind === "Cancellation" ? "#fee2e2" : "#fef3c7"}; color:${r.revisionKind === "Cancellation" ? "#7f1d1d" : "#78350f"};">${r.revisionKind === "Cancellation" ? "FULL CANCELLATION" : r.revisionKind.toUpperCase()}</span>
            <button class="nav-btn-styled" style="background:var(--brand); color:#fff; font-weight:700; padding:7px 18px; font-size:0.8rem;">Authorize →</button>
          </div>
        </div>
        <div id="apor-expand-${r.requestId}" style="display:none; padding-top:14px; border-top:1px dashed var(--border); margin-top:12px;"></div>
      </div>`).join("");
  } catch (e) {
    feed.innerHTML = `<p style="color:var(--warn);">Network error: ${e.message}</p>`;
  }
}

function toggleAPORCard(requestId) {
  const expandDiv = document.getElementById(`apor-expand-${requestId}`);
  if (!expandDiv) return;
  if (window.aporExpandedId === requestId) {
    expandDiv.style.display = "none"; expandDiv.innerHTML = "";
    window.aporExpandedId = null;
    return;
  }
  if (window.aporExpandedId) {
    const prev = document.getElementById(`apor-expand-${window.aporExpandedId}`);
    if (prev) { prev.style.display = "none"; prev.innerHTML = ""; }
  }
  window.aporExpandedId = requestId;
  const r = (window.aporList || []).find(x => x.requestId === requestId);
  if (!r) return;
  expandDiv.style.display = "block";
  expandDiv.innerHTML = renderAPORCard(r);
  (r.revisedLineItems || []).forEach((_, idx) => updateAPORLineTotals(idx, requestId));
  updateAPORGrandTotal(requestId);
}

function renderAPORCard(r) {
  const fmt = (n) => (Number(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});
  const currentByItem = Object.fromEntries((r.currentLines || []).map(l => [l.itemCode, l]));
  const revised = r.revisedLineItems || [];
  const isCancel = r.revisionKind === "Cancellation";
  const hc = r.headerChanges || {};
  const rid = r.requestId;

  // PO Change Summary — every line the draft actually touches, in the
  // same bullet style as Revise PO's own "PRN Change Summary".
  const summaryLines = revised.map(line => {
    const cur = currentByItem[line.itemCode] || {};
    const oldQty = Number(cur.quantity) || 0, newQty = Number(line.quantity) || 0;
    const oldRate = Number(cur.rate) || 0, newRate = Number(line.rate) || 0;
    if (Math.abs(newQty - oldQty) < 1e-9 && Math.abs(newRate - oldRate) < 1e-9) return "";
    const qtyColor = newQty > oldQty ? "#15803d" : "#b91c1c";
    return `<li> <strong> ${line.description || line.itemCode}: </strong> ${fmt(oldQty)} → <span style="font-weight:700; color:${qtyColor};">${fmt(newQty)}</span>${Math.abs(newRate-oldRate) > 1e-9 ? `, rate ${fmt(oldRate)} → <span style="font-weight:700; color:#b45309;">${fmt(newRate)}</span>` : ""}</li>`;
  }).filter(Boolean);
  const summaryHtml = summaryLines.length ? `
      <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:10px 14px; margin-bottom:12px;">
        <div style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:#78350f; margin-bottom:6px;">Material Change Summary</div>
        <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#334155; line-height:1.7;">${summaryLines.join("")}</ul>
      </div>` : "";

  // General Change Summary — everything from Revise PO OTHER than the
  // material table itself: header fields, taxes/charges/terms, and the
  // resulting Sub Total / Grand Total movement.
  const bulletHtml = (f) => {
    const curDisp = f.isDate ? formatDateDMY(f.cur) : (f.isText ? (f.cur || "—") : fmt(f.cur));
    const revDisp = f.isDate ? formatDateDMY(f.rev) : (f.isText ? f.rev : fmt(f.rev));
    return `<li><strong>${f.label}</strong>: ${curDisp} → <span style="font-weight:700; color:#b45309;">${revDisp}</span></li>`;
  };
  const changedField = (f) => {
    if (f.rev == null) return false;
    if (f.isDate) return new Date(f.rev).toDateString() !== new Date(f.cur).toDateString();
    if (f.isText) return (f.rev || "") !== (f.cur || "");
    return Math.abs(Number(f.rev) - Number(f.cur)) > 1e-9;
  };
  const generalFieldDefs = [
    { label: "Supplier Offer No", cur: r.supplierRef, rev: hc.supplierRef, isText: true },
    { label: "Delivery Date", cur: r.deliveryDate, rev: hc.deliveryDate, isDate: true },
    { label: "CGST %", cur: r.cgstPercent, rev: hc.cgstPercent },
    { label: "SGST %", cur: r.sgstPercent, rev: hc.sgstPercent },
    { label: "IGST %", cur: r.igstPercent, rev: hc.igstPercent },
    { label: "Packing", cur: r.packing, rev: hc.packing },
    { label: "Freight", cur: r.freight, rev: hc.freight },
    { label: "Other", cur: r.other, rev: hc.other },
    { label: "Round Off", cur: r.roundOff, rev: hc.roundOff },
    { label: "Warranty", cur: r.warranty, rev: hc.warranty, isText: true },
    { label: "Payment Terms", cur: r.paymentTerms, rev: hc.paymentTerms, isText: true },
    { label: "Freight Terms", cur: r.freightTerms, rev: hc.freightTerms, isText: true },
  ];
  const generalBullets = generalFieldDefs.filter(changedField).map(bulletHtml);

  const effForSummary = {
    cgstPercent: hc.cgstPercent != null ? Number(hc.cgstPercent) : (Number(r.cgstPercent) || 0),
    sgstPercent: hc.sgstPercent != null ? Number(hc.sgstPercent) : (Number(r.sgstPercent) || 0),
    igstPercent: hc.igstPercent != null ? Number(hc.igstPercent) : (Number(r.igstPercent) || 0),
    packing: hc.packing != null ? Number(hc.packing) : (Number(r.packing) || 0),
    freight: hc.freight != null ? Number(hc.freight) : (Number(r.freight) || 0),
    other: hc.other != null ? Number(hc.other) : (Number(r.other) || 0),
    roundOff: hc.roundOff != null ? Number(hc.roundOff) : (Number(r.roundOff) || 0),
  };
  const draftSubTotal = revised.reduce((sum, line) => sum + (Number(line.quantity)||0) * (Number(line.rate)||0) * (100 - (Number(line.discountPercent)||0)) / 100, 0)
    + (r.currentLines || []).filter(cur => !revised.some(l => l.itemCode === cur.itemCode))
        .reduce((sum, cur) => sum + (Number(cur.amount) || 0), 0);
  const draftGrandTotal = draftSubTotal + draftSubTotal*effForSummary.cgstPercent/100 + draftSubTotal*effForSummary.sgstPercent/100
    + draftSubTotal*effForSummary.igstPercent/100 + effForSummary.packing + effForSummary.freight + effForSummary.other + effForSummary.roundOff;
  const oldSubTotal = Number(r.subTotal) || 0, oldGrandTotal = Number(r.grandTotal) || 0;
  if (Math.abs(draftSubTotal - oldSubTotal) > 1e-9) generalBullets.push(`<li><strong>Sub Total</strong>: ${fmt(oldSubTotal)} → <span style="font-weight:700; color:${draftSubTotal > oldSubTotal ? "#15803d" : "#b91c1c"};">${fmt(draftSubTotal)}</span></li>`);
  if (Math.abs(draftGrandTotal - oldGrandTotal) > 1e-9) generalBullets.push(`<li><strong>Grand Total</strong>: ${fmt(oldGrandTotal)} → <span style="font-weight:700; color:${draftGrandTotal > oldGrandTotal ? "#15803d" : "#b91c1c"};">${fmt(draftGrandTotal)}</span></li>`);

  const generalSummaryHtml = generalBullets.length ? `
      <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:10px 14px; margin-bottom:12px;">
        <div style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:#78350f; margin-bottom:6px;">General Change Summary</div>
        <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#334155; line-height:1.7;">${generalBullets.join("")}</ul>
      </div>` : "";

  const designRates = r.designRatesByItemCode || {};
  const rows = revised.map((line, idx) => {
    const cur = currentByItem[line.itemCode] || {};
    const oldQty = Number(cur.quantity) || 0;
    const received = Number(cur.received) || 0;
    const newQty = Number(line.quantity) || 0;
    const rowBg = Math.abs(newQty - oldQty) < 1e-9 ? "" : (newQty > oldQty ? "#f0fdf4" : "#fffbeb");

    // Same over-rate check Create/Authorize PO already have — this screen
    // was missing it entirely, so a revision could push a rate above the
    // BOQ's Design Rate/Qty with no warning and nothing stopping it.
    const designRate = designRates[line.itemCode];
    const hasDesignRate = designRate != null;
    const rate = Number(line.rate) || 0;
    const disc = Number(line.discountPercent) || 0;
    const effectiveRate = rate * (100 - disc) / 100;
    const isOverRate = hasDesignRate && effectiveRate > Number(designRate) + 1e-9;

    const allocs = line.allocations || [];
    const allocHtml = allocs.length === 0
      ? `<div style="font-size:0.72rem; color:var(--muted);">No PRN allocated. Entire Material Quantity is extra stock.</div>`
      : allocs.map(a => {
          // Same "needs" concept as Revise PO — this PRN's current draw
          // from THIS line, floored so a cross-PO split is never double-counted.
          const need = Math.max(0, (Number(a.currentPurchaseQty) || Number(a.quantity) || 0));
          return `<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="flex:1; font-family:monospace; font-size:0.7rem; font-weight:700; color:var(--brand);">${a.prnId.replace(/^PRN_/,"")}</span>
            <input type="number" min="0" step="any" class="apor-alloc" data-idx="${idx}" data-prnid="${a.prnId}" data-need="${need}"
              value="${Number(a.quantity)||0}" oninput="updateAPORLineTotals(${idx}, ${rid})"
              style="width:78px; text-align:center; font-weight:700; padding:4px; border:1.5px solid var(--brand); border-radius:3px; font-size:0.78rem;">
          </div>`;
        }).join("");

    return `
      <tr style="border-bottom:1px solid #e2e8f0; ${isOverRate ? "background:#fef2f2;" : (rowBg ? `background:${rowBg};` : "")}">
        <td style="padding:8px; font-size:0.8rem; font-weight:600; min-width:170px;">${line.description || ""}</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:#1a2332;">${fmt(oldQty)}</td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-weight:800; color:${newQty > oldQty ? "#15803d" : "#b91c1c"};">${fmt(newQty)}</td>
        <td style="padding:8px; text-align:center; font-size:0.72rem; color:${received > 0 ? "#b45309" : "var(--muted)"}; font-weight:700;">${fmt(received)}</td>
        <td style="padding:8px; text-align:center;">
          <input type="number" min="${received}" step="any" class="apor-vdq" data-idx="${idx}" data-requestid="${rid}"
            value="${Number(line.quantity)||0}" oninput="updateAPORLineTotals(${idx}, ${rid})"
            style="width:100px; text-align:center; font-weight:800; padding:6px; border:1.5px solid #15803d; border-radius:4px; font-size:0.85rem;">
        </td>
        <td style="padding:8px; text-align:center; font-family:monospace; font-weight:700; color:#475569; font-size:0.82rem;" data-designrate="${idx}">${hasDesignRate ? fmt(designRate) : '—'}</td>
        <td style="padding:8px; text-align:center;">
          <input type="number" min="0" step="any" class="apor-rate" data-idx="${idx}" data-requestid="${rid}" value="${Number(line.rate)||0}" oninput="updateAPORLineTotals(${idx}, ${rid})"
            style="width:90px; text-align:center; font-weight:700; padding:6px; border:1.5px solid ${isOverRate ? '#dc2626' : 'var(--border)'}; border-radius:4px; font-size:0.82rem; ${isOverRate ? 'background:#fef2f2;' : ''}">
        </td>
        <td style="padding:8px; text-align:center;">
          <input type="number" min="0" max="100" step="any" class="apor-disc" data-idx="${idx}" value="${Number(line.discountPercent)||0}" oninput="updateAPORLineTotals(${idx}, ${rid})"
            style="width:70px; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem;">
        </td>
        <td id="apor-amount-${rid}-${idx}" style="padding:8px; text-align:right; font-family:monospace; font-weight:800; font-size:0.88rem;">0</td>
        <td style="padding:8px; min-width:190px;">${allocHtml}<div id="apor-sum-${rid}-${idx}" style="font-size:0.65rem; font-weight:800; margin-top:4px;"></div>
          ${isOverRate ? `<div style="margin-top:6px; font-size:0.68rem; font-weight:700; color:#b91c1c;">⚠️ Rate after Disc % (${fmt(effectiveRate)}) is above Design Rate/Qty (${fmt(designRate)}). Only an admin can authorize.</div>` : ""}
        </td>
      </tr>`;
  }).join("");

  // hc.deliveryDate is stored as "dd-Mon-yyyy" (e.g. "11-Aug-2026") by
  // Revise PO, which native Date parsing handles inconsistently across
  // browsers — parsed explicitly here instead of trusting `new Date(...)`.
  const parseDMYDate = (s) => {
    if (!s) return "";
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s).trim());
    if (m) {
      const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
      const mm = months[m[2]] || '01';
      return `${m[3]}-${mm}-${m[1].padStart(2,'0')}`;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0,10);
  };

  return `
    <div data-requestid="${rid}">
      ${isCancel ? `<div style="background:#fef2f2; border-left:3px solid #b91c1c; padding:9px 12px; border-radius:4px; font-size:0.76rem; color:#7f1d1d; margin-bottom:12px;">Authorizing this cancels the PO outright. Every line goes to zero and all PRN allocations return to "still to order".</div>` : ""}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
        <div>
          <label class="field-label" style="margin-top:0;">Supplier Offer No</label>
          <input type="text" id="apor-supplier-ref-${rid}" value="${(hc.supplierRef != null ? hc.supplierRef : r.supplierRef || "").replace(/"/g,"&quot;")}" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        </div>
        <div>
          <label class="field-label" style="margin-top:0;">Delivery Date *</label>
          <input type="date" lang="en-GB" id="apor-delivery-date-${rid}" value="${parseDMYDate(hc.deliveryDate) || parseDMYDate(r.deliveryDate)}" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        </div>
      </div>

      ${summaryHtml}

      <div style="background:#f8fafc; border-left:3px solid var(--brand); padding:9px 12px; border-radius:4px; font-size:0.75rem; color:#334155; margin-bottom:12px;">
        <strong>Vendor Discussed Purchase Quantity</strong> is what was actually agreed with the vendor. It cannot go below what has already been received. Anything not allocated to a PRN is ordered as extra stock and lands in the Raw Material store.
      </div>

      <div style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius);">
        <table class="store-basket-data-table" style="width:100%; border-collapse:collapse; min-width:1150px;">
          <thead><tr style="background:#f8fafc;">
            <th style="padding:8px; font-size:0.68rem; text-align:left; min-width:170px;">Description of Material</th>
            <th style="padding:8px; font-size:0.68rem; text-align:center;">Old PO Qty</th>
            <th style="padding:8px; font-size:0.68rem; text-align:center; color:var(--brand);">New Required Qty</th>
            <th style="padding:8px; font-size:0.68rem; text-align:center;">Already Received</th>
            <th style="padding:8px; font-size:0.68rem; text-align:center; color:#15803d;">Vendor Discussed Qty *</th>
            <th style="padding:8px; font-size:0.68rem; text-align:center;">Design Rate / Qty</th>
            <th style="padding:8px; font-size:0.68rem; text-align:center;">Rate / Qty</th>
            <th style="padding:8px; font-size:0.68rem; text-align:center;">Disc %</th>
            <th style="padding:8px; font-size:0.68rem; text-align:center; color:#15803d;">Amount</th>
            <th style="padding:8px; font-size:0.68rem; text-align:left;">Allocation to PRNs</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      ${generalSummaryHtml}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Taxes & Charges</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
            <div><label class="field-label" style="margin-top:0;">CGST %</label><input type="number" id="apor-cgst-${rid}" value="${hc.cgstPercent != null ? hc.cgstPercent : (Number(r.cgstPercent)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">SGST %</label><input type="number" id="apor-sgst-${rid}" value="${hc.sgstPercent != null ? hc.sgstPercent : (Number(r.sgstPercent)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">IGST %</label><input type="number" id="apor-igst-${rid}" value="${hc.igstPercent != null ? hc.igstPercent : (Number(r.igstPercent)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Packing</label><input type="number" id="apor-packing-${rid}" value="${hc.packing != null ? hc.packing : (Number(r.packing)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Freight</label><input type="number" id="apor-freight-${rid}" value="${hc.freight != null ? hc.freight : (Number(r.freight)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Other</label><input type="number" id="apor-other-${rid}" value="${hc.other != null ? hc.other : (Number(r.other)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Round Off</label><input type="number" id="apor-roundoff-${rid}" value="${hc.roundOff != null ? hc.roundOff : (Number(r.roundOff)||0)}" step="any" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          </div>
        </div>
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Terms</div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Warranty</label><input type="text" id="apor-warranty-${rid}" value="${(hc.warranty != null ? hc.warranty : r.warranty || "").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Payment Terms</label><input type="text" id="apor-payment-${rid}" value="${(hc.paymentTerms != null ? hc.paymentTerms : r.paymentTerms || "").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Freight Terms</label><input type="text" id="apor-freight-terms-${rid}" value="${(hc.freightTerms != null ? hc.freightTerms : r.freightTerms || "").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; background:#f0f9ff; border:1px solid #bae6fd; border-radius:var(--radius); padding:14px; margin-top:14px;">
        <div style="font-size:0.85rem;">
          <div>Sub Total: <strong id="apor-subtotal-disp-${rid}">0</strong></div>
          <div style="font-size:1.05rem; margin-top:4px;">Grand Total: <strong id="apor-grandtotal-disp-${rid}" style="color:var(--brand);">0</strong></div>
        </div>
        <div style="display:flex; gap:10px;">
          <button id="apor-reject-${rid}" onclick="rejectPORevisionUI(${rid})" style="padding:8px 18px; background:#b91c1c; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700; font-size:0.82rem;">Reject PO Revision</button>
          <button id="apor-auth-${rid}" class="nav-btn-styled" onclick="authorizePORevisionUI(${rid}, false)" style="background:var(--accent); color:#fff; font-weight:700; padding:8px 22px;">Authorize PO Revision</button>
        </div>
      </div>
    </div>`;
}

function updateAPORLineTotals(idx, requestId) {
  const vdq = parseFloat(document.querySelector(`.apor-vdq[data-idx="${idx}"][data-requestid="${requestId}"]`)?.value) || 0;
  const rate = parseFloat(document.querySelectorAll(`#apor-expand-${requestId} .apor-rate[data-idx="${idx}"]`)[0]?.value) || 0;
  const disc = parseFloat(document.querySelectorAll(`#apor-expand-${requestId} .apor-disc[data-idx="${idx}"]`)[0]?.value) || 0;
  const amountEl = document.getElementById(`apor-amount-${requestId}-${idx}`);
  if (amountEl) amountEl.textContent = (vdq * rate * (100 - disc) / 100).toLocaleString("en-IN",{maximumFractionDigits:2});

  const inputs = Array.from(document.querySelectorAll(`#apor-expand-${requestId} .apor-alloc[data-idx="${idx}"]`));
  let sum = 0;
  inputs.forEach(inp => {
    let v = parseFloat(inp.value) || 0;
    const need = parseFloat(inp.dataset.need) || 0;
    if (v < 0) { v = 0; inp.value = "0"; }
    if (v > need + 1e-9) { v = need; inp.value = Number.isInteger(need) ? need : need.toFixed(2); }
    sum += v;
    inp.style.borderColor = "var(--brand)";
  });
  const el = document.getElementById(`apor-sum-${requestId}-${idx}`);
  if (el) {
    const extra = Math.round((vdq - sum) * 100) / 100;
    if (sum > vdq + 1e-9) { el.style.color = "#b91c1c"; el.textContent = `Allocated ${sum} but the line is ${vdq}.`; }
    else if (extra > 0)  { el.style.color = "#b45309"; el.textContent = `${extra} Extra Quantity`; }
    else                 { el.style.color = "#15803d"; el.textContent = "Fully allocated"; }
  }
  updateAPORGrandTotal(requestId);
}

function updateAPORGrandTotal(requestId) {
  const scope = document.getElementById(`apor-expand-${requestId}`);
  if (!scope) return;
  let subTotal = 0;
  scope.querySelectorAll(`[id^="apor-amount-${requestId}-"]`).forEach(el => {
    subTotal += parseFloat(el.textContent.replace(/,/g, "")) || 0;
  });
  const cgst = parseFloat(document.getElementById(`apor-cgst-${requestId}`)?.value) || 0;
  const sgst = parseFloat(document.getElementById(`apor-sgst-${requestId}`)?.value) || 0;
  const igst = parseFloat(document.getElementById(`apor-igst-${requestId}`)?.value) || 0;
  const packing = parseFloat(document.getElementById(`apor-packing-${requestId}`)?.value) || 0;
  const freight = parseFloat(document.getElementById(`apor-freight-${requestId}`)?.value) || 0;
  const other = parseFloat(document.getElementById(`apor-other-${requestId}`)?.value) || 0;
  const roundOff = parseFloat(document.getElementById(`apor-roundoff-${requestId}`)?.value) || 0;
  const grandTotal = subTotal + subTotal*cgst/100 + subTotal*sgst/100 + subTotal*igst/100 + packing + freight + other + roundOff;
  const subEl = document.getElementById(`apor-subtotal-disp-${requestId}`);
  const gtEl = document.getElementById(`apor-grandtotal-disp-${requestId}`);
  if (subEl) subEl.textContent = subTotal.toLocaleString("en-IN",{maximumFractionDigits:2});
  if (gtEl) gtEl.textContent = grandTotal.toLocaleString("en-IN",{maximumFractionDigits:2});
}

// Two-phase authorize. The first call may come back needsConfirmation
// when a PRN moved on since the draft was written — rather than discarding
// the purchaser's vendor negotiation, the server re-clamps the affected
// allocations and reports exactly what will become spare. The authorizer
// sees that and re-confirms; only then does anything get written.
async function authorizePORevisionUI(requestId, confirmStale) {
  const authBtn = document.getElementById(`apor-auth-${requestId}`);
  const rejBtn = document.getElementById(`apor-reject-${requestId}`);
  if (authBtn) { authBtn.disabled = true; authBtn.textContent = "Authorizing…"; }
  if (rejBtn) rejBtn.disabled = true;

  const r = (window.aporList || []).find(x => x.requestId === requestId);
  const originalLines = r ? (r.revisedLineItems || []) : [];
  const editedLineItems = originalLines.map((line, idx) => {
    const vdqEl = document.querySelector(`.apor-vdq[data-idx="${idx}"][data-requestid="${requestId}"]`);
    const scope = document.getElementById(`apor-expand-${requestId}`);
    const rateEl = scope?.querySelectorAll(`.apor-rate[data-idx="${idx}"]`)[0];
    const discEl = scope?.querySelectorAll(`.apor-disc[data-idx="${idx}"]`)[0];
    const allocEls = scope ? Array.from(scope.querySelectorAll(`.apor-alloc[data-idx="${idx}"]`)) : [];
    return {
      ...line,
      quantity: vdqEl ? (parseFloat(vdqEl.value) || 0) : line.quantity,
      rate: rateEl ? (parseFloat(rateEl.value) || 0) : line.rate,
      discountPercent: discEl ? (parseFloat(discEl.value) || 0) : line.discountPercent,
      allocations: allocEls.map(el => ({ prnId: el.dataset.prnid, quantity: parseFloat(el.value) || 0 })),
    };
  });
  const editedHeader = {
    supplierRef: document.getElementById(`apor-supplier-ref-${requestId}`)?.value || null,
    deliveryDate: document.getElementById(`apor-delivery-date-${requestId}`)?.value || null,
    cgstPercent: parseFloat(document.getElementById(`apor-cgst-${requestId}`)?.value) || 0,
    sgstPercent: parseFloat(document.getElementById(`apor-sgst-${requestId}`)?.value) || 0,
    igstPercent: parseFloat(document.getElementById(`apor-igst-${requestId}`)?.value) || 0,
    packing: parseFloat(document.getElementById(`apor-packing-${requestId}`)?.value) || 0,
    freight: parseFloat(document.getElementById(`apor-freight-${requestId}`)?.value) || 0,
    other: parseFloat(document.getElementById(`apor-other-${requestId}`)?.value) || 0,
    roundOff: parseFloat(document.getElementById(`apor-roundoff-${requestId}`)?.value) || 0,
    warranty: document.getElementById(`apor-warranty-${requestId}`)?.value || null,
    paymentTerms: document.getElementById(`apor-payment-${requestId}`)?.value || null,
    freightTerms: document.getElementById(`apor-freight-terms-${requestId}`)?.value || null,
  };

  // Same non-admin block Authorize PO already has — checked here (not
  // just visually flagged) since nothing previously stopped a revision
  // with a rate above Design Rate/Qty from actually being authorized.
  const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
  if (!isAdminUser) {
    const designRates = r?.designRatesByItemCode || {};
    for (const line of editedLineItems) {
      const dr = designRates[line.itemCode];
      if (dr == null) continue;
      const effectiveRate = (Number(line.rate) || 0) * (100 - (Number(line.discountPercent) || 0)) / 100;
      if (effectiveRate > Number(dr) + 1e-9) {
        if (authBtn) { authBtn.disabled = false; authBtn.textContent = "Authorize PO Revision"; }
        if (rejBtn) rejBtn.disabled = false;
        return alert(`${line.itemCode}: Rate / Qty after Disc % (${effectiveRate}) is higher than Design Rate / Qty (${dr}). Only an admin can authorize this PO revision. Hand it off to an admin.`);
      }
    }
  }

  showBlockingOverlay("Authorizing PO revision…");

  try {
    const data = await apFetch({ action: "authorizePORevision", requestId, confirmStale,
      editedLineItems, editedHeader,
      operatorName: appActiveOperatorIdentityString });
    hideBlockingOverlay();

    if (!data.success && data.needsConfirmation) {
      const fmt = (n) => (Number(n)||0).toLocaleString("en-IN",{maximumFractionDigits:2});
      const lines = (data.staleNotes || []).map(s =>
        `• ${s.prnId} / ${s.itemCode}: drafted ${fmt(s.drafted)}, but it can now only take ${fmt(s.canAbsorb)} — ${fmt(s.surplus)} becomes spare stock.`).join("\n");
      if (confirm(`A PRN changed since this revision was drafted.\n\n${lines}\n\nAuthorize with these adjustments?`)) {
        return authorizePORevisionUI(requestId, true);
      }
      if (authBtn) { authBtn.disabled = false; authBtn.textContent = "Authorize Revision"; }
      if (rejBtn) rejBtn.disabled = false;
      return;
    }

    if (data.success) {
      checkPurchasePORevisionReminder();
      const feed = document.getElementById("apor-cards-feed");
      if (feed) { feed.style.display = "none"; feed.innerHTML = ""; }
      const notes = [];
      if ((data.staleNotes || []).length) notes.push(`${data.staleNotes.length} allocation(s) re-clamped to current PRN needs.`);
      if ((data.unwound || []).length) notes.push(`Deferred BOQ reductions completed for ${data.unwound.map(u => u.prnId).join(", ")}.`);
      let msg = `<div style="font-size:0.85rem; font-weight:800; margin-bottom:8px;">✅ <strong>${data.poNo}</strong> revised to V${data.revisionNumber}!</div>`;
      if (notes.length) msg += `<div style="font-size:0.8rem; margin-bottom:8px;">${notes.join(" ")}</div>`;
      if (data.pdfUrl) msg += `<a href="${driveLink(data.pdfUrl)}" target="_blank" style="display:inline-block; margin-top:8px; margin-right:10px; background:#fff; color:var(--brand); border:1.5px solid var(--brand); padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; text-decoration:none;">📄 Open PDF →</a>`;
      msg += `<button onclick="document.getElementById('apor-feedback').style.display='none'; initializeAuthorizePORevisionPanel();" style="margin-top:14px; background:var(--accent); color:#fff; border:none; padding:7px 18px; border-radius:var(--radius); font-weight:700; font-size:0.82rem; cursor:pointer;">+ Authorize Another PO Revision</button>`;
      showPurchaseFeedback("apor-feedback", msg, "success", true);
    } else {
      if (authBtn) { authBtn.disabled = false; authBtn.textContent = "Authorize Revision"; }
      if (rejBtn) rejBtn.disabled = false;
      showPurchaseFeedback("apor-feedback", data.error || "Authorization failed.", "error");
    }
  } catch (e) {
    hideBlockingOverlay();
    if (authBtn) { authBtn.disabled = false; authBtn.textContent = "Authorize Revision"; }
    if (rejBtn) rejBtn.disabled = false;
    showPurchaseFeedback("apor-feedback", "Network error: " + e.message, "error");
  }
}

async function rejectPORevisionUI(requestId) {
  if (!confirm("Reject this PO revision? The PO stays unchanged and returns to the revision queue.")) return;
  try {
    const data = await apFetch({ action: "rejectPORevision", requestId, rejectionReason: null,
      operatorName: appActiveOperatorIdentityString });
    if (data.success) {
      // Nothing to restore — the live PO was never modified. It simply
      // reappears in the revision queue, since its stamped PRN versions
      // are still behind.
      showPurchaseFeedback("apor-feedback", `Revision for <strong>${data.poNo}</strong> rejected. The PO is unchanged and returns to the revision queue.`, "success");
      await initializeAuthorizePORevisionPanel();
    } else {
      showPurchaseFeedback("apor-feedback", data.error || "Rejection failed.", "error");
    }
  } catch (e) {
    showPurchaseFeedback("apor-feedback", "Network error: " + e.message, "error");
  }
}

// ── Revise PRN (store ↔ purchase re-split, + BOQ-driven delta revisions) ──
window.rprnState = null;

