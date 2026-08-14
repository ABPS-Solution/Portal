function sdSetPeriod(btn) {
  document.querySelectorAll("#sd-period-btns .dd-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  sdCurrentPeriod = btn.dataset.period;
  const customZone = document.getElementById("sd-custom-zone");
  if (sdCurrentPeriod === "custom") { customZone.style.display = "flex"; return; }
  customZone.style.display = "none";
  sdLoadDashboard();
}

function sdCustomTypeChange() {
  const type = document.getElementById("sd-custom-type").value;
  sdCurrentCustomType = type;
  const valInput = document.getElementById("sd-custom-val");
  if (type === "customday")      { valInput.type = "date"; valInput.placeholder = ""; }
  else if (type === "customweek")  { valInput.type = "date"; valInput.placeholder = "Pick any day in the week"; }
  else if (type === "custommonth") { valInput.type = "month"; }
  else if (type === "customquarter") { valInput.type = "text"; valInput.placeholder = "e.g. 2025-Q2"; }
  else if (type === "customyear")  { valInput.type = "number"; valInput.placeholder = "e.g. 2025"; }
}

function sdLoadCustom() {
  const val = document.getElementById("sd-custom-val").value.trim();
  if (!val) return alert("Please enter a value for the custom period.");
  sdCurrentPeriod = sdCurrentCustomType;
  sdLoadDashboard(val);
}

async function sdLoadDashboard(customVal) {
  ["sd-s-tickets","sd-s-pending","sd-s-boqneedprn","sd-s-grns","sd-s-spare",
   "sd-s-boqinc","sd-s-overruns"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });
  try {
    const data = await apFetch({
      action:      "fetchStoreDashboardData",
      periodType:  sdCurrentPeriod,
      periodValue: customVal || ""
    });
    if (!data.success) { alert("Store Dashboard load failed: " + data.error); return; }
    sdRenderDashboard(data);
  } catch(e) {
    alert("Store Dashboard error: " + e.message);
  }
}

function sdRenderDashboard(data) {
  const { stats, byDept, dailyTrend, grnByType, projectHealth, recentTickets } = data;

  // Row 1 stat cards
  document.getElementById("sd-s-tickets").textContent   = stats.totalTickets;
  document.getElementById("sd-s-pending").textContent   = stats.pendingApprovals;
  document.getElementById("sd-s-grns").textContent      = stats.totalGRNs;
  document.getElementById("sd-s-spare").textContent     = stats.spareStoreItems;
  document.getElementById("sd-s-boqneedprn").textContent = stats.boqsNeedingPRN ?? "—";

  // Row 2 stat cards
  document.getElementById("sd-s-boqinc").textContent          = stats.pendingBOQIncrease;
  document.getElementById("sd-s-overruns").textContent        = stats.boqOverruns;

  // Chart 1 — Tickets by Department (horizontal bar)
  if (sdChartDept) sdChartDept.destroy();
  const deptLabels = Object.keys(byDept);
  const ctx1 = document.getElementById("sd-chart-dept").getContext("2d");
  sdChartDept = new Chart(ctx1, {
    type: "bar",
    data: {
      labels: deptLabels,
      datasets: [{ label:"Tickets", data: deptLabels.map(d => byDept[d]),
        backgroundColor: ["rgba(37,99,235,0.7)","rgba(16,185,129,0.7)","rgba(245,158,11,0.7)","rgba(239,68,68,0.7)","rgba(139,92,246,0.7)","rgba(236,72,153,0.7)"],
        borderRadius: 4 }]
    },
    options: { indexAxis:"y", responsive:true, plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ color:"#f1f5f9" }, ticks:{ stepSize:1 } }, y:{ grid:{ display:false } } } }
  });

  // Chart 2 — Daily Ticket Volume (line)
  if (sdChartTrend) sdChartTrend.destroy();
  const ctx2 = document.getElementById("sd-chart-trend").getContext("2d");
  sdChartTrend = new Chart(ctx2, {
    type: "line",
    data: {
      labels: dailyTrend.map(d => d.label),
      datasets: [{ label:"Tickets", data: dailyTrend.map(d => d.count),
        borderColor: "rgba(37,99,235,0.8)", backgroundColor: "rgba(37,99,235,0.08)",
        pointRadius: 3, fill: true, tension: 0.3 }]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } },
      scales:{ y:{ ticks:{ stepSize:1 }, grid:{ color:"#f1f5f9" } }, x:{ grid:{ display:false }, ticks:{ font:{ size:9 } } } } }
  });

  // Chart 3 — GRN Volume by Material Type (bar)
  if (sdChartGrnType) sdChartGrnType.destroy();
  const grnLabels = Object.keys(grnByType);
  const ctx3 = document.getElementById("sd-chart-grn-type").getContext("2d");
  sdChartGrnType = new Chart(ctx3, {
    type: "bar",
    data: {
      labels: grnLabels,
      datasets: [{ label:"Qty", data: grnLabels.map(t => grnByType[t]),
        backgroundColor: ["rgba(16,185,129,0.7)","rgba(37,99,235,0.7)","rgba(245,158,11,0.7)","rgba(139,92,246,0.7)","rgba(239,68,68,0.7)"],
        borderRadius: 4 }]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } },
      scales:{ y:{ grid:{ color:"#f1f5f9" } }, x:{ grid:{ display:false } } } }
  });

  // Row 4 left — Project Health
  sdHealthData        = projectHealth;
  sdHealthFiltered    = [...projectHealth];
  sdHealthCurrentPage = 1;
  const searchEl = document.getElementById("sd-health-search");
  if (searchEl) searchEl.value = "";
  sdRenderHealthTable();

  // Row 4 right — Recent Ticket Activity
  const feed = document.getElementById("sd-recent-feed");
  if (feed) {
    if (recentTickets.length === 0) {
      feed.innerHTML = `<div style="font-size:0.75rem; color:var(--muted); padding:8px;">No recent ticket activity.</div>`;
    } else {
      const statusColors = {
        "Pending Approval":           { bg:"#fef9c3", color:"#854d0e" },
        "Increase Approved":          { bg:"#dcfce7", color:"#15803d" },
        "Rejected":                   { bg:"#fee2e2", color:"#b91c1c" },
        "Pending BOQ Increase Review":{ bg:"#ede9fe", color:"#6d28d9" },
        "Return Complete":            { bg:"#e0f2fe", color:"#0369a1" }
      };
      feed.innerHTML = recentTickets.map(t => {
        const sc = statusColors[t.status] || { bg:"#f1f5f9", color:"#475569" };
        return `<div style="display:flex; justify-content:space-between; align-items:flex-start; padding:6px 8px; background:#fff; border:1px solid var(--border); border-radius:4px; gap:8px;">
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.72rem; font-weight:700; font-family:monospace; color:var(--brand); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.ticketId}</div>
            <div style="font-size:0.68rem; color:var(--muted);">${t.projectId} · ${t.department} · ${t.requestedBy}</div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex-shrink:0;">
            <span style="font-size:0.65rem; font-weight:700; padding:1px 7px; border-radius:6px; background:${sc.bg}; color:${sc.color};">${t.status}</span>
            <span style="font-size:0.62rem; color:var(--muted);">${formatDateTimeDMY(t.dateCreated) || t.dateCreated}</span>
          </div>
        </div>`;
      }).join("");
    }
  }
}

