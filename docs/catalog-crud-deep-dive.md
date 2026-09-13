# Catalog CRUD Layer — Deep-Dive Analysis

Layer-by-layer dissection of the catalog domain: **ProductMaster, Category, Brand,
TenantProduct (listings)** + everything they touch (variants, images, EAV attributes,
change requests, inventory, outbox, search index, frontend, tests).

Scope: `backend/src/{models,services,controllers,routes,middleware,utils}` catalog
slices, `frontend/apps/{web,storefront}` catalog features, `backend/scripts` catalog
suites. ~3,700 LOC of core CRUD code + ~1,500 LOC of cross-cutting middleware.

---

## 0. Architecture at a glance

```
                       ┌────────────────────────────────────────────────────────┐
 public  GET /catalog  │  catalog.public.controller ─ catalogSearch.service     │  (merged read view)
                       │        │                                               │
admin    /catalog/admin│  catalog.admin.controller ─┬─ productMaster.service    │
                       │                            ├─ category.service         │
                       │                            ├─ brand.service            │
tenant   /catalog/tenant│  catalog.tenant.controller ─┬─ tenantProduct.service   │
                       │                             ├─ inventory.service       │
                       │                             ├─ changeRequest.service   │
                       │                             └─ bulkImport.service      │
                       └────────────────────────────────────────────────────────┘
   routes → validate(Joi, stripUnknown) → authenticate(JWT) → authorize(roles)
        → controllers (thin) → services (rules) → models (Mongoose + 3 plugins)
        → auditService.record() + catalogEventService.publish() [outbox]
                              └─> worker: drain() → searchIndexer / notifications
```

**The core design idea (and it is well implemented):** a *field-ownership split*.
Global identity fields (title, description, category, brand, attributes, images,
variants) live on the shared `ProductMaster`; per-tenant sellability (price, stock,
status) lives on `TenantProduct`. Tenants can never fork a shared SKU — global-field
edits and new-SKU proposals go through `ProductChangeRequest` + admin review.
`utils/catalog/fieldOwnership.js` encodes the two field sets and every write path
branches on them.

---

## 1. Data layer (models)

### 1.1 The 8 catalog models

| Model | Collection | Role | Notable indexes |
|---|---|---|---|
| `ProductMaster` | productmasters | global "what this product is" | unique `skuGlobal`, unique `slug`, partial-unique `barcode`, text index on `searchText/title/tags` |
| `ProductVariant` | productvariants | global variants (10 stems / red) | unique `(master, variantType, value)`, partial-unique `sku` |
| `ProductImage` | productimages | master **and** variant galleries (one collection, `variantId` nullable scope) | `(master, variantId, status, isPrimary↓, sortOrder)` |
| `ProductAttributeValue` | productattributevalues | EAV attributes, one row per `(master, key)` | unique `(master, attributeKey)` |
| `ProductChangeRequest` | productchangerequests | field-ownership approval workflow w/ stored diff | `(status,type)`, `(tenant,status)`, `(master,status)` |
| `Category` | categories | global taxonomy tree (`parentId` refs, denormalized `level`), `attributeSchema` = bounded per-category EAV field defs | unique `slug`, `(status,parentId,sortOrder)` |
| `Brand` | brands | global brand registry + verification state | unique `slug`, `(status, verification.isVerified)` |
| `TenantProduct` | tenantproducts | **the** per-tenant sellable row: price, stock snapshot, availability, listing status, rating rollup | **unique `(tenantId, productMasterId, variantId)`**, `(tenant,status)` |

Good decisions:
- EAV/variants/images in separate collections — no unbounded embeds, bounded docs.
- `ProductImage.variantId` null-scope + `(master, variantId, …)` index is a clean
  way to have per-variant galleries with master fallback in one pipeline.
- `TenantProduct` unique triple correctly models the variant-listing matrix
  (master-level row `variantId=null` coexists with per-variant rows).
- Denormalized `level` on Category, `searchText` blob on master, `rating` rollup on
  listing — all deliberate read-side optimizations.
- `Category.attributeSchema` is the compliance-gating hook (e.g. FSSAI required for
  a pharma/food category) — validated at write time by `categoryService.validateAttributes`.

### 1.2 Model-level issues

- **`ENTITY_STATUS2`** (`constants/enums.js:798`) — dead duplicate of ENTITY_STATUS
  (missing ARCHIVED). 0 usages. Delete it.
- **Unique indexes vs soft-delete** — soft-deleted rows keep their `slug` /
  `skuGlobal` / `barcode` unique keys forever. Recreating a deleted category/brand
  with the same explicit slug → 409 `SLUG_TAKEN`/`DUPLICATE_KEY`; auto
  `uniqueSlug()` papers over it with `-2` suffixes (also depends on `Model.exists`
  honoring the soft-delete filter — see §2). REJECTED masters accumulate forever
  (no delete endpoint; only `deprecate`), permanently holding SKU/slug.
- `TenantProduct` doc comment says *DRAFT → ACTIVE (requires master ACTIVE + price
  set)* — **neither is enforced anywhere** (see §4.4 F-05/F-06).

---

## 2. Shared plugins (`models/plugins/index.js`)

Every catalog model gets `softDeletePlugin` + `auditPlugin` + `toJSONPlugin`.

- `pre(/^find/)` injects `isDeleted: {$ne: true}` into find-family queries;
  `pre('aggregate')` unshifts a `$match`.
- `softDelete()` / `softDeleteById()` set `isDeleted+deletedAt` instead of removing.
- `toJSONPlugin` strips `_id/__v/isDeleted/deletedAt` + a secret-field denylist.

