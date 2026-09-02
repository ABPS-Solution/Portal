// accounts/employee-details.js — "Employee Details" toggle, SHARED
// between Tour Expense Tracker (te-panel-employees) and Daily Cash/UPI
// Expenses (ce-panel-employees) as of 2 Sep 2026. Both host screens now
// render the exact same unified table (one employee list, one Add/Save/
// Delete path) rather than two separate screens that each only ever
// activated their own module's status — adding someone via one screen
// used to leave them invisible/unusable on the other, which is the bug
// this closes. Name/EMP ID/Department are compulsory on Add and Save.
//
// Tour Balance and Daily (Cash/UPI) Balance are two SEPARATE columns
// (migration 170) — Tour balances can legitimately linger for weeks
// (an advance not yet reconciled by a checked voucher), Daily balances
// are meant to settle same-day (an advance opened and closed the same
// day nets back to zero), so mixing them into one number was actively
// misleading. Each has its own independent Active/Inactive status pill,
// click to toggle — deactivating either side requires that side's own
// balance to be exactly 0 first (server-enforced).
//
// EMP_SCREEN_CONFIG below is the only thing that differs between the two
// host screens — which feedback/success helpers to call and what
// "back to this screen" hookup a success banner's button should reopen.

const EMP_SCREEN_CONFIG = {
  ed: { // Tour Expense Tracker's Employee Details
    panelId: "te-panel-employees",
    feedback: (msg, type) => showTourFeedback(msg, type),
    success: (msg, label, call) => showTourSuccess(msg, label, call),
    afterAdd: "switchTourExpenseToggle('employees'); edToggleAddForm('ed');",
    afterSave: "switchTourExpenseToggle('employees')",
    afterDelete: "switchTourExpenseToggle('employees')",
  },
  cee: { // Daily Cash/UPI Expenses' Employee Details
    panelId: "ce-panel-employees",
    feedback: (msg, type) => showCashExpenseFeedback(msg, type),
    success: (msg, label, call) => showCashExpenseSuccess(msg, label, call),
    afterAdd: "switchCashExpenseToggle('employees'); edToggleAddForm('cee');",
    afterSave: "switchCashExpenseToggle('employees')",
    afterDelete: "switchCashExpenseToggle('employees')",
  },
};

async function initializeEmployeeDetailsPanel() { await edInitEmployeeSection("ed"); }
async function initializeCashExpenseEmployeesPanel() { await edInitEmployeeSection("cee"); }

async function edInitEmployeeSection(ns) {
  const cfg = EMP_SCREEN_CONFIG[ns];
  const panel = document.getElementById(cfg.panelId);
  // Position-Based Daily Expense Limits is a Tour Expense-only concept
  // (position_type only matters for Tour voucher over-limit checks) —
  // that sub-panel stays exclusive to the "ed" (Tour) host screen.
  const limitsBlock = ns === "ed" ? `
    <div style="margin-bottom:28px; padding-bottom:20px; border-bottom:2px solid var(--border);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="margin:0;">Position-Based Daily Expense Limits</h3>
        <button class="nav-btn-styled" onclick="elToggleAddForm()">+ Add Limit</button>
      </div>
      <div id="el-add-form" style="display:none; background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
          <select id="el-new-type" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
            ${TOUR_EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
          <input type="number" id="el-new-manager-limit" placeholder="Manager Daily Limit (₹)" min="0" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
          <input type="number" id="el-new-staff-limit" placeholder="Staff Daily Limit (₹)" min="0" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
        </div>
        <button class="nav-btn-styled" onclick="submitAddExpenseLimit()">Submit</button>
        <button class="nav-btn-styled" onclick="document.getElementById('el-add-form').style.display='none';">Cancel</button>
      </div>
      <div id="el-table-wrap" style="overflow-x:auto;"></div>
    </div>` : "";

  panel.innerHTML = `
    ${limitsBlock}
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
      <div style="font-size:0.8rem; color:var(--muted);">One shared employee list across Tour Expense and Daily Cash/UPI/Online Expenses — Tour Balance and Daily Balance are tracked separately.</div>
      <button class="nav-btn-styled" onclick="edToggleAddForm('${ns}')">+ Add Employee</button>
    </div>
    <div id="${ns}-add-form" style="display:none; background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <input type="text" id="${ns}-new-name" placeholder="Employee Name *" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:160px;">
        <input type="text" id="${ns}-new-empcode" placeholder="EMP ID *" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:120px;">
        <input type="text" id="${ns}-new-dept" placeholder="Department *" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:140px;">
        <select id="${ns}-new-position" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:120px;">
          <option value="Staff">Staff</option><option value="Manager">Manager</option>
        </select>
        <input type="number" id="${ns}-new-balance" placeholder="Opening Tour Balance (₹)" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:160px;">
      </div>
      <button class="nav-btn-styled" onclick="edSubmitAddEmployee('${ns}')">Submit</button>
      <button class="nav-btn-styled" onclick="document.getElementById('${ns}-add-form').style.display='none';">Cancel</button>
    </div>
    <div id="${ns}-table-wrap" style="overflow-x:auto;"></div>`;

  if (ns === "ed") await loadExpenseLimitsTable();
  await edLoadEmployeeDetailsTable(ns);
}

