# Roadmap

Everything in this repo is built so each phase **plugs in without rework** — models are
normalized, tenant-scoped, and referenced (never embedded).

## ✅ Phase 1 — User domain (done, this repo)

- OTP-first auth, JWT + rotating refresh, device sessions, logout
- Profiles, preferences, marketing consent, location
- Saved addresses with serviceability stamps & exactly-one-default
- Admin user management + RBAC
- Multi-tenant scaffolding (Tenant, TenantAuthConfig, tenant-scope guard)
- Smoke test: 17 end-to-end scenarios

## ✅ Phase 2a — Catalogue (done)

Full multi-tenant catalogue implemented (see `docs/DATA_MODELS.md` §5, `docs/API.md` §Catalog):

- **ProductMaster** (global identity) + **TenantProduct** (tenant price/stock/status)
  field-ownership split — the core multi-tenant pattern from the architecture doc
- **ProductChangeRequest** review workflow (create_master / update_global_fields /
  add_variant / update_images / update_attributes / deactivate_master)
- Duplicate detection (exact barcode/SKU → 409; fuzzy title → 409 POSSIBLE_DUPLICATE)
- **Optimistic locking** (`version` → 409 VERSION_CONFLICT) on masters & listings
- **Category tree** with `attributeSchema` compliance gating; **Brand registry** w/ verification
- **EAV attributes**, variants, images (separate collections — no unbounded arrays)
- **Merged customer view** (`GET /catalog`): only ACTIVE listings of ACTIVE masters surface
- **Inventory**: atomic reserve/release (race-safe), auto OUT_OF_STOCK, denormalized snapshot
- **PriceHistory** (append-only), **AuditLog** (immutable, tenant-scoped reads),
  **CatalogEvent** outbox (drain + handlers; Kafka/Redis-ready)
- **Bulk CSV** price/stock import with async job polling + templates
- Seed script now loads demo catalogue; `npm run smoke:catalog` proves 12 scenarios

## ✅ Phase 2b + Phase 3 — Order lifecycle (done)

Slotted delivery engine + full cart → orders → payments → fulfillment → returns/refunds
lifecycle implemented end-to-end (per `uploads/order_lifecycle_cart_delivery_fulfillment_returns.md`).
`npm run smoke:order` proves 20 scenarios; live demo verified on the running server.

- **Slots engine** (BigBasket-style): `Hub` (dark store) + `DeliverySlot` windows
  (8-10 / 10-1 / 1-4 / 4-7 / 7-10) with hard `totalCapacity`; **atomic lock** —
  `$expr reservedCapacity < totalCapacity` guarded `findOneAndUpdate`, so concurrent
  reserves can never oversell; HELD reservation (10-min TTL) → CONFIRMED after payment;
  TTL sweep releases expired holds + capacity
- **Cart** (own collection, one ACTIVE per tenant+user, TTL expiry, 50-item cap):
  price/stock/title snapshots at add-time, **never live-synced**; checkout revalidates
  price+stock, returns the diff, and refuses to proceed until the customer explicitly
  re-confirms (`confirmPriceChanges`) — no surprise charges
- **Order saga orchestrator** (`order.service`, NOT choreography): create → charge
  (idempotent) → hard-decrement inventory → confirm slot → queue picking task;
  compensating actions on every failure (payment fail → cancel + release slot;
  inventory race loss → refund + release slot + notify); cancellation is the reverse
  saga (restore stock → release slot → refund)
- **Status machine** (central `orderStateMachine`): created → payment_pending →
  confirmed → picking → packed → out_for_delivery → delivered; delivery_failed retries
  (max 2 → cancelled); every transition appends `OrderStatusHistory` (track-order timeline)
- **Fulfillment**: `FulfillmentTask` (queued→picking→packed) for PICKER/ADMIN;
  `DeliveryAssignment` for RIDER/ADMIN with **POD capture** (OTP stored hashed /
  photo / signature) → DELIVERED
- **Returns — two flows**: A) `pickup_qc` standard return (pickup → QC → refund);
  B) `instant_claim` perishable quality guarantee (auto-approve + instant wallet refund,
  monthly-claim fraud guard → manual review). Perishables are not pickup-returnable
