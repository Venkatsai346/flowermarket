import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RIDER_ACTIONS,
  RIDER_ASSIGNMENT_STATUS_META,
  RIDER_AVAILABILITY_META,
  RIDER_POD_TYPE_META,
  RIDER_STEPS,
} from './riderMeta.js';

test('rider assignment status meta covers the full state machine', () => {
  for (const s of ['pending_accept', 'accepted', 'at_hub', 'in_transit', 'arrived', 'delivered', 'failed', 'cancelled']) {
    assert.ok(RIDER_ASSIGNMENT_STATUS_META[s], `missing status ${s}`);
  }
});

test('rider availability and pod meta cover backend enums', () => {
  for (const s of ['available', 'busy', 'offline']) {
    assert.ok(RIDER_AVAILABILITY_META[s], `missing availability ${s}`);
  }
  for (const s of ['otp', 'photo', 'signature']) {
    assert.ok(RIDER_POD_TYPE_META[s], `missing pod type ${s}`);
  }
});

test('every active state has at least one wired action', () => {
  for (const s of ['pending_accept', 'accepted', 'at_hub', 'in_transit', 'arrived']) {
    assert.ok(RIDER_ACTIONS[s]?.length, `missing action for ${s}`);
  }
});

test('completed states have no rider actions', () => {
  for (const s of ['delivered', 'failed', 'cancelled']) {
    assert.deepEqual(RIDER_ACTIONS[s] || [], []);
  }
});

test('steps form a linear happy path', () => {
  assert.deepEqual(RIDER_STEPS.map((s) => s.key), ['pending_accept', 'accepted', 'at_hub', 'in_transit', 'arrived', 'delivered']);
});