function edToggleAddForm(ns) {
  const f = document.getElementById(`${ns}-add-form`);
  f.style.display = f.style.display === "none" ? "block" : "none";
}

function edStatusPill(label, status, onclickCall) {
  const active = status === 'Active';
  return `<span onclick="${onclickCall}" title="Click to ${active ? 'deactivate' : 'activate'}"
        style="cursor:pointer; display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700;
               background:${active ? '#dcfce7' : '#fee2e2'}; color:${active ? '#15803d' : '#b91c1c'};">${label}: ${status}</span>`;
}

async function edLoadEmployeeDetailsTable(ns) {
  const wrap = document.getElementById(`${ns}-table-wrap`);
  wrap.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading...</div>`;
  try {
    const data = await acFetch("listAllTourEmployees", {});
    if (!data.success) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
    const rows = data.employees.map(e => {
      const bothInactive = e.status === 'Inactive' && e.cashStatus === 'Inactive';
      return `
      <tr style="border-bottom:1px solid var(--border); opacity:${bothInactive ? '0.55' : '1'};" data-employee-id="${e.employeeId}">
        <td style="padding:7px;"><input type="text" class="${ns}-f-name" value="${escapeHtml(e.employeeName)}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px;"><input type="text" class="${ns}-f-empcode" value="${escapeHtml(e.empCode || '')}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px;"><input type="text" class="${ns}-f-dept" value="${escapeHtml(e.departmentName || '')}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px;"><select class="${ns}-f-position" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;">
          <option value="Staff" ${e.positionType !== 'Manager' ? 'selected' : ''}>Staff</option>
          <option value="Manager" ${e.positionType === 'Manager' ? 'selected' : ''}>Manager</option>
        </select></td>
        <td style="padding:7px; text-align:right; font-weight:700;">${formatINRComma(e.balance)}</td>
        <td style="padding:7px; text-align:center;">${edStatusPill('Tour', e.status, `edToggleModuleStatus(${e.employeeId}, 'tour', '${e.status}', '${ns}')`)}</td>
        <td style="padding:7px; text-align:right; font-weight:700;">${formatINRComma(e.cashBalance)}</td>
        <td style="padding:7px; text-align:center;">${edStatusPill('Daily', e.cashStatus, `edToggleModuleStatus(${e.employeeId}, 'cash', '${e.cashStatus}', '${ns}')`)}</td>
        <td style="padding:7px; white-space:nowrap;">
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem;" onclick="edSubmitUpdateEmployee(${e.employeeId}, '${ns}')">Save</button>
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem; background:#b91c1c; color:#fff;" onclick="edSubmitDeleteEmployee(${e.employeeId}, '${escapeHtml(e.employeeName).replace(/'/g, "\\'")}', '${ns}')">Delete</button>
        </td>
      </tr>`;
    }).join("");
    wrap.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead><tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:8px;">Name</th><th style="padding:8px;">EMP ID</th><th style="padding:8px;">Department</th><th style="padding:8px;">Position</th>
          <th style="padding:8px; text-align:right;">Tour Balance</th><th style="padding:8px; text-align:center;">Tour Status</th>
          <th style="padding:8px; text-align:right;">Daily Balance</th><th style="padding:8px; text-align:center;">Daily Status</th>
          <th style="padding:8px;">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

async function edToggleModuleStatus(employeeId, module, currentStatus, ns) {
  const cfg = EMP_SCREEN_CONFIG[ns];
  const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
  const action = module === 'tour' ? 'setTourEmployeeStatus' : 'setCashExpenseEmployeeStatus';
  showBlockingOverlay("Updating status...");
  try {
    const data = await acFetch(action, { employeeId, status: newStatus });
    hideBlockingOverlay();
    if (data.success) edLoadEmployeeDetailsTable(ns);
    else cfg.feedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); cfg.feedback("Network error: " + e.message, "error"); }
}

async function edSubmitAddEmployee(ns) {
  const cfg = EMP_SCREEN_CONFIG[ns];
  const employeeName = document.getElementById(`${ns}-new-name`).value.trim();
  const empCode = document.getElementById(`${ns}-new-empcode`).value.trim();
  const departmentName = document.getElementById(`${ns}-new-dept`).value.trim();
  const positionType = document.getElementById(`${ns}-new-position`).value;
  const openingBalance = document.getElementById(`${ns}-new-balance`).value;
  if (!employeeName) return cfg.feedback("Employee Name is required.", "error");
  if (!empCode) return cfg.feedback("EMP ID is required.", "error");
  if (!departmentName) return cfg.feedback("Department is required.", "error");

  showBlockingOverlay("Adding employee...");
  try {
    const data = await acFetch("addTourEmployee", { employeeName, empCode, departmentName, positionType, openingBalance });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById(`${ns}-add-form`).style.display = "none";
      [`${ns}-new-name`, `${ns}-new-empcode`, `${ns}-new-dept`, `${ns}-new-balance`].forEach(id => document.getElementById(id).value = "");
      document.getElementById(`${ns}-new-position`).value = "Staff";
      edLoadEmployeeDetailsTable(ns);
      cfg.success("Employee added — active in both Tour Expense and Daily Cash/UPI/Online Expenses.", "Add Another Employee", cfg.afterAdd);
    } else {
      cfg.feedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); cfg.feedback("Network error: " + e.message, "error"); }
}

async function edSubmitUpdateEmployee(employeeId, ns) {
  const cfg = EMP_SCREEN_CONFIG[ns];
  const row = document.querySelector(`#${ns}-table-wrap tr[data-employee-id="${employeeId}"]`);
  const employeeName = row.querySelector(`.${ns}-f-name`).value.trim();
  const empCode = row.querySelector(`.${ns}-f-empcode`).value.trim();
  const departmentName = row.querySelector(`.${ns}-f-dept`).value.trim();
  const positionType = row.querySelector(`.${ns}-f-position`).value;
  if (!employeeName) return cfg.feedback("Employee Name is required.", "error");
  if (!empCode) return cfg.feedback("EMP ID is required.", "error");
  if (!departmentName) return cfg.feedback("Department is required.", "error");

  showBlockingOverlay("Saving...");
  try {
    const data = await acFetch("updateTourEmployee", { employeeId, employeeName, empCode, departmentName, positionType });
    hideBlockingOverlay();
    if (data.success) { edLoadEmployeeDetailsTable(ns); cfg.success("Saved.", "Edit Another Employee", cfg.afterSave); }
    else cfg.feedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); cfg.feedback("Network error: " + e.message, "error"); }
}

