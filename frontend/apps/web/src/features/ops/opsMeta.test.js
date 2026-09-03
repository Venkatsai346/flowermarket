import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSIGNMENT_STATUS_META,
  OPS_ORDER_STATUS_META,
  PAYMENT_STATUS_META,
  SLOT_STATUS_META,
  TASK_STATUS_META,
} from './opsMeta.js';

test('fulfillment metadata covers every documented order state', () => {
  for (const status of [
    'confirmed', 'picking', 'packed', 'out_for_delivery', 'delivered',
    'delivery_failed', 'return_requested', 'return_approved', 'return_picked_up',
    'qc_passed', 'qc_failed', 'refund_initiated', 'refunded',
  ]) {
    assert.ok(OPS_ORDER_STATUS_META[status], `missing OPS_ORDER_STATUS_META.${status}`);
  }
});

test('assignment, task, payment and slot metadata cover machine values', () => {
  for (const s of ['pending_accept', 'accepted', 'at_hub', 'in_transit', 'arrived', 'delivered', 'failed', 'cancelled']) {
    assert.ok(ASSIGNMENT_STATUS_META[s], `missing assignment ${s}`);
  }
  for (const s of ['queued', 'picking', 'packed', 'failed']) {
    assert.ok(TASK_STATUS_META[s], `missing task ${s}`);
  }
  for (const s of ['pending', 'success', 'failed', 'refunded', 'partially_refunded']) {
    assert.ok(PAYMENT_STATUS_META[s], `missing payment ${s}`);
  }
  for (const s of ['open', 'full', 'closed', 'cancelled']) {
    assert.ok(SLOT_STATUS_META[s], `missing slot ${s}`);
  }
});
