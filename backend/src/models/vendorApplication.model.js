/**
 * VendorApplication — a user's request to sell on the marketplace (Phase 5).
 *
 * One application per user (re-submitting updates the same row). A platform
 * admin review either APPROVES (→ creates the `vendors` profile and flips
 * user.role to `vendor`) or REJECTS with a note. The `vendor` role can never
 * be granted any other way.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { VENDOR_APPLICATION_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const VendorApplicationSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    businessName: { type: String, required: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 80 },
    contactPhone: { type: String, default: null, maxlength: 20 },
    gstin: { type: String, default: null, maxlength: 20, trim: true, uppercase: true },
    categories: { type: [String], default: [] }, // category slugs/names they intend to sell
    city: { type: String, default: null, maxlength: 80 },

    status: {
      type: String,
      enum: Object.values(VENDOR_APPLICATION_STATUS),
      default: VENDOR_APPLICATION_STATUS.SUBMITTED,
      index: true,
    },
    reviewedBy: { type: Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    note: { type: String, default: null, maxlength: 500 },
    submittedAt: { type: Date, default: Date.now },
  },
  { collection: 'vendorapplications' }
);

VendorApplicationSchema.plugin(auditPlugin);
VendorApplicationSchema.plugin(softDeletePlugin);
VendorApplicationSchema.plugin(toJSONPlugin);

export default mongoose.model('VendorApplication', VendorApplicationSchema);
