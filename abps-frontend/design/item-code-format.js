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
    const m = /^(nph|tph)\b/.exec(s.slice(i));
    if (m && boundaryBefore) {
      flushLiteral();
      segments.push({ kind: m[1] === 'nph' ? 'number' : 'text' });
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
  segments.forEach((seg, idx) => {
    if (seg.kind === 'literal') return;
    const index = placeholders.length;
    seg.index = index;
    let label = '';
    const next = segments[idx + 1];
    if (next && next.kind === 'literal') label = next.text.split(',')[0].trim();
    if (!label) label = `Value ${index + 1}`;
    seg.label = label;
    placeholders.push({ index, kind: seg.kind, options: seg.options || null, label });
  });
  return { segments, placeholders, error: null };
}

function icfValidateValues(template, values) {
  const { placeholders, error } = icfParseTemplate(template);
  if (error) return error;
  const vals = Array.isArray(values) ? values : [];
  for (const ph of placeholders) {
    const raw = vals[ph.index];
    const v = raw == null ? '' : String(raw).trim();
    if (!v) return `"${ph.label}" is required.`;
    if (ph.kind === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) return `"${ph.label}" must be a number.`;
    if (ph.kind === 'choice' && !ph.options.includes(v)) return `"${ph.label}" must be one of: ${ph.options.join(', ')}.`;
  }
  return null;
}

function icfRenderTemplate(template, values) {
  const { segments, error } = icfParseTemplate(template);
  if (error) throw new Error(error);
  const vals = Array.isArray(values) ? values : [];
  let out = '';
  for (const seg of segments) {
    if (seg.kind === 'literal') out += seg.text;
    else { const raw = vals[seg.index]; out += (raw == null ? '' : String(raw)).trim(); }
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ── Form builder — renders the fill-in inputs for one template into a
// container element, wiring each input to call `onChange()` (a real
// listener, not an inline-stringified handler — inline handlers run in
// global scope and can't see closure state) so the caller can recompute
// its live preview. Returns a getValues() closure the caller uses to read
// current values back out in placeholder order.
function icfRenderFormInputs(containerEl, template, onChange, idPrefix) {
  const { segments, error } = icfParseTemplate(template);
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
    const inputType = seg.kind === 'number' ? 'number' : 'text';
    return `<span style="display:inline-flex; flex-direction:column; margin:4px 6px;">
      <label style="font-size:0.68rem; font-weight:700; color:var(--brand); text-transform:uppercase;">${seg.label}</label>
      <input type="${inputType}" id="${id}" data-idx="${seg.index}"
        style="width:90px; padding:5px; border:1px solid var(--border); border-radius:3px; font-size:0.82rem;">
    </span>`;
  }).join('');

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
      const el = document.getElementById(`${idPrefix}-ph-${ph.index}`);
      return el ? el.value.trim() : '';
    });
  };
}
