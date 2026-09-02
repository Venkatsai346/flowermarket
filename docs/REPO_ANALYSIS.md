# Flower Market — Deep Repository Analysis

_Analysis date: 2026-09-02 · branch `arena/01a0623c-flowermarket` · base commit `92e19c4` ("first commit")_

A single-commit monorepo containing a **BigBasket-style, multi-tenant flower marketplace**:
a very large Express/Mongoose API (~18.9k LOC, 5 completed phases) and a much smaller
React/Vite admin console + Expo scaffold (~5.5k LOC). This document is a structural,
behavioural and risk analysis of both halves, plus what I verified by actually running things.

---

## 0. TL;DR — the ten things that matter

1. **The backend is the product.** 232 routes, 76 models, 46 services, an explicit order
   saga, a policy/pricing engine, billing, forecasting, notifications, exports and media.
   It is unusually disciplined for a first commit.
2. **The frontend is an admin console only.** It consumes **~80 of 232 endpoints (~35%)**.
3. **Zero customer-facing UI exists.** `/cart`, `/orders`, `/returns`, `/wallet`, `/rider`,
   `/fulfillment`, `/policies`, `/catalog/tenant` — 82 endpoints — have **no UI at all**.
   The mobile app is a login screen, not a shopping app.
4. **No MongoDB transactions anywhere** (`startSession` = 0 hits). Consistency relies on
   atomic `findOneAndUpdate` guards + compensating actions (a deliberate, documented choice).
5. **RBAC hole:** `/catalog/tenant/*` (20 endpoints incl. price/stock writes) is guarded by
   `authenticate` only — **any customer-role token can mutate the tenant's catalog**.
6. **Media uploads are open to any authenticated user** with no per-user quota (250 MB video cap).
7. **CORS is fully open in dev** (`config.isDev` short-circuits the allowlist).
8. **One frontend→backend contract drift:** `GET /marketplace/admin/billing/invoices/:id`
   is called by the shared client but does not exist server-side.
9. **Dead code path:** `tenantContext` reads `req.auth?.tenant`, but it runs *before*
   `authenticate` and the claim is stored as `req.auth.tenantId` — that branch can never fire.
10. **Environment blocker:** `mongodb-memory-server` cannot download the mongod binary in
    this sandbox (`fastdl.mongodb.org` unreachable), so the 10 smoke suites can't run here.

---

## 1. Repository map

```
flowermarket/
├─ backend/           Node 18+ ESM · Express 4 · Mongoose 8 · JWT · Razorpay      ~18.9k LOC
│  ├─ src/{config,constants,middleware,models,routes,controllers,services,utils}
│  ├─ scripts/        dev-server (in-memory mongo), seed, nightly job, 10 smoke suites (3.5k LOC)
│  ├─ docs/           API.md (590) · DATA_MODELS.md (555) · ROADMAP.md (284) · ARCHITECTURE.md (73)
│  └─ storage/local/  ⚠ 906 KB of committed uploaded images (12 files, tracked in git)
├─ frontend/          npm workspaces monorepo                                      ~5.5k LOC
│  ├─ packages/shared @flower-market/shared — API client, endpoints, zustand auth, utils
│  ├─ apps/web        React 18 + Vite 6 + Tailwind v4 + Zustand + Recharts admin console
│  └─ apps/mobile     Expo/RN scaffold (single login screen proving the shared core)
├─ uploads/           9 phase specification documents (1.8k lines) — the "design bible"
└─ package-lock.json  ⚠ stray empty lockfile named "bloomy" at repo root
```

292 tracked files, one commit, no CI config, no linter config, no test runner (smoke
scripts are hand-rolled `node` files with their own assert helpers).

---

## 2. Backend architecture

### 2.1 Layering (strictly enforced, verified by inspection)

```
routes → controllers → services → models
           ↑ middleware: tenantContext, authenticate, authorize, validate, rateLimiter, errorHandler
           ↑ utils: ApiError/ApiResponse, jwt, hash, money, csv, orderStateMachine, validators
```

Controllers are genuinely thin (2.1k LOC across 18 files); business logic lives in services
(9.3k LOC across 46 files). No service imports a controller; no route touches a model. This
holds throughout — a rare property at this size.

### 2.2 Request lifecycle

