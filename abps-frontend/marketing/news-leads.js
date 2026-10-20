// Marketing -> News Leads (20 Oct 2026). Cards from the daily news read
// (lib/newsIngest.js). "Create Lead" opens the shared New Lead form inside the
// card (same form Email Leads uses), pre-filled from the article; once the
// lead is saved the card is linked to it (linkNewsLeadToLead). "Dismiss" hides it.
let nlState = { status: "New", signalType: "", days: 30, search: "", items: [], counts: {}, lastRun: null };
const NL_SIGNAL_TYPES = ["New plant / expansion", "Solar / renewable", "Substation / DISCOM / EPC", "Tender"];
const NL_SIGNAL_COLORS = { "New plant / expansion": "#1d4ed8", "Solar / renewable": "#b45309", "Substation / DISCOM / EPC": "#7c3aed", "Tender": "#be185d" };

function nlInit() {
  nlState.status = "New";
  nlState.search = "";
  const s = document.getElementById("nl-search"); if (s) s.value = "";
  const isAdmin = localStorage.getItem("erpIsUserAdminGlobal") === "true" || localStorage.getItem("isUserAdminGlobal") === "true";
  const runBtn = document.getElementById("nl-run-btn"); if (runBtn) runBtn.style.display = isAdmin ? "" : "none";
  nlLoad();
}

async function nlLoad() {
  const list = document.getElementById("nl-list");
  if (typeof parkSharedLeadForm === "function") parkSharedLeadForm();
  if (list) list.innerHTML = `<div style="padding:16px; color:var(--muted);">Loading news leads...</div>`;
  try {
    const d = await apFetch({ action: "fetchNewsLeads", status: nlState.status, signalType: nlState.signalType || null, days: nlState.days, search: nlState.search });
    if (!d.success) { if (list) list.innerHTML = `<div style="color:#b91c1c; padding:12px;">${escapeHtml(d.error || "Could not load news leads.")}</div>`; return; }
    nlState.items = d.items || []; nlState.counts = d.counts || {}; nlState.lastRun = d.lastRun || null;
    nlRender();
  } catch (e) {
    if (e && e.message === "SESSION_EXPIRED") return;
    if (list) list.innerHTML = `<div style="color:#b91c1c; padding:12px;">${escapeHtml(e.message)}</div>`;
  }
}

function nlSetStatus(st) { nlState.status = st; nlLoad(); }
function nlSetSignal(v) { nlState.signalType = v; nlLoad(); }
function nlSetDays(v) { nlState.days = parseInt(v, 10) || 30; nlLoad(); }
let nlSearchTimer = null;
function nlOnSearch(v) { clearTimeout(nlSearchTimer); nlSearchTimer = setTimeout(() => { nlState.search = v.trim(); nlLoad(); }, 350); }

function nlRender() {
  const tabs = document.getElementById("nl-tabs");
  if (tabs) {
    const labels = { New: "To review", Accepted: "Made into leads", Dismissed: "Dismissed", Filtered: "Filtered out" };
    tabs.innerHTML = Object.entries(labels).map(([k, label]) => {
      const on = nlState.status === k;
      return `<button class="nav-btn-styled" onclick="nlSetStatus('${k}')" style="width:auto; padding:7px 14px; font-size:0.82rem; background:${on ? "var(--brand)" : "#e2e8f0"}; color:${on ? "#fff" : "#334155"};">${label} (${nlState.counts[k] || 0})</button>`;
    }).join("");
  }
  const run = document.getElementById("nl-last-run");
  if (run) {
    const r = nlState.lastRun;
    run.textContent = r ? `Last checked ${typeof formatOrdinalDateTime === "function" ? formatOrdinalDateTime(r.startedAt) : r.startedAt}: ${r.fetched || 0} articles read, ${r.relevant || 0} new leads${(r.errors || []).length ? `, ${r.errors.length} source problem(s)` : ""}.` : "Not checked yet. The news is read every morning at 9:00 am.";
  }
  const list = document.getElementById("nl-list");
  if (!list) return;
  if (!nlState.items.length) {
    list.innerHTML = `<div style="padding:14px; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); color:var(--muted); font-size:0.88rem;">${nlState.status === "New" ? "Nothing to review right now." : "Nothing here."}</div>`;
    return;
  }
  list.innerHTML = nlState.items.map(nlCardHtml).join("");
}

