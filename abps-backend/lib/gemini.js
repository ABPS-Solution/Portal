// ═══════════════════════════════════════════════════════════════════════
// lib/gemini.js — replaces UrlFetchApp calls to the Gemini API in
// code.js. One shared helper (callGeminiJSON) enforces "JSON only, no
// preamble" the same way the Apps Script prompts did, then each specific
// use case builds on top of it, passing its own MODEL_TIER (primary,
// with an optional fallback) rather than a single global model.
// ═══════════════════════════════════════════════════════════════════════

// Real, verified API model IDs (checked against Google's docs July 2026 —
// do not guess-rename these, several "GA-sounding" model names are
// actually still preview IDs under the hood):
const MODEL_2_5_FLASH_LITE = 'gemini-2.5-flash-lite';   // GA, stable
const MODEL_3_5_FLASH_LITE = 'gemini-3.5-flash-lite';   // GA, stable
const MODEL_3_FLASH        = 'gemini-3-flash-preview';  // still preview despite the "3 Flash" name
const MODEL_3_1_PRO        = 'gemini-3.1-pro-preview';  // still preview despite being the "Pro" tier

// Named tiers per the model-assignment decisions in the project handoff —
// each is an ORDERED ARRAY: [primary, fallback?]. Functions below pass
// one of these to callGeminiJSON instead of a bare model string.
const TIER_CLASSIFY_CHEAP = [MODEL_2_5_FLASH_LITE];                 // no fallback — cheap, high-volume, simple binary/semantic tasks
const TIER_EXTRACT_LITE   = [MODEL_3_5_FLASH_LITE, MODEL_3_FLASH];  // document/image extraction, business cards, email detail steps
const TIER_REASONING_PRO  = [MODEL_3_1_PRO, MODEL_3_FLASH];         // PO parsing — needs real reasoning depth, not just extraction

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// callGeminiJSON — tries each model in `models` in order. Within a given
// model, retries transient errors (429/5xx) with backoff, same as
// before. Only moves on to the NEXT model in the array once the current
// model's retries are exhausted — this mirrors code.js's old
// primary-endpoint-then-fallback-endpoint pattern, just generalized to
// N models instead of a hardcoded pair.
async function callGeminiJSON(parts, { models = [MODEL_2_5_FLASH_LITE], retries = 2 } = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY environment variable is not set.');
  if (!models.length) throw new Error('callGeminiJSON: at least one model is required.');

  const body = {
    contents: [{ parts }],
    // NOTE: temperature is honored by gemini-2.5-flash-lite but is
    // silently IGNORED by all Gemini 3.x models (3.5 Flash-Lite,
    // 3-flash-preview, 3.1-pro-preview) — not an error, just a no-op on
    // those tiers. Left in place since it's harmless and still matters
    // for the 2.5 tier.
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  };

  let lastErr;
  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const model = models[modelIdx];
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const isLastModel = modelIdx === models.length - 1;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          // Rate limit / transient — retry the SAME model with backoff first.
          if (resp.status === 429 || resp.status >= 500) {
            lastErr = new Error(`Gemini API (${model}) returned ${resp.status}`);
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            continue;
          }
          // Persistent 4xx (bad key, bad request, model unavailable) —
          // no point retrying THIS model again; break out to try the
          // next model in the array (if any) immediately.
          lastErr = new Error(`Gemini API (${model}) error ${resp.status}: ${await resp.text()}`);
          break;
        }
        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error(`Gemini (${model}) returned no content.`);
        return JSON.parse(text);
      } catch (err) {
        lastErr = err;
        if (attempt === retries) break; // exhausted retries on this model — fall through to next model
      }
    }
    if (!isLastModel) {
      console.error(`callGeminiJSON: ${model} exhausted, falling back to ${models[modelIdx + 1]}. Last error: ${lastErr?.message}`);
    }
  }
  throw lastErr;
}

