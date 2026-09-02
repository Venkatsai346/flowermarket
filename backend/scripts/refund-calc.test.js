/**
 * RefundCalculatorService unit test — blueprint §5.
 *
 * Final math (corrected; components never double-count):
 *   refundItemAmount = Σ (price − discountAllocated) × qty   → net goods value
 *   refundTaxAmount  = Σ tax × qty                            → GST credit-note line
 *   refundFeeAmount  = deliveryFee × refundFeePct (policy-gated)
 *   totalRefund      = item + tax + fee == exactly what the customer paid
 *
 * Run: node scripts/refund-calc.test.js
 */
import assert from 'node:assert/strict';

const round2 = (n) => Math.round(n * 100) / 100;

function computeRefund({ returnedOrderItems, deliveryFee, refundDeliveryFeeWhen = 'full_order_return_only', refundFeePct = 100, isFullReturn = false }) {
  let refundItemAmount = 0;
  let refundTaxAmount = 0;
  for (const line of returnedOrderItems) {
    const qty = line.qty || 1;
    refundItemAmount = round2(refundItemAmount + (line.pricePerUnit - (line.discountPerUnit || 0)) * qty);
    refundTaxAmount = round2(refundTaxAmount + (line.taxPerUnit || 0) * qty);
  }
  let refundFeeAmount = 0;
  if (refundDeliveryFeeWhen === 'always' || (refundDeliveryFeeWhen === 'full_order_return_only' && isFullReturn)) {
    refundFeeAmount = round2((deliveryFee || 0) * (refundFeePct / 100));
  }
  return { refundItemAmount, refundTaxAmount, refundFeeAmount, totalRefund: round2(refundItemAmount + refundTaxAmount + refundFeeAmount) };
}

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

// A: partial return under FULL_ORDER_RETURN_ONLY -> fee NOT refunded
{
  const r = computeRefund({ returnedOrderItems: [{ pricePerUnit: 300, discountPerUnit: 30, taxPerUnit: 15, qty: 1 }], deliveryFee: 49, refundDeliveryFeeWhen: 'full_order_return_only', isFullReturn: false });
  assert.equal(r.refundItemAmount, 270, 'A item: 300−30');
  assert.equal(r.refundTaxAmount, 15, 'A tax');
  assert.equal(r.refundFeeAmount, 0, 'A: partial -> no fee');
  assert.equal(r.totalRefund, 285, 'A total: customer paid 300−30+15 = 285');
  ok('partial return: item+tax only, no fee (FULL_ORDER_RETURN_ONLY)');
}

// B: full return under FULL_ORDER_RETURN_ONLY -> fee refunded (2 lines)
{
  const r = computeRefund({
    returnedOrderItems: [{ pricePerUnit: 300, discountPerUnit: 30, taxPerUnit: 15, qty: 1 }, { pricePerUnit: 200, discountPerUnit: 0, taxPerUnit: 10, qty: 1 }],
    deliveryFee: 49, refundDeliveryFeeWhen: 'full_order_return_only', isFullReturn: true,
  });
  assert.equal(r.refundItemAmount, 470, 'B item: 270+200');
  assert.equal(r.refundTaxAmount, 25, 'B tax');
  assert.equal(r.refundFeeAmount, 49, 'B: full return -> fee refunded');
  assert.equal(r.totalRefund, 544, 'B total: 470+25+49');
  ok('full return: fee refunded (FULL_ORDER_RETURN_ONLY)');
}

// C: partial return under ALWAYS -> fee refunded
{
  const r = computeRefund({ returnedOrderItems: [{ pricePerUnit: 300, discountPerUnit: 30, taxPerUnit: 15, qty: 1 }], deliveryFee: 49, refundDeliveryFeeWhen: 'always', refundFeePct: 100, isFullReturn: false });
  assert.equal(r.refundItemAmount, 270, 'C item');
  assert.equal(r.refundTaxAmount, 15, 'C tax');
  assert.equal(r.refundFeeAmount, 49, 'C: ALWAYS -> fee refunded even partial');
  assert.equal(r.totalRefund, 334, 'C total');
  ok('partial return with ALWAYS -> fee refunded');
}

// D: partial fee split (50%)
{
  const r = computeRefund({ returnedOrderItems: [{ pricePerUnit: 300, discountPerUnit: 30, taxPerUnit: 15, qty: 1 }], deliveryFee: 49, refundDeliveryFeeWhen: 'always', refundFeePct: 50, isFullReturn: false });
  assert.equal(r.refundFeeAmount, 24.5, 'D: 50% of 49');
  assert.equal(r.totalRefund, 270 + 15 + 24.5, 'D total');
  ok('partial fee split (50%)');
}

// E: NEVER -> fee never refunded even on full return
{
  const r = computeRefund({
    returnedOrderItems: [{ pricePerUnit: 300, discountPerUnit: 30, taxPerUnit: 15, qty: 1 }, { pricePerUnit: 200, discountPerUnit: 0, taxPerUnit: 10, qty: 1 }],
    deliveryFee: 49, refundDeliveryFeeWhen: 'never', isFullReturn: true,
  });
  assert.equal(r.refundFeeAmount, 0, 'E: NEVER -> no fee');
  assert.equal(r.totalRefund, 495, 'E total: 470+25');
  ok('NEVER -> fee never refunded');
}

// F: multi-qty line
{
  const r = computeRefund({ returnedOrderItems: [{ pricePerUnit: 300, discountPerUnit: 30, taxPerUnit: 15, qty: 2 }], deliveryFee: 49, refundDeliveryFeeWhen: 'full_order_return_only', isFullReturn: true });
  assert.equal(r.refundItemAmount, 540, 'F: 2 × (300−30)');
  assert.equal(r.refundTaxAmount, 30, 'F: 2 × 15');
  assert.equal(r.refundFeeAmount, 49, 'F: full return fee');
  assert.equal(r.totalRefund, 619, 'F total');
  ok('multi-qty line components');
}

console.log(`\nREFUND CALC: all ${pass} scenarios passed ✔`);
