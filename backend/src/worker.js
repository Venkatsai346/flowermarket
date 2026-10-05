/**
 * Worker runtime — the async-execution layer the API process deliberately
 * doesn't own.
 *
 *   node src/worker.js
 *
 * One process (N possible — everything is safe under concurrency):
 *  1. OUTBOX CONSUMER — every WORKER_POLL_MS it reclaims expired leases and
 *     drains due catalog events with ATOMIC CLAIMS (pending→publishing with
 *     claimedBy + leaseExpiresAt). Handler failures back off exponentially
 *     (30s/2m/10m/30m) and dead-letter after WORKER_MAX_ATTEMPTS; ops can
 *     re-queue via POST /catalog/admin/events/retry-failed.
 *  2. CATALOG BULK JOBS — advances one bounded, durable row checkpoint batch
 *     per tick. Mongo leases make restarts and concurrent workers safe.
 *  3. CATALOG QUALITY — advances one durable, resumable 100-family sweep
 *     checkpoint per tick with tenant-scoped leases and cancellation.
 *  4. MEDIA PROCESSING — verifies signatures, extracts metadata and creates
 *     immutable responsive AVIF/WebP renditions through durable leases.
 *  5. SCHEDULER — runs the built-in jobs (per-tenant nightly + marketplace
 *     nightly) at their scheduled hour. Single-flight across workers via an
 *     atomic nextRunAt advance (see workers/scheduler.js).
 *
 * The API process keeps its manual drain button (same claim path — safe to
 * run alongside the worker) and the manual nightly endpoints.
 *
 * Env: WORKER_ENABLED (default on), WORKER_POLL_MS, WORKER_BATCH_SIZE,
 *      WORKER_LEASE_MS, WORKER_MAX_ATTEMPTS, WORKER_NIGHTLY_HOUR.
 */
import crypto from 'node:crypto';
import config from './config/index.js';
import { connectDb, disconnectDb } from './config/db.js';
import { assertProductionProviders } from './utils/assertProductionProviders.js';
import MODEL_FILES from './config/models.js';
import catalogEventService from './services/catalogEvent.service.js';
import notificationService from './services/notification.service.js';
import searchIndexer from './services/searchIndexer.service.js';
import heartbeatService from './services/heartbeat.service.js';
import bulkImportService from './services/bulkImport.service.js';
import catalogQualityService from './services/catalogQuality.service.js';
import mediaProcessingService from './services/mediaProcessing.service.js';
import inventoryReservationService from './services/inventoryReservation.service.js';
import { catalogQualityEvaluationDuration, catalogQualityEvaluations, catalogQualityFamilies } from './observability/registry.js';
import { seedJobs, tick as schedulerTick } from './workers/scheduler.js';

const workerId = `worker-${process.pid}-${crypto.randomBytes(2).toString('hex')}`;
let stopping = false;

// lifetime counters, reported with every heartbeat (informational snapshot)
const counters = {
  ticks: 0,
  eventsPublished: 0,
  eventsFailed: 0,
  leasesReclaimed: 0,
  jobsStarted: 0,
  bulkJobsAdvanced: 0,
  qualityRunsAdvanced: 0,
  mediaJobsProcessed: 0,
  inventoryReservationsExpired: 0,
};

