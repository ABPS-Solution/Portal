// shared/liveUpdates.js — screens update by themselves when someone else
// changes the data (Oct 2026). Same file in Portal and ERP.
//
// The backend streams "these tables changed" messages (lib/liveEvents.js,
// fed by Postgres NOTIFY triggers on every marketing table). A screen
// registers with liveRegister(): which tables it shows, how to tell it is on
// screen, and how to re-run its current view quietly. On a change the
// visible screens that use those tables re-run their last search and keep
// open leads / expanded cards / scroll position.
//
// Never lose what someone is typing: while a field inside the results is
// focused or has unsaved edits (or a task / lead form is open), the refresh
// waits and a small bar says new data is waiting. It applies by itself once
// the person is done, or at once from the bar's button.
//
// Changes made from this tab are skipped for a moment (the screen already
// shows them); the stream connects straight to Cloud Run because Firebase
// Hosting cuts long responses at 60s.

const LIVE_TOKEN_KEY = (typeof ERP_LOCAL_STORAGE_KEYS !== "undefined") ? "erpSessionToken" : "sessionToken";
const LIVE_STREAM_URL = ((typeof API_DIRECT_URL !== "undefined") ? API_DIRECT_URL : GAS_URL).replace(/\/exec$/, "/api/liveEvents");
const LIVE_OWN_WRITE_QUIET_MS = 2500;
const LIVE_READ_ACTION = /^(fetch|search|get|check|pull|load|mint|list|download|match|resolve|preview|extract|generate)/i;

const liveScreens = [];
let liveAbort = null;
let liveToken = null;
let liveBackoffMs = 1000;
let liveLastOwnWrite = 0;
let liveConnectedOnce = false;
let liveBarEl = null;

// key: unique name; tables: table names ('marketing.leads') or schema
// prefixes ('marketing.'); isVisible(): on screen with something to refresh;
// results(): element holding the data (edits inside it hold the refresh);
// hold(): optional extra "don't refresh now"; refresh(): async re-run.
function liveRegister(key, def) {
  const i = liveScreens.findIndex(s => s.key === key);
  const entry = Object.assign({ key, pending: false, running: false, again: false }, def);
  if (i === -1) liveScreens.push(entry); else liveScreens[i] = entry;
}

function liveTablesMatch(screen, tables) {
  if (!tables) return true;
  return tables.some(t => screen.tables.some(s => s.endsWith(".") ? t.startsWith(s) : t === s));
}

// ── Unsaved-edit tracking ──────────────────────────────────────────────
// A field the person typed in / changed is marked; it counts as unsaved
// until the screen re-renders it or a save goes through from this tab.
document.addEventListener("input", (e) => { if (e.isTrusted && e.target) e.target.__liveDirty = true; }, true);
document.addEventListener("change", (e) => { if (e.isTrusted && e.target) e.target.__liveDirty = true; }, true);

function liveIsEditable(el) {
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  return !/^(button|submit|reset|image|hidden)$/i.test(el.type || "");
}

function liveIsShown(el) {
  return !!(el && el.isConnected && el.getClientRects().length);
}

const LIVE_FORM_SELECTORS = [
  ".template-task-form", '[id^="matrix-task-form-mount-"]', "#step2-new-entry-dropdown",
];

function liveHasUnsavedWork(root) {
  if (!root) return false;
  const a = document.activeElement;
  if (a && root.contains(a) && liveIsEditable(a)) return true;
  for (const el of root.querySelectorAll("input, textarea, select, [contenteditable='true']")) {
    if (el.__liveDirty) return true;
  }
  for (const sel of LIVE_FORM_SELECTORS) {
    for (const f of root.querySelectorAll(sel)) if (liveIsShown(f) && f.children.length) return true;
  }
  return false;
}

function liveClearDirty() {
  document.querySelectorAll("input, textarea, select, [contenteditable='true']").forEach(el => { el.__liveDirty = false; });
}