Gaps:
1. **Only `find*` and `aggregate` are filtered.** `updateMany` / `deleteMany` /
   `countDocuments` / `insertMany` are not. Consequences:
   - `productMasterService.deprecate()` → `TenantProduct.updateMany({productMasterId,
     status: {$ne: INACTIVE}}, …)` also flips **soft-deleted** listings and stamps
     `lastStatusChangedAt` on ghosts.
   - `setAttributes()` → `ProductAttributeValue.deleteMany({productMasterId})` is a
     hard delete that *also* reaps soft-deleted rows (replace-semantics, OK, but
     worth knowing).
   - Manual `isDeleted: {$ne: true}` filters scattered in services
     (`tenantProduct.listListings`, `adminCatalog`) are therefore partly redundant
     for `find`/`aggregate` (the hook already adds them) and partly necessary
     (`updateMany`). The mix shows the team is unsure which family is hooked.
2. `isDeleted`/`deletedAt`/`updatedBy` are `select: false` — good for payload
   hygiene, but it means code that needs them must opt in (the codebase does this
   inconsistently, e.g. `productBySlug` re-filters `isDeleted` manually while
   `getMaster` relies on the hook).

---

## 3. Domain utilities (`utils/catalog/`)

### 3.1 `fieldOwnership.js` ✅
The load-bearing file of the whole domain. `MASTER_GLOBAL_FIELDS` vs
`TENANT_LISTING_FIELDS` + `splitMasterPatch()`. Note `TENANT_LISTING_FIELDS` only
covers `price, orderLimits` — status is handled via a separate state machine and
stock via inventory, which is consistent with the routes.

### 3.2 `optimisticLock.js` ❌ (F-02)
```js
if (Number(doc.version) !== Number(expectedVersion)) throw 409;
doc.set(patch); doc.version += 1; return doc.save();
```
The check is **in-memory against a doc fetched earlier**, and `save()` is an
unguarded `updateOne({_id})`. Two concurrent writers that both read `version=5`
both pass the check and both save → **last write wins, version only +1, no 409**.
The "optimistic lock" only protects a *stale client* (good UX), not the data.
A correct version uses
`Model.updateOne({_id, version: expected}, {$set: patch, $inc: {version: 1}})`
and 409s on `matchedCount === 0`. Every master update, price update, status update,
variant/image/attribute mutation routes through this — the whole catalog write
surface inherits the hole. (The smoke test's "stale version must 409" only proves
the client-side half.)

### 3.3 `diff.js` ✅
`pick`/`diffObjects` (JSON-normalized field diffs) — clean and used for change-request
before/after snapshots.

### 3.4 `similarity.js` ✅
Token-Jaccard + char-bigram-Dice, max of both, threshold 0.8, stopword set.
Reasonable for fuzzy duplicate flagging; combined with exact SKU/barcode 409s.

### 3.5 `variantImages.js` ✅ (the best file in the domain)
Pure, unit-tested (9/9 passing here), no I/O. The "variant gallery else master
fallback" rule with an explicit `imageSource` flag, scoped primary resolution,
`pickDefaultVariant` tie-breaks. This is the pattern the rest of the domain should
copy.

### 3.6 `availability.js` ✅
`deriveAvailability(qty)` — shared by inventory refresh + listing creation. Threshold 10.

### 3.7 `csv.js` ✅
Zero-dep RFC-ish parser (quotes, escaped quotes, CRLF, BOM) + serializer with proper
escaping. Fine for ≤1MB uploads (body limit is 1MB — see §8.4 for why that still
matters).

---

## 4. Service layer (the CRUD core)

### 4.1 `productMaster.service.js` (655 LOC)

**Create** (`createMaster` / `proposeMaster`):
- Validates category exists + `validateAttributes` against the category's
  `attributeSchema` (compliance gating works end-to-end).
- Duplicate detection: exact barcode/SKU → 409; fuzzy title (first-3-words regex
  pre-filter + similarity ≥ 0.8) → 409 `POSSIBLE_DUPLICATE` with the incumbent id.
  TOCTOU: two concurrent creates can both pass the read-then-write; the DB unique
  index is the real guard (and E11000→409 is mapped — good).
- Two-phase save: `create()` → `syncMasterExtras()` → `save(searchText)`. No
  transaction: a mid-way failure leaves a master with partial extras.
- `searchText` blob = title+desc+tags+category path(2 levels)+brand+attributes —
  precomputed for Mongo text search. Nice, but category path is capped at one
  parent hop.

**`syncMasterExtras` ❌ (F-07):** for a create payload containing *both* variants
with images *and* master images with `isPrimary`, the master-image block runs
`ProductImage.updateMany({productMasterId, isPrimary: true}, {$set:{isPrimary:false}})`
**without scoping `variantId: null`** → it demotes the surviving variant primaries
that `ensureSingleVariantPrimary` just elected. The chosen master image is re-set
by `findOne({url})` (fragile with duplicate URLs). Net: variant galleries lose
their intended primary on create; `sortGallery` then orders by sortOrder, so the
"primary" thumbnail of a variant with its own photos can be the wrong one.

**Review** (`reviewCreateMaster`): PENDING_REVIEW → ACTIVE|REJECTED, bumps version,
emits `product_created` on approve. Fine. **No cascade on REJECT** — see F-06.

**Update** (`updateGlobalFields`):
- Re-validates attributes if `categoryId` changes. Good.
- Re-runs duplicate check on title/barcode even when only one changed — by design,
  but surprising (renaming to a similar title 409s).
- `slug` updates skip `assertSlugFree` → collision surfaces as raw E11000 → 409
  `DUPLICATE_KEY` (mapped, acceptable, inconsistent with category/brand paths).