`helmet → cors → raw-body webhook routes → json/urlencoded → compression → morgan → /api/v1
→ tenantContext → route → validate(Joi) → authenticate → authorize → controller → service →
model → envelope → errorHandler`

Two deliberate subtleties:

- **Webhooks are mounted before `express.json`** (`/payments/webhook/razorpay|mock` with
  `express.raw`) because Razorpay HMAC is computed over exact bytes. Correct.
- **`tenantContext` runs before `authenticate`**, so the tenant is resolved from the
  `x-tenant-id` header (or default tenant), and `authenticate` then enforces
  `token.tenant === req.tenantId` (`TENANT_MISMATCH`). This is why the web client must send
  `x-tenant-id` on *every* request — documented in `apps/web/src/api.js`.

### 2.3 Route surface (232 endpoints, 15 mounts)

| Mount | Endpoints | Guard | UI coverage |
|---|---:|---|---:|
| `/auth` | 8 | public + rate limiters | 4 |
| `/users` | 19 | `authenticate`, admin sub-routes `authorize` ×4 | 1 |
| `/catalog` (public) | 5 | public | 2 |
| `/catalog/tenant` | 20 | `authenticate` **only** ⚠ | 0 |
| `/catalog/admin` | 25 | `authenticate` + `authorize` | 20 |
| `/cart` | 11 | `authenticate` | 0 |
| `/orders` | 4 | `authenticate` | 0 |
| `/returns` | 5 | `authenticate` (+2 ops guards) | 0 |
| `/wallet` | 3 | `authenticate` | 0 |
| `/fulfillment` | 20 | `authorize` on all 20 | 0 |
| `/rider` | 9 | `authorize(RIDER…)` | 0 |
| `/policies` | 10 | `authorize` ×9 | 0 |
| `/admin` | 48 | router-level `authorize(ADMIN, SUPER_ADMIN)` | 11 |
| `/marketplace` | 38 | segmented: `/vendor`, `/store`, `/admin` | 37 |
| `/media` | 6 | `authenticate` only ⚠ | 5 |

### 2.4 Domain model (76 Mongoose models)

Grouped exactly as the phases built them, all exported from `models/index.js`:

- **Identity/tenancy** — Tenant, TenantAuthConfig, User, AuthToken, OtpVerification, Address,
  Location, ServiceablePincode, DeliveryZone, Vendor.
- **Catalog (Phase 2)** — the central pattern: **ProductMaster** (global identity, admin-owned
  fields) vs **TenantProduct** (per-tenant price/stock/status). Plus Category (with
  `attributeSchema` gating), Brand, ProductVariant/Image/AttributeValue (EAV, separate
  collections — no unbounded arrays), Inventory, PriceHistory, ProductChangeRequest
  (approval workflow), AuditLog, CatalogEvent (outbox).
- **Orders (Phase 3)** — Hub, Cart/CartItem, DeliverySlot, SlotReservation, Order/OrderItem/
  OrderStatusHistory, Payment/PaymentTransaction, Wallet/WalletTransaction, ReturnRequest/
  ReturnItem, RefundTransaction, FulfillmentTask, DeliveryAssignment.
- **Policies (3.5)** — DeliveryFeePolicy, TaxPolicy (per-category GST/HSN), DiscountPolicy,
  CouponUsage, OrderChargeBreakdown (immutable), TenantRefundPolicy, FulfillmentTimeLog.
- **Admin/ops (4/4b)** — InventoryAdjustment (append-only ledger), AnalyticsDaily, Device,
  NotificationTemplate, Notification, ExportJob, ExportArtifact.
- **Marketplace (5)** — Plan, Subscription, Invoice, VendorApplication, PlatformDaily, Counter.
- **Media** — MediaAsset.

Three shared plugins applied to every schema (`models/plugins/index.js`):
`softDeletePlugin` (adds `isDeleted`, hijacks `pre(/^find/)` and `pre('aggregate')` — nothing
is ever hard-deleted), `auditPlugin` (createdAt/updatedAt/updatedBy), `toJSONPlugin`
(`_id → id`, strips `__v`, `isDeleted`, and a secret-field denylist).

Snapshot discipline is consistent and correct: orders carry `addressSnapshot` + `slotSnapshot`,
cart items snapshot price/title at add-time, `OrderChargeBreakdown` is frozen at order time,
`orderitems.vendorId` is snapshotted for vendor GMV. History stays truthful when policy changes.

