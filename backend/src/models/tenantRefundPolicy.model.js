/**
 * TenantRefundPolicy — whether/how the delivery fee is refunded (Phase 3.5).
 *
 * Whether a full-order return should also refund the delivery fee is a genuine
 * BUSINESS call (the delivery physically happened), not an engineering one.
 * This row makes it explicit per tenant:
 *   refundDeliveryFeeWhen: NEVER | FULL_ORDER_RETURN_ONLY | ALWAYS
 *   refundFeePct:          allow a partial split (e.g. 50% of the fee)
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { REFUND_FEE_POLICY } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TenantRefundPolicySchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true },
    refundDeliveryFeeWhen: {
      type: String,
      enum: Object.values(REFUND_FEE_POLICY),
      default: REFUND_FEE_POLICY.FULL_ORDER_RETURN_ONLY,
    },
    refundFeePct: { type: Number, default: 100, min: 0, max: 100 },
    updatedBy: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'tenantrefundpolicies', timestamps: true }
);

TenantRefundPolicySchema.index({ tenantId: 1 }, { unique: true });

TenantRefundPolicySchema.plugin(auditPlugin);
TenantRefundPolicySchema.plugin(softDeletePlugin);
TenantRefundPolicySchema.plugin(toJSONPlugin);

export default mongoose.model('TenantRefundPolicy', TenantRefundPolicySchema);
