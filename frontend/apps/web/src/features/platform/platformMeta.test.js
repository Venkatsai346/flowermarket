import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANK_VERIFICATION_META, EXPORT_STATUS_META, KYC_STATUS_META, TENANT_STATUS_META, VENDOR_STATUS_LIFECYCLE_META, opRows,
} from './platformMeta.js';

describe('platform lifecycle meta', () => {
  test('covers KYC and bank verification states', () => {
    for (const s of ['not_submitted', 'pending', 'approved', 'rejected']) assert.ok(KYC_STATUS_META[s]?.tone);
    for (const s of ['unverified', 'pending', 'verified', 'failed']) assert.ok(BANK_VERIFICATION_META[s]?.tone);
  });

  test('covers export statuses', () => {
    for (const s of ['pending', 'running', 'done', 'failed']) assert.ok(EXPORT_STATUS_META[s]?.tone);
  });

  test('covers tenant and vendor lifecycle states', () => {
    for (const s of ['active', 'inactive', 'blocked']) assert.ok(TENANT_STATUS_META[s]?.tone);
    for (const s of ['active', 'suspended']) assert.ok(VENDOR_STATUS_LIFECYCLE_META[s]?.tone);
  });

  test('opRows flattens nested step outputs', () => {
    const rows = opRows({ billing: { scanned: 2, invoicesCreated: 1 }, events: { error: 'nope' } });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].scanned, 2);
    assert.equal(rows[1].error, 'nope');
  });
});
