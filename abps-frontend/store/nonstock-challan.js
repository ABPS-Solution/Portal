// ═══════════════════════════════════════════════════════════════════════
// Delivery Challans with no stock issue (26 Oct 2026) — the builder above
// the ticket pool on Material Outward on Delivery Challan.
//   Gas Refill      empty cylinders to the vendor (the refill comes back on its RM PO GRN).
//   Rejected Return Not OK material back to the vendor, picked from open "Return to Vendor" rejections.
//   Direct Supply   project RM PO material sent by the supplier straight to the customer / site.
// The builder only picks the lines; the draft card, Generate Draft and
// Authorize are the same as for ticket challans (material-outward.js).
// ═══════════════════════════════════════════════════════════════════════

window._mnsState = window._mnsState || { kind: null, vendor: "", projectId: "", companyName: "", rows: [], sources: [] };

const MNS_KINDS = [
  { kind: "Gas Refill", hint: "Empty cylinders sent for refill. Full-cylinder stock does not change; the refill comes back on its RM PO." },
  { kind: "Rejected Return", hint: "Rejected (Not OK) material going back to the vendor. It was never in stock." },
  { kind: "Direct Supply", hint: "Material on a project RM PO sent by the supplier straight to the customer or site." },
];

function mnsRenderSection() {
  const st = window._mnsState;
  const btns = MNS_KINDS.map(k => `<button class="nav-btn-styled" style="width:auto; background:${st.kind === k.kind ? "var(--brand)" : "#e2e8f0"}; color:${st.kind === k.kind ? "#fff" : "#334155"};" onclick="mnsPickKind(${jsArg(k.kind)})">${escapeHtml(k.kind)}</button>`).join("");
  return `<div class="section" id="mns-section" style="padding:14px 16px; border:1px solid var(--border); border-radius:var(--radius); background:#f8fafc;">
      <div style="font-weight:800; font-size:1rem; margin-bottom:6px;">Challan with no stock issue</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">${btns}</div>
      <div id="mns-builder" style="margin-top:12px;">${st.kind ? mnsBuilderHtml() : ""}</div>
    </div>`;
}

function mnsPickKind(kind) {
  const st = window._mnsState;
  if (st.kind === kind) { st.kind = null; } else { Object.assign(st, { kind, vendor: "", projectId: "", companyName: "", rows: [], sources: [] }); }
  if (kind === "Gas Refill" && st.kind) st.rows = [{ itemCode: "", name: "", quantity: "" }];
  mnsRerender();
}

function mnsRerender() {
  const sec = document.getElementById("mns-section");
  if (sec) sec.outerHTML = mnsRenderSection();
}

