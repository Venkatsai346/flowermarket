# Search analytics and merchandising

## Data flow

1. Ranked search writes one durable `query` record before returning its `queryId`.
2. Each grouped storefront card retains the query ID and result position from the page that introduced it.
3. A 50%-visible card sends one idempotent impression; product navigation and successful cart additions send click and cart events.
4. The API accepts only server-minted query IDs, the same tenant/session, and listings from the retrieved result family. Event IDs are unique per tenant, so retries are safe.
5. Verified attribution is copied to the cart and immutable order line. Purchase and revenue facts are read from non-pending, non-cancelled orders—never from browser revenue fields.
6. Tenant nightly maintenance materializes idempotent purchase events and genuine rolling 30-day engagement, sales, and return signals into the canonical search documents and active search provider.

Interaction rows contain no customer identity or raw session token. Session values are one-way hashed and truncated. Events expire after 180 days; order lines remain the financial source of truth.

## Merchandising rules

Search admins can create tenant-scoped, typed rules for:

- query/category pins, boosts, and buries;
- application-relative redirects;
- scheduled campaigns with start/end instants and explicit timezone metadata;
- curated product/category shelves;
- in-stock substitutes for an unavailable listing.

Rules support draft, active, and paused states, priorities, optimistic versions, soft deletion, and audit records. Active-window reads are cached for 30 seconds and always recheck schedule boundaries. Redirects beginning with `//` or targeting an external origin are rejected.

Static ranking profiles remain the baseline. Active merchandising is overlaid for the matching request, so campaigns do not mutate long-lived profile weights.

## Operations

- Migration: `013_search_merchandising_analytics.js`
- Safeguard test: `npm run test:search-analytics` in `backend/`
- Rollup: the `tenant-nightly` worker step reports `searchAnalytics.listingsUpdated`, `purchaseEventsMaterialized`, and its 30-day `windowStart`.
- Metrics: `search_interaction_events_total{type,outcome}` and `search_analytics_rollups_total{outcome}`
- Admin reporting: `/search/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Public beacons: `POST /search/events`
- Public curated shelves: `GET /search/shelves?categoryId=<id>`

If rollup fails, search remains available with the previous materialized signals and the nightly result records the isolated error. Re-running is safe: purchase IDs are deterministic and search signal updates replace the complete 30-day window. OpenSearch writes rehydrate canonical Mongo documents first, preventing unrelated catalog updates from erasing materialized signals.

### Abuse and incident checks

- A spike in `session_mismatch`, `unknown_query`, or `listing_not_in_results` outcomes indicates replay or malformed clients; these responses do not mutate analytics.
- Confirm the worker and per-tenant nightly job are healthy before investigating stale popularity.
- Pause a suspect campaign instead of deleting it while investigating; audit history and the soft-deleted record are retained.
- Purchase discrepancies must be reconciled against `OrderItem` and `Order`, not browser events.
