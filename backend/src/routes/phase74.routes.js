/**
 * Phase 7.4 admin routes — consolidated endpoint registration.
 *
 * Reviews: customer CRUD + admin moderation
 * Demand:  forecasting, reorder alerts, product trends
 * HSN:     summary table, monthly trend
 * E-way:   bill data extraction
 * GSTR-2B: import, match, report
 * DLQ:     list, requeue, purge, stats
 * Pool:    connection pool monitoring
 */

import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';

import demandForecastService from '../services/demandForecast.service.js';
import hsnSummaryService from '../services/hsnSummary.service.js';
import ewayBillService from '../services/ewayBill.service.js';
import gstr2bService from '../services/gstr2b.service.js';
import dlqService from '../services/dlq.service.js';
import connectionPoolService from '../services/connectionPool.service.js';
import { dedupStats } from '../middleware/deduplicate.js';

const router = Router();

// All Phase 7.4 admin endpoints require authentication
router.use(authenticate, authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN));

// ──────────────────────────────────────────────────────
// Demand Forecasting
// ──────────────────────────────────────────────────────
const forecastSchema = Joi.object({
  tenantProductId: Joi.string().optional(),
  weeks: Joi.number().integer().min(4).max(52).default(12),
  forecastWeeks: Joi.number().integer().min(1).max(12).default(4),
  method: Joi.string().valid('simple', 'weighted', 'trend').default('weighted'),
});

