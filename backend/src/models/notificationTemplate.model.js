/**
 * NotificationTemplate — the copy engine (Phase 4b).
 *
 * Bodies use {{placeholders}} resolved from payload at enqueue time. Templates
 * are DATA (admin-editable, versioned) — copy changes never need a deploy.
 * tenantId null = platform default (fallback); a tenant can override any code.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { NOTIFICATION_CHANNEL, NOTIFICATION_PRIORITY } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ChannelTextSchema = new Schema(
  {
    subject: { type: String, default: null, maxlength: 200 }, // push title / email subject
    body: { type: String, required: true, maxlength: 20000 },
  },
  { _id: false }
);

const NotificationTemplateSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true }, // null = platform default
    code: { type: String, required: true, trim: true, maxlength: 64 }, // e.g. order_confirmed
    eventType: { type: String, default: null }, // auto-trigger source (catalog event type)

    channels: {
      type: [String],
      enum: Object.values(NOTIFICATION_CHANNEL),
      default: [NOTIFICATION_CHANNEL.PUSH],
    },

    // per-channel copy: { push: {subject, body}, email: {subject, body}, sms: {body} }
    content: {
      push: { type: ChannelTextSchema, default: null },
      email: { type: ChannelTextSchema, default: null },
      sms: { type: ChannelTextSchema, default: null },
    },

    priority: {
      type: String,
      enum: Object.values(NOTIFICATION_PRIORITY),
      default: NOTIFICATION_PRIORITY.NORMAL,
    },
    isActive: { type: Boolean, default: true, index: true },
    version: { type: Number, default: 1 },
    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },
  },
  { collection: 'notificationtemplates' }
);

NotificationTemplateSchema.index({ tenantId: 1, code: 1 }, { unique: true });
NotificationTemplateSchema.index({ eventType: 1, isActive: 1 });

NotificationTemplateSchema.plugin(auditPlugin);
NotificationTemplateSchema.plugin(softDeletePlugin);
NotificationTemplateSchema.plugin(toJSONPlugin);

export default mongoose.model('NotificationTemplate', NotificationTemplateSchema);
