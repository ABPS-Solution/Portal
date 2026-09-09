let cachedInboundEmailLeadsArray = [];
let activeEmailLeadContextIndex = null;
// engineer-name directory + the two active filter values, all populated
// from fetchEmailLeadsList's response (server is the source of truth for
// which mailboxes exist — see EMAIL_LEADS_ENGINEER_DIRECTORY in
// routes/marketing.js). 6 Sep 2026.
let cachedEmailLeadsEngineerDirectory = [];
// The selected mailbox is held here rather than read off a <select> — the
// filter is a laid-out row of pills now (7 Sep 2026, explicit request:
// the dropdown hid the whole list behind a click and made it impossible
// to see at a glance which mailboxes exist).
let activeEmailLeadsEngineerFilter = "ALL";
// Same reasoning, same pill pattern, applied to the date filter too
// (7 Sep 2026) — the native radio row read as five bare dots with no
// visual grouping, which is what looked "bad" about it.
let activeEmailLeadsDateFilter = "all";
// Company Name Search (9 Sep 2026) — a pure client-side substring filter
// over whatever engineer/date-filtered set is already cached, not a
// server round-trip: the whole point is instant-as-you-type narrowing,
// and the underlying list (unactioned leads for one mailbox/date range)
// is small enough that re-filtering the in-memory array on every
// keystroke is cheaper and simpler than debouncing a network call.
let activeEmailLeadsCompanySearch = "";
const EMAIL_LEADS_DATE_FILTER_OPTIONS = [
  ["all", "All Time"], ["today", "Today"], ["yesterday", "Yesterday"],
  ["thisWeek", "This Week"], ["thisMonth", "This Month"],
];

function resolveEmailLeadEngineerName(inboxAccount) {
  if (!inboxAccount) return "Unknown";
  const entry = cachedEmailLeadsEngineerDirectory.find(e => e.email && e.email.toLowerCase() === String(inboxAccount).toLowerCase());
  return entry ? entry.engineerName : "Not a recognised ABPS mailbox";
}

function getCurrentEmailLeadsFilters() {
  return { engineerEmail: activeEmailLeadsEngineerFilter, dateFilter: activeEmailLeadsDateFilter };
}

function selectEmailLeadsEngineerFilter(encodedEmail) {
  activeEmailLeadsEngineerFilter = decodeURIComponent(encodedEmail);
  renderEmailLeadsEngineerPills();
  refetchEmailLeadsListWithFilters();
}

function selectEmailLeadsDateFilter(value) {
  activeEmailLeadsDateFilter = value;
  renderEmailLeadsDatePills();
  refetchEmailLeadsListWithFilters();
}

function renderEmailLeadsDatePills() {
  const wrap = document.getElementById("email-leads-date-pills");
  if (!wrap) return;
  wrap.innerHTML = EMAIL_LEADS_DATE_FILTER_OPTIONS.map(([value, label]) => {
    const active = activeEmailLeadsDateFilter === value;
    return `
      <div onclick="selectEmailLeadsDateFilter('${value}')"
        style="cursor:pointer; user-select:none; border:1.5px solid ${active ? "var(--brand)" : "var(--border)"};
               background:${active ? "var(--highlight-bg)" : "#fff"}; color:${active ? "var(--brand)" : "var(--text)"};
               border-radius:6px; padding:6px 12px; font-size:0.78rem; font-weight:700;">${label}</div>`;
  }).join("");
}

