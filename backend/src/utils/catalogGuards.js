/**
 * catalogGuards — the SINGLE policy core for catalog governance.
 *
 * Why this file exists: `/catalog/admin` used to authorize `(ADMIN,
 * SUPER_ADMIN)` while store owners carry role `admin` — so any tenant could
 * rewrite the platform-global catalog (masters, categories, brands) and even
 * approve their own change requests. The router now enforces SUPER_ADMIN, and
 * every rule below lives HERE — pure, unit-tested, no DB — so services and
 * tests share one definition of who may do what:
 *
 *   WHO                                    MAY
 *   ─────────────────────────────────────  ────────────────────────────────
 *   super_admin                            everything (global catalog CRUD +
 *                                          change-request review)
 *   admin / vendor of a PRO or BUSINESS    listings + stock + propose masters
 *   tenant                                 + file change requests
 *   admin / vendor of a FREE tenant        listings + stock only
 *                                          (CR submit/propose → 402)
 *   customer / picker / rider              nothing (403 at the router)
 *
 * Lifecycle rules (all fail-closed):
 *   1. A change request is reviewable only from PENDING; claim is atomic so
 *      two admins can never both approve (the loser gets 409).
 *   2. Tenants touch only their OWN requests (ownership is part of every
 *      tenant-side assert, never assumed by the caller).
 *   3. A master is listable only while ACTIVE or PENDING_REVIEW — staging on
 *      a pending master is deliberate (search + cart still hide it until
 *      approval); activating onto anything else 409s instead of stranding a
 *      zombie listing.
 */

import { badRequest, conflict, forbidden, notFound, paymentRequired } from './ApiError.js';
import {
  USER_ROLES,
  TENANT_PLAN,
  PRODUCT_MASTER_STATUS,
  CHANGE_REQUEST_STATUS,
} from '../constants/enums.js';

/** Roles that may operate a tenant's own catalog surface (listings/stock/CRs). */
export const TENANT_CATALOG_ROLES = Object.freeze([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.VENDOR]);

/**
 * Plans whose tenants may file catalog change requests and propose masters.
 * THE one-line policy: relax/tighten paid access here and every submit path
 * follows (submit + proposeMaster both enforce it; revise/cancel on already-
 * filed requests are grandfathered and stay open).
 */
export const CHANGE_REQUEST_PLANS = Object.freeze([TENANT_PLAN.PRO, TENANT_PLAN.BUSINESS]);

export function canSubmitChangeRequests(planCode) {
  return CHANGE_REQUEST_PLANS.includes(planCode);
}

/** 402 when the tenant's plan may not file catalog change requests. */
export function assertChangeRequestPlan({ planCode }) {
  if (!canSubmitChangeRequests(planCode)) {
    throw paymentRequired(
      'Catalog change requests need a Pro or Business plan — upgrade to propose catalog changes',
      'PLAN_UPGRADE_REQUIRED',
      { feature: 'catalog_change_requests', planCode: planCode || null, allowedPlans: [...CHANGE_REQUEST_PLANS] }
    );
  }
  return true;
}

/** A change request is reviewable only from PENDING (kill double-approvals). */
export function assertReviewable(cr) {
  if (!cr) throw notFound('Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
  if (cr.status !== CHANGE_REQUEST_STATUS.PENDING) {
    throw conflict(`Request is already ${cr.status}`, 'REQUEST_ALREADY_REVIEWED');
  }
  return true;
}

function assertOwnRequest(cr, tenantId) {
  if (!cr) throw notFound('Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
  if (String(cr.tenantId) !== String(tenantId)) {
    throw forbidden('Not your change request', 'FORBIDDEN');
  }
}

/** Tenants cancel their OWN requests, and only from PENDING. */
export function assertCancellable({ cr, tenantId }) {
  assertOwnRequest(cr, tenantId);
  if (cr.status !== CHANGE_REQUEST_STATUS.PENDING) {
    throw conflict('Only pending requests can be cancelled', 'REQUEST_NOT_PENDING');
  }
  return true;
}

/** Tenants revise their OWN requests, and only from NEEDS_CHANGES. */
export function assertRevisable({ cr, tenantId }) {
  assertOwnRequest(cr, tenantId);
  if (cr.status !== CHANGE_REQUEST_STATUS.NEEDS_CHANGES) {
    throw conflict('Only needs_changes requests can be revised', 'REQUEST_NOT_REVISABLE');
  }
  return true;
}

/** A master is listable/activatable only while ACTIVE or PENDING_REVIEW. */
export function assertMasterListable(master) {
  if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
  if (![PRODUCT_MASTER_STATUS.ACTIVE, PRODUCT_MASTER_STATUS.PENDING_REVIEW].includes(master.status)) {
    throw badRequest('Master is not available for listing', 'MASTER_NOT_AVAILABLE');
  }
  return true;
}

/** A master decision applies only to a PENDING_REVIEW master. */
export function assertMasterReviewable(master) {
  if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
  if (master.status !== PRODUCT_MASTER_STATUS.PENDING_REVIEW) {
    throw conflict('Master is not pending review', 'NOT_PENDING_REVIEW');
  }
  return true;
}

/** Deprecating an already-deprecated master is a no-op conflict, not work. */
export function assertMasterDeprecatable(master) {
  if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
  if (master.status === PRODUCT_MASTER_STATUS.DEPRECATED) {
    throw conflict('Master is already deprecated', 'ALREADY_DEPRECATED');
  }
  return true;
}
