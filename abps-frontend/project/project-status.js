function handlePstatProjectInput(query) {
  const dd = document.getElementById("pstat-project-dropdown");
  if (!query || query.trim().length < 1) { dd.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const matches = window.pstatKnownProjectCodes.filter(p => p.toLowerCase().includes(q)).slice(0, 10);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(p => `
    <div onclick="selectPstatProject('${p.replace(/'/g,"\\'")}')"
      style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${p}</div>`).join("");
  dd.style.display = "block";
}
function selectPstatProject(projectId) {
  document.getElementById("pstat-project-input").value = projectId;
  document.getElementById("pstat-project-dropdown").style.display = "none";
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#pstat-project-input") && !e.target.closest("#pstat-project-dropdown")) {
    const dd = document.getElementById("pstat-project-dropdown"); if (dd) dd.style.display = "none";
  }
});

function fmtPstatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${hh}:${mm} ${dd}/${mo}/${yyyy}`;
}

async function runProjectStatusSearch() {
  const projectId = document.getElementById("pstat-project-input").value.trim();
  if (!projectId) { alert("Enter a Project ID first."); return; }
  document.getElementById("pstat-project-dropdown").style.display = "none";
  const resultsZone = document.getElementById("pstat-results");
  const lanesContainer = document.getElementById("pstat-lanes-container");
  resultsZone.style.display = "block";
  lanesContainer.innerHTML = `<div class="pstat-empty-state">Loading...</div>`;
  document.getElementById("pstat-header-id").textContent = projectId;
  document.getElementById("pstat-header-company").textContent = "";
  document.getElementById("pstat-header-metrics").textContent = "";

  try {
    const [designData, purchaseData, productionData, ppsData] = await Promise.all([
      apFetch({ action: "fetchProjectDesignStatus", projectId }),
      apFetch({ action: "fetchProjectPurchaseStatus", projectId }),
      apFetch({ action: "fetchProjectProductionStatus", projectId }),
      apFetch({ action: "fetchProjectPPSBatch", projectId }),
    ]);

    if (!designData.success) {
      lanesContainer.innerHTML = `<div class="pstat-empty-state" style="color:var(--warn);">${designData.error}</div>`;
      return;
    }

    const companyName = (window.pstatProjectMeta && window.pstatProjectMeta[projectId] && window.pstatProjectMeta[projectId].companyName) || "";
    document.getElementById("pstat-header-company").textContent = companyName;

    const lanes = buildPstatLanes(designData, purchaseData, productionData, ppsData);
    renderPstatHeaderMetrics(lanes);
    renderPstatLanes(lanes, lanesContainer);
  } catch (e) {
    lanesContainer.innerHTML = `<div class="pstat-empty-state" style="color:var(--warn);">Network error: ${e.message}</div>`;
  }
}

function setPstatView(view) {
  document.getElementById("pstat-results").dataset.view = view;
  document.getElementById("pstat-view-btn-summary").classList.toggle("pstat-view-active", view === "summary");
  document.getElementById("pstat-view-btn-detail").classList.toggle("pstat-view-active", view === "detail");
}

// buildPstatLanes — one lane per BOQ, joining that BOQ's PRN, PPS materials
// and Job Cards by boq_id (the key every one of these tables already
// carries but the old UI never joined on). A PRN or Job Card whose boqId
// matches no BOQ row is data drift, not silently dropped — it lands in a
// trailing "Unlinked records" lane instead.
function buildPstatLanes(designData, purchaseData, productionData, ppsData) {
  const boqs = designData.boqs || [];
  const prns = (purchaseData.success && purchaseData.prns) ? purchaseData.prns : [];
  const jobCards = (productionData.success && productionData.jobCards) ? productionData.jobCards : [];
  const materialsByPrn = (ppsData.success && ppsData.materialsByPrn) ? ppsData.materialsByPrn : {};

  const prnsByBoq = {};
  prns.forEach(p => { (prnsByBoq[p.boqId] = prnsByBoq[p.boqId] || []).push(p); });
  const jcsByBoq = {};
  jobCards.forEach(jc => { (jcsByBoq[jc.boqId] = jcsByBoq[jc.boqId] || []).push(jc); });
  const linkedBoqIds = new Set(boqs.map(b => b.boqId));

  const lanes = boqs.map(boq => {
    const boqPrns = prnsByBoq[boq.boqId] || [];
    const prn = boqPrns.length > 0 ? boqPrns[boqPrns.length - 1] : null;
    const materials = prn ? (materialsByPrn[prn.prnId] || []) : [];
    return { boq, prn, materials, jobCards: jcsByBoq[boq.boqId] || [] };
  });

  const orphanPrns = prns.filter(p => !linkedBoqIds.has(p.boqId));
  const orphanJcs = jobCards.filter(jc => !linkedBoqIds.has(jc.boqId));
  if (orphanPrns.length > 0 || orphanJcs.length > 0) {
    lanes.push({ orphan: true, orphanPrns, orphanJcs });
  }
  return lanes;
}

// derivePstatStages — the single source of truth for every stage's node
// colour and text across the whole screen. See the plan doc for the exact
// rules; kept here as one function so the visual and the logic can never
// drift apart.
function derivePstatStages(lane) {
  const { boq, prn, materials, jobCards } = lane;
  const today = new Date();

  const design = {
    state: boq.status === "Authorized" ? "complete" : "active",
    primary: `V${boq.version || 1}`,
    sub: boq.status || "—",
  };

  let purchase;
  if (!prn) {
    purchase = { state: "pending", primary: "—", sub: "PRN not raised" };
  } else if (prn.status === "Pending Authorization") {
    purchase = { state: "active", primary: prn.prnId, primaryUrl: prn.pdfUrl || null, sub: prn.status };
  } else {
    purchase = { state: "complete", primary: prn.prnId, primaryUrl: prn.pdfUrl || null, sub: prn.status || "—" };
  }

  let po;
  if (!prn || materials.length === 0) {
    po = { state: "pending", primary: "—", sub: prn ? "No PPS lines" : "No PRN yet" };
  } else {
    const totalBuffered = materials.reduce((s, m) => s + (Number(m.bufferedPurchaseQty) || 0), 0);
    const totalStill = materials.reduce((s, m) => s + (Number(m.stillToOrder) || 0), 0);
    const totalRecv = materials.reduce((s, m) => s + (Number(m.receivedQty) || 0), 0);
    const receivedPct = totalBuffered > 1e-9 ? (totalRecv / totalBuffered) * 100 : 0;

    let state;
    if (receivedPct >= 100 - 1e-6) state = "complete";
    else if (totalStill < totalBuffered || totalRecv > 0) state = "active";
    else state = "pending";

    const anyAwaitingRevision = materials.some(m => m.awaitingPoRevision);
    const anyOverdue = materials.some(m => (m.purchaseOrders || []).some(po =>
      po.expectedDelivery && new Date(po.expectedDelivery) < today && !po.actualDelivery));
    if (anyAwaitingRevision || anyOverdue) state = "attention";

    po = {
      state,
      primary: `${Math.round(receivedPct)}%`,
      sub: anyOverdue ? "Overdue delivery" : anyAwaitingRevision ? "PO revision needed" : "Received",
    };
  }

  let production;
  if (jobCards.length === 0) {
    production = { state: "pending", primary: "—", sub: "No Job Cards" };
  } else {
    const doneCount = jobCards.filter(jc => jc.isCompleted).length;
    const anyProgress = jobCards.some(jc => jc.isCompleted || (Number(jc.weightedUsed) || 0) > 0);
    const state = doneCount === jobCards.length ? "complete" : anyProgress ? "active" : "pending";
    production = { state, primary: `${doneCount}/${jobCards.length}`, sub: "sets done" };
  }

  return { design, purchase, po, production };
}

// Lane accent = furthest-reached stage's colour, so a wall of green lanes
// with one amber/red bar reads at a glance. 'attention' anywhere always wins.
function pstatLaneAccent(stages) {
  const all = [stages.design, stages.purchase, stages.po, stages.production];
  if (all.some(s => s.state === "attention")) return "attention";
  let furthest = stages.design.state; // design is never "pending"
  [stages.purchase, stages.po, stages.production].forEach(s => {
    if (s.state !== "pending") furthest = s.state;
  });
  return furthest;
}

function renderPstatHeaderMetrics(lanes) {
  const realLanes = lanes.filter(l => !l.orphan);
  const boqCount = realLanes.length;
  const authorizedCount = realLanes.filter(l => l.boq.status === "Authorized").length;
  const prnCount = realLanes.filter(l => l.prn).length;
  let totalBuffered = 0, totalRecv = 0;
  realLanes.forEach(l => {
    l.materials.forEach(m => {
      totalBuffered += Number(m.bufferedPurchaseQty) || 0;
      totalRecv += Number(m.receivedQty) || 0;
    });
  });
  const receivedPct = totalBuffered > 1e-9 ? Math.round((totalRecv / totalBuffered) * 100) : 0;
  let totalSets = 0, doneSets = 0;
  realLanes.forEach(l => { totalSets += l.jobCards.length; doneSets += l.jobCards.filter(jc => jc.isCompleted).length; });

  const sep = `<span class="pstat-metric-sep">·</span>`;
  document.getElementById("pstat-header-metrics").innerHTML =
    `<strong>${boqCount}</strong> BOQ${boqCount === 1 ? "" : "s"} (<strong>${authorizedCount}</strong> authorized)${sep}` +
    `<strong>${prnCount}</strong> PRN${prnCount === 1 ? "" : "s"} raised${sep}` +
    `<strong>${receivedPct}%</strong> material received${sep}` +
    `<strong>${doneSets}/${totalSets}</strong> sets complete`;
}

function renderPstatLanes(lanes, container) {
  if (lanes.length === 0) {
    container.innerHTML = `<div class="pstat-empty-state">No BOQs found for this project.</div>`;
    return;
  }
  container.innerHTML = lanes.map(lane => lane.orphan ? renderPstatOrphanLane(lane) : renderPstatLane(lane)).join("");
}

function renderPstatLane(lane) {
  const { boq } = lane;
  const stages = derivePstatStages(lane);
  const accent = pstatLaneAccent(stages);
  const stageDefs = [
    { label: "Design", data: stages.design },
    { label: "Purchase", data: stages.purchase },
    { label: "PO", data: stages.po },
    { label: "Production", data: stages.production },
  ];

  const nodesHtml = stageDefs.map((sd, i) => {
    const nodeClass = sd.data.state === "complete" ? "pstat-node-complete"
      : sd.data.state === "active" ? "pstat-node-active"
      : sd.data.state === "attention" ? "pstat-node-attention" : "";
    const connector = i === 0 ? "" :
      `<div class="pstat-connector ${stageDefs[i - 1].data.state === "complete" ? "pstat-connector-fill" : ""}"></div>`;
    return `${connector}<div class="pstat-node ${nodeClass}">${sd.data.state === "attention" ? "!" : ""}</div>`;
  }).join("");

  const labelsHtml = stageDefs.map(sd => {
    // Purchase's primary is a real PRN ID (identifying text, not a
    // metric like "9%" or "0/9") — shown unbold and, when a PDF exists,
    // as a link straight to the document instead of plain text.
    const primaryHtml = sd.data.primaryUrl
      ? `<a href="${driveLink(sd.data.primaryUrl)}" target="_blank" class="pstat-stage-primary pstat-stage-primary-link">${sd.data.primary}</a>`
      : `<div class="pstat-stage-primary">${sd.data.primary}</div>`;
    return `
    <div class="pstat-stage" data-state="${sd.data.state}">
      <div class="pstat-stage-label">${sd.label}</div>
      ${primaryHtml}
      <div class="pstat-stage-sub">${sd.data.sub}</div>
    </div>`;
  }).join("");

  return `
    <div class="pstat-lane" data-accent="${accent}">
      <div class="pstat-lane-top">
        <div class="pstat-lane-title">${boq.productName || boq.department || boq.boqId}${boq.productRating ? `<span class="pstat-lane-rating">${boq.productRating}</span>` : ""}</div>
        <div class="pstat-lane-meta">
          <span class="pstat-lane-meta-strong">${boq.department || "—"}</span>
          <span class="pstat-lane-meta-strong">${fmtQty(boq.orderQuantity)} sets</span>
          ${boq.pdfUrl ? `<a href="${driveLink(boq.pdfUrl)}" target="_blank">BOQ Link ↗</a>` : `<span style="font-family:monospace;">${boq.boqId}</span>`}
        </div>
      </div>
      <div class="pstat-stepper">${nodesHtml}</div>
      <div class="pstat-stepper-labels">${labelsHtml}</div>
      <div class="pstat-lane-detail">${renderPstatLaneDetail(lane)}</div>
    </div>`;
}

// pstatProgressRingSvg — small circular progress indicator for a Job Card
// tile (replaces the old flat "Set 1 / 67%" text). Rotated -90deg so the
// arc starts at 12 o'clock and fills clockwise, same convention as most
// progress rings.
function pstatProgressRingSvg(pct, isDone) {
  const r = 18, c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = c * (1 - clamped / 100);
  const color = isDone ? "var(--pstat-complete)" : (clamped > 0 ? "var(--pstat-active)" : "var(--pstat-pending)");
  return `<svg width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(-90deg);">
    <circle cx="22" cy="22" r="${r}" fill="none" stroke="#e8edf3" stroke-width="4"></circle>
    <circle cx="22" cy="22" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" style="transition:stroke-dashoffset 0.3s ease;"></circle>
  </svg>`;
}

function renderPstatLaneDetail(lane) {
  const { materials, jobCards } = lane;
  let html = "";

  if (materials.length > 0) {
    html += `<div class="pstat-detail-heading">Materials (${materials.length})</div>
      <div class="pstat-scroll-wrap"><table class="pstat-mat-table">
        <thead><tr><th>Material</th><th style="text-align:center;">BOQ Req</th><th style="text-align:center;">On Order</th><th style="text-align:center;">Received</th><th>Progress</th></tr></thead>
        <tbody>
          ${materials.map(m => {
            const buffered = Number(m.bufferedPurchaseQty) || 0;
            const recv = Number(m.receivedQty) || 0;
            const pct = buffered > 1e-9 ? Math.min(100, (recv / buffered) * 100) : 0;
            return `<tr>
              <td>${m.materialName || m.itemCode}</td>
              <td style="text-align:center;">${fmtQty(m.boqRequiredQty)}</td>
              <td style="text-align:center;">${fmtQty(m.onOrderQty)}</td>
              <td style="text-align:center;">${fmtQty(m.receivedQty)}</td>
              <td>
                <div class="pstat-progress-cell">
                  <div class="pstat-progress-track"><div class="pstat-progress-fill ${pct < 100 ? "pstat-progress-partial" : ""}" style="width:${pct}%;"></div></div>
                  <span class="pstat-progress-label">${Math.round(pct)}%</span>
                </div>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>`;

    const allPos = materials.flatMap(m => (m.purchaseOrders || []).map(po => ({ ...po, materialName: m.materialName })));
    if (allPos.length > 0) {
      const today = new Date();
      html += `<div class="pstat-detail-heading">PO Allocations</div><div class="pstat-po-list">
        ${allPos.map(po => {
          const overdue = po.expectedDelivery && new Date(po.expectedDelivery) < today && !po.actualDelivery;
          const chipClass = po.actualDelivery ? "pstat-po-chip-ontime" : overdue ? "pstat-po-chip-overdue" : "pstat-po-chip-pending";
          const chipLabel = po.actualDelivery ? "Delivered" : overdue ? "Overdue" : "Pending";
          const poNoHtml = po.pdfUrl
            ? `<a href="${driveLink(po.pdfUrl)}" target="_blank" style="font-weight:400;">${po.poNo} ↗</a>`
            : `<span style="font-weight:400;">${po.poNo}</span>`;
          return `<div class="pstat-po-card">
            <div class="pstat-po-row1"><span>${poNoHtml} <span style="font-weight:600; color:var(--muted);">— ${po.vendorName || "—"}</span></span><span>${fmtQty(po.receivedQty)} / ${fmtQty(po.orderedQty)} recv</span></div>
            <div class="pstat-po-row2"><span>Exp: ${formatDateDMY(po.expectedDelivery) || "—"}${po.actualDelivery ? ` · Delivered: ${formatDateDMY(po.actualDelivery)}` : ""}</span><span class="pstat-po-chip ${chipClass}">${chipLabel}</span></div>
          </div>`;
        }).join("")}
      </div>`;
    }
  }

  if (jobCards.length > 0) {
    html += `<div class="pstat-detail-heading">Job Cards</div><div class="pstat-jc-grid">
      ${jobCards.map(jc => {
        const allotted = Number(jc.weightedAllotted) || 0;
        const used = Number(jc.weightedUsed) || 0;
        const pct = jc.isCompleted ? 100 : (allotted > 1e-9 ? Math.min(100, (used / allotted) * 100) : 0);
        return `<div class="pstat-jc-tile">
          <div class="pstat-jc-ring-wrap">
            ${pstatProgressRingSvg(pct, jc.isCompleted)}
            <div class="pstat-jc-ring-label ${jc.isCompleted ? "pstat-jc-ring-done" : ""}">${jc.isCompleted ? "✓" : pct.toFixed(0) + "%"}</div>
          </div>
          <div class="pstat-jc-set-label">Set ${jc.setNumber}</div>
        </div>`;
      }).join("")}
    </div>`;
  }

  if (!html) html = `<div style="color:var(--muted); font-size:0.82rem;">No purchase or production activity yet for this BOQ.</div>`;
  return html;
}

function renderPstatOrphanLane(lane) {
  const prnRows = (lane.orphanPrns || []).map(p => `<div class="pstat-po-card"><div class="pstat-po-row1"><span>${p.prnId}</span><span>${p.status || "—"}</span></div><div class="pstat-po-row2">References BOQ ${p.boqId} — not found among this project's BOQs.</div></div>`).join("");
  const jcRows = (lane.orphanJcs || []).map(jc => `<div class="pstat-po-card"><div class="pstat-po-row1"><span>${jc.jobCardNumber}</span><span>Set ${jc.setNumber}</span></div><div class="pstat-po-row2">References BOQ ${jc.boqId} — not found among this project's BOQs.</div></div>`).join("");
  return `
    <div class="pstat-lane" data-accent="attention">
      <div class="pstat-lane-top">
        <div class="pstat-lane-title">Unlinked records</div>
        <div class="pstat-lane-meta"><span>References a BOQ ID this project doesn't currently have</span></div>
      </div>
      <div class="pstat-lane-detail" style="margin-top:0; padding-top:0; border-top:none;">
        <div class="pstat-po-list">${prnRows}${jcRows}</div>
      </div>
    </div>`;
}

function exitTourExpenseBackToMenu() {
  document.getElementById("canvas-module-tour-expense").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function exitDesignWorkspacePanelBackToMenu() {
  document.getElementById("module-design-workspace-enclosure-panel").style.display = "none";
  const dd = document.getElementById("canvas-module-design-dashboard");
  if (dd) dd.style.display = "none";
  
  // Re-sync visibility rules matrices before showing menu elements
  enforceDynamicModuleRoleGateways(userPermissions);
  
  // FIXED: Restores your home grid cleanly to avoid layout breaks
  document.getElementById("dashboard-view").style.display = "flex";
  
  // Refresh company listings background cache
  triggerCompanyDropdownArrayFetch(); 
}

/**
 * NEW INITIALIZATION GATING: Filters personnel tree data explicitly for the Design Department.
 * Populates options with personnel belonging strictly to Design or Admin.
 */

