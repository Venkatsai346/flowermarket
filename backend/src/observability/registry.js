/**
 * Application metrics registry — the signal set that matters for THIS system.
 *
 * Four families the operator actually pages on:
 *   1. OUTBOX   — depth by status, OLDEST DUE AGE (the lag metric), DLQ depth
 *   2. WORKER   — heartbeat age + alive flag (consumer liveness)
 *   3. JOBS     — next-run countdown + last status per scheduled job
 *   4. HTTP     — request counts + duration histogram per route pattern
 *
 * Plus process (uptime/heap/rss/event-loop lag) and DB connectivity.
 *
 * `collectDynamic()` is awaited by the /metrics handler on every scrape:
 * it recomputes all DB-backed gauges fresh (a handful of cheap indexed
 * reads — fine at scrape cadence) so /metrics is always current with no
 * background-update drift.
 */

import mongoose from 'mongoose';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import config from '../config/index.js';
import CatalogEvent from '../models/catalogEvent.model.js';
import ScheduledJob from '../models/scheduledJob.model.js';
import SystemHeartbeat from '../models/systemHeartbeat.model.js';
import Payment from '../models/payment.model.js';
import RefundTransaction from '../models/refundTransaction.model.js';
import CatalogBulkJob from '../models/catalogBulkJob.model.js';
import CatalogQualityRun from '../models/catalogQualityRun.model.js';
import MediaProcessingJob from '../models/mediaProcessingJob.model.js';
import ProductImage from '../models/productImage.model.js';
import catalogEventService from '../services/catalogEvent.service.js';
import { PAYMENT_STATUS, PAYMENT_PROVIDER, REFUND_TRANSACTION_STATUS } from '../constants/enums.js';
import { createRegistry } from './metrics.js';

export const registry = createRegistry('fm');

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

// ---- HTTP (process-scoped, written by middleware/metrics.js) ----
export const httpRequests = registry.counter(
  'http_requests_total',
  'Total HTTP requests by method, route pattern and status code.',
  ['method', 'route', 'status'],
);
export const httpDuration = registry.histogram(
  'http_request_duration_seconds',
  'HTTP request duration in seconds by method and route pattern.',
  ['method', 'route'],
);

// ---- Search provider (bounded operation labels; never index/query cardinality) ----
export const searchProviderRequests = registry.counter(
  'search_provider_requests_total',
  'External search provider requests by operation and outcome.',
  ['provider', 'operation', 'outcome'],
);
export const searchInteractionEvents = registry.counter(
  'search_interaction_events_total',
  'Search interaction acceptance and rejection outcomes by bounded event type and reason.',
  ['type', 'outcome'],
);
export const warehouseAllocationRequests = registry.counter(
  'warehouse_allocation_requests_total',
  'Warehouse allocation planning outcomes by bounded strategy and outcome.',
  ['strategy', 'outcome'],
);
export const warehouseAllocationNodes = registry.histogram(
  'warehouse_allocation_candidate_nodes',
  'Eligible fulfillment nodes evaluated per allocation.',
  ['strategy'],
  [0, 1, 2, 3, 5, 8, 12, 20, 50],
);

export const searchRollups = registry.counter(
  'search_analytics_rollups_total',
  'Search analytics rollup outcomes.',
  ['outcome'],
);