- **Refunds**: wallet (instant, default) vs original method (gateway), destination
  surfaced at initiation; `idempotencyKey` on every charge AND refund; wallet is
  versioned (optimistic lock) with append-only ledger; reconciliation sweep for stuck
  PENDING payments
- **Payments**: provider abstraction — mock gateway (decline hook: amount paise ending
  in `13`) for dev/tests; Razorpay adapter stub ready for real keys; webhook confirm path
- Order numbers: per-tenant daily `FM-YYMMDD-NNNNN` via atomic counter; outbox events:
  order_confirmed / order_delivered / order_cancelled / refund events

## ✅ Phase 3.5 — Policies, rider app, forecasting, Razorpay hardening (done)

Per `uploads/tenant_charges_rider_endpoints_slot_forecasting_refund_fees.md`.

- **Policy engine** (replaces hardcoded ₹49): `DeliveryFeePolicy` (tenant, base fee,
  free-delivery threshold, express surge multiplier, distance-per-km),
  `TaxPolicy` per CATEGORY (GST slab + HSN — a legal classification, not a tenant
  choice), `DiscountPolicy` coupons (FLAT/PERCENT, min cart, max cap, per-customer
  usage limit, tenant or platform-wide). `pricingPolicyService.computeOrderCharges`
  persists an **immutable `OrderChargeBreakdown`** at order time + per-item
  `taxAmount` / `discountAllocated` on `OrderItem` — historical orders and refunds
  always reflect what the customer was ACTUALLY charged, even if policy changes later.
- **Refund fee handling**: component refunds — `refundItemAmount` (net goods value =
  price − discount), `refundTaxAmount` (credit-note line), `refundFeeAmount` governed
  by `TenantRefundPolicy` (`NEVER` / `FULL_ORDER_RETURN_ONLY` / `ALWAYS` + `refundFeePct`).
  Components stored separately on `RefundTransaction` for GST credit notes / finance.
- **Rider app endpoints** (explicit state machine, nothing inferred):
  `POST /rider/deliveries/:id/{accept|reject|arrive-hub|depart|arrive|complete|fail}` +
  `POST /rider/availability`. `depart` requires `package_verified` → order
  OUT_FOR_DELIVERY + customer notification. `accept` has a 45 s TTL; a background
  sweep auto-reassigns expired PENDING_ACCEPT assignments (no stuck orders).
  `reject` immediately reassigns to the next available rider, excluding the rejecter
  (capped list → manual assignment). `complete` captures POD (OTP hashed).
- **Slot forecasting**: "forecasting sets the number; the atomic lock enforces it."
  `slotForecastingService` = min(predicted demand × headroom, physical picker/rider
  limit), fed by historical volume per hub/slot-type/weekday + real fulfillment-time
  logs. Every DELIVERED order writes a `FulfillmentTimeLog` (self-correcting loop).
  Nightly batch = `slotService.generateForDates(..., { forecast: true })`;
  express surge is never charged for a slot the hub physically can't hit.
- **Razorpay live hardening**: official `razorpay` SDK (orders.create `payment_capture=1`,
  refunds), webhook HMAC-SHA256 signature verification over the RAW body
  (timing-safe compare, raw-body route mounted before `express.json`),
  async payment confirmation — `charge()` returns `pending:true` (order stays
  PAYMENT_PENDING), `payment.captured`/`order.paid` webhook → `confirmPayment`
  → inventory commit → CONFIRMED (idempotent); `payment.failed` → mark failed +
  cancel pending order. Mock gateway keeps the deterministic `…13` decline hook and
  a `forcePending()` hook so the async path is fully testable without real keys.

## ✅ Phase 4 — Admin dashboard API (done)

Per `uploads/admin_dashboard_api_analytics.md` — read-first, write-controlled. All under
`/api/v1/admin` (ADMIN/SUPER_ADMIN), every list paginated + tenant-scoped, every write audited.

