# Catalog Quality Operations

## Purpose

Catalog quality is a durable control plane, not a cosmetic completion percentage. It separates:

- **Technical publishability**: no blocker-class issue prevents a safe storefront offer.
- **Launch readiness**: no blockers and a weighted score of at least 85.

The evaluator is read-only with respect to source catalog data. It writes explainable tenant-scoped projections and never silently repairs products, listings, inventory, media, taxonomy, or search documents.

## Durable execution

`POST /catalog/tenant/quality/evaluate` creates (or returns) the tenant's single active `CatalogQualityRun` and returns `202`. API and worker processes use the same atomic Mongo claim path. A worker advances at most 100 product families per claim and then cooperatively releases the run, allowing fair scheduling across tenants.

Runs use:

- a source cutoff so listings created after the run starts are evaluated on the next run;
- an ascending product-master cursor;
- 60-second leases and stale-lease reclamation;
- five crash attempts before terminal failure;
- a unique partial index enforcing one active run per tenant;
- 90-day TTL retention for terminal run history;
- tenant-scoped reads, cancellation, and retry.

Successful batches are idempotent projection upserts. The cursor only advances after the complete batch is persisted. A crash during a bulk upsert may repeat some projection writes, but the final state is deterministic and has no source-catalog side effects. Obsolete assessments are removed only after a fully completed run, so cancellation and failure never erase the last usable projection.

## State machine

`queued → running → queued` repeats once per bounded batch.

Terminal transitions:

- `queued → cancelled`
- `running → cancel_requested → cancelled`
- `running → completed`
- repeated expired leases: `running → failed`
- after remediation: `failed → queued`

Cancellation is cooperative. A running batch finishes its bounded database work before its expired lease is finalized as cancelled.

## Evidence model

Each assessment contains:

- weighted dimension evidence for identity, taxonomy/specifications, variants, media, content/SEO, commerce readiness, inventory integrity, compliance evidence, and search freshness;
- separate `publishable` and `launchReady` decisions;
- blocker, warning, and informational findings;
- accountable owner and field location;
- explicit remediation instructions;
- deterministic issue fingerprint;
- `firstDetectedAt` and `lastDetectedAt` lifecycle timestamps;
- deterministic source fingerprint and evaluator version;
- the quality-run ID that produced the projection.

Issue first-detection timestamps survive reevaluation while the deterministic fingerprint remains present. Fingerprints include evaluator version to make rule changes explicit.

## API

- `POST /catalog/tenant/quality/evaluate`
- `GET /catalog/tenant/quality/summary`
- `GET /catalog/tenant/quality/runs`
- `GET /catalog/tenant/quality/runs/:runId`
- `POST /catalog/tenant/quality/runs/:runId/cancel`
- `POST /catalog/tenant/quality/runs/:runId/retry`
- `GET /catalog/tenant/quality/assessments`
- `GET /catalog/tenant/quality/assessments/:masterId`

All endpoints require tenant admin or super-admin authorization and derive tenant identity from authenticated middleware, never request payloads.

## Observability and SLOs

Metrics:

- `fm_catalog_quality_runs{status}`
- `fm_catalog_quality_oldest_queued_age_seconds`
- `fm_catalog_quality_evaluation_duration_seconds{outcome}`
- `fm_catalog_quality_evaluations_total{outcome}`
- `fm_catalog_quality_families_evaluated`

Recommended objectives:

- oldest queued age under 120 seconds;
- no active run without a worker heartbeat;
- failed runs below 1% of initiated runs;
- nightly or event-driven refresh keeps stale assessments below 5%;
- p95 bounded-batch duration under 10 seconds.

Alert when queued age exceeds five minutes, any failed run remains untriaged for 30 minutes, or worker heartbeat is stale while quality work is active.

## Rollout

1. Deploy migration `010_durable_catalog_quality_runs.js` before enabling the UI action.
2. Deploy API and worker from the same release so evaluator versions match.
3. Confirm one worker heartbeat and quality queue gauges.
4. Start with one representative tenant and verify completed run counts, blocker distributions, and assessment provenance.
5. Expand tenant-by-tenant; do not run ad-hoc database cleanup while a run is active.

Rollback is safe at the application layer: stop creating runs and stop worker claims. Existing assessments remain readable. Do not drop run/provenance indexes until all older application replicas are retired.

## Incident response

1. Inspect run status, heartbeat, cursor, attempts, and the latest bounded error.
2. Confirm worker health and Mongo latency.
3. If a source document violates evaluator assumptions, repair it through governed catalog workflows.
4. Retry only the failed run; its cursor and completed projections are retained.
5. Cancel only when the run should stop. Start a fresh full run after cancellation if a coherent current projection is required.
6. Never mark a run completed manually: completion performs safe obsolete-projection reconciliation.
