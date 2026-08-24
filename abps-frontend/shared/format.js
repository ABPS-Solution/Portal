// Shared display helper — stored values are the full Type of Material name directly
// (e.g. "Fabrication", "Switchgear") everywhere: sheets, PDFs, filters, matching logic.
// Defined globally here (not lazily) so it's always available regardless of navigation order.
window.typeLabelDisplay_ = window.typeLabelDisplay_ || function(t) {
  const clean = (t || "").toString().trim();
  return clean || "Uncategorized";
};

// Client-side mirror of routes/design.js's buildMaterialDisplayLabel — same
// "Name - Rating - Description of Material - Make: X" convention, Make
// only appended when it actually has a value. Used anywhere a screen needs
// to build this label itself instead of getting a ready-made displayLabel
// back from the server.
function buildMaterialDisplayLabel(materialName, rating, descriptionOfMaterial, make) {
  const parts = [(materialName || "").toString().trim()];
  const r = (rating || "").toString().trim();
  if (r) parts.push(r);
  const d = (descriptionOfMaterial || "").toString().trim();
  if (d) parts.push(d);
  const m = (make || "").toString().trim();
  if (m) parts.push(`Make: ${m}`);
  return parts.join(" - ");
}

// Escapes a value before it's interpolated into an innerHTML template string.
// Use for any field whose content isn't fully controlled by internal staff —
// most importantly AI-extracted / inbound-email-derived text (Email Leads),
// where the source is an external, unauthenticated sender.
function escapeHtml(value) {
  return (value === null || value === undefined ? "" : String(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanISTTimestamp(rawStr) {
  if (!rawStr) return "";
  let str = rawStr.toString().trim();
  if (!str) return "";
  if (str.indexOf("T") === -1 && (str.indexOf("am") !== -1 || str.indexOf("pm") !== -1)) return str;
  
  let dateObj = new Date(str);
  if (isNaN(dateObj.getTime())) return str;
  
  let hours = dateObj.getHours(); let minutes = dateObj.getMinutes();
  let ampm = hours >= 12 ? 'pm' : 'am'; hours = hours % 12; hours = hours ? hours : 12;
  return hours + ":" + String(minutes).padStart(2,'0') + " " + ampm;
}

function formatCleanDateOnly(rawStr) {
  return formatDateDMY(rawStr);
}

function fmtQty(n) {
  return (Number(n) || 0).toString();
}

// Trims trailing zeros from a NUMERIC-column value Postgres returns as a
// string like "2.000" -- shows "2" for whole numbers, "2.5" if that's
// what's actually there, never a padded decimal.
function formatQtyTrimmed(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (isNaN(n)) return String(value);
  return String(parseFloat(n.toFixed(6)));
}

function formatDateDMY(value) {
  if (!value) return "";
  const s = String(value);
  // A pure calendar date with no time component (e.g. "2026-08-03", a
  // date picker's own selection with no instant to convert) — this has
  // no timezone ambiguity, so it's used as-is rather than round-tripped
  // through Date parsing (which would treat it as UTC midnight anyway).
  const dateOnlyMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, yyyy, mm, dd] = dateOnlyMatch;
    return `${dd}-${mm}-${yyyy}`;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return s; // already a plain/unparseable string — show as-is rather than blank
  // A real timestamp (has a time component) — converted to IST
  // explicitly, since the server stores/returns UTC instants and this
  // must never depend on the browser's own local timezone setting.
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value || "";
  return `${get('day')}-${get('month')}-${get('year')}`;
}

function trimNum(n) {
  const x = Number(n) || 0;
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
}

// ═══════════════════════════════════════════════════════
// DATE INPUT FORMAT ENHANCER — force DD/MM/YYYY display
// ═══════════════════════════════════════════════════════
// A native <input type="date">'s displayed text format follows the
// browser's own locale, not anything controllable via HTML/CSS (the
// lang="en-GB" attribute some browsers are documented to respect for
// this does NOT reliably work in practice — confirmed not working here).
// The only way to force DD/MM/YYYY while keeping the real native
// calendar picker is to overlay a correctly-formatted label on top of
// the (still fully functional, still clickable) native input, and hide
// the native input's own text. This runs on a short poll rather than a
// one-time DOMContentLoaded pass, since every panel here renders its
// date inputs dynamically via innerHTML at unpredictable times.
function formatDMYFromISO(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts;
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function enhanceOneDateInputForDMY(input) {
  if (input.dataset.dmyEnhanced) return;
  input.dataset.dmyEnhanced = "1";

  // Preserve original inline width/flex behavior — wrap in a span that
  // takes over the input's layout role so surrounding grids/flexboxes
  // aren't disturbed.
  const wrap = document.createElement('span');
  wrap.style.cssText = 'position:relative; display:inline-block; width:100%; vertical-align:middle;';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.style.width = '100%';
  input.style.color = 'transparent';
  input.style.background = 'transparent';
  input.style.position = 'relative';
  input.style.zIndex = '1';

  // Overlay must sit ABOVE the input (higher z-index) or the input's own
  // background — opaque by default, "transparent" above only covers its
  // TEXT — silently covers the overlay text entirely. pointer-events:none
  // means clicks still fall through to the input underneath, so the
  // native calendar picker still opens normally on click.
  const overlay = document.createElement('span');
  overlay.style.cssText = 'position:absolute; left:1px; top:0; right:26px; bottom:0; display:flex; align-items:center; padding-left:9px; pointer-events:none; font:inherit; z-index:2;';
  wrap.appendChild(overlay);

  const sync = () => {
    const formatted = formatDMYFromISO(input.value);
    overlay.textContent = formatted || 'dd/mm/yyyy';
    overlay.style.color = formatted ? 'inherit' : '#9ca3af';
  };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  sync();
}

function enhanceAllDateInputsForDMY() {
  // #reusable-child-modules-template (Follow-up/Task forms) is a hidden
  // master copy that gets cloneNode(true)'d fresh for every lead — never
  // enhance the master itself, or every clone inherits the wrapper/overlay
  // markup and transparent input styling via cloneNode WITHOUT the sync
  // event listeners cloneNode can't copy, leaving Target Date / Next
  // Follow-Up Date looking frozen and unresponsive on every clone. Skipping
  // the master here means each clone's own date input is still plain and
  // gets enhanced fresh, with working listeners, on the next poll tick
  // after it's inserted into the visible DOM.
  document.querySelectorAll('input[type="date"]:not([data-dmy-enhanced])').forEach(input => {
    if (input.closest('#reusable-child-modules-template')) return;
    enhanceOneDateInputForDMY(input);
  });
}
