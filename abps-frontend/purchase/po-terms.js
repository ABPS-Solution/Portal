// PO Terms (20 Oct 2026). Standard Payment Terms / Insurance / Warranty /
// Freight Terms wordings, kept in Vendor List -> PO Terms.
// 1. potEnhance: on every editable RM PO screen a pick list is placed in
//    front of each of the four text boxes. Picking a wording writes it into
//    the box (the box is what every save reads, so nothing else changed);
//    "Other (type it in)" shows the box for a one-off wording.
// 2. The PO Terms toggle on Vendor List (add / remove wordings).
const POT_FIELDS = { warranty: "Warranty", insurance: "Insurance", payment: "Payment Terms", "freight-terms": "Freight Terms" };
const POT_INPUT_RE = /^(cpo|rpo)-(warranty|insurance|payment|freight-terms)$/;
let potCache = { at: 0, options: null, loading: null };

async function potLoadOptions(force) {
  if (!force && potCache.options && Date.now() - potCache.at < 5 * 60 * 1000) return potCache.options;
  if (potCache.loading) return potCache.loading;
  potCache.loading = apFetch({ action: "fetchPoTermOptions" })
    .then(d => { potCache.options = d.success ? (d.options || []) : (potCache.options || []); potCache.at = Date.now(); return potCache.options; })
    .catch(() => potCache.options || [])
    .finally(() => { potCache.loading = null; });
  return potCache.loading;
}

function potOptionsFor(type) { return (potCache.options || []).filter(o => o.termType === type).map(o => o.text); }

function potSync(input, select) {
  const opts = potOptionsFor(select.dataset.termType);
  const v = String(input.value || "").trim();
  if (!v) { select.value = ""; input.style.display = "none"; }
  else if (opts.includes(v)) { select.value = v; input.style.display = "none"; }
  else { select.value = "__other__"; input.style.display = ""; }
  select.dataset.lastValue = input.value;
}

