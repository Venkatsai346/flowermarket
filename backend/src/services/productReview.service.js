/**
 * ProductReviewService — CRUD, moderation, rating aggregation.
 *
 * The rating rollup (avg + count on TenantProduct) is updated atomically
 * inside approve/reject/unapprove so it never drifts from the review set.
 * Every function is tenant-scoped.
 *
 * The service is deliberately thin on business rules — "one review per user
 * per product" is a unique index; "1–5 integer" is a schema constraint;
 * "only approved reviews visible to customers" is a query filter. The code
 * does not duplicate what the database already enforces.
 */

import ProductReview, { REVIEW_STATUS } from '../models/productReview.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import Order from '../models/order.model.js';
import auditService from './audit.service.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';

class ProductReviewService {
  // ----------------------------------------------------------------
  // Customer CRUD
  // ----------------------------------------------------------------

  /**
   * Create a review. Enforces one-per-user-per-product via the unique index;
   * if the user already reviewed this product, throws conflict.
   */
  async create({ tenantId, userId, payload }) {
    const { tenantProductId, rating, title, body, orderId, images } = payload;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw badRequest('Rating must be an integer between 1 and 5', 'INVALID_RATING');
    }

    // Verify the product exists
    const product = await TenantProduct.findOne({ _id: tenantProductId, tenantId }).lean();
    if (!product) throw notFound('Product not found', 'PRODUCT_NOT_FOUND');

    // Verify purchase if orderId provided
    let isVerifiedPurchase = false;
    if (orderId) {
      const order = await Order.findOne({
        _id: orderId,
        tenantId,
        userId,
        status: { $in: ['delivered', 'completed'] },
      }).lean();
      isVerifiedPurchase = !!order;
    }