// One pill per mailbox, wrapping across as many rows as it takes. The
// backend only ever sends OUR OWN mailboxes here plus, when there are
// still leftover rows from the old resolution bug, a single synthetic
// "__UNRECOGNISED__" bucket — a customer's address is never its own pill.
function renderEmailLeadsEngineerPills() {
  const wrap = document.getElementById("email-leads-engineer-pills");
  if (!wrap) return;
  const pill = (value, title, subtitle, isStray) => {
    const active = activeEmailLeadsEngineerFilter === value;
    const border = active ? "var(--brand)" : "var(--border)";
    const bg = active ? "var(--highlight-bg)" : "#fff";
    const titleColor = active ? "var(--brand)" : (isStray ? "var(--warn)" : "var(--text)");
    return `
      <div onclick="selectEmailLeadsEngineerFilter('${encodeURIComponent(value)}')"
        style="cursor:pointer; user-select:none; border:1.5px solid ${border}; background:${bg}; border-radius:6px;
               padding:6px 10px; min-width:0; display:flex; flex-direction:column; gap:1px; line-height:1.25;">
        <span style="font-size:0.78rem; font-weight:700; color:${titleColor};">${escapeHtml(title)}</span>
        ${subtitle ? `<span style="font-size:0.68rem; font-family:monospace; color:var(--muted); word-break:break-all;">${escapeHtml(subtitle)}</span>` : ""}
      </div>`;
  };
  wrap.innerHTML =
    pill("ALL", "All Engineers", "", false) +
    cachedEmailLeadsEngineerDirectory.map(e =>
      e.unrecognised ? pill(e.email, e.engineerName, "", true) : pill(e.email, e.engineerName, e.email, false)
    ).join("");
}

function populateEmailLeadsEngineerDropdown(directory) {
  cachedEmailLeadsEngineerDirectory = Array.isArray(directory) ? directory : [];
  // A previously-selected mailbox can disappear between refreshes (its
  // last unactioned lead got handled) — fall back to All rather than
  // silently filtering on something no longer offered.
  if (activeEmailLeadsEngineerFilter !== "ALL"
      && !cachedEmailLeadsEngineerDirectory.some(e => e.email === activeEmailLeadsEngineerFilter)) {
    activeEmailLeadsEngineerFilter = "ALL";
  }
  renderEmailLeadsEngineerPills();
}

function updateEmailLeadsFilteringForText() {
  const display = document.getElementById("email-leads-active-filters-display");
  if (!display) return;
  const { engineerEmail, dateFilter } = getCurrentEmailLeadsFilters();
  let engineerLabel;
  if (engineerEmail === "ALL") {
    engineerLabel = "All Engineers";
  } else {
    const entry = cachedEmailLeadsEngineerDirectory.find(e => e.email === engineerEmail);
    engineerLabel = entry && entry.unrecognised
      ? entry.engineerName
      : resolveEmailLeadEngineerName(engineerEmail) + " — " + engineerEmail;
  }
  const DATE_LABELS = { all: "All Time", today: "Today", yesterday: "Yesterday", thisWeek: "This Week", thisMonth: "This Month" };
  display.textContent = `Filtering for: ${engineerLabel} | for ${DATE_LABELS[dateFilter] || "All Time"}`;
}

// Filters cachedInboundEmailLeadsArray by the current Company Name Search
// text (case-insensitive substring on extractedCompany) and renders the
// result — called both on every keystroke and after any server refetch,
// so the search stays applied across an engineer/date pill change rather
// than resetting.
function applyEmailLeadsCompanySearchAndRender() {
  const term = activeEmailLeadsCompanySearch.trim().toLowerCase();
  const filtered = term
    ? cachedInboundEmailLeadsArray.filter(m => String(m.extractedCompany || "").toLowerCase().includes(term))
    : cachedInboundEmailLeadsArray;
  renderEmailLeadsFeedInterface(filtered, term ? `No companies matching "${activeEmailLeadsCompanySearch.trim()}" in this view.` : null);
}

function handleEmailLeadsCompanySearchInput(value) {
  activeEmailLeadsCompanySearch = value;
  applyEmailLeadsCompanySearchAndRender();
}

