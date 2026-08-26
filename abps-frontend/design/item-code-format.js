// ═══════════════════════════════════════════════════════════════════════
// design/item-code-format.js — client-side port of
// abps-backend/lib/itemCodeFormat.js, used ONLY to render the fill-in form
// and its live preview. The server re-parses and re-renders every template
// itself on write and never trusts a string built here — see
// createItemCode in routes/design.js. Same "client port for live preview,
// server recomputes authoritatively" arrangement as
// numberToWordsINRClient (production/project-invoice.js) mirrors
// numberToWordsINR (lib/poTemplate.js).
//
// Keep this in sync with lib/itemCodeFormat.js — same token rules:
//   <A or B or C>   pick exactly one
//   nph             numeric placeholder (whole word)
//   tph             text placeholder (whole word)
//   mph             mirror placeholder — read-only, copies the nearest
//                   earlier nph sharing the same derived label
//   xph             step-rating list — dynamic (rating × count) rows,
//                   validated against an earlier "nph Step Sizes" (count
//                   target) and an earlier "nph kVAr" (magnitude target)
//   anything else   fixed literal
// ═══════════════════════════════════════════════════════════════════════

function icfTokenizeTemplate(template) {
  const s = String(template == null ? '' : template);
  const segments = [];
  let buf = '';
  let i = 0;
  const flushLiteral = () => { if (buf) { segments.push({ kind: 'literal', text: buf }); buf = ''; } };

  while (i < s.length) {
    const ch = s[i];
    if (ch === '<') {
      const close = s.indexOf('>', i + 1);
      if (close === -1) return { error: 'Unclosed "<" — every choice must be written as <A or B>.' };
      const inner = s.slice(i + 1, close);
      const options = inner.split(/\s+or\s+/i).map(o => o.trim()).filter(Boolean);
      if (options.length < 2) return { error: `Choice "<${inner}>" needs at least two options separated by " or ".` };
      flushLiteral();
      segments.push({ kind: 'choice', options });
      i = close + 1;
      continue;
    }
    if (ch === '>') return { error: 'Unmatched ">" — every choice must be written as <A or B>.' };
    const boundaryBefore = i === 0 || /[^A-Za-z0-9_]/.test(s[i - 1]);
    const m = /^(nph|tph|mph|xph)\b/.exec(s.slice(i));
    if (m && boundaryBefore) {
      flushLiteral();
      const KIND_BY_WORD = { nph: 'number', tph: 'text', mph: 'mirror', xph: 'steplist' };
      segments.push({ kind: KIND_BY_WORD[m[1]] });
      i += m[1].length;
      continue;
    }
    buf += ch;
    i++;
  }
  flushLiteral();
  return { segments };
}

function icfParseTemplate(template) {
  const t = icfTokenizeTemplate(template);
  if (t.error) return { segments: [], placeholders: [], error: t.error };
  const segments = t.segments;
  const placeholders = [];
  let parseError = null;
  segments.forEach((seg, idx) => {
    if (seg.kind === 'literal' || parseError) return;
    const index = placeholders.length;
    seg.index = index;
    // Stop the label at comma/paren/slash, not just comma — "nph V
    // (designed to" must label as "V", and "nph kVAr / nph V" must label
    // its first half "kVAr" — load-bearing for mph/xph resolution below.
    let label = '';
    const next = segments[idx + 1];
    if (next && next.kind === 'literal') label = next.text.split(/[,()/]/)[0].trim();
    if (!label) label = `Value ${index + 1}`;
    seg.label = label;

    const ph = { index, kind: seg.kind, options: seg.options || null, label };

    if (seg.kind === 'mirror') {
      const source = placeholders.filter(p => p.kind === 'number' && p.label === label).pop();
      if (!source) { parseError = `"mph" labeled "${label}" has no earlier "nph ${label}" to mirror.`; return; }
      ph.mirrorOf = source.index;
      seg.mirrorOf = source.index;
    }

    if (seg.kind === 'steplist') {
      const stepSizes = placeholders.filter(p => p.kind === 'number' && p.label === 'Step Sizes').pop();
      const kvarTarget = placeholders.filter(p => p.kind === 'number' && p.label === 'kVAr').pop();
      if (!stepSizes) { parseError = '"xph" needs an earlier "nph Step Sizes" placeholder to validate the step count against.'; return; }
      if (!kvarTarget) { parseError = '"xph" needs an earlier "nph kVAr" placeholder to validate the total kVAr against.'; return; }
      ph.stepSizesOf = stepSizes.index;
      ph.kvarTargetOf = kvarTarget.index;
      seg.stepSizesOf = stepSizes.index;
      seg.kvarTargetOf = kvarTarget.index;
    }

    placeholders.push(ph);
  });
  if (parseError) return { segments: [], placeholders: [], error: parseError };
  return { segments, placeholders, error: null };
}

