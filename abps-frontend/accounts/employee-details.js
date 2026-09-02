// accounts/employee-details.js — "Employee Details" toggle. Name/EMP
// ID/Department are editable inline; Current Balance never is (it only
// ever moves via Pay Advance / Check Voucher). Add supports a non-zero
// opening balance. Delete removes the employee row entirely (25 Aug 2026,
// replacing the old Deactivate) — the backend still refuses to delete an
// employee with a non-zero balance or any advance/voucher history, same
// underlying FK-safety reasoning the old Deactivate had.

async function initializeEmployeeDetailsPanel() {
  const panel = document.getElementById("te-panel-employees");
  panel.innerHTML = `
    <div style="margin-bottom:28px; padding-bottom:20px; border-bottom:2px solid var(--border);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="margin:0;">Position-Based Daily Expense Limits</h3>
        <button class="nav-btn-styled" onclick="elToggleAddForm()">+ Add Limit</button>
      </div>
      <div id="el-add-form" style="display:none; background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
          <select id="el-new-position" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
            <option value="Staff">Staff</option><option value="Manager">Manager</option>
          </select>
          <select id="el-new-type" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
            ${TOUR_EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
          <input type="number" id="el-new-limit" placeholder="Daily Limit (₹)" min="0" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
        </div>
        <button class="nav-btn-styled" onclick="submitAddExpenseLimit()">Submit</button>
        <button class="nav-btn-styled" onclick="document.getElementById('el-add-form').style.display='none';">Cancel</button>
      </div>
      <div id="el-table-wrap" style="overflow-x:auto;"></div>
    </div>

    <div style="display:flex; justify-content:flex-end; margin-bottom:14px;">
      <button class="nav-btn-styled" onclick="edToggleAddForm()">+ Add Employee</button>
    </div>
    <div id="ed-add-form" style="display:none; background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <input type="text" id="ed-new-name" placeholder="Employee Name" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:160px;">
        <input type="text" id="ed-new-empcode" placeholder="EMP ID" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:120px;">
        <input type="text" id="ed-new-dept" placeholder="Department" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:140px;">
        <select id="ed-new-position" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:120px;">
          <option value="Staff">Staff</option><option value="Manager">Manager</option>
        </select>
        <input type="number" id="ed-new-balance" placeholder="Opening Balance" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:140px;">
      </div>
      <button class="nav-btn-styled" onclick="submitAddEmployee()">Submit</button>
      <button class="nav-btn-styled" onclick="document.getElementById('ed-add-form').style.display='none';">Cancel</button>
    </div>
    <div id="ed-table-wrap" style="overflow-x:auto;"></div>`;
  await loadExpenseLimitsTable();
  await loadEmployeeDetailsTable();
}

function edToggleAddForm() {
  const f = document.getElementById("ed-add-form");
  f.style.display = f.style.display === "none" ? "block" : "none";
}