// ── Business Card OCR ────────────────────────────────────────────────
// Ports the "parse" action — image in, structured contact fields out.
async function parseBusinessCard(base64Image, mimeType = 'image/jpeg', base64ImageBack = null, mimeTypeBack = 'image/jpeg') {
  const hasBack = !!base64ImageBack;
  const parts = [
    {
      text: `Extract contact details from ${hasBack ? "these two business card images (front and back of the same card)" : "this business card image"}. Return ONLY a JSON object with these
exact keys (use empty string "" if a field is not present, never omit a key):
{"companyName":"", "contactPersonName":"", "position":"", "phone":"", "altPhone":"", "email":"",
 "website":"", "city":"", "state":"", "country":"", "companyAddress":""}
${hasBack ? "Combine information from both images — the back often has additional details like a second address, website, or extra phone numbers not on the front." : ""}
If country is missing but a 6-digit Indian postal code is visible, infer "India".`,
    },
    { inlineData: { mimeType, data: base64Image } },
  ];
  if (hasBack) parts.push({ inlineData: { mimeType: mimeTypeBack, data: base64ImageBack } });
  return callGeminiJSON(parts, { models: TIER_EXTRACT_LITE });
}

// ── Item Code Semantic Search ────────────────────────────────────────
// Takes the pre-filtered candidate shortlist (from the fast text-match
// pass already in routes/design.js's searchItemCodeCandidates) and asks
// Gemini to rank by functional/semantic match, matching the two-stage
// "narrow then rank" approach in code.js.
async function semanticItemMatch(query, candidates) {
  const candidateList = candidates.map(c => `${c.item_code}: ${c.material_name} (${c.rating || ''}, ${c.type_of_material || ''})`).join('\n');
  return callGeminiJSON([
    {
      text: `A design engineer searched for: "${query}"

Candidate item codes (from a text-overlap prefilter):
${candidateList}

Rank these by how well they semantically match the search intent, accounting for engineering
abbreviations and shorthand (e.g. "SS" = Stainless Steel, "MCB" = Miniature Circuit Breaker).
Return ONLY JSON: {"matches": [{"itemCode": "...", "confidence": 0-100, "reason": "short reason"}]},
sorted by confidence descending. Only include matches with confidence >= 40.`,
    },
  ], { models: TIER_CLASSIFY_CHEAP });
}

// ── Inbound Email Lead Classification + Summarization (2-step, cost-conscious) ──
// Step 1: cheap classification on every unread message — subject + a short
// body snippet only, no summary extraction. Step 2 (full summary) only runs
// for genuine leads — mirrors classifyOutboundEmail/extractOfferDetails below.
async function classifyInboundEmail(subject, bodyText, senderEmail) {
  return callGeminiJSON([
    {
      text: `Email from: ${senderEmail}
Subject: ${subject}
Body (first 500 chars): ${bodyText.slice(0, 500)}

Determine if this is a genuine business lead/enquiry (not spam, not a newsletter, not an
automated notification, not a security alert). Return ONLY JSON:
{"isLead": true/false, "companyName": "", "contactPerson": ""}`,
    },
  ], { models: TIER_CLASSIFY_CHEAP });
}

// Step 2: full summary extraction — only called when Step 1 says isLead: true.
async function summarizeInboundEmail(subject, bodyText, senderEmail) {
  return callGeminiJSON([
    {
      text: `Email from: ${senderEmail}
Subject: ${subject}
Body:
${bodyText.slice(0, 6000)}

This email has already been identified as a genuine business lead/enquiry. Extract:
{"companyName": "", "contactPerson": "", "summary": "one or two sentence summary"}`,
    },
  ], { models: TIER_EXTRACT_LITE });
}

// ── Outbound Sent-Email Classification (2-step, cost-conscious) ────────
// Step 1: cheap binary/ternary classification on every candidate email.
// Step 2 (full extraction) only runs for genuine OFFER emails — mirrors
// code.js's explicit "only genuine offers reach here" cost-saving design.
async function classifyOutboundEmail(subject, bodyText) {
  return callGeminiJSON([
    {
      text: `Classify this email sent by ABPS Solution Pvt Ltd.

Subject: ${subject}
Body (first 400 chars): ${bodyText.slice(0, 400)}

Classify as exactly ONE of:
- "OFFER": a genuine commercial offer, quote, or proposal — mentions product pricing, specifications,
  delivery terms, or payment terms, sent to a customer or prospect.
- "COLD_OUTREACH": an introductory/prospecting email presenting ABPS Solutions to a company found
  externally — no specific pricing or formal quote, just an introduction.
- "OTHER": internal email, newsletter/notification, or a follow-up with no offer or introductory content.

Return ONLY JSON: {"classification": "OFFER" | "COLD_OUTREACH" | "OTHER"}`,
    },
  ], { models: TIER_CLASSIFY_CHEAP });
}

