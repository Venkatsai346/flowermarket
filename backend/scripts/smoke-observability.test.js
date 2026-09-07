/**
 * Observability smoke test — /healthz, /readyz, /metrics (Prometheus).
 *
 * Hermetic: in-memory mongod, app built via createApp() on an ephemeral port,
 * real HTTP via fetch. No dev .env leakage (test-env-guard first).
 *
 * Covers:
 *   1. Registry correctness — counter/gauge/histogram, label sorting,
 *      escaping, monotonic buckets, HELP/TYPE lines
 *   2. /healthz liveness (DB-free) + /readyz gating (503 pre-DB, 200 post-DB)
 *   3. /metrics — valid exposition format, outbox gauges reflect seeded rows,
 *      DLQ depth, oldest-pending age
 *   4. Worker heartbeat → alive flag flips with beat age
 *   5. Scheduled-job gauges (next-run countdown + last status)
 *   6. HTTP request metrics (bounded route labels, status codes)
 *
 * Run: node scripts/smoke-observability.test.js
 */
import './test-env-guard.js'; // FIRST import: hermetic env before dotenv (see test-env-guard.js)
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.DEFAULT_TENANT_ID = ''; // hermetic
process.env.MONGODB_URI = ''; // hermetic
process.env.OTP_PROVIDER = 'memory';
process.env.OBS_WORKER_ALIVE_AFTER_SEC = '10';

let mongod;
let server;
let base;
let passed = 0;
function ok(name) { passed += 1; console.log(`  PASS  ${name}`); }

/** Parse a rendered exposition body into { name{labels} : value } (test-side client). */
function parseExposition(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+?)(\{[^}]*\})?\s+(-?[0-9.e+-]+)\s*$/);
    assert.ok(m, `unparseable metric line: ${line}`);
    out.set(m[1] + (m[2] || ''), Number(m[3]));
  }
  return out;
}

