// ═══════════════════════════════════════════════════════════════════════
// shared/prn-drafts.js — keep unsaved progress on the PRN and Material
// Requirement Date screens (Create / Authorize / Revise PRN, Assign /
// Revise Material Requirement Date) across Return to Main Dashboard, a
// refresh, or a dropped connection. Same storage as shared/drafts.js
// (abpsDraftSave/Read/Clear, 3-day expiry, cleared on explicit logout).
//
// What is saved: which PRN/BOQ was open, plus the typed values. Reopening
// the screen reopens that item and puts the values back. The item's own
// data is still loaded from the server, so reopening needs a connection;
// the typed values survive regardless. Each screen clears its draft on a
// successful submit.
// ═══════════════════════════════════════════════════════════════════════

const PRN_DRAFT_KEYS = {
  create: "prnCreate", authorize: "prnAuthorize", reviseDelta: "prnReviseDelta",
  reviseOther: "prnReviseOther", mrd: "mrdAssign", rmrd: "mrdRevise",
};
let prnDraftRestoring = false;
let prnDraftTimer = null;

function prnDraftVisible(el) { return !!(el && el.offsetParent !== null && el.innerHTML.trim()); }

// Table inputs rarely have ids here — they're keyed by class + data-idx.
function prnDraftCapture(zone) {
  const out = {};
  if (!zone) return out;
  zone.querySelectorAll("input, select, textarea").forEach(el => {
    if (el.type === "file") return;
    const key = el.id || (el.classList[0] && el.dataset.idx !== undefined ? `${el.classList[0]}|${el.dataset.idx}` : null);
    if (!key) return;
    out[key] = (el.type === "checkbox" || el.type === "radio") ? { c: !!el.checked } : { v: el.value };
  });
  return out;
}

function prnDraftApply(zone, fields) {
  if (!zone || !fields) return 0;
  let applied = 0;
  const find = (key) => {
    if (!key.includes("|")) return zone.querySelector(`#${CSS.escape(key)}`);
    const [cls, idx] = key.split("|");
    return zone.querySelector(`.${CSS.escape(cls)}[data-idx="${CSS.escape(idx)}"]`);
  };
  // Checkboxes first — ticking one is what enables its store-qty input.
  const entries = Object.entries(fields).sort((a, b) => ("c" in b[1]) - ("c" in a[1]));
  entries.forEach(([key, val]) => {
    const el = find(key);
    if (!el) return;
    if ("c" in val) { if (el.checked === val.c) return; el.checked = val.c; }
    else { if (el.value === val.v) return; el.value = val.v; }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    applied++;
  });
  return applied;
}

