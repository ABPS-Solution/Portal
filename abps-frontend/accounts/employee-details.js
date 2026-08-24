// accounts/employee-details.js — "Employee Details" toggle. Name/EMP
// ID/Department are editable inline; Current Balance never is (it only
// ever moves via Pay Advance / Check Voucher). Add supports a non-zero
// opening balance. Remove = deactivate (status='Inactive'), history
// preserved — a matching Reactivate exists for the same reason a status
// column exists at all: to undo a mistaken deactivation.

async function initializeEmployeeDetailsPanel() {
  const panel = document.getElementById("te-panel-employees");
  panel.innerHTML = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:14px;">
      <button class="nav-btn-styled" onclick="edToggleAddForm()">+ Add Employee</button>
    </div>
    <div id="ed-add-form" style="display:none; background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-bottom:16px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <input type="text" id="ed-new-name" placeholder="Employee Name" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:160px;">
        <input type="text" id="ed-new-empcode" placeholder="EMP ID" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:120px;">
        <input type="text" id="ed-new-dept" placeholder="Department" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:140px;">
        <input type="number" id="ed-new-balance" placeholder="Opening Balance" style="padding:9px 10px; border:1px solid var(--border); border-radius:6px; flex:1; min-width:140px;">
      </div>
      <button class="nav-btn-styled" onclick="submitAddEmployee()">Submit</button>
      <button class="nav-btn-styled" onclick="document.getElementById('ed-add-form').style.display='none';">Cancel</button>
    </div>
    <div id="ed-table-wrap" style="overflow-x:auto;"></div>`;
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
        <td style="padding:7px; text-align:right; font-weight:700;">${formatINRComma(e.balance)}</td>
        <td style="padding:7px; text-align:center;">${e.status === 'Active' ? 'Active' : '<span style="color:#b91c1c; font-weight:700;">Inactive</span>'}</td>
        <td style="padding:7px; white-space:nowrap;">
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem;" onclick="submitUpdateEmployee(${e.employeeId})">Save</button>
          <button class="nav-btn-styled" style="padding:5px 10px; font-size:0.76rem;" onclick="submitSetEmployeeStatus(${e.employeeId}, '${e.status === 'Active' ? 'Inactive' : 'Active'}')">${e.status === 'Active' ? 'Deactivate' : 'Reactivate'}</button>
        </td>
      </tr>`).join("");
    wrap.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead><tr style="background:var(--highlight-bg); text-align:left;">
          <th style="padding:8px;">Name</th><th style="padding:8px;">EMP ID</th><th style="padding:8px;">Department</th>
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
  const openingBalance = document.getElementById("ed-new-balance").value;
  if (!employeeName) return showTourFeedback("Employee Name is required.", "error");

  showBlockingOverlay("Adding employee...");
  try {
    const data = await acFetch("addTourEmployee", { employeeName, empCode, departmentName, openingBalance });
    hideBlockingOverlay();
    if (data.success) {
      document.getElementById("ed-add-form").style.display = "none";
      ["ed-new-name", "ed-new-empcode", "ed-new-dept", "ed-new-balance"].forEach(id => document.getElementById(id).value = "");
      loadEmployeeDetailsTable();
      showTourSuccess("Employee added.", "Add Another Employee", "edToggleAddForm()");
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
  if (!employeeName) return showTourFeedback("Employee Name is required.", "error");

  showBlockingOverlay("Saving...");
  try {
    const data = await acFetch("updateTourEmployee", { employeeId, employeeName, empCode, departmentName });
    hideBlockingOverlay();
    if (data.success) { loadEmployeeDetailsTable(); showTourSuccess("Saved.", "Edit Another Employee", "document.getElementById('te-success').style.display='none';"); }
    else showTourFeedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}

async function submitSetEmployeeStatus(employeeId, status) {
  if (status === 'Inactive') {
    const row = document.querySelector(`tr[data-employee-id="${employeeId}"]`);
    const balance = Number(row?.dataset.balance) || 0;
    if (balance !== 0) {
      return showTourFeedback(`Cannot deactivate — Current Balance must be exactly 0 (it's ${formatINRComma(balance)}).`, "error");
    }
    if (!confirm("Deactivate this employee? They'll disappear from the voucher page and every picker, but their history stays intact.")) return;
  }
  showBlockingOverlay("Updating...");
  try {
    const data = await acFetch("setTourEmployeeStatus", { employeeId, status });
    hideBlockingOverlay();
    if (data.success) { loadEmployeeDetailsTable(); showTourSuccess(`Employee set to ${status}.`, "Back to Employee Details", "document.getElementById('te-success').style.display='none';"); }
    else showTourFeedback(data.error, "error");
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}
