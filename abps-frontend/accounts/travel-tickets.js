// accounts/travel-tickets.js — Travel Ticket Booking (Accounts department,
// migration 166, perm_travel_tickets). HR books company-paid flight/
// train/bus tickets for travelling employees; Accounts links a booked
// traveller to that employee's Tour Expense Voucher while checking it
// (see accounts/voucher-check.js). This module never touches balance or
// total_actual_amount — display/reporting only, same invariant enforced
// server-side in routes/travelTickets.js and routes/accounts.js.

const TTK_TOGGLES = ["book", "manage"];
const TTK_MODES = ["Flight", "Train", "Bus"];
const TTK_TRIP_TYPES = ["One Way", "Round Trip"];

let ttkCachedEmployees = [];
let ttkCachedCompanies = [];
let ttkTravellerRows = [];      // [{employeeId, employeeName, empCode, price}]
let ttkSelectedCompanies = [];  // [companyName]
let ttkInvoiceFiles = [];       // [{base64Data, fileName, mimeType}] — Invoice Upload is compulsory, multiple allowed
let ttkEditingTicketId = null;
let ttkLastSearchTickets = []; // last searchTravelTickets result, for the table's own state

function initializeTravelTicketsPanel() {
  document.getElementById("ttk-feedback").style.display = "none";
  document.getElementById("ttk-success").style.display = "none";
  switchTravelTicketToggle("book");
}

function switchTravelTicketToggle(toggle) {
  document.getElementById("ttk-feedback").style.display = "none";
  document.getElementById("ttk-success").style.display = "none";
  document.getElementById("ttk-toggle-bar").style.display = "flex";
  TTK_TOGGLES.forEach(t => {
    const panel = document.getElementById(`ttk-panel-${t}`);
    const btn = document.getElementById(`ttk-toggle-${t}`);
    if (panel) panel.style.display = (t === toggle) ? "block" : "none";
    if (btn) { btn.style.background = (t === toggle) ? "var(--brand)" : "#e2e8f0"; btn.style.color = (t === toggle) ? "#fff" : "#334155"; }
  });
  if (toggle === "book") ttkRenderBookForm();
  if (toggle === "manage") ttkInitializeManagePanel();
}

