/**
 * Hub — the dark store / fulfillment center (per the order-lifecycle doc).
 *
 * Slots belong to a Hub; picking tasks are dispatched to a Hub; ServiceablePincode
 * rows link a pincode to its servicing hub via hubId. Kept lean — capacity planning
 * (forecasting) is an ops function, not stored here.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ENTITY_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const HubSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, maxlength: 40 },
    zoneId: { type: Types.ObjectId, ref: 'DeliveryZone', default: null },

    address: {
      line1: { type: String, trim: true, maxlength: 160 },
      city: { type: String, trim: true, maxlength: 80 },
      state: { type: String, trim: true, maxlength: 80 },
      pincode: { type: String, trim: true, maxlength: 12 },
    },
    coordinates: { type: [Number], default: null }, // [lng, lat]
    areaId: { type: Types.ObjectId, ref: 'Location', default: null },

    // pincodes this hub services (curated, bounded)
    serviceablePincodes: { type: [String], default: [] },

    defaultSlotCapacity: { type: Number, default: 50, min: 1 },
    isActive: { type: Boolean, default: true, index: true },

    status: {
      type: String,
      enum: Object.values(ENTITY_STATUS),
      default: ENTITY_STATUS.ACTIVE,
    },
  },
  { collection: 'hubs' }
);

HubSchema.index({ tenantId: 1, code: 1 }, { unique: true });
HubSchema.index({ tenantId: 1, isActive: 1 });

HubSchema.plugin(auditPlugin);
HubSchema.plugin(softDeletePlugin);
HubSchema.plugin(toJSONPlugin);

export default mongoose.model('Hub', HubSchema);
