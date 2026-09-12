/**
 * catalog-guards.test.js — PURE catalog-governance policy (who may do what).
 *
 *   node scripts/catalog-guards.test.js
 *
 * No database. utils/catalogGuards.js is the single policy core the services
 * enforce, so every rule is locked here: the paid-plan gate for change
 * requests, tenant ownership, and every lifecycle transition (review /
 * cancel / revise / master review / deprecate / listable). The DB-backed
 * smokes prove the wiring; this suite proves the POLICY.
 */

import assert from 'node:assert/strict';
import {
  CHANGE_REQUEST_PLANS,
  canSubmitChangeRequests,
  assertChangeRequestPlan,
  assertReviewable,
  assertCancellable,
  assertRevisable,
  assertMasterListable,
  assertMasterReviewable,
  assertMasterDeprecatable,
} from '../src/utils/catalogGuards.js';

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  PASS  ${label}`); };
const throwsCode = (fn, code, status = null) => {
  try { fn(); } catch (e) { assert.equal(e.code, code); if (status) assert.equal(e.status, status); return; }
  assert.fail(`expected throw ${code}`);
};

// ---------------- paid-plan gate ----------------
{
  assert.deepEqual([...CHANGE_REQUEST_PLANS], ['pro', 'business']);
  assert.equal(canSubmitChangeRequests('pro'), true);
  assert.equal(canSubmitChangeRequests('business'), true);
  assert.equal(canSubmitChangeRequests('free'), false);
  assert.equal(canSubmitChangeRequests(undefined), false);
  assert.equal(canSubmitChangeRequests(null), false);
  assert.equal(canSubmitChangeRequests('enterpris'), false);
  ok('plan predicate: pro/business only, everything else gated');
}
{
  assert.equal(assertChangeRequestPlan({ planCode: 'pro' }), true);
  assert.equal(assertChangeRequestPlan({ planCode: 'business' }), true);
  throwsCode(() => assertChangeRequestPlan({ planCode: 'free' }), 'PLAN_UPGRADE_REQUIRED', 402);
  throwsCode(() => assertChangeRequestPlan({}), 'PLAN_UPGRADE_REQUIRED', 402);
  try {
    assertChangeRequestPlan({ planCode: 'free' });
  } catch (e) {
    assert.equal(e.details.feature, 'catalog_change_requests');
    assert.deepEqual(e.details.allowedPlans, ['pro', 'business']);
  }
  ok('plan assert: 402 + upgrade details for free/unknown, pass for paid');
}

// ---------------- change-request lifecycle ----------------
{
  assert.equal(assertReviewable({ status: 'pending' }), true);
  throwsCode(() => assertReviewable(null), 'CHANGE_REQUEST_NOT_FOUND', 404);
  for (const s of ['approved', 'rejected', 'needs_changes', 'cancelled']) {
    throwsCode(() => assertReviewable({ status: s }), 'REQUEST_ALREADY_REVIEWED', 409);
  }
  ok('reviewable: PENDING only (double-approval → 409)');
}
{
  const own = { status: 'pending', tenantId: 't1' };
  assert.equal(assertCancellable({ cr: own, tenantId: 't1' }), true);
  throwsCode(() => assertCancellable({ cr: null, tenantId: 't1' }), 'CHANGE_REQUEST_NOT_FOUND', 404);
  throwsCode(() => assertCancellable({ cr: own, tenantId: 't2' }), 'FORBIDDEN', 403);
  for (const s of ['approved', 'rejected', 'needs_changes', 'cancelled']) {
    throwsCode(() => assertCancellable({ cr: { status: s, tenantId: 't1' }, tenantId: 't1' }), 'REQUEST_NOT_PENDING', 409);
  }
  ok('cancellable: own + PENDING only (ownership + status)');
}
{
  const own = { status: 'needs_changes', tenantId: 't1' };
  assert.equal(assertRevisable({ cr: own, tenantId: 't1' }), true);
  throwsCode(() => assertRevisable({ cr: null, tenantId: 't1' }), 'CHANGE_REQUEST_NOT_FOUND', 404);
  throwsCode(() => assertRevisable({ cr: own, tenantId: 't2' }), 'FORBIDDEN', 403);
  for (const s of ['pending', 'approved', 'rejected', 'cancelled']) {
    throwsCode(() => assertRevisable({ cr: { status: s, tenantId: 't1' }, tenantId: 't1' }), 'REQUEST_NOT_REVISABLE', 409);
  }
  ok('revisable: own + NEEDS_CHANGES only');
}

// ---------------- master lifecycle ----------------
{
  assert.equal(assertMasterListable({ status: 'active' }), true);
  assert.equal(assertMasterListable({ status: 'pending_review' }), true);
  throwsCode(() => assertMasterListable(null), 'PRODUCT_MASTER_NOT_FOUND', 404);
  throwsCode(() => assertMasterListable({ status: 'rejected' }), 'MASTER_NOT_AVAILABLE', 400);
  throwsCode(() => assertMasterListable({ status: 'deprecated' }), 'MASTER_NOT_AVAILABLE', 400);
  ok('listable: ACTIVE or PENDING_REVIEW only (staged, never zombies)');
}
{
  assert.equal(assertMasterReviewable({ status: 'pending_review' }), true);
  throwsCode(() => assertMasterReviewable(null), 'PRODUCT_MASTER_NOT_FOUND', 404);
  for (const s of ['active', 'rejected', 'deprecated']) {
    throwsCode(() => assertMasterReviewable({ status: s }), 'NOT_PENDING_REVIEW', 409);
  }
  ok('master reviewable: PENDING_REVIEW only');
}
{
  assert.equal(assertMasterDeprecatable({ status: 'active' }), true);
  assert.equal(assertMasterDeprecatable({ status: 'pending_review' }), true);
  throwsCode(() => assertMasterDeprecatable(null), 'PRODUCT_MASTER_NOT_FOUND', 404);
  throwsCode(() => assertMasterDeprecatable({ status: 'deprecated' }), 'ALREADY_DEPRECATED', 409);
  ok('deprecatable: anything but already-deprecated');
}

console.log(`\nCATALOG GUARDS: all ${passed} scenarios passed ✔\n`);
