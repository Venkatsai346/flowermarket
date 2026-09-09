/**
 * DemandForecastService — inventory demand prediction.
 *
 * Uses historical order data to predict future demand per product.
 * Three forecasting methods:
 *   1. Moving average (last N weeks)
 *   2. Weighted moving average (recent weeks weighted more)
 *   3. Trend-adjusted (accounts for growth/decline direction)
 *
 * Results are used for:
 *   - Stock reorder alerts (demand > current stock)
 *   - Procurement planning
 *   - Warehouse allocation
 *
 * All queries are tenant-scoped and use aggregation pipelines for efficiency.
 */

import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import Inventory from '../models/inventory.model.js';
import { badRequest } from '../utils/ApiError.js';

/** ISO week number helper */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

class DemandForecastService {
  /**
   * Generate demand forecast for all products (or a specific product).
   *
   * @param {Object} opts
   * @param {string} opts.tenantId
   * @param {string} [opts.tenantProductId] — specific product (null = all)
   * @param {number} [opts.weeks=12] — lookback window in weeks
   * @param {number} [opts.forecastWeeks=4] — forecast horizon
   * @param {string} [opts.method='weighted'] — 'simple' | 'weighted' | 'trend'
   */
  async forecast({ tenantId, tenantProductId = null, weeks = 12, forecastWeeks = 4, method = 'weighted' }) {
    if (!['simple', 'weighted', 'trend'].includes(method)) {
      throw badRequest('Method must be simple, weighted, or trend', 'INVALID_METHOD');
    }

    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);

    // Aggregate historical sales per product per week
    const matchStage = {
      tenantId,
      status: { $in: ['delivered', 'completed'] },
      createdAt: { $gte: since },
    };

