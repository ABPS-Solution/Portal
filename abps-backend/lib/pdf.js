// ═══════════════════════════════════════════════════════════════════════
// lib/pdf.js — replaces the Google Docs API templating code.js used
// (DocumentApp.create(), appendParagraph(), table building) with
// pdf-lib, since there's no direct Node equivalent of Google Docs API
// for a Cloud Run service. Layout is simpler than the original Docs
// template but carries the same data — header block, then a table.
//
// Storage: generated buffers are uploaded to Cloud Storage (lib/storage.js)
// rather than Drive, since Drive requires per-user OAuth scope while
// Cloud Storage works cleanly with Cloud Run's service account. Drive
// automation for drawings/attachments is a separate, deferred item —
// this only covers documents this backend itself generates.
// ═══════════════════════════════════════════════════════════════════════
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_WIDTH = 595.28;  // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;

// ── Indian currency formatter (Rs 2,06,783.00 style) — matches code.js's formatINR ──
function formatINR(num) {
  const n = Number(num) || 0;
  const parts = n.toFixed(2).split('.');
  let intPart = parts[0];
  const dec = parts[1];
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    intPart = rest + ',' + last3;
  }
  return 'Rs ' + intPart + '.' + dec;
}

// ── BOQ-specific layout — ports code.js's DocumentApp-based BOQ PDF
// (centered letterhead, key:value header block, bordered materials
// table, INR totals, Prepared By / Authorized By signature block).
// Kept separate from the generic buildDocument() below, which PRN/PO/
// Job Card letterhead still use — BOQ's layout diverges enough
// (centered title, totals block, signatures) that sharing one function
// would complicate all four rather than simplify any of them.
// Whole numbers show with no decimals (e.g. "3200"); fractional values
// show up to 2 decimals with no trailing-zero padding — matches
// code.js's formatRateSmart_.
function formatRateSmart(val) {
  const num = Number(val) || 0;
  if (Number.isInteger(num)) return String(num);
  return (Math.round(num * 100) / 100).toString();
}

// Same "no unnecessary decimals" rule as formatRateSmart, but with
// Indian comma grouping (lakhs/crores) and no "Rs" prefix — for
// Rate/Qty and Total Rate table cells.
function formatIndianCommaSmart(val) {
  const num = Number(val) || 0;
  const isWhole = Number.isInteger(num);
  const rounded = isWhole ? num : Math.round(num * 100) / 100;
  const parts = rounded.toString().split('.');
  let intPart = parts[0];
  const dec = parts[1];
  const negative = intPart.startsWith('-');
  if (negative) intPart = intPart.slice(1);
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    intPart = rest + ',' + last3;
  }
  return (negative ? '-' : '') + intPart + (dec ? '.' + dec : '');
}

// Greedy word-wrap against a max pixel width for the given font/size.
// Falls back to a hard character-split for a single word wider than the
// column itself (long item codes etc.) so it never silently overflows.
function wrapTextLines(text, font, size, maxWidth) {
  const words = String(text ?? '').split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
      while (font.widthOfTextAtSize(current, size) > maxWidth && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > maxWidth) cut--;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
  }
  lines.push(current);
  return lines.length ? lines : [''];
}

