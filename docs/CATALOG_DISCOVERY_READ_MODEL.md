# Catalog Discovery Read Model

## Contract

Customer product-listing pages call `GET /api/v1/catalog?groupBy=master`.
The grouped contract is product-family based: filtering, totals, facets, sorting
and pagination happen on distinct product masters before the selected families
are hydrated with every live tenant-listed variant.

### Pagination

`meta.nextCursor` is an opaque, versioned keyset cursor. It is bound to the
current tenant, search, category, brand, type, price, stock, sort and governed
attribute filters. A cursor reused with another filter set fails with
`INVALID_CATALOG_CURSOR` instead of silently skipping or duplicating products.
Page pagination remains available for older clients; cursor and page > 1 cannot
be combined.

### Governed attribute filters

Category `attributeSchema` entries marked `facetable` or `filterable` drive the
public specification facets. The client sends a bounded JSON query parameter:

```text
attributes={"colour":["Red","Blue"],"ram_gb":[8],"capacity_l":{"min":1,"max":5}}
```

The edge validator limits this to 12 governed keys and 20 values per key.
Unknown/non-governed keys fail closed. Values from master and variant EAV rows
are supported; multiple values within a key are OR, while separate keys are
AND. Facet counts are distinct product-family counts.

## Search convergence

For relevance text searches, the ranking system contributes an ordered,
bounded list of master candidates. The authoritative catalog aggregation then
revalidates tenant publication, master lifecycle, compliance, price, stock,
variants and facets. Search index data never becomes commerce truth.

The search projection now carries governed master and variant attributes and a
compound wildcard index supports dynamic fields. Attribute-filtered grouped
search deliberately remains on live matching until the deployment has completed
a full search reindex, preventing partially upgraded indexes from returning
false zero-result pages.

## Production rollout

1. Deploy the API and run `npm run db:migrate` before serving traffic.
2. Confirm migration `006_catalog_discovery_read_model.js` is applied.
3. Run the existing search full-reindex operation for every tenant.
4. Confirm outbox backlog and dead-letter depth are zero.
5. Exercise category, brand, price, stock, parent-category and attribute filters.
6. Verify cursor continuation while listings are inserted or updated.
7. Observe the metrics below and compare P50/P95/P99 before increasing traffic.

## Observability

The `/metrics` endpoint exports bounded-cardinality discovery signals:

- `fm_catalog_read_duration_seconds{source,outcome}`
- `fm_catalog_read_requests_total{source,outcome}`
- `fm_catalog_families_returned{source}`

`source` is one of `authoritative`, `ranked_hydration`, or `ranked_fallback`.
Responses also carry a `Server-Timing` catalog measurement for browser and
synthetic monitoring. No tenant IDs, queries, categories or user values are
used as metric labels.

Recommended launch gates:

- browse P95 below 250 ms;
- text search P95 below 300 ms;
- grouped request error rate below 0.1%;
- ranked fallback rate below 1%;
- zero duplicate master IDs across cursor pages;
- exact API total equals distinct visible masters for sampled tenants.
