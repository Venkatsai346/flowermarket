import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_REQUEST_STATUS_META,
  CHANGE_REQUEST_TYPE_META,
  EVENT_STATUS_META,
  LISTING_STATUS_META,
  changedKeys,
  entityLabel,
  fmtJson,
} from './catalogMeta.js';

describe('catalog meta', () => {
  test('covers all change request statuses and types', () => {
    for (const s of ['pending', 'approved', 'rejected', 'needs_changes', 'cancelled']) {
      assert.ok(CHANGE_REQUEST_STATUS_META[s]?.label);
    }
    for (const t of ['create_master', 'update_global_fields', 'add_variant', 'update_images', 'update_attributes', 'deactivate_master']) {
      assert.ok(CHANGE_REQUEST_TYPE_META[t]?.label);
      assert.ok(CHANGE_REQUEST_TYPE_META[t]?.description);
    }
  });

  test('listing and event status maps stay aligned with backend', () => {
    for (const s of ['draft', 'active', 'inactive', 'out_of_stock']) assert.ok(LISTING_STATUS_META[s]?.tone);
    for (const s of ['pending', 'publishing', 'published', 'failed']) assert.ok(EVENT_STATUS_META[s]?.tone);
  });

  test('changedKeys finds only modified keys across before/after', () => {
    assert.deepEqual(changedKeys({ title: 'A', price: 10 }, { title: 'B', price: 10 }), ['title']);
    assert.deepEqual(changedKeys(null, { status: 'active' }), ['status']);
    assert.deepEqual(changedKeys({ a: 1 }, { a: 1 }), []);
  });

  test('formatters stay readable', () => {
    assert.equal(entityLabel('product_change_request'), 'Change request');
    assert.match(fmtJson({ ok: true }), /ok/);
    assert.equal(fmtJson(null), '—');
  });
});
