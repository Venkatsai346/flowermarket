/**
 * PlanService — marketplace plan catalog (Phase 5).
 *
 * Plans are DATA (platform-admin editable); pricing is snapshotted onto
 * subscriptions/invoices at use time. `ensureDefaults` seeds the catalog
 * idempotently (free/pro/business) — safe to run on every boot/seed.
 */

import Plan from '../models/plan.model.js';
import { serializeList } from '../utils/serialize.js';
import { notFound, conflict } from '../utils/ApiError.js';
import { TENANT_PLAN } from '../constants/enums.js';

export const DEFAULT_PLANS = [
  {
    code: TENANT_PLAN.FREE,
    name: 'Free',
    description: 'For getting started — one hub, 50 products, standard delivery.',
    priceMonthly: 0,
    commissionRateBps: 200, // 2%
    features: { maxHubs: 1, maxProducts: 50, maxStaff: 2, marketplaceEnabled: false },
    trialDays: 0,
    sortOrder: 10,
  },
  {
    code: TENANT_PLAN.PRO,
    name: 'Pro',
    description: 'Growing stores — 3 hubs, unlimited products, marketplace ready.',
    priceMonthly: 999,
    commissionRateBps: 100, // 1%
    features: { maxHubs: 3, maxProducts: 0, maxStaff: 10, marketplaceEnabled: true },
    trialDays: 14,
    sortOrder: 20,
  },
  {
    code: TENANT_PLAN.BUSINESS,
    name: 'Business',
    description: 'Full marketplace play — 10 hubs, vendor routing, priority support.',
    priceMonthly: 2999,
    commissionRateBps: 50, // 0.5%
    features: { maxHubs: 10, maxProducts: 0, maxStaff: 50, marketplaceEnabled: true },
    trialDays: 14,
    sortOrder: 30,
  },
];

class PlanService {
  async ensureDefaults() {
    const created = [];
    for (const p of DEFAULT_PLANS) {
      const existing = await Plan.findOne({ code: p.code });
      if (!existing) {
        await Plan.create(p);
        created.push(p.code);
      }
    }
    return created;
  }

  // ---- public read ----
  async listActive() {
    return serializeList(await Plan.find({ isActive: true }).sort({ sortOrder: 1, priceMonthly: 1 }).lean());
  }

  async getByCode(code) {
    const plan = await Plan.findOne({ code });
    if (!plan) throw notFound('Plan not found', 'PLAN_NOT_FOUND');
    return plan;
  }

  // ---- platform admin CRUD ----
  async listAll() {
    return serializeList(await Plan.find().sort({ sortOrder: 1 }).lean());
  }

  async create(payload) {
    const existing = await Plan.findOne({ code: payload.code });
    if (existing) throw conflict('Plan code already exists', 'PLAN_CODE_EXISTS');
    const plan = await Plan.create({
      code: payload.code,
      name: payload.name,
      description: payload.description || null,
      priceMonthly: payload.priceMonthly,
      currency: payload.currency || 'INR',
      commissionRateBps: payload.commissionRateBps ?? 100,
      features: payload.features || {},
      trialDays: payload.trialDays ?? 0,
      isActive: payload.isActive !== false,
      sortOrder: payload.sortOrder ?? 0,
      version: 1,
    });
    return plan;
  }

  async update({ planId, payload }) {
    const plan = await Plan.findById(planId);
    if (!plan) throw notFound('Plan not found', 'PLAN_NOT_FOUND');
    // Referential guard: deactivating a plan with live subscribers would strand
    // stores on a dead code (entitlements fail-safe to free limits, but the
    // operator should move subscribers FIRST — deliberately, not by accident).
    if (payload.isActive === false && plan.isActive !== false) {
      const { default: Subscription } = await import('../models/subscription.model.js');
      const live = await Subscription.countDocuments({
        planCode: plan.code, status: { $in: ['trial', 'active', 'past_due'] },
      });
      if (live > 0) {
        throw conflict(
          `Plan "${plan.code}" still has ${live} live subscription(s) — move them first`,
          'PLAN_HAS_SUBSCRIBERS',
          { planCode: plan.code, liveSubscriptions: live }
        );
      }
    }
    const allowed = ['name', 'description', 'priceMonthly', 'commissionRateBps', 'features', 'trialDays', 'isActive', 'sortOrder'];
    for (const k of allowed) {
      if (k in payload) plan[k] = payload[k];
    }
    plan.version += 1;
    await plan.save();
    return plan;
  }
}

export default new PlanService();
