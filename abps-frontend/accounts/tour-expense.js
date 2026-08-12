// ═══════════════════════════════════════════════════════
// TOUR EXPENSE TRACKER
// ═══════════════════════════════════════════════════════
let teSelectedEmployeeId = null;

function initializeTourExpensePanel() {
  teSelectedEmployeeId = null;
  document.getElementById("te-employee-detail").innerHTML = "";
  document.getElementById("te-employee-search-input").value = "";
  document.getElementById("te-add-employee-form").style.display = "none";
  switchTourExpenseTab("employee");
  renderTourEmployeeSearchResults();
}

function switchTourExpenseTab(tab) {
  document.getElementById("te-panel-employee").style.display = tab === "employee" ? "block" : "none";
  document.getElementById("te-panel-voucher").style.display  = tab === "voucher"  ? "block" : "none";
  document.getElementById("te-tab-employee").style.background = tab === "employee" ? "var(--brand)" : "";
  document.getElementById("te-tab-employee").style.color      = tab === "employee" ? "#fff" : "";
  document.getElementById("te-tab-voucher").style.background  = tab === "voucher"  ? "var(--brand)" : "";
  document.getElementById("te-tab-voucher").style.color       = tab === "voucher"  ? "#fff" : "";
  if (tab === "voucher") loadTourVoucherList();
}

async function openAddTourEmployeeForm() {
  document.getElementById("te-new-employee-name").value = "";
  document.getElementById("te-add-employee-form").style.display = "block";
  const deptSelect = document.getElementById("te-new-employee-dept");
  if (deptSelect.options.length <= 1) {
    try {
      const data = await acFetch("listTourDepartments", {});
      if (data.success) {
        data.departments.forEach(name => {
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          deptSelect.appendChild(opt);
        });
      }
    } catch(e) { /* dropdown just stays with the default option if this fails */ }
  }
}

