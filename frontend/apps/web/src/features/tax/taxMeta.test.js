import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_NOTE_REASON_META,
  STATUTORY_RATE_KIND_META,
  TAX_DOC_STATUS_META,
  TAX_NATURE_OF_SUPPLY_META,
  TAX_REGISTRATION_TYPE_META,
  registrationPayload,
  registrationToForm,
  statutoryRatePayload,
  taxPolicyPayload,
} from './taxMeta.js';

test('tax meta covers backend enums', () => {
  for (const k of ['invoice', 'credit_note']) assert.ok(TAX_DOC_STATUS_META && k);
  for (const k of ['draft', 'issued', 'cancelled']) assert.ok(TAX_DOC_STATUS_META[k]);
  for (const k of ['regular', 'composition', 'unregistered']) assert.ok(TAX_REGISTRATION_TYPE_META[k]);
  for (const k of ['taxable', 'nil_rated', 'exempt', 'zero_rated', 'non_gst']) assert.ok(TAX_NATURE_OF_SUPPLY_META[k]);
  for (const k of ['return', 'cancellation', 'price_revision', 'deficiency', 'other']) assert.ok(CREDIT_NOTE_REASON_META[k]);
  assert.ok(STATUTORY_RATE_KIND_META.tcs_gst_52);
  assert.ok(STATUTORY_RATE_KIND_META.tds_194o);
});

test('registration payload normalizes gstin, pan and blank fields', () => {
  const payload = registrationPayload({
    legalName: '  Ramya Florists  ',
    tradeName: '',
    gstin: ' 37aaacb1234c1z5 ',
    pan: ' aaacb1234c ',
    address: { line1: '', line2: null, city: '', state: '', pincode: '' },
    contact: { email: '', phone: '' },
    invoiceFooter: '',
    invoiceTerms: '',
    signatureUrl: '',
  });
  assert.equal(payload.legalName, 'Ramya Florists');
  assert.equal(payload.tradeName, null);
  assert.equal(payload.gstin, '37AAACB1234C1Z5');
  assert.equal(payload.pan, 'AAACB1234C');
  assert.equal(payload.address.line1, null);
  assert.equal(payload.contact.email, null);
});

test('registration roundtrip preserves nested fields', () => {
  const form = registrationToForm({ gstin: '37AAACB1234C1Z5', address: { line1: 'Street' }, contact: { email: 'a@b.co' } });
  assert.equal(form.address.line1, 'Street');
  assert.equal(form.contact.email, 'a@b.co');
});

test('tax policy payload derives rateBps from percentage and keeps nature', () => {
  const p = taxPolicyPayload({ categoryId: 'abc', gstSlabPct: '18', natureOfSupply: 'taxable', cessBps: '', hsnCode: '0603', effectiveFrom: '2026-04-01' });
  assert.equal(p.gstSlabPct, 18);
  assert.equal(p.rateBps, 1800);
  assert.equal(p.cessBps, 0);
  assert.equal(p.effectiveFrom, '2026-04-01');
});

test('statutory payload converts percentage to bps', () => {
  const p = statutoryRatePayload({ kind: 'tds_194o', ratePct: '0.5', appliesTo: 'gross_sales', effectiveFrom: '2026-01-01', notificationRef: 'ref' });
  assert.equal(p.rateBps, 50);
  assert.equal(p.appliesTo, 'gross_sales');
  assert.equal(p.notificationRef, 'ref');
});
