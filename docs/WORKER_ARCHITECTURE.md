# The Worker Runtime — the async-execution layer

**Status: implemented + verified (2026-09-06).** See `docs/E2E_TEST_RESULTS.md`
for the full result matrix.

## The architectural gap this closes

The system already had the *plumbing* for async work — a durable catalog
outbox, delayed events, an idempotent nightly maintenance pipeline — but **no
execution engine**:

| What existed | What was missing |
|---|---|
| `CatalogEvent` outbox rows (durable, indexed, TTL-purged) | Nothing *consumed* them except a manual UI button / manual POST |
| `availableAt` (delayed publish), `attempts`, `lastError` | No backoff, no retry of `failed` rows (doc copy claimed retry; code never did it) |
| `maintenanceService.nightly` + `marketplaceNightly` (idempotent, step-isolated) | Only ran from an *external* cron ("suggested cron" comment) or a manual endpoint — not in the repo, not scheduled anywhere |
| Two registered outbox handlers: **search indexer**, **notification fan-out** | Search index + notifications only refreshed when a human clicked "Drain pending" |
| Zero timers in `src/` | No scheduler for the nightly pipeline (billing cycles, rollups, exports, forecasts) |

Concretely, in production: a price change sat in the outbox until someone
clicked drain; the ranked search index went stale (the very class of bug the
`stale_fallback` was a patch *around*); notifications queued; **payout billing
cycles and platform rollups never ran**.

And two latent correctness defects in consumption itself:

1. **No lease on `publishing`.** A process that died between
   `status='publishing'` and completion left the row stuck *forever* —
   processing lost, visible as a permanent `PUBLISHING` counter.
2. **`failed` was never retried.** `drain()` only queried `pending`.
   Dead-lettering existed, but with no backoff, no attempt cap, no re-queue
   affordance.

## The move

**A worker runtime: a second process from the same codebase that owns all
async execution.** Zero new infrastructure — same Mongo, same services; one
new entrypoint, one small model, lease fields on the outbox row.

```
                ┌──────────────────────────── Mongo (shared) ───────────────────────────┐
                │ catalogevents · searchdocuments · notifications · scheduledjobs · …   │
                └──────▲──────────────────────────────────────▲────────────────────────┘
                       │ reads (search, API)                  │ writes (handlers)
        ┌──────────────┴───────────┐            ┌─────────────┴────────────┐
        │  API process  (server.js)│            │  WORKER  (src/worker.js) │
        │  :4000, request-path     │            │  every WORKER_POLL_MS:   │
        │  manual drain button ─────┼──(atomic  │   1. reapExpired leases  │
        │  manual nightly POSTs     │   claims) │   2. drain outbox (N)    │
        └───────────────────────────┼───────────┤   3. scheduler tick      │
                                    │ safe co-existence (same claim path)  │
                                    └──────────────────────────────────────┘
```

### Invariants (each covered by `scripts/smoke-worker.test.js`)

1. **Atomic claim.** `pending → publishing` via `findOneAndUpdate` guarded on
   `{_id, status:'pending', availableAt ≤ now}`, setting
   `claimedBy/claimedAt/leaseExpiresAt`. N workers race safely; each event is
   handled exactly once per delivery.
2. **Lease + reaper.** A crash mid-handler leaves `publishing` rows — but
   `reapExpired()` (run every tick, by any worker) returns rows past
   `leaseExpiresAt` to `pending`. Nothing can be stuck in `publishing`
   forever.
3. **Backoff, then dead-letter.** Handler failure ⇒ `attempts++` and the row
   re-queues as `pending` with `availableAt = now + backoff(attempts)`
   (30s / 2m / 10m / 30m). After `WORKER_MAX_ATTEMPTS` (5) ⇒ terminal
   `failed` (DLQ): payload + `lastError` retained, re-queueable on purpose.
4. **Manual re-queue.** `POST /catalog/admin/events/retry-failed`
   resets the DLQ budget and re-queues (`requeued` count returned).
5. **At-least-once, idempotent handlers.** A lease that expires while a
   handler is still running can be re-claimed — handlers must be idempotent
   (search reindex is an upsert; the notifier dedupes). Documented on the
   service + the handler-registration API.
6. **Single-flight scheduler.** Built-in jobs are *code-defined,
   state-persisted* (`ScheduledJob` rows). A run is claimed by atomically
   advancing `nextRunAt` with the expected current value — only the winner
   executes, across N workers and restarts.

### Built-in scheduled jobs