function prnDraftAutosave() {
  if (prnDraftRestoring) return;
  const createZone = document.getElementById("prn-create-zone");
  const pc = window.prnPendingCreate;
  if (pc && pc.lineItems && prnDraftVisible(createZone)) {
    abpsDraftSave(PRN_DRAFT_KEYS.create, { projectId: pc.projectId, boqId: pc.boqId, fields: prnDraftCapture(createZone) });
  }
  if (typeof aprnExpandedId !== "undefined" && aprnExpandedId) {
    const mount = document.getElementById(`aprn-rows-mount-${aprnExpandedId}`);
    if (prnDraftVisible(mount)) {
      abpsDraftSave(PRN_DRAFT_KEYS.authorize, { prnId: aprnExpandedId, kind: window.aprnKindFilter || null, fields: prnDraftCapture(mount) });
    }
  }
  const deltaZone = document.getElementById("rprn-delta-zone");
  const rpc = window.rprnPendingCreate;
  if (rpc && rpc.lineItems && prnDraftVisible(deltaZone) && deltaZone.querySelector("table")) {
    abpsDraftSave(PRN_DRAFT_KEYS.reviseDelta, { boqId: rpc.boqId, fields: prnDraftCapture(deltaZone) });
  }
  const rprnBody = document.getElementById("rprn-body");
  const rsel = document.getElementById("rprn-prn-select");
  if (window.rprnState && rsel && rsel.value && prnDraftVisible(rprnBody) && rprnBody.querySelector("table")) {
    const proj = document.getElementById("rprn-project-select-ta-input");
    abpsDraftSave(PRN_DRAFT_KEYS.reviseOther, { projectId: proj ? proj.value : "", prnId: rsel.value, fields: prnDraftCapture(rprnBody) });
  }
  if (window.mrdState) {
    const m = window.mrdState.mrd;
    const mBody = document.getElementById("mrd-body");
    if (m && m.prnId && prnDraftVisible(mBody) && mBody.querySelector(`#mrd-submit-btn`)) {
      const proj = document.getElementById("mrd-project-select-ta-input");
      abpsDraftSave(PRN_DRAFT_KEYS.mrd, { mode: "assign", projectId: proj ? proj.value : "", prnId: m.prnId, lines: m.lines });
    }
    const r = window.mrdState.rmrd;
    if (r && r.prnId) {
      const rDelta = document.getElementById("rmrd-delta-zone");
      const rBody = document.getElementById("rmrd-body");
      const inQueue = prnDraftVisible(rDelta) && rDelta.querySelector("#rmrd-submit-btn");
      const inOther = prnDraftVisible(rBody) && rBody.querySelector("#rmrd-submit-btn");
      if (inQueue || inOther) {
        const proj = document.getElementById("rmrd-project-select-ta-input");
        abpsDraftSave(PRN_DRAFT_KEYS.rmrd, { mode: inQueue ? "queue" : "other", projectId: proj ? proj.value : "", prnId: r.prnId, lines: r.lines });
      }
    }
  }
}

function prnDraftScheduleSave() {
  clearTimeout(prnDraftTimer);
  prnDraftTimer = setTimeout(prnDraftAutosave, 600);
}
["input", "change", "click"].forEach(ev => document.addEventListener(ev, prnDraftScheduleSave, true));
window.addEventListener("beforeunload", prnDraftAutosave);

// MRD: saved tranches replace the server's for the same PRN, but only in
// an editable table (a submitted, read-only view always shows the truth).
function prnDraftMrdLinesFor(ns, prnId) {
  if (prnDraftRestoring !== ns) return null;
  const d = abpsDraftRead(PRN_DRAFT_KEYS[ns]);
  return (d && d.payload.prnId === prnId) ? d.payload.lines : null;
}

function prnDraftNotice(fbId) {
  const fb = document.getElementById(fbId);
  if (!fb) return;
  fb.style.cssText = "display:block; background:#eff6ff; border-left:4px solid #2563eb; color:#1e40af; padding:10px 12px; margin-bottom:12px; border-radius:var(--radius); font-size:0.85rem; font-weight:600;";
  fb.textContent = "Your unsaved progress was restored.";
}

async function prnDraftRestore(fn) {
  try { await fn(); } catch (e) { /* restore is best-effort */ }
  finally { prnDraftRestoring = false; }
}

// ── Per-screen restore, called at the end of each panel's initializer ──

async function prnDraftRestoreCreate() {
  const d = abpsDraftRead(PRN_DRAFT_KEYS.create);
  if (!d) return;
  prnDraftRestoring = true;
  await prnDraftRestore(async () => {
    await jumpToPRNFromQueue(d.payload.projectId, d.payload.boqId, null);
    const zone = document.getElementById("prn-create-zone");
    if (!prnDraftVisible(zone) || !zone.querySelector("table")) { abpsDraftClear(PRN_DRAFT_KEYS.create); return; }
    if (prnDraftApply(zone, d.payload.fields)) prnDraftNotice("prn-feedback");
  });
}

