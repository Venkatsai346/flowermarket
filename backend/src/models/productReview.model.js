/**
 * ProductReview — customer reviews and ratings for tenant products.
 *
 * Business rules:
 *  - One review per (user, tenantProduct) — enforced by unique index.
 *  - Rating is 1–5 stars (integer).
 *  - Reviews go through moderation: pending → approved/rejected.
 *  - Only APPROVED reviews are visible to customers and affect the average.
 *  - Average rating + review count are denormalized on TenantProduct.
 *  - Soft-deletable (standard plugin).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

export const REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const ProductReviewSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    tenantProductId: { type: Types.ObjectId, ref: 'TenantProduct', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: Types.ObjectId, ref: 'Order', default: null },

    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true, maxlength: 200, default: '' },
    body: { type: String, trim: true, maxlength: 5000, default: '' },

    // moderation
    status: {
      type: String,
      enum: Object.values(REVIEW_STATUS),
      default: REVIEW_STATUS.PENDING,
      index: true,
    },
    moderatedAt: { type: Date, default: null },
    moderatedBy: { type: Types.ObjectId, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 500, default: '' },

    // metadata
    isVerifiedPurchase: { type: Boolean, default: false },
    helpfulCount: { type: Number, default: 0 },
    images: [{ type: String, maxlength: 500 }],
  },
  { collection: 'productreviews' }
);

// One review per user per product
ProductReviewSchema.index({ tenantId: 1, tenantProductId: 1, userId: 1 }, { unique: true });

// For listing reviews for a product (approved only, newest first)
ProductReviewSchema.index({ tenantId: 1, tenantProductId: 1, status: 1, createdAt: -1 });

// For moderation queue
ProductReviewSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

// For user's review history
ProductReviewSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

ProductReviewSchema.plugin(auditPlugin);
ProductReviewSchema.plugin(softDeletePlugin);
ProductReviewSchema.plugin(toJSONPlugin);

export default mongoose.model('ProductReview', ProductReviewSchema);