async function main() {
  if (!config.worker.enabled) {
    console.log('[worker] WORKER_ENABLED=false — not starting');
    return;
  }
  assertProductionProviders(config);
  await connectDb();
  for (const f of MODEL_FILES) {
    await (await import(`./models/${f}`)).default.init();
  }

  // same event handlers as the API process (Set-based, idempotent register)
  notificationService.initConsumer();
  searchIndexer.initConsumer();

  const jobs = await seedJobs();
  console.log(
    `[worker] ${workerId} up — poll=${config.worker.pollMs}ms batch=${config.worker.batchSize} ` +
      `lease=${config.worker.leaseMs}ms maxAttempts=${config.worker.maxAttempts} ` +
      `jobs=[${jobs.map((j) => j.name).join(', ')}]`,
  );
  heartbeatService.beat('worker', workerId, counters);

  // tick: heartbeat → reap expired leases → drain due events → run due jobs
  const tickOnce = async () => {
    counters.ticks += 1;
    heartbeatService.beat('worker', workerId, counters);
    const reclaimed = await catalogEventService.reapExpired().catch((e) => {
      console.error('[worker] reap failed:', e?.message);
      return 0;
    });
    counters.leasesReclaimed += reclaimed;
    if (reclaimed) console.log(`[worker] reclaimed ${reclaimed} expired lease(s)`);
    const res = await catalogEventService.drain({
      limit: config.worker.batchSize,
      workerId,
    }).catch((e) => {
      console.error('[worker] drain failed:', e?.message);
      return null;
    });
    if (res) {
      counters.eventsPublished += res.published;
      counters.eventsFailed += res.failed;
      if (res.published || res.failed) {
        console.log(`[worker] drained ${res.published} ok / ${res.failed} failed (scanned ${res.scanned})`);
      }
    }
    const bulkResults = await bulkImportService.processAvailable({
      workerId, maxJobs: 1, maxBatchesPerJob: 1,
    }).catch((e) => {
      // Worker failures must be visible; leases make the batch reclaimable.
      // eslint-disable-next-line no-console
      console.error('[worker] bulk import advance failed:', e?.message);
      return [];
    });
    counters.bulkJobsAdvanced += bulkResults.length;
    const qualityStarted = process.hrtime.bigint();
    const qualityResults = await catalogQualityService.processAvailableRuns({ workerId, maxRuns: 1 }).catch((e) => {
      catalogQualityEvaluationDuration.observe({ outcome: 'error' }, Number(process.hrtime.bigint() - qualityStarted) / 1e9);
      catalogQualityEvaluations.inc({ outcome: 'error' });
      // The run lease remains reclaimable after an unexpected batch failure.
      // eslint-disable-next-line no-console
      console.error('[worker] catalog quality advance failed:', e?.message);
      return [];
    });
    if (qualityResults.length) {
      catalogQualityEvaluationDuration.observe({ outcome: 'ok' }, Number(process.hrtime.bigint() - qualityStarted) / 1e9);
      catalogQualityEvaluations.inc({ outcome: 'ok' });
      counters.qualityRunsAdvanced += qualityResults.length;
      for (const result of qualityResults) {
        if (result?.status === 'completed') catalogQualityFamilies.observe({}, result.evaluated || 0);
      }
    }
    const mediaResults = await mediaProcessingService.processAvailable({ workerId, maxJobs: 1 }).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[worker] media processing failed:', e?.message);
      return [];
    });
    counters.mediaJobsProcessed += mediaResults.length;
    await mediaProcessingService.probeOne().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[worker] media health probe failed:', e?.message);
    });
    const reservationSweepEvery = Math.max(1, Math.round(60000 / config.worker.pollMs));
    if (counters.ticks % reservationSweepEvery === 0) {
      const sweep = await inventoryReservationService.sweepExpired({}).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[worker] inventory reservation sweep failed:', e?.message);
        return null;
      });
      if (sweep) counters.inventoryReservationsExpired += sweep.expired;
    }
    try {
      const started = await schedulerTick(workerId);
      counters.jobsStarted += started.length;
      for (const name of started) console.log(`[worker] job started: ${name}`);
    } catch (e) {
      console.error('[worker] scheduler failed:', e?.message);
    }
  };

  // first tick immediately, then on cadence
  await tickOnce();
  const timer = setInterval(() => {
    tickOnce().catch((e) => console.error('[worker] tick error:', e?.message));
  }, config.worker.pollMs);
  timer.unref();

  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${sig} — shutting down (in-flight tick finishes)`);
    clearInterval(timer);
    try {
      await disconnectDb();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
