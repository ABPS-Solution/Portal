// ═══════════════════════════════════════════════════════════════════════
// lib/poTemplate.js — Raw Material Purchase Order HTML, ported from
// code.js's renderPurchaseOrderHTML_ + numberToWordsINR_ + the
// PO_PERMANENT_TERMS constant, so the Node PO document matches the
// legacy Apps Script output exactly.
// ═══════════════════════════════════════════════════════════════════════

const PO_PERMANENT_TERMS = [
  'Kindly Send Your Order Acceptance within 3 Days of Receipt of Order failing which it will be considered that order is accepted unconditionally.',
  'Timely Delivery is Essence of the Order.',
  'Mention Our P.O. No. on your Invoice.',
  'Mention Our Item Codes on your Invoice.',
  'Please submit 3 Copy of your TAX INVOICE with Material.',
  'Material T.C. & Dimensional Report Should Accompany The Material',
];

function numberToWordsINR(amount) {
  amount = Math.round(parseFloat(amount) || 0);
  if (amount === 0) return 'Zero Rupees Only';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const twoDigit = (n) => n < 20 ? ones[n] : tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
  const threeDigit = (n) => (n >= 100 ? ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' : '') : '') + (n%100 ? twoDigit(n%100) : '');
  let words = '';
  const crore = Math.floor(amount / 10000000); amount %= 10000000;
  const lakh  = Math.floor(amount / 100000);   amount %= 100000;
  const thousand = Math.floor(amount / 1000);  amount %= 1000;
  const hundred = amount;
  if (crore)    words += threeDigit(crore) + ' Crore ';
  if (lakh)     words += twoDigit(lakh) + ' Lakh ';
  if (thousand) words += twoDigit(thousand) + ' Thousand ';
  if (hundred)  words += threeDigit(hundred);
  return words.trim() + ' Rupees Only';
}

function renderPurchaseOrderHTML(data) {
  const money = (n) => (parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => (s == null ? '' : s.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  // For quantity/rate/discount — 87 stays 87, 87.2 stays 87.2, never a
  // forced 87.00. Amount/Sub Total/Grand Total etc. keep money()'s
  // fixed 2-decimal currency formatting; this is only for the
  // measurement-style columns.
  const qtyFmt = (n) => (Math.round((parseFloat(n) || 0) * 100) / 100).toLocaleString('en-IN');
  // pg returns DATE/TIMESTAMPTZ columns as JS Date objects — esc()'s
  // .toString() on one of those was dumping the full
  // "Tue Jul 28 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"
  // representation straight onto the document. UTC methods specifically
  // (not local Date methods) since the stored value is midnight UTC —
  // using local getters could shift the calendar date by a day
  // depending on the server process's timezone.
  const fmtDate = (d) => {
    if (!d) return '';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return esc(d);
    const day = String(dt.getUTCDate()).padStart(2, '0');
    const mon = dt.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return `${day} ${mon} ${dt.getUTCFullYear()}`;
  };

  let totalQty = 0, subTotal = 0;
  const items = data.lineItems || [];
  const rowsHtml = items.map((it, i) => {
    const qty = parseFloat(it.quantity) || 0;
    const rate = parseFloat(it.rate) || 0;
    const disc = parseFloat(it.discountPercent) || 0;
    const amount = qty * rate * (100 - disc) / 100;
    totalQty += qty; subTotal += amount;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td class="l desc">${esc(it.description)}</td>
      <td class="c">${esc(it.itemCode)}</td>
      <td class="c">${qtyFmt(qty)}</td>
      <td class="c">${qtyFmt(rate)}</td>
      <td class="c">${esc(it.unit || 'Nos')}</td>
      <td class="c">${disc ? qtyFmt(disc) : ''}</td>
      <td class="r">${money(amount)}</td>
    </tr>`;
  }).join('');

  const cgstP = parseFloat(data.cgstPercent) || 0, sgstP = parseFloat(data.sgstPercent) || 0, igstP = parseFloat(data.igstPercent) || 0;
  const cgstAmt = subTotal * cgstP / 100, sgstAmt = subTotal * sgstP / 100, igstAmt = subTotal * igstP / 100;
  const packing = parseFloat(data.packing) || 0, freight = parseFloat(data.freight) || 0;
  const other = parseFloat(data.other) || 0, roundOff = parseFloat(data.roundOff) || 0;
  const grandTotal = subTotal + cgstAmt + sgstAmt + igstAmt + packing + freight + other + roundOff;

  const permanentTerms = PO_PERMANENT_TERMS.map(t => esc(t)).join('<br>');
  const logoUrl = 'https://drive.google.com/thumbnail?id=1otmP6wyBnA953B1CrJg-sI7h3F-eeD_b&sz=w1000';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; }
    .sheet { width: 100%; border: 1px solid #000; }
    .title { text-align: center; font-size: 15pt; font-weight: bold; padding: 8px; border-bottom: 1px solid #000; }
    .top { display: flex; border-bottom: 1px solid #000; }
    .top .left { width: 61%; border-right: 1px solid #000; display: flex; }
    .top .right { width: 39%; }
    .logo-box { width: 150px; flex-shrink: 0; padding: 8px; display: flex; align-items: flex-start; justify-content: center; }
    .logo-box img { width: 100%; height: auto; display: block; border: none; outline: none; }
    .co-info { padding: 10px 10px 10px 4px; line-height: 1.35; }
    .co-info .gstin-gap { margin-top: 10px; }
    .co-info .name { font-size: 12pt; font-weight: bold; padding: 4px 0; }
    .top .right .co-info { padding: 10px; }
    table.meta { width: 100%; border-collapse: collapse; table-layout: fixed; border-bottom: 1px solid #000; }
    table.meta td { padding: 5px 8px; border-right: 1px solid #000; border-top: none; border-bottom: none; overflow: hidden; }
    table.meta td:last-child { border-right: none; }
    table.meta b { font-weight: bold; }
    table.items { width: 100%; border-collapse: collapse; border-spacing: 0; table-layout: fixed; }
    table.items th, table.items td { border: 1px solid #000; padding: 5px 6px; vertical-align: middle; }
    table.items th { border: 1px solid #000; background: #f0f0f0; text-align: center; font-weight: bold; }
    table.items th:first-child, table.items td:first-child { border-left: none; }
    table.items th:last-child, table.items td:last-child { border-right: none; }
    table.items td.c { text-align: center; } td.l { text-align: left; } td.r { text-align: right; }
    table.items col.w-sr { width: 7%; } col.w-desc { width: 32%; } col.w-code { width: 12%; }
    col.w-qty { width: 8%; } col.w-rate { width: 10%; } col.w-per { width: 7%; } col.w-disc { width: 10%; } col.w-amt { width: 14%; }
    tr.total td { font-weight: bold; text-align: center; border: 1px solid #000; }
    tr.total td.r { text-align: right; }
    .footer-wrap { margin-top: 40px; break-inside: avoid; page-break-inside: avoid; }
    .footer-tbl { width: 100%; border-collapse: collapse; }
    .footer-tbl td { border: 1px solid #000; padding: 5px 8px; vertical-align: middle; font-size: 9pt; }
    .footer-tbl td:last-child { border-right: none; }
    .footer-tbl .tw-label, .footer-tbl .terms-cell { border-left: none; }
    .footer-tbl .tw-label { vertical-align: middle; border-right: none; }
    .footer-tbl .tw-val { font-weight: bold; vertical-align: middle; border-left: none; }
    .footer-tbl .terms-cell { vertical-align: top; font-size: 8pt; line-height: 1.5; }
    .footer-tbl .terms-cell .th { font-weight: bold; font-size: 9pt; }
    .footer-tbl .terms-cell .perm { font-weight: bold; }
    .footer-tbl .cv { text-align: right; }
    .footer-tbl tr.gt td { font-weight: bold; }
    .decl-tbl { width: 100%; border-collapse: collapse; }
    .decl-tbl td { border: 1px solid #000; padding: 8px; font-size: 8pt; }
    .decl-tbl td:last-child { border-right: none; }
    .decl-tbl .decl-cell { border-left: none; }
    .decl-tbl .decl-cell { vertical-align: top; line-height: 1.4; }
    .decl-tbl .for-abps { text-align: right; font-weight: bold; font-size: 9pt; }
    .decl-tbl .sign-space { height: 70px; border-top: none; border-bottom: none; }
    .decl-tbl .sig-name { text-align: center; vertical-align: bottom; }
    @page { size: A4 portrait; margin: 10mm; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
  </style></head><body>
  <div class="sheet">
    <div class="title">Purchase Order</div>
    <div class="top">
      <div class="left">
        <div class="logo-box"><img src="${logoUrl}" alt=""></div>
        <div class="co-info">
          <div class="label">Invoice To</div>
          <div class="name">ABPS SOLUTION PRIVATE LIMITED</div>
          <div>Gat No. 258/1, Plot No. 8/2, Village Khalumbre, Chakan - Talegaon Road, Tal. Khed, near Lohr TSI Compound, Pune, Maharashtra 410501</div>
          <div class="gstin-gap">GSTIN/UIN : 27AASCA4081G1ZF</div>
          <div>State Name : Maharashtra &nbsp;&nbsp;&nbsp; Code : 27</div>
          <div>E-Mail : purchase@abpowerindia.com</div>
        </div>
      </div>
      <div class="right">
        <div class="co-info">
          <div class="label">Supplier Details</div>
          <div class="name">${esc(data.vendorName)}</div>
          <div>${esc(data.vendorAddress)}</div>
          <div class="gstin-gap">GSTIN/UIN : ${esc(data.vendorGstin)}</div>
          <div>State Name : ${esc(data.vendorState)} &nbsp;&nbsp;&nbsp; Code : ${esc(data.vendorCode)}</div>
          <div>E-Mail : ${esc(data.vendorEmail || '')}</div>
        </div>
      </div>
    </div>
    <table class="meta">
      <colgroup><col style="width:25%"><col style="width:34%"><col style="width:17%"><col style="width:24%"></colgroup>
      <tr>
        <td>P.O. No. : <b>${esc(data.poNumber)}</b></td>
        <td>Supplier Offer No : <b>${esc(data.supplierRef || '')}</b></td>
        <td>Date: <b>${fmtDate(data.orderDate)}</b></td>
        <td>Delivery Date : <b>${fmtDate(data.deliveryDate)}</b></td>
      </tr>
    </table>
    <table class="items">
      <colgroup>
        <col class="w-sr"><col class="w-desc"><col class="w-code"><col class="w-qty">
        <col class="w-rate"><col class="w-per"><col class="w-disc"><col class="w-amt">
      </colgroup>
      <thead><tr>
        <th>Sr.No</th><th>Description Of Goods</th><th>Item Code</th><th>Quantity</th>
        <th>Rate /<br>Quantity</th><th>Per</th><th>Discount %</th><th>Amount</th>
      </tr></thead>
      <tbody>
        ${rowsHtml}
        <tr class="total">
          <td colspan="3">Total</td><td>${qtyFmt(totalQty)}</td><td colspan="3"></td><td class="r">${money(subTotal)}</td>
        </tr>
      </tbody>
    </table>
    <div class="footer-wrap">
    <table class="footer-tbl">
      <colgroup>
        <col style="width:20%"><col style="width:47%"><col style="width:19%"><col style="width:14%">
      </colgroup>
      <tr class="tax-row">
        <td class="tw-label">Tax Amount (in words) :</td>
        <td class="tw-val">${esc(numberToWordsINR(grandTotal))}</td>
        <td class="cl">Sub Total</td>
        <td class="cv">${money(subTotal)}</td>
      </tr>
      <tr>
        <td colspan="2" rowspan="8" class="terms-cell">
          <span class="th">Terms &amp; Condition :</span><br><br>
          WARRANTY : ${esc(data.warranty || '')}<br>
          Payment Terms : ${esc(data.paymentTerms || '')}<br>
          Freight : ${esc(data.freightTerms || '')}<br><br>
          <span class="perm">${permanentTerms}</span>
        </td>
        <td class="cl">CGST &nbsp; ${cgstP} %</td><td class="cv">${money(cgstAmt)}</td>
      </tr>
      <tr><td class="cl">SGST &nbsp; ${sgstP} %</td><td class="cv">${money(sgstAmt)}</td></tr>
      <tr><td class="cl">IGST &nbsp; ${igstP} %</td><td class="cv">${money(igstAmt)}</td></tr>
      <tr><td class="cl">Packing</td><td class="cv">${money(packing)}</td></tr>
      <tr><td class="cl">Freight</td><td class="cv">${money(freight)}</td></tr>
      <tr><td class="cl">Other</td><td class="cv">${money(other)}</td></tr>
      <tr><td class="cl">Round Off</td><td class="cv">${money(roundOff)}</td></tr>
      <tr class="gt"><td class="cl">Grand Total</td><td class="cv">${money(grandTotal)}</td></tr>
    </table>
    <table class="decl-tbl">
      <colgroup><col style="width:34%"><col style="width:22%"><col style="width:22%"><col style="width:22%"></colgroup>
      <tr>
        <td rowspan="3" class="decl-cell">Declaration<br>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</td>
        <td colspan="3" class="for-abps">for ABPS SOLUTION PRIVATE LIMITED</td>
      </tr>
      <tr><td colspan="3" class="sign-space"></td></tr>
      <tr>
        <td class="sig-name">Prepared By<br>${esc(data.preparedBy || '')}</td>
        <td class="sig-name">Checked By<br>${esc(data.authorizedBy || '')}</td>
        <td class="sig-name">Authorized By<br>${esc(data.authorizedBy || '')}</td>
      </tr>
    </table>
    </div>
  </div>
  </body></html>`;
}

module.exports = { renderPurchaseOrderHTML, numberToWordsINR, PO_PERMANENT_TERMS };