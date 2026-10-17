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
      style="width:auto; padding:7px 16px; font-size:0.85rem; font-weight:700; border-radius:999px; background:${vdFilter === k ? "var(--brand)" : "#e2e8f0"}; color:${vdFilter === k ? "#fff" : "#334155"};">${k === "Incomplete" ? "Details Incomplete" : k} <span style="opacity:0.8;">(${counts[k]})</span></button>`;
  root.innerHTML = `
    <style>
      #vd-table { width:100%; border-collapse:separate; border-spacing:0; font-size:0.86rem; }
      #vd-table thead th { position:sticky; top:0; z-index:2; background:#eef2f7; color:#1e293b; font-size:0.82rem; font-weight:800;
        text-transform:uppercase; letter-spacing:0.02em; padding:11px 10px; vertical-align:middle; white-space:nowrap;
        border-left:1.5px solid var(--border); border-bottom:2px solid #94a3b8; }
      #vd-table td { padding:10px; vertical-align:middle; border-left:1.5px solid var(--border); border-bottom:2px solid #94a3b8; }
      #vd-table th:first-child, #vd-table td:first-child { border-left:none; }
      #vd-table tbody tr.vd-row:nth-child(4n+1) td { background:#fff; }
      #vd-table tbody tr.vd-row:nth-child(4n+3) td { background:#f8fafc; }
      #vd-table tbody tr.vd-row:hover td { background:#eef4ff; }
      #vd-table tbody tr.vd-row.vd-open td { background:#e0ecff; }
      #vd-table tbody tr.vd-row.vd-inactive td { color:#94a3b8; }
      #vd-table .vd-exp { width:auto; min-width:52px; padding:5px 10px; font-weight:800; font-size:0.85rem; border:1.5px solid var(--brand);
        background:#fff; color:var(--brand); border-radius:6px; cursor:pointer; }
      #vd-table tr.vd-open .vd-exp { background:var(--brand); color:#fff; }
      #vd-table td.vd-detail-cell { padding:0 14px 14px; background:#f1f5f9; }
      .vd-badge { display:inline-block; padding:3px 10px; border-radius:999px; font-size:0.74rem; font-weight:800; white-space:nowrap; }
    </style>
    <div id="vd-feedback" style="display:none;"></div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
      <div style="position:relative; flex:1 1 320px;">
        <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#94a3b8;">🔍</span>
        <input type="text" id="vd-search" placeholder="Search name, GSTIN, city, contact, phone, email..." autocomplete="off"
          oninput="vdRenderCards()" style="width:100%; box-sizing:border-box; padding:10px 12px 10px 36px; font-weight:600; border:2px solid #94a3b8; border-radius:8px;">
      </div>
      <button type="button" class="nav-btn-styled" style="width:auto; background:var(--accent); padding:10px 20px; font-weight:700; border-radius:8px;" onclick="vdOpenForm(null)">+ Add Vendor</button>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; align-items:center;">${["Active", "Incomplete", "Inactive", "All"].map(pill).join("")}
      <span id="vd-count" style="margin-left:auto; font-size:0.85rem; color:#475569; font-weight:600;"></span>
    </div>
    <div id="vd-cards"></div>`;
  vdRenderCards();
}

function vdSetFilter(k) { vdFilter = k; vdRenderList(); }

const vdOpenRows = new Set();
const vdRowId = (name) => "vd-" + Array.from(String(name)).map(c => c.charCodeAt(0).toString(36)).join("");

function vdMatches(v, q) {
  if (!q) return true;
  const hay = [v.vendorName, v.gstin, v.city, v.state, v.contactPerson, v.phoneNumber, v.email, v.typeOfVendor]
    .filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9@ ]/g, " ");
  return q.toLowerCase().replace(/[^a-z0-9@ ]/g, " ").split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

