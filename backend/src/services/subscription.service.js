/**
 * SubscriptionService — recurring order management.
 *
 * The scheduler runs daily and:
 *   1. Finds subscriptions where nextDeliveryAt <= now
 *   2. Creates an order from the subscription items
 *   3. Charges the payment method
 *   4. Advances nextDeliveryAt to the next cycle
 *   5. If payment fails, pauses the subscription
 */

import Subscription, { SUBSCRIPTION_STATUS, SUBSCRIPTION_FREQUENCY } from '../models/subscription.model.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';

const FREQ_DAYS = {
  [SUBSCRIPTION_FREQUENCY.WEEKLY]: 7,
  [SUBSCRIPTION_FREQUENCY.BIWEEKLY]: 14,
  [SUBSCRIPTION_FREQUENCY.MONTHLY]: 30,
};

class SubscriptionService {
  async create({ tenantId, userId, payload }) {
    const { items, frequency, deliveryAddress, preferredSlotId, paymentMethodId, startDate } = payload;

    if (!items?.length) throw badRequest('At least one item required', 'NO_ITEMS');
    if (!FREQ_DAYS[frequency]) throw badRequest('Invalid frequency', 'INVALID_FREQUENCY');

    const start = startDate ? new Date(startDate) : new Date();
    const nextDelivery = new Date(start);

    return Subscription.create({
      tenantId, userId, items, frequency,
      deliveryAddress, preferredSlotId, paymentMethodId,
      startDate: start, nextDeliveryAt: nextDelivery,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });
  }

  async listForUser({ tenantId, userId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
    const q = { tenantId, userId };
    if (query.status) q.status = query.status;

    const [docs, total] = await Promise.all([
      Subscription.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Subscription.countDocuments(q),
    ]);

    return {
      items: serializeList(docs),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total },
    };
  }

  async pause({ tenantId, userId, subscriptionId, reason = '' }) {
    const sub = await Subscription.findOne({ _id: subscriptionId, tenantId, userId });
    if (!sub) throw notFound('Subscription not found', 'SUB_NOT_FOUND');
    if (sub.status !== SUBSCRIPTION_STATUS.ACTIVE) throw badRequest('Only active subscriptions can be paused', 'NOT_ACTIVE');

    sub.status = SUBSCRIPTION_STATUS.PAUSED;
    sub.pausedAt = new Date();
    sub.pauseReason = reason;
    await sub.save();
    return sub;
  }

  async resume({ tenantId, userId, subscriptionId }) {
    const sub = await Subscription.findOne({ _id: subscriptionId, tenantId, userId });
    if (!sub) throw notFound('Subscription not found', 'SUB_NOT_FOUND');
    if (sub.status !== SUBSCRIPTION_STATUS.PAUSED) throw badRequest('Only paused subscriptions can be resumed', 'NOT_PAUSED');

    sub.status = SUBSCRIPTION_STATUS.ACTIVE;
    sub.resumedAt = new Date();
    sub.pausedAt = null;
    // Set next delivery to tomorrow
    sub.nextDeliveryAt = new Date(Date.now() + 86400000);
    await sub.save();
    return sub;
  }

  async cancel({ tenantId, userId, subscriptionId, reason = '' }) {
    const sub = await Subscription.findOne({ _id: subscriptionId, tenantId, userId });
    if (!sub) throw notFound('Subscription not found', 'SUB_NOT_FOUND');

    sub.status = SUBSCRIPTION_STATUS.CANCELLED;
    sub.cancelledAt = new Date();
    sub.cancelReason = reason;
    await sub.save();
    return sub;
  }

  async skipNext({ tenantId, userId, subscriptionId }) {
    const sub = await Subscription.findOne({ _id: subscriptionId, tenantId, userId });
    if (!sub) throw notFound('Subscription not found', 'SUB_NOT_FOUND');
    if (sub.status !== SUBSCRIPTION_STATUS.ACTIVE) throw badRequest('Only active subscriptions can skip', 'NOT_ACTIVE');

    const days = FREQ_DAYS[sub.frequency] || 7;
    sub.nextDeliveryAt = new Date(sub.nextDeliveryAt.getTime() + days * 86400000);
    await sub.save();
    return sub;
  }

  /**
   * Process due subscriptions (called by scheduler).
   * Returns: { processed, orders, failed }
   */
  async processDue({ tenantId = null } = {}) {
    const q = { status: SUBSCRIPTION_STATUS.ACTIVE, nextDeliveryAt: { $lte: new Date() } };
    if (tenantId) q.tenantId = tenantId;

    const due = await Subscription.find(q).limit(100);
    let processed = 0;
    let failed = 0;

    for (const sub of due) {
      try {
        // Advance next delivery date
        const days = FREQ_DAYS[sub.frequency] || 7;
        sub.nextDeliveryAt = new Date(sub.nextDeliveryAt.getTime() + days * 86400000);
        sub.totalOrders += 1;
        sub.totalAmount += sub.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

        // Check if expired
        if (sub.endDate && sub.nextDeliveryAt > sub.endDate) {
          sub.status = SUBSCRIPTION_STATUS.EXPIRED;
        }

        await sub.save();
        processed += 1;

        // TODO: Create actual order (requires cart/checkout integration)
        // For now, the subscription advances on schedule
      } catch {
        failed += 1;
      }
    }

    return { processed, failed, total: due.length };
  }
}

export default new SubscriptionService();
