/**
 * Brand — global brand registry (admin-owned).
 *
 * `isVerified` brands skip some approval steps (verified-brand shortcut from the
 * architecture doc). complianceDocs: e.g. registration certificates.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { ENTITY_STATUS, BRAND_VERIFICATION_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ComplianceDocSchema = new Schema(
  {
    type: { type: String, trim: true, maxlength: 60 }, // e.g. 'fssai', 'gst_cert'
    url: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const BrandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 140 },
    logoUrl: { type: String, default: null },
    // Wide hero for the brand card / filtered-listing header.
    bannerUrl: { type: String, default: null, trim: true },
    tagline: { type: String, default: null, maxlength: 160, trim: true },
    description: { type: String, default: null, maxlength: 500 },
    // Long-form brand story for the storefront brands page.
    story: { type: String, default: null, maxlength: 3000, trim: true },
    countryOfOrigin: { type: String, default: null, maxlength: 60 },
    website: { type: String, default: null, maxlength: 300, trim: true },
    foundedYear: { type: Number, default: null, min: 1800, max: 2100 },
    headquarters: { type: String, default: null, maxlength: 120, trim: true },
    socialLinks: {
      instagram: { type: String, default: null, trim: true },
      facebook: { type: String, default: null, trim: true },
      youtube: { type: String, default: null, trim: true },
      x: { type: String, default: null, trim: true },
    },
    // Curation for the storefront brands page (featured first, then sortOrder).
    isFeatured: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },

    verification: {
      status: {
        type: String,
        enum: Object.values(BRAND_VERIFICATION_STATUS),
        default: BRAND_VERIFICATION_STATUS.PENDING,
      },
      isVerified: { type: Boolean, default: false },
      verifiedAt: { type: Date, default: null },
    },
    complianceDocs: { type: [ComplianceDocSchema], default: [] },

    status: {
      type: String,
      enum: Object.values(ENTITY_STATUS),
      default: ENTITY_STATUS.ACTIVE,
      index: true,
    },
  },
  { collection: 'brands' }
);

BrandSchema.index({ slug: 1 }, { unique: true });
BrandSchema.index({ status: 1, 'verification.isVerified': 1 });

BrandSchema.plugin(auditPlugin);
BrandSchema.plugin(softDeletePlugin);
BrandSchema.plugin(toJSONPlugin);

export default mongoose.model('Brand', BrandSchema);
