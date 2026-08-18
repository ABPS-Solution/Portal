// ═══════════════════════════════════════════════════════════════════════
// project/security-admin.js — screen for location-restricted login
// (ABPS_SYSTEM_OVERVIEW.md §18.3, migrations 099/100): toggle Login
// Anywhere and Security & Login Access per user, manage the office IP
// allowlist and trusted devices, view the login log, edit business hours,
// and manually activate/deactivate Outage Mode. Backend: routes/security.js,
// gated by perm_security_login_access on every route (client-side gated
// via userPermissions.securityLoginAccess — a dedicated permission, not
// perm_admin, so it can be granted selectively; mostly admins in practice).
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
      <td style="padding:8px; text-align:center;">
        <input type="checkbox" ${u.perm_security_login_access ? 'checked' : ''} onchange="toggleUserSecurityLoginAccess('${u.email}', this.checked)">
      </td>
    </tr>`).join('') || `<tr><td colspan="6" style="padding:14px; text-align:center; color:var(--muted);">No users found.</td></tr>`;
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

async function toggleUserSecurityLoginAccess(email, enabled) {
  try {
    const data = await apFetch({ action: "setUserSecurityLoginAccess", email, enabled });
    if (data.success) {
      showBOQBanner("sa-feedback", `${enabled ? 'Enabled' : 'Disabled'} Security & Login Access for ${email}.`, "success");
      const u = saAllUsers.find(x => x.email === email);
      if (u) u.perm_security_login_access = enabled;
    } else {
      showBOQBanner("sa-feedback", data.error || "Failed to update.", "error");
      renderSecurityAdminUsers();
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
      renderOutageModeStatus(data.settings);
    }
  } catch (e) { console.error("loadSecuritySettings failed:", e); }
}

async function submitSecuritySettings() {
  const businessHoursStart = document.getElementById("sa-settings-hours-start").value;
  const businessHoursEnd = document.getElementById("sa-settings-hours-end").value;
  try {
    const data = await apFetch({ action: "updateSecuritySettings", businessHoursStart, businessHoursEnd });
    if (data.success) showBOQBanner("sa-feedback", "Settings saved.", "success");
    else showBOQBanner("sa-feedback", data.error || "Failed to save settings.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

// Manual Outage Mode (migration 100) — deliberately NOT automatic. A real
// human with Security & Login Access flips this on when there's a
// confirmed office network/power outage, so any user who's previously
// logged in from the office can sign in remotely on a brand-new device
// while it's active. Always has an expiry (max 12h) so it can't be left
// on by accident. Trusted Devices already covers returning devices
// without needing this at all.
function renderOutageModeStatus(settings) {
  const box = document.getElementById("sa-outage-mode-status");
  const active = settings.outage_mode_active && settings.outage_mode_expires_at && new Date(settings.outage_mode_expires_at) > new Date();
  if (active) {
    box.innerHTML = `⚠️ <strong>Outage Mode is ACTIVE</strong> — activated by ${settings.outage_mode_activated_by || 'unknown'} at ${new Date(settings.outage_mode_started_at).toLocaleString()}, expires ${new Date(settings.outage_mode_expires_at).toLocaleString()}.
      <button class="nav-btn-styled" style="margin-left:10px; padding:4px 12px; font-size:0.78rem;" onclick="deactivateOutageModeNow()">Deactivate Now</button>`;
    box.style.background = '#fef3c7'; box.style.borderLeftColor = '#f59e0b'; box.style.color = '#78350f';
  } else {
    box.innerHTML = `Outage Mode is off. Only use this for a confirmed office network/power outage — Trusted Devices already covers returning staff on their own devices without it.
      <div style="margin-top:10px; display:flex; gap:10px; align-items:center;">
        <label style="font-size:0.8rem;">Duration (hours):</label>
        <input type="number" id="sa-outage-hours" value="4" min="0.5" max="12" step="0.5" style="width:80px;">
        <button class="nav-btn-styled" style="padding:6px 14px;" onclick="activateOutageModeNow()">Activate Outage Mode</button>
      </div>`;
    box.style.background = 'var(--highlight-bg)'; box.style.borderLeftColor = 'var(--brand)'; box.style.color = 'var(--text)';
  }
}

async function activateOutageModeNow() {
  const hours = parseFloat(document.getElementById("sa-outage-hours").value) || 4;
  if (!confirm(`Activate Outage Mode for ${hours} hour(s)? Any user who has logged in from the office before will be able to sign in remotely until it expires.`)) return;
  try {
    const data = await apFetch({ action: "activateOutageMode", hours });
    if (data.success) { showBOQBanner("sa-feedback", "Outage Mode activated.", "success"); loadSecuritySettings(); }
    else showBOQBanner("sa-feedback", data.error || "Failed to activate.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

async function deactivateOutageModeNow() {
  try {
    const data = await apFetch({ action: "deactivateOutageMode" });
    if (data.success) { showBOQBanner("sa-feedback", "Outage Mode deactivated.", "success"); loadSecuritySettings(); }
    else showBOQBanner("sa-feedback", data.error || "Failed to deactivate.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}