// Lighter-weight than executeInboundEmailSyncPipelineFetch — just re-runs
// fetchEmailLeadsList with the currently-selected filters, no Gmail poll
// (fetchAndProcessInboundEmailLeads is expensive/quota-bound and has no
// reason to re-run just because the operator changed a filter dropdown).
async function refetchEmailLeadsListWithFilters() {
  updateEmailLeadsFilteringForText();
  const feedCanvas = document.getElementById("email-leads-inbound-feed-canvas");
  if (feedCanvas) feedCanvas.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); font-size:0.85rem;">Loading...</div>`;
  const { engineerEmail, dateFilter } = getCurrentEmailLeadsFilters();
  try {
    const data = await apFetch({ action: "fetchEmailLeadsList", engineerEmail, dateFilter });
    if (data.success) {
      cachedInboundEmailLeadsArray = data.emailLeads || [];
      if (data.engineerDirectory) populateEmailLeadsEngineerDropdown(data.engineerDirectory);
      try { localStorage.setItem("abps_active_email_leads_cache", JSON.stringify(cachedInboundEmailLeadsArray)); } catch(e) { /* quota — ok */ }
      applyEmailLeadsCompanySearchAndRender();
    } else if (feedCanvas) {
      feedCanvas.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-size:0.85rem;">Failed to load leads: ${escapeHtml(data.error || "Unknown error")}</div>`;
    }
  } catch (e) {
    if (feedCanvas) feedCanvas.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn); font-size:0.85rem;">Network error: ${escapeHtml(e.message)}</div>`;
  }
}

/**
 * EXECUTE INBOUND EMAIL SYNC PIPELINE FETCH
 * Connects to the backend server to pull unread emails, runs the AI classifier,
 * and updates the interface layout with instruction-centered headers.
 */
async function executeInboundEmailSyncPipelineFetch() {
  // Static list, no server round-trip needed — rendered here (the
  // panel-open entry point) so the pills exist before the first fetch
  // resolves, not just after selectEmailLeadsDateFilter is first clicked.
  renderEmailLeadsDatePills();
  const companySearchInput = document.getElementById("email-leads-company-search-input");
  if (companySearchInput) companySearchInput.value = activeEmailLeadsCompanySearch;
  // syncBtn no longer exists — the "Sync Inbox" button was retired since scanning now
  // runs automatically via background triggers. This function still runs on panel-open
  // to populate the feed, so every reference to syncBtn below is now optional.
  const syncBtn = document.getElementById("email-sync-trigger-btn");
  const feedbackNode = document.getElementById("email-leads-runtime-status-feedback");
  const feedCanvas = document.getElementById("email-leads-inbound-feed-canvas");
  
  if (!feedbackNode || !feedCanvas) {
    console.error("UI Render Error: One or more compulsory target elements are missing from the DOM.");
    return;
  }
  
  // 1. Lock the interface button to block multiple overlapping server requests (if present)
  if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = "Syncing..."; }
  
  // 2. Set up the high-visibility animated loading banner look
  feedbackNode.style.cssText = `
    display: flex; 
    align-items: center; 
    justify-content: center; 
    gap: 12px; 
    padding: 12px; 
    background: var(--highlight-bg); 
    border: 1.5px solid var(--brand); 
    border-radius: var(--radius); 
    color: var(--brand);
    margin-bottom: 16px;
    animation: pulseGlow 1.8s infinite ease-in-out;
  `;
  
  // Inject the clean spinning hardware-accelerated loader graphics vector circle inline
  feedbackNode.innerHTML = `
    <div class="spinner" style="
      width: 16px; 
      height: 16px; 
      border: 2px solid var(--border); 
      border-top-color: var(--brand); 
      border-radius: 50%; 
      animation: spin 0.8s linear infinite;
    "></div>
    <span style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
      Connecting to mail server...
    </span>
  `;
  
  try {
    // 3. Poll for new mail first (fetchAndProcessInboundEmailLeads only
    // ever returns poll counts — {processed, leads, errors} — never the
    // rows themselves, so it can't populate the feed on its own), then
    // fetch the actual list. This two-step call is the fix for the bug
    // where the feed always rendered empty: previously there was no
    // route that returned emailLeads at all.
    const pollData = await apFetch({
      action: "fetchAndProcessInboundEmailLeads",
      activeEngineer: appActiveOperatorIdentityString
    });
    if (!pollData.success) {
      feedbackNode.style.cssText = "display: block; padding: 12px; border-radius: var(--radius); background: #fff5f5; border: 1px solid var(--warn); color: var(--warn); font-weight: 700; text-align: center; margin-bottom: 16px;";
      feedbackNode.textContent = "Sync failed: " + (pollData.error || "Unknown backend error context.");
      return;
    }

    const { engineerEmail, dateFilter } = getCurrentEmailLeadsFilters();
    const data = await apFetch({ action: "fetchEmailLeadsList", engineerEmail, dateFilter });
    updateEmailLeadsFilteringForText();

    // 4. Handle response success states and mount elements to your interface canvas
    if (data.success) {
      cachedInboundEmailLeadsArray = data.emailLeads || [];
      if (data.engineerDirectory) populateEmailLeadsEngineerDropdown(data.engineerDirectory);
      try {
        localStorage.setItem("abps_active_email_leads_cache", JSON.stringify(cachedInboundEmailLeadsArray));
      } catch(storageErr) {
        // localStorage quota exceeded — trim oldest 20 entries and retry
        if (cachedInboundEmailLeadsArray.length > 20) {
          cachedInboundEmailLeadsArray = cachedInboundEmailLeadsArray.slice(0, 20);
        }
        try { localStorage.setItem("abps_active_email_leads_cache", JSON.stringify(cachedInboundEmailLeadsArray)); } catch(e2) { /* silent fail */ }
      }

      applyEmailLeadsCompanySearchAndRender();
      feedbackNode.style.display = "none";
    } else {
      feedbackNode.style.cssText = "display: block; padding: 12px; border-radius: var(--radius); background: #fff5f5; border: 1px solid var(--warn); color: var(--warn); font-weight: 700; text-align: center; margin-bottom: 16px;";
      feedbackNode.textContent = "Failed to load leads: " + (data.error || "Unknown backend error context.");
    }
  } catch (error) {
    feedbackNode.style.cssText = "display: block; padding: 12px; border-radius: var(--radius); background: #fff5f5; border: 1px solid var(--warn); color: var(--warn); font-weight: 700; text-align: center; margin-bottom: 16px;";
    feedbackNode.textContent = "Network runtime connection failure: " + error.message;
    console.error("Inbound email pipeline operational sync crash: ", error);
  } finally {
    // 5. Restore full structural button states parameters regardless of success or failure paths
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = "Refresh Leads"; }
  }
}

