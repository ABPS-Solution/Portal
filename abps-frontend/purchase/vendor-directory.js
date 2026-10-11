// Purchase → Tracking & Search → Vendor Directory (perm_vendor_directory,
// migration 250). Backend: routes/vendorDirectory.js.
let vdVendors = [];
let vdTypes = [];
let vdFilter = "Active";

const vdEsc = (v) => escapeHtml(v == null ? "" : String(v));
const vdMoney = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

async function initializeVendorDirectoryPanel() {
  const root = document.getElementById("vd-root");
  if (!root) return;
  vdFilter = "Active";
  root.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading vendors...</div>`;
  try {
    const data = await apFetch({ action: "fetchVendorDirectory" });
    if (!data.success) throw new Error(data.error || "Could not load vendors.");
    vdVendors = data.vendors || [];
    vdTypes = data.vendorTypes || [];
    vdRenderList();
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") root.innerHTML = `<div style="padding:16px; color:#b91c1c; font-weight:700;">${vdEsc(e.message)}</div>`;
  }
}

function vdFeedback(ok, msg) {
  const fb = document.getElementById("vd-feedback");
  if (!fb) return;
  fb.style.cssText = ok
    ? "display:block; background:#dcfce7; border-left:4px solid #15803d; color:#15803d; padding:10px 12px; margin-bottom:12px; font-weight:700; border-radius:4px;"
    : "display:block; background:#fee2e2; border-left:4px solid #b91c1c; color:#b91c1c; padding:10px 12px; margin-bottom:12px; font-weight:700; border-radius:4px;";
  fb.textContent = msg;
  fb.scrollIntoView({ behavior: "smooth", block: "center" });
}

function vdRenderList() {
  const root = document.getElementById("vd-root");
  const counts = {
    Active: vdVendors.filter(v => v.status === "Active").length,
    Inactive: vdVendors.filter(v => v.status !== "Active").length,
    Incomplete: vdVendors.filter(v => v.incomplete && v.status === "Active").length,
    All: vdVendors.length,
  };
  const pill = (k) => `<button type="button" class="nav-btn-styled vd-pill" onclick="vdSetFilter('${k}')"
      style="width:auto; padding:6px 14px; font-size:0.82rem; font-weight:700; background:${vdFilter === k ? "var(--brand)" : "#e2e8f0"}; color:${vdFilter === k ? "#fff" : "#334155"};">${k === "Incomplete" ? "Details Incomplete" : k} (${counts[k]})</button>`;
  root.innerHTML = `
    <div id="vd-feedback" style="display:none;"></div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
      <input type="text" id="vd-search" placeholder="Search name, GSTIN, city, contact, phone, email..." autocomplete="off"
        oninput="vdRenderCards()" style="flex:1 1 280px; padding:9px; font-weight:600;">
      <button type="button" class="nav-btn-styled" style="width:auto; background:var(--accent); padding:9px 18px; font-weight:700;" onclick="vdOpenForm(null)">+ Add Vendor</button>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">${["Active", "Incomplete", "Inactive", "All"].map(pill).join("")}</div>
    <div id="vd-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;"></div>
    <div id="vd-detail"></div>`;
  vdRenderCards();
}

function vdSetFilter(k) { vdFilter = k; vdRenderList(); }

