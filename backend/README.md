# Flower Market API

Node.js + Express + MongoDB REST API for an **online flower market** — BigBasket-style
(OTP login, slotted delivery, location-aware catalogue). Built multi-tenant ready from
day one.

> **Implemented & smoke-tested:** Phase 1 (user domain — auth, profiles, addresses,
> admin/RBAC), Phase 2a (multi-tenant catalogue — ProductMaster + TenantProduct split,
> approval workflows, inventory, search, bulk import), Phase 3 (order lifecycle — cart
> with price revalidation, BigBasket-style slotted delivery with atomic capacity locks,
> saga-orchestrated orders, fulfillment/picking + rider POD delivery, returns
> (pickup-QC + instant claim), wallet & idempotent refunds), Phase 3.5 (pricing policies,
> rider app, slot forecasting, Razorpay hardening), **Phase 4 (admin dashboard — products,
> inventory, slots, orders, users, analytics with exact KPIs + CSV exports)** and
> **Phase 4b (notifications outbox with template-as-data, scheduled CSV/BI exports,
> nightly maintenance pipeline).** See `docs/ROADMAP.md`.

---

## Tech stack

| Layer      | Choice                                            |
| ---------- | ------------------------------------------------- |
| Runtime    | Node.js ≥ 18 (ESM)                                |
| Framework  | Express                                           |
| Database   | MongoDB (Mongoose 8, normalized collections)      |
| Auth       | JWT access + rotating hashed refresh tokens + OTP |
| Payments   | Razorpay (Phase 3 — checkout)                     |
| Validation | Joi                                               |
| Security   | bcrypt, helmet, CORS, rate limiting               |

---

## Quickstart

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env            # then set MONGODB_URI, JWT secrets

# 3. run a local MongoDB (or point MONGODB_URI at Atlas)
#    e.g. docker run -d -p 27017:27017 mongo:7

# 4. seed the default tenant + demo admin
npm run seed                    # prints DEFAULT_TENANT_ID — put it in .env

