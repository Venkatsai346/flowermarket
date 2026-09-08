import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_META, TRACK_COPY, TRACK_STEPS } from './status.js';

test('TRACK_STEPS is the five customer milestones', () => {
  assert.deepEqual(TRACK_STEPS, ['Placed', 'Confirmed', 'Being prepared', 'On the way', 'Delivered']);
});

test('TRACK_COPY covers every STATUS_META key', () => {
  for (const key of Object.keys(STATUS_META)) {
    assert.ok(TRACK_COPY[key] && TRACK_COPY[key].length > 12, key);
  }
});
