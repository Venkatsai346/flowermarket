# Catalog schema → authoring coverage

This matrix is the frontend contract for catalog CRUD. “System-owned” fields are intentionally visible/read-only or derived; allowing arbitrary edits would violate audit, inventory, review, or search invariants.

| Backend owner | Operator-authorable coverage | System-owned / derived |
|---|---|---|
| `ProductMaster` | Identity, taxonomy, descriptions, barcode, tags, manufacturer/model/origin, GTIN/MPN/ISBN/HSN, condition, warranty, SEO, option vocabulary/rules, unit policy, fulfillment measurements/class/flags, perishability/cold chain, selling unit and order defaults | status/review, compliance aggregate, version, creator, sold count, vendor attribution, marketplace timestamp, search text, audit/delete metadata |
| `ProductVariant` | Legacy and multidimensional identity, label, SKU/barcode/GTIN/MPN, weight/dimensions, sell quantity/unit, order/default/status, variant gallery | canonical combination key, audit/delete metadata |
| Master and variant EAV | Category-scoped typed string/text/number/boolean/select/multi-select/date/JSON values and units | typed query projections (`textValue`, `numberValue`, etc.) and sort projection |
| `ProductImage` | Scope, URL/upload, alt text, media type, role, MIME, dimensions, file size, focal point, primary and order | uploader, lifecycle/audit metadata |
| `ProductPackage` | Variant scope, code/label/level/contained pack, quantity/unit, SKU/barcode/GTIN, weight/dimensions, status/order | resolved containment id and audit metadata |
| `ProductBundleComponent` | Product/variant reference, quantity/unit, selection group, required/default, min/max selections, adjustment, status/order | graph identity and audit metadata |
| `ProductCompliance` | Product/variant scope, type/code/title/authority, jurisdiction/regions, status, validity, issuer reference, evidence metadata/checksum, restrictions and structured metadata | verifier identity/time and audit metadata |
| `TenantProduct` | Seller SKU, complete price/sale/tax policy, price basis, order limits, availability policy, merchandising, all channels, opening/current stock and lifecycle status | tenant/master identity, inventory-derived availability, rating aggregate, version and mutation timestamps |
| `Category` | Identity/tree/media, complete attribute schema semantics, compliance requirements, curation/status/order | audit/delete metadata |
| `Brand` | Identity/media/copy/provenance/site/social links, curation/status/order | verification actor/time and audit/delete metadata |

## Draft recovery

Product-master, single-listing and bulk-variant listing forms autosave account-scoped drafts in browser local storage after a short debounce. Recovery is explicit: server data is never silently replaced. Successful submission clears the draft, while accidental navigation, refresh, browser close, or modal dismissal preserves it. Dirty pages also participate in the browser’s unload warning.
