# Catalog transactional commands and idempotency

## Contract

Catalog master creation, tenant listing creation, and tenant price changes are command boundaries. On a MongoDB replica set or `mongos`, the aggregate write, immutable history, audit evidence, durable outbox row, and command result commit in one transaction.

Clients should send a unique `Idempotency-Key` header for every mutation. The shared web client generates one UUID per logical request and preserves it through token-refresh retries.

Keys are scoped by tenant for tenant commands and by `global` for central catalog commands. A key is permanently bound (for the journal retention period) to:

- operation name;
- canonical SHA-256 request fingerprint;
- final response.

An exact retry receives the original response without re-executing writes. Reusing a key with a different operation or payload returns `409 IDEMPOTENCY_KEY_REUSED`. A concurrent duplicate returns `409 IDEMPOTENT_COMMAND_IN_PROGRESS`; retry it with the **same key** after a short delay. Keys are limited to 200 characters.

## Atomic boundaries

| Command | Atomic writes |
|---|---|
| `product_master.create` | master, variants, variant/master media, attributes, search text, audit, outbox |
| `tenant_listing.create` | listing, optional initial inventory, audit, outbox |
| `tenant_listing.update_price` | optimistic listing update, `PriceHistory`, audit, outbox |

The outbox remains the durable cross-process cache/search signal. In-process invalidation is not emitted before a transaction commits, preventing phantom invalidations from aborted transactions.

## Journal lifecycle

`CatalogCommand` rows begin as `pending` with a 60-second owner lease. Successful transactions store the response and become `succeeded` in the same transaction. Failed commands become terminal `failed`, retaining a bounded error summary. Completed rows expire after 90 days. A worker/process that dies before opening the write transaction leaves a reclaimable lease.

Deploy migration `012_catalog_command_journal.js` before enabling traffic. It creates the tenant/key uniqueness, lease-claim, and retention indexes.

## Standalone MongoDB

Transactions require a replica set or `mongos`; production must use one. Standalone MongoDB is supported only as an explicit local/test compatibility mode. Commands perform ordered writes and register reverse-order compensations. This gives deterministic cleanup for ordinary exceptions, but cannot provide crash atomicity if the process or database dies between a write and its compensation. Do not run production catalog mutations against standalone MongoDB.

## Operations

Prometheus metrics:

- `fm_catalog_command_runs_total{operation,mode,outcome}`
- `fm_catalog_command_duration_seconds{operation,mode}`

`mode` is `transaction`, `compensation`, or `journal` (replay). Alert on sustained failures, compensation mode in production, or latency changes by operation. Inspect `catalogcommands` for pending leases older than 60 seconds and failed command summaries. Never manually change a successful fingerprint or response; issue a new key for a genuinely new request.

## Rollout checklist

1. Confirm production MongoDB reports a replica set name or `isdbgrid`.
2. Apply migration 012 and verify all three indexes.
3. Deploy API instances, then web clients.
4. Exercise a mutation while dropping the client response; repeat with the same key and verify one aggregate/history/audit/outbox set.
5. Verify key/payload mismatch returns 409.
6. Confirm no `mode="compensation"` samples occur in production.
