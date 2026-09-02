/**
 * DeliveryFeePolicy — per-tenant delivery-fee configuration (Phase 3.5).
 *
 * Replaces the hardcoded `deliveryFee = 49`: pricing is a configurable,
 * versioned policy. A tenant may have multiple rows over time
 * (effective_from/to); at most ONE is active at any moment (partial unique
 * index on isActive).
 *
 * Compute (see PricingPolicyService.computeOrderCharges):
 *   fee = cart_subtotal >= free_delivery_threshold ? 0
 *         : base_fee
 *           × express_surge_multiplier (only when slot.windowType == EXPRESS)
 *           + distance_fee_per_km × zone_distance_km (only when zone-priced)
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ENTITY_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const DeliveryFeePolicySchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, trim: true, maxlength: 120, default: 'default' },

    baseFee: { type: Number, required: true, min: 0 },
    freeDeliveryThreshold: { type: Number, default: null, min: 0 }, // null = never free
    expressSurgeMultiplier: { type: Number, default: 1, min: 1 },
    distanceFeePerKm: { type: Number, default: 0, min: 0 }, // 0 = zone pricing disabled

    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: Object.values(ENTITY_STATUS),
      default: ENTITY_STATUS.ACTIVE,
    },
    version: { type: Number, default: 1, min: 1 },
  },
  { collection: 'deliveryfeepolicies' }
);

// at most one ACTIVE row per tenant at a time
DeliveryFeePolicySchema.index(
  { tenantId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

DeliveryFeePolicySchema.plugin(auditPlugin);
DeliveryFeePolicySchema.plugin(softDeletePlugin);
DeliveryFeePolicySchema.plugin(toJSONPlugin);

export default mongoose.model('DeliveryFeePolicy', DeliveryFeePolicySchema);
