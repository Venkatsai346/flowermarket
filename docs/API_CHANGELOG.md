# Flower Market API Changelog

All notable changes to the API are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/)

## [Unreleased] — Storefront content (brands, categories, rich store pages)

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
