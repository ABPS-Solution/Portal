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
        label: `${escapeHtml(c.contactPersonName)}${c.position ? " — " + escapeHtml(c.position) : ""}${c.lastActivityAt ? " — last touched " + escapeHtml(formatOrdinalDate(c.lastActivityAt)) : ""}`,
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
  "Date of Meeting", "Tentative Delivery", "Expected Delivery", "Created", "Last Contacted",
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

function mprepMatchBadge(reason) {
  const labels = { exact_contact: "known contact", corporate_domain: "company domain", ai_extracted_name: "name match (unverified)" };
  const colors = { exact_contact: "#047857", corporate_domain: "#047857", ai_extracted_name: "#b45309" };
  if (!reason || !labels[reason]) return "";
  return `<span style="font-size:0.62rem; font-weight:700; color:${colors[reason]}; background:${colors[reason]}18; padding:1px 6px; border-radius:3px; margin-left:6px; text-transform:uppercase;">${labels[reason]}</span>`;
}

function mprepTimelineRow(item) {
  const when = item.when ? formatOrdinalDate(item.when) : "(no date)";
  const actor = item.actor ? escapeHtml(item.actor) : "";
  const contact = item.contactPerson ? ` · ${escapeHtml(item.contactPerson)}` : "";
  const dirBadge = item.direction && item.direction !== "N/A"
    ? `<span style="font-size:0.6rem; font-weight:700; color:${item.direction === "Inbound" ? "#0369a1" : "#7c3aed"}; text-transform:uppercase; margin-left:6px;">${item.direction}</span>`
    : "";
  const link = item.link ? `<a href="${driveLink(item.link)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; font-size:0.75rem; margin-left:8px;">Open ↗</a>` : "";
  const detail = item.detail ? `<div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">${escapeHtml(item.detail)}</div>` : "";
  return `<div style="display:flex; gap:10px; padding:8px 10px; border-bottom:1px solid #f1f5f9; break-inside:avoid;">
    <div style="min-width:78px; font-size:0.72rem; color:var(--muted); font-weight:700;">${escapeHtml(when)}</div>
    <div style="flex:1; min-width:0;">
      <div style="font-size:0.82rem; font-weight:700; color:var(--text);">
        [${escapeHtml(item.type)}]${dirBadge} ${escapeHtml(item.title || "")}${mprepMatchBadge(item.matchReason)}${link}
      </div>
      <div style="font-size:0.75rem; color:var(--muted); margin-top:1px;">${actor}${contact}</div>
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

  // ── AI brief block ──────────────────────────────────────────────────
  let aiHtml = "";
  if (aiBrief) {
    const section = (title, arr) => arr && arr.length
      ? `<div style="margin-bottom:8px;"><div style="font-size:0.68rem; font-weight:800; text-transform:uppercase; color:#3730a3; margin-bottom:4px;">${escapeHtml(title)}</div>${mprepBulletList(arr.map(escapeHtml))}</div>`
      : "";
    aiHtml = `<div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:6px; padding:14px 16px; margin-bottom:16px;">
      <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; color:#4338ca; letter-spacing:0.5px; margin-bottom:6px;">🤖 AI Briefing</div>
      <div style="font-size:0.9rem; font-weight:700; color:var(--text); margin-bottom:10px;">${escapeHtml(aiBrief.headline || "")}</div>
      ${section("Where We Stand", aiBrief.whereWeStand)}
      ${section("Open Items", aiBrief.openItems)}
      ${section("Talking Points", aiBrief.talkingPoints)}
      ${section("Watch Outs", aiBrief.watchOuts)}
      <button class="btn btn-sub" style="margin-top:6px; font-size:0.75rem; padding:5px 10px;" onclick="mprepGenerateBrief()">↻ Regenerate summary</button>
    </div>`;
  } else {
    aiHtml = `<div style="background:#fef3c7; border:1px solid #fde68a; border-radius:6px; padding:10px 14px; margin-bottom:16px; font-size:0.82rem; color:#92400e;">
      AI summary unavailable${aiError ? `: ${escapeHtml(aiError)}` : ""} — the facts below are complete and unaffected.
      <button class="btn btn-sub" style="margin-left:8px; font-size:0.72rem; padding:4px 8px;" onclick="mprepGenerateBrief()">Try again</button>
    </div>`;
  }

  // ── At a glance ─────────────────────────────────────────────────────
  const glanceTiles = [
    ["Days Since Last Contact", ag.daysSinceLastContact === null ? "Never" : ag.daysSinceLastContact],
    ["Overdue Tasks", ag.overdueTaskCount],
    ["Pending Follow-Ups", ag.pendingFollowUpCount],
    ["Open Customer Queries", ag.openQueryCount],
    ["Breached Queries", ag.breachedQueryCount],
    ["Late Projects", ag.lateProjectCount],
    ["Unanswered Inbound Email", ag.unansweredInbound ? "Yes" : "No"],
  ];
  const glanceHtml = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:8px; margin-bottom:16px;">
    ${glanceTiles.map(([label, value]) => `
      <div style="background:#fff; border:1px solid var(--border); border-radius:6px; padding:8px 10px; text-align:center;">
        <div style="font-size:1.1rem; font-weight:800; color:var(--brand);">${escapeHtml(String(value))}</div>
        <div style="font-size:0.62rem; font-weight:700; color:var(--muted); text-transform:uppercase; margin-top:2px;">${escapeHtml(label)}</div>
      </div>`).join("")}
  </div>`;

  // ── People ──────────────────────────────────────────────────────────
  const peopleHtml = facts.contacts.map((p, i) => {
    const fields = [
      ["Status", p.status], ["Engineer", p.engineerDisplay], ["Phone", p.phone], ["Alt Phone", p.altPhone],
      ["Email", p.email], ["Approx Requirement", p.approxRequirement], ["Business Potential", p.approxBusinessPotential],
      ["Expected Order Timeline", p.expectedOrderTimeline], ["Competitor Details", p.competitorDetails],
      ["Products Discussed", p.productsDiscussed],
    ];
    const fieldsHtml = fields.map(([l, v]) => mprepFieldRow(l, v)).join("");
    const body = `<div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px; padding:8px 0 4px;">${fieldsHtml}</div>`;
    if (facts.contacts.length === 1) {
      return `<div style="margin-bottom:6px;"><strong style="font-size:0.88rem;">${escapeHtml(p.contactPersonName)}${p.position ? " — " + escapeHtml(p.position) : ""}</strong>${body}</div>`;
    }
    const bodyId = `mprep-person-body-${i}`;
    return `<div style="margin-bottom:6px; border:1px solid #e2e8f0; border-radius:4px; overflow:hidden;">
      <div onclick="mprepToggleCard('${bodyId}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:6px 10px;">
        <strong style="font-size:0.82rem;">${escapeHtml(p.contactPersonName)}${p.position ? " — " + escapeHtml(p.position) : ""}</strong>
        <span id="${bodyId}-caret" style="font-size:0.7rem; color:var(--muted);">▸</span>
      </div>
      <div id="${bodyId}" style="display:none; padding:0 10px;">${body}</div>
    </div>`;
  }).join("");

  // ── Open items ──────────────────────────────────────────────────────
  const openItemsHtml = mprepBulletList([
    ...oi.overdueTasks.map(t => `<strong>Overdue task</strong> (due ${escapeHtml(formatOrdinalDate(t.targetDate))}, assigned to ${escapeHtml(t.eng || "—")}): ${escapeHtml(t.desc || "")}`),
    ...oi.pendingFollowUps.map(f => `<strong>Follow-up due</strong> ${escapeHtml(formatOrdinalDate(f.nextDate))} — ${escapeHtml(f.nextActionType || "")} (${escapeHtml(f.eng || "—")})`),
    ...oi.openQueries.map(q => `<strong>${q.breached ? "Breached" : "Open"} customer query</strong> — ${escapeHtml(q.stageName || "")}, target ${escapeHtml(q.targetClosingDate ? formatOrdinalDate(q.targetClosingDate) : "—")}, owner ${escapeHtml(q.responsiblePerson || "—")}`),
    ...oi.lateProjects.map(p => `<strong>Project past delivery</strong> — ${escapeHtml(p.projectId)} (PO ${escapeHtml(p.poNumber || "—")}), promised ${escapeHtml(p.promisedDate ? formatOrdinalDate(p.promisedDate) : "—")}`),
  ], "Nothing outstanding right now.");

  // ── Timeline ────────────────────────────────────────────────────────
  const timelineHtml = facts.timeline.length
    ? facts.timeline.map(mprepTimelineRow).join("")
    : `<div style="padding:12px; color:var(--muted); font-style:italic; font-size:0.82rem;">No recorded activity.</div>`;

  // ── Order execution (projects + line items) ────────────────────────
  const projectsHtml = facts.projects.map(p => {
    const weak = p.matchReason === "company_name"
      ? `<span style="font-size:0.6rem; font-weight:700; color:#b45309; margin-left:6px;">NAME MATCH — verify</span>` : "";
    const lines = facts.poLineItems.filter(li => li.project_id === p.project_id);
    const lineFields = lines.map(li => `<div style="font-size:0.78rem; padding:4px 0; border-bottom:1px dashed #e2e8f0;">
      ${escapeHtml(li.standard_product_name || li.description || "")} — Qty ${escapeHtml(String(li.mfc_quantity ?? li.quantity ?? ""))} ${escapeHtml(li.unit || "")}
      ${li.on_hold ? `<span style="color:#b45309; font-weight:700;"> (ON HOLD${li.hold_reason ? ": " + escapeHtml(li.hold_reason) : ""})</span>` : ""}
    </div>`).join("");
    const fields = [
      ["Status", p.project_status], ["PO Number", p.po_number],
      ["Tentative Delivery", p.delivery_date], ["Expected Delivery", p.mfc_actual_delivery_date],
    ];
    return `<div style="margin-bottom:10px; border:1px solid #e2e8f0; border-radius:4px; padding:8px 10px;">
      <strong style="font-size:0.85rem;">${escapeHtml(p.project_id)}${weak}</strong>
      <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px; margin-top:6px;">${fields.map(([l, v]) => mprepFieldRow(l, v)).join("")}</div>
      ${lineFields ? `<div style="margin-top:6px;">${lineFields}</div>` : ""}
    </div>`;
  }).join("");

  const invoicesHtml = facts.invoices.length ? mprepBulletList(facts.invoices.map(inv =>
    `<strong>${escapeHtml(inv.invoiceType)} Invoice ${escapeHtml(inv.invoiceNo)}</strong>${inv.revision > 1 ? ` (Rev ${inv.revision})` : ""} — ₹${escapeHtml(formatQtyTrimmed(inv.totalAmount))}${inv.pdfUrl ? ` <a href="${driveLink(inv.pdfUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">↗</a>` : ""}`
  )) : "";

  const offersHtml = facts.offers.length ? mprepBulletList(facts.offers.map(o =>
    `<strong>${escapeHtml(o.email_sent_date ? formatOrdinalDate(o.email_sent_date) : "")}</strong> — ${escapeHtml(o.email_subject || "Offer")}${o.estimated_value ? ` (₹${escapeHtml(formatQtyTrimmed(o.estimated_value))})` : ""}`
  )) : "";

  const documentsHtml = facts.documents.length ? mprepBulletList(facts.documents.map(d =>
    `PO ${escapeHtml(d.purchase_order_number || "—")} (${escapeHtml(d.purchase_order_date ? formatOrdinalDate(d.purchase_order_date) : "—")})${d.po_document_url ? ` <a href="${driveLink(d.po_document_url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">↗</a>` : ""}`
  )) : "";

  // ── Reference (collapsed) ──────────────────────────────────────────
  const refFields = [
    ["Website", c.website], ["City", c.city], ["State", c.state], ["Country", c.country],
    ["Address", c.company_address], ["Industry", c.type_of_industry],
    ["Type of Customer", (c.typeOfCustomerList || []).join(", ")],
  ];
  const refHtml = `<div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px;">${refFields.map(([l, v]) => mprepFieldRow(l, v)).join("")}</div>`;

  resultsNode.innerHTML = `
    <div id="mprep-brief-print-area">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
        <h3 style="margin:0; font-size:1.1rem;">${escapeHtml(c.company_name)}${facts.scopeIsAllPeople ? "" : ` — ${escapeHtml(facts.contacts[0]?.contactPersonName || "")}`}</h3>
        <button class="btn btn-sub" id="mprep-print-btn" onclick="window.print()" style="width:auto; flex-shrink:0; padding:8px 16px;">🖨 Print Brief</button>
      </div>
      ${aiHtml}
      ${mprepSection("At A Glance", "#0369a1", glanceHtml)}
      ${mprepSection("People", "#be185d", peopleHtml)}
      ${mprepSection("Open Items", "#b91c1c", openItemsHtml)}
      ${mprepSection("Activity Timeline", "#334155", `<div style="border:1px solid #e2e8f0; border-radius:4px;">${timelineHtml}</div>`)}
      ${mprepSection("Order Execution", "#0f766e", projectsHtml || `<div style="font-size:0.8rem; color:var(--muted); font-style:italic;">No linked project found.</div>`)}
      ${mprepSection("Invoices", "#0f766e", invoicesHtml)}
      ${mprepSection("Offers Sent", "#7c3aed", offersHtml)}
      ${mprepSection("Documents", "#0056b3", documentsHtml)}
      ${mprepSection("Reference — Company Detail", "#64748b", refHtml)}
    </div>
  `;
}

function mprepToggleCard(bodyId) {
  const body = document.getElementById(bodyId);
  const caret = document.getElementById(`${bodyId}-caret`);
  if (!body) return;
  const isOpen = body.style.display === "block";
  body.style.display = isOpen ? "none" : "block";
  if (caret) caret.textContent = isOpen ? "▸" : "▾";
}
