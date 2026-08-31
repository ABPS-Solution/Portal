async function initializeMaterialListPanel() {
  document.getElementById("material-list-results-zone").innerHTML = "";
  document.getElementById("material-list-feedback").style.display = "none";
  materialListSelectedProjectId = null;
  const searchInput = document.getElementById("material-list-project-ta-input");
  if (searchInput) searchInput.value = "";

  await ensureSharedProjectTypeaheadData(true).catch(() => {});
  syncMaterialListScopeUI();
  await loadMaterialListForPurchase();
}

// "All Active Projects" is the default scope, highlighted like an active
// toggle; searching a specific project unhighlights it (and vice versa) —
// same active/inactive pill convention as Manufacturing Clearance's status
// toggles.
function syncMaterialListScopeUI() {
  const btn = document.getElementById("material-list-all-projects-btn");
  const label = document.getElementById("material-list-scope-label");
  const isAll = !materialListSelectedProjectId;
  if (btn) {
    btn.style.background = isAll ? "var(--brand)" : "#e2e8f0";
    btn.style.color = isAll ? "#fff" : "#334155";
  }
  if (label) {
    label.innerHTML = isAll
      ? `List of Material to Raise Purchase Order for <strong>ALL Active Projects</strong>`
      : `List of Material to Raise Purchase Order for <strong>${materialListSelectedProjectId}</strong>`;
  }
}

function selectMaterialListAllProjects() {
  materialListSelectedProjectId = null;
  const searchInput = document.getElementById("material-list-project-ta-input");
  if (searchInput) searchInput.value = "";
  document.getElementById("material-list-feedback").style.display = "none";
  syncMaterialListScopeUI();
  renderMaterialListFiltered();
}

function searchMaterialListByProject() {
  const input = document.getElementById("material-list-project-ta-input");
  const typed = (input?.value || "").trim();
  if (!typed) { showBOQBanner("material-list-feedback", "⚠️ Type a Project ID or Customer Name and select it from the dropdown first.", "error"); return; }
  // Must resolve to a real, known active project — a typed Customer Name
  // narrows the dropdown but isn't itself a valid filter value, only the
  // Project ID actually selected from it is.
  const known = window.sharedActiveProjectCodes || [];
  if (!known.includes(typed)) {
    showBOQBanner("material-list-feedback", "⚠️ Select a Project ID from the dropdown list.", "error");
    return;
  }
  document.getElementById("material-list-feedback").style.display = "none";
  materialListSelectedProjectId = typed;
  syncMaterialListScopeUI();
  renderMaterialListFiltered();
}

function renderMaterialListFiltered() {
  const filtered = materialListSelectedProjectId
    ? materialListCache.filter(item => item.projectId === materialListSelectedProjectId)
    : materialListCache;
  renderMaterialListByType(filtered);
}

async function loadMaterialListForPurchase() {
  const zone    = document.getElementById("material-list-results-zone");
  const syncBtn = document.getElementById("material-list-sync-btn");
  if (syncBtn) { syncBtn.disabled = true; syncBtn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Syncing...'; }
  zone.innerHTML = `<div style="text-align:center; padding:30px; color:var(--brand); font-weight:600;">
    <div class="spinner" style="display:inline-block; width:18px; height:18px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:10px; vertical-align:middle;"></div>
    Loading Material List...
  </div>`;

  try {
    const data = await apFetch({ action: "fetchMaterialListForPurchase" });
    if (!data.success) {
      zone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">${data.error || "Failed to load."}</div>`;
      return;
    }
    materialListCache = data.materials || [];
    renderMaterialListFiltered();
  } catch(e) {
    zone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-weight:700;">Network error: ${e.message}</div>`;
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.innerHTML = "🔄 Refresh"; }
  }
  refreshMaterialListHiddenNote();
}

