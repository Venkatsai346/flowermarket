/**
 * NotificationService — template resolution, rendering, enqueue (outbox),
 * the sending worker, the customer inbox, and the event→notification
 * consumer (Phase 4b blueprint §3-5).
 *
 * Rules:
 *  - Template resolution: tenant-specific first, platform default (tenantId
 *    null) fallback. Missing/inactive template → skip silently (never poison
 *    the event drain).
 *  - Rendering: {{key}} ← payload; unknown keys → ''; truncate per channel.
 *  - Enqueue is ONE insert (fast); sending happens in processPending().
 *  - dedupeKey unique → dispatch is idempotent.
 */

import Notification from '../models/notification.model.js';
import NotificationTemplate from '../models/notificationTemplate.model.js';
import Device from '../models/device.model.js';
import User from '../models/user.model.js';
import notificationProvider from './notificationProvider.service.js';
import catalogEventService, { registerCatalogEventHandler } from './catalogEvent.service.js';
import Order from '../models/order.model.js';
import { serializeList } from '../utils/serialize.js';
import { notFound, badRequest, conflict } from '../utils/ApiError.js';
import config from '../config/index.js';
import { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS, NOTIFICATION_PRIORITY } from '../constants/enums.js';

const MAX_LEN = { push: 500, email: 10000, sms: 1600 };

/** {{key}} renderer — safe for any placeholder shape. */
export function renderTemplate(text, data = {}) {
  if (!text) return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const val = data[key];
    return val === null || val === undefined ? '' : String(val);
  });
}

/** Resolve template: tenant-specific → platform default. */
async function resolveTemplate({ tenantId, code }) {
  let tpl = await NotificationTemplate.findOne({ tenantId, code, isActive: true }).lean();
  if (!tpl) tpl = await NotificationTemplate.findOne({ tenantId: null, code, isActive: true }).lean();
  return tpl || null;
}

class NotificationService {
  /** Reachable channels for a user (push needs an active device). */
  async reachableChannels({ tenantId, userId, preferred }) {
    const channels = new Set(preferred || []);
    const [deviceCount, user] = await Promise.all([
      Device.countDocuments({ tenantId, userId, status: 'active' }),
      User.findOne({ _id: userId, tenantId }).lean(),
    ]);
    if (deviceCount === 0) channels.delete(NOTIFICATION_CHANNEL.PUSH);
    if (!user?.phone?.verified) channels.delete(NOTIFICATION_CHANNEL.SMS);
    if (!user?.email?.verified) channels.delete(NOTIFICATION_CHANNEL.EMAIL);
    return [...channels];
  }

  /**
   * Enqueue a notification for a user (idempotent on dedupeKey).
   * @returns {{created: boolean, notification}}
   */
  async dispatch({ tenantId, userId, orderId = null, templateCode, data = {}, channels = null, dedupeKey = null, actorId = null, req = null }) {
    const tpl = await resolveTemplate({ tenantId, code: templateCode });
    if (!tpl) return { created: false, notification: null, reason: 'template_missing' };

    // which channels actually fire (template ∩ requested ∩ reachable)
    const tplChannels = tpl.channels || [NOTIFICATION_CHANNEL.PUSH];
    const requested = channels ? channels.filter((c) => tplChannels.includes(c)) : tplChannels;
    const effective = await this.reachableChannels({ tenantId, userId, preferred: requested });
    if (!effective.length) return { created: false, notification: null, reason: 'no_channel' };

    if (dedupeKey) {
      const existing = await Notification.findOne({ tenantId, dedupeKey });
      if (existing) return { created: false, notification: existing, reason: 'duplicate' };
    }

    const dataFor = (channel) => {
      const content = tpl.content?.[channel] || {};
      const subject = renderTemplate(content.subject || null, data);
      const body = renderTemplate(content.body || '', data);
      return {
        subject: subject?.slice(0, 200) || null,
        body: body?.slice(0, MAX_LEN[channel] || 20000) || '',
      };
    };

    const push = dataFor(NOTIFICATION_CHANNEL.PUSH);
    const email = dataFor(NOTIFICATION_CHANNEL.EMAIL);
    const sms = dataFor(NOTIFICATION_CHANNEL.SMS);

    const notification = await Notification.create({
      tenantId,
      userId,
      orderId: orderId || null,
      templateCode,
      templateVersion: tpl.version,
      dedupeKey: dedupeKey || null,
      channels: effective,
      priority: tpl.priority || NOTIFICATION_PRIORITY.NORMAL,
      title: push.subject || null,
      subject: email.subject || null,
      body: push.body || sms.body || email.body || '',
      payload: data,
      status: NOTIFICATION_STATUS.PENDING,
      channelStatus: Object.fromEntries(effective.map((c) => [c, NOTIFICATION_STATUS.PENDING])),
    });

    return { created: true, notification };
  }

