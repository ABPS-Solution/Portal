function pd2SetPeriod(btn) {
  document.querySelectorAll("#pd2-period-btns .dd-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  pd2CurrentPeriod = btn.dataset.period;
  const customZone = document.getElementById("pd2-custom-zone");
  if (pd2CurrentPeriod === "custom") { customZone.style.display = "flex"; requestAnimationFrame(syncDashboardCanvasTopPadding); return; }
  customZone.style.display = "none";
  requestAnimationFrame(syncDashboardCanvasTopPadding);
  pd2LoadDashboard();
}

function pd2CustomTypeChange() {
  const type = document.getElementById("pd2-custom-type").value;
  pd2CurrentCustomType = type;
  const valInput = document.getElementById("pd2-custom-val");
  if (type === "customday")        { valInput.type = "date";   valInput.placeholder = ""; }
  else if (type === "customweek")  { valInput.type = "date";   valInput.placeholder = "Pick any day in the week"; }
  else if (type === "custommonth") { valInput.type = "month"; }
  else if (type === "customquarter") { valInput.type = "text"; valInput.placeholder = "e.g. 2025-Q2"; }
  else if (type === "customyear")  { valInput.type = "number"; valInput.placeholder = "e.g. 2025"; }
}

function pd2LoadCustom() {
  const val = document.getElementById("pd2-custom-val").value.trim();
  if (!val) return alert("Please enter a value for the custom period.");
  pd2CurrentPeriod = pd2CurrentCustomType;
  pd2LoadDashboard(val);
}

async function pd2LoadDashboard(customVal) {
  ["pd2-s-activejcn","pd2-s-finished","pd2-s-inprogress","pd2-s-store-approvals","pd2-s-unique-proj",
   "pd2-s-tickets","pd2-s-boqutil","pd2-s-jc-increase"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });
  try {
    const data = await apFetch({
      action:      "fetchProductionDashboardData",
      periodType:  pd2CurrentPeriod,
      periodValue: customVal || ""
    });
    if (!data.success) { alert("Production Dashboard load failed: " + data.error); return; }
    pd2RenderDashboard(data);
  } catch(e) {
    alert("Production Dashboard error: " + e.message);
  }
}

