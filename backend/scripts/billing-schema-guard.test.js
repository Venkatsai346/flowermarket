/**
 * billing-schema-guard.test.js — the TenantSubscription identity guard.
 *
 * Needs node_modules (mongoose) but NO database: schema introspection never
 * touches a connection.
 *
 *   node scripts/billing-schema-guard.test.js
 *
 * The guard once false-positived on EVERY registration: it probed
 * `schema.path('planSnapshot')`, but single-nested subdocument intermediates
 * are not in Mongoose's `schema.paths` (they live in `schema.nested`), so the
 * probe was undefined on the correct schema — and the failure details didn't
 * even include that check. Both halves are locked here: leaf probes pass on
 * the billing schema, and the checker rejects the customer schema precisely.
 */

import assert from 'node:assert/strict';
import TenantSubscription from '../src/models/tenantSubscription.model.js';
import Subscription from '../src/models/subscription.model.js';
import { assertTenantSubscriptionSchema, checkTenantBillingShape } from '../src/services/billing.service.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

// The guard passes on the real billing schema (no false positive).
assert.doesNotThrow(() => assertTenantSubscriptionSchema());
const billing = checkTenantBillingShape(TenantSubscription.schema);
assert.equal(billing.ok, true, JSON.stringify(billing.checks));
ok('guard passes on the real TenantSubscription schema');

// Lock the Mongoose semantics that caused the false positive: intermediates
// are not paths, leaves are — the probe rule, as an executable assertion.
assert.equal(TenantSubscription.schema.path('planSnapshot'), undefined);
assert.ok(TenantSubscription.schema.path('planSnapshot.name'));
assert.ok(TenantSubscription.schema.path('planSnapshot.priceMonthly'));
ok('nested intermediates are not paths; leaves are (probe rule locked)');

// The checker rejects the customer schema — with the precise failing checks,
// so a future mismatch is diagnosable from the error details alone.
const customer = checkTenantBillingShape(Subscription.schema);
assert.equal(customer.ok, false);
assert.equal(customer.checks.hasPlanCode, false);
assert.equal(customer.checks.hasPlanSnapshot, false);
assert.equal(customer.checks.statusHasTrial, false);
assert.equal(customer.checks.hasTenantId, true, 'tenantId alone must never pass a schema');
ok('checker rejects the customer Subscription schema precisely');

// A missing/unregistered model fails closed (and never throws a TypeError).
const missing = checkTenantBillingShape(undefined);
assert.equal(missing.ok, false);
assert.equal(missing.checks.schemaRegistered, false);
ok('missing schema fails closed');

console.log(`\nBILLING SCHEMA GUARD: all ${pass} scenarios passed ✔\n`);