  /** Worker: send pending notifications (per-channel adapters). */
  async processPending({ limit = config.notifications.workerBatch } = {}) {
    const rows = await Notification.find({ status: NOTIFICATION_STATUS.PENDING })
      .sort({ createdAt: 1 })
      .limit(Math.min(limit, 500));
    let sent = 0; let failed = 0;

    for (const n of rows) {
      n.status = NOTIFICATION_STATUS.SENDING;
      await n.save();
      try {
        const results = {};
        for (const channel of n.channels || []) {
          try {
            if (channel === NOTIFICATION_CHANNEL.PUSH) {
              const devices = await Device.find({ tenantId: n.tenantId, userId: n.userId, status: 'active' }).lean();
              for (const device of devices) {
                await notificationProvider.sendPush({ device, title: n.title || n.subject, body: n.body, data: n.payload, notificationId: n._id });
              }
              results[channel] = devices.length ? 'sent' : 'skipped';
            } else if (channel === NOTIFICATION_CHANNEL.EMAIL) {
              const user = await User.findOne({ _id: n.userId, tenantId: n.tenantId }).lean();
              if (user?.email?.address && user.email.verified) {
                await notificationProvider.sendEmail({ to: user.email.address, subject: n.subject, body: n.body, data: n.payload, notificationId: n._id });
                results[channel] = 'sent';
              } else results[channel] = 'skipped';
            } else if (channel === NOTIFICATION_CHANNEL.SMS) {
              const user = await User.findOne({ _id: n.userId, tenantId: n.tenantId }).lean();
              if (user?.phone?.number && user.phone.verified) {
                await notificationProvider.sendSms({ to: `${user.phone.countryCode || '+91'}${user.phone.number}`, body: n.body, data: n.payload, notificationId: n._id });
                results[channel] = 'sent';
              } else results[channel] = 'skipped';
            }
          } catch (err) {
            results[channel] = 'failed';
            n.lastError = err?.message || String(err);
          }
        }
        n.channelStatus = results;
        const anyFailed = Object.values(results).includes('failed');
        n.status = anyFailed ? NOTIFICATION_STATUS.FAILED : NOTIFICATION_STATUS.SENT;
        n.sentAt = new Date();
        n.attempts = (n.attempts || 0) + 1;
        if (!anyFailed) sent += 1; else failed += 1;
      } catch (err) {
        failed += 1;
        n.status = NOTIFICATION_STATUS.FAILED;
        n.attempts = (n.attempts || 0) + 1;
        n.lastError = err?.message || String(err);
      }
      await n.save();
    }
    return { scanned: rows.length, sent, failed };
  }