async function loadEmployeeDetailsTable() {
  const wrap = document.getElementById("ed-table-wrap");
  wrap.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading...</div>`;
  try {
    const data = await acFetch("listAllTourEmployees", {});
    if (!data.success) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
    const rows = data.employees.map(e => `
      <tr style="border-bottom:1px solid var(--border); opacity:${e.status === 'Inactive' ? '0.55' : '1'};" data-employee-id="${e.employeeId}" data-balance="${e.balance}">
        <td style="padding:7px;"><input type="text" class="ed-f-name" value="${escapeHtml(e.employeeName)}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px;"><input type="text" class="ed-f-empcode" value="${escapeHtml(e.empCode || '')}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px;"><input type="text" class="ed-f-dept" value="${escapeHtml(e.departmentName || '')}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px;"><select class="ed-f-position" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;">
          <option value="Staff" ${e.positionType !== 'Manager' ? 'selected' : ''}>Staff</option>
          <option value="Manager" ${e.positionType === 'Manager' ? 'selected' : ''}>Manager</option>
        </select></td>
        <td style="padding:7px; text-align:right; font-weight:700;">${formatINRComma(e.balance)}</td>
        <td style="padding:7px; text-align:center;">${e.status === 'Active' ? 'Active' : '<span style="color:#b91c1c; font-weight:700;">Inactive</span>'}</td>
        <td style="padding:7px; white-space:nowrap;">
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem;" onclick="submitUpdateEmployee(${e.employeeId})">Save</button>
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem; background:#b91c1c; color:#fff;" onclick="submitDeleteEmployee(${e.employeeId}, '${escapeHtml(e.employeeName).replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>`).join("");
    wrap.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead><tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:8px;">Name</th><th style="padding:8px;">EMP ID</th><th style="padding:8px;">Department</th><th style="padding:8px;">Position</th>
          <th style="padding:8px; text-align:right;">Current Balance</th><th style="padding:8px;">Status</th><th style="padding:8px;">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

async function submitAddEmployee() {
  const employeeName = document.getElementById("ed-new-name").value.trim();
  const empCode = document.getElementById("ed-new-empcode").value.trim();
  const departmentName = document.getElementById("ed-new-dept").value.trim();
  const positionType = document.getElementById("ed-new-position").value;
  const openingBalance = document.getElementById("ed-new-balance").value;
  if (!employeeName) return showTourFeedback("Employee Name is required.", "error");

  showBlockingOverlay("Adding employee...");
  try {
    const data = await acFetch("addTourEmployee", { employeeName, empCode, departmentName, positionType, openingBalance });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("ed-add-form").style.display = "none";
      ["ed-new-name", "ed-new-empcode", "ed-new-dept", "ed-new-balance"].forEach(id => document.getElementById(id).value = "");
      document.getElementById("ed-new-position").value = "Staff";
      loadEmployeeDetailsTable();
      showTourSuccess("Employee added.", "Add Another Employee", "switchTourExpenseToggle('employees'); edToggleAddForm();");
    } else {
      showTourFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}

async function submitUpdateEmployee(employeeId) {
  const row = document.querySelector(`tr[data-employee-id="${employeeId}"]`);
  const employeeName = row.querySelector(".ed-f-name").value.trim();
  const empCode = row.querySelector(".ed-f-empcode").value.trim();
  const departmentName = row.querySelector(".ed-f-dept").value.trim();
  const positionType = row.querySelector(".ed-f-position").value;
  if (!employeeName) return showTourFeedback("Employee Name is required.", "error");

  showBlockingOverlay("Saving...");
  try {
    const data = await acFetch("updateTourEmployee", { employeeId, employeeName, empCode, departmentName, positionType });
    hideBlockingOverlay();
    if (data.success) { loadEmployeeDetailsTable(); showTourSuccess("Saved.", "Edit Another Employee", "switchTourExpenseToggle('employees')"); }
    else showTourFeedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}

async function submitDeleteEmployee(employeeId, employeeName) {
  if (!confirm(`Permanently delete "${employeeName}"? This cannot be undone. (Blocked if their balance isn't 0 or they have any advance/voucher history.)`)) return;
  showBlockingOverlay("Deleting...");
  try {
    const data = await acFetch("deleteTourEmployee", { employeeId });
    hideBlockingOverlay();
    if (data.success) { loadEmployeeDetailsTable(); showTourSuccess(`"${employeeName}" deleted.`, "Back to Employee Details", "switchTourExpenseToggle('employees')"); }
    else showTourFeedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}

// ── Position-Based Daily Expense Limits (migration 167) ─────────────────
// positionType/expenseType are read-only once a row exists — editing
// either via the upsert route would silently create a NEW row via
// ON CONFLICT rather than moving the old one. Only dailyLimit is
// editable in place; changing the pair means Delete + re-Add.
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
    if (data.limits.length === 0) {
      wrap.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No expense limits configured.</div>`;
      return;
    }
    const rows = data.limits.map(l => `
      <tr style="border-bottom:1px solid var(--border);" data-limit-id="${l.limitId}">
        <td style="padding:7px;">${escapeHtml(l.positionType)}</td>
        <td style="padding:7px;">${escapeHtml(l.expenseType)}</td>
        <td style="padding:7px;"><input type="number" class="el-f-limit" value="${trimNum(l.dailyLimit)}" min="0"
              style="width:100px; padding:5px; border:1px solid var(--border); border-radius:4px; text-align:right;"></td>
        <td style="padding:7px; white-space:nowrap;">
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem;" onclick="submitUpdateExpenseLimit(${l.limitId}, '${escapeHtml(l.positionType)}', '${escapeHtml(l.expenseType).replace(/'/g, "\\'")}')">Save</button>
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem; background:#b91c1c; color:#fff;" onclick="submitDeleteExpenseLimit(${l.limitId}, '${escapeHtml(l.positionType)} / ${escapeHtml(l.expenseType).replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>`).join("");
    wrap.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem; max-width:520px;">
        <thead><tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:8px;">Position</th><th style="padding:8px;">Expense Type</th>
          <th style="padding:8px;">Daily Limit (₹)</th><th style="padding:8px;">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

async function submitAddExpenseLimit() {
  const positionType = document.getElementById("el-new-position").value;
  const expenseType = document.getElementById("el-new-type").value;
  const dailyLimit = document.getElementById("el-new-limit").value;
  if (!dailyLimit || Number(dailyLimit) <= 0) return showTourFeedback("Daily Limit must be a positive number.", "error");

  showBlockingOverlay("Saving limit...");
  try {
    const data = await acFetch("upsertTourExpenseLimit", { positionType, expenseType, dailyLimit });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("el-add-form").style.display = "none";
      document.getElementById("el-new-limit").value = "";
      loadExpenseLimitsTable();
    } else {
      showTourFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}

async function submitUpdateExpenseLimit(limitId, positionType, expenseType) {
  const row = document.querySelector(`tr[data-limit-id="${limitId}"]`);
  const dailyLimit = row.querySelector(".el-f-limit").value;
  if (!dailyLimit || Number(dailyLimit) <= 0) return showTourFeedback("Daily Limit must be a positive number.", "error");

  showBlockingOverlay("Saving...");
  try {
    const data = await acFetch("upsertTourExpenseLimit", { positionType, expenseType, dailyLimit });
    hideBlockingOverlay();
    if (data.success) loadExpenseLimitsTable();
    else showTourFeedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}

async function submitDeleteExpenseLimit(limitId, label) {
  if (!confirm(`Delete the ${label} daily limit?`)) return;
  showBlockingOverlay("Deleting...");
  try {
    const data = await acFetch("deleteTourExpenseLimit", { limitId });
    hideBlockingOverlay();
    if (data.success) loadExpenseLimitsTable();
    else showTourFeedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}