async function submitAddTourEmployee() {
  const employeeName = document.getElementById("te-new-employee-name").value.trim();
  const departmentName = document.getElementById("te-new-employee-dept").value.trim();
  if (!employeeName) { showBOQBanner("te-feedback", "Employee name is required.", "error"); return; }
  showBlockingOverlay("Adding employee...");
  try {
    const data = await acFetch("addTourEmployee", { employeeName, departmentName });
    if (data.success) {
      document.getElementById("te-add-employee-form").style.display = "none";
      showBOQBanner("te-feedback", `Added employee "${employeeName}" with 0 balance.`, "success");
      renderTourEmployeeSearchResults();
    } else {
      showBOQBanner("te-feedback", data.error || "Failed to add employee.", "error");
    }
  } catch(e) {
    showBOQBanner("te-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

async function renderTourEmployeeSearchResults() {
  const searchTerm = document.getElementById("te-employee-search-input").value.trim();
  const list = document.getElementById("te-employee-list");
  list.innerHTML = '<div style="padding:10px; color:var(--muted);">Loading...</div>';
  try {
    const data = await acFetch("searchTourEmployees", { searchTerm: searchTerm || null });
    if (!data.success) { list.innerHTML = `<div style="padding:10px; color:#b91c1c;">${data.error}</div>`; return; }
    if (data.employees.length === 0) { list.innerHTML = '<div style="padding:10px; color:var(--muted);">No employees found.</div>'; return; }
    list.innerHTML = data.employees.map(emp => `
      <div class="menu-card" style="padding:10px 14px; cursor:pointer;" onclick="selectTourEmployee(${emp.employee_id})">
        <span class="mc-label">${emp.employee_name}</span>
        <div style="font-size:0.75rem; color:var(--muted);">${emp.department_name || "—"} · Balance: ${emp.balance}</div>
      </div>`).join("");
  } catch(e) {
    list.innerHTML = `<div style="padding:10px; color:#b91c1c;">Network error: ${e.message}</div>`;
  }
}

async function selectTourEmployee(employeeId) {
  teSelectedEmployeeId = employeeId;
  const detail = document.getElementById("te-employee-detail");
  detail.innerHTML = '<div style="padding:10px; color:var(--muted);">Loading...</div>';
  try {
    const data = await acFetch("getTourEmployeeDetail", { employeeId });
    if (!data.success) { detail.innerHTML = `<div style="padding:10px; color:#b91c1c;">${data.error}</div>`; return; }
    renderTourEmployeeDetail(data.employee, data.pendingVouchers);
  } catch(e) {
    detail.innerHTML = `<div style="padding:10px; color:#b91c1c;">Network error: ${e.message}</div>`;
  }
}

function renderTourEmployeeDetail(employee, pendingVouchers) {
  const detail = document.getElementById("te-employee-detail");
  detail.innerHTML = `
    <div style="background:var(--highlight-bg); padding:16px; border-radius:var(--radius); margin-top:10px;">
      <h3 style="margin:0 0 8px 0;">${employee.employee_name}</h3>
      <div style="font-size:0.85rem; color:var(--muted); margin-bottom:4px;">Department: ${employee.department_name || "—"}</div>
      <div style="font-size:1.1rem; font-weight:700; margin-bottom:12px;">Balance: ${employee.balance}</div>
      <div style="display:flex; gap:8px; margin-bottom:14px;">
        <button class="nav-btn-styled" onclick="openTourAdvanceForm()">Pay Advance</button>
        <button class="nav-btn-styled" onclick="openTourVoucherForm()">Add Voucher</button>
      </div>
      <div id="te-advance-form" style="display:none; margin-bottom:12px;">
        <input type="number" id="te-advance-amount" placeholder="Amount" style="padding:8px; margin-right:8px; width:140px;">
        <button class="nav-btn-styled" onclick="submitTourAdvance()">Submit</button>
        <button class="nav-btn-styled" onclick="document.getElementById('te-advance-form').style.display='none';">Cancel</button>
      </div>
      <div id="te-voucher-form" style="display:none; margin-bottom:12px;">
        <input type="text" id="te-voucher-customer" placeholder="Customer Name" style="padding:8px; margin-right:8px;"><br style="margin-bottom:6px;">
        <input type="text" id="te-voucher-purpose" placeholder="Purpose of Visit" style="padding:8px; margin:6px 8px 6px 0;"><br>
        <input type="number" id="te-voucher-amount" placeholder="Voucher Amount" style="padding:8px; margin:6px 8px 6px 0; width:140px;"><br>
        <button class="nav-btn-styled" onclick="submitTourVoucher()">Submit</button>
        <button class="nav-btn-styled" onclick="document.getElementById('te-voucher-form').style.display='none';">Cancel</button>
      </div>
      <div style="font-weight:600; margin-bottom:6px;">Pending Vouchers</div>
      ${pendingVouchers.length === 0
        ? '<div style="color:var(--muted); font-size:0.85rem;">No pending vouchers.</div>'
        : pendingVouchers.map(v => `
            <div style="padding:8px 0; border-bottom:1px solid var(--border); font-size:0.85rem;">
              ${v.customer_name} — ${v.purpose_of_visit || "—"} — Amount: ${v.voucher_amount}
            </div>`).join("")}
    </div>`;
}

function openTourAdvanceForm() {
  document.getElementById("te-advance-amount").value = "";
  document.getElementById("te-advance-form").style.display = "block";
}

async function submitTourAdvance() {
  const amount = Number(document.getElementById("te-advance-amount").value);
  if (!amount || amount <= 0) { showBOQBanner("te-feedback", "Enter a valid positive amount.", "error"); return; }
  showBlockingOverlay("Paying advance...");
  try {
    const data = await acFetch("payTourAdvance", { employeeId: teSelectedEmployeeId, amount });
    if (data.success) {
      showBOQBanner("te-feedback", `Advance paid. New balance: ${data.newBalance}.`, "success");
      selectTourEmployee(teSelectedEmployeeId);
      renderTourEmployeeSearchResults();
    } else {
      showBOQBanner("te-feedback", data.error || "Failed to pay advance.", "error");
    }
  } catch(e) {
    showBOQBanner("te-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

function openTourVoucherForm() {
  document.getElementById("te-voucher-customer").value = "";
  document.getElementById("te-voucher-purpose").value = "";
  document.getElementById("te-voucher-amount").value = "";
  document.getElementById("te-voucher-form").style.display = "block";
}

async function submitTourVoucher() {
  const customerName = document.getElementById("te-voucher-customer").value.trim();
  const purposeOfVisit = document.getElementById("te-voucher-purpose").value.trim();
  const voucherAmount = Number(document.getElementById("te-voucher-amount").value);
  if (!customerName || !voucherAmount || voucherAmount <= 0) {
    showBOQBanner("te-feedback", "Customer Name and a valid positive Voucher Amount are required.", "error");
    return;
  }
  showBlockingOverlay("Creating voucher...");
  try {
    const data = await acFetch("addTourVoucher", { employeeId: teSelectedEmployeeId, customerName, purposeOfVisit, voucherAmount });
    if (data.success) {
      showBOQBanner("te-feedback", `Voucher created. New balance: ${data.newBalance}.`, "success");
      selectTourEmployee(teSelectedEmployeeId);
      renderTourEmployeeSearchResults();
    } else {
      showBOQBanner("te-feedback", data.error || "Failed to create voucher.", "error");
    }
  } catch(e) {
    showBOQBanner("te-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

async function loadTourVoucherList() {
  const body = document.getElementById("te-voucher-list-body");
  body.innerHTML = '<tr><td colspan="8" style="padding:14px; text-align:center;">Loading...</td></tr>';
  try {
    const data = await acFetch("searchTourVouchers", {});
    if (!data.success) { body.innerHTML = `<tr><td colspan="8" style="padding:14px; text-align:center; color:#b91c1c;">${data.error}</td></tr>`; return; }
    if (data.vouchers.length === 0) { body.innerHTML = '<tr><td colspan="8" style="padding:14px; text-align:center; color:var(--muted);">No unchecked vouchers.</td></tr>'; return; }
    body.innerHTML = data.vouchers.map(v => `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px;">${formatDateDMY(v.created_date)}</td>
        <td style="padding:8px;">${v.department_name || "—"}</td>
        <td style="padding:8px;">${v.employee_name}</td>
        <td style="padding:8px;">${v.customer_name}</td>
        <td style="padding:8px;">${v.purpose_of_visit || "—"}</td>
        <td style="padding:8px;">${v.voucher_amount}</td>
        <td style="padding:8px;"><input type="number" id="te-checked-amount-${v.voucher_id}" placeholder="Checked Amount" style="padding:6px; width:120px;"></td>
        <td style="padding:8px;"><button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem;" onclick="submitCheckTourVoucher(${v.voucher_id})">Submit</button></td>
      </tr>`).join("");
  } catch(e) {
    body.innerHTML = `<tr><td colspan="8" style="padding:14px; text-align:center; color:#b91c1c;">Network error: ${e.message}</td></tr>`;
  }
}

async function submitCheckTourVoucher(voucherId) {
  const input = document.getElementById("te-checked-amount-" + voucherId);
  const checkedAmount = Number(input.value);
  if (input.value === "" || isNaN(checkedAmount) || checkedAmount < 0) {
    showBOQBanner("te-feedback", "Enter a valid Checked Voucher Amount.", "error");
    return;
  }
  showBlockingOverlay("Checking voucher...");
  try {
    const data = await acFetch("checkTourVoucher", { voucherId, checkedAmount });
    if (data.success) {
      showBOQBanner("te-feedback", `Voucher checked. Employee's new balance: ${data.newBalance}.`, "success");
      loadTourVoucherList();
      renderTourEmployeeSearchResults(); // the employee-list card also shows Balance — refresh it too, not just the detail panel
    } else {
      showBOQBanner("te-feedback", data.error || "Failed to check voucher.", "error");
    }
  } catch(e) {
    showBOQBanner("te-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

function switchMcStatus(status) {
  mcCurrentStatus = status;
  syncMcStatusPills();
  loadManufacturingClearanceList();
}

function syncMcStatusPills() {
  ["Active", "Inactive", "Completed"].forEach(s => {
    const btn = document.getElementById("mc-pill-" + s.toLowerCase());
    if (btn) btn.style.background = (s === mcCurrentStatus) ? "var(--brand)" : "#e2e8f0";
    if (btn) btn.style.color = (s === mcCurrentStatus) ? "#fff" : "#334155";
  });
}

