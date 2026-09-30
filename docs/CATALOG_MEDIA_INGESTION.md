# Governed Catalog Media Ingestion

## Security boundary

Catalog uploads are never trusted because a browser supplied a filename or MIME type. The production flow is:

1. Validate purpose, declared extension, MIME type, byte size, tenant quota and actor role.
2. Issue a short-lived, tenant-namespaced upload target.
3. Keep the S3 origin object private with `no-store` caching while unverified.
4. Confirm object existence, exact byte length and object-store MIME metadata.
5. Create a durable processing job and report `processing` to the client.
6. Read no more than the purpose-specific byte limit.
7. Verify file signatures independently of filename and headers.
8. Decode images under a 40-megapixel limit to resist decompression bombs.
9. Extract authoritative dimensions, aspect ratio and SHA-256 evidence.
10. Create immutable AVIF and WebP derivatives.
11. Publish the original only after inspection succeeds.
12. Mark the registry asset `ready`; only ready tenant-owned assets can be attached through governed catalog APIs.

The platform does not server-fetch arbitrary remote URLs. This intentionally removes SSRF, redirect, DNS-rebinding and unbounded-download risk from the upload path. Curated legacy remote media remains identifiable through provenance gaps and should be replaced or accompanied by verified source/license evidence.

## Durable processing

`MediaProcessingJob` provides one idempotent job per asset, atomic fair claims, 60-second leases, five attempts, stale-lease recovery and 30-day terminal retention. API processes may kick a job for development latency; production workers use the same claim path. Crashes before the final registry update safely repeat deterministic derivative writes to immutable keys.

Image processing is deliberately sequential within one job to bound native Sharp memory and object-store pressure. Worker concurrency should be scaled horizontally rather than by creating unbounded transforms inside one process.

Renditions are generated at applicable widths from 320, 640, 960 and 1440 pixels in AVIF and WebP without enlargement. Each stores dimensions, bytes, immutable key, public URL and SHA-256 checksum. Storefront `picture` elements prefer AVIF, then WebP, then the inspected original.

## Duplicate evidence

SHA-256 is tenant-scoped and indexed. A matching ready asset records `duplicateOf`; data is not silently merged or deleted because two visually identical bytes may have different catalog ownership or retention requirements. Operators can review duplicates without losing audit evidence.

## Availability monitoring

The worker probes one least-recently-checked ready object per tick. A single failure is recorded but does not change storefront state. Two consecutive checks are required to mark an asset and every linked `ProductImage` as broken, avoiding transient object-store flicker. Broken active media is a quality blocker and appears in the Media remediation queue.

## Provenance

Registry and product-image records support:

- source type (`upload`, `official`, `wikimedia`, `licensed`, `legacy`);
- source URL;
- creator;
- license;
- attribution.

A governed upload receives cryptographic and processing provenance automatically. External legacy URLs without a recognized verified source are reported as provenance warnings and reduce media quality.

## Lifecycle safety

- A media asset cannot be deleted while linked to an active product image.
- Retire the catalog image first, then delete the registry asset.
- Deletion removes original and derivative objects best-effort and terminates outstanding processing.
- Product-image attachment ignores client-supplied dimensions, MIME, checksum, renditions and URL whenever `mediaAssetId` is supplied; authoritative registry evidence wins.
- Tenant ownership is checked during attachment.

## Deployment

1. Deploy Sharp-compatible backend images and migration `011_media_ingestion_pipeline.js`.
2. In production use `STORAGE_PROVIDER=s3`; the existing production-provider guard rejects local pod storage.
3. Confirm S3 CORS permits the signed PUT and that the worker role can Get, Put, Copy, Head and Delete only the configured bucket/prefix.
4. Deploy API and workers from the same release.
5. Upload a test PNG and verify `processing → ready`, dimensions, checksum and renditions.
6. Verify uninspected S3 objects are private and ready objects/derivatives have immutable cache headers.
7. Confirm responsive PDP requests choose AVIF/WebP and no original is enlarged.
8. Alert before broad rollout, then replace ungoverned media in blocker-first order.

## Metrics and alerts

- `fm_media_processing_jobs{status}`
- `fm_media_processing_oldest_queued_age_seconds`
- `fm_catalog_broken_media_assets`
- existing bounded HTTP and worker heartbeat metrics

Page when queue age exceeds five minutes, failed jobs are non-zero for 15 minutes, worker heartbeat is stale with queued work, or broken governed media is detected. Track derivative storage growth and object-store 4xx/5xx outside high-cardinality application labels.

## Incident response

- **Signature mismatch:** never override; inspect uploader activity and delete the quarantined object.
- **Decode/pixel-limit failure:** request a safely exported replacement.
- **Repeated job failure:** inspect the durable job error, object permissions and Sharp resource limits; retry by reconfirming only after remediation.
- **Broken health status:** verify object existence/CDN origin, restore or attach replacement, then allow probes to recover status.
- **Duplicate:** confirm intended ownership before retiring either asset.
- **Rendition inconsistency:** do not edit URLs in place; reprocess to immutable keys and update through the governed attachment workflow.