function mnsBuilderHtml() {
  const st = window._mnsState;
  const hint = (MNS_KINDS.find(k => k.kind === st.kind) || {}).hint || "";
  const top = `<p style="margin:0 0 10px; font-size:0.8rem; color:var(--muted);">${escapeHtml(hint)}</p>`;
  if (st.kind === "Direct Supply") {
    return top + `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div style="flex:1 1 280px; position:relative;"><label class="field-label" style="margin-top:0;">Project ID or Customer Name *</label>
          <input type="text" id="mns-project" value="${escapeHtml(st.projectId)}" autocomplete="off" placeholder="Type to search..."
            oninput="mnsProjectSearch(this.value)" onfocus="mnsProjectSearch(this.value)" style="width:100%; padding:8px; border:1.5px solid #94a3b8; border-radius:var(--radius);" />
          <div id="mns-project-dd" style="display:none; position:fixed; z-index:9999; background:#fff; border:1.5px solid var(--brand); border-radius:4px; max-height:240px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div></div>
        <button class="nav-btn-styled" style="width:auto; background:var(--brand);" onclick="mnsLoadSources()">Show PO Materials</button>
      </div>${mnsSourcesTableHtml()}`;
  }
  const vendorBox = `<div style="flex:1 1 280px; position:relative;"><label class="field-label" style="margin-top:0;">Vendor Name *</label>
      <input type="text" id="mns-vendor" value="${escapeHtml(st.vendor)}" autocomplete="off" placeholder="Search vendor..."
        oninput="mnsVendorSearch(this.value)" onfocus="mnsVendorSearch(this.value)" style="width:100%; padding:8px; border:1.5px solid #94a3b8; border-radius:var(--radius);" />
      <div id="mns-vendor-dd" style="display:none; position:fixed; z-index:9999; background:#fff; border:1.5px solid var(--brand); border-radius:4px; max-height:240px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div></div>`;
  if (st.kind === "Rejected Return") {
    return top + `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">${vendorBox}
        <button class="nav-btn-styled" style="width:auto; background:var(--brand);" onclick="mnsLoadSources()">Show Rejected Material</button></div>${mnsSourcesTableHtml()}`;
  }
  // Gas Refill
  const rows = st.rows.map((r, i) => `<tr>
      <td style="padding:6px; border:1px solid var(--border); position:relative;">
        <input type="text" id="mns-gas-name-${i}" value="${escapeHtml(r.name)}" autocomplete="off" placeholder="Search the gas item code..."
          oninput="mnsGasSearch(${i}, this.value)" style="width:100%; padding:6px; border:1.5px solid ${r.itemCode ? "#94a3b8" : "#dc2626"}; border-radius:4px;" />
        <div id="mns-gas-dd-${i}" style="display:none; position:fixed; z-index:9999; background:#fff; border:1.5px solid var(--brand); border-radius:4px; max-height:240px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);"></div></td>
      <td style="padding:6px; border:1px solid var(--border); width:130px;"><input type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(String(r.quantity))}" oninput="window._mnsState.rows[${i}].quantity = this.value" style="width:100%; padding:6px; text-align:center; border:1.5px solid #94a3b8; border-radius:4px;" /></td>
      <td style="padding:6px; border:1px solid var(--border); width:70px; text-align:center;"><button class="nav-btn-styled" style="width:auto; background:#fee2e2; color:#b91c1c; padding:2px 8px;" onclick="mnsRemoveGasRow(${i})">✕</button></td>
    </tr>`).join("");
  return top + `<div style="display:flex; gap:10px; flex-wrap:wrap;">${vendorBox}</div>
    <table style="width:100%; border-collapse:collapse; margin-top:12px;">
      <thead><tr style="background:var(--highlight-bg);"><th style="padding:8px; border:1px solid var(--border); text-align:left;">Gas (empty cylinders)</th><th style="padding:8px; border:1px solid var(--border);">Qty</th><th style="border:1px solid var(--border);"></th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div style="display:flex; justify-content:space-between; gap:10px; margin-top:10px; flex-wrap:wrap;">
      <button class="nav-btn-styled" style="width:auto; background:#64748b;" onclick="mnsAddGasRow()">+ Add Row</button>
      <button class="nav-btn-styled" id="mns-create-btn" style="width:auto; background:var(--accent);" onclick="mnsCreateDraft()">Create Draft Challan</button>
    </div>`;
}

