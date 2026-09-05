// Global guard for every number input in the app — native <input type="number">
// otherwise accepts 'e'/'E' (scientific notation), '+', and '-' even on
// fields that make no sense with them (quantities, rates, percentages).
// Blocks the keystroke where possible, and strips it on paste/autofill
// too, since keydown alone doesn't catch those.
(function() {
  function allowsNegative(inp) {
    return !(inp.min !== "" && inp.min != null && Number(inp.min) >= 0);
  }
  document.addEventListener("keydown", function(e) {
    const t = e.target;
    if (!(t && t.tagName === "INPUT" && t.type === "number")) return;
    if (e.key === "e" || e.key === "E" || e.key === "+") { e.preventDefault(); return; }
    if (e.key === "-" && !allowsNegative(t)) { e.preventDefault(); }
  }, true);
  document.addEventListener("input", function(e) {
    const t = e.target;
    if (!(t && t.tagName === "INPUT" && t.type === "number")) return;
    let v = t.value;
    let cleaned = v.replace(/[eE+]/g, "");
    if (!allowsNegative(t)) cleaned = cleaned.replace(/-/g, "");
    if (cleaned !== v) t.value = cleaned;
  }, true);
})();

/**
 * CENTRAL FETCH WRAPPER
 * All backend calls go through this. Handles session expiry globally.
 */

function showBlockingOverlay(text) {
  let ov = document.getElementById("app-blocking-overlay");
  const msgEl = () => document.getElementById("app-blocking-overlay-text");
  if (ov) { ov.style.display = "flex"; if (msgEl()) msgEl().textContent = text || "Processing..."; return; }
  ov = document.createElement("div");
  ov.id = "app-blocking-overlay";
  ov.style.cssText = "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(255,255,255,0.35); backdrop-filter:blur(1px); z-index:99999; display:flex; align-items:center; justify-content:center; cursor:wait;";
  ov.innerHTML = `
    <div style="background:rgba(255,255,255,0.9); border:1px solid var(--border); border-radius:var(--radius); padding:22px 32px; box-shadow:0 8px 28px rgba(0,0,0,0.18); display:flex; align-items:center; gap:14px;">
      <div class="spinner" style="width:22px; height:22px; border:3px solid rgba(0,0,0,0.12); border-top-color:var(--accent); border-radius:50%; animation:spin 0.6s linear infinite;"></div>
      <span id="app-blocking-overlay-text" style="font-weight:700; font-size:0.92rem; color:var(--text);">${text || "Processing..."}</span>
    </div>`;
  // Block all clicks/keys from reaching the page underneath while visible
  ov.addEventListener("click", e => e.stopPropagation());
  document.body.appendChild(ov);
}

function hideBlockingOverlay() {
  const ov = document.getElementById("app-blocking-overlay");
  if (ov) ov.style.display = "none";
}

function showBOQBanner(elementId, message, type, persist) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const isSuccess = type === "success";
  el.style.borderLeftColor = isSuccess ? "var(--accent)" : "#e53e3e";
  el.style.background      = isSuccess ? "#f0fff4" : "#fff5f5";
  el.style.color           = isSuccess ? "#276749" : "#c53030";
  el.innerHTML  = message;
  el.style.display = "block";
  if (isSuccess && !persist) setTimeout(() => { el.style.display = "none"; }, 6000);
  // An error shown after Submit needs to actually be seen — if the
  // operator scrolled deep into a long material-rows table before
  // clicking Submit, a banner sitting above the fold at the top of the
  // section was invisible until they scrolled back up themselves.
  if (!isSuccess) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ═══════════════════════════════════════════════════════
// UPLOAD DRAWINGS
// ═══════════════════════════════════════════════════════

function showPurchaseFeedback(elementId, message, type, persist) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const ok = type === "success";
  el.style.cssText = `display:block; background:${ok ? '#dcfce7' : '#fee2e2'}; border-left:4px solid ${ok ? '#15803d' : '#b91c1c'}; color:${ok ? '#15803d' : '#b91c1c'}; padding:12px; margin-bottom:12px; border-radius:var(--radius);`;
  el.innerHTML = message;
  if (ok && !persist) setTimeout(() => { el.style.display = "none"; }, 6000);
  // Same reasoning as showBOQBanner — an error banner scrolled out of
  // view above a long form is as good as invisible.
  if (!ok) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ═══════════════════════════════════════════════════════
// ONE CONSISTENT LOOK FOR EVERY "SUBMIT SUCCEEDED" MOMENT
// message + optional doc link(s) + a "+ Do Another" button that resets
// the panel back to a blank/fresh state. Never auto-hides (unlike the
// two banners above) since there's now a button in it to act on.
// resetFnCall is a literal inline-JS string, e.g. "initializePRNPanel()"
// — matches the existing onclick="..." convention used everywhere else
// in this codebase rather than passing a function reference.
// ═══════════════════════════════════════════════════════
function showSuccessWithReset(elementId, message, resetButtonLabel, resetFnCall, docLinks) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const links = (docLinks || []).filter(d => d && d.url).map(d =>
    `<div style="margin-top:8px;"><a href="${d.url}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">${d.label} ↗</a></div>`
  ).join("");
  el.style.cssText = "display:block; background:#f0fdf4; border-left:4px solid var(--accent); color:#15803d; padding:14px; margin-bottom:14px; border-radius:var(--radius);";
  el.innerHTML = `
    <div style="font-weight:700; font-size:0.92rem;">${message}</div>
    ${links}
    <button class="nav-btn-styled" style="background:var(--accent); color:#fff; margin-top:12px; padding:7px 18px; font-weight:700; font-size:0.82rem;" onclick="${resetFnCall}">+ ${resetButtonLabel}</button>
  `;
}