function showTicketFeedback(message, type) {
  const el = document.getElementById("ttk-feedback");
  if (!el) return;
  if (type !== "error") { el.style.display = "none"; return; }
  el.style.display = "block";
  el.style.background = "#fee2e2";
  el.style.borderLeftColor = "#b91c1c";
  el.style.color = "#b91c1c";
  el.textContent = message;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showTicketSuccess(message, resetLabel, resetFnCall) {
  document.getElementById("ttk-feedback").style.display = "none";
  const el = document.getElementById("ttk-success");
  if (!el) return;
  document.getElementById("ttk-toggle-bar").style.display = "none";
  TTK_TOGGLES.forEach(t => { const panel = document.getElementById(`ttk-panel-${t}`); if (panel) panel.style.display = "none"; });
  el.style.display = "block";
  showSuccessWithReset("ttk-success", message, resetLabel, resetFnCall);
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ── Book a Ticket ─────────────────────────────────────────────────────

async function ttkRenderBookForm() {
  const panel = document.getElementById("ttk-panel-book");
  const editing = !!ttkEditingTicketId;
  panel.innerHTML = `
    <div style="background:var(--highlight-bg); padding:18px; border-radius:var(--radius);">
      ${editing ? `<div style="margin-bottom:12px; font-weight:700; color:var(--brand);">Editing Ticket #${ttkEditingTicketId}</div>` : ""}
      <div style="margin-bottom:16px; padding:14px; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <label class="field-label">Invoice Upload *</label>
        <input type="file" id="ttk-invoice-file" accept="image/*,application/pdf" multiple onchange="ttkHandleInvoiceFile(this)"
          style="width:100%; padding:7px 0;">
        <div id="ttk-invoice-file-list" style="font-size:0.75rem; color:var(--muted); margin-top:4px;"></div>
        <button type="button" class="nav-btn-styled" id="ttk-gemini-btn" onclick="ttkProcessWithGemini()" disabled
          style="margin-top:10px; padding:8px 16px; font-size:0.85rem; opacity:0.5;">✨ Process with Gemini</button>
        <div id="ttk-gemini-status" style="font-size:0.78rem; color:var(--muted); margin-top:6px;"></div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:12px;">
        <div style="flex:1;"><label class="field-label">Mode of Travel *</label>
          <select id="ttk-mode" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
            <option value="">Select...</option>${TTK_MODES.map(m => `<option value="${m}">${m}</option>`).join("")}
          </select></div>
        <div style="flex:1;"><label class="field-label">Trip Type *</label>
          <select id="ttk-trip-type" onchange="ttkOnTripTypeChange()" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;">
            <option value="">Select...</option>${TTK_TRIP_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select></div>
        <div style="flex:1;"><label class="field-label">From City *</label>
          <input type="text" id="ttk-from-city" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"></div>
        <div style="flex:1;"><label class="field-label">To City *</label>
          <input type="text" id="ttk-to-city" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"></div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:12px;">
        <div style="flex:1;"><label class="field-label">PNR / Ticket No</label>
          <input type="text" id="ttk-pnr" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"></div>
        <div style="flex:1;"><label class="field-label">Departure Date *</label>
          <input type="date" id="ttk-depart-date" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"></div>
        <div style="flex:1;" id="ttk-return-date-wrap"><label class="field-label">Return Date *</label>
          <input type="date" id="ttk-return-date" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"></div>
      </div>
      <div style="margin-bottom:12px; position:relative;">
        <label class="field-label">Company(ies) of Visit</label>
        <input type="text" id="ttk-company-search" placeholder="Type to search or add a company..." autocomplete="off"
          style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"
          oninput="ttkHandleCompanySearch(this.value)">
        <div id="ttk-company-dropdown" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
        <div id="ttk-company-chips" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;"></div>
      </div>

      <div style="margin-bottom:8px; font-weight:700;">Travellers *</div>
      <div id="ttk-traveller-rows"></div>
      <button type="button" class="nav-btn-styled" onclick="ttkAddTravellerRow()" style="margin-bottom:16px; padding:7px 14px; font-size:0.85rem;">+ Add Traveller</button>

      <div style="display:flex; justify-content:flex-end; margin-bottom:16px; font-weight:700;">
        Booking Total: <span id="ttk-total" style="margin-left:8px;">₹0</span>
      </div>

      <div style="margin-bottom:16px;">
        <label class="field-label">Remarks</label>
        <textarea id="ttk-remarks" rows="1" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px; resize:vertical;"></textarea>
      </div>
      <button class="nav-btn-styled" onclick="submitTravelTicket()">${editing ? "Save Changes" : "Save Ticket Booking"}</button>
      ${editing ? `<button class="nav-btn-styled" onclick="ttkCancelEdit()" style="margin-left:8px; background:#e2e8f0; color:#334155;">Cancel Edit</button>` : ""}
    </div>`;

  if (!editing) {
    ttkTravellerRows = [];
    ttkSelectedCompanies = [];
    ttkInvoiceFiles = [];
  }
  try {
    const [empData, companyData] = await Promise.all([
      acFetch("searchTourEmployees", {}),
      acFetch("listTourCompanies", {}),
    ]);
    ttkCachedEmployees = empData.success ? empData.employees : [];
    ttkCachedCompanies = companyData.success ? companyData.companies : [];
  } catch (e) { console.error("Travel Ticket Booking bootstrap failed:", e.message); }

  ttkRenderCompanyChips();
  ttkRenderTravellerRows();
  ttkOnTripTypeChange();
  enhanceAllDateInputsForDMY();
}

function ttkOnTripTypeChange() {
  const tripType = document.getElementById("ttk-trip-type").value;
  const wrap = document.getElementById("ttk-return-date-wrap");
  if (!wrap) return;
  wrap.style.display = (tripType === "Round Trip") ? "block" : "none";
  if (tripType !== "Round Trip") document.getElementById("ttk-return-date").value = "";
}

function ttkAddTravellerRow() {
  ttkTravellerRows.push({ employeeId: null, employeeName: "", empCode: "", price: "" });
  ttkRenderTravellerRows();
}

function ttkRemoveTravellerRow(idx) {
  ttkTravellerRows.splice(idx, 1);
  ttkRenderTravellerRows();
}

function ttkRenderTravellerRows() {
  const wrap = document.getElementById("ttk-traveller-rows");
  if (!wrap) return;
  if (ttkTravellerRows.length === 0) ttkTravellerRows.push({ employeeId: null, employeeName: "", empCode: "", price: "" });
  wrap.innerHTML = ttkTravellerRows.map((row, idx) => `
    <div style="display:flex; gap:10px; align-items:flex-end; margin-bottom:10px; position:relative;" data-row="${idx}">
      <div style="flex:2; position:relative;">
        <label class="field-label">Employee ${idx + 1}</label>
        <input type="text" class="ttk-traveller-search" data-row="${idx}" placeholder="Type to search employee..." autocomplete="off"
          value="${escapeHtml(row.employeeName)}"
          style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"
          oninput="ttkHandleTravellerSearch(${idx}, this.value)">
        <div class="ttk-traveller-dropdown" data-row="${idx}" style="display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:220px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div>
      </div>
      <div style="flex:1;"><label class="field-label">EMP ID</label>
        <input type="text" readonly value="${escapeHtml(row.empCode)}" style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px; background:#f1f5f9;"></div>
      <div style="flex:1;"><label class="field-label">Price (₹) *</label>
        <input type="number" min="0" value="${row.price}" oninput="ttkUpdateTravellerPrice(${idx}, this.value)"
          style="width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:6px;"></div>
      ${ttkTravellerRows.length > 1 ? `<button type="button" onclick="ttkRemoveTravellerRow(${idx})" style="padding:9px 12px; border:1px solid var(--border); border-radius:6px; background:#fff; cursor:pointer; color:#b91c1c;">✕</button>` : ""}
    </div>`).join("");
  ttkRecalcTotal();
}

function ttkHandleTravellerSearch(idx, query) {
  ttkTravellerRows[idx].employeeId = null;
  ttkTravellerRows[idx].employeeName = query;
  ttkTravellerRows[idx].empCode = "";
  const dd = document.querySelector(`.ttk-traveller-dropdown[data-row="${idx}"]`);
  const q = (query || "").trim().toLowerCase();
  if (!q || !dd) { if (dd) dd.style.display = "none"; return; }
  const takenIds = ttkTravellerRows.filter((r, i) => i !== idx && r.employeeId).map(r => r.employeeId);
  const matches = ttkCachedEmployees.filter(e => e.employeeName.toLowerCase().includes(q) && !takenIds.includes(e.employeeId)).slice(0, 15);
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.innerHTML = matches.map(e => `
    <div onmousedown="event.preventDefault(); ttkSelectTraveller(${idx}, ${e.employeeId})"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${escapeHtml(e.employeeName)} <span style="color:var(--muted); font-size:0.75rem;">${e.empCode ? '· ' + escapeHtml(e.empCode) : ''}</span>
    </div>`).join("");
  const input = document.querySelector(`.ttk-traveller-search[data-row="${idx}"]`);
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + "px"; dd.style.left = rect.left + "px"; dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function ttkSelectTraveller(idx, employeeId) {
  const emp = ttkCachedEmployees.find(e => e.employeeId === employeeId);
  if (!emp) return;
  ttkTravellerRows[idx].employeeId = employeeId;
  ttkTravellerRows[idx].employeeName = emp.employeeName;
  ttkTravellerRows[idx].empCode = emp.empCode || "";
  ttkRenderTravellerRows();
}

function ttkUpdateTravellerPrice(idx, value) {
  ttkTravellerRows[idx].price = value;
  ttkRecalcTotal();
}

function ttkRecalcTotal() {
  const total = ttkTravellerRows.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const el = document.getElementById("ttk-total");
  if (el) el.textContent = formatINRComma(total);
}

function ttkHandleCompanySearch(query) {
  const dd = document.getElementById("ttk-company-dropdown");
  const q = (query || "").trim().toLowerCase();
  if (!q) { dd.style.display = "none"; return; }
  const matches = ttkCachedCompanies.filter(c => c.companyName.toLowerCase().includes(q) && !ttkSelectedCompanies.includes(c.companyName)).slice(0, 15);
  const exactHit = ttkCachedCompanies.some(c => c.companyName.trim().toLowerCase() === q) || ttkSelectedCompanies.some(c => c.trim().toLowerCase() === q);
  let html = matches.map(c => `
    <div onmousedown="event.preventDefault(); ttkSelectCompany('${c.companyName.replace(/'/g, "\\'")}')"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${escapeHtml(c.companyName)}</div>`).join("");
  if (!exactHit && query.trim()) {
    html += `<div onmousedown="event.preventDefault(); ttkAddNewCompany('${query.trim().replace(/'/g, "\\'")}')"
      style="padding:8px 10px; cursor:pointer; font-size:0.85rem; color:var(--brand); font-weight:700;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">+ Add "${escapeHtml(query.trim())}" as a new company</div>`;
  }
  if (!html) { dd.style.display = "none"; return; }
  dd.innerHTML = html;
  const input = document.getElementById("ttk-company-search");
  const rect = input.getBoundingClientRect();
  dd.style.top = rect.bottom + "px"; dd.style.left = rect.left + "px"; dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function ttkSelectCompany(companyName) {
  if (!ttkSelectedCompanies.includes(companyName)) ttkSelectedCompanies.push(companyName);
  document.getElementById("ttk-company-search").value = "";
  document.getElementById("ttk-company-dropdown").style.display = "none";
  ttkRenderCompanyChips();
}

async function ttkAddNewCompany(companyName) {
  document.getElementById("ttk-company-dropdown").style.display = "none";
  try {
    const data = await acFetch("addTourCompany", { companyName });
    if (data.success) {
      ttkCachedCompanies.push(data.company);
      ttkSelectCompany(data.company.companyName);
    } else {
      alert("Could not add company: " + data.error);
    }
  } catch (e) { alert("Network error adding company: " + e.message); }
}

function ttkRemoveCompanyChip(companyName) {
  ttkSelectedCompanies = ttkSelectedCompanies.filter(c => c !== companyName);
  ttkRenderCompanyChips();
}

function ttkRenderCompanyChips() {
  const wrap = document.getElementById("ttk-company-chips");
  if (!wrap) return;
  wrap.innerHTML = ttkSelectedCompanies.map(c => `
    <span style="background:var(--brand); color:#fff; padding:4px 10px; border-radius:14px; font-size:0.8rem; display:inline-flex; align-items:center; gap:6px;">
      ${escapeHtml(c)} <span onclick="ttkRemoveCompanyChip('${c.replace(/'/g, "\\'")}')" style="cursor:pointer; font-weight:700;">✕</span>
    </span>`).join("");
}

function ttkHandleInvoiceFile(input) {
  const files = [...input.files];
  if (files.length === 0) { ttkInvoiceFiles = []; ttkRenderInvoiceFileList(); return; }
  ttkInvoiceFiles = new Array(files.length);
  let loaded = 0;
  files.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result.split(",")[1];
      ttkInvoiceFiles[idx] = { base64Data, fileName: file.name, mimeType: file.type };
      loaded++;
      if (loaded === files.length) ttkRenderInvoiceFileList();
    };
    reader.readAsDataURL(file);
  });
}

