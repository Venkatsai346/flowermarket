/**
 * GST invoice PDF — unit, no DB.
 *
 * A generated buffer must be a real PDF 1.4 document whose bytes contain the
 * invoice number, the parties, and the grand total. Issuance must never
 * depend on this file succeeding (callers catch); this suite proves the
 * renderer itself is not a stub.
 *
 * Run: node scripts/invoice-pdf.test.js
 */
import assert from 'node:assert/strict';
import { renderInvoicePdf } from '../src/utils/invoicePdf.js';

let passed = 0;
function ok(name) { passed += 1; console.log(`  PASS  ${name}`); }

const sample = {
  docType: 'invoice',
  number: 'FM/25-26/000042',
  orderNumber: 'FM-24001',
  supplyDate: '2026-04-12T10:00:00.000Z',
  amountInWords: 'Rupees Two Hundred Forty Eight Only',
  supplier: {
    name: 'Bloomy Hyderabad',
    tradeName: 'Bloomy',
    gstin: '36AABCU9603R1ZM',
    address: { line1: 'Banjara Hills', city: 'Hyderabad', state: 'Telangana', pincode: '500034' },
  },
  recipient: {
    name: 'Asha Rao',
    address: { line1: '12 MG Road', city: 'Hyderabad', state: 'Telangana', pincode: '500001' },
    phone: '9876543210',
  },
  lines: [
    {
      description: 'Red rose bunch',
      hsnCode: '0603',
      qty: 2,
      uom: 'BUN',
      taxableValuePaise: 18952,
      rateBps: 500,
      cgstPaise: 474,
      sgstPaise: 474,
      igstPaise: 0,
      cessPaise: 0,
      lineTotalPaise: 19900,
    },
    {
      description: 'Delivery charges',
      hsnCode: '996812',
      qty: 1,
      uom: 'OTH',
      taxableValuePaise: 4900,
      rateBps: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
      lineTotalPaise: 4900,
    },
  ],
  totals: {
    taxableValuePaise: 23852,
    cgstPaise: 474,
    sgstPaise: 474,
    igstPaise: 0,
    cessPaise: 0,
    roundOffPaise: 0,
    grandTotalPaise: 24800,
  },
};

function main() {
  console.log('\ninvoice-pdf\n');

  const buf = renderInvoicePdf(sample);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 800, `pdf too small: ${buf.length}`);
  ok(`emits a buffer (${buf.length} bytes)`);

  const ascii = buf.toString('latin1');
  assert.ok(ascii.startsWith('%PDF-1.4'), ascii.slice(0, 16));
  assert.ok(ascii.includes('%%EOF'));
  assert.ok(/startxref\n\d+/.test(ascii));
  ok('PDF 1.4 header, xref, EOF');

  assert.ok(ascii.includes('FM/25-26/000042'), 'missing document number');
  assert.ok(ascii.includes('TAX INVOICE'));
  assert.ok(ascii.includes('Bloomy'));
  assert.ok(ascii.includes('Asha Rao'));
  assert.ok(ascii.includes('36AABCU9603R1ZM'));
  assert.ok(ascii.includes('Red rose bunch'));
  assert.ok(ascii.includes('Rs. 248.00') || ascii.includes('Rs. 248.00'.replace(' ', ' ')));
  ok('contains number, parties, line, grand total');

  // CGST + SGST identity is a money invariant the invoice must display.
  assert.ok(ascii.includes('CGST'));
  assert.ok(ascii.includes('SGST'));
  ok('splits GST heads on the invoice');

  const credit = renderInvoicePdf({ ...sample, docType: 'credit_note', number: 'CN/25-26/000001', originalNumber: sample.number });
  const cAscii = credit.toString('latin1');
  assert.ok(cAscii.includes('TAX CREDIT NOTE'));
  assert.ok(cAscii.includes('CN/25-26/000001'));
  assert.ok(cAscii.includes('Against FM/25-26/000042'));
  ok('credit note variant');

  const empty = renderInvoicePdf({});
  assert.ok(empty.toString('latin1').startsWith('%PDF-1.4'));
  ok('empty doc still produces a PDF (never throws)');

  console.log(`\n${passed} passed`);
}

main();
