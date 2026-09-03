import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUPON_STATUS_META,
  DISCOUNT_TYPE_META,
  REFUND_FEE_POLICY_META,
  couponPayload,
  deliveryFeePayload,
  emptyCoupon,
} from './policiesMeta.js';

test('discount, coupon and refund policy meta cover backend enums', () => {
  for (const s of ['flat', 'percent']) assert.ok(DISCOUNT_TYPE_META[s], `missing discount ${s}`);
  for (const s of ['active', 'disabled', 'expired']) assert.ok(COUPON_STATUS_META[s], `missing coupon ${s}`);
  for (const s of ['never', 'full_order_return_only', 'always']) assert.ok(REFUND_FEE_POLICY_META[s], `missing refund policy ${s}`);
});

test('coupon payload normalizes code and numeric fields', () => {
  const p = couponPayload({ ...emptyCoupon(), code: '  welcome  ', discountType: 'percent', value: '10', minCartValue: '499', maxDiscountCap: '', usageLimitPerCustomer: '2', validFrom: '', validTo: '', isPlatformWide: false });
  assert.equal(p.code, 'WELCOME');
  assert.equal(p.value, 10);
  assert.equal(p.minCartValue, 499);
  assert.equal(p.maxDiscountCap, null);
  assert.equal(p.usageLimitPerCustomer, 2);
  assert.equal(p.validFrom, null);
  assert.equal(p.validTo, null);
  assert.equal(p.isPlatformWide, false);
});

test('delivery fee payload maps optional blanks to null', () => {
  const p = deliveryFeePayload({ name: ' default ', baseFee: '49', freeDeliveryThreshold: '', expressSurgeMultiplier: '', distanceFeePerKm: '', effectiveFrom: '', effectiveTo: '' });
  assert.equal(p.name, 'default');
  assert.equal(p.baseFee, 49);
  assert.equal(p.freeDeliveryThreshold, null);
  assert.equal(p.expressSurgeMultiplier, null);
  assert.equal(p.distanceFeePerKm, null);
  assert.equal(p.effectiveFrom, null);
  assert.equal(p.effectiveTo, null);
});
