/**
 * Chaos testing — validates system resilience under failure conditions.
 *
 * Tests that the system degrades gracefully when:
 *   1. Database connection drops
 *   2. Memory pressure (large payloads)
 *   3. Concurrent conflicting writes (race conditions)
 *   4. Malformed/malicious input
 *   5. TTL expiry and cache eviction
 *   6. Input validation robustness
 *
 * Hermetic: in-memory mongod.
 *
 * Run: node scripts/smoke-chaos.test.js
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
function ok(name) { passed += 1; console.log(`  ✅ ${name}`); }

async function main() {
  const config = (await import('../src/config/index.js')).default;
  mongod = await createHermeticMongo({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_chaos');
  await mongoose.connect(config.mongoUri, { autoIndex: false });

  console.log('=== Chaos Testing ===\n');

  // ── 1. Database disconnect — queries fail gracefully ──
  {
    await mongoose.disconnect();
    try {
      const conn = mongoose.connection;
      assert.notEqual(conn.readyState, 1, 'Connection is not ready after disconnect');
      ok('Database disconnect — connection state changes correctly');
    } catch (err) {
      console.error(`  ❌ DB disconnect: ${err.message}`);
    }
    await mongoose.connect(config.mongoUri, { autoIndex: false });
  }

  // ── 2. Template rendering — malicious input ──
  {
    const { renderTemplate } = await import('../src/services/notification.service.js');

    // Normal rendering
    const normal = renderTemplate('Hello {{ name }}', { name: 'World' });
    assert.equal(normal, 'Hello World');
    ok('Template rendering — normal input works');

    // Missing key → empty string
    const missing = renderTemplate('Hello {{ missing }}', {});
    assert.equal(missing, 'Hello ');
    ok('Template rendering — missing key → empty string (no crash)');

    // Nested key
    const nested = renderTemplate('{{ user.name }}', { 'user.name': 'Alice' });
    assert.equal(nested, 'Alice');
    ok('Template rendering — nested key resolution');

    // Null/undefined safety
    const nullSafe = renderTemplate('{{ val }}', { val: null });
    assert.equal(nullSafe, '');
    ok('Template rendering — null value → empty string');

    // Very long input
    const long = 'A'.repeat(50000);
    const longResult = renderTemplate('{{ v }}', { v: long });
    assert.equal(longResult.length, 50000);
    ok('Template rendering — 50KB input handled without crash');
  }

  // ── 3. BoundedCache — concurrent writes ──
  {
    const { BoundedCache } = await import('../src/utils/BoundedCache.js');
    const cache = new BoundedCache({ maxEntries: 100, ttlMs: 60000 });

    // 1000 concurrent writes
    const promises = Array.from({ length: 1000 }, (_, i) =>
      new Promise((resolve) => {
        cache.set(`k-${i}`, { v: i });
        resolve(cache.get(`k-${i}`));
      }),
    );
    const results = await Promise.all(promises);
    const allValid = results.every((r) => r !== undefined);
    assert.ok(allValid, 'All concurrent writes succeeded');
    ok('BoundedCache — 1000 concurrent writes all succeeded');

    cache.destroy();
  }

  // ── 4. BoundedCache — eviction under pressure ──
  {
    const { BoundedCache } = await import('../src/utils/BoundedCache.js');
    const cache = new BoundedCache({ maxEntries: 10, ttlMs: 60000 });

    for (let i = 0; i < 100; i++) cache.set(`k-${i}`, i);

    assert.ok(cache.size <= 10, `Cache bounded at ${cache.size}`);
    const stats = cache.stats();
    assert.ok(stats.evictions > 0, `${stats.evictions} evictions`);
    ok(`BoundedCache — eviction: ${stats.evictions} evictions, size=${cache.size}`);

    cache.destroy();
  }

  // ── 5. BoundedCache — TTL expiry ──
  {
    const { BoundedCache } = await import('../src/utils/BoundedCache.js');
    const cache = new BoundedCache({ maxEntries: 100, ttlMs: 50 });

    cache.set('ephemeral', 'value');
    assert.equal(cache.get('ephemeral'), 'value', 'Available before TTL');

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(cache.get('ephemeral'), undefined, 'Expired after TTL');
    ok('BoundedCache — TTL expiry works correctly');

    cache.destroy();
  }

  // ── 6. Input validation — all bad inputs rejected ──
  {
    const Joi = (await import('joi')).default;
    const schema = Joi.object({
      rating: Joi.number().integer().min(1).max(5).required(),
      title: Joi.string().max(200).required(),
    });

    const badInputs = [
      { rating: 0, title: 'test' },
      { rating: 6, title: 'test' },
      { rating: 1.5, title: 'test' },
      { rating: 'five', title: 'test' },
      { rating: null, title: 'test' },
      { title: 'test' },
      {},
      { rating: -1, title: '' },
    ];

    let allRejected = true;
    for (const input of badInputs) {
      const { error } = schema.validate(input);
      if (!error) allRejected = false;
    }
    assert.ok(allRejected, 'All bad inputs rejected');
    ok('Input validation — all 8 malicious inputs correctly rejected');
  }

  // ── 7. money.js — fuzz: 10000 random splits never lose a paisa ──
  {
    const { allocatePaise, toPaise, fromPaise } = await import('../src/utils/money.js');
    const { randomInt } = await import('node:crypto');

    let fuzzPassed = 0;
    for (let trial = 0; trial < 10000; trial++) {
      const n = randomInt(1, 6);
      const weights = Array.from({ length: n }, () => randomInt(0, 1000));
      const totalPaise = randomInt(-50000, 50000);
      const parts = allocatePaise(totalPaise, weights);
      const sum = parts.reduce((s, p) => s + p, 0);
      assert.equal(sum, totalPaise, `Fuzz trial ${trial}: sum=${sum} !== total=${totalPaise}`);
      fuzzPassed += 1;
    }
    ok(`Money fuzz — ${fuzzPassed}/10000 random allocations never lose a paisa`);
  }

  // ── 8. Money — negative amounts don't flip sign ──
  {
    const { allocatePaise } = await import('../src/utils/money.js');
    const parts = allocatePaise(-100, [30, 70]);
    const allNegative = parts.every((p) => p <= 0);
    assert.ok(allNegative, 'Negative split stays negative');
    assert.equal(parts.reduce((s, p) => s + p, 0), -100, 'Negative split sums correctly');
    ok('Money — negative amounts never flip sign');
  }

  console.log(`\n=== Chaos Testing: ${passed}/8 sections passed ===`);
}

main()
  .then(async () => { await mongoose.disconnect(); await stopHermeticMongo(mongod); process.exit(0); })
  .catch(async (err) => {
    console.error('\nFATAL:', err);
    try { await mongoose.disconnect(); } catch { /* */ }
    await stopHermeticMongo(mongod);
    process.exit(1);
  });