function vdMatches(v, q) {
  if (!q) return true;
  const hay = [v.vendorName, v.gstin, v.city, v.state, v.contactPerson, v.phoneNumber, v.email, v.typeOfVendor]
    .filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9@ ]/g, " ");
  return q.toLowerCase().replace(/[^a-z0-9@ ]/g, " ").split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function vdRenderCards() {
  const box = document.getElementById("vd-cards");
  if (!box) return;
  const q = (document.getElementById("vd-search")?.value || "").trim();
  const list = vdVendors.filter(v =>
    (vdFilter === "All" || (vdFilter === "Active" && v.status === "Active") || (vdFilter === "Inactive" && v.status !== "Active")
      || (vdFilter === "Incomplete" && v.incomplete && v.status === "Active")) && vdMatches(v, q));
  if (list.length === 0) {
    box.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:24px; color:var(--muted); background:#fff; border:1px solid var(--border); border-radius:6px;">No vendors match.</div>`;
    return;
  }
  box.innerHTML = list.map(v => {
    const done = (Number(v.onTime) || 0) + (Number(v.late) || 0);
    const onTimePct = done ? Math.round((Number(v.onTime) || 0) * 100 / done) + "%" : "—";
    return `
    <div onclick="vdOpenProfile(${jsArg(v.vendorName)})" style="cursor:pointer; background:#fff; border:1.5px solid var(--border); border-left:4px solid ${v.status === "Active" ? "#7c3aed" : "#94a3b8"}; border-radius:8px; padding:12px 14px; display:flex; flex-direction:column; gap:6px;"
      onmouseover="this.style.borderColor='var(--brand)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
        <div style="font-weight:800; color:var(--brand); line-height:1.3;">${vdEsc(v.vendorName)}</div>
        ${v.status !== "Active" ? `<span style="font-size:0.68rem; font-weight:800; background:#e2e8f0; color:#475569; padding:2px 8px; border-radius:999px;">INACTIVE</span>`
          : v.incomplete ? `<span style="font-size:0.68rem; font-weight:800; background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:999px; white-space:nowrap;">DETAILS INCOMPLETE</span>` : ""}
      </div>
      <div style="font-size:0.8rem; color:#475569;">${[v.typeOfVendor, [v.city, v.state].filter(Boolean).join(", ")].filter(Boolean).map(vdEsc).join(" · ") || "&nbsp;"}</div>
      ${v.gstin ? `<div style="font-size:0.78rem; font-family:monospace; color:#334155;">GSTIN ${vdEsc(v.gstin)}</div>` : ""}
      <div style="display:flex; gap:14px; flex-wrap:wrap; border-top:1px dashed var(--border); padding-top:6px; font-size:0.78rem; color:#334155;">
        <span><strong>${Number(v.poCount) || 0}</strong> POs</span>
        <span><strong>${vdMoney(v.poValue)}</strong></span>
        <span>On time <strong>${onTimePct}</strong></span>
      </div>
    </div>`;
  }).join("");
}