function ttkRenderInvoiceFileList() {
  const el = document.getElementById("ttk-invoice-file-list");
  if (el) {
    el.textContent = ttkInvoiceFiles.length
      ? `${ttkInvoiceFiles.length} file(s) selected: ${ttkInvoiceFiles.map(f => f.fileName).join(", ")}`
      : "";
  }
  const btn = document.getElementById("ttk-gemini-btn");
  if (btn) {
    btn.disabled = ttkInvoiceFiles.length === 0;
    btn.style.opacity = ttkInvoiceFiles.length === 0 ? "0.5" : "1";
  }
}

async function ttkProcessWithGemini() {
  if (ttkInvoiceFiles.length === 0) return;
  const btn = document.getElementById("ttk-gemini-btn");
  const status = document.getElementById("ttk-gemini-status");
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Reading document(s) with Gemini...";
  try {
    const data = await acFetch("extractTravelTicketFromDocs", {
      invoices: ttkInvoiceFiles,
      employees: ttkCachedEmployees.map(e => ({ employeeId: e.employeeId, employeeName: e.employeeName })),
    });
    if (!data.success) {
      if (status) status.textContent = "";
      showTicketFeedback(data.error || "Gemini extraction failed.", "error");
      return;
    }
    const x = data.extracted;
    if (x.modeOfTravel) document.getElementById("ttk-mode").value = x.modeOfTravel;
    if (x.tripType) document.getElementById("ttk-trip-type").value = x.tripType;
    ttkOnTripTypeChange();
    if (x.fromCity) document.getElementById("ttk-from-city").value = x.fromCity;
    if (x.toCity) document.getElementById("ttk-to-city").value = x.toCity;
    if (x.departDate) document.getElementById("ttk-depart-date").value = x.departDate;
    if (x.tripType === "Round Trip" && x.returnDate) document.getElementById("ttk-return-date").value = x.returnDate;
    if (x.pnrNumber) document.getElementById("ttk-pnr").value = x.pnrNumber;

    if (Array.isArray(x.travellers) && x.travellers.length > 0) {
      ttkTravellerRows = x.travellers.map(t => {
        if (t.matchedEmployeeId) {
          const emp = ttkCachedEmployees.find(e => e.employeeId === t.matchedEmployeeId);
          if (emp) return { employeeId: emp.employeeId, employeeName: emp.employeeName, empCode: emp.empCode || "", price: t.price || "" };
        }
        return { employeeId: null, employeeName: t.name || "", empCode: "", price: t.price || "" };
      });
      ttkRenderTravellerRows();
    }
    if (status) status.textContent = "✓ Fields filled from Gemini — please review before saving.";
  } catch (e) {
    if (status) status.textContent = "";
    showTicketFeedback("Network error: " + e.message, "error");
  } finally {
    if (btn) btn.disabled = ttkInvoiceFiles.length === 0;
  }
}