### 2.5 Concurrency model — the interesting part

There are **no MongoDB transactions** (0 `startSession` calls). Instead:

- **Inventory reserve**: `findOneAndUpdate` with `$expr: { $lte: [{$add:['$qtyReserved',qty]}, '$qtyOnHand'] }`.
- **Inventory commit**: `$expr: { $gte: ['$qtyOnHand', qty] }` + `$inc: -qty`.
- **Slot reserve**: `$expr: { $lt: ['$reservedCapacity', { $ifNull: ['$manualCapacity','$totalCapacity'] }] }`
  — so an admin's intraday capacity override can never oversell and never shrink below reserved.
- **Optimistic locking** via a `version` field on Order, TenantProduct, ProductMaster, Wallet,
  Inventory (`409 VERSION_CONFLICT`).
- **Idempotency keys** on every charge and refund; webhook replays are no-ops.

Consistency across services is achieved by the **saga orchestrator** in `order.service.js`
(702 LOC, the largest file), which is explicit rather than choreographed:

```
checkout: revalidate cart → validate slot hold → snapshot address → create order
        → PAYMENT_PENDING → charge → commit inventory → confirm slot → task → CONFIRMED
compensations: charge fail → release slot + CANCELLED(payment_failed)
               inventory race lost → restore committed + refund + release slot + CANCELLED
               cancel → restore stock → release slot → refund (reverse saga)
```

Transitions are validated centrally by `utils/orderStateMachine.js` (a frozen adjacency map,
`assertTransition` throws `400 INVALID_ORDER_TRANSITION`) and every transition appends an
`OrderStatusHistory` row. This is the cleanest part of the codebase.

**Caveat:** without transactions, a process crash between two atomic steps leaves a partial
state that only the sweeps (`/fulfillment/slots/sweep`, `assignments/sweep`,
`reconcile/payments`) will heal. That's an acceptable, explicitly chosen trade-off for a
standalone Mongo deployment — but it means those sweeps are load-bearing, not optional.

### 2.6 Cross-cutting mechanisms

- **Outbox** (`CatalogEvent` + `catalogEvent.service`) with a drain endpoint; the notification
  consumer registers on it at `createApp()` (Set-based, idempotent, throw-safe).
- **Provider abstractions** everywhere — payments (mock/razorpay), notifications
  (console/mock/fcm/apns/smtp/twilio), storage (local/s3), billing (console/mock/razorpay),
  SMS. Only the console/mock/local paths are implemented; the rest are declared seams
  (one `TODO` in the whole repo, in `smsSender.service.js`).
- **Config** is centralized in `config/index.js` — no `process.env` reads outside it (verified).
- **Errors**: `AppError` + factories; `errorHandler` normalizes Mongoose ValidationError,
  duplicate key (11000 → 409), CastError, payload-too-large; stacks only in dev.
- **Money**: rupees as JS numbers with `roundMoney` (×100/round/÷100) applied at every sum.
  Not integer paise — acceptable for INR at this scale, but see finding F8.

---

## 3. Frontend architecture

### 3.1 Shared core (`packages/shared`, framework-agnostic ESM)

- **`api/client.js`** — fetch wrapper; envelope parsing; bearer injection; **single-flight
  refresh on 401** (`refreshing` promise shared across concurrent calls) with one retry;
  clears session only if the refresh itself fails; throws typed `ApiError`.
- **`api/endpoints.js`** — 81 typed call helpers in 7 namespaces (auth, marketplace, admin,
  public, catalogAdmin, media).
- **`auth/store.js`** — zustand + `persist`, storage adapter injected (localStorage on web,
  swappable for AsyncStorage on mobile).
- **`utils/`** — INR formatting (`en-IN`, lakh/crore compaction), dates, and status→tone maps
  used to keep badges consistent.

### 3.2 Web console (`apps/web`)

- **Routing** — `RequireAuth` (hydrates `/users/me`) → `AppShell` → `RoleGuard` per route.
  Three lenses: `super_admin` → `/platform/*`, `admin` → store pages, `vendor` → `/vendor*`.
- **State** — zustand for exactly two things (session, toasts); server data via a 62-line
  `useApi`/`useAction` hook pair. No react-query. Reasonable at this size; the hook does
  re-run on every `deps` identity change and has no cache/dedupe.
