// ═══════════════════════════════════════════════════════════════════════
// marketing/meeting-prep.js — Meeting Preparation (Marketing > Lead Source).
//
// Company typeahead -> pick one contact or ALL people -> a curated,
// read-only briefing: an AI-written bullet summary on top of a fully
// deterministic fact bundle (open items, activity timeline, commercial
// history, order-execution status). Every fact underneath the AI summary
// renders straight from the server response — the AI layer is a
// presentation convenience, never the only source of a number.
//
// Reuses the generalized company typeahead in shared/apFetch.js
// (handleCompanySearchTypeaheadInput/selectCompanySearchTypeahead, both
// now take inputId/ddId). The person picker below is its OWN copy of the
// same body-appended, position:fixed overlay pattern (not
// shared/ui.js's genericDropdown, which floats only within its own
// panel) — deliberately, so it renders in front of the whole card the
// same way the Material Name / company suggestion lists do, per
// CLAUDE.md's "clipped-dropdown fix pattern". Rendering below mirrors
// renderIsolatedDocumentInfoSection in marketing/leads.js — inline
// styles only, so it carries zero shared-CSS risk.
// ═══════════════════════════════════════════════════════════════════════

let mprepSelectedCompanyName = "";
let mprepContacts = [];
let mprepSelectedLeadIds = null; // null = ALL people

const MPREP_ALL_PEOPLE_VALUE = "__ALL__";

// ── Person picker — body-appended position:fixed overlay, same pattern
// as ensureCompanySearchDropdownEl (shared/apFetch.js). ─────────────────
function mprepEnsurePersonDropdownEl() {
  let dd = document.getElementById("mprep-person-picker-dd");
  if (!dd) {
    dd = document.createElement("div");
    dd.id = "mprep-person-picker-dd";
    dd.style.cssText = "display:none; position:fixed; background:#fff; border:1.5px solid var(--brand); border-radius:4px; z-index:9999; max-height:260px; overflow-y:auto; box-shadow:0 6px 16px rgba(0,0,0,0.15);";
    document.body.appendChild(dd);
  }
  return dd;
}

function mprepSetPersonDropdownDisabled(disabled, placeholderText) {
  const display = document.getElementById("mprep-person-picker-display");
  if (!display) return;
  display.dataset.disabled = disabled ? "1" : "0";
  display.style.opacity = disabled ? "0.5" : "1";
  display.style.cursor = disabled ? "not-allowed" : "pointer";
  display.style.background = disabled ? "#f1f5f9" : "#fff";
  if (placeholderText !== undefined) {
    const textEl = document.getElementById("mprep-person-picker-display-text");
    if (textEl) textEl.textContent = placeholderText;
  }
  if (disabled) mprepEnsurePersonDropdownEl().style.display = "none";
}

function mprepPopulatePersonDropdown(options) {
  const dd = mprepEnsurePersonDropdownEl();
  dd.innerHTML = options.map((o, i) => `
    <div data-idx="${i}" style="padding:9px 12px; cursor:pointer; font-size:0.88rem; border-bottom:1px solid var(--border); line-height:1.35;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background=''">${o.label}</div>
  `).join("");
  Array.from(dd.children).forEach((el, i) => {
    el.onclick = () => mprepSelectPersonDropdown(options[i].value, options[i].label);
  });
}

function mprepToggleAndPositionPersonDropdown() {
  const display = document.getElementById("mprep-person-picker-display");
  if (!display || display.dataset.disabled === "1") return;
  const dd = mprepEnsurePersonDropdownEl();
  if (dd.style.display === "block") { dd.style.display = "none"; return; }
  const rect = display.getBoundingClientRect();
  dd.style.top = rect.bottom + "px";
  dd.style.left = rect.left + "px";
  dd.style.width = rect.width + "px";
  dd.style.display = "block";
}

function mprepSelectPersonDropdown(value, label) {
  const textEl = document.getElementById("mprep-person-picker-display-text");
  if (textEl) textEl.textContent = label;
  const dd = document.getElementById("mprep-person-picker-dd");
  if (dd) dd.style.display = "none";
  mprepOnPersonPicked(value);
}

