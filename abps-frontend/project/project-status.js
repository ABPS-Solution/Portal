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
  resultsZone.style.display = "block";
  document.getElementById("pstat-design-zone").innerHTML = `<div style="padding:14px; color:var(--muted);">Loading...</div>`;
  document.getElementById("pstat-purchase-zone").innerHTML = `<div style="padding:14px; color:var(--muted);">Loading...</div>`;
  document.getElementById("pstat-production-zone").innerHTML = `<div style="padding:14px; color:var(--muted);">Loading...</div>`;

  try {
    const [designData, purchaseData, productionData] = await Promise.all([
      apFetch({ action: "fetchProjectDesignStatus", projectId }),
      apFetch({ action: "fetchProjectPurchaseStatus", projectId }),
      apFetch({ action: "fetchProjectProductionStatus", projectId }),
    ]);
    renderPstatDesign(designData);
    renderPstatPurchase(purchaseData);
    renderPstatProduction(productionData);
  } catch (e) {
    document.getElementById("pstat-design-zone").innerHTML = `<div style="color:var(--warn); padding:12px;">Network error: ${e.message}</div>`;
  }
}

function renderPstatDesign(data) {
  const zone = document.getElementById("pstat-design-zone");
  if (!data.success) { zone.innerHTML = `<div style="color:var(--warn); padding:12px;">${data.error}</div>`; return; }
  if (!data.boqs || data.boqs.length === 0) { zone.innerHTML = `<div style="padding:14px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:4px;">No BOQs found for this project.</div>`; return; }
  zone.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
      <thead><tr style="background:var(--highlight-bg); text-align:left;">
        <th style="padding:8px;">BOQ ID</th><th style="padding:8px;">Department</th>
        <th style="padding:8px; text-align:center;">Order Qty</th><th style="padding:8px;">Status</th>
        <th style="padding:8px; text-align:center;">Version</th><th style="padding:8px;">Created</th><th style="padding:8px;">Updated</th>
      </tr></thead>
      <tbody>
        ${data.boqs.map(b => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px; font-family:monospace;">${b.pdfUrl ? `<a href="${driveLink(b.pdfUrl)}" target="_blank" style="color:var(--brand); font-weight:700;">${b.boqId}</a>` : b.boqId}</td>
            <td style="padding:8px;">${b.department || "—"}</td>
            <td style="padding:8px; text-align:center; font-family:monospace;">${fmtQty(b.orderQuantity)}</td>
            <td style="padding:8px;">${b.status || "—"}</td>
            <td style="padding:8px; text-align:center;">${b.version || "—"}</td>
            <td style="padding:8px; font-size:0.8rem;">${fmtPstatDateTime(b.createdAt)}</td>
            <td style="padding:8px; font-size:0.8rem;">${fmtPstatDateTime(b.updatedAt)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function renderPstatProduction(data) {
  const zone = document.getElementById("pstat-production-zone");
  if (!data.success) { zone.innerHTML = `<div style="color:var(--warn); padding:12px;">${data.error}</div>`; return; }
  if (!data.jobCards || data.jobCards.length === 0) { zone.innerHTML = `<div style="padding:14px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:4px;">No Job Cards found for this project.</div>`; return; }

  const byBoq = {};
  data.jobCards.forEach(jc => { (byBoq[jc.boqId] = byBoq[jc.boqId] || []).push(jc); });

  zone.innerHTML = Object.entries(byBoq).map(([boqId, jcs]) => {
    const pills = jcs.map(jc => {
      let label;
      if (jc.isCompleted) {
        label = `<span style="font-weight:800;">Completed</span>`;
      } else {
        const allotted = Number(jc.weightedAllotted) || 0;
        const used = Number(jc.weightedUsed) || 0;
        const pct = allotted > 1e-9 ? Math.min(100, (used / allotted) * 100) : 0;
        label = `${pct.toFixed(1)}%`;
      }
      const bg = jc.isCompleted ? "#dcfce7" : "#eff6ff";
      const color = jc.isCompleted ? "#15803d" : "#2563eb";
      return `<div style="background:${bg}; color:${color}; border-radius:4px; padding:8px 10px; font-size:0.8rem; font-weight:700; text-align:center;">
                Set ${jc.setNumber}<br>${label}
              </div>`;
    }).join("");
    return `
      <div style="margin-bottom:16px;">
        <div style="font-family:monospace; font-weight:700; color:var(--brand); margin-bottom:6px; font-size:0.85rem;">${boqId}</div>
        <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:8px;">${pills}</div>
      </div>`;
  }).join("");
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