function sdFilterHealth() {
  const q = (document.getElementById("sd-health-search")?.value || "").toLowerCase();
  sdHealthFiltered = q
    ? sdHealthData.filter(p => p.projId.toLowerCase().includes(q) || p.customer.toLowerCase().includes(q))
    : [...sdHealthData];
  sdHealthCurrentPage = 1;
  sdRenderHealthTable();
}

function sdHealthPage(dir) {
  const total = sdHealthFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / SD_HEALTH_PAGE_SIZE));
  sdHealthCurrentPage = Math.min(Math.max(1, sdHealthCurrentPage + dir), totalPages);
  sdRenderHealthTable();
}

function sdRenderHealthTable() {
  const tbody = document.getElementById("sd-health-tbody");
  const total = sdHealthFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / SD_HEALTH_PAGE_SIZE));
  const start = (sdHealthCurrentPage - 1) * SD_HEALTH_PAGE_SIZE;
  const page  = sdHealthFiltered.slice(start, start + SD_HEALTH_PAGE_SIZE);

  const pageInfo = document.getElementById("sd-health-page-info");
  if (pageInfo) pageInfo.textContent = total > SD_HEALTH_PAGE_SIZE
    ? `${start+1}–${Math.min(start+SD_HEALTH_PAGE_SIZE, total)} of ${total}`
    : `${total} project${total !== 1 ? "s" : ""}`;

  const prevBtn = document.querySelector("[onclick=\"sdHealthPage(-1)\"]");
  const nextBtn = document.querySelector("[onclick=\"sdHealthPage(1)\"]");
  if (prevBtn) prevBtn.disabled = sdHealthCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = sdHealthCurrentPage >= totalPages;

  if (!tbody) return;
  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted); font-size:0.72rem; padding:6px;">No projects found</td></tr>`;
    return;
  }
  tbody.innerHTML = page.map((p, i) => {
    const rowBg = i % 2 === 0 ? "var(--card)" : "#f8fafc";
    return `<tr style="background:${rowBg}; border-bottom:1px solid #f1f5f9;">
      <td style="padding:8px 6px; font-weight:700; font-family:monospace; font-size:0.75rem;">${p.projId}</td>
      <td style="padding:8px 6px; font-size:0.75rem;">${p.customer}</td>
      <td style="padding:8px 6px; text-align:center; font-size:0.75rem;">${p.totalTickets}</td>
      <td style="padding:8px 6px; text-align:center; color:#15803d; font-weight:700; font-size:0.75rem;">${p.approved}</td>
      <td style="padding:8px 6px; text-align:center; color:${p.pending > 0 ? "#b45309" : "var(--muted)"}; font-weight:${p.pending > 0 ? "700" : "400"}; font-size:0.75rem;">${p.pending}</td>
      <td style="padding:8px 6px; text-align:center; font-family:monospace; font-size:0.75rem;">${p.qtyConsumed}</td>
    </tr>`;
  }).join("");
}

function navigateToProductionDashboard() {
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("module-workspace-container").style.display = "none";
  document.querySelectorAll(".workspace-panel").forEach(p => p.style.display = "none");
  ddShowAllWorkspaceEnclosures();
  const c = document.getElementById("canvas-module-production-dashboard");
  if (c) c.style.display = "block";
  showDashboardGlobalToolbar("Production Dashboard", "pd2-period-btns", pd2ReturnToMain);
  if (typeof pd2LoadDashboard === "function") pd2LoadDashboard();
}

// ═══════════════════════════════════════════════════════
// PRODUCTION DASHBOARD ENGINE
// ═══════════════════════════════════════════════════════
let pd2CurrentPeriod     = "today";
let pd2CurrentCustomType = "customday";
let pd2JCNData = [], pd2JCNFiltered = [], pd2JCNCurrentPage = 1;
const PD2_JCN_PAGE_SIZE = 8;