- The patch is **whitelisted by Joi upstream** (`masterUpdateSchema` forbids
  `skuGlobal/type`, and `stripUnknown: true` removes `status/version/searchText`…),
  so the admin update path is actually tight. The danger in this service is the
  *other* entry point: `applyGlobalPatch` (see §4.3 F-03).

**Sub-resources**: `addVariant/updateVariant/removeVariant/addImage/setImagePrimary/
removeImage/setAttributes`. Consistent: version-gate → mutate → audit → outbox.
`updateVariant` has a proper `allowed` field list (the master update path lacks
the equivalent at the service level, relying on Joi). `removeVariant` correctly
soft-deletes the variant's image rows first (no dangling galleries). Small
blemishes: `addVariant` logs `actorType: viaRequest ? 'admin' : 'admin'`;
`listMasters` has `sortBy === 'createdAt' ? 'createdAt' : 'createdAt'` (sortBy
silently ignored).

**Deprecate**: master → DEPRECATED + `updateMany` cascades active tenant listings
to INACTIVE + event. Works (smoke-tested), but the `updateMany` isn't
soft-delete-filtered (ghost listings get flipped too — §2 gap 1).

### 4.2 `category.service.js` / `brand.service.js`

**Category**
- Create: parent check, auto-unique slug, `level = parent.level + 1`.
- Update ❌ (F-08): cycle detection is **one level deep** —
  `parent.parentId === id` only. Moving a category under its *grandchild*
  (A→B→C, set A.parent=C) creates a real cycle. Consequences:
  - `categoryService.tree()` returns `[]` (roots vanish) — silent data loss in the
    admin tree.
  - `catalogSearchService.customerCategories()` **infinite-recurses** (`attach`
    follows the cycle) → `RangeError` → 500 on the *public* `GET /catalog/categories`.
  - `level` is never recomputed for descendants of a moved node (denormalization
    silently rots).
- Remove: blocks if direct children exist, soft-deletes, emits event. Does **not**
  check for products referencing it → masters dangle on a deleted category
  (read paths return `category: null`; acceptable, but undeclared).
- `validateAttributes`: per-type checks (number min/max, select options, boolean,
  custom regex with try/catch). Solid.

**Brand**
- `remove` ❌ (F-09): "delete" = set `status: INACTIVE`. Not soft-deleted,
  **no catalog event** (categories/masters emit one), inconsistent contract with
  the other two taxonomy entities; slug stays locked; `list?status=inactive` still
  returns it.
- `verify`: un-verify maps to `BRAND_VERIFICATION_STATUS.REJECTED` (not PENDING) —
  a brand that was never rejected becomes REJECTED by un-verification; cosmetic but
  confusing in filters (`verification.status` vs `isVerified` drift).

### 4.3 `changeRequest.service.js` ❌❌ (the weakest write path)

- **`submit`**: `payload`/`diff` are `Joi.object().allow(null)` — **free-form**.
  The tenant controls exactly what `applyRequest` will later write to the shared
  master. (See F-03.)
- **`review`** ❌ (F-04): `findById` → check `status === PENDING` → `save()` →
  `applyRequest()`. No atomic claim (contrast: the *outbox* in the same repo does
  this correctly with `findOneAndUpdate` guarded claims). Two concurrent approves:
  both read PENDING, both save, **both apply** — `UPDATE_IMAGES` adds every image
  twice; `DEACTIVATE_MASTER` double-cascades (second `deprecate` throws
  `ALREADY_DEPRECATED` *after* the request was already marked approved).
- **`review` is non-rollback** ❌ (F-03b): the CR is saved as APPROVED *before*
  `applyRequest` runs. Any apply failure (e.g. free-form `payload.attributes` with
  an invalid key → Mongoose validation on `insertMany`) leaves the CR
  approved-but-not-applied, and it can never be retried
  (`REQUEST_ALREADY_REVIEWED`). Tenant sees "approved", master is untouched.
- **`applyRequest`** trusts `cr.diff.after` wholesale via `applyGlobalPatch`
  (`master.set(patch)` + save + version bump, no re-validation against current
  state, no field whitelist, no duplicate check). Since `diff.after` is
  tenant-supplied (F-03), a request labelled "title update" can carry
  `{status: 'active'}` (resurrect a REJECTED master) or `{status: 'deprecated'}`
  (deprecate **without** the listing cascade), or stale `categoryId`/`brandId`
  refs (Mongoose does not validate ref existence).
- `UPDATE_IMAGES` is ADD-only despite the name (no removal/replace semantics).
- `cancel`/`revise`: tenant-scoped, state-checked — fine (same check-then-save
  race, low impact).

### 4.4 `tenantProduct.service.js` (470 LOC)

**`createListing`**
- Allows masters in `ACTIVE` **and** `PENDING_REVIEW` (so tenants can stage
  listings before approval — intended), then
- ❌ (F-05): nothing ever re-checks master status. `updateStatus` DRAFT→ACTIVE has
  **no master-status check and no price check** → a listing can be ACTIVE on a
  PENDING_REVIEW (or later REJECTED) master. The cart blocks non-ACTIVE masters at
  add-time (safe for money), and PLP/slug-PDP filter `master.status = ACTIVE` —
  but `GET /catalog/products/:id` (PDP) does **not** (F-06), so the storefront can
  render a shareable page for a product that never passed review.
- Entitlement cap (`entitlementService.assertWithinLimit`) only on ACTIVE —
  drafts are free staging, bulk inherits per-row. Good design.
- `Inventory.create` happens *after* `TenantProduct.create`, non-atomically →
  crash window: listing claims `stockQty=50` with no inventory row (reads fall
  back to the snapshot → over-availability until fixed).

