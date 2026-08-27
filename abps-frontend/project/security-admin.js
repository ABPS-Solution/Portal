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
  selectPinTreeMode('changepin'); // sets the mode-button active styling; re-render is harmless, data's already loaded
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

// ── Login Anywhere — presented as a department family tree ──────────────
// Deliberately built from saAllUsers fresh on every load (fetchAdminUserList
// -> live admin_db.users/departments), never a hardcoded department or
// person list — a new person added via the Users Sheet, in ANY department,
// shows up here automatically the next time this tab loads. Adding a new
// admin_db.departments row (see the DEPARTMENT ORDER note below) is the
// only case that needs a one-line update here.
//
// DEPARTMENT ORDER (26 Aug 2026) — matches admin_db.departments exactly,
// including 'Project' and 'Accounts', added as real assignable departments
// specifically so this tree could include them (they didn't exist before).
// Colors are distinct from each other on purpose (unlike the 7-department
// Permissions Matrix, which reuses Project's blue for Design, ALL NINE of
// these render side-by-side at once here so every color must be tellable
// apart from its neighbors).
const LA_DEPARTMENTS = [
  { name: 'Admin', color: '#1e293b' },
  { name: 'Marketing', color: '#be185d' },
  { name: 'Project', color: '#2563eb' },
  { name: 'Design', color: '#4338ca' },
  { name: 'Purchase', color: '#7c3aed' },
  { name: 'Store', color: '#0369a1' },
  { name: 'Production', color: '#b45309' },
  { name: 'Quality Assurance', color: '#dc2626' },
  { name: 'Accounts', color: '#0f766e' },
];

async function loadSecurityAdminUsers() {
  try {
    const data = await apFetch({ action: "fetchAdminUserList" });
    if (data.success) {
      saAllUsers = data.users;
      renderSecurityAdminUsers();
    }
  } catch (e) { console.error("loadSecurityAdminUsers failed:", e); }
}

function laPersonButtonHtml(u, color) {
  const granted = !!u.perm_login_anywhere;
  const border = granted ? `3px solid #0f172a` : `1.5px solid #dde3ea`;
  return `
    <div style="display:flex; flex-direction:column; align-items:center;">
      <div style="width:2px; height:20px; background:${color};"></div>
      <div style="width:7px; height:7px; border-radius:50%; background:${color}; margin-bottom:-1px;"></div>
      <button onclick="handleLoginAnywhereButtonClick('${u.email}')"
        title="${granted ? 'Click to revoke' : 'Click to grant'} Login Anywhere access"
        style="border:${border}; background:#fff; border-radius:12px; padding:13px 22px; cursor:pointer;
               font-weight:${granted ? 800 : 650}; font-size:0.92rem; color:#1e293b; white-space:nowrap;
               box-shadow:0 1px 3px rgba(15,23,42,0.08); transition:transform 0.12s, box-shadow 0.12s;"
        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 14px rgba(15,23,42,0.14)';"
        onmouseout="this.style.transform=''; this.style.boxShadow='0 1px 3px rgba(15,23,42,0.08)';">
        ${u.first_name || ''} ${u.last_name || ''}
      </button>
    </div>`;
}

function renderSecurityAdminUsers() {
  const q = (document.getElementById("sa-user-search").value || "").toLowerCase().trim();
  const root = document.getElementById("sa-user-tree-root");
  if (!root) return;

  const branches = LA_DEPARTMENTS.map(dept => {
    const people = saAllUsers.filter(u => (u.department || '') === dept.name && (!q ||
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(q)));
    if (q && people.length === 0) return ''; // hide whole branch while searching with no match
    return `
      <div style="margin-bottom:44px;">
        <div style="display:flex; align-items:center; justify-content:center; gap:10px; padding-bottom:12px;">
          <span style="font-weight:800; font-size:1.15rem; letter-spacing:0.3px; color:${dept.color};">${dept.name}</span>
          ${people.length > 0 ? `<span style="background:${dept.color}1a; color:${dept.color}; font-size:0.72rem; font-weight:800; padding:2px 9px; border-radius:999px;">${people.length}</span>` : ''}
        </div>
        <div style="height:3px; width:100%; border-radius:2px; background:${dept.color};"></div>
        ${people.length === 0
          ? `<div style="text-align:center; color:var(--muted); font-size:0.82rem; padding:16px 0 0;">No one in this department yet.</div>`
          : `<div style="display:flex; flex-wrap:wrap; justify-content:center; gap:26px 22px; width:100%; padding-top:4px;">
               ${people.map(u => laPersonButtonHtml(u, dept.color)).join('')}
             </div>`}
      </div>`;
  }).join('');

  root.innerHTML = `
    <div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:32px clamp(16px, 4vw, 48px); width:100%; box-sizing:border-box;">
      ${branches || `<div style="text-align:center; color:var(--muted); padding:20px;">No users found.</div>`}
    </div>`;
}