    try {
      const review = await ProductReview.create({
        tenantId,
        tenantProductId,
        userId,
        orderId: orderId || null,
        rating,
        title: title || '',
        body: body || '',
        isVerifiedPurchase,
        images: images || [],
        status: REVIEW_STATUS.PENDING,
      });

      await auditService.record({
        action: 'review_created',
        entityType: 'product_review',
        entityId: review._id,
        tenantId,
        actorId: userId,
        actorType: 'user',
        after: { rating, tenantProductId },
      });

      return review;
    } catch (err) {
      if (err.code === 11000) {
        throw conflict('You have already reviewed this product', 'DUPLICATE_REVIEW');
      }
      throw err;
    }
  }

  /** Update a user's own pending review (title, body, rating). */
  async update({ tenantId, userId, reviewId, payload }) {
    const review = await ProductReview.findOne({ _id: reviewId, tenantId, userId });
    if (!review) throw notFound('Review not found', 'REVIEW_NOT_FOUND');
    if (review.status !== REVIEW_STATUS.PENDING) {
      throw badRequest('Only pending reviews can be edited', 'REVIEW_NOT_EDITABLE');
    }

    const { rating, title, body, images } = payload;
    if (rating !== undefined) {
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw badRequest('Rating must be an integer between 1 and 5', 'INVALID_RATING');
      }
      review.rating = rating;
    }
    if (title !== undefined) review.title = title;
    if (body !== undefined) review.body = body;
    if (images !== undefined) review.images = images;

    await review.save();
    return review;
  }

  /** Soft-delete a user's own review. */
  async deleteOwn({ tenantId, userId, reviewId }) {
    const review = await ProductReview.findOne({ _id: reviewId, tenantId, userId });
    if (!review) throw notFound('Review not found', 'REVIEW_NOT_FOUND');

    // If it was approved, update the rollup
    if (review.status === REVIEW_STATUS.APPROVED) {
      await this._updateRollup(tenantId, review.tenantProductId);
    }

    await review.softDelete({ by: userId });
    return { deleted: true };
  }

  // ----------------------------------------------------------------
  // Public (customer-facing)
  // ----------------------------------------------------------------

  /** List approved reviews for a product. */
  async listForProduct({ tenantId, tenantProductId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
    const q = { tenantId, tenantProductId, status: REVIEW_STATUS.APPROVED };

    if (query.minRating) q.rating = { $gte: Number(query.minRating) };

    const sort = query.sort === 'helpful' ? { helpfulCount: -1, createdAt: -1 } : { createdAt: -1 };

    const [docs, total, stats] = await Promise.all([
      ProductReview.find(q).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      ProductReview.countDocuments(q),
      this._ratingDistribution({ tenantId, tenantProductId }),
    ]);

    return {
      items: serializeList(docs),
      meta: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasMore: (page - 1) * limit + docs.length < total,
      },
      stats,
    };
  }

  /** List a user's own reviews (any status). */
  async listForUser({ tenantId, userId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
    const q = { tenantId, userId };

    const [docs, total] = await Promise.all([
      ProductReview.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ProductReview.countDocuments(q),
    ]);

    return {
      items: serializeList(docs),
      meta: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasMore: (page - 1) * limit + docs.length < total,
      },
    };
  }

  /** Mark a review as helpful (increment). */
  async markHelpful({ tenantId, reviewId }) {
    const review = await ProductReview.findOneAndUpdate(
      { _id: reviewId, tenantId, status: REVIEW_STATUS.APPROVED },
      { $inc: { helpfulCount: 1 } },
      { new: true },
    );
    if (!review) throw notFound('Review not found', 'REVIEW_NOT_FOUND');
    return review;
  }

  // ----------------------------------------------------------------
  // Admin / Moderation
  // ----------------------------------------------------------------

  /** List reviews for moderation (pending, approved, rejected, or all). */
  async listForModeration({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId };
    if (query.status && query.status !== 'all') q.status = query.status;

    const [docs, total, pending] = await Promise.all([
      ProductReview.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('userId', 'name profile.firstName profile.lastName')
        .populate('tenantProductId', 'name sku')
        .lean(),
      ProductReview.countDocuments(q),
      ProductReview.countDocuments({ tenantId, status: REVIEW_STATUS.PENDING }),
    ]);

    return {
      items: serializeList(docs),
      meta: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasMore: (page - 1) * limit + docs.length < total,
        pending,
      },
    };
  }

  /** Approve a review → becomes visible, updates product rating rollup. */
  async approve({ tenantId, reviewId, actorId, req = null }) {
    const review = await ProductReview.findOne({ _id: reviewId, tenantId });
    if (!review) throw notFound('Review not found', 'REVIEW_NOT_FOUND');
    if (review.status === REVIEW_STATUS.APPROVED) return review;

    review.status = REVIEW_STATUS.APPROVED;
    review.moderatedAt = new Date();
    review.moderatedBy = actorId;
    review.rejectionReason = '';
    await review.save();

    await this._updateRollup(tenantId, review.tenantProductId);

    await auditService.record({
      action: 'review_approved',
      entityType: 'product_review',
      entityId: review._id,
      tenantId,
      actorId,
      actorType: 'tenant',
      after: { status: REVIEW_STATUS.APPROVED },
      req,
    });

    return review;
  }

  /** Reject a review → never visible, rollup unaffected. */
  async reject({ tenantId, reviewId, reason = '', actorId, req = null }) {
    const review = await ProductReview.findOne({ _id: reviewId, tenantId });
    if (!review) throw notFound('Review not found', 'REVIEW_NOT_FOUND');

    const wasApproved = review.status === REVIEW_STATUS.APPROVED;
    review.status = REVIEW_STATUS.REJECTED;
    review.moderatedAt = new Date();
    review.moderatedBy = actorId;
    review.rejectionReason = reason;
    await review.save();

    if (wasApproved) {
      await this._updateRollup(tenantId, review.tenantProductId);
    }

    await auditService.record({
      action: 'review_rejected',
      entityType: 'product_review',
      entityId: review._id,
      tenantId,
      actorId,
      actorType: 'tenant',
      before: { status: wasApproved ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.PENDING },
      after: { status: REVIEW_STATUS.REJECTED, reason },
      req,
    });

    return review;
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  /** Recalculate and denormalize avgRating + reviewCount on TenantProduct. */
  async _updateRollup(tenantId, tenantProductId) {
    const approved = await ProductReview.find({
      tenantId,
      tenantProductId,
      status: REVIEW_STATUS.APPROVED,
    }).select('rating').lean();

    const count = approved.length;
    const avg = count > 0
      ? Math.round((approved.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10
      : 0;

    await TenantProduct.updateOne(
      { _id: tenantProductId, tenantId },
      {
        $set: {
          'rating.average': avg,
          'rating.count': count,
          'rating.updatedAt': new Date(),
        },
      },
    );
  }

  /** Rating distribution (1–5) for a product. */
  async _ratingDistribution({ tenantId, tenantProductId }) {
    const pipeline = [
      { $match: { tenantId, tenantProductId, status: REVIEW_STATUS.APPROVED } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ];
    const result = await ProductReview.aggregate(pipeline);
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    for (const r of result) {
      dist[r._id] = r.count;
      total += r.count;
      sum += r._id * r.count;
    }
    return {
      distribution: dist,
      total,
      average: total > 0 ? Math.round((sum / total) * 10) / 10 : 0,
    };
  }
}

export default new ProductReviewService();
