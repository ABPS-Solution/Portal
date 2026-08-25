// accounts/cash-expense-employees.js — "Employee Details" toggle for
// Daily Cash/UPI Expenses. Independent employee list from Tour Expense
// Tracker's (explicit decision) — Name/EMP ID/Department editable inline;
// Delete removes the employee row entirely (25 Aug 2026, replacing the
// old Deactivate) — the backend refuses if they have any expense history.

async function initializeCashExpenseEmployeesPanel() {
  const panel = document.getElementById("ce-panel-employees");
  panel.innerHTML = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:14px;">
      <button class="nav-btn-styled" onclick="ceeToggleAddForm()">+ Add Employee</button>
    </div>
    <div id="cee-add-form" style="display:none; background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <input type="text" id="cee-new-name" placeholder="Employee Name" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:160px;">
        <input type="text" id="cee-new-empcode" placeholder="EMP ID" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:120px;">
        <input type="text" id="cee-new-dept" placeholder="Department" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:140px;">
      </div>
      <button class="nav-btn-styled" onclick="submitAddCashExpenseEmployee()">Submit</button>
      <button class="nav-btn-styled" onclick="document.getElementById('cee-add-form').style.display='none';">Cancel</button>
    </div>
    <div id="cee-table-wrap" style="overflow-x:auto;"></div>`;
  await loadCashExpenseEmployeesTable();
}

function ceeToggleAddForm() {
  const f = document.getElementById("cee-add-form");
  f.style.display = f.style.display === "none" ? "block" : "none";
}

async function loadCashExpenseEmployeesTable() {
  const wrap = document.getElementById("cee-table-wrap");
  wrap.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading...</div>`;
  try {
    const data = await acFetch("listAllCashExpenseEmployees", {});
    if (!data.success) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
    const rows = data.employees.map(e => `
      <tr style="border-bottom:1px solid var(--border); opacity:${e.status === 'Inactive' ? '0.55' : '1'};" data-employee-id="${e.employeeId}">
        <td style="padding:7px;"><input type="text" class="cee-f-name" value="${escapeHtml(e.employeeName)}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px;"><input type="text" class="cee-f-empcode" value="${escapeHtml(e.empCode || '')}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px;"><input type="text" class="cee-f-dept" value="${escapeHtml(e.departmentName || '')}" style="width:100%; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:7px; text-align:center;">${e.status === 'Active' ? 'Active' : '<span style="color:#b91c1c; font-weight:700;">Inactive</span>'}</td>
        <td style="padding:7px; white-space:nowrap;">
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem;" onclick="submitUpdateCashExpenseEmployee(${e.employeeId})">Save</button>
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem; background:#b91c1c; color:#fff;" onclick="submitDeleteCashExpenseEmployee(${e.employeeId}, '${escapeHtml(e.employeeName).replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>`).join("");
    wrap.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead><tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:8px;">Name</th><th style="padding:8px;">EMP ID</th><th style="padding:8px;">Department</th>
          <th style="padding:8px;">Status</th><th style="padding:8px;">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) { wrap.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

async function submitAddCashExpenseEmployee() {
  const employeeName = document.getElementById("cee-new-name").value.trim();
  const empCode = document.getElementById("cee-new-empcode").value.trim();
  const departmentName = document.getElementById("cee-new-dept").value.trim();
  if (!employeeName) return showCashExpenseFeedback("Employee Name is required.", "error");

  showBlockingOverlay("Adding employee...");
  try {
    const data = await acFetch("addCashExpenseEmployee", { employeeName, empCode, departmentName });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("cee-add-form").style.display = "none";
      ["cee-new-name", "cee-new-empcode", "cee-new-dept"].forEach(id => document.getElementById(id).value = "");
      loadCashExpenseEmployeesTable();
      showCashExpenseSuccess("Employee added.", "Add Another Employee", "switchCashExpenseToggle('employees'); ceeToggleAddForm();");
    } else {
      showCashExpenseFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showCashExpenseFeedback("Network error: " + e.message, "error"); }
}

async function submitUpdateCashExpenseEmployee(employeeId) {
  const row = document.querySelector(`tr[data-employee-id="${employeeId}"]`);
  const employeeName = row.querySelector(".cee-f-name").value.trim();
  const empCode = row.querySelector(".cee-f-empcode").value.trim();
  const departmentName = row.querySelector(".cee-f-dept").value.trim();
  if (!employeeName) return showCashExpenseFeedback("Employee Name is required.", "error");

  showBlockingOverlay("Saving...");
  try {
    const data = await acFetch("updateCashExpenseEmployee", { employeeId, employeeName, empCode, departmentName });
    hideBlockingOverlay();
    if (data.success) { loadCashExpenseEmployeesTable(); showCashExpenseSuccess("Saved.", "Edit Another Employee", "switchCashExpenseToggle('employees')"); }
    else showCashExpenseFeedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); showCashExpenseFeedback("Network error: " + e.message, "error"); }
}

async function submitDeleteCashExpenseEmployee(employeeId, employeeName) {
  if (!confirm(`Permanently delete "${employeeName}"? This cannot be undone. (Blocked if they have any expense history.)`)) return;
  showBlockingOverlay("Deleting...");
  try {
    const data = await acFetch("deleteCashExpenseEmployee", { employeeId });
    hideBlockingOverlay();
    if (data.success) { loadCashExpenseEmployeesTable(); showCashExpenseSuccess(`"${employeeName}" deleted.`, "Back to Employee Details", "switchCashExpenseToggle('employees')"); }
    else showCashExpenseFeedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); showCashExpenseFeedback("Network error: " + e.message, "error"); }
}