const VD_COLS = [
  ["Vendor Name", v => `<span style="font-weight:800; color:var(--brand);">${vdEsc(v.vendorName)}</span>`, "left", 210],
  ["Status", v => v.status !== "Active" ? '<span class="vd-badge" style="background:#e2e8f0; color:#475569;">Inactive</span>'
    : v.incomplete ? '<span class="vd-badge" style="background:#fef3c7; color:#b45309;">Details incomplete</span>'
    : '<span class="vd-badge" style="background:#dcfce7; color:#15803d;">Active</span>', "center", 110],
  ["Type of Vendor", v => vdEsc(v.typeOfVendor || "—"), "left", 130],
  ["GSTIN", v => `<span style="font-family:monospace; font-size:0.84rem;">${vdEsc(v.gstin || "—")}</span>`, "left", 160],
  ["Contact Person", v => vdEsc(v.contactPerson || "—"), "left", 140],
  ["Phone", v => vdEsc(v.phoneNumber || "—"), "left", 120],
  ["Email", v => vdEsc(v.email || "—"), "left", 190],
  ["City", v => vdEsc(v.city || "—"), "left", 110],
  ["State", v => vdEsc([v.state, v.stateCode ? "(" + v.stateCode + ")" : ""].filter(Boolean).join(" ") || "—"), "left", 140],
  ["Address", v => `<div style="max-width:260px; white-space:normal; line-height:1.35;">${vdEsc(v.address || "—")}</div>`, "left", 240],
  ["CGST / SGST / IGST %", v => [v.cgstPercent, v.sgstPercent, v.igstPercent].map(p => p == null ? "—" : trimNum(Number(p))).join(" / "), "center", 130],
  ["POs", v => trimNum(Number(v.poCount) || 0), "center", 70],
  ["Open POs", v => trimNum(Number(v.openPoCount) || 0), "center", 80],
  ["PO Value", v => `<span style="font-weight:700;">${vdMoney(v.poValue)}</span>`, "right", 130],
  ["Last PO", v => v.lastPoDate ? formatOrdinalDate(v.lastPoDate) : "—", "center", 120],
  ["Qty Ordered", v => trimNum(Number(v.qtyOrdered) || 0), "center", 100],
  ["Qty Received", v => trimNum(Number(v.qtyReceived) || 0), "center", 100],
  ["On-time %", v => { const d = (Number(v.onTime) || 0) + (Number(v.late) || 0); if (!d) return "—"; const p = Math.round((Number(v.onTime) || 0) * 100 / d); return `<span style="font-weight:800; color:${p >= 90 ? "#15803d" : p >= 70 ? "#b45309" : "#b91c1c"};">${p}%</span>`; }, "center", 90],
  ["Avg Days Late", v => v.avgDaysLate == null ? "—" : trimNum(Math.round(Number(v.avgDaysLate) * 10) / 10), "center", 90],
  ["Rejection %", v => { const r = Number(v.qtyReceived) || 0; const rej = (Number(v.qaRejected) || 0) + (Number(v.transitRejected) || 0); return r ? (Math.round(rej * 1000 / r) / 10) + "%" : "—"; }, "center", 90],
  ["Last Delivery", v => v.lastDeliveryDate ? formatOrdinalDate(v.lastDeliveryDate) : "—", "center", 120],
];

function vdRenderCards() {
  const box = document.getElementById("vd-cards");
  if (!box) return;
  const q = (document.getElementById("vd-search")?.value || "").trim();
  const list = vdVendors.filter(v =>
    (vdFilter === "All" || (vdFilter === "Active" && v.status === "Active") || (vdFilter === "Inactive" && v.status !== "Active")
      || (vdFilter === "Incomplete" && v.incomplete && v.status === "Active")) && vdMatches(v, q));
  const cnt = document.getElementById("vd-count");
  if (cnt) cnt.textContent = `${list.length} vendor${list.length === 1 ? "" : "s"}`;
  if (list.length === 0) {
    box.innerHTML = `<div style="text-align:center; padding:28px; color:var(--muted); background:#fff; border:2px solid #94a3b8; border-radius:var(--radius);">No vendors match.</div>`;
    return;
  }
  const n = VD_COLS.length + 1;
  box.innerHTML = `
    <div style="overflow:auto; max-height:72vh; border:2px solid #94a3b8; border-radius:var(--radius); background:#fff;">
      <table id="vd-table">
        <thead><tr><th style="text-align:center; min-width:70px;">Sr No</th>${VD_COLS.map(([h, , al, w]) => `<th style="text-align:${al}; min-width:${w}px;">${h}</th>`).join("")}</tr></thead>
        <tbody>${list.map((v, i) => { const id = vdRowId(v.vendorName); const open = vdOpenRows.has(v.vendorName); return `
          <tr class="vd-row${v.status !== "Active" ? " vd-inactive" : ""}${open ? " vd-open" : ""}" id="${id}-row">
            <td style="text-align:center;"><button type="button" class="vd-exp" title="Open / close vendor details" onclick="vdToggleRow(${jsArg(v.vendorName)})">${i + 1} ${open ? "▴" : "▾"}</button></td>
            ${VD_COLS.map(([, fn, al]) => `<td style="text-align:${al};">${fn(v)}</td>`).join("")}
          </tr>
          <tr class="vd-detail-row" id="${id}-detail" style="display:${open ? "table-row" : "none"};"><td colspan="${n}" class="vd-detail-cell"><div id="${id}-box"></div></td></tr>`; }).join("")}</tbody>
      </table>
    </div>`;
  vdOpenRows.forEach(name => { if (list.some(v => v.vendorName === name)) vdLoadProfileInto(name); });
}

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
    const intra = code === "27";
    document.getElementById("vdf-cgstPercent").value = intra ? 9 : 0;
    document.getElementById("vdf-sgstPercent").value = intra ? 9 : 0;
    document.getElementById("vdf-igstPercent").value = intra ? 0 : 18;
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
function vdToggleRow(vendorName) {
  if (vdOpenRows.has(vendorName)) return vdCloseProfile(vendorName);
  vdOpenProfile(vendorName);
}

