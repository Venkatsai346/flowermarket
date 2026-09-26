# Catalog Product-Master Seed Runbook

## Purpose

`backend/scripts/seed-catalog-product-masters.js` creates the complete product-master and variant registry documented in [`PRODUCT_MASTER_VARIANT_REFERENCE_CATALOG.md`](./PRODUCT_MASTER_VARIANT_REFERENCE_CATALOG.md).

The seed is deterministic, dependency-aware, dry-run-first, idempotent, and resumable. It creates **no categories and no brands**. Every master resolves and reuses the category and brand documents already present in the target database.

## Fixed scope

| Entity | Expected total |
|---|---:|
| Governed leaf categories | 27 |
| Unique existing brands | 341 |
| Category–brand relationships | 409 |
| Product masters | 409 |
| Variants | 1,227 |
| Master-level category attributes | 3,340 |
| Variant-level category attributes | 2,226 |
| Pending compliance records | 1,403 |
| Category-required compliance records represented | 952 |
| Bundle component relationships | 28 |
| Unique master + variant SKUs | 1,636 |
| Master media | 0 |
| Variant media | 0 |

The default audited actor is the supplied super-admin:

```text
6a97b0e9a61173c01d040435
```

The script verifies that this user exists and is an active `super_admin` before planning database writes.

## Safety contract

- No `--apply` means a database-backed dry run. Nothing is written.
- `--validate-only` does not connect to MongoDB.
- Categories are resolved by exact governed slug and must be active, non-root, and not deleted.
- Brands are resolved by canonical name and slug and must be active and not deleted.
- Missing, duplicate, inactive, or ambiguous dependencies stop the run.
- The script never creates, substitutes, renames, verifies, or updates category or brand records.
- SKU, slug, title, category, brand, schema, and cross-master variant-SKU collisions stop the run.
- Existing complete deterministic records are unchanged.
- Existing deterministic records with missing required attributes or variants are repaired without replacing complete records.
- Existing editorial changes, extra attributes, extra variants, lifecycle state, and tenant listings are preserved.
- New reference masters default to `pending_review`. Activating unverified reference data requires the explicit `--active` flag.
- Master and variant media arrays are hard-validated as empty.
- Every category-defined master and variant EAV field—required and optional—is populated and validated against both the canonical playbooks and the actual category schemas in MongoDB.
- Every category compliance requirement is materialized as a product-level `pending` record with jurisdiction, governance metadata, and no fabricated evidence.
- Existing verified/pending/rejected compliance records and their evidence are preserved; reruns append only missing canonical requirement records.
- Existing operator-authored bundle compositions are never replaced; empty seeded bundles receive deterministic physical-product components.
- Legacy textual placeholders are replaced during repair, while unrelated operator-authored attributes and extensions are preserved.

## Prerequisites

1. Back up the target database.
2. Deploy the application revision containing this script and the universal catalog migrations.
3. Ensure the taxonomy seed has already created all 27 governed leaf categories.
4. Ensure the brand seed has already created all 341 brands.
5. Confirm the target MongoDB connection variables are set for the intended environment.
6. Confirm super-admin `6a97b0e9a61173c01d040435` is active.
7. Review placeholder and evidence warnings in `PRODUCT_MASTER_VARIANT_REFERENCE_CATALOG.md`.

Never point the command at production until the plan output has been reviewed against a recent backup.

## Commands

Run commands from `backend/`.

### 1. Offline blueprint and mutation-contract validation

```bash
npm run catalog:products:validate
```

Expected summary:

```text
409 product masters · 1227 variants · 27 categories
341 unique brands · 409 category/brand relationships
1636 unique master/variant SKUs · 0 media records
3340 master attributes · 2226 variant attributes · 1403 pending compliance records
28 deterministic bundle component relationships
```

### 2. Database-backed dry run

```bash
npm run catalog:products:plan
```

The plan reports:

- dependency validation;
- schema compatibility;
- collisions;
- masters to create;
- incomplete deterministic masters to repair;
- complete masters that remain unchanged.