document.addEventListener("click", (e) => {
  const dd = document.getElementById("mprep-person-picker-dd");
  if (!dd) return;
  if (!e.target.closest("#mprep-person-picker-display") && !e.target.closest("#mprep-person-picker-dd")) {
    dd.style.display = "none";
  }
});

function mprepResetScreen() {
  mprepSelectedCompanyName = "";
  mprepContacts = [];
  mprepSelectedLeadIds = null;
  const companyInput = document.getElementById("mprep-company-input");
  if (companyInput) companyInput.value = "";
  const dd = document.getElementById("mprep-company-suggestions");
  if (dd) dd.style.display = "none";
  mprepSetPersonDropdownDisabled(true, "Select a company first");
  const generateBtn = document.getElementById("mprep-generate-btn");
  if (generateBtn) generateBtn.disabled = true;
  const resultsNode = document.getElementById("mprep-results");
  if (resultsNode) resultsNode.innerHTML = "";
  const errNode = document.getElementById("mprep-error-banner");
  if (errNode) { errNode.style.display = "none"; errNode.textContent = ""; }
}

// Called by the generalized typeahead in shared/apFetch.js the moment a
// company is picked (window.onCompanySearchTypeaheadSelect hook) — only
// fires for a non-default ddId, so it never affects Search by Company Name.
window.onCompanySearchTypeaheadSelect = function (companyValue, inputId) {
  if (inputId !== "mprep-company-input") return;
  mprepOnCompanySelected(companyValue);
};

async function mprepOnCompanySelected(companyName) {
  mprepSelectedCompanyName = companyName;
  mprepSelectedLeadIds = null;
  const generateBtn = document.getElementById("mprep-generate-btn");
  if (generateBtn) generateBtn.disabled = true;
  const resultsNode = document.getElementById("mprep-results");
  if (resultsNode) resultsNode.innerHTML = "";
  mprepSetPersonDropdownDisabled(true, "Loading contacts...");
  try {
    const data = await apFetch({ action: "fetchMeetingPrepContacts", companyName });
    if (!data.success) {
      mprepShowError(data.error || "Could not load contacts for this company.");
      return;
    }
    mprepContacts = data.contacts || [];
    const options = [
      { value: MPREP_ALL_PEOPLE_VALUE, label: `ALL people at this company (${mprepContacts.length} contact${mprepContacts.length === 1 ? "" : "s"})` },
      ...mprepContacts.map((c, i) => ({
        value: String(i),
        label: `${escapeHtml(c.contactPersonName)}${c.position ? " · " + escapeHtml(c.position) : ""}${c.lastActivityAt ? " · last touched " + escapeHtml(formatOrdinalDate(c.lastActivityAt)) : ""}`,
      })),
    ];
    mprepPopulatePersonDropdown(options);
    mprepSetPersonDropdownDisabled(false, "Select a contact or ALL people");
  } catch (e) {
    mprepShowError("Network error loading contacts: " + e.message);
  }
}

function mprepOnPersonPicked(value) {
  const generateBtn = document.getElementById("mprep-generate-btn");
  if (value === MPREP_ALL_PEOPLE_VALUE) {
    mprepSelectedLeadIds = null;
  } else {
    const idx = Number(value);
    mprepSelectedLeadIds = (mprepContacts[idx] && mprepContacts[idx].leadIds) || null;
  }
  if (generateBtn) generateBtn.disabled = false;
}

function mprepShowError(message) {
  const errNode = document.getElementById("mprep-error-banner");
  if (!errNode) return;
  errNode.textContent = message;
  errNode.style.display = "block";
}

async function mprepGenerateBrief() {
  if (!mprepSelectedCompanyName) return;
  const errNode = document.getElementById("mprep-error-banner");
  if (errNode) { errNode.style.display = "none"; errNode.textContent = ""; }
  const resultsNode = document.getElementById("mprep-results");
  const generateBtn = document.getElementById("mprep-generate-btn");
  if (generateBtn) generateBtn.disabled = true;
  if (resultsNode) resultsNode.innerHTML = `<div style="padding:24px; text-align:center; color:var(--muted);">Assembling briefing…</div>`;
  try {
    const data = await apFetch({
      action: "fetchMeetingPrepBrief",
      companyName: mprepSelectedCompanyName,
      leadIds: mprepSelectedLeadIds,
    });
    if (!data.success) {
      if (resultsNode) resultsNode.innerHTML = "";
      mprepShowError(data.error || "Could not generate the briefing.");
      return;
    }
    mprepRenderBrief(data.facts, data.aiBrief, data.aiError);
  } catch (e) {
    if (resultsNode) resultsNode.innerHTML = "";
    mprepShowError("Network error generating briefing: " + e.message);
  } finally {
    if (generateBtn) generateBtn.disabled = false;
  }
}

