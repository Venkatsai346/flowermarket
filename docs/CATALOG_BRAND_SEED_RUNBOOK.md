# Catalog brand registry seed runbook

This runbook installs the comprehensive launch brand registry aligned with every governed leaf category in the Catalog Guidance Book.

## Coverage

The blueprint currently contains:

- **341 globally deduplicated brand documents**
- **27 governed leaf categories covered**
- **409 category-to-brand coverage relationships**
- **39 cross-category brands merged into one global identity**

Coverage includes flowers, bouquets, plants, seeds, smartphones, tablets, laptops, TVs, monitors, audio, wearables, cameras, appliances, furniture, apparel, footwear, jewellery, cosmetics, supplements, medical devices, packaged food, fresh produce, publishers, toys, automotive parts, batteries, software, services and gift hampers.

The Brand model is intentionally global and does not store category IDs. Category affinity exists in the seed blueprint to prove complete assortment coverage and deduplicate names; one Brand document is shared by products in every applicable category.

## Ownership and governance

The default audited actor is:

```text
6a97b0e9a61173c01d040435
```

The database-backed plan and apply commands verify that this user exists and is an active `super_admin`.

A seeded name is a registry candidate, not proof of trademark ownership, authorized distributorship, product authenticity or regulatory approval. New documents are deliberately created with:

```text
verification.status = pending
verification.isVerified = false
verification.verifiedAt = null
```

Verification must happen through the existing platform governance workflow after evidence review.

## Media behavior

As required, new brand documents use:

```text
logoUrl = null
bannerUrl = null
```

The script also leaves tagline, descriptions, story, website, social links, origin and headquarters empty rather than inventing claims.

On existing brands, the script preserves:

- logo and banner;
- tagline, descriptions and story;
- website and social links;
- origin, foundation year and headquarters;
- active/inactive/archived status;
- featured ordering and curation;
- verification status and timestamps;
- existing ObjectId and all product references.

Only a conflicting canonical name or slug is corrected on an existing document.

## Safety guarantees

- Dry-run is the default.
- Pure validation requires no database connection.
- The script validates every category assignment against the canonical category playbooks.
- Every governed leaf category must have brand coverage.
- Duplicate names within a category are rejected.
- Globally repeated names are merged into one document.
- Generated slug collisions are rejected before database access.
- Every create payload is checked against the backend Joi brand contract.
- The actor and all 27 prerequisite leaf categories are verified before planning.
- Existing slug/name identity collisions stop execution for manual review.
- Writes use `brandService`, retaining normal audits and catalog events.
- The operation is deterministic, idempotent and resumable.
- Unknown, custom, local and future brands are never deleted or archived.
- Existing media and curation are never overwritten.

## Recommended release sequence

### 1. Back up

Take a database snapshot or export at least:

- `brands`
- `productmasters`
- audit records
- catalog event/outbox records

### 2. Ensure taxonomy exists

Apply and verify the category taxonomy first. The brand plan refuses to run if any of the 27 governed leaf category slugs is missing.

```bash
cd backend
npm run catalog:taxonomy:plan
npm run catalog:taxonomy:seed -- --accept-product-impact
```

Use the impact flag only when the category runbook says it is required.

### 3. Validate without connecting

```bash
npm run catalog:brands:validate
```

Expected result:

```text
341 unique brands
27 governed leaf categories
409 category/brand relationships
39 multi-category brands deduplicated
```

### 4. Run a database-backed dry plan

```bash
npm run catalog:brands:plan
```

This checks the actor, confirms taxonomy prerequisites and reports every create/update without writing.

### 5. Apply in staging

```bash
npm run catalog:brands:seed
```

To create new brands as inactive rather than active:

```bash
npm run catalog:brands:seed -- --inactive
```

### 6. Verify staging

Confirm:

1. The plan is idempotent on a second run (`unchanged` for every row).
2. New brand media is empty.
3. Existing media and curation did not change.
4. Cross-category brands such as Apple, Samsung, Sony and Philips exist only once.
5. New brands are unverified/pending.
6. Product master brand selectors load the registry successfully.
7. Audit and catalog event records carry the supplied super-admin actor.
8. No custom/local brands were removed.

### 7. Apply to production

Repeat the reviewed command during a controlled release window.

## Commands

```bash
# Contract and coverage validation; no DB
npm run catalog:brands:validate

# DB-backed plan; no writes
npm run catalog:brands:plan

# Apply, creating new rows active but unverified
npm run catalog:brands:seed

# Apply, creating new rows inactive and unverified
npm run catalog:brands:seed -- --inactive

# Use another active super-admin actor
npm run catalog:brands:plan -- --actor=<OBJECT_ID>

# Controlled recovery: continue independent rows and exit non-zero with failures
npm run catalog:brands:seed -- --continue-on-error
```

## Reruns and recovery

The script writes sequentially through the domain service because ordered audit and outbox publication matter more than raw insertion speed for this bounded registry. If interrupted, rerun the plan and apply. Completed brands become `unchanged`; missing brands resume safely.

`--continue-on-error` is available for controlled recovery. Every failed brand is reported and the final process exits non-zero.

## Maintaining the registry

Edit `backend/src/data/catalogBrandBlueprints.js` when adding brands or category affinities. The pure validation command protects category coverage, duplicates, slugs and API compatibility. Brand reality is open-ended: regional, private-label and newly launched brands should continue to enter through governed CRUD rather than requiring destructive reseeding.
