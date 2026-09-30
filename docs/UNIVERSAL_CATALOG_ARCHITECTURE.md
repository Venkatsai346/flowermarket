# Universal Catalog Architecture

## Gap assessment

The seven gaps identified after the first universal-product release were valid. They are not enum gaps; each is a separate graph, governance, or commerce concern.

| Capability | Canonical owner | Integrity boundary | Public projection |
|---|---|---|---|
| Variant EAV | `ProductVariantAttributeValue` | Category schema scope, typed projection, unique variant/key | Exact SKU attributes and search tokens |
| Units/conversion | `ProductMaster.unitPolicy`, `ProductVariant.sellQuantity`, `TenantProduct.priceBasis` | One factor-1 base unit, bounded unique units, fractional policy | Price basis, available units, invoice UQC |
| Pack hierarchy | `ProductPackage` | Same-master variant references, unique codes/barcodes, acyclic contained-package graph | Pack levels and quantities |
| Bundle components | `ProductBundleComponent` | Bundle-only ownership, live component/variant references, recursive-cycle rejection | Included products, variants, quantities and selection groups |
| Compliance entities | `ProductCompliance`, `Category.complianceRequirements` | Evidence, validity periods, jurisdiction and activation/checkout gates | Verified, unexpired records only |
| Option dependencies | `ProductMaster.optionRules` | Defined dimensions/values, no contradictory values, SKU combination validation | Existing compatible combinations and selectors |
| Strong integrity | Models + `catalogStructure.service` + migrations | CAS version claims, transactions with standalone compensation, unique indexes, reference guards and integrity reports | Publish gate and integrity score |

## Product graph

```text
Category
  ├─ typed attribute definitions (master / variant / both)
  └─ compliance requirements

ProductMaster
  ├─ options + dependency rules
  ├─ unit policy
  ├─ ProductAttributeValue[]
  ├─ ProductVariant[]
  │    └─ ProductVariantAttributeValue[]
  ├─ ProductPackage[]             (acyclic hierarchy)
  ├─ ProductCompliance[]          (master or variant scoped)
  ├─ ProductBundleComponent[]     (when kind=bundle; acyclic product graph)
  └─ ProductImage[]

TenantProduct
  ├─ seller/channel offer
  ├─ price + price basis
  ├─ policy + merchandising
  └─ inventory linkage
```

## Invariants

1. Option and unit codes are stable normalized identities; labels are presentation.
2. Every multidimensional SKU has one canonical order-independent combination key.
3. Option rules may only reference values declared by the product and are enforced on create, edit, and option-vocabulary changes.
4. Unit conversion uses a product-local base graph. Factors are positive, unit codes are unique, and the base factor is exactly one.
5. Pack trees and bundle graphs cannot contain cycles.
6. A component variant must belong to its component master. A package variant and a compliance variant must belong to their target master.
7. Referenced variants and bundle components cannot be retired silently.
8. Category-required compliance blocks listing activation and cart/checkout revalidation until valid evidence is verified.
9. Only verified, unexpired compliance is public. Draft evidence and internal metadata never cross the storefront boundary.
10. Structural replacements validate first and then use a MongoDB transaction. Standalone Mongo deployments use compensating restoration instead of accepting partial state.
11. Every structural write claims the product version first, emits audit history, and enters the catalog outbox for search refresh.
12. Cart and order snapshots preserve both unit code and price-basis quantity; invoices emit the corresponding GST UQC and normalized quantity.

## Compatibility

Migration `005_catalog_structural_entities` backfills a one-unit policy from every legacy `defaultSellingUnit`. Existing flower variants, prices, cart quantities, and selling units remain valid. New collections are additive, while legacy scalar fields remain compatibility projections.
