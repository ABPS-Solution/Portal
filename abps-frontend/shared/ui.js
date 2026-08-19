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
// ASSIGN CURRENT STOCK
// ═══════════════════════════════════════════════════════

