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
  // department screens that happen to share this same enclosure — showing
  // it there was misleading Store staff into thinking a Purchase Order
  // needed attention from them. They get the Store "BOQ revised, check
  // Revise PRN" reminder instead (purchase-enclosure-prn-revision-reminder-banner,
  // toggled together with Store's own copy via checkStorePRNRevisionReminder).
  if (["purchase-prn", "purchase-revise-prn", "purchase-authorize-prn"].includes(targetModuleId)) {
    const banner = document.getElementById("purchase-po-revision-reminder-banner");
    if (banner) banner.style.display = "none";
    checkStorePRNRevisionReminder();
  } else {
    checkPurchasePORevisionReminder();
    const storeBannerHere = document.getElementById("purchase-enclosure-prn-revision-reminder-banner");
    if (storeBannerHere) storeBannerHere.style.display = "none";
  }
  window.scrollTo(0, 0);
  setTimeout(() => window.scrollTo(0, 0), 50);
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.getElementById("module-store-workspace-enclosure-panel").style.display = "none";
  document.getElementById("module-design-workspace-enclosure-panel").style.display = "none";

  ["canvas-module-purchase-prn","canvas-module-purchase-material-list","canvas-module-purchase-upload-rm-po","canvas-module-purchase-rejected-material","canvas-module-purchase-create-po","canvas-module-purchase-authorize-prn","canvas-module-purchase-authorize-po","canvas-module-purchase-pps-tracking","canvas-module-purchase-revise-po","canvas-module-purchase-authorize-po-revision","canvas-module-purchase-revise-prn","canvas-module-purchase-search-po","canvas-module-purchase-vendor-costing"].forEach(id => {
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
  } else if (targetModuleId === "purchase-vendor-costing") {
    document.getElementById("canvas-module-purchase-vendor-costing").style.display = "block";
    initializeSearchVendorCostingInfoPanel();
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
      _allocatedForQty: Number(li.orderedQty) || 0,
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

    // Costing Diff — same formula as Create PO's row (see po.js
    // renderCPOMaterialRows), sourced from this line's own state. The
    // Design Rate/Qty comparison no longer highlights/warns here — a rate
    // above design rate was already reviewed and accepted when this PO
    // was first created and authorized, so Costing Diff is informational
    // only from here on.
    const discNow = parseFloat(li.discountPercent) || 0;
    const rateNow = parseFloat(li.rate) || 0;
    const hasRateValue = li.rate !== '' && li.rate !== null && li.rate !== undefined && !isNaN(parseFloat(li.rate));
    const effectiveRate = rateNow * (100 - discNow) / 100;
    const designRate = li.designRatePerQuantity;
    const hasDesignRate = designRate != null;
    const costingDiff = (hasRateValue && hasDesignRate) ? (effectiveRate - Number(designRate)) * vdqNow : null;

    const rpoRowBg = li.changed
      ? (Number(li.newRequiredQty) > Number(li.orderedQty) ? "#f0fdf4" : "#fffbeb")
      : "#fff";
    return `
    <div data-lineidx="${idx}" style="background:${rpoRowBg}; border:1px solid var(--border); border-radius:var(--radius); padding:12px; margin-bottom:10px;">
      <div style="display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap;">
        <div style="font-weight:700; color:var(--brand); padding-bottom:8px; min-width:20px;">${idx + 1}</div>

        <div style="flex:1; min-width:140px;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Material Name</div>
          <div style="min-height:36px; box-sizing:border-box; display:flex; align-items:center; font-size:0.82rem; font-weight:600; padding:6px 4px; word-break:break-word; white-space:normal;">${li.description || ""}</div>
        </div>
        <div style="width:100%; order:99;">
          <label style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; display:block;">Description of Material</label>
          <textarea rows="1" placeholder="Optional free-text note about this line (e.g. color, variant, spec detail)..."
            oninput="updateRPORowField(${idx},'additionalDescription',this.value)"
            style="width:100%; box-sizing:border-box; padding:7px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem; font-family:inherit; resize:vertical;">${(li.additionalDescription||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
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
          <input type="number" min="${Number(li.receivedQty)||0}" step="any" class="rpo-vdq" data-idx="${idx}" value="${formatQtyTrimmed(li.quantity)}"
            oninput="updateRPORowField(${idx},'quantity',this.value)"
            onblur="handleRPOQtyBlur(${idx})"
            style="width:100%; height:36px; box-sizing:border-box; text-align:center; font-weight:800; padding:6px; border:1.5px solid #15803d; border-radius:4px; font-size:0.85rem;">
        </div>
        <div style="width:90px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Rate / Qty *</div>
          <input type="number" min="0" step="any" class="rpo-rate" data-idx="${idx}" value="${formatQtyTrimmed(li.rate)}"
            oninput="updateRPORowField(${idx},'rate',this.value)"
            style="width:100%; height:36px; box-sizing:border-box; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem;">
        </div>
        <div style="width:65px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Disc %</div>
          <input type="number" min="0" max="100" step="any" class="rpo-disc" data-idx="${idx}" value="${formatQtyTrimmed(li.discountPercent)}"
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
          <label class="field-label" style="margin-top:0;">Delivery Date</label>
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
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
            <div><label class="field-label" style="margin-top:0;">Import / Export</label>
              <select id="rpo-trade-type" onchange="onRPOTradeTypeChange()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;">
                <option value="Import" ${po.tradeType !== 'Export' ? 'selected' : ''}>Import</option>
                <option value="Export" ${po.tradeType === 'Export' ? 'selected' : ''}>Export</option>
              </select>
            </div>
            <div id="rpo-usd-rate-wrap" style="display:${po.tradeType === 'Export' ? 'block' : 'none'};"><label class="field-label" style="margin-top:0;">INR to USD Rate</label><input type="number" min="0" step="0.01" id="rpo-usd-rate" value="${po.usdRate != null ? Number(po.usdRate) : ''}" placeholder="e.g. 95.3" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          </div>
          <div id="rpo-gst-note" style="display:${po.tradeType === 'Export' ? 'block' : 'none'}; font-size:0.78rem; color:var(--muted); margin-bottom:8px;">No GST for Export POs.</div>
          <div id="rpo-gst-fields" style="display:${po.tradeType === 'Export' ? 'none' : 'grid'}; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:10px;">
            <div><label class="field-label" style="margin-top:0;">CGST %</label><input type="number" min="0" id="rpo-cgst" value="${Number(po.cgstPercent)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">SGST %</label><input type="number" min="0" id="rpo-sgst" value="${Number(po.sgstPercent)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">IGST %</label><input type="number" min="0" id="rpo-igst" value="${Number(po.igstPercent)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
            <div><label class="field-label" style="margin-top:0;">Packing<span id="rpo-pkg-gst-note" style="display:${po.tradeType === 'Export' ? 'none' : 'inline'};"> (including GST)</span></label><input type="number" id="rpo-packing" value="${Number(po.packing)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Freight<span id="rpo-frt-gst-note" style="display:${po.tradeType === 'Export' ? 'none' : 'inline'};"> (including GST)</span></label><input type="number" id="rpo-freight" value="${Number(po.freight)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Other<span id="rpo-oth-gst-note" style="display:${po.tradeType === 'Export' ? 'none' : 'inline'};"> (including GST)</span></label><input type="number" id="rpo-other" value="${Number(po.other)||0}" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Round Off</label><input type="number" id="rpo-roundoff" value="${Number(po.roundOff)||0}" step="any" oninput="updateRPOGrandTotal()" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          </div>
        </div>
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Terms</div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Warranty</label><input type="text" id="rpo-warranty" value="${(po.warranty||"").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Insurance</label><input type="text" id="rpo-insurance" value="${(po.insurance||"").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Payment Terms</label><input type="text" id="rpo-payment" value="${(po.paymentTerms||"").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Freight Terms</label><input type="text" id="rpo-freight-terms" value="${(po.freightTerms||"").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        </div>
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; grid-column:1 / -1;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Notes (optional)</div>
          <textarea id="rpo-notes" rows="2" placeholder="Left blank, nothing extra appears on the document." style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%; font-family:inherit; font-size:0.85rem;">${(po.notes||"")}</textarea>
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

// handleRPOQtyBlur — same role as Create PO's handleCPOQtyBlur: once the
// operator settles on a new Vendor Discussed Qty that no longer matches
// what the allocation was actually made against, the PRN split can't be
// trusted anymore — clear it and force a re-confirm via Allocate to PRNs,
// same as Create PO does on Quantity.
function handleRPOQtyBlur(idx) {
  const li = window.rpoActive?.lineItems[idx];
  if (!li || !li._allocationTouched) return;
  const newQty = parseFloat(li.quantity) || 0;
  if (newQty === li._allocatedForQty) return;
  if ((li._workingAllocations || []).length > 0) {
    li._workingAllocations = [];
    li._allocationTouched = false;
  } else {
    // All-extra: extra is just "whatever's left", stays valid no matter
    // how the quantity changes — just re-track what it's confirmed against.
    li._allocatedForQty = newQty;
  }
  renderPORevisionCard();
}

function updateRPORowAmount(idx) {
  const li = window.rpoActive?.lineItems[idx];
  if (!li) return;
  const vdq = parseFloat(li.quantity) || 0;
  const rate = parseFloat(li.rate) || 0;
  const disc = parseFloat(li.discountPercent) || 0;
  const amountEl = document.getElementById(`rpo-amount-${idx}`);
  if (amountEl) amountEl.textContent = (vdq * rate * (100 - disc) / 100).toLocaleString("en-IN",{maximumFractionDigits:2});

  // Costing Diff — same effective-rate (after Disc %) logic as the
  // render-time version, updated live without a full re-render mid-keystroke.
  // No longer drives any highlighting — informational only.
  const hasRateValue = li.rate !== '' && li.rate !== null && li.rate !== undefined && !isNaN(parseFloat(li.rate));
  const effectiveRate = rate * (100 - disc) / 100;
  const designRate = li.designRatePerQuantity;
  const hasDesignRate = designRate != null;
  const costingDiff = (hasRateValue && hasDesignRate) ? (effectiveRate - Number(designRate)) * vdq : null;
  const diffSpan = document.querySelector(`.rpo-costing-diff[data-idx="${idx}"]`);
  if (diffSpan) {
    diffSpan.textContent = costingDiff != null ? costingDiff.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : "—";
    diffSpan.style.color = costingDiff > 0 ? "#dc2626" : (costingDiff < 0 ? "#15803d" : "#475569");
  }
}

function onRPOTradeTypeChange() {
  const isExport = document.getElementById("rpo-trade-type").value === "Export";
  document.getElementById("rpo-usd-rate-wrap").style.display = isExport ? "block" : "none";
  document.getElementById("rpo-gst-fields").style.display = isExport ? "none" : "grid";
  document.getElementById("rpo-gst-note").style.display = isExport ? "block" : "none";
  ["rpo-pkg-gst-note", "rpo-frt-gst-note", "rpo-oth-gst-note"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isExport ? "none" : "inline";
  });
  updateRPOGrandTotal();
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
  const isExport = document.getElementById("rpo-trade-type")?.value === "Export";
  const usdRate = parseFloat(document.getElementById("rpo-usd-rate")?.value) || 0;
  const conv = (n) => (isExport && usdRate > 0) ? n / usdRate : n;
  const cgstP = isExport ? 0 : (parseFloat(document.getElementById("rpo-cgst")?.value) || 0);
  const sgstP = isExport ? 0 : (parseFloat(document.getElementById("rpo-sgst")?.value) || 0);
  const igstP = isExport ? 0 : (parseFloat(document.getElementById("rpo-igst")?.value) || 0);
  const packing = parseFloat(document.getElementById("rpo-packing")?.value) || 0;
  const freight = parseFloat(document.getElementById("rpo-freight")?.value) || 0;
  const other = parseFloat(document.getElementById("rpo-other")?.value) || 0;
  const roundOff = parseFloat(document.getElementById("rpo-roundoff")?.value) || 0;
  // Packing/Freight/Other are entered GST-inclusive -- never part of the
  // GST-taxable base (the material sub-total alone), added after GST is
  // computed -- matches routes/purchase.js's authorizePORevision formula.
  const taxableBase = conv(subTotal);
  const grandTotal = taxableBase + taxableBase*cgstP/100 + taxableBase*sgstP/100 + taxableBase*igstP/100 + conv(packing) + conv(freight) + conv(other) + roundOff;
  const fmt = (n) => n.toLocaleString("en-IN",{maximumFractionDigits:2});
  const symbol = isExport ? "$" : "";
  const stEl = document.getElementById("rpo-subtotal-disp");
  const gtEl = document.getElementById("rpo-grandtotal-disp");
  if (stEl) stEl.textContent = symbol + fmt(taxableBase);
  if (gtEl) gtEl.textContent = symbol + fmt(grandTotal);
}

// ── Allocate to PRNs modal — visually identical to Create PO's
// openCPOAllocationPicker / saveCPOAllocationPicker (store/create-prn.js),
// sourced from this line's own li.allocations (already loaded with
// fetchPOForRevision) instead of a fresh fetch, since Revise PO already
// knows every open PRN for this item + PO combination.
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

  const rowsHtml = prns.map(p => `
    <div style="display:flex; align-items:center; gap:12px; padding:11px 12px; border:1px solid var(--border); border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:0.78rem; color:${p.stale ? "#b45309" : "var(--brand)"}; white-space:normal; line-height:1.4;">${p.prnId.replace(/^PRN_/,"")}${p.stale ? " ●" : ""}</div>
      </div>
      <span style="font-size:0.7rem; font-weight:700; color:#15803d; background:#dcfce7; padding:2px 8px; border-radius:4px; white-space:nowrap;">Needs ${fmt(p.need)}</span>
      <input type="number" min="0" max="${p.need}" step="any"
        class="rpo-alloc-modal-input" data-prnid="${p.prnId}" data-need="${p.need}"
        value="${workingByPrn[p.prnId] !== undefined ? Math.min(workingByPrn[p.prnId], p.need) : (p.need > 0 ? p.need : "")}" placeholder="0"
        oninput="updateRPOAllocModalSummary(${idx})"
        style="width:100px; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--brand); border-radius:4px; font-size:0.85rem;">
    </div>`).join("");

  const noPrnNotice = prns.length === 0
    ? `<div style="padding:10px 12px; margin-bottom:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; font-size:0.8rem; color:#78350f;">No authorized PRN currently needs this material from this PO. This line will be ordered entirely as extra available stock unless you add allocations to PRNs.</div>`
    : "";

  // Extra is always shown, never a manual input — same as Create PO,
  // it's just whatever's left on the line after real PRN allocations.
  const extraRowHtml = `
    <div id="rpo-alloc-extra-row" style="display:flex; align-items:center; gap:12px; padding:11px 12px; border:1px dashed #f59e0b; border-radius:6px; margin-bottom:6px; font-size:0.85rem; background:#fffbeb;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:0.78rem; color:#78350f;">Extra</div>
      </div>
      <div id="rpo-alloc-extra-value" style="width:100px; text-align:center; font-weight:700; padding:6px; border:1.5px solid #f59e0b; border-radius:4px; font-size:0.85rem; background:#fff; color:#78350f;">0</div>
    </div>`;

  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; width:100%; max-width:600px; max-height:82vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.3); overflow:hidden;">
      <div style="padding:18px 20px; border-bottom:1px solid var(--border); background:#f8fafc;">
        <div style="font-weight:800; font-size:1rem; color:var(--brand);">Allocate ${fmt(vdq)} ${li.unit || ""} of ${li.itemCode || li.description || ""} to PRNs</div>
      </div>
      <div style="overflow-y:auto; flex:1; padding:16px 20px;">${noPrnNotice}${rowsHtml}${extraRowHtml}</div>
      <div id="rpo-alloc-modal-summary" style="padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700;"></div>
      <div style="display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid var(--border); background:#f8fafc;">
        <button onclick="document.getElementById('rpo-alloc-modal').remove()" style="padding:9px 18px; border:1px solid var(--border); background:#fff; border-radius:6px; cursor:pointer; font-weight:600;">Cancel</button>
        <button onclick="saveRPOAllocationModal(${idx})" style="padding:9px 22px; background:var(--brand); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">Save Allocation</button>
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
    inp.style.borderColor = v > need + 1e-9 ? "#b91c1c" : "var(--brand)";
  });
  const unalloc = Math.round((vdq - sum) * 100) / 100;
  const extraEl = document.getElementById("rpo-alloc-extra-value");
  if (extraEl) extraEl.textContent = fmt(Math.max(0, unalloc));
  const el = document.getElementById("rpo-alloc-modal-summary");
  if (!el) return;
  if (overCap.length) {
    el.style.cssText = "padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700; background:#fef2f2; color:#b91c1c;";
    el.textContent = `${overCap.length} PRN(s) allocated more than they still need.`;
  } else if (sum > vdq + 1e-9) {
    el.style.cssText = "padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700; background:#fef2f2; color:#b91c1c;";
    el.textContent = `Allocated ${fmt(sum)}, but the Vendor Discussed Qty is only ${fmt(vdq)}.`;
  } else {
    el.style.cssText = `padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700; background:${unalloc > 0 ? "#fffbeb" : "#f0fdf4"}; color:${unalloc > 0 ? "#78350f" : "#15803d"};`;
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
  li._allocatedForQty = vdq;
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
      return { itemCode: li.itemCode, srNo: li.srNo, description: li.description, additionalDescription: li.additionalDescription || "", unit: li.unit,
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
      tradeType: document.getElementById("rpo-trade-type")?.value || "Import",
      usdRate: parseFloat(document.getElementById("rpo-usd-rate")?.value) || null,
      warranty: document.getElementById("rpo-warranty")?.value.trim() || null,
      insurance: document.getElementById("rpo-insurance")?.value.trim() || null,
      paymentTerms: document.getElementById("rpo-payment")?.value.trim() || null,
      freightTerms: document.getElementById("rpo-freight-terms")?.value.trim() || null,
      notes: document.getElementById("rpo-notes")?.value.trim() || null,
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
  // Plain confirm(), not prompt() — this action never required a
  // justification (routes/purchase.js's dismissPORevisionQueue only ever
  // validated poNo, reason was always optional), but the old prompt()'s
  // wording read as if typing something was mandatory.
  const ok = confirm(`Mark ${poNo} as needing no revision?\n\nUse this when you covered the PRN change with a NEW purchase order instead.`);
  if (!ok) return;
  try {
    const data = await apFetch({ action: "dismissPORevisionQueue", poNo, operatorName: appActiveOperatorIdentityString });
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
    // Give every revised line the same editable-state shape Revise PO's
    // own lineItems carry (_workingAllocations/_allocationTouched/
    // _allocatedForQty) so the row can reuse the identical card markup,
    // qty-blur reset, and Allocate to PRNs modal pattern.
    revs.forEach(r => {
      (r.revisedLineItems || []).forEach(li => {
        li._workingAllocations = (li.allocations || []).map(a => ({ prnId: a.prnId, quantity: Number(a.quantity) || 0 }));
        li._allocationTouched = (li.allocations || []).length > 0;
        li._allocatedForQty = Number(li.quantity) || 0;
      });
    });
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
    { label: "Insurance", cur: r.insurance, rev: hc.insurance, isText: true },
    { label: "Payment Terms", cur: r.paymentTerms, rev: hc.paymentTerms, isText: true },
    { label: "Freight Terms", cur: r.freightTerms, rev: hc.freightTerms, isText: true },
    { label: "Notes", cur: r.notes, rev: hc.notes, isText: true },
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
  const draftTaxableBase = draftSubTotal + effForSummary.packing + effForSummary.freight + effForSummary.other;
  const draftGrandTotal = draftTaxableBase + draftTaxableBase*effForSummary.cgstPercent/100 + draftTaxableBase*effForSummary.sgstPercent/100
    + draftTaxableBase*effForSummary.igstPercent/100 + effForSummary.roundOff;
  const oldSubTotal = Number(r.subTotal) || 0, oldGrandTotal = Number(r.grandTotal) || 0;
  if (Math.abs(draftSubTotal - oldSubTotal) > 1e-9) generalBullets.push(`<li><strong>Sub Total</strong>: ${fmt(oldSubTotal)} → <span style="font-weight:700; color:${draftSubTotal > oldSubTotal ? "#15803d" : "#b91c1c"};">${fmt(draftSubTotal)}</span></li>`);
  if (Math.abs(draftGrandTotal - oldGrandTotal) > 1e-9) generalBullets.push(`<li><strong>Grand Total</strong>: ${fmt(oldGrandTotal)} → <span style="font-weight:700; color:${draftGrandTotal > oldGrandTotal ? "#15803d" : "#b91c1c"};">${fmt(draftGrandTotal)}</span></li>`);

  const generalSummaryHtml = generalBullets.length ? `
      <div style="background:#fff; border:1px solid var(--border); border-radius:var(--radius); padding:10px 14px; margin-bottom:12px;">
        <div style="font-size:0.82rem; font-weight:800; text-transform:uppercase; color:#78350f; margin-bottom:6px;">General Change Summary</div>
        <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#334155; line-height:1.7;">${generalBullets.join("")}</ul>
      </div>` : "";

  const designRates = r.designRatesByItemCode || {};
  // Card-per-line layout — identical structure/columns to Revise PO's own
  // renderPORevisionCard rows (Description / Old PO Qty / New Required Qty
  // / Already Received / Unit / Vendor Discussed Qty / Rate / Qty / Disc %
  // / Costing Diff / Amount, then an Allocate to PRNs button + chips strip
  // below) instead of this screen's own bespoke table.
  const rows = revised.map((line, idx) => {
    const cur = currentByItem[line.itemCode] || {};
    const oldQty = Number(cur.quantity) || 0;
    const received = Number(cur.received) || 0;
    const newQty = Number(line.quantity) || 0;

    const workingAllocs = line._workingAllocations || [];
    const vdqNow = parseFloat(line.quantity) || 0;
    const allocSum = workingAllocs.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    const unallocNow = Math.round((vdqNow - allocSum) * 100) / 100;
    const chipsHtml = (workingAllocs.length || line._allocationTouched)
      ? workingAllocs.map(a => `<div style="display:inline-block; background:#e0f2fe; color:var(--brand); font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 4px 3px 0;" title="${a.prnId}">${a.prnId.replace(/^PRN_/,"")}: <strong>${a.quantity}</strong></div>`).join("")
        + (unallocNow > 0 ? `<div style="display:inline-block; background:#fef3c7; color:#78350f; font-size:0.72rem; padding:2px 8px; border-radius:4px; margin:0 0 3px 0;">Extra: <strong>${unallocNow}</strong></div>` : "")
      : '<span style="color:#b91c1c; font-size:0.75rem; font-weight:600;">No PRNs allocated</span>';

    // Costing Diff — same formula Authorize PO uses, informational only.
    // A rate above design rate was already reviewed and accepted when
    // this PO was first created and authorized, so nothing here
    // highlights or blocks on it anymore.
    const designRate = designRates[line.itemCode];
    const hasDesignRate = designRate != null;
    const discNow = parseFloat(line.discountPercent) || 0;
    const rateNow = parseFloat(line.rate) || 0;
    const hasRateValue = line.rate !== '' && line.rate !== null && line.rate !== undefined && !isNaN(parseFloat(line.rate));
    const effectiveRate = rateNow * (100 - discNow) / 100;
    const costingDiff = (hasRateValue && hasDesignRate) ? (effectiveRate - Number(designRate)) * vdqNow : null;

    const rowBg = Math.abs(newQty - oldQty) < 1e-9 ? "#fff" : (newQty > oldQty ? "#f0fdf4" : "#fffbeb");

    return `
    <div data-lineidx="${idx}" style="background:${rowBg}; border:1px solid var(--border); border-radius:var(--radius); padding:12px; margin-bottom:10px;">
      <div style="display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap;">
        <div style="font-weight:700; color:var(--brand); padding-bottom:8px; min-width:20px;">${idx + 1}</div>

        <div style="flex:1; min-width:140px;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Material Name</div>
          <div style="min-height:36px; box-sizing:border-box; display:flex; align-items:center; font-size:0.82rem; font-weight:600; padding:6px 4px; word-break:break-word; white-space:normal;">${line.description || ""}</div>
        </div>
        <div style="width:100%; order:99;">
          <label style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; display:block;">Description of Material</label>
          <textarea rows="1" placeholder="Optional free-text note about this line (e.g. color, variant, spec detail)..."
            oninput="updateAPORRowField(${rid},${idx},'additionalDescription',this.value)"
            style="width:100%; box-sizing:border-box; padding:7px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem; font-family:inherit; resize:vertical;">${(line.additionalDescription||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
        </div>
        <div style="width:70px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Old PO Qty</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; font-weight:700; color:#1a2332; font-size:0.85rem;">${fmt(oldQty)}</div>
        </div>
        <div style="width:75px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">New Required Qty</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; font-weight:800; font-size:0.85rem; color:${newQty > oldQty ? "#15803d" : "#b91c1c"};">${fmt(newQty)}</div>
        </div>
        <div style="width:70px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Already Received</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-size:0.78rem; font-weight:700; color:${received > 0 ? "#b45309" : "var(--muted)"};">${fmt(received)}</div>
        </div>
        <div style="width:50px; flex-shrink:0; text-align:center;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Unit</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; font-family:monospace; color:#475569; font-size:0.85rem;">${line.unit || '—'}</div>
        </div>
        <div style="width:90px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Vendor Discussed Qty *</div>
          <input type="number" min="${received}" step="any" class="apor-vdq" data-idx="${idx}" data-requestid="${rid}" value="${formatQtyTrimmed(line.quantity)}"
            oninput="updateAPORRowField(${rid},${idx},'quantity',this.value)"
            onblur="handleAPORQtyBlur(${rid},${idx})"
            style="width:100%; height:36px; box-sizing:border-box; text-align:center; font-weight:800; padding:6px; border:1.5px solid #15803d; border-radius:4px; font-size:0.85rem;">
        </div>
        <div style="width:90px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Rate / Qty *</div>
          <input type="number" min="0" step="any" class="apor-rate" data-idx="${idx}" data-requestid="${rid}" value="${formatQtyTrimmed(line.rate)}"
            oninput="updateAPORRowField(${rid},${idx},'rate',this.value)"
            style="width:100%; height:36px; box-sizing:border-box; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem;">
        </div>
        <div style="width:65px; flex-shrink:0;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px; text-align:center;">Disc %</div>
          <input type="number" min="0" max="100" step="any" class="apor-disc" data-idx="${idx}" data-requestid="${rid}" value="${formatQtyTrimmed(line.discountPercent)}"
            oninput="updateAPORRowField(${rid},${idx},'discountPercent',this.value)"
            style="width:100%; height:36px; box-sizing:border-box; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--border); border-radius:4px; font-size:0.82rem;">
        </div>
        <div style="width:100px; flex-shrink:0; text-align:right;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Costing Diff</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:flex-end; font-family:monospace; font-weight:700; font-size:0.85rem; color:${costingDiff > 0 ? '#dc2626' : (costingDiff < 0 ? '#15803d' : '#475569')};"><span class="apor-costing-diff" data-idx="${idx}" data-requestid="${rid}">${costingDiff != null ? costingDiff.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</span></div>
        </div>
        <div style="width:110px; flex-shrink:0; text-align:right;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Amount</div>
          <div style="height:36px; box-sizing:border-box; display:flex; align-items:center; justify-content:flex-end; font-family:monospace; font-weight:800; font-size:1.05rem; color:#0f172a;"><span id="apor-amount-${rid}-${idx}">0</span></div>
        </div>
      </div>

      <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div style="min-width:180px;">
          <div style="font-size:0.68rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">PRNs using this Material *</div>
          <button onclick="openAPORAllocationModal(${rid},${idx})" style="font-size:0.75rem; padding:5px 12px; background:var(--accent); color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">Allocate to PRNs</button>
        </div>
        <div style="flex:1; min-width:200px; padding-top:2px;">${chipsHtml}</div>
      </div>
    </div>`;
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
          <label class="field-label" style="margin-top:0;">Delivery Date</label>
          <input type="date" lang="en-GB" id="apor-delivery-date-${rid}" value="${parseDMYDate(hc.deliveryDate) || parseDMYDate(r.deliveryDate)}" style="padding:9px; border:1.5px solid var(--border); border-radius:var(--radius); width:100%;">
        </div>
      </div>

      ${summaryHtml}

      <div style="background:#f8fafc; border-left:3px solid var(--brand); padding:9px 12px; border-radius:4px; font-size:0.75rem; color:#334155; margin-bottom:12px;">
        <strong>Vendor Discussed Purchase Quantity</strong> is what was actually agreed with the vendor. It cannot go below what has already been received. Anything not allocated to a PRN is ordered as extra stock and lands in the Raw Material store.
      </div>

      <div id="apor-lines-wrap-${rid}">${rows}</div>

      ${generalSummaryHtml}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Taxes & Charges</div>
          ${(() => {
            const effTradeType = hc.tradeType != null ? hc.tradeType : (r.tradeType || 'Import');
            const effUsdRate = hc.usdRate != null ? hc.usdRate : (r.usdRate != null ? Number(r.usdRate) : '');
            const isExp = effTradeType === 'Export';
            return `
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
            <div><label class="field-label" style="margin-top:0;">Import / Export</label>
              <select id="apor-trade-type-${rid}" onchange="onAPORTradeTypeChange(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;">
                <option value="Import" ${!isExp ? 'selected' : ''}>Import</option>
                <option value="Export" ${isExp ? 'selected' : ''}>Export</option>
              </select>
            </div>
            <div id="apor-usd-rate-wrap-${rid}" style="display:${isExp ? 'block' : 'none'};"><label class="field-label" style="margin-top:0;">INR to USD Rate</label><input type="number" min="0" step="0.01" id="apor-usd-rate-${rid}" value="${effUsdRate}" placeholder="e.g. 95.3" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          </div>
          <div id="apor-gst-note-${rid}" style="display:${isExp ? 'block' : 'none'}; font-size:0.78rem; color:var(--muted); margin-bottom:8px;">No GST for Export POs.</div>
          <div id="apor-gst-fields-${rid}" style="display:${isExp ? 'none' : 'grid'}; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:10px;">
            <div><label class="field-label" style="margin-top:0;">CGST %</label><input type="number" min="0" id="apor-cgst-${rid}" value="${hc.cgstPercent != null ? hc.cgstPercent : (Number(r.cgstPercent)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">SGST %</label><input type="number" min="0" id="apor-sgst-${rid}" value="${hc.sgstPercent != null ? hc.sgstPercent : (Number(r.sgstPercent)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">IGST %</label><input type="number" min="0" id="apor-igst-${rid}" value="${hc.igstPercent != null ? hc.igstPercent : (Number(r.igstPercent)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          </div>`; })()}
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
            ${(() => { const isExp2 = (hc.tradeType != null ? hc.tradeType : (r.tradeType || 'Import')) === 'Export'; return `
            <div><label class="field-label" style="margin-top:0;">Packing<span id="apor-pkg-gst-note-${rid}" style="display:${isExp2 ? 'none' : 'inline'};"> (including GST)</span></label><input type="number" id="apor-packing-${rid}" value="${hc.packing != null ? hc.packing : (Number(r.packing)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Freight<span id="apor-frt-gst-note-${rid}" style="display:${isExp2 ? 'none' : 'inline'};"> (including GST)</span></label><input type="number" id="apor-freight-${rid}" value="${hc.freight != null ? hc.freight : (Number(r.freight)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
            <div><label class="field-label" style="margin-top:0;">Other<span id="apor-oth-gst-note-${rid}" style="display:${isExp2 ? 'none' : 'inline'};"> (including GST)</span></label><input type="number" id="apor-other-${rid}" value="${hc.other != null ? hc.other : (Number(r.other)||0)}" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>`; })()}
            <div><label class="field-label" style="margin-top:0;">Round Off</label><input type="number" id="apor-roundoff-${rid}" value="${hc.roundOff != null ? hc.roundOff : (Number(r.roundOff)||0)}" step="any" oninput="updateAPORGrandTotal(${rid})" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          </div>
        </div>
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Terms</div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Warranty</label><input type="text" id="apor-warranty-${rid}" value="${(hc.warranty != null ? hc.warranty : r.warranty || "").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Insurance</label><input type="text" id="apor-insurance-${rid}" value="${(hc.insurance != null ? hc.insurance : r.insurance || "").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div style="margin-bottom:8px;"><label class="field-label" style="margin-top:0;">Payment Terms</label><input type="text" id="apor-payment-${rid}" value="${(hc.paymentTerms != null ? hc.paymentTerms : r.paymentTerms || "").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
          <div><label class="field-label" style="margin-top:0;">Freight Terms</label><input type="text" id="apor-freight-terms-${rid}" value="${(hc.freightTerms != null ? hc.freightTerms : r.freightTerms || "").replace(/"/g,"&quot;")}" style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%;"></div>
        </div>
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); padding:16px; grid-column:1 / -1;">
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:12px;">Notes (optional)</div>
          <textarea id="apor-notes-${rid}" rows="2" placeholder="Left blank, nothing extra appears on the document." style="padding:7px; border:1px solid var(--border); border-radius:4px; width:100%; font-family:inherit; font-size:0.85rem;">${(hc.notes != null ? hc.notes : r.notes || "")}</textarea>
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

// updateAPORRowField — same role as Revise PO's updateRPORowField: keeps
// the line's own JS state in sync on every keystroke, so a later re-render
// (e.g. after the Allocate to PRNs modal saves on a DIFFERENT row) never
// loses an in-progress edit on this one.
function updateAPORRowField(requestId, idx, field, value) {
  const r = (window.aporList || []).find(x => x.requestId === requestId);
  const line = r?.revisedLineItems?.[idx];
  if (!line) return;
  line[field] = value;
  updateAPORLineTotals(idx, requestId);
}

// handleAPORQtyBlur — same role as Revise PO's handleRPOQtyBlur: a
// Vendor Discussed Qty edit that no longer matches what the allocation
// was made against clears the allocation and forces a re-confirm.
function handleAPORQtyBlur(requestId, idx) {
  const r = (window.aporList || []).find(x => x.requestId === requestId);
  const line = r?.revisedLineItems?.[idx];
  if (!line || !line._allocationTouched) return;
  const newQty = parseFloat(line.quantity) || 0;
  if (newQty === line._allocatedForQty) return;
  if ((line._workingAllocations || []).length > 0) {
    line._workingAllocations = [];
    line._allocationTouched = false;
  } else {
    line._allocatedForQty = newQty;
  }
  const expandDiv = document.getElementById(`apor-expand-${requestId}`);
  if (expandDiv) {
    expandDiv.innerHTML = renderAPORCard(r);
    (r.revisedLineItems || []).forEach((_, i) => updateAPORLineTotals(i, requestId));
    updateAPORGrandTotal(requestId);
  }
}

function updateAPORLineTotals(idx, requestId) {
  const r = (window.aporList || []).find(x => x.requestId === requestId);
  const line = r?.revisedLineItems?.[idx];
  if (!line) return;
  const vdq = parseFloat(line.quantity) || 0;
  const rate = parseFloat(line.rate) || 0;
  const disc = parseFloat(line.discountPercent) || 0;
  const amountEl = document.getElementById(`apor-amount-${requestId}-${idx}`);
  if (amountEl) amountEl.textContent = (vdq * rate * (100 - disc) / 100).toLocaleString("en-IN",{maximumFractionDigits:2});

  // Costing Diff — same live-update-without-full-re-render tradeoff as
  // Revise PO's updateRPORowAmount. Informational only, no highlighting.
  const designRates = r?.designRatesByItemCode || {};
  const hasRateValue = line.rate !== '' && line.rate !== null && line.rate !== undefined && !isNaN(parseFloat(line.rate));
  const effectiveRate = rate * (100 - disc) / 100;
  const designRate = designRates[line.itemCode];
  const hasDesignRate = designRate != null;
  const costingDiff = (hasRateValue && hasDesignRate) ? (effectiveRate - Number(designRate)) * vdq : null;
  const diffSpan = document.querySelector(`.apor-costing-diff[data-idx="${idx}"][data-requestid="${requestId}"]`);
  if (diffSpan) {
    diffSpan.textContent = costingDiff != null ? costingDiff.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : "—";
    diffSpan.style.color = costingDiff > 0 ? "#dc2626" : (costingDiff < 0 ? "#15803d" : "#475569");
  }

  updateAPORGrandTotal(requestId);
}

function onAPORTradeTypeChange(requestId) {
  const isExport = document.getElementById(`apor-trade-type-${requestId}`).value === "Export";
  document.getElementById(`apor-usd-rate-wrap-${requestId}`).style.display = isExport ? "block" : "none";
  document.getElementById(`apor-gst-fields-${requestId}`).style.display = isExport ? "none" : "grid";
  document.getElementById(`apor-gst-note-${requestId}`).style.display = isExport ? "block" : "none";
  ["apor-pkg-gst-note-", "apor-frt-gst-note-", "apor-oth-gst-note-"].forEach(prefix => {
    const el = document.getElementById(`${prefix}${requestId}`);
    if (el) el.style.display = isExport ? "none" : "inline";
  });
  updateAPORGrandTotal(requestId);
}
function updateAPORGrandTotal(requestId) {
  const scope = document.getElementById(`apor-expand-${requestId}`);
  if (!scope) return;
  let subTotal = 0;
  scope.querySelectorAll(`[id^="apor-amount-${requestId}-"]`).forEach(el => {
    subTotal += parseFloat(el.textContent.replace(/,/g, "")) || 0;
  });
  const isExport = document.getElementById(`apor-trade-type-${requestId}`)?.value === "Export";
  const usdRate = parseFloat(document.getElementById(`apor-usd-rate-${requestId}`)?.value) || 0;
  const conv = (n) => (isExport && usdRate > 0) ? n / usdRate : n;
  const cgst = isExport ? 0 : (parseFloat(document.getElementById(`apor-cgst-${requestId}`)?.value) || 0);
  const sgst = isExport ? 0 : (parseFloat(document.getElementById(`apor-sgst-${requestId}`)?.value) || 0);
  const igst = isExport ? 0 : (parseFloat(document.getElementById(`apor-igst-${requestId}`)?.value) || 0);
  const packing = parseFloat(document.getElementById(`apor-packing-${requestId}`)?.value) || 0;
  const freight = parseFloat(document.getElementById(`apor-freight-${requestId}`)?.value) || 0;
  const other = parseFloat(document.getElementById(`apor-other-${requestId}`)?.value) || 0;
  const roundOff = parseFloat(document.getElementById(`apor-roundoff-${requestId}`)?.value) || 0;
  // Packing/Freight/Other are entered GST-inclusive -- never part of the
  // GST-taxable base (the material sub-total alone), added after GST is
  // computed -- matches routes/purchase.js's authorizePORevision formula.
  const taxableBase = conv(subTotal);
  const grandTotal = taxableBase + taxableBase*cgst/100 + taxableBase*sgst/100 + taxableBase*igst/100 + conv(packing) + conv(freight) + conv(other) + roundOff;
  const symbol = isExport ? "$" : "";
  const subEl = document.getElementById(`apor-subtotal-disp-${requestId}`);
  const gtEl = document.getElementById(`apor-grandtotal-disp-${requestId}`);
  if (subEl) subEl.textContent = symbol + taxableBase.toLocaleString("en-IN",{maximumFractionDigits:2});
  if (gtEl) gtEl.textContent = symbol + grandTotal.toLocaleString("en-IN",{maximumFractionDigits:2});
}

// ── Allocate to PRNs modal for Authorize PO Revision — same chrome as
// Revise PO's openRPOAllocationModal. The drafted allocation record only
// carries {prnId, quantity} (no live "still needs" snapshot survives past
// the draft), so unlike Revise PO's modal there's no per-PRN cap shown —
// the server's own confirmStale reconciliation at authorize time is the
// authoritative check on live PRN capacity either way.
function openAPORAllocationModal(requestId, idx) {
  const r = (window.aporList || []).find(x => x.requestId === requestId);
  const line = r?.revisedLineItems?.[idx];
  if (!line) return;
  const vdq = parseFloat(line.quantity) || 0;
  const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const existing = document.getElementById("apor-alloc-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "apor-alloc-modal";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.55); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;";

  const rowsHtml = (line._workingAllocations || []).map(a => `
    <div style="display:flex; align-items:center; gap:12px; padding:11px 12px; border:1px solid var(--border); border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:0.78rem; color:var(--brand); white-space:normal; line-height:1.4;">${a.prnId.replace(/^PRN_/,"")}</div>
      </div>
      <input type="number" min="0" step="any"
        class="apor-alloc-modal-input" data-prnid="${a.prnId}"
        value="${a.quantity || ""}" placeholder="0"
        oninput="updateAPORAllocModalSummary(${requestId},${idx})"
        style="width:100px; text-align:center; font-weight:700; padding:6px; border:1.5px solid var(--brand); border-radius:4px; font-size:0.85rem;">
    </div>`).join("");

  const noPrnNotice = (line._workingAllocations || []).length === 0
    ? `<div style="padding:10px 12px; margin-bottom:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; font-size:0.8rem; color:#78350f;">No PRN allocated on this draft. This line is entirely extra stock unless allocated above.</div>`
    : "";

  const extraRowHtml = `
    <div id="apor-alloc-extra-row" style="display:flex; align-items:center; gap:12px; padding:11px 12px; border:1px dashed #f59e0b; border-radius:6px; margin-bottom:6px; font-size:0.85rem; background:#fffbeb;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:0.78rem; color:#78350f;">Extra</div>
      </div>
      <div id="apor-alloc-extra-value" style="width:100px; text-align:center; font-weight:700; padding:6px; border:1.5px solid #f59e0b; border-radius:4px; font-size:0.85rem; background:#fff; color:#78350f;">0</div>
    </div>`;

  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; width:100%; max-width:600px; max-height:82vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.3); overflow:hidden;">
      <div style="padding:18px 20px; border-bottom:1px solid var(--border); background:#f8fafc;">
        <div style="font-weight:800; font-size:1rem; color:var(--brand);">Allocate ${fmt(vdq)} ${line.unit || ""} of ${line.itemCode || line.description || ""} to PRNs</div>
      </div>
      <div style="overflow-y:auto; flex:1; padding:16px 20px;">${noPrnNotice}${rowsHtml}${extraRowHtml}</div>
      <div id="apor-alloc-modal-summary" style="padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700;"></div>
      <div style="display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid var(--border); background:#f8fafc;">
        <button onclick="document.getElementById('apor-alloc-modal').remove()" style="padding:9px 18px; border:1px solid var(--border); background:#fff; border-radius:6px; cursor:pointer; font-weight:600;">Cancel</button>
        <button onclick="saveAPORAllocationModal(${requestId},${idx})" style="padding:9px 22px; background:var(--brand); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">Save Allocation</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  updateAPORAllocModalSummary(requestId, idx);
}

function updateAPORAllocModalSummary(requestId, idx) {
  const r = (window.aporList || []).find(x => x.requestId === requestId);
  const line = r?.revisedLineItems?.[idx];
  if (!line) return;
  const vdq = parseFloat(line.quantity) || 0;
  const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const inputs = Array.from(document.querySelectorAll(".apor-alloc-modal-input"));
  let sum = 0;
  inputs.forEach(inp => {
    let v = parseFloat(inp.value) || 0;
    if (v < 0) { v = 0; inp.value = "0"; }
    sum += v;
  });
  const unalloc = Math.round((vdq - sum) * 100) / 100;
  const extraEl = document.getElementById("apor-alloc-extra-value");
  if (extraEl) extraEl.textContent = fmt(Math.max(0, unalloc));
  const el = document.getElementById("apor-alloc-modal-summary");
  if (!el) return;
  if (sum > vdq + 1e-9) {
    el.style.cssText = "padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700; background:#fef2f2; color:#b91c1c;";
    el.textContent = `Allocated ${fmt(sum)}, but the Vendor Discussed Qty is only ${fmt(vdq)}.`;
  } else {
    el.style.cssText = `padding:12px 20px; border-top:1px solid var(--border); font-size:0.82rem; font-weight:700; background:${unalloc > 0 ? "#fffbeb" : "#f0fdf4"}; color:${unalloc > 0 ? "#78350f" : "#15803d"};`;
    el.textContent = unalloc > 0 ? `Allocated ${fmt(sum)} of ${fmt(vdq)}. Unallocated ${fmt(unalloc)} will be extra stock.` : `All ${fmt(vdq)} allocated.`;
  }
}

function saveAPORAllocationModal(requestId, idx) {
  const r = (window.aporList || []).find(x => x.requestId === requestId);
  const line = r?.revisedLineItems?.[idx];
  const modal = document.getElementById("apor-alloc-modal");
  if (!line || !modal) return;
  const vdq = parseFloat(line.quantity) || 0;
  const allocs = [];
  let sum = 0;
  for (const inp of modal.querySelectorAll(".apor-alloc-modal-input")) {
    const q = parseFloat(inp.value) || 0;
    if (q <= 0) continue;
    sum += q;
    allocs.push({ prnId: inp.dataset.prnid, quantity: q });
  }
  if (sum > vdq + 1e-9) { alert(`Allocated ${sum} across PRNs but the Vendor Discussed Qty is only ${vdq}.`); return; }
  line._workingAllocations = allocs;
  line._allocationTouched = allocs.length > 0;
  line._allocatedForQty = vdq;
  modal.remove();
  const expandDiv = document.getElementById(`apor-expand-${requestId}`);
  if (expandDiv) {
    expandDiv.innerHTML = renderAPORCard(r);
    (r.revisedLineItems || []).forEach((_, i) => updateAPORLineTotals(i, requestId));
    updateAPORGrandTotal(requestId);
  }
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
  // quantity/rate/discountPercent/allocations are already kept live in
  // the JS model by updateAPORRowField / saveAPORAllocationModal — no
  // need to re-read the DOM (there's no longer a per-PRN input embedded
  // in the row to read from anyway, allocation editing moved to the modal).
  const editedLineItems = originalLines.map(line => ({
    ...line,
    quantity: parseFloat(line.quantity) || 0,
    rate: parseFloat(line.rate) || 0,
    discountPercent: parseFloat(line.discountPercent) || 0,
    allocations: (line._workingAllocations || []).filter(a => a.quantity > 0),
  }));
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
    tradeType: document.getElementById(`apor-trade-type-${requestId}`)?.value || "Import",
    usdRate: parseFloat(document.getElementById(`apor-usd-rate-${requestId}`)?.value) || null,
    warranty: document.getElementById(`apor-warranty-${requestId}`)?.value || null,
    insurance: document.getElementById(`apor-insurance-${requestId}`)?.value || null,
    paymentTerms: document.getElementById(`apor-payment-${requestId}`)?.value || null,
    freightTerms: document.getElementById(`apor-freight-terms-${requestId}`)?.value || null,
    notes: document.getElementById(`apor-notes-${requestId}`)?.value || null,
  };

  // No Design Rate/Qty block here anymore — a rate above design rate was
  // already reviewed and accepted when this PO was first created and
  // authorized, so a revision doesn't re-litigate it (Costing Diff on the
  // row stays informational only). Matches the backend, which no longer
  // enforces this on authorizePORevision either.

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

