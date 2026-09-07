import { fromPaise } from './money.js';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inr(paise) {
  const n = fromPaise(paise || 0);
  return `₹${n.toFixed(2)}`;
}

function addr(a = {}) {
  return [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).map(esc).join(', ');
}

/**
 * Printable GST invoice / credit note. HTML-to-file v1 — the customer opens
 * this in a new window and prints (or Save as PDF). Never blocks issuance.
 */
export function renderInvoiceHtml(doc) {
  const totals = doc.totals || {};
  const rupees = doc.totalsRupees;
  const isCredit = doc.docType === 'credit_note';
  const title = isCredit ? 'Tax Credit Note' : 'Tax Invoice';
  const lines = doc.lines || [];

  const rows = lines.map((l) => `
    <tr>
      <td>${esc(l.description)}</td>
      <td class="mono">${esc(l.hsnCode || '—')}</td>
      <td class="num">${esc(l.qty)} ${esc(l.uom || '')}</td>
      <td class="num">${inr(l.unitPricePaise)}</td>
      <td class="num">${inr(l.taxableValuePaise)}</td>
      <td class="num">${((l.rateBps || 0) / 100).toFixed(0)}%</td>
      <td class="num">${inr((l.cgstPaise || 0) + (l.sgstPaise || 0) + (l.igstPaise || 0) + (l.cessPaise || 0))}</td>
      <td class="num">${inr(l.lineTotalPaise)}</td>
    </tr>`).join('');

  const grand = rupees?.grandTotal != null ? `₹${Number(rupees.grandTotal).toFixed(2)}` : inr(totals.grandTotalPaise);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} ${esc(doc.number)}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #1e293b; margin: 32px; font-size: 13px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .muted { color: #64748b; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; text-align: left; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
    .num, .mono { font-variant-numeric: tabular-nums; }
    .num { text-align: right; }
    .mono { font-family: ui-monospace, monospace; }
    .totals { margin-left: auto; width: 280px; margin-top: 16px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .grand { font-weight: 700; font-size: 15px; border-top: 1px solid #cbd5e1; margin-top: 6px; padding-top: 8px; }
    @media print { body { margin: 12mm; } button { display: none; } }
  </style>
</head>
<body>
  <button onclick="window.print()" style="float:right;padding:8px 12px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer">Print / Save PDF</button>
  <p class="muted" style="margin:0 0 4px">${isCredit ? 'CREDIT NOTE' : 'ORIGINAL FOR RECIPIENT'}</p>
  <h1>${esc(title)}</h1>
  <p class="mono">${esc(doc.number)}${doc.originalNumber ? ` · against ${esc(doc.originalNumber)}` : ''}</p>
  <p class="muted">Order ${esc(doc.orderNumber)} · ${esc(doc.supplyDate ? new Date(doc.supplyDate).toLocaleDateString('en-IN') : '')}</p>

  <div class="grid">
    <div>
      <p class="muted" style="margin:0 0 4px">Supplier</p>
      <strong>${esc(doc.supplier?.tradeName || doc.supplier?.name)}</strong>
      ${doc.supplier?.gstin ? `<p class="mono">GSTIN ${esc(doc.supplier.gstin)}</p>` : '<p class="muted">Unregistered</p>'}
      <p>${addr(doc.supplier?.address)}</p>
    </div>
    <div>
      <p class="muted" style="margin:0 0 4px">Recipient</p>
      <strong>${esc(doc.recipient?.name)}</strong>
      <p>${addr(doc.recipient?.address)}</p>
      ${doc.recipient?.phone ? `<p>${esc(doc.recipient.phone)}</p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th><th>HSN</th><th class="num">Qty</th><th class="num">Price</th>
        <th class="num">Taxable</th><th class="num">GST</th><th class="num">Tax</th><th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div><span class="muted">Taxable value</span><span>${inr(totals.taxableValuePaise)}</span></div>
    ${(totals.cgstPaise || 0) > 0 ? `<div><span class="muted">CGST</span><span>${inr(totals.cgstPaise)}</span></div>` : ''}
    ${(totals.sgstPaise || 0) > 0 ? `<div><span class="muted">SGST</span><span>${inr(totals.sgstPaise)}</span></div>` : ''}
    ${(totals.igstPaise || 0) > 0 ? `<div><span class="muted">IGST</span><span>${inr(totals.igstPaise)}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${grand}</span></div>
  </div>
  ${doc.amountInWords ? `<p class="muted">${esc(doc.amountInWords)}</p>` : ''}
  <p class="muted" style="margin-top:32px">Prices are GST-inclusive MRP. This document is a reconstruction of what was charged.</p>
</body>
</html>`;
}

export default renderInvoiceHtml;
