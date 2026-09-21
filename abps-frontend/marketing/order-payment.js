// ═══════════════════════════════════════════════════════════════════════
// marketing/order-payment.js — Order Payment Progress (migration 214,
// 21 Sep 2026). Tracks expected-vs-received payment tranches per customer
// PO, modelled on purchase/pps-tracking.js's delivery-schedule editor
// (same "full desired list, not a delta" save contract, same per-row
// add/remove/edit shape) — minus quantity clamping, since this screen
// deliberately WARNS instead of blocking on over/under-scheduling.
//
// All top-level identifiers are opp*-prefixed (grepped clean before
// writing this file) — a duplicate top-level let/const anywhere in
// abps-frontend/ is a fatal SyntaxError that kills the whole app.
// ═══════════════════════════════════════════════════════════════════════

window.oppAllProjects = window.oppAllProjects || [];
window.oppActiveProjectId = null;
window.oppActiveTranches = [];   // working copy for the open editor
window.oppActivePoTotal = null;
window.oppIncludeFullyPaid = false;

function oppFmt(n) {
  return (parseFloat(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

async function initializeOrderPaymentPanel() {
  document.getElementById("opp-feedback").style.display = "none";
  document.getElementById("opp-editor-zone").innerHTML = "";
  document.getElementById("opp-include-fully-paid").checked = window.oppIncludeFullyPaid;
  document.getElementById("opp-search-input").value = "";
  await oppLoadList();
  if (localStorage.getItem("isUserAdminGlobal") === "true") {
    document.getElementById("opp-aggregate-strip").style.display = "block";
    oppLoadAggregate();
  } else {
    document.getElementById("opp-aggregate-strip").style.display = "none";
  }
}

async function oppLoadList() {
  const listEl = document.getElementById("opp-list");
  listEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchOrderPaymentProgressList", includeFullyPaid: window.oppIncludeFullyPaid });
    if (!data.success) { listEl.innerHTML = `<div style="color:#b91c1c; padding:14px;">${data.error || 'Failed to load.'}</div>`; return; }
    window.oppAllProjects = data.projects || [];
    oppRenderList(window.oppAllProjects);
  } catch (e) {
    listEl.innerHTML = `<div style="color:#b91c1c; padding:14px;">Network error: ${e.message}</div>`;
  }
}

function oppToggleFullyPaid(checked) {
  window.oppIncludeFullyPaid = checked;
  oppLoadList();
}

function oppFilterList(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) { oppRenderList(window.oppAllProjects); return; }
  const filtered = window.oppAllProjects.filter(p =>
    (p.companyName || "").toLowerCase().includes(q) ||
    (p.projectId || "").toLowerCase().includes(q) ||
    (p.poNumber || "").toLowerCase().includes(q));
  oppRenderList(filtered);
}

function oppRenderList(projects) {
  const listEl = document.getElementById("opp-list");
  if (!projects.length) {
    listEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">No matching POs.</div>`;
    return;
  }
  listEl.innerHTML = projects.map(p => {
    const isFullyPaid = p.pendingBalance != null && p.pendingBalance <= 0.005;
    const overdueChip = p.overdueCount > 0
      ? `<span style="background:#fee2e2; color:#b91c1c; font-weight:700; font-size:0.7rem; padding:2px 8px; border-radius:10px; margin-left:8px;">${p.overdueCount} overdue</span>` : "";
    const fallbackChip = p.poTotalSource === 'po_invoice_report_fallback'
      ? `<span style="background:#fef3c7; color:#b45309; font-weight:700; font-size:0.68rem; padding:2px 8px; border-radius:10px; margin-left:8px;" title="No PO line items on this project — using the PO amount typed at upload as an estimate.">estimate</span>` : "";
    const unknownTotal = p.poTotal == null;
    return `
      <div style="border:1px solid var(--border); border-radius:var(--radius); padding:12px 14px; margin-bottom:10px; background:#fff; cursor:pointer;" onclick="oppOpenProject('${p.projectId}')">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <strong>${p.companyName || '—'}</strong> — ${p.projectId}
            <div style="font-size:0.78rem; color:var(--muted);">PO ${p.poNumber || '—'} · ${p.projectStatus || ''}${overdueChip}${fallbackChip}</div>
          </div>
          <div style="text-align:right; font-family:monospace;">
            ${unknownTotal
              ? `<div style="color:var(--muted); font-size:0.82rem;">PO total unknown</div>`
              : `<div style="font-size:0.7rem; color:var(--muted);">PO Total ₹${oppFmt(p.poTotal)}</div>
                 <div style="font-size:0.7rem; color:#15803d;">Received ₹${oppFmt(p.receivedTotal)}</div>
                 <div style="font-weight:700; color:${isFullyPaid ? '#15803d' : '#b45309'};">
                   ${isFullyPaid ? 'Fully Paid' : `Pending ₹${oppFmt(p.pendingBalance)}`}
                 </div>`}
          </div>
        </div>
      </div>`;
  }).join("");
}

async function oppOpenProject(projectId) {
  window.oppActiveProjectId = projectId;
  const zone = document.getElementById("opp-editor-zone");
  zone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;
  zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const data = await apFetch({ action: "fetchOrderPaymentSchedule", projectId });
    if (!data.success) { zone.innerHTML = `<div style="color:#b91c1c; padding:14px;">${data.error || 'Failed to load.'}</div>`; return; }
    window.oppActiveTranches = (data.tranches || []).map(t => ({ ...t }));
    window.oppActivePoTotal = data.poTotal;
    oppRenderEditor(data.project, data.poTotal, data.poTotalSource);
  } catch (e) {
    zone.innerHTML = `<div style="color:#b91c1c; padding:14px;">Network error: ${e.message}</div>`;
  }
}

