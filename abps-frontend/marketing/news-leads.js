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
    const labels = { New: "To review", Accepted: "Made into leads", Dismissed: "Dismissed" };
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
  // Same table look as Morning Meeting (nlr-table / mm-table classes).
  list.innerHTML = `<div style="overflow-x:auto;">
    <table class="nlr-table mm-table">
      <colgroup><col style="width:4%"><col style="width:10%"><col style="width:14%"><col style="width:31%"><col style="width:10%"><col style="width:13%"><col style="width:10%"><col style="width:8%"></colgroup>
      <thead><tr>
        <th class="nlr-center">Sr No</th><th class="nlr-center">Signal</th><th>Company &amp; Place</th>
        <th>What's Happening</th><th class="nlr-center">Capacity / Value</th><th>Fits ABPS</th><th>Source &amp; Date</th><th class="nlr-center">Action</th>
      </tr></thead>
      <tbody>${nlState.items.map((it, i) => nlRowHtml(it, i + 1)).join("")}</tbody>
    </table></div>`;
}

function nlRowHtml(it, sr) {
  const color = NL_SIGNAL_COLORS[it.signalType] || "#475569";
  const date = it.publishedAt ? (typeof formatOrdinalDate === "function" ? formatOrdinalDate(it.publishedAt) : String(it.publishedAt).slice(0, 10)) : "";
  const place = [it.location, it.state, it.country].filter(Boolean).join(", ");
  // High = a clear, named project to call about now; Medium = probably useful, worth a check.
  const level = it.confidence == null ? "" : (it.confidence >= 80 ? "High" : "Medium");
  // Indian amounts always with the ₹ sign ("INR 500 crore" / "Rs 500 cr" -> "₹500 crore")
  const rupee = v => String(v || "").replace(/\b(?:INR|Rs\.?)\s*/gi, "₹").replace(/₹\s+/g, "₹").replace(/(\d)\s*cr\b\.?/gi, "$1 crore");
  const none = '<span class="nlr-none">Not stated</span>';
  const also = (it.alsoReported || []).length
    ? `<div class="nlr-sub" style="margin-top:4px;">Also: ${it.alsoReported.slice(0, 4).map(a => a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.sourceName || "link")}</a>` : escapeHtml(a.sourceName || "")).join(", ")}${it.alsoReported.length > 4 ? ` +${it.alsoReported.length - 4}` : ""}</div>` : "";
  let actions;
  if (it.status === "New") {
    actions = `<button class="nav-btn-styled" onclick="nlCreateLead(${it.newsId})" style="width:100%; padding:6px 8px; font-size:0.8rem; background:#15803d; color:#fff; margin-bottom:5px;">Create Lead</button>
      <button class="nav-btn-styled" onclick="nlDismiss(${it.newsId})" style="width:100%; padding:6px 8px; font-size:0.8rem; background:#f1f5f9; color:#475569;">Dismiss</button>`;
  } else if (it.status === "Accepted") {
    actions = `<div style="font-weight:700; color:#15803d;">${escapeHtml(it.leadId || "")}</div>${it.decidedBy ? `<div class="nlr-sub">by ${escapeHtml(it.decidedBy)}</div>` : ""}`;
  } else {
    actions = `<div class="nlr-sub" style="margin-bottom:5px;">${escapeHtml(it.status === "Dismissed" ? `Dismissed${it.decidedBy ? " by " + it.decidedBy : ""}${it.dismissReason ? ": " + it.dismissReason : ""}` : (it.filterReason || "Filtered"))}</div>
      <button class="nav-btn-styled" onclick="nlRestore(${it.newsId})" style="width:100%; padding:5px 8px; font-size:0.78rem; background:#e0e7ff; color:#3730a3;">Move to review</button>`;
  }
  return `<tr id="nl-row-${it.newsId}">
      <td class="nlr-center" style="text-align:center;">${sr}</td>
      <td class="nlr-center" style="text-align:center;"><div style="font-size:0.78rem; font-weight:800; line-height:1.25; color:${color};">${escapeHtml(it.signalType || "News")}</div>${level ? `<span style="display:inline-block; margin-top:6px; padding:2px 10px; border-radius:999px; font-size:0.72rem; font-weight:800; ${level === "High" ? "background:#dcfce7; color:#15803d; border:1px solid #86efac;" : "background:#fef3c7; color:#b45309; border:1px solid #fcd34d;"}">${level}</span>` : ""}</td>
      <td>${it.companyName ? `<strong>${escapeHtml(it.companyName)}</strong>` : none}${place ? `<div class="nlr-sub">${escapeHtml(place)}</div>` : ""}</td>
      <td>${it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="font-weight:700; color:#0f172a;">${escapeHtml(it.title)} ↗</a>` : `<strong>${escapeHtml(it.title)}</strong>`}${it.projectSummary || it.whyRelevant ? `<div style="margin-top:5px; font-size:0.78rem; line-height:1.4; color:#334155;">${escapeHtml(rupee([it.projectSummary, it.whyRelevant].filter(Boolean).join(" ")))}</div>` : ""}</td>
      <td class="nlr-center" style="text-align:center;">${it.capacity ? `<div>${escapeHtml(it.capacity)}</div>` : ""}${it.estimatedValue ? `<div style="font-weight:700;">${escapeHtml(rupee(it.estimatedValue))}</div>` : ""}${!it.capacity && !it.estimatedValue ? none : ""}</td>
      <td>${it.suggestedProducts ? escapeHtml(it.suggestedProducts) : none}</td>
      <td>${escapeHtml(it.sourceName || "")}${date ? `<div class="nlr-sub">${escapeHtml(date)}</div>` : ""}${also}</td>
      <td class="nlr-center" style="text-align:center;">${actions}</td>
    </tr>
    <tr id="nl-form-row-${it.newsId}" style="display:none;"><td colspan="8" class="nlr-lead-cell"><div id="nl-form-mount-${it.newsId}" style="display:none;"></div></td></tr>`;
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
  const formRow = document.getElementById(`nl-form-row-${newsId}`); if (formRow) formRow.style.display = "";
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
  window._emailLeadFormCancelCleanup = () => { window._newsLeadCreateCtx = null; if (typeof parkSharedLeadForm === "function") parkSharedLeadForm(); mountEl.style.display = "none"; const fr = document.getElementById(`nl-form-row-${newsId}`); if (fr) fr.style.display = "none"; };
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
