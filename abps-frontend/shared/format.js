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

// BOQ material row box display — the row's materialName field itself
// stays bare "Name - Rating" (Make deliberately excluded, see
// create-boq.js's handleBOQRowMaterialSearch header comment: Make is
// locked to the Item Code and stored in its own row.make field so the
// backend/PDF can compose "Name - Rating - Description - Make: X" in
// order). This only controls what the row's Material Name textarea shows
// on screen after a selection, so an operator can see the Make they just
// picked without it being baked into the saved materialName string.
function boqRowMaterialDisplayText(row) {
  const name = (row && row.materialName || "").toString();
  const make = (row && row.make || "").toString().trim();
  return make ? `${name} - Make: ${make}` : name;
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

  // Explicitly convert to IST rather than reading getHours()/getMinutes(),
  // which return the BROWSER's local timezone — wrong for any user not
  // physically on IST-offset system clock. Same reasoning as formatDateDMY.
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(dateObj);
  const hourPart = parts.find(p => p.type === 'hour')?.value || '12';
  const minutePart = parts.find(p => p.type === 'minute')?.value || '00';
  const ampmPart = (parts.find(p => p.type === 'dayPeriod')?.value || 'AM').toLowerCase();
  return `${hourPart}:${minutePart} ${ampmPart}`;
}

// Formats a plain "HH:MM:SS" (Postgres TIME WITHOUT TIME ZONE, e.g.
// marketing.follow_ups.event_time) as 12-hour "h:mm am/pm". No timezone
// conversion here — the value was already written as IST wall-clock time
// (LOCALTIME on a connection pinned to Asia/Kolkata), so treating it as a
// UTC instant and re-converting (cleanISTTimestamp's job) would double
// -shift it. Deliberately separate from cleanISTTimestamp, which is for
// real timestamptz/instant values, not a bare time-of-day.
function formatPlainTimeOfDay(rawStr) {
  if (!rawStr) return "";
  const m = rawStr.toString().trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  let hours = parseInt(m[1], 10);
  const minutes = m[2];
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12; hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

// Combines a plain event_date + event_time pair (see formatPlainTimeOfDay)
// into "h:mm am/pm DD-MM-YYYY" for a created/last-edited timestamp column.
function formatFollowUpTimestamp(dateVal, timeVal) {
  const datePart = formatCleanDateOnly(dateVal);
  const timePart = formatPlainTimeOfDay(timeVal);
  if (!datePart && !timePart) return "";
  return `${timePart} ${datePart}`.trim();
}

// Extracts the YYYY-MM-DD portion from a raw date/timestamp value so it can
// be assigned directly to a native <input type="date">.value — that input
// ONLY accepts YYYY-MM-DD; assigning it a DD-MM-YYYY string (e.g. from
// formatCleanDateOnly) silently fails and leaves the field blank, which
// looked like the value being "reset" on Edit.
function toDateInputValue(rawStr) {
  if (!rawStr) return "";
  const m = rawStr.toString().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
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
// Ordinal display date, e.g. "6th Sep 2026" — accepts an ISO date string
// or a Date. Used anywhere a friendlier, unambiguous date than DD/MM/YYYY
// is wanted (Advance Vouchers table, voucher-check line items).
function formatOrdinalDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  const day = d.getDate();
  const suffix = (day % 10 === 1 && day !== 11) ? 'st'
    : (day % 10 === 2 && day !== 12) ? 'nd'
    : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${day}${suffix} ${month} ${d.getFullYear()}`;
}

// Ordinal date + 12h time, e.g. "6th Sep 2026, 3:45 PM" — for the
// several Store screens (GRN, QA Check, Approvals, tickets/dashboard
// timestamps) that previously showed a DD/MM/YYYY + time pair.
function formatOrdinalDateTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${formatOrdinalDate(d)}, ${h}:${m} ${ampm}`;
}

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
  // Exposed so enhanceAllDateInputsForDMY's poll can re-sync an ALREADY-
  // enhanced input — code that sets `.value = ...` directly (e.g. Edit
  // Follow-Up/Edit Task populating a date field from existing data) never
  // fires a real 'input'/'change' event, so the overlay silently kept
  // showing its stale/placeholder text over a native input whose real
  // value had actually updated correctly — looked exactly like the date
  // "going blank" on Edit even though the underlying value was fine.
  input._dmySync = sync;
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
  document.querySelectorAll('input[type="date"]').forEach(input => {
    if (input.closest('#reusable-child-modules-template')) return;
    if (input.dataset.dmyEnhanced) {
      if (input._dmySync) input._dmySync();
    } else {
      enhanceOneDateInputForDMY(input);
    }
  });
}
