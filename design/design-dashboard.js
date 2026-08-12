function ddFilterHealth() {
  const q = (document.getElementById("dd-health-search")?.value || "").toLowerCase();
  ddHealthFiltered = q
    ? ddHealthData.filter(p => p.projId.toLowerCase().includes(q) || p.customer.toLowerCase().includes(q))
    : [...ddHealthData];
  ddHealthCurrentPage = 1;
  ddRenderHealthTable();
}

function ddHealthPage(dir) {
  const totalPages = Math.ceil(ddHealthFiltered.length / DD_HEALTH_PAGE_SIZE);
  ddHealthCurrentPage = Math.max(1, Math.min(totalPages, ddHealthCurrentPage + dir));
  ddRenderHealthTable();
}

function ddRenderHealthTable() {
  const fmt = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits:0 });
  const tbody = document.getElementById("dd-health-tbody");
  const total = ddHealthFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / DD_HEALTH_PAGE_SIZE));
  const start = (ddHealthCurrentPage - 1) * DD_HEALTH_PAGE_SIZE;
  const page  = ddHealthFiltered.slice(start, start + DD_HEALTH_PAGE_SIZE);

  const pageInfo = document.getElementById("dd-health-page-info");
  if (pageInfo) pageInfo.textContent = total > DD_HEALTH_PAGE_SIZE
    ? `${start+1}–${Math.min(start+DD_HEALTH_PAGE_SIZE, total)} of ${total}`
    : `${total} project${total !== 1 ? "s" : ""}`;

  // Toggle prev/next buttons
  const prevBtn = document.querySelector("[onclick=\"ddHealthPage(-1)\"]");
  const nextBtn = document.querySelector("[onclick=\"ddHealthPage(1)\"]");
  if (prevBtn) prevBtn.disabled = ddHealthCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = ddHealthCurrentPage >= totalPages;

  if (!tbody) return;
  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--muted); font-size:0.72rem; padding:6px;">No projects found</td></tr>`;
    return;
  }
  tbody.innerHTML = page.map((p, i) => {
    const prnBg    = p.prnRaised ? "#dcfce7" : "#fee2e2";
    const prnColor = p.prnRaised ? "#15803d" : "#b91c1c";
    const rowBg    = i % 2 === 0 ? "var(--card)" : "#f8fafc";
    return `<tr style="background:${rowBg}; border-bottom:1px solid #f1f5f9;">
      <td style="padding:10px 8px; font-weight:700; font-family:monospace; font-size:0.78rem;">${p.projId}</td>
      <td style="padding:10px 8px; font-size:0.78rem;">${p.customer}</td>
      <td style="padding:10px 8px; text-align:center; font-size:0.78rem;">${p.total}</td>
      <td style="padding:10px 8px; text-align:center; color:#15803d; font-weight:700; font-size:0.78rem;">${p.authorized}</td>
      <td style="padding:10px 8px; text-align:center; color:${p.pending > 0 ? "#b45309" : "var(--muted)"}; font-weight:${p.pending > 0 ? "700" : "400"}; font-size:0.78rem;">${p.pending}</td>
      <td style="padding:10px 8px; text-align:right; font-family:monospace; font-size:0.78rem;">${fmt(p.value)}</td>
      <td style="padding:10px 8px; text-align:center;"><span style="font-size:0.72rem; font-weight:700; padding:2px 10px; border-radius:8px; background:${prnBg}; color:${prnColor};">${p.prnRaised ? "Yes" : "No"}</span></td>
    </tr>`;
  }).join("");
}

function ddSetPeriod(btn) {
  document.querySelectorAll(".dd-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const p = btn.dataset.period;
  ddCurrentPeriod = p;
  const customZone = document.getElementById("dd-custom-zone");
  if (p === "custom") { customZone.style.display = "flex"; return; }
  customZone.style.display = "none";
  ddLoadDashboard();
}

function ddCustomTypeChange() {
  const type = document.getElementById("dd-custom-type").value;
  ddCurrentCustomType = type;
  const valInput = document.getElementById("dd-custom-val");
  if (type === "customday")     { valInput.type = "date";  valInput.placeholder = ""; }
  else if (type === "customweek")  { valInput.type = "date";  valInput.placeholder = "Pick any day in the week"; }
  else if (type === "custommonth") { valInput.type = "month"; }
  else if (type === "customquarter") { valInput.type = "text"; valInput.placeholder = "e.g. 2025-Q2"; }
  else if (type === "customyear")  { valInput.type = "number"; valInput.placeholder = "e.g. 2025"; }
}

function ddLoadCustom() {
  const val = document.getElementById("dd-custom-val").value.trim();
  if (!val) return alert("Please enter a value for the custom period.");
  ddCurrentPeriod = ddCurrentCustomType;
  ddLoadDashboard(val);
}

async function ddLoadDashboard(customVal) {
  const body = document.getElementById("dd-body");
  if (!body) return;
  // Show loading state on stat cards
  ["dd-s-created","dd-s-authorized","dd-s-pending","dd-s-authtime","dd-s-itemcodes"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });

  try {
    const data = await apFetch({
      action:      "fetchDesignDashboardData",
      periodType:  ddCurrentPeriod,
      periodValue: customVal || ""
    });
    if (!data.success) { alert("Dashboard load failed: " + data.error); return; }
    ddRenderDashboard(data);
  } catch(e) {
    alert("Dashboard error: " + e.message);
  }
}

