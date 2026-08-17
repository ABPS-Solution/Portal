// ═══════════════════════════════════════════════════════════════════════
// accounts/security-admin.js — admin screen for location-restricted login
// (ABPS_SYSTEM_OVERVIEW.md §18.3): toggle Login Anywhere per user, manage
// the office IP allowlist and trusted devices, view the login log, and
// edit business-hours/outage settings. Backend: routes/security.js,
// perm_admin-gated on every route (also gated client-side via
// userPermissions.admin, same pattern as other admin-only elements).
// ═══════════════════════════════════════════════════════════════════════
let saAllUsers = [];

async function initializeSecurityAdminPanel() {
  switchSecurityAdminTab('users');
  await Promise.all([
    loadSecurityAdminUsers(),
    loadAllowedNetworks(),
    loadTrustedDevices(),
    loadLoginLog(),
    loadSecuritySettings(),
  ]);
}

function exitSecurityAdminBackToMenu() {
  document.getElementById("canvas-module-security-admin").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function switchSecurityAdminTab(tab) {
  ['users', 'networks', 'devices', 'log', 'settings'].forEach(t => {
    document.getElementById(`sa-panel-${t}`).style.display = (t === tab) ? 'block' : 'none';
    document.getElementById(`sa-tab-${t}`).style.background = (t === tab) ? 'var(--brand)' : '';
    document.getElementById(`sa-tab-${t}`).style.color = (t === tab) ? '#fff' : '';
  });
}

// ── Login Anywhere ──────────────────────────────────────────────────────
async function loadSecurityAdminUsers() {
  try {
    const data = await apFetch({ action: "fetchAdminUserList" });
    if (data.success) { saAllUsers = data.users; renderSecurityAdminUsers(); }
  } catch (e) { console.error("loadSecurityAdminUsers failed:", e); }
}

function renderSecurityAdminUsers() {
  const q = (document.getElementById("sa-user-search").value || "").toLowerCase().trim();
  const tbody = document.getElementById("sa-user-list-body");
  const filtered = saAllUsers.filter(u => !q ||
    `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
    (u.email || "").toLowerCase().includes(q));
  tbody.innerHTML = filtered.map(u => `
    <tr style="border-top:1px solid var(--border);">
      <td style="padding:8px;">${u.first_name || ''} ${u.last_name || ''}</td>
      <td style="padding:8px;">${u.email}</td>
      <td style="padding:8px;">${u.department || '—'}</td>
      <td style="padding:8px;">${u.status}</td>
      <td style="padding:8px; text-align:center;">
        <input type="checkbox" ${u.perm_login_anywhere ? 'checked' : ''} onchange="toggleUserLoginAnywhere('${u.email}', this.checked)">
      </td>
    </tr>`).join('') || `<tr><td colspan="5" style="padding:14px; text-align:center; color:var(--muted);">No users found.</td></tr>`;
}

async function toggleUserLoginAnywhere(email, enabled) {
  try {
    const data = await apFetch({ action: "setUserLoginAnywhere", email, enabled });
    if (data.success) {
      showBOQBanner("sa-feedback", `${enabled ? 'Enabled' : 'Disabled'} Login Anywhere for ${email}.`, "success");
      const u = saAllUsers.find(x => x.email === email);
      if (u) u.perm_login_anywhere = enabled;
    } else {
      showBOQBanner("sa-feedback", data.error || "Failed to update.", "error");
      renderSecurityAdminUsers(); // revert the checkbox to server state
    }
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
    renderSecurityAdminUsers();
  }
}

// ── Office Networks ─────────────────────────────────────────────────────
async function loadAllowedNetworks() {
  try {
    const data = await apFetch({ action: "fetchAllowedNetworks" });
    if (!data.success) return;
    const tbody = document.getElementById("sa-network-list-body");
    tbody.innerHTML = data.networks.map(n => `
      <tr style="border-top:1px solid var(--border);">
        <td style="padding:8px; font-family:monospace;">${n.cidr}</td>
        <td style="padding:8px;">${n.label}</td>
        <td style="padding:8px;">${n.active ? 'Active' : 'Inactive'}</td>
        <td style="padding:8px;">${formatDateDMY ? formatDateDMY(n.created_at) : new Date(n.created_at).toLocaleDateString()}</td>
        <td style="padding:8px;">${n.active ? `<button class="nav-btn-styled" style="padding:4px 10px; font-size:0.78rem;" onclick="deactivateNetwork(${n.network_id})">Deactivate</button>` : '—'}</td>
      </tr>`).join('') || `<tr><td colspan="5" style="padding:14px; text-align:center; color:var(--muted);">No networks configured.</td></tr>`;
  } catch (e) { console.error("loadAllowedNetworks failed:", e); }
}

async function submitAddAllowedNetwork() {
  const cidr = document.getElementById("sa-network-cidr").value.trim();
  const label = document.getElementById("sa-network-label").value.trim();
  if (!cidr || !label) return showBOQBanner("sa-feedback", "CIDR and Label are both required.", "error");
  try {
    const data = await apFetch({ action: "addAllowedNetwork", cidr, label });
    if (data.success) {
      document.getElementById("sa-network-cidr").value = "";
      document.getElementById("sa-network-label").value = "";
      showBOQBanner("sa-feedback", "Network added.", "success");
      loadAllowedNetworks();
    } else {
      showBOQBanner("sa-feedback", data.error || "Failed to add network.", "error");
    }
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

async function deactivateNetwork(networkId) {
  if (!confirm("Deactivate this network? Users on it will no longer be treated as on the office network.")) return;
  try {
    const data = await apFetch({ action: "deactivateAllowedNetwork", networkId });
    if (data.success) { showBOQBanner("sa-feedback", "Network deactivated.", "success"); loadAllowedNetworks(); }
    else showBOQBanner("sa-feedback", data.error || "Failed to deactivate.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

// ── Trusted Devices ──────────────────────────────────────────────────────
async function loadTrustedDevices() {
  try {
    const data = await apFetch({ action: "fetchTrustedDevices" });
    if (!data.success) return;
    const tbody = document.getElementById("sa-device-list-body");
    tbody.innerHTML = data.devices.map(d => `
      <tr style="border-top:1px solid var(--border);">
        <td style="padding:8px;">${d.user_email}</td>
        <td style="padding:8px; font-size:0.78rem; color:var(--muted); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${d.device_label || '—'}</td>
        <td style="padding:8px;">${new Date(d.created_at).toLocaleDateString()}</td>
        <td style="padding:8px;">${d.last_used_at ? new Date(d.last_used_at).toLocaleDateString() : '—'}</td>
        <td style="padding:8px;">${new Date(d.expires_at).toLocaleDateString()}</td>
        <td style="padding:8px;">${d.revoked ? 'Revoked' : 'Active'}</td>
        <td style="padding:8px;">${!d.revoked ? `<button class="nav-btn-styled" style="padding:4px 10px; font-size:0.78rem;" onclick="revokeDevice(${d.device_id})">Revoke</button>` : '—'}</td>
      </tr>`).join('') || `<tr><td colspan="7" style="padding:14px; text-align:center; color:var(--muted);">No trusted devices yet.</td></tr>`;
  } catch (e) { console.error("loadTrustedDevices failed:", e); }
}

async function revokeDevice(deviceId) {
  if (!confirm("Revoke this device? It will need to log in from the office network again to be trusted.")) return;
  try {
    const data = await apFetch({ action: "revokeTrustedDevice", deviceId });
    if (data.success) { showBOQBanner("sa-feedback", "Device revoked.", "success"); loadTrustedDevices(); }
    else showBOQBanner("sa-feedback", data.error || "Failed to revoke.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

// ── Login Log ─────────────────────────────────────────────────────────
async function loadLoginLog() {
  try {
    const data = await apFetch({ action: "fetchLoginLog" });
    if (!data.success) return;
    const tbody = document.getElementById("sa-log-list-body");
    tbody.innerHTML = data.entries.map(l => `
      <tr style="border-top:1px solid var(--border); ${l.allowed ? '' : 'background:#fef2f2;'}">
        <td style="padding:8px; white-space:nowrap;">${new Date(l.created_at).toLocaleString()}</td>
        <td style="padding:8px;">${l.email || l.google_verified_email || '—'}</td>
        <td style="padding:8px; font-family:monospace;">${l.ip || '—'}</td>
        <td style="padding:8px; font-weight:700; color:${l.allowed ? '#16a34a' : '#dc2626'};">${l.allowed ? 'Allowed' : 'Blocked'}</td>
        <td style="padding:8px;">${l.reason}</td>
        <td style="padding:8px;">${l.city ? `${l.city}, ` : ''}${l.country || '—'}</td>
        <td style="padding:8px;">${l.isp_asn || '—'}</td>
        <td style="padding:8px;">${l.is_vpn ? '⚠️ Yes' : 'No'}</td>
      </tr>`).join('') || `<tr><td colspan="8" style="padding:14px; text-align:center; color:var(--muted);">No login attempts recorded yet.</td></tr>`;
  } catch (e) { console.error("loadLoginLog failed:", e); }
}

// ── Settings ──────────────────────────────────────────────────────────
async function loadSecuritySettings() {
  try {
    const data = await apFetch({ action: "fetchSecuritySettings" });
    if (data.success && data.settings) {
      document.getElementById("sa-settings-hours-start").value = (data.settings.business_hours_start || '').slice(0, 5);
      document.getElementById("sa-settings-hours-end").value = (data.settings.business_hours_end || '').slice(0, 5);
      document.getElementById("sa-settings-outage-minutes").value = data.settings.outage_grace_minutes;
    }
  } catch (e) { console.error("loadSecuritySettings failed:", e); }
}

async function submitSecuritySettings() {
  const businessHoursStart = document.getElementById("sa-settings-hours-start").value;
  const businessHoursEnd = document.getElementById("sa-settings-hours-end").value;
  const outageGraceMinutes = parseInt(document.getElementById("sa-settings-outage-minutes").value, 10) || null;
  try {
    const data = await apFetch({ action: "updateSecuritySettings", businessHoursStart, businessHoursEnd, outageGraceMinutes });
    if (data.success) showBOQBanner("sa-feedback", "Settings saved.", "success");
    else showBOQBanner("sa-feedback", data.error || "Failed to save settings.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}
