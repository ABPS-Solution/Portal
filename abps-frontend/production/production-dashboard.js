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
  pd2CurrentCustomType = dashCustomTypeChange("pd2");
}

function pd2LoadCustom() {
  const val = dashReadCustomVal("pd2");
  if (!val) return alert("Please enter a value for the custom period.");
  pd2CurrentPeriod = pd2CurrentCustomType;
  pd2LoadDashboard(val);
}

async function pd2LoadDashboard(customVal) {
  ["pd2-s-activejcn","pd2-s-finished","pd2-s-inprogress","pd2-s-mrd-awaiting","pd2-s-mrd-revision",
   "pd2-s-tickets","pd2-s-repair-qty","pd2-s-overdue-deliveries","pd2-s-boq-awaiting-plan","pd2-s-fg-pending"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });
  try {
    const data = await apFetch({
      action:      "fetchProductionDashboardData",
      periodType:  pd2CurrentPeriod,
      periodValue: customVal || "",
      todayOverride: localStorage.getItem("ptlTodayOverride") || "",
    });
    if (!data.success) { alert("Production Dashboard load failed: " + data.error); return; }
    pd2RenderDashboard(data);
  } catch(e) {
    alert("Production Dashboard error: " + e.message);
  }
}

function pd2RenderDashboard(data) {
  const { stats, byDept, dailyTrend, inProgressJCNs, stepSlipByFlow, dueToday, overdue } = data;

  // Sub-department scoping (explicit request, 6 Sep 2026) — a Reactor/
  // Capacitor/Panel person's session is scoped server-side (routes/
  // dashboards.js's resolveProductionSubDeptScope); this just reflects
  // that back in the title so it's never silently unclear why the
  // numbers only cover one department. Unscoped for everyone else.
  const titleEl = document.getElementById("dash-global-title");
  if (titleEl) titleEl.textContent = stats.subDept ? `Production Dashboard — ${stats.subDept}` : "Production Dashboard";

  // Row 1
  document.getElementById("pd2-s-activejcn").textContent   = stats.activeJCNs;
  document.getElementById("pd2-s-finished").textContent    = stats.finishedThisPeriod;
  document.getElementById("pd2-s-inprogress").textContent  = stats.inProgress;
  document.getElementById("pd2-s-mrd-awaiting").textContent= stats.prnsAwaitingMrd ?? "—";
  document.getElementById("pd2-s-mrd-revision").textContent= stats.prnsNeedingMrdRevision ?? "—";

  // Row 2
  document.getElementById("pd2-s-tickets").textContent          = stats.storeTickets;
  document.getElementById("pd2-s-repair-qty").textContent       = stats.materialsBeingRepaired ?? "—";
  document.getElementById("pd2-s-overdue-deliveries").textContent = stats.overdueExpectedDeliveries ?? "—";
  document.getElementById("pd2-s-boq-awaiting-plan").textContent= stats.boqsAwaitingProductionPlan ?? "—";
  document.getElementById("pd2-s-fg-pending").textContent       = stats.fgAwaitingQaApproval ?? "—";

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
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
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
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ y:{ ticks:{ stepSize:1 }, grid:{ color:"#f1f5f9" } }, x:{ grid:{ display:false }, ticks:{ font:{ size:9 } } } } }
  });

  // Chart 3 — Average Step Slip by Flow (horizontal bar). Positive days =
  // finished later than its own target date; negative = early. Replaces
  // Project Completion Progress (thin/redundant once Due Today/Overdue
  // below covers the same lateness question with real dates).
  if (pd2ChartCompletion) pd2ChartCompletion.destroy();
  const ctx3el = document.getElementById("pd2-chart-completion");
  if (ctx3el && stepSlipByFlow && stepSlipByFlow.length > 0) {
    const slipLabels = stepSlipByFlow.map(f => f.flowName);
    const slipData    = stepSlipByFlow.map(f => f.avgSlipDays);
    pd2ChartCompletion = new Chart(ctx3el.getContext("2d"), {
      type: "bar",
      data: {
        labels: slipLabels,
        datasets: [{ label: "Avg Slip (days)", data: slipData,
          backgroundColor: slipData.map(v => v > 0 ? "rgba(239,68,68,0.75)" : "rgba(16,185,129,0.75)"),
          borderRadius: 3 }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "#f1f5f9" } },
          y: { grid: { display: false }, ticks: { font: { size: 9 } } }
        }
      }
    });
  } else if (ctx3el) {
    // No data state
    const c = ctx3el.getContext("2d");
    c.fillStyle = "#94a3b8";
    c.font = "11px sans-serif";
    c.textAlign = "center";
    c.fillText("No completed steps with target dates yet", ctx3el.width / 2, ctx3el.height / 2);
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
  pd2RenderJCNTable();

  // Row 4 right two panels — Due Today / Overdue, Production's own
  // Project Timeline trunk item (Production Planning), across every
  // Active project (routes/dashboards.js's fetchProductionTimelineDueOverdue)
  // — same shape/convention as Design's and Purchase's own Due Today/
  // Overdue panels (dd-duetoday-tbody/dd-overdue-tbody,
  // pd-duetoday-tbody/pd-overdue-tbody).
  const dueTbody = document.getElementById("pd2-duetoday-tbody");
  if (dueTbody) {
    dueTbody.innerHTML = (dueToday || []).length === 0
      ? `<tr><td colspan="2" style="color:var(--muted); padding:6px;">Nothing due today.</td></tr>`
      : dueToday.map(r => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:4px;"><span style="font-family:monospace; font-weight:700; font-size:0.72rem;">${r.projectId}</span><br/><span style="color:var(--muted); font-size:0.72rem;">${r.companyName}</span></td>
            <td style="padding:4px;">${r.label}</td>
          </tr>`).join("");
  }

  const overdueTbody = document.getElementById("pd2-overdue-tbody");
  if (overdueTbody) {
    overdueTbody.innerHTML = (overdue || []).length === 0
      ? `<tr><td colspan="3" style="color:var(--muted); padding:6px;">Nothing overdue — nice work.</td></tr>`
      : overdue.map(r => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:4px;"><span style="font-family:monospace; font-weight:700; font-size:0.72rem;">${r.projectId}</span><br/><span style="color:var(--muted); font-size:0.72rem;">${r.companyName}</span></td>
            <td style="padding:4px;">${r.label}</td>
            <td style="padding:4px; text-align:right; color:#b91c1c; font-weight:700;">${r.daysOverdue}d</td>
          </tr>`).join("");
  }
}

function pd2FilterJCN() {
  const dept = document.getElementById("pd2-jcn-dept-filter")?.value || "";
  pd2JCNFiltered = pd2JCNData.filter(j => !dept || j.department === dept);
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
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--muted); font-size:0.72rem; padding:10px;">No in-progress job cards found.</td></tr>`;
    return;
  }
  tbody.innerHTML = page.map((j, i) => {
    const rowBg = i % 2 === 0 ? "var(--card)" : "#f8fafc";
    return `<tr style="background:${rowBg}; border-bottom:1px solid #f1f5f9;">
      <td style="padding:7px 6px; font-family:monospace; font-size:0.72rem; font-weight:700; color:var(--brand);">${j.jcn}</td>
      <td style="padding:7px 6px; font-size:0.72rem;">${j.department}</td>
      <td style="padding:7px 6px; text-align:center; font-size:0.72rem; font-weight:700; color:var(--brand);">${j.ticketCount}</td>
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

