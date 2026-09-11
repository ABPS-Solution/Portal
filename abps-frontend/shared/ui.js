// Global guard for every number input in the app — native <input type="number">
// otherwise accepts 'e'/'E' (scientific notation), '+', and '-' even on
// fields that make no sense with them (quantities, rates, percentages).
// Blocks the keystroke where possible, and strips it on paste/autofill
// too, since keydown alone doesn't catch those.
//
// Negative now blocked by DEFAULT on every number input (6 Sep 2026,
// explicit request after a Qty field going negative via the native
// up/down spinner corrupted a GST calculation) — previously this only
// blocked negative when a field happened to declare min >= 0, so any
// field with no min attribute (most of them) was wide open. A field that
// genuinely needs negative values (e.g. Round Off, which can legitimately
// round down) opts back in with data-allow-negative="true", or by giving
// it a negative min itself.
(function() {
  function allowsNegative(inp) {
    if (inp.dataset.allowNegative === "true") return true;
    if (inp.min !== "" && inp.min != null && !isNaN(Number(inp.min))) return Number(inp.min) < 0;
    return false;
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
    if (!allowsNegative(t)) {
      // The native up/down spinner (the actual reported case — clicking
      // the down arrow at 0) sets a whole negative value in one shot, e.g.
      // "-1" — a blind minus-strip used to turn that INTO "1" (positive)
      // instead of clamping it, inverting the sign rather than blocking
      // it. Parse the value and clamp to the field's floor (its min, or 0)
      // whenever it parses as a real negative number; only fall back to
      // stripping the character for a bare/mid-typed "-" that doesn't
      // parse yet.
      const num = Number(cleaned);
      if (cleaned !== "" && cleaned !== "-" && !isNaN(num) && num < 0) {
        const floor = (t.min !== "" && t.min != null && !isNaN(Number(t.min))) ? Number(t.min) : 0;
        cleaned = String(floor);
      } else {
        cleaned = cleaned.replace(/-/g, "");
      }
    }
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

// ── "Reconnecting…" indicator (apFetch's network retry) ────────────────
// Deliberately NOT showBlockingOverlay: that one is a full-screen blocker
// already used by long submit flows, and it has no reference counting, so
// a retry's hide() would tear down a submit's overlay early. This is a
// small non-blocking pill instead, at a z-index BELOW both the overlay
// (99999) and the error banners (9999) so it can never cover either.
// Ref-counted because several requests can be retrying at once.
let reconnectingRefCount = 0;

function showReconnectingIndicator() {
  reconnectingRefCount++;
  let el = document.getElementById("app-reconnecting-pill");
  if (el) { el.style.display = "flex"; return; }
  el = document.createElement("div");
  el.id = "app-reconnecting-pill";
  el.style.cssText = "position:fixed; top:60px; left:50%; transform:translateX(-50%); background:#fff3cd; border:1px solid #ffc107; color:#856404; padding:8px 16px; border-radius:20px; font-size:0.82rem; font-weight:700; z-index:9998; box-shadow:0 4px 12px rgba(0,0,0,0.12); display:flex; align-items:center; gap:8px;";
  el.innerHTML = `<div class="spinner" style="width:13px; height:13px; border:2px solid rgba(133,100,4,0.25); border-top-color:#856404; border-radius:50%; animation:spin 0.6s linear infinite;"></div><span>Reconnecting…</span>`;
  document.body.appendChild(el);
}

function hideReconnectingIndicator() {
  reconnectingRefCount = Math.max(0, reconnectingRefCount - 1);
  if (reconnectingRefCount > 0) return; // another request is still retrying
  const el = document.getElementById("app-reconnecting-pill");
  if (el) el.style.display = "none";
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
  // Not rendered right now (hidden panel, a cloneNode template, a collapsed
  // card): scrollHeight reads 0, so measuring here would pin a bogus tiny
  // height that survives until something re-grows it. Leave it alone.
  if (el.getClientRects().length === 0) return;
  el.style.height = "auto";
  // ★ The border MUST be added back. index.html:18 sets `box-sizing:
  // border-box` on every element, so `height` has to cover content +
  // padding + BORDER — but scrollHeight only ever measures content +
  // padding. Setting height = scrollHeight is therefore short by exactly
  // the vertical border width (3px on this app's standard 1.5px field
  // border), which shaves the bottom off the LAST wrapped line. Invisible
  // on a short one-line value (there's slack), very visible on a long
  // wrapped one — that's what made Create BOQ's Product Rating render its
  // final line sliced in half.
  const cs = window.getComputedStyle(el);
  const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  el.style.height = (el.scrollHeight + border) + "px";
}
function autoGrowAllIn(container) {
  (container ? container.querySelectorAll("textarea") : document.querySelectorAll("textarea"))
    .forEach(autoGrowTextField);
}
// A grown height is pinned in pixels against the width it was measured at —
// if the field later gets narrower (window resize, a sibling field growing
// and squeezing a grid column), the same text needs more lines than the
// pinned height allows and the overflow is silently clipped. Re-measure
// every rendered textarea after a resize settles. Debounced, and
// autoGrowTextField itself skips anything not currently rendered, so this
// can't touch hidden panels or #reusable-child-modules-template.
let _autoGrowResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_autoGrowResizeTimer);
  _autoGrowResizeTimer = setTimeout(() => autoGrowAllIn(), 150);
});

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