// ── Add / Edit form ──────────────────────────────────────────────────────
function vdOpenForm(vendorName) {
  const v = vendorName ? vdVendors.find(x => x.vendorName === vendorName) : null;
  const ov = document.createElement("div");
  ov.id = "vd-form-overlay";
  ov.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.5); z-index:9000; display:flex; align-items:flex-start; justify-content:center; padding:30px 16px; overflow-y:auto;";
  const field = (id, label, val, extra) => `<div><label class="field-label" style="margin-top:0;">${label}</label>
      <input type="text" id="vdf-${id}" value="${vdEsc(val)}" ${extra || ""} style="width:100%; padding:8px;"></div>`;
  ov.innerHTML = `
    <div style="background:var(--card, #fff); border-radius:var(--radius, 8px); width:100%; max-width:760px; box-shadow:0 12px 32px rgba(0,0,0,0.25); overflow:hidden;">
      <div style="background:var(--brand); color:#fff; padding:14px 20px; display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0; font-size:1.05rem; color:#fff;">${v ? "Edit Vendor" : "Add Vendor"}</h3>
        <button type="button" onclick="document.getElementById('vd-form-overlay').remove()" style="background:none; border:none; font-size:1.5rem; line-height:1; cursor:pointer; color:#fff; width:auto; padding:0;">×</button>
      </div>
      <div style="padding:18px 20px; display:grid; grid-template-columns:1fr 1fr; gap:12px 16px;">
        <div style="grid-column:1/-1;">${field("vendorName", "Vendor Name *", v && v.vendorName)}</div>
        ${field("gstin", "GSTIN", v && v.gstin, 'maxlength="15" oninput="this.value=this.value.toUpperCase(); vdGstinState()"')}
        <div><label class="field-label" style="margin-top:0;">Type of Vendor</label>
          <select id="vdf-typeOfVendor" style="width:100%; padding:8px;"><option value="">— Select —</option>
            ${vdTypes.map(t => `<option ${v && v.typeOfVendor === t ? "selected" : ""}>${vdEsc(t)}</option>`).join("")}</select></div>
        ${field("contactPerson", "Contact Person", v && v.contactPerson)}
        ${field("phoneNumber", "Phone", v && v.phoneNumber, 'inputmode="tel"')}
        ${field("email", "Email", v && v.email, 'inputmode="email"')}
        ${field("city", "City", v && v.city)}
        ${field("state", "State", v && v.state)}
        ${field("stateCode", "State Code", v && v.stateCode, 'maxlength="2"')}
        <div style="grid-column:1/-1;"><label class="field-label" style="margin-top:0;">Address</label>
          <textarea id="vdf-address" rows="2" style="width:100%; padding:8px; font-family:inherit;">${vdEsc(v && v.address)}</textarea></div>
        ${field("cgstPercent", "CGST %", v && v.cgstPercent != null ? Number(v.cgstPercent) : "", 'inputmode="decimal"')}
        ${field("sgstPercent", "SGST %", v && v.sgstPercent != null ? Number(v.sgstPercent) : "", 'inputmode="decimal"')}
        ${field("igstPercent", "IGST %", v && v.igstPercent != null ? Number(v.igstPercent) : "", 'inputmode="decimal"')}
        <div id="vdf-error" style="grid-column:1/-1; display:none; color:#b91c1c; font-weight:700; font-size:0.85rem;"></div>
        <div style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="nav-btn-styled" style="width:auto; background:#718096; padding:8px 18px; font-weight:700;" onclick="document.getElementById('vd-form-overlay').remove()">Cancel</button>
          <button type="button" class="nav-btn-styled" id="vdf-save" style="width:auto; background:var(--accent); padding:8px 20px; font-weight:700;" onclick="vdSave(${v ? jsArg(v.vendorName) : "null"})">${v ? "Save Changes" : "Add Vendor"}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  document.getElementById("vdf-vendorName").focus();
}

// GSTIN's first two digits are the state code.
const VD_GST_STATES = { "01":"Jammu and Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh","10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat","26":"Dadra and Nagar Haveli and Daman and Diu","27":"Maharashtra","29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu","34":"Puducherry","35":"Andaman and Nicobar Islands","36":"Telangana","37":"Andhra Pradesh","38":"Ladakh","97":"Other Territory" };
function vdGstinState() {
  const g = (document.getElementById("vdf-gstin")?.value || "").trim();
  const code = g.slice(0, 2);
  if (g.length >= 2 && VD_GST_STATES[code]) {
    document.getElementById("vdf-stateCode").value = code;
    document.getElementById("vdf-state").value = VD_GST_STATES[code];
  }
}

async function vdSave(originalName) {
  const val = (id) => (document.getElementById("vdf-" + id)?.value || "").trim();
  const vendor = {};
  ["vendorName", "gstin", "typeOfVendor", "contactPerson", "phoneNumber", "email", "city", "state", "stateCode", "address", "cgstPercent", "sgstPercent", "igstPercent"]
    .forEach(k => vendor[k] = val(k));
  const err = document.getElementById("vdf-error");
  if (!vendor.vendorName) { err.textContent = "Vendor name is required."; err.style.display = "block"; return; }
  const btn = document.getElementById("vdf-save");
  btn.disabled = true;
  try {
    const data = await apFetch({ action: "saveVendor", originalName, vendor });
    if (!data.success) { err.textContent = data.error || "Could not save."; err.style.display = "block"; btn.disabled = false; return; }
    document.getElementById("vd-form-overlay").remove();
    await initializeVendorDirectoryPanel();
    vdFeedback(true, originalName ? `${data.vendorName} saved.` : `${data.vendorName} added.`);
    vdOpenProfile(data.vendorName);
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") { err.textContent = e.message; err.style.display = "block"; }
    btn.disabled = false;
  }
}

// ── Vendor profile ───────────────────────────────────────────────────────
async function vdOpenProfile(vendorName) {
  const box = document.getElementById("vd-detail");
  if (!box) return;
  box.innerHTML = `<div style="margin-top:16px; padding:20px; text-align:center; color:var(--muted);">Loading ${vdEsc(vendorName)}...</div>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const d = await apFetch({ action: "fetchVendorProfile", vendorName });
    if (!d.success) throw new Error(d.error || "Could not load the vendor.");
    box.innerHTML = vdProfileHtml(d);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") box.innerHTML = `<div style="margin-top:16px; color:#b91c1c; font-weight:700;">${vdEsc(e.message)}</div>`;
  }
}

