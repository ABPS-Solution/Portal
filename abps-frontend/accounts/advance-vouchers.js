// accounts/advance-vouchers.js — "Advance Vouchers" toggle. Pay an
// advance against an employee; Place of Visit is a typeahead with
// inline add-new (shared accounts.tour_places, same table the public
// voucher page reads/writes).

let advCachedEmployees = [];
let advSelectedEmployeeId = null;
let advCachedPlaces = [];
let advSelectedPlace = "";

async function initializeAdvanceVoucherPanel() {
  const panel = document.getElementById("te-panel-advance");
  panel.innerHTML = `
    <div style="background:var(--highlight-bg); padding:18px; border-radius:var(--radius); max-width:520px;">
      <div style="margin-bottom:12px; position:relative;">
        <label class="field-label">Employee Name *</label>
        <input type="text" id="adv-emp-search" placeholder="Type to search employee..." autocomplete="off"
          style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"
          oninput="advHandleEmployeeSearch(this.value)">
        <div id="adv-emp-dropdown" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:12px;">
        <div style="flex:1;"><label class="field-label">EMP ID</label>
          <input type="text" id="adv-emp-code" readonly style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px; background:#f1f5f9;"></div>
        <div style="flex:1;"><label class="field-label">Department</label>
          <input type="text" id="adv-emp-dept" readonly style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px; background:#f1f5f9;"></div>
      </div>
      <div style="margin-bottom:12px; position:relative;">
        <label class="field-label">Company of Visit *</label>
        <input type="text" id="adv-place-search" placeholder="Type to search or add a place..." autocomplete="off"
          style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"
          oninput="advHandlePlaceSearch(this.value)">
        <div id="adv-place-dropdown" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:12px;">
        <div style="flex:1;"><label class="field-label">Start Date of Visit *</label>
          <input type="date" id="adv-start-date" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"></div>
        <div style="flex:1;"><label class="field-label">Estimate Days of Visit</label>
          <input type="number" id="adv-est-days" min="1" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"></div>
      </div>
      <div style="margin-bottom:16px;">
        <label class="field-label">Advance Amount *</label>
        <input type="number" id="adv-amount" min="0" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
      </div>
      <button class="nav-btn-styled" onclick="submitTourAdvance()">Submit</button>
    </div>`;

  advSelectedEmployeeId = null;
  advSelectedPlace = "";
  try {
    const [empData, placeData] = await Promise.all([
      acFetch("searchTourEmployees", {}),
      acFetch("listTourPlaces", {}),
    ]);
    advCachedEmployees = empData.success ? empData.employees : [];
    advCachedPlaces = placeData.success ? placeData.places : [];
  } catch (e) { console.error("Advance Vouchers bootstrap failed:", e.message); }
  enhanceAllDateInputsForDMY();
}

function advHandleEmployeeSearch(query) {
  const dd = document.getElementById("adv-emp-dropdown");
  advSelectedEmployeeId = null;
  document.getElementById("adv-emp-code").value = "";
  document.getElementById("adv-emp-dept").value = "";
  const q = (query || "").trim().toLowerCase();
  if (!q) { dd.style.display = "none"; return; }
  const matches = advCachedEmployees.filter(e => e.employeeName.toLowerCase().includes(q)).slice(0, 15);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(e => `
    <div onmousedown="event.preventDefault(); advSelectEmployee(${e.employeeId})"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${escapeHtml(e.employeeName)} <span style="color:var(--muted); font-size:0.75rem;">${e.empCode ? '· ' + escapeHtml(e.empCode) : ''}</span>
    </div>`).join("");
  const input = document.getElementById("adv-emp-search");
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + "px"; dd.style.left = rect.left + "px"; dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function advSelectEmployee(employeeId) {
  const emp = advCachedEmployees.find(e => e.employeeId === employeeId);
  if (!emp) return;
  advSelectedEmployeeId = employeeId;
  document.getElementById("adv-emp-search").value = emp.employeeName;
  document.getElementById("adv-emp-code").value = emp.empCode || "";
  document.getElementById("adv-emp-dept").value = emp.departmentName || "";
  document.getElementById("adv-emp-dropdown").style.display = "none";
}

function advHandlePlaceSearch(query) {
  const dd = document.getElementById("adv-place-dropdown");
  advSelectedPlace = query;
  const q = (query || "").trim().toLowerCase();
  if (!q) { dd.style.display = "none"; return; }
  const matches = advCachedPlaces.filter(p => p.placeName.toLowerCase().includes(q)).slice(0, 15);
  const exactHit = advCachedPlaces.some(p => p.placeName.trim().toLowerCase() === q);
  let html = matches.map(p => `
    <div onmousedown="event.preventDefault(); advSelectPlace('${p.placeName.replace(/'/g, "\\'")}')"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${escapeHtml(p.placeName)}</div>`).join("");
  if (!exactHit && query.trim()) {
    html += `<div onmousedown="event.preventDefault(); advAddNewPlace('${query.trim().replace(/'/g, "\\'")}')"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; color:var(--brand); font-weight:700;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">+ Add "${escapeHtml(query.trim())}" as a new place</div>`;
  }
  if (!html) { dd.style.display = "none"; return; }
  dd.innerHTML = html;
  const input = document.getElementById("adv-place-search");
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + "px"; dd.style.left = rect.left + "px"; dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function advSelectPlace(placeName) {
  advSelectedPlace = placeName;
  document.getElementById("adv-place-search").value = placeName;
  document.getElementById("adv-place-dropdown").style.display = "none";
}

async function advAddNewPlace(placeName) {
  document.getElementById("adv-place-dropdown").style.display = "none";
  try {
    const data = await acFetch("addTourPlace", { placeName });
    if (data.success) {
      advCachedPlaces.push(data.place);
      advSelectPlace(data.place.placeName);
    } else {
      alert("Could not add place: " + data.error);
    }
  } catch (e) { alert("Network error adding place: " + e.message); }
}

document.addEventListener("click", (e) => {
  ["adv-emp-dropdown", "adv-place-dropdown"].forEach(id => {
    const dd = document.getElementById(id);
    if (dd && !e.target.closest(`#${id}`) && e.target.id !== id.replace("-dropdown", "-search")) dd.style.display = "none";
  });
});

async function submitTourAdvance() {
  const amount = parseFloat(document.getElementById("adv-amount").value);
  const startDate = document.getElementById("adv-start-date").value;
  const estimatedDays = document.getElementById("adv-est-days").value;
  if (!advSelectedEmployeeId) return showTourFeedback("Select an employee from the dropdown.", "error");
  if (!advSelectedPlace.trim()) return showTourFeedback("Company of Visit is required.", "error");
  if (!startDate) return showTourFeedback("Start Date of Visit is required.", "error");
  if (!amount || amount <= 0) return showTourFeedback("A positive Advance Amount is required.", "error");

  showBlockingOverlay("Recording advance...");
  try {
    const data = await acFetch("payTourAdvance", {
      employeeId: advSelectedEmployeeId, placeOfVisit: advSelectedPlace.trim(),
      startDate, estimatedDays: estimatedDays || null, amount,
    });
    hideBlockingOverlay();
    if (data.success) {
      initializeAdvanceVoucherPanel();
      showTourSuccess(`Advance recorded. New balance: ${formatINRComma(data.newBalance)}.`, "Record Another Advance", "initializeAdvanceVoucherPanel()");
    } else {
      showTourFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showTourFeedback("Network error: " + e.message, "error"); }
}