document.addEventListener("click", (e) => {
  document.querySelectorAll(".ttk-traveller-dropdown").forEach(dd => {
    if (!e.target.closest(".ttk-traveller-dropdown") && !e.target.classList.contains("ttk-traveller-search")) dd.style.display = "none";
  });
  const companyDd = document.getElementById("ttk-company-dropdown");
  if (companyDd && !e.target.closest("#ttk-company-dropdown") && e.target.id !== "ttk-company-search") companyDd.style.display = "none";
});

function ttkCancelEdit() {
  ttkEditingTicketId = null;
  ttkRenderBookForm();
}

async function submitTravelTicket() {
  const modeOfTravel = document.getElementById("ttk-mode").value;
  const tripType = document.getElementById("ttk-trip-type").value;
  const fromCity = document.getElementById("ttk-from-city").value.trim();
  const toCity = document.getElementById("ttk-to-city").value.trim();
  const departDate = document.getElementById("ttk-depart-date").value;
  const returnDate = document.getElementById("ttk-return-date").value;
  const pnrNumber = document.getElementById("ttk-pnr").value.trim();
  const remarks = document.getElementById("ttk-remarks").value.trim();

  if (!modeOfTravel) return showTicketFeedback("Mode of Travel is required.", "error");
  if (!tripType) return showTicketFeedback("Trip Type is required.", "error");
  if (!fromCity || !toCity) return showTicketFeedback("From City and To City are required.", "error");
  if (!departDate) return showTicketFeedback("Departure Date is required.", "error");
  if (tripType === "Round Trip" && !returnDate) return showTicketFeedback("Return Date is required for a Round Trip.", "error");
  if (ttkTravellerRows.some(r => !r.employeeId)) return showTicketFeedback("Every traveller row needs an employee selected from the dropdown.", "error");
  if (ttkTravellerRows.some(r => r.price === "" || isNaN(Number(r.price)) || Number(r.price) < 0)) {
    return showTicketFeedback("Every traveller needs a valid, non-negative price.", "error");
  }
  // Invoice Upload is compulsory on create; on Edit, an existing ticket
  // already has at least one (enforced at create time), so a new upload
  // there is optional — it appends, never replaces.
  if (!ttkEditingTicketId && ttkInvoiceFiles.length === 0) {
    return showTicketFeedback("Invoice Upload is required — select at least one file.", "error");
  }

  const payload = {
    modeOfTravel, tripType, fromCity, toCity, departDate, returnDate: tripType === "Round Trip" ? returnDate : null,
    pnrNumber: pnrNumber || null, remarks: remarks || null,
    companies: ttkSelectedCompanies,
    travellers: ttkTravellerRows.map(r => ({ employeeId: r.employeeId, price: Number(r.price) })),
    invoices: ttkInvoiceFiles,
  };

  showBlockingOverlay(ttkEditingTicketId ? "Saving changes..." : "Booking ticket...");
  try {
    const data = ttkEditingTicketId
      ? await acFetch("updateTravelTicket", { ticketId: ttkEditingTicketId, ...payload })
      : await acFetch("createTravelTicket", payload);
    hideBlockingOverlay();
    if (data.success) {
      const wasEditing = !!ttkEditingTicketId;
      ttkEditingTicketId = null;
      const travellerNames = ttkTravellerRows.map(r => r.employeeName).filter(Boolean).join(", ");
      showTicketSuccess(
        wasEditing ? "Travel ticket updated." : `${modeOfTravel} ticket booked for ${travellerNames}, Total Price: ${formatINRComma(data.totalPrice || 0)}`,
        "Book Another Ticket", "switchTravelTicketToggle('book')"
      );
    } else {
      showTicketFeedback(data.error, "error");
    }
  } catch (e) { hideBlockingOverlay(); showTicketFeedback("Network error: " + e.message, "error"); }
}