function potBuildSelect(input, type) {
  const select = document.createElement("select");
  select.className = "pot-select";
  select.dataset.termType = type;
  select.dataset.forInput = input.id;
  select.style.cssText = "width:100%; margin-bottom:4px;";
  const opts = potOptionsFor(type);
  select.innerHTML = `<option value="">-- Choose ${escapeHtml(type)} --</option>`
    + opts.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")
    + `<option value="__other__">Other (type it in)</option>`;
  select.onchange = () => {
    if (select.value === "__other__") {
      if (opts.includes(String(input.value || "").trim())) input.value = "";
      input.style.display = ""; input.focus();
    } else {
      input.value = select.value; input.style.display = "none";
    }
    select.dataset.lastValue = input.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  return select;
}

function potEnhanceAll() {
  if (!potCache.options) return;
  document.querySelectorAll("input[type=text]").forEach(input => {
    const m = input.id && input.id.match(POT_INPUT_RE);
    if (!m || input.readOnly || input.disabled) return;
    const type = POT_FIELDS[m[2]];
    let select = input.previousElementSibling && input.previousElementSibling.classList.contains("pot-select") ? input.previousElementSibling : null;
    if (!select) { select = potBuildSelect(input, type); input.parentNode.insertBefore(select, input); potSync(input, select); return; }
    // the screen filled the box itself (loading a draft / PO): follow it
    if (select.dataset.lastValue !== input.value) potSync(input, select);
  });
}

// Loads only once someone is logged in (a call with no session would trip
// the session-expired handling), retried at most every 30 s until it works.
const potLoggedIn = () => !!(localStorage.getItem("erpSessionToken") || localStorage.getItem("sessionToken"));
let potLastTry = 0;
setInterval(() => {
  if (document.hidden || !potLoggedIn()) return;
  if (!potCache.options) {
    if (!potCache.loading && Date.now() - potLastTry > 30000) { potLastTry = Date.now(); potLoadOptions().then(potEnhanceAll); }
    return;
  }
  potEnhanceAll();
}, 500);

// ── Vendor List toggle ──────────────────────────────────────────────────
function vdShowTab(tab) {
  const vendors = document.getElementById("vd-root"), terms = document.getElementById("vd-terms-root");
  if (vendors) vendors.style.display = tab === "terms" ? "none" : "";
  if (terms) terms.style.display = tab === "terms" ? "" : "none";
  ["vendors", "terms"].forEach(t => {
    const b = document.getElementById("vd-tab-" + t);
    if (b) { b.style.background = t === tab ? "var(--brand)" : "#e2e8f0"; b.style.color = t === tab ? "#fff" : "#334155"; }
  });
  if (tab === "terms") potRenderManager();
}

async function potRenderManager(msg) {
  const root = document.getElementById("vd-terms-root");
  if (!root) return;
  root.innerHTML = `<div style="padding:16px; color:var(--muted);">Loading...</div>`;
  const options = await potLoadOptions(true);
  root.innerHTML = `
    <p style="font-size:0.85rem; color:var(--muted); margin:0 0 12px;">These wordings appear as a pick list in the Payment Terms, Insurance, Warranty and Freight Terms boxes on every RM PO screen. People can still choose "Other" and type a one-off wording for a single PO. Removing a wording only takes it off the list; POs that already use it keep it.</p>
    ${msg ? `<div style="padding:8px 12px; margin-bottom:10px; border-left:4px solid ${msg.ok ? "#15803d" : "#b91c1c"}; background:${msg.ok ? "#dcfce7" : "#fee2e2"}; color:${msg.ok ? "#14532d" : "#991b1b"}; font-weight:700;">${escapeHtml(msg.text)}</div>` : ""}
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:14px;">
      ${Object.values(POT_FIELDS).map((type, i) => {
        const list = options.filter(o => o.termType === type);
        return `<div style="border:1px solid var(--border); border-radius:var(--radius); padding:12px 14px; background:#fff;">
          <div style="font-weight:800; margin-bottom:8px;">${escapeHtml(type)} <span style="color:var(--muted); font-weight:600;">(${list.length})</span></div>
          ${list.length ? list.map(o => `<div style="display:flex; gap:8px; align-items:flex-start; padding:6px 0; border-bottom:1px solid #eef2f7;">
              <div style="flex:1; font-size:0.88rem;">${escapeHtml(o.text)}</div>
              <button class="nav-btn-styled" onclick="potRemove(${o.optionId})" style="width:auto; padding:3px 10px; font-size:0.78rem; background:#fee2e2; color:#b91c1c;">Remove</button>
            </div>`).join("") : `<div style="font-size:0.85rem; color:var(--muted); padding:4px 0;">None yet.</div>`}
          <div style="display:flex; gap:8px; margin-top:10px;">
            <input type="text" id="pot-new-${i}" placeholder="Add a ${escapeHtml(type)} wording" style="flex:1;" onkeydown="if(event.key==='Enter')potAdd(${i})">
            <button class="nav-btn-styled" onclick="potAdd(${i})" style="width:auto; padding:6px 14px; background:var(--brand); color:#fff;">Add</button>
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

async function potAdd(i) {
  const type = Object.values(POT_FIELDS)[i];
  const input = document.getElementById("pot-new-" + i);
  const text = input ? input.value.trim() : "";
  if (!text) return;
  try {
    const d = await apFetch({ action: "addPoTermOption", termType: type, text });
    potRenderManager(d.success ? { ok: true, text: `Added to ${type}.` } : { ok: false, text: d.error || "Could not add." });
  } catch (e) { if (e.message !== "SESSION_EXPIRED") potRenderManager({ ok: false, text: e.message }); }
}

async function potRemove(optionId) {
  if (!(await abpsConfirm("Remove this wording from the pick list? POs that already use it are not changed.", { title: "PO Terms", okLabel: "Remove" }))) return;
  try {
    const d = await apFetch({ action: "removePoTermOption", optionId });
    potRenderManager(d.success ? { ok: true, text: "Removed." } : { ok: false, text: d.error || "Could not remove." });
  } catch (e) { if (e.message !== "SESSION_EXPIRED") potRenderManager({ ok: false, text: e.message }); }
}
