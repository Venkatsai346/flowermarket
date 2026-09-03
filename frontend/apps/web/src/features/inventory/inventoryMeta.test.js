import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADJUSTMENT_TYPE_META, INVENTORY_HEALTH_META, SLOT_STATUS_META,
  adjustPayload, emptyAdjust, fmtPct, hubCreatePayload, hubToForm, parsePincodes,
} from './inventoryMeta.js';

test('inventory and slot meta cover backend enums', () => {
  for (const h of ['in_stock', 'low_stock', 'out_of_stock']) assert.ok(INVENTORY_HEALTH_META[h]);
  for (const a of ['restock', 'shrinkage', 'audit_correction', 'return_restock']) assert.ok(ADJUSTMENT_TYPE_META[a]);
  for (const s of ['open', 'closed', 'full', 'cancelled']) assert.ok(SLOT_STATUS_META[s]);
});

test('adjust payload requires non-zero integer change and trimmed reason', () => {
  const p = adjustPayload({ ...emptyAdjust(), type: 'restock', qtyChange: '10', reason: '  new stock  ', note: '' });
  assert.equal(p.qtyChange, 10);
  assert.equal(p.reason, 'new stock');
  assert.equal(p.note, null);
});

test('hub create payload parses pincodes and keeps only 6-digit codes', () => {
  const p = hubCreatePayload({ name: '  North hub ', code: 'NORTH', pincodes: '500001 500002, invalid 500001', defaultSlotCapacity: '40', isActive: true });
  assert.equal(p.name, 'North hub');
  assert.deepEqual(p.pincodes, ['500001', '500002']);
  assert.equal(p.defaultSlotCapacity, 40);
});

test('hub form roundtrip and pincode parser dedupe', () => {
  const form = hubToForm({ name: 'Hub', code: 'H', serviceablePincodes: ['500001', '500002'] });
  assert.equal(form.pincodes, '500001, 500002');
  assert.deepEqual(parsePincodes('500001, 500001 700000'), ['500001', '700000']);
  assert.deepEqual(parsePincodes('bad'), []);
});

test('fmtPct renders a decimal 0..1 as a percentage', () => {
  assert.equal(fmtPct(0.42), '42%');
  assert.equal(fmtPct(0), '0%');
});