// ── Search / Manage ───────────────────────────────────────────────────

async function ttkInitializeManagePanel() {
  const panel = document.getElementById("ttk-panel-manage");
  panel.innerHTML = `
    <div style="display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; align-items:flex-end;">
      <div><label class="field-label">Status</label>
        <select id="ttk-filter-status" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px;">
          <option value="">All</option><option value="Booked">Booked</option><option value="Cancelled">Cancelled</option>
        </select></div>
      <div><label class="field-label">Actioned</label>
        <select id="ttk-filter-actioned" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px;">
          <option value="">All</option><option value="Unactioned">Unactioned</option><option value="Actioned">Actioned</option>
        </select></div>
      <div><label class="field-label">Mode</label>
        <select id="ttk-filter-mode" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px;">
          <option value="">All</option>${TTK_MODES.map(m => `<option value="${m}">${m}</option>`).join("")}
        </select></div>
      <div><label class="field-label">Department</label>
        <select id="ttk-filter-dept" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px;"><option value="">All</option></select></div>
      <div><label class="field-label">From City</label>
        <input type="text" id="ttk-filter-from-city" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px;"></div>
      <div><label class="field-label">To City</label>
        <input type="text" id="ttk-filter-to-city" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px;"></div>
      <div><label class="field-label">Departure Date</label>
        <input type="date" id="ttk-filter-depart-date" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px;"></div>
      <button class="nav-btn-styled" onclick="ttkRunSearch()">Search</button>
    </div>
    <div id="ttk-search-label" style="display:none; font-weight:700; color:var(--brand); margin-bottom:10px; font-size:0.9rem; line-height:1.7;"></div>
    <div id="ttk-search-totals" style="margin-bottom:12px; font-weight:700;"></div>
    <div id="ttk-search-results"></div>`;
  enhanceAllDateInputsForDMY();
  try {
    const deptData = await acFetch("listTourDepartments", {});
    if (deptData.success) {
      document.getElementById("ttk-filter-dept").innerHTML += deptData.departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
    }
  } catch (e) { console.error("Travel ticket department filter bootstrap failed:", e.message); }
  ttkRunSearch();
}

