import test from 'node:test';
import assert from 'node:assert/strict';
import { REFUND_REASON_META, RETURN_CLAIM_TYPE_META, RETURN_STATUS_META } from './aftersalesMeta.js';

test('return status meta covers every backend return state', () => {
  for (const s of ['requested', 'approved', 'rejected', 'picked_up', 'qc_passed', 'qc_failed', 'refund_initiated', 'refunded', 'refund_rejected']) {
    assert.ok(RETURN_STATUS_META[s], `missing RETURN_STATUS_META.${s}`);
  }
});

test('return claim and refund reason meta cover backend enums', () => {
  for (const s of ['pickup_qc', 'instant_claim']) {
    assert.ok(RETURN_CLAIM_TYPE_META[s], `missing claim type ${s}`);
  }
  for (const s of ['order_cancelled', 'return_qc_passed', 'instant_claim_approved', 'delivery_failed', 'admin_override']) {
    assert.ok(REFUND_REASON_META[s], `missing refund reason ${s}`);
  }
});
