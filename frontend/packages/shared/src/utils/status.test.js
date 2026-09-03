import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANK_VERIFICATION_META, KYC_STATUS_META, PAYOUT_STATE_META, USER_ROLE_META, USER_STATUS_META,
  EXPORT_STATUS_META, TENANT_STATUS_META, VENDOR_STATUS_LIFECYCLE_META, INVENTORY_HEALTH_META,
} from './status.js';

describe('shared status metadata', () => {
  test('covers platform, payout and core console states', () => {
    for (const s of ['not_submitted', 'pending', 'approved', 'rejected']) assert.ok(KYC_STATUS_META[s]?.tone);
    for (const s of ['unverified', 'pending', 'verified', 'failed']) assert.ok(BANK_VERIFICATION_META[s]?.tone);
    for (const s of ['pending', 'running', 'done', 'failed']) assert.ok(EXPORT_STATUS_META[s]?.tone);
    for (const s of ['active', 'inactive', 'blocked']) assert.ok(TENANT_STATUS_META[s]?.tone);
    for (const s of ['active', 'suspended']) assert.ok(VENDOR_STATUS_LIFECYCLE_META[s]?.tone);
    for (const s of ['pending_approval', 'processing', 'paid', 'failed']) assert.ok(PAYOUT_STATE_META[s]?.tone);
    for (const s of ['customer', 'vendor', 'admin', 'super_admin']) assert.equal(typeof USER_ROLE_META[s]?.label, 'string');
    for (const s of ['active', 'inactive', 'blocked']) assert.ok(USER_STATUS_META[s]?.tone);
    for (const s of ['in_stock', 'low_stock', 'out_of_stock']) assert.ok(INVENTORY_HEALTH_META[s]?.tone);
  });

  test('status maps are label/tone only (safe for mobile)', () => {
    const sample = Object.values(PAYOUT_STATE_META)[0];
    assert.equal(typeof sample.label, 'string');
    assert.equal(typeof sample.tone, 'string');
    assert.equal('icon' in sample, false);
  });
});
