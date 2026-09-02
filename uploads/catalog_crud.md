# Frontend wave — Catalog CRUD (categories, brands, product masters)

> Owner: Product frontend team. Status: **plan → SHIPPED** ✅
> (live in the web console on :5173; backend regression 9/9 green; full CRUD lifecycle
> verified end-to-end through the Vite proxy).
> Web-only (mobile stays parked per product decision). Builds on the Phase 5 API and the
> admin-console foundation (`frontend/` monorepo). Same discipline: blueprints first,
> exact 1:1 endpoint mapping, optimistic-lock awareness, role-guarded surfaces,
> hand-verifiable acceptance criteria, full regression (backend 9/9 must stay green).

## 1. Goal

Give operators full control of the **shared catalog** from the web console:

1. **Categories** — the taxonomy tree (with attribute schemas for fresh categories).
2. **Brands** — the brand registry with a **verification workflow**.
3. **Product masters** — the global SKU catalog: create, edit (optimistic-locked),
   review pending vendor/tenant proposals, deprecate, and manage attributes, variants
   and images.

The backend for all three already exists (`/api/v1/catalog/admin/*`, Phase 1-2, ADMIN +
SUPER_ADMIN). This phase is a **pure frontend build** — zero backend logic changes.

## 2. Contracts (verified against the live code — the source of truth)

All endpoints require `Bearer` + role `admin`/`super_admin`; tenant resolution as usual
(`x-tenant-id` = session tenant, sent automatically by the client).

### 2.1 Categories `/catalog/admin/categories`
| Method/path | Body/query | Response notes |
| --- | --- | --- |
| `POST /categories` | `{name, slug?, parentId?, description?, imageUrl?, iconUrl?, attributeSchema[], sortOrder, isFeatured, status}` | 201 doc (`id`) |
| `GET /categories` | `includeInactive, parentId, featured, page, limit` | `{data: items, meta}` — items are **lean `_id` rows** |
| `GET /categories/tree` | `includeInactive` | nested `children` tree (lean `_id`) |
| `GET /categories/:id` | — | doc |
| `PATCH /categories/:id` | same fields (name optional) | doc |
| `DELETE /categories/:id` | — | `{deleted:true}`; **400 `CATEGORY_HAS_CHILDREN`** if it has children |

`attributeSchema[]`: `{key (^[a-z0-9_]+$), label, type: string\|number\|boolean\|select\|date, required, options[], unit, min, max, regex}`.

### 2.2 Brands `/catalog/admin/brands`
| Method/path | Body/query | Notes |
| --- | --- | --- |
| `POST /brands` | `{name, slug?, logoUrl?, description?, countryOfOrigin?, status?}` | 201 doc |
| `GET /brands` | `status, verified (true/false), page, limit` | lean `_id` rows |
| `PATCH /brands/:id` | editable fields | doc |
| `PATCH /brands/:id/verify` | `{verified: bool, note?}` | flips `verification {status: verified\|rejected, isVerified, verifiedAt}` |
| `DELETE /brands/:id` | — | **soft** → status `inactive` |

### 2.3 Product masters `/catalog/admin/masters`
| Method/path | Body/query | Notes |
| --- | --- | --- |
| `POST /masters` | full create (below) | 201 doc; default status `active` |
| `GET /masters` | `status, categoryId, brandId, type, search, page, limit` | lean `_id` rows |
| `GET /masters/:id` | — | **rich**: doc + `attributes[{key,value,unit}]`, `variants[]`, `images[]`, `category{id,name,slug}`, `brand{id,name,slug}`, `version` |
| `PATCH /masters/:id` | editable global fields + **`expectedVersion` (required)** | **optimistic lock** — stale → **409 `VERSION_CONFLICT`** |
| `POST /masters/:id/review` | `{decision: approve\|reject, note?}` | for `pending_review` masters |
| `POST /masters/:id/deprecate` | `{note?}` | status → `deprecated`; cascades listings inactive |
| `POST /masters/:id/variants` | `{variantType, value, displayLabel?, sku?, sortOrder?, isDefault?, expectedVersion}` | 201 |
| `POST /masters/:id/images` | `{url, altText?, isPrimary?, sortOrder?, expectedVersion}` | 201 |
| `PUT /masters/:id/attributes` | `{attributes[], expectedVersion}` | replaces attribute set |

Create body: `{skuGlobal, type, title, slug?, shortDescription?, description?, categoryId (req), brandId?, barcode?, tags[], isPerishable?, requiresColdChain?, defaultSellingUnit?, minOrderQty?, maxOrderQty?, attributes[], variants[], images[], status?}`.