function ttkBuildSearchLabel() {
  const esc = (s) => (s || "").toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const val = (s) => `<span style="color:var(--brand);">${esc(s || 'All')}</span>`;
  const statusLabel = document.getElementById("ttk-filter-status").value || "All";
  const actionedLabel = document.getElementById("ttk-filter-actioned").value || "All";
  const modeLabel = document.getElementById("ttk-filter-mode").value || "All";
  const deptLabel = document.getElementById("ttk-filter-dept").value || "All";
  const fromCityLabel = document.getElementById("ttk-filter-from-city").value || "All";
  const toCityLabel = document.getElementById("ttk-filter-to-city").value || "All";
  const departDateVal = document.getElementById("ttk-filter-depart-date").value;
  const departDateLabel = departDateVal ? formatOrdinalDate(departDateVal) : "All";
  return `<span style="color:#000;">Searching for</span>` +
    `<br><span style="color:#000;">Status:</span> ${val(statusLabel)} &nbsp; <span style="color:#000;">Actioned:</span> ${val(actionedLabel)} &nbsp; <span style="color:#000;">Mode:</span> ${val(modeLabel)} &nbsp; <span style="color:#000;">Department:</span> ${val(deptLabel)}` +
    `<br><span style="color:#000;">From City:</span> ${val(fromCityLabel)} &nbsp; <span style="color:#000;">To City:</span> ${val(toCityLabel)}` +
    `<br><span style="color:#000;">Departure Date:</span> ${val(departDateLabel)}`;
}

