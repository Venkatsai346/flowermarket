/**
 * MarketplaceAnalyticsService — cross-tenant analytics (Phase 5).
 *
 * The platform dashboard is computed over EVERY tenant (super_admin only).
 * Exact formulas (hand-verifiable):
 *   gmv / orders / netRevenue  = Σ tenant-wide analyticsdailies rows (hubId null)
 *   commissionsAccrued         = Σ open+paid invoice commission lines
 *   mrr                        = Σ live subscriptions priceMonthly (snapshot)
 *   activeTenants              = tenants active with a live subscription
 *   newTenants / newVendors    = created within the range
 *   byPlan                     = live subscriptions grouped by planCode
 * platformdailies is the idempotent nightly rollup (unique date upsert).
 */

import PlatformDaily from '../models/platformDaily.model.js';
import AnalyticsDaily from '../models/analyticsDaily.model.js';
import Invoice from '../models/invoice.model.js';
import Subscription from '../models/subscription.model.js';
import Vendor from '../models/vendor.model.js';
import Tenant from '../models/tenant.model.js';
import OrderItem from '../models/orderItem.model.js';
import billingService from './billing.service.js';
import auditService from './audit.service.js';
import { roundMoney } from '../utils/money.js';
import { INVOICE_STATUS, INVOICE_LINE_TYPE, SUBSCRIPTION_STATUS } from '../constants/enums.js';

const LIVE_SUB = { status: { $in: [SUBSCRIPTION_STATUS.TRIAL, SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE] } };

class MarketplaceAnalyticsService {
  /** Cross-tenant dashboard KPIs for a date range. */
  async dashboard({ from, to }) {
    const fromStr = from.slice(0, 10);
    const toStr = to.slice(0, 10);
    const [rolled, invoices, subs, [vendorsNew], [tenantsNew], [activeTenants]] = await Promise.all([
      AnalyticsDaily.aggregate([
        { $match: { hubId: null, date: { $gte: fromStr, $lte: toStr } } },
        { $group: { _id: null, orders: { $sum: '$ordersCreated' }, gmv: { $sum: '$gmv' }, netRevenue: { $sum: '$netRevenue' } } },
      ]),
      Invoice.aggregate([
        { $match: { status: { $in: [INVOICE_STATUS.OPEN, INVOICE_STATUS.PAID, INVOICE_STATUS.OVERDUE] }, 'period.from': { $gte: new Date(`${fromStr}T00:00:00.000Z`), $lte: new Date(`${toStr}T00:00:00.000Z`) } } },
        { $unwind: '$lineItems' },
        { $match: { 'lineItems.type': INVOICE_LINE_TYPE.COMMISSION } },
        { $group: { _id: null, commissions: { $sum: '$lineItems.amount' } } },
      ]),
      Subscription.aggregate([
        { $match: LIVE_SUB },
        { $group: { _id: null, mrr: { $sum: '$planSnapshot.priceMonthly' }, tenants: { $sum: 1 }, byPlan: { $push: '$planCode' } } },
      ]),
      Vendor.aggregate([
        { $match: { joinedAt: { $gte: new Date(`${fromStr}T00:00:00.000Z`), $lte: new Date(`${toStr}T23:59:59.999Z`) } } },
        { $group: { _id: null, n: { $sum: 1 } } },
      ]),
      Tenant.aggregate([
        { $match: { createdAt: { $gte: new Date(`${fromStr}T00:00:00.000Z`), $lte: new Date(`${toStr}T23:59:59.999Z`) } } },
        { $group: { _id: null, n: { $sum: 1 } } },
      ]),
      Tenant.aggregate([{ $match: { status: 'active' } }, { $group: { _id: null, n: { $sum: 1 } } }]),
    ]);

    const byPlan = {};
    for (const code of (subs[0]?.byPlan || [])) byPlan[code] = (byPlan[code] || 0) + 1;

    return {
      from: fromStr,
      to: toStr,
      orders: rolled[0]?.orders || 0,
      gmv: roundMoney(rolled[0]?.gmv || 0),
      netRevenue: roundMoney(rolled[0]?.netRevenue || 0),
      commissionsAccrued: roundMoney(invoices[0]?.commissions || 0),
      mrr: roundMoney(subs[0]?.mrr || 0),
      activeTenants: activeTenants?.n || 0,
      newTenants: tenantsNew?.n || 0,
      newVendors: vendorsNew?.n || 0,
      byPlan,
    };
  }

