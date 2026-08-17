let cachedInboundEmailLeadsArray = [];
let activeEmailLeadContextIndex = null;

/**
 * EXECUTE INBOUND EMAIL SYNC PIPELINE FETCH
 * Connects to the backend server to pull unread emails, runs the AI classifier,
 * and updates the interface layout with instruction-centered headers.
 */
async function executeInboundEmailSyncPipelineFetch() {
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

    const data = await apFetch({ action: "fetchEmailLeadsList" });

    // 4. Handle response success states and mount elements to your interface canvas
    if (data.success) {
      cachedInboundEmailLeadsArray = data.emailLeads || [];
      try {
        localStorage.setItem("abps_active_email_leads_cache", JSON.stringify(cachedInboundEmailLeadsArray));
      } catch(storageErr) {
        // localStorage quota exceeded — trim oldest 20 entries and retry
        if (cachedInboundEmailLeadsArray.length > 20) {
          cachedInboundEmailLeadsArray = cachedInboundEmailLeadsArray.slice(0, 20);
        }
        try { localStorage.setItem("abps_active_email_leads_cache", JSON.stringify(cachedInboundEmailLeadsArray)); } catch(e2) { /* silent fail */ }
      }

      renderEmailLeadsFeedInterface(cachedInboundEmailLeadsArray);
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

/**
 * RENDER EMAIL LEADS LIVE FEED CANVAS
 * Generates interactive lead cards off compiled email assets caches,
 * implementing smart admin-only action guards and inline form workspace drawers.
 */
function renderEmailLeadsFeedInterface(emailLeadsList) {
  const canvas = document.getElementById("email-leads-inbound-feed-canvas");
  if (!canvas) return;
  canvas.innerHTML = "";
  
  if (emailLeadsList.length === 0) {
    canvas.innerHTML = `
      <div style="text-align:center; padding:30px; color:var(--muted); font-size:0.9rem; background:#fff; border:1px solid var(--border); border-radius:6px;">
        <h3 style="color: var(--accent); margin-bottom:6px;">No Email Leads Found</h3>
        <p style="margin:0;">Nothing has been classified as a lead yet. New incoming emails are scanned automatically in the background every 5 minutes.</p>
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
    card.style.borderLeft = "4px solid var(--accent)";
    
    const attsLabel = mail.attachments && mail.attachments.length > 0 ? mail.attachments.join(", ") : "None";
    
    // FIXED: Enforce role visibility restriction boundaries to guard delete actions
    const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
    const deleteActionHtml = isAdminUser 
      ? `<button class="nav-btn-styled" style="background:var(--warn); font-size:0.75rem; padding:4px 8px;" onclick="archiveEmailLeadFromSystemDatabaseCache('${mail.messageIdReference}', ${mIdx})">Delete</button>` 
      : "";

    card.innerHTML = `
      <div class="contact-summary-header-row" style="margin-bottom:6px;">
        <div class="contact-summary-title-info">
          <div class="meta-row-line-block">
            <span style="background:var(--accent); color:#fff;">SOURCE: EMAIL</span>
            <span style="background:var(--highlight-bg); border:1px solid var(--brand); color:var(--brand); font-family:monospace; text-transform:none;">${mail.destinationInboxAccount}</span>
            <span style="background:#cbd5e1; color:#1e293b; font-weight:700;">${formatDateDMY(mail.receivedDate)} at ${formatTime12h(mail.receivedTime) || mail.receivedTime}</span>
          </div>
          <div class="meta-row-line-block" style="margin-top:6px;">
            <span style="background:#e2e8f0;">Company:</span><strong style="margin-right:20px; color:var(--brand);">${mail.extractedCompany}</strong>
            <span style="background:#edf2f7;">Contact Person Name:</span><strong>${mail.extractedContactName}</strong>
          </div>
        </div>
        <div class="directory-btn-actions-block" style="margin-top:4px; display:flex; gap:6px; align-items:center;">
          <a href="${mail.originalDeepLinkThreadUrl}" target="_blank" class="nav-btn-styled" style="background:#4a5568; text-decoration:none; font-size:0.75rem; padding:4px 8px; display:inline-flex; align-items:center;">Open Email ↗</a>
          ${deleteActionHtml}
        </div>
      </div>
      
      <div style="font-size:0.85rem; background:#f8fafc; border:1px solid #e2e8f0; padding:8px; border-radius:4px; margin:6px 0; line-height:1.4; color:var(--text);">
        <strong>AI Email Summary:</strong> ${mail.aiSummaryText}
      </div>
      
      <div style="font-size:0.72rem; font-weight:700; color:var(--muted); margin-bottom:8px;">
        📎 Attachments: <span style="color:#4a5568; font-family:monospace;">${attsLabel}</span>
      </div>

      <div style="margin-top:8px;">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:3px;">
          <label style="font-size:0.65rem; font-weight:700; color:var(--muted); text-transform:uppercase;">Notes</label>
          <span id="email-note-creator-${mIdx}" style="font-size:0.7rem; color:var(--muted); font-style:italic;">${mail.creatorOfNote ? "Last saved by: " + mail.creatorOfNote : ""}</span>
        </div>
        <div style="display:flex; align-items:flex-end; gap:8px;">
          <textarea id="email-note-${mIdx}" placeholder="Add notes about this email lead..." style="flex:1; min-height:38px; padding:5px 8px; font-size:0.82rem; border:1px solid var(--border); border-radius:4px; resize:vertical;">${mail.notes || ""}</textarea>
          <button class="nav-btn-styled" style="background:var(--brand); font-size:0.75rem; padding:4px 10px; white-space:nowrap; flex-shrink:0;" onclick="saveEmailLeadNote(${mIdx}, '${mail.messageIdReference}')">Save Note</button>
        </div>
      </div>
      
      <div style="margin-top:10px;" id="email-action-response-mount-zone-${mIdx}">
        <button class="btn btn-sub" style="width:auto; font-size:0.78rem; padding:5px 12px;" onclick="triggerEmailLeadDatabaseActionPipeline(${mIdx})" id="email-form-toggle-btn-text-${mIdx}">Check in CRM / Log Follow-up</button>
      </div>
      
      <div id="email-nested-inline-database-workspace-anchor-${mIdx}" style="margin-top:10px; display:none; background:#f1f5f9; padding:8px; border-radius:6px; border:1px solid var(--border);"></div>
    `;
    canvas.appendChild(card);
  });
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

