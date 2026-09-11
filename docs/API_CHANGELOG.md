# Flower Market API Changelog

All notable changes to the API are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/)

## [Unreleased] — Storefront content (brands, categories, rich store pages)

### Fixed — storefront-content follow-ups
- **Saved store content never appeared**: the Tenant `store` schema was missing
  the rich-content paths, so Mongoose strict mode silently stripped hero
  slides, highlights, testimonials, about, contact, SEO and announcement on
  save (200 + success toast, nothing in the DB). The schema now carries every
  path `updateStore` writes. NOTE: content saved before this fix was dropped
  and must be re-saved once — it never reached the database.
- **Stale storefront after save**: the global response cache (60s default, 5min
  for taxonomy) was never invalidated — `invalidateCache` had zero callers.
  Store saves now bust `/domains/bootstrap`, `/marketplace/stores/` and
  `/catalog/store/`; brand/category writes bust the whole `/catalog/`
  namespace. Saves appear on the next storefront load.
- **Category edit failed** (`'id' with value 'undefined'`): admin list/tree
  endpoints return `.lean()` rows, which skip the toJSON `_id → id` mapping.
  `category.service` (list + tree) and `brand.service` (list) now serialize
  through `serializeDoc`/`serializeList`, so every entity row carries a string
  `id`. The admin category modal additionally resolves ids via `rid()` and
  normalizes `parentId`, so it cannot aim at `undefined` even against an
  id-less payload.
- **Admin BrandsPage crashed** (`featured is not defined`): the featured/search
  filter UI shipped without its state declarations and query params. Restored.
- New pure gate `test:storefront-contracts` (59 checks, in `test` + `smoke:all`)
  pins all of the above: schema paths, strict-mode round-trips, serializer
  behaviour, Joi acceptance, and source-wiring invariants. The hermetic suite
  gains section 5 asserting the admin list/tree id contract against a live DB.

### Fixed — storefront-content round 3 (attach failures)
- **Saved announcements never rendered**: `App.jsx` passed `message=` while
  `AnnouncementBar` reads `announcement=` — a prop-name mismatch builds cannot
  catch and the null-guard hid completely. Fixed; every other new section's
  props were audited usage-vs-definition and match. Contract suite gains S6
  (storefront prop wiring) so the class cannot recur.
- **Brand modal ignored the enriched model**: `blank()`/`pickFields()`/UI were
  the old poor shape while the submit body referenced new keys — new fields
  were invisible, and editing a brand silently WIPED its banner/tagline/story/
  website/socials/curation to null. The modal is now coherent end to end
  (all fields, banner purpose, featured curation) and edits resolve ids via
  `rid()`. Pinned by contract section S7.
- **Stale reads after save (the "wrong API method" GET)**: the response cache
  cached ALL GETs including authenticated ones (the `/admin/ + req.user` skip
  never fires — the middleware runs before per-route auth). Credentialed
  requests (Authorization/Cookie) now bypass the cache entirely; anonymous
  public reads stay cached with bust-on-write. Store saves additionally bust
  `/marketplace/store`, which covers both the owner's GET and the public
  `/stores/:slug` reads.
- **Localhost tenant alignment**: the storefront sends no tenant header, so on
  localhost it renders DEFAULT_TENANT_ID/first-active — possibly not the store
  edited in the console. DEV-only `?asTenant=<id>` pins the storefront tenant
  for testing (backend ignores the header under real hostnames; the branch is
  `import.meta.env.DEV`-gated out of production builds).

### Fixed — storefront-content round 4 (edit wipes + carousel)
- **Saving one card wiped story/socials/contact/SEO**: `updateStore` merged on
  the live Mongoose subdocument, and SingleNested instances cast back as `{}`
  through the wholesale `tenant.store` replacement (arrays/scalars survived,
  which is why only those blocks "stripped"). The merge is now a pure,
  exported, contract-tested POJO function (`buildStoreUpdate`, prev =
  `tenant.store.toObject()`), and the audit `before` snapshot is a POJO too
  (it previously held live refs showing after-values). Any content wiped this
  way must be re-entered once — the wipe wrote `{}` to the DB.
- **Latent 500 on featured-id saves**: `updateStore` referenced `Category` /
  `Brand` without importing them — fixed (the hermetic suite's
  INVALID_FEATURED_IDS assertion exercises it).
