// ═══════════════════════════════════════════════════════
// ACCOUNTS DASHBOARD ENGINE — same engine shape as
// purchase/purchase-dashboard.js, `ad` prefix. 3 tile rows (15 tiles) +
// 3 charts, no list-panel row (see CLAUDE.md's Accounts Dashboard plan
// for why the layout differs from the other 4 dashboards).
// ═══════════════════════════════════════════════════════
let adCurrentPeriod = "today";
let adCurrentCustomType = "customday";
let adChartTrend = null, adChartTourType = null, adChartDailyType = null;

function adReturnToMain() {
  const c = document.getElementById("canvas-module-accounts-dashboard");
  if (c) c.style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function adSetPeriod(btn) {
  document.querySelectorAll("#ad-period-btns .dd-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  adCurrentPeriod = btn.dataset.period;
  const cz = document.getElementById("ad-custom-zone");
  if (adCurrentPeriod === "custom") { cz.style.display = "flex"; requestAnimationFrame(syncDashboardCanvasTopPadding); return; }
  cz.style.display = "none";
  requestAnimationFrame(syncDashboardCanvasTopPadding);
  adLoadDashboard();
}

function adCustomTypeChange() {
  adCurrentCustomType = document.getElementById("ad-custom-type").value;
  const v = document.getElementById("ad-custom-val");
  if (adCurrentCustomType === "custommonth") v.type = "month";
  else if (adCurrentCustomType === "customquarter") { v.type = "text"; v.placeholder = "e.g. 2025-Q2"; }
  else if (adCurrentCustomType === "customyear") { v.type = "number"; v.placeholder = "e.g. 2025"; }
  else v.type = "date";
}

function adLoadCustom() {
  const val = document.getElementById("ad-custom-val").value.trim();
  if (!val) return alert("Please enter a value for the custom period.");
  adCurrentPeriod = adCurrentCustomType;
  adLoadDashboard(val);
}

async function adLoadDashboard(customVal) {
  ["ad-s-unchecked","ad-s-openadv","ad-s-unactioned","ad-s-cashbox","ad-s-outstanding",
   "ad-s-totalexp","ad-s-tourpaid","ad-s-dailyspent","ad-s-travelpaid","ad-s-advpaid",
   "ad-s-vouchers","ad-s-checktime","ad-s-variance","ad-s-overlimit","ad-s-topups"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });
  try {
    const data = await apFetch({
      action:      "fetchAccountsDashboardData",
      periodType:  adCurrentPeriod,
      periodValue: customVal || "",
    });
    if (!data.success) { alert("Dashboard load failed: " + data.error); return; }
    adRenderDashboard(data);
  } catch (e) {
    alert("Dashboard error: " + e.message);
  }
}

function adFmtINR(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Mirrors pdFormatPct's null->"—" shape, for the Avg Voucher Check Time
// tile — null means zero vouchers were checked in the period, not zero
// days.
function adFormatDays(n) {
  return n === null || n === undefined ? "—" : n + (n === 1 ? " day" : " days");
}

function adRenderDashboard(data) {
  const { stats, expenseTrend, tourSpendByType, dailySpendByType } = data;

  // Row 1 — live backlog
  document.getElementById("ad-s-unchecked").textContent = stats.uncheckedVouchers;
  document.getElementById("ad-s-unchecked-sub").textContent = stats.uncheckedVouchers === 0
    ? "queue clear" : `oldest ${stats.oldestUncheckedDays ?? 0}d waiting`;

  document.getElementById("ad-s-openadv").textContent = stats.openAdvances;
  document.getElementById("ad-s-openadv-sub").textContent = adFmtINR(stats.openAdvanceAmount) + " out";

  document.getElementById("ad-s-unactioned").textContent = stats.unactionedTravellers;
  document.getElementById("ad-s-unactioned-sub").textContent = adFmtINR(stats.unactionedTravelAmount) + " unreconciled"
    + ` (${stats.unactionedTicketCount} ticket${stats.unactionedTicketCount === 1 ? '' : 's'} · ${stats.unactionedHotelCount} hotel${stats.unactionedHotelCount === 1 ? '' : 's'})`;

  const cashBoxEl = document.getElementById("ad-s-cashbox");
  cashBoxEl.textContent = adFmtINR(stats.cashBoxCombined);
  cashBoxEl.style.color = stats.cashBoxInRange ? "var(--text)" : "#b91c1c";
  document.getElementById("ad-s-cashbox-sub").textContent = stats.cashBoxInRange
    ? `Cash ${adFmtINR(stats.cashBalance)} · UPI ${adFmtINR(stats.upiBalance)}`
    : `⚠ outside ₹3,000–₹10,000 target`;

  document.getElementById("ad-s-outstanding").textContent = adFmtINR(stats.outstandingAmount);
  document.getElementById("ad-s-outstanding-sub").textContent =
    `${stats.outstandingEmployees} employee${stats.outstandingEmployees === 1 ? '' : 's'}`
    + (stats.outstandingFromAdvances > 0 ? ` · incl. ${adFmtINR(stats.outstandingFromAdvances)} open advances` : '');

  // Row 2 — money out
  document.getElementById("ad-s-totalexp").textContent = adFmtINR(stats.totalExpense);
  document.getElementById("ad-s-tourpaid").textContent = adFmtINR(stats.tourPaid);
  document.getElementById("ad-s-dailyspent").textContent = adFmtINR(stats.cashSpent);
  document.getElementById("ad-s-dailyspent-sub").textContent = stats.onlineSpent > 0 ? `${adFmtINR(stats.onlineSpent)} online` : '';
  document.getElementById("ad-s-travelpaid").textContent = adFmtINR(stats.travelPaid);
  document.getElementById("ad-s-travelpaid-sub").textContent =
    `${stats.travelTicketCount} ticket${stats.travelTicketCount === 1 ? '' : 's'} · ${stats.travelHotelCount} hotel${stats.travelHotelCount === 1 ? '' : 's'}`;
  document.getElementById("ad-s-advpaid").textContent = adFmtINR(stats.advancesPaid);
  document.getElementById("ad-s-advpaid-sub").textContent = `${stats.advanceCount} advance${stats.advanceCount === 1 ? '' : 's'}`;

  // Row 3 — activity & control
  document.getElementById("ad-s-vouchers").textContent = stats.vouchersChecked;
  document.getElementById("ad-s-checktime").textContent = adFormatDays(stats.avgCheckDays);

  const varianceEl = document.getElementById("ad-s-variance");
  varianceEl.textContent = stats.claimVariancePct === null ? "—" : stats.claimVariancePct + "%";
  varianceEl.style.color = stats.claimVariancePct === null ? "var(--text)" : (stats.claimVariancePct < 0 ? "#b91c1c" : "#15803d");

  document.getElementById("ad-s-overlimit").textContent = adFmtINR(stats.overLimitAmount);
  document.getElementById("ad-s-overlimit-sub").textContent = `${stats.overLimitLines} line${stats.overLimitLines === 1 ? '' : 's'} flagged`;

  document.getElementById("ad-s-topups").textContent = adFmtINR(stats.topups);

  // Chart 1 — Expense Trend. Single-bucket period renders as a bar (a
  // 1-point line chart is an invisible dot), same convention as
  // Purchase's RM PO trend chart.
  if (adChartTrend) adChartTrend.destroy();
  const ctx1 = document.getElementById("ad-chart-trend").getContext("2d");
  if (expenseTrend.length === 0) {
    adChartTrend = new Chart(ctx1, { type: "line", data: { labels: ["No data"], datasets: [{ data: [0], borderColor: "#f1f5f9" }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
  } else if (expenseTrend.length === 1) {
    adChartTrend = new Chart(ctx1, {
      type: "bar",
      data: { labels: expenseTrend.map(t => t.label), datasets: [{ label: "Expense", data: expenseTrend.map(t => t.amount), backgroundColor: "rgba(37,99,235,0.75)", borderRadius: 4, barThickness: 40 }] },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: "#f1f5f9" } } }
      }
    });
  } else {
    adChartTrend = new Chart(ctx1, {
      type: "line",
      data: {
        labels: expenseTrend.map(t => t.label),
        datasets: [{
          label: "Expense", data: expenseTrend.map(t => t.amount),
          borderColor: "rgba(37,99,235,0.9)", backgroundColor: "rgba(37,99,235,0.12)",
          tension: 0.25, fill: true, pointRadius: 3, pointBackgroundColor: "rgba(37,99,235,0.9)",
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: "#f1f5f9" } } }
      }
    });
  }

  // Chart (left) — Tour Expense by Type, top 5 (horizontal bar)
  if (adChartTourType) adChartTourType.destroy();
  const ctx2 = document.getElementById("ad-chart-tour-type").getContext("2d");
  if (tourSpendByType.length === 0) {
    adChartTourType = new Chart(ctx2, { type: "bar", data: { labels: ["No data"], datasets: [{ data: [0], backgroundColor: "#f1f5f9" }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
  } else {
    adChartTourType = new Chart(ctx2, {
      type: "bar",
      data: { labels: tourSpendByType.map(r => r.label), datasets: [{ label: "Amount", data: tourSpendByType.map(r => r.amount), backgroundColor: "rgba(124,58,237,0.7)", borderRadius: 3 }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: "#f1f5f9" } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } }
      }
    });
  }

  // Chart (right) — Daily Expense by Type, top 5 (horizontal bar)
  if (adChartDailyType) adChartDailyType.destroy();
  const ctx3 = document.getElementById("ad-chart-daily-type").getContext("2d");
  if (dailySpendByType.length === 0) {
    adChartDailyType = new Chart(ctx3, { type: "bar", data: { labels: ["No data"], datasets: [{ data: [0], backgroundColor: "#f1f5f9" }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
  } else {
    adChartDailyType = new Chart(ctx3, {
      type: "bar",
      data: { labels: dailySpendByType.map(r => r.label), datasets: [{ label: "Amount", data: dailySpendByType.map(r => r.amount), backgroundColor: "rgba(15,118,110,0.7)", borderRadius: 3 }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: "#f1f5f9" } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } }
      }
    });
  }
}
