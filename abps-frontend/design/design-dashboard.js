function ddSetPeriod(btn) {
  document.querySelectorAll(".dd-period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const p = btn.dataset.period;
  ddCurrentPeriod = p;
  const customZone = document.getElementById("dd-custom-zone");
  if (p === "custom") { customZone.style.display = "flex"; requestAnimationFrame(syncDashboardCanvasTopPadding); return; }
  customZone.style.display = "none";
  requestAnimationFrame(syncDashboardCanvasTopPadding);
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

// PTL_TODAY_OVERRIDE_KEY ("ptlTodayOverride") is Project Timeline's own
// admin-only, client-side-only "today" override (project-timeline.js) —
// this dashboard's Due Today/Overdue panels read the SAME key so an
// admin building a test scenario on the Timeline screen sees a
// consistent picture here too, without that override ever needing to
// exist as a real server-side setting. A non-admin's request is ignored
// server-side regardless of what's in their own localStorage.
async function ddLoadDashboard(customVal) {
  const body = document.getElementById("dd-body");
  if (!body) return;
  // Show loading state on stat cards
  ["dd-s-overdue","dd-s-pending","dd-s-pendingrevisions","dd-s-itemcodes","dd-s-drawingsuploaded",
   "dd-s-authorized","dd-s-revised","dd-s-drawingturnaround","dd-s-avgboqs","dd-s-authtime"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });

  try {
    const data = await apFetch({
      action:      "fetchDesignDashboardData",
      periodType:  ddCurrentPeriod,
      periodValue: customVal || "",
      todayOverride: localStorage.getItem("ptlTodayOverride") || "",
    });
    if (!data.success) { alert("Dashboard load failed: " + data.error); return; }
    ddRenderDashboard(data);
  } catch(e) {
    alert("Dashboard error: " + e.message);
  }
}

// Shared minutes -> "N minutes/hrs/days" formatter for the two
// turnaround-time tiles below — same smart-unit idea the old Average
// Authorization Time tile already had, just inlined into one string
// since this dashboard's tiles are single-line, no separate unit div.
function ddFormatMinutes(mins) {
  if (mins === null || mins === undefined) return "—";
  if (mins < 60) return Math.round(mins) + " min";
  if (mins < 1440) return (mins / 60).toFixed(1) + " hrs";
  return (mins / 1440).toFixed(1) + " days";
}

function ddRenderDashboard(data) {
  const { stats, byDept, versionDist, dueToday, overdue } = data;
  const fmt = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits:0 });

  // Row 1
  document.getElementById("dd-s-overdue").textContent          = stats.designWorkOverdue;
  document.getElementById("dd-s-pending").textContent           = stats.totalPending;
  document.getElementById("dd-s-pendingrevisions").textContent = stats.pendingBoqRevisions;
  document.getElementById("dd-s-itemcodes").textContent         = stats.newItemCodes;
  document.getElementById("dd-s-drawingsuploaded").textContent = stats.drawingsUploaded;

  // Row 2
  document.getElementById("dd-s-authorized").textContent = stats.totalAuthorized;
  document.getElementById("dd-s-revised").textContent    = stats.totalRevised;
  document.getElementById("dd-s-drawingturnaround").textContent =
    stats.avgDrawingTurnaroundDays !== null ? stats.avgDrawingTurnaroundDays + " days" : "—";
  document.getElementById("dd-s-avgboqs").textContent = stats.avgBoqsPerActiveProject !== null ? stats.avgBoqsPerActiveProject : "—";
  document.getElementById("dd-s-authtime").textContent = ddFormatMinutes(stats.avgAuthTime);

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

  // Due Today / Overdue — Design's 4 Project Timeline trunk items across
  // every Active project (routes/dashboards.js's fetchDesignTimelineDueOverdue),
  // already sorted server-side (priority order / days-overdue desc then priority).
  const dueTbody = document.getElementById("dd-duetoday-tbody");
  dueTbody.innerHTML = dueToday.length === 0
    ? `<tr><td colspan="2" style="color:var(--muted); padding:6px;">Nothing due today.</td></tr>`
    : dueToday.map(r => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:4px;"><span style="font-family:monospace; font-weight:700; font-size:0.72rem;">${r.projectId}</span><br/><span style="color:var(--muted); font-size:0.72rem;">${r.companyName}</span></td>
          <td style="padding:4px;">${r.label}</td>
        </tr>`).join("");

  const overdueTbody = document.getElementById("dd-overdue-tbody");
  overdueTbody.innerHTML = overdue.length === 0
    ? `<tr><td colspan="3" style="color:var(--muted); padding:6px;">Nothing overdue — nice work.</td></tr>`
    : overdue.map(r => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:4px;"><span style="font-family:monospace; font-weight:700; font-size:0.72rem;">${r.projectId}</span><br/><span style="color:var(--muted); font-size:0.72rem;">${r.companyName}</span></td>
          <td style="padding:4px;">${r.label}</td>
          <td style="padding:4px; text-align:right; color:#b91c1c; font-weight:700;">${r.daysOverdue}d</td>
        </tr>`).join("");
}
