# Catalog layer production audit — 2026-09-15

## Scope

A file-by-file review of the catalog domain and every major dependency it touches:

- **Backend:** catalog models, taxonomy, master/listing/variant/image/attribute workflows, inventory, pricing history, change requests, outbox, public catalog assembly, search indexing/retrieval, controllers, routes, validators, RBAC and shared middleware.
- **Admin console:** global masters/categories/brands, tenant listings, variant wizard, inventory controls, review queue, audit/events and bulk import.
- **Storefront:** home/browse/search/category/brand shelves, grouped product cards, PDP variant selection, wishlist/cart integration and public API contracts.
- **Verification:** catalog pure tests, repository invariants, search relevance evaluation, variant-image tests, frontend production builds and storefront unit tests.

The repository already had a strong architectural base: global `ProductMaster` identity separated from tenant sellability, bounded variant/image/EAV collections, atomic optimistic locking, an outbox-fed read index, tenant isolation, paise-safe commerce and a public dual publish gate. This pass focused on the gaps that remained after the earlier F-01–F-20 remediation.

## Findings fixed in this pass

### P0 — catalog operations and correctness

1. **Tenant listing creation was unusable for store admins.** `ListingPanel` loaded masters from the `SUPER_ADMIN`-only global admin route. Added a tenant-authorized, read-only `/catalog/tenant/masters` discovery endpoint that forcibly returns ACTIVE masters, wired it through the shared client and console.
2. **Quick deactivation silently dropped optimistic-lock data.** The shared client accepted only `id`, so `{ expectedVersion }` supplied by the console was discarded and the API failed with `VERSION_REQUIRED`. The client now forwards the body and the route validates it.
3. **Master rejection advanced two versions.** The atomic review already changed status and incremented version; the reject branch saved and incremented again. Removed the stale second save/bump.
4. **Master-detail review and review-queue state diverged.** Approving/rejecting a proposed master directly left its `create_master` request pending forever. The master decision now closes the matching pending workflow atomically; calls originating in the already-claimed queue remain a no-op.
5. **A missing `conflict` import broke the backend invariant suite and the deprecation error path.** Consolidated the `ApiError` import.

### P0 — inventory integrity

6. **Order commit could decrement an arbitrary warehouse row.** `getStock`, PDP and catalog use the default (`warehouseId: null`) row, but commit/restore did not scope warehouse. Both now use the same sellable row.
7. **Order commit ignored reservations.** It guarded only `qtyOnHand >= qty`, while every customer read exposes `qtyOnHand - qtyReserved`. The atomic guard now checks available stock, preventing checkout from consuming another order's hold.
8. **Malformed internal quantities reached atomic stock writes.** Commit/restore now reject or skip missing listing IDs and non-positive/non-integer quantities.
9. **Stock-set audit falsely reported every previous quantity as zero.** The old post-image subtraction was mathematically always zero. Absolute counts remain one atomic last-write-wins operation; the audit now records an unknown pre-image instead of incorrect data.
10. **Restore result overstated success.** It returned requested item count even where no inventory row matched. It now returns the number actually restored.

### P0/P1 — customer publish gate and search parity

11. **Ranked search ignored explicit brand and product-type filters.** Added `brandId` and `productType` to search documents, index projection, retrieval and facets.
12. **Ranked search ignored customer sort selection.** `price_asc`, `price_desc`, `newest` and `popularity` now produce deterministic explicit ordering rather than silently returning relevance order.
13. **Ranked facets did not apply the list's filters.** Category, brand, type, vendor, availability, price and colour constraints now flow into the facet query.
14. **The search index could publish archived variants and legacy priceless listings.** Index status now requires ACTIVE listing + ACTIVE master + finite price + ACTIVE referenced variant. Invalid rows remain hidden for diagnostics/repair.
15. **The live catalog counted and paginated dead variant listings.** Variant resolution now occurs before count/facets/pagination, and dangling, archived or soft-deleted variants are excluded. Master-level listings remain valid.
16. **Storefront brand/category product counts counted variants, not products.** Aggregations now deduplicate by master before counting and ignore legacy priceless rows.

### P1 — storefront behavior