- **Products**: shared master catalog joined via tenant listings + inventory (search,
  category, health filter) → list / detail (listings + inventory + price history) / export.csv
- **Inventory**: health summary (in_stock/low_stock/out_of_stock, reserved, on-hand value);
  filterable list with restock suggestions; **append-only ledger** (`inventoryadjustments`)
  with atomic version-locked adjust (`qtyAfter ≥ 0` guard, retry-once); export.csv
- **Hubs & slots**: hub CRUD + serviceable pincode management + activate/deactivate;
  slot grid with **intraday `manualCapacity` override** (honored by the atomic reserve gate
  via `$ifNull` — can never oversell, never shrink below reserved) + close/reopen; daily
  utilization grid
- **Orders**: rich-filter admin list (status/date/hub/payment/total-range/search) + full
  detail (items w/ tax+discount, immutable charge breakdown, timeline, payments, refunds,
  returns, delivery assignment) + export.csv
- **Users & staff**: staff create (admin/picker/rider; super_admin minting blocked),
  status/role guards (no self-modify, no touching super_admin), user detail (wallet, order
  summary, addresses, returns), per-rider stats (delivered, rejections, avg delivery time),
  export.csv
- **Analytics**: dashboard KPIs with exact formulas (ordersCreated, gmv, netRevenue = gmv −
  refunds, aov, delivered, cancellationRate, returnsRate, new/repeat customers), daily
  series, payment + slot-type splits; top products / categories / hubs / slot fill-rate;
  **nightly rollup `analyticsdailies`** (idempotent rebuild endpoint) + export.csv (BOM, RFC-4180)

## ✅ Phase 4b — Ops tooling: notifications + exports + nightly pipeline (done)

Per `uploads/ops_tooling_notifications_exports.md`. Provider abstraction first —
default provider is `console` (logs + marks sent); FCM/APNs/SMTP/Twilio slot in behind
`notificationProvider.service.js` via env config (no live credentials wired this pass).
Every send is **outbox**: `notifications` rows (user × template × dedupeKey, unique sparse
dedupe) queued in the request path, sent by the `processPending` worker with per-channel
`channelStatus` + attempts/lastError.

- **Devices + inbox**: `GET/POST /users/me/devices` (partial-unique token dedupe, max 10,
  soft disable), `DELETE /users/me/devices/:id`, `GET /users/me/notifications`,
  `POST /users/me/notifications/:id/read`
- **Templates are DATA**: `notificationtemplates` (tenant code unique, platform-default
  `tenantId: null` fallback, `{{placeholders}}` rendered at enqueue, per-channel content,
  version bumped on edit, `eventType` auto-trigger). Admin CRUD at
  `/admin/notifications/templates*`; manual send + worker + log at
  `/admin/notifications/send|process|list`
- **Event → notification consumer**: registered at boot (`createApp`), maps
  order_confirmed / out_for_delivery / rider_arrived / delivered / cancelled /
  payment_failed / refund_completed → dispatch with order-enriched payload
  (firstName, orderNumber, total, slot); channels intersected with reachable
  (push needs active device; sms/email need verified phone/email); throw-safe — never
  poisons the event drain
- **Scheduled CSV/BI exports**: `exportjobs` idempotent on `jobKey`
  (`analytics_daily:{date}:{date}`, `orders`, `inventory`, `products`, `users`), render
  reuses the Phase-4 admin `csv()` functions, artifact stored in `exportartifacts`
  (RFC-4180 + UTF-8 BOM), `GET /admin/exports/:id/download`
- **Nightly pipeline** `POST /admin/maintenance/nightly` (or `scripts/nightly-job.mjs` for
  cron): forecast → analytics rollups → create `analytics_daily` jobs → run due exports →
  drain events → process notifications. Every step isolated + idempotent (re-run creates
  zero duplicate jobs)
- Verified: `smoke-ops.test.js` 7/7 + full regression (smoke 17, catalog, order 21,
  phase35 11, admin 11, refund-calc 6, slot-forecast 4) + live spot-check on the demo
  (device dedupe, template CRUD, manual send → worker → inbox → read, export BOM download,
  nightly idempotent)

