// marketing/company-duplicates.js — admin "Duplicate Companies" tool on
// Search by Company Name (10 Oct 2026). Lists companies that look like the
// same company written differently and merges them. Backend:
// routes/companyMatch.js (fetchDuplicateCompanies / mergeCompanies).

function cdupIsAdmin() {
  return localStorage.getItem("isUserAdminGlobal") === "true" || localStorage.getItem("erpIsUserAdminGlobal") === "true";
}

function cdupInitPanel() {
  const wrap = document.getElementById("cdup-admin-wrap");
  if (!wrap) return;
  wrap.style.display = cdupIsAdmin() ? "" : "none";
  const out = document.getElementById("cdup-output");
  if (out) { out.innerHTML = ""; out.style.display = "none"; }
  const btn = document.getElementById("cdup-toggle-btn");
  if (btn) btn.textContent = "Find Duplicate Companies";
}

async function cdupToggle() {
  const out = document.getElementById("cdup-output");
  const btn = document.getElementById("cdup-toggle-btn");
  if (out.style.display !== "none") { out.style.display = "none"; out.innerHTML = ""; btn.textContent = "Find Duplicate Companies"; return; }
  out.style.display = "";
  btn.textContent = "Hide Duplicate Companies";
  await cdupLoad();
}

async function cdupLoad() {
  const out = document.getElementById("cdup-output");
  out.innerHTML = `<div style="color:var(--muted); padding:8px 0;">Looking for duplicates...</div>`;
  try {
    const data = await apFetch({ action: "fetchDuplicateCompanies" });
    if (!data.success) { out.innerHTML = `<div style="color:var(--warn); font-weight:700;">${escapeHtml(data.error || "Could not load.")}</div>`; return; }
    if (!data.groups.length) { out.innerHTML = `<div style="color:#15803d; font-weight:700; padding:8px 0;">No duplicate companies found.</div>`; return; }
    out.innerHTML = `<div style="font-size:0.85rem; color:var(--muted); margin:8px 0;">${data.groups.length} group(s). In each group pick the company to <strong>keep</strong>; Merge moves the other's leads, contacts and tasks onto it and deletes the other. Its name is remembered so future emails match automatically.</div>` +
      data.groups.map((g, gi) => cdupGroupHtml(g, gi)).join("");
  } catch (e) {
    if (e.message !== "SESSION_EXPIRED") out.innerHTML = `<div style="color:var(--warn); font-weight:700;">${escapeHtml(e.message)}</div>`;
  }
}

function cdupGroupHtml(g, gi) {
  const rows = g.companies.map((c, ci) => `
    <label style="display:flex; align-items:center; gap:10px; padding:6px 8px; border-bottom:1px solid var(--border); cursor:pointer;">
      <input type="radio" name="cdup-keep-${gi}" value="${escapeHtml(c.company_id)}" ${ci === 0 ? "checked" : ""} style="width:auto;">
      <span style="flex:1;"><strong>${escapeHtml(c.company_name)}</strong>
        <span style="color:var(--muted); font-size:0.78rem;"> ${escapeHtml(c.company_id)}${c.city ? " · " + escapeHtml(c.city) : ""}${c.state ? ", " + escapeHtml(c.state) : ""}</span></span>
      <span style="font-size:0.78rem; color:var(--muted);">${c.lead_count} lead(s)</span>
    </label>`).join("");
  return `<div id="cdup-group-${gi}" style="border:2px solid #94a3b8; border-radius:8px; margin:10px 0; background:#fff; overflow:hidden;">
    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:${g.kind === "same" ? "#fef3c7" : "#eef2ff"};">
      <span style="font-size:0.78rem; font-weight:800; text-transform:uppercase; color:#334155;">${g.kind === "same" ? "Same name, written differently" : "Very similar names, check carefully"}</span>
      <button type="button" class="nav-btn-styled" style="width:auto; padding:4px 14px; font-size:0.8rem;" onclick="cdupMergeGroup(${gi})">Merge into selected</button>
    </div>
    ${rows}
  </div>`;
}

async function cdupMergeGroup(gi) {
  const box = document.getElementById(`cdup-group-${gi}`);
  const radios = Array.from(box.querySelectorAll(`input[name="cdup-keep-${gi}"]`));
  const keep = radios.find(r => r.checked);
  if (!keep) return;
  const others = radios.filter(r => r !== keep).map(r => r.value);
  const keepName = keep.closest("label").querySelector("strong").textContent;
  const otherNames = radios.filter(r => r !== keep).map(r => r.closest("label").querySelector("strong").textContent);
  if (!await abpsConfirm(`Keep "${keepName}" and merge into it:\n\n${otherNames.join("\n")}\n\nTheir leads, contacts and tasks move to "${keepName}" and the others are deleted. This cannot be undone.`,
    { title: "Merge companies", okLabel: "Merge", cancelLabel: "Cancel" })) return;
  box.style.opacity = "0.5";
  try {
    for (const src of others) {
      const r = await apFetch({ action: "mergeCompanies", sourceCompanyId: src, targetCompanyId: keep.value });
      if (!r.success) { alert(r.error || "Merge failed."); box.style.opacity = "1"; return; }
    }
    box.innerHTML = `<div style="padding:8px 10px; color:#15803d; font-weight:700;">Merged into "${escapeHtml(keepName)}".</div>`;
    box.style.opacity = "1";
  } catch (e) {
    box.style.opacity = "1";
    if (e.message !== "SESSION_EXPIRED") alert(e.message);
  }
}