// Step 2 — only called for classification === 'OFFER'. Fuzzy-matches the
// recipient against your existing companies list (handles "M/S ABC Pvt
// Ltd" -> "ABC Pvt Ltd" style variations) and extracts offer details.
async function extractOfferDetails(subject, bodyText, companiesList) {
  const companyNames = companiesList.map(c => `${c.company_id}: ${c.company_name}`).join('\n');
  return callGeminiJSON([
    {
      text: `Analyze this sent offer email from ABPS Solution Pvt Ltd.

Subject: ${subject}
Body: ${bodyText}

Task 1 — Match the client company against our leads database using fuzzy semantic reasoning
(e.g. "M/S ABC Pvt Ltd" matches "ABC Pvt Ltd"). Company list:
${companyNames}

Task 2 — Generate a 50-80 word summary of what was offered.
Task 3 — List all products/systems mentioned (comma-separated).
Task 4 — Extract any price or value figure. If none, return "Not Mentioned".

Return ONLY JSON:
{"matchedCompanyId": "" or null, "summary": "", "productsMentioned": "", "estimatedValue": ""}`,
    },
  ], { models: TIER_EXTRACT_LITE });
}

// ── Gate Entry Invoice OCR ──────────────────────────────────────────────
// Ports processUploadedInvoiceImageViaGemini — extracts header fields +
// line items from a photographed vendor invoice (optionally + challan),
// pre-filling the Gate Entry form instead of manual typing. Returns
// extracted data only; nothing is written to the DB here — the operator
// reviews/corrects before commitGateEntryPipelineStep actually saves it,
// same two-step flow as the original.
async function parseVendorInvoice(invoiceBase64, invoiceMimeType, challanBase64, challanMimeType) {
  const parts = [
    {
      text: `You are analyzing an Indian supplier tax invoice for ABPS Solution Private Limited (the buyer).
You may receive one image (Tax Invoice) or two images (Tax Invoice + Delivery Challan). ALL financial
data (Rate, GST) comes ONLY from the Tax Invoice page — the Challan page has no pricing, ignore it for that.

Extract header fields:
- invoiceNumber: from "Invoice No", "Tax Invoice No", "Bill No"
- challanNumber: from "Challan No", "DC No", "Delivery Note" (empty string if not found)
- vendorName: the SELLER/SUPPLIER (the FROM party) — NOT ABPS Solution, which is the buyer
- invoiceDate: format YYYY-MM-DD
- poNumber: OUR purchase order number this delivery is against — labels like "PO No", "P.O. No",
  "Your Order No", "Buyer's Order No", "Against PO", "PO Ref". Extract exactly as printed. Empty
  string if not present anywhere on the document.

For each line item row:
- itemCode: ONLY set this if a value matching EXACTLY "ABPS" followed by digits (e.g. ABPS00001) appears
  printed on that row as its own field. HSN/SAC codes, part numbers, and grade codes are NOT item codes —
  never guess or construct one. Empty string if none visible.
- materialName: clean uppercase description, technical specs preserved
- quantity: numeric only
- unit: NOS/KG/MTR/LTR/SET etc
- ratePerQuantity: numeric only, per-unit rate excluding GST
- gstPercent: numeric only (e.g. 18)

Return ONLY JSON: {"invoiceNumber":"", "challanNumber":"", "vendorName":"", "invoiceDate":"", "poNumber":"",
"lineItems": [{"itemCode":"", "rawDescriptionLine":"", "materialName":"", "gateQuantity":0, "ratePerQuantity":0, "gstPercent":18, "unitType":"NOS"}]}

For rawDescriptionLine: the exact raw text from the description/particulars column, unmodified.
For materialName: a clean, standardized version of the same line (uppercase, technical specs preserved).
For gateQuantity: the numeric quantity from the invoice's Qty/Quantity column.
For unitType: NOS/KG/MTR/LTR/SET etc, standardized uppercase, default "NOS" if not found.`,
    },
    { inlineData: { mimeType: invoiceMimeType || 'image/jpeg', data: invoiceBase64 } },
  ];
  if (challanBase64) {
    parts.push({ inlineData: { mimeType: challanMimeType || 'image/jpeg', data: challanBase64 } });
  }
  return callGeminiJSON(parts, { models: TIER_EXTRACT_LITE });
}

