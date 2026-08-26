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
let saAllLoginLogEntries = [];

async function initializeSecurityAdminPanel() {
  switchSecurityAdminTab('permissions');
  await Promise.all([
    loadSecurityAdminUsers(),
    loadAllowedNetworks(),
    loadTrustedDevices(),
    loadLoginLog(),
    loadSecuritySettings(),
    loadSecurityAdminPinUsers(),
    loadRegisteredDevices(),
    loadPermissionCatalog(),
  ]);
}

function exitSecurityAdminBackToMenu() {
  document.getElementById("canvas-module-security-admin").style.display = "none";
  enforceDynamicModuleRoleGateways(userPermissions);
  document.getElementById("dashboard-view").style.display = "flex";
}

function switchSecurityAdminTab(tab) {
  ['permissions', 'users', 'networks', 'devices', 'log', 'settings', 'pins', 'registeredpcs'].forEach(t => {
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
        <td style="padding:8px;"><button class="nav-btn-styled" style="padding:4px 10px; font-size:0.78rem;" onclick="submitDeleteTrustedDevice(${d.device_id})">Delete</button></td>
      </tr>`).join('') || `<tr><td colspan="7" style="padding:14px; text-align:center; color:var(--muted);">No trusted devices yet.</td></tr>`;
  } catch (e) { console.error("loadTrustedDevices failed:", e); }
}

async function submitDeleteTrustedDevice(deviceId) {
  if (!confirm("Delete this trusted device? It will need to log in from the office network again to be trusted.")) return;
  try {
    const data = await apFetch({ action: "deleteTrustedDevice", deviceId });
    if (data.success) { showBOQBanner("sa-feedback", "Trusted device deleted.", "success"); loadTrustedDevices(); }
    else showBOQBanner("sa-feedback", data.error || "Failed to delete.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

// ── Login Log ─────────────────────────────────────────────────────────
async function loadLoginLog() {
  try {
    const data = await apFetch({ action: "fetchLoginLog" });
    if (!data.success) return;
    saAllLoginLogEntries = data.entries;
    renderLoginLog();
  } catch (e) { console.error("loadLoginLog failed:", e); }
}

function renderLoginLog() {
  const q = (document.getElementById("sa-log-search").value || "").toLowerCase().trim();
  const tbody = document.getElementById("sa-log-list-body");
  const filtered = saAllLoginLogEntries.filter(l => !q || (l.user_name || "").toLowerCase().includes(q));
  tbody.innerHTML = filtered.map(l => `
      <tr style="border-top:1px solid var(--border); ${l.allowed ? '' : 'background:#fef2f2;'}">
        <td style="padding:8px; white-space:nowrap;">${formatDateTimeDMY(l.created_at)}</td>
        <td style="padding:8px;">${l.user_name || '—'}</td>
        <td style="padding:8px; font-family:monospace;">${l.ip || '—'}</td>
        <td style="padding:8px; font-weight:700; color:${l.allowed ? '#16a34a' : '#dc2626'};">${l.allowed ? 'Allowed' : 'Blocked'}</td>
        <td style="padding:8px;">${l.reason}</td>
        <td style="padding:8px;">${l.city ? `${l.city}, ` : ''}${l.country || '—'}</td>
        <td style="padding:8px;">${l.isp_asn || '—'}</td>
        <td style="padding:8px;">${l.is_vpn ? '⚠️ Yes' : 'No'}</td>
      </tr>`).join('') || `<tr><td colspan="8" style="padding:14px; text-align:center; color:var(--muted);">No login attempts recorded yet.</td></tr>`;
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

// ── Registered Devices (migration 140) ───────────────────────────────────
// A registered device (laptop, phone, tablet) is how PIN login becomes
// possible at all — an admin generates a one-time code here, the operator
// enters it once on that device (no OAuth redirect, unlike the Gmail
// connection flow), and only the users explicitly listed here may then
// PIN-login on it.
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
  if (!confirm("Delete this device? No one will be able to PIN-login on it until it's re-enrolled with a new code.")) return;
  try {
    const data = await apFetch({ action: "deleteRegisteredDevice", deviceId });
    if (data.success) { showBOQBanner("sa-feedback", "Device deleted.", "success"); loadRegisteredDevices(); }
    else showBOQBanner("sa-feedback", data.error || "Failed to delete.", "error");
  } catch (e) {
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}

// ── Permissions Matrix (26 Aug 2026) ──────────────────────────────────────
// A visual, per-user, department-colored view over every real perm_*
// column on admin_db.users — "a glorified Users Sheet for section access".
// pmCatalog is fetched once (it's effectively static config); pmUserValues
// is refetched per selected user. Card grouping/colors are defined here in
// parallel with lib/permissionCatalog.js's DEPARTMENT_META on the backend
// (same 7 departments, same colors, same dept-tabs-bar accents) — adding a
// NEW permission to an EXISTING department needs only one line in
// permissionCatalog.js and it appears here automatically; adding a whole
// new department needs one more entry in PM_CARD_ORDER below too.
const PM_CARD_ORDER = [
  { key: 'marketing', label: 'Marketing', color: '#be185d' },
  { key: 'project', label: 'Project', color: '#2563eb' },
  { key: 'design', label: 'Design', color: '#2563eb' },
  { key: 'purchase', label: 'Purchase', color: '#7c3aed' },
  { key: 'store', label: 'Store', color: '#0369a1' },
  { key: 'production', label: 'Production', color: '#b45309' },
  { key: 'accounts', label: 'Accounts', color: '#0f766e' },
];
const PM_SYSTEM_COLOR = '#334155';

let pmCatalog = [];
let pmSelectedUser = null;
let pmUserValues = {};

async function loadPermissionCatalog() {
  try {
    const data = await apFetch({ action: "fetchPermissionCatalog" });
    if (data.success) pmCatalog = data.catalog;
  } catch (e) { console.error("loadPermissionCatalog failed:", e); }
}

function handlePermissionMatrixSearchInput(rawQuery) {
  const q = (rawQuery || "").toLowerCase().trim();
  const box = document.getElementById("pm-user-search-results");
  if (!q) { box.style.display = "none"; box.innerHTML = ""; return; }
  const matches = saAllUsers.filter(u => `${u.first_name} ${u.last_name}`.toLowerCase().includes(q)).slice(0, 8);
  if (matches.length === 0) {
    box.style.display = "block";
    box.innerHTML = `<div style="padding:10px; font-size:0.82rem; color:var(--muted);">No users found.</div>`;
    return;
  }
  box.style.display = "block";
  box.innerHTML = matches.map(u => `
    <div onclick="selectPermissionMatrixUser('${u.email}')" style="padding:9px 12px; cursor:pointer; border-top:1px solid var(--border); font-size:0.85rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background=''">
      <strong>${u.first_name || ''} ${u.last_name || ''}</strong>
      <span style="color:var(--muted); font-size:0.78rem;"> — ${u.department || 'No department'}</span>
    </div>`).join('');
}

async function selectPermissionMatrixUser(email) {
  const user = saAllUsers.find(u => u.email === email);
  if (!user) return;
  document.getElementById("pm-user-search").value = `${user.first_name || ''} ${user.last_name || ''}`;
  document.getElementById("pm-user-search-results").style.display = "none";
  document.getElementById("pm-matrix-root").innerHTML = `<div style="padding:20px; color:var(--muted); font-size:0.85rem;">Loading…</div>`;
  try {
    const data = await apFetch({ action: "fetchUserPermissionValues", email });
    if (!data.success) {
      document.getElementById("pm-matrix-root").innerHTML = `<div style="padding:14px; color:var(--warn);">${data.error || 'Failed to load permissions.'}</div>`;
      return;
    }
    pmSelectedUser = user;
    pmUserValues = data.values;
    renderPermissionMatrix();
  } catch (e) {
    document.getElementById("pm-matrix-root").innerHTML = `<div style="padding:14px; color:var(--warn);">Connection error: ${e.message}</div>`;
  }
}

function pmPillHtml(perm) {
  const enabled = !!pmUserValues[perm.dbColumn];
  const color = perm.systemWide ? PM_SYSTEM_COLOR : (PM_CARD_ORDER.find(c => c.key === perm.department || `dashboard-${c.key}` === perm.department) || {}).color || PM_SYSTEM_COLOR;
  const isDashboard = (perm.department || '').startsWith('dashboard-');
  const label = isDashboard ? `📊 ${perm.label}` : perm.label;
  const style = enabled
    ? `background:${color}1f; border:1.5px solid ${color}; color:${color}; font-weight:700;`
    : `background:#f1f5f9; border:1.5px solid #cbd5e1; color:#94a3b8; font-weight:600;`;
  return `<button onclick="togglePermissionMatrixPill('${perm.dbColumn}')"
      style="${style} padding:7px 14px; border-radius:999px; font-size:0.8rem; cursor:pointer; transition:all 0.12s;">${label}</button>`;
}

function renderPermissionMatrix() {
  const root = document.getElementById("pm-matrix-root");
  if (!pmSelectedUser) { root.innerHTML = ""; return; }

  const cards = PM_CARD_ORDER.map(card => {
    const pills = pmCatalog.filter(p => !p.systemWide && (p.department === card.key || p.department === `dashboard-${card.key}`));
    // Dashboard pill (if this department has one) shown first within its card.
    pills.sort((a, b) => (b.department.startsWith('dashboard-') ? 1 : 0) - (a.department.startsWith('dashboard-') ? 1 : 0));
    if (pills.length === 0) return '';
    return `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; margin-bottom:14px;">
        <div style="display:flex; align-items:center; gap:10px; padding:10px 16px; background:${card.color}0f; border-bottom:1px solid var(--border);">
          <div style="width:5px; height:18px; border-radius:2px; background:${card.color};"></div>
          <span style="font-weight:800; color:${card.color}; font-size:0.95rem;">${card.label}</span>
        </div>
        <div style="padding:14px 16px; display:flex; flex-wrap:wrap; gap:8px;">
          ${pills.map(pmPillHtml).join('')}
        </div>
      </div>`;
  }).join('');

  const systemPills = pmCatalog.filter(p => p.systemWide);
  const systemCard = systemPills.length === 0 ? '' : `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; margin-bottom:14px;">
        <div style="display:flex; align-items:center; gap:10px; padding:10px 16px; background:#33415512; border-bottom:1px solid var(--border);">
          <div style="width:5px; height:18px; border-radius:2px; background:${PM_SYSTEM_COLOR};"></div>
          <span style="font-weight:800; color:${PM_SYSTEM_COLOR}; font-size:0.95rem;">System-Wide</span>
        </div>
        <div style="padding:14px 16px; display:flex; flex-wrap:wrap; gap:8px;">
          ${systemPills.map(pmPillHtml).join('')}
        </div>
      </div>`;

  root.innerHTML = `
    <div style="font-weight:700; font-size:0.95rem; margin-bottom:14px;">
      Editing access for: ${pmSelectedUser.first_name || ''} ${pmSelectedUser.last_name || ''}
      <span style="color:var(--muted); font-weight:500; font-size:0.82rem;"> (${pmSelectedUser.department || 'No department'})</span>
    </div>
    ${cards}${systemCard}`;
}

async function togglePermissionMatrixPill(dbColumn) {
  if (!pmSelectedUser) return;
  const wasEnabled = !!pmUserValues[dbColumn];
  const enabled = !wasEnabled;
  // Optimistic update so the pill flips instantly; reverted on failure.
  pmUserValues[dbColumn] = enabled;
  renderPermissionMatrix();
  try {
    const data = await apFetch({ action: "toggleUserPermission", email: pmSelectedUser.email, dbColumn, enabled });
    if (!data.success) {
      pmUserValues[dbColumn] = wasEnabled;
      renderPermissionMatrix();
      showBOQBanner("sa-feedback", data.error || "Failed to update permission.", "error");
    }
  } catch (e) {
    pmUserValues[dbColumn] = wasEnabled;
    renderPermissionMatrix();
    showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
  }
}
