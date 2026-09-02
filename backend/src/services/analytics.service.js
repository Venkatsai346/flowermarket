/**
 * AnalyticsService — the defensible numbers (Phase 4 blueprint §5).
 *
 * Every KPI is an exact formula over indexed fields. Formulas:
 *   ordersCreated = count of orders created in range (all statuses)
 *   gmv           = Σ totalAmount of orders created in range whose status ∉ cancelled
 *   netRevenue    = gmv − Σ refundTransaction.amount (refunds initiated in range)
 *   aov           = gmv / orders (excluding cancelled)
 *   delivered     = orders that reached delivered
 *   cancellationRate = cancelled / ordersCreated
 *   returnsRate   = returnRequests / delivered
 *   newCustomers  = customers created in range
 *   repeatCustomers = customers with ≥ 2 orders in range
 *   top products  = Σ orderitems (qty, revenue) excluding cancelled orders
 *   slot fill     = Σ reserved / Σ effectiveCapacity
 *
 * rebuildDailyStats() upserts `analyticsdailies` (idempotent — the nightly
 * job hook + manual /admin/analytics/rebuild).
 */

import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import RefundTransaction from '../models/refundTransaction.model.js';
import User from '../models/user.model.js';
import ReturnRequest from '../models/returnRequest.model.js';
import DeliverySlot from '../models/deliverySlot.model.js';
import AnalyticsDaily from '../models/analyticsDaily.model.js';
import ProductMaster from '../models/productMaster.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import { roundMoney } from '../utils/money.js';
import { ADMIN_DEFAULTS } from '../constants/enums.js';

const CANCELLED = new Set(['cancelled']);

function dayBounds(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const endExclusive = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000);
  return { start, endExclusive };
}

