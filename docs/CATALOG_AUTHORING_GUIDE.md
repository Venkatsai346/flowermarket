# Catalog authoring guidance book

**Audience:** platform catalog operators, reviewers, tenant store owners and listing managers  
**In-product location:** Admin Console → Catalog deep admin → **Guidance book**  
**Source of maintained category templates:** `frontend/apps/web/src/features/catalog/catalogGuidance.js`

This guide explains how to turn a real-world product into four deliberately separate records:

1. **Category** — the governed vocabulary: typed specifications and compliance requirements.
2. **Product master** — shared global truth: identity, options, factual content, fulfilment profile and references.
3. **Variant** — one valid, stock-bearing combination such as `ram=8 GB, storage=256 GB, color=Blue`.
4. **Tenant listing** — one store’s offer: seller SKU, quantity identity, price, stock, availability, merchandising and channels.

Keeping these layers separate prevents the most common catalog failures: duplicate products, prices embedded in global copy, colour/size combinations without inventory identity, ambiguous quantity, expired evidence, and listings that promise what fulfilment cannot deliver.

## How to use the book

### Platform catalog team

1. Open **Category playbooks** and choose the closest leaf category.
2. Create the category schema using the recommended stable keys, types, scopes, groups and facets.
3. Confirm every compliance requirement with the responsible legal/compliance owner. Mark genuinely conditional requirements as conditional.
4. Open **Build a product master** and create one representative product.
5. Run **Pre-publish review** through search, PDP, selected variant, cart, fulfilment, invoice and return history.
6. Only then scale imports or permit proposals against the category.

### Tenant listing team

1. Select the approved master and exact variant actually held or supplied.
2. Open **List in your store** and follow every field explanation.
3. Confirm price basis and stock use the same sellable unit.
4. Keep the offer in `draft` until price, availability, order rules, channels and fulfilment are checked.
5. Activate only the channels the store can honour.

## Category coverage

The living in-product book currently includes detailed playbooks for:

- Fresh flowers
- Bouquets and floral arrangements
- Live plants
- Seeds, bulbs and planting material
- Smartphones
- Tablets and e-readers
- Laptops and notebooks
- Televisions and monitors
- Audio, headphones and wearables
- Cameras and imaging
- Major home appliances
- Furniture
- Apparel
- Footwear
- Jewellery and precious articles
- Beauty and cosmetics
- Packaged food and beverages
- Fresh produce
- Health supplements and nutraceuticals
- Books and publications
- Toys and games
- Automotive parts and accessories
- Batteries and power storage
- Medical devices
- Digital products and licences
- Services and appointments
- Gift hampers and configurable bundles

Each playbook supplies:

- the correct product kind and unit-policy decision;
- recommended variant axes;
- an attribute-schema table with stable key, label, type, master/variant scope, required state, controlled options, numeric bounds, units, filter/facet/search behavior and display group;
- compliance requirement templates with code, type, jurisdiction, conditionality and expiry behavior;
- one complete product/variant/listing example;
- category-specific modelling warnings where required.

For a category not yet named, use the **Category design recipe** in the application. Create broad parent categories for navigation only and put detailed schemas on the most-specific sellable leaf. Start from facts customers compare, facts that change stock identity, fulfilment facts, and legally material facts—never from an arbitrary list of marketing keywords.

## Smartphone worked example

### Category

`Smartphones` should normally use `physical` kind and count/piece units. Recommended variant axes are `ram`, `storage`, and `color`.

Core schema fields include:

| Key | Type | Scope | Why |
|---|---|---|---|
| `brand` | string | master | Stable manufacturer identity |
| `model_name` | string | master | Stable model identity |
| `operating_system` | select | master | Platform comparison/filtering |
| `processor` | string | master | Searchable performance identity |
| `ram_gb` | number, GB | variant | Changes the sellable configuration |
| `storage_gb` | number, GB | variant | Changes the sellable configuration |
| `color` | select | variant | Customer choice and often SKU identity |
| `display_size_in` | number, in | master | Comparable display fact |
| `display_type` | select | master | Comparable display fact |
| `battery_mah` | number, mAh | master | Comparable battery fact |
| `network_generation` | select | master | Connectivity compatibility |
| `sim_type` | select | master | Connectivity compatibility |
| `rear_camera_mp` | number, MP | master | Camera summary |
| `in_the_box` | multi-select | master | Prevents charger/accessory ambiguity |
| `sar_value` | string | master | Safety disclosure |
| `warranty_months` | number, months | master | Customer service commitment |

