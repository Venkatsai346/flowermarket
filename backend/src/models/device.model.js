/**
 * Device — a user's push destination (Phase 4b).
 *
 * One row per (user, provider, pushToken). A user may hold several devices
 * (phone + tablet). Partial unique index on ACTIVE devices so re-registration
 * is idempotent; disabled rows are kept for audit but excluded from targeting.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { PUSH_PROVIDER, DEVICE_PLATFORM } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const DeviceSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    provider: {
      type: String,
      enum: Object.values(PUSH_PROVIDER),
      default: PUSH_PROVIDER.FCM,
    },
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORM),
      default: DEVICE_PLATFORM.ANDROID,
    },
    pushToken: { type: String, required: true, trim: true, maxlength: 512 },

    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true },
    lastSeenAt: { type: Date, default: null },

    metadata: {
      appVersion: { type: String, default: null, maxlength: 32 },
      deviceModel: { type: String, default: null, maxlength: 80 },
      locale: { type: String, default: null, maxlength: 10 },
    },
  },
  { collection: 'devices' }
);

// one ACTIVE token per user+provider (idempotent re-registration)
DeviceSchema.index(
  { userId: 1, provider: 1, pushToken: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);
DeviceSchema.index({ tenantId: 1, status: 1 });

DeviceSchema.plugin(auditPlugin);
DeviceSchema.plugin(softDeletePlugin);
DeviceSchema.plugin(toJSONPlugin);

export default mongoose.model('Device', DeviceSchema);
