/**
 * Vendor — an approved seller profile on the marketplace (Phase 5).
 *
 * Created ONLY from an approved VendorApplication (which also grants the
 * `vendor` role). commissionRateBps is the platform's cut on this vendor's
 * sales (default from config, platform-admin adjustable). Payout details are
 * metadata only this pass — no live disbursement. Counters (gmv/orders) are
 * refreshed by the analytics rollups from `orderitems.vendorId`.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { VENDOR_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const VendorSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    businessName: { type: String, required: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 80 },
    gstin: { type: String, default: null, maxlength: 20, trim: true, uppercase: true },
    categories: { type: [String], default: [] },
    city: { type: String, default: null, maxlength: 80 },

    commissionRateBps: { type: Number, default: 100, min: 0, max: 10000 },
    status: {
      type: String,
      enum: Object.values(VENDOR_STATUS),
      default: VENDOR_STATUS.ACTIVE,
      index: true,
    },
    payout: {
      method: { type: String, enum: ['bank', 'upi'], default: 'upi' },
      name: { type: String, default: null, maxlength: 120 },
      maskedAccount: { type: String, default: null, maxlength: 40 }, // e.g. ****1234 — display only
    },
    joinedAt: { type: Date, default: Date.now },
    counters: {
      gmv: { type: Number, default: 0, min: 0 },
      orders: { type: Number, default: 0, min: 0 },
    },
    reviewedBy: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'vendors' }
);

VendorSchema.plugin(auditPlugin);
VendorSchema.plugin(softDeletePlugin);
VendorSchema.plugin(toJSONPlugin);

export default mongoose.model('Vendor', VendorSchema);
