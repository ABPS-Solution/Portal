async function initializePinvWorkspace() {
  document.getElementById("pinv-feedback").style.display = "none";
  document.getElementById("pinv-detail-zone").style.display = "none";
  document.getElementById("pinv-success-zone").style.display = "none";
  document.getElementById("pinv-select-zone").style.display = "block";
  const select = document.getElementById("pinv-project-select");
  select.innerHTML = '<option value="">Loading...</option>';
  try {
    const data = await apFetch({ action: "fetchInvoiceEligibleProjects" });
    if (!data.success) { select.innerHTML = '<option value="">Failed to load</option>'; return; }
    select.innerHTML = '<option value="">— Select Project ID —</option>' +
      data.projects.map(p => `<option value="${p.projectId}">${p.projectId} — ${p.companyName || ''}</option>`).join("");
    if (data.projects.length === 0) {
      select.innerHTML = '<option value="">No eligible Project IDs. All Job Cards for a project must be Added to FG first</option>';
    }
  } catch(e) {
    select.innerHTML = '<option value="">Network error</option>';
  }
}

async function handlePinvProjectChange(projectId) {
  const detailZone = document.getElementById("pinv-detail-zone");
  if (!projectId) { detailZone.style.display = "none"; return; }
  detailZone.style.display = "block";
  document.getElementById("pinv-jc-body").innerHTML = '<tr><td colspan="3" style="padding:14px; text-align:center;">Loading...</td></tr>';
  document.getElementById("pinv-blockers").style.display = "none";
  document.getElementById("pinv-generate-zone").style.display = "none";
  try {
    const data = await apFetch({ action: "fetchProjectInvoiceDetail", projectId });
    if (!data.success) { showBOQBanner("pinv-feedback", data.error || "Failed to load.", "error"); return; }
    pinvCache = data;
    renderPinvDetail();
  } catch(e) {
    showBOQBanner("pinv-feedback", "Network error: " + e.message, "error");
  }
}

function renderPinvDetail() {
  const body = document.getElementById("pinv-jc-body");
  const jcByBoq = {};
  pinvCache.jobCards.forEach(jc => { (jcByBoq[jc.boqId] = jcByBoq[jc.boqId] || []).push(jc); });
  body.innerHTML = pinvCache.boqs.map(b => {
    const jcs = jcByBoq[b.boqId] || [];
    if (jcs.length === 0) {
      return `<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">${b.boqId}</td><td style="padding:8px; color:var(--warn); font-weight:700;" colspan="2">⚠ No Job Cards found for this BOQ</td></tr>`;
    }
    return jcs.map((jc, i) => {
      const useLabel = jc.finishedGoodUse === 'Use in other Product' ? 'Used in other Product'
                      : jc.finishedGoodUse === 'Keep in FG Store' ? 'Ready for Dispatch' : '—';
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px;">${i === 0 ? b.boqId : ''}</td>
        <td style="padding:8px;">✅ JC_Set${jc.setNumber}</td>
        <td style="padding:8px;">${useLabel}</td>
      </tr>`;
    }).join("");
  }).join("");

  const blockersDiv = document.getElementById("pinv-blockers");
  const msgs = [];
  if (pinvCache.pendingTicketsCount > 0) msgs.push(`${pinvCache.pendingTicketsCount} pending store ticket(s) exist for this project's job cards — resolve them first.`);
  if (pinvCache.pendingBoqIncreaseCount > 0) msgs.push(`${pinvCache.pendingBoqIncreaseCount} open BOQ Increase Request(s) exist for this project — resolve them first.`);
  if (msgs.length > 0) {
    blockersDiv.style.display = "block";
    blockersDiv.innerHTML = msgs.map(m => `<div style="padding:12px; margin-bottom:8px; background:#fff5f5; border-left:4px solid #e53e3e; border-radius:var(--radius); color:#b91c1c; font-weight:600;">${m}</div>`).join("");
    document.getElementById("pinv-generate-zone").style.display = "none";
  } else {
    blockersDiv.style.display = "none";
    document.getElementById("pinv-generate-zone").style.display = "block";
  }
}

function openPinvConfirmModal() {
  document.getElementById("pinv-confirm-target").textContent = pinvCache.projectId;
  document.getElementById("pinv-confirm-input").value = "";
  document.getElementById("pinv-confirm-submit-btn").disabled = true;
  document.getElementById("pinv-confirm-submit-btn").style.opacity = "0.5";
  document.getElementById("pinv-confirm-submit-btn").style.cursor = "not-allowed";
  document.getElementById("pinv-confirm-modal").style.display = "flex";
}

function closePinvConfirmModal() {
  document.getElementById("pinv-confirm-modal").style.display = "none";
}

function handlePinvConfirmInput() {
  const match = document.getElementById("pinv-confirm-input").value.trim() === pinvCache.projectId;
  const btn = document.getElementById("pinv-confirm-submit-btn");
  btn.disabled = !match;
  btn.style.opacity = match ? "1" : "0.5";
  btn.style.cursor = match ? "pointer" : "not-allowed";
}

async function submitPinvGeneration() {
  const confirmProjectId = document.getElementById("pinv-confirm-input").value.trim();
  closePinvConfirmModal();
  showBlockingOverlay("Generating invoice and completing project...");
  try {
    const data = await apFetch({ action: "generateProjectInvoiceAndComplete", projectId: pinvCache.projectId, confirmProjectId, operatorName: appActiveOperatorIdentityString || "Unknown" });
    if (data.success) {
      document.getElementById("pinv-select-zone").style.display = "none";
      document.getElementById("pinv-detail-zone").style.display = "none";
      const successZone = document.getElementById("pinv-success-zone");
      successZone.style.display = "block";
      successZone.innerHTML = `
        <div style="padding:14px; background:#f0fdf4; border-left:4px solid #22c55e; border-radius:var(--radius); color:#15803d; font-weight:600; margin-bottom:14px;">
          Invoice Generated for Project ID: ${pinvCache.projectId}
        </div>
        <a href="${driveLink(data.url)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700;">Open Invoice Document ↗</a>
        <div style="margin-top:16px;">
          <button class="nav-btn-styled" style="background:var(--accent); padding:8px 20px; font-weight:700;" onclick="initializePinvWorkspace()">+ Create New Project Invoice</button>
        </div>`;
    } else {
      showBOQBanner("pinv-feedback", data.error || "Failed.", "error");
    }
  } catch(e) {
    showBOQBanner("pinv-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

let _submitFGAddItemInProgress = false;