async function edSubmitDeleteEmployee(employeeId, employeeName, ns) {
  const cfg = EMP_SCREEN_CONFIG[ns];
  if (!confirm(`Permanently delete "${employeeName}"? This cannot be undone. (Blocked unless both Tour Balance and Daily Balance are 0 and they have no advance/voucher/expense history.)`)) return;
  showBlockingOverlay("Deleting...");
  try {
    const data = await acFetch("deleteTourEmployee", { employeeId });
    hideBlockingOverlay();
    if (data.success) { edLoadEmployeeDetailsTable(ns); cfg.success(`"${employeeName}" deleted.`, "Back to Employee Details", cfg.afterDelete); }
    else cfg.feedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); cfg.feedback("Network error: " + e.message, "error"); }
}

// ── Position-Based Daily Expense Limits (migration 167) — Tour Expense
// only, unaffected by the shared-employee-list change above. ───────────
// One row per Expense Type, with Manager/Staff limits side by side —
// the backend still stores one row per (position, expense_type) pair
// (upsertTourExpenseLimit/deleteTourExpenseLimit), so a single Save or
// Delete here just fires that route once per position that actually has
// a value. expenseType is read-only once a row exists — there is no
// rename; add a new one via + Add Limit if a different type is needed.
let elLimitsData = []; // flat rows from listTourExpenseLimits, kept for elSubmitAddLimit's duplicate check

function elToggleAddForm() {
  const f = document.getElementById("el-add-form");
  f.style.display = f.style.display === "none" ? "block" : "none";
}