function icfParseStepListValue(raw) {
  let steps;
  try { steps = JSON.parse(raw); } catch (e) { throw new Error('malformed'); }
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('empty');
  for (const s of steps) {
    const rating = Number(s && s.rating), count = Number(s && s.count);
    if (!(rating > 0) || !Number.isInteger(count) || count <= 0) throw new Error('bad-row');
  }
  return steps.map(s => ({ rating: Number(s.rating), count: Number(s.count) }));
}

// Mirrors lib/itemCodeFormat.js's isValidNumericPlaceholderValue — a "V"
// (bare Voltage) label may hold a dual value like "240/415", and any
// "...Ratio"-labeled placeholder (CT Ratio, Turns Ratio, etc.) is a ratio
// by definition, e.g. "100/5" — every other numeric label stays strictly
// single-number.
function icfIsSlashAllowedLabel(label) {
  const l = (label || '').trim();
  return /^v$/i.test(l) || /\bratio\b/i.test(l);
}
function icfIsValidNumericPlaceholderValue(v, label) {
  if (/^-?\d+(\.\d+)?$/.test(v)) return true;
  return icfIsSlashAllowedLabel(label) && /^-?\d+(\.\d+)?(\s*\/\s*-?\d+(\.\d+)?)+$/.test(v);
}

function icfValidateValues(template, values) {
  const { placeholders, error } = icfParseTemplate(template);
  if (error) return error;
  const vals = Array.isArray(values) ? values : [];
  for (const ph of placeholders) {
    const raw = vals[ph.index];

    if (ph.kind === 'steplist') {
      const rawStr = raw == null ? '' : String(raw).trim();
      if (!rawStr) return `"Step Rating" is required.`;
      let steps;
      try { steps = icfParseStepListValue(rawStr); }
      catch (e) { return `"Step Rating" must be one or more valid rating/count steps.`; }
      const sumCount = steps.reduce((s, x) => s + x.count, 0);
      const sumKvar = steps.reduce((s, x) => s + x.rating * x.count, 0);
      const stepSizesVal = Number(vals[ph.stepSizesOf]);
      const kvarTargetVal = Number(vals[ph.kvarTargetOf]);
      if (Math.abs(sumCount - stepSizesVal) > 1e-9) return `"Step Rating" step counts add up to ${sumCount}, but Step Sizes is ${stepSizesVal} — they must match.`;
      if (Math.abs(sumKvar - kvarTargetVal) > 1e-6) return `"Step Rating" kVAr adds up to ${sumKvar}, but the designed kVAr is ${kvarTargetVal} — they must match.`;
      continue;
    }

    const v = raw == null ? '' : String(raw).trim();
    if (!v) return `"${ph.label}" is required.`;
    if ((ph.kind === 'number' || ph.kind === 'mirror') && !icfIsValidNumericPlaceholderValue(v, ph.label)) {
      return icfIsSlashAllowedLabel(ph.label)
        ? `"${ph.label}" must be a number (e.g. 415, or a ratio/multi-value like 240/415).`
        : `"${ph.label}" must be a number.`;
    }
    if (ph.kind === 'choice' && !ph.options.includes(v)) return `"${ph.label}" must be one of: ${ph.options.join(', ')}.`;
  }
  return null;
}

