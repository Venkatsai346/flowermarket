# Non-compliance Sandbox Taxonomy & Product Registry

## Purpose

These are **additional**, parallel seeds for integration, storefront, listing, search, cart and order testing. They do not modify the canonical taxonomy or canonical product seed.

The sandbox intentionally removes category-level compliance gates while retaining every mandatory category attribute. It is visually and technically namespaced with `sandbox-*` slugs and `Sandbox · …` names so operators cannot confuse it with the governed production taxonomy.

> **Do not use this taxonomy to publish regulated real-world goods.** Absence of a software compliance requirement does not remove legal obligations. The apply commands require an explicit `--acknowledge-noncompliant-sandbox` flag.

## Deterministic coverage

| Structure | Count |
|---|---:|
| Sandbox roots | 11 |
| Sandbox sections | 19 |
| Sandbox leaf categories | 27 |
| Total sandbox categories | 57 |
| Mandatory category attribute definitions | 164 |
| Category compliance requirements | **0** |
| Reused existing brands | 341 |
| Category/brand relationships | 409 |
| Product masters | 1,227 |
| Variants | 3,681 |
| Mandatory master EAV rows | 6,216 |
| Mandatory variant EAV rows | 4,752 |
| Bundle component relationships | 84 |
| Compliance records | **0** |
| Product-master media | **0** |
| Variant media | **0** |

The product volume comes from three deterministic product families for each of the 409 canonical category/brand relationships. Every master has exactly three variants and one default variant.

## Safety guarantees

- Canonical category slugs and documents are never read as mutation targets.
- Sandbox slugs always begin with `sandbox-`; slug collisions fail closed.
- Existing brands are resolved by exact normalized name or canonical slug and are never created or modified.
- Missing categories or brands stop the product seed before writes begin.
- Both scripts are dry-run-first, idempotent, resumable and collision-aware.
- Product repair only fills missing mandatory master EAV, variants, variant EAV and empty bundle composition.
- Operator-authored attributes, extensions, lifecycle status and bundle compositions are preserved.
- Category repair preserves all operator media and curation fields.
- Product and variant media are always empty on creation.
- All writes use the existing domain services, optimistic versions, audit records and catalog events.
- Super-admin defaults to `6a97b0e9a61173c01d040435` and can be overridden only with `--actor=<ObjectId>`.

## 1. Offline validation

No database connection is required.

```bash
cd backend
npm run catalog:sandbox:taxonomy:validate
npm run catalog:sandbox:products:validate
```

Expected coverage:

```text
11 roots · 19 sections · 27 leaves
164 mandatory attribute definitions · 0 compliance requirements

1227 masters · 3681 variants · 27 categories
341 existing brands · 409 category/brand relationships
6216 mandatory master EAV · 4752 mandatory variant EAV
84 bundle component relationships · 0 compliance records · 0 media records
```

## 2. Database-backed plans

Configure the intended MongoDB target, then run plans before any apply:

```bash
npm run catalog:sandbox:taxonomy:plan
npm run catalog:sandbox:products:plan
```

The product plan must run after the taxonomy exists. On a new target, therefore apply the taxonomy before requesting the product plan.

## 3. Apply the sandbox taxonomy

```bash
npm run catalog:sandbox:taxonomy:seed -- --acknowledge-noncompliant-sandbox
```

If a later schema repair affects already-created sandbox products, review the plan and explicitly allow it:

```bash
npm run catalog:sandbox:taxonomy:seed -- \
  --acknowledge-noncompliant-sandbox \
  --accept-product-impact
```

## 4. Apply the sandbox products

Safe default: create masters as `pending_review`.

```bash
npm run catalog:sandbox:products:seed -- --acknowledge-noncompliant-sandbox
```

For a dedicated test database where immediate listing activation is intentional:

```bash
npm run catalog:sandbox:products:seed -- \
  --acknowledge-noncompliant-sandbox \
  --active
```

`--active` is never implied. It is an explicit operator decision because active masters become eligible for tenant listings and search indexing. It applies only when a master is first created; reruns never override an operator-managed lifecycle status.

## Resume and retry

Both scripts can be rerun after interruption. Use `--continue-on-error` only when you want a complete failure inventory; the default stops on the first failed domain write.

```bash
npm run catalog:sandbox:products:seed -- \
  --acknowledge-noncompliant-sandbox \
  --continue-on-error
```

After a successful apply, rerun the corresponding plan. A settled registry reports all rows as `unchanged`.

## Publication semantics

A no-compliance sandbox master defaults to `complianceStatus: not_required` because its category defines no compliance requirements. Storefront publication still requires an active master, active tenant listing, valid selling price, enabled storefront channel, valid variant and plan entitlement. Search re-indexing does not activate drafts and does not bypass those gates.
