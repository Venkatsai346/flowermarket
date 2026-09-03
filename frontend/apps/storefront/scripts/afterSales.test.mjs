/**
 * Pure tests for the storefront after-sales vocabulary.
 *
 * No DOM, no network, no Mongo — a customer-facing status map and a couple of
 * quantity helpers have to be wrong the same way money has to be wrong: never.
 * Run with `npm run test -w @flower-market/storefront`.
 */
import assert from 'node:assert/strict';
import {
  CANCEL_REASONS,
  RETURN_CLAIM_META,
  RETURN_REASONS,
  RETURN_STATUS_META,
  canCancel,
  canPickupReturn,
  canReturn,
  meta,
  remainingQty,
  signedMoney,
} from '../src/lib/afterSales.js';

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ✅ ${name}`);
};

console.log('after-sales helpers:');

ok("cancel is allowed exactly on the backend's cancellable states", () => {
  for (const s of ['created', 'payment_pending', 'confirmed', 'picking', 'packed', 'delivery_failed']) {
    assert.equal(canCancel(s), true, `${s} should be cancellable`);
  }
  for (const s of ['delivered', 'cancelled', 'return_requested', 'refunded']) {
    assert.equal(canCancel(s), false, `${s} should not be cancellable`);
  }
});

ok('remainingQty never leaks a negative number', () => {
  assert.equal(remainingQty({ qty: 5, returnedQty: 2 }), 3);
  assert.equal(remainingQty({ qty: 5, returnedQty: 9 }), 0);
  assert.equal(remainingQty({ qty: 0 }), 0);
  assert.equal(remainingQty({}), 0);
});

ok('a line is pickup-returnable only when flagged returnable and non-zero', () => {
  assert.equal(canPickupReturn({ isReturnable: true, qty: 3, returnedQty: 1 }), true);
  assert.equal(canPickupReturn({ isReturnable: false, qty: 3 }), false);
  assert.equal(canPickupReturn({ isReturnable: true, qty: 2, returnedQty: 2 }), false);
});

ok('an order can start a return only after delivery with a remaining line', () => {
  assert.equal(canReturn({ status: 'delivered' }, [{ qty: 1 }]), true);
  assert.equal(canReturn({ status: 'confirmed' }, [{ qty: 1 }]), false);
  assert.equal(canReturn({ status: 'delivered' }, [{ qty: 1, returnedQty: 1 }]), false);
});

ok('meta falls back to title-case rather than crashing on a new status', () => {
  assert.deepEqual(meta('pickup_qc', RETURN_CLAIM_META), RETURN_CLAIM_META.pickup_qc);
  const fallback = meta('some_new_status', null);
  assert.equal(fallback.label, 'Some New Status');
});

ok('wallet amounts carry an explicit sign and keep the Indian grouping', () => {
  assert.equal(signedMoney(100, 'credit'), '+₹100');
  assert.equal(signedMoney(1000, 'credit'), '+₹1,000');
  assert.equal(signedMoney(1000, 'debit'), '−₹1,000');
});

ok('every display map covers its documented machine values', () => {
  for (const code of ['requested', 'approved', 'rejected', 'picked_up', 'qc_passed', 'qc_failed', 'refund_initiated', 'refunded', 'refund_rejected']) {
    assert.ok(RETURN_STATUS_META[code], `return status ${code} should have copy`);
  }
  for (const code of ['pickup_qc', 'instant_claim']) {
    assert.ok(RETURN_CLAIM_META[code], `claim type ${code} should have copy`);
  }
  assert.ok(CANCEL_REASONS.length >= 4, 'customers need a real pick list');
  assert.ok(RETURN_REASONS.length >= 5, 'return reasons should not be one option');
});

console.log(`\nafter-sales helpers: ${passed} passed, 0 failed\n✅ every after-sales display invariant holds`);