- **Feature pages (24)** — dashboard, catalog (listings/masters/categories/brands with a
  349-line form modal and 365-line detail modal), orders, vendors, billing, storefront
  branding, and six platform pages.
- **Media** — `MediaUploader` (drag-drop + XHR progress), `MediaPickerModal`, `ImageField`;
  `lib/upload.js` implements presign → PUT → confirm and correctly sends app auth headers
  only for same-origin (local provider) uploads, never to a presigned S3 URL.
- **Vite** — binds `0.0.0.0`, `allowedHosts: true`, proxies `/api` **and** `/media/local` to
  `:4000`. Already sandbox/live-preview safe.

### 3.3 Mobile (`apps/mobile`)

Expo 52 / RN 0.76, a single `App.jsx` login screen using the shared client with an in-memory
storage shim. It is a proof that the core is portable — nothing more. Hardcoded demo
credentials (`admin@flowermarket.in` / `Admin@12345`) sit in the source.

---

## 4. What I verified in this sandbox

| Check | Result |
|---|---|
| `npm install` backend / frontend | ✅ clean (0 vulnerabilities reported; 937 FE packages) |
| `node --check` on all 200+ backend `.js`/`.mjs` | ✅ 0 syntax errors |
| `import('./src/app.js')` (resolves the full module graph) | ✅ OK — every route/controller/service/model import resolves |
| `import('./src/routes/index.js')` | ✅ OK — no missing controller methods at wire time |
| `npm run build` (frontend) | ✅ 2254 modules, 371 KB JS / 105 KB gzip, 4.1 s |
| Endpoint contract diff (client ↔ routes) | ⚠ 1 drift (F4 below) |
| Backend smoke suites (10 files, ~3.5k LOC) | ❌ **cannot run here** — `mongodb-memory-server` fails to download mongod (`fastdl.mongodb.org` unreachable: `ECONNRESET`). No local `mongod`, no proxy. Needs a real Mongo URI or a pre-cached binary. |

Bundle note: the console ships as one 372 KB chunk — Recharts and all 24 pages are eagerly
imported. Route-level `React.lazy` would cut first paint substantially.

---

## 5. Findings, ranked

### Security / correctness

**F1 — `/catalog/tenant/*` has no role guard (high).**
`catalog.tenant.routes.js` applies `router.use(authenticate)` and nothing else; the file
comments admit "role gating for 'manager' is a future RBAC refinement". Any authenticated
user of a tenant — including a plain `customer` — can create listings, change prices
(`PATCH /listings/:id/price`), change stock, and reserve/release inventory.
_Fix:_ `router.use(authorize(ADMIN, SUPER_ADMIN, VENDOR))` (or a new `store_manager` role).

**F2 — `/media/*` is authenticated but unauthorized and unquotaed (medium).**
Any logged-in customer can presign and PUT up to 250 MB per video with no per-user/tenant
cap and no rate limit. Storage-abuse / cost vector.
_Fix:_ role gate presign, add a per-tenant quota check in `media.service`, add a limiter.

**F3 — CORS allows every origin in development (medium).**
`app.js`: `if (!origin || config.corsOrigins.includes(origin) || config.isDev) return cb(null, true)`.
Fine locally, dangerous if anything ships with `NODE_ENV` unset (`env` defaults to
`'development'`, so a mis-deploy is open by default). Prefer failing closed and listing the
preview host explicitly.

**F4 — Contract drift: `adminInvoiceDetail` calls a non-existent route (low).**
`endpoints.js` exposes `GET /marketplace/admin/billing/invoices/:id`; `marketplace.routes.js`
only has the list route. Currently unused by any page, so it's a latent 404.
_Fix:_ add the route, or delete the helper.

**F5 — Dead branch in `tenantContext` (low).**
`if (!tenantId && req.auth?.tenant)` — `tenantContext` runs before `authenticate`, and
`authenticate` writes `req.auth.tenantId` (not `.tenant`). The branch is unreachable twice
over. Harmless today, but it misleads: it implies token-based tenant resolution works
without the header, which is precisely the trap `apps/web/src/api.js` documents at length.

**F6 — Validation coverage is uneven (low-medium).**
Route-level `validate()` density: `/fulfillment` 3 hits across 20 routes, `/returns` 2/5,
`/cart` 5/11, `/orders` 2/4. Params/bodies on those paths reach services unchecked (Mongoose
casting is the only backstop → `CastError` 400s instead of clean `VALIDATION_ERROR` details).