| Job | Cadence | Runs |
|---|---|---|
| `tenant-nightly` | daily @ `WORKER_NIGHTLY_HOUR` (default 02:00) | `maintenanceService.nightly` for **every active tenant** (forecast, analytics rollups, export jobs + runs, notifications, event drain) |
| `marketplace-nightly` | daily @ hour+5 | `maintenanceService.marketplaceNightly` (billing cycle per period, rollovers, overdue sweep, platform rollups, shared drain) |
| `payment-reconcile` | every `PAYMENT_RECONCILE_EVERY_MS` (5 min) — first **interval** job (scheduler gained `everyMs` support for it) | `paymentService.reconcilePending` + `refundService.reconcileRefunds`: stale PENDING payments/refunds are resolved **against the gateway** (source of truth) — lost webhooks are recovered, unattested captures are failed + compensated. See `docs/PAYMENTS_ARCHITECTURE.md` |

Both were previously "cron if you set one up"; now they run, are
single-flight, and their `lastRunAt/lastStatus/lastResult` are inspectable in
the `scheduledjobs` collection.

## How to run

```bash
# API (unchanged)
node src/server.js
# Worker (new) — same .env, safe to run N of them
node src/worker.js
```

Env (all optional): `WORKER_ENABLED` (default on), `WORKER_POLL_MS` (5000),
`WORKER_BATCH_SIZE` (20), `WORKER_LEASE_MS` (60000), `WORKER_MAX_ATTEMPTS` (5),
`WORKER_NIGHTLY_HOUR` (2).

The API's manual **Drain pending** button and the manual nightly endpoints
remain — they share the same atomic-claim path, so manual + worker coexist
without double-processing (proven: admin UI suite A08 passes with the worker
running).

## Verified live (not just unit-tested)

- **Auto-drain:** price patch → outbox `published 79→80` within one poll, no UI.
- **Search follows price:** search showed 199 → patch 202 → auto-drain →
  search **202** → restore → search **199** (index maintained by the worker
  process, served by the API process — shared via Mongo, no in-memory
  coupling).
- **Crash recovery:** orphaned `publishing` row with expired lease → live
  worker reclaimed + consumed it; `publishing` back to 0.
- **Observability live:** `/healthz` 200, `/readyz` 200 (503 pre-DB, proven
  in the hermetic suite), `/metrics` showing worker heartbeat age ≈ 5s with
  `fm_worker_alive 1`; outbox lag metric caught a real pending event
  (age 0.015s) before the worker drained it; request counter advanced 0→3
  for exactly 3 requests; scrapes absent from the access log; graceful
  SIGTERM verified on both processes (clean log → DB disconnect → exit 0).
- **Regression:** live E2E 67/67, admin UI 36/36, storefront UI 27/27, all 14
  DB suites (worker 6/6 + observability 7/7) — worker running throughout.

## Files

| File | Role |
|---|---|
| `src/worker.js` | worker entrypoint: boot, model index init, handler registration, tick loop, graceful shutdown |
| `src/workers/scheduler.js` | built-in job registry, `seedJobs()`, `tick()` (single-flight claim) |
| `src/models/scheduledJob.model.js` | persisted schedule state (nextRunAt, lastRun*) |
| `src/models/catalogEvent.model.js` | + `claimedBy/claimedAt/leaseExpiresAt` + reaper index |
| `src/services/catalogEvent.service.js` | leased atomic claims, backoff, DLQ, `reapExpired()`, `retryFailed()` |
| `src/routes/catalog.admin.routes.js` | + `POST /events/retry-failed` |
| `src/config/models.js` | single source of truth for the model list (worker + nightly-job) |
| `scripts/smoke-worker.test.js` | hermetic suite: atomicity, reaper, retry/DLQ, single-flight |

## Observability — implemented (2026-09-06)

The async layer is operable, not just present. Three endpoints, mounted at
the app root (no auth/tenant header, kept out of the access log), plus
process heartbeats in Mongo.

