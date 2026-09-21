// ═══════════════════════════════════════════════════════════════════════
// marketing/order-payment.js — Order Payment Progress (migration 214,
// 21 Sep 2026). Tracks expected-vs-received payment tranches per customer
// PO, modelled on purchase/pps-tracking.js's delivery-schedule editor
// (same "full desired list, not a delta" save contract, same per-row
// add/remove/edit shape) — minus quantity clamping, since this screen
// deliberately WARNS instead of blocking on over/under-scheduling.
//
// Each PO card's payment editor and its "View Lead" panel are independent,
// per-project toggles (tracked in the two Sets below) — clicking one PO's
// header never collapses a different PO's already-open editor, and
// several can be open at once. Editor content renders directly under that
// PO's own header, never in a shared bottom zone.
//
// All top-level identifiers are opp*-prefixed (grepped clean before
// writing this file) — a duplicate top-level let/const anywhere in
// abps-frontend/ is a fatal SyntaxError that kills the whole app.
// ═══════════════════════════════════════════════════════════════════════

window.oppAllProjects = window.oppAllProjects || [];
window.oppLastRenderedProjects = [];
window.oppOverdueOnly = false;   // client-side filter: only POs with >=1 tranche past its Expected Date
window.oppExpandedProjects = new Set();       // projectIds with the payment editor open
window.oppLeadExpandedProjects = new Set();   // projectIds with the View Lead panel open
window.oppScheduleDataCache = {};             // projectId -> fetchOrderPaymentSchedule response (or {error})
window.oppActiveTranchesByProject = {};       // projectId -> working tranche array for that editor

