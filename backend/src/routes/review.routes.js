/**
 * Product review routes — customer CRUD + admin moderation.
 *
 * Customer endpoints:
 *   POST   /reviews              — create a review
 *   GET    /reviews/mine         — list my reviews
 *   PATCH  /reviews/:id          — update my pending review
 *   DELETE /reviews/:id          — delete my review
 *   POST   /reviews/:id/helpful  — mark a review as helpful
 *
 * Public:
 *   GET    /reviews/product/:id  — list approved reviews for a product
 *
 * Admin:
 *   GET    /admin/reviews        — list all reviews (moderation queue)
 *   POST   /admin/reviews/:id/approve — approve a review
 *   POST   /admin/reviews/:id/reject  — reject a review
 */

import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import productReviewService from '../services/productReview.service.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();

// ---- validation schemas ----
const createReviewSchema = Joi.object({
  tenantProductId: Joi.string().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  title: Joi.string().max(200).allow('').optional(),
  body: Joi.string().max(5000).allow('').optional(),
  orderId: Joi.string().allow(null).optional(),
  images: Joi.array().items(Joi.string().uri().max(500)).max(5).optional(),
});

const updateReviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).optional(),
  title: Joi.string().max(200).allow('').optional(),
  body: Joi.string().max(5000).allow('').optional(),
  images: Joi.array().items(Joi.string().uri().max(500)).max(5).optional(),
}).min(1);

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  minRating: Joi.number().integer().min(1).max(5).optional(),
  sort: Joi.string().valid('newest', 'helpful').default('newest'),
});

const modListSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('pending', 'approved', 'rejected', 'all').default('all'),
});

const rejectSchema = Joi.object({
  reason: Joi.string().max(500).allow('').default(''),
});

// ---- Customer routes ----
router.use(authenticate);

router.post('/', validate(createReviewSchema), async (req, res, next) => {
  try {
    const review = await productReviewService.create({
      tenantId: req.tenantId,
      userId: req.user._id,
      payload: req.body,
    });
    res.status(201).json({ success: true, data: review });
  } catch (err) { next(err); }
});

router.get('/mine', validate(listQuerySchema, 'query'), async (req, res, next) => {
  try {
    const result = await productReviewService.listForUser({
      tenantId: req.tenantId,
      userId: req.user._id,
      query: req.query,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.patch('/:id', validate(updateReviewSchema), async (req, res, next) => {
  try {
    const review = await productReviewService.update({
      tenantId: req.tenantId,
      userId: req.user._id,
      reviewId: req.params.id,
      payload: req.body,
    });
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await productReviewService.deleteOwn({
      tenantId: req.tenantId,
      userId: req.user._id,
      reviewId: req.params.id,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/:id/helpful', async (req, res, next) => {
  try {
    const review = await productReviewService.markHelpful({
      tenantId: req.tenantId,
      reviewId: req.params.id,
    });
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

// ---- Public route (no auth required) ----
export const publicReviewRouter = Router();
publicReviewRouter.get('/product/:id', validate(listQuerySchema, 'query'), async (req, res, next) => {
  try {
    const result = await productReviewService.listForProduct({
      tenantId: req.tenantId,
      tenantProductId: req.params.id,
      query: req.query,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ---- Admin routes ----
export const adminReviewRouter = Router();
adminReviewRouter.use(authenticate, authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN));

adminReviewRouter.get('/', validate(modListSchema, 'query'), async (req, res, next) => {
  try {
    const result = await productReviewService.listForModeration({
      tenantId: req.tenantId,
      query: req.query,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

adminReviewRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const review = await productReviewService.approve({
      tenantId: req.tenantId,
      reviewId: req.params.id,
      actorId: req.user._id,
      req,
    });
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

adminReviewRouter.post('/:id/reject', validate(rejectSchema), async (req, res, next) => {
  try {
    const review = await productReviewService.reject({
      tenantId: req.tenantId,
      reviewId: req.params.id,
      reason: req.body.reason,
      actorId: req.user._id,
      req,
    });
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

export default router;