function ddRenderDashboard(data) {
  const { stats, byDept, versionDist, trendData, pendingList, updatePendingList, projectHealth, showTrend } = data;
  const fmt = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits:0 });

  // Stat cards
  document.getElementById("dd-s-created").textContent    = stats.totalCreated;
  document.getElementById("dd-s-authorized").textContent = stats.totalAuthorized;
  document.getElementById("dd-s-pending").textContent    = stats.totalPending;
  // Smart auth time formatting
  if (stats.avgAuthTime !== null) {
    const mins = stats.avgAuthTime;
    if (mins < 60) {
      document.getElementById("dd-s-authtime").textContent      = mins;
      document.getElementById("dd-s-authtime-unit").textContent = "minutes";
    } else if (mins < 1440) {
      document.getElementById("dd-s-authtime").textContent      = (mins / 60).toFixed(1);
      document.getElementById("dd-s-authtime-unit").textContent = "hours";
    } else {
      document.getElementById("dd-s-authtime").textContent      = (mins / 1440).toFixed(1);
      document.getElementById("dd-s-authtime-unit").textContent = "days";
    }
  } else {
    document.getElementById("dd-s-authtime").textContent      = "—";
    document.getElementById("dd-s-authtime-unit").textContent = "";
  }
  document.getElementById("dd-s-itemcodes").textContent  = stats.newItemCodes;

  // By dept table
  const tbody = document.getElementById("dd-dept-tbody");
  tbody.innerHTML = "";
  const depts = Object.keys(byDept).sort();
  if (depts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--muted); font-size:0.72rem; padding:4px;">No data for period</td></tr>`;
  } else {
    depts.forEach(d => {
      tbody.innerHTML += `<tr style="border-top:1px solid #f1f5f9;">
        <td style="padding:2px 4px; font-weight:600;">${d}</td>
        <td style="padding:2px 4px; text-align:center;">${byDept[d].count}</td>
        <td style="padding:2px 4px; text-align:right;">${fmt(byDept[d].value)}</td>
      </tr>`;
    });
  }

  // Trend chart removed from layout
  if (ddChartTrend) { ddChartTrend.destroy(); ddChartTrend = null; }

  // Chart 2 — BOQs by dept
  if (ddChartDept) ddChartDept.destroy();
  const deptLabels = Object.keys(byDept);
  const ctx2 = document.getElementById("dd-chart-dept").getContext("2d");
  ddChartDept = new Chart(ctx2, {
    type: "bar",
    data: {
      labels: deptLabels,
      datasets: [{ label:"BOQs", data: deptLabels.map(d => byDept[d].count),
        backgroundColor: ["rgba(37,99,235,0.7)","rgba(16,185,129,0.7)","rgba(245,158,11,0.7)","rgba(239,68,68,0.7)","rgba(139,92,246,0.7)"],
        borderRadius: 4 }]
    },
    options: { indexAxis:"y", responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ color:"#f1f5f9" }, ticks:{ stepSize:1 } }, y:{ grid:{ display:false }, ticks:{ font:{ size:10 } } } } }
  });

  // Chart 3 — Version distribution
  if (ddChartVersion) ddChartVersion.destroy();
  const ctx3 = document.getElementById("dd-chart-version").getContext("2d");
  ddChartVersion = new Chart(ctx3, {
    type: "bar",
    data: {
      labels: ["v1","v2","v3+"],
      datasets: [{ label:"BOQs", data: [versionDist["v1"], versionDist["v2"], versionDist["v3+"]],
        backgroundColor: ["rgba(16,185,129,0.7)","rgba(245,158,11,0.7)","rgba(239,68,68,0.7)"],
        borderRadius: 4 }]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } },
      scales:{ y:{ ticks:{ stepSize:1 }, grid:{ color:"#f1f5f9" } }, x:{ grid:{ display:false } } } }
  });

  // Pending list removed from this dashboard

  // Project health — load into pagination engine
  ddHealthData     = projectHealth;
  ddHealthFiltered = [...projectHealth];
  ddHealthCurrentPage = 1;
  const searchEl = document.getElementById("dd-health-search");
  if (searchEl) searchEl.value = "";
  ddRenderHealthTable();
}

