/**
 * Notification — outbox + inbox (Phase 4b).
 *
 * One row per (user × template × dedupeKey). It is BOTH the send queue
 * (status pending → sending → sent/failed, worker-processed with attempts +
 * lastError) and the customer's notification history (read marks the inbox).
 * Rendered title/body/subject are snapshotted at enqueue so later template
 * edits never mutate history.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS, NOTIFICATION_PRIORITY } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const NotificationSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', default: null, index: true }, // context link

    templateCode: { type: String, required: true, maxlength: 64 },
    templateVersion: { type: Number, default: 1 },
    dedupeKey: { type: String, default: null }, // e.g. order_confirmed:{orderId} — unique when set

    channels: {
      type: [String],
      enum: Object.values(NOTIFICATION_CHANNEL),
      default: [],
    },
    priority: {
      type: String,
      enum: Object.values(NOTIFICATION_PRIORITY),
      default: NOTIFICATION_PRIORITY.NORMAL,
    },

    // rendered snapshot at enqueue
    title: { type: String, default: null, maxlength: 200 },
    subject: { type: String, default: null, maxlength: 200 },
    body: { type: String, default: null, maxlength: 20000 },
    payload: { type: Schema.Types.Mixed, default: null }, // resolved data (audit)

    status: {
      type: String,
      enum: Object.values(NOTIFICATION_STATUS),
      default: NOTIFICATION_STATUS.PENDING,
      index: true,
    },
    // per-channel delivery result: { push: 'sent', email: 'failed' }
    channelStatus: { type: Schema.Types.Mixed, default: {} },

    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { collection: 'notifications' }
);

NotificationSchema.index({ tenantId: 1, status: 1, createdAt: 1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

NotificationSchema.plugin(auditPlugin);
NotificationSchema.plugin(softDeletePlugin);
NotificationSchema.plugin(toJSONPlugin);

export default mongoose.model('Notification', NotificationSchema);