// Wrap apFetch: a successful write from this tab clears the unsaved marks
// and quiets the echo of our own change.
if (typeof apFetch === "function" && !apFetch.__liveWrapped) {
  const liveInnerApFetch = apFetch;
  apFetch = async function (payload) {
    const action = payload && payload.action;
    const isWrite = action && !LIVE_READ_ACTION.test(action);
    const data = await liveInnerApFetch(payload);
    if (isWrite && data && data.success !== false) { liveLastOwnWrite = Date.now(); liveClearDirty(); }
    return data;
  };
  apFetch.__liveWrapped = true;
}

// ── Waiting bar ────────────────────────────────────────────────────────
function liveShowBar(show) {
  if (!show) { if (liveBarEl) liveBarEl.style.display = "none"; return; }
  if (!liveBarEl) {
    liveBarEl = document.createElement("div");
    liveBarEl.id = "live-updates-bar";
    liveBarEl.style.cssText = "position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:9000; background:#1e3a8a; color:#fff; border-radius:999px; padding:8px 10px 8px 18px; font-size:0.9rem; font-weight:700; box-shadow:0 6px 20px rgba(0,0,0,0.25); display:flex; align-items:center; gap:12px; max-width:calc(100vw - 32px);";
    liveBarEl.innerHTML = `<span>Someone else changed this data. It will update when you finish editing.</span>
      <button type="button" style="width:auto; background:#fff; color:#1e3a8a; border:none; border-radius:999px; padding:6px 14px; font-weight:800; cursor:pointer;">Update now</button>`;
    liveBarEl.querySelector("button").onclick = () => {
      if (typeof abpsConfirm === "function") {
        abpsConfirm("Update now? Anything you have typed here and not saved will be lost.").then(ok => { if (ok) liveRunPending(true); });
      } else if (confirm("Update now? Anything you have typed here and not saved will be lost.")) {
        liveRunPending(true);
      }
    };
    document.body.appendChild(liveBarEl);
  }
  liveBarEl.style.display = "flex";
}

// ── Refresh scheduling ─────────────────────────────────────────────────
async function liveRunScreen(s) {
  if (s.running) { s.again = true; return; }
  s.running = true; s.pending = false;
  const y = window.scrollY;
  try { await s.refresh(); } catch (e) { if (e && e.message !== "SESSION_EXPIRED") console.warn("[live] refresh failed:", s.key, e); }
  finally {
    s.running = false;
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
    if (s.again) { s.again = false; liveRunScreen(s); }
  }
}

function liveRunPending(force) {
  let waiting = false;
  for (const s of liveScreens) {
    if (!s.pending) continue;
    let visible = false;
    try { visible = s.isVisible(); } catch (_) {}
    if (!visible) continue; // stays pending until the screen is opened again
    let held = false;
    if (!force) {
      try { held = liveHasUnsavedWork(s.results && s.results()) || (s.hold ? !!s.hold() : false); } catch (_) {}
    }
    if (held || document.hidden) { waiting = waiting || held; continue; }
    liveRunScreen(s);
  }
  liveShowBar(waiting);
}

function liveOnChange(tables) {
  for (const s of liveScreens) if (liveTablesMatch(s, tables)) s.pending = true;
  liveRunPending(false);
}

// Re-check held / hidden refreshes: after focus leaves a field, the tab
// becomes visible again, or every couple of seconds as a backstop.
document.addEventListener("focusout", () => setTimeout(() => liveRunPending(false), 150));
document.addEventListener("visibilitychange", () => { if (!document.hidden) liveRunPending(false); });
setInterval(() => { if (liveScreens.some(s => s.pending)) liveRunPending(false); }, 2000);