async function buildBOQPdfBuffer({ customerName, projectId, productName, productRating, department,
  orderQuantity, materialRows, preparedBy, authorizedBy, includeCosting, version }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const centerText = (text, { size, bold = false, color = rgb(0, 0, 0) }) => {
    const f = bold ? boldFont : font;
    const width = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, size, font: f, color });
  };

  // ── Company header ──
  centerText('ABPS Solution Pvt Ltd', { size: 18, bold: true });
  y -= 22;
  centerText('Bill of Quantity', { size: 14 });
  y -= 26;

  // ── Header info block ──
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const qtyDisplay = Math.round(Number(orderQuantity) || 0);
  const headerLines = [
    ['Customer Name:', customerName || '\u2014'],
    ['Project ID:', projectId || '\u2014'],
    ['Date:', dateStr],
    ['Version:', `Rev${version || 1}`],
    null,
    ['Product Name:', productName || '\u2014'],
    ['Product Rating:', productRating || '\u2014'],
    ['Department:', department || '\u2014'],
    ['Order Quantity:', `${qtyDisplay} Sets`],
  ];
  headerLines.forEach((line) => {
    if (!line) { y -= 8; return; }
    const [label, value] = line;
    page.drawText(label, { x: MARGIN, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
    const labelWidth = boldFont.widthOfTextAtSize(label, 10);
    page.drawText(value, { x: MARGIN + labelWidth + 4, y, size: 10, font, color: rgb(0, 0, 0) });
    y -= 15;
  });
  y -= 8;

  // ── Materials table — Sr No / Qty/Set / Total Qty / Unit / Rate/Qty /
  // Total Rate all horizontally centered; column order is Qty/Set ->
  // Total Qty -> Unit; Item Code widened (taken from Description) so
  // codes never wrap in either doc; Total Qty very slightly widened in
  // the costed doc so its header doesn't wrap either.
  const CENTERED_KEYS = new Set(['srNo', 'typeOfStore', 'itemCode', 'make', 'qtyPerSet', 'totalQty', 'unit', 'rate', 'total']);
  const columns = includeCosting
    ? [
        { key: 'srNo', label: 'Sr No', width: 30 },
        { key: 'typeOfStore', label: 'Type of Store', width: 68 },
        { key: 'itemCode', label: 'Item Code', width: 58 },
        { key: 'description', label: 'Description of Material', width: 78 },
        { key: 'make', label: 'Make', width: 40 },
        { key: 'qtyPerSet', label: 'Qty/Set', width: 38 },
        { key: 'totalQty', label: 'Total Qty', width: 44 },
        { key: 'unit', label: 'Unit', width: 32 },
        { key: 'rate', label: 'Rate/Qty', width: 48 },
        { key: 'total', label: 'Total Rate / Set', width: 58 },
      ]
    : [
        { key: 'srNo', label: 'Sr No', width: 32 },
        { key: 'typeOfStore', label: 'Type of Store', width: 72 },
        { key: 'itemCode', label: 'Item Code', width: 65 },
        { key: 'description', label: 'Description of Material', width: 145 },
        { key: 'make', label: 'Make', width: 52 },
        { key: 'qtyPerSet', label: 'Qty/Set', width: 40 },
        { key: 'totalQty', label: 'Total Qty', width: 55 },
        { key: 'unit', label: 'Unit', width: 32 },
      ];
  const tableWidth = columns.reduce((a, c) => a + c.width, 0);
  const CELL_PAD = 3;
  const LINE_HEIGHT = 10;
  const ROW_VPAD = 6; // top+bottom padding inside a cell, above the wrapped text block

  // Draws one row, wrapping each cell's text to its column width and
  // sizing the row to the tallest wrapped cell. Text is also vertically
  // centered within the row (not just top-aligned) — shorter cells in a
  // tall row now sit centered, not stuck to the top.
  const drawGridRow = (cells, { bold = false, size = 8.5 } = {}) => {
    const f = bold ? boldFont : font;
    const wrapped = columns.map((col, i) => wrapTextLines(cells[i] ?? '', f, size, col.width - CELL_PAD * 2));
    const rowHeight = Math.max(...wrapped.map(lines => lines.length)) * LINE_HEIGHT + ROW_VPAD;

    let x = MARGIN;
    page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: tableWidth, height: rowHeight, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
    columns.forEach((col, i) => {
      if (i > 0) page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
      const textBlockHeight = wrapped[i].length * LINE_HEIGHT;
      const topPad = (rowHeight - textBlockHeight) / 2;
      wrapped[i].forEach((lineText, lineIdx) => {
        const lineY = y - topPad - LINE_HEIGHT * (lineIdx + 1) + 2;
        let lineX = x + CELL_PAD;
        if (CENTERED_KEYS.has(col.key)) {
          const textWidth = f.widthOfTextAtSize(lineText, size);
          lineX = x + (col.width - textWidth) / 2;
        }
        page.drawText(lineText, { x: lineX, y: lineY, size, font: f, color: rgb(0, 0, 0) });
      });
      x += col.width;
    });
    return rowHeight;
  };

  const drawHeaderRow = () => { y -= drawGridRow(columns.map(c => c.label), { bold: true }); };
  drawHeaderRow();

  let totalPerSet = 0;
  materialRows.forEach((r, idx) => {
    if (y < MARGIN + 60) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawHeaderRow();
    }
    const qty = Number(r.quantityFor1Set) || 0;
    const rate = Number(r.designRatePerQuantity) || 0;
    const totalQty = qty * (Number(orderQuantity) || 0);
    const lineTotal = qty * rate;
    totalPerSet += lineTotal;
    const storeLabel = (r.typeOfStore || 'Raw Materials Store').replace(/\s*Store\s*$/i, '');
    const baseCells = [String(idx + 1), storeLabel, r.itemCode || '', r.descriptionOfMaterial || '', r.make || '',
      formatRateSmart(qty), formatRateSmart(totalQty), r.unit || ''];
    y -= drawGridRow(includeCosting ? [...baseCells, formatIndianCommaSmart(rate), formatIndianCommaSmart(lineTotal)] : baseCells);
  });

  // ── Totals (costed version only) — extra breathing room below the
  // table; label bold, amount not bold.
  if (includeCosting) {
    y -= 26;
    if (y < MARGIN + 60) { page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = PAGE_HEIGHT - MARGIN; }
    const label1 = 'Total BOQ Cost Per Set:  ';
    page.drawText(label1, { x: MARGIN, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    page.drawText(formatINR(totalPerSet), { x: MARGIN + boldFont.widthOfTextAtSize(label1, 11), y, size: 11, font, color: rgb(0, 0, 0) });
    y -= 16;
    const label2 = 'Total BOQ Cost:               ';
    page.drawText(label2, { x: MARGIN, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    page.drawText(formatINR(totalPerSet * (Number(orderQuantity) || 0)), { x: MARGIN + boldFont.widthOfTextAtSize(label2, 11), y, size: 11, font, color: rgb(0, 0, 0) });
    y -= 30;
  } else {
    y -= 26;
  }

  // ── Signatures — "Prepared By"/"Authorized By" labels bold, the
  // person's name not bold.
  if (y < MARGIN + 50) { page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = PAGE_HEIGHT - MARGIN; }
  page.drawText('Prepared By', { x: MARGIN, y, size: 8, font: boldFont, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Authorized By', { x: MARGIN + 260, y, size: 8, font: boldFont, color: rgb(0.3, 0.3, 0.3) });
  y -= 16;
  page.drawText(preparedBy || '\u2014', { x: MARGIN, y, size: 10, font, color: rgb(0, 0, 0) });
  page.drawText(authorizedBy || '\u2014', { x: MARGIN + 260, y, size: 10, font, color: rgb(0, 0, 0) });

  return pdfDoc.save();
}

async function buildDocument({ title, subtitle, headerLines, columns, rows, footerNote }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawText = (text, { x = MARGIN, size = 10, bold = false, color = rgb(0.1, 0.13, 0.2) } = {}) => {
    page.drawText(text, { x, y, size, font: bold ? boldFont : font, color });
  };

  // Title block
  drawText(title, { size: 16, bold: true });
  y -= 20;
  if (subtitle) { drawText(subtitle, { size: 11 }); y -= 22; } else { y -= 8; }

  // Header key-value lines
  headerLines.forEach(([label, value]) => {
    drawText(`${label}:`, { bold: true, size: 9.5 });
    drawText(String(value ?? '—'), { x: MARGIN + 130, size: 9.5 });
    y -= 15;
  });
  y -= 10;

  // Table
  const colWidths = columns.map(c => c.width);
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const rowHeight = 18;

  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - rowHeight + 4, width: tableWidth, height: rowHeight, color: rgb(0.0, 0.34, 0.7) });
    let x = MARGIN;
    columns.forEach((col, i) => {
      page.drawText(col.label, { x: x + 4, y: y - 12, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
      x += colWidths[i];
    });
    y -= rowHeight;
  };

  drawTableHeader();

  rows.forEach((row, rowIdx) => {
    if (y < MARGIN + rowHeight) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawTableHeader();
    }
    if (rowIdx % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - rowHeight + 4, width: tableWidth, height: rowHeight, color: rgb(0.96, 0.97, 0.98) });
    }
    let x = MARGIN;
    columns.forEach((col, i) => {
      const val = row[col.key] !== undefined && row[col.key] !== null ? String(row[col.key]) : '—';
      page.drawText(val.slice(0, col.maxChars || 30), { x: x + 4, y: y - 12, size: 8, font, color: rgb(0.1, 0.13, 0.2) });
      x += colWidths[i];
    });
    y -= rowHeight;
  });

  if (footerNote) {
    y -= 20;
    page.drawText(footerNote, { x: MARGIN, y, size: 8, font, color: rgb(0.42, 0.48, 0.55) });
  }

  return pdfDoc.save(); // returns Uint8Array
}

// ── PRN PDF — ports code.js's DocumentApp-based PRN doc (centered
// letterhead, key:value header block, bordered materials table incl.
// Store Person signature block) onto pdf-lib. Kept separate from
// buildDocument() for the same reason buildBOQPdfBuffer is separate —
// this layout has its own centered title/signature treatment.
// Only called from authorizePRN — PRN PDFs are generated once, at
// authorization, matching legacy's single-PDF-per-lifecycle model.
async function buildPRNPdfBuffer({ prnId, projectId, customerName, productName, productRating, department, orderQuantity, storePerson, authorizedBy, isDeltaPRN, version, lineItems }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const centerText = (text, { size, bold = false, color = rgb(0, 0, 0) }) => {
    const f = bold ? boldFont : font;
    const width = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, size, font: f, color });
  };

  // ── Company header ──
  centerText('ABPS Solution Pvt Ltd', { size: 18, bold: true });
  y -= 22;
  centerText(isDeltaPRN ? 'Purchase Request Note (Additional — New/Increased Items Only)' : 'Purchase Request Note', { size: isDeltaPRN ? 11 : 14 });
  y -= 26;

  // ── Header info block — same field set/order/layout as the BOQ doc.
  // PRN ID and Customer Name are deliberately NOT shown, per explicit
  // decision — Project ID + Version already identify the document.
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const qtyDisplay = Math.round(Number(orderQuantity) || 0);
  const headerLines = [
    ['Project ID:', projectId || '\u2014'],
    ['PRN ID:', prnId || '\u2014'],
    ['Date:', dateStr],
    ['Version:', `Rev${version || 1}`],
    null,
    ['Product Name:', productName || '\u2014'],
    ['Product Rating:', productRating || '\u2014'],
    ['Order Quantity:', `${qtyDisplay} Sets`],
  ];
  const headerMaxWidth = PAGE_WIDTH - MARGIN * 2;
  headerLines.forEach((line) => {
    if (!line) { y -= 8; return; }
    const [label, value] = line;
    const labelWidth = boldFont.widthOfTextAtSize(label, 10);
    const valueX = MARGIN + labelWidth + 4;
    const valueMaxWidth = headerMaxWidth - labelWidth - 4;
    const wrapped = wrapTextLines(value, font, 10, valueMaxWidth);
    page.drawText(label, { x: MARGIN, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
    wrapped.forEach((wLine, i) => {
      page.drawText(wLine, { x: valueX, y: y - i * 13, size: 10, font, color: rgb(0, 0, 0) });
    });
    y -= 15 + Math.max(0, wrapped.length - 1) * 13;
  });
  y -= 8;

  // ── Materials table — Sr No/Buffer % widened slightly so their headers
  // never wrap; Type of Material replaced with Unit (same width BOQ uses
  // for its Unit column); the rest of the space freed by that swap goes
  // to Description of Material. Total table width unchanged (492pt).
  const CENTERED_KEYS = new Set(['srNo', 'boqRequiredQty', 'bufferPct', 'bufferedPurchaseQty', 'currentUnassignedStoreQty', 'purchaseQty', 'unit']);
  const columns = [
    { key: 'srNo', label: 'Sr No', width: 32 },
    { key: 'materialName', label: 'Description of Material', width: 178 },
    { key: 'unit', label: 'Unit', width: 32 },
    { key: 'boqRequiredQty', label: 'BOQ Qty', width: 42 },
    { key: 'bufferPct', label: 'Buffer %', width: 44 },
    { key: 'bufferedPurchaseQty', label: 'Buffered BOQ Qty', width: 55 },
    { key: 'currentUnassignedStoreQty', label: 'Store Qty', width: 55 },
    { key: 'purchaseQty', label: 'Purchase Qty', width: 55 },
  ];
  const tableWidth = columns.reduce((a, c) => a + c.width, 0);
  const CELL_PAD = 3;
  const LINE_HEIGHT = 10;
  const ROW_VPAD = 6;

  const drawGridRow = (cells, { bold = false, size = 8.5 } = {}) => {
    const f = bold ? boldFont : font;
    const wrapped = columns.map((col, i) => wrapTextLines(cells[i] ?? '', f, size, col.width - CELL_PAD * 2));
    const rowHeight = Math.max(...wrapped.map(lines => lines.length)) * LINE_HEIGHT + ROW_VPAD;

    let x = MARGIN;
    page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: tableWidth, height: rowHeight, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
    columns.forEach((col, i) => {
      if (i > 0) page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
      const textBlockHeight = wrapped[i].length * LINE_HEIGHT;
      const topPad = (rowHeight - textBlockHeight) / 2;
      wrapped[i].forEach((lineText, lineIdx) => {
        const lineY = y - topPad - LINE_HEIGHT * (lineIdx + 1) + 2;
        let lineX = x + CELL_PAD;
        if (CENTERED_KEYS.has(col.key)) {
          const textWidth = f.widthOfTextAtSize(lineText, size);
          lineX = x + (col.width - textWidth) / 2;
        }
        page.drawText(lineText, { x: lineX, y: lineY, size, font: f, color: rgb(0, 0, 0) });
      });
      x += col.width;
    });
    return rowHeight;
  };

  const drawHeaderRow = () => { y -= drawGridRow(columns.map(c => c.label), { bold: true }); };
  drawHeaderRow();

  (lineItems || []).forEach((item, idx) => {
    if (y < MARGIN + 80) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawHeaderRow();
    }
    const bufferPctDisplay = (Number(item.bufferPct) || 0) > 0 ? `${formatRateSmart(item.bufferPct)}%` : '0%';
    y -= drawGridRow([
      String(idx + 1), item.materialName || '', item.unit || '',
      formatRateSmart(item.boqRequiredQty || 0), bufferPctDisplay,
      formatRateSmart(item.bufferedPurchaseQty || 0),
      formatRateSmart(item.currentUnassignedStoreQty || 0),
      formatRateSmart(item.purchaseQty || 0),
    ]);
  });

  // ── Signatures — "Prepared By"/"Authorized By" labels bold, the
  // person's name not bold. Same dual-column layout as the BOQ doc.
  // "Prepared By" replaces the old "Store Person" label; the value
  // itself is unchanged (still the created_by field).
  y -= 30;
  if (y < MARGIN + 50) { page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = PAGE_HEIGHT - MARGIN; }
  page.drawText('Prepared By', { x: MARGIN, y, size: 8, font: boldFont, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Authorized By', { x: MARGIN + 260, y, size: 8, font: boldFont, color: rgb(0.3, 0.3, 0.3) });
  y -= 16;
  page.drawText(storePerson || '\u2014', { x: MARGIN, y, size: 10, font, color: rgb(0, 0, 0) });
  page.drawText(authorizedBy || '\u2014', { x: MARGIN + 260, y, size: 10, font, color: rgb(0, 0, 0) });

  return pdfDoc.save();
}

// ── Purchase Order PDF ────────────────────────────────────────────────
async function generatePOPdf({ poNo, vendorName, orderDate, deliveryDate, lineItems, grandTotal, paymentTerms, warranty }) {
  return buildDocument({
    title: 'Raw Material Purchase Order',
    subtitle: `P.O. No: ${poNo}   |   Order Date: ${orderDate}`,
    headerLines: [
      ['Vendor', vendorName], ['Delivery Date', deliveryDate],
      ['Payment Terms', paymentTerms], ['Warranty', warranty],
      ['Grand Total (INR)', grandTotal ? Number(grandTotal).toLocaleString('en-IN') : '—'],
    ],
    columns: [
      { key: 'srNo', label: 'Sr', width: 25 },
      { key: 'description', label: 'Description', width: 180, maxChars: 45 },
      { key: 'itemCode', label: 'Item Code', width: 70 },
      { key: 'quantity', label: 'Qty', width: 45 },
      { key: 'unit', label: 'Unit', width: 45 },
      { key: 'rate', label: 'Rate', width: 55 },
      { key: 'amount', label: 'Amount', width: 65 },
    ],
    rows: lineItems.map((li, idx) => ({
      srNo: idx + 1, description: li.description, itemCode: li.itemCode,
      quantity: li.quantity, unit: li.unit, rate: Number(li.rate || 0).toFixed(2), amount: Number(li.amount || 0).toFixed(2),
    })),
    footerNote: 'ABPS Portal — Auto-generated Purchase Order.',
  });
}

// ── BOQ PDF ────────────────────────────────────────────────────────────
async function generateBOQPdf({ projectId, customerName, productName, productRating, department, orderQuantity, materialRows, preparedBy, authorizedBy, version }) {
  return buildBOQPdfBuffer({ customerName, projectId, productName, productRating, department, orderQuantity, materialRows, preparedBy, authorizedBy, includeCosting: true, version });
}

// ── BOQ No-Cost PDF variant ─────────────────────────────────────────────
// Same layout as generateBOQPdf, minus Rate/Total Rate columns and the
// totals block — the customer-facing version code.js generated
// alongside the internal costing PDF.
async function generateBOQNoCostPdf({ projectId, customerName, productName, productRating, department, orderQuantity, materialRows, preparedBy, authorizedBy, version }) {
  return buildBOQPdfBuffer({ customerName, projectId, productName, productRating, department, orderQuantity, materialRows, preparedBy, authorizedBy, includeCosting: false, version });
}

// ── Job Card Letterhead PDF ─────────────────────────────────────────────
// Bespoke layout (like buildBOQPdfBuffer/buildPRNPdfBuffer) rather than the
// generic buildDocument() — centered company header, tight label:value
// spacing with wrapping, no table, no footer note, per explicit decision.
async function buildJobCardLetterheadPdfBuffer({ projectId, customerName, productName, productRating, department, jobCardNumber }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const centerText = (text, { size, bold = false, color = rgb(0, 0, 0) }) => {
    const f = bold ? boldFont : font;
    const width = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, size, font: f, color });
  };

  // ── Company header ──
  centerText('ABPS Solution Pvt Ltd', { size: 18, bold: true });
  y -= 22;
  centerText('Job Card Letterhead', { size: 14 });
  y -= 26;

  // ── Header info block — every value starts at the same fixed x, based
  // on the widest label in this set, rather than each value trailing its
  // own label at a different offset. Still wraps if a value would run
  // past the right margin.
  const headerLines = [
    ['Customer Name:', customerName || '\u2014'],
    ['Project ID:', projectId || '\u2014'],
    ['Product Name:', productName || '\u2014'],
    ['Product Rating:', productRating || '\u2014'],
    ['Department:', department || '\u2014'],
    ['Job Card Number:', jobCardNumber || '\u2014'],
  ];
  const headerMaxWidth = PAGE_WIDTH - MARGIN * 2;
  const widestLabel = Math.max(...headerLines.map(([label]) => boldFont.widthOfTextAtSize(label, 10)));
  const valueX = MARGIN + widestLabel + 4;
  const valueMaxWidth = headerMaxWidth - widestLabel - 4;
  headerLines.forEach((line) => {
    if (!line) { y -= 8; return; }
    const [label, value] = line;
    const wrapped = wrapTextLines(value, font, 10, valueMaxWidth);
    page.drawText(label, { x: MARGIN, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
    wrapped.forEach((wLine, i) => {
      page.drawText(wLine, { x: valueX, y: y - i * 13, size: 10, font, color: rgb(0, 0, 0) });
    });
    y -= 15 + Math.max(0, wrapped.length - 1) * 13;
  });

  return pdfDoc.save();
}

async function buildProjectInvoicePdfBuffer({ projectId, boqs, jobCards }) {
  const rows = jobCards.map(jc => ({
    boqId: jc.boq_id,
    jobCard: `JC_Set${jc.set_number}`,
    use: jc.finished_good_use === 'Use in other Product' ? 'Used in other Product'
       : jc.finished_good_use === 'Keep in FG Store' ? 'Ready for Dispatch'
       : '—',
  }));
  const pdfDoc = await buildDocument({
    title: 'Project Invoice',
    subtitle: `Project ID: ${projectId}`,
    headerLines: [
      ['Project ID', projectId],
      ['Total BOQs', boqs.length],
      ['Total Job Cards', jobCards.length],
    ],
    columns: [
      { key: 'boqId', label: 'BOQ ID', width: 260, maxChars: 60 },
      { key: 'jobCard', label: 'Job Card', width: 100, maxChars: 20 },
      { key: 'use', label: 'Use', width: 140, maxChars: 30 },
    ],
    rows,
    footerNote: 'Generated by ABPS Portal — Project Invoice Generation',
  });
  return await pdfDoc.save();
}

async function generateJobCardLetterheadPdf({ projectId, customerName, productName, productRating, department, jobCardNumber }) {
  return buildJobCardLetterheadPdfBuffer({ projectId, customerName, productName, productRating, department, jobCardNumber });
}

module.exports = { formatINR, buildPRNPdfBuffer, generatePOPdf, generateBOQPdf, generateBOQNoCostPdf, generateJobCardLetterheadPdf, buildProjectInvoicePdfBuffer };