/**
 * ProductChangeRequest — the field-ownership approval workflow.
 *
 * THE mechanism that keeps the shared catalog from forking:
 *  - Tenants may write tenant-scoped fields (price/stock/status) directly.
 *  - ANY global-field change (title, images, category, brand, attributes) or a
 *    brand-new master proposal lands here as a request with a stored `diff`.
 *  - Admin reviews: APPROVED applies the diff to the master; REJECTED notifies
 *    the tenant with a reason; NEEDS_CHANGES lets the tenant revise & resubmit.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { CHANGE_REQUEST_TYPE, CHANGE_REQUEST_STATUS } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const ReviewSchema = new Schema(
  {
    reviewedBy: { type: Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    note: { type: String, default: null, maxlength: 800 },
  },
  { _id: false }
);

const ProductChangeRequestSchema = new Schema(
  {
    type: {
      type: String,
      enum: Object.values(CHANGE_REQUEST_TYPE),
      required: true,
      index: true,
    },
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    productMasterId: { type: Types.ObjectId, ref: 'ProductMaster', default: null, index: true },
    requestedBy: { type: Types.ObjectId, ref: 'User', required: true },
    note: { type: String, default: null, maxlength: 500 },

    // CREATE_MASTER -> proposed master fields; ADD_VARIANT/UPDATE_IMAGES/... -> action payload
    payload: { type: Schema.Types.Mixed, default: null },
    // UPDATE_GLOBAL_FIELDS -> { before: {...}, after: {...} }
    diff: {
      before: { type: Schema.Types.Mixed, default: null },
      after: { type: Schema.Types.Mixed, default: null },
    },
    duplicateOf: { type: Types.ObjectId, ref: 'ProductMaster', default: null },

    status: {
      type: String,
      enum: Object.values(CHANGE_REQUEST_STATUS),
      default: CHANGE_REQUEST_STATUS.PENDING,
      index: true,
    },
    review: { type: ReviewSchema, default: () => ({}) },
    submittedAt: { type: Date, default: Date.now },
  },
  { collection: 'productchangerequests' }
);

ProductChangeRequestSchema.index({ status: 1, type: 1 });
ProductChangeRequestSchema.index({ tenantId: 1, status: 1 });
ProductChangeRequestSchema.index({ productMasterId: 1, status: 1 });

ProductChangeRequestSchema.plugin(auditPlugin);
ProductChangeRequestSchema.plugin(softDeletePlugin);
ProductChangeRequestSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductChangeRequest', ProductChangeRequestSchema);