- **Carousel had no slide CSS**: `.hero-slide` / `.hero-slide-active` were
  never defined, so all slides stacked fully visible with no crossfade; the
  copy-rise animation class was missing too. Added, with a
  `prefers-reduced-motion` guard. Slide frames also gained a brand-gradient
  backdrop so a slow/failed image degrades elegantly, never to a hole.
- NOTE on "banner overrides hero slides": no code path routes the banner into
  slides — slide `<img>`s render only their own `imageUrl`, and the
  banner/carousel branches are mutually exclusive. If banner pixels appear
  where slides should be, the slide records themselves carry the banner URL
  (the library picker lists every asset by design, so it is one click away)
  — or the slides predate the schema fix and were never re-saved. Check the
  bootstrap `heroSlides[].imageUrl` values to confirm in seconds.

### Added — local multi-store development
- `<slug>.localhost` now resolves like a production store subdomain (new
  `HOST_LOCAL` resolution source, `ALLOW_LOCAL_SUBDOMAINS` flag defaulting on
  outside production): one storefront dev server acts as every store via
  `http://<slug>.localhost:5174` — own hostname, own sessions, own carts, zero
  DNS/hosts setup. Unknown slugs fail closed (`STORE_NOT_FOUND`); bare
  `localhost`, reserved labels and multi-label names fall through exactly as
  before. Pure parser `parseLocalSubdomain` is contract-tested; live
  resolution is covered by smoke-domains section 8.
