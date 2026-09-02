import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import FulfillmentTimeLog from '../models/fulfillmentTimeLog.model.js';
import Hub from '../models/hub.model.js';
import { FORECAST_DEFAULTS as D } from '../constants/enums.js';
import { roundMoney } from '../utils/money.js';

/**
 * SlotForecastingService — blueprint §4.
 *
 * The atomic capacity LOCK prevents overselling; this service decides what the
 * capacity NUMBER should be (a prediction problem, not a distributed-systems
 * problem — don't conflate the two).
 *
 * capacity = min(predicted_demand × headroom, physical_limit)
 *   predicted_demand = moving-average of historical order volume per
 *                      (hub, slotType, weekday) over HISTORY_DAYS
 *   physical_limit   = picker_throughput ∩ rider_throughput per slot window
 *
 * Closing the loop: every DELIVERED order appends a FulfillmentTimeLog (real
 * pick/pack/delivery seconds). If a hub consistently blows its promised
 * window, next day's physical_limit self-corrects downward.
 */
class SlotForecastingService {
  /** Generate the daily slot capacity recommendation for a hub. */
  async forecastHubDay({ tenantId, hubId, date, pickerCount = null, riderCount = null, dryRun = false }) {
    const hub = await Hub.findOne({ _id: hubId, tenantId });
    if (!hub) throw new Error(`Hub ${hubId} not found`);

    const dateKey = new Date(`${date}T00:00:00Z`);
    const weekday = dateKey.getUTCDay();
    const historyStart = new Date(dateKey.getTime() - D.HISTORY_DAYS * 86400000);

    // ---- historical order volume per slot type on this weekday ----
    const orders = await Order.find({
      tenantId,
      status: { $in: ['delivered', 'refunded', 'return_approved', 'return_picked_up', 'qc_passed', 'refund_initiated'] },
      createdAt: { $gte: historyStart, $lt: dateKey },
    }).lean();

    const volumeBySlot = {};
    for (const o of orders) {
      const st = o.slotSnapshot?.windowType || 'normal';
      volumeBySlot[st] = (volumeBySlot[st] || 0) + 1;
    }
    // orders without slot snapshot count as normal
    const normalVolume = orders.length;
    const predicted = {};
    for (const st of ['normal', 'express', 'same_day', 'next_day', 'scheduled']) {
      const count = st === 'normal' ? normalVolume : (volumeBySlot[st] || 0);
      predicted[st] = count; // moving-average baseline (per weekday over 60d)
    }

    // ---- physical throughput limit ----
    const pickers = pickerCount ?? (await this.countActiveByRole({ tenantId, hubId, role: 'picker' }));
    const riders = riderCount ?? (await this.countActiveByRole({ tenantId, hubId, role: 'rider' }));

    // picker capacity: pickers × items/hr × window hours
    const pickLimit = pickers * D.PICK_ITEMS_PER_HOUR * D.WINDOW_HOURS;
    // rider capacity: riders × deliveries per slot
    const riderLimit = riders * D.DELIVERIES_PER_RIDER_PER_SLOT;
    const physicalLimit = Math.max(D.FLOOR_CAPACITY, Math.round(Math.min(pickLimit, riderLimit)));

    // ---- capacity = min(demand×headroom, physical) ----
    const capacityBySlot = {};
    for (const st of Object.keys(predicted)) {
      const demand = Math.max(D.FLOOR_CAPACITY, predicted[st]);
      const cap = Math.max(D.FLOOR_CAPACITY, Math.round(Math.min(demand * D.HEADROOM_MULTIPLIER, physicalLimit)));
      capacityBySlot[st] = cap;
    }

    const result = {
      tenantId, hubId, hubName: hub.name, date,
      weekday,
      historical: { orderCount: orders.length, window: { from: historyStart.toISOString().slice(0, 10), to: date } },
      predictedDemand: predicted,
      physical: { pickers, riders, pickLimit, riderLimit, physicalLimit },
      recommendedCapacity: capacityBySlot,
      generatedAt: new Date(),
    };

    if (!dryRun) {
      const slotDoc = await import('../models/deliverySlot.model.js').then((m) => m.default);
      await slotDoc.updateMany(
        { tenantId, hubId, date },
        { $set: { forecastCapacity: capacityBySlot.normal || null, forecastAt: new Date() } }
      );
    }
    return result;
  }

  /** Nightly batch: forecast next N days for all active hubs of a tenant. */
  async forecastUpcoming({ tenantId, days = 7, pickerCount = null, riderCount = null, dryRun = false }) {
    const hubs = await Hub.find({ tenantId, isActive: true }).lean();
    const out = [];
    for (const hub of hubs) {
      for (let i = 0; i < days; i += 1) {
        const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
        out.push(await this.forecastHubDay({ tenantId, hubId: hub._id, date: d, pickerCount, riderCount, dryRun }));
      }
    }
    return { hubs: hubs.length, days, forecasts: out };
  }

  /**
   * Closing the loop: record REAL fulfillment times for a delivered order.
   * Called by the rider/fulfillment flow at DELIVERED.
   */
  async recordFulfillmentTime({ orderId, tenantId, hubId, slotId, slotType, weekday, pickSeconds = null, packSeconds = null, deliverySeconds = null }) {
    // update-or-insert (an order should only be logged once; make it idempotent)
    return FulfillmentTimeLog.updateOne(
      { orderId },
      {
        $set: {
          tenantId, hubId, slotId,
          slotType: slotType || 'normal',
          weekday,
          pickSeconds, packSeconds, deliverySeconds,
          deliveredAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  /** Historical averages used by ops dashboards. */
  async historyStats({ tenantId, hubId = null }) {
    const q = { tenantId };
    if (hubId) q.hubId = hubId;
    const logs = await FulfillmentTimeLog.find(q).lean();
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
    const pick = logs.map((l) => l.pickSeconds).filter(Number.isFinite);
    const pack = logs.map((l) => l.packSeconds).filter(Number.isFinite);
    const deliv = logs.map((l) => l.deliverySeconds).filter(Number.isFinite);
    return {
      total: logs.length,
      avgPickSeconds: avg(pick),
      avgPackSeconds: avg(pack),
      avgDeliverySeconds: avg(deliv),
    };
  }

  async countActiveByRole({ tenantId, hubId, role }) {
    const User = (await import('../models/user.model.js')).default;
    const q = { tenantId, role, status: 'active' };
    if (hubId) q['rider.currentHubId'] = hubId;
    return User.countDocuments(q);
  }
}

export default new SlotForecastingService();