# 5. run
npm run dev                     # http://localhost:4000
```

**Smoke tests (no MongoDB needed — spin up an in-memory one):**

```bash
npm run smoke                   # user domain — 17 end-to-end scenarios
npm run smoke:catalog           # catalogue — 12+ scenarios (approval, locking, inventory...)
npm run smoke:order             # order lifecycle — 20 scenarios (cart→slots→saga→POD→returns→refunds)
```

---

## Project layout

```
src/
├── config/            # env config + mongo bootstrap
├── constants/         # enums (single source of truth)
├── models/            # Mongoose schemas (normalized — no unbounded embeds)
│   └── plugins/       # softDelete / audit / toJSON plugins
├── services/          # business logic (auth, otp, user, address, tenant)
├── controllers/       # thin HTTP adapters
├── middleware/        # auth, rbac, tenant, validation, rate-limit, errors
├── routes/            # /auth, /users (REST, v1)
└── utils/             # ApiError/ApiResponse, jwt, hash, otp, validators
scripts/               # seed + smoke test
docs/                  # design docs (data models, API, architecture, roadmap)
```

---

## Design docs (read these)

- **[docs/DATA_MODELS.md](docs/DATA_MODELS.md)** — every collection, business rules, why
  everything is normalized, multi-tenant strategy, slotted-delivery design, product
  scalability.
- **[docs/API.md](docs/API.md)** — full endpoint reference with request/response examples.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — layers, auth flows, security, deployment.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — phase plan through products → slots → cart →
  orders → Razorpay → multi-tenant marketplace.

---

## What's implemented

**Phase 1 — user domain**
- ✅ OTP-first auth (BigBasket-style) + JWT access (15 min) + rotating refresh tokens
- ✅ Multi-tenant ready: every model tenant-scoped; `x-tenant-id` + JWT claim +
  tenant-scope guard (cross-tenant tokens rejected)
- ✅ Location-aware: canonical `Location` + `ServiceablePincode` + per-address
  serviceability stamps; saved addresses with exactly-one-default invariant
- ✅ Admin: user list (paginated/filterable), role & status management, RBAC

**Phase 2a — multi-tenant catalogue** (the field-ownership pattern)
- ✅ `ProductMaster` (global) + `TenantProduct` (tenant price/stock/status) split
- ✅ `ProductChangeRequest` approval workflow — tenants can't edit global fields directly
- ✅ Duplicate detection (barcode/SKU exact → 409; fuzzy title → POSSIBLE_DUPLICATE)
- ✅ Optimistic locking (`version` → 409 VERSION_CONFLICT) on masters & listings
- ✅ Category tree + `attributeSchema` compliance gating; brand registry w/ verification
- ✅ Merged customer view `GET /catalog` (ACTIVE listings of ACTIVE masters only)
- ✅ Inventory with atomic reserve/release; price history; immutable audit log;
  catalog event outbox (cache/search-ready, Kafka-able)
- ✅ Bulk CSV price/stock import with async job polling + templates

**Phase 3 — order lifecycle** (per `uploads/order_lifecycle_cart_delivery_fulfillment_returns.md`)
- ✅ Cart: disposable draft, price/stock snapshots at add-time, checkout revalidation with
  explicit re-confirm on price change (never surprise-charge), 50-item cap, TTL expiry
- ✅ Slotted delivery: `Hub` dark stores, atomic capacity lock (`$expr` guarded
  `findOneAndUpdate` — no overselling), 10-min HELD hold → CONFIRMED, TTL sweep
- ✅ Order saga orchestrator: charge (idempotencyKey) → hard-decrement inventory →
  confirm slot → queue picking; compensating transactions on every failure; cancellation
  is the reverse saga (restore stock → release slot → refund)
- ✅ Status machine + append-only `OrderStatusHistory` (track-order timeline)
- ✅ Fulfillment: pick/pack tasks (PICKER), rider dispatch + POD capture (OTP hashed /
  photo / signature) → DELIVERED; delivery-failure retries (max 2 → auto-cancel+refund)
- ✅ Returns: `pickup_qc` (pickup → QC → refund) + `instant_claim` (perishable guarantee,
  auto-approve, monthly fraud guard); per-item returnedQty tracking
- ✅ Refunds: wallet (instant, default) vs original method; idempotent; versioned wallet +
  append-only ledger; payment reconciliation sweep
- ✅ Payments via provider abstraction — mock gateway (dev/tests) + Razorpay adapter ready

**Phase 3.5 — policies, rider app, forecasting, payments hardening**
(per `uploads/tenant_charges_rider_endpoints_slot_forecasting_refund_fees.md`)
- ✅ Policy engine: per-tenant delivery-fee policy (free-delivery threshold, express
  surge, distance fee), per-category GST `TaxPolicy` (slab + HSN), coupon
  `DiscountPolicy` — no more hardcoded ₹49. Immutable `OrderChargeBreakdown` +
  per-item `taxAmount`/`discountAllocated` persisted at order time
- ✅ Component refunds: `refundItemAmount` + `refundTaxAmount` + `refundFeeAmount`
  stored separately, fee refund gated by `TenantRefundPolicy`
  (NEVER / FULL_ORDER_RETURN_ONLY / ALWAYS + pct split)
- ✅ Rider app: explicit delivery state machine — accept/reject (auto-reassign, no
  stuck PENDING_ACCEPT, 45 s accept TTL sweep)/arrive-hub/depart (package_verified
  gate → OUT_FOR_DELIVERY)/arrive/complete (POD: OTP hashed/photo/signature)/fail
- ✅ Slot forecasting: demand×headroom vs physical picker/rider limit, fed by
  fulfillment-time logs (every delivery feeds back); nightly forecast batch
- ✅ Razorpay live: official SDK, webhook HMAC-SHA256 verification over raw body,
  async payment confirm (`payment.captured`) / fail (`payment.failed`) flow

**Phase 4 — admin dashboard API** (per `uploads/admin_dashboard_api_analytics.md`)
- ✅ Products: shared catalog joined via listings + inventory; list / detail / CSV export
- ✅ Inventory: health summary, low/out-of-stock filters, restock suggestions, append-only
  adjustment ledger with atomic version-locked adjusts, CSV export
- ✅ Hubs & slots: hub CRUD + pincodes, intraday slot capacity override (atomic gate
  honors it — no oversell), close/reopen, daily utilization
- ✅ Orders: rich admin filters, full admin detail (items/breakdown/timeline/payments/
  refunds/returns/assignment), CSV export
- ✅ Users & staff: staff creation (no super_admin minting), status/role guards, user
  detail, per-rider ops stats, CSV export
- ✅ Analytics: exact-formula KPIs (gmv, netRevenue, aov, cancellation/returns rates…),
  top products/categories/hubs, slot fill-rate, nightly `analyticsdailies` rollup, CSV export

**Phase 4b — ops tooling** (per `uploads/ops_tooling_notifications_exports.md`)
- ✅ Notifications: device registry (token dedupe, soft disable) + customer inbox +
  mark-read; **template-as-data** (`{{placeholders}}`, per-channel content, platform-default
  fallback, admin CRUD, versioned); outbox send pipeline (per-channel status, attempts,
  retry) with console/mock provider — FCM/APNs/SMTP/Twilio adapters slot behind the same
  interface; event→notification consumer wired to the order outbox (throw-safe)
- ✅ Exports: scheduled CSV/BI jobs idempotent on `jobKey` (analytics_daily/orders/
  inventory/products/users), reuse Phase-4 CSV renderers, RFC-4180 + UTF-8 BOM download
- ✅ Nightly pipeline: forecast → analytics rollups → export jobs → drain → notify
  (`POST /admin/maintenance/nightly` or `scripts/nightly-job.mjs` for cron) — idempotent

**Phase 5 — multi-tenant marketplace** (per `uploads/multi_tenant_marketplace.md`)
- ✅ Tenant self-service: public `POST /marketplace/tenants/register` (slug unique, owner
  admin + auto-login, plan + trial subscription); store discovery + public storefront;
  owner branding/publish (`/marketplace/store`); plan change with pro-rata adjustments
- ✅ Vendor onboarding: apply → platform review → approve grants the `vendor` role (the
  only path to it) + seller profile; vendor products → review → `marketplaceListed`; store
  sync routes vendor products into marketplace-enabled stores (idempotent); checkout
  snapshots `orderitem.vendorId` for attribution
- ✅ Per-tenant billing: `plans` (data, admin-editable), one live subscription per tenant,
  per-period invoices (subscription fee + commission on GMV + prorated adjustments),
  idempotent billing cycle + overdue sweep + mock payments (real gateway slots in)
- ✅ Cross-tenant analytics: platform dashboard (gmv, mrr, commissions, tenants/vendors by
  plan, top tenants/vendors) + idempotent `platformdailies` rollup; marketplace nightly
  pass (billing → rollup → drain → notify)
- Marketplace mode remains the existing `Tenant.features.marketplaceEnabled` flag

## Next phases (see roadmap)

See `docs/ROADMAP.md` (Phase 6 ideas).