// ── Rendering — mirrors renderIsolatedDocumentInfoSection's inline-style
// model (marketing/leads.js) so this carries zero shared-CSS risk. ──────

// Labels whose value is a plain 'YYYY-MM-DD' string that should render
// as "8th Sep 2026" (formatOrdinalDate, shared/format.js) rather than
// the raw ISO form.
const MPREP_DATE_FIELD_LABELS = new Set([
  "Date of Meeting", "Created", "Last Contacted",
]);

function mprepFieldRow(label, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "";
  const display = MPREP_DATE_FIELD_LABELS.has(label) ? formatOrdinalDate(rawValue) : String(rawValue);
  return `<div style="display:flex; flex-direction:column; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:6px 8px; min-width:0; word-break:break-word;">
    <span style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:2px;">${escapeHtml(label)}</span>
    <span style="font-size:0.82rem; font-weight:600; color:var(--text);">${escapeHtml(display)}</span>
  </div>`;
}

function mprepSection(title, color, innerHtml) {
  if (!innerHtml) return "";
  return `<div style="margin-bottom:14px; break-inside:avoid;">
    <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:${color}; background:${color}18; padding:5px 10px; border-radius:4px; margin-bottom:8px; letter-spacing:0.5px;">${escapeHtml(title)}</div>
    ${innerHtml}
  </div>`;
}

function mprepBulletList(items, emptyText) {
  if (!items || items.length === 0) {
    return emptyText ? `<div style="font-size:0.8rem; color:var(--muted); font-style:italic; padding:6px 8px;">${escapeHtml(emptyText)}</div>` : "";
  }
  return `<ul style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:5px;">
    ${items.map(t => `<li style="font-size:0.85rem; color:var(--text); line-height:1.4;">${t}</li>`).join("")}
  </ul>`;
}

function mprepTimelineRow(item) {
  const when = item.when ? formatOrdinalDate(item.when) : "(no date)";
  const whenTime = item.whenTime ? formatPlainTimeOfDay(item.whenTime) : "";
  const actor = item.actor ? escapeHtml(item.actor) : "";
  const contact = item.contactPerson ? ` · ${escapeHtml(item.contactPerson)}` : "";
  const dirBadge = item.direction && item.direction !== "N/A"
    ? `<span style="font-size:0.6rem; font-weight:700; color:${item.direction === "Incoming" ? "#0369a1" : "#7c3aed"}; text-transform:uppercase; margin-left:6px;">${item.direction}</span>`
    : "";
  // Email entries deliberately carry no link and no match-reason badge —
  // nobody viewing this brief has access to the inbox it landed in, so a
  // link would be a dead click and an unverified badge would only invite
  // doubt with no way to check it. Every other type still links through.
  const link = item.link ? `<a href="${driveLink(item.link)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; font-size:0.75rem; margin-left:8px;">Open ↗</a>` : "";
  const venue = (item.meetingVenue || item.venueNameCity)
    ? `<div style="font-size:0.75rem; color:var(--muted); margin-top:1px;">Venue: ${escapeHtml([item.meetingVenue, item.venueNameCity].filter(Boolean).join(", "))}</div>` : "";
  const detail = item.detail ? `<div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">${escapeHtml(item.detail)}</div>` : "";
  return `<div style="display:flex; gap:10px; padding:8px 10px; border-bottom:1px solid #f1f5f9; break-inside:avoid;">
    <div style="min-width:98px; font-size:0.72rem; color:var(--muted); font-weight:700;">${escapeHtml(when)}${whenTime ? `<div style="font-weight:600;">${escapeHtml(whenTime)}</div>` : ""}</div>
    <div style="flex:1; min-width:0;">
      <div style="font-size:0.82rem; font-weight:700; color:var(--text);">
        [${escapeHtml(item.type)}]${dirBadge} ${escapeHtml(item.title || "")}${link}
      </div>
      <div style="font-size:0.75rem; color:var(--muted); margin-top:1px;">${actor}${contact}</div>
      ${venue}
      ${detail}
    </div>
  </div>`;
}