## ✅ Phase 5 — Multi-tenant marketplace (done)

Per `uploads/multi_tenant_marketplace.md`. Root: tenants were seed-only, the `vendor`
role was unused, billing didn't exist, analytics were tenant-scoped. Now any visitor can
open a store, vendors join through a review workflow, stores bill per period with
auditable invoices, and the platform sees across all tenants.

- **Tenant self-service** (`/marketplace`): public `GET /plans`, `GET /stores` (published
  discovery), `GET /stores/:slug` (storefront with branding + vendor products when
  marketplace mode is on), `POST /tenants/register` — creates tenant + owner admin
  (never super_admin) + auth config + trial subscription + auto-login tokens; slug
  unique/reserved → 409. Owner ops: `GET|PATCH /marketplace/store` (branding, publish →
  onboarding active), `GET /marketplace/store/subscription`,
  `PATCH /marketplace/store/plan` (existing stores subscribe on first change; mid-period
  changes write a pro-rata `pendingAdjustment`), `GET /marketplace/store/invoices`,
  `GET /marketplace/store/vendors`, `POST /marketplace/store/vendors/:id/sync`
  (marketplace mode required; idempotent TenantProduct creation)
- **Vendor onboarding + routing**: `POST /marketplace/vendor/apply` (one per user,
  re-submit updates) → super_admin review `POST /marketplace/admin/vendor-applications/
  :id/review` — approve creates the `vendors` profile AND grants the `vendor` role (the
  only path). Vendor products (`/marketplace/vendor/products`) start `pending_review` →
  admin review → `marketplaceListed=true`. `ProductMaster.vendorId` attributes ownership;
  `orderitems.vendorId` is snapshotted at checkout (vendor GMV needs no joins); store sync
  routes vendor products into marketplace-enabled stores
- **Per-tenant billing**: `plans` (data, admin CRUD at `/marketplace/admin/plans*`;
  free ₹0/2%, pro ₹999/1% + marketplace, business ₹2999/0.5%); one live subscription per
  tenant (trial → active rollover); per-period invoices (`INV-YYMM-seq`) with frozen line
  items (subscription fee, commission = GMV × bps from `analyticsdailies`, pro-rata
  adjustment); billing cycle idempotent per (tenant, period.from, period.to); mock
  payments via `billingProvider` (razorpay slots in); overdue sweep → past_due
- **Cross-tenant analytics** (`/marketplace/admin/analytics/*`): platform dashboard
  (gmv, orders, netRevenue, commissionsAccrued, mrr, active/new tenants, new vendors,
  byPlan — hand-verifiable formulas), top tenants/vendors, idempotent `platformdailies`
  rollup; `POST /marketplace/admin/nightly` runs the platform-wide pass (billing →
  overdue → rollup → drain → notify), also hooked into `scripts/nightly-job.mjs`