function oppFmt(n) {
  return (parseFloat(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// oppFmtDate — "21 Sep 2026" (numeric day, no ordinal suffix), the format
// this screen deliberately uses instead of the app-wide formatOrdinalDate
// ("21st Sep 2026"), per explicit request for this section only.
function oppFmtDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${d.getDate()} ${month} ${d.getFullYear()}`;
}

// oppTodayIso / oppIsOverdueTranche — a tranche is overdue only while its
// Expected Date has genuinely passed AND it's not yet fully received.
// Deliberately re-derived from expectedAmount/receivedAmount directly
// (not from t.status) so it stays correct regardless of which of the two
// amounts changed last — the amount can be reduced to match what was
// received just as easily as the received amount can catch up to it.
function oppTodayIso() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
}
function oppIsOverdueTranche(t) {
  if (!t.expectedDate || t.expectedDate >= oppTodayIso()) return false;
  const expected = Number(t.expectedAmount) || 0;
  const received = Number(t.receivedAmount) || 0;
  return received + 1e-9 < expected;
}

async function initializeOrderPaymentPanel() {
  document.getElementById("opp-overdue-only").checked = window.oppOverdueOnly;
  document.getElementById("opp-search-input").value = "";
  // Fresh state every time the panel is (re-)entered — same "reset on
  // entry" convention as every other full-screen canvas panel.
  window.oppExpandedProjects = new Set();
  window.oppLeadExpandedProjects = new Set();
  window.oppScheduleDataCache = {};
  window.oppActiveTranchesByProject = {};
  await oppLoadList();
  // Visible to everyone who can reach this screen at all (perm_order_payment_
  // progress), not admin-only — the backend gate matches (fetchOrderPaymentAggregate).
  document.getElementById("opp-aggregate-strip").style.display = "block";
  oppLoadAggregate();
}

async function oppLoadList() {
  const listEl = document.getElementById("opp-list");
  listEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  try {
    // Fully-paid POs are never fetched at all now -- there's no toggle to
    // reveal them, they're simply not relevant to a payment-tracking list.
    const data = await apFetch({ action: "fetchOrderPaymentProgressList", includeFullyPaid: false });
    if (!data.success) { listEl.innerHTML = `<div style="color:#b91c1c; padding:14px;">${escapeHtml(data.error || 'Failed to load.')}</div>`; return; }
    window.oppAllProjects = data.projects || [];
    oppRenderList(oppFilteredProjects(document.getElementById("opp-search-input").value || ""));
  } catch (e) {
    listEl.innerHTML = `<div style="color:#b91c1c; padding:14px;">Network error: ${escapeHtml(e.message)}</div>`;
  }
}

function oppToggleOverdueOnly(checked) {
  window.oppOverdueOnly = checked;
  oppRenderList(oppFilteredProjects(document.getElementById("opp-search-input").value || ""));
}

// oppFilteredProjects -- search text AND the "overdue only" toggle both
// apply client-side over the already-fetched list (overdueCount is
// already returned per project, no extra round trip needed for the toggle).
function oppFilteredProjects(query) {
  const q = (query || "").trim().toLowerCase();
  let list = window.oppAllProjects;
  if (window.oppOverdueOnly) list = list.filter(p => p.overdueCount > 0);
  if (!q) return list;
  return list.filter(p =>
    (p.companyName || "").toLowerCase().includes(q) ||
    (p.projectId || "").toLowerCase().includes(q) ||
    (p.poNumber || "").toLowerCase().includes(q));
}

function oppFilterList(query) {
  oppRenderList(oppFilteredProjects(query));
}

// oppRerenderCurrentList — used by every action that only changes expand
// state or in-memory tranche data, never the underlying project list, so
// it never needs a network round-trip.
function oppRerenderCurrentList() {
  oppRenderList(window.oppLastRenderedProjects);
}

function oppRenderList(projects) {
  window.oppLastRenderedProjects = projects;
  const listEl = document.getElementById("opp-list");
  if (!projects.length) {
    listEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">No matching POs.</div>`;
    return;
  }
  listEl.innerHTML = projects.map(p => oppRenderCard(p)).join("");
  // The tranche rows inside any already-expanded card's editor need an
  // explicit follow-up render (see oppFillTranchesIfPresent) — a <script>
  // tag baked into the innerHTML string above would never execute.
  for (const projectId of window.oppExpandedProjects) oppFillTranchesIfPresent(projectId);
}

function oppRenderCard(p) {
  const isFullyPaid = p.pendingBalance != null && p.pendingBalance <= 0.005;
  const unknownTotal = p.poTotal == null;
  const overdueChip = p.overdueCount > 0
    ? `<span style="background:#fee2e2; color:#b91c1c; font-weight:700; font-size:0.68rem; padding:2px 8px; border-radius:10px; margin-left:6px;">${p.overdueCount} overdue</span>` : "";
  const fallbackChip = p.poTotalSource === 'po_invoice_report_fallback'
    ? `<span style="background:#fef3c7; color:#b45309; font-weight:700; font-size:0.66rem; padding:2px 8px; border-radius:10px; margin-left:6px;" title="No PO line items on this project. Using the PO amount typed at upload as an estimate.">estimate</span>` : "";

  const isExpanded = window.oppExpandedProjects.has(p.projectId);
  const isLeadExpanded = window.oppLeadExpandedProjects.has(p.projectId);

  return `
    <div style="border:1px solid var(--border); border-radius:var(--radius); margin-bottom:10px; background:#fff; overflow:hidden;">
      <div style="padding:12px 14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px; cursor:pointer;" onclick="oppToggleProject('${p.projectId}')">
        <div style="flex:1; min-width:220px;">
          <div style="font-weight:800; font-size:0.95rem;">${escapeHtml(p.companyName || '-')}</div>
          <div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">
            ${escapeHtml(p.projectId)} · ${escapeHtml(p.projectStatus || '')}${overdueChip}${fallbackChip}
          </div>
        </div>
        <div style="display:flex; gap:26px; align-items:flex-start; font-family:monospace; text-align:right;">
          <div>
            <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--muted);">PO Total</div>
            <div style="font-size:1.08rem; font-weight:700;">${unknownTotal ? '-' : '₹' + oppFmt(p.poTotal)}</div>
          </div>
          <div>
            <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--muted);">Received</div>
            <div style="font-size:1.08rem; font-weight:700; color:#15803d;">₹${oppFmt(p.receivedTotal)}</div>
          </div>
          <div>
            <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--muted);">Pending</div>
            <div style="font-size:1.08rem; font-weight:700; color:${isFullyPaid ? '#15803d' : '#b45309'};">${isFullyPaid ? 'Fully Paid' : '₹' + oppFmt(p.pendingBalance)}</div>
          </div>
        </div>
        <button id="opp-lead-btn-${p.projectId}" class="nav-btn-styled" style="font-size:0.78rem; padding:5px 12px; background:#fff; color:var(--brand); border:1px solid var(--brand); white-space:nowrap;"
          onclick="event.stopPropagation(); oppToggleLeadExpand('${p.projectId}', '${encodeURIComponent(p.companyName || '')}')">${isLeadExpanded ? 'Hide Lead' : 'View Lead'}</button>
      </div>
      <div id="opp-lead-expand-${p.projectId}" style="display:${isLeadExpanded ? 'block' : 'none'};">${isLeadExpanded ? oppLeadExpandPlaceholderOrCached(p.projectId) : ''}</div>
      <div id="opp-editor-expand-${p.projectId}" style="display:${isExpanded ? 'block' : 'none'};">${isExpanded ? oppRenderEditorContent(p.projectId) : ''}</div>
    </div>`;
}

// ── PO editor (payment tranches) — expands directly under its own PO card ──

async function oppToggleProject(projectId) {
  const wrap = document.getElementById(`opp-editor-expand-${projectId}`);
  if (window.oppExpandedProjects.has(projectId)) {
    window.oppExpandedProjects.delete(projectId);
    if (wrap) { wrap.style.display = "none"; wrap.innerHTML = ""; }
    return;
  }
  window.oppExpandedProjects.add(projectId);
  if (wrap) { wrap.style.display = "block"; wrap.innerHTML = oppRenderEditorContent(projectId); oppFillTranchesIfPresent(projectId); }

  if (!window.oppScheduleDataCache[projectId]) {
    try {
      const data = await apFetch({ action: "fetchOrderPaymentSchedule", projectId });
      window.oppScheduleDataCache[projectId] = data.success ? data : { error: data.error || 'Failed to load.' };
      if (data.success) window.oppActiveTranchesByProject[projectId] = (data.tranches || []).map(t => ({ ...t }));
    } catch (e) {
      window.oppScheduleDataCache[projectId] = { error: 'Network error: ' + e.message };
    }
    const wrapNow = document.getElementById(`opp-editor-expand-${projectId}`);
    if (wrapNow && window.oppExpandedProjects.has(projectId)) {
      wrapNow.innerHTML = oppRenderEditorContent(projectId);
      oppFillTranchesIfPresent(projectId);
    }
  }
}

function oppRenderEditorContent(projectId) {
  const cached = window.oppScheduleDataCache[projectId];
  if (!cached) return `<div style="padding:14px 16px; border-top:1px solid var(--border); color:var(--muted); font-size:0.85rem;">Loading...</div>`;
  if (cached.error) return `<div style="padding:14px 16px; border-top:1px solid var(--border); color:#b91c1c; font-size:0.85rem;">${escapeHtml(cached.error)}</div>`;

  const { project, poTotal, poTotalSource, lineItems } = cached;
  const fallbackNote = poTotalSource === 'po_invoice_report_fallback'
    ? `<div style="font-size:0.72rem; color:#b45309; margin-top:4px;">⚠ This project has no line items yet. The PO Total shown is an estimate from the amount typed in at PO upload, not a reliable figure.</div>` : "";

  // Each product is its own block (not a side-by-side flex row) so a long
  // description wraps at full width instead of squeezing awkwardly next
  // to the price column — the price sits on its own line underneath.
  // Small bordered table, same column-border/row-border convention as the
  // lead View Details Tasks table (tasks-followups.js) — Product 85% /
  // Qty 5% / Amount 10%, one row per product.
  const productsBox = (lineItems || []).length ? `
    <div style="margin-top:12px; padding:10px 12px; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); font-size:0.78rem;">
      <strong style="color:var(--muted); font-size:0.7rem; text-transform:uppercase;">Products in this Order</strong>
      <table style="width:100%; border-collapse:collapse; table-layout:fixed; margin-top:6px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="width:85%; padding:5px 6px; text-align:left; font-size:0.68rem; text-transform:uppercase; color:var(--muted);">Product</th>
            <th style="width:5%; padding:5px 6px; text-align:center; font-size:0.68rem; text-transform:uppercase; color:var(--muted); border-left:2px solid var(--border);">Qty</th>
            <th style="width:10%; padding:5px 6px; text-align:right; font-size:0.68rem; text-transform:uppercase; color:var(--muted); border-left:2px solid var(--border);">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lineItems.map(li => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:5px 6px; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtml(li.description || '-')}</td>
              <td style="padding:5px 6px; text-align:center; border-left:2px solid var(--border); white-space:nowrap;">${li.quantity != null ? `<strong>${oppFmt(li.quantity)}${li.unit ? ' ' + escapeHtml(li.unit) : ''}</strong>` : '-'}</td>
              <td style="padding:5px 6px; text-align:right; border-left:2px solid var(--border); font-family:monospace; white-space:nowrap;">${li.totalAmount != null ? '₹' + oppFmt(li.totalAmount) : '-'}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  return `
    <div style="padding:14px 16px; border-top:1px solid var(--border); background:#e9edf2;">
      ${project.paymentTerms ? `
      <div style="padding:10px 12px; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); font-size:0.82rem;">
        <strong style="color:var(--muted); font-size:0.72rem; text-transform:uppercase;">Payment Terms (reference only)</strong>
        <div style="margin-top:4px; white-space:pre-line;">${escapeHtml(project.paymentTerms)}</div>
      </div>` : ""}
      ${productsBox}
      <div style="margin-top:14px; font-size:0.85rem;">
        PO Total (incl. GST): <strong>${poTotal == null ? 'Unknown' : '₹' + oppFmt(poTotal)}</strong>
        ${fallbackNote}
      </div>
      <div id="opp-tranches-wrap-${projectId}" style="margin-top:12px;"></div>
      <div id="opp-balance-line-${projectId}" style="margin-top:8px; font-size:0.82rem; font-weight:700;"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button class="nav-btn-styled" style="background:var(--brand); padding:8px 16px;" onclick="oppSaveSchedule('${projectId}')">Save</button>
      </div>
      <div id="opp-editor-feedback-${projectId}" style="margin-top:10px;"></div>
    </div>`;
}

// oppFillTranchesIfPresent — call right after any innerHTML assignment
// that used oppRenderEditorContent(), so its #opp-tranches-wrap-... div
// (present only once real data has loaded, not during the initial
// "Loading..." placeholder) gets its rows populated.
function oppFillTranchesIfPresent(projectId) {
  if (document.getElementById(`opp-tranches-wrap-${projectId}`)) oppRenderTranches(projectId);
}

function oppTrancheRowBg(t) {
  // Same red shade as the aggregate strip's Overdue buckets (#fee2e2),
  // not a lighter one — the two should read as the same severity.
  return oppIsOverdueTranche(t) ? '#fee2e2' : '#f8fafc';
}

function oppRenderTranches(projectId) {
  const wrap = document.getElementById(`opp-tranches-wrap-${projectId}`);
  if (!wrap) return;
  const list = window.oppActiveTranchesByProject[projectId] || [];
  const rows = list.map((t, i) => {
    const slipped = t.originalExpectedDate && t.expectedDate && t.originalExpectedDate !== t.expectedDate;
    const isReceived = t.status === 'Received';
    const note = slipped
      ? `<div id="opp-slip-note-${projectId}-${i}" style="font-size:0.68rem; color:#b45309; margin-top:2px;" title="Originally expected ${oppFmtDate(t.originalExpectedDate)}">slipped from ${oppFmtDate(t.originalExpectedDate)}</div>` : `<div id="opp-slip-note-${projectId}-${i}"></div>`;
    // Expected/Received Amount are text inputs with live Indian-comma
    // formatting (sanitizeAmountInput/formatIndianCurrencyInput, same
    // pattern Review Extracted Purchase Order uses), not type="number" —
    // a plain number input can't display "1,07,616" at all. Left BLANK
    // (placeholder "0") rather than pre-filled with a literal "0" when
    // there's no real value yet — typing into a pre-filled "0" without
    // first clearing it is what produced "01111".
    return `
      <div id="opp-tranche-row-${projectId}-${i}" style="background:${oppTrancheRowBg(t)}; border:1px solid var(--border); border-radius:6px; padding:8px 10px; margin-bottom:8px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <div style="flex:1; min-width:110px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Expected Amount ₹</label>
            <input type="text" inputmode="decimal" placeholder="0" value="${t.expectedAmount ? formatIndianCurrencyInput(t.expectedAmount) : ''}"
              oninput="oppUpdateTrancheField('${projectId}', ${i}, 'expectedAmount', sanitizeAmountInput(this))"
              onblur="this.value = window.oppActiveTranchesByProject['${projectId}'][${i}].expectedAmount ? formatIndianCurrencyInput(window.oppActiveTranchesByProject['${projectId}'][${i}].expectedAmount) : '';"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex:1; min-width:130px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Expected Date</label>
            <input type="date" value="${t.expectedDate || ''}"
              onchange="oppUpdateDateField('${projectId}', ${i}, 'expectedDate', this.value)"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex:1; min-width:110px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Received Amount ₹</label>
            <input type="text" inputmode="decimal" placeholder="0" value="${t.receivedAmount ? formatIndianCurrencyInput(t.receivedAmount) : ''}"
              oninput="oppUpdateTrancheField('${projectId}', ${i}, 'receivedAmount', sanitizeAmountInput(this))"
              onblur="this.value = window.oppActiveTranchesByProject['${projectId}'][${i}].receivedAmount ? formatIndianCurrencyInput(window.oppActiveTranchesByProject['${projectId}'][${i}].receivedAmount) : '';"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex:1; min-width:130px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Received Date</label>
            <input type="date" value="${t.receivedDate || ''}"
              onchange="oppUpdateDateField('${projectId}', ${i}, 'receivedDate', this.value)"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex:1.4; min-width:140px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Reference (optional)</label>
            <input type="text" value="${(t.paymentReference || '').replace(/"/g, '&quot;')}" placeholder="UTR / Cheque No."
              oninput="oppUpdateTrancheField('${projectId}', ${i}, 'paymentReference', this.value)"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex-shrink:0; align-self:flex-end;">
            <span id="opp-status-badge-${projectId}-${i}" style="display:inline-block; padding:5px 10px; border-radius:10px; font-size:0.7rem; font-weight:700; background:${isReceived ? '#dcfce7' : (t.status === 'Partially Received' ? '#fef3c7' : '#f1f5f9')}; color:${isReceived ? '#15803d' : (t.status === 'Partially Received' ? '#b45309' : '#475569')};">${t.status}</span>
          </div>
          <button type="button" onclick="oppRemoveTranche('${projectId}', ${i})" title="Remove this tranche" style="flex-shrink:0; align-self:flex-end; background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:4px; font-size:0.75rem; font-weight:700; padding:6px 9px; cursor:pointer;">✕</button>
        </div>
        ${note}
      </div>`;
  }).join("");
  const empty = list.length === 0
    ? `<div style="font-size:0.75rem; color:var(--muted); font-style:italic; margin-bottom:6px;">No payment tranches yet.</div>` : "";
  wrap.innerHTML = `${empty}${rows}
    <button type="button" onclick="oppAddTranche('${projectId}')" style="display:block; width:100%; background:none; border:1.5px dashed var(--brand); color:var(--brand); border-radius:5px; font-size:0.78rem; font-weight:700; padding:8px; cursor:pointer;">+ Add Payment</button>`;
  oppRenderBalanceLine(projectId);
}

function oppAddTranche(projectId) {
  const list = window.oppActiveTranchesByProject[projectId] || (window.oppActiveTranchesByProject[projectId] = []);
  const scheduled = list.reduce((s, t) => s + (Number(t.expectedAmount) || 0), 0);
  const poTotal = window.oppScheduleDataCache[projectId]?.poTotal;
  const remaining = poTotal == null ? '' : Math.max(0, poTotal - scheduled);
  list.push({ paymentId: null, expectedAmount: remaining || '', expectedDate: '', originalExpectedDate: null,
    status: 'Pending', receivedAmount: 0, receivedDate: '', paymentReference: '' });
  oppRenderTranches(projectId);
}

function oppRemoveTranche(projectId, idx) {
  window.oppActiveTranchesByProject[projectId].splice(idx, 1);
  oppRenderTranches(projectId);
}

// oppUpdateTrancheField — the fix for the "one keystroke at a time" bug:
// this NEVER re-renders the tranche rows on a plain amount/text keystroke
// (that full-innerHTML rebuild is exactly what was destroying focus after
// every character). It only ever patches the one status badge + the
// balance line directly, both cheap leaf-node updates that don't touch
// the input the user is actively typing into.
function oppUpdateTrancheField(projectId, idx, field, value) {
  const t = (window.oppActiveTranchesByProject[projectId] || [])[idx];
  if (!t) return;
  t[field] = value;
  const expected = Number(t.expectedAmount) || 0;
  const received = Number(t.receivedAmount) || 0;
  t.status = received <= 0 ? 'Pending' : (received + 1e-9 >= expected ? 'Received' : 'Partially Received');
  const badge = document.getElementById(`opp-status-badge-${projectId}-${idx}`);
  if (badge) {
    const isReceived = t.status === 'Received';
    badge.textContent = t.status;
    badge.style.background = isReceived ? '#dcfce7' : (t.status === 'Partially Received' ? '#fef3c7' : '#f1f5f9');
    badge.style.color = isReceived ? '#15803d' : (t.status === 'Partially Received' ? '#b45309' : '#475569');
  }
  // A received-amount edit can clear (or trip) the overdue red tint just
  // as much as a date edit can -- patch the row background directly here
  // too, same cheap-leaf-node-only reasoning as the badge above.
  const row = document.getElementById(`opp-tranche-row-${projectId}-${idx}`);
  if (row) row.style.background = oppTrancheRowBg(t);
  oppRenderBalanceLine(projectId);
}

// oppUpdateDateField — date inputs fire 'change' (once, on completion),
// not 'input' per keystroke, so a full row rebuild here doesn't trip the
// same focus-loss bug — needed anyway to refresh the "slipped from ..."
// note, which oppUpdateTrancheField's cheaper patch doesn't cover.
function oppUpdateDateField(projectId, idx, field, value) {
  const t = (window.oppActiveTranchesByProject[projectId] || [])[idx];
  if (!t) return;
  t[field] = value;
  oppRenderTranches(projectId);
}

// oppRenderBalanceLine — advisory only, NEVER disables Save. Over- and
// under-scheduled totals are both legitimate (POs get amended, retention
// held back), so this is purely informational.
function oppRenderBalanceLine(projectId) {
  const el = document.getElementById(`opp-balance-line-${projectId}`);
  if (!el) return;
  const list = window.oppActiveTranchesByProject[projectId] || [];
  const scheduled = list.reduce((s, t) => s + (Number(t.expectedAmount) || 0), 0);
  const poTotal = window.oppScheduleDataCache[projectId]?.poTotal;
  if (poTotal == null) {
    el.innerHTML = `<div style="color:var(--muted);">Scheduled ₹${oppFmt(scheduled)}</div><div style="color:var(--muted); font-weight:600; margin-top:2px;">PO Total unknown, cannot compare.</div>`;
    return;
  }
  const diff = poTotal - scheduled;
  // "Scheduled X of Y" on its own line, the unscheduled/over-scheduled/
  // fully-scheduled note on the line below it — the two used to run
  // together as one long sentence.
  let color = '#15803d', note = 'Fully scheduled.';
  if (diff > 0.005) { color = '#b45309'; note = `₹${oppFmt(diff)} unscheduled.`; }
  else if (diff < -0.005) { color = '#b91c1c'; note = `₹${oppFmt(-diff)} over-scheduled.`; }
  el.innerHTML = `<div>Scheduled ₹${oppFmt(scheduled)} of ₹${oppFmt(poTotal)}</div><div style="color:${color}; margin-top:2px;">${note}</div>`;
}

async function oppSaveSchedule(projectId) {
  if (!projectId) return;
  const list = window.oppActiveTranchesByProject[projectId] || [];
  const fbId = `opp-editor-feedback-${projectId}`;
  for (const t of list) {
    if (!(Number(t.expectedAmount) > 0) || !t.expectedDate) {
      showBOQBanner(fbId, "Every tranche needs a positive expected amount and a date.", "error");
      return;
    }
  }
  showBlockingOverlay("Saving Payment Schedule...");
  try {
    const data = await apFetch({
      action: "saveOrderPaymentSchedule", projectId,
      tranches: list.map(t => ({
        paymentId: t.paymentId, expectedAmount: t.expectedAmount, expectedDate: t.expectedDate,
        receivedAmount: t.receivedAmount || 0, receivedDate: t.receivedDate || null,
        paymentReference: t.paymentReference || null,
      })),
      operatorName: window.appActiveOperatorIdentityString || "Unknown",
    });
    if (data.success) {
      // Force a fresh fetch for this project (its own numbers changed) and
      // reload the list (its header's PO Total/Received/Pending changed
      // too) — every other card's own expand state is untouched. Deleting
      // the cache before oppLoadList()'s own re-render means this card
      // briefly shows "Loading..." there; the explicit re-fetch below
      // (still needed, since this project's editor must show the saved
      // data, not just the list) then fills it in for real.
      delete window.oppScheduleDataCache[projectId];
      await oppLoadList();
      if (window.oppExpandedProjects.has(projectId)) {
        try {
          const fresh = await apFetch({ action: "fetchOrderPaymentSchedule", projectId });
          window.oppScheduleDataCache[projectId] = fresh.success ? fresh : { error: fresh.error || 'Failed to load.' };
          if (fresh.success) window.oppActiveTranchesByProject[projectId] = (fresh.tranches || []).map(t => ({ ...t }));
        } catch (e) { /* the list itself already reloaded; a failure here just leaves this one editor on "Loading..." */ }
        const wrapNow = document.getElementById(`opp-editor-expand-${projectId}`);
        if (wrapNow && window.oppExpandedProjects.has(projectId)) {
          wrapNow.innerHTML = oppRenderEditorContent(projectId);
          oppFillTranchesIfPresent(projectId);
        }
        showBOQBanner(fbId, "Saved.", "success");
      }
      oppLoadAggregate();
    } else {
      showBOQBanner(fbId, data.error || "Failed.", "error");
    }
  } catch (e) {
    showBOQBanner(fbId, "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

// ── "View Lead" — same searchCompanyData action + card markup as Search
// Tasks' View Company button (marketing/companies.js's
// toggleTaskCompanyExpand), reused so the lead's real, editable View
// Details form (toggleContactExpansionView, leads.js) opens identically
// from here. ──────────────────────────────────────────────────────────

function oppLeadExpandPlaceholderOrCached(projectId) {
  return window.oppLeadCache && window.oppLeadCache[projectId] ? window.oppLeadCache[projectId] : `<div style="padding:10px 14px; color:var(--muted); font-size:0.8rem; border-top:1px solid var(--border);">Loading lead...</div>`;
}
window.oppLeadCache = window.oppLeadCache || {};

async function oppToggleLeadExpand(projectId, encodedCompany) {
  const companyName = decodeURIComponent(encodedCompany);
  const expandDiv = document.getElementById(`opp-lead-expand-${projectId}`);
  if (!expandDiv) return;

  const btn = document.getElementById(`opp-lead-btn-${projectId}`);
  if (window.oppLeadExpandedProjects.has(projectId)) {
    window.oppLeadExpandedProjects.delete(projectId);
    expandDiv.style.display = "none";
    expandDiv.innerHTML = "";
    if (btn) btn.textContent = "View Lead";
    return;
  }
  window.oppLeadExpandedProjects.add(projectId);
  expandDiv.style.display = "block";
  expandDiv.innerHTML = `<div style="padding:10px 14px; color:var(--muted); font-size:0.8rem; border-top:1px solid var(--border);">Loading lead...</div>`;
  if (btn) btn.textContent = "Hide Lead";

  try {
    const data = await apFetch({ action: "searchCompanyData", activeEngineer: window.appActiveOperatorIdentityString, companyName, contactName: "" });
    const target = document.getElementById(`opp-lead-expand-${projectId}`);
    if (!target) return; // panel was navigated away from mid-fetch

    if (!data.success || !data.leads || data.leads.length === 0) {
      const html = `<div style="padding:10px 14px; border-top:1px solid var(--border); color:var(--warn); font-size:0.82rem; font-weight:700;">No lead record found for "${escapeHtml(companyName)}".</div>`;
      target.innerHTML = html;
      window.oppLeadCache[projectId] = html;
      return;
    }

    globalFollowUpsCacheMap = data.followups;
    globalTasksCacheMap = data.tasks;

    const cardsHtml = data.leads.map(lead => {
      const tRef = lead["Lead ID"];
      return `
        <div class="contact-summary-card-parent" id="opp-lead-card-${tRef}">
          <div class="contact-summary-header-row" style="cursor:pointer;" onclick="toggleContactExpansionView('${tRef}', \`${encodeURIComponent(JSON.stringify(lead))}\`)">
            <div class="contact-summary-title-info">
              <div class="meta-row-line-block" style="margin-bottom:6px;">
                <span style="background:#e2e8f0;">Company:</span><strong style="margin-right:20px;">${escapeHtml(lead["Company Name"] || companyName)}</strong>
                <span style="background:#edf2f7;">Status:</span><strong id="card-lbl-status-${tRef}">${escapeHtml(lead["Status"] || "N/A")}</strong>
              </div>
              <div class="meta-row-line-block">
                <span style="background:#e2e8f0;">Name:</span><strong style="margin-right:20px;" id="card-lbl-name-${tRef}">${escapeHtml(lead["Contact Person Name"] || "Unspecified")}</strong>
                <span style="background:#edf2f7;">Position:</span><strong id="card-lbl-pos-${tRef}">${escapeHtml(lead["Position"] || "Unspecified")}</strong>
              </div>
            </div>
            <div class="directory-btn-actions-block" onclick="event.stopPropagation()">
              <span id="expand-trigger-${tRef}" style="color:var(--brand); font-size:1.3rem; font-weight:700; line-height:1; padding:4px 6px;">▾</span>
            </div>
          </div>
          <div class="contact-expanded-workspace-payload-drawer" id="drawer-panel-${tRef}" style="display:none; padding-top:4px;">
            <div class="leads-editable-fields-box-canvas" id="canvas-fields-${tRef}"></div>
            <div class="child-injected-modules-mount-point" id="modules-mount-${tRef}" style="margin-top:10px;"></div>
          </div>
        </div>`;
    }).join("");

    const html = `<div style="padding:12px 14px; border-top:1px solid var(--border); background:#f8fafc;">
      <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--brand); margin-bottom:10px;">📋 ${escapeHtml(companyName)}, Lead Record</div>
      ${cardsHtml}
    </div>`;
    target.innerHTML = html;
    window.oppLeadCache[projectId] = html;
  } catch (e) {
    const target = document.getElementById(`opp-lead-expand-${projectId}`);
    if (target) target.innerHTML = `<div style="padding:10px 14px; border-top:1px solid var(--border); color:var(--warn);">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// ── Admin-only aggregate strip ──────────────────────────────────────────
