# Sandbox tenant-listing seed runbook

## Purpose and boundaries

`backend/scripts/seed-catalog-sandbox-listings.js` turns the previously seeded **active sandbox product variants** into sellable tenant-scoped listings. It uses the application's real MongoDB connection (`MONGODB_URI`) and never uses mocks or in-memory persistence.

It creates or refreshes only:

- `TenantProduct` documents, one per selected active variant;
- default-location `Inventory` documents aligned with each listing's stock snapshot;
- derived `SearchDocument` projections through the catalog's production search indexer.

It never creates or changes tenants, users, categories, brands, product masters, product variants, EAV values, bundles, media, or compliance data. Existing complete merchant listings are preserved rather than overwritten.

## Deterministic coverage

| Tenant | Store profile | Master selection | Variant listings |
|---|---|---:|---:|
| `6aa2acaaf23bef4d46ce4c1e` | Flower store (`FLORA`) | Every sandbox master in fresh flowers, bouquets, live plants, seeds/bulbs | 234 (78 masters × 3) |
| `6ab7a306154d0153e5aae538` | Grocery store (`GROCERY`) | Every sandbox master in packaged food and fresh produce | 315 (105 masters × 3) |
| `6ab7a0f6154d0153e5aae0e4` | Multi-category store (`MULTI`) | Deterministic category-balanced sample spanning all 27 leaf categories | 108 (36 masters × 3) |
| `6a97b0e9a61173c01d040435` | Flower and gift store (`FLORAGIFT`) | Every flower-store master plus every gift-hamper/bundle master | 333 (111 masters × 3) |

The 990 listing requirements are tenant-specific. The same global master/variant can correctly be sold by more than one tenant.

## Data quality

Every generated listing has:

- a deterministic, tenant-unique `SBXL-*` seller SKU;
- INR MRP, selling price and private cost price with a valid price ladder;
- variant-aware price basis and unit;
- positive deterministic opening stock;
- matching default-location inventory with zero reserved stock;
- valid minimum/maximum order limits;
- backorder/preorder and lead-time policy;
- storefront, marketplace and POS channels enabled;
- deterministic featured/search merchandising;
- `active` listing and in-stock availability state;
- the configured active super-admin in `listedBy`/audit attribution.

Prices and stock are deterministic test data, not manufacturer or merchant claims. Media remains inherited from the product catalog and is not created by this seed.

## Prerequisites

1. Configure the intended real database securely in `backend/.env` or the process environment:

   ```env
   MONGODB_URI=mongodb://host/database
   ```

2. The actor must exist as an active `super_admin`. Default:

   ```text
   6a97b0e9a61173c01d040435
   ```

3. All four configured IDs must exist as active `Tenant` documents. The fourth ID is independently resolved in both `users` (actor) and `tenants` (store); one does not substitute for the other.
4. Run the sandbox taxonomy and product seeds first.
5. Target sandbox masters and all required variants must be active. If products were initially created as `pending_review`, approve them through the catalog workflow before seeding active listings. The listing seed deliberately does not bypass master lifecycle controls.

## Commands

Run from `backend/`.

### Offline validation (no database connection)

```bash
npm run catalog:sandbox:listings:validate
```

### Database-backed dry run

```bash
npm run catalog:sandbox:listings:plan
```

The resolved database name, tenant identities and create/recovery/conflict counts are printed before any mutation. Credentials are never printed.

### Apply all tenants

Bash/macOS/Linux:

```bash
npm run catalog:sandbox:listings:seed -- \
  --acknowledge-sandbox-listings
```

Windows PowerShell (single line — do not copy the Bash `\` character):

```powershell
npm run catalog:sandbox:listings:seed -- --acknowledge-sandbox-listings
```

For a PowerShell multiline command, use its backtick continuation character instead:

```powershell
npm run catalog:sandbox:listings:seed -- `
  --acknowledge-sandbox-listings
```

### Plan or apply one tenant

Use the profile code or ObjectId. This is useful for controlled rollout and recovery.

```bash
npm run catalog:sandbox:listings:plan -- --tenant=MULTI

npm run catalog:sandbox:listings:seed -- \
  --tenant=6ab7a0f6154d0153e5aae0e4 \
  --acknowledge-sandbox-listings
```

Repeat `--tenant=` to select multiple tenants.

### Override actor

```bash
npm run catalog:sandbox:listings:seed -- \
  --actor=<active-super-admin-object-id> \
  --acknowledge-sandbox-listings
```

The override is still required to resolve to an active super-admin.

## Safety, idempotency and recovery

- **Validation first:** the deterministic registry is validated before connecting.
- **Exact dependencies:** masters and variants are resolved by generated global SKU/variant SKU and checked against the sandbox ownership tag, category and lifecycle state.
- **No silent overwrites:** complete existing merchant listings satisfy the target but are not rewritten. Inactive, unpriced, unstocked or otherwise incomplete existing target listings are reported as conflicts and block apply.
- **Collision protection:** seller-SKU ownership is checked before writes; the database's tenant/master/variant and tenant/seller-SKU unique indexes remain the final race-safety boundary.
- **Resumable chunks:** an interrupted run can be rerun. Already-created listings are detected, and missing inventory rows are recovered without changing valid listing data.
- **No plan-limit bypass through the API:** this is explicit operator seed tooling for controlled test tenants. It writes seed records directly after prerequisite validation and acknowledgement; it is not exposed as an application endpoint.
- **Search-ready storefront data:** apply runs the production search indexer for each selected tenant; stale or missing target search projections remain visible in dry-run plans.
- **Fresh convergence proof:** after apply, the script rebuilds its plan from MongoDB. Success is printed only when every selected listing is active, priced, storefront-enabled, stocked, backed by aligned active inventory, and represented by a current active search document.
- **Merchant edits remain authoritative:** reruns do not reset price, stock, status or merchandising. If an edit makes a required test listing no longer convergent, the script reports it for review rather than undoing it.

If a run fails after some chunks, correct the reported dependency/index/conflict issue and run the same command again. Do not manually delete healthy rows to restart.

### Missing master or variant prerequisite

The listing script now reports **all unique catalog prerequisite issues in one pass** rather than stopping at the first absent variant. It does not silently skip products or duplicate product-seed responsibilities.

If the report contains `MASTER_MISSING` or `VARIANT_MISSING`, run the product convergence workflow first:

```powershell
npm run catalog:sandbox:products:plan
npm run catalog:sandbox:products:seed -- --acknowledge-noncompliant-sandbox --active
npm run catalog:sandbox:listings:plan
npm run catalog:sandbox:listings:seed -- --acknowledge-sandbox-listings
```

The product seed repairs missing variants idempotently. `--active` applies only when it must create a missing master; it deliberately does not change an existing master's lifecycle. If the report contains `MASTER_NOT_ACTIVE` for an existing `pending_review` master, approve that master through the catalog lifecycle and rerun the listing plan.

For example, a missing `SBX-ATL-0A274B24-TAB-ACER-BB370-V03` is repaired by the sandbox product seed; it must not be skipped or replaced with the wrong tablet variant.

## Expected final result

A clean all-tenant apply ends with:

```text
Database verification passed: all 990 active variant listings have valid pricing, ordering data, aligned inventory and current search documents.
```

Counts are also available programmatically from `CATALOG_SANDBOX_LISTING_COUNTS` in `backend/src/data/catalogSandboxListingBlueprints.js`.