async function ttkRunSearch() {
  const lbl = document.getElementById("ttk-search-label");
  lbl.style.display = "block";
  lbl.innerHTML = ttkBuildSearchLabel();

  const results = document.getElementById("ttk-search-results");
  results.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading...</div>`;
  try {
    const data = await acFetch("searchTravelTickets", {
      status: document.getElementById("ttk-filter-status").value || null,
      actionedFilter: document.getElementById("ttk-filter-actioned").value || null,
      modeOfTravel: document.getElementById("ttk-filter-mode").value || null,
      departmentName: document.getElementById("ttk-filter-dept").value || null,
      fromCity: document.getElementById("ttk-filter-from-city").value.trim() || null,
      toCity: document.getElementById("ttk-filter-to-city").value.trim() || null,
      departDate: document.getElementById("ttk-filter-depart-date").value || null,
    });
    if (!data.success) { results.innerHTML = `<p style="color:var(--warn);">${escapeHtml(data.error)}</p>`; return; }
    document.getElementById("ttk-search-totals").textContent =
      `Total Live Booking Value: ${formatINRComma(data.totalLivePrice)} · Total Refunded: ${formatINRComma(data.totalRefund)}`;
    ttkLastSearchTickets = data.tickets;
    if (data.tickets.length === 0) {
      results.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted); background:var(--highlight-bg); border-radius:var(--radius);">No travel tickets found.</div>`;
      return;
    }
    results.innerHTML = ttkRenderTicketsTable(data.tickets);
  } catch (e) { results.innerHTML = `<p style="color:var(--warn);">${escapeHtml(e.message)}</p>`; }
}

// Same bordered/wrapping table shape as voucher-search.js's
// tvsRenderAdvanceTable — one row per TRAVELLER (a ticket with 3
// travellers renders 3 rows), since Emp Name/Department/Amount/Status
// are all per-traveller, not per-ticket. Ticket-level fields (Mode,
// Route, Trip Type, dates, Companies, Booked On/By, Doc link) repeat
// identically across every traveller row of the same ticket.
function ttkRenderTicketsTable(tickets) {
  const colBorder = "border-left:2px solid var(--border);";
  const cell = "padding:6px; font-size:0.82rem; color:#000; text-align:center; vertical-align:middle; word-wrap:break-word; overflow-wrap:break-word;";
  const rows = [];
  tickets.forEach(t => {
    const dateOfTravel = t.tripType === 'Round Trip' && t.returnDate
      ? `${formatOrdinalDate(t.departDate)} → ${formatOrdinalDate(t.returnDate)}` : formatOrdinalDate(t.departDate);
    const companiesCell = (t.companiesOfVisit || []).length ? t.companiesOfVisit.map(escapeHtml).join(", ") : "—";
    const invoices = t.invoices || [];
    const docCell = invoices.length
      ? invoices.map((inv, idx) => `<a href="${driveLink(inv.url)}" target="_blank" rel="noopener">${escapeHtml(inv.fileName || `Invoice ${idx + 1}`)}</a>`).join("<br>")
      : "—";
    const bookedOrCancelled = t.status === 'Cancelled'
      ? `<span style="color:#b91c1c; font-weight:700;">Cancelled</span>`
      : `<span style="color:#15803d; font-weight:700;">Booked</span>`;
    const actionsCell = t.status === 'Cancelled'
      ? `<span style="color:var(--muted); font-size:0.72rem;">${t.cancelReason ? escapeHtml(t.cancelReason) : '—'}</span>`
      : `<button class="nav-btn-styled" onclick="ttkStartEdit(${t.ticketId})" style="padding:4px 8px; font-size:0.72rem;">Edit</button>
         <button class="nav-btn-styled" onclick="ttkCancelTicket(${t.ticketId})" style="padding:4px 8px; font-size:0.72rem; margin-top:3px; background:#fee2e2; color:#b91c1c;">Cancel</button>`;
    const travellers = t.travellers && t.travellers.length ? t.travellers : [null];
    travellers.forEach(tv => {
      const statusColor = !tv ? { bg: '#f1f5f9', fg: 'var(--muted)' }
        : tv.status === 'Linked' ? { bg: '#dcfce7', fg: '#15803d' }
        : tv.status === 'Cancelled' ? { bg: '#fee2e2', fg: '#b91c1c' } : { bg: '#e0f2fe', fg: '#0369a1' };
      rows.push(`
        <tr style="border-bottom:2px solid var(--border);">
          <td style="${cell} font-weight:700;">${tv ? escapeHtml(tv.employeeName) : '—'}</td>
          <td style="${cell} ${colBorder}">${tv ? escapeHtml(tv.departmentName || '—') : '—'}</td>
          <td style="${cell} ${colBorder} font-weight:700;">${tv ? formatINRComma(tv.price) : '—'}</td>
          <td style="${cell} ${colBorder}"><span style="padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700; background:${statusColor.bg}; color:${statusColor.fg};">${tv ? tv.status : '—'}</span></td>
          <td style="${cell} ${colBorder}">${escapeHtml(t.modeOfTravel)}</td>
          <td style="${cell} ${colBorder}">${escapeHtml(t.fromCity)} → ${escapeHtml(t.toCity)}</td>
          <td style="${cell} ${colBorder}">${escapeHtml(t.tripType)}</td>
          <td style="${cell} ${colBorder}">${dateOfTravel}</td>
          <td style="${cell} ${colBorder}">${tv && tv.linkedVoucherNumber ? escapeHtml(tv.linkedVoucherNumber) : '—'}</td>
          <td style="${cell} ${colBorder}">${companiesCell}</td>
          <td style="${cell} ${colBorder}">${formatOrdinalDate(t.bookingDate)}</td>
          <td style="${cell} ${colBorder}">${escapeHtml(t.bookedBy)}</td>
          <td style="${cell} ${colBorder}">${bookedOrCancelled}</td>
          <td style="${cell} ${colBorder}">${docCell}</td>
          <td style="${cell} ${colBorder}">${actionsCell}</td>
        </tr>`);
    });
  });
  const th = "padding:6px; text-align:center; font-size:0.72rem; text-transform:uppercase; color:var(--muted); vertical-align:middle;";
  const headers = ["Emp Name", "Department", "Amount", "Status", "Mode of Travel", "Route", "Trip Type", "Date of Travel", "PRN", "Companies", "Booked On", "Booked By", "Booked or Cancelled", "Doc Link", "Actions"];
  return `
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
        <thead><tr style="background:var(--highlight-bg); border-bottom:2px solid var(--border);">
          ${headers.map((h, i) => `<th style="${th} ${i > 0 ? colBorder : ''}">${h}</th>`).join("")}
        </tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`;
}

