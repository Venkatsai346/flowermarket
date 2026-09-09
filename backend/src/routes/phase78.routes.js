/**
 * Phase 7.8 routes — advanced features.
 *
 * Subscriptions: CRUD + pause/resume/cancel/skip
 * Loyalty: earn/redeem/status
 * Referral: code/apply/stats
 * Feature flags: CRUD + check
 * Multi-currency: convert/format/rates
 * Support: tickets + messages + stats
 * Analytics: LTV, cohorts, affinity, trends
 */

import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';

import subscriptionService from '../services/subscription.service.js';
import loyaltyService from '../services/loyalty.service.js';
import referralService from '../services/referral.service.js';
import featureFlagsService from '../services/featureFlags.service.js';
import currencyService from '../services/currency.service.js';
import supportService from '../services/support.service.js';
import advancedAnalyticsService from '../services/advancedAnalytics.service.js';
import voiceOrderService from '../services/voiceOrder.service.js';

const router = Router();
router.use(authenticate);

// ── Subscriptions ──
const subCreateSchema = Joi.object({
  items: Joi.array().items(Joi.object({
    tenantProductId: Joi.string().required(),
    quantity: Joi.number().integer().min(1).required(),
    unitPrice: Joi.number().min(0).required(),
  })).min(1).required(),
  frequency: Joi.string().valid('weekly', 'biweekly', 'monthly').required(),
  deliveryAddress: Joi.string().optional(),
  preferredSlotId: Joi.string().optional(),
  paymentMethodId: Joi.string().optional(),
  startDate: Joi.string().isoDate().optional(),
});

router.post('/subscriptions', validate(subCreateSchema), async (req, res, next) => {
  try {
    const sub = await subscriptionService.create({ tenantId: req.tenantId, userId: req.user._id, payload: req.body });
    res.status(201).json({ success: true, data: sub });
  } catch (err) { next(err); }
});