  /** Per-vendor marketplace stats (from orderitems.vendorId snapshots). */
  async vendorStats({ vendorId, from = null, to = null }) {
    const match = { vendorId };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(`${String(from).slice(0, 10)}T00:00:00.000Z`);
      if (to) match.createdAt.$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`);
    }
    const [agg] = await OrderItem.aggregate([
      { $match: match },
      { $group: { _id: null, gmv: { $sum: '$lineTotal' }, orders: { $sum: 1 } } },
    ]);
    return { gmv: roundMoney(agg?.gmv || 0), orders: agg?.orders || 0 };
  }

  /** Top tenants / vendors for the range (bounded). */
  async topTenants({ from, to, limit = 10 }) {
    const fromStr = from.slice(0, 10);
    const toStr = to.slice(0, 10);
    const rows = await AnalyticsDaily.aggregate([
      { $match: { hubId: null, date: { $gte: fromStr, $lte: toStr } } },
      { $group: { _id: '$tenantId', gmv: { $sum: '$gmv' }, orders: { $sum: '$ordersCreated' } } },
      { $sort: { gmv: -1 } },
      { $limit: Math.min(limit, 25) },
    ]);
    const tenants = await Tenant.find({ _id: { $in: rows.map((r) => r._id) } }).select('name slug').lean();
    const byId = new Map(tenants.map((t) => [String(t._id), t]));
    return rows.map((r) => ({ tenantId: r._id, name: byId.get(String(r._id))?.name || null, slug: byId.get(String(r._id))?.slug || null, gmv: roundMoney(r.gmv), orders: r.orders }));
  }

  async topVendors({ from, to, limit = 10 }) {
    const match = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(`${String(from).slice(0, 10)}T00:00:00.000Z`);
      if (to) match.createdAt.$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`);
    }
    const rows = await OrderItem.aggregate([
      { $match: { ...match, vendorId: { $ne: null } } },
      { $group: { _id: '$vendorId', gmv: { $sum: '$lineTotal' }, orders: { $sum: 1 } } },
      { $sort: { gmv: -1 } },
      { $limit: Math.min(limit, 25) },
    ]);
    const vendors = await Vendor.find({ _id: { $in: rows.map((r) => r._id) } }).select('businessName slug').lean();
    const byId = new Map(vendors.map((v) => [String(v._id), v]));
    return rows.map((r) => ({ vendorId: r._id, businessName: byId.get(String(r._id))?.businessName || null, slug: byId.get(String(r._id))?.slug || null, gmv: roundMoney(r.gmv), orders: r.orders }));
  }

  /** Idempotent platformdailies rebuild for a date range. */
  async rebuildPlatformDaily({ from, to, req = null, actorId = null }) {
    const fromStr = String(from).slice(0, 10);
    const toStr = String(to).slice(0, 10);
    const out = [];
    const cursor = new Date(`${fromStr}T00:00:00.000Z`);
    const end = new Date(`${toStr}T00:00:00.000Z`);
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(`${date}T23:59:59.999Z`);

      const [rolled, invoices, subs, [tenantsNew], [vendorsNew], [activeTenants]] = await Promise.all([
        AnalyticsDaily.aggregate([
          { $match: { hubId: null, date } },
          { $group: { _id: null, orders: { $sum: '$ordersCreated' }, gmv: { $sum: '$gmv' }, netRevenue: { $sum: '$netRevenue' } } },
        ]),
        Invoice.aggregate([
          { $match: { status: { $in: [INVOICE_STATUS.OPEN, INVOICE_STATUS.PAID, INVOICE_STATUS.OVERDUE] }, createdAt: { $gte: dayStart, $lte: dayEnd } } },
          { $unwind: '$lineItems' },
          { $match: { 'lineItems.type': INVOICE_LINE_TYPE.COMMISSION } },
          { $group: { _id: null, commissions: { $sum: '$lineItems.amount' } } },
        ]),
        Subscription.aggregate([
          { $match: LIVE_SUB },
          { $group: { _id: null, mrr: { $sum: '$planSnapshot.priceMonthly' }, byPlan: { $push: '$planCode' } } },
        ]),
        Tenant.aggregate([{ $match: { createdAt: { $gte: dayStart, $lte: dayEnd } } }, { $group: { _id: null, n: { $sum: 1 } } }]),
        Vendor.aggregate([{ $match: { joinedAt: { $gte: dayStart, $lte: dayEnd } } }, { $group: { _id: null, n: { $sum: 1 } } }]),
        Tenant.aggregate([{ $match: { status: 'active' } }, { $group: { _id: null, n: { $sum: 1 } } }]),
      ]);

      const byPlan = {};
      for (const code of (subs[0]?.byPlan || [])) byPlan[code] = (byPlan[code] || 0) + 1;

      await PlatformDaily.updateOne(
        { date },
        {
          $set: {
            orders: rolled[0]?.orders || 0,
            gmv: roundMoney(rolled[0]?.gmv || 0),
            netRevenue: roundMoney(rolled[0]?.netRevenue || 0),
            commissionsAccrued: roundMoney(invoices[0]?.commissions || 0),
            mrr: roundMoney(subs[0]?.mrr || 0),
            activeTenants: activeTenants?.n || 0,
            newTenants: tenantsNew?.n || 0,
            newVendors: vendorsNew?.n || 0,
            byPlan,
            computedAt: new Date(),
          },
        },
        { upsert: true }
      );
      out.push(date);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    await auditService.record({
      action: 'platform_rollup', entityType: 'platform_daily', entityId: null,
      tenantId: null, actorId, actorType: actorId ? 'admin' : 'system',
      after: { from: fromStr, to: toStr, days: out.length }, req,
    }).catch(() => {});
    return { rebuiltDays: out.length, days: out };
  }
}

export default new MarketplaceAnalyticsService();
