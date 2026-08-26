// ═══════════════════════════════════════════════════════════════════════
// project/security-admin.js — screen for location-restricted login
// (ABPS_SYSTEM_OVERVIEW.md §18.3, migrations 099/100): toggle Login
// Anywhere per user, manage the office IP allowlist and trusted devices,
// view the login log, edit business hours, and manually activate/
// deactivate Outage Mode. Backend: routes/security.js, gated by
// perm_security_login_access on every route (client-side gated via
// userPermissions.securityLoginAccess). perm_security_login_access itself
// (who can even open this screen) is deliberately NOT toggleable from
// here (18 Aug 2026) — it's managed only via a direct admin_db.users
// update or the Users Sheet, outside the app, since it's the permission
// that gates this exact screen.
// ═══════════════════════════════════════════════════════════════════════
let saAllUsers = [];
let saAllPinUsers = [];

async function initializeSecurityAdminPanel() {
  switchSecurityAdminTab('users');
  await Promise.all([
    loadSecurityAdminUsers(),
    loadAllowedNetworks(),
    loadTrustedDevices(),
    loadLoginLog(),
    loadSecuritySettings(),
    loadSecurityAdminPinUsers(),
    loadRegisteredDevices(),
  ]);
}

function exitSecurityAdminBackToMenu() {
  document.getElementById("canvas-module-security-admin").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function switchSecurityAdminTab(tab) {
  ['users', 'networks', 'devices', 'log', 'settings', 'pins', 'registeredpcs'].forEach(t => {
    document.getElementById(`sa-panel-${t}`).style.display = (t === tab) ? 'block' : 'none';
    document.getElementById(`sa-tab-${t}`).style.background = (t === tab) ? 'var(--brand)' : '#e2e8f0';
    document.getElementById(`sa-tab-${t}`).style.color = (t === tab) ? '#fff' : '#334155';
  });
}

// ── Login Anywhere ──────────────────────────────────────────────────────
async function loadSecurityAdminUsers() {
  try {
    const data = await apFetch({ action: "fetchAdminUserList" });
    if (data.success) {
      saAllUsers = data.users;
      renderSecurityAdminUsers();
    }
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
      <td style="padding:8px;">${u.department || '—'}</td>
      <td style="padding:8px;">${u.status}</td>
      <td style="padding:8px; text-align:center;">
        <input type="checkbox" ${u.perm_login_anywhere ? 'checked' : ''} onchange="toggleUserLoginAnywhere('${u.email}', this.checked)">
      </td>
    </tr>`).join('') || `<tr><td colspan="4" style="padding:14px; text-align:center; color:var(--muted);">No users found.</td></tr>`;
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
        <td style="padding:8px;">${d.user_name || '—'}</td>
        <td style="padding:8px; font-size:0.78rem; color:var(--muted); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${d.device_label || '—'}</td>
        <td style="padding:8px;">${formatDateDMY(d.created_at)}</td>
        <td style="padding:8px;">${d.last_used_at ? formatDateDMY(d.last_used_at) : '—'}</td>
        <td style="padding:8px;">${formatDateDMY(d.expires_at)}</td>
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
        <td style="padding:8px; white-space:nowrap;">${formatDateTimeDMY(l.created_at)}</td>
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
// confirmed office network/power outage, so ANY user can sign in remotely
// on a brand-new device while it's active (widened 24 Aug 2026 — was
// previously restricted to accounts with prior office-login history).
// Always has an expiry (max 12h) so it can't be left on by accident.
// Trusted Devices already covers returning devices without needing this.
function renderOutageModeStatus(settings) {
  const box = document.getElementById("sa-outage-mode-status");
  const active = settings.outage_mode_active && settings.outage_mode_expires_at && new Date(settings.outage_mode_expires_at) > new Date();
  if (active) {
    box.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
        <div style="line-height:1.5;">⚠️ <strong>Outage Mode is ACTIVE</strong> — activated by ${escapeHtml(settings.outage_mode_activated_by || 'unknown')} at ${formatDateTimeDMY(settings.outage_mode_started_at)}, expires ${formatDateTimeDMY(settings.outage_mode_expires_at)}.</div>
        <button class="nav-btn-styled" style="padding:6px 16px; font-size:0.8rem; flex-shrink:0; white-space:nowrap;" onclick="deactivateOutageModeNow()">Deactivate Now</button>
      </div>`;
    box.style.background = '#fef3c7'; box.style.borderLeftColor = '#f59e0b'; box.style.color = '#78350f';
  } else {
    box.innerHTML = `Outage Mode is off. Only use this for a confirmed office network/power outage — Trusted Devices already covers returning staff on their own devices without it.
      <div style="margin-top:10px; display:flex; gap:10px; align-items:center;">
        <label style="font-size:0.8rem;">Duration (hours):</label>
        <input type="number" id="sa-outage-hours" value="1" min="0.5" max="12" step="0.5" style="width:80px;">
        <button class="nav-btn-styled" style="padding:6px 14px;" onclick="activateOutageModeNow()">Activate Outage Mode</button>
      </div>`;
    box.style.background = 'var(--highlight-bg)'; box.style.borderLeftColor = 'var(--brand)'; box.style.color = 'var(--text)';
  }
}

async function activateOutageModeNow() {
  const hours = parseFloat(document.getElementById("sa-outage-hours").value) || 1;
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

// ── PIN Login (migration 140, redesigned 26 Aug 2026) ───────────────────
// View-only PIN values (confirmed design — see lib/pinAuth.js's header
// comment on reversible encryption) + a per-person "Generate Enrollment
// Code" action, which is now the ONLY way a PIN gets set or changed: the
// person redeeming the code chooses their own PIN self-service on the
// login screen. Admins can no longer type a PIN in directly here.
async function loadSecurityAdminPinUsers() {
  try {
    const data = await apFetch({ action: "fetchPinUsers" });
    if (data.success) { saAllPinUsers = data.users; renderSecurityAdminPinUsers(); }
  } catch (e) { console.error("loadSecurityAdminPinUsers failed:", e); }
}

function pinValueCell(u) {
  const lockNote = u.pin_disabled
    ? ' <span style="color:#dc2626; font-weight:700; font-size:0.72rem;">(disabled — too many fails)</span>'
    : (u.pin_locked_until && new Date(u.pin_locked_until) > new Date())
      ? ` <span style="color:#d97706; font-weight:700; font-size:0.72rem;">(locked until ${new Date(u.pin_locked_until).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})</span>`
      : '';
  const value = u.pin_value
    ? `<span style="font-family:monospace; font-weight:700; letter-spacing:2px; font-size:1.15rem;">${u.pin_value}</span>`
    : '<span style="color:var(--muted);">Not set</span>';
  return value + lockNote;
}

function renderSecurityAdminPinUsers() {
  const q = (document.getElementById("sa-pin-user-search").value || "").toLowerCase().trim();
  const tbody = document.getElementById("sa-pin-user-list-body");
  const filtered = saAllPinUsers.filter(u => !q ||
    `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
    (u.email || "").toLowerCase().includes(q));
  tbody.innerHTML = filtered.map(u => `
    <tr style="border-top:1px solid var(--border);">
      <td style="padding:8px;">${u.first_name || ''} ${u.last_name || ''}</td>
      <td style="padding:8px;">${u.department || '—'}</td>
      <td style="padding:8px;">${pinValueCell(u)}</td>
      <td style="padding:8px; display:flex; gap:6px;">
        <button class="nav-btn-styled" style="padding:4px 10px; font-size:0.78rem;" onclick="submitCreateDeviceEnrollmentCode('${u.email}')">Generate Enrollment Code</button>
        ${(u.pin_disabled || u.pin_locked_until) ? `<button class="nav-btn-styled" style="padding:4px 10px; font-size:0.78rem;" onclick="submitClearUserPinLockout('${u.email}')">Unlock</button>` : ''}
      </td>
    </tr>`).join('') || `<tr><td colspan="4" style="padding:14px; text-align:center; color:var(--muted);">No users found.</td></tr>`;
}

async function submitClearUserPinLockout(email) {
  if (!confirm(`Clear the PIN lockout for ${email}? Their existing PIN stays the same.`)) return;
  try {
    const data = await apFetch({ action: "clearUserPinLockout", email });
    if (data.success) { showBOQBanner("sa-feedback", "Lockout cleared.", "success"); loadSecurityAdminPinUsers(); }
    else showBOQBanner("sa-feedback", data.error || "Failed to clear lockout.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

async function submitCreateDeviceEnrollmentCode(targetEmail) {
  try {
    const data = await apFetch({ action: "createDeviceEnrollmentCode", targetEmail });
    if (data.success) {
      const resultBox = document.getElementById("sa-devicecode-result");
      resultBox.style.display = "block";
      resultBox.innerHTML = `
        <div style="font-weight:700; color:#15803d; margin-bottom:6px;">Enrollment code for ${targetEmail} (valid 15 minutes, single use):</div>
        <div style="font-family:monospace; font-size:1.4rem; font-weight:800; letter-spacing:3px; color:#111827;">${data.code}</div>
        <div style="font-size:0.78rem; color:var(--muted); margin-top:6px;">Give this to them — on the login screen they choose "Enrollment Code", select their own name, and enter this code to set up their PC and PIN.</div>`;
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      showBOQBanner("sa-feedback", data.error || "Failed to generate code.", "error");
    }
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

// ── Registered PCs (migration 140) ──────────────────────────────────────
// A registered PC is how PIN login becomes possible at all — an admin
// generates a one-time code here, the operator enters it once on that PC
// (no OAuth redirect, unlike the Gmail connection flow), and only the
// users explicitly listed here may then PIN-login on it.
async function loadRegisteredDevices() {
  try {
    const data = await apFetch({ action: "fetchRegisteredDevices" });
    if (data.success) renderRegisteredDevicesList(data.devices);
  } catch (e) { console.error("loadRegisteredDevices failed:", e); }
}

function renderRegisteredDevicesList(devices) {
  const tbody = document.getElementById("sa-registereddevice-list-body");
  tbody.innerHTML = devices.map(d => `
    <tr style="border-top:1px solid var(--border);">
      <td style="padding:8px;">${d.device_label}</td>
      <td style="padding:8px; font-size:0.78rem;">${(d.allowed_users || []).join(', ') || '—'}</td>
      <td style="padding:8px;">${d.status}</td>
      <td style="padding:8px;">${formatDateDMY(d.created_at)}</td>
      <td style="padding:8px;">${d.last_used_at ? formatDateDMY(d.last_used_at) : '—'}</td>
      <td style="padding:8px;"><button class="nav-btn-styled" style="padding:4px 10px; font-size:0.78rem;" onclick="submitDeleteRegisteredDevice(${d.device_id})">Delete</button></td>
    </tr>`).join('') || `<tr><td colspan="6" style="padding:14px; text-align:center; color:var(--muted);">No PCs registered yet.</td></tr>`;
}

async function submitDeleteRegisteredDevice(deviceId) {
  if (!confirm("Delete this PC? No one will be able to PIN-login on it until it's re-enrolled with a new code.")) return;
  try {
    const data = await apFetch({ action: "deleteRegisteredDevice", deviceId });
    if (data.success) { showBOQBanner("sa-feedback", "Device deleted.", "success"); loadRegisteredDevices(); }
    else showBOQBanner("sa-feedback", data.error || "Failed to delete.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}
