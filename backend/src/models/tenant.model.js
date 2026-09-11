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

// ---------------------------------------------------------------------------
// Storefront content blocks (world-class storefront).
//
// Everything a tenant's public store needs to render a rich homepage, about
// page, header and footer — WITHOUT extra round-trips: the whole `store`
// object ships inside the storefront bootstrap response, so first paint needs
// exactly one call. All arrays are BOUNDED (see the matching Joi limits in
// marketplace.validators.js) so a tenant cannot bloat their own bootstrap.
// ---------------------------------------------------------------------------

/** One responsive hero-carousel slide. `mobileImageUrl` is the portrait crop. */
const HeroSlideSchema = new Schema(
  {
    imageUrl: { type: String, required: true, trim: true },
    mobileImageUrl: { type: String, default: null, trim: true },
    title: { type: String, default: null, maxlength: 80, trim: true },
    subtitle: { type: String, default: null, maxlength: 160, trim: true },
    ctaLabel: { type: String, default: null, maxlength: 30, trim: true },
    ctaLink: { type: String, default: null, maxlength: 300, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

/** Trust-badge row under the hero (freshness, slots, guarantee…). */
const HighlightSchema = new Schema(
  {
    icon: { type: String, default: null, maxlength: 30, trim: true },
    title: { type: String, required: true, maxlength: 60, trim: true },
    text: { type: String, default: null, maxlength: 200, trim: true },
  },
  { _id: false }
);

const TestimonialSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80, trim: true },
    text: { type: String, required: true, maxlength: 500, trim: true },
    rating: { type: Number, default: null, min: 1, max: 5 },
    avatarUrl: { type: String, default: null, trim: true },
  },
  { _id: false }
);

const StoreAddressSchema = new Schema(
  {
    line1: { type: String, default: null, maxlength: 120, trim: true },
    line2: { type: String, default: null, maxlength: 120, trim: true },
    city: { type: String, default: null, maxlength: 80, trim: true },
    state: { type: String, default: null, maxlength: 80, trim: true },
    pincode: { type: String, default: null, maxlength: 10, trim: true },
  },
  { _id: false }
);

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
      kit: {
        type: String,
        enum: ['rose', 'marigold', 'tropical'],
        default: 'rose',
      },
      primaryColor: { type: String, default: '#9F1239' },
      accentColor: { type: String, default: '#C9A227' },
    },

    // ---- Scope ----
    supportedCurrencies: { type: [String], default: ['INR'] },
    defaultCurrency: { type: String, default: 'INR' },
    timezone: { type: String, default: 'Asia/Kolkata' },

    // ---- Plan / subscription ----
    // Free-form reference to `plans.code` (deliberately NOT an enum): plans are
    // operator-created data, so constraining this field meant every new plan
    // needed a code deploy — and the stale enum ('enterprise') already rejected
    // the real 'business' plan at registration. Unknown codes fail SAFE to the
    // free-plan limits in entitlement.service.js.
    plan: {
      type: String,
      default: TENANT_PLAN.FREE,
      trim: true,
      lowercase: true,
      maxlength: 40,
      index: true,
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
      enum: ['active', 'inactive', 'blocked', 'suspended'],
      default: 'active',
      index: true,
    },
    statusReason: { type: String, default: null, maxlength: 500 },
    statusChangedAt: { type: Date, default: null },
    statusChangedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

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
        youtube: { type: String, default: null, trim: true },
        x: { type: String, default: null, trim: true },
        whatsapp: { type: String, default: null, maxlength: 30, trim: true },
      },
      // ---- rich storefront content (bounded arrays — see marketplace.validators.js) ----
      heroSlides: { type: [HeroSlideSchema], default: [] },
      announcement: {
        text: { type: String, default: null, maxlength: 120, trim: true },
        linkUrl: { type: String, default: null, maxlength: 300, trim: true },
        isActive: { type: Boolean, default: true },
      },
      about: {
        title: { type: String, default: null, maxlength: 120, trim: true },
        content: { type: String, default: null, maxlength: 4000, trim: true },
        imageUrl: { type: String, default: null, trim: true },
        videoUrl: { type: String, default: null, trim: true },
      },
      highlights: { type: [HighlightSchema], default: [] },
      testimonials: { type: [TestimonialSchema], default: [] },
      contact: {
        phone: { type: String, default: null, maxlength: 20, trim: true },
        email: { type: String, default: null, trim: true },
        address: { type: StoreAddressSchema, default: null },
        hours: { type: String, default: null, maxlength: 200, trim: true },
        whatsapp: { type: String, default: null, maxlength: 20, trim: true },
        mapUrl: { type: String, default: null, trim: true },
      },
      seo: {
        title: { type: String, default: null, maxlength: 70, trim: true },
        description: { type: String, default: null, maxlength: 170, trim: true },
      },
      footerText: { type: String, default: null, maxlength: 300, trim: true },
      // Merchant-curated homepage rails (validated live at write time).
      featuredCategoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
      featuredBrandIds: [{ type: Schema.Types.ObjectId, ref: 'Brand' }],
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