// ── The stream ─────────────────────────────────────────────────────────
async function liveConnect(token) {
  const ctrl = new AbortController();
  liveAbort = ctrl;
  let gotHello = false;
  try {
    const res = await fetch(LIVE_STREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token }),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) { liveToken = "__rejected__:" + token; return; }
    if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
        if (msg.t === "hello") {
          gotHello = true; liveBackoffMs = 1000;
          // Anything may have changed while we were reconnecting.
          if (liveConnectedOnce) liveOnChange(null);
          liveConnectedOnce = true;
        } else if (msg.t === "resync") {
          liveOnChange(null);
        } else if (msg.t === "change") {
          if (Date.now() - liveLastOwnWrite < LIVE_OWN_WRITE_QUIET_MS) continue;
          liveOnChange(msg.tables);
        }
      }
    }
  } catch (e) {
    if (ctrl.signal.aborted) return;
  } finally {
    if (liveAbort === ctrl) liveAbort = null;
  }
  if (ctrl.signal.aborted) return;
  const wait = gotHello ? 500 : liveBackoffMs;
  if (!gotHello) liveBackoffMs = Math.min(liveBackoffMs * 2, 30000);
  setTimeout(liveTick, wait);
}

// Keeps exactly one stream open while someone is logged in.
function liveTick() {
  const token = localStorage.getItem(LIVE_TOKEN_KEY);
  if (!token) {
    if (liveAbort) { liveAbort.abort(); liveAbort = null; }
    liveToken = null; liveConnectedOnce = false;
    return;
  }
  if (liveToken === "__rejected__:" + token) return; // expired session; wait for a new login
  if (liveToken !== token && liveAbort) { liveAbort.abort(); liveAbort = null; }
  if (liveAbort) return;
  liveToken = token;
  liveConnect(token);
}
setInterval(liveTick, 5000);
setTimeout(liveTick, 1500);

// ── Marketing screens ──────────────────────────────────────────────────
const LIVE_LEAD_TABLES = ["marketing.leads", "marketing.lead_contacts", "marketing.companies", "marketing.company_aliases",
  "marketing.tasks", "marketing.offers_sent", "marketing.po_invoice_report_information"];

// Search Leads by ABPS Engineer Name and Status (New Leads Report).
liveRegister("newLeadsReport", {
  tables: LIVE_LEAD_TABLES,
  isVisible: () => !!window._nlrLastFilters && liveIsShown(document.getElementById("nlr-output"))
    && !!document.querySelector("#nlr-output .nlr-table, #nlr-output .nlr-filtering"),
  results: () => document.getElementById("nlr-output"),
  refresh: async () => {
    const f = window._nlrLastFilters;
    const out = document.getElementById("nlr-output");
    const data = await apFetch({ action: "fetchNewLeadsReport", ...f });
    if (!data.success || !out) return;
    const openRow = out.querySelector(".nlr-row.open");
    const openId = openRow ? openRow.id.replace(/^nlr-row-/, "") : null;
    out.innerHTML = nlrRenderReport(data, f);
    if (openId && document.getElementById(`nlr-row-${openId}`)) await nlrToggleLead(openId);
  },
});

