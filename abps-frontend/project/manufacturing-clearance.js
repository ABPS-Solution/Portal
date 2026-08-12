let mcCurrentStatus = "Inactive";

function initializeManufacturingClearancePanel() {
  mcCurrentStatus = "Inactive";
  syncMcStatusPills();
  loadManufacturingClearanceList();
}

async function loadManufacturingClearanceList() {
  const body = document.getElementById("mc-list-body");
  body.innerHTML = '<tr><td colspan="4" style="padding:14px; text-align:center;">Loading...</td></tr>';
  try {
    const data = await apFetch({ action: "fetchProjectsByStatus", status: mcCurrentStatus });
    if (!data.success) { body.innerHTML = `<tr><td colspan="4" style="padding:14px; text-align:center; color:#b91c1c;">${data.error}</td></tr>`; return; }
    if (data.projects.length === 0) { body.innerHTML = '<tr><td colspan="4" style="padding:14px; text-align:center; color:var(--muted);">No projects with this status.</td></tr>'; return; }
    body.innerHTML = data.projects.map(p => `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-family:monospace;">${p.projectId}</td>
        <td style="padding:8px;">${p.companyName}</td>
        <td style="padding:8px;">${formatDateDMY(p.deliveryDate) || "—"}</td>
        <td style="padding:8px;">
          ${mcCurrentStatus === "Inactive"
            ? `<button class="nav-btn-styled" style="background:#2f9e58; padding:5px 12px; font-size:0.78rem;" onclick="mcActivateProject('${p.projectId}')">Activate</button>`
            : mcCurrentStatus === "Completed"
            ? `<button class="nav-btn-styled" style="background:var(--brand); padding:5px 12px; font-size:0.78rem;" onclick="mcReactivateProject('${p.projectId}')">Reactivate</button>`
            : `<span style="color:var(--muted); font-size:0.78rem;">—</span>`}
        </td>
      </tr>`).join("");
  } catch(e) {
    body.innerHTML = `<tr><td colspan="4" style="padding:14px; text-align:center; color:#b91c1c;">Network error: ${e.message}</td></tr>`;
  }
}

async function mcActivateProject(projectId) {
  if (!confirm(`Activate ${projectId}? This clears it for manufacturing and makes it visible to all departments. This cannot be undone from this screen.`)) return;
  showBlockingOverlay("Activating project...");
  try {
    const data = await apFetch({ action: "activateProject", projectId });
    if (data.success) { loadManufacturingClearanceList(); }
    else alert(data.error || "Failed to activate.");
  } catch(e) {
    alert("Network error: " + e.message);
  } finally {
    hideBlockingOverlay();
  }
}

async function mcReactivateProject(projectId) {
  if (!confirm(`Reactivate ${projectId}? This moves it back to Active. Its PRNs stay Completed and any resumed production will need a fresh Job Card Increase or new PRN.`)) return;
  showBlockingOverlay("Reactivating project...");
  try {
    const data = await apFetch({ action: "reactivateCompletedProject", projectId });
    if (data.success) { loadManufacturingClearanceList(); }
    else alert(data.error || "Failed to reactivate.");
  } catch(e) {
    alert("Network error: " + e.message);
  } finally {
    hideBlockingOverlay();
  }
}

let sweepBlockedAllocationsCache = [];

