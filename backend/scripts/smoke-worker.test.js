/**
 * Worker runtime smoke test — crash-safe outbox consumption + scheduler.
 *
 * Hermetic: in-memory mongod, no dev .env leakage (test-env-guard first).
 *
 * Covers:
 *   1. Backoff ladder (30s / 2m / 10m / 30m, capped)
 *   2. Claim atomicity — N concurrent workers, each event handled exactly once
 *   3. Lease reclamation — a "dead" worker's in-flight row is reclaimed and
 *      re-consumed (no event stuck in `publishing` forever)
 *   4. Retry + dead-letter + manual re-queue — failures back off via
 *      availableAt, DLQ after maxAttempts, retryFailed() restores budget
 *   5. Scheduler single-flight — two workers tick on the same due job,
 *      exactly one executes; nextRunAt advances
 *   6. Scheduler due/no-due boundaries + seed idempotency
 *
 * Run: node scripts/smoke-worker.test.js
 */
import './test-env-guard.js'; // FIRST import: hermetic env before dotenv (see test-env-guard.js)
import assert from 'node:assert/strict';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = ''; // hermetic
process.env.MONGODB_URI = ''; // hermetic
process.env.OTP_PROVIDER = 'memory';
process.env.WORKER_MAX_ATTEMPTS = '5';

