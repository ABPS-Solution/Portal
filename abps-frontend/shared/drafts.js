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
// 15 days (10 Oct 2026). Drafts are also saved per login on the server
// (routes/userDrafts.js) so they follow the person to another device and
// survive logout; the browser copy is what screens read.
const ABPS_DRAFT_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;
const ABPS_DRAFT_OWNER_KEY = ABPS_DRAFT_PREFIX + "__owner";
const abpsDraftPushTimers = {};
const abpsDraftPushPending = {};
const ABPS_DRAFT_DEBOUNCE_MS = 800;
const abpsDraftTimers = {};

function abpsDraftSave(key, payload) {
  const ts = Date.now();
  try {
    localStorage.setItem(ABPS_DRAFT_PREFIX + key, JSON.stringify({ ts, payload }));
  } catch (_) { /* quota/private mode — autosave is best-effort by design */ }
  abpsDraftQueuePush(key, ts, payload);
}

function abpsDraftQueuePush(key, ts, payload) {
  abpsDraftPushPending[key] = { ts, payload };
  clearTimeout(abpsDraftPushTimers[key]);
  abpsDraftPushTimers[key] = setTimeout(() => abpsDraftPushNow(key), 1500);
}

function abpsDraftPushNow(key) {
  const p = abpsDraftPushPending[key];
  if (!p) return;
  delete abpsDraftPushPending[key];
  clearTimeout(abpsDraftPushTimers[key]);
  if (typeof apFetch !== "function") return;
  apFetch({ action: "saveUserDraft", key, ts: p.ts, payload: p.payload }).catch(() => {});
}

// Called just before logout clears this browser, so the last few seconds
// of typing still reach the server.
function abpsDraftFlushAll() {
  Object.keys(abpsDraftPushPending).forEach(abpsDraftPushNow);
}

// Called after login / page load: brings this person's saved progress from
// the server into this browser (newer copy wins, both ways). A different
// person's leftover browser copies are removed first (shared devices).
async function abpsDraftSyncFromServer() {
  if (typeof apFetch !== "function") return;
  let data;
  try { data = await apFetch({ action: "fetchUserDrafts" }); } catch (_) { return; }
  if (!data || !data.success) return;
  try {
    const localKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ABPS_DRAFT_PREFIX) && k !== ABPS_DRAFT_OWNER_KEY) localKeys.push(k);
    }
    const owner = localStorage.getItem(ABPS_DRAFT_OWNER_KEY);
    if (owner && owner !== data.personKey) {
      localKeys.forEach(k => localStorage.removeItem(k));
      localKeys.length = 0;
    }
    localStorage.setItem(ABPS_DRAFT_OWNER_KEY, data.personKey);
    const server = {};
    (data.drafts || []).forEach(d => { server[d.key] = d; });
    localKeys.forEach(k => {
      const key = k.slice(ABPS_DRAFT_PREFIX.length);
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(k) || "null"); } catch (_) {}
      if (!raw || !raw.payload) return;
      if (Date.now() - raw.ts > ABPS_DRAFT_MAX_AGE_MS) { localStorage.removeItem(k); return; }
      if (!server[key] || raw.ts > server[key].ts) abpsDraftQueuePush(key, raw.ts, raw.payload);
    });
    Object.values(server).forEach(d => {
      if (Date.now() - d.ts > ABPS_DRAFT_MAX_AGE_MS) return;
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(ABPS_DRAFT_PREFIX + d.key) || "null"); } catch (_) {}
      if (!raw || raw.ts < d.ts) {
        try { localStorage.setItem(ABPS_DRAFT_PREFIX + d.key, JSON.stringify({ ts: d.ts, payload: d.payload })); } catch (_) {}
      }
    });
  } catch (_) { /* best-effort */ }
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
  delete abpsDraftPushPending[key];
  clearTimeout(abpsDraftPushTimers[key]);
  if (typeof apFetch === "function") apFetch({ action: "clearUserDraft", key }).catch(() => {});
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
    // Restored textareas keep their empty-state height; regrow them to fit.
    requestAnimationFrame(() => {
      document.querySelectorAll(`#${CSS.escape(containerId)} textarea`).forEach(t => {
        if (!t.offsetParent) return;
        t.style.height = "auto"; t.style.height = t.scrollHeight + "px";
      });
    });
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