function oppRenderEditor(project, poTotal, poTotalSource) {
  const zone = document.getElementById("opp-editor-zone");
  const fallbackNote = poTotalSource === 'po_invoice_report_fallback'
    ? `<div style="font-size:0.72rem; color:#b45309; margin-top:4px;">⚠ This project has no line items yet — the PO Total shown is an estimate from the amount typed in at PO upload, not a reliable figure.</div>` : "";
  zone.innerHTML = `
    <div style="border:1.5px solid var(--brand); border-radius:var(--radius); padding:16px; margin-top:6px; background:#fbfdff;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div>
          <div style="font-weight:800; font-size:1rem; color:var(--brand);">${project.companyName || project.projectId}</div>
          <div style="font-size:0.8rem; color:var(--muted);">${project.projectId} · PO ${project.poNumber || '—'}</div>
        </div>
        <button class="nav-btn-styled" style="background:#718096;" onclick="oppCloseEditor()">Close</button>
      </div>

      ${project.paymentTerms ? `
      <div style="margin-top:12px; padding:10px 12px; background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius); font-size:0.82rem;">
        <strong style="color:var(--muted); font-size:0.72rem; text-transform:uppercase;">Payment Terms (reference only)</strong>
        <div style="margin-top:4px; white-space:pre-line;">${project.paymentTerms}</div>
      </div>` : ""}

      <div style="margin-top:14px; font-size:0.85rem;">
        PO Total (incl. GST): <strong>${poTotal == null ? 'Unknown' : '₹' + oppFmt(poTotal)}</strong>
        ${fallbackNote}
      </div>

      <div id="opp-tranches-wrap" style="margin-top:12px;"></div>
      <div id="opp-balance-line" style="margin-top:8px; font-size:0.82rem; font-weight:700;"></div>

      <div style="display:flex; gap:10px; margin-top:14px;">
        <button class="nav-btn-styled" style="background:var(--brand); padding:8px 16px;" onclick="oppSaveSchedule()">Save</button>
      </div>
      <div id="opp-editor-feedback" style="margin-top:10px;"></div>
    </div>`;
  oppRenderTranches();
}

function oppCloseEditor() {
  window.oppActiveProjectId = null;
  window.oppActiveTranches = [];
  document.getElementById("opp-editor-zone").innerHTML = "";
}