router.get('/demand/forecast', validate(forecastSchema, 'query'), async (req, res, next) => {
  try {
    const result = await demandForecastService.forecast({ tenantId: req.tenantId, ...req.query });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/demand/reorder-alerts', async (req, res, next) => {
  try {
    const result = await demandForecastService.reorderAlerts({ tenantId: req.tenantId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

const trendSchema = Joi.object({
  weeks: Joi.number().integer().min(4).max(52).default(16),
});

router.get('/demand/trend/:productId', validate(trendSchema, 'query'), async (req, res, next) => {
  try {
    const result = await demandForecastService.productTrend({
      tenantId: req.tenantId,
      tenantProductId: req.params.productId,
      ...req.query,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────────────
// HSN Summary
// ──────────────────────────────────────────────────────
const hsnSchema = Joi.object({
  from: Joi.string().isoDate().required(),
  to: Joi.string().isoDate().required(),
  docType: Joi.string().valid('invoice', 'credit_note').optional(),
  groupBy: Joi.string().valid('hsn_uqc', 'hsn_rate').default('hsn_uqc'),
});

router.get('/hsn/summary', validate(hsnSchema, 'query'), async (req, res, next) => {
  try {
    const result = await hsnSummaryService.summary({ tenantId: req.tenantId, ...req.query });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

const hsnTrendSchema = Joi.object({
  hsnCode: Joi.string().required(),
  months: Joi.number().integer().min(1).max(24).default(6),
});

router.get('/hsn/trend', validate(hsnTrendSchema, 'query'), async (req, res, next) => {
  try {
    const result = await hsnSummaryService.monthlyTrend({ tenantId: req.tenantId, ...req.query });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────────────
// E-way Bill
// ──────────────────────────────────────────────────────
const ewaySchema = Joi.object({
  from: Joi.string().isoDate().required(),
  to: Joi.string().isoDate().required(),
});

router.get('/eway/required', validate(ewaySchema, 'query'), async (req, res, next) => {
  try {
    const result = await ewayBillService.findEwayRequired({ tenantId: req.tenantId, ...req.query });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/eway/invoice/:invoiceId', async (req, res, next) => {
  try {
    const result = await ewayBillService.generatePayload({
      tenantId: req.tenantId,
      invoiceId: req.params.invoiceId,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/eway/batch', validate(ewaySchema, 'query'), async (req, res, next) => {
  try {
    const result = await ewayBillService.generateBatch({ tenantId: req.tenantId, ...req.query });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────────────
// GSTR-2B
// ──────────────────────────────────────────────────────
const gstr2bImportSchema = Joi.object({
  period: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
  entries: Joi.array().items(Joi.object({
    supplierGstin: Joi.string().required(),
    supplierName: Joi.string().allow('').optional(),
    invoiceNumber: Joi.string().required(),
    invoiceDate: Joi.string().required(),
    invoiceValue: Joi.number().required(),
    taxableValue: Joi.number().optional(),
    igst: Joi.number().optional(),
    cgst: Joi.number().optional(),
    sgst: Joi.number().optional(),
    cess: Joi.number().optional(),
    placeOfSupply: Joi.string().allow('').optional(),
    reverseCharge: Joi.boolean().optional(),
    invoiceType: Joi.string().allow('').optional(),
  })).min(1).required(),
});

router.post('/gstr2b/import', validate(gstr2bImportSchema), async (req, res, next) => {
  try {
    const result = await gstr2bService.import({
      tenantId: req.tenantId,
      ...req.body,
      actorId: req.user._id,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

const gstr2bPeriodSchema = Joi.object({
  period: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
});

router.post('/gstr2b/match', validate(gstr2bPeriodSchema), async (req, res, next) => {
  try {
    const result = await gstr2bService.match({ tenantId: req.tenantId, ...req.body });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/gstr2b/report', validate(gstr2bPeriodSchema, 'query'), async (req, res, next) => {
  try {
    const result = await gstr2bService.report({ tenantId: req.tenantId, ...req.query });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/gstr2b/periods', async (req, res, next) => {
  try {
    const result = await gstr2bService.listPeriods({ tenantId: req.tenantId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────────────
// Dead Letter Queue (DLQ)
// ──────────────────────────────────────────────────────
const dlqListSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  eventType: Joi.string().optional(),
  entityType: Joi.string().optional(),
  from: Joi.string().isoDate().optional(),
  to: Joi.string().isoDate().optional(),
});

router.get('/dlq', validate(dlqListSchema, 'query'), async (req, res, next) => {
  try {
    const result = await dlqService.list({ tenantId: req.tenantId, query: req.query });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/dlq/stats', async (req, res, next) => {
  try {
    const result = await dlqService.stats({ tenantId: req.tenantId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/dlq/:eventId', async (req, res, next) => {
  try {
    const result = await dlqService.get({ tenantId: req.tenantId, eventId: req.params.eventId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/dlq/:eventId/requeue', async (req, res, next) => {
  try {
    const result = await dlqService.requeue({
      tenantId: req.tenantId,
      eventId: req.params.eventId,
      actorId: req.user._id,
      req,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

const bulkRequeueSchema = Joi.object({
  eventType: Joi.string().optional(),
  entityType: Joi.string().optional(),
  olderThan: Joi.string().isoDate().optional(),
});

router.post('/dlq/bulk-requeue', validate(bulkRequeueSchema), async (req, res, next) => {
  try {
    const result = await dlqService.bulkRequeue({
      tenantId: req.tenantId,
      filters: req.body,
      actorId: req.user._id,
      req,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

const purgeSchema = Joi.object({
  olderThanDays: Joi.number().integer().min(1).max(365).default(30),
});

router.post('/dlq/purge', validate(purgeSchema), async (req, res, next) => {
  try {
    const result = await dlqService.purge({
      tenantId: req.tenantId,
      ...req.body,
      actorId: req.user._id,
      req,
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────────────
// Connection Pool + Dedup Monitoring
// ──────────────────────────────────────────────────────
router.get('/pool/stats', async (req, res, next) => {
  try {
    const result = await connectionPoolService.stats();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/pool/slow-ops', async (req, res, next) => {
  try {
    const thresholdMs = Number(req.query.thresholdMs) || 100;
    const limit = Number(req.query.limit) || 20;
    const result = await connectionPoolService.slowOps({ thresholdMs, limit });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/pool/events', async (req, res, next) => {
  try {
    const result = connectionPoolService.getEvents();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/dedup/stats', async (req, res, next) => {
  try {
    const result = dedupStats();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export default router;