// ── Per-user Rate Limiting ──────────────────────────────────────────────
// Ports checkGeminiRateLimit_ from code.js. Uses a DB table rather than
// an in-memory counter, since Cloud Run can scale to multiple instances
// — an in-memory limit would only cap calls per-instance, not per-user
// globally, which defeats the point.
async function checkGeminiRateLimit(pool, userEmail, actionName, { maxPerMinute = 10 } = {}) {
  await pool.query(
    `INSERT INTO admin_db.gemini_call_log (user_email, action_name) VALUES ($1, $2)`,
    [userEmail, actionName]
  );
  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*) AS count FROM admin_db.gemini_call_log
     WHERE user_email = $1 AND called_at > now() - interval '60 seconds'`,
    [userEmail]
  );
  if (parseInt(count, 10) > maxPerMinute) {
    const err = new Error(`Rate limit exceeded — please wait a moment before making another AI request.`);
    err.isRateLimit = true;
    throw err;
  }
}

// ── Raw Material PO Document Parsing ────────────────────────────────────
// Extracts header + line items from an uploaded PO document (PDF or
// image), fuzzy-matching each line against the provided item code
// catalog so the operator only has to correct mismatches, not type
// everything from scratch.
async function parseRawMaterialPO(fileBase64, mimeType, catalog) {
  const catalogList = (catalog || []).slice(0, 500).map(c => `${c.itemCode}: ${c.materialName}`).join('\n');
  return callGeminiJSON([
    {
      text: `Extract data from this Raw Material Purchase Order document.

Return ONLY JSON:
{"poNumber":"", "orderDate":"YYYY-MM-DD", "deliveryDate":"YYYY-MM-DD", "vendorName":"", "grandTotal":0,
 "lineItems": [{"description":"", "itemCode":"" or null, "quantity":0, "unit":"", "rate":0, "amount":0}]}

For each line item's itemCode, fuzzy-match "description" against this catalog (engineering abbreviations
apply, e.g. "SS"=Stainless Steel). Only set itemCode if reasonably confident; otherwise null.
Catalog:
${catalogList}`,
    },
    { inlineData: { mimeType: mimeType || 'application/pdf', data: fileBase64 } },
  ]);
}

// ── Batch Store Entry Item Code Matching ────────────────────────────────
// Given several raw invoice description lines, each with its own
// client-side-prefiltered candidate list, returns ranked matches per
// line in ONE Gemini call rather than one call per line — much cheaper
// for a multi-item invoice.
async function matchStoreEntryItemCodes(lineItemsWithCandidates) {
  const linesText = lineItemsWithCandidates.map((li, idx) =>
    `Line ${idx}: "${li.rawDescription}"\nCandidates: ${(li.candidatesTop60 || []).map(c => `${c.itemCode}:${c.materialName}`).join(', ')}`
  ).join('\n\n');

  return callGeminiJSON([
    {
      text: `Match each invoice line description below against its candidate item codes.

${linesText}

Return ONLY JSON: {"results": [{"matches": [{"itemCode":"", "confidence":"high"|"medium"|"low"}]}, ...]}
One results[] entry per Line above, in the same order, each with up to 3 ranked matches
(empty matches array if no reasonable match).`,
    },
  ], { models: TIER_CLASSIFY_CHEAP });
}

// ── Customer PO Document Parsing ────────────────────────────────────────
// Ports the "PO Document Parsing" use case — extracts header fields, all
// line items, amounts, and free-text payment terms/warranty clauses from
// an uploaded customer Purchase Order (PDF or image). Uses TIER_REASONING_PRO
// deliberately, not a Flash tier: distinguishing order date vs delivery
// date, and correctly parsing free-text payment/warranty clauses, is a
// genuine reading-comprehension task, not simple field extraction.
async function parseCustomerPurchaseOrder(fileBase64, mimeType) {
  const parts = [
    {
      text: `Extract data from this customer Purchase Order document (may be several pages,
possibly with lengthy terms & conditions).

