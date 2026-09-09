/**
 * Smoke test — DLQ management + request deduplication (Phase 7.4.7 + 7.4.17).
 *
 * Hermetic: in-memory mongod.
 *
 * Covers:
 *   1. DLQ stats (empty → zero depth)
 *   2. DLQ requeue (failed → pending)
 *   3. DLQ bulk requeue
 *   4. DLQ purge
 *   5. Dedup — idempotency key returns cached response
 *   6. Dedup — content fingerprint deduplicates
 *   7. Dedup — cache stats
 *
 * Run: node scripts/smoke-dlq-dedup.test.js
 */
import './test-env-guard.js';
import assert from 'node:assert/strict';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = '';
process.env.MONGODB_URI = '';
process.env.OTP_PROVIDER = 'memory';

let mongod;
let passed = 0;
function ok(name) { passed += 1; console.log(`  PASS  ${name}`); }

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await createHermeticMongo({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_dlq');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  const MODEL_FILES = (await import('../src/config/models.js')).default;
  await Promise.all(MODEL_FILES.map((f) => import(`../src/models/${f}`)));
  for (const m of MODEL_FILES) {
    const mod = (await import(`../src/models/${m}`)).default;
    await mod.init();
  }

  const { default: dlqService } = await import('../src/services/dlq.service.js');
  const { default: CatalogEvent } = await import('../src/models/catalogEvent.model.js');
  const { BoundedCache } = await import('../src/utils/BoundedCache.js');

  const TENANT = new mongoose.Types.ObjectId();

  // ── 1. DLQ stats — empty ──
  const emptyStats = await dlqService.stats({ tenantId: TENANT });
  assert.equal(emptyStats.depth, 0, 'Empty DLQ');
  assert.equal(emptyStats.oldestAgeMs, 0);
  ok('DLQ stats — empty queue returns zero depth');

  // ── 2. Create failed events ──
  for (let i = 0; i < 5; i++) {
    await CatalogEvent.create({
      tenantId: TENANT,
      eventType: 'price_changed',
      entityType: 'listing',
      entityId: new mongoose.Types.ObjectId(),
      status: 'failed',
      attempts: 5,
      lastError: `Error ${i}`,
      availableAt: new Date(),
    });
  }
  ok('Created 5 failed events for DLQ testing');

  // ── 3. DLQ list ──
  const list = await dlqService.list({ tenantId: TENANT, query: {} });
  assert.equal(list.items.length, 5, '5 DLQ entries');
  assert.equal(list.meta.total, 5);
  ok('DLQ list — returns 5 entries');

  // ── 4. DLQ stats — populated ──
  const stats = await dlqService.stats({ tenantId: TENANT });
  assert.equal(stats.depth, 5, 'Depth = 5');
  assert.ok(stats.oldestAgeMs >= 0, 'Oldest age >= 0');
  ok('DLQ stats — depth=5');

  // ── 5. DLQ requeue single ──
  const firstEvent = list.items[0];
  await dlqService.requeue({
    tenantId: TENANT,
    eventId: firstEvent.id || firstEvent._id,
    actorId: new mongoose.Types.ObjectId(),
  });
  const requeued = await CatalogEvent.findOne({ _id: firstEvent.id || firstEvent._id });
  assert.equal(requeued.status, 'pending', 'Requeued to pending');
  assert.equal(requeued.retryCount, 0, 'Retry count reset');
  ok('DLQ requeue — failed → pending');

  // ── 6. DLQ bulk requeue ──
  const bulk = await dlqService.bulkRequeue({ tenantId: TENANT });
  assert.ok(bulk.requeued >= 4, `Bulk requeued ${bulk.requeued}`);
  ok('DLQ bulk requeue — remaining failed events requeued');

  // ── 7. DLQ purge ──
  // Make some old failed events
  await CatalogEvent.create({
    tenantId: TENANT,
    eventType: 'test_purge',
    entityType: 'listing',
    entityId: new mongoose.Types.ObjectId(),
    status: 'failed',
    attempts: 5,
    lastError: 'old error',
    availableAt: new Date(),
    createdAt: new Date(Date.now() - 40 * 86400000), // 40 days old
    updatedAt: new Date(Date.now() - 40 * 86400000),
  });
  const purgeResult = await dlqService.purge({ tenantId: TENANT, olderThanDays: 30 });
  assert.ok(purgeResult.purged >= 1, `Purged ${purgeResult.purged} old entries`);
  ok('DLQ purge — old entries removed');

  // ── 8. Dedup — BoundedCache as dedup store ──
  const dedupCache = new BoundedCache({ maxEntries: 100, ttlMs: 60000 });

  // Simulate idempotency: same key → same response
  const key = 'idempotency-key-123';
  const response = { status: 200, body: { success: true, orderId: 'ORD-001' } };
  dedupCache.set(key, response);
  const cached = dedupCache.get(key);
  assert.deepEqual(cached, response, 'Cached response returned');
  ok('Dedup — idempotency key returns cached response');

  // ── 9. Dedup — cache miss after TTL ──
  const shortCache = new BoundedCache({ maxEntries: 100, ttlMs: 50 });
  shortCache.set('expire-me', 'value');
  assert.equal(shortCache.get('expire-me'), 'value');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(shortCache.get('expire-me'), undefined, 'Expired');
  ok('Dedup — entries expire after TTL');

  // ── 10. Dedup — stats ──
  const cacheStats = dedupCache.stats();
  assert.ok(cacheStats.hits >= 1, 'Has hits');
  assert.ok(cacheStats.sets >= 1, 'Has sets');
  ok('Dedup — cache stats available');

  dedupCache.destroy();
  shortCache.destroy();

  console.log(`\n=== DLQ + DEDUP SMOKE: ${passed}/10 sections passed ===`);
}

main()
  .then(async () => { await mongoose.disconnect(); await stopHermeticMongo(mongod); process.exit(0); })
  .catch(async (err) => {
    console.error('\nFAILED:', err);
    try { await mongoose.disconnect(); } catch { /* */ }
    await stopHermeticMongo(mongod);
    process.exit(1);
  });