- The storefront dev proxy no longer sets `changeOrigin` (it rewrote Host to
  the backend's address, collapsing every store to the fallback tenant).
  CORS already permits `*.localhost` in development — no change needed there.
- DEV-only `?asTenant=<id>` storage is now isolated per pin, so pinned tabs
  cannot cross-contaminate carts/sessions. See "Testing multiple stores
  locally" in the storefront README.

### Added — public catalog
- `GET /catalog/store/brands` — brands this store actually sells (scoped to the
  tenant's live listings), each with `productCount` + `fromPrice`, featured
  first. Tenant-resolved from the request host, same cache behaviour as the
  other public catalog GETs.
- `GET /catalog/store/categories` — categories this store actually sells as
  `{ tree, flat }`: dead branches pruned, `productCount` rolled up into
  `totalCount` per subtree, `fromPrice` per node.
- `GET /catalog/products` already accepted `brandId` — the storefront now uses
  it for brand-filtered listings (`/search?brand=<id>`).

### Changed — store payload (`GET /domains/bootstrap`, `GET /marketplace/stores/:slug`)
The public store shape is now shared (`publicStoreShape`) and carries the full
storefront content model — all tenant-editable via `PATCH /marketplace/store`:
- `heroSlides[]` (max 8): image + optional mobile crop, title, subtitle,
  CTA label/link, per-slide on/off. Empty → legacy `bannerUrl` renders.
- `announcement`: dismissible bar text + link + on/off.
- `about`: title, content (blank-line paragraphs), image, video
  (YouTube/Vimeo embed or direct file).
- `highlights[]` (max 6): icon name + title + text trust badges.
- `testimonials[]` (max 12): name, text, 1–5 rating, avatar.
- `contact`: phone, email, hours, WhatsApp, map link, structured address.
- `seo`: page-title / meta-description overrides (blank = name · tagline).
- `footerText`, `featuredCategoryIds[]`, `featuredBrandIds[]` (max 12 each).
- `socialLinks` gains `youtube`, `x`, `whatsapp`.

### Changed — brands (global registry, admin-owned)
- New fields on create/update: `bannerUrl`, `tagline`, `story`, `website`,
  `headquarters`, `foundedYear`, `socialLinks{instagram,facebook,youtube,x}`,
  `isFeatured`, `sortOrder`.
- `GET /catalog/admin/brands` accepts `featured` + `search` filters.

### Changed — categories
- New `bannerUrl` field (wide hero for the category page header).

### Changed — media
- New upload purposes: `category_banner`, `brand_banner`, `store_hero`,
  `store_about` (see `MEDIA_PURPOSE` in the web app).

### Storefront (`@flower-market/storefront`)
- New routes `/brands` (search / sort / verified-only) and `/categories`
  (search + featured + full tree), both fed by the store-scoped endpoints.
- Home: responsive hero carousel (autoplay, reduced-motion aware, swipe,
  keyboard), trust highlights, shoppable category/brand rails (tenant
  curation with automatic best-stocked fallback), story teaser, testimonials.
- Browse gains a category header (banner, story, live counts, from-price)
  and breadcrumbs that resolve at any depth; Search supports `?brand=`;
  About renders the full story + video + contact; header sub-nav, richer
  footer, tenant SEO overrides, announcement bar.

### Admin console (`@flower-market/web`)
- Storefront page becomes the tenant CMS: announcement, hero carousel,
  story, highlights, testimonials, contact and SEO cards with per-card save.
- Brands editor covers all new fields; brand list gains featured/search
  filters. Categories editor gains the banner field.

## [1.0.0] — 2026-09-09

### Phase 7.0 — Foundation
- Health endpoints: `/health` (liveness), `/health/ready` (readiness), `/health/deep`
- Structured JSON logging with trace IDs
- Request timeout middleware (30s)
- Rate limiting (API + auth-specific)
- CSRF protection
- IP allowlisting for admin operations
- Account lockout (5 failed attempts)
- Prometheus metrics endpoint (`/metrics`)
- OpenAPI documentation (`/docs`)

### Phase 7.4 — Backend Features
- **Product Reviews** — `POST /reviews`, `GET /reviews/product/:id`
  - Customer CRUD: create, update, delete own reviews
  - Admin moderation: `POST /admin/reviews/:id/approve`, `/reject`
  - Rating rollup on products (avg + count)
  - Helpful count, verified purchase badges
- **Demand Forecasting** — `GET /admin/phase74/demand/forecast`
  - 3 methods: simple, weighted, trend-adjusted
  - Reorder alerts: `GET /admin/phase74/demand/reorder-alerts`
  - Product trends: `GET /admin/phase74/demand/trend/:productId`
- **HSN Summary** — `GET /admin/phase74/hsn/summary`
  - Period-based HSN summary for GSTR-1
  - Monthly trend: `GET /admin/phase74/hsn/trend`
- **E-way Bill** — `GET /admin/phase74/eway/required`
  - Identify invoices >₹50K
  - Generate NIC-format JSON: `GET /admin/phase74/eway/invoice/:id`
  - Batch export: `GET /admin/phase74/eway/batch`
- **GSTR-2B** — `POST /admin/phase74/gstr2b/import`
  - Import portal data, match against purchase invoices
  - Report: `GET /admin/phase74/gstr2b/report`
- **Dead Letter Queue** — `GET /admin/phase74/dlq`
  - List, inspect, requeue, bulk requeue, purge
  - Stats: `GET /admin/phase74/dlq/stats`
- **Connection Pool** — `GET /admin/phase74/pool/stats`
  - Pool stats, slow ops, connection events
  - Dedup stats: `GET /admin/phase74/dedup/stats`
- **Request Deduplication** — automatic for all POST/PUT/PATCH
  - `Idempotency-Key` header support
  - Content fingerprint fallback
  - Response caching with 60s TTL
- **API Response Caching** — GET responses cached per route/TTL
  - Catalog: 60s, Categories: 5min, Search: 30s
  - Cache invalidation on data changes

### Phase 7.4 — Admin Pages
- Tenant Settings: `GET/PUT /settings`
- Export Center: `GET/POST /exports`
- Delivery Zones: CRUD `/delivery-zones`
- Fiscal Periods: CRUD `/platform/fiscal-periods`
- Settlement Ingestion: `POST /platform/settlements`
- Statutory Deposits: `POST /platform/statutory-deposits`

### Phase 7.7 — Scaling
- MongoDB connection pool tuning via env vars
- BullMQ queue system (Redis-backed, in-memory fallback)
- Read replica support (configurable read preference)
- Response cache middleware with per-route TTL

### Authentication
- JWT access + refresh tokens
- OTP verification (phone + email)
- TOTP 2FA support
- Role-based access: `super_admin`, `admin`, `vendor`, `rider`

### Pagination
All list endpoints return:
```json
{
  "success": true,
  "items": [...],
  "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5, "hasMore": true }
}
```

### Error Format
```json
{
  "success": false,
  "error": { "message": "Human-readable message", "code": "MACHINE_CODE" }
}
```