function pd2RenderDashboard(data) {
  const { stats, byDept, dailyTrend, inProgressJCNs, recentFG, projectCompletion } = data;

  // Row 1
  document.getElementById("pd2-s-activejcn").textContent      = stats.activeJCNs;
  document.getElementById("pd2-s-finished").textContent       = stats.finishedThisPeriod;
  document.getElementById("pd2-s-inprogress").textContent     = stats.inProgress;
  document.getElementById("pd2-s-store-approvals").textContent= stats.pendingStoreApprovals ?? "—";
  document.getElementById("pd2-s-unique-proj").textContent    = stats.uniqueProjectsActive  ?? "—";

  // Row 2
  document.getElementById("pd2-s-tickets").textContent    = stats.storeTickets;
  document.getElementById("pd2-s-jc-increase").textContent= stats.jcIncreaseRequestsPending ?? "—";
  if (stats.boqUtilPct !== null) {
    document.getElementById("pd2-s-boqutil").textContent     = stats.boqUtilPct + "%";
    document.getElementById("pd2-s-boqutil-sub").textContent = "avg across active projects";
  } else {
    document.getElementById("pd2-s-boqutil").textContent     = "—";
    document.getElementById("pd2-s-boqutil-sub").textContent = "no active BOQ data";
  }

  // Chart 1 — FG by Department (bar)
  if (pd2ChartDept) pd2ChartDept.destroy();
  const deptLabels = Object.keys(byDept);
  const ctx1 = document.getElementById("pd2-chart-dept").getContext("2d");
  pd2ChartDept = new Chart(ctx1, {
    type: "bar",
    data: {
      labels: deptLabels,
      datasets: [{ label:"FG Items", data: deptLabels.map(d => byDept[d]),
        backgroundColor: ["rgba(37,99,235,0.7)","rgba(16,185,129,0.7)","rgba(245,158,11,0.7)","rgba(139,92,246,0.7)","rgba(239,68,68,0.7)"],
        borderRadius: 4 }]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } },
      scales:{ y:{ ticks:{ stepSize:1 }, grid:{ color:"#f1f5f9" } }, x:{ grid:{ display:false } } } }
  });

  // Chart 2 — Job Card Completion Trend (line)
  if (pd2ChartTrend) pd2ChartTrend.destroy();
  const ctx2 = document.getElementById("pd2-chart-trend").getContext("2d");
  pd2ChartTrend = new Chart(ctx2, {
    type: "line",
    data: {
      labels: dailyTrend.map(d => d.label),
      datasets: [{ label:"Completed", data: dailyTrend.map(d => d.count),
        borderColor: "rgba(16,185,129,0.85)", backgroundColor: "rgba(16,185,129,0.08)",
        pointRadius: 3, fill: true, tension: 0.3 }]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } },
      scales:{ y:{ ticks:{ stepSize:1 }, grid:{ color:"#f1f5f9" } }, x:{ grid:{ display:false }, ticks:{ font:{ size:9 } } } } }
  });

  // Chart 3 — Project Completion Progress (horizontal stacked bar)
  if (pd2ChartCompletion) pd2ChartCompletion.destroy();
  const ctx3el = document.getElementById("pd2-chart-completion");
  if (ctx3el && projectCompletion && projectCompletion.length > 0) {
    const compLabels   = projectCompletion.map(p => p.customerName.length > 18 ? p.customerName.substring(0, 16) + "…" : p.customerName);
    const finishedData = projectCompletion.map(p => p.finished);
    const inProgData   = projectCompletion.map(p => p.inProgress);
    pd2ChartCompletion = new Chart(ctx3el.getContext("2d"), {
      type: "bar",
      data: {
        labels: compLabels,
        datasets: [
          { label: "Finished",    data: finishedData, backgroundColor: "rgba(16,185,129,0.75)", borderRadius: 3 },
          { label: "In Progress", data: inProgData,   backgroundColor: "rgba(245,158,11,0.75)", borderRadius: 3 }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: {
          legend: { display: true, position: "bottom", labels: { font: { size: 9 }, boxWidth: 10, padding: 6 } }
        },
        scales: {
          x: { stacked: true, ticks: { stepSize: 1 }, grid: { color: "#f1f5f9" } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } }
        }
      }
    });
  } else if (ctx3el) {
    // No data state
    const c = ctx3el.getContext("2d");
    c.fillStyle = "#94a3b8";
    c.font = "11px sans-serif";
    c.textAlign = "center";
    c.fillText("No active projects with job cards", ctx3el.width / 2, ctx3el.height / 2);
  }

  // Row 4 left — In Progress JCN table
  // Populate department filter dropdown
  const deptFilter = document.getElementById("pd2-jcn-dept-filter");
  const existingDepts = new Set([...deptFilter.options].map(o => o.value).filter(Boolean));
  const newDepts = [...new Set(inProgressJCNs.map(j => j.department).filter(Boolean))];
  newDepts.forEach(d => {
    if (!existingDepts.has(d)) {
      const opt = document.createElement("option");
      opt.value = d; opt.textContent = d;
      deptFilter.appendChild(opt);
    }
  });

  pd2JCNData        = inProgressJCNs;
  pd2JCNFiltered    = [...inProgressJCNs];
  pd2JCNCurrentPage = 1;
  const searchEl = document.getElementById("pd2-jcn-search");
  if (searchEl) searchEl.value = "";
  pd2RenderJCNTable();

  // Row 4 right — Recent FG feed
  const feed = document.getElementById("pd2-fg-feed");
  if (feed) {
    if (recentFG.length === 0) {
      feed.innerHTML = `<div style="font-size:0.75rem; color:var(--muted); padding:8px;">No finished goods entries yet.</div>`;
    } else {
      feed.innerHTML = recentFG.map(fg => `
        <div style="padding:7px 10px; background:#fff; border:1px solid var(--border); border-radius:4px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:0.75rem; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${fg.productName} <span style="color:var(--muted); font-weight:400;">${fg.productRating}</span></div>
              <div style="font-size:0.67rem; color:var(--muted);">${fg.projectId} · ${fg.department} · ${fg.jobCardNumber}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex-shrink:0;">
              <span style="font-size:0.62rem; color:var(--muted);">${formatOrdinalDate(fg.date)}</span>
            </div>
          </div>
        </div>`).join("");
    }
  }
}