// Age-since-received bucket for a lead card's left-border/chip color —
// same 3-color language (fresh/soon/overdue) already used by QA
// Inspection Timeline and the department dashboards, applied here so a
// stale, still-unactioned lead is visible at a glance without opening it.
function emailLeadAgeInfo(receivedDate) {
  if (!receivedDate) return { label: "", cls: "fresh" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rd = new Date(String(receivedDate).slice(0, 10) + "T00:00:00");
  const days = Math.round((today - rd) / 86400000);
  if (days <= 0) return { label: "Received Today", cls: "fresh" };
  if (days === 1) return { label: "1 day ago", cls: "fresh" };
  if (days <= 4) return { label: `${days} days ago`, cls: "soon" };
  return { label: `${days} days overdue`, cls: "overdue" };
}
const EMAIL_LEAD_AGE_COLORS = {
  fresh: { border: "#15803d", chipBg: "#dcfce7", chipText: "#15803d" },
  soon: { border: "#b45309", chipBg: "#fef3c7", chipText: "#b45309" },
  overdue: { border: "#b91c1c", chipBg: "#fee2e2", chipText: "#b91c1c" },
};

/**
 * RENDER EMAIL LEADS LIVE FEED CANVAS
 * Generates interactive lead cards off compiled email assets caches,
 * implementing smart admin-only action guards and inline form workspace drawers.
 */
function renderEmailLeadsFeedInterface(emailLeadsList, emptyMessageOverride) {
  const canvas = document.getElementById("email-leads-inbound-feed-canvas");
  if (!canvas) return;
  canvas.innerHTML = "";

  if (emailLeadsList.length === 0) {
    canvas.innerHTML = `
      <div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <h3 style="color: var(--accent); margin-bottom:6px;">No Email Leads Found</h3>
        <p style="margin:0;">${escapeHtml(emptyMessageOverride || "Nothing has been classified as a lead yet. New incoming emails are scanned automatically in the background every 5 minutes.")}</p>
      </div>
    `;
    return;
  }
  
  // CHRONOLOGICAL SORT MATRIX: Newest First tracking using Unix Epoch value weights
  emailLeadsList.sort((a, b) => b.rawUnixTimestampValue - a.rawUnixTimestampValue);
  
  emailLeadsList.forEach((mail, mIdx) => {
    let card = document.createElement("div");
    card.className = "contact-summary-card-parent";
    card.id = `email-lead-wrapper-node-${mIdx}`;
    card.style.cssText = "display:flex; flex-direction:column; gap:12px;";

    const age = emailLeadAgeInfo(mail.receivedDate);
    const ageColor = EMAIL_LEAD_AGE_COLORS[age.cls];
    card.style.borderLeft = `4px solid ${ageColor.border}`;

    // attachments is a plain comma-separated text column, not an array —
    // only shown at all when there's a real one, instead of a permanent
    // "Attachments: None" row on every card.
    const hasAttachments = mail.attachments && String(mail.attachments).trim();
    const receivedTimeLabel = mail.receivedTime ? `, ${formatTime12h(mail.receivedTime)}` : "";

    // FIXED: Enforce role visibility restriction boundaries to guard delete actions
    const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
    const deleteActionHtml = isAdminUser
      ? `<button style="background:none; border:none; color:var(--muted); font-size:0.78rem; font-weight:600; cursor:pointer; padding:0;" onmouseover="this.style.color='var(--warn)'" onmouseout="this.style.color='var(--muted)'" onclick="archiveEmailLeadFromSystemDatabaseCache('${mail.messageIdReference}', ${mIdx})">Delete</button>`
      : "";

    const hasNote = mail.notes && String(mail.notes).trim();

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span style="font-size:1.02rem; font-weight:800; color:var(--brand);">${escapeHtml(mail.extractedCompany)}</span>
          <span style="font-size:0.88rem; color:var(--text); font-weight:600;">· ${escapeHtml(mail.extractedContactName)}</span>
        </div>
        <span style="flex-shrink:0; font-size:0.7rem; font-weight:800; letter-spacing:0.02em; text-transform:uppercase; padding:3px 10px; border-radius:20px; white-space:nowrap; background:${ageColor.chipBg}; color:${ageColor.chipText};">${escapeHtml(age.label)}</span>
      </div>

      <div style="font-size:0.8rem; color:var(--muted); display:flex; flex-wrap:wrap; gap:4px 18px;">
        <span title="The ABPS mailbox this email was received into">To <b style="color:var(--text); font-weight:600;">${escapeHtml(resolveEmailLeadEngineerName(mail.destinationInboxAccount))}</b> <span style="font-family:monospace; font-size:0.78rem;">${escapeHtml(mail.destinationInboxAccount || "Unknown")}</span></span>
        <span title="The customer's email address">From <span style="font-family:monospace; font-size:0.78rem;">${escapeHtml(mail.senderEmail || "Not recorded yet")}</span></span>
        <span>${formatOrdinalDate(mail.receivedDate)}${receivedTimeLabel}</span>
      </div>

      <div style="font-size:0.85rem; background:var(--highlight-bg); border:1px solid var(--border); border-radius:6px; padding:10px 12px; line-height:1.5; color:var(--text);">
        <strong>AI Summary —</strong> ${escapeHtml(mail.aiSummaryText)}
      </div>

      <div style="display:flex; align-items:center; gap:18px; font-size:0.8rem;">
        <span style="color:var(--brand); font-weight:600; cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:4px;" onclick="toggleEmailLeadFullMessage(${mIdx})" id="email-full-message-toggle-${mIdx}">
          <span id="email-full-message-caret-${mIdx}">▸</span> View Full Email
        </span>
        ${hasAttachments ? `<span style="color:var(--muted); display:flex; align-items:center; gap:4px;">📎 ${escapeHtml(mail.attachments)}</span>` : ""}
      </div>
      <div id="email-full-message-body-${mIdx}" style="display:none; margin-top:-4px; background:#fff; border:1px solid var(--border); border-radius:4px; padding:10px; font-size:0.82rem; color:var(--text);">
        <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(mail.subject || "(no subject)")}</div>
        <div style="white-space:pre-wrap; line-height:1.5; max-height:400px; overflow-y:auto;">${escapeHtml(mail.body || "(no body content available)")}</div>
      </div>

      <div id="email-notes-zone-${mIdx}">
        <div id="email-notes-preview-${mIdx}" style="display:${hasNote ? "flex" : "none"}; align-items:flex-start; justify-content:space-between; gap:12px; background:var(--highlight-bg); border:1px solid var(--border); border-radius:6px; padding:8px 12px; font-size:0.8rem;">
          <div>
            <div id="email-note-preview-text-${mIdx}" style="color:var(--text); line-height:1.4;">${escapeHtml(mail.notes || "")}</div>
            <div id="email-note-creator-${mIdx}" style="color:var(--muted); font-size:0.72rem; margin-top:3px;">${mail.creatorOfNote ? "Last saved by: " + escapeHtml(mail.creatorOfNote) : ""}</div>
          </div>
          <span style="color:var(--brand); font-weight:700; cursor:pointer; flex-shrink:0;" onclick="toggleEmailLeadNotesEditor(${mIdx})">Edit</span>
        </div>
        <div id="email-notes-add-link-${mIdx}" style="display:${hasNote ? "none" : "block"}; font-size:0.8rem; color:var(--brand); font-weight:600; cursor:pointer; width:fit-content;" onclick="toggleEmailLeadNotesEditor(${mIdx})">+ Add note</div>
        <div id="email-notes-editor-${mIdx}" style="display:none; align-items:flex-end; gap:8px;">
          <textarea id="email-note-${mIdx}" placeholder="Add notes about this email lead..." style="flex:1; min-height:44px; padding:8px; font-size:0.82rem; border:1px solid var(--border); border-radius:4px; resize:vertical; font-family:inherit;">${escapeHtml(mail.notes || "")}</textarea>
          <button class="nav-btn-styled" style="background:var(--brand); font-size:0.78rem; padding:8px 14px; white-space:nowrap; flex-shrink:0;" onclick="saveEmailLeadNote(${mIdx}, '${mail.messageIdReference}')">Save Note</button>
        </div>
      </div>

      <div style="display:flex; align-items:center; justify-content:flex-end; gap:16px; padding-top:10px; border-top:1px solid var(--border);" id="email-action-response-mount-zone-${mIdx}">
        ${deleteActionHtml}
        <button class="btn btn-sub" style="width:auto; font-size:0.82rem; padding:9px 18px;" onclick="triggerEmailLeadDatabaseActionPipeline(${mIdx})" id="email-form-toggle-btn-text-${mIdx}">Add in CRM / Log Follow-up</button>
      </div>

      <div id="email-nested-inline-database-workspace-anchor-${mIdx}" style="display:none; background:#f1f5f9; padding:8px; border-radius:6px; border:1px solid var(--border);"></div>
    `;
    canvas.appendChild(card);
  });
}

// "+ Add note" (empty state) or "Edit" (a note already exists) reveals
// the real textarea+Save row in place of whichever of those two was
// showing — a one-way reveal, same as the old always-open textarea just
// collapsed until asked for; nothing re-collapses it afterward, matching
// how Save Note has never auto-closed the editor either. The textarea's
// own id and saveEmailLeadNote are untouched.
function toggleEmailLeadNotesEditor(idx) {
  const preview = document.getElementById(`email-notes-preview-${idx}`);
  const addLink = document.getElementById(`email-notes-add-link-${idx}`);
  const editor = document.getElementById(`email-notes-editor-${idx}`);
  if (editor) editor.style.display = "flex";
  if (preview) preview.style.display = "none";
  if (addLink) addLink.style.display = "none";
}

function toggleEmailLeadFullMessage(idx) {
  const body = document.getElementById(`email-full-message-body-${idx}`);
  const caret = document.getElementById(`email-full-message-caret-${idx}`);
  if (!body || !caret) return;
  const expanded = body.style.display !== "none";
  body.style.display = expanded ? "none" : "block";
  caret.textContent = expanded ? "▸" : "▾";
}

// Called after a follow-up, task, or new lead is successfully created off
// an Email Leads card (either directly, or from the nested existing-company
// directory opened via triggerEmailLeadDatabaseActionPipeline) — persists
// the "acted on" state server-side (markEmailLeadActioned) so the card stays
// gone on the next Refresh Leads / re-open, not just in this session's DOM.
async function markEmailLeadActionedAndRemoveCard(idx) {
  const mail = cachedInboundEmailLeadsArray[idx];
  if (!mail) return;
  const messageId = mail.messageIdReference;
  try {
    await apFetch({ action: "markEmailLeadActioned", activeEngineer: appActiveOperatorIdentityString, messageId });
  } catch (e) {
    console.error("markEmailLeadActioned failed:", e);
  }
  cachedInboundEmailLeadsArray = cachedInboundEmailLeadsArray.filter(item => item.messageIdReference !== messageId);
  try { localStorage.setItem("abps_active_email_leads_cache", JSON.stringify(cachedInboundEmailLeadsArray)); } catch(e) { /* quota — ok */ }
  const cardNode = document.getElementById(`email-lead-wrapper-node-${idx}`);
  if (cardNode) cardNode.remove();
  if (document.getElementById("email-leads-inbound-feed-canvas")?.children.length === 0) {
    renderEmailLeadsFeedInterface([]);
  }
}

// If scopeNode (a follow-up/task form's containing element) is inside the
// nested "existing company" directory opened from an Email Leads card,
// resolves and marks that card actioned. Returns silently otherwise — this
// same commit function is shared by every other lead/follow-up screen in
// Marketing, most of which have nothing to do with Email Leads.
function markEmailLeadActionedIfInEmailContext(scopeNode) {
  const anchor = scopeNode && scopeNode.closest('[id^="email-nested-inline-database-workspace-anchor-"]');
  if (!anchor) return;
  const idx = parseInt(anchor.id.replace("email-nested-inline-database-workspace-anchor-", ""), 10);
  if (!isNaN(idx)) markEmailLeadActionedAndRemoveCard(idx);
}

async function saveEmailLeadNote(idx, messageId) {
  const noteText = document.getElementById(`email-note-${idx}`)?.value?.trim() || "";
  const btn = event.target;
  btn.disabled = true; btn.textContent = "Saving...";
  try {
    const d = await apFetch({
      action: "saveEmailLeadNote",
      activeEngineer: appActiveOperatorIdentityString,
      messageId: messageId,
      noteText: noteText
    });
    if (d.success) {
      btn.textContent = "Saved ✓";
      btn.style.background = "var(--accent)";
      // Update creator display immediately
      const creatorEl = document.getElementById(`email-note-creator-${idx}`);
      if (creatorEl) creatorEl.textContent = "Last saved by: " + appActiveOperatorIdentityString;
      // Update local cache
      const mail = cachedInboundEmailLeadsArray.find(m => m.messageIdReference === messageId);
      if (mail) { 
        mail.notes = noteText; 
        mail.creatorOfNote = appActiveOperatorIdentityString;
        localStorage.setItem("abps_active_email_leads_cache", JSON.stringify(cachedInboundEmailLeadsArray)); 
      }
      setTimeout(() => { btn.textContent = "Save Note"; btn.style.background = "var(--brand)"; btn.disabled = false; }, 2000);  
    } else {
      alert("Failed to save note: " + (d.error || "Unknown error"));
      btn.disabled = false; btn.textContent = "Save Note";
    }
  } catch(e) {
    alert("Error: " + e.message);
    btn.disabled = false; btn.textContent = "Save Note";
  }
}