**F7 — `authenticate` hits the DB on every request** (`User.findById`) with no cache. At
scale this is one extra round trip per call; a short-TTL cache or trusting the JWT claims for
read-only paths would help.

**F8 — Money as floats.** `roundMoney` is applied consistently, so drift is bounded, but
commission (`GMV × bps`), pro-rata adjustments and tax splits are exactly where float
rounding bites. Integer paise would remove the class of bug entirely.

### Repository hygiene

**F9 — Uploaded binaries are committed.** `backend/storage/local/**` (12 images, 906 KB) is
tracked in git; `backend/.gitignore` doesn't exclude `storage/`. Runtime upload output should
never be in the repo.

**F10 — Stray root `package-lock.json`** named `"bloomy"` with an empty `packages` map — a
leftover; it makes the root look like a workspace root when it isn't.

**F11 — No CI, no linter, no formatter, no test runner.** The 10 smoke suites are excellent
in content but are invoked manually, only 3 of them are wired into `package.json` scripts
(`smoke`, `smoke:catalog`, `smoke:order`), and nothing enforces them. Code references
`eslint-disable` comments for an ESLint config that doesn't exist.

**F12 — `.env.example` has inline comments after values** (`JWT_ACCESS_TTL_SECONDS=900          # 15 minutes`).
`dotenv` keeps `#`-comments only when unquoted values are trimmed — it works today, but it's
fragile; several parsers (and `docker --env-file`) would ingest the comment.

### Product-level gap

**F13 — The customer never sees this system.** 82 endpoints across cart, orders, returns,
wallet, rider, fulfillment, policies and the tenant catalog portal have no client. The
backend can run a full grocery-style commerce operation; the shipped UI can only administer
it. That's the single biggest asymmetry in the repo, and the highest-leverage place to build.

---

## 6. Recommended next moves

**Immediate (hours)**
1. Add `authorize(...)` to `/catalog/tenant/*` and `/media/presign` — F1/F2.
2. Delete or implement `adminInvoiceDetail`; delete the dead `tenantContext` branch — F4/F5.
3. `git rm -r --cached backend/storage` + add `storage/` to `backend/.gitignore`; drop the
   root `bloomy` lockfile — F9/F10.
4. Fail-closed CORS with an explicit preview-host allowlist — F3.

**Short (days)**
5. Add GitHub Actions: `node --check` sweep, `vite build`, and the smoke suites against a
   `mongo:7` service container (which also fixes the "can't run tests offline" problem).
6. Fill the `validate()` gaps on `/fulfillment`, `/cart`, `/returns`, `/orders` — F6.
7. Code-split the console with `React.lazy` per route (372 KB → a fraction on first paint).

**Strategic (weeks)**
8. **Build the customer surface** — the storefront (`GET /marketplace/stores/:slug` already
   returns branding + products) and the mobile shopping flow: catalog → cart → slot picker →
   checkout (`confirmPriceChanges` + idempotency key) → track (`/orders/:id/timeline`) →
   returns/wallet. Every endpoint already exists and is smoke-tested; the shared client makes
   it a UI-only exercise. `docs/ROADMAP.md` even ships the screen→endpoint mapping.
9. Build the **rider app** on the 9 `/rider` state-machine endpoints and the **picker** view
   on `/fulfillment` — currently the two roles with backend support and zero tooling.
10. Move money to integer paise before real payouts / GST invoicing land — F8.

---

## 7. Codebase statistics

| Area | Files | LOC |
|---|---:|---:|
| Backend `src/` | 200 | 18,898 |
| — services | 46 | 9,303 |
| — models | 76 | 3,702 |
| — controllers | 18 | 2,106 |
| — routes | 16 | 806 |
| Backend `scripts/` (seed, dev-server, 10 smoke suites) | 14 | 3,500 |
| Backend `docs/` | 5 | 1,693 |
| Frontend `apps/web/src` | 40 | 5,523 |
| Frontend `packages/shared` | 7 | ~500 |
| Spec docs `uploads/` | 9 | 1,789 |

Largest single files: `order.service.js` (702), `productMaster.service.js` (497),
`fulfillment.service.js` (384), `MasterDetailModal.jsx` (365), `billing.service.js` (357).