- Marketplace mode remains `Tenant.features.marketplaceEnabled` (pro/business plans set
  it; free doesn't — single-brand stores unchanged)
- Verified: `smoke-marketplace.test.js` 14/14 (register/409, branding+storefront, vendor
  approve/reject/409, product review + sync + checkout vendorId + stats, invoice
  hand-verified + proration + pay + overdue, platform dashboard hand-summed + rollup +
  nightly idempotent) + full regression of all 8 prior suites + live spot-check on the demo

## 🟢 Frontend wave — admin console (SHIPPED)

- Monorepo `frontend/` (npm workspaces): `packages/shared` (API client with envelope
  parsing + auto-refresh, typed endpoints, zustand auth store, money/date/status utils),
  `apps/web` (React 18 + Vite + Tailwind v4 + Zustand admin console), `apps/mobile`
  (Expo scaffold on the shared core).
- Role-aware surfaces: platform operator (`/platform/*`), store owner (`/catalog`,
  `/orders`, `/vendors`, `/billing`, `/storefront`), vendor (`/vendor*`). Store
  self-service registration with live plan pricing.
- Full marketplace ops from the console: approve applications, review vendor products,
  run billing cycle + mark invoices paid/void, plans CRUD, platform analytics + rollup.
- Key integration facts: tokens carry the tenant claim and `tenantContext` runs before
  `authenticate`, so the client sends `x-tenant-id` = session tenant on every request
  (and scoped to the tenant field at login). Verified end-to-end through the Vite proxy
  (register → vendor apply/approve → product review → store sync → storefront live).
- Plan: `uploads/admin_console.md`.

## 🟢 Catalog CRUD (categories · brands · masters) — SHIPPED

- Web console now manages the shared catalog end-to-end: **Categories** (tree view with
  nested rows, child-guard delete, attribute-schema editor with required-field guidance),
  **Brands** (registry CRUD + one-click verify/unverify with audit note), **Masters**
  (global SKU catalog: search/filters, create/edit with attributes/variants/images
  editors, rich detail with review + deprecate + sub-resource management).
- Optimistic locking surfaced as first-class UX: every master mutation carries
  `expectedVersion`; stale edits → `409 VERSION_CONFLICT` toast + auto-refetch; version
  shown on detail (`v{n}`).
- Category required-attribute validation is enforced server-side and guided client-side
  (amber banner + required rows + submit validation).
- Verified E2E through the Vite proxy: category tree + `CATEGORY_HAS_CHILDREN` guard,
  brand verify/soft-delete, master create → versioned PATCH/addVariant/addImage/
  setAttributes → stale-409 → deprecate. Backend regression 9/9 green.
- Plan: `uploads/catalog_crud.md`.

## 🟢 Media uploads (images & videos from device) — SHIPPED

- Presigned-upload pipeline (`POST /media/presign` → direct `PUT` → `POST /media/:id/confirm`);
  the browser never sees storage credentials. Provider abstraction: `local` (dev default,
  same-origin authed PUT route, served at `/media/local`) and `s3` (presigned PUT, `HeadObject`
  verify) — identical UX.
- Every upload is registered in `mediaAssets` (tenant, purpose, type, size, status
  `pending|ready|failed|deleted`, key `{tenant}/{purpose}/{yyyymm}/{uuid}.{ext}`), tenant-scoped
  gallery list/detail/soft-delete. Sign-time type+size allowlists (images ≤ 10 MB, videos ≤
  250 MB) + confirm-time magic-byte sniffing (jpeg/png/gif/webp/avif/mp4/mov).
- Web console: `MediaUploader` (drag-drop + progress), `MediaPickerModal` (gallery + inline
  upload), `ImageField` (preview + device upload + URL-paste + clear) wired into master form
  images, master-detail add-image, category image, brand logo, store logo/banner. Catalog +
  storefront image fields now accept relative URIs (local-provider URLs persist).
- Verified: backend 10/10 suites green (9 core + smoke-media 8 checks) + `smoke-media-e2e-proxy`
  12/12 through the Vite proxy (login → presign → PUT → confirm → serve bytes → category with
  uploaded image → auth/ext guards); `vite build` clean.
- Plan: `uploads/media_upload.md`.

## 🟡 Phase 6 — ideas (not planned yet)

- Vendor payouts (real disbursement), GST invoicing, subdomain routing, search ranking

## How the React Native app consumes this (suggested mapping)

| Screen | Endpoint |
| --- | --- |
| Splash → login | `POST /auth/otp/request`, `POST /auth/otp/verify` |
| Onboarding profile | `PATCH /users/me`, `PUT /users/me/location` |
| My Addresses | `/users/me/addresses*` |
| Home (pincode-aware) | pincode check + catalogue (Phase 2) |
| Slot picker | `GET /cart/slots?pincode=…&date=…` + `POST /cart/slots/:id/reserve` |
| Cart | `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id` |
| Checkout | `POST /cart/revalidate` → `POST /cart/checkout` (idempotency key, confirmPriceChanges) |
| Track order | `GET /orders/:id/timeline` |
| Returns | `POST /returns` (`pickup_qc` or `instant_claim`), `GET /returns/:id` |
| Wallet/refunds | `GET /wallet`, `GET /wallet/transactions`, `GET /wallet/refunds` |