A first run against an empty product registry should report:

```text
create 409 · repair 0 · unchanged 0
```

### 3. Apply as pending review — recommended

```bash
npm run catalog:products:seed
```

This creates reference masters as `pending_review`, allowing catalog operators to replace placeholders and verify factual details before global activation.

### 4. Apply as active — explicit risk acceptance

```bash
npm run catalog:products:seed -- --active
```

Use this only if the reference records have been reviewed and it is acceptable for active product masters to become globally discoverable. Category-required compliance remains `pending` until evidence is completed.

### 5. Override the actor when formally approved

```bash
npm run catalog:products:plan -- --actor=<ACTIVE_SUPER_ADMIN_OBJECT_ID>
npm run catalog:products:seed -- --actor=<ACTIVE_SUPER_ADMIN_OBJECT_ID>
```

The supplied actor remains the default; overrides must also resolve to an active super-admin.

### 6. Continue past independent failures

```bash
npm run catalog:products:seed -- --continue-on-error
```

This is intended for controlled recovery only. The command exits unsuccessfully when any row fails and prints each failed master SKU. Correct the cause and rerun normally.

## Creation behavior

Each new master is created through `productMasterService.createMaster`, preserving canonical normalization, duplicate detection, category validation, audit recording, search text, outbox events, variant combination identities, and unit-quantity checks.

Each reference master contains:

- exact existing category and brand references;
- identity, descriptions, tags, SEO, warranty, fulfilment, and unit policy;
- all master-scope category attributes, including every required field;
- controlled option definitions;
- exactly three variants with unique SKUs and one default;
- all variant-scope EAV rows, including every required field;
- every category compliance requirement as a pending, jurisdiction-aware record;
- deterministic non-recursive components for bouquet and gift-hamper bundle masters, unless an operator has already authored a composition;
- zero master images;
- zero variant images.

## Idempotence and recovery

A rerun classifies every blueprint row as:

- `CREATE`: no deterministic master exists;
- `REPAIR`: the exact master exists but expected category attributes, variants, variant attributes, or compliance requirement records are missing;
- `UNCHANGED`: all expected seed-owned structural records exist.

Repair mode only adds missing deterministic structure. It does not reset titles, descriptions, SEO, lifecycle status, category, brand, complete variants, extra variants, or operator-authored extensions.

If a run is interrupted:

1. Do not manually duplicate the failed SKU.
2. Rerun the database-backed plan.
3. Review the `repair` count and collision output.
4. Correct missing dependencies or data conflicts.
5. Rerun `--apply`.
6. Re-run the plan and require `create 0 · repair 0 · unchanged 409`.

## Post-apply verification

Run the plan again:

```bash
npm run catalog:products:plan
```

Require:

```text
create 0 · repair 0 · unchanged 409
```

Then verify in the admin console:

1. Search several deterministic SKUs across unrelated categories.
2. Confirm the exact category and brand appear.
3. Confirm three variants and exactly one default variant.
4. Confirm master and variant galleries are empty.
5. Confirm required master and variant specifications appear.
6. Confirm regulated categories remain blocked or pending until real compliance evidence is supplied.
7. Replace every `0000000000000`, `<REPLACE…>`, `verify`, generic model, warranty, ingredient, origin, and performance value before commercial publication.

## Governance warning

This seed creates structurally complete reference/demo catalog identities, not verified commercial claims. A real brand name does not prove that the brand manufactures, authorizes, certifies, or sells the illustrative product. Compliance rows deliberately remain `pending` with empty evidence arrays: software cannot truthfully manufacture certificates, licence numbers, issuer references, expiry dates, or regulator evidence. Never promote those rows to `verified`, and never activate a commercial listing, until an authorized operator attaches authoritative evidence. Never invent or retain placeholder GTIN, barcode, ISBN, HSN, FSSAI, BIS, CDSCO, hallmark, battery, safety, ingredient, warranty, or origin data in a published record.