function mnsSourcesTableHtml() {
  const st = window._mnsState;
  if (!st.sourcesLoaded) return "";
  if (!st.sources.length) {
    return `<div style="margin-top:12px; padding:12px; text-align:center; color:var(--muted); border:1px dashed var(--border); border-radius:var(--radius);">${st.kind === "Direct Supply" ? "No PO material is still due for this project." : "This vendor has no rejected material waiting to go back."}</div>`;
  }
  const isRej = st.kind === "Rejected Return";
  const head = isRej
    ? ["Material", "GRN", "Action", "Can send", "Qty to send"]
    : ["Material", "PO", "PRN", "Vendor", "Still due", "Qty supplied"];
  const rows = st.sources.map((s, i) => {
    const cap = isRej ? s.freeQty : s.dueQty;
    const cells = isRej
      ? [escapeHtml(s.materialName || s.itemCode), escapeHtml(s.grnNumber || ""), escapeHtml(s.action || ""), `${escapeHtml(fmtQty(cap))} ${escapeHtml(s.unit || "")}`]
      : [escapeHtml(s.description), escapeHtml(s.poNo), escapeHtml((s.prnId || "").replace(/^PRN_/, "")), escapeHtml(s.vendorName || ""), `${escapeHtml(fmtQty(cap))} ${escapeHtml(s.unit || "")}`];
    return `<tr>${cells.map(c => `<td style="padding:7px; border:1px solid var(--border); word-break:break-word;">${c}</td>`).join("")}
      <td style="padding:6px; border:1px solid var(--border); width:120px;"><input type="number" min="0" max="${cap}" step="any" inputmode="decimal" value="${escapeHtml(String(s._qty ?? ""))}" placeholder="0"
        oninput="window._mnsState.sources[${i}]._qty = this.value" style="width:100%; padding:6px; text-align:center; border:1.5px solid #94a3b8; border-radius:4px;" /></td></tr>`;
  }).join("");
  return `<div style="overflow-x:auto; margin-top:12px;"><table style="width:100%; border-collapse:collapse;">
      <thead><tr style="background:var(--highlight-bg);">${head.map(h => `<th style="padding:8px; border:1px solid var(--border); text-align:left; font-size:0.8rem;">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="display:flex; justify-content:flex-end; margin-top:10px;">
      <button class="nav-btn-styled" id="mns-create-btn" style="width:auto; background:var(--accent);" onclick="mnsCreateDraft()">Create Draft Challan</button></div>`;
}

function mnsAddGasRow() { window._mnsState.rows.push({ itemCode: "", name: "", quantity: "" }); mnsRerender(); }
function mnsRemoveGasRow(i) { window._mnsState.rows.splice(i, 1); if (!window._mnsState.rows.length) mnsAddGasRow(); else mnsRerender(); }

function mnsPlaceDropdown(input, dd) {
  const r = input.getBoundingClientRect();
  dd.style.left = r.left + "px"; dd.style.top = r.bottom + "px"; dd.style.width = Math.max(r.width, 260) + "px";
}

function mnsGasSearch(i, query) {
  const input = document.getElementById(`mns-gas-name-${i}`);
  const dd = document.getElementById(`mns-gas-dd-${i}`);
  window._mnsState.rows[i].name = query; window._mnsState.rows[i].itemCode = "";
  if (input) input.style.borderColor = "#dc2626";
  if (!dd || !(query || "").trim()) { if (dd) dd.style.display = "none"; return; }
  const hits = materialSearch(window.itemCodeCatalogCache || [], query, 25);
  mnsPlaceDropdown(input, dd);
  dd.innerHTML = hits.length
    ? hits.map(c => `<div onmousedown="event.preventDefault(); mnsPickGas(${i}, this.dataset.code, this.dataset.name)" data-code="${escapeHtml(c.itemCode)}" data-name="${escapeHtml(c.combinedName || c.productName || c.itemCode)}"
        style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.85rem;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
        <span style="font-family:monospace; color:var(--muted);">${escapeHtml(c.itemCode)}</span> ${escapeHtml(c.combinedName || c.productName || "")}</div>`).join("")
    : `<div style="padding:8px 12px; font-size:0.8rem; color:#b91c1c;">No item code found.</div>`;
  dd.style.display = "block";
}

function mnsPickGas(i, code, name) {
  Object.assign(window._mnsState.rows[i], { itemCode: code, name });
  mnsRerender();
}

let mnsVendorSeq = 0;
async function mnsVendorSearch(query) {
  window._mnsState.vendor = query;
  const input = document.getElementById("mns-vendor");
  const dd = document.getElementById("mns-vendor-dd");
  if (!input || !dd) return;
  const seq = ++mnsVendorSeq;
  try {
    const data = await apFetch({ action: "searchVendorNamesForMaterialOutward", query: query || "" });
    if (seq !== mnsVendorSeq) return;
    const vendors = (data.success ? data.vendors : []) || [];
    window._mowVendorDetails = window._mowVendorDetails || {};
    (data.vendorDetails || []).forEach(v => { window._mowVendorDetails[v.name] = v; });
    mnsPlaceDropdown(input, dd);
    dd.innerHTML = vendors.length
      ? vendors.map(v => `<div onmousedown="event.preventDefault(); mnsPickVendor(this.dataset.v)" data-v="${escapeHtml(v)}" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.85rem;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">${escapeHtml(v)}</div>`).join("")
      : `<div style="padding:8px 12px; font-size:0.8rem; color:#b91c1c;">No vendor found. Add it in Purchase → Vendor List first.</div>`;
    dd.style.display = "block";
  } catch (e) { dd.style.display = "none"; }
}

function mnsPickVendor(name) {
  window._mnsState.vendor = name;
  const input = document.getElementById("mns-vendor");
  if (input) input.value = name;
  const dd = document.getElementById("mns-vendor-dd");
  if (dd) dd.style.display = "none";
  if (window._mnsState.kind === "Rejected Return") mnsLoadSources();
}

async function mnsProjectSearch(query) {
  window._mnsState.projectId = query;
  const input = document.getElementById("mns-project");
  const dd = document.getElementById("mns-project-dd");
  if (!input || !dd) return;
  await ensureSharedProjectTypeaheadData();
  const meta = window.sharedProjectMeta || {};
  const q = (query || "").toLowerCase().trim();
  const hits = (window.sharedActiveProjectCodes || []).filter(p => !q || p.toLowerCase().includes(q) || ((meta[p] && meta[p].companyName) || "").toLowerCase().includes(q)).slice(0, 30);
  mnsPlaceDropdown(input, dd);
  dd.innerHTML = hits.length
    ? hits.map(p => `<div onmousedown="event.preventDefault(); mnsPickProject(this.dataset.p)" data-p="${escapeHtml(p)}" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
        <div style="font-weight:700;">${escapeHtml((meta[p] && meta[p].companyName) || "")}</div><div style="font-family:monospace; color:var(--muted);">${escapeHtml(p)}</div></div>`).join("")
    : `<div style="padding:8px 12px; font-size:0.8rem; color:var(--muted);">No active project found.</div>`;
  dd.style.display = "block";
}