function pd2FilterJCN() {
  const q    = (document.getElementById("pd2-jcn-search")?.value || "").toLowerCase();
  const dept = document.getElementById("pd2-jcn-dept-filter")?.value || "";
  pd2JCNFiltered = pd2JCNData.filter(j => {
    const matchQ    = !q    || j.jcn.toLowerCase().includes(q) || j.projectId.toLowerCase().includes(q);
    const matchDept = !dept || j.department === dept;
    return matchQ && matchDept;
  });
  pd2JCNCurrentPage = 1;
  pd2RenderJCNTable();
}

function pd2JCNPage(dir) {
  const totalPages = Math.max(1, Math.ceil(pd2JCNFiltered.length / PD2_JCN_PAGE_SIZE));
  pd2JCNCurrentPage = Math.min(Math.max(1, pd2JCNCurrentPage + dir), totalPages);
  pd2RenderJCNTable();
}

function pd2RenderJCNTable() {
  const tbody = document.getElementById("pd2-jcn-tbody");
  const total = pd2JCNFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / PD2_JCN_PAGE_SIZE));
  const start = (pd2JCNCurrentPage - 1) * PD2_JCN_PAGE_SIZE;
  const page  = pd2JCNFiltered.slice(start, start + PD2_JCN_PAGE_SIZE);

  const pageInfo = document.getElementById("pd2-jcn-page-info");
  if (pageInfo) pageInfo.textContent = total > PD2_JCN_PAGE_SIZE
    ? `${start+1}–${Math.min(start+PD2_JCN_PAGE_SIZE, total)} of ${total}`
    : `${total} job card${total !== 1 ? "s" : ""}`;

  const prevBtn = document.querySelector("[onclick=\"pd2JCNPage(-1)\"]");
  const nextBtn = document.querySelector("[onclick=\"pd2JCNPage(1)\"]");
  if (prevBtn) prevBtn.disabled = pd2JCNCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = pd2JCNCurrentPage >= totalPages;

  if (!tbody) return;
  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted); font-size:0.72rem; padding:10px;">No in-progress job cards found.</td></tr>`;
    return;
  }
  tbody.innerHTML = page.map((j, i) => {
    const rowBg = i % 2 === 0 ? "var(--card)" : "#f8fafc";
    return `<tr style="background:${rowBg}; border-bottom:1px solid #f1f5f9;">
      <td style="padding:7px 6px; font-family:monospace; font-size:0.72rem; font-weight:700; color:var(--brand);">${j.jcn}</td>
      <td style="padding:7px 6px; font-size:0.72rem; font-weight:600;">${j.projectId}</td>
      <td style="padding:7px 6px; font-size:0.72rem;">${j.productName} <span style="color:var(--muted);">${j.productRating}</span></td>
      <td style="padding:7px 6px; font-size:0.72rem;">${j.department}</td>
      <td style="padding:7px 6px; text-align:center; font-size:0.72rem; font-weight:700; color:var(--brand);">${j.ticketCount}</td>
      <td style="padding:7px 6px; text-align:center; font-size:0.68rem; color:var(--muted);">${j.lastActivity}</td>
    </tr>`;
  }).join("");
}

function navigateToMarketingDashboard() {
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none");
  ddShowAllWorkspaceEnclosures();
  const c = document.getElementById("canvas-module-marketing-dashboard");
  if (c) c.style.display = "block";
  showDashboardGlobalToolbar("Marketing Dashboard", "md-period-btns", exitMarketingDashboardBackToMenu);
  mdLoadDashboard();
}

function exitPurchaseWorkspacePanelBackToMenu() {
  ["material-list-sync-btn", "purchase-top-bar-title", "module-purchase-workspace-enclosure-panel",
   "canvas-module-purchase-prn", "canvas-module-purchase-material-list", "canvas-module-purchase-upload-rm-po"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  enforceDynamicModuleRoleGateways(userPermissions);
  const dashEl = document.getElementById("dashboard-view");
  if (dashEl) dashEl.style.display = "flex";
  triggerCompanyDropdownArrayFetch();
}

// ═══════════════════════════════════════════════════════
// PURCHASE REQUEST NOTE (PRN)
// ═══════════════════════════════════════════════════════

let prnCurrentData = null;
let prnStoreQtyLocked = false;

let sweepBasket = []; // [{ itemCode, materialName, quantity, reason }]