export const searchProviderDuration = registry.histogram(
  'search_provider_request_duration_seconds',
  'External search provider request duration by operation.',
  ['provider', 'operation'],
  [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
);

// ---- Catalog discovery (bounded labels; never tenant/query cardinality) ----
export const catalogCommandRuns = registry.counter(
  'catalog_command_runs_total',
  'Catalog command outcomes by operation, execution mode, and replay status.',
  ['operation', 'mode', 'outcome'],
);
export const catalogCommandDuration = registry.histogram(
  'catalog_command_duration_seconds',
  'Catalog command execution duration by operation and execution mode.',
  ['operation', 'mode'],
  [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
);

export const catalogReadDuration = registry.histogram(
  'catalog_read_duration_seconds',
  'Authoritative grouped catalog read duration by source and outcome.',
  ['source', 'outcome'],
  [0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 2, 5],
);
export const catalogReadRequests = registry.counter(
  'catalog_read_requests_total',
  'Grouped catalog requests by source and outcome.',
  ['source', 'outcome'],
);
export const catalogFamiliesReturned = registry.histogram(
  'catalog_families_returned',
  'Number of product families returned by one grouped catalog request.',
  ['source'],
  [0, 1, 6, 12, 24, 36, 60],
);
export const catalogQualityEvaluationDuration = registry.histogram(
  'catalog_quality_evaluation_duration_seconds',
  'Tenant catalog quality sweep duration by bounded outcome.',
  ['outcome'],
  [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
);
export const catalogQualityEvaluations = registry.counter(
  'catalog_quality_evaluations_total',
  'Tenant catalog quality sweeps by bounded outcome.',
  ['outcome'],
);
export const catalogQualityFamilies = registry.histogram(
  'catalog_quality_families_evaluated',
  'Product families evaluated by a completed quality sweep.',
  [],
  [0, 1, 10, 50, 100, 500, 1000, 5000, 10000, 50000],
);
export const catalogMediaReadDuration = registry.histogram(
  'catalog_media_read_duration_seconds',
  'Global media operations read duration by bounded operation and outcome.',
  ['operation', 'outcome'],
  [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
);
export const catalogMediaMutations = registry.counter(
  'catalog_media_mutations_total',
  'Successful governed catalog media mutations by bounded operation.',
  ['operation'],
);
const catalogBulkJobs = registry.gauge(
  'catalog_bulk_jobs',
  'Durable catalog bulk jobs by bounded status.',
  ['status'],
);
const catalogBulkOldestQueuedAge = registry.gauge(
  'catalog_bulk_oldest_queued_age_seconds',
  'Age of the oldest queued catalog bulk job; zero when no job is queued.',
);
const catalogQualityRuns = registry.gauge(
  'catalog_quality_runs',
  'Durable catalog quality runs by bounded status.',
  ['status'],
);
const catalogQualityOldestQueuedAge = registry.gauge(
  'catalog_quality_oldest_queued_age_seconds',
  'Age of the oldest queued catalog quality run; zero when none is queued.',
);
const mediaProcessingJobs = registry.gauge(
  'media_processing_jobs',
  'Durable media processing jobs by bounded status.',
  ['status'],
);
const mediaProcessingOldestQueuedAge = registry.gauge(
  'media_processing_oldest_queued_age_seconds',
  'Age of the oldest queued media processing job; zero when none is queued.',
);
const catalogBrokenMedia = registry.gauge(
  'catalog_broken_media_assets',
  'Active governed product-image rows that failed repeated storage health checks.',
);

// ---- DB ----
const dbConnected = registry.gauge('db_connected', '1 when the Mongo connection is ready, 0 otherwise.');

// ---- Outbox (the async-execution layer) ----
const outboxEvents = registry.gauge('outbox_events', 'Outbox events by status.', ['status']);
const outboxOldestAge = registry.gauge(
  'outbox_oldest_pending_age_seconds',
  'Age in seconds of the oldest due (dispatchable) pending outbox event; 0 when the queue is empty.',
);
const outboxDlq = registry.gauge('outbox_dlq_depth', 'Outbox dead-letter depth (terminal failed events awaiting manual re-queue).');

// ---- Worker liveness ----
const workerAge = registry.gauge(
  'worker_last_heartbeat_age_seconds',
  'Seconds since the async worker last beat; -1 when no beat has ever been seen.',
);
const workerAlive = registry.gauge('worker_alive', '1 when the worker heartbeat is fresh (<= configured threshold), 0 otherwise.');

// ---- Payments (money state) ----
const paymentPending = registry.gauge('payment_pending_count', 'Payments stuck PENDING (awaiting gateway/webhook or reconciliation).');
const paymentPendingAge = registry.gauge(
  'payment_pending_oldest_age_seconds',
  'Age in seconds of the oldest PENDING payment; 0 when none.',
);
const refundPending = registry.gauge('refund_pending_count', 'Gateway refunds awaiting reconciliation (async providers).');

// ---- Cash on delivery (unsecured money, physically in the field) ----
// Cash is the one payment method where the platform extends credit to a
// stranger and then sends an employee to collect it, so "how much is
// outstanding, and how old is it?" is a risk question, not a curiosity. These
// four gauges are the whole exposure dashboard: receivable (owed, not yet
// taken), age (how long it has been owed), and cash on hand (taken but not yet
// banked — the theft/loss window).
const codOutstanding = registry.gauge(
  'cod_outstanding_count',
  'COD payments AWAITING_COLLECTION — orders confirmed and moving with no money taken yet.',
);
const codOutstandingPaise = registry.gauge(
  'cod_outstanding_paise',
  'Total paise owed across outstanding COD payments (the unsecured exposure).',
);
const codOutstandingAge = registry.gauge(
  'cod_outstanding_oldest_age_seconds',
  'Age in seconds of the oldest outstanding COD payment; 0 when none.',
);
const codCashOnHand = registry.gauge(
  'cod_cash_on_hand_count',
  'COD payments collected but not yet banked — physical notes in the field.',
);
export const codCollections = registry.counter(
  'cod_collections_total',
  'Cash-on-delivery collection attempts by outcome (ok/already_collected/mismatch/error).',
  ['result'],
);
export const webhookEvents = registry.counter(
  'webhook_events_total',
  'Gateway webhook events by provider and processing result (processed/duplicate/mismatch/ignored).',
  ['provider', 'result'],
);
export const paymentReconcile = registry.counter(
  'payment_reconcile_runs_total',
  'Payment reconciliation sweeps by outcome (ok/error).',
  ['result'],
);

// ---- Pricing ----
// A store trading on a platform default rather than its own policy is invisible
// in every other signal: the order succeeds, the money reconciles, and the
// merchant never learns they are charging a number they did not choose. This is
// the counter that makes it visible. kind = delivery_fee | tax_policy.
export const pricingFallback = registry.counter(
  'pricing_fallback_total',
  'Orders priced from a platform default because the tenant has no active policy.',
  ['kind'],
);

// ---- Scheduled jobs ----
const jobNext = registry.gauge(
  'scheduled_job_next_run_in_seconds',
  'Seconds until a scheduled job runs next (negative = overdue).',
  ['job'],
);
const jobStatus = registry.gauge(
  'scheduled_job_last_status',
  'Last run outcome of a scheduled job (1=ok, 0=error, -1=never ran).',
  ['job'],
);

// ---- Process ----
const procUptime = registry.gauge('process_uptime_seconds', 'Process uptime in seconds.');
const procHeap = registry.gauge('process_memory_heap_bytes', 'Process heap usage in bytes.');
const procRss = registry.gauge('process_memory_rss_bytes', 'Process resident set size in bytes.');
const procLoopLag = registry.gauge(
  'process_event_loop_lag_seconds',
  'Event-loop lag observed since the previous scrape (stat=mean|max).',
  ['stat'],
);

/**
 * Recompute every dynamic gauge. DB-backed sections degrade gracefully:
 * if Mongo is not connected, process metrics still render and db_connected=0.
 */
export async function collectDynamic() {
  // process — always available
  const mem = process.memoryUsage();
  procUptime.set(process.uptime());
  procHeap.set(mem.heapUsed);
  procRss.set(mem.rss);
  procLoopLag.set({ stat: 'mean' }, loopDelay.mean / 1e6);
  procLoopLag.set({ stat: 'max' }, loopDelay.max / 1e6);
  loopDelay.reset();

  dbConnected.set(mongoose.connection.readyState === 1 ? 1 : 0);
  if (mongoose.connection.readyState !== 1) return;

  try {
    // outbox
    const st = await catalogEventService.status();
    for (const s of ['pending', 'publishing', 'published', 'failed']) {
      outboxEvents.set({ status: s }, st[s] || 0);
    }
    const oldest = await CatalogEvent.findOne({
      status: 'pending',
      availableAt: { $lte: new Date() },
    })
      .sort({ availableAt: 1, createdAt: 1 })
      .select('availableAt')
      .lean();
    outboxOldestAge.set(oldest ? Math.max(0, (Date.now() - new Date(oldest.availableAt).getTime()) / 1000) : 0);
    outboxDlq.set(st.failed || 0);

    // durable catalog imports
    catalogBulkJobs.reset();
    const bulkCounts = await CatalogBulkJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    for (const status of ['queued', 'running', 'cancel_requested', 'cancelled', 'completed', 'failed']) {
      catalogBulkJobs.set({ status }, bulkCounts.find((row) => row._id === status)?.count || 0);
    }
    const oldestBulk = await CatalogBulkJob.findOne({ status: 'queued' }).sort({ createdAt: 1 }).select('createdAt').lean();
    catalogBulkOldestQueuedAge.set(oldestBulk ? Math.max(0, (Date.now() - new Date(oldestBulk.createdAt).getTime()) / 1000) : 0);

    // durable catalog quality sweeps
    catalogQualityRuns.reset();
    const qualityCounts = await CatalogQualityRun.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    for (const status of ['queued', 'running', 'cancel_requested', 'cancelled', 'completed', 'failed']) {
      catalogQualityRuns.set({ status }, qualityCounts.find((row) => row._id === status)?.count || 0);
    }
    const oldestQuality = await CatalogQualityRun.findOne({ status: 'queued' }).sort({ createdAt: 1 }).select('createdAt').lean();
    catalogQualityOldestQueuedAge.set(oldestQuality ? Math.max(0, (Date.now() - new Date(oldestQuality.createdAt).getTime()) / 1000) : 0);

    // governed media ingestion
    mediaProcessingJobs.reset();
    const mediaCounts = await MediaProcessingJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    for (const status of ['queued', 'running', 'completed', 'failed']) {
      mediaProcessingJobs.set({ status }, mediaCounts.find((row) => row._id === status)?.count || 0);
    }
    const oldestMedia = await MediaProcessingJob.findOne({ status: 'queued' }).sort({ createdAt: 1 }).select('createdAt').lean();
    mediaProcessingOldestQueuedAge.set(oldestMedia ? Math.max(0, (Date.now() - new Date(oldestMedia.createdAt).getTime()) / 1000) : 0);
    catalogBrokenMedia.set(await ProductImage.countDocuments({ healthStatus: 'broken', status: 'active', isDeleted: { $ne: true } }));

    // worker liveness
    const hb = await SystemHeartbeat.findOne({ role: 'worker' }).lean();
    if (hb && hb.lastBeatAt) {
      const age = (Date.now() - new Date(hb.lastBeatAt).getTime()) / 1000;
      workerAge.set(age);
      workerAlive.set(age <= config.observability.workerAliveAfterSec ? 1 : 0);
    } else {
      workerAge.set(-1);
      workerAlive.set(0);
    }

    // scheduled jobs (reset first — the job set can change)
    jobNext.reset();
    jobStatus.reset();
    const jobs = await ScheduledJob.find().select('name nextRunAt lastStatus').lean();
    const now = Date.now();
    for (const j of jobs) {
      jobNext.set({ job: j.name }, (new Date(j.nextRunAt).getTime() - now) / 1000);
      jobStatus.set({ job: j.name }, j.lastStatus === 'ok' ? 1 : j.lastStatus === 'error' ? 0 : -1);
    }

    // payments (money in flight)
    const [pendingPayments, oldestPayment, pendingRefunds] = await Promise.all([
      Payment.countDocuments({ status: PAYMENT_STATUS.PENDING }),
      Payment.findOne({ status: PAYMENT_STATUS.PENDING }).sort({ createdAt: 1 }).select('createdAt').lean(),
      RefundTransaction.countDocuments({ status: REFUND_TRANSACTION_STATUS.PENDING }),
    ]);
    paymentPending.set(pendingPayments);
    paymentPendingAge.set(
      oldestPayment ? Math.max(0, (Date.now() - new Date(oldestPayment.createdAt).getTime()) / 1000) : 0,
    );
    refundPending.set(pendingRefunds);

    // cash on delivery (exposure: owed, aging, and taken-but-unbanked)
    const [codOwed, codOldest, codOwedPaise, codCollectedUnbanked] = await Promise.all([
      Payment.countDocuments({ status: PAYMENT_STATUS.AWAITING_COLLECTION }),
      Payment.findOne({ status: PAYMENT_STATUS.AWAITING_COLLECTION })
        .sort({ createdAt: 1 }).select('createdAt').lean(),
      Payment.aggregate([
        { $match: { status: PAYMENT_STATUS.AWAITING_COLLECTION } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.countDocuments({
        status: PAYMENT_STATUS.SUCCESS,
        provider: PAYMENT_PROVIDER.COD,
        depositedAt: null,
      }),
    ]);
    codOutstanding.set(codOwed);
    codOutstandingAge.set(
      codOldest ? Math.max(0, (Date.now() - new Date(codOldest.createdAt).getTime()) / 1000) : 0,
    );
    // `amount` is rupees on the Payment row; the metric is paise so it stays an
    // integer and matches every other money gauge in the ledger.
    codOutstandingPaise.set(Math.round((codOwedPaise[0]?.total || 0) * 100));
    codCashOnHand.set(codCollectedUnbanked);
  } catch (err) {
    // partial metrics are better than none — the scrape still succeeds
    // eslint-disable-next-line no-console
    console.error('[metrics] dynamic collect failed:', err?.message);
  }
}
