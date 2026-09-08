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