**`bulkCreateListings`** — genuinely well-designed partial-success contract:
per-row validation, `onConflict: skip|error`, duplicate-in-request detection,
master-row+variant-row ambiguity warning, 100-row cap, `selectAll` mode.
The "earlier rows stay created" semantics on abort is documented — acceptable,
but clients must treat it as a saga, not a transaction.

**`updatePrice`** — price validity (selling ≤ mrp when both set), version-gated
write, `PriceHistory` row **after** the save (crash → price changed, no history),
audit + `price_changed` outbox event. The money math itself is paise-safe in the
cart/checkout layers.

**`updateStatus` / `assertTransition`** — DRAFT→ACTIVE/INACTIVE,
ACTIVE→INACTIVE/OUT_OF_STOCK, INACTIVE→ACTIVE, OOS→ACTIVE/INACTIVE. Consistent
state machine. But see F-05 (no price/master gate) and: `INACTIVE`/
`OUT_OF_STOCK` transitions don't verify preconditions (activating a priceless
listing → orderable at ₹0, F-05).

**`listListings`** — aggregation with master+variant lookups; ❌ unescaped
`new RegExp(query.search, 'i')` (F-10); `minPrice/maxPrice` are Joi-validated
(upstream `listingQuerySchema`) so the NaN path is closed *here* — but the same
pattern in `adminCatalog` is not validated at all (F-10 covers both).

**`masterListingStatus`** — one-shot variant-selection grid (variants + galleries +
existing listings + versions). Exactly the right shape for a listing wizard.

### 4.5 `inventory.service.js` (the stock half of listing CRUD)

- `reserve`/`release`/`commitForOrder`/`restoreForOrder` use **atomic
  `findOneAndUpdate` with `$expr` guards** — this is the real oversell protection
  and it is correct (smoke-tested: over-reservation 409s).
- ❌ (F-11): `setStock`/`adjustStock` are read-modify-write `row.save()`. Two
  concurrent `+10` adjustments both read 100, both write 110 — one is lost.
  `adjustStock` should be `$inc` with a `$expr` floor guard. The Inventory model
  doc even promises "`version` for optimistic locking on manual set/adjust" —
  the field exists, is **never checked** (and the stock routes never even
  validate the body — §7.4).
- ❌ (F-12): `qtyReserved` is written **only** by the tenant-facing
  `POST /listings/:id/stock/reserve|release` endpoints — the checkout saga
  commits straight against `qtyOnHand`. There is no order linkage, no TTL, no
  expiry: a tenant can pin arbitrary stock forever; displayed
  `qtyAvailable = onHand − reserved` diverges from what checkout actually sells
  (commit only guards `onHand`). Availability math is consistent everywhere
  (`max(0, onHand−reserved)` in 6+ places) but the reserved half is effectively
  a tenant-controlled knob on the storefront.
- `refreshListingStock` — denormalizes `stockQty` + `availability` onto the
  listing and auto-flips ACTIVE→OUT_OF_STOCK at zero (reactivation stays
  explicit). Correct, but a second unguarded `updateOne` (crash window between
  the two writes); it doesn't bump listing `version` (intentional — system write).

### 4.6 `catalogEvent.service.js` (outbox) ✅✅

The strongest subsystem in the catalog area. Durable outbox rows; **leased
consumption** via atomic `findOneAndUpdate` claims (`claimedBy` +
`leaseExpiresAt`); `reapExpired()` reclaims crashed-worker rows; exponential
backoff 30s/2m/10m/30m → dead-letter after `maxAttempts`; manual `retryFailed()`.
At-least-once is explicitly documented and the handlers are idempotent by
construction (search indexer = upsert; notifications dedupe). `publish()`
validates event types against the enum. Only nits: `drain()` re-runs a global
`reapExpired` per call, and candidate `find(limit)` before atomic claim means N
workers can scan the same batch (waste, not wrongness).

### 4.7 `adminCatalog.service.js`

Read-side joins (master × listing × inventory) for the ops dashboard.
- ❌ (F-13): `list()` does `TenantProduct.find(listingFilter).lean()` with
  **no limit** — every listing of the tenant is materialized in memory, then
  filtered/paginated in JS (search path adds two more unbounded queries).
  Fine at 1k listings, degrades at 100k.
- `primary = ls[0]` — the "primary" listing per master is whichever came first
  from an unsorted query; its price/stock are presented as the master's.
- ❌ `csv()` — "CSV export" calls `list({limit: 200})`: **exports silently
  truncate at 200 rows** with no signal.

### 4.8 `bulkImport.service.js`

- In-memory `BoundedCache` job registry (100 jobs, 1h TTL) — documented as a
  stand-in for a real queue; multi-instance deploys break job polling (job on
  instance A, GET hits B → 404), restarts lose jobs.
- ❌ (F-14): no row-count cap; body limit is 1MB → tens of thousands of rows,
  processed sequentially fire-and-forget with `.catch(() => {})` (errors vanish
  unless the job row itself records them).
- `findListing` by `sku` → `ProductMaster.findOne({skuGlobal})` →
  `TenantProduct.findOne({tenantId, productMasterId})` **unsorted**: for a
  multi-variant master the bulk price row lands on an *arbitrary* variant
  listing.
- Price-row create path: `productMasterId: row.masterId || null` — a SKU-keyed
  row (no masterId column) that finds no existing listing creates with
  `productMasterId: null` → guaranteed 404-ish row failure.

### 4.9 `catalogSearch.service.js` (public read path)

- Merged view via aggregation: listings (tenant, ACTIVE) ⋈ masters → filter
  `master.status = ACTIVE`, `isDeleted` — the correct publish gate for PLP.
