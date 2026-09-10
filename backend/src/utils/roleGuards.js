/**
 * roleGuards — the SINGLE policy core for user role/status changes.
 *
 * Why this file exists: `PATCH /users/:id/role` used to call a naive setter
 * with no guards, so any store owner (role `admin`) could self-promote to
 * `super_admin`, refresh their token, and own the platform. The hardened
 * rules lived only in `adminUsers.service` (wired to a different route).
 * Both routes now enforce THIS policy — pure, unit-tested, no DB.
 *
 * Rules (all fail-closed):
 *   1. Nobody changes their own role or status (no self-promotion, no self-lockout).
 *   2. `super_admin` can never be granted via API (operator onboarding is seed/DB
 *      only) and super_admin users cannot be modified via API at all.
 *   3. `vendor` can never be granted via the role endpoint — the ONLY path is
 *      an approved VendorApplication (see vendor.service.js).
 *   4. The actor must hold an admin-capable role (routes enforce this too; the
 *      guard asserts defensively so a future route can't forget).
 */

import { badRequest, forbidden } from './ApiError.js';
import { USER_ROLES } from '../constants/enums.js';

const SUPER = USER_ROLES.SUPER_ADMIN;

/** Roles that count as plan "staff" for entitlement limits. */
export const STAFF_ROLES = Object.freeze([USER_ROLES.ADMIN, USER_ROLES.PICKER, USER_ROLES.RIDER]);

export const isStaffRole = (role) => STAFF_ROLES.includes(role);

function assertAdminActor(actorRole) {
  if (actorRole !== USER_ROLES.ADMIN && actorRole !== SUPER) {
    throw forbidden('Only store or platform admins can manage users', 'FORBIDDEN');
  }
}

/**
 * @param actor {{ id: string, role: string }} — the caller
 * @param target {{ _id?: any, id?: any, role: string }} — resolved user doc/lean
 * @param newRole {string} — requested role (already enum-validated by Joi)
 * @throws AppError when the change is not allowed. Returns true when allowed.
 */
export function assertRoleChangeAllowed({ actor, target, newRole }) {
  assertAdminActor(actor?.role);
  if (!target) throw badRequest('User not found', 'USER_NOT_FOUND');
  if (String(target._id ?? target.id) === String(actor?.id)) {
    throw badRequest('You cannot change your own role', 'SELF_MODIFICATION');
  }
  if (newRole === SUPER) {
    throw forbidden('super_admin cannot be granted via API', 'SUPER_ADMIN_GRANT_FORBIDDEN');
  }
  if (newRole === USER_ROLES.VENDOR) {
    throw forbidden('Vendor role is granted only by an approved vendor application', 'VENDOR_GRANT_FORBIDDEN');
  }
  if (target.role === SUPER) {
    throw forbidden('Super admins cannot be modified via API', 'SUPER_ADMIN_IMMUTABLE');
  }
  return true;
}

/**
 * Status changes are less sensitive than role changes, but self-lockout and
 * touching platform operators are still forbidden.
 */
export function assertStatusChangeAllowed({ actor, target }) {
  assertAdminActor(actor?.role);
  if (!target) throw badRequest('User not found', 'USER_NOT_FOUND');
  if (String(target._id ?? target.id) === String(actor?.id)) {
    throw badRequest('You cannot change your own status', 'SELF_MODIFICATION');
  }
  if (target.role === SUPER) {
    throw forbidden('Super admins cannot be modified via API', 'SUPER_ADMIN_IMMUTABLE');
  }
  return true;
}