function nlCardHtml(it) {
  const color = NL_SIGNAL_COLORS[it.signalType] || "#475569";
  const date = it.publishedAt ? (typeof formatOrdinalDate === "function" ? formatOrdinalDate(it.publishedAt) : String(it.publishedAt).slice(0, 10)) : "";
  const place = [it.location, it.state].filter(Boolean).join(", ");
  const facts = [
    it.companyName ? `<b>${escapeHtml(it.companyName)}</b>` : "",
    place ? escapeHtml(place) : "",
    it.capacity ? escapeHtml(it.capacity) : "",
    it.estimatedValue ? escapeHtml(it.estimatedValue) : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");
  const also = (it.alsoReported || []).length
    ? `<div style="font-size:0.78rem; color:var(--muted); margin-top:4px;">Also reported by: ${it.alsoReported.slice(0, 6).map(a => a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.sourceName || "link")}</a>` : escapeHtml(a.sourceName || "")).join(", ")}${it.alsoReported.length > 6 ? ` and ${it.alsoReported.length - 6} more` : ""}</div>` : "";
  let actions = "";
  if (it.status === "New") {
    actions = `<button class="nav-btn-styled" onclick="nlCreateLead(${it.newsId})" style="width:auto; padding:7px 14px; background:#15803d; color:#fff;">Create Lead</button>
      <button class="nav-btn-styled" onclick="nlDismiss(${it.newsId})" style="width:auto; padding:7px 14px; background:#f1f5f9; color:#475569;">Dismiss</button>`;
  } else if (it.status === "Accepted") {
    actions = `<span style="font-size:0.82rem; color:#15803d; font-weight:700;">Lead ${escapeHtml(it.leadId || "")} created${it.decidedBy ? " by " + escapeHtml(it.decidedBy) : ""}</span>`;
  } else {
    actions = `<span style="font-size:0.8rem; color:var(--muted);">${escapeHtml(it.status === "Dismissed" ? `Dismissed${it.decidedBy ? " by " + it.decidedBy : ""}${it.dismissReason ? ": " + it.dismissReason : ""}` : (it.filterReason || "Filtered"))}</span>
      <button class="nav-btn-styled" onclick="nlRestore(${it.newsId})" style="width:auto; padding:6px 12px; background:#e0e7ff; color:#3730a3;">Move to review</button>`;
  }
  return `<div class="nl-card" id="nl-card-${it.newsId}" style="border:1px solid var(--border); border-left:4px solid ${color}; border-radius:0; background:#fff; padding:12px 14px; margin-bottom:10px;">
    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start;">
      <div style="min-width:0; flex:1;">
        <div style="font-size:0.75rem; font-weight:700; color:${color}; text-transform:uppercase; letter-spacing:0.02em;">${escapeHtml(it.signalType || "News")}${it.confidence != null ? ` <span style="color:var(--muted); font-weight:600; text-transform:none;">· AI confidence ${it.confidence}%</span>` : ""}</div>
        <div style="font-size:0.98rem; font-weight:700; margin:3px 0;">${it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="color:#0f172a; text-decoration:none;">${escapeHtml(it.title)} ↗</a>` : escapeHtml(it.title)}</div>
        <div style="font-size:0.78rem; color:var(--muted);">${escapeHtml(it.sourceName || "")}${date ? " · " + escapeHtml(date) : ""}</div>
      </div>
    </div>
    ${facts ? `<div style="font-size:0.86rem; margin-top:8px;">${facts}</div>` : ""}
    ${it.projectSummary ? `<div style="font-size:0.86rem; margin-top:4px;">${escapeHtml(it.projectSummary)}</div>` : ""}
    ${it.whyRelevant || it.suggestedProducts ? `<div style="font-size:0.82rem; margin-top:6px; padding:6px 10px; background:#f0fdf4; color:#14532d;">${it.whyRelevant ? escapeHtml(it.whyRelevant) : ""}${it.suggestedProducts ? `${it.whyRelevant ? " " : ""}<b>Fits:</b> ${escapeHtml(it.suggestedProducts)}` : ""}</div>` : ""}
    ${also}
    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;">${actions}</div>
    <div id="nl-form-mount-${it.newsId}" style="display:none; margin-top:12px;"></div>
  </div>`;
}

async function nlDismiss(newsId) {
  const reason = await abpsPrompt("Dismiss this news lead? You can add a short reason (optional).", "", { title: "Dismiss", okLabel: "Dismiss" });
  if (reason === null) return;
  try {
    const d = await apFetch({ action: "dismissNewsLead", newsId, reason });
    if (!d.success) { abpsAlert(d.error || "Could not dismiss."); return; }
    nlLoad();
  } catch (e) { if (e.message !== "SESSION_EXPIRED") abpsAlert(e.message); }
}