async function oppLoadAggregate() {
  const el = document.getElementById("opp-aggregate-strip");
  el.innerHTML = `<div style="text-align:center; padding:10px; color:var(--muted); font-size:0.8rem;">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchOrderPaymentAggregate" });
    if (!data.success) { el.style.display = "none"; return; }
    oppRenderAggregateStrip(data);
  } catch (e) {
    el.style.display = "none";
  }
}

function oppRenderAggregateStrip(data) {
  const el = document.getElementById("opp-aggregate-strip");
  const bucket = (label, b, color) => `
    <div style="flex:1; min-width:120px; background:${color.bg}; border:1px solid ${color.border}; border-radius:var(--radius); padding:10px 12px;">
      <div style="font-size:0.66rem; font-weight:800; text-transform:uppercase; color:${color.text};">${label}</div>
      <div style="font-size:1.02rem; font-weight:800; color:${color.text}; font-family:monospace;">₹${oppFmt(b.amount)}</div>
      <div style="font-size:0.66rem; color:var(--muted);">${b.count} payment${b.count === 1 ? '' : 's'}${b.oldestDate ? ' · oldest ' + oppFmtDate(b.oldestDate) : ''}</div>
    </div>`;
  const red = { bg: '#fee2e2', border: '#fca5a5', text: '#b91c1c' };
  const green = { bg: '#dcfce7', border: '#86efac', text: '#15803d' };
  const neutral = { bg: '#f1f5f9', border: 'var(--border)', text: '#334155' };
  el.innerHTML = `
    <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--muted); margin-bottom:8px;">Expected Payments Across All POs</div>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      ${bucket('Overdue more than 7 days', data.overdueOverWeek, red)}
      ${bucket('Overdue in last 7 days', data.overdue, red)}
      ${bucket('Today', data.today, green)}
      ${bucket('This Week', data.thisWeek, green)}
      ${bucket('Next Week', data.nextWeek, neutral)}
      ${bucket('This Month', data.thisMonth, neutral)}
      ${bucket('This Quarter', data.thisQuarter, neutral)}
      ${bucket('Later', data.later, neutral)}
    </div>`;
}
