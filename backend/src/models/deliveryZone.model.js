/**
 * DeliveryZone — grouping of pincodes/areas for delivery planning.
 *
 * WHY IT EXISTS:
 *  - Slots, fees and route planning operate at the ZONE level, not per-pincode.
 *    Example: "Zone East — all 522xxx pincodes, express available, fee ₹40".
 *  - `ServiceablePincode.zoneId` points here, so the checkout engine can jump
 *    from a pincode to its zone to its slot availability in one hop.
 *  - Pincode->zone membership can be expressed as a list here (bounded, curated
 *    by ops) — membership is small and admin-controlled, so it stays bounded.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const DeliveryZoneSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, maxlength: 40 },
    description: { type: String, default: null, maxlength: 200 },

    pincodes: { type: [String], default: [] }, // curated membership list
    areaIds: { type: [Types.ObjectId], ref: 'Location', default: [] },

    deliveryFee: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },

    // future: route-planning hooks
    routePlanRef: { type: String, default: null },
  },
  { collection: 'deliveryzones' }
);

DeliveryZoneSchema.index({ tenantId: 1, code: 1 }, { unique: true });

DeliveryZoneSchema.plugin(auditPlugin);
DeliveryZoneSchema.plugin(softDeletePlugin);
DeliveryZoneSchema.plugin(toJSONPlugin);

export default mongoose.model('DeliveryZone', DeliveryZoneSchema);