async function main() {
  // ---- 1. registry unit correctness (no DB needed) ----
  const { createRegistry, escapeLabelValue } = await import('../src/observability/metrics.js');
  const r = createRegistry('t');
  const c = r.counter('hits', 'Total hits.', ['method', 'route']);
  c.inc({ method: 'GET', route: '/a' });
  c.inc({ method: 'GET', route: '/a' });
  c.inc({ method: 'POST', route: '/b' });
  const g = r.gauge('temp', 'Temperature.', ['unit']);
  g.set({ unit: 'c' }, 21.5);
  g.set({ unit: 'c' }, NaN); // non-finite must be dropped
  const h = r.histogram('lat', 'Latency.', ['route'], [1, 10]);
  h.observe({ route: '/a' }, 0.5);
  h.observe({ route: '/a' }, 5);
  h.observe({ route: '/a' }, 50);
  const esc = r.gauge('esc', 'Escaping.', ['v']);
  esc.set({ v: 'a"b\\c\nd' }, 1);

  const body = r.render();
  assert.ok(body.includes('# TYPE t_hits counter'), 'counter TYPE');
  assert.ok(body.includes('# TYPE t_temp gauge'), 'gauge TYPE');
  assert.ok(body.includes('# TYPE t_lat histogram'), 'histogram TYPE');
  assert.ok(body.includes('t_hits{method="GET",route="/a"} 2'), 'labels sorted (method before route)');
  assert.ok(body.includes('t_temp{unit="c"} 21.5'), 'gauge value');
  assert.ok(!body.includes('NaN'), 'NaN dropped');
  assert.ok(body.includes('t_lat_bucket{le="1",route="/a"} 1'), 'bucket le=1');
  assert.ok(body.includes('t_lat_bucket{le="+Inf",route="/a"} 3'), '+Inf bucket = total');
  assert.ok(body.includes('t_lat_bucket{le="10",route="/a"} 2'), 'bucket le=10 monotonic');
  assert.ok(body.includes('t_lat_sum{route="/a"} 55.5'), 'histogram sum');
  assert.ok(body.includes('t_lat_count{route="/a"} 3'), 'histogram count');
  assert.ok(body.includes('t_esc{v="a\\"b\\\\c\\nd"} 1'), 'label escaping');
  assert.equal(escapeLabelValue('x"y'), 'x\\"y');
  ok('registry: counters/gauges/histograms, sorting, escaping, monotonic buckets');

  // ---- app boot (before DB connect, to test /readyz gating) ----
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // ---- 2. liveness + readiness ----
  let res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  let j = await res.json();
  assert.equal(j.status, 'ok');
  res = await fetch(`${base}/readyz`);
  assert.equal(res.status, 503, 'not ready before DB connect');
  j = await res.json();
  assert.equal(j.checks.db, false);

  // connect DB now
  const config = (await import('../src/config/index.js')).default;
  mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] } });
  config.mongoUri = mongod.getUri('flower_market_obs_smoke');
  await mongoose.connect(config.mongoUri, { autoIndex: false });
  const MODEL_FILES = (await import('../src/config/models.js')).default;
  for (const f of MODEL_FILES) {
    await (await import(`../src/models/${f}`)).default.init();
  }

  res = await fetch(`${base}/readyz`);
  assert.equal(res.status, 200, 'ready after DB connect');
  assert.equal((await res.json()).checks.db, true);
  ok('healthz liveness (DB-free) + readyz gating (503 → 200)');

  // ---- 3. outbox gauges + DLQ + oldest-pending age ----
  const { default: catalogEventService } = await import('../src/services/catalogEvent.service.js');
  const { default: CatalogEvent } = await import('../src/models/catalogEvent.model.js');
  const ENTITY = '64b0000000000000000000aa';
  await catalogEventService.publish({ eventType: 'price_changed', entityType: 'listing', entityId: ENTITY });
  await catalogEventService.publish({ eventType: 'price_changed', entityType: 'listing', entityId: ENTITY, delayMs: 600_000 }); // not due
  await CatalogEvent.create({ eventType: 'price_changed', entityType: 'listing', entityId: ENTITY, status: 'failed', attempts: 5, lastError: 'test dlq' });

  res = await fetch(`${base}/metrics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  let text = await res.text();
  let m = parseExposition(text);
  assert.equal(m.get('fm_db_connected'), 1);
  assert.equal(m.get('fm_outbox_events{status="pending"}'), 2, '2 pending (1 due + 1 delayed)');
  assert.equal(m.get('fm_outbox_dlq_depth'), 1, 'DLQ depth');
  assert.ok(m.get('fm_outbox_oldest_pending_age_seconds') >= 0, 'oldest pending age present');
  assert.ok(m.get('fm_process_uptime_seconds') > 0);
  assert.ok(text.includes('# TYPE fm_outbox_events gauge'));
  ok('metrics: outbox gauges, DLQ depth, oldest-pending age, content-type');

  // ---- 4. worker heartbeat → alive flag ----
  const { default: SystemHeartbeat } = await import('../src/models/systemHeartbeat.model.js');
  const { default: heartbeatService } = await import('../src/services/heartbeat.service.js');
  await heartbeatService.beat('worker', 'test-worker', { ticks: 3 });
  res = await fetch(`${base}/metrics`);
  text = await res.text();
  m = parseExposition(text);
  assert.equal(m.get('fm_worker_alive'), 1, 'fresh beat → alive');
  assert.ok(m.get('fm_worker_last_heartbeat_age_seconds') < 10, 'age small for fresh beat');

  await SystemHeartbeat.updateOne({ role: 'worker' }, { $set: { lastBeatAt: new Date(Date.now() - 120_000) } });
  res = await fetch(`${base}/metrics`);
  m = parseExposition(await res.text());
  assert.equal(m.get('fm_worker_alive'), 0, 'stale beat → not alive');
  assert.ok(m.get('fm_worker_last_heartbeat_age_seconds') > 100, 'age reflects staleness');
  ok('worker heartbeat: alive flag flips with beat age');

  // ---- 5. scheduled-job gauges ----
  const { seedJobs } = await import('../src/workers/scheduler.js');
  await seedJobs([
    { name: 'test-job', schedule: 'test', hour: 2, minute: 0, async run() { return {}; } },
  ]);
  res = await fetch(`${base}/metrics`);
  m = parseExposition(await res.text());
  const nextIn = m.get('fm_scheduled_job_next_run_in_seconds{job="test-job"}');
  assert.ok(nextIn !== undefined && nextIn > 0, 'job next-run countdown present');
  assert.equal(m.get('fm_scheduled_job_last_status{job="test-job"}'), -1, 'never ran → -1');
  ok('scheduled-job gauges (next-run + last status)');

  // ---- 6. HTTP request metrics (bounded route labels) ----
  // tenantContext gates /api/v1/* behind an active tenant — seed one
  const { default: Tenant } = await import('../src/models/tenant.model.js');
  const tenant = await Tenant.create({ name: 'Obs T', slug: 'obs-t', status: 'active' });
  const apiRes = await fetch(`${base}/api/v1/health`, { headers: { 'x-tenant-id': tenant.id } });
  assert.equal(apiRes.status, 200, 'tenant-scoped health 200');
  res = await fetch(`${base}/metrics`);
  text = await res.text();
  m = parseExposition(text);
  const apiHealth = m.get('fm_http_requests_total{method="GET",route="/api/v1/health",status="200"}');
  assert.ok(apiHealth >= 1, 'request counted with route-pattern label');
  assert.ok(text.includes('fm_http_request_duration_seconds_bucket{le="0.005",method="GET",route="/api/v1/health"'), 'duration histogram present');
  assert.ok(!text.includes('route="/metrics"'), 'ops endpoints excluded from request metrics');
  ok('HTTP request metrics: bounded route labels + duration histogram');

  // ---- 7. whole-body format validity (every line parseable) ----
  parseExposition(text); // throws on any malformed line
  ok('full /metrics body is valid exposition format');

  console.log(`\n=== OBSERVABILITY SMOKE: ${passed}/7 sections passed ===`);
}

main()
  .then(async () => {
    if (server) server.close();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nFAILED:', err);
    try { if (server) server.close(); } catch { /* noop */ }
    try { await mongoose.disconnect(); } catch { /* noop */ }
    if (mongod) await mongod.stop().catch(() => {});
    process.exit(1);
  });