- ✅ Search regex is **escaped** here (unlike the admin/tenant list paths — F-10).
- Facets via `$facet` on the same pipeline; bounded; swallows errors → empty
  facets (degraded, not broken).
- `inStock` filter uses the `stockQty` snapshot for speed, then patches exact
  availability in a batch (`bulkGetStock`) — the batch function is carefully
  documented to return the *same* number `getStock()` does (warehouse-scoped).
  Good.
- `groupBy=master` card assembly: full variant family fetched in bounded queries,
  order-preserving, dead-variant listings filtered. Solid.
- ❌ `customerCategories()` — unguarded recursion (F-08 payload).
- `customerBrands()` — verified-only chips. Fine.

### 4.10 `searchIndexer.service.js`

- Rides the same outbox (no dual writes). Handler is deliberately
  failure-tolerant (index staleness is repaired by sweep, never blocks catalog
  writes).
- Docs: paise-denominated price fields, `suggest` tokens, variant labels,
  `sourceVersion = listing.version + master.version`, `status: active|hidden`
  from the dual master+listing gate.
- ❌ (F-15): `reindexMaster` `.limit(500)` — a master listed in >500 tenants is
  only *partially* reindexed on every change; the tail goes stale until a full
  rebuild. Undocumented scaling cliff.
- `attributes: listing.attributes || {}` — TenantProduct has no `attributes`
  field; always `{}`. Dead.
- `soldCount30d: master.soldCount` — **`soldCount` is never incremented anywhere
  in the codebase** (verified: zero writes). The "popularity" sort and the
  ranking popularity signal are permanently 0. Either wire an `$inc` on order
  completion or delete the signal.

---

## 5. Controller + route layer

### 5.1 Thoroughness of the thin layer
Controllers are genuinely thin (parse → one service call → envelope). Route
order is deliberate (`/listings/bulk` before `/listings/:id`), and every
catalog route runs `authenticate + authorize + validate`. RBAC tiers:
- `/catalog/admin` → ADMIN, SUPER_ADMIN
- `/catalog/tenant` → ADMIN, SUPER_ADMIN, **VENDOR** (Phase 6.0 fix: previously
  any authenticated tenant user — including `customer` — could change prices;
  the route comment + smoke test both lock this in)
- `/catalog` public → tenantContext only

### 5.2 Validation wiring
`validate.js` runs Joi with `{abortEarly: false, stripUnknown: true, convert: true}`
and replaces `req[source]` with the coerced value. Consequences:
- ✅ `masterUpdateSchema` (forbids `skuGlobal/type`; no `status/version/searchText`)
  + stripUnknown = the admin master-update path is a true whitelist. My first
  suspicion (inject `status` to skip the deprecation cascade) **dies here** —
  good.
- ✅ `categoryCreateSchema`/`brandCreateSchema` have no `level`/`verification`/
  `_id` → mass-assignment of those fields is stripped.
- ❌ `changeRequestCreateSchema.payload/diff` = `Joi.object()` free-form → the
  whitelist **stops exactly at the change-request boundary** (F-03).
- ❌ (F-16) the four inventory routes (`PUT/PATCH/POST /listings/:id/stock…`)
  run **no body validation** — `inventoryOpSchema` exists in the validators file
  and is used **nowhere** (dead code). `PUT /stock` with `{}` → `qty=undefined`
  → `undefined < 0` is false → row "updated" with `qtyOnHand=undefined` (no-op
  save) + a misleading `stock_change` audit entry. `reserve/release` are saved by
  in-service `Number.isInteger` checks. The service-level checks mostly hold, but
  the contract is unenforced at the edge.
- `listingCreateSchema.price` requires **both** `mrp` and `sellingPrice` *when
  the price object is present* — but the price object itself is optional → the
  priceless-listing path (F-05) sails through the edge.

---

## 6. Cross-cutting middleware (the layer most likely to bite)

### 6.1 `tenantContext` ✅
Host-first tenant resolution (`{slug}.root` / verified custom domain), header
only when host didn't decide, `allowHeaderOverride` dev-only, unknown subdomain
→ 404 (deliberate anti-leak), default-tenant fallback. `req.tenantId` is always
set → the public controller's `req.tenantId || req.headers['x-tenant-id']`
fallback is dead code. One config-dependent caveat: with
`trustForwardedHost` on, `x-forwarded-host` becomes tenant-deciding — only safe
behind a proxy that strips inbound `x-forwarded-host`.

### 6.2 `authenticate` / `authorize`
- Tenant-scope guard: token tenant ≠ resolved tenant → 401 (super_admin exempt).
  Solid multi-tenant isolation for *authenticated* surfaces.
- ❌ (F-17): RBAC reads `req.auth.role` = **the role claim frozen in the JWT**,
  not the live DB role. A demoted admin keeps ADMIN until token expiry.
  (Also `payload.role !== 'super_admin'` is a raw string, not the enum.)
- User is loaded fresh every request (blocked/deleted checks are live) — good.

### 6.3 `errorHandler`
E11000→409 `DUPLICATE_KEY` (with `keyValue`), Mongoose ValidationError→400 with
per-field details, CastError→400, 413. Clean.
- ❌ (F-10): a `SyntaxError` from `new RegExp('(')` is **not** in the family
  list → 500 `INTERNAL_ERROR` for a malformed search param. (See also ReDoS.)

### 6.4 `responseCache` ❌❌ (F-01) — the biggest finding in the whole slice

```js
const tenantId = req.tenantId || 'public';
const key = `GET:${tenantId}:${req.originalUrl}`;
...
if (req.path.includes('/admin/') && req.user) return next();
```
1. **No user in the key.** The middleware runs *before* `authenticate`, so
   `GET /api/v1/users/me`, `GET /api/v1/cart`, `GET /api/v1/wallet` — all
   user-specific, all 2xx — are cached **per tenant, not per user** for 60s.
   User A's cart/profile/balance is served to user B of the same tenant
   (store staff accounts = same tenant by design). Cross-user data leak.
