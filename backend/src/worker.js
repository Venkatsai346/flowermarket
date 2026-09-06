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
 *  2. SCHEDULER — runs the built-in jobs (per-tenant nightly + marketplace
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
import MODEL_FILES from './config/models.js';
import catalogEventService from './services/catalogEvent.service.js';
import notificationService from './services/notification.service.js';
import searchIndexer from './services/searchIndexer.service.js';
import heartbeatService from './services/heartbeat.service.js';
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
};

async function main() {
  if (!config.worker.enabled) {
    console.log('[worker] WORKER_ENABLED=false — not starting');
    return;
  }
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