function vdProfileHtml(d) {
  const v = d.vendor, p = d.purchase || {}, perf = d.performance || {}, rej = d.rejections || {};
  const done = (Number(perf.on_time_deliveries) || 0) + (Number(perf.late_deliveries) || 0);
  const onTime = done ? Math.round((Number(perf.on_time_deliveries) || 0) * 100 / done) + "%" : "—";
  const recv = Number(perf.total_quantity_received) || 0;
  const rejPct = recv ? (Math.round((Number(perf.qa_rejected_quantity) || 0) * 1000 / recv) / 10) + "%" : "—";
  const tile = (label, value, sub) => `<div style="background:#fff; border:1px solid var(--border); border-radius:8px; padding:10px 12px;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#64748b;">${label}</div>
      <div style="font-size:1.25rem; font-weight:800; color:#0f172a; margin-top:2px;">${value}</div>
      ${sub ? `<div style="font-size:0.75rem; color:#64748b;">${sub}</div>` : ""}</div>`;
  const kv = (k, val) => `<div><span style="color:#64748b; font-size:0.78rem;">${k}</span><div style="font-weight:600;">${val ? vdEsc(val) : "—"}</div></div>`;
  const th = (t, al) => `<th style="border:1px solid var(--border); padding:7px; text-align:${al || "center"}; background:var(--highlight-bg);">${t}</th>`;
  const td = (h, al) => `<td style="border:1px solid var(--border); padding:7px; text-align:${al || "center"}; vertical-align:middle;">${h}</td>`;
  const tableWrap = (head, rows, empty) => rows.length
    ? `<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.84rem; min-width:620px;"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<div style="color:var(--muted); padding:8px 0;">${empty}</div>`;
  const section = (title, body) => `<div style="margin-top:16px;"><div class="sec-label" style="margin:0 0 8px 0;">${title}</div>${body}</div>`;
  const mats = d.materials.map(m => `<tr>${td(`<div style="font-weight:600;">${vdEsc(m.materialName)}</div><div style="font-size:0.75rem; color:#64748b;">${vdEsc(m.itemCode)}</div>`, "left")}
      ${td(vdEsc(m.unit))}${td(fmtQty(m.totalQty))}${td(m.poCount)}${td(vdMoney(m.lastRate))}${td(`${vdMoney(m.minRate)} – ${vdMoney(m.maxRate)}`)}${td(formatOrdinalDate(m.lastPoDate))}</tr>`);
  const pos = d.recentPos.map(r => `<tr>${td(`<strong>${vdEsc(r.poNo)}</strong>`, "left")}${td(formatOrdinalDate(r.orderDate))}${td(vdEsc(r.status))}${td(vdMoney(r.grandTotal))}</tr>`);
  const grns = d.grns.map(g => `<tr>${td(`<strong>${vdEsc(g.grnNumber)}</strong>`, "left")}${td(formatOrdinalDate(g.date))}${td(vdEsc(g.poNos || "—"))}${td(g.lines)}${td(fmtQty(g.ok))}${td(fmtQty(g.notOk))}${td(fmtQty(g.missing))}</tr>`);
  return `
    <div style="margin-top:18px; background:#f8fafc; border:1.5px solid #94a3b8; border-left:5px solid #7c3aed; border-radius:8px; padding:14px 16px;">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
        <div>
          <div style="font-size:1.15rem; font-weight:800; color:var(--brand);">${vdEsc(v.vendorName)}</div>
          <div style="font-size:0.82rem; color:#475569;">${[v.typeOfVendor, v.status === "Active" ? "Active" : "Inactive"].filter(Boolean).map(vdEsc).join(" · ")}${v.incomplete ? ` · <span style="color:#b45309; font-weight:700;">Details incomplete</span>` : ""}</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="nav-btn-styled" style="width:auto; background:var(--brand); padding:7px 16px; font-weight:700;" onclick="vdOpenForm(${jsArg(v.vendorName)})">Edit</button>
          <button type="button" class="nav-btn-styled" style="width:auto; background:${v.status === "Active" ? "#b45309" : "var(--accent)"}; padding:7px 16px; font-weight:700;" onclick="vdSetStatus(${jsArg(v.vendorName)}, '${v.status === "Active" ? "Inactive" : "Active"}')">${v.status === "Active" ? "Deactivate" : "Activate"}</button>
          <button type="button" class="nav-btn-styled" style="width:auto; background:#b91c1c; padding:7px 16px; font-weight:700;" onclick="vdDelete(${jsArg(v.vendorName)})">Delete</button>
          <button type="button" class="nav-btn-styled" style="width:auto; background:#718096; padding:7px 16px; font-weight:700;" onclick="document.getElementById('vd-detail').innerHTML=''">Close</button>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:10px 16px; margin-top:12px; font-size:0.86rem;">
        ${kv("GSTIN", v.gstin)}${kv("Contact Person", v.contactPerson)}${kv("Phone", v.phoneNumber)}${kv("Email", v.email)}
        ${kv("City", v.city)}${kv("State", [v.state, v.stateCode].filter(Boolean).join(" · "))}
        ${kv("GST %", [v.cgstPercent != null ? "CGST " + Number(v.cgstPercent) : "", v.sgstPercent != null ? "SGST " + Number(v.sgstPercent) : "", v.igstPercent != null ? "IGST " + Number(v.igstPercent) : ""].filter(Boolean).join(", "))}
        <div style="grid-column:1/-1;">${kv("Address", v.address)}</div>
      </div>
      ${section("Purchase", `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px;">
        ${tile("Authorized POs", p.authorized || 0, p.pending ? `${p.pending} waiting authorization` : "")}
        ${tile("PO value (this FY)", vdMoney(p.value_fy))}${tile("PO value (all time)", vdMoney(p.value_all))}
        ${tile("POs still delivering", p.open_deliveries || 0)}${tile("Last PO", p.last_po ? formatOrdinalDate(p.last_po) : "—")}</div>`)}
      ${section("Delivery & Quality", `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px;">
        ${tile("On-time deliveries", onTime, done ? `${perf.on_time_deliveries || 0} on time, ${perf.late_deliveries || 0} late` : "")}
        ${tile("Average days late", perf.average_days_late != null ? fmtQty(perf.average_days_late) : "—")}
        ${tile("Q/A rejected", rejPct, recv ? `${fmtQty(perf.qa_rejected_quantity)} of ${fmtQty(recv)} received` : "")}
        ${tile("Transit rejected", perf.transit_rejected_quantity != null ? fmtQty(perf.transit_rejected_quantity) : "—")}
        ${tile("Open rejected / missing", rej.open_lines || 0, rej.open_lines ? `${fmtQty(rej.open_qty)} still pending` : "")}
        ${tile("Last delivery", perf.last_delivery_date ? formatOrdinalDate(perf.last_delivery_date) : "—")}</div>`)}
      ${section("Materials Supplied", tableWrap(th("Material", "left") + th("Unit") + th("Total Ordered") + th("POs") + th("Last Rate") + th("Rate Range") + th("Last PO"), mats, "No authorized POs yet."))}
      ${section("Recent Purchase Orders", tableWrap(th("PO No", "left") + th("Order Date") + th("Status") + th("Grand Total"), pos, "No POs yet."))}
      ${section("Recent GRNs", tableWrap(th("GRN", "left") + th("Date") + th("PO") + th("Lines") + th("OK") + th("Not OK") + th("Missing"), grns, "No GRNs yet."))}
    </div>`;
}