// Locks every "mph" input read-only and keeps it synced to the value of
// the earlier "nph" it mirrors — live preview only; the server always
// recomputes this authoritatively regardless of what's sent (see
// applyMirrorValues in lib/itemCodeFormat.js).
function icfWireMirrorFields(placeholders, containerEl, idPrefix) {
  placeholders.filter(p => p.kind === 'mirror').forEach(ph => {
    const sourceEl = document.getElementById(`${idPrefix}-ph-${ph.mirrorOf}`);
    const mirrorEl = document.getElementById(`${idPrefix}-ph-${ph.index}`);
    if (!sourceEl || !mirrorEl) return;
    mirrorEl.readOnly = true;
    mirrorEl.style.background = '#f1f5f9';
    mirrorEl.style.color = 'var(--muted)';
    mirrorEl.title = 'Always matches the value entered above — cannot be changed independently.';
    const sync = () => { mirrorEl.value = sourceEl.value; };
    sourceEl.addEventListener('input', sync);
    sync();
  });
}

// Dynamic +Add Step builder for one "xph" placeholder — rows of
// (rating, count) number pairs, with a live running total against the
// Step Sizes count and the designed kVAr this placeholder resolved
// against in icfParseTemplate. `stepState` is a shared object (keyed by
// placeholder index) the caller's getValues() reads back out, so state
// survives this widget's own internal re-renders.
function icfInitStepListWidget(ph, containerEl, idPrefix, stepState, onChange) {
  const mount = document.getElementById(`${idPrefix}-ph-${ph.index}-steplist`);
  if (!mount) return;
  if (!stepState[ph.index] || stepState[ph.index].length === 0) stepState[ph.index] = [{ rating: '', count: '' }];

  const targetCountEl = () => document.getElementById(`${idPrefix}-ph-${ph.stepSizesOf}`);
  const targetKvarEl = () => document.getElementById(`${idPrefix}-ph-${ph.kvarTargetOf}`);

  // updateSummary() only touches the two summary text lines, never the row
  // inputs — a full innerHTML rebuild on every keystroke was destroying and
  // recreating the row <input> elements each time, which dropped focus after
  // the first character typed (had to re-click the box for every digit).
  // Row inputs are only rebuilt by render(), which runs solely on add/remove.
  function updateSummary() {
    const rows = stepState[ph.index];
    const sumCount = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const sumKvar = rows.reduce((s, r) => s + (Number(r.rating) || 0) * (Number(r.count) || 0), 0);
    const targetCount = Number((targetCountEl() || {}).value) || 0;
    const targetKvar = Number((targetKvarEl() || {}).value) || 0;
    const countOk = Math.abs(sumCount - targetCount) < 1e-9;
    const kvarOk = Math.abs(sumKvar - targetKvar) < 1e-6;
    const countEl = mount.querySelector('[data-summary="count"]');
    const kvarEl = mount.querySelector('[data-summary="kvar"]');
    if (countEl) { countEl.textContent = `Steps: ${sumCount} / ${targetCount || '?'}`; countEl.style.color = countOk ? '#15803d' : '#b91c1c'; }
    if (kvarEl) { kvarEl.textContent = `kVAr: ${sumKvar} / ${targetKvar || '?'}`; kvarEl.style.color = kvarOk ? '#15803d' : '#b91c1c'; }
  }

  function render() {
    const rows = stepState[ph.index];

    mount.innerHTML = `
      ${rows.map((r, i) => `
        <div style="display:flex; align-items:center; gap:4px; margin-bottom:3px;">
          <input type="number" min="0" step="any" value="${r.rating}" data-row="${i}" data-field="rating"
            placeholder="kVAr" style="width:70px; padding:3px 4px; font-size:0.78rem; border:1px solid var(--border); border-radius:3px;">
          <span style="font-size:0.72rem; color:var(--muted);">kVAr x</span>
          <input type="number" min="1" step="1" value="${r.count}" data-row="${i}" data-field="count"
            placeholder="Qty" style="width:55px; padding:3px 4px; font-size:0.78rem; border:1px solid var(--border); border-radius:3px;">
          ${rows.length > 1 ? `<button type="button" data-remove="${i}" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:3px; font-size:0.65rem; font-weight:700; padding:1px 5px; cursor:pointer;">✕</button>` : ''}
        </div>`).join('')}
      <button type="button" data-add="1" style="background:none; border:1px dashed var(--brand); color:var(--brand); border-radius:3px; font-size:0.65rem; font-weight:700; padding:2px 6px; cursor:pointer; margin-top:2px;">+ Add Step</button>
      <div data-summary="count" style="font-size:0.66rem; margin-top:4px;"></div>
      <div data-summary="kvar" style="font-size:0.66rem;"></div>
    `;

    mount.querySelectorAll('input[data-row]').forEach(el => el.addEventListener('input', () => {
      const i = Number(el.dataset.row), field = el.dataset.field;
      stepState[ph.index][i][field] = el.value;
      updateSummary();
      if (typeof onChange === 'function') onChange();
    }));
    const addBtn = mount.querySelector('[data-add]');
    if (addBtn) addBtn.addEventListener('click', () => { stepState[ph.index].push({ rating: '', count: '' }); render(); updateSummary(); });
    mount.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
      stepState[ph.index].splice(Number(btn.dataset.remove), 1);
      render();
      updateSummary();
      if (typeof onChange === 'function') onChange();
    }));

    updateSummary();
  }

  render();
  // Re-render (for the live target numbers) whenever the Step Sizes / kVAr
  // fields it targets change — those are plain nph inputs elsewhere in
  // the same form.
  const countSrc = targetCountEl(), kvarSrc = targetKvarEl();
  if (countSrc) countSrc.addEventListener('input', updateSummary);
  if (kvarSrc) kvarSrc.addEventListener('input', updateSummary);
}