2. The "skip admin" guard checks `req.user`, which is **never set at this
   point** (authenticate runs later) → dead guard.
3. **`invalidateCache()` is never called from anywhere** (verified: zero
   call sites) → *every* GET, including the catalog (PLP 60s, search 30s,
   categories 5min), serves stale data after any write. A tenant price change
   keeps serving the old price to customers until TTL expiry — and the
   `search` path's "index stale → serve legacy" probe itself can be served from
   this cache.

### 6.5 `deduplicate` ⚠️ (F-18)
Mobile-retry idempotency via explicit `Idempotency-Key` or an implicit
`sha256(method+path+body)` fingerprint, 60s TTL, in-flight coalescing.
- The key space is **global, not tenant/user-scoped**: two different tenants
  POSTing byte-identical bodies to the same path (e.g. both listing the same
  global master at the same price) → tenant B receives tenant A's cached 201,
  i.e. A's listing ids.
- Implicit fingerprint means legitimate repeated *identical* writes within 60s
  (re-apply the same stock, re-save the same price) silently no-op and return
  the first response — for non-idempotent ops like `adjustStock(+5)`, a
  double-submit is a **lost update** rather than a double-apply.
- In-memory → per-instance (documented swap-to-Redis path exists).

### 6.6 Rate limits / timeout / CSRF
Global 300 req/15min/IP (Redis-backed when configured), 30s request timeout,
CSRF on the cookie-auth surfaces. Reasonable.

---

## 7. Async layer (worker / scheduler / search index)

- `worker.js`: poll loop → `reapExpired` → `drain` → scheduler `tick`.
  First tick immediate, timer unref'd, clean SIGTERM drain. The API process
  registers the same handlers (Set-based) and keeps a *manual* drain button —
  both use the same atomic claim path, so coexistence is safe.
- `scheduler.js`: code-defined jobs, persisted state, atomic `nextRunAt`
  expected-value claim for single-flight across workers. Nightly per-tenant
  maintenance isolates per-tenant and per-step failures.
- Search index freshness: events → indexer upserts; `freshnessCheck` reports
  (and optionally repairs) docs older than 24h; `reindexAll` is
  cursor-resumable (`_id`-based, not skip-based). Public controller adds a
  "legacy probe" — if the live catalogue has more rows than the index, serve
  the live scan (`indexState: stale_fallback`). That's a genuinely thoughtful
  degradation story.

---

## 8. Frontend layer

### 8.1 Admin console (`apps/web/src/features/catalog/`)
Full CRUD surface: `CatalogPage` (tenant listings + price/status/stock with
`expectedVersion` + VERSION_CONFLICT toasts + refresh), `CatalogOpsPage` +
`MastersPage` + `MasterFormModal`/`MasterDetailModal` (admin: create/edit
masters, variants, images, attributes, versioned everywhere), `CategoriesPage`,
`BrandsPage`, `ReviewQueuePanel`, `BulkPanel` (CSV upload + job polling),
`EventPanel` (outbox drain/retry/status), `AuditPanel`. The client-side
optimistic-lock UX (version from last fetch → 409 → "refresh and retry") is
exactly the pattern `optimisticLock.js` intends — which makes F-02 (the
in-memory check) more embarrassing: the whole UX invests in a lock the server
doesn't actually enforce atomically.

### 8.2 Storefront (`apps/storefront`)
`Product.jsx` PDP (variant selector, gallery with `imageSource` badges,
related products), `ProductCard`/`ProductSheet` with `primaryImageUrl` +
fallback semantics, `?groupBy=master` cards with variant dropdowns and price
ranges. The storefront is a faithful consumer of the read contracts — no
client-side reimplementation of catalog rules.

---

## 9. Test layer

- `smoke-catalog.test.js` (hermetic in-memory mongod): propose→approve,
  duplicate SKU 409, RBAC (tenant can't touch taxonomy; customer 403 on
  /catalog/tenant), listing create/availability, customer merged view,
  **stale-version 409**, price history, atomic reserve + over-reservation 409,
  change-request reject-then-approve, deprecate cascade, event/audit counts.
  Strong happy-path + a few adversarial edges.
- `smoke-catalog-variants.test.js`: variant listing matrix (case 1/2/3),
  nested galleries, primary resolution.
- `variant-images.test.js`: 9/9 pure-function assertions (passing here).
- `invariants.test.js`: 110 repo-wide structural invariants (passing here).
- **Not covered** (matches the findings): concurrent-writer races (F-02/F-04),
  category cycles (F-08), diff/payload injection (F-03), response-cache user
  scoping (F-01), priceless activation (F-05), PDP master-status gap (F-06),
  CSV export truncation (F-13).
- Hermetic suites need the `mongodb-memory-server` binary download — this
  sandbox has no egress to `fastdl.mongodb.org`, so I verified statically and
  ran the pure suites here; run `npm run test:unit` + `smoke:all` in CI.

---

## 10. Findings ledger (ranked)