function mprepRenderBrief(facts, aiBrief, aiError) {
  const resultsNode = document.getElementById("mprep-results");
  if (!resultsNode) return;

  const c = facts.company;
  const ag = facts.atAGlance;
  const oi = facts.openItems;

  // Needed by toggleContactExpansionView (leads.js) the moment a person's
  // lead-wrapper card is clicked, below — same convention
  // marketing/companies.js's toggleTaskCompanyExpand uses.
  window.globalFollowUpsCacheMap = facts.followupsByLead || {};
  window.globalTasksCacheMap = facts.tasksByLead || {};

  // ── AI brief block — 4 distinct mini-cards (colored top border, own
  // box) instead of stacked text sections, so each category is visually
  // separated rather than reading as one dense cluster. No Regenerate
  // button — Generate Brief above already does that job. ─────────────────
  let aiHtml = "";
  if (aiBrief) {
    const CATS = [
      { title: "Where We Stand", arr: aiBrief.whereWeStand, color: "#0369a1" },
      { title: "Open Items", arr: aiBrief.openItems, color: "#b45309" },
      { title: "Talking Points", arr: aiBrief.talkingPoints, color: "#15803d" },
      { title: "Watch Outs", arr: aiBrief.watchOuts, color: "#b91c1c" },
    ].filter(c => c.arr && c.arr.length);
    const catCard = (c) => `<div style="background:#fff; border:1px solid var(--border); border-top:3px solid ${c.color}; border-radius:6px; padding:10px 12px;">
        <div style="font-size:0.66rem; font-weight:800; text-transform:uppercase; letter-spacing:0.4px; color:${c.color}; margin-bottom:6px;">${escapeHtml(c.title)}</div>
        ${mprepBulletList(c.arr.map(escapeHtml))}
      </div>`;
    aiHtml = `<div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:6px; padding:14px 16px; margin-bottom:16px;">
      <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; color:#4338ca; letter-spacing:0.5px; margin-bottom:10px;">AI Briefing</div>
      <div style="font-size:0.95rem; font-weight:700; color:var(--text); background:#fff; border-radius:6px; padding:10px 12px; margin-bottom:10px;">${escapeHtml(aiBrief.headline || "")}</div>
      ${CATS.length ? `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px;">${CATS.map(catCard).join("")}</div>` : ""}
    </div>`;
  } else {
    aiHtml = `<div style="background:#fef3c7; border:1px solid #fde68a; border-radius:6px; padding:10px 14px; margin-bottom:16px; font-size:0.82rem; color:#92400e;">
      AI summary unavailable${aiError ? `: ${escapeHtml(aiError)}` : ""}. The facts below are complete and unaffected.
      <button class="btn btn-sub" style="width:auto; display:inline-flex; margin-left:8px; font-size:0.72rem; padding:4px 8px;" onclick="mprepGenerateBrief()">Try again</button>
    </div>`;
  }

  // ── At a glance ─────────────────────────────────────────────────────
  const glanceTiles = [
    ["Days Since Last Contact", ag.daysSinceLastContact === null ? "Never" : ag.daysSinceLastContact],
    ["Total Follow-Ups", ag.totalFollowUpCount],
    ["Overdue Tasks", ag.overdueTaskCount],
    ["Completed Tasks", ag.completedTaskCount],
    ["Open Customer Queries", ag.openQueryCount],
    ["Unanswered Incoming Email", ag.unansweredIncomingEmail ? "Yes" : "No"],
  ];
  const glanceHtml = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:8px; margin-bottom:16px;">
    ${glanceTiles.map(([label, value]) => `
      <div style="background:#fff; border:1px solid var(--border); border-radius:6px; padding:8px 10px; text-align:center;">
        <div style="font-size:1.1rem; font-weight:800; color:var(--brand);">${escapeHtml(String(value))}</div>
        <div style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-top:2px;">${escapeHtml(label)}</div>
      </div>`).join("")}
  </div>`;

  // ── People — grouped by person, each with their own lead-wrapper cards
  // (one per enquiry), reusing the real lead View Details expand
  // (toggleContactExpansionView, leads.js) exactly like any lead wrapper
  // elsewhere in the app. ──────────────────────────────────────────────
  const peopleHtml = (facts.people || []).map((p, i) => {
    const fields = [["Status", p.status], ["Phone", p.phone], ["Email", p.email], ["ABPS Engineer", p.engineerDisplay]];
    const fieldsHtml = fields.map(([l, v]) => mprepFieldRow(l, v)).join("");
    const leadsHtml = (p.leads || []).map(({ leadId, rawLead }) => `
      <div class="contact-summary-card-parent" id="mprep-lead-card-${leadId}" style="background:#f8fafc;">
        <div class="contact-summary-header-row" style="cursor:pointer;" onclick="toggleContactExpansionView('${leadId}', \`${encodeURIComponent(JSON.stringify(rawLead))}\`)">
          <div class="contact-summary-title-info">
            <div class="meta-row-line-block" style="margin-bottom:6px;">
              <span style="background:#e2e8f0;">Status:</span><strong id="card-lbl-status-${leadId}">${escapeHtml(rawLead["Status"] || "N/A")}</strong>
              <span style="background:#edf2f7;">Lead ID:</span><strong>${escapeHtml(leadId)}</strong>
            </div>
          </div>
          <div class="directory-btn-actions-block" onclick="event.stopPropagation()">
            <span id="expand-trigger-${leadId}" style="color:var(--brand); font-size:1.3rem; font-weight:700; line-height:1; padding:4px 6px;">▾</span>
          </div>
        </div>
        <div class="contact-expanded-workspace-payload-drawer" id="drawer-panel-${leadId}" style="display:none; padding-top:4px;">
          <div class="leads-editable-fields-box-canvas" id="canvas-fields-${leadId}"></div>
          <div class="child-injected-modules-mount-point" id="modules-mount-${leadId}" style="margin-top:10px;"></div>
        </div>
      </div>`).join("");
    return `<div style="margin-bottom:14px; border:1px solid #e2e8f0; border-radius:4px; padding:10px;">
      <strong style="font-size:0.88rem;">${escapeHtml(p.contactPersonName)}${p.position ? " · " + escapeHtml(p.position) : ""}</strong>
      <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px; padding:8px 0 4px;">${fieldsHtml}</div>
      ${leadsHtml}
    </div>`;
  }).join("");

  // ── Open items ──────────────────────────────────────────────────────
  const openItemsHtml = mprepBulletList([
    ...oi.overdueTasks.map(t => `<strong>Overdue task</strong> (due ${escapeHtml(formatOrdinalDate(t.targetDate))}, assigned to ${escapeHtml(t.eng || "-")}): ${escapeHtml(t.desc || "")}`),
    ...oi.pendingFollowUps.map(f => `<strong>Follow-up due</strong> ${escapeHtml(formatOrdinalDate(f.nextDate))}: ${escapeHtml(f.nextActionType || "")} (${escapeHtml(f.eng || "-")})`),
    ...oi.openQueries.map(q => `<strong>${q.breached ? "Breached" : "Open"} customer query</strong>: ${escapeHtml(q.stageName || "")}, target ${escapeHtml(q.targetClosingDate ? formatOrdinalDate(q.targetClosingDate) : "-")}, owner ${escapeHtml(q.responsiblePerson || "-")}`),
    ...oi.lateProjects.map(p => `<strong>Project past delivery</strong>: ${escapeHtml(p.projectId)} (PO ${escapeHtml(p.poNumber || "-")}), promised ${escapeHtml(p.promisedDate ? formatOrdinalDate(p.promisedDate) : "-")}`),
  ], "Nothing outstanding right now.");

  // ── Timeline ────────────────────────────────────────────────────────
  const timelineHtml = facts.timeline.length
    ? facts.timeline.map(mprepTimelineRow).join("")
    : `<div style="padding:12px; color:var(--muted); font-style:italic; font-size:0.82rem;">No recorded activity.</div>`;

  const invoicesHtml = facts.invoices.length ? mprepBulletList(facts.invoices.map(inv =>
    `<strong>${escapeHtml(inv.invoiceType)} Invoice ${escapeHtml(inv.invoiceNo)}</strong>${inv.revision > 1 ? ` (Rev ${inv.revision})` : ""}: ₹${escapeHtml(formatQtyTrimmed(inv.totalAmount))}${inv.pdfUrl ? ` <a href="${driveLink(inv.pdfUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">↗</a>` : ""}`
  )) : "";

  const offersHtml = facts.offers.length ? mprepBulletList(facts.offers.map(o =>
    `<strong>${escapeHtml(o.email_sent_date ? formatOrdinalDate(o.email_sent_date) : "")}</strong>: ${escapeHtml(o.email_subject || "Offer")}${o.estimated_value ? ` (₹${escapeHtml(formatQtyTrimmed(o.estimated_value))})` : ""}`
  )) : "";

  // ── Below-the-fold detail — People/Timeline/Invoices/Offers are backup
  // material, not what you need to walk into the meeting knowing.
  // Order Execution / Documents / Reference: Company Detail were removed
  // outright (not just collapsed) — the same delivery/product facts that
  // mattered now surface in the Timeline's own PO-received entry instead.
  const detailHtml = [
    mprepSection("People", "#be185d", peopleHtml),
    mprepSection("Activity Timeline", "#334155", `<div style="border:1px solid #e2e8f0; border-radius:4px;">${timelineHtml}</div>`),
    mprepSection("Invoices", "#0f766e", invoicesHtml),
    mprepSection("Offers Sent", "#7c3aed", offersHtml),
  ].join("");

  resultsNode.innerHTML = `
    <div id="mprep-brief-area">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
        <h3 style="margin:0; font-size:1.1rem;">${escapeHtml(c.company_name)}${facts.scopeIsAllPeople ? "" : ` · ${escapeHtml(facts.contacts[0]?.contactPersonName || "")}`}</h3>
        <button class="btn btn-sub" id="mprep-download-btn" onclick="mprepDownloadBrief()" style="width:auto; flex-shrink:0; padding:8px 16px; background:#15803d; color:#fff; border-color:#15803d;">Download Brief</button>
      </div>
      ${aiHtml}
      ${mprepSection("At A Glance", "#0369a1", glanceHtml)}
      ${mprepSection("Open Items", "#b91c1c", openItemsHtml)}
      <div onclick="mprepToggleDetail()" style="cursor:pointer; display:flex; align-items:center; gap:6px; padding:8px 10px; margin-bottom:10px; background:#f8fafc; border:1px solid var(--border); border-radius:4px; font-size:0.8rem; font-weight:700; color:var(--muted);">
        <span id="mprep-detail-caret">▸</span> Show full details (people, timeline, orders, invoices, documents)
      </div>
      <div id="mprep-detail-body" style="display:none;">${detailHtml}</div>
    </div>
  `;
}

async function mprepDownloadBrief() {
  if (!mprepSelectedCompanyName) return;
  const btn = document.getElementById("mprep-download-btn");
  const originalText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Generating..."; }
  showBlockingOverlay("Downloading Meeting Brief...");
  try {
    const data = await apFetch({
      action: "generateMeetingBriefPdf",
      companyName: mprepSelectedCompanyName,
      leadIds: mprepSelectedLeadIds,
    });
    if (data.success) {
      const link = document.createElement("a");
      link.href = "data:application/pdf;base64," + data.base64;
      link.download = data.fileName || "Meeting_Brief.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      mprepShowError(data.error || "Failed to generate the brief PDF.");
    }
  } catch (e) {
    mprepShowError("Network error generating the brief PDF: " + e.message);
  } finally {
    hideBlockingOverlay();
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

function mprepToggleDetail() {
  const body = document.getElementById("mprep-detail-body");
  const caret = document.getElementById("mprep-detail-caret");
  if (!body) return;
  const isOpen = body.style.display === "block";
  body.style.display = isOpen ? "none" : "block";
  if (caret) caret.textContent = isOpen ? "▸" : "▾";
}