// Client-side mirror of lib/itemCodeFormat.js's applyMhOhmAutoCalc — live
// preview only; the server recomputes and overwrites this authoritatively
// on write regardless of what this sends. Ohm = 314.16 × mH ÷ 1000.
function icfWireMhOhmAutoCalc(placeholders, containerEl, idPrefix) {
  const mhPh = placeholders.find(p => p.kind === 'number' && /^mh$/i.test(p.label.trim()));
  const ohmPh = placeholders.find(p => p.kind === 'number' && /^ohm/i.test(p.label.trim()));
  if (!mhPh || !ohmPh) return;
  const mhEl = document.getElementById(`${idPrefix}-ph-${mhPh.index}`);
  const ohmEl = document.getElementById(`${idPrefix}-ph-${ohmPh.index}`);
  if (!mhEl || !ohmEl) return;
  ohmEl.readOnly = true;
  ohmEl.style.background = '#f1f5f9';
  ohmEl.style.color = 'var(--muted)';
  ohmEl.title = 'Auto-calculated as 314.16 × mH ÷ 1000';
  const recompute = () => {
    const mhVal = parseFloat(mhEl.value);
    ohmEl.value = isNaN(mhVal) ? '' : String(Math.round((314.16 * mhVal / 1000) * 1000) / 1000);
    // Setting .value directly does NOT fire an 'input' event, so anything
    // that in turn derives FROM ohm (Total kVAr / kVAr, both of which
    // listen for 'input' on the ohm field) never saw this change — the
    // ohm box visibly updated but the downstream kVAr stayed stale until
    // the operator separately touched A or ohm, at which point it jumped
    // to reflect the ohm value that had already silently changed. Dispatch
    // one explicitly so the whole chain (mH -> ohm -> kVAr) stays live.
    ohmEl.dispatchEvent(new Event('input'));
  };
  // Registered before the generic onChange listener below (see call site),
  // so ohmEl's value is already up to date by the time that listener reads
  // it back out for the live preview on the same keystroke.
  mhEl.addEventListener('input', recompute);
  recompute();
}

