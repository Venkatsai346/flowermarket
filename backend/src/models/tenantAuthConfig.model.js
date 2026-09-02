/**
 * TenantAuthConfig — per-tenant authentication & delivery policy.
 *
 * WHY IT EXISTS (multi-tenant readiness):
 *  - Each tenant (your flower market today, future sister stores / vendor stores)
 *    can toggle its own auth rules: which login methods are allowed, whether
 *    phone OTP is mandatory, whether email is required for checkout, whether
 *    same-day delivery is offered, what the delivery fee policy is, etc.
 *  - Looked up ONCE per request by the auth middleware and cached in-memory,
 *    so per-tenant policy changes (e.g. "disable OTP login for maintenance")
 *    take effect without redeploying.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { LOGIN_METHOD, DELIVERY_FEE_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const TenantAuthConfigSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, unique: true, index: true },

    allowedLoginMethods: {
      type: [String],
      enum: Object.values(LOGIN_METHOD),
      default: [LOGIN_METHOD.PHONE_OTP],
    },
    requirePhoneVerification: { type: Boolean, default: true },
    requireEmailForCheckout: { type: Boolean, default: false },
    otpLength: { type: Number, default: 6, min: 4, max: 8 },
    otpTtlSeconds: { type: Number, default: 300 },
    otpMaxAttempts: { type: Number, default: 5 },
    sessionTtlSeconds: { type: Number, default: 30 * 24 * 60 * 60 },

    deliveryPolicy: {
      minimumOrderValue: { type: Number, default: 0, min: 0 },
      deliveryFeeType: {
        type: String,
        enum: Object.values(DELIVERY_FEE_TYPE),
        default: DELIVERY_FEE_TYPE.FLAT,
      },
      flatDeliveryFee: { type: Number, default: 49, min: 0 },
      freeDeliveryAbove: { type: Number, default: 999, min: 0 }, // INR
      maxDistanceKm: { type: Number, default: 15, min: 0 },
    },

    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { collection: 'tenantauthconfigs' }
);

TenantAuthConfigSchema.plugin(auditPlugin);
TenantAuthConfigSchema.plugin(softDeletePlugin);
TenantAuthConfigSchema.plugin(toJSONPlugin);

export default mongoose.model('TenantAuthConfig', TenantAuthConfigSchema);
