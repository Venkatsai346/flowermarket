/**
 * Tenant — the multi-tenant root entity.
 *
 * WHY IT EXISTS:
 * We designed for multi-tenancy from day one ("we might scale this to support
 * multi tenant system"). Every scoped collection (users, products, carts,
 * orders, slots...) carries a `tenantId` so that a single MongoDB deployment
 * can host many businesses (your flower market today, sister stores tomorrow)
 * without data bleed.
 *
 * Tenant types:
 *  - your flower market          -> tenant type "business"
 *  - a future seller/vendor      -> tenant type "vendor"   (marketplace mode)
 *  - the platform operator itself-> tenant type "platform"
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { TENANT_PLAN } from '../constants/enums.js';

const { Schema } = mongoose;

const TenantSchema = new Schema(
  {
    // ---- Identity ----
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      index: true,
    },
    type: {
      type: String,
      enum: ['business', 'vendor', 'platform'],
      default: 'business',
      index: true,
    },

    // ---- Contact / branding ----
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
    theme: {
      primaryColor: { type: String, default: '#7a1f3d' },
      accentColor: { type: String, default: '#c9a227' },
    },

    // ---- Scope ----
    supportedCurrencies: { type: [String], default: ['INR'] },
    defaultCurrency: { type: String, default: 'INR' },
    timezone: { type: String, default: 'Asia/Kolkata' },

    // ---- Plan / subscription ----
    plan: {
      type: String,
      enum: Object.values(TENANT_PLAN),
      default: TENANT_PLAN.FREE,
    },
    planExpiresAt: { type: Date, default: null },
    features: {
      // capability flags — cheap feature-flagging without a separate service
      slotsEnabled: { type: Boolean, default: true },
      paymentsEnabled: { type: Boolean, default: true },
      subscriptionsEnabled: { type: Boolean, default: false },
      marketplaceEnabled: { type: Boolean, default: false },
    },

    // ---- Status ----
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked'],
      default: 'active',
      index: true,
    },

    // ---- Ownership ----
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    // ---- Phase 5: marketplace storefront ----
    store: {
      tagline: { type: String, default: null, maxlength: 160 },
      description: { type: String, default: null, maxlength: 2000 },
      bannerUrl: { type: String, default: null, trim: true },
      socialLinks: {
        instagram: { type: String, default: null, trim: true },
        facebook: { type: String, default: null, trim: true },
        website: { type: String, default: null, trim: true },
      },
      isPublished: { type: Boolean, default: false },
      onboardingStatus: {
        type: String,
        enum: ['registered', 'active'],
        default: 'registered',
      },
    },

    // ---- Hierarchy (franchise under a city, seller under a platform, etc.) ----
    parentTenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
  },
  { timestamps: false, collection: 'tenants' }
);

TenantSchema.plugin(auditPlugin);
TenantSchema.plugin(softDeletePlugin);
TenantSchema.plugin(toJSONPlugin);

export default mongoose.model('Tenant', TenantSchema);