Return ONLY JSON:
{"companyName":"", "poNumber":"", "poDate":"YYYY-MM-DD", "deliveryDate":"YYYY-MM-DD",
 "productName":"", "summary":"", "scopeOfWork":"",
 "basicAmount":0, "gstAmount":0, "totalAmount":0,
 "lineItems":[{"description":"", "quantity":0, "unit":"", "ratePerUnit":0, "totalValue":0}],
 "paymentTerms":"", "warrantyTerms":"", "abgRequired":false}

Rules:
- companyName is the ISSUER of the PO (the buyer placing the order with us), not our own company name.
- poDate is when the PO was issued/dated; deliveryDate is the committed delivery date/schedule —
  these are often different fields on the document, do not conflate them.
- basicAmount/gstAmount/totalAmount: if the document states a single clear pre-tax total, GST amount,
  and grand total, use those. If GST is only shown per-line (e.g. "18%" per item, no single summed
  GST figure), sum the line totals into basicAmount, leave gstAmount as 0, and put totalAmount as the
  document's stated overall order value if one is explicitly given — do not fabricate a GST total by
  calculating it yourself.
- summary: one or two sentence description of what's being supplied/ordered.
- scopeOfWork: brief description of the scope (e.g. "Supply of X" or "Supply + Installation + Commissioning of X").
- paymentTerms and warrantyTerms should be a concise plain-text summary of the relevant clauses
  (not a verbatim copy of the entire terms section) — a few sentences is enough.
- abgRequired: true only if the document explicitly requires an Advance Bank Guarantee.
- If a field genuinely isn't present anywhere in the document, use "" (or 0/false), never guess.`,
    },
    { inlineData: { mimeType: mimeType || 'application/pdf', data: fileBase64 } },
  ];
  return callGeminiJSON(parts, { models: TIER_REASONING_PRO });
}

// ── Invoice Rate Rescue ──────────────────────────────────────────────────
// Secondary, targeted call fired only when parseVendorInvoice's primary
// extraction returns a zero rate for one or more line items (~25% of
// Gate Entry invoices per the cost sheet) — re-extracts just rate,
// taxable value, and quantity for those specific rows rather than
// re-running the whole invoice, keeping the retry cheap and focused.
async function rescueInvoiceRates(invoiceBase64, invoiceMimeType, zeroRateLineItems) {
  const linesText = zeroRateLineItems.map((li, idx) =>
    `Line ${idx}: material "${li.materialName}", quantity ${li.quantity} ${li.unit}`
  ).join('\n');
  const parts = [
    {
      text: `The rate/price for the following line items could not be read on the first pass of this
invoice. Look again carefully at ONLY these rows and re-extract their rate, taxable value, and
quantity — they are usually present but were missed (small print, a merged cell, or a rate column
that shifted position).

${linesText}

Return ONLY JSON: {"rescued": [{"lineIndex":0, "ratePerQuantity":0, "taxableValue":0, "quantity":0}]}
One entry per Line above (same index numbering), omit any line you still genuinely cannot find a rate for.`,
    },
    { inlineData: { mimeType: invoiceMimeType || 'image/jpeg', data: invoiceBase64 } },
  ];
  return callGeminiJSON(parts, { models: TIER_EXTRACT_LITE });
}