Compliance starting points include BIS CRS for the applicable handset model, WPC ETA for radio equipment, Legal Metrology package declarations, e-waste EPR and battery-waste EPR. TEC/MTCTE is conditional on the currently notified equipment scope. Exact applicability must be reviewed for the model, radio modules, importer/producer role and current Indian notifications.

### Product and variant

- Master title: `Acme Nova 5G`
- Global SKU: `PHN-ACM-NOVA5G`
- Model number: `NOVA5G-IN`
- Option vocabulary: RAM `{8 GB, 12 GB}`, storage `{128 GB, 256 GB}`, colour `{Black, Midnight Blue}`
- Variant: `ram=8 GB, storage=256 GB, color=Midnight Blue`
- Variant identifiers: exact barcode/GTIN and seller-independent manufacturer part number
- Packed fulfilment measurements: `0.42 kg`, `18 × 9 × 6 cm`
- Serial tracking: enabled

### Tenant offer

- Seller SKU: `KAK-PHN-NOVA-8256-BLU`
- MRP: `₹29,999`
- Selling price: `₹27,499`
- Cost price: `₹24,000` (private)
- Price basis: `1 piece`
- Stock: `15 pieces`
- Maximum order: `2`
- Backorder/preorder: off unless the store has an operationally supported policy
- Channels: enable only those in which this exact variant can be fulfilled
- Status: draft until checks pass, then active

## Attribute design rules

- Use `number` plus `unit`; never store `5000 mAh` as an unfilterable string when `5000` and `mAh` can be represented separately.
- Use `select` or `multi_select` for governed facets. Decide spelling and casing once.
- A master attribute must be true for every variant.
- A variant attribute must correspond to that exact combination.
- Use `json` only for genuinely structured facts such as a nutrition panel or stone breakdown; do not hide ordinary fields in blobs.
- `required` means authoring cannot be complete without the value—not merely that the field is useful.
- `filterable` supports exact/range filtering; `facetable` supports result counts; `searchable` contributes useful query text.
- Stable keys are contracts. Change labels for presentation; do not casually rename keys after products exist.

## Compliance rules

Compliance is scoped evidence, not a badge typed into marketing copy.

- Apply a record to the master only if it covers all variants; otherwise select the exact variant.
- Record authority, jurisdiction, validity period, issuer reference and evidence metadata.
- Use `verified` only after the governance workflow has actually verified evidence.
- Preserve expiry dates and make renewal operationally visible.
- Never expose private evidence URLs or reviewer identity on the public storefront.
- Do not infer that a certificate for one model covers a related model, pack, radio module or formulation.
- Category templates are starting points, not legal advice. Applicability changes by exact product, use, composition, claims, origin, state and current notification.

## Listing quantity examples

| Product | Price basis | Stock means |
|---|---|---|
| Smartphone | `1 piece` | number of exact phone variants |
| Rose bunch | `1 bunch` where variant sell quantity is 20 stems | number of 20-stem bunches, not stems |
| Apples | `1 kg` | number of sellable 1 kg packs unless fractional inventory is explicitly supported |
| Service | `1 visit` | bookable visits/capacity |
| Software | `1 licence` | available keys/entitlements if inventory-limited |
| Case pack | `1 case` and package says 24 pieces | cases, not individual pieces |

## Publication stop conditions

Do not publish when:

- required evidence is missing, expired, mismatched or unverifiable;
- variant identity differs from packaging/barcode or actual stock;
- listing price basis and inventory unit disagree;
- fulfilment cannot honour hazardous, age-restricted, cold-chain, serial or lead-time promises;
- an override or badge makes claims beyond the approved label, certificate or warranty;
- sale/availability dates conflict;
- the shared master is not active;
- a version conflict indicates somebody changed the record during editing.

## Maintenance standard

The guidance dataset has automated contract tests for unique playbook IDs, stable attribute keys, supported EAV types/scopes, compliance types, complete examples and smartphone essentials. When adding a new leaf category, add or extend a playbook, verify it with the responsible domain owner, and run the admin test/build suites before release.