async function loadExpenseLimitsTable() {
  const wrap = document.getElementById("el-table-wrap");
  wrap.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading...</div>`;
  try {
    const data = await acFetch("listTourExpenseLimits", {});
    if (!data.success) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
    elLimitsData = data.limits;
    if (elLimitsData.length === 0) {
      wrap.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No expense limits configured.</div>`;
      return;
    }
    // Pivot the flat (position, expenseType, dailyLimit) rows into one
    // row per expenseType with both positions' values side by side.
    const byType = {};
    for (const l of elLimitsData) {
      const g = (byType[l.expenseType] ||= { expenseType: l.expenseType });
      if (l.positionType === 'Manager') { g.managerLimitId = l.limitId; g.managerLimit = l.dailyLimit; }
      else { g.staffLimitId = l.limitId; g.staffLimit = l.dailyLimit; }
    }
    const groups = Object.values(byType).sort((a, b) => a.expenseType.localeCompare(b.expenseType));
    const rows = groups.map(g => `
      <tr style="border-bottom:1px solid var(--border);" data-expense-type="${escapeHtml(g.expenseType)}">
        <td style="padding:7px;">${escapeHtml(g.expenseType)}</td>
        <td style="padding:7px;"><input type="number" class="el-f-manager-limit" value="${g.managerLimit != null ? trimNum(g.managerLimit) : ''}" min="0" placeholder="—"
              style="width:100px; padding:5px; border:1px solid var(--border); border-radius:4px; text-align:right;"></td>
        <td style="padding:7px;"><input type="number" class="el-f-staff-limit" value="${g.staffLimit != null ? trimNum(g.staffLimit) : ''}" min="0" placeholder="—"
              style="width:100px; padding:5px; border:1px solid var(--border); border-radius:4px; text-align:right;"></td>
        <td style="padding:7px; white-space:nowrap;">
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem;" onclick="submitUpdateExpenseLimit('${escapeHtml(g.expenseType).replace(/'/g, "\\'")}')">Save</button>
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem; background:#b91c1c; color:#fff;" onclick="submitDeleteExpenseLimit('${escapeHtml(g.expenseType).replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>`).join("");
    wrap.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem; max-width:640px;">
        <thead><tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:8px;">Expense Type</th><th style="padding:8px;">Manager Daily Limit (₹)</th>
          <th style="padding:8px;">Staff Daily Limit (₹)</th><th style="padding:8px;">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

async function submitAddExpenseLimit() {
  const expenseType = document.getElementById("el-new-type").value;
  const managerLimit = document.getElementById("el-new-manager-limit").value;
  const staffLimit = document.getElementById("el-new-staff-limit").value;
  if (!managerLimit && !staffLimit) return showTourFeedback("Enter at least one of Manager or Staff Daily Limit.", "error");
  if ((managerLimit && Number(managerLimit) <= 0) || (staffLimit && Number(staffLimit) <= 0)) {
    return showTourFeedback("Daily Limit must be a positive number.", "error");
  }

  showBlockingOverlay("Saving limit...");
  try {
    if (managerLimit) {
      const d = await acFetch("upsertTourExpenseLimit", { positionType: "Manager", expenseType, dailyLimit: managerLimit });
      if (!d.success) { hideBlockingOverlay(); return showTourFeedback(d.error, "error"); }
    }
    if (staffLimit) {
      const d = await acFetch("upsertTourExpenseLimit", { positionType: "Staff", expenseType, dailyLimit: staffLimit });
      if (!d.success) { hideBlockingOverlay(); return showTourFeedback(d.error, "error"); }
    }
    hideBlockingOverlay();
    document.getElementById("el-add-form").style.display = "none";
    document.getElementById("el-new-manager-limit").value = "";
    document.getElementById("el-new-staff-limit").value = "";
    loadExpenseLimitsTable();
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}

async function submitUpdateExpenseLimit(expenseType) {
  const row = document.querySelector(`tr[data-expense-type="${CSS.escape(expenseType)}"]`);
  const managerLimit = row.querySelector(".el-f-manager-limit").value;
  const staffLimit = row.querySelector(".el-f-staff-limit").value;
  if ((managerLimit && Number(managerLimit) <= 0) || (staffLimit && Number(staffLimit) <= 0)) {
    return showTourFeedback("Daily Limit must be a positive number.", "error");
  }

  showBlockingOverlay("Saving...");
  try {
    if (managerLimit) {
      const d = await acFetch("upsertTourExpenseLimit", { positionType: "Manager", expenseType, dailyLimit: managerLimit });
      if (!d.success) { hideBlockingOverlay(); return showTourFeedback(d.error, "error"); }
    }
    if (staffLimit) {
      const d = await acFetch("upsertTourExpenseLimit", { positionType: "Staff", expenseType, dailyLimit: staffLimit });
      if (!d.success) { hideBlockingOverlay(); return showTourFeedback(d.error, "error"); }
    }
    hideBlockingOverlay();
    loadExpenseLimitsTable();
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}

async function submitDeleteExpenseLimit(expenseType) {
  if (!confirm(`Delete the ${expenseType} daily limit (both Manager and Staff)?`)) return;
  const group = elLimitsData.filter(l => l.expenseType === expenseType);
  showBlockingOverlay("Deleting...");
  try {
    for (const l of group) {
      const d = await acFetch("deleteTourExpenseLimit", { limitId: l.limitId });
      if (!d.success) { hideBlockingOverlay(); return showTourFeedback(d.error, "error"); }
    }
    hideBlockingOverlay();
    loadExpenseLimitsTable();
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}