| # | Sev | Where | Finding | Status |
|---|-----|-------|---------|--------|
| F-01 | **Critical** | `middleware/responseCache.js` + `app.js` | User-specific GETs (`/users/me`, `/cart`, `/wallet`) cached per **tenant** (no user in key; admin guard reads `req.user` before auth → dead). Cross-user data leak within a tenant. Additionally `invalidateCache` has **zero call sites** → catalog reads stale up to TTL after every write. | ✅ **FIXED** — per-identity cache key (auth hash), public-only allowlist (admin/tenant/user routes never cached), in-process invalidation bus (`utils/localEvents.js`) wired into `catalogEvent.publish`. 
| F-02 | **High** | `utils/catalog/optimisticLock.js` | Version check is in-memory on a stale fetch; `save()` is unguarded `updateOne({_id})`. Concurrent writers both succeed → lost updates on every master/listing write. Fix: conditional `updateOne({_id, version}, {$set, $inc})` + `matchedCount`. | ✅ **FIXED** — double check: fast in-memory + conditional `updateOne({_id, version}, {$set})` with `matchedCount` → 409 (`utils/catalog/optimisticLock.js`). 
| F-03 | **High** | `catalog.validators.js` (`changeRequestCreateSchema`) + `changeRequest.service.applyRequest` + `productMaster.applyGlobalPatch` | `payload`/`diff` are free-form `Joi.object()`; on approve, `diff.after` is `master.set()` with **no whitelist, no re-validation**. Tenant-supplied `{status:'active'}` resurrects REJECTED masters; `{status:'deprecated'}` skips the listing cascade; stale refs land unvalidated. | ✅ **FIXED** — `whitelistMasterPatch` choke point (global fields only) + re-validation on apply (`assertSlugFree`, duplicate check, category attributes). 
| F-04 | **High** | `changeRequest.service.review` | Check-then-save on `status` (no atomic claim) → concurrent double-approve double-applies (images ×2; double deprecate). The outbox in the same repo demonstrates the correct pattern. Also non-rollback: CR saved APPROVED before apply; apply failure ⇒ approved-but-not-applied, unretryable. | ✅ **FIXED** — atomic `findOneAndUpdate` claim (PENDING gate); failed apply compensates back to PENDING with `lastApplyError`; `appliedAt` idempotency stamp. 
| F-05 | **High** | `tenantProduct.service` + `listingCreateSchema` | Model contract "DRAFT→ACTIVE requires price set" is unenforced: price object optional at create, no price/master check on activation → priceless ACTIVE listing; cart snapshots `sellingPrice ?? 0` → **orderable at ₹0**. | ✅ **FIXED** — `assertActivatable` gate on create+activate (valid `sellingPrice`, master ACTIVE); public read path filters priceless listings. 
| F-06 | **Medium** | `catalog.public.controller.assembleProductPage` | PDP (`/products/:id`) never checks `master.status` (PLP + slug-PDP do). PENDING_REVIEW/REJECTED masters render public pages; REJECTED masters also have no listing cascade (only DEPRECATED does). Cart blocks non-ACTIVE masters, so no money leak — but the publish gate is inconsistent. | ✅ **FIXED** — master gate in `assembleProductPage` (PDP + stock check); reject cascade stages listings (can't activate on non-ACTIVE master). 
| F-07 | **Medium** | `productMaster.service.syncMasterExtras` | Master-image primary-clear `updateMany` not scoped `variantId: null` → demotes variant primaries when create payload has both. | ✅ **FIXED** — master primary-clear scoped `variantId: null`; per-variant primaries survive syncs. 
| F-08 | **Medium** | `category.service.update` | Cycle check one level deep (grandchild cycles possible) + `level` never cascades → admin tree returns `[]`; **public** `GET /catalog/categories` infinite-recurses (RangeError → 500). | ✅ **FIXED** — ancestor-walk cycle guard (`isAncestorOrSelf`), BFS `recomputeLevels`, cycle-safe `tree()`/`customerCategories` (visited sets, bounded). 
| F-09 | **Medium** | `brand.service.remove` | "Delete" = `status: INACTIVE` (not soft-delete), no outbox event, inconsistent with category/master removal contracts. | ✅ **FIXED** — brand delete = soft delete + audit + `brand_updated` outbox event (consistent with category/master). 
| F-10 | **Medium** | `productMaster.listMasters`, `tenantProduct.listListings`, `adminCatalog.list`, `catalogSearch.searchMasters` | Unescaped `new RegExp(userInput)`: `?search=(` → unhandled `SyntaxError` → 500; `(a+)+`-style → catastrophic backtracking (matched in Mongo). The *public* path escapes correctly — fix the other four to match. | ✅ **FIXED** — all five sites use shared `literalRegex` (escaped); public path standardized on the same util. 
| F-11 | **Medium** | `inventory.service.setStock/adjustStock` | Read-modify-write `save()`; concurrent adjustments lose updates (adjust should be `$inc` + floor guard). The Inventory `version` field promised by the model doc is never used; stock routes validate no body (dead `inventoryOpSchema`). | ✅ **FIXED** — `setStock` single upserting `$set`; `adjustStock` `$inc` + `$expr` floor guard; integer validation (no NaN writes). 
| F-12 | **Medium** | `inventory.service.reserve/release` + tenant routes | `qtyReserved` is tenant-writable with no order linkage/TTL while checkout commits against `qtyOnHand` only → displayed availability diverges from sellable stock; reservations never expire. | ✅ **FIXED** — tenant reserve/release endpoints removed (routes + controller + shared client + smoke suite); `qtyReserved` is saga-internal only. 
| F-13 | **Medium** | `adminCatalog.service` | `list()` loads **all** tenant listings into memory (unbounded) then paginates in JS; `csv()` silently truncates exports at 200 rows. | ✅ **FIXED** — single in-DB aggregation (per-master `$group`, `$facet` pagination); CSV pages at 200×50 with `exportComplete` + in-file truncation warning. 
| F-14 | **Low** | `bulkImport.service` + tenant route | Fire-and-forget `.catch(()=>{})`; in-memory jobs (lost on restart / 404 cross-instance); no row cap (1MB body ⇒ ~10⁴+ rows sequential); SKU-keyed price rows hit arbitrary variant listing; SKU-only create path uses `productMasterId: null`. | ✅ **FIXED** — `BULK_MAX_ROWS=5000` cap; deterministic master-level targeting; real masterId resolution; job crash → `failed` + logged (no silent swallow). 
| F-15 | **Low** | `searchIndexer.reindexMaster` | `.limit(500)` — masters listed in >500 tenants are partially reindexed (stale tail until full rebuild); undocumented. | ✅ **FIXED** — `_id` cursor pagination (BATCH×MAX_BATCHES); returns `{indexed, scanned}`. 
| F-16 | **Low** | `catalog.tenant.routes` stock endpoints | No body validation (dead `inventoryOpSchema`); `PUT /stock {}` = silent no-op + misleading audit entry. | ✅ **FIXED** — `stockSetSchema`/`stockAdjustSchema` (integers, bounds, `delta ≠ 0`); dead `inventoryOpSchema` removed. 
| F-17 | **Low** | `middleware/authorize.js` | RBAC on JWT-frozen role claim, not live DB role (stale-role window = token TTL); raw `'super_admin'` string. | ✅ **FIXED** — RBAC on the LIVE DB role (`user.role || payload.role`); super-admin exemption checked against the live value too. 
| F-18 | **Low** | `middleware/deduplicate.js` | Fingerprint/idempotency key space not tenant-scoped → identical bodies across tenants return the other tenant's cached 201; identical repeat non-idempotent writes within 60s silently drop. | ✅ **FIXED** — key space scoped by host + tenant header + auth hash; auto-fingerprint POST-only (PUT/PATCH never silently dropped); explicit idempotency keys unchanged. 
| F-19 | **Info** | `productMaster.model` / search index | `soldCount` is never incremented anywhere → popularity sort + ranking signal permanently 0 (`soldCount30d` mislabels lifetime count). | ✅ **FIXED** — `+$inc soldCount` on commit, `-$inc` on restore (`bumpSoldCount`, fire-safe: never fails the sale). 
| F-20 | **Info** | `models/plugins`, `enums`, services | Soft-delete filter absent from `updateMany/deleteMany/count` (ghost rows flipped by deprecate cascade); `ENTITY_STATUS2` dead enum; `listMasters` dead `sortBy` ternary; `addVariant` `actorType: 'admin' : 'admin'`; `searchDocument.attributes` always `{}`; unique keys held forever by soft-deleted/REJECTED rows (slug re-use 409s). | ✅ **FIXED** — `ENTITY_STATUS2` + dead code removed; unique keys now partial on `{isDeleted:false}` (schema + migration `003_softdelete_aware_unique_indexes.js`). 

**Verification** — `backend/scripts/catalog-fixes-pure.test.js` (35 pure unit tests: regex escaping, optimistic lock races, field whitelist, cache keying + invalidation, dedup scoping, cycle guard, live-role RBAC, stock guards, index declarations) and `backend/scripts/smoke-catalog-fixes.test.js` (hermetic adversarial end-to-end: concurrency races, CR smuggling, activation gates, dedup isolation, live-role demotion, slug re-use, cache invalidation). The pre-existing `smoke-catalog.test.js` was updated for F-12.

---

## 11. What's genuinely well-built (keep these)

1. **Field-ownership split** as a first-class concept with a single source of
   truth (`fieldOwnership.js`) and a real approval workflow for cross-boundary
   writes.
2. **Outbox with leased atomic claims, backoff ladder, DLQ + manual re-queue** —
   production-grade, correctly handles crashed workers and N-drainer races.
3. **Atomic inventory guards** (`$expr` in `findOneAndUpdate`) for
   reserve/release/commit — oversell protection that's actually race-safe.
4. **Variant-image resolution** — pure, tested, fallback semantics +
   `imageSource` provenance; the domain's best file.
5. **Public read path** — merged aggregation with correct publish gates,
   escaped search regex, bounded facets, stale-index probe with live fallback.
6. **Tenant isolation** — host-first tenant resolution with deliberate
   404-on-unknown-subdomain; token-tenant mismatch 401; every tenant query
   tenant-scoped (aggregations normalized to ObjectId).
7. **Error normalization** — E11000→409 with `keyValue`, per-field Joi details.
8. **Hermetic catalog smoke suite** covering RBAC, version conflicts,
   over-reservation, cascades, duplicate detection — the right invariants,
   just not the concurrency ones.
9. **BoundedCache everywhere** (dedup, response cache, bulk jobs) — no
   unbounded Map growth.
10. **Bulk listing contract** — per-row partial success with explicit
    `skipped` reasons is the right shape for a wizard-driven API.

## 12. Suggested fix order

1. **F-01** (security): key response cache on auth identity (or exclude
   user-scoped routes), actually call `invalidateCache` from catalog writes —
   or drop the middleware for non-idempotent-adjacent GETs.
2. **F-02/F-04** (correctness): conditional atomic version updates for
   listings/masters; atomic status claim for change-request review; make
   `review` apply-then-mark (or retryable on failure).
3. **F-03/F-05/F-06** (integrity): whitelist `diff.after` to
   `MASTER_GLOBAL_FIELDS` + re-validate on apply; require `sellingPrice != null`
   on activation; check `master.status === ACTIVE` in `assembleProductPage` (or
   cascade on REJECT).
4. **F-08/F-10** (availability): deep cycle check (walk ancestors) + level
   recompute; escape search regexes in the four list paths.
5. **F-11/F-12** (stock): `$inc`-based adjust; either remove the tenant
   reserve/release endpoints or wire them to real holds with TTL.
6. Rest per ledger.