async function nlRestore(newsId) {
  try {
    const d = await apFetch({ action: "restoreNewsLead", newsId });
    if (!d.success) { abpsAlert(d.error || "Could not move it back."); return; }
    nlLoad();
  } catch (e) { if (e.message !== "SESSION_EXPIRED") abpsAlert(e.message); }
}

async function nlRunNow() {
  if (!(await abpsConfirm("Read the news now? This takes a few minutes.", { title: "News Leads", okLabel: "Read now" }))) return;
  const btn = document.getElementById("nl-run-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Reading the news..."; }
  try {
    const d = await apFetch({ action: "runNewsLeadsNow", _timeoutMs: 540000 });
    if (!d.success) abpsAlert(d.error || "The news read failed.");
    else abpsAlert(`Done: ${d.result.fetched} articles read, ${d.result.relevant} new leads.`, { title: "News Leads" });
  } catch (e) { if (e.message !== "SESSION_EXPIRED") abpsAlert(e.message); }
  if (btn) { btn.disabled = false; btn.textContent = "Read news now"; }
  nlLoad();
}

// Opens the shared New Lead form inside the card, pre-filled from the article.
function nlCreateLead(newsId) {
  const it = nlState.items.find(x => x.newsId === newsId);
  const mountEl = document.getElementById(`nl-form-mount-${newsId}`);
  const form = document.getElementById("step2-new-entry-dropdown");
  if (!it || !mountEl || !form) { abpsAlert("The New Lead form could not be opened. Please refresh the page."); return; }
  if (typeof parkSharedLeadForm === "function") parkSharedLeadForm();
  if (!window._sharedLeadFormHome) window._sharedLeadFormHome = { parent: form.parentNode, next: form.nextSibling };
  form.style.display = "block";
  mountEl.appendChild(form);
  mountEl.style.display = "block";
  const remaining = document.getElementById("remaining-sections-form");
  const success = document.getElementById("success-screen");
  if (remaining) remaining.style.display = "block";
  if (success) success.style.display = "none";
  document.querySelectorAll("#remaining-sections-form input, #remaining-sections-form textarea, #remaining-sections-form select").forEach(input => {
    if (input.type === "checkbox" || input.type === "radio") input.checked = false;
    else if (input.tagName === "SELECT") { if (["act1", "act2", "act3", "act4", "actOffer"].includes(input.id)) input.value = "No"; else if (input.id !== "dropform-status") input.value = ""; }
    else if (input.id !== "dropform-company-locked") { input.value = ""; if (input.tagName === "TEXTAREA") input.style.height = "auto"; }
  });
  document.querySelectorAll(".other-input").forEach(el => el.style.display = "none");
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set("dropform-company-locked", it.companyName || "");
  set("dropform-city", it.location || "");
  set("dropform-state", it.state || "");
  set("dropform-country", "India");
  const note = [
    `From news: ${it.title}`,
    [it.sourceName, it.publishedAt ? String(it.publishedAt).slice(0, 10) : ""].filter(Boolean).join(", "),
    it.url || "",
    it.projectSummary || "",
    [it.capacity, it.estimatedValue].filter(Boolean).join(", "),
    it.suggestedProducts ? `Fits: ${it.suggestedProducts}` : "",
  ].filter(Boolean).join("\n");
  const tech = document.getElementById("techSummary");
  if (tech) { tech.value = note; if (typeof autoGrowTextField === "function") autoGrowTextField(tech); }
  currentActiveModuleContext = "DROPDOWN";
  if (typeof applyEngineerFieldLockState === "function") applyEngineerFieldLockState();
  ["global-direct-inline-create-entry-btn", "global-direct-inline-collapse-entry-btn"].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
  const back = document.getElementById("canvas-back-btn-enclosure-row"); if (back) back.innerHTML = "";
  window._newsLeadCreateCtx = { newsId };
  window._emailLeadFormCancelCleanup = () => { window._newsLeadCreateCtx = null; if (typeof parkSharedLeadForm === "function") parkSharedLeadForm(); mountEl.style.display = "none"; };
  mountEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Called from the New Lead submit success path (marketing/leads.js).
async function nlAfterLeadCreated(leadId) {
  const ctx = window._newsLeadCreateCtx;
  window._newsLeadCreateCtx = null;
  if (!ctx || !leadId) return;
  try { await apFetch({ action: "linkNewsLeadToLead", newsId: ctx.newsId, leadId }); } catch (e) { console.error("linkNewsLeadToLead failed:", e); }
  setTimeout(nlLoad, 2500);
}