async function prnDraftRestoreAuthorize() {
  const d = abpsDraftRead(PRN_DRAFT_KEYS.authorize);
  if (!d || (d.payload.kind || null) !== (window.aprnKindFilter || null)) return;
  if (!aprnList.some(p => p.prnId === d.payload.prnId)) { abpsDraftClear(PRN_DRAFT_KEYS.authorize); return; }
  prnDraftRestoring = true;
  await prnDraftRestore(async () => {
    toggleAPRNExpansion(d.payload.prnId);
    const mount = document.getElementById(`aprn-rows-mount-${d.payload.prnId}`);
    if (prnDraftApply(mount, d.payload.fields)) prnDraftNotice("aprn-feedback");
  });
}

async function prnDraftRestoreReviseDelta() {
  const d = abpsDraftRead(PRN_DRAFT_KEYS.reviseDelta);
  if (!d) return;
  if (!(window.rprnQueueMeta || {})[d.payload.boqId]) { abpsDraftClear(PRN_DRAFT_KEYS.reviseDelta); return; }
  prnDraftRestoring = true;
  await prnDraftRestore(async () => {
    await jumpToRPRNDelta(d.payload.boqId, null);
    if (prnDraftApply(document.getElementById("rprn-delta-zone"), d.payload.fields)) prnDraftNotice("rprn-delta-feedback");
  });
}

async function prnDraftRestoreReviseOther() {
  const d = abpsDraftRead(PRN_DRAFT_KEYS.reviseOther);
  if (!d || !d.payload.projectId) return;
  prnDraftRestoring = true;
  await prnDraftRestore(async () => {
    switchRevisePRNTab("other");
    await initializeRevisePRNOtherTab();
    document.getElementById("rprn-project-select-ta-input").value = d.payload.projectId;
    await loadRevisePRNList();
    const meta = (window.rprnOtherListMeta || {})[d.payload.prnId];
    if (!meta) { abpsDraftClear(PRN_DRAFT_KEYS.reviseOther); return; }
    genericDropdownSelect("rprn-prn-select", d.payload.prnId,
      `${meta.productName || ""}${meta.productRating ? " " + meta.productRating : ""}`, null);
    await loadPRNForRevision();
    if (prnDraftApply(document.getElementById("rprn-body"), d.payload.fields)) prnDraftNotice("rprn-feedback");
  });
}

async function prnDraftRestoreMrd() {
  const d = abpsDraftRead(PRN_DRAFT_KEYS.mrd);
  if (!d || !d.payload.projectId) return;
  prnDraftRestoring = "mrd";
  await prnDraftRestore(async () => {
    await jumpToMRDFromQueue(d.payload.projectId, d.payload.prnId, null);
    prnDraftNotice("mrd-feedback");
  });
}

async function prnDraftRestoreRmrd() {
  const d = abpsDraftRead(PRN_DRAFT_KEYS.rmrd);
  if (!d) return;
  prnDraftRestoring = "rmrd";
  await prnDraftRestore(async () => {
    if (d.payload.mode === "queue") {
      await loadRMRDQueueTab();
      if (!(window.rmrdQueueMeta || {})[d.payload.prnId]) { abpsDraftClear(PRN_DRAFT_KEYS.rmrd); return; }
      await jumpToRMRDDelta(d.payload.prnId, null);
      prnDraftNotice("rmrd-delta-feedback");
    } else {
      if (!d.payload.projectId) return;
      switchReviseMRDTab("other");
      await initializeReviseMRDOtherTab();
      document.getElementById("rmrd-project-select-ta-input").value = d.payload.projectId;
      await loadReviseMRDList();
      const meta = (window.rmrdOtherListMeta || {})[d.payload.prnId];
      if (!meta) { abpsDraftClear(PRN_DRAFT_KEYS.rmrd); return; }
      genericDropdownSelect("rmrd-prn-select", d.payload.prnId,
        `${meta.productName || ""}${meta.productRating ? " " + meta.productRating : ""}`, null);
      await loadReviseMRDForPRN();
      prnDraftNotice("rmrd-feedback");
    }
  });
}