async function handleLoginAnywhereButtonClick(email) {
  const u = saAllUsers.find(x => x.email === email);
  if (!u) return;
  await toggleUserLoginAnywhere(email, !u.perm_login_anywhere);
}

async function toggleUserLoginAnywhere(email, enabled) {
  try {
    const data = await apFetch({ action: "setUserLoginAnywhere", email, enabled });
    if (data.success) {
      const named = saAllUsers.find(x => x.email === email);
      const displayLabel = named ? `${named.first_name || ''} ${named.last_name || ''}`.trim() : email;
      showBOQBanner("sa-feedback", `${enabled ? 'Enabled' : 'Disabled'} Login Anywhere for ${displayLabel}.`, "success");
      const u = saAllUsers.find(x => x.email === email);
      if (u) u.perm_login_anywhere = enabled;
      renderSecurityAdminUsers();
    } else {
      showBOQBanner("sa-feedback", data.error || "Failed to update.", "error");
      renderSecurityAdminUsers(); // revert the button to server state
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

// Flip-card tree (26 Aug 2026) — same department-tree shape/colors as
// Login Anywhere, minus the thick-border "granted" styling (a PIN's
// state is shown on the card's back face, not via border weight). Each
// card starts showing the person's name; clicking flips it to reveal
// either their PIN (pinTreeMode 'pin', instant, data already loaded) or
// a freshly generated enrollment code (pinTreeMode 'enroll', one network
// call per flip — no cooldown server-side, so generating for several
// people back-to-back is fine). Clicking again flips back to the name.
let pinTreeMode = 'pin';
let pinFlippedState = {}; // email -> true while showing the back face
let pinEnrollCodeCache = {}; // email -> last-generated {code, expiresAt} for redisplay without re-hitting the API mid-flip-animation
let pinChangeEditingState = {}; // email -> true while its Change PIN card has an open edit input (suppresses hover-driven flip-back)

function showPinChangeBanner(msg, isError) {
  const box = document.getElementById("sa-pin-change-banner");
  if (!box) return;
  box.textContent = msg;
  box.style.background = isError ? '#fef2f2' : '#dcfce7';
  box.style.color = isError ? '#991b1b' : '#166534';
  box.style.display = 'block';
  setTimeout(() => { box.style.display = 'none'; }, 3000);
}

function selectPinTreeMode(mode) {
  pinTreeMode = mode;
  pinFlippedState = {}; // switching modes always resets every card to its front face
  pinChangeEditingState = {};
  ['changepin', 'enroll'].forEach(m => {
    const btn = document.getElementById(`pinmode-btn-${m}`);
    if (!btn) return;
    btn.style.background = (m === mode) ? 'var(--brand)' : '#e2e8f0';
    btn.style.color = (m === mode) ? '#fff' : '#334155';
  });
  renderSecurityAdminPinUsers();
}

async function loadSecurityAdminPinUsers() {
  try {
    const data = await apFetch({ action: "fetchPinUsers" });
    if (data.success) { saAllPinUsers = data.users; renderSecurityAdminPinUsers(); }
  } catch (e) { console.error("loadSecurityAdminPinUsers failed:", e); }
}

function pinLockBadgeHtml(u) {
  if (u.pin_disabled) {
    return `<div style="font-size:0.68rem; color:#dc2626; font-weight:700; margin-top:4px;">Disabled (too many fails) — <a href="#" onclick="submitClearUserPinLockout('${u.email}'); return false;" style="color:#dc2626;">Unlock</a></div>`;
  }
  if (u.pin_locked_until && new Date(u.pin_locked_until) > new Date()) {
    const until = new Date(u.pin_locked_until).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `<div style="font-size:0.68rem; color:#d97706; font-weight:700; margin-top:4px;">Locked until ${until} — <a href="#" onclick="submitClearUserPinLockout('${u.email}'); return false;" style="color:#d97706;">Unlock</a></div>`;
  }
  return '';
}

function pinFlipCardHtml(u, color) {
  const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  const safeId = u.email.replace(/[^a-zA-Z0-9]/g, '_');
  const flipped = !!pinFlippedState[u.email];
  const cached = pinEnrollCodeCache[u.email];
  const isChangeMode = pinTreeMode === 'changepin';
  const backText = pinTreeMode === 'enroll'
    ? (cached ? cached.code : '…')
    : (u.pin_value || 'None');
  const backIsCode = pinTreeMode === 'enroll';
  const outerHandlers = isChangeMode
    ? `onmouseenter="handleChangePinHover('${u.email}', true)" onmouseleave="handleChangePinHover('${u.email}', false)"`
    : `onclick="handlePinFlipClick('${u.email}')"`;
  const backOnClick = isChangeMode ? ` onclick="handleChangePinBackClick('${u.email}'); event.stopPropagation();"` : '';
  return `
    <div style="display:flex; flex-direction:column; align-items:center;">
      <div style="width:2px; height:20px; background:${color};"></div>
      <div style="width:7px; height:7px; border-radius:50%; background:${color}; margin-bottom:-1px;"></div>
      <div id="pinflip-outer-${safeId}" ${outerHandlers}
        style="width:180px; height:52px; perspective:800px; cursor:pointer;">
        <div id="pinflip-inner-${safeId}" style="position:relative; width:100%; height:100%; transition:transform 0.5s; transform-style:preserve-3d; transform:${flipped ? 'rotateY(180deg)' : 'rotateY(0deg)'};">
          <div style="position:absolute; inset:0; backface-visibility:hidden; display:flex; align-items:center; justify-content:center; text-align:center; padding:0 10px;
                      border:1.5px solid #dde3ea; border-radius:12px; background:#fff; box-shadow:0 1px 3px rgba(15,23,42,0.08); font-weight:650; font-size:0.88rem; color:#1e293b;">
            ${name}
          </div>
          <div id="pinflip-back-${safeId}"${backOnClick} style="position:absolute; inset:0; backface-visibility:hidden; transform:rotateY(180deg); display:flex; align-items:center; justify-content:center; text-align:center; padding:0 8px;
                      border:1.5px solid ${color}; border-radius:12px; background:${color}14; font-weight:800; font-size:${backIsCode ? '1.02rem' : '1.05rem'}; color:#0f172a; font-family:${backIsCode || u.pin_value ? 'monospace' : 'inherit'}; letter-spacing:${backIsCode || u.pin_value ? '2px' : 'normal'};">
            ${backText}
          </div>
        </div>
      </div>
      ${pinLockBadgeHtml(u)}
    </div>`;
}

async function handlePinFlipClick(email) {
  const u = saAllPinUsers.find(x => x.email === email);
  if (!u) return;
  const safeId = email.replace(/[^a-zA-Z0-9]/g, '_');
  const nowFlipped = !pinFlippedState[email];

  // Flipping TO the back face in enroll mode: fetch a fresh code first so
  // the reveal shows a real value instead of a placeholder mid-animation.
  if (nowFlipped && pinTreeMode === 'enroll') {
    try {
      const data = await apFetch({ action: "createDeviceEnrollmentCode", targetEmail: email });
      if (!data.success) { showBOQBanner("sa-feedback", data.error || "Failed to generate code.", "error"); return; }
      pinEnrollCodeCache[email] = { code: data.code, expiresAt: data.expiresAt };
      const backEl = document.getElementById(`pinflip-back-${safeId}`);
      if (backEl) backEl.textContent = data.code;
    } catch (e) {
      showBOQBanner("sa-feedback", "Connection error: " + e.message, "error");
      return;
    }
  }

  pinFlippedState[email] = nowFlipped;
  const inner = document.getElementById(`pinflip-inner-${safeId}`);
  if (inner) inner.style.transform = nowFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
}

// ── Change PIN mode ───────────────────────────────────────────────────
// Hover flips the card to show the current PIN (view-only); clicking
// that revealed PIN swaps it for an editable input. Typing a new
// 4-digit PIN auto-submits (same convention as the login screen's PIN
// field) straight to adminResetUserPin, which invalidates every session
// for that person server-side — this IS the "reset someone's PIN" flow.
function handleChangePinHover(email, entering) {
  if (pinChangeEditingState[email]) return; // an edit is in progress — hover must not interrupt it
  const safeId = email.replace(/[^a-zA-Z0-9]/g, '_');
  const inner = document.getElementById(`pinflip-inner-${safeId}`);
  if (inner) inner.style.transform = entering ? 'rotateY(180deg)' : 'rotateY(0deg)';
}

function handleChangePinBackClick(email) {
  if (pinChangeEditingState[email]) return; // already editing
  pinChangeEditingState[email] = true;
  const safeId = email.replace(/[^a-zA-Z0-9]/g, '_');
  const backEl = document.getElementById(`pinflip-back-${safeId}`);
  if (!backEl) return;
  backEl.innerHTML = `<input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"
    id="pinchange-input-${safeId}" style="width:80px; text-align:center; font-weight:800; font-size:1.05rem; letter-spacing:4px; font-family:monospace; border:1.5px solid #cbd5e1; border-radius:6px; padding:4px;"
    oninput="handleChangePinInputTyping('${email}', this)" onclick="event.stopPropagation();">`;
  const input = document.getElementById(`pinchange-input-${safeId}`);
  if (input) input.focus();
}

function handleChangePinInputTyping(email, inputEl) {
  const digitsOnly = inputEl.value.replace(/\D/g, '').slice(0, 4);
  if (inputEl.value !== digitsOnly) inputEl.value = digitsOnly;
  if (digitsOnly.length === 4) submitAdminResetPin(email, digitsOnly);
}

async function submitAdminResetPin(email, newPin) {
  const safeId = email.replace(/[^a-zA-Z0-9]/g, '_');
  const input = document.getElementById(`pinchange-input-${safeId}`);
  if (input) input.disabled = true;
  try {
    const data = await apFetch({ action: "adminResetUserPin", email, newPin });
    const u = saAllPinUsers.find(x => x.email === email);
    if (data.success) {
      if (u) u.pin_value = newPin;
      const displayName = u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : email;
      showPinChangeBanner(`PIN updated for ${displayName}. They're signed out everywhere and must use the new PIN.`, false);
      const backEl = document.getElementById(`pinflip-back-${safeId}`);
      if (backEl) {
        backEl.innerHTML = newPin;
      }
      pinChangeEditingState[email] = false;
      const inner = document.getElementById(`pinflip-inner-${safeId}`);
      if (inner) inner.style.transform = 'rotateY(0deg)';
    } else {
      showPinChangeBanner(data.error || "Failed to update PIN.", true);
      if (input) { input.disabled = false; input.value = ''; input.focus(); }
    }
  } catch (e) {
    showPinChangeBanner("Connection error: " + e.message, true);
    if (input) { input.disabled = false; input.value = ''; input.focus(); }
  }
}

function renderSecurityAdminPinUsers() {
  const q = (document.getElementById("sa-pin-user-search").value || "").toLowerCase().trim();
  const root = document.getElementById("sa-pin-tree-root");
  if (!root) return;

  const branches = LA_DEPARTMENTS.map(dept => {
    const people = saAllPinUsers.filter(u => (u.department || '') === dept.name && (!q ||
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(q)));
    if (q && people.length === 0) return '';
    return `
      <div style="margin-bottom:44px;">
        <div style="display:flex; align-items:center; justify-content:center; gap:10px; padding-bottom:12px;">
          <span style="font-weight:800; font-size:1.15rem; letter-spacing:0.3px; color:${dept.color};">${dept.name}</span>
          ${people.length > 0 ? `<span style="background:${dept.color}1a; color:${dept.color}; font-size:0.72rem; font-weight:800; padding:2px 9px; border-radius:999px;">${people.length}</span>` : ''}
        </div>
        <div style="height:3px; width:100%; border-radius:2px; background:${dept.color};"></div>
        ${people.length === 0
          ? `<div style="text-align:center; color:var(--muted); font-size:0.82rem; padding:16px 0 0;">No one in this department yet.</div>`
          : `<div style="display:flex; flex-wrap:wrap; justify-content:center; gap:26px 22px; width:100%; padding-top:4px;">
               ${people.map(u => pinFlipCardHtml(u, dept.color)).join('')}
             </div>`}
      </div>`;
  }).join('');

  root.innerHTML = `
    <div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:32px clamp(16px, 4vw, 48px); width:100%; box-sizing:border-box;">
      ${branches || `<div style="text-align:center; color:var(--muted); padding:20px;">No users found.</div>`}
    </div>`;
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

function pmPillHtml(perm, color) {
  const enabled = !!pmUserValues[perm.dbColumn];
  const isDashboard = (perm.department || '').startsWith('dashboard-');
  const label = isDashboard ? `📊 ${perm.label}` : perm.label;
  // Text is always black; only the background carries the department
  // color, and only once the person actually has access (26 Aug 2026).
  // A light tint (not the solid color) keeps black text readable against
  // every department's color, including the darker ones.
  const style = enabled
    ? `background:${color}26; border:1.5px solid ${color}; color:#0f172a; font-weight:700;`
    : `background:#f1f5f9; border:1.5px solid #cbd5e1; color:#0f172a; font-weight:600;`;
  return `<button onclick="togglePermissionMatrixPill('${perm.dbColumn}')"
      style="${style} padding:8px 16px; border-radius:999px; font-size:0.92rem; cursor:pointer; transition:all 0.12s;">${label}</button>`;
}

function renderPermissionMatrix() {
  const root = document.getElementById("pm-matrix-root");
  if (!pmSelectedUser) { root.innerHTML = ""; return; }

  const cards = PM_CARD_ORDER.map(card => {
    const perms = pmCatalog.filter(p => p.department === card.key || p.department === `dashboard-${card.key}`);
    if (perms.length === 0) return '';
    // Group into sub-rows (row 0 = Dashboard, always its own row; the
    // rest mirror that department's real sec-label groupings in
    // index.html — see lib/permissionCatalog.js's header comment).
    const rowNumbers = [...new Set(perms.map(p => p.row))].sort((a, b) => a - b);
    const rowsHtml = rowNumbers.map(rowNum => {
      const rowPerms = perms.filter(p => p.row === rowNum);
      const rowLabel = rowPerms[0].rowLabel;
      return `
        <div style="margin-bottom:10px;">
          ${rowLabel ? `<div style="font-size:0.8rem; font-weight:800; text-transform:uppercase; letter-spacing:0.4px; color:var(--muted); margin-bottom:6px;">${rowLabel}</div>` : ''}
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${rowPerms.map(p => pmPillHtml(p, card.color)).join('')}
          </div>
        </div>`;
    }).join('');
    return `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; margin-bottom:14px;">
        <div style="display:flex; align-items:center; gap:10px; padding:10px 16px; background:${card.color}0f; border-bottom:1px solid var(--border);">
          <div style="width:5px; height:18px; border-radius:2px; background:${card.color};"></div>
          <span style="font-weight:800; color:${card.color}; font-size:1.15rem;">${card.label}</span>
        </div>
        <div style="padding:14px 16px;">
          ${rowsHtml}
        </div>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div style="font-weight:700; font-size:1.1rem; margin-bottom:14px;">
      Editing access for: ${pmSelectedUser.first_name || ''} ${pmSelectedUser.last_name || ''}
      <span style="color:var(--muted); font-weight:500; font-size:0.95rem;"> (${pmSelectedUser.department || 'No department'})</span>
    </div>
    ${cards}`;
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