async function ttkStartEdit(ticketId) {
  try {
    const data = await acFetch("searchTravelTickets", {});
    if (!data.success) return showTicketFeedback(data.error, "error");
    const t = data.tickets.find(x => x.ticketId === ticketId);
    if (!t) return showTicketFeedback("Ticket not found.", "error");
    ttkEditingTicketId = ticketId;
    ttkTravellerRows = (t.travellers || []).map(tv => ({ employeeId: tv.employeeId, employeeName: tv.employeeName, empCode: tv.empCode || "", price: tv.price }));
    ttkSelectedCompanies = t.companiesOfVisit || [];
    ttkInvoiceFiles = [];
    switchTravelTicketToggle("book");
    await ttkRenderBookForm();
    document.getElementById("ttk-mode").value = t.modeOfTravel;
    document.getElementById("ttk-trip-type").value = t.tripType;
    ttkOnTripTypeChange();
    document.getElementById("ttk-from-city").value = t.fromCity;
    document.getElementById("ttk-to-city").value = t.toCity;
    document.getElementById("ttk-depart-date").value = t.departDate ? t.departDate.slice(0, 10) : "";
    if (t.returnDate) document.getElementById("ttk-return-date").value = t.returnDate.slice(0, 10);
    document.getElementById("ttk-pnr").value = t.pnrNumber || "";
    document.getElementById("ttk-remarks").value = t.remarks || "";
    ttkRenderCompanyChips();
    ttkRenderTravellerRows();
    enhanceAllDateInputsForDMY();
  } catch (e) { showTicketFeedback("Network error: " + e.message, "error"); }
}

async function ttkCancelTicket(ticketId) {
  const refundInput = prompt("Refund amount received from the vendor (leave blank if none):");
  if (refundInput === null) return;
  const reason = prompt("Reason for cancelling (optional):") || null;
  const refundAmount = refundInput.trim() === "" ? null : Number(refundInput);
  if (refundInput.trim() !== "" && (isNaN(refundAmount) || refundAmount < 0)) return showTicketFeedback("Refund amount must be a valid non-negative number.", "error");

  showBlockingOverlay("Cancelling ticket...");
  try {
    const data = await acFetch("cancelTravelTicket", { ticketId, refundAmount, cancelReason: reason });
    hideBlockingOverlay();
    if (data.success) { ttkRunSearch(); } else { showTicketFeedback(data.error, "error"); }
  } catch (e) { hideBlockingOverlay(); showTicketFeedback("Network error: " + e.message, "error"); }
}