function oppRenderTranches() {
  const wrap = document.getElementById("opp-tranches-wrap");
  const list = window.oppActiveTranches;
  const rows = list.map((t, i) => {
    const slipped = t.originalExpectedDate && t.expectedDate && t.originalExpectedDate !== t.expectedDate;
    const isReceived = t.status === 'Received';
    const note = slipped
      ? `<div style="font-size:0.68rem; color:#b45309; margin-top:2px;" title="Originally expected ${t.originalExpectedDate}">slipped from ${t.originalExpectedDate}</div>` : "";
    return `
      <div style="background:#f8fafc; border:1px solid var(--border); border-radius:6px; padding:8px 10px; margin-bottom:8px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <div style="flex:1; min-width:110px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Expected Amount ₹</label>
            <input type="number" min="0.01" step="any" value="${t.expectedAmount ?? ''}"
              oninput="oppUpdateTrancheField(${i}, 'expectedAmount', this.value)"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex:1; min-width:130px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Expected Date</label>
            <input type="date" value="${t.expectedDate || ''}"
              onchange="oppUpdateTrancheField(${i}, 'expectedDate', this.value)"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex:1; min-width:110px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Received Amount ₹</label>
            <input type="number" min="0" step="any" value="${t.receivedAmount ?? ''}"
              oninput="oppUpdateTrancheField(${i}, 'receivedAmount', this.value)"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex:1; min-width:130px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Received Date</label>
            <input type="date" value="${t.receivedDate || ''}"
              onchange="oppUpdateTrancheField(${i}, 'receivedDate', this.value)"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex:1.4; min-width:140px;">
            <label class="field-label" style="margin-top:0; font-size:0.68rem;">Reference (optional)</label>
            <input type="text" value="${(t.paymentReference || '').replace(/"/g, '&quot;')}" placeholder="UTR / Cheque No."
              oninput="oppUpdateTrancheField(${i}, 'paymentReference', this.value)"
              style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px;" />
          </div>
          <div style="flex-shrink:0; align-self:flex-end;">
            <span style="display:inline-block; padding:5px 10px; border-radius:10px; font-size:0.7rem; font-weight:700; background:${isReceived ? '#dcfce7' : (t.status === 'Partially Received' ? '#fef3c7' : '#f1f5f9')}; color:${isReceived ? '#15803d' : (t.status === 'Partially Received' ? '#b45309' : '#475569')};">${t.status}</span>
          </div>
          <button type="button" onclick="oppRemoveTranche(${i})" title="Remove this tranche" style="flex-shrink:0; align-self:flex-end; background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:4px; font-size:0.75rem; font-weight:700; padding:6px 9px; cursor:pointer;">✕</button>
        </div>
        ${note}
      </div>`;
  }).join("");
  const empty = list.length === 0
    ? `<div style="font-size:0.75rem; color:var(--muted); font-style:italic; margin-bottom:6px;">No payment tranches yet.</div>` : "";
  wrap.innerHTML = `${empty}${rows}
    <button type="button" onclick="oppAddTranche()" style="display:block; width:100%; background:none; border:1.5px dashed var(--brand); color:var(--brand); border-radius:5px; font-size:0.78rem; font-weight:700; padding:8px; cursor:pointer;">+ Add Payment</button>`;
  oppRenderBalanceLine();
}

function oppAddTranche() {
  const list = window.oppActiveTranches;
  const scheduled = list.reduce((s, t) => s + (Number(t.expectedAmount) || 0), 0);
  const remaining = window.oppActivePoTotal == null ? '' : Math.max(0, window.oppActivePoTotal - scheduled);
  list.push({ paymentId: null, expectedAmount: remaining || '', expectedDate: '', originalExpectedDate: null,
    status: 'Pending', receivedAmount: 0, receivedDate: '', paymentReference: '' });
  oppRenderTranches();
}

function oppRemoveTranche(idx) {
  window.oppActiveTranches.splice(idx, 1);
  oppRenderTranches();
}

function oppUpdateTrancheField(idx, field, value) {
  const t = window.oppActiveTranches[idx];
  if (!t) return;
  t[field] = value;
  // Derive the displayed status client-side too, purely cosmetic — the
  // server always recomputes it authoritatively on save.
  const expected = Number(t.expectedAmount) || 0;
  const received = Number(t.receivedAmount) || 0;
  t.status = received <= 0 ? 'Pending' : (received + 1e-9 >= expected ? 'Received' : 'Partially Received');
  if (field === 'expectedAmount' || field === 'receivedAmount') {
    oppRenderTranches();
  } else {
    oppRenderBalanceLine();
  }
}