router.get('/subscriptions', async (req, res, next) => {
  try {
    const result = await subscriptionService.listForUser({ tenantId: req.tenantId, userId: req.user._id, query: req.query });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.post('/subscriptions/:id/pause', async (req, res, next) => {
  try {
    const sub = await subscriptionService.pause({ tenantId: req.tenantId, userId: req.user._id, subscriptionId: req.params.id, reason: req.body.reason });
    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
});

router.post('/subscriptions/:id/resume', async (req, res, next) => {
  try {
    const sub = await subscriptionService.resume({ tenantId: req.tenantId, userId: req.user._id, subscriptionId: req.params.id });
    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
});

router.post('/subscriptions/:id/cancel', async (req, res, next) => {
  try {
    const sub = await subscriptionService.cancel({ tenantId: req.tenantId, userId: req.user._id, subscriptionId: req.params.id, reason: req.body.reason });
    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
});

router.post('/subscriptions/:id/skip', async (req, res, next) => {
  try {
    const sub = await subscriptionService.skipNext({ tenantId: req.tenantId, userId: req.user._id, subscriptionId: req.params.id });
    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
});

// ── Loyalty ──
router.get('/loyalty/status', async (req, res, next) => {
  try {
    const result = await loyaltyService.status({ tenantId: req.tenantId, userId: req.user._id });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

const redeemSchema = Joi.object({ points: Joi.number().integer().min(100).required() });
router.post('/loyalty/redeem', validate(redeemSchema), async (req, res, next) => {
  try {
    const result = await loyaltyService.redeem({ tenantId: req.tenantId, userId: req.user._id, points: req.body.points });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ── Referral ──
router.get('/referral/code', async (req, res, next) => {
  try {
    const result = await referralService.getCode({ tenantId: req.tenantId, userId: req.user._id });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/referral/stats', async (req, res, next) => {
  try {
    const result = await referralService.stats({ tenantId: req.tenantId, userId: req.user._id });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

const applyRefSchema = Joi.object({ code: Joi.string().required() });
router.post('/referral/apply', validate(applyRefSchema), async (req, res, next) => {
  try {
    const result = await referralService.apply({ tenantId: req.tenantId, userId: req.user._id, code: req.body.code });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ── Currency ──
router.get('/currency/convert', async (req, res, next) => {
  try {
    const { amount, from = 'INR', to = 'USD' } = req.query;
    const converted = currencyService.convert(Number(amount), from, to);
    res.json({ success: true, data: { original: Number(amount), converted, from, to, formatted: currencyService.format(converted, to) } });
  } catch (err) { next(err); }
});

router.get('/currency/rates', async (req, res, next) => {
  try {
    res.json({ success: true, data: { rates: currencyService.getRates(), supported: currencyService.supported() } });
  } catch (err) { next(err); }
});

// ── Support ──
const ticketSchema = Joi.object({
  subject: Joi.string().max(200).required(),
  description: Joi.string().max(5000).allow('').optional(),
  category: Joi.string().valid('order', 'payment', 'delivery', 'product', 'account', 'other').optional(),
  orderId: Joi.string().allow(null).optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'urgent').optional(),
});

router.post('/support/tickets', validate(ticketSchema), async (req, res, next) => {
  try {
    const ticket = await supportService.create({ tenantId: req.tenantId, userId: req.user._id, payload: req.body });
    res.status(201).json({ success: true, data: ticket });
  } catch (err) { next(err); }
});

router.get('/support/tickets', async (req, res, next) => {
  try {
    const result = await supportService.list({ tenantId: req.tenantId, userId: req.user._id, query: req.query });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/support/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await supportService.get({ tenantId: req.tenantId, ticketId: req.params.id });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
});

router.post('/support/tickets/:id/message', async (req, res, next) => {
  try {
    const ticket = await supportService.addMessage({ tenantId: req.tenantId, ticketId: req.params.id, userId: req.user._id, message: req.body.message });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
});

// ── Voice Ordering ──
const voiceSchema = Joi.object({ text: Joi.string().max(500).required(), language: Joi.string().default('en') });
router.post('/voice/parse', validate(voiceSchema), async (req, res, next) => {
  try {
    const result = await voiceOrderService.parse({ tenantId: req.tenantId, ...req.body });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ── Admin: Feature Flags ──
const adminRouter = Router();
adminRouter.use(authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN));

adminRouter.get('/flags', async (req, res, next) => {
  try { res.json({ success: true, data: featureFlagsService.list() }); } catch (err) { next(err); }
});

const flagSchema = Joi.object({
  key: Joi.string().required(),
  enabled: Joi.boolean().optional(),
  description: Joi.string().allow('').optional(),
  percentage: Joi.number().min(0).max(100).optional(),
});
adminRouter.post('/flags', validate(flagSchema), async (req, res, next) => {
  try {
    const flag = await featureFlagsService.set(req.body);
    res.json({ success: true, data: flag });
  } catch (err) { next(err); }
});

// ── Admin: Support ──
adminRouter.get('/support/tickets', async (req, res, next) => {
  try {
    const result = await supportService.list({ tenantId: req.tenantId, query: req.query });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

adminRouter.patch('/support/tickets/:id/status', async (req, res, next) => {
  try {
    const ticket = await supportService.updateStatus({ tenantId: req.tenantId, ticketId: req.params.id, status: req.body.status });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
});

adminRouter.get('/support/stats', async (req, res, next) => {
  try {
    const result = await supportService.stats({ tenantId: req.tenantId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ── Admin: Advanced Analytics ──
adminRouter.get('/analytics/ltv', async (req, res, next) => {
  try {
    const result = await advancedAnalyticsService.customerLTV({ tenantId: req.tenantId, months: Number(req.query.months) || 12 });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

adminRouter.get('/analytics/cohorts', async (req, res, next) => {
  try {
    const result = await advancedAnalyticsService.cohortAnalysis({ tenantId: req.tenantId, months: Number(req.query.months) || 6 });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

adminRouter.get('/analytics/affinity', async (req, res, next) => {
  try {
    const result = await advancedAnalyticsService.productAffinity({ tenantId: req.tenantId, limit: Number(req.query.limit) || 20 });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

adminRouter.get('/analytics/revenue-trend', async (req, res, next) => {
  try {
    const result = await advancedAnalyticsService.revenueTrend({ tenantId: req.tenantId, period: req.query.period || 'daily', days: Number(req.query.days) || 30 });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export { adminRouter };
export default router;
