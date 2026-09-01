// ═══════════════════════════════════════════════════════
// PURCHASE DASHBOARD ENGINE
// ═══════════════════════════════════════════════════════
let pdCurrentPeriod = "today";
let pdCurrentCustomType = "customday";
let pdChartPoTrend = null, pdChartDelivery = null, pdChartVendorDelay = null;

function pdReturnToMain() {
  const c = document.getElementById("canvas-module-purchase-dashboard");
  if (c) c.style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function pdSetPeriod(btn) {
  document.querySelectorAll("#pd-period-btns .dd-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  pdCurrentPeriod = btn.dataset.period;
  const cz = document.getElementById("pd-custom-zone");
  if (pdCurrentPeriod === "custom") { cz.style.display = "flex"; requestAnimationFrame(syncDashboardCanvasTopPadding); return; }
  cz.style.display = "none";
  requestAnimationFrame(syncDashboardCanvasTopPadding);
  pdLoadDashboard();
}

function pdCustomTypeChange() {
  pdCurrentCustomType = document.getElementById("pd-custom-type").value;
  const v = document.getElementById("pd-custom-val");
  if (pdCurrentCustomType === "custommonth") v.type = "month";
  else if (pdCurrentCustomType === "customquarter") { v.type = "text"; v.placeholder = "e.g. 2025-Q2"; }
  else if (pdCurrentCustomType === "customyear") { v.type = "number"; v.placeholder = "e.g. 2025"; }
  else v.type = "date";
}

function pdLoadCustom() {
  const val = document.getElementById("pd-custom-val").value.trim();
  if (!val) return alert("Please enter a value for the custom period.");
  pdCurrentPeriod = pdCurrentCustomType;
  pdLoadDashboard(val);
}

// ptlTodayOverride — same admin-only, client-side-only "today" override
// Project Timeline itself uses (project-timeline.js), read here too so
// this dashboard's Due/Overdue panels agree with a test scenario an
// admin has set up on the Timeline screen. See ddLoadDashboard's own
// identical comment (design-dashboard.js) for the full rationale.
async function pdLoadDashboard(customVal) {
  ["pd-s-noassign","pd-s-partassign","pd-s-unsched","pd-s-partsched","pd-s-grns",
   "pd-s-pendingpo","pd-s-pendingporev","pd-s-pos","pd-s-matcov","pd-s-ontime"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });
  try {
    const data = await apFetch({
      action:      "fetchPurchaseDashboardData",
      periodType:  pdCurrentPeriod,
      periodValue: customVal || "",
      todayOverride: localStorage.getItem("ptlTodayOverride") || "",
    });
    if (!data.success) { alert("Dashboard load failed: " + data.error); return; }
    pdRenderDashboard(data);
  } catch(e) {
    alert("Dashboard error: " + e.message);
  }
}

function pdFormatPct(n) {
  return n === null || n === undefined ? "—" : n + "%";
}

function pdRenderDashboard(data) {
  const { stats, poTrend, deliveryTimeline, vendorDelay, overdueList, dueToday, overdue } = data;
  const fmtNum = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits:0 });

  // Row 1
  document.getElementById("pd-s-noassign").textContent   = stats.noMaterialsAssigned;
  document.getElementById("pd-s-partassign").textContent = stats.partialMaterialsAssigned;
  document.getElementById("pd-s-unsched").textContent    = stats.unscheduledPRNs;
  document.getElementById("pd-s-partsched").textContent  = stats.partiallyScheduledPRNs;
  document.getElementById("pd-s-grns").textContent       = stats.unactionedGRNs;

  // Row 2
  document.getElementById("pd-s-pendingpo").textContent    = stats.pendingPOAuthorizations;
  document.getElementById("pd-s-pendingporev").textContent = stats.pendingPORevisionAuthorizations;
  document.getElementById("pd-s-pos").textContent          = stats.totalPOs;
  document.getElementById("pd-s-matcov").textContent       = stats.materialsCovered;
  document.getElementById("pd-s-matcov-total").textContent = "/ " + stats.materialsTotal + " needing purchase";
  document.getElementById("pd-s-ontime").textContent       = pdFormatPct(stats.onTimeDeliveryRate);

  // Chart 1 — RM POs Created Over Time. A single-day period (Today,
  // Yesterday, or a 1-day custom range) buckets to exactly one point —
  // a line chart with one point renders as an invisible dot, so that
  // case renders as a single bar instead. Anything with 2+ points
  // (This Week, a multi-day custom range, etc.) stays a connected line.
  if (pdChartPoTrend) pdChartPoTrend.destroy();
  const ctx1 = document.getElementById("pd-chart-po-trend").getContext("2d");
  if (poTrend.length === 0) {
    pdChartPoTrend = new Chart(ctx1, { type:"line", data:{ labels:["No data"], datasets:[{ data:[0], borderColor:"#f1f5f9" }] }, options:{ plugins:{ legend:{ display:false } } } });
  } else if (poTrend.length === 1) {
    pdChartPoTrend = new Chart(ctx1, {
      type: "bar",
      data: {
        labels: poTrend.map(t => t.label),
        datasets: [{ label: "RM POs Created", data: poTrend.map(t => t.count), backgroundColor: "rgba(37,99,235,0.75)", borderRadius: 4, barThickness: 40 }]
      },
      options: {
        responsive: true, plugins: { legend: { display:false } },
        scales: { x: { grid: { display:false }, ticks: { font: { size:9 } } },
                  y: { ticks: { stepSize:1 }, grid: { color:"#f1f5f9" } } }
      }
    });
  } else {
    pdChartPoTrend = new Chart(ctx1, {
      type: "line",
      data: {
        labels: poTrend.map(t => t.label),
        datasets: [{
          label: "RM POs Created", data: poTrend.map(t => t.count),
          borderColor: "rgba(37,99,235,0.9)", backgroundColor: "rgba(37,99,235,0.12)",
          tension: 0.25, fill: true, pointRadius: 3, pointBackgroundColor: "rgba(37,99,235,0.9)",
        }]
      },
      options: {
        responsive: true, plugins: { legend: { display:false } },
        scales: { x: { grid: { display:false }, ticks: { font: { size:9 } } },
                  y: { ticks: { stepSize:1 }, grid: { color:"#f1f5f9" } } }
      }
    });
  }

  // Chart 2 — Purchase Order Delivery Timeline
  if (pdChartDelivery) pdChartDelivery.destroy();
  const ctx2 = document.getElementById("pd-chart-delivery").getContext("2d");
  const dl = deliveryTimeline;
  pdChartDelivery = new Chart(ctx2, {
    type: "bar",
    data: {
      labels: ["Overdue", "Due This Week", "Due This Month", "Due Later"],
      datasets: [{
        data: [dl.overdue, dl.thisWeek, dl.thisMonth, dl.later],
        backgroundColor: [
          "rgba(239,68,68,0.75)",
          "rgba(245,158,11,0.75)",
          "rgba(37,99,235,0.7)",
          "rgba(16,185,129,0.7)"
        ],
        borderRadius: 4,
        barThickness: 28
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { stepSize:1 }, grid: { color:"#f1f5f9" } },
        x: { grid: { display:false } }
      }
    }
  });

  // Chart 3 — Average Delivery Delay by Vendor (top 8)
  if (pdChartVendorDelay) pdChartVendorDelay.destroy();
  const ctx3 = document.getElementById("pd-chart-vendor-delay").getContext("2d");
  if (vendorDelay.length === 0) {
    pdChartVendorDelay = new Chart(ctx3, { type:"bar", data:{ labels:["No late deliveries"], datasets:[{ data:[0], backgroundColor:"#f1f5f9" }] }, options:{ plugins:{ legend:{ display:false } } } });
  } else {
    pdChartVendorDelay = new Chart(ctx3, {
      type: "bar",
      data: {
        labels: vendorDelay.map(v => v.vendor),
        datasets: [{ label:"Avg Days Late", data: vendorDelay.map(v => v.avgDaysLate), backgroundColor:"rgba(239,68,68,0.7)", borderRadius:3 }]
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { display:false } },
        scales: { x: { grid: { color:"#f1f5f9" } }, y: { grid: { display:false }, ticks: { font: { size:9 } } } }
      }
    });
  }

  // Row 4 — Due Today / Overdue (Purchase's Project Timeline trunk nodes)
  const dueTbody = document.getElementById("pd-duetoday-tbody");
  dueTbody.innerHTML = dueToday.length === 0
    ? `<tr><td colspan="2" style="color:var(--muted); padding:6px;">Nothing due today.</td></tr>`
    : dueToday.map(r => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:4px;"><span style="font-family:monospace; font-weight:700; font-size:0.72rem;">${r.projectId}</span><br/><span style="color:var(--muted); font-size:0.72rem;">${r.companyName}</span></td>
          <td style="padding:4px;">${r.label}</td>
        </tr>`).join("");

  const timelineOverdueTbody = document.getElementById("pd-timeline-overdue-tbody");
  timelineOverdueTbody.innerHTML = overdue.length === 0
    ? `<tr><td colspan="3" style="color:var(--muted); padding:6px;">Nothing overdue — nice work.</td></tr>`
    : overdue.map(r => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:4px;"><span style="font-family:monospace; font-weight:700; font-size:0.72rem;">${r.projectId}</span><br/><span style="color:var(--muted); font-size:0.72rem;">${r.companyName}</span></td>
          <td style="padding:4px;">${r.label}</td>
          <td style="padding:4px; text-align:right; color:#b91c1c; font-weight:700;">${r.daysOverdue}d</td>
        </tr>`).join("");

  // Overdue POs table
  const overdueTbody = document.getElementById("pd-overdue-tbody");
  document.getElementById("pd-overdue-count").textContent = overdueList.length;
  overdueTbody.innerHTML = overdueList.length === 0
    ? `<tr><td colspan="5" style="padding:8px; color:var(--muted); font-size:0.72rem;">✅ No overdue Purchase Orders</td></tr>`
    : overdueList.map((po, i) => {
        const rowBg = i%2===0?"var(--card)":"#f8fafc";
        const overdueBg = po.daysOverdue<=3?"#fef3c7":po.daysOverdue<=7?"#fee2e2":"#fecaca";
        const overdueColor = po.daysOverdue<=3?"#b45309":"#b91c1c";
        return `<tr style="border-bottom:1px solid #f1f5f9; background:${rowBg};">
          <td style="padding:4px 5px; font-family:monospace; font-size:0.68rem; font-weight:700;">${po.poId}</td>
          <td style="padding:4px 5px; font-size:0.7rem;">${po.vendor}</td>
          <td style="padding:4px 5px; text-align:center; font-size:0.68rem;">${formatDateDMY(po.deliveryDate)}</td>
          <td style="padding:4px 5px; text-align:center;"><span style="font-size:0.62rem; font-weight:700; padding:1px 6px; border-radius:8px; background:${overdueBg}; color:${overdueColor};">${po.daysOverdue}d</span></td>
          <td style="padding:4px 5px; text-align:right; font-family:monospace; font-size:0.7rem;">${fmtNum(po.grand)}</td>
        </tr>`;
      }).join("");
}

// ═══════════════════════════════════════════════════════
// SHARED PURCHASE FEEDBACK HELPER
// ═══════════════════════════════════════════════════════