### Endpoints

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /healthz` | **Liveness** — process up, event loop responsive | Deliberately DB-free: a Mongo outage must not look like a dead process (restarts wouldn't help) |
| `GET /readyz` | **Readiness** — may this instance take traffic? | 200 only when Mongo is connected; 503 `{"checks":{"db":false}}` otherwise — this is what a LB/orchestrator gates on |
| `GET /metrics` | Prometheus text exposition (0.0.4) | Dynamic gauges recomputed **per scrape** — no background-update drift |

### The metric set (all `fm_*`)

| Family | Type | Why it matters |
|---|---|---|
| `fm_outbox_events{status}` | gauge | queue shape at a glance |
| `fm_outbox_oldest_pending_age_seconds` | gauge | **the lag metric** — how long a due event has waited |
| `fm_outbox_dlq_depth` | gauge | terminal-failed events awaiting `POST /events/retry-failed` |
| `fm_worker_last_heartbeat_age_seconds` | gauge | consumer liveness: the worker beats every tick (5s) into `systemheartbeats`; age is the truth |
| `fm_worker_alive` | gauge | `age ≤ OBS_WORKER_ALIVE_AFTER_SEC` (default 30s = 6 missed ticks) |
| `fm_scheduled_job_next_run_in_seconds{job}` | gauge | negative = overdue |
| `fm_scheduled_job_last_status{job}` | gauge | 1 ok / 0 error / −1 never |
| `fm_http_requests_total{method,route,status}` | counter | route = **matched pattern** (`/api/v1/orders/:id`) — bounded cardinality |
| `fm_http_request_duration_seconds{method,route}` | histogram | 11 buckets, 5ms→10s |
| `fm_db_connected` | gauge | 0/1 |
| `fm_process_{uptime_seconds,memory_heap_bytes,memory_rss_bytes}` | gauge | |
| `fm_process_event_loop_lag_seconds{stat=mean\|max}` | gauge | since previous scrape — event-loop saturation signal |

Implementation: `src/observability/metrics.js` (dependency-free registry —
counters/gauges/histograms, canonical label sorting, spec-compliant escaping,
monotonic buckets), `src/observability/registry.js` (definitions + per-scrape
`collectDynamic()`), `src/middleware/metrics.js`, `src/routes/ops.routes.js`,
`SystemHeartbeat` model (one doc per role; a dead beat **is** the down-signal).

Suggested alert rules:

```promql
fm_outbox_oldest_pending_age_seconds > 300          # outbox lag > 5min
fm_outbox_dlq_depth > 0                             # anything dead-lettered
fm_worker_alive == 0                                # consumer down > 30s
fm_scheduled_job_next_run_in_seconds < -86400       # job > 1 day overdue
fm_db_connected == 0                                # Mongo down
histogram_quantile(0.95, rate(fm_http_request_duration_seconds_bucket[5m])) by (route) > 0.5
```

## What this unlocks (next moves, in order)

1. ~~**Real payment provider.**~~ **DONE (2026-09-06)** — the payment layer
   is implemented: provider abstraction (mock + Razorpay), HMAC-verified
   webhook pipeline with event-level idempotency + audit + amount
   verification, gateway-poll reconciliation, refund reconciliation, the
   scheduled `payment-reconcile` worker job, customer payment-status
   endpoint, and the `fm_webhook_*` / `fm_payment_pending_*` metrics. Full
   design + verification evidence: `docs/PAYMENTS_ARCHITECTURE.md`.
   Going live = set the `RAZORPAY_*` env vars — no code path changes.
2. ~~**CI.**~~ **DONE (2026-09-06)** — `.github/workflows/ci.yml`, four jobs:
   `backend` (pure suites + 16 hermetic suites on in-memory mongod 6.0.6),
   `frontend` (per-workspace unit tests + production builds), `live-e2e`
   (full stack on a `mongo:6.0.6` replica-set service: API + worker + 2× Vite
   → the 67-check suite), and `browser-ui` (same stack + real Chromium
   provisioned from `@sparticuz/chromium` → storefront 27 + admin 36 checks).
   Shared stack boot: `scripts/ci/boot-live-stack.sh` (idempotent: rs0 ensure
   → seed → API/worker/Vite → health gates → writes `/tmp/fm-ci/env.sh` with
   `FM_TENANT_ID`/`API_LOG_FILE` for the suites — the same script boots the
   identical stack on a dev machine). The e2e harnesses resolve tenant/log
   paths from env (`FM_TENANT_ID`, `API_LOG_FILE`, `CHROMIUM_BIN`,
   `BROWSER_LIBS_DIR`) so CI re-seeding a fresh tenant needs zero code edits.
3. **Scale-out readiness.** The worker is already multi-instance safe; the
   next scale step is horizontal worker replicas behind the same Mongo, then
   Redis caching for the hot catalog read path if NDCG@10 scale demands it.
   Kafka/Redis *publisher* can later consume the same outbox rows without
   schema changes — that was the outbox design goal, now actually load-bearing.