// Client-side mirror of lib/itemCodeFormat.js's applyTotalKvarAutoCalc —
// live preview only; the server recomputes and overwrites this
// authoritatively on write regardless of what this sends.
// Total kVAr = 3 × A² × ohm ÷ 1000 (Iron Core Reactor's rating template).
function icfWireTotalKvarAutoCalc(placeholders, containerEl, idPrefix) {
  const ampPh = placeholders.find(p => p.kind === 'number' && /^a$/i.test(p.label.trim()));
  const ohmPh = placeholders.find(p => p.kind === 'number' && /^ohm/i.test(p.label.trim()));
  const totalKvarPh = placeholders.find(p => p.kind === 'number' && /^total\s*kvar$/i.test(p.label.trim()));
  if (!ampPh || !ohmPh || !totalKvarPh) return;
  const ampEl = document.getElementById(`${idPrefix}-ph-${ampPh.index}`);
  const ohmEl = document.getElementById(`${idPrefix}-ph-${ohmPh.index}`);
  const totalKvarEl = document.getElementById(`${idPrefix}-ph-${totalKvarPh.index}`);
  if (!ampEl || !ohmEl || !totalKvarEl) return;
  totalKvarEl.readOnly = true;
  totalKvarEl.style.background = '#f1f5f9';
  totalKvarEl.style.color = 'var(--muted)';
  totalKvarEl.title = 'Auto-calculated as 3 × A² × ohm ÷ 1000';
  const recompute = () => {
    const ampVal = parseFloat(ampEl.value);
    const ohmVal = parseFloat(ohmEl.value);
    totalKvarEl.value = (isNaN(ampVal) || isNaN(ohmVal)) ? '' : String(Math.round((3 * ampVal * ampVal * ohmVal / 1000) * 1000) / 1000);
  };
  // Registered before the generic onChange listener at the call site, same
  // ordering reasoning as icfWireMhOhmAutoCalc — and after that function's
  // own mH->ohm listener, so ohm is already current when this reads it.
  ampEl.addEventListener('input', recompute);
  ohmEl.addEventListener('input', recompute);
  recompute();
}

// Client-side mirror of lib/itemCodeFormat.js's applyReactorAutoCalcs —
// live preview only; the server recomputes and overwrites both
// authoritatively on write. kVAr = A² × ohm ÷ 1000 (bare "kVAr" label,
// distinct from Iron Core Reactor's "Total kVAr").
function icfWireKvarAutoCalc(placeholders, containerEl, idPrefix) {
  const ampPh = placeholders.find(p => p.kind === 'number' && /^a$/i.test(p.label.trim()));
  const ohmPh = placeholders.find(p => p.kind === 'number' && /^ohm/i.test(p.label.trim()));
  const kvarPh = placeholders.find(p => p.kind === 'number' && /^kvar$/i.test(p.label.trim()));
  if (!ampPh || !ohmPh || !kvarPh) return;
  const ampEl = document.getElementById(`${idPrefix}-ph-${ampPh.index}`);
  const ohmEl = document.getElementById(`${idPrefix}-ph-${ohmPh.index}`);
  const kvarEl = document.getElementById(`${idPrefix}-ph-${kvarPh.index}`);
  if (!ampEl || !ohmEl || !kvarEl) return;
  kvarEl.readOnly = true;
  kvarEl.style.background = '#f1f5f9';
  kvarEl.style.color = 'var(--muted)';
  kvarEl.title = 'Auto-calculated as A² × ohm ÷ 1000';
  const recompute = () => {
    const ampVal = parseFloat(ampEl.value);
    const ohmVal = parseFloat(ohmEl.value);
    kvarEl.value = (isNaN(ampVal) || isNaN(ohmVal)) ? '' : String(Math.round((ampVal * ampVal * ohmVal / 1000) * 1000) / 1000);
  };
  ampEl.addEventListener('input', recompute);
  ohmEl.addEventListener('input', recompute);
  recompute();
}