// ── Dispatch Bill Matching ───────────────────────────────────────────────
// Parses a dispatch/transport tax invoice uploaded against a lead:
// fuzzy-matches the client company against the leads database (same
// "M/S ABC Pvt Ltd" -> "ABC Pvt Ltd" style matching as extractOfferDetails)
// and extracts the invoice-level fields needed to progress the lead to
// "Order Dispatched".
async function parseDispatchBill(fileBase64, mimeType, companiesList) {
  const companyNames = companiesList.map(c => `${c.company_id}: ${c.company_name}`).join('\n');
  const parts = [
    {
      text: `Analyze this dispatch/transport tax invoice.

Task 1 — Match the client (consignee/buyer) company against our leads database using fuzzy
semantic reasoning (e.g. "M/S ABC Pvt Ltd" matches "ABC Pvt Ltd"). Company list:
${companyNames}

Task 2 — Extract the invoice-level fields.

Return ONLY JSON:
{"matchedCompanyId": "" or null, "invoiceNumber":"", "invoiceDate":"YYYY-MM-DD",
 "customerPO":"", "customerPODate":"YYYY-MM-DD", "subTotal":0, "gst":0, "grandTotal":0}

If invoiceDate or customerPODate are not present on the document, use "".`,
    },
    { inlineData: { mimeType: mimeType || 'image/jpeg', data: fileBase64 } },
  ];
  return callGeminiJSON(parts, { models: TIER_EXTRACT_LITE });
}

// ── Commission Report Matching ────────────────────────────────────────────
// Parses a site commissioning report uploaded against a lead: same
// fuzzy company match as Dispatch Bill Matching, plus the fields needed
// to progress the lead to "Product Commissioned".
async function parseCommissionReport(fileBase64, mimeType, companiesList) {
  const companyNames = companiesList.map(c => `${c.company_id}: ${c.company_name}`).join('\n');
  const parts = [
    {
      text: `Analyze this site commissioning report.

Task 1 — Match the client company against our leads database using fuzzy semantic reasoning
(e.g. "M/S ABC Pvt Ltd" matches "ABC Pvt Ltd"). Company list:
${companyNames}

Task 2 — Extract the commissioning-level fields.

Return ONLY JSON:
{"matchedCompanyId": "" or null, "commissioningDate":"YYYY-MM-DD", "engineerNames":"",
 "commissionedProduct":"", "customerContactPerson":""}

engineerNames: comma-separated if more than one ABPS engineer is named on the report.`,
    },
    { inlineData: { mimeType: mimeType || 'image/jpeg', data: fileBase64 } },
  ];
  return callGeminiJSON(parts, { models: TIER_EXTRACT_LITE });
}

// ── Lead Text Cleanup (Submit + Update, shared) ──────────────────────────
// Ports cleanupTextWithAI — cleans/standardizes free-text fields (fixes
// spelling, collapses stray whitespace, applies Title Case to
// name/company/place fields) on lead submission or edit. Only string
// values are sent; non-string values (booleans, arrays, numbers, dates)
// pass through untouched. Non-fatal by design at the call site: a
// cleanup failure should never block saving the lead.
async function cleanupLeadTextFields(fieldsObject) {
  const stringEntries = Object.entries(fieldsObject).filter(([, v]) => typeof v === 'string' && v.trim());
  if (stringEntries.length === 0) return fieldsObject;

  const toClean = Object.fromEntries(stringEntries);
  const cleaned = await callGeminiJSON([
    {
      text: `Clean and standardize the free-text field values below from a CRM lead form. For each:
- Fix obvious spelling/typo errors
- Collapse stray/duplicate whitespace
- Apply Title Case to proper nouns (names, companies, cities, states, countries) — but do NOT
  Title Case free-form sentences/summaries, leave those as natural sentence case
- Do NOT change the actual meaning or invent information

Fields (JSON object, key -> current value):
${JSON.stringify(toClean)}

Return ONLY a JSON object with the EXACT SAME KEYS, each mapped to its cleaned value.`,
    },
  ], { models: TIER_CLASSIFY_CHEAP });

  // Merge cleaned strings back over the original object — never drop
  // non-string fields, and fall back to the original value per-key if
  // the model omitted a key rather than losing data.
  const merged = { ...fieldsObject };
  for (const key of Object.keys(toClean)) {
    if (typeof cleaned[key] === 'string' && cleaned[key].trim()) merged[key] = cleaned[key];
  }
  return merged;
}

module.exports = {
  callGeminiJSON, parseBusinessCard, semanticItemMatch, classifyInboundEmail, summarizeInboundEmail,
  classifyOutboundEmail, extractOfferDetails, parseVendorInvoice, checkGeminiRateLimit,
  parseRawMaterialPO, matchStoreEntryItemCodes,
  parseCustomerPurchaseOrder, rescueInvoiceRates, parseDispatchBill, parseCommissionReport, cleanupLeadTextFields,
};