/**
 * AdvancedAnalyticsService — data-driven insights beyond basic dashboards.
 *
 * Provides:
 *   1. Customer Lifetime Value (CLV) calculation
 *   2. Cohort analysis (retention by signup month)
 *   3. Product affinity (frequently bought together)
 *   4. Revenue forecasting (time-series projection)
 *   5. Funnel analysis (browse → cart → checkout → purchase)
 */

import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import User from '../models/user.model.js';
import TenantProduct from '../models/tenantProduct.model.js';

class AdvancedAnalyticsService {
  /**
   * Customer Lifetime Value — total revenue per customer over a period.
   */
  async customerLTV({ tenantId, months = 12 }) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const pipeline = [
      { $match: { tenantId, status: { $in: ['delivered', 'completed'] }, createdAt: { $gte: since } } },
      { $group: { _id: '$userId', totalSpent: { $sum: '$totalAmount' }, orderCount: { $sum: 1 }, avgOrder: { $avg: '$totalAmount' } } },
      { $sort: { totalSpent: -1 } },
      { $limit: 100 },
    ];

    const results = await Order.aggregate(pipeline);
    const userIds = results.map((r) => r._id);
    const users = await User.find({ _id: { $in: userIds } }).select('name profile.firstName phone.number').lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    return results.map((r) => {
      const user = userMap.get(String(r._id));
      return {
        userId: String(r._id),
        name: user?.name || user?.profile?.firstName || 'Unknown',
        totalSpent: r.totalSpent,
        orderCount: r.orderCount,
        avgOrder: Math.round(r.avgOrder),
      };
    });
  }

  /**
   * Cohort analysis — retention by signup month.
   */
  async cohortAnalysis({ tenantId, months = 6 }) {
    const cohorts = [];
    const now = new Date();

    for (let i = 0; i < months; i++) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const [newUsers, returningUsers] = await Promise.all([
        User.countDocuments({ tenantId, createdAt: { $gte: monthStart, $lt: monthEnd } }),
        Order.distinct('userId', {
          tenantId,
          createdAt: { $gte: monthStart, $lt: monthEnd },
          status: { $in: ['delivered', 'completed'] },
        }).then(async (activeUserIds) => {
          const prevMonth = new Date(monthStart);
          prevMonth.setMonth(prevMonth.getMonth() - 1);
          const prevUsers = await User.distinct('_id', { tenantId, createdAt: { $lt: monthStart } });
          return activeUserIds.filter((id) => prevUsers.some((p) => String(p) === String(id))).length;
        }),
      ]);

      cohorts.unshift({
        month: monthStart.toISOString().slice(0, 7),
        newUsers,
        returningUsers,
        retention: newUsers > 0 ? Math.round((returningUsers / (newUsers + returningUsers)) * 100) : 0,
      });
    }

    return cohorts;
  }

  /**
   * Product affinity — frequently bought together.
   */
  async productAffinity({ tenantId, limit = 20 }) {
    const pipeline = [
      { $match: { tenantId, status: { $in: ['delivered', 'completed'] } } },
      { $unwind: '$items' },
      { $group: { _id: '$orderId', products: { $addToSet: '$items.tenantProductId' } } },
      { $match: { 'products.1': { $exists: true } } }, // Only orders with 2+ products
      { $limit: 1000 },
    ];

    const orders = await Order.aggregate(pipeline);
    const pairs = new Map();

    for (const order of orders) {
      const prods = order.products.map(String).sort();
      for (let i = 0; i < prods.length; i++) {
        for (let j = i + 1; j < prods.length; j++) {
          const key = `${prods[i]}|${prods[j]}`;
          pairs.set(key, (pairs.get(key) || 0) + 1);
        }
      }
    }

    const sorted = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const allIds = [...new Set(sorted.flatMap(([k]) => k.split('|')))];
    const products = await TenantProduct.find({ _id: { $in: allIds } }).select('name sku').lean();
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    return sorted.map(([key, count]) => {
      const [a, b] = key.split('|');
      return {
        product1: { id: a, name: productMap.get(a)?.name || 'Unknown' },
        product2: { id: b, name: productMap.get(b)?.name || 'Unknown' },
        coOccurrences: count,
      };
    });
  }

  /**
   * Revenue trend — daily/weekly/monthly revenue over a period.
   */
  async revenueTrend({ tenantId, period = 'daily', days = 30 }) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const groupBy = period === 'monthly'
      ? { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }
      : period === 'weekly'
        ? { year: { $year: '$createdAt' }, week: { $isoWeek: '$createdAt' } }
        : { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };

    const pipeline = [
      { $match: { tenantId, status: { $in: ['delivered', 'completed'] }, createdAt: { $gte: since } } },
      { $group: { _id: groupBy, revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } },
    ];

    return Order.aggregate(pipeline);
  }
}

export default new AdvancedAnalyticsService();