// Client-side mirror of applyReactorAutoCalcs' BIL lookup — found
// structurally (a "Bil"-containing literal followed by nph / nph), same
// reasoning as the server-side function's own comment. Wired off the kV
// choice's radio group, since these two fields have no source <input> of
// their own to listen on.
const ICF_REACTOR_BIL_BY_KV = {
  '3.3': [10, 40], '6.6': [20, 60], '11': [28, 75], '22': [50, 125],
  '33': [70, 170], '66': [140, 325], '132': [275, 550],
};
function icfWireReactorBilAutoCalc(template, containerEl, idPrefix) {
  const { segments } = icfParseTemplate(template);
  if (!segments) return;
  for (let i = 0; i < segments.length - 3; i++) {
    const litBefore = segments[i], nph1 = segments[i + 1], litSlash = segments[i + 2], nph2 = segments[i + 3];
    if (litBefore.kind === 'literal' && /\bbil\b/i.test(litBefore.text) &&
        nph1.kind === 'number' && litSlash.kind === 'literal' && litSlash.text.trim() === '/' &&
        nph2.kind === 'number') {
      const kvChoice = segments.find(s => s.kind === 'choice' && s.options.length === 7 &&
        ['3.3', '6.6', '11', '22', '33', '66', '132'].every((v, oi) => s.options[oi] === v));
      if (!kvChoice) return;
      const nph1El = document.getElementById(`${idPrefix}-ph-${nph1.index}`);
      const nph2El = document.getElementById(`${idPrefix}-ph-${nph2.index}`);
      if (!nph1El || !nph2El) return;
      [nph1El, nph2El].forEach(el => {
        el.readOnly = true;
        el.style.background = '#f1f5f9';
        el.style.color = 'var(--muted)';
        el.title = 'Auto-filled from the selected kV rating (standard BIL levels)';
      });
      const recompute = () => {
        const checked = containerEl.querySelector(`input[name="${idPrefix}-ph-${kvChoice.index}-group"]:checked`);
        const pair = checked ? ICF_REACTOR_BIL_BY_KV[checked.value.trim()] : null;
        nph1El.value = pair ? String(pair[0]) : '';
        nph2El.value = pair ? String(pair[1]) : '';
      };
      containerEl.querySelectorAll(`input[name="${idPrefix}-ph-${kvChoice.index}-group"]`).forEach(el => el.addEventListener('change', recompute));
      recompute();
      return;
    }
  }
}

// Client-side mirror of lib/itemCodeFormat.js's applyApfcRatedCurrentAutoCalc
// — live preview only; the server recomputes and overwrites this
// authoritatively on write whenever it CAN compute one (see that
// function's comment for why a dual-voltage reference is left alone
// instead of overwritten). Matched structurally, same reasoning as
// icfWireReactorBilAutoCalc above — these templates reuse the "kVAr"/"V"
// labels twice more later (a "(designed to ...)" pair and again near
// "Step Rating = ... at N kVAr / M V"), so label matching alone would
// grab the wrong occurrence.
function icfWireApfcRatedCurrentAutoCalc(template, containerEl, idPrefix) {
  const { segments } = icfParseTemplate(template);
  if (!segments) return;
  for (let i = 0; i < segments.length - 4; i++) {
    const kvarSeg = segments[i], lit1 = segments[i + 1], vkvSeg = segments[i + 2], lit2 = segments[i + 3], curSeg = segments[i + 4];
    if (kvarSeg.kind !== 'literal' && lit1.kind === 'literal' &&
        vkvSeg.kind !== 'literal' && lit2.kind === 'literal' && /rated current/i.test(lit2.text) &&
        curSeg.kind === 'number') {
      const kvarEl = document.getElementById(`${idPrefix}-ph-${kvarSeg.index}`);
      const vkvEl = document.getElementById(`${idPrefix}-ph-${vkvSeg.index}`);
      const curEl = document.getElementById(`${idPrefix}-ph-${curSeg.index}`);
      if (!kvarEl || !vkvEl || !curEl) return;
      const isKv = /^kv$/i.test((vkvSeg.label || '').trim());
      curEl.title = isKv
        ? 'Auto-calculated as kVAr ÷ (√3 × kV) when possible'
        : 'Auto-calculated as (kVAr × 1000) ÷ (√3 × V) when possible';
      // NOT forced read-only, unlike the other auto-calc fields — the V/kV
      // reference can legitimately be a dual value like "415/240" (tph,
      // free text), in which case there's no single defensible current to
      // compute and the operator needs to be able to type one in by hand.
      const recompute = () => {
        const kvarVal = parseFloat(kvarEl.value);
        const refRaw = (vkvEl.value || '').trim();
        if (isNaN(kvarVal) || !/^-?\d+(\.\d+)?$/.test(refRaw)) return; // leave whatever's there — manual entry
        const refVal = parseFloat(refRaw);
        const current = isKv ? kvarVal / (Math.sqrt(3) * refVal) : (kvarVal * 1000) / (Math.sqrt(3) * refVal);
        curEl.value = String(Math.round(current * 1000) / 1000);
      };
      kvarEl.addEventListener('input', recompute);
      vkvEl.addEventListener('input', recompute);
      recompute();
      return;
    }
  }
}