// A PRN's materials don't appear above at all until Production has
// submitted (non-stale) requirement dates for them — see
// fetchMaterialListForPurchase's hard gate. Without this note a
// purchaser has no way to tell "nothing to buy" apart from "something's
// hidden, waiting on Production" — same complaint that Hold Product's
// visible badge exists to avoid, just here as a count rather than a
// per-row flag since the hidden rows never render at all.
async function refreshMaterialListHiddenNote() {
  const el = document.getElementById("material-list-hidden-note");
  if (!el) return;
  try {
    const data = await apFetch({ action: "checkPRNsNeedingRequirementDatesCount" });
    const count = data.success ? (data.count || 0) : 0;
    if (count > 0) {
      el.style.display = "block";
      el.textContent = `${count} PRN${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} awaiting Production requirement dates and ${count === 1 ? "is" : "are"} not shown.`;
    } else {
      el.style.display = "none";
    }
  } catch (e) { el.style.display = "none"; }
}

function renderMaterialListByType(materials) {
  const zone = document.getElementById("material-list-results-zone");

  // Aggregate by itemCode across all projects — sum purchase qty
  const aggregated = {};
  materials.forEach(item => {
    const code = (item.itemCode || "").trim();
    if (!code) return;
    const qty = Math.max(0, Number(item.stillToOrderQty) || 0);
    if (!aggregated[code]) {
      aggregated[code] = {
        itemCode:         code,
        materialName:     item.materialName || "—",
        typeOfMaterial:   (item.typeOfMaterial || "Uncategorized").trim(),
        unit:             item.unit || item.unitType || "NOS",
        totalPurchaseQty: 0
      };
    }
    aggregated[code].totalPurchaseQty += qty;
  });

  const active = Object.values(aggregated).filter(m => m.totalPurchaseQty > 0);

  if (active.length === 0) {
    zone.innerHTML = `<div style="text-align:center; padding:40px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); color:var(--muted);">
      <div style="font-size:2rem; margin-bottom:10px;">✅</div>
      <div style="font-weight:700; color:var(--accent);">All materials fully covered!</div>
      <div style="font-size:0.82rem; margin-top:4px;">No items with purchase quantity greater than zero.</div>
    </div>`;
    return;
  }

  // Group by type
  const typeGroups = {};
  active.forEach(item => {
    const type = item.typeOfMaterial;
    if (!typeGroups[type]) typeGroups[type] = [];
    typeGroups[type].push(item);
  });
  Object.values(typeGroups).forEach(g => g.sort((a, b) => b.totalPurchaseQty - a.totalPurchaseQty));

  zone.innerHTML = "";
  Object.keys(typeGroups).sort().forEach(type => {
    const items     = typeGroups[type];
    const sectionId = "ml-section-body-" + type.replace(/\s+/g, '_');
    const toggleId  = "ml-toggle-btn-" + type.replace(/\s+/g, '_');
    const isCollapsed = localStorage.getItem("ml_section_" + type) === "collapsed";

    const section = document.createElement("div");
    section.style.cssText = "margin-bottom:16px; background:var(--card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.04);";

    const headerDiv = document.createElement("div");
    headerDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:var(--highlight-bg); border-bottom:1px solid var(--border); cursor:pointer; user-select:none;";
    headerDiv.onclick = () => {
      const body = document.getElementById(sectionId);
      const btn  = document.getElementById(toggleId);
      if (body.style.display === "none") {
        body.style.display = "flex";
        btn.textContent = "▲ Collapse";
        localStorage.setItem("ml_section_" + type, "expanded");
      } else {
        body.style.display = "none";
        btn.textContent = "▼ Expand";
        localStorage.setItem("ml_section_" + type, "collapsed");
      }
    };
    headerDiv.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:0.78rem; font-weight:800; text-transform:uppercase; color:var(--brand); letter-spacing:0.5px;">${window.typeLabelDisplay_(type)}</span>
        <span style="font-size:0.72rem; font-weight:700; background:#fee2e2; color:#b91c1c; padding:2px 8px; border-radius:10px;">${items.length} ${items.length === 1 ? 'item' : 'items'}</span>
      </div>
      <button id="${toggleId}" style="background:transparent; border:1px solid var(--border); color:var(--brand); font-size:0.72rem; font-weight:700; padding:3px 10px; border-radius:4px; cursor:pointer;">
        ${isCollapsed ? '▼ Expand' : '▲ Collapse'}
      </button>`;

    const bodyDiv = document.createElement("div");
    bodyDiv.id = sectionId;
    bodyDiv.style.cssText = `display:${isCollapsed ? 'none' : 'flex'}; flex-wrap:wrap; gap:10px; padding:14px;`;

    items.forEach(item => {
      const card = document.createElement("div");
      card.style.cssText = "background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:var(--radius); display:flex; flex-direction:column; justify-content:space-between; gap:8px; box-shadow:0 1px 3px rgba(0,0,0,0.02); width:160px; flex-shrink:0; overflow:hidden; cursor:pointer;";
      card.title = "Click to see the Project ID breakdown for this material";
      card.onclick = () => showMaterialProjectBreakdownModal(item.itemCode, item.materialName, item.unit, item.totalPurchaseQty);
      card.innerHTML = `
        <div style="font-size:0.78rem; font-weight:700; color:#334155; line-height:1.35; word-break:break-word; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; flex:1;">
          ${item.materialName}
        </div>
        <div style="border-top:1px dashed #e2e8f0; padding-top:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-family:monospace; font-size:1.2rem; font-weight:800; color:#b91c1c;">${(Math.round(item.totalPurchaseQty * 100) / 100).toString()}</span>
            <span style="font-size:0.65rem; font-weight:700; padding:2px 6px; border-radius:3px; background:#fee2e2; color:#b91c1c;">${(item.unit || "NOS").toUpperCase()}</span>
          </div>
          <div style="font-size:0.65rem; color:var(--muted); font-weight:600; margin-top:2px;">To Purchase</div>
        </div>`;
      bodyDiv.appendChild(card);
    });

    section.appendChild(headerDiv);
    section.appendChild(bodyDiv);
    zone.appendChild(section);
  });
}

function showMaterialProjectBreakdownModal(itemCode, materialName, unit, totalQty) {
  // materialListCache already carries one entry per (Project ID, Item Code) pair —
  // the table view sums these into a single aggregated card. This modal un-collapses
  // that same data back into its per-project breakdown, no extra network call needed.
  const rows = materialListCache.filter(m => (m.itemCode || "").trim() === itemCode);

  // Respect whatever project scope is currently active, same as the main table
  const filteredRows = materialListSelectedProjectId
    ? rows.filter(r => r.projectId === materialListSelectedProjectId)
    : rows;

  const byPrn = {};
  const reqDatesByPrn = {};
  filteredRows.forEach(r => {
    const pid = r.prnId || "Unassigned";
    const qty = Math.max(0, Number(r.stillToOrderQty) || 0);
    if (qty <= 0) return;
    if (!byPrn[pid]) byPrn[pid] = 0;
    byPrn[pid] += qty;
    reqDatesByPrn[pid] = r.requirementDates || [];
  });

  const prnIds = Object.keys(byPrn).sort();
  const unitLabel = (unit || "NOS").toUpperCase();
  const fmtQtyN = (n) => (Math.round((Number(n) || 0) * 100) / 100).toString();

  const rowsHtml = prnIds.length === 0
    ? `<tr><td colspan="3" style="padding:14px; text-align:center; color:var(--muted); font-size:0.85rem;">No PRN-level breakdown available.</td></tr>`
    : prnIds.map(pid => {
        const reqDates = reqDatesByPrn[pid] || [];
        const reqDateCell = reqDates.length === 0
          ? `<span style="color:var(--muted); font-size:0.8rem;">—</span>`
          : reqDates.map(d => `<div style="font-size:0.92rem;">${fmtQtyN(d.qty)} on ${formatDateDMY(d.date)}</div>`).join("");
        return `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 6px; font-size:0.85rem; font-weight:600; color:#334155;">${pid}</td>
          <td style="padding:8px 6px; text-align:center; font-family:monospace; font-size:1.1rem; font-weight:800; color:#b91c1c;">${fmtQtyN(byPrn[pid])} <span style="font-size:0.7rem; font-weight:700; color:var(--muted);">${unitLabel}</span></td>
          <td style="padding:8px 6px; text-align:center;">${reqDateCell}</td>
        </tr>`;
      }).join("");

  // Combined-quantity-by-date number line (31 Aug 2026) — aggregates every
  // PRN's own requirement dates into one timeline showing the TOTAL of
  // this material needed on each date across every PRN (e.g. 5 on the 10th
  // for one PRN + 15 on the 10th for another = 20 shown at the 10th),
  // positioned proportionally to real elapsed time between dates, not
  // evenly spaced by index — a gap of 20 days should look wider than a
  // gap of 2. Sits between the header and the table, only rendered when
  // there's at least one dated point to show.
  const qtyByDate = {};
  prnIds.forEach(pid => {
    (reqDatesByPrn[pid] || []).forEach(d => {
      if (!d.date) return;
      qtyByDate[d.date] = (qtyByDate[d.date] || 0) + (Number(d.qty) || 0);
    });
  });
  const sortedDates = Object.keys(qtyByDate).sort();
  let timelineHtml = "";
  if (sortedDates.length > 0) {
    const INSET = 8; // % from each edge — "slightly inside", not flush to the ends
    const parseD = (s) => new Date(s + "T00:00:00Z").getTime();
    const minT = parseD(sortedDates[0]);
    const maxT = parseD(sortedDates[sortedDates.length - 1]);
    const span = maxT - minT;
    const points = sortedDates.map(dateStr => {
      const pct = span === 0 ? 50 : INSET + ((parseD(dateStr) - minT) / span) * (100 - 2 * INSET);
      return { dateStr, pct, qty: qtyByDate[dateStr] };
    });
    const markersHtml = points.map(p => `
      <div style="position:absolute; left:${p.pct}%; top:0; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; white-space:nowrap;">
        <div style="font-size:0.85rem; font-weight:800; color:#b91c1c; margin-bottom:4px;">${fmtQtyN(p.qty)} <span style="font-size:0.65rem; font-weight:700; color:var(--muted);">${unitLabel}</span></div>
        <div style="width:9px; height:9px; border-radius:50%; background:var(--brand); border:2px solid #fff; box-shadow:0 0 0 1px var(--brand);"></div>
        <div style="font-size:0.72rem; font-weight:600; color:#334155; margin-top:4px;">${formatDateDMY(p.dateStr)}</div>
      </div>`).join("");
    timelineHtml = `
      <div style="position:relative; height:62px; margin:6px 4px 22px;">
        <div style="position:absolute; left:0; right:0; top:29px; height:2px; background:var(--border);"></div>
        ${markersHtml}
      </div>`;
  }

  const existing = document.getElementById("material-project-breakdown-modal-overlay");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "material-project-breakdown-modal-overlay";
  modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;";
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:#fff;border-radius:var(--radius);padding:24px;max-width:1080px;width:94%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;border-bottom:2px solid var(--border);padding-bottom:12px;">
        <div>
          <div style="font-size:1rem;font-weight:800;color:var(--brand);">${materialName}</div>
          <div style="font-size:0.78rem;color:var(--muted);margin-top:3px;">Item Code: <strong>${itemCode}</strong></div>
        </div>
        <button onclick="document.getElementById('material-project-breakdown-modal-overlay').remove()" style="background:transparent;border:none;font-size:1.3rem;line-height:1;color:var(--muted);cursor:pointer;padding:0 0 0 10px;">&times;</button>
      </div>
      ${timelineHtml}
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
        <colgroup><col style="width:auto;"><col style="width:140px;"><col style="width:200px;"></colgroup>
        <thead>
          <tr style="text-align:left; border-bottom:2px solid var(--border);">
            <th style="padding:6px; font-size:0.72rem; text-transform:uppercase; color:var(--muted); letter-spacing:0.5px;">PRN ID</th>
            <th style="padding:6px; text-align:center; font-size:0.72rem; text-transform:uppercase; color:var(--muted); letter-spacing:0.5px;">PRN Quantity</th>
            <th style="padding:6px; text-align:center; font-size:0.72rem; text-transform:uppercase; color:var(--muted); letter-spacing:0.5px;">Production Requirement Date</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);">
            <td style="padding:8px 6px; font-size:0.82rem; font-weight:800; color:#334155;">Total</td>
            <td style="padding:8px 6px; text-align:center; font-family:monospace; font-size:1.15rem; font-weight:800; color:var(--brand);">${(Math.round((totalQty || 0) * 100) / 100).toString()} <span style="font-size:0.7rem; font-weight:700; color:var(--muted);">${unitLabel}</span></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  document.body.appendChild(modal);
}

