// ═══════════════════════════════════════════════════════════════════════
// shared/drafts.js — autosave for long forms (Offline Phase 2).
//
// THE PROBLEM: Create BOQ, RM PO and Project Invoice are 15-40 minute
// forms with dozens of fields and a dynamic material/line-item table.
// Nothing preserved them — a dropped connection, an accidental refresh,
// a 12h session expiry, or a stray back-button lost the lot. The
// beforeunload warning in apFetch.js only *warns*, it saves nothing.
//
// WHAT THIS IS NOT: this does not submit anything offline and does not
// touch any write path. The draft is local to this browser; submitting
// still needs a connection and still goes through the normal server-side
// validation. It only stops typed work evaporating.
//
// Drafts survive a SESSION EXPIRY (involuntary, and you come back as the
// same person) but are cleared on an explicit LOGOUT (deliberate, and
// several devices here are shared) — see clearAppLocalStorageKeepingDeviceKeys.
// ═══════════════════════════════════════════════════════════════════════

const ABPS_DRAFT_PREFIX = "abpsDraft:";
const ABPS_DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const ABPS_DRAFT_DEBOUNCE_MS = 800;
const abpsDraftTimers = {};

function abpsDraftSave(key, payload) {
  try {
    localStorage.setItem(ABPS_DRAFT_PREFIX + key, JSON.stringify({ ts: Date.now(), payload }));
  } catch (_) { /* quota/private mode — autosave is best-effort by design */ }
}

function abpsDraftRead(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(ABPS_DRAFT_PREFIX + key) || "null");
    if (!raw || !raw.payload) return null;
    if (Date.now() - raw.ts > ABPS_DRAFT_MAX_AGE_MS) { abpsDraftClear(key); return null; }
    return raw;
  } catch (_) { return null; }
}

function abpsDraftClear(key) {
  try { localStorage.removeItem(ABPS_DRAFT_PREFIX + key); } catch (_) {}
}

// Capture every user-editable field inside a container, keyed by element
// id. File inputs are skipped deliberately — a File can't be serialised,
// and silently "restoring" a form minus its attachments would be worse
// than not restoring it, so callers warn about re-attaching instead.
function abpsCaptureFields(containerId) {
  const root = document.getElementById(containerId);
  if (!root) return {};
  const out = {};
  root.querySelectorAll("input, select, textarea").forEach(el => {
    if (!el.id || el.type === "file" || el.type === "password" || el.disabled) return;
    out[el.id] = (el.type === "checkbox" || el.type === "radio") ? !!el.checked : el.value;
  });
  return out;
}

function abpsRestoreFields(containerId, fields) {
  const root = document.getElementById(containerId);
  if (!root || !fields) return;
  Object.entries(fields).forEach(([id, val]) => {
    const el = root.querySelector(`#${CSS.escape(id)}`);
    if (!el || el.disabled) return;
    if (el.type === "checkbox" || el.type === "radio") el.checked = !!val;
    else el.value = val;
    // Fire input/change so anything derived (totals, dependent dropdowns,
    // the DD/MM/YYYY date overlay) recomputes instead of showing stale.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// A draft is only worth keeping if the user actually typed something —
// otherwise merely opening a form would leave a restore prompt behind.
function abpsDraftHasContent(payload) {
  const anyField = Object.values(payload.fields || {}).some(v => v !== "" && v !== false && v != null);
  const anyRows = Array.isArray(payload.state) ? payload.state.length > 0
                : (payload.state && typeof payload.state === "object" ? Object.keys(payload.state).length > 0 : false);
  return anyField || anyRows;
}

// abpsDraftAttach — start autosaving a form. `getExtraState` returns the
// JS-side state a DOM scan can't see (e.g. cboqMaterialRows), since these
// forms keep their material/line rows in an array, not in the DOM.
function abpsDraftAttach(key, containerId, getExtraState) {
  const root = document.getElementById(containerId);
  if (!root || root.dataset.abpsDraftAttached === "1") return;
  root.dataset.abpsDraftAttached = "1";
  const handler = () => {
    clearTimeout(abpsDraftTimers[key]);
    abpsDraftTimers[key] = setTimeout(() => {
      const payload = {
        fields: abpsCaptureFields(containerId),
        state: typeof getExtraState === "function" ? getExtraState() : null,
      };
      if (abpsDraftHasContent(payload)) abpsDraftSave(key, payload);
    }, ABPS_DRAFT_DEBOUNCE_MS);
  };
  root.addEventListener("input", handler);
  root.addEventListener("change", handler);
}

// abpsDraftOfferRestore — if a draft exists, show a bar at the top of the
// form offering it. Deliberately opt-in rather than auto-applying: silently
// repopulating a form the user thought was blank is its own hazard.
function abpsDraftOfferRestore(key, containerId, applyExtraState, opts) {
  const draft = abpsDraftRead(key);
  const root = document.getElementById(containerId);
  if (!draft || !root) return;
  const existing = document.getElementById(`abps-draft-bar-${key}`);
  if (existing) existing.remove();

  const when = new Date(draft.ts);
  const hhmm = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const sameDay = when.toDateString() === new Date().toDateString();
  const stamp = sameDay ? `at ${hhmm}` : `on ${String(when.getDate()).padStart(2, "0")}/${String(when.getMonth() + 1).padStart(2, "0")}/${when.getFullYear()} at ${hhmm}`;
  const fileNote = (opts && opts.hasFileUploads)
    ? ` <span style="font-weight:400;">Any attached files will need re-selecting.</span>` : "";

  const bar = document.createElement("div");
  bar.id = `abps-draft-bar-${key}`;
  bar.style.cssText = "background:#fff3cd; border:1px solid #ffc107; color:#856404; padding:10px 14px; border-radius:6px; font-size:0.84rem; font-weight:700; margin-bottom:14px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;";
  bar.innerHTML = `<span style="flex:1; min-width:220px;">You have unsaved work on this form from ${stamp}.${fileNote}</span>`;

  const restoreBtn = document.createElement("button");
  restoreBtn.type = "button";
  restoreBtn.className = "nav-btn-styled";
  restoreBtn.style.cssText = "background:var(--accent); padding:6px 16px; font-size:0.8rem;";
  restoreBtn.textContent = "Restore";
  restoreBtn.onclick = () => {
    abpsRestoreFields(containerId, draft.payload.fields);
    if (typeof applyExtraState === "function") applyExtraState(draft.payload.state);
    bar.remove();
  };

  const discardBtn = document.createElement("button");
  discardBtn.type = "button";
  discardBtn.className = "nav-btn-styled";
  discardBtn.style.cssText = "background:#6b7280; padding:6px 16px; font-size:0.8rem;";
  discardBtn.textContent = "Discard";
  discardBtn.onclick = () => { abpsDraftClear(key); bar.remove(); };

  bar.appendChild(restoreBtn);
  bar.appendChild(discardBtn);
  root.insertBefore(bar, root.firstChild);
}
