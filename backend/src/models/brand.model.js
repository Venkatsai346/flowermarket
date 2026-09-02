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
    description: { type: String, default: null, maxlength: 500 },
    countryOfOrigin: { type: String, default: null, maxlength: 60 },

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
