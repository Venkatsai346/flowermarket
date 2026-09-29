# Catalog media operations

## Operating model

Catalog media is global canonical content. A media change affects every tenant that lists the product, so direct operations are restricted to `super_admin`. Tenant administrators continue to propose global image changes through catalog change requests.

The Media workspace is an evidence-driven queue, not a generic file browser. It evaluates each non-deleted product family for:

- At least one factual product image.
- Exactly one primary image in the master gallery when a master gallery exists.
- Useful alternative text of at least five characters.
- Recorded pixel dimensions and an 800 × 800 minimum launch standard.
- Visual coverage for active variants. A master-level image is the governed fallback; without one, each active variant requires scoped media.
- Deterministic gallery ordering and explicit roles.

The calculated media score prioritizes remediation; blockers remain explicit and are never hidden by a high score.

## APIs

All routes require `super_admin`:

- `GET /api/v1/catalog/admin/media/summary`
- `GET /api/v1/catalog/admin/media/families`
- `PATCH /api/v1/catalog/admin/masters/:id/images/:imageId/metadata`
- `PUT /api/v1/catalog/admin/masters/:id/images/order`

The family queue supports bounded `search`, `issue`, `sort`, `page`, and `limit` parameters. Issue values are `no_media`, `no_primary`, `primary_conflict`, `missing_alt`, `dimensions`, `variant_coverage`, and `healthy`.

Metadata and ordering writes require the product master's `expectedVersion`. A stale operator receives `409 VERSION_CONFLICT`, must reload, inspect the other change, and retry. Every successful operation writes an audit record and emits `product_master_updated` for search/read-model refresh.

## Asset ingestion workflow

1. Upload through the governed media upload pipeline. Do not attach arbitrary local paths or data URLs.
2. Confirm the asset shows the exact product and, when scoped, the exact variant.
3. Enter concise visual alternative text; do not repeat SEO keywords.
4. Scope to the master gallery when it is a truthful family fallback, otherwise select the variant.
5. Mark primary only when the asset is the best default customer representation. The first asset in an empty scope is promoted automatically.
6. Record MIME type, byte size, width, height, and focal point. Metadata may be repaired later in the Media workspace.
7. Verify the catalog event outbox drains and storefront projections refresh.

Do not overwrite an existing asset URL to replace imagery. Attach the replacement, verify it, promote it to primary, and then retire the old row. This keeps audit evidence and avoids transient broken galleries. If a primary is retired, the lowest-order surviving asset in that same master/variant scope is promoted deterministically so the gallery never becomes accidentally primary-less.

## Production rollout

1. Run migration `008_catalog_media_operations.js` through the normal migration runner.
2. Verify `media_operations_gallery_idx` and `media_operations_quality_scan_idx` exist.
3. Open Catalog Ops → Media as a super administrator and compare family/asset totals with Mongo counts.
4. Validate samples from every issue queue, especially master fallback and variant-scoped galleries.
5. Perform one metadata repair and confirm the master version increments, an audit row appears, and a catalog event is published.
6. Upload one test image through the governed upload flow and verify it appears on the storefront after event processing.
7. Roll out remediation in blocker-first batches. Avoid mass deletion.

## Scaling and safety

The queue uses indexed `$lookup` pipelines, bounded pages, projected results, deterministic sorting, and `allowDiskUse` for operational resilience. Search is limited to 120 characters and page size to 100. The summary is global and should be cached at the edge only if invalidated on every media/master mutation.

For catalogs above several hundred thousand families, move the same deterministic evidence rules into a durable global media projection refreshed by catalog events. Do not increase API timeouts or return unbounded asset arrays as a substitute.

Operational metrics use bounded labels only:

- `fm_catalog_media_read_duration_seconds{operation="summary|families",outcome="ok|error"}`
- `fm_catalog_media_mutations_total{operation="add|metadata|primary|reorder|retire"}`

Alert when p95 queue reads exceed five seconds for 15 minutes or read errors exceed 1%. Mutation errors remain visible through the standard route-level HTTP metrics and structured application errors. Never use master IDs, image IDs, URLs, search text, or actor IDs as metric labels.

## Incident response

- **409 conflicts:** reload; never blind-retry with a newer version.
- **Broken image URL:** attach a replacement and promote it before retiring the broken asset.
- **Multiple primaries:** choose the truthful default. Primary scope is independent for master and each variant gallery.
- **Variant mismatch:** verify `variantId` belongs to the path's master; the API rejects cross-master attachment.
- **Queue/search drift:** inspect the catalog outbox and reindex workflow.
- **Cross-catalog impact:** disable admin media mutation routes, preserve audit/event rows, and investigate actor and request metadata.
