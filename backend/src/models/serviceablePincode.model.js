/**
 * ServiceablePincode — governs WHERE we deliver and HOW (slot eligibility).
 *
 * DESIGN NOTES:
 *  - This is the "deliverability map" BigBasket-style apps query constantly.
 *    Instead of scanning every address, the checkout flow checks one row:
 *    "pincode X, tenant Y -> serviceable? which zone? which delivery types?".
 *  - It references canonical Location nodes (pincode node + zone), keeping
 *    slot logic decoupled from free-text addresses.
 *  - `zone` is the future hook for zone-based pricing / route planning;
 *    slots for a zone live in the DeliverySlot collection (Phase: slots).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { DELIVERY_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ServiceablePincodeSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },

    pincode: { type: String, trim: true, maxlength: 12, required: true, index: true },
    locationId: { type: Types.ObjectId, ref: 'Location', default: null, index: true }, // pincode node

    isServiceable: { type: Boolean, default: true, index: true },

    deliveryTypes: {
      type: [String],
      enum: Object.values(DELIVERY_TYPE),
      default: [DELIVERY_TYPE.STANDARD],
    },
    deliveryCutoffTimes: {
      // e.g. orders before 17:00 get same-day
      sameDayCutoff: { type: String, default: '17:00' }, // HH:mm in tenant tz
      expressCutoff: { type: String, default: '20:00' },
    },
    minDeliveryTimeMinutes: { type: Number, default: 90, min: 15 },
    maxDeliveryTimeMinutes: { type: Number, default: 1440, min: 30 },

    zoneId: { type: Types.ObjectId, ref: 'DeliveryZone', default: null, index: true }, // Phase: slots

    // the hub that services this pincode (slot eligibility + fulfillment dispatch)
    hubId: { type: Types.ObjectId, ref: 'Hub', default: null, index: true },

    blocked: { type: Boolean, default: false },
    blockReason: { type: String, default: null },
    notes: { type: String, default: null },

    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { collection: 'serviceablepincodes' }
);

ServiceablePincodeSchema.index({ tenantId: 1, pincode: 1 }, { unique: true });
ServiceablePincodeSchema.index({ tenantId: 1, isServiceable: 1 });

ServiceablePincodeSchema.plugin(auditPlugin);
ServiceablePincodeSchema.plugin(softDeletePlugin);
ServiceablePincodeSchema.plugin(toJSONPlugin);

export default mongoose.model('ServiceablePincode', ServiceablePincodeSchema);
