# Durable catalog bulk operations

## Purpose

Price and stock CSV imports are operational writes, not request-sized convenience calls. They must survive API restarts, worker restarts, rolling deployments, and multi-instance routing while preserving tenant isolation and deterministic CSV order.

The durable subsystem replaces the former process-local one-hour cache with:

- `catalogbulkjobs`: tenant-scoped job state, counters, lease, checkpoint, bounded error summary, and retention.
- `catalogbulkjobrows`: allowlisted row payloads, row-level status, attempts, errors, and reclaimable leases.
- Atomic, fair claims shared by API development runners and production workers; unstarted jobs run first, then the least-recently advanced job.
- Bounded 25-row worker batches so one tenant's import cannot starve other imports, the catalog outbox, heartbeat, or scheduler.
- At-least-once recovery with idempotent target-state operations: price sets an explicit price and stock sets an absolute quantity.
- Thirty-day TTL retention for completed job and row evidence.

## API

All routes retain the tenant catalog RBAC boundary and enforce `req.tenantId` on every job read or mutation.

- `POST /api/v1/catalog/tenant/bulk/:kind?dryRun=true|false`
- `GET /api/v1/catalog/tenant/bulk/jobs`
- `GET /api/v1/catalog/tenant/bulk/jobs/:jobId`
- `GET /api/v1/catalog/tenant/bulk/jobs/:jobId/failures`
- `POST /api/v1/catalog/tenant/bulk/jobs/:jobId/cancel`
- `POST /api/v1/catalog/tenant/bulk/jobs/:jobId/retry-failures`

`kind` is `price` or `stock`. Uploads are capped at 5,000 rows and 5 MB. Only documented columns are persisted; values are trimmed and individually capped at 240 characters. Unknown columns are discarded.

Cancellation is cooperative. Queued jobs cancel immediately. Running jobs enter `cancel_requested` and stop after the current bounded batch. A crashed worker's expired cancellation lease is finalized by the next worker tick.

Retry resets only failed rows for a completed job. For a terminal worker-failure job, it also re-queues unfinished pending/running rows. Successful rows remain checkpointed and are never replayed by the retry action.

## State machine

```text
queued -> running -> completed
   |         |
   |         +-> cancel_requested -> cancelled
   +-----------------------------> cancelled
running -- expired lease --> running (reclaimed, attempt +1)
completed/failed + failed rows -> queued (failed rows only)
running + exhausted lease attempts -> failed
```

A normal cooperative batch handoff clears crash-attempt debt. Five expired ownership leases terminate the job as failed and preserve evidence for investigation.

## Correctness details

- CSV rows execute in ascending source row number. Duplicate rows targeting the same listing therefore have deterministic last-row-wins behavior.
- `listingId` is queried as `_id` together with `tenantId`; it can no longer resolve an arbitrary listing from the tenant.
- SKU and master targeting deterministically prefers the master-level listing, then the oldest variant listing.
- Stock processing consumes the resolver's `{ listing, masterId }` contract correctly.
- Dry runs traverse the same resolution and validation path but perform no commerce mutation.
- Job counters and row outcomes are persisted after each row. Error summaries on the job are bounded to 100; the failures endpoint pages the authoritative row evidence.
- Worker/API ownership uses a 60-second renewable lease. No in-memory registry is authoritative.

## Production rollout

1. Deploy the models and worker code.
2. Run migration `009_durable_catalog_bulk_jobs.js`.
3. Verify unique row, pending-row, claim, tenant-history, and TTL indexes.
4. Confirm the worker heartbeat includes `bulkJobsAdvanced`.
5. Submit a dry-run CSV and verify job/row documents, progress, and zero catalog writes.
6. Submit a small write job and verify price history or absolute inventory state.
7. Kill a worker during a job; after lease expiry, verify another worker reclaims it.
8. Attempt cross-tenant job reads and mutations; expect `404 JOB_NOT_FOUND`.
9. Test cancellation and failed-row retry before broad rollout.

The API process performs a safe asynchronous kick for development and low-volume deployments. Production must run the worker continuously; API and worker claims are mutually safe.

## Observability and SLOs

Metrics:

- `fm_catalog_bulk_jobs{status}`
- `fm_catalog_bulk_oldest_queued_age_seconds`
- Existing `fm_worker_alive` and HTTP request/error metrics

Suggested initial alerts:

- Oldest queued age above 120 seconds for 10 minutes.
- A running job with an expired lease.
- Any terminal `failed` job.
- Worker heartbeat stale while queued jobs exist.
- Row failure ratio over 5% for a non-dry-run job.

Never use tenant IDs, job IDs, listing IDs, SKU values, CSV text, or error messages as metric labels.

## Incident response

1. Inspect worker heartbeat and queued-age metrics.
2. Verify claim and pending-row indexes.
3. Inspect the job's bounded summary and paged failure evidence.
4. Do not edit counters manually; repair row state and recalculate only through an audited maintenance script.
5. For malformed source data, correct the CSV or source entities, then use **Retry failed rows**.
6. For systemic mutation errors, stop workers, preserve job/row documents, repair the service, then allow lease reclamation.
7. Never bypass tenant filters when supporting a merchant.