17. **Browse product cards used the obsolete prop contract.** Quantity state, busy state and stepper callbacks were all broken on `/browse`. The page now uses the same line-aware contract as Home/Search.
18. **PDP deep-linked variants were not sent to the API.** `/p/:slug?variantId=…` now requests that variant explicitly and refetches when the URL selection changes.

### P1 — taxonomy and API hardening

19. **Categories/brands could be deleted while active products referenced them.** Deletion now returns `CATEGORY_IN_USE` / `BRAND_IN_USE` until active or pending products are reassigned.
20. **Brand verification did not emit a catalog event.** It now invalidates/refreshes dependent reads through the same outbox path as other brand mutations.
21. **Several mutation bodies were unvalidated.** Master review, deprecation, variant/image delete and tenant deactivation now have explicit Joi contracts. Invalid decisions and missing versions fail at the edge.

## Architecture that is production-strong

- Global catalog ownership is separated cleanly from tenant price/stock/status.
- Tenant writes are scoped and global writes are `SUPER_ADMIN` only.
- Public visibility requires both ACTIVE master and ACTIVE, priced listing.
- Optimistic writes use conditional DB updates rather than in-memory-only checks.
- Inventory adjustments and checkout deductions use guarded atomic operators.
- Variant galleries have deterministic primary selection and master fallback.
- Change-request approvals use atomic claims and compensating rollback.
- The durable catalog event outbox has leases, retries and dead-letter behavior.
- Search indexing is idempotent, cursor-paginated and repairable.
- Public regex inputs are escaped and query limits are bounded.
- Soft-delete-aware uniqueness allows safe key reuse.

## Remaining scale roadmap

These are architectural investments, not reasons to block the fixes above:

1. **Transactional write units.** Master + variants/images/attributes, listing + initial inventory, and price + history are currently multi-write sagas. On a replica set, wrap these in Mongo sessions; retain compensation for standalone/dev deployments.
2. **Durable bulk imports.** The job registry is process-local. Move job state and row checkpoints to Mongo/Redis and execute through the worker so restarts and multi-instance routing cannot lose jobs.
3. **True grouped pagination.** `groupBy=master` groups after listing-level pagination. Implement a master-first aggregation/index query with a stable master cursor so a variant family never spans pages and product totals are exact.
4. **Production search provider.** Atlas/OpenSearch seams exist but are intentionally unimplemented. Before catalogs exceed the bounded Mongo candidate strategy, ship one provider with typo/facet/load tests and zero-downtime alias swaps.
5. **Search analytics signals.** Replace lifetime `soldCount` mislabeled as 30-day sales with windowed rollups; wire impressions/clicks/returns/vendor rating and evaluate ranking changes against logged NDCG/MRR and conversion.
6. **Warehouse allocation policy.** The storefront currently sells the default inventory row. Introduce an explicit fulfillment-location allocator before exposing multi-warehouse aggregate stock.
7. **Catalog quality scoring.** Add completeness, image quality, taxonomy compliance, duplicate confidence and publish-block reasons to admin workflows.
8. **Dependency modernization.** The backend production dependency audit has no high/critical finding. The frontend monorepo audit reports high/critical findings in the mobile Expo/React Native toolchain (not storefront runtime); plan the breaking Expo/RN upgrade independently and verify native builds.
9. **DB-backed CI reliability.** Smoke suites require a MongoDB binary download in a fresh environment. Cache/pin the binary in CI or provide a Mongo service container so adversarial integration suites are deterministic and offline-capable.

## Verification snapshot

- Catalog guard suite: **8/8 passed**
- Catalog adversarial pure suite: **35/35 passed**
- Repository invariants: **110/110 passed**
- Search ranking: **79/79 passed**
- Search relevance: **mean NDCG@10 0.996, MRR 1.00**
- Variant image suite: **9/9 passed**
- Admin + storefront production builds: **passed**
- Storefront unit tests: **11/11 passed**
- DB-backed catalog smoke: blocked in this sandbox because `fastdl.mongodb.org` reset the Mongo binary download; no application assertion ran.
- Legacy aggregate `npm test` still reaches the repository's pre-existing custom lint-baseline failures; the catalog/invariant suites above pass. Real backend ESLint is not installed in backend dev dependencies. Frontend ESLint likewise is not installed despite a script entry.
