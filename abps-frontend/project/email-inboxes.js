// Security & Login Access -> Email Inboxes (23 Sep 2026, migration 216).
// Super Admin only; every route is gated perm_super_admin server-side
// (routes/emailInboxes.js). Two parts:
//  - Connected Inboxes: Gmail accounts the system polls (OAuth), and which
//    section each feeds — Leads or Customer Queries.
//  - Mailbox Directory: every address our mail arrives on (including the
//    md@abpowerindia.com sub-addresses), who it belongs to, and whether it
//    shows in this system's Leads Received through Email.

let eibConnections = [];
let eibMailboxes = [];
let eibUnlisted = [];

function eibActiveUsers() {
  return (typeof saAllUsers !== "undefined" ? saAllUsers : [])
    .filter(u => u.status === "Active")
    .map(u => ({ key: u.personKey, name: `${u.first_name || ""} ${u.last_name || ""}`.trim(), dept: u.department || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function eibUserName(key) {
  const u = eibActiveUsers().find(x => x.key === key)
    || ((typeof saAllUsers !== "undefined" ? saAllUsers : []).map(x => ({ key: x.personKey, name: `${x.first_name || ""} ${x.last_name || ""}`.trim() })).find(x => x.key === key));
  return u ? u.name : key;
}
function eibFeedback(msg, ok) {
  const el = document.getElementById("eib-feedback");
  if (!el) return;
  el.style.display = msg ? "block" : "none";
  el.style.borderLeftColor = ok ? "var(--accent)" : "var(--warn)";
  el.style.background = ok ? "#f0fdf4" : "#fef2f2";
  el.textContent = msg || "";
}

async function loadEmailInboxes() {
  const mount = document.getElementById("eib-mount");
  if (!mount) return;
  mount.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted);">Loading...</div>`;
  try {
    const data = await apFetch({ action: "fetchEmailInboxes" });
    if (!data.success) { mount.innerHTML = `<div style="padding:14px; color:var(--warn);">${escapeHtml(data.error || "Failed to load.")}</div>`; return; }
    eibConnections = data.connections || [];
    eibMailboxes = (data.mailboxes || []).map(m => ({ ...m, _dirty: false }));
    eibUnlisted = data.unlisted || [];
    eibRender();
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") mount.innerHTML = `<div style="padding:14px; color:var(--warn);">${escapeHtml(e.message)}</div>`;
  }
}

function eibCountCell(c) {
  const r = (c && c.received) || 0, l = (c && c.leads) || 0;
  return r ? `${r} received<br><span style="color:var(--muted); font-size:0.75rem;">${l} lead${l === 1 ? "" : "s"}</span>`
           : `<span style="color:var(--muted);">None</span>`;
}

const EIB_SECTION_ORDER = { "Leads": 0, "Customer Queries": 1, "Excluded": 2 };
const EIB_SECTION_SHADE = { "Leads": "#eff6ff", "Customer Queries": "#f5f3ff", "Excluded": "#f3f4f6" };
const EIB_SECTION_LABEL = {
  "Leads": "Leads Received through Email",
  "Customer Queries": "Customer Queries Received through Email",
  "Excluded": "Excluded (not in any section)",
};
function eibSectionSort(a, b, key, tieKey) {
  return ((EIB_SECTION_ORDER[a[key]] ?? 9) - (EIB_SECTION_ORDER[b[key]] ?? 9)) || String(a[tieKey]).localeCompare(String(b[tieKey]));
}

function eibRender() {
  const mount = document.getElementById("eib-mount");
  eibConnections.sort((a, b) => eibSectionSort(a, b, "feed", "email"));
  eibMailboxes.sort((a, b) => eibSectionSort(a, b, "section", "address"));
  const th = 'style="text-align:left; padding:8px; font-size:0.72rem; text-transform:uppercase; color:var(--muted); background:#f8fafc; border:1px solid var(--border);"';
  const td = 'style="padding:8px; border:1px solid var(--border); vertical-align:top; font-size:0.85rem;"';

  const connRows = eibConnections.map((c, i) => {
    const revoked = c.status !== "Active";
    const system = c.systemRoles && c.systemRoles.length;
    const action = system
      ? `<span title="Its access also powers ${escapeHtml(c.systemRoles.join(", "))} — can't be disconnected" style="font-size:0.75rem; font-weight:700; color:#92400e; background:#fef3c7; padding:3px 8px; border-radius:10px;">System account (${escapeHtml(c.systemRoles.join(", "))})</span>`
      : revoked
        ? `<span style="font-size:0.78rem; color:var(--muted);">Use Connect new inbox to reconnect</span>`
        : `<button class="nav-btn-styled" style="background:var(--warn); padding:5px 12px; font-size:0.78rem;" onclick="eibDisconnect(${i})">Disconnect</button>`;
    return `<tr style="background:${EIB_SECTION_SHADE[c.feed] || "#fff"};">
      <td ${td}><strong>${escapeHtml(c.email)}</strong></td>
      <td ${td}><select ${revoked ? "disabled" : ""} onchange="eibSetFeed(${i}, this.value)" style="width:auto; padding:5px;">
        ${["Leads", "Customer Queries", "Excluded"].map(f => `<option value="${f}" ${c.feed === f ? "selected" : ""}>${EIB_SECTION_LABEL[f]}</option>`).join("")}
      </select></td>
      <td ${td}><span style="font-weight:700; color:${revoked ? "var(--warn)" : "var(--accent)"};">${revoked ? "Disconnected" : "Connected"}</span></td>
      <td ${td}>${eibCountCell(c.last7Days)}</td>
      <td ${td}>${c.lastUsedAt ? formatOrdinalDateTime(c.lastUsedAt) : "Never"}<br><span style="color:var(--muted); font-size:0.75rem;">Connected by ${escapeHtml(c.connectedBy || "—")}</span></td>
      <td ${td}>${action}</td>
    </tr>`;
  }).join("");

  const users = eibActiveUsers();
  const mbRows = eibMailboxes.map((m, i) => {
    const chips = m.personKeys.map((k, j) => `<span style="display:inline-flex; align-items:center; gap:4px; background:var(--highlight-bg); border:1px solid var(--border); border-radius:12px; padding:2px 8px; margin:0 4px 4px 0; font-size:0.78rem;">${escapeHtml(eibUserName(k))}<span style="cursor:pointer; color:var(--warn); font-weight:700;" onclick="eibRemovePerson(${i}, ${j})">×</span></span>`).join("");
    const addOpts = users.filter(u => !m.personKeys.includes(u.key)).map(u => `<option value="${escapeHtml(u.key)}">${escapeHtml(u.name)}${u.dept ? " — " + escapeHtml(u.dept) : ""}</option>`).join("");
    return `<tr style="background:${EIB_SECTION_SHADE[m.section] || "#fff"}; ${m._dirty ? "box-shadow:inset 4px 0 0 #f59e0b;" : ""}">
      <td ${td}><strong>${escapeHtml(m.address)}</strong></td>
      <td ${td}>${chips || `<span style="color:var(--muted); font-size:0.78rem;">No one linked</span>`}
        <select onchange="eibAddPerson(${i}, this.value)" style="width:100%; padding:4px; font-size:0.78rem; margin-top:2px;"><option value="">+ Add employee</option>${addOpts}</select></td>
      <td ${td}><input type="text" value="${escapeHtml(m.note || "")}" placeholder="e.g. MD, Raipur Region" oninput="eibSetField(${i}, 'note', this.value)" style="padding:5px; font-size:0.8rem;"></td>
      <td ${td}><select onchange="eibSetField(${i}, 'section', this.value)" style="width:auto; padding:5px;">
        <option value="Leads" ${m.section === "Leads" ? "selected" : ""}>Leads Received through Email</option>
        <option value="Excluded" ${m.section === "Excluded" ? "selected" : ""}>Excluded (internal mailbox)</option>
      </select></td>
      <td ${td}><select onchange="eibSetField(${i}, 'arrivesVia', this.value)" style="width:auto; padding:5px;">
        <option value="Via md@" ${m.arrivesVia === "Via md@" ? "selected" : ""}>Copied into md@</option>
        <option value="Direct" ${m.arrivesVia === "Direct" ? "selected" : ""}>Connected directly</option>
      </select></td>
      <td ${td}><input type="checkbox" ${m.active ? "checked" : ""} onchange="eibSetField(${i}, 'active', this.checked)" style="width:18px; height:18px;"></td>
      <td ${td}>${eibCountCell(m.last7Days)}</td>
      <td ${td}><div style="display:flex; flex-direction:column; gap:4px;">
        <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem; ${m._dirty ? "" : "opacity:0.5;"}" onclick="eibSave(${i})">Save</button>
        <button class="nav-btn-styled" style="padding:5px 12px; font-size:0.78rem; background:#fff; color:var(--warn); border:1px solid var(--warn);" onclick="eibDelete(${i})">Remove</button>
      </div></td>
    </tr>`;
  }).join("");

  const unlistedHtml = eibUnlisted.length ? `
    <div style="margin-top:12px; padding:10px 12px; background:#fffbeb; border:1px solid #fde68a; border-radius:var(--radius); font-size:0.82rem;">
      <strong>Mail arrived in the last 7 days on addresses not in this directory:</strong>
      ${eibUnlisted.map(u => `<span style="display:inline-flex; align-items:center; gap:6px; margin:4px 8px 0 0;">${escapeHtml(u.address)} (${u.last7Days.received})
        <button class="nav-btn-styled" style="padding:2px 8px; font-size:0.72rem;" onclick="eibAddAddress('${escapeHtml(u.address)}')">Add</button></span>`).join("")}
    </div>` : "";

  mount.innerHTML = `
    <div style="margin-bottom:20px; padding:12px 14px; border:1px solid var(--border); border-radius:var(--radius); background:#f8fafc;">
      <h3 style="margin:0 0 4px; color:var(--brand);">Link to share</h3>
      <p style="font-size:0.8rem; color:var(--muted); margin:0 0 8px;">Send this to the person who owns a new inbox. They open it, sign in to that inbox on Google's screen and click Allow. The inbox then appears below under Excluded until you pick its section. The link works for 7 days and can be used by more than one person.</p>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <input type="text" id="eib-invite-link" readonly placeholder="Click Generate link" style="flex:1; min-width:260px; font-size:0.8rem;">
        <button class="nav-btn-styled" style="width:auto;" onclick="eibGenerateInvite()">Generate link</button>
        <button class="nav-btn-styled" style="width:auto; background:var(--accent);" onclick="eibCopyInvite()">Copy</button>
      </div>
      <div id="eib-invite-expiry" style="font-size:0.75rem; color:var(--muted); margin-top:4px;"></div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
      <h3 style="margin:0; color:var(--brand);">Connected Inboxes</h3>
      <button class="nav-btn-styled" style="background:var(--accent);" onclick="eibConnectNew()">+ Connect new inbox</button>
    </div>
    <p style="font-size:0.8rem; color:var(--muted); margin:0 0 8px;">Gmail accounts this system reads. Each one feeds one section, or none if Excluded (for test inboxes). Connecting opens Google's own permission screen: sign in as the inbox you want to add and click Allow.</p>
    <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; min-width:820px; border:1px solid var(--border);">
      <thead><tr><th ${th}>Inbox</th><th ${th}>Section</th><th ${th}>Status</th><th ${th}>Mail, last 7 days</th><th ${th}>Last checked</th><th ${th}></th></tr></thead>
      <tbody>${connRows || `<tr><td ${td} colspan="6">No inboxes connected.</td></tr>`}</tbody>
    </table></div>

    <h3 style="margin:24px 0 8px; color:var(--brand);">Mailbox Directory</h3>
    <p style="font-size:0.8rem; color:var(--muted); margin:0 0 8px;">Adding an address here does not connect it. It only tells the system who an address belongs to, for mail that already reaches a connected inbox (for example company addresses copied into md@abpowerindia.com). An inbox that is not copied into md@ must be connected with the link above. Every address our mail arrives on, including the company addresses whose mail is copied into md@abpowerindia.com. Linked employee(s) are shown on Email Leads cards and filters. Untick "Show in this system" to hide an address's mail from this system's Leads Received through Email only. The other system keeps its own setting.</p>
    <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; min-width:1100px; border:1px solid var(--border);">
      <thead><tr><th ${th}>Address</th><th ${th}>Linked employee(s)</th><th ${th}>Note</th><th ${th}>Section</th><th ${th}>Arrives</th><th ${th}>Show in this system</th><th ${th}>Mail, last 7 days</th><th ${th}></th></tr></thead>
      <tbody>${mbRows || `<tr><td ${td} colspan="8">No addresses yet.</td></tr>`}</tbody>
    </table></div>
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
      <input type="email" id="eib-new-address" placeholder="new.address@abpowerindia.com" style="max-width:320px;">
      <button class="nav-btn-styled" onclick="eibAddAddress(document.getElementById('eib-new-address').value)">+ Add address</button>
    </div>
    ${unlistedHtml}`;
}

function eibSetField(i, field, value) {
  eibMailboxes[i][field] = value;
  eibMailboxes[i]._dirty = true;
  // Only the Note box fires on every keystroke; re-rendering would steal focus.
  if (field !== "note") eibRender();
}
function eibAddPerson(i, key) {
  if (!key) return;
  if (!eibMailboxes[i].personKeys.includes(key)) eibMailboxes[i].personKeys.push(key);
  eibMailboxes[i]._dirty = true;
  eibRender();
}
function eibRemovePerson(i, j) {
  eibMailboxes[i].personKeys.splice(j, 1);
  eibMailboxes[i]._dirty = true;
  eibRender();
}
function eibAddAddress(address) {
  const a = String(address || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) return eibFeedback("Enter a valid email address.", false);
  if (eibMailboxes.some(m => m.address === a)) return eibFeedback(`${a} is already in the directory.`, false);
  eibMailboxes.push({ address: a, personKeys: [], note: "", section: "Leads",
    arrivesVia: a.endsWith("@abpowerindia.com") && a !== "md@abpowerindia.com" ? "Via md@" : "Direct",
    active: true, last7Days: (eibUnlisted.find(u => u.address === a) || {}).last7Days, _dirty: true });
  eibUnlisted = eibUnlisted.filter(u => u.address !== a);
  eibFeedback(`${a} added below. Link employee(s), then click Save on its row.`, true);
  eibRender();
}

async function eibSave(i) {
  const m = eibMailboxes[i];
  try {
    const data = await apFetch({ action: "saveEmailMailbox", address: m.address, personKeys: m.personKeys, note: m.note,
      section: m.section, arrivesVia: m.arrivesVia, active: !!m.active });
    if (!data.success) return eibFeedback(data.error || "Save failed.", false);
    eibFeedback(`Saved ${m.address}.`, true);
    await loadEmailInboxes();
  } catch (e) { if (e.message !== "SESSION_EXPIRED") eibFeedback(e.message, false); }
}
async function eibDelete(i) {
  const m = eibMailboxes[i];
  if (!confirm(`Remove ${m.address} from the directory? Mail arriving on it will no longer be recognised as ours or linked to anyone.`)) return;
  try {
    const data = await apFetch({ action: "deleteEmailMailbox", address: m.address });
    // Not saved yet — just drop it locally.
    if (!data.success && /not found/i.test(data.error || "")) { eibMailboxes.splice(i, 1); eibRender(); return; }
    if (!data.success) return eibFeedback(data.error || "Remove failed.", false);
    eibFeedback(`Removed ${m.address}.`, true);
    await loadEmailInboxes();
  } catch (e) { if (e.message !== "SESSION_EXPIRED") eibFeedback(e.message, false); }
}
async function eibSetFeed(i, feed) {
  const c = eibConnections[i];
  try {
    const data = await apFetch({ action: "setEmailInboxFeed", email: c.email, feed });
    if (!data.success) { eibFeedback(data.error || "Could not change section.", false); return loadEmailInboxes(); }
    eibFeedback(feed === "Excluded" ? `${c.email} is now excluded from every section.` : `${c.email} now feeds ${EIB_SECTION_LABEL[feed]}.`, true);
    c.feed = feed;
    eibRender();
  } catch (e) { if (e.message !== "SESSION_EXPIRED") eibFeedback(e.message, false); }
}
async function eibDisconnect(i) {
  const c = eibConnections[i];
  if (!confirm(`Disconnect ${c.email}? It will stop being read. You can reconnect it later with Connect new inbox.`)) return;
  try {
    const data = await apFetch({ action: "disconnectEmailInbox", email: c.email });
    if (!data.success) return eibFeedback(data.error || "Disconnect failed.", false);
    eibFeedback(`${c.email} disconnected.`, true);
    await loadEmailInboxes();
  } catch (e) { if (e.message !== "SESSION_EXPIRED") eibFeedback(e.message, false); }
}
async function eibConnectNew() {
  try {
    const data = await apFetch({ action: "mintGmailConnectLink" });
    if (!data.success) return eibFeedback(data.error || "Could not start the connection.", false);
    window.open(data.url, "_blank", "noopener");
    eibFeedback("Google's permission screen opened in a new tab. Sign in as the inbox to add, click Allow, then come back and reload this tab.", true);
  } catch (e) { if (e.message !== "SESSION_EXPIRED") eibFeedback(e.message, false); }
}

async function eibGenerateInvite() {
  try {
    const data = await apFetch({ action: "mintGmailInviteLink" });
    if (!data.success) return eibFeedback(data.error || "Could not create the link.", false);
    document.getElementById("eib-invite-link").value = data.url;
    document.getElementById("eib-invite-expiry").textContent = `Valid until ${formatOrdinalDateTime(new Date(data.expiresAt).toISOString())}.`;
  } catch (e) { if (e.message !== "SESSION_EXPIRED") eibFeedback(e.message, false); }
}
async function eibCopyInvite() {
  const el = document.getElementById("eib-invite-link");
  if (!el || !el.value) return eibFeedback("Generate a link first.", false);
  try { await navigator.clipboard.writeText(el.value); } catch (e) { el.select(); document.execCommand("copy"); }
  eibFeedback("Link copied.", true);
}
