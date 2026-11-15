// Static check for unescaped text in HTML built from template literals.
// Finds `${...}` inside HTML-looking template literals whose expression
// names a likely free-text field (name, remark, email, error ...) and is not
// wrapped in escapeHtml / jsArg / a number or date formatter.
// Findings already in escaping-baseline.json are allowed; only NEW ones fail.
//   node check-escaping.js <frontendDir>            check
//   node check-escaping.js <frontendDir> --update   rewrite the baseline
// Keys are file + normalized expression (no line numbers), with a count.
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const update = process.argv.includes('--update');
const baselinePath = path.join(__dirname, 'escaping-baseline.json');

const SAFE_CALL = /\b(\w*[eE]sc\w*|escapeHtml|jsArg|encodeURIComponent|fmt\w*|format\w*|trim\w*|Number|parseInt|parseFloat|String\(Number|Math\.\w+|toFixed|toLocaleString|toLocaleDateString|toLocaleTimeString|JSON\.stringify|friendlyNum\w*)\s*\(/;
const UNTRUSTED = /(name|desc|remark|reason|company|email|subject|body|note|text|message|msg|error|err\b|title|label|address|contact|vendor|material|comment|summary|city|state|country|person|engineer|preparedBy|createdBy|requestedBy|approvedBy|purpose|venue|website|phone|query|detail|spec|make|rating|filename|fileName|caption|issue|problem|discussion|status)/i;

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules' && !f.startsWith('.')) walk(p, out); }
    else if (f.endsWith('.js') && f !== 'sw.js') out.push(p);
  }
  return out;
}

// Returns [{text, exprs:[...]}] for every template literal (nested ones too).
function templates(src) {
  const found = [];
  let i = 0;
  function readTemplate() { // src[i] === '`'
    i++;
    let text = ''; const exprs = [];
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { text += src.substr(i, 2); i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') { i += 2; const start = i; skipCode('}'); exprs.push(src.slice(start, i)); i++; text += '${}'; continue; }
      text += c; i++;
    }
    found.push({ text, exprs });
  }
  function skipString(q) { i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; }
  function skipCode(end) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '`') { readTemplate(); continue; }
      if (c === '"' || c === "'") { skipString(c); continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; continue; }
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') { if (depth === 0 && c === end) return; depth--; }
      i++;
    }
  }
  while (i < src.length) { const before = i; skipCode(null); if (i === before) i++; }
  return found;
}

function stripSafe(expr) {
  let e = expr.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "''");
  for (let guard = 0; guard < 50; guard++) {
    const m = SAFE_CALL.exec(e);
    if (!m) break;
    let j = m.index + m[0].length, depth = 1;
    while (j < e.length && depth) { if (e[j] === '(') depth++; else if (e[j] === ')') depth--; j++; }
    e = e.slice(0, m.index) + '0' + e.slice(j);
  }
  return e.replace(/[\w$.?\[\]]+\.length\b/g, '0').replace(/\b\w*(Count|Qty|Quantity|Amount|Total|Idx|Index|Id|ID|Key|Pct|Percent|Num|No|Width|Height|Color|Colour|Class|Cls|Style|Icon|Bg|Border)\b/g, '0');
}

function findings(file) {
  const out = [];
  for (const t of templates(fs.readFileSync(file, 'utf8'))) {
    if (!/<[a-zA-Z\/]|\bon[a-z]+=/.test(t.text)) continue;
    for (const raw of t.exprs) {
      if (raw.includes('`')) continue;            // nested HTML is checked on its own
      const rest = stripSafe(raw);
      if (!/[A-Za-z_$]/.test(rest)) continue;
      if (!UNTRUSTED.test(rest)) continue;
      if (/\?\s*''\s*:\s*''\s*$/.test(rest)) continue;          // cond ? 'literal' : 'literal'
      if (SAFE_CALL.test(raw)) continue;         // escaped somewhere: trust the author
      if (/^[\s!(]*[\w$]+\s*\(/.test(raw)) continue;                 // builder helper call
      if (!/[A-Za-z_$][\w$]*\??\.[A-Za-z_$]/.test(rest)) continue; // only field reads like row.name
      out.push(raw.replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

if (require.main !== module) { module.exports = { findings }; return; }
const current = {};
for (const f of walk(root, [])) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  for (const e of findings(f)) { const k = rel + ' :: ' + e; current[k] = (current[k] || 0) + 1; }
}
const total = Object.values(current).reduce((a, b) => a + b, 0);

if (update) {
  const sorted = Object.fromEntries(Object.keys(current).sort().map(k => [k, current[k]]));
  fs.writeFileSync(baselinePath, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`Baseline written: ${total} findings in ${Object.keys(current).length} keys.`);
  process.exit(0);
}
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
const fresh = [];
for (const [k, n] of Object.entries(current)) if (n > (baseline[k] || 0)) fresh.push(`${k}  (${n} now, ${baseline[k] || 0} allowed)`);
console.log(`Escaping check: ${total} findings, ${fresh.length} new.`);
if (fresh.length) {
  console.log('New unescaped interpolations in HTML (wrap in escapeHtml(...) or jsArg(...) for inline handlers):');
  fresh.forEach(x => console.log('  ' + x));
  process.exit(1);
}