Enums (for dropdowns): `PRODUCT_TYPE` = fresh_flower, dried_flower, artificial_flower,
flower_bouquet, flower_arrangement, plant, seed, gardening_tool, floral_accessory, gift,
other. `SELLING_UNIT` = piece, stem, bunch, bouquet, box, bucket, kilogram, gram, pack,
pot. `VARIANT_TYPE` = weight, pack_size, stem_count, color, size, flavor, other.
`ATTRIBUTE_FIELD_TYPE` = string, number, boolean, select, date. Master status =
pending_review, active, rejected, deprecated.

## 3. Screen inventory & API mapping

| Screen | Route | Reads | Writes |
| --- | --- | --- | --- |
| Masters (list) | `/catalog/masters` | `GET /catalog/admin/masters` + categories + brands (filter dropdowns) | — |
| Master create | modal | categories/brands/type/unit enums | `POST /masters` |
| Master detail | modal | `GET /masters/:id` | review / deprecate / add variant / add image / set attributes (all `expectedVersion`) |
| Master edit | modal | `GET /masters/:id` | `PATCH /masters/:id` (+ `expectedVersion`) |
| Categories (tree) | `/catalog/categories` | `GET /categories/tree`, `GET /categories` (parent select) | create / update / delete |
| Brands | `/catalog/brands` | `GET /brands` | create / update / verify / delete |

Navigation: new **Catalog** group (admin + super_admin) → Masters · Categories · Brands.
The existing tenant listings page becomes **My catalog** (still `/catalog`) to remove the
master-vs-listing confusion.

## 4. Design decisions

- **Optimistic lock as a first-class UX**: every master mutation carries
  `expectedVersion` from the last-fetched doc; on `409 VERSION_CONFLICT` the console
  shows a "changed by someone else — refresh and retry" toast and refetches the master.
  Version is displayed in the detail header (`v{n}`).
- **Tree, not table, for categories**: nested rows with indent + expand/collapse;
  children rendered inline; delete blocked client-side with the server's
  `CATEGORY_HAS_CHILDREN` surfaced as an error toast.
- **Brand verification is a one-click action** (Verified ✓ / Rejected ✗ with optional
  note) directly in the row.
- **Dynamic editors**: attributes (key/label/type/options/unit), variants
  (type/value/label/sku/default), images (url/alt/primary) as add/remove row lists —
  same shape the API expects.
- **`_id` normalization**: categories/brands/masters list endpoints return lean rows
  (`_id`), detail endpoints return `id` — one `rid()` helper in the console normalizes.
- Shared enum→label maps live in `@flower-market/shared` so the mobile app reuses them
  later (per the frontend-wave plan).

## 5. QA matrix

1. Categories: create root + child → tree renders nested; update child; delete parent →
   400 `CATEGORY_HAS_CHILDREN` toast; delete child → ok; status filter respected.
2. Brands: create; verify → badge flips to Verified (audit note); edit; soft-delete →
   disappears from active list (status inactive filter shows it).
3. Masters: create with attributes + variants + images → appears in list; search finds
   by SKU/title; filters by status/category/brand/type.
4. Detail: attributes table, variants, images, category/brand names, version shown.
5. Edit: PATCH with current `expectedVersion` succeeds (version bumps); PATCH with a
   stale version → `VERSION_CONFLICT` toast + refetch (simulated by editing twice).
6. Sub-resources: add variant (version), add image, set attributes — each bumps version.
7. Review: a `pending_review` master (e.g. vendor-created) shows Approve/Reject →
   status flips; deprecate on active → `deprecated`.
8. Auth: store-owner and platform sessions both reach the pages (ADMIN+SUPER_ADMIN);
   vendor/customer redirected to no-access.
9. Regression: backend suites 9/9 stay green (no backend changes in this phase).

## 6. Acceptance criteria

- Operators can fully manage categories (tree CRUD with attribute schemas), brands
  (CRUD + verification) and product masters (CRUD + review + deprecate + attributes/
  variants/images) entirely from the web console, with loading/empty/error states,
  inline validation and toast feedback.
- Every mutation matches the backend contracts 1:1, including `expectedVersion` on all
  master writes and graceful handling of `VERSION_CONFLICT` / `CATEGORY_HAS_CHILDREN`.
- Navigation groups make the master catalog vs tenant listings distinction obvious.
- Backend regression 9/9 green; web `vite build` clean; full CRUD lifecycle verified
  end-to-end through the Vite proxy against the live demo.

## 7. Non-goals (this pass)

- No change-request queue UI (vendor `create_master`/edit proposals — API exists, UI
  later; vendor product review already lives in Platform → Vendors).
- No bulk import/export UI for masters (API exists).
- No per-listing price/stock editing from the master detail (already in My catalog).
- No mobile work.
