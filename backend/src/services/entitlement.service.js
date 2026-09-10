/**
 * EntitlementService — plan limits, ENFORCED (not just displayed).
 *
 * Why this service exists: plans always carried maxHubs/maxProducts/maxStaff,
 * but nothing ever checked them — a Free store could create 100 hubs. Every
 * creation path now calls assertWithinLimit() BEFORE writing:
 *   hubs     → adminSlots.createHub
 *   products → tenantProduct.createListing / bulkCreateListings (active listings)
 *   staff    → adminUsers.createStaff + user.setRole promotions into staff roles
 *
 * Semantics:
 *   - limit 0 = unlimited (matches the plan model contract).
 *   - Unknown/missing plan code fails SAFE to the free-plan limits (the most
 *     restrictive tier) and logs loudly — a store is never bricked by an
 *     operator typo, and never silently unlimited either.
 *   - Violations are 402 PLAN_LIMIT_EXCEEDED with {resource, used, limit,
 *     planCode} so the console can render "3/3 hubs — upgrade to add more".
 */

import Tenant from '../models/tenant.model.js';
import Plan from '../models/plan.model.js';
import Hub from '../models/hub.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import User from '../models/user.model.js';
import { paymentRequired } from '../utils/ApiError.js';
import { TENANT_LISTING_STATUS, USER_STATUS } from '../constants/enums.js';
import { STAFF_ROLES } from '../utils/roleGuards.js';
import { TENANT_PLAN } from '../constants/enums.js';

// Mirrors the seeded Free plan (plan.service.js DEFAULT_PLANS) — the fail-safe
// tier when a tenant references a plan code that no longer resolves.
export const FREE_FALLBACK_FEATURES = Object.freeze({
  maxHubs: 1, maxProducts: 50, maxStaff: 2, marketplaceEnabled: false,
});

export const ENTITLEMENT_RESOURCES = Object.freeze(['hubs', 'products', 'staff']);

/** Pure policy: does used+extra breach the limit? 0/negative = unlimited. */
export function exceedsLimit(used, limit, extra = 1) {
  if (!limit || limit <= 0) return false;
  return used + extra > limit;
}

const LIMIT_FIELD = { hubs: 'maxHubs', products: 'maxProducts', staff: 'maxStaff' };

class EntitlementService {
  /** Resolve the tenant's live plan features (fail-safe to free). */
  async planForTenant(tenantId) {
    const tenant = await Tenant.findById(tenantId).select('plan').lean();
    const code = tenant?.plan || TENANT_PLAN.FREE;
    const plan = await Plan.findOne({ code }).select('code name features').lean();
    if (!plan) {
      console.warn(`[entitlements] tenant ${tenantId} references unknown plan "${code}" — failing safe to free limits`);
      return { code, name: null, features: { ...FREE_FALLBACK_FEATURES }, fallback: true };
    }
    return { code: plan.code, name: plan.name, features: plan.features || {}, fallback: false };
  }

  async countUsed({ tenantId, resource }) {
    if (resource === 'hubs') {
      return Hub.countDocuments({ tenantId, isActive: true, isDeleted: { $ne: true } });
    }
    if (resource === 'products') {
      return TenantProduct.countDocuments({ tenantId, status: TENANT_LISTING_STATUS.ACTIVE });
    }
    // staff: active humans in staff roles (owner counts as one; customers,
    // vendors and blocked users never consume seats)
    return User.countDocuments({
      tenantId,
      role: { $in: [...STAFF_ROLES] },
      status: USER_STATUS.ACTIVE,
      isDeleted: { $ne: true },
    });
  }

  /** Throw 402 when creating `extra` more of `resource` would breach the cap. */
  async assertWithinLimit({ tenantId, resource, extra = 1 }) {
    const field = LIMIT_FIELD[resource];
    if (!field) return;
    const [plan, used] = await Promise.all([
      this.planForTenant(tenantId),
      this.countUsed({ tenantId, resource }),
    ]);
    const limit = plan.features?.[field] ?? 0;
    if (exceedsLimit(used, limit, extra)) {
      throw paymentRequired(
        `Plan limit reached: ${used}/${limit} ${resource} used on the ${plan.name || plan.code} plan`,
        'PLAN_LIMIT_EXCEEDED',
        { resource, used, limit, planCode: plan.code }
      );
    }
    return { used, limit, planCode: plan.code };
  }

  /** Usage snapshot for the console ("3/3 hubs — upgrade to add more"). */
  async usage({ tenantId }) {
    const plan = await this.planForTenant(tenantId);
    const [hubs, products, staff] = await Promise.all([
      this.countUsed({ tenantId, resource: 'hubs' }),
      this.countUsed({ tenantId, resource: 'products' }),
      this.countUsed({ tenantId, resource: 'staff' }),
    ]);
    const shape = (used, field) => ({ used, limit: plan.features?.[field] ?? 0 });
    return {
      planCode: plan.code,
      planName: plan.name,
      fallback: plan.fallback,
      hubs: shape(hubs, 'maxHubs'),
      products: shape(products, 'maxProducts'),
      staff: shape(staff, 'maxStaff'),
    };
  }
}

export default new EntitlementService();
