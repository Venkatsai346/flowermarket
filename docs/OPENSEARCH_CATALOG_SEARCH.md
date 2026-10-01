# Production catalog search with OpenSearch

## Architecture

OpenSearch is a retrieval engine, not the catalog source of truth. MongoDB remains authoritative and retains the `SearchDocument` projection as a durable fallback and typo vocabulary. When `SEARCH_PROVIDER=opensearch`:

1. Catalog outbox consumers build one denormalized document per tenant listing.
2. The document is idempotently upserted into MongoDB and OpenSearch using `{tenantId}:{listingId}` as its stable ID.
3. OpenSearch performs tenant-isolated fuzzy/prefix candidate retrieval, numeric and categorical filtering, and exact facet aggregation.
4. The existing pure ranking engine reranks the top bounded candidate set using availability, 30-day popularity, CTR, freshness, discount, vendor quality, margin, promotion, return-rate penalties, experiments, pins, and buries.
5. The authoritative master-first catalog read model hydrates the ranked master IDs and applies final visibility, family grouping, exact family totals, and cursor pagination.

An OpenSearch failure never makes hidden catalog rows visible. The public controller falls back to the authoritative Mongo catalog read and exposes fallback/index-state metadata.

## Index model

The provider creates immutable versioned indexes:

```text
flowermarket-catalog-YYYYMMDDHHMMSS-random
```

and manages three aliases:

- `flowermarket-catalog-read` — customer queries;
- `flowermarket-catalog-write` — incremental outbox updates;
- `flowermarket-catalog-rebuild` — temporary target during a full rebuild.

Full platform rebuilds create a fresh index, stream the catalog into it, and atomically move read/write aliases only after the final batch succeeds. While rebuilding, incremental updates and deletes are dual-written to the current index and rebuild target, preventing the alias cutover from losing concurrent changes. Failed or bounded/incomplete rebuilds are aborted and never become customer-visible.

Tenant-scoped repairs update the current write alias in place; they do not replace a shared multi-tenant index.

## Search behavior

- Multi-field fuzzy matching with title, brand, tag, variant and body boosts.
- Prefix analyzers for autocomplete and partial terms.
- Typo correction and tenant/platform synonyms remain governed in Mongo and are expanded before retrieval.
- Tenant, lifecycle, category, brand, product type, vendor, availability and price filters execute in OpenSearch.
- Governed attributes are projected into collision-safe keyword tokens and nested numeric key/value rows. This avoids dynamic-field mapping explosions and cross-category type conflicts.
- Customer content is never interpolated into index names or field paths.
- Candidate reranking defaults to 1,000 documents and is capped at 5,000.

## Security

Production enforces HTTPS and rejects credentials embedded in endpoint URLs. Use either:

- a short-lived OpenSearch API key supplied by the secret manager; or
- a least-privileged username/password account.

The service account needs index, alias, bulk, search, count, refresh and cluster-health permissions only for the configured prefix. Network policy should restrict the cluster to application and worker subnets. HTTP redirects are rejected so authorization headers cannot be forwarded to another origin.

Do not expose OpenSearch directly to browsers. Storefront requests always go through the API’s tenant resolution, validation, rate limiting and visibility gates.

## Configuration

```dotenv
SEARCH_PROVIDER=opensearch
OPENSEARCH_ENDPOINT=https://search.internal.example
OPENSEARCH_INDEX_PREFIX=flowermarket-catalog
OPENSEARCH_API_KEY=<secret-manager-reference>
OPENSEARCH_REQUEST_TIMEOUT_MS=5000
OPENSEARCH_MAX_RETRIES=2
OPENSEARCH_CANDIDATE_CAP=1000
OPENSEARCH_SHARDS=2
OPENSEARCH_REPLICAS=1
```

Production boot refuses missing, malformed, non-HTTPS or unauthenticated OpenSearch configuration. Tune shard count from measured index size and query concurrency, not tenant count. Start with shards large enough to remain below roughly 30–50 GB each.

## Rollout

1. Provision a supported OpenSearch cluster in the application’s private network.
2. Create the least-privileged service identity and place credentials in the secret manager.
3. Deploy with `SEARCH_PROVIDER=mongo` first; the OpenSearch code remains dormant.
4. In a staging environment, switch to `opensearch` and have a **super admin** call the reindex endpoint with `allTenants: true` to build and activate the first version. Tenant admins are explicitly forbidden from initiating a global alias cutover.
5. Compare relevance evaluation, query latency, result coverage, zero-result rate and facet parity.
6. Canary a small application pool, then roll out progressively.
7. Keep the Mongo projection populated. Reverting `SEARCH_PROVIDER=mongo` is the immediate incident escape hatch.

## Operations and recovery

The admin health endpoint reports provider, cluster state, timeout state and document count. Prometheus exports:

- `fm_search_provider_requests_total{provider,operation,outcome}`
- `fm_search_provider_request_duration_seconds{provider,operation}`

Alert on:

- any red cluster state;
- elevated `failed` or `timeout` outcomes;
- search P95 above 300 ms;
- repeated authoritative fallback;
- index lag above 30 seconds;
- sustained Mongo/OpenSearch document-count divergence;
- a rebuild alias that remains present after the expected rebuild window.

A process crash during rebuild leaves the rebuild alias intentionally isolated from reads while incremental writes continue dual-writing. Operators should inspect the target, then either resume through the controlled rebuild workflow or remove the rebuild alias and target before starting again. Never manually repoint only one of the read/write aliases.

Retain at least one previous versioned index until post-cutover smoke checks pass, then delete old versions according to storage policy. Alias switching is atomic; index deletion is deliberately a separate operational action.