    const pipeline = [
      { $match: matchStage },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            productId: '$items.tenantProductId',
            year: { $year: '$createdAt' },
            week: { $isoWeek: '$createdAt' },
          },
          totalQty: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } },
    ];

    if (tenantProductId) {
      pipeline[0].$match['items.tenantProductId'] = tenantProductId; // eslint-disable-line
    }

    const weeklyData = await Order.aggregate(pipeline);

    // Group by product
    const byProduct = new Map();
    for (const row of weeklyData) {
      const pid = String(row._id.productId);
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid).push({
        year: row._id.year,
        week: row._id.week,
        qty: row.totalQty,
        revenue: row.totalRevenue,
        orders: row.orderCount,
      });
    }

    // Calculate forecasts
    const results = [];
    for (const [productId, weeks_data] of byProduct) {
      const forecasted = this._calculateForecast(weeks_data, forecastWeeks, method);
      const product = await TenantProduct.findOne({ _id: productId, tenantId })
        .select('name sku stockQty availability').lean();
      const inventory = await Inventory.findOne({ tenantId, tenantProductId: productId })
        .select('qtyOnHand qtyReserved').lean();

      const currentStock = inventory
        ? Math.max(0, (inventory.qtyOnHand || 0) - (inventory.qtyReserved || 0))
        : product?.stockQty || 0;

      const weeklyDemand = forecasted.forecastPerWeek || 0;
      const totalDemand = weeklyDemand * forecastWeeks;
      const weeksOfStock = weeklyDemand > 0 ? Math.floor(currentStock / weeklyDemand) : Infinity;

      results.push({
        productId,
        productName: product?.name || 'Unknown',
        sku: product?.sku || '',
        currentStock,
        historicalWeeks: weeks_data.length,
        avgWeeklyDemand: Math.round(weeklyDemand * 10) / 10,
        forecastTotalDemand: Math.round(totalDemand),
        forecastWeeks,
        method,
        weeksOfStock: weeksOfStock === Infinity ? null : weeksOfStock,
        reorderNeeded: currentStock < totalDemand,
        reorderQty: Math.max(0, Math.round(totalDemand - currentStock)),
        confidence: forecasted.confidence,
        trend: forecasted.trend,
        weeklyHistory: weeks_data.slice(-8), // last 8 weeks for charting
      });
    }

    // Sort by urgency (lowest weeks of stock first)
    results.sort((a, b) => {
      const aW = a.weeksOfStock === null ? 999 : a.weeksOfStock;
      const bW = b.weeksOfStock === null ? 999 : b.weeksOfStock;
      return aW - bW;
    });

    return {
      forecasts: results,
      meta: {
        weeks,
        forecastWeeks,
        method,
        productsAnalyzed: results.length,
        reorderAlerts: results.filter((r) => r.reorderNeeded).length,
      },
    };
  }

  /**
   * Get reorder alerts only — products where demand exceeds stock.
   */
  async reorderAlerts({ tenantId, weeks = 12 }) {
    const full = await this.forecast({ tenantId, weeks, forecastWeeks: 2, method: 'weighted' });
    return {
      alerts: full.forecasts.filter((f) => f.reorderNeeded),
      meta: full.meta,
    };
  }

  /**
   * Get demand trend for a specific product (weekly breakdown).
   */
  async productTrend({ tenantId, tenantProductId, weeks = 16 }) {
    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);

    const pipeline = [
      {
        $match: {
          tenantId,
          status: { $in: ['delivered', 'completed'] },
          createdAt: { $gte: since },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.tenantProductId': tenantProductId } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            week: { $isoWeek: '$createdAt' },
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          },
          totalQty: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } },
    ];

    const data = await Order.aggregate(pipeline);
    return data.map((d) => ({
      week: `${d._id.year}-W${String(d._id.week).padStart(2, '0')}`,
      qty: d.totalQty,
      revenue: d.totalRevenue,
    }));
  }

  // ----------------------------------------------------------------
  // Internal forecast methods
  // ----------------------------------------------------------------

  _calculateForecast(weeksData, forecastWeeks, method) {
    if (!weeksData.length) {
      return { forecastPerWeek: 0, confidence: 0, trend: 'flat' };
    }

    const quantities = weeksData.map((w) => w.qty);

    switch (method) {
      case 'simple':
        return this._simpleMovingAverage(quantities, forecastWeeks);
      case 'weighted':
        return this._weightedMovingAverage(quantities, forecastWeeks);
      case 'trend':
        return this._trendAdjusted(quantities, forecastWeeks);
      default:
        return this._weightedMovingAverage(quantities, forecastWeeks);
    }
  }

  _simpleMovingAverage(qty, forecastWeeks) {
    const avg = qty.reduce((s, q) => s + q, 0) / qty.length;
    return {
      forecastPerWeek: avg,
      forecastTotal: Math.round(avg * forecastWeeks),
      confidence: Math.min(0.9, qty.length / 12),
      trend: 'flat',
    };
  }

  _weightedMovingAverage(qty, forecastWeeks) {
    // More recent weeks get higher weight
    const weights = qty.map((_, i) => i + 1);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const weighted = qty.reduce((s, q, i) => s + q * weights[i], 0) / totalWeight;

    return {
      forecastPerWeek: weighted,
      forecastTotal: Math.round(weighted * forecastWeeks),
      confidence: Math.min(0.85, qty.length / 10),
      trend: this._detectTrend(qty),
    };
  }

  _trendAdjusted(qty, forecastWeeks) {
    if (qty.length < 3) return this._weightedMovingAverage(qty, forecastWeeks);

    // Simple linear regression: y = a + bx
    const n = qty.length;
    const xs = qty.map((_, i) => i);
    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = qty.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * qty[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
    const intercept = (sumY - slope * sumX) / n;

    // Forecast next weeks
    const nextWeek = n + forecastWeeks / 2;
    const forecastPerWeek = Math.max(0, intercept + slope * nextWeek);

    return {
      forecastPerWeek,
      forecastTotal: Math.round(forecastPerWeek * forecastWeeks),
      confidence: Math.min(0.8, qty.length / 12),
      trend: slope > 0.5 ? 'growing' : slope < -0.5 ? 'declining' : 'flat',
      slope: Math.round(slope * 100) / 100,
    };
  }

  _detectTrend(qty) {
    if (qty.length < 4) return 'flat';
    const half = Math.floor(qty.length / 2);
    const firstHalf = qty.slice(0, half).reduce((s, q) => s + q, 0) / half;
    const secondHalf = qty.slice(half).reduce((s, q) => s + q, 0) / (qty.length - half);
    const change = (secondHalf - firstHalf) / (firstHalf || 1);
    if (change > 0.2) return 'growing';
    if (change < -0.2) return 'declining';
    return 'flat';
  }
}

export default new DemandForecastService();
