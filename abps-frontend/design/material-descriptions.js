// ═══════════════════════════════════════════════════════════════════════
// design/material-descriptions.js — shared typeahead + create flow for
// the "Description of Material" registry (18 Aug 2026). Used by the BOQ
// header field (4 screens), FG material-row sub-fields, Import an
// Existing BOQ, and Add to Finished Goods Store. Mirrors the caching
// pattern of loadItemCodeCatalogIntoCache (design/item-codes.js) and the
// generic-typeahead pattern of handleIcfTypeTypeaheadInput.
// ═══════════════════════════════════════════════════════════════════════

async function loadMaterialDescriptionsIntoCache(forceRefresh = false) {
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const now = Date.now();
  if (!forceRefresh && window.materialDescriptionsCache && window._materialDescriptionsLoadedAt &&
      (now - window._materialDescriptionsLoadedAt) < CACHE_TTL_MS) {
    return;
  }
  try {
    const data = await apFetch({ action: "fetchMaterialDescriptions" });
    if (data.success) {
      window.materialDescriptionsCache = data.descriptions || [];
      window._materialDescriptionsLoadedAt = Date.now();
    } else {
      window.materialDescriptionsCache = window.materialDescriptionsCache || [];
    }
  } catch (e) {
    console.error("Material description catalog load failed:", e);
    window.materialDescriptionsCache = window.materialDescriptionsCache || [];
  }
}

// Generic typeahead — inputId is the visible text field, hiddenIdFieldId
// (optional) is a hidden input that carries the resolved descriptionId,
// onSelectFn (optional, a GLOBAL function name string) is called as
// window[onSelectFn](descriptionId, descriptionText, extraArg) after a
// selection or successful inline creation — extraArg (optional, e.g. a
// material-row index) lets one shared callback update the right row's
// backing data object, since typing a value directly into a hidden
// input's .value via JS does NOT fire its onchange handler.
function handleMaterialDescriptionTypeaheadInput(query, inputId, dropdownId, hiddenIdFieldId, onSelectFn, extraArg) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  const inputEl = document.getElementById(inputId);
  if (inputEl && hiddenIdFieldId) {
    const hidden = document.getElementById(hiddenIdFieldId);
    if (hidden) hidden.value = ""; // typing invalidates any prior exact selection
  }

  const rect = (inputEl || dropdown.parentElement).getBoundingClientRect();
  dropdown.style.position = "fixed";
  dropdown.style.left = rect.left + "px";
  dropdown.style.top = rect.bottom + "px";
  dropdown.style.width = Math.max(rect.width, 260) + "px";

  const q = (query || "").trim().toLowerCase();
  if (!q) { dropdown.style.display = "none"; return; }

  const catalog = window.materialDescriptionsCache || [];
  const matches = catalog.filter(d => (d.descriptionText || "").toLowerCase().includes(q)).slice(0, 12);
  const exact = catalog.find(d => (d.descriptionText || "").trim().toLowerCase() === q);

  let html = matches.map(d => `
    <div onmousedown="event.preventDefault();" onclick="selectMaterialDescriptionOption(${d.descriptionId}, '${d.descriptionText.replace(/'/g, "\\'")}', '${inputId}', '${dropdownId}', '${hiddenIdFieldId || ""}', ${onSelectFn ? `'${onSelectFn}'` : 'null'}, ${extraArg !== undefined ? `'${extraArg}'` : 'null'})"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; font-size:0.82rem;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      ${d.descriptionText}
    </div>`).join("");

  if (!exact && query.trim()) {
    html += `
      <div onmousedown="event.preventDefault();" onclick="createMaterialDescriptionInline('${query.trim().replace(/'/g, "\\'")}', '${inputId}', '${dropdownId}', '${hiddenIdFieldId || ""}', ${onSelectFn ? `'${onSelectFn}'` : 'null'}, ${extraArg !== undefined ? `'${extraArg}'` : 'null'})"
        style="padding:8px 12px; cursor:pointer; font-size:0.82rem; font-weight:700; color:var(--accent); border-top:1px solid var(--border);"
        onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
        + Create new: "${query.trim()}"
      </div>`;
  }

  if (!html) { dropdown.style.display = "none"; return; }
  dropdown.innerHTML = html;
  dropdown.style.display = "block";
}

