/**
 * GST invoice / credit-note PDF (Wave 2 / B4).
 *
 * A self-contained PDF 1.4 writer — no native deps, no headless Chrome, no
 * npm. Helvetica only (WinAnsi). The rupee sign is not in WinAnsi so amounts
 * render as `Rs. 1,299.50`, which is the conventional Indian tax-document
 * form and is what a CA expects on a printout.
 *
 * Never throws on "ugly" input: missing parties become em-dashes, empty
 * line lists still produce a numbered document. Callers MUST catch anyway
 * — issuing the TaxDocument is the legal event; the PDF is evidence.
 */

import { fromPaise } from './money.js';

const PAGE_W = 595; // A4
const PAGE_H = 842;
const MARGIN = 40;
const ROW_H = 16;
const HEADER_H = 46;

function pdfEscape(s) {
  return String(s ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[^\x20-\x7E]/g, (ch) => {
      if (ch === '—') return '--';
      if (ch === '–') return '-';
      if (ch === '’' || ch === '‘') return "'";
      if (ch === '“' || ch === '”') return '"';
      return ' ';
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function inr(paise) {
  const n = fromPaise(paise || 0);
  const formatted = n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Rs. ${formatted}`;
}

function partyLines(p = {}) {
  const a = p.address || {};
  return [
    p.tradeName || p.name || '--',
    p.gstin ? `GSTIN ${p.gstin}` : 'Unregistered',
    [a.line1, a.line2].filter(Boolean).join(', '),
    [a.city, a.state, a.pincode].filter(Boolean).join(', '),
    p.phone || p.email || '',
  ].filter(Boolean);
}

function wrap(text, widthChars) {
  const s = String(text || '');
  if (s.length <= widthChars) return [s];
  const out = [];
  let rest = s;
  while (rest.length > widthChars) {
    let cut = rest.lastIndexOf(' ', widthChars);
    if (cut < 8) cut = widthChars;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function dateIn(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function contentStream(doc) {
  const isCredit = doc.docType === 'credit_note';
  const title = isCredit ? 'TAX CREDIT NOTE' : 'TAX INVOICE';
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  const totals = doc.totals || {};
  const ops = [];

  const push = (s) => ops.push(s);
  const fillRect = (x, y, w, h, r, g, b) => {
    push(`${r} ${g} ${b} rg`);
    push(`${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
    push('0 0 0 rg');
  };
  const text = (str, x, y, { size = 10, bold = false, r = 0, g = 0, b = 0 } = {}) => {
    const font = bold ? 'F2' : 'F1';
    push('BT');
    push(`/${font} ${size} Tf`);
    push(`${r} ${g} ${b} rg`);
    push(`1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm`);
    push(`(${pdfEscape(str)}) Tj`);
    push('ET');
    push('0 0 0 rg');
  };

  // Brand bar
  fillRect(0, PAGE_H - HEADER_H, PAGE_W, HEADER_H, 0.72, 0.09, 0.29);
  text('BLOOMY', MARGIN, PAGE_H - 30, { size: 16, bold: true, r: 1, g: 1, b: 1 });
  text(isCredit ? 'CREDIT NOTE' : 'ORIGINAL FOR RECIPIENT', PAGE_W - MARGIN - 150, PAGE_H - 28, {
    size: 9, r: 1, g: 0.92, b: 0.94,
  });

  let y = PAGE_H - HEADER_H - 28;
  text(title, MARGIN, y, { size: 16, bold: true });
  y -= 16;
  text(doc.number || '', MARGIN, y, { size: 11, bold: true });
  if (doc.originalNumber) text(`Against ${doc.originalNumber}`, MARGIN + 160, y, { size: 9 });
  y -= 14;
  text(`Order ${doc.orderNumber || '--'}  ·  ${dateIn(doc.supplyDate)}`, MARGIN, y, { size: 9, r: 0.4, g: 0.45, b: 0.5 });

  y -= 22;
  text('Supplier', MARGIN, y, { size: 8, r: 0.4, g: 0.45, b: 0.5 });
  text('Recipient', 310, y, { size: 8, r: 0.4, g: 0.45, b: 0.5 });
  y -= 14;
  const left = partyLines(doc.supplier);
  const right = partyLines(doc.recipient);
  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i += 1) {
    if (left[i]) text(left[i], MARGIN, y, { size: i === 0 ? 11 : 9, bold: i === 0 });
    if (right[i]) text(right[i], 310, y, { size: i === 0 ? 11 : 9, bold: i === 0 });
    y -= 12;
  }

  y -= 10;
  // Table header
  fillRect(MARGIN, y - 4, PAGE_W - 2 * MARGIN, 16, 0.96, 0.96, 0.97);
  const cols = [
    { x: MARGIN + 4, w: 150, label: 'Item' },
    { x: 230, w: 50, label: 'HSN' },
    { x: 290, w: 40, label: 'Qty' },
    { x: 340, w: 55, label: 'Taxable' },
    { x: 410, w: 36, label: 'GST' },
    { x: 455, w: 100, label: 'Total' },
  ];
  for (const c of cols) text(c.label, c.x, y, { size: 8, r: 0.4, g: 0.45, b: 0.5 });
  y -= ROW_H + 2;

  const bottom = 120;
  for (const line of lines) {
    if (y < bottom) {
      text('(continued on following page in HTML copy)', MARGIN, y, { size: 8, r: 0.5, g: 0.5, b: 0.5 });
      break;
    }
    const desc = wrap(line.description || 'Item', 28)[0];
    const tax = (line.cgstPaise || 0) + (line.sgstPaise || 0) + (line.igstPaise || 0) + (line.cessPaise || 0);
    const gstPct = ((line.rateBps || 0) / 100).toFixed(0);
    text(desc, cols[0].x, y, { size: 9 });
    text(String(line.hsnCode || '--'), cols[1].x, y, { size: 8 });
    text(`${line.qty ?? ''} ${line.uom || ''}`.trim(), cols[2].x, y, { size: 8 });
    text(inr(line.taxableValuePaise), cols[3].x, y, { size: 8 });
    text(`${gstPct}%`, cols[4].x, y, { size: 8 });
    text(inr(line.lineTotalPaise), cols[5].x, y, { size: 8 });
    y -= ROW_H;
  }

  y -= 8;
  const boxX = 340;
  const row = (label, value, bold = false) => {
    text(label, boxX, y, { size: 9, bold, r: bold ? 0 : 0.4, g: bold ? 0 : 0.45, b: bold ? 0 : 0.5 });
    text(value, boxX + 120, y, { size: 9, bold });
    y -= 14;
  };
  row('Taxable value', inr(totals.taxableValuePaise));
  if ((totals.cgstPaise || 0) > 0) row('CGST', inr(totals.cgstPaise));
  if ((totals.sgstPaise || 0) > 0) row('SGST', inr(totals.sgstPaise));
  if ((totals.igstPaise || 0) > 0) row('IGST', inr(totals.igstPaise));
  if ((totals.cessPaise || 0) > 0) row('Cess', inr(totals.cessPaise));
  if ((totals.roundOffPaise || 0) !== 0) row('Round off', inr(totals.roundOffPaise));
  y -= 2;
  push('0.8 0.82 0.84 RG');
  push(`${boxX} ${y + 10} 215 0.6 re S`);
  push('0 0 0 RG');
  row('Grand total', inr(totals.grandTotalPaise), true);

  y -= 8;
  if (doc.amountInWords) {
    for (const w of wrap(doc.amountInWords, 90)) {
      text(w, MARGIN, y, { size: 9, r: 0.3, g: 0.35, b: 0.4 });
      y -= 12;
    }
  }

  text('Prices are GST-inclusive MRP. This document reconstructs what was charged.', MARGIN, 56, {
    size: 8, r: 0.45, g: 0.5, b: 0.55,
  });
  text('Computer-generated tax invoice — signature not required under GST rules.', MARGIN, 44, {
    size: 8, r: 0.45, g: 0.5, b: 0.55,
  });

  return ops.join('\n');
}

function buildPdf(stream) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const contents = add(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
  const page = add(
    `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contents} 0 R `
    + `/Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> >>`,
  );
  const pages = add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);

  // Patch the page parent to the pages object (1-based ids).
  objects[page - 1] = objects[page - 1].replace('/Parent 0 0 R', `/Parent ${pages} 0 R`);

  const encoder = (i) => `${i} 0 obj\n${objects[i - 1]}\nendobj\n`;
  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let i = 1; i <= objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(body, 'utf8');
    body += encoder(i);
  }
  const xrefAt = Buffer.byteLength(body, 'utf8');
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'utf8');
}

/**
 * @param {object} doc  a tax document (paise totals, parties, lines)
 * @returns {Buffer}    PDF 1.4 bytes
 */
export function renderInvoicePdf(doc = {}) {
  return buildPdf(contentStream(doc));
}

export default renderInvoicePdf;
