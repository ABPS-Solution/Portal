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

// A server string as a JS argument inside an inline on*="..." handler:
// JSON gives a safe JS literal, escapeHtml keeps it inside the attribute.
function jsArg(value) {
  return escapeHtml(JSON.stringify(value === null || value === undefined ? "" : String(value)));
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
    return `${dd}/${mm}/${yyyy}`;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return s; // already a plain/unparseable string — show as-is rather than blank
  // A real timestamp (has a time component) — converted to IST
  // explicitly, since the server stores/returns UTC instants and this
  // must never depend on the browser's own local timezone setting.
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value || "";
  return `${get('day')}/${get('month')}/${get('year')}`;
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
// One set of month names for every screen and document (matches
// abps-backend/lib/docDate.js): September is always "Sept".
const APP_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
function formatOrdinalDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  const day = d.getDate();
  const suffix = (day % 10 === 1 && day !== 11) ? 'st'
    : (day % 10 === 2 && day !== 12) ? 'nd'
    : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  const month = APP_MONTH_NAMES[d.getMonth()];
  return `${day}${suffix} ${month} ${d.getFullYear()}`;
}

// Ordinal date + 12h time, e.g. "6th Sep 2026, 3:45 PM" — for the
// several Store screens (GRN, QA Check, Approvals, tickets/dashboard
// timestamps) that previously showed a DD/MM/YYYY + time pair.
function formatOrdinalDateTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  // Always IST, whatever the viewing device's own time zone is.
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d).map(x => [x.type, x.value]));
  const day = Number(p.day);
  const suffix = (day % 10 === 1 && day !== 11) ? 'st'
    : (day % 10 === 2 && day !== 12) ? 'nd'
    : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  return `${day}${suffix} ${APP_MONTH_NAMES[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod}`;
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
  // min-width:0 matters on a narrow (mobile) grid column — a flex/grid
  // item's default min-width is its content's min-content size, which for
  // an inline-block can refuse to shrink below that and silently overflow
  // its column instead of respecting width:100%.
  wrap.style.cssText = 'position:relative; display:inline-block; width:100%; min-width:0; max-width:100%; vertical-align:middle; box-sizing:border-box;';
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
  // native calendar picker still opens normally on click. overflow:hidden +
  // nowrap/ellipsis is defensive — the formatted text should always fit,
  // but a narrow mobile column must never let it visually spill past the
  // box's own border.
  const overlay = document.createElement('span');
  overlay.style.cssText = 'position:absolute; left:1px; top:0; right:26px; bottom:0; display:flex; align-items:center; padding-left:9px; pointer-events:none; font:inherit; z-index:2; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;';
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