async function vdSetStatus(vendorName, status) {
  const ok = await abpsConfirm(status === "Inactive"
    ? `Deactivate ${vendorName}? It will no longer appear when creating a Purchase Order. Its history stays.`
    : `Activate ${vendorName} again?`, { okLabel: status === "Inactive" ? "Deactivate" : "Activate" });
  if (!ok) return;
  try {
    const d = await apFetch({ action: "setVendorStatus", vendorName, status });
    if (!d.success) return vdFeedback(false, d.error || "Could not change the status.");
    await initializeVendorDirectoryPanel();
    vdFeedback(true, `${vendorName} is now ${status}.`);
    vdOpenProfile(vendorName);
  } catch (e) { if (e.message !== "SESSION_EXPIRED") vdFeedback(false, e.message); }
}

async function vdDelete(vendorName) {
  const ok = await abpsConfirm(`Delete ${vendorName}? This works only if the vendor was never used on a PO, Gate Entry or Delivery Challan. Otherwise deactivate it.`, { okLabel: "Delete" });
  if (!ok) return;
  try {
    const d = await apFetch({ action: "deleteVendor", vendorName });
    if (!d.success) return vdFeedback(false, d.error || "Could not delete.");
    await initializeVendorDirectoryPanel();
    vdFeedback(true, `${vendorName} deleted.`);
  } catch (e) { if (e.message !== "SESSION_EXPIRED") vdFeedback(false, e.message); }
}