export class AnalyticsService {
  /**
   * Compute a full window of KPIs live (aggregations over orders).
   * @returns {{range, kpis, series[], byPaymentMethod, bySlotType}}
   */
  async dashboard({ tenantId, from, to, hubId = null }) {
    const { start, endExclusive } = dayBounds(from, to);
    const created = { createdAt: { $gte: start, $lt: endExclusive } };
    if (hubId) created['slotSnapshot.hubId'] = hubId;

    const orders = await Order.find({ tenantId, ...created }).lean();

    const createdCount = orders.length;
    const valid = orders.filter((o) => !CANCELLED.has(o.status));
    const gmv = roundMoney(valid.reduce((a, o) => a + (o.totalAmount || 0), 0));
    const delivered = orders.filter((o) => o.status === 'delivered').length;
    const cancelled = orders.filter((o) => CANCELLED.has(o.status)).length;

    const refundMatch = { tenantId, createdAt: { $gte: start, $lt: endExclusive }, status: { $in: ['success', 'initiated', 'pending'] } };
    if (hubId) refundMatch.orderId = { $in: orders.map((o) => o._id) };
    const refundAgg = await RefundTransaction.aggregate([
      { $match: refundMatch },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const refunded = refundAgg[0]?.total || 0;
    const netRevenue = roundMoney(gmv - refunded);
    const aov = valid.length ? roundMoney(gmv / valid.length) : 0;

    const byPaymentMethod = {};
    for (const o of valid) byPaymentMethod[o.paymentMethod || 'unknown'] = (byPaymentMethod[o.paymentMethod || 'unknown'] || 0) + 1;
    const bySlotType = {};
    for (const o of orders) {
      const st = o.slotSnapshot?.windowType || 'normal';
      bySlotType[st] = (bySlotType[st] || 0) + 1;
    }

    // ---- customers ----
    const newCustomers = await User.countDocuments({ tenantId, role: 'customer', createdAt: { $gte: start, $lt: endExclusive } });
    const orderCounts = await Order.aggregate([
      { $match: { tenantId, ...created } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
      { $match: { n: { $gte: 2 } } },
    ]);
    const repeatCustomers = orderCounts.length;

    // ---- returns ----
    const returnRequests = await ReturnRequest.countDocuments({ tenantId, createdAt: { $gte: start, $lt: endExclusive } });

    // ---- daily series (orders per day) ----
    const series = [];
    const cursor = new Date(start);
    while (cursor < endExclusive) {
      const day = cursor.toISOString().slice(0, 10);
      const dayOrders = orders.filter((o) => o.createdAt >= cursor && o.createdAt < new Date(cursor.getTime() + 86400000));
      const dayValid = dayOrders.filter((o) => !CANCELLED.has(o.status));
      const dayGmv = roundMoney(dayValid.reduce((a, o) => a + (o.totalAmount || 0), 0));
      series.push({
        date: day,
        orders: dayOrders.length,
        gmv: dayGmv,
        delivered: dayOrders.filter((o) => o.status === 'delivered').length,
        cancelled: dayOrders.filter((o) => CANCELLED.has(o.status)).length,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      range: { from, to, hubId },
      kpis: {
        ordersCreated: createdCount,
        gmv, netRevenue, aov, delivered, cancelled,
        deliverySuccessRate: orders.length ? roundMoney(delivered / orders.length) : 0,
        cancellationRate: createdCount ? roundMoney(cancelled / createdCount) : 0,
        returnsRate: delivered ? roundMoney(returnRequests / delivered) : 0,
        newCustomers, repeatCustomers,
        returnRequests,
      },
      series,
      byPaymentMethod,
      bySlotType,
    };
  }

  /** Top products by qty/revenue over the window (excludes cancelled). */
  async topProducts({ tenantId, from, to, limit = ADMIN_DEFAULTS.TOP_PRODUCTS_LIMIT, hubId = null }) {
    const { start, endExclusive } = dayBounds(from, to);
    const orderMatch = { tenantId, createdAt: { $gte: start, $lt: endExclusive }, status: { $nin: [...CANCELLED] } };
    if (hubId) orderMatch['slotSnapshot.hubId'] = hubId;
    const orderIds = (await Order.find(orderMatch).select('_id').lean()).map((o) => o._id);
    if (!orderIds.length) return [];

    const agg = await OrderItem.aggregate([
      { $match: { tenantId, orderId: { $in: orderIds } } },
      {
        $group: {
          _id: '$tenantProductId',
          qty: { $sum: '$qty' },
          revenue: { $sum: { $add: [{ $subtract: ['$lineTotal', '$discountAllocated'] }, '$taxAmount'] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: Math.min(limit, 100) },
    ]);
    if (!agg.length) return [];

    const listingIds = agg.map((a) => a._id).filter(Boolean);
    const listings = listingIds.length ? await TenantProduct.find({ tenantId, _id: { $in: listingIds } }).select('productMasterId skuSnapshot').lean() : [];
    const masterIds = [...new Set(listings.map((l) => String(l.productMasterId)).filter(Boolean))];
    const masters = masterIds.length ? await ProductMaster.find({ tenantId, _id: { $in: masterIds } }).select('title skuGlobal').lean() : [];
    const masterById = new Map(masters.map((m) => [String(m._id), m]));
    const listingById = new Map(listings.map((l) => [String(l._id), l]));

    return agg.map((a) => {
      const listing = listingById.get(String(a._id));
      const master = listing ? masterById.get(String(listing.productMasterId)) : null;
      return {
        tenantProductId: a._id,
        skuGlobal: master?.skuGlobal || listing?.skuSnapshot?.skuGlobal || null,
        title: master?.title || listing?.skuSnapshot?.title || null,
        qty: a.qty,
        revenue: roundMoney(a.revenue),
      };
    });
  }

  /** Category performance (via master.categoryId). */
  async categoryPerformance({ tenantId, from, to }) {
    const { start, endExclusive } = dayBounds(from, to);
    const orderIds = (await Order.find({ tenantId, createdAt: { $gte: start, $lt: endExclusive }, status: { $nin: [...CANCELLED] } }).select('_id').lean()).map((o) => o._id);
    if (!orderIds.length) return [];
    const listings = await TenantProduct.find({ tenantId }).select('productMasterId').lean();
    const masterIds = [...new Set(listings.map((l) => String(l.productMasterId)).filter(Boolean))];
    const masters = masterIds.length ? await ProductMaster.find({ tenantId, _id: { $in: masterIds } }).select('categoryId').lean() : [];
    const catByListing = new Map();
    const masterCat = new Map(masters.map((m) => [String(m._id), m.categoryId]));
    for (const l of listings) catByListing.set(String(l._id), masterCat.get(String(l.productMasterId)) || null);

    const agg = await OrderItem.aggregate([
      { $match: { tenantId, orderId: { $in: orderIds } } },
      { $group: { _id: '$tenantProductId', qty: { $sum: '$qty' }, revenue: { $sum: { $add: [{ $subtract: ['$lineTotal', '$discountAllocated'] }, '$taxAmount'] } } } },
    ]);
    const byCat = {};
    for (const a of agg) {
      const cat = catByListing.get(String(a._id));
      if (!cat) continue;
      byCat[cat] = byCat[cat] || { categoryId: cat, qty: 0, revenue: 0 };
      byCat[cat].qty += a.qty;
      byCat[cat].revenue = roundMoney(byCat[cat].revenue + a.revenue);
    }
    return Object.values(byCat).sort((x, y) => y.revenue - x.revenue);
  }

  /** Hub performance. */
  async hubPerformance({ tenantId, from, to }) {
    const { start, endExclusive } = dayBounds(from, to);
    const agg = await Order.aggregate([
      { $match: { tenantId, createdAt: { $gte: start, $lt: endExclusive } } },
      {
        $group: {
          _id: '$slotSnapshot.hubId',
          orders: { $sum: 1 },
          gmv: { $sum: { $cond: [{ $in: ['$status', [...CANCELLED]] }, 0, '$totalAmount'] } },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        },
      },
      { $sort: { gmv: -1 } },
    ]);
    return agg.map((a) => ({ hubId: a._id, orders: a.orders, gmv: roundMoney(a.gmv), delivered: a.delivered }));
  }

  /** Slot fill-rate trend + overbooked count over the window. */
  async slotPerformance({ tenantId, from, to, hubId = null }) {
    const days = [];
    const cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      const q = { tenantId, date, status: { $in: ['open', 'full', 'closed'] } };
      if (hubId) q.hubId = hubId;
      const slots = await DeliverySlot.find(q).lean();
      let capacity = 0; let reserved = 0;
      for (const s of slots) {
        capacity += s.manualCapacity ?? s.totalCapacity;
        reserved += s.reservedCapacity;
      }
      days.push({
        date,
        slots: slots.length,
        capacity,
        reserved,
        fillRate: capacity ? roundMoney(reserved / capacity) : 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const overbooked = days.filter((d) => d.reserved > d.capacity).length;
    return { days, overbooked };
  }

  /**
   * Nightly job hook + manual rebuild: idempotent upsert of analyticsdailies.
   * Rows: tenant-wide (hubId null) + per hub.
   */
  async rebuildDailyStats({ tenantId, from, to }) {
    const { start, endExclusive } = dayBounds(from, to);
    const out = [];
    const cursor = new Date(start);
    while (cursor < endExclusive) {
      const date = cursor.toISOString().slice(0, 10);
      const dayOrders = await Order.find({ tenantId, createdAt: { $gte: cursor, $lt: new Date(cursor.getTime() + 86400000) } }).lean();

      const compute = async (hubId) => {
        const orders = hubId ? dayOrders.filter((o) => o.slotSnapshot?.hubId && String(o.slotSnapshot.hubId) === String(hubId)) : dayOrders;
        const valid = orders.filter((o) => !CANCELLED.has(o.status));
        const gmv = roundMoney(valid.reduce((a, o) => a + (o.totalAmount || 0), 0));
        const orderIds = orders.map((o) => o._id);
        const refundAgg = orderIds.length ? await RefundTransaction.aggregate([
          { $match: { tenantId, orderId: { $in: orderIds }, status: { $in: ['success', 'initiated', 'pending'] } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]) : [];
        const netRevenue = roundMoney(gmv - (refundAgg[0]?.total || 0));

        const top = await this.topProducts({ tenantId, from: date, to: date, hubId });
        const byPaymentMethod = {};
        const bySlotType = {};
        for (const o of valid) byPaymentMethod[o.paymentMethod || 'unknown'] = (byPaymentMethod[o.paymentMethod || 'unknown'] || 0) + 1;
        for (const o of orders) { const st = o.slotSnapshot?.windowType || 'normal'; bySlotType[st] = (bySlotType[st] || 0) + 1; }

        return AnalyticsDaily.updateOne(
          { tenantId, hubId, date },
          {
            $set: {
              ordersCreated: orders.length,
              gmv,
              netRevenue,
              aov: valid.length ? roundMoney(gmv / valid.length) : 0,
              delivered: orders.filter((o) => o.status === 'delivered').length,
              cancelled: orders.filter((o) => CANCELLED.has(o.status)).length,
              returnRequests: await ReturnRequest.countDocuments({ tenantId, createdAt: { $gte: cursor, $lt: new Date(cursor.getTime() + 86400000) } }),
              newCustomers: await User.countDocuments({ tenantId, role: 'customer', createdAt: { $gte: cursor, $lt: new Date(cursor.getTime() + 86400000) } }),
              repeatCustomers: (await Order.aggregate([
                { $match: { tenantId, createdAt: { $gte: cursor, $lt: new Date(cursor.getTime() + 86400000) } } },
                { $group: { _id: '$userId', n: { $sum: 1 } } },
                { $match: { n: { $gte: 2 } } },
              ])).length,
              byPaymentMethod, bySlotType,
              topProducts: top.slice(0, ADMIN_DEFAULTS.TOP_PRODUCTS_LIMIT),
              version: 1,
              computedAt: new Date(),
            },
          },
          { upsert: true }
        );
      };

      await compute(null); // tenant-wide
      const hubIds = [...new Set(dayOrders.map((o) => o.slotSnapshot?.hubId).filter(Boolean))];
      for (const h of hubIds) await compute(h);

      out.push(date);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return { rebuiltDays: out.length, days: out };
  }

  /** CSV of daily series (rollup-first: use analyticsdailies when built). */
  async csv({ tenantId, from, to, hubId = null }) {
    const rolled = await AnalyticsDaily.find({ tenantId, date: { $gte: from, $lte: to }, ...(hubId ? { hubId } : { hubId: null }) }).sort({ date: 1 }).lean();
    if (rolled.length) {
      return rolled.map((r) => ({
        date: r.date, hubId: r.hubId || 'ALL', ordersCreated: r.ordersCreated, gmv: r.gmv,
        netRevenue: r.netRevenue, aov: r.aov, delivered: r.delivered, cancelled: r.cancelled,
        returnRequests: r.returnRequests, newCustomers: r.newCustomers, repeatCustomers: r.repeatCustomers,
      }));
    }
    const d = await this.dashboard({ tenantId, from, to, hubId });
    return d.series.map((s) => ({ date: s.date, hubId: hubId || 'ALL', ordersCreated: s.orders, gmv: s.gmv, delivered: s.delivered, cancelled: s.cancelled }));
  }
}

export default new AnalyticsService();