// Formats a native <input type="time"> value ("HH:MM", always 24-hour
// regardless of locale) into a friendly "h:mm AM/PM" string.
function formatTimeAMPMFromHM(hm) {
  if (!hm) return '';
  const parts = hm.split(':');
  if (parts.length < 2) return '';
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  if (isNaN(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

// Same overlay technique as enhanceOneDateInputForDMY, for the same
// underlying reason: on mobile Safari/Chrome, a native <input type="time">'s
// OWN displayed digits are rendered by the browser's internal time-picker
// widget at a size that largely ignores the input's own font-size/line-
// height CSS — this made "Time of Meeting" render as oversized, mismatched-
// looking text next to a normally-sized Date of Meeting field (which
// already had this same transparent-input-plus-custom-overlay treatment).
// Hiding the native text (color:transparent) and drawing our own small,
// consistently-styled "h:mm AM/PM" overlay on top fixes this the same way
// the date fix did, without touching the native picker itself — clicks
// still fall through and open it normally.
function enhanceOneTimeInputForAMPM(input) {
  if (input.dataset.ampmEnhanced) return;
  input.dataset.ampmEnhanced = "1";

  const wrap = document.createElement('span');
  wrap.style.cssText = 'position:relative; display:inline-block; width:100%; min-width:0; max-width:100%; vertical-align:middle; box-sizing:border-box;';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.style.width = '100%';
  input.style.color = 'transparent';
  input.style.background = 'transparent';
  input.style.position = 'relative';
  input.style.zIndex = '1';

  const overlay = document.createElement('span');
  overlay.style.cssText = 'position:absolute; left:1px; top:0; right:26px; bottom:0; display:flex; align-items:center; padding-left:9px; pointer-events:none; font:inherit; z-index:2; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;';
  wrap.appendChild(overlay);

  const sync = () => {
    const formatted = formatTimeAMPMFromHM(input.value);
    overlay.textContent = formatted || '--:-- --';
    overlay.style.color = formatted ? 'inherit' : '#9ca3af';
  };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  input._ampmSync = sync;
  sync();
}

function enhanceAllTimeInputsForAMPM() {
  document.querySelectorAll('input[type="time"]').forEach(input => {
    if (input.closest('#reusable-child-modules-template')) return;
    if (input.dataset.ampmEnhanced) {
      if (input._ampmSync) input._ampmSync();
    } else {
      enhanceOneTimeInputForAMPM(input);
    }
  });
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

// Item-code search: matches the full "Name - Rating - Make" text (so a
// name copied from another screen finds its item), ignoring extra spaces.
// Gate Entry's uploaded Invoice / Challan as "open in new tab" links.
// drive_image_url holds "invoiceUrl, challanUrl" (either may be missing).
function gateDocLinksHtml(docUrls, invoiceNumber, challanNumber) {
  const urls = String(docUrls || "").split(",").map(u => u.trim()).filter(Boolean);
  if (!urls.length) return '<span style="font-size:0.78rem; color:var(--muted); margin-left:6px;">No invoice / challan uploaded</span>';
  let labels;
  if (urls.length >= 2) labels = ["View Invoice", "View Challan"];
  else if (invoiceNumber && !challanNumber) labels = ["View Invoice"];
  else if (challanNumber && !invoiceNumber) labels = ["View Challan"];
  else labels = ["View Invoice / Challan"];
  return urls.slice(0, 2).map((u, i) => `<a href="${escapeHtml(driveLink(u))}" target="_blank" rel="noopener" onclick="event.stopPropagation();"
    style="display:inline-block; margin-left:6px; padding:3px 9px; border:1px solid var(--brand); border-radius:4px; color:var(--brand); font-weight:700; font-size:0.78rem; text-decoration:none; background:#fff;">${labels[i] || "View Document"} ↗</a>`).join("");
}

function itemCatalogMatches(it, query) {
  return materialSearchScore(it, query) > 0;
}

// ── Forgiving material search (3 Oct 2026) ────────────────────────────
// One search used by every material picker. Ignores spaces/punctuation
// ("bus bar" = "busbar", "50x6" = "50 x 6"), takes words in any order,
// tolerates 1-2 wrong letters per word, understands shop-floor short forms
// (MATERIAL_SEARCH_ALIASES) and ranks the best match first.
const MATERIAL_SEARCH_ALIASES = {
  al: "aluminium", alu: "aluminium", aluminum: "aluminium", alluminium: "aluminium", allu: "aluminium",
  cu: "copper", cop: "copper", cap: "capacitor", caps: "capacitor", capa: "capacitor",
  fg: "fiber glass", fibre: "fiber", frp: "fiber glass", ss: "stainless steel",
  gi: "galvanized", hdg: "hot dip galvanized", galvanised: "galvanized",
  lugs: "lug", bolts: "bolt", nuts: "nut", washers: "washer", fuses: "fuse", lamps: "lamp",
  sleve: "sleeve", sleev: "sleeve", washar: "washer", wahhar: "washer", condactor: "conductor",
  woodn: "wooden", hardner: "hardener", pepar: "paper", sander: "sand", matrial: "material",
  thred: "thread", thard: "thread", buuble: "bubble", buble: "bubble", strech: "stretch", sterch: "stretch",
  insuleatar: "insulator", insulater: "insulator", contator: "contactor", contactar: "contactor",
  channal: "channel", groment: "grommet", cabal: "cable", cabel: "cable", termanal: "terminal",
  vaccum: "vacuum", vacum: "vacuum", favi: "fevi", putti: "putty", teap: "tape",
  ct: "current transformer", pt: "potential transformer", rvt: "residual voltage transformer",
  mcb: "mcb", mccb: "mccb", acb: "acb", vcb: "vcb", la: "arrester", sa: "surge arrester",
  pfc: "power factor controller", apfc: "apfc", ind: "indicating", ex: "exhaust"
};

function msNormText(t) {
  return String(t == null ? "" : t).toLowerCase()
    .replace(/&/g, " and ")
    .replace(/(\d)\s*x\s*(\d)/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9.]+/g, " ").replace(/(^|\s)\.|\.(\s|$)/g, " ")
    .replace(/\s+/g, " ").trim();
}

function msEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

function msAllowedTypos(word) {
  if (/^\d/.test(word) || word.length <= 3) return 0;
  return word.length <= 6 ? 1 : 2;
}

// Score one query word against an item's words / compact text. 0 = no match.
function msWordScore(qw, words, compact) {
  if (/^\d/.test(qw)) {
    const qn = qw.replace(/^0+(?=\d)/, "");
    for (const w of words) if (w === qw || (/^\d/.test(w) && w.replace(/^0+(?=\d)/, "") === qn)) return 10;
    return 0;
  }
  let best = 0;
  for (const w of words) {
    if (w === qw) return 10;
    if (qw.length >= 2 && w.startsWith(qw)) best = Math.max(best, 7);
  }
  if (best) return best;
  if (qw.length >= 4 && compact.includes(qw)) return 6;
  const allowed = msAllowedTypos(qw);
  if (allowed) {
    for (const w of words) {
      if (w.length < 3 || /^\d/.test(w)) continue;
      const d = msEditDistance(qw, w, allowed);
      if (d <= allowed) best = Math.max(best, 5 - d);
      else if (w.length > qw.length) {
        const dp = msEditDistance(qw, w.slice(0, qw.length), allowed);
        if (dp <= allowed) best = Math.max(best, 3 - dp);
      }
    }
  }
  return best;
}

function msDefaultFields(it) {
  return [it.combinedName, it.productName, it.materialName, it.rating, it.make, it.itemCode, it.typeOfMaterial];
}

const _msPrepCache = new WeakMap();
function msPrepare(item, getFields) {
  const key = (item && typeof item === "object") ? item : null;
  const cached = key && !getFields ? _msPrepCache.get(key) : null;
  if (cached) return cached;
  const parts = (getFields || msDefaultFields)(item).filter(Boolean).map(msNormText);
  const words = Array.from(new Set(parts.join(" ").split(" ").filter(Boolean)));
  const prep = { parts, words, compact: parts.join("").replace(/ /g, "") };
  if (key && !getFields) _msPrepCache.set(key, prep);
  return prep;
}

// Returns 0 when the item does not match; otherwise higher = better.
function materialSearchScore(item, query, getFields) {
  const qText = msNormText(query);
  if (!qText) return 0;
  const prep = msPrepare(item, getFields);
  const parts = prep.parts, words = prep.words, compact = prep.compact;
  const qCompact = qText.replace(/ /g, "");
  let score = 0;
  for (const raw of qText.split(" ")) {
    let s = msWordScore(raw, words, compact);
    const alias = MATERIAL_SEARCH_ALIASES[raw];
    if (alias) {
      const aWords = msNormText(alias).split(" ");
      const aScore = Math.min(...aWords.map(a => msWordScore(a, words, compact)));
      s = Math.max(s, aScore);
    }
    if (!s) return 0;
    score += s;
  }
  if (qCompact.length >= 3 && compact.includes(qCompact)) score += 8;
  const main = parts[0] || "";
  if (main.startsWith(qText.split(" ")[0])) score += 3;
  return score;
}

// Ranked search: best matches first, at most `limit` results.
function materialSearch(list, query, limit, getFields) {
  const scored = [];
  (list || []).forEach((item, i) => {
    const s = materialSearchScore(item, query, getFields);
    if (s > 0) scored.push({ item, s, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, limit || scored.length).map(x => x.item);
}