  // ---------------- inbox (customer) ----------------
  async listForUser({ tenantId, userId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId, userId };
    if (query.status) q.status = query.status;
    const [docs, total] = await Promise.all([
      Notification.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async markRead({ tenantId, userId, notificationId }) {
    const n = await Notification.findOne({ _id: notificationId, tenantId, userId });
    if (!n) throw notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
    if (n.status !== NOTIFICATION_STATUS.READ) {
      n.status = NOTIFICATION_STATUS.READ;
      n.readAt = new Date();
      await n.save();
    }
    return n;
  }

  // ---------------- devices ----------------
  async registerDevice({ tenantId, userId, payload }) {
    const count = await Device.countDocuments({ tenantId, userId, status: 'active' });
    if (count >= config.notifications.maxDevicesPerUser) {
      throw conflict('Device limit reached', 'DEVICE_LIMIT_REACHED');
    }
    const existing = await Device.findOne({ tenantId, userId, provider: payload.provider || 'fcm', pushToken: payload.pushToken });
    if (existing) {
      existing.status = 'active';
      existing.platform = payload.platform || existing.platform;
      existing.lastSeenAt = new Date();
      existing.metadata = { ...(existing.metadata || {}), ...(payload.metadata || {}) };
      await existing.save();
      return { device: existing, reRegistered: true };
    }
    const device = await Device.create({
      tenantId,
      userId,
      provider: payload.provider || 'fcm',
      platform: payload.platform || 'android',
      pushToken: payload.pushToken,
      status: 'active',
      lastSeenAt: new Date(),
      metadata: payload.metadata || {},
    });
    return { device, reRegistered: false };
  }

  async listDevices({ tenantId, userId }) {
    return serializeList(await Device.find({ tenantId, userId }).sort({ createdAt: -1 }).lean());
  }

  async removeDevice({ tenantId, userId, deviceId }) {
    const device = await Device.findOne({ _id: deviceId, tenantId, userId });
    if (!device) throw notFound('Device not found', 'DEVICE_NOT_FOUND');
    device.status = 'disabled';
    await device.save();
    return device;
  }

  // ---------------- admin log ----------------
  async listAll({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId };
    if (query.status) q.status = query.status;
    if (query.userId) q.userId = query.userId;
    if (query.from || query.to) {
      q.createdAt = {};
      if (query.from) q.createdAt.$gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) q.createdAt.$lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86400000);
    }
    const [docs, total] = await Promise.all([
      Notification.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  // ---------------- template admin ----------------
  async listTemplates({ tenantId, query = {} }) {
    const q = { $or: [{ tenantId }, { tenantId: null }] };
    if (query.code) q.$or = [{ tenantId, code: query.code }, { tenantId: null, code: query.code }];
    if (query.isActive != null) q.isActive = query.isActive === 'true' || query.isActive === true;
    return serializeList(await NotificationTemplate.find(q).sort({ code: 1 }).lean());
  }

  async createTemplate({ tenantId, payload, actorId = null, req = null }) {
    const existing = await NotificationTemplate.findOne({ tenantId, code: payload.code });
    if (existing) throw conflict('Template code already exists for this tenant', 'DUPLICATE_TEMPLATE_CODE');
    return NotificationTemplate.create({
      tenantId,
      code: payload.code,
      eventType: payload.eventType || null,
      channels: payload.channels || ['push'],
      content: payload.content || {},
      priority: payload.priority || 'normal',
      isActive: payload.isActive !== false,
      version: 1,
      effectiveFrom: payload.effectiveFrom || null,
      effectiveTo: payload.effectiveTo || null,
    });
  }

  async updateTemplate({ tenantId, templateId, payload, req = null }) {
    const tpl = await NotificationTemplate.findOne({ _id: templateId, tenantId });
    if (!tpl) throw notFound('Template not found', 'TEMPLATE_NOT_FOUND');
    const allowed = ['eventType', 'channels', 'content', 'priority', 'isActive', 'effectiveFrom', 'effectiveTo'];
    let changed = false;
    for (const k of allowed) {
      if (k in payload) { tpl[k] = payload[k]; changed = true; }
    }
    if (changed) tpl.version += 1;
    await tpl.save();
    return tpl;
  }

  // ---------------- event → notification consumer ----------------
  /**
   * Map a catalog event to a notification. Registered as an outbox handler so
   * the existing drain() delivers it (same path as cache invalidation).
   * Every failure is caught and logged — a bad mapping/template must never
   * poison the event drain (the drain would otherwise mark the row failed).
   */
  eventToNotification = async (event) => {
    try {
      const map = {
        order_confirmed: ['order_confirmed'],
        order_out_for_delivery: ['order_out_for_delivery'],
        order_delivered: ['order_delivered'],
        order_cancelled: ['order_cancelled'],
        rider_arrived: ['rider_arrived'],
        payment_failed: ['payment_failed'],
        refund_completed: ['refund_processed'],
        return_refund_initiated: ['refund_processed'],
      };
      const templateCodes = map[event.eventType];
      if (!templateCodes) return;

      const order = event.entityType === 'order'
        ? await Order.findOne({ _id: event.entityId, tenantId: event.tenantId }).lean()
        : null;
      if (!order) return;

      const user = order.userId
        ? await User.findOne({ _id: order.userId, tenantId: order.tenantId }).lean().catch(() => null)
        : null;

      const data = {
        firstName: user?.profile?.firstName || user?.name || 'there',
        orderNumber: order.orderNumber,
        total: order.totalAmount ? `₹${order.totalAmount}` : null,
        slot: order.slotSnapshot ? `${order.slotSnapshot.date} ${order.slotSnapshot.startTime}` : null,
        itemsCount: order.itemsCount,
        ...(event.payload || {}),
      };

      for (const code of templateCodes) {
        await this.dispatch({
          tenantId: order.tenantId,
          userId: order.userId,
          orderId: order._id,
          templateCode: code,
          data,
          dedupeKey: `${code}:${order._id}`,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[notification] event consumer failed (${event?.eventType}):`, err?.message);
    }
  };

  /** Wire the consumer into the catalog outbox (called once at boot). */
  initConsumer() {
    registerCatalogEventHandler(this.eventToNotification);
  }
}

export default new NotificationService();
