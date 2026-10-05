# Catalog taxonomy seed runbook

This runbook installs the category hierarchy represented by the Catalog Guidance Book into MongoDB.

## What it creates

- **11 root departments**
- **19 navigation sections**
- **27 governed leaf categories**
- **259 typed attribute-schema fields**, including **164 required fields**
- **88 compliance requirements**, including **55 required** and 33 conditional requirements

Only leaf categories carry product schemas and compliance requirements. Parent and section nodes are navigation/taxonomy containers.

The hierarchy covers flowers and plants, electronics, home and appliances, fashion, health and beauty, grocery and food, media and education, kids and toys, automotive, digital products and services, and bundles.

## Ownership

The default audit actor is the supplied super administrator:

```text
6a97b0e9a61173c01d040435
```

Before planning or applying, the script verifies that this ID exists and belongs to an **active `super_admin`**. Override it only when intentionally running under another active super administrator:

```bash
npm run catalog:taxonomy:plan -- --actor=<OBJECT_ID>
```

## Safety properties

- Dry-run is the default.
- The complete blueprint and backend Joi contract are validated before connecting or writing.
- Slugs, parent references, attribute keys, bounds and compliance codes are checked.
- Writes use the existing category service, producing normal audit entries and catalog events.
- The process is deterministic, idempotent and safely resumable after interruption.
- Existing documents are updated only when governed data differs.
- Unknown/custom categories are not deleted or archived.
- Legacy `plants` is safely adopted as canonical `live-plants` when there is no conflicting canonical row; its ObjectId and product references are preserved.
- If both legacy and canonical rows exist, execution stops for a manual merge rather than guessing.
- New categories start with `imageUrl`, `iconUrl` and `bannerUrl` set to `null`.
- Existing media is **never overwritten**, including on repeated runs.
- Existing `status` and `isFeatured` curation choices are preserved; new rows start active and not featured.
- Existing category IDs are retained, preserving product references.
- An update affecting categories referenced by active or pending products is blocked unless its impact is explicitly acknowledged.

## Recommended deployment sequence

### 1. Back up production

Take a database snapshot or an export of at least:

- `categories`
- `productmasters`
- `catalogaudits` / the configured audit collection
- the catalog event/outbox collection

### 2. Validate without a database

```bash
cd backend
npm run catalog:taxonomy:validate
```

Expected summary:

```text
11 roots · 19 sections · 27 leaf categories
259 attribute fields (164 required)
88 compliance requirements (55 required)
```

### 3. Run a database-backed plan

```bash
npm run catalog:taxonomy:plan
```

This verifies the actor and prints every create/update plus referenced-product impact. It makes no changes.

### 4. Review product impact

If an existing leaf schema changes, inspect products reported against it. New required attributes and compliance requirements may require product backfill and review.

The script refuses to alter referenced active/pending categories unless this is acknowledged:

```bash
npm run catalog:taxonomy:seed -- --accept-product-impact
```

Do not use that flag as a shortcut. Prepare a backfill/review plan first.

### 5. Apply in staging

```bash
npm run catalog:taxonomy:seed -- --accept-product-impact
```

Without existing referenced products, `--accept-product-impact` is unnecessary.

### 6. Verify in the console

Check:

1. Root → section → leaf hierarchy and ordering.
2. Media remains empty on newly inserted categories.
3. Existing category media remains unchanged.
4. Smartphone and another regulated category show all required schema and compliance rows.
5. Master creation renders master and variant-scoped typed controls correctly.
6. Category tree, storefront navigation and search facets remain healthy.
7. Audit and category event records identify the supplied super administrator.

### 7. Apply to production

Repeat the exact validated command against production during a controlled release window.

## Commands

```bash
# Pure validation; no database connection
npm run catalog:taxonomy:validate

# Database-backed dry run; no writes
npm run catalog:taxonomy:plan

# Apply when no referenced-product schema impact exists
npm run catalog:taxonomy:seed

# Apply after explicitly reviewing referenced-product impact
npm run catalog:taxonomy:seed -- --accept-product-impact

# Continue independent branches after a row error; exits non-zero and reports failures
npm run catalog:taxonomy:seed -- --accept-product-impact --continue-on-error
```

## Reruns and failures

The seed is upsert-like but intentionally uses the domain service instead of raw bulk replacement. This preserves cycle checks, levels, audits, events and compliance side effects. If a process stops midway, rerun the plan and then apply; completed rows become `unchanged`.

`--continue-on-error` is intended for controlled recovery only. A failed parent causes its descendants to fail safely because no unresolved parent is guessed. The final process exits non-zero when any row failed.

## What the script deliberately does not do

- It does not delete or archive custom categories.
- It does not populate category media.
- It does not invent compliance verification records for products.
- It does not silently backfill product attribute values.
- It does not activate or approve products.
- It does not treat the playbooks as legal advice; accountable operators must confirm current applicability for exact products and jurisdictions.