function selectMaterialDescriptionOption(descriptionId, descriptionText, inputId, dropdownId, hiddenIdFieldId, onSelectFn, extraArg) {
  const inputEl = document.getElementById(inputId);
  if (inputEl) inputEl.value = descriptionText;
  const dropdown = document.getElementById(dropdownId);
  if (dropdown) dropdown.style.display = "none";
  if (hiddenIdFieldId) {
    const hidden = document.getElementById(hiddenIdFieldId);
    if (hidden) hidden.value = descriptionId;
  }
  if (onSelectFn && window[onSelectFn]) window[onSelectFn](descriptionId, descriptionText, extraArg);
}

async function createMaterialDescriptionInline(text, inputId, dropdownId, hiddenIdFieldId, onSelectFn, extraArg, forceCreate) {
  const dropdown = document.getElementById(dropdownId);
  if (dropdown) dropdown.innerHTML = `<div style="padding:8px 12px; font-size:0.8rem; color:var(--muted);">Creating...</div>`;
  try {
    const data = await apFetch({ action: "createMaterialDescription", descriptionText: text, operatorName: appActiveOperatorIdentityString, forceCreate: !!forceCreate });
    if (!data.success) {
      // The duplicate-match checks are advisory, not a hard lock — a
      // flagged match can be a false positive (e.g. "Pink Color" vs
      // "Pink Color, ABCD Description"), so give the operator a way to
      // proceed anyway instead of just refusing. `existing` is only set
      // for the two duplicate-flag responses, never for a real validation
      // error, so it's what distinguishes "advisory, can override" from
      // "actually invalid, nothing to override."
      if (data.existing && confirm(`${data.error}\n\nClick OK to create it anyway as a new, separate description.`)) {
        return createMaterialDescriptionInline(text, inputId, dropdownId, hiddenIdFieldId, onSelectFn, extraArg, true);
      }
      if (!data.existing) alert(data.error || "Could not create this description.");
      if (dropdown) dropdown.style.display = "none";
      return;
    }
    if (data.aiCheckUnavailable) {
      console.warn("Material description created — AI similarity check was unavailable, only the deterministic token check ran.");
    }
    await loadMaterialDescriptionsIntoCache(true);
    selectMaterialDescriptionOption(data.descriptionId, data.descriptionText, inputId, dropdownId, hiddenIdFieldId, onSelectFn, extraArg);
  } catch (e) {
    alert("Network error creating description: " + e.message);
    if (dropdown) dropdown.style.display = "none";
  }
}

// Shared onSelectFn for every per-row (FG material row) Description of
// Material field across all four BOQ screens — extraArg is "<prefix>:<idx>"
// (e.g. "cboq:2"), dispatching into the right screen's rows array so one
// callback can serve all of them, matching selectBOQRowMaterial's own
// rowsMap convention (design/update-boq.js).
function boqRowDescOnSelect(descriptionId, descriptionText, extraArg) {
  const [prefix, idxStr] = (extraArg || "").split(":");
  const idx = parseInt(idxStr);
  // NOTE: these are top-level `let` bindings in create-boq.js/authorize-boq.js/
  // update-boq.js — visible as bare identifiers across <script> tags in the
  // same classic (non-module) global scope, but NOT as window.* properties,
  // so they must be referenced by bare name here, not window.cboqMaterialRows.
  const rowsMap = { cboq: cboqMaterialRows, eboq: eboqMaterialRows, uboq: uboqMaterialRows, boqrev: uboqRevRows };
  const rows = rowsMap[prefix];
  if (rows && rows[idx]) {
    rows[idx].descriptionId = descriptionId;
    rows[idx].descriptionOfMaterial = descriptionText;
  }
}

// Global outside-click closer for every material-description dropdown on
// the page — same convention as the other typeahead dropdowns in this app.
document.addEventListener("click", (e) => {
  if (e.target.closest('[id$="-desc-input"]') || e.target.closest('[id$="-desc-dropdown"]')) return;
  document.querySelectorAll('[id$="-desc-dropdown"]').forEach(d => { d.style.display = "none"; });
});