// oppRenderBalanceLine — advisory only, NEVER disables Save. Over- and
// under-scheduled totals are both legitimate (POs get amended, retention
// held back), so this is purely informational.
function oppRenderBalanceLine() {
  const el = document.getElementById("opp-balance-line");
  if (!el) return;
  const scheduled = window.oppActiveTranches.reduce((s, t) => s + (Number(t.expectedAmount) || 0), 0);
  const poTotal = window.oppActivePoTotal;
  if (poTotal == null) {
    el.innerHTML = `<span style="color:var(--muted);">Scheduled ₹${oppFmt(scheduled)} — PO Total unknown, cannot compare.</span>`;
    return;
  }
  const diff = poTotal - scheduled;
  let color = '#15803d', label = `Scheduled ₹${oppFmt(scheduled)} of ₹${oppFmt(poTotal)} — fully scheduled`;
  if (diff > 0.005) { color = '#b45309'; label = `Scheduled ₹${oppFmt(scheduled)} of ₹${oppFmt(poTotal)} — ₹${oppFmt(diff)} unscheduled`; }
  else if (diff < -0.005) { color = '#b91c1c'; label = `Scheduled ₹${oppFmt(scheduled)} of ₹${oppFmt(poTotal)} — ₹${oppFmt(-diff)} over-scheduled`; }
  el.innerHTML = `<span style="color:${color};">${label}</span>`;
}

async function oppSaveSchedule() {
  const projectId = window.oppActiveProjectId;
  if (!projectId) return;
  const fb = document.getElementById("opp-editor-feedback");
  for (const t of window.oppActiveTranches) {
    if (!(Number(t.expectedAmount) > 0) || !t.expectedDate) {
      showBOQBanner("opp-editor-feedback", "Every tranche needs a positive expected amount and a date.", "error");
      return;
    }
  }
  showBlockingOverlay("Saving Payment Schedule...");
  try {
    const data = await apFetch({
      action: "saveOrderPaymentSchedule", projectId,
      tranches: window.oppActiveTranches.map(t => ({
        paymentId: t.paymentId, expectedAmount: t.expectedAmount, expectedDate: t.expectedDate,
        receivedAmount: t.receivedAmount || 0, receivedDate: t.receivedDate || null,
        paymentReference: t.paymentReference || null,
      })),
      operatorName: window.appActiveOperatorIdentityString || "Unknown",
    });
    if (data.success) {
      showBOQBanner("opp-editor-feedback", "Saved.", "success");
      await oppOpenProject(projectId);
      await oppLoadList();
    } else {
      showBOQBanner("opp-editor-feedback", data.error || "Failed.", "error");
    }
  } catch (e) {
    showBOQBanner("opp-editor-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
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
      <div style="font-size:0.68rem; font-weight:800; text-transform:uppercase; color:${color.text};">${label}</div>
      <div style="font-size:1.05rem; font-weight:800; color:${color.text}; font-family:monospace;">₹${oppFmt(b.amount)}</div>
      <div style="font-size:0.68rem; color:var(--muted);">${b.count} payment${b.count === 1 ? '' : 's'}${b.oldestDate ? ' · oldest ' + b.oldestDate : ''}</div>
    </div>`;
  el.innerHTML = `
    <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--muted); margin-bottom:8px;">Expected Payments Across All POs (Admin View)</div>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      ${bucket('Overdue', data.overdue, { bg: '#fee2e2', border: '#fca5a5', text: '#b91c1c' })}
      ${bucket('This Week', data.thisWeek, { bg: '#fef3c7', border: '#fde68a', text: '#b45309' })}
      ${bucket('Next 30 Days', data.next30Days, { bg: '#f1f5f9', border: 'var(--border)', text: '#334155' })}
      ${bucket('Next 90 Days', data.next90Days, { bg: '#f1f5f9', border: 'var(--border)', text: '#334155' })}
      ${bucket('Later', data.later, { bg: '#f1f5f9', border: 'var(--border)', text: '#334155' })}
    </div>`;
}