let mongod;
let passed = 0;
function ok(name) { passed += 1; console.log(`  PASS  ${name}`); }

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await createHermeticMongo({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_worker_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const MODEL_FILES = (await import('../src/config/models.js')).default;
  const models = await Promise.all(MODEL_FILES.map((f) => import(`../src/models/${f}`)));
  for (const m of models) { const mod = m.default; await mod.init(); }

  const { default: catalogEventService, registerCatalogEventHandler, backoffMs } =
    await import('../src/services/catalogEvent.service.js');
  const { default: CatalogEvent } = await import('../src/models/catalogEvent.model.js');
  const { default: ScheduledJob } = await import('../src/models/scheduledJob.model.js');
  const { seedJobs, tick } = await import('../src/workers/scheduler.js');

  // one global test handler, behaviour steered by `state` per phase
  const state = { failNext: 0, seen: [] };
  registerCatalogEventHandler(async (ev) => {
    if (state.failNext > 0) { state.failNext -= 1; throw new Error('handler boom'); }
    state.seen.push(String(ev.entityId));
  });

  const ENTITY = '64b000000000000000000001';
  const pub = () => catalogEventService.publish({
    eventType: 'price_changed', entityType: 'listing', entityId: ENTITY,
  });

  // ---- 1. backoff ladder ----
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 120_000);
  assert.equal(backoffMs(3), 600_000);
  assert.equal(backoffMs(4), 1_800_000);
  assert.equal(backoffMs(99), 1_800_000); // capped
  ok('backoff ladder 30s/2m/10m/30m (capped)');

  // ---- 2. claim atomicity across 3 concurrent workers ----
  const evs = await Promise.all(Array.from({ length: 6 }, () => pub()));
  state.seen = [];
  state.failNext = 0;
  const results = await Promise.all([
    catalogEventService.drain({ limit: 50, workerId: 'w-a' }),
    catalogEventService.drain({ limit: 50, workerId: 'w-b' }),
    catalogEventService.drain({ limit: 50, workerId: 'w-c' }),
  ]);
  assert.equal(results.reduce((n, r) => n + r.published, 0), 6);
  assert.equal(state.seen.length, 6, 'each event handled exactly once');
  assert.deepEqual(new Set(state.seen).size, 1, 'single entity, 6 events');
  const leftover = await CatalogEvent.countDocuments({ status: { $in: ['pending', 'publishing'] } });
  assert.equal(leftover, 0);
  ok('claim atomicity — 3 concurrent workers, 6 events, exactly-once handling');

  // ---- 3. lease reclamation (dead worker recovery) ----
  await pub();
  const stuck = await CatalogEvent.findOne({ status: 'pending' });
  stuck.status = 'publishing';
  stuck.claimedBy = 'dead-worker';
  stuck.claimedAt = new Date(Date.now() - 120_000);
  stuck.leaseExpiresAt = new Date(Date.now() - 60_000); // expired
  await stuck.save();
  const before = state.seen.length;
  const re = await catalogEventService.drain({ limit: 10, workerId: 'w-reaper' });
  assert.equal(re.published, 1, 'reclaimed event was consumed');
  assert.equal(state.seen.length, before + 1);
  const stuckLeft = await CatalogEvent.countDocuments({ status: 'publishing' });
  assert.equal(stuckLeft, 0);
  ok('lease reclamation — dead worker row recovered and consumed');

  // ---- 4. retry backoff → dead-letter → manual re-queue ----
  const ENTITY4 = '64b000000000000000000004'; // unique per phase (rows share no id)
  await catalogEventService.publish({
    eventType: 'price_changed', entityType: 'listing', entityId: ENTITY4,
  });
  state.failNext = 5; // every attempt fails until the budget is spent
  for (let i = 1; i <= 5; i += 1) {
    const r = await catalogEventService.drain({ limit: 10, workerId: 'w-retry' });
    assert.equal(r.failed, 1, `attempt ${i} recorded as failed`);
    const row = await CatalogEvent.findOne({ entityId: ENTITY4 });
    assert.equal(row.attempts, i, `attempts=${i} after failure ${i}`);
    if (i < 5) {
      assert.equal(row.status, 'pending', `retry ${i} re-queued as pending`);
      assert.ok(row.availableAt.getTime() > Date.now() - 1000, `retry ${i} backoff in the future`);
      assert.ok(row.lastError.includes('handler boom'), 'lastError recorded');
      // simulate the backoff elapsing
      row.availableAt = new Date(Date.now() - 1000);
      await row.save();
    }
  }
  const dlq = await CatalogEvent.findOne({ entityId: ENTITY4 });
  assert.equal(dlq.status, 'failed', 'dead-lettered after maxAttempts');
  assert.equal(dlq.attempts, 5);
  assert.equal(dlq.lastError, 'handler boom');
  const rq = await catalogEventService.retryFailed();
  assert.equal(rq.requeued, 1);
  state.failNext = 0; // handler recovers
  const fin = await catalogEventService.drain({ limit: 10, workerId: 'w-retry2' });
  assert.equal(fin.published, 1);
  const doneRow = await CatalogEvent.findOne({ entityId: ENTITY4 });
  assert.equal(doneRow.status, 'published');
  assert.equal(doneRow.attempts, 0, 'attempt budget restored by manual re-queue');
  ok('retry backoff → dead-letter at 5 attempts → retryFailed() → published');

  // ---- 5. scheduler single-flight ----
  const jobRuns = { n: 0 };
  const testDefs = [
    {
      name: 'test-job', schedule: 'test', hour: 2, minute: 0,
      async run() { jobRuns.n += 1; return { fired: true }; },
    },
  ];
  await seedJobs(testDefs);
  const job = await ScheduledJob.findOne({ name: 'test-job' });
  assert.ok(job.nextRunAt.getTime() > Date.now(), 'seeded with future nextRunAt');
  const noStart = await tick('w-x', testDefs);
  assert.deepEqual(noStart, [], 'not due → nothing starts');
  job.nextRunAt = new Date(Date.now() - 1000);
  await job.save();
  await Promise.all([tick('w-1', testDefs), tick('w-2', testDefs)]);
  await new Promise((r) => setTimeout(r, 100)); // let the fire-and-forget run finish
  assert.equal(jobRuns.n, 1, 'single-flight: exactly one worker executed the job');
  const after = await ScheduledJob.findOne({ name: 'test-job' });
  assert.ok(after.nextRunAt.getTime() > Date.now(), 'nextRunAt advanced');
  assert.equal(after.lastStatus, 'ok');
  assert.equal(after.lastResult.fired, true);
  ok('scheduler single-flight — 2 workers, 1 execution, schedule advanced');

  // ---- 6. seed idempotency ----
  await seedJobs(testDefs);
  const count = await ScheduledJob.countDocuments({ name: 'test-job' });
  assert.equal(count, 1, 'seed does not duplicate');
  ok('seed idempotency');

  console.log(`\n=== WORKER SMOKE: ${passed}/6 sections passed ===`);
}

main()
  .then(async () => { await mongoose.disconnect(); await stopHermeticMongo(mongod); process.exit(0); })
  .catch(async (err) => {
    console.error('\nFAILED:', err);
    try { await mongoose.disconnect(); } catch { /* noop */ }
    await stopHermeticMongo(mongod);
    process.exit(1);
  });
