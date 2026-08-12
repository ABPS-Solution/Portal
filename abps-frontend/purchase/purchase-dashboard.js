// ═══════════════════════════════════════════════════════
// PURCHASE DASHBOARD ENGINE
// ═══════════════════════════════════════════════════════
let pdCurrentPeriod = "today";
let pdCurrentCustomType = "customday";
let pdChartPrnTrend = null, pdChartCoverage = null, pdChartAge = null;

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
  if (pdCurrentPeriod === "custom") { cz.style.display = "flex"; return; }
  cz.style.display = "none";
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

async function pdLoadDashboard(customVal) {
  ["pd-s-prns","pd-s-active","pd-s-closed","pd-s-age","pd-s-pos","pd-s-poval","pd-s-matcov"].forEach(id => {  
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });
  try {
    const data = await apFetch({
      action:      "fetchPurchaseDashboardData",
      periodType:  pdCurrentPeriod,
      periodValue: customVal || ""
    });
    if (!data.success) { alert("Dashboard load failed: " + data.error); return; }
    pdRenderDashboard(data);
  } catch(e) {
    alert("Dashboard error: " + e.message);
  }
}

function pdRenderDashboard(data) {
  const { stats, prnTrend, ageBuckets, byType, deliveryTimeline, poValueTrend, projectCoverageList, noPoItems, overdueList, showTrend } = data;
  const fmtNum = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits:0 });

  // Stat cards
  document.getElementById("pd-s-prns").textContent   = stats.totalPRNs;
  document.getElementById("pd-s-active").textContent = stats.activePRNs;
  document.getElementById("pd-s-closed").textContent = stats.closedPRNs;
  document.getElementById("pd-s-age").textContent    = stats.avgPRNAgeDays !== null ? stats.avgPRNAgeDays : "—";
  document.getElementById("pd-s-pos").textContent    = stats.totalPOs;
  document.getElementById("pd-s-poval").textContent  = fmtNum(stats.totalPOValue);
  document.getElementById("pd-s-matcov").textContent       = stats.materialsCovered;
  document.getElementById("pd-s-matcov-total").textContent = "/ " + stats.materialsTotal + " total";
  const ppEl = document.getElementById("pd-s-prn-pending");
  const pcEl = document.getElementById("pd-s-prn-covered");
  if (ppEl) ppEl.textContent = stats.prnPendingAssignment ?? "—";
  if (pcEl) pcEl.textContent = stats.prnFullyCovered      ?? "—";

  // Chart 1 — PRN trend (stacked bar)
  if (pdChartPrnTrend) pdChartPrnTrend.destroy();
  const titleEl = document.getElementById("pd-chart2-title");
  if (titleEl) titleEl.textContent = showTrend ? "PRN Status Over Time" : "PRN Status";
  const ctx1 = document.getElementById("pd-chart-prn-trend").getContext("2d");
  if (prnTrend.length === 0) {
    pdChartPrnTrend = new Chart(ctx1, { type:"bar", data:{ labels:["No data"], datasets:[{ data:[0], backgroundColor:"#f1f5f9" }] }, options:{ plugins:{ legend:{ display:false } } } });
  } else {
    pdChartPrnTrend = new Chart(ctx1, {
      type:"bar",
      data:{
        labels: prnTrend.map(t=>t.label),
        datasets:[
          { label:"Active",  data:prnTrend.map(t=>t.active),  backgroundColor:"rgba(245,158,11,0.75)", borderRadius:3 },
          { label:"Closed",  data:prnTrend.map(t=>t.closed),  backgroundColor:"rgba(16,185,129,0.75)", borderRadius:3 }
        ]
      },
      options:{ responsive:true, plugins:{ legend:{ position:"bottom", labels:{ boxWidth:10, font:{ size:9 } } } },
        scales:{ x:{ stacked:true, grid:{ display:false } }, y:{ stacked:true, ticks:{ stepSize:1 }, grid:{ color:"#f1f5f9" } } } }
    });
  }

  // Chart 2 — Still To Order vs On Order by material type
  if (pdChartCoverage) pdChartCoverage.destroy();
  const types = Object.keys(byType).sort();
  const ctx2  = document.getElementById("pd-chart-coverage").getContext("2d");
  if (types.length === 0) {
    pdChartCoverage = new Chart(ctx2, { type:"bar", data:{ labels:["No data"], datasets:[{ data:[0], backgroundColor:"#f1f5f9" }] }, options:{ plugins:{ legend:{ display:false } } } });
  } else {
    pdChartCoverage = new Chart(ctx2, {
      type:"bar",
      data:{
        labels: types,
        datasets:[
          { label:"On Order",       data:types.map(t=>byType[t].onOrder),      backgroundColor:"rgba(37,99,235,0.75)",  borderRadius:3, barPercentage:0.4, categoryPercentage:0.8 },
          { label:"Still To Order", data:types.map(t=>byType[t].stillToOrder), backgroundColor:"rgba(239,68,68,0.7)",   borderRadius:3, barPercentage:0.4, categoryPercentage:0.8 }
        ]
      },
      options:{
        indexAxis:"y",
        responsive:true,
        grouped:true,
        plugins:{ legend:{ position:"bottom", labels:{ boxWidth:10, font:{ size:9 } } } },
        scales:{
          x:{ grid:{ color:"#f1f5f9" } },
          y:{ grid:{ display:false }, ticks:{ font:{ size:9 } } }
        }
      }
    });
  }

  // Chart 3 — PO Delivery Timeline (live)
  if (pdChartAge) pdChartAge.destroy();
  const ctx3 = document.getElementById("pd-chart-delivery").getContext("2d");
  const dl = deliveryTimeline;
  pdChartAge = new Chart(ctx3, {
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

  // No PO items table
  const noPoTbody = document.getElementById("pd-nopo-tbody");
  document.getElementById("pd-nopo-count").textContent = noPoItems.length;
  noPoTbody.innerHTML = noPoItems.length === 0
    ? `<tr><td colspan="5" style="padding:8px; color:var(--muted); font-size:0.72rem;">✅ All materials have POs</td></tr>`
    : noPoItems.map((item, i) => {
        const rowBg = i%2===0?"var(--card)":"#f8fafc";
        const ageBg = item.maxAge<=7?"#dcfce7":item.maxAge<=14?"#fef3c7":"#fee2e2";
        const ageColor = item.maxAge<=7?"#15803d":item.maxAge<=14?"#b45309":"#b91c1c";
        return `<tr style="border-bottom:1px solid #f1f5f9; background:${rowBg};">
          <td style="padding:4px 5px; font-weight:600;">${item.matName}</td>
          <td style="padding:4px 5px; font-family:monospace; font-size:0.68rem;">${item.itemCode}</td>
          <td style="padding:4px 5px; text-align:center; font-size:0.68rem;">${item.prnCount} PRN${item.prnCount>1?"s":""}</td>
          <td style="padding:4px 5px; text-align:right; font-weight:700;">${(() => { const v = Math.round((item.stillToOrder || 0) * 100) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2); })()}</td>
          <td style="padding:4px 5px; text-align:center;"><span style="font-size:0.62rem; font-weight:700; padding:1px 5px; border-radius:8px; background:${ageBg}; color:${ageColor};">${item.maxAge}d</span></td>
        </tr>`;
      }).join("");

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

