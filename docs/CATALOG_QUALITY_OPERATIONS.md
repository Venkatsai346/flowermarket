# Catalog quality control plane

## Purpose

The quality projection is an explainable, tenant-scoped launch control plane. It does **not** mutate product, variant, image, listing, inventory, or search data. Operators remediate findings through the governed catalog workspaces and explicitly re-run evaluation.

Technical publishability and launch readiness are intentionally different:

- **Publishable** means the current assessment has no blocker.
- **Launch ready** means it has no blocker and scores at least 85/100.
- **Refresh due** means the persisted evidence is over 24 hours old. Treat it as stale until re-evaluated.

## Dimensions and evidence

The deterministic 100-point rubric covers canonical identity (15), taxonomy and required specifications (20), variants (15), governed media (20), content and SEO (10), tenant commerce/inventory readiness (15), and search projection freshness (5).

Each finding persists a stable code, severity, accountable domain owner, optional field path, explanation, and remediation instruction. A source fingerprint records the exact source versions/timestamps used by the evaluator. Assessments are tenant/master unique and never shared across tenants.

## API and authorization

All endpoints require an authenticated tenant `admin` or `super_admin`. Vendor access is deliberately excluded from tenant-wide sweeps and evidence.

- `POST /api/v1/catalog/tenant/quality/evaluate`
- `GET /api/v1/catalog/tenant/quality/summary`
- `GET /api/v1/catalog/tenant/quality/assessments`
- `GET /api/v1/catalog/tenant/quality/assessments/:masterId`

List queries support bounded `search`, `grade`, `readiness`, `issueCode`, `page`, and `limit` filters. The synchronous sweep rejects more than 50,000 tenant listings with `QUALITY_SWEEP_TOO_LARGE`; do not raise that guard. Large tenants require a resumable, queued evaluator with per-tenant concurrency control before rollout.

## Production rollout

1. Deploy code while keeping the UI evaluation action operationally restricted.
2. Run migration `007_catalog_quality_projection.js` using the normal migration runner.
3. Confirm the unique tenant/master index and the readiness, issue, and priority indexes exist.
4. Run one evaluation for a small internal tenant and verify summary totals against tenant listing families.
5. Inspect blocker samples and confirm no write timestamps changed on source catalog entities.
6. Roll out tenant by tenant, watching latency and error metrics.
7. Schedule evaluation only after a queued architecture exists; this release uses explicit operator-triggered evaluation.

Rollback can hide the UI/routes without deleting the projection. The collection is rebuildable. Preserve it during incident analysis because fingerprints and evaluated timestamps are useful evidence.

## Observability and SLO gates

Metrics use bounded labels only:

- `fm_catalog_quality_evaluation_duration_seconds{outcome="ok|bounded|error"}`
- `fm_catalog_quality_evaluations_total{outcome="ok|bounded|error"}`
- `fm_catalog_quality_families_evaluated`

Suggested initial gates:

- p95 sweep duration below 30 seconds for tenants under 10,000 listings.
- Error ratio below 1% over 30 minutes (exclude the explicit `bounded` outcome).
- No assessment older than 24 hours during an active launch window.
- Projection family count equals the count of distinct non-deleted listed masters.

Alert on sustained errors, unexpected bounded outcomes, or rapidly increasing stale assessments. Never include tenant IDs, master IDs, issue codes, or queries as metric labels.

## Incident checks

1. Verify Mongo health and projection indexes.
2. Compare tenant listing count with the 50,000 synchronous guard.
3. Inspect outbox/search health when `SEARCH_DOCUMENT_DRIFT` or `SEARCH_DOCUMENT_STALE` rises.
4. Confirm category required-attribute schemas are intentional before bulk remediation.
5. Re-evaluate after repairs and verify the fingerprint and evaluated timestamp change.
6. If evidence appears cross-tenant, disable quality routes immediately and preserve projection records for investigation.
