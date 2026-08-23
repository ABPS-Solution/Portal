// accounts/voucher-search.js — "Search Tour Expense Vouchers" toggle.
// Read-only: filters + two balance-bucket lists + a Checked-only total.

async function initializeVoucherSearchPanel() {
  const panel = document.getElementById("te-panel-search");
  panel.innerHTML = `
    <div id="tvs-balance-buckets" style="display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap;"></div>
    <div style="background:var(--highlight-bg); padding:14px; border-radius:var(--radius); margin-bottom:16px; display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
      <div><label class="field-label">Employee</label>
        <select id="tvs-f-employee" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:160px;"><option value="">All</option></select></div>
      <div><label class="field-label">Department</label>
        <select id="tvs-f-dept" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;"><option value="">All</option></select></div>
      <div><label class="field-label">Purpose of Visit</label>
        <select id="tvs-f-purpose" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;">
          <option value="">All</option>${TOUR_PURPOSES.map(p => `<option value="${p}">${p}</option>`).join("")}</select></div>
      <div><label class="field-label">Place of Visit</label>
        <input type="text" id="tvs-f-place" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;"></div>
      <div><label class="field-label">Type</label>
        <select id="tvs-f-type" style="padding:8px; border:1px solid var(--border); border-radius:6px; min-width:140px;">
          <option value="">All</option>${TOUR_EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}</select></div>
      <div><label class="field-label">Date From</label>
        <input type="date" id="tvs-f-from" style="padding:8px; border:1px solid var(--border); border-radius:6px;"></div>
      <div><label class="field-label">Date To</label>
        <input type="date" id="tvs-f-to" style="padding:8px; border:1px solid var(--border); border-radius:6px;"></div>
      <div><label class="field-label">Status</label>
        <select id="tvs-f-status" style="padding:8px; border:1px solid var(--border); border-radius:6px;">
          <option value="">All</option><option value="Unchecked">Unchecked</option><option value="Checked">Checked</option></select></div>
      <button class="nav-btn-styled" onclick="runTourVoucherSearch()">Search</button>
    </div>
    <div id="tvs-total" style="font-weight:700; margin-bottom:14px;"></div>
    <div id="tvs-results"></div>`;

  try {
    const [empData, deptData] = await Promise.all([acFetch("searchTourEmployees", {}), acFetch("listTourDepartments", {})]);
    if (empData.success) {
      document.getElementById("tvs-f-employee").innerHTML += empData.employees.map(e => `<option value="${e.employeeId}">${escapeHtml(e.employeeName)}</option>`).join("");
    }
    if (deptData.success) {
      document.getElementById("tvs-f-dept").innerHTML += deptData.departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
    }
  } catch (e) { console.error("Search filter bootstrap failed:", e.message); }

  enhanceAllDateInputsForDMY();
  runTourVoucherSearch();
}

async function runTourVoucherSearch() {
  const filters = {
    employeeId: document.getElementById("tvs-f-employee").value || null,
    departmentName: document.getElementById("tvs-f-dept").value || null,
    purposeOfVisit: document.getElementById("tvs-f-purpose").value || null,
    placeOfVisit: document.getElementById("tvs-f-place").value || null,
    expenseType: document.getElementById("tvs-f-type").value || null,
    dateFrom: document.getElementById("tvs-f-from").value || null,
    dateTo: document.getElementById("tvs-f-to").value || null,
    status: document.getElementById("tvs-f-status").value || null,
  };
  const resultsEl = document.getElementById("tvs-results");
  resultsEl.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Searching...</div>`;

  try {
    const data = await acFetch("searchTourVouchers", filters);
    if (!data.success) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }

    document.getElementById("tvs-balance-buckets").innerHTML = `
      ${tvsRenderBucket("Balance over ₹10,000", data.employeesOver10k, "#b91c1c")}
      ${tvsRenderBucket("Balance ₹10,000 or under", data.employeesUnder10k, "#15803d")}`;

    document.getElementById("tvs-total").textContent = `Total Voucher Amount (Checked, Actual): ${trimNum(data.totalCheckedActual)}`;

    if (data.vouchers.length === 0) {
      resultsEl.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No vouchers match this filter.</div>`;
      return;
    }
    resultsEl.innerHTML = data.vouchers.map(v => tvsRenderCard(v)).join("");
  } catch (e) { resultsEl.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

function tvsRenderBucket(title, employees, color) {
  const rows = employees.length
    ? employees.map(e => `<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:0.82rem;">
        <span>${escapeHtml(e.employeeName)}</span><span style="font-weight:700; color:${color};">${trimNum(e.balance)}</span></div>`).join("")
    : `<div style="color:var(--muted); font-size:0.8rem;">None.</div>`;
  return `<div style="flex:1; min-width:220px; background:var(--highlight-bg); padding:12px 14px; border-radius:var(--radius);">
    <div style="font-weight:700; margin-bottom:6px; font-size:0.85rem;">${title}</div>${rows}</div>`;
}

function tvsRenderCard(v) {
  const lines = v.lines || [];
  const rows = lines.map(l => {
    const billCell = l.billUrl ? `<a href="${driveLink(l.billUrl)}" target="_blank" rel="noopener">${escapeHtml(l.billFileName || 'View')}</a>` : "—";
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px;">${l.srNo}</td><td style="padding:6px;">${formatDateDMY(l.expenseDate)}</td>
      <td style="padding:6px;">${escapeHtml(l.expenseType)}${l.conveyanceMode ? ' (' + escapeHtml(l.conveyanceMode) + ')' : ''}</td>
      <td style="padding:6px; text-align:right;">${trimNum(l.amount)}</td>
      <td style="padding:6px; text-align:right;">${l.actualAmount !== null && l.actualAmount !== undefined ? trimNum(l.actualAmount) : '—'}</td>
      <td style="padding:6px;">${billCell}</td>
    </tr>`;
  }).join("");
  const statusColor = v.status === 'Checked' ? '#15803d' : '#b45309';
  return `
    <div class="contact-summary-card-parent">
      <div class="contact-summary-header-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='block'?'none':'block'" style="cursor:pointer; width:100%;">
        <div class="contact-summary-title-info" style="width:100%;">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <span style="background:var(--brand); color:#fff; padding:3px 8px; font-weight:700;">${escapeHtml(v.voucherNumber)}</span>
              <span style="margin-left:8px; font-weight:700;">${escapeHtml(v.employeeName)}</span>
            </div>
            <span style="background:${statusColor}; color:#fff; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:3px;">${v.status}</span>
          </div>
          <div style="font-size:0.85rem; color:var(--muted); margin-top:6px;">
            ${escapeHtml(v.departmentName || '—')} · ${escapeHtml(v.purposeOfVisit)} · ${escapeHtml(v.placeOfVisit)} ·
            ${formatDateDMY(v.visitStartDate)}–${formatDateDMY(v.visitEndDate)} ·
            Claimed ${trimNum(v.totalAmount)}${v.totalActualAmount !== null ? ' · Actual ' + trimNum(v.totalActualAmount) : ''}
          </div>
        </div>
      </div>
      <div style="display:none; padding-top:12px; border-top:1px dashed var(--border); margin-top:10px; overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
          <thead><tr style="background:var(--highlight-bg); text-align:left;">
            <th style="padding:6px;">Sr No</th><th style="padding:6px;">Date</th><th style="padding:6px;">Type</th>
            <th style="padding:6px; text-align:right;">Amount</th><th style="padding:6px; text-align:right;">Actual</th><th style="padding:6px;">Bill</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