function icfRenderTemplate(template, values) {
  const { segments, error } = icfParseTemplate(template);
  if (error) throw new Error(error);
  const vals = Array.isArray(values) ? values : [];
  let out = '';
  for (const seg of segments) {
    if (seg.kind === 'literal') { out += seg.text; continue; }
    if (seg.kind === 'steplist') {
      const steps = icfParseStepListValue(vals[seg.index]);
      out += steps.map(s => `${s.rating} kVAr x ${s.count}`).join(' + ');
      continue;
    }
    const raw = vals[seg.index];
    out += (raw == null ? '' : String(raw)).trim();
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ── Form builder — renders the fill-in inputs for one template into a
// container element, wiring each input to call `onChange()` (a real
// listener, not an inline-stringified handler — inline handlers run in
// global scope and can't see closure state) so the caller can recompute
// its live preview. Returns a getValues() closure the caller uses to read
// current values back out in placeholder order.
// initialValues (optional) — same order as the template's placeholders
// (i.e. exactly the array shape stored in item_codes.format_values /
// sent as materialNameValues/ratingValues) — pre-fills every field with
// an existing item code's values, e.g. for "clone an existing code, tweak
// one or two things" in Add / Check Item Code.
function icfRenderFormInputs(containerEl, template, onChange, idPrefix, initialValues) {
  const { segments, placeholders, error } = icfParseTemplate(template);
  if (error) {
    containerEl.innerHTML = `<div style="color:#b91c1c; font-size:0.8rem; font-weight:600;">⚠ ${error}</div>`;
    return () => [];
  }
  containerEl.innerHTML = segments.map((seg) => {
    if (seg.kind === 'literal') {
      const t = seg.text.trim();
      return t ? `<span style="padding:6px 2px; font-weight:600; color:var(--muted);">${t}</span>` : '';
    }
    const id = `${idPrefix}-ph-${seg.index}`;
    if (seg.kind === 'choice') {
      const groupId = `${id}-group`;
      return `<span style="display:inline-flex; flex-direction:column; margin:4px 6px;">
        <label style="font-size:0.68rem; font-weight:700; color:var(--brand); text-transform:uppercase;">${seg.label}</label>
        <div class="pill-group" id="${groupId}">
          ${seg.options.map((opt, oi) => `
            <input type="radio" name="${groupId}" id="${groupId}-${oi}" value="${opt.replace(/"/g,'&quot;')}">
            <label for="${groupId}-${oi}">${opt}</label>
          `).join('')}
        </div>
      </span>`;
    }
    if (seg.kind === 'steplist') {
      return `<span style="display:inline-flex; flex-direction:column; margin:4px 6px; vertical-align:top;">
        <label style="font-size:0.68rem; font-weight:700; color:var(--brand); text-transform:uppercase;">Step Rating</label>
        <div id="${id}-steplist" style="border:1px solid var(--border); border-radius:4px; padding:6px; min-width:230px;"></div>
      </span>`;
    }
    // A "V" (Voltage) or "...Ratio"-labeled field can hold a slash value
    // like "240/415" or "100/5" — a native <input type="number"> blocks
    // the "/" character outright, so it must stay type="text" for those
    // labels even though every other number/mirror placeholder uses the
    // numeric keypad/spinner. Server-side validation (lib/itemCodeFormat.js)
    // is still the authority; this only affects what the input widget allows.
    const inputType = (seg.kind === 'number' || seg.kind === 'mirror') && !icfIsSlashAllowedLabel(seg.label) ? 'number' : 'text';
    return `<span style="display:inline-flex; flex-direction:column; margin:4px 6px;">
      <label style="font-size:0.68rem; font-weight:700; color:var(--brand); text-transform:uppercase;">${seg.label}</label>
      <input type="${inputType}" id="${id}" data-idx="${seg.index}"
        style="width:90px; padding:5px; border:1px solid var(--border); border-radius:3px; font-size:0.82rem;">
    </span>`;
  }).join('');

  // Pre-fill from an existing item code's stored values, before any
  // auto-calc/mirror wiring below runs (so a derived field's first
  // computation, if any, sees real source values rather than blanks).
  // steplist gets its raw JSON parsed into stepListState directly, since
  // icfInitStepListWidget only seeds a blank default row when its state
  // entry is empty.
  const stepListState = {};
  if (Array.isArray(initialValues)) {
    placeholders.forEach((ph, i) => {
      const v = initialValues[i];
      if (v === undefined || v === null || v === '') return;
      if (ph.kind === 'choice') {
        const radio = containerEl.querySelector(`input[name="${idPrefix}-ph-${ph.index}-group"][value="${CSS.escape(String(v))}"]`);
        if (radio) radio.checked = true;
      } else if (ph.kind === 'steplist') {
        try {
          const parsed = JSON.parse(v);
          if (Array.isArray(parsed) && parsed.length > 0) stepListState[ph.index] = parsed;
        } catch (e) { /* malformed/legacy value — leave the widget's own default */ }
      } else {
        const el = document.getElementById(`${idPrefix}-ph-${ph.index}`);
        if (el) el.value = v;
      }
    });
  }

  // Must run BEFORE the generic onChange listeners below are attached —
  // each registers its own 'input' listener on its SOURCE field first, so
  // the derived field is already recomputed by the time onChange's own
  // listener (also on that same source field) reads values back out for
  // the live preview.
  icfWireMhOhmAutoCalc(placeholders, containerEl, idPrefix);
  icfWireTotalKvarAutoCalc(placeholders, containerEl, idPrefix);
  icfWireKvarAutoCalc(placeholders, containerEl, idPrefix);
  icfWireReactorBilAutoCalc(template, containerEl, idPrefix);
  icfWireApfcRatedCurrentAutoCalc(template, containerEl, idPrefix);
  icfWireMirrorFields(placeholders, containerEl, idPrefix);
  placeholders.filter(p => p.kind === 'steplist').forEach(ph => icfInitStepListWidget(ph, containerEl, idPrefix, stepListState, onChange));

  if (typeof onChange === 'function') {
    containerEl.querySelectorAll('input[type="text"], input[type="number"]').forEach(el => el.addEventListener('input', onChange));
    containerEl.querySelectorAll('input[type="radio"]').forEach(el => el.addEventListener('change', onChange));
  }

  return function getValues() {
    const { placeholders } = icfParseTemplate(template);
    return placeholders.map(ph => {
      if (ph.kind === 'choice') {
        const checked = containerEl.querySelector(`input[name="${idPrefix}-ph-${ph.index}-group"]:checked`);
        return checked ? checked.value : '';
      }
      if (ph.kind === 'steplist') {
        return JSON.stringify((stepListState[ph.index] || []).map(r => ({ rating: r.rating, count: r.count })));
      }
      const el = document.getElementById(`${idPrefix}-ph-${ph.index}`);
      return el ? el.value.trim() : '';
    });
  };
}
