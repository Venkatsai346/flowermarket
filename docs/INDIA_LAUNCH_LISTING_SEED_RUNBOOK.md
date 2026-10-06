# India Launch Tenant Listing Seed

This seed materializes variant-level `TenantProduct` rows from the governed India launch master catalog. It is separate from the production, sandbox, and legacy listing seeds.

## Scope

| Code | Tenant | Catalog scope | Expected masters | Expected variant listings |
|---|---|---|---:|---:|
| `FLOWER1` | `6a97b0e9a61173c01d040435` | Flowers | 60 | 120 |
| `FLOWER2` | `6aa2acaaf23bef4d46ce4c1e` | Flowers | 60 | 120 |
| `GROCERY` | `6ab7a306154d0153e5aae538` | Grocery | 164 | 328 |
| `FASHION` | `6aba82c6ee308adc0c75e9c8` | Fashion | 128 | 384 |
| `DAIRYEGG` | `6aba8342ee308adc0c75eb18` | Dairy and eggs | 72 | 144 |
| `ELECTRO` | `6aba83a1ee308adc0c75ec46` | Electronics | 172 | 344 |
| `BEAUTY` | `6aba8405ee308adc0c75ed44` | Beauty | 116 | 232 |
| `VEGGIES` | `6aba847eee308adc0c75ee7b` | Vegetables | 276 | 552 |

Expected total: **2,224 active variant listings**. Counts are contract-tested from the deterministic launch registry.

## Required order

The original 1,000-master selection ended before the flower section. The current product registry preserves those 1,000 identities and appends 60 flower masters, producing 1,060 masters and 2,248 variants without rewriting existing SKUs.

Launch listings require active masters. Existing pending-review launch masters are approved only when the explicit activation command is used:

```powershell
npm run catalog:india:products:activate
npm run catalog:india:listings:validate
npm run catalog:india:listings:plan
npm run catalog:india:listings:seed
```

The activation run is audited as a super-admin lifecycle decision. The listing plan is a real-database dry run and changes nothing.

## Safety and ownership

- Actor defaults to super-admin `6a97b0e9a61173c01d040435` and must resolve to an active `super_admin` user.
- Every configured tenant must exist and be active.
- Only masters tagged `india-launch-2026` are considered.
- Vertical scope is derived from governed launch tags, never title matching.
- Every active master must have active variants; listing rows are always variant-specific.
- Exact merchant-owned listing collisions are never overwritten.
- Seed-owned seller SKUs use the `INL26-` marker and are deterministically reconciled.
- Apply requires the explicit `--acknowledge-launch-listings` flag (included in the npm seed command).
- Writes are chunked and resumable. Reruns create only missing rows and repair seed-owned rows.
- Inventory never drops below reserved quantity.
- Search documents are rebuilt per tenant and checked after apply.
- The script never creates or deletes tenants, masters, variants, categories, or brands.

## Tenant-scoped operation

Plan or apply one store by code or ObjectId:

```powershell
npm run catalog:india:listings:plan -- --tenant=FLOWER1
npm run catalog:india:listings:seed -- --tenant=6aba83a1ee308adc0c75ec46
```

Valid codes are `FLOWER1`, `FLOWER2`, `GROCERY`, `FASHION`, `DAIRYEGG`, `ELECTRO`, `BEAUTY`, and `VEGGIES`.

## Generated listing data

Every listing receives deterministic, category-aware values for:

- seller SKU;
- MRP, selling price, cost price, INR currency, and tax-inclusive policy;
- exact variant price basis and catalog unit;
- minimum and maximum order quantities;
- stock snapshot and aligned default-location inventory;
- availability state;
- backorder, preorder, availability-window, and lead-time policy;
- merchandising badges, featured state, and search boost;
- storefront, marketplace, POS, and wholesale channel flags;
- active lifecycle status and actor/timestamp metadata.

Pricing uses vertical and leaf-category profiles plus a deterministic bounded adjustment. It is launch data, not a substitute for merchant pricing review.
