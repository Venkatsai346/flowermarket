/**
 * role-guards unit test — the privilege-escalation policy, proven without a DB.
 *
 * Regression cover for the hole this module closed: PATCH /users/:id/role was
 * guarded only by `authorize(ADMIN, ...)` and called a naive setter, so any
 * store owner could self-promote to super_admin, refresh their token, and own
 * the platform. Both role routes now enforce utils/roleGuards.js.
 *
 * Every case here is a pure function call — no DB, no network.
 *
 * Run: node scripts/role-guards.test.js
 */
import assert from 'node:assert/strict';
import {
  assertRoleChangeAllowed,
  assertStatusChangeAllowed,
  isStaffRole,
  STAFF_ROLES,
} from '../src/utils/roleGuards.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };
const throwsCode = (fn, code) => {
  try { fn(); } catch (e) { assert.equal(e.code, code); return; }
  assert.fail(`expected throw ${code}`);
};

const owner = { id: 'owner1', role: 'admin' };
const platform = { id: 'root1', role: 'super_admin' };
const customer = { id: 'cust1', role: 'customer' };
const staffer = { _id: 'staff9', role: 'picker' };
const patron = { _id: 'cust1', role: 'customer' };

// ---- the escalation hole, closed ----
throwsCode(
  () => assertRoleChangeAllowed({ actor: owner, target: { _id: 'owner1', role: 'admin' }, newRole: 'super_admin' }),
  'SELF_MODIFICATION'
);
ok('a store owner cannot change their OWN role (no self-promotion)');

throwsCode(
  () => assertRoleChangeAllowed({ actor: owner, target: patron, newRole: 'super_admin' }),
  'SUPER_ADMIN_GRANT_FORBIDDEN'
);
ok('a store owner cannot grant super_admin to anyone in their tenant');

throwsCode(
  () => assertRoleChangeAllowed({ actor: platform, target: patron, newRole: 'super_admin' }),
  'SUPER_ADMIN_GRANT_FORBIDDEN'
);
ok('even a super_admin cannot mint another super_admin via API (seed/DB only)');

throwsCode(
  () => assertRoleChangeAllowed({ actor: owner, target: { _id: 'root1', role: 'super_admin' }, newRole: 'customer' }),
  'SUPER_ADMIN_IMMUTABLE'
);
ok('super_admin users cannot be demoted or touched via API');

// ---- the vendor invariant, enforced ----
throwsCode(
  () => assertRoleChangeAllowed({ actor: owner, target: patron, newRole: 'vendor' }),
  'VENDOR_GRANT_FORBIDDEN'
);
throwsCode(
  () => assertRoleChangeAllowed({ actor: platform, target: patron, newRole: 'vendor' }),
  'VENDOR_GRANT_FORBIDDEN'
);
ok('vendor role is grantable ONLY by an approved application — never via the role endpoint');

// ---- legitimate staff management still works ----
assert.equal(assertRoleChangeAllowed({ actor: owner, target: patron, newRole: 'picker' }), true);
assert.equal(assertRoleChangeAllowed({ actor: owner, target: patron, newRole: 'admin' }), true);
assert.equal(assertRoleChangeAllowed({ actor: owner, target: staffer, newRole: 'customer' }), true);
assert.equal(assertRoleChangeAllowed({ actor: platform, target: staffer, newRole: 'rider' }), true);
ok('owners can promote/demote staff (admin/picker/rider/customer) within their tenant');

// ---- actor is required (fail-closed for future callers) ----
throwsCode(() => assertRoleChangeAllowed({ actor: null, target: patron, newRole: 'picker' }), 'FORBIDDEN');
throwsCode(() => assertRoleChangeAllowed({ actor: customer, target: patron, newRole: 'picker' }), 'FORBIDDEN');
ok('a missing or non-admin actor is rejected, not silently allowed');

// ---- status changes ----
throwsCode(() => assertStatusChangeAllowed({ actor: owner, target: { _id: 'owner1', role: 'admin' } }), 'SELF_MODIFICATION');
throwsCode(() => assertStatusChangeAllowed({ actor: owner, target: { _id: 'root1', role: 'super_admin' } }), 'SUPER_ADMIN_IMMUTABLE');
assert.equal(assertStatusChangeAllowed({ actor: owner, target: staffer }), true);
ok('status changes block self-lockout and super_admin modification, allow the rest');

// ---- staff vocabulary ----
assert.deepEqual([...STAFF_ROLES].sort(), ['admin', 'picker', 'rider']);
assert.equal(isStaffRole('admin'), true);
assert.equal(isStaffRole('customer'), false);
assert.equal(isStaffRole('vendor'), false);
assert.equal(isStaffRole('super_admin'), false);
ok('staff seats = admin/picker/rider (vendors and customers never consume seats)');

console.log(`\nrole-guards: ${pass} assertions passed`);