// Lead cards (Search by Company Name / Type of Customer / City-State /
// Engineer, New Leads Details). The last search that filled the main lead
// card list is remembered and re-run.
const LIVE_LEAD_SEARCH_ACTIONS = ["searchCompanyData", "searchByQualifications", "searchLeadsByCityStateMatrix", "searchByEngineer"];
let liveLastLeadSearch = null;
if (typeof apFetch === "function") {
  const liveOuter = apFetch;
  apFetch = async function (payload) {
    if (payload && LIVE_LEAD_SEARCH_ACTIONS.includes(payload.action)) liveLastLeadSearch = Object.assign({}, payload);
    return liveOuter(payload);
  };
  apFetch.__liveWrapped = true;
}
if (typeof buildMultiContactDirectoryInterface === "function") {
  const liveInnerBuild = buildMultiContactDirectoryInterface;
  buildMultiContactDirectoryInterface = function (leadsList, targetSearchName, containerId) {
    if (!containerId && !window._liveRebuildingLeadCards) {
      window._leadCardsLast = liveLastLeadSearch ? { payload: liveLastLeadSearch, targetName: targetSearchName || "" } : null;
    }
    return liveInnerBuild(leadsList, targetSearchName, containerId);
  };
}
liveRegister("leadCards", {
  tables: LIVE_LEAD_TABLES,
  isVisible: () => {
    const c = document.getElementById("multi-contact-records-container");
    return !!window._leadCardsLast && liveIsShown(c) && c.children.length > 0;
  },
  results: () => document.getElementById("multi-contact-records-container"),
  refresh: async () => {
    const last = window._leadCardsLast;
    const payload = Object.assign({}, last.payload);
    delete payload.sessionToken;
    const data = await apFetch(payload);
    if (!data.success || !Array.isArray(data.leads)) return;
    const openDrawer = Array.from(document.querySelectorAll('#multi-contact-records-container [id^="drawer-panel-"]'))
      .find(d => d.style.display === "block");
    const openRef = openDrawer ? openDrawer.id.replace(/^drawer-panel-/, "") : null;
    globalTasksCacheMap = data.tasks || {};
    window._liveRebuildingLeadCards = true;
    try { buildMultiContactDirectoryInterface(data.leads, last.targetName); }
    finally { window._liveRebuildingLeadCards = false; }
    const lead = openRef && data.leads.find(l => l["Lead ID"] === openRef);
    if (lead) toggleContactExpansionView(openRef, encodeURIComponent(JSON.stringify(lead)));
  },
});

// Search Tasks by ABPS Engineer Name and Status.
liveRegister("taskMatrix", {
  tables: ["marketing.tasks", "marketing.leads", "marketing.lead_contacts", "marketing.companies"],
  isVisible: () => !!window._taskMatrixLast && liveIsShown(document.getElementById("task-matrix-results-output-node")),
  results: () => document.getElementById("task-matrix-results-output-node"),
  refresh: async () => {
    const out = document.getElementById("task-matrix-results-output-node");
    const openCompanies = Array.from(out.querySelectorAll('[id^="matrix-task-company-expand-"]'))
      .filter(liveIsShown).map(el => el.id.replace(/^matrix-task-company-expand-/, ""));
    await executeTaskMatrixSearch({ live: true });
    openCompanies.forEach(id => { const b = document.getElementById(`view-company-btn-${id}`); if (b) b.click(); });
  },
});

// Leads Received through Email.
liveRegister("emailLeads", {
  tables: ["marketing.processed_emails", "marketing.email_lead_notes", "marketing.leads", "marketing.companies"],
  isVisible: () => liveIsShown(document.getElementById("email-leads-inbound-feed-canvas")),
  results: () => document.getElementById("email-leads-inbound-feed-canvas"),
  refresh: async () => {
    const feed = document.getElementById("email-leads-inbound-feed-canvas");
    const openBodies = Array.from(feed.querySelectorAll('[id^="email-full-message-body-"]'))
      .filter(el => el.style.display === "block").map(el => el.id.replace(/^email-full-message-body-/, ""));
    await refetchEmailLeadsListWithFilters({ silent: true });
    openBodies.forEach(idx => { if (document.getElementById(`email-full-message-body-${idx}`)) toggleEmailLeadFullMessage(idx); });
  },
});

// Marketing Dashboard.
liveRegister("marketingDashboard", {
  tables: ["marketing."],
  isVisible: () => liveIsShown(document.getElementById("md-body")),
  results: () => null,
  refresh: async () => { await mdLoadDashboard(window._mdLastCustomVal, { silent: true }); },
});

// Order Payment Progress. An open payment editor holds the refresh.
liveRegister("orderPayment", {
  tables: ["marketing.order_payment_schedule", "marketing.po_invoice_report_information"],
  isVisible: () => liveIsShown(document.getElementById("opp-list")) && Array.isArray(window.oppAllProjects),
  results: () => document.getElementById("opp-list"),
  hold: () => !!(window.oppExpandedProjects && window.oppExpandedProjects.size),
  refresh: async () => { await oppLoadList({ silent: true }); },
});
