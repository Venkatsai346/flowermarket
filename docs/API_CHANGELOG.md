# Flower Market API Changelog

All notable changes to the API are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/)

## [Unreleased] — Catalog governance: global-plane lockdown, atomic reviews, paid-plan gating

### Security — store owners could rewrite the shared catalog
- **Every store owner (`role: 'admin'`) could CRUD global masters, categories,
  brands, and self-approve change requests**: `/catalog/admin/*` allowed
  `ADMIN` with no scope check, and services added no role checks. The whole
  global router is now `SUPER_ADMIN`-only (403 `FORBIDDEN` otherwise), matching
  every other global router. See `docs/catalog-governance.md`.

### Fixed — review races and stranded approvals
- **Double-approve race**: two simultaneous approvals both passed the
  read-then-save status check and applied twice (duplicate variants).
  `review`, `reviewCreateMaster`, `deprecate`, `cancel`, and `revise` now
  claim their row with a guarded atomic update; exactly one wins and the loser
  gets the precise terminal-state error (`REQUEST_ALREADY_REVIEWED`,
  `NOT_PENDING_REVIEW`, `ALREADY_DEPRECATED`, …).
- **Approved-but-never-applied stranding**: if the apply threw after the
  verdict was saved, the CR sat `approved` forever with no effect. Apply
  failures now revert the claim to `pending` with `applyAttempts + 1`,
  `lastApplyError`, and a `change_request_apply_failed` audit entry —
  retryable, never stranded.
- **Zombie listings**: a listing created on an ACTIVE master could be
  activated AFTER the master was deprecated. Activation re-checks the master
  (409 `MASTER_NOT_AVAILABLE`).
- **Change requests filed against missing/dead masters** (404/400
  `MASTER_NOT_AVAILABLE` / `MASTER_NOT_ACTIVE` at submit, except
  `create_master` which creates its target).
- **`revise` mutated silently** — it now records a `change_request_revised`
  audit entry.

### Changed — review work is a paid-plan feature
- Filing change requests and proposing masters now require a paid plan
  (`pro`/`business`, checked live per request): 402 `PLAN_UPGRADE_REQUIRED`
  with `details.feature: 'catalog_change_requests'` otherwise. Existing
  requests are grandfathered — `revise`/`cancel` stay available on any plan.
- Console mirrors the split: global catalog pages (masters, categories,
  brands) are platform-only in nav + route map, and the Deep-admin page shows
  store owners only the tenant-scoped tabs (listings, bulk); review/audit/
  events are platform-only.

## [Unreleased] — Billing hardening: dunning integrity, GST, invoice journals

### Fixed — the collection loopholes are closed
- **Paying ANY one invoice cleared `past_due`, even with older overdues
  outstanding** — and the sweep only fired on OPEN→OVERDUE transitions, so the
  block never came back. Standing now has ONE choke point
  (`refreshStanding()`): the block lifts if and only if ZERO delinquent
  invoices remain, for pay-confirms, webhook confirms, and voids alike.
- **Voiding an overdue invoice left the subscription `past_due` forever.**
  Void now re-derives standing: voiding the last delinquent unblocks,
  voiding one of several keeps the block.
- **Double grace window**: the sweep stacked a second 7-day lag on top of the
  invoice's own `dueAt` (period end + 7d), so "due Apr 8" really meant
  "flagged ~Apr 15". Single explicit grace now: anything past `dueAt` is
  flagged on the next nightly run.
- **Upgrade pro-rata was double-charged** (`total = subtotal + signed`
  counted a +₹200 adjustment twice) and **downgrade pro-rata crashed invoice
  creation** (negative `unitAmount` vs the schema's `min: 0`, aborting the
  whole cycle). Totals are signed-correct
  (`taxable = fee + commission + adjustment`, GST on taxable), and the cycle
  isolates failures per subscription over a cursor.
- **Mid-period plan changes retroactively re-priced the whole period's GMV**
  (upgrade on day 29 to halve the month's commission). Commission rates are
  now effective NEXT period (`pendingCommissionRateBps`, applied on advance);
  only the fee difference is pro-rated immediately.
- **Concurrent cycle runs could double-invoice a period** (findOne→create
  race). The unique (tenant, period) index is now the backstop: the loser
  catches the duplicate key and returns the winner's row.
- **Platform invoice/credit-note PDFs rendered 1/100th amounts** (rupee
  floats passed into `*Paise` fields) and never detected void invoices
  (`'voided'` vs the enum's `'void'`). Both fixed.
- `POST /cart/checkout` now trips on TWO wires: `past_due` subscription OR
  any delinquent invoice — so cancelled-with-debt, pre-hardening, and drifted
  rows still block.

### Added
- **GST on platform invoices**: `GST` line at `MARKETPLACE_INVOICE_GST_BPS`
  (default 1800 = 18%, 0 disables) on fee + commission + adjustment; trial
  commission is taxed, waived fees are not. Totals, PDFs, journals, and the
  marketplace smoke all cover it.
- **`invoice_paid` ledger journals**: every settlement posts
  DR gateway_clearing / CR subscription income + commission income +
  `gst_output_payable:platform` (new `platform_subscription_income` account),
  idempotent per invoice, with nightly `backfillInvoicePayments()` repair.
  Zero-value invoices auto-finalise as paid (no gateway, no journal).
- **Dunning notices**: the overdue sweep dispatches ONE `invoice_overdue`
  notice per invoice to the store owner (dedupe-keyed; new platform-default
  template, tenant-overridable) and stamps `lastReminderAt`.
- **Sweep self-heal**: after flagging transitions, the sweep enforces
  "OVERDUE invoice ⇒ past_due subscription" platform-wide, healing drift.
- New pure gate `test:billing` (14 checks, in `test` + `test:unit` +
  `smoke:all`) locks invoice totals, the delinquency predicate, standing
  transitions, and journal splits without a database; the marketplace smoke
  gains section 5c (two overdues → pay one → still blocked → pay all →
  active + journals).

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