function mnsPickProject(p) {
  window._mnsState.projectId = p;
  const input = document.getElementById("mns-project");
  if (input) input.value = p;
  const dd = document.getElementById("mns-project-dd");
  if (dd) dd.style.display = "none";
  mnsLoadSources();
}

document.addEventListener("click", (e) => {
  if (e.target.closest && e.target.closest('[id^="mns-"][id$="-dd"], [id^="mns-gas-dd-"], #mns-vendor, #mns-project, [id^="mns-gas-name-"]')) return;
  document.querySelectorAll('#mns-vendor-dd, #mns-project-dd, [id^="mns-gas-dd-"]').forEach(d => { d.style.display = "none"; });
});

async function mnsLoadSources() {
  const st = window._mnsState;
  const body = st.kind === "Direct Supply" ? { kind: st.kind, projectId: st.projectId.trim() } : { kind: st.kind, vendorName: st.vendor.trim() };
  if (st.kind === "Direct Supply" ? !body.projectId : !body.vendorName) {
    abpsAlert(st.kind === "Direct Supply" ? "Pick the project first." : "Pick the vendor first.");
    return;
  }
  try {
    showBlockingOverlay("Loading...");
    const data = await apFetch({ action: "fetchNonStockChallanSources", ...body });
    if (!data.success) throw apUserError(data.error || "Could not load the list. Please try again.");
    st.sources = data.rows || [];
    st.sourcesLoaded = true;
    if (data.companyName) st.companyName = data.companyName;
    mnsRerender();
  } catch (err) {
    abpsAlert(friendlyErr(err));
  } finally {
    hideBlockingOverlay();
  }
}

async function mnsCreateDraft() {
  const st = window._mnsState;
  let lines;
  if (st.kind === "Gas Refill") {
    if (!st.vendor.trim()) return abpsAlert("Pick the vendor first.");
    const bad = st.rows.findIndex(r => !r.itemCode || !(Number(r.quantity) > 0));
    if (bad >= 0) return abpsAlert(`Row ${bad + 1}: pick the gas from the list and enter a quantity above 0.`);
    lines = st.rows.map(r => ({ itemCode: r.itemCode, quantity: Number(r.quantity) }));
  } else {
    const picked = st.sources.filter(s => Number(s._qty) > 0);
    if (!picked.length) return abpsAlert("Enter a quantity for at least one row.");
    const over = picked.find(s => Number(s._qty) > Number(st.kind === "Rejected Return" ? s.freeQty : s.dueQty) + 1e-9);
    if (over) return abpsAlert(`${over.materialName || over.description}: the quantity is more than can be sent.`);
    lines = st.kind === "Rejected Return"
      ? picked.map(s => ({ rejectionId: s.rejectionId, quantity: Number(s._qty) }))
      : picked.map(s => ({ poNo: s.poNo, itemCode: s.itemCode, prnId: s.prnId, quantity: Number(s._qty) }));
  }
  const vd = (window._mowVendorDetails || {})[st.vendor] || {};
  const payload = st.kind === "Direct Supply"
    ? { outwardType: st.kind, projectId: st.projectId.trim(), companyName: st.companyName || "", returnableStatus: "Non-Returnable", lines }
    : { outwardType: st.kind, vendorName: st.vendor.trim(), address: vd.address || "", state: vd.state || "",
        returnableStatus: st.kind === "Gas Refill" ? "Returnable" : "", lines };
  const btn = document.getElementById("mns-create-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Creating..."; }
  try {
    const data = await apFetch({ action: "saveDeliveryChallanDraft", ...payload, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (!data.success) throw apUserError(data.error || "Could not create the challan. Please try again.");
    Object.assign(st, { kind: null, vendor: "", projectId: "", companyName: "", rows: [], sources: [], sourcesLoaded: false });
    window._mowExpandedDrafts && window._mowExpandedDrafts.add(String(data.challanId));
    await loadMaterialOutwardServiceQueue();
  } catch (err) {
    abpsAlert(friendlyErr(err));
    if (btn) { btn.disabled = false; btn.textContent = "Create Draft Challan"; }
  }
}