// ═══════════════════════════════════════════════════════
// AUTO-GROW TEXT FIELD — generic version of the per-screen autoGrowPoField/
// mcAutoGrowField helpers (leads.js, manufacturing-clearance.js). Grows a
// textarea's height to fit wrapped content instead of clipping it at
// rows="1"/overflow:hidden. Call once on input/focus for live-typed fields,
// and via autoGrowAllIn(container) right after any innerHTML render that
// drops in readonly/prefilled textareas (their content never fires input,
// so nothing else would ever measure them).
// ═══════════════════════════════════════════════════════
function autoGrowTextField(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}
function autoGrowAllIn(container) {
  (container ? container.querySelectorAll("textarea") : document.querySelectorAll("textarea"))
    .forEach(autoGrowTextField);
}

// ═══════════════════════════════════════════════════════
// GENERIC WRAPPING DROPDOWN — for any picker whose option text is too
// long for a native <select> (browsers never wrap a native <select>'s own
// option rows onto multiple lines — no CSS can override that; it has to
// be a plain div-based dropdown instead, same as store/tickets.js's
// pre-existing ticket-boq-* picker). Markup convention per baseId:
//   <input type="hidden" id="{baseId}">                      -- holds .value, unchanged for every existing caller
//   <div id="{baseId}-display" class="gwd-display" onclick="toggleGenericDropdown('{baseId}')">
//     <span id="{baseId}-display-text">...</span><span>▾</span>
//   </div>
//   <div id="{baseId}-list" class="gwd-list"></div>
// A single delegated click-outside handler (below) closes every open
// .gwd-list, keyed off the shared class rather than one id per widget.
// ═══════════════════════════════════════════════════════
function genericDropdownPopulate(baseId, options, onSelectCallback) {
  const list = document.getElementById(`${baseId}-list`);
  if (!list) return;
  if (!options || options.length === 0) {
    list.innerHTML = `<div style="padding:8px 10px; color:var(--muted); font-size:0.82rem;">No options.</div>`;
    return;
  }
  list.innerHTML = options.map((o, i) => `
    <div data-idx="${i}" style="padding:8px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem; line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">${o.label}</div>`).join("");
  Array.from(list.children).forEach((el, i) => {
    el.onclick = (e) => { e.stopPropagation(); genericDropdownSelect(baseId, options[i].value, options[i].label, onSelectCallback); };
  });
}
function genericDropdownSelect(baseId, value, label, onSelectCallback) {
  const hidden = document.getElementById(baseId);
  if (hidden) hidden.value = value;
  const textEl = document.getElementById(`${baseId}-display-text`);
  if (textEl) textEl.textContent = label;
  const list = document.getElementById(`${baseId}-list`);
  if (list) list.style.display = "none";
  if (onSelectCallback) onSelectCallback(value);
}
function genericDropdownReset(baseId, placeholderText) {
  const hidden = document.getElementById(baseId);
  if (hidden) hidden.value = "";
  const textEl = document.getElementById(`${baseId}-display-text`);
  if (textEl) textEl.textContent = placeholderText;
  const list = document.getElementById(`${baseId}-list`);
  if (list) { list.innerHTML = ""; list.style.display = "none"; }
}
function genericDropdownSetDisabled(baseId, disabled) {
  const disp = document.getElementById(`${baseId}-display`);
  if (!disp) return;
  disp.dataset.disabled = disabled ? "1" : "0";
  disp.style.opacity = disabled ? "0.5" : "1";
  disp.style.cursor = disabled ? "not-allowed" : "pointer";
  disp.style.background = disabled ? "#f1f5f9" : "#fff";
  disp.style.color = disabled ? "var(--muted)" : "var(--text)";
}
function toggleGenericDropdown(baseId) {
  const disp = document.getElementById(`${baseId}-display`);
  if (!disp || disp.dataset.disabled === "1") return;
  const list = document.getElementById(`${baseId}-list`);
  if (!list) return;
  const isOpen = list.style.display === "block";
  document.querySelectorAll(".gwd-list").forEach(l => { l.style.display = "none"; });
  list.style.display = isOpen ? "none" : "block";
}
document.addEventListener("click", (e) => {
  if (e.target.closest(".gwd-display") || e.target.closest(".gwd-list")) return;
  document.querySelectorAll(".gwd-list").forEach(l => { l.style.display = "none"; });
});

// ═══════════════════════════════════════════════════════
// ASSIGN CURRENT STOCK
// ═══════════════════════════════════════════════════════