function vdCloseProfile(vendorName) {
  vdOpenRows.delete(vendorName);
  const id = vdRowId(vendorName);
  const det = document.getElementById(id + "-detail"), row = document.getElementById(id + "-row");
  if (det) det.style.display = "none";
  if (row) { row.classList.remove("vd-open"); const b = row.querySelector(".vd-exp"); if (b) b.textContent = b.textContent.replace("▴", "▾"); }
}

async function vdOpenProfile(vendorName) {
  vdOpenRows.add(vendorName);
  const id = vdRowId(vendorName);
  if (!document.getElementById(id + "-row")) { vdFilter = "All"; const sr = document.getElementById("vd-search"); if (sr) sr.value = ""; vdRenderList(); }
  const det = document.getElementById(id + "-detail"), row = document.getElementById(id + "-row");
  if (det) det.style.display = "table-row";
  if (row) { row.classList.add("vd-open"); const b = row.querySelector(".vd-exp"); if (b) b.textContent = b.textContent.replace("▾", "▴"); }
  await vdLoadProfileInto(vendorName);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function vdLoadProfileInto(vendorName) {
  const box = document.getElementById(vdRowId(vendorName) + "-box");
  if (!box) return;
  box.innerHTML = `<div style="padding:16px; text-align:center; color:var(--muted);">Loading ${vdEsc(vendorName)}...</div>`;
  try {
    const d = await apFetch({ action: "fetchVendorProfile", vendorName });
    if (!d.success) throw new Error(d.error || "Could not load the vendor.");
    box.innerHTML = vdProfileHtml(d);
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") box.innerHTML = `<div style="padding:12px; color:#b91c1c; font-weight:700;">${vdEsc(e.message)}</div>`;
  }
}

function vdProfileHtml(d) {
  const v = d.vendor, p = d.purchase || {}, perf = d.performance || {}, rej = d.rejections || {};
  const done = (Number(perf.on_time_deliveries) || 0) + (Number(perf.late_deliveries) || 0);
  const onTime = done ? Math.round((Number(perf.on_time_deliveries) || 0) * 100 / done) + "%" : "—";
  const recv = Number(perf.total_quantity_received) || 0;
  const rejPct = recv ? (Math.round((Number(perf.qa_rejected_quantity) || 0) * 1000 / recv) / 10) + "%" : "—";
  const B = "2px solid #94a3b8";
  const pillTag = (txt, bg, fg) => `<span style="font-size:0.72rem; font-weight:800; background:${bg}; color:${fg}; padding:3px 10px; border-radius:999px; white-space:nowrap;">${txt}</span>`;

  // Details: label / value grid with lines; missing values flagged.
  const missing = `<span style="color:#b45309; font-weight:600;">Not set</span>`;
  const cell = (label, val, span) => `<div style="${span ? "grid-column:1/-1;" : ""} padding:9px 12px; border-right:1.5px solid #cbd5e1; border-bottom:1.5px solid #cbd5e1; min-width:0;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:#64748b; letter-spacing:0.3px;">${label}</div>
      <div style="font-weight:600; color:#0f172a; margin-top:2px; overflow-wrap:break-word;">${val ? vdEsc(val) : missing}</div></div>`;
  const gst = [v.cgstPercent != null ? "CGST " + Number(v.cgstPercent) + "%" : "", v.sgstPercent != null ? "SGST " + Number(v.sgstPercent) + "%" : "", v.igstPercent != null ? "IGST " + Number(v.igstPercent) + "%" : ""].filter(Boolean).join(" · ");
  const details = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); border:${B}; border-radius:8px; background:#fff; overflow:hidden;">
      ${cell("GSTIN", v.gstin)}${cell("Type of Vendor", v.typeOfVendor)}${cell("Contact Person", v.contactPerson)}${cell("Phone", v.phoneNumber)}
      ${cell("Email", v.email)}${cell("City", v.city)}${cell("State", [v.state, v.stateCode ? "(" + v.stateCode + ")" : ""].filter(Boolean).join(" "))}${cell("GST %", gst)}
      ${cell("Address", v.address, true)}</div>`;

  const tile = (label, value, sub, accent) => `<div style="background:#fff; border:${B}; border-top:4px solid ${accent || "#94a3b8"}; border-radius:8px; padding:10px 12px; min-width:0;">
      <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; color:#64748b; letter-spacing:0.3px; line-height:1.3;">${label}</div>
      <div style="font-size:1.3rem; font-weight:800; color:#0f172a; margin-top:4px; line-height:1.2;">${value}</div>
      <div style="font-size:0.74rem; color:#64748b; margin-top:2px; min-height:1em;">${sub || ""}</div></div>`;
  const tiles = (html) => `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px;">${html}</div>`;

  const th = (t, al) => `<th style="padding:8px; text-align:${al || "center"}; vertical-align:middle; background:var(--highlight-bg); font-weight:800;">${t}</th>`;
  const td = (h, al) => `<td style="padding:8px; text-align:${al || "center"}; vertical-align:middle;">${h}</td>`;
  const table = (head, rows, empty) => rows.length
    ? `<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.85rem; min-width:620px; background:#fff;"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<div style="padding:14px; text-align:center; color:var(--muted); background:#fff; border:2px dashed #cbd5e1; border-radius:8px;">${empty}</div>`;
  const section = (title, count, body) => `<div style="margin-top:16px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <div class="sec-label" style="margin:0;">${title}</div>${count != null ? pillTag(count, "var(--highlight-bg)", "var(--brand)") : ""}</div>${body}</div>`;

  const mats = d.materials.map(m => `<tr>${td(`<div style="font-weight:700;">${vdEsc(m.materialName)}</div><div style="font-size:0.75rem; color:#64748b;">${vdEsc(m.itemCode)}</div>`, "left")}
      ${td(vdEsc(m.unit))}${td(fmtQty(m.totalQty))}${td(m.poCount)}${td(`<strong>${vdMoney(m.lastRate)}</strong>`)}${td(`${vdMoney(m.minRate)} – ${vdMoney(m.maxRate)}`)}${td(formatOrdinalDate(m.lastPoDate))}</tr>`);
  const pos = d.recentPos.map(r => `<tr>${td(`<strong>${vdEsc(r.poNo)}</strong>`, "left")}${td(formatOrdinalDate(r.orderDate))}${td(vdEsc(r.status))}${td(`<strong>${vdMoney(r.grandTotal)}</strong>`)}</tr>`);
  const grns = d.grns.map(g => `<tr>${td(`<strong>${vdEsc(g.grnNumber)}</strong>`, "left")}${td(formatOrdinalDate(g.date))}${td(vdEsc(g.poNos || "—"))}${td(g.lines)}
      ${td(`<strong style="color:#15803d;">${fmtQty(g.ok)}</strong>`)}${td(Number(g.notOk) ? `<strong style="color:#b91c1c;">${fmtQty(g.notOk)}</strong>` : "0")}${td(Number(g.missing) ? `<strong style="color:#b45309;">${fmtQty(g.missing)}</strong>` : "0")}</tr>`);
  const btn = (label, bg, onclick) => `<button type="button" class="nav-btn-styled" style="width:auto; background:${bg}; padding:7px 16px; font-weight:700; font-size:0.85rem;" onclick="${onclick}">${label}</button>`;

  return `
    <div style="margin-top:18px; background:#f8fafc; border:${B}; border-left:6px solid var(--brand); border-radius:10px; overflow:hidden;">
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center; padding:14px 16px; background:#fff; border-bottom:${B};">
        <div style="min-width:0;">
          <div style="font-size:1.25rem; font-weight:800; color:var(--brand); line-height:1.25;">${vdEsc(v.vendorName)}</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
            ${v.status === "Active" ? pillTag("ACTIVE", "#dcfce7", "var(--brand)") : pillTag("INACTIVE", "#e2e8f0", "#475569")}
            ${v.incomplete ? pillTag("DETAILS INCOMPLETE", "#fef3c7", "var(--brand)") : ""}
            ${v.typeOfVendor ? pillTag(vdEsc(v.typeOfVendor).toUpperCase(), "var(--highlight-bg)", "var(--brand)") : ""}
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${btn("Edit", "var(--brand)", `vdOpenForm(${jsArg(v.vendorName)})`)}
          ${btn(v.status === "Active" ? "Deactivate" : "Activate", v.status === "Active" ? "#b45309" : "var(--accent)", `vdSetStatus(${jsArg(v.vendorName)}, '${v.status === "Active" ? "Inactive" : "Active"}')`)}
          ${btn("Delete", "#b91c1c", `vdDelete(${jsArg(v.vendorName)})`)}
          ${btn("Close", "#718096", `vdCloseProfile(${jsArg(v.vendorName)})`)}
        </div>
      </div>
      <div style="padding:14px 16px 18px;">
        ${v.incomplete ? `<div style="background:#fffbeb; border-left:4px solid #d97706; color:#92400e; padding:9px 12px; border-radius:4px; font-size:0.85rem; margin-bottom:12px;">Some details are missing. Click <strong>Edit</strong> to add the GSTIN and address so this vendor's POs print correctly.</div>` : ""}
        ${section("Vendor Details", null, details)}
        ${section("Purchase", null, tiles(
          tile("Authorized POs", p.authorized || 0, p.pending ? `${p.pending} waiting authorization` : "", "var(--brand)")
          + tile("PO Value (This FY)", vdMoney(p.value_fy), "", "var(--brand)")
          + tile("PO Value (All Time)", vdMoney(p.value_all), "", "var(--brand)")
          + tile("POs Still Delivering", p.open_deliveries || 0, "", "var(--brand)")
          + tile("Last PO", p.last_po ? formatOrdinalDate(p.last_po) : "—", "", "var(--brand)")))}
        ${section("Delivery & Quality", null, tiles(
          tile("On-Time Deliveries", onTime, done ? `${perf.on_time_deliveries || 0} on time · ${perf.late_deliveries || 0} late` : "No deliveries tracked yet", "var(--brand)")
          + tile("Average Days Late", perf.average_days_late != null ? fmtQty(perf.average_days_late) : "—", "", "var(--brand)")
          + tile("Q/A Rejected", rejPct, recv ? `${fmtQty(perf.qa_rejected_quantity)} of ${fmtQty(recv)} received` : "", "var(--brand)")
          + tile("Transit Rejected", perf.transit_rejected_quantity != null ? fmtQty(perf.transit_rejected_quantity) : "—", "", "var(--brand)")
          + tile("Open Rejected / Missing", rej.open_lines || 0, rej.open_lines ? `${fmtQty(rej.open_qty)} still pending` : "", "var(--brand)")
          + tile("Last Delivery", perf.last_delivery_date ? formatOrdinalDate(perf.last_delivery_date) : "—", "", "var(--brand)")))}
        ${section("Materials Supplied", d.materials.length || null, table(th("Material", "left") + th("Unit") + th("Total Ordered") + th("POs") + th("Last Rate") + th("Rate Range") + th("Last PO"), mats, "No authorized POs with this vendor yet."))}
        ${section("Recent Purchase Orders", d.recentPos.length || null, table(th("PO No", "left") + th("Order Date") + th("Status") + th("Grand Total"), pos, "No POs with this vendor yet."))}
        ${section("Recent GRNs", d.grns.length || null, table(th("GRN", "left") + th("Date") + th("PO") + th("Lines") + th("OK") + th("Not OK") + th("Missing"), grns, "No GRNs from this vendor yet."))}
      </div>
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
