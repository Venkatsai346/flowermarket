# Flower Market — Deep Repository Analysis (current)

_Analysis date: 2026-09-06 · branch `arena/01a074b5-flowermarket` · base commit `e68e787`
(`feat: add Phase 11 cross-cutting polish and hardening`)_

This document **supersedes** the 2026-09-03 Phase-6 analysis. Everything below was re-derived
from the current tree and, wherever possible, actually executed in this sandbox:
`npm install` (backend 181 pkgs, frontend 938 pkgs), every DB-free backend suite, the
`search-eval` gate, the invariants suite, the storefront test, the shared-client tests,
all 11 admin-console TAP suites, and both Vite production builds.

---

## 0. TL;DR

1. **The platform is a multi-tenant flower marketplace with three clients on one API**:
   an admin console (`apps/web` — store admin, platform super-admin, vendor, rider),
   a customer storefront (`apps/storefront` — boots from the hostname alone), and a
   mobile scaffold (`apps/mobile` — login only). The backend is the product:
   **79 models · 59 services · 23 controllers · 20 route modules · 295 endpoints · ~29.5k LOC**.
2. **All backend Phases 1–6 are shipped and green.** In this session: money 60/60,
   GST 78/78, payout 47/47, payout-provider 52/52, hostname 55/55, ranking 79/79,
   invariants 8/8, refund-calc 6/6, slot-forecast 4/4, search-eval **NDCG@10 0.996**
   (gate 0.85). The 13 DB-backed smoke suites are written and wired but cannot run here
   (no mongod binary available in the sandbox; they skip loudly by design).
3. **All 12 phases of the admin-web plan are shipped** (`ADMIN_WEB_PHASED_PLAN.md`),
   with 19 feature directories, ~15.6k LOC, 40 passing TAP meta-tests, and a green
   build (545 kB / 144 kB gzip). The console now has a rider workspace, fulfillment
   ops centre, after-sales/QC, policies/coupons, search tuning, GST + platform tax,
   user/staff/rider directory, inventory/hubs, catalog deep-admin, and the platform
   lifecycle/KYC/automation hub.
4. **The storefront is a complete customer loop**: discovery (search/autocomplete/
   categories), cart (server-side, coupons), OTP auth, checkout (address → held slot →
   payment incl. wallet gated on the exact server quote), order tracking, cancellation,
   returns (standard + instant claim), wallet and refunds. 1.8k+ LOC, 7/7 tests,
   build 290 kB / 88 kB gzip.
5. **What is incomplete is deliberately narrow**: no tenant lifecycle mutation API
   (suspend/activate — the only backend gap the console is waiting on), the legacy
   checkout pipeline still prices tax-on-top (MRP-inclusive migration deferred),
   the financial-doc layer is paise-native while orders/pricing/analytics still ride
   rupee-floats, all external providers are mock/console seams, `/fulfillment`
   validation is thin, there is no CI/linter, runtime uploads are still tracked in git,
   and the storefront lacks invoice links, address management, a notification inbox and
   pincode-aware entry.

---

## 1. Repository map

```
flowermarket/
├─ backend/                        Node 18+ ESM · Express 4 · Mongoose 8     ~29.5k LOC src
│  ├─ src/{config,constants,middleware,models,routes,controllers,services,utils}
│  ├─ scripts/                     26 test/demo files (pure + smoke + invariants + eval)
│  ├─ docs/                        API.md · DATA_MODELS.md · ROADMAP.md · ARCHITECTURE.md
│  └─ storage/local/               ⚠ 11 runtime uploads still tracked (~906 KB)
├─ frontend/                       npm-workspaces monorepo
│  ├─ packages/shared              @flower-market/shared — client, 273 typed endpoints,
│  │                               auth store, money/date/status utils (+13 tests)
│  ├─ apps/web                     React 18 + Vite 6 + Tailwind 4 admin console ~15.6k LOC
│  ├─ apps/storefront              React 18 + Vite 6 customer storefront  ~2.8k LOC
│  └─ apps/mobile                  Expo/RN scaffold — login screen only  ~194 LOC
├─ docs/                           REPO_ANALYSIS.md (this file), ADMIN_WEB_PHASED_PLAN.md
├─ uploads/                        10 phase-specification blueprints
└─ package-lock.json               ⚠ stray root lockfile named "bloomy"
```

| Area | Phase-6 snapshot | Now |
|---|---:|---:|
| Backend `src` LOC | 28,976 | **29,461** |
| Endpoints | 293 | **295** (294 router + `/health`) |
| Shared-client typed calls | 172 | **273** (all hit a real route — invariant) |
| Admin web `src` LOC | 7,012 | **15,622** (+495 test LOC, 11 TAP suites) |
| Admin web feature dirs | ~10 | **19** (all 12 plan phases present) |
| Storefront | ~1.85k LOC, 7 tests | **2,797 LOC, 7 tests** (same surface, hardened) |
| Mobile | 194 LOC scaffold | 194 LOC scaffold (unchanged) |

---

## 2. How the platform functions

### 2.1 Architecture patterns (backend)

**Strict one-directional layering** — `routes → controllers → services → models`:

- Routes declare paths + middleware only (`tenantContext` at router level, then
  `validate(Joi)` → `authenticate` → `authorize(roles)`).
- Controllers are thin adapters: parse validated input, call one service, wrap the
  response envelope. No business logic.
- Services hold every rule (sagas, state machines, money maths, eligibility gates).
- Models define schema + indexes + virtuals; three shared plugins (`softDelete`,
  `audit`, `toJSON`) are applied everywhere — **no destructive deletes in the codebase**.
- `utils/` holds pure, DB-free engines: `money.js` (paise), `gst.js`,
  `orderStateMachine.js`, `payoutStateMachine.js`, `hostname.js`, `ranking.js`,
  `queryUnderstanding.js` — the pattern that lets 450+ invariants run with no Mongo.

**Request lifecycle**: `helmet → raw-body webhook routes → host-aware CORS → json →
compression → morgan → /api/v1 → tenantContext → validate → authenticate → authorize →
controller → service → model → envelope → errorHandler`. The three webhook routes
(Razorpay payment, mock payment, payout provider) are mounted **before** `express.json`
so HMAC-SHA256 is computed over the exact bytes.

**Multi-tenancy** (`middleware/tenantContext.js`): resolution order
Host → header → default → bootstrap fallback, where **Host wins** —
`{slug}.{PLATFORM_ROOT_DOMAIN}` or a DNS-TXT-verified custom domain. An unknown store
subdomain **404s** (fail-closed, never the default tenant); infrastructure hosts
(localhost, IPs, the sandbox preview host) never resolve a tenant, so the header path
serves the admin console. `utils/hostname.js` treats `Host` as attacker input
(userinfo rejected, ports must be digits, 43 reserved slugs) and is fuzzed at 55 tests,
~1 µs per classification with a TTL+LRU cache that also caches negatives.
`authenticate` adds the tenant-scope guard: a token minted for tenant A is rejected on
tenant B's hostname (`TENANT_MISMATCH`).

**Roles** (RBAC): `customer · admin · picker · rider · vendor · super_admin`.
Sensitive routers apply `authorize()` at router level (the invariants suite fails the
build if a financial write path loses its guard); the UI mirrors this with `RoleGuard`
and a role-aware `HomeRedirect` (super_admin → `/platform`, admin → `/`, rider → `/rider`,
vendor → `/vendor`).

### 2.2 The money rules (the heart of the system)

**Two arithmetic regimes, bridged at one boundary:**

| Regime | Where | Rule |
|---|---|---|
| **Paise-native** | ledger, payouts, GST documents, refund math | integer paise; `allocatePaise()` largest-remainder so splits never lose a paisa; `splitTaxPaise()` makes `CGST + SGST === tax` structurally impossible |
| **Rupee-float (legacy)** | order totals, pricing engine, cart, wallet, analytics | `roundMoney` at every boundary; the Phase-3.5 pricing path still adds tax *on top* of price |

The bridge is `toPaise()` at the ledger boundary with a `rounding_difference` account
(tolerance ₹1 per order) so the journal **always balances** and the legacy drift stays
measurable. A full paise migration of the legacy pipeline is the known open item.

**Double-entry ledger** (`ledger.service.js` + `ledgerPosting.service.js`):

- Four enforced rules: every journal balances or nothing is written; journals are
  idempotent (`{kind}:{refType}:{refId}` keys); journals are immutable (corrections are
  reversing journals); `accountbalances` is a materialized view recomputable from
  entries (nightly `verifyBalances({repair:true})`).
- Transactions when the deployment is a replica set (probed once at boot);
  journal-first otherwise. `strict` mode is on by default in production.
- `sale_captured` on CONFIRMED: `DR gateway_clearing` (or `customer_wallet_liability` for
  wallet payments — decided from the Payment row, the money-movement truth) and
  `CR vendor_payable:{v}` / `platform_commission_income` / `gst_output_payable:{v}` /
  `tenant_payable:{t}` + delivery fee. Store-owned items accrue **no** commission per
  order (they are billed monthly by the billing cycle — double-counting avoided
  deliberately).
- `refund_issued` is a **proportional reversal of the original sale journal** — a refund
  can never touch an account the order didn't, nor exceed what was captured.
- Backfill sweep is idempotent, so a non-strict post failure self-heals nightly.

**Payouts** (`payout.service.js`, 1231 LOC — the largest service):

- `computeLineFinancials()` is pure and holds the worked example to the paisa
  (₹5900 gross → ₹5279.10 net after 10% commission, 18% GST-on-commission, 0.5% TCS,
  0.1% TDS); 20 000-case fuzz proves `net + deductions === gross`.
- Accrual at CONFIRMED (one `PayoutLineItem` per vendor item, deductions frozen at
  today's rates). Nothing payable until **both gates** open: return window closed
  (`deliveredAt + returnWindowDays`, perishables 1 day) and, optionally,
  `psp_settled` ledger entries (gate ships **off by default**).
- Batch state machine (11 states) whose **missing** `PROCESSING → QUEUED` edge is the
  whole double-payment defence: an in-flight batch is resolved by
  `reconcileInFlight()` (asking the provider by our idempotency key), never by retry.
  `REJECTED → DRAFT` exists (fix the numbers, resubmit); `REVERSED`/`CANCELLED` terminal.
- Provider contract has **three** outcomes: success / clean failure / ambiguous.
  Transport errors never throw — they leave the batch PROCESSING. Rail selection
  UPI/IMPS/NEFT/RTGS by amount. Ledger posts at submission; reversal posts the exact
  mirror journal. Bank-detail fingerprint change re-arms a **24 h freeze** and
  penny-drop re-verification. Distinct-approver dual approval above a threshold,
  per-batch ceiling, payout floor, negative-balance carry-forward.

**Wallet** — a real internal payment method: `walletService.debit` is versioned
(optimistic lock, retry-once); a `Payment.walletClaimToken` claim makes concurrent
retries run exactly one debiter and a crashed debit *heals* on retry instead of
double-charging; wallet refunds are always routed back to the wallet; the storefront
offers wallet payment **only** when the wallet balance covers the exact
`POST /cart/quote` grand total the server will charge.

**Refunds** — wallet by default, gateway (original method) above ₹2,000; a wallet
payment can only be refunded to the wallet. Component split
`item + tax + fee === amount` is persisted (credit-note ready) and idempotency keys
prevent double refunds.

### 2.3 Order lifecycle — the saga

`order.service.js` is an explicit **orchestrator** (not choreography). Checkout:

```
cart revalidation (stale-cart guard: price/stock diff → 409 until confirmPriceChanges)
→ slot hold must be this user's live HELD hold (10-min TTL)
→ address ownership snapshot
→ Order CREATED + OrderItems (price/title/tax/discount SNAPSHOT — never recomputed)
→ immutable OrderChargeBreakdown persisted
→ PAYMENT_PENDING + idempotent charge
   ├─ gateway async (Razorpay) → await webhook → confirmPayment() (replay-safe)
   └─ wallet → synchronous debit
→ hard-commit inventory (atomic; race loss → restore + full refund + release slot + CANCELLED)
→ slot CONFIRMED → fulfillment task queued → CONFIRMED
→ ledger sale_captured + payout accrual (safePost: never blocks confirmation in non-strict)
→ cart marked checked out + catalog event published
```

**Compensations** exist for every failure: payment fail → release slot + CANCELLED;
stock race loss → restore + refund + release + CANCELLED; cancellation is the reverse
saga (restore inventory → release slot → component refund → CANCELLED), allowed only
from `CREATED / PAYMENT_PENDING / CONFIRMED / PICKING / PACKED / DELIVERY_FAILED`.

**Order state machine** (16 states, frozen adjacency map, every transition writes
`OrderStatusHistory`): `created → payment_pending → confirmed → picking → packed →
out_for_delivery → delivered`, with `delivery_failed` retries (**max 2**, then cancel),
and the return sub-machine `return_requested → return_approved → return_picked_up →
qc_passed → refund_initiated → refunded` (or `qc_failed → refund_rejected`; instant
claim skips pickup: `return_approved → refund_initiated`).

**Fulfillment & rider**: `FulfillmentTask` (queued→picking→packed) for pickers;
`DeliveryAssignment` (pending_accept→accepted→at_hub→in_transit→arrived→delivered,
or failed/cancelled) for riders with **POD capture** (OTP hashed / photo / signature).
Ops dispatch auto-assigns by hub. Every real pick/pack/deliver duration is recorded
into `FulfillmentTimeLog` feeding the slot-forecasting loop.

**Slots** (BigBasket-style): `Hub` dark stores + `DeliverySlot` windows with hard
`totalCapacity`; the reserve is a guarded `findOneAndUpdate`
(`$expr reservedCapacity < totalCapacity`) so concurrent requests can never oversell;
HELD reservations expire via a TTL sweep; slot capacity can be generated from
forecast (upcoming demand + historical fill) with `overwrite` off by default.

**Inventory**: atomic reserve/commit/release, `version` optimistic locks, append-only
`InventoryAdjustment` ledger (restock/shrinkage/audit, reason required), denormalized
snapshots, auto OUT_OF_STOCK.

### 2.4 Catalog & search

- **Identity split**: `ProductMaster` (global: title, images, variants, EAV attributes,
  brand, category) vs `TenantProduct` (per-tenant price/stock/status). Customers see a
  merged view of ACTIVE listings of ACTIVE masters only.
- **Governance**: `ProductChangeRequest` workflow (propose → review), duplicate
  detection (exact barcode/SKU → 409; fuzzy title → 409 POSSIBLE_DUPLICATE),
  optimistic locks on masters/listings, category `attributeSchema` compliance, brand
  verification, price history, immutable audit trail, bulk CSV import as async jobs
  with templates.
- **Outbox**: catalog events (`catalogevents`) drained by handlers — the search
  indexer rides this existing plumbing (upsert on stable key, at-least-once safe).
- **Search ranking**: two-stage retrieval (bounded candidates from `searchdocuments`,
  then a pure in-process scorer — 2.4 ms per 1,000 candidates). Eight normalised
  signals (log-damped popularity, Bayesian-smoothed CTR, freshness half-life, stock,
  discount depth, return-rate penalty, editorial pin/bury, promotion boost) with
  **out-of-stock demoted, never filtered** — proven unbreakable across 300 randomised
  weight configurations. Ranking profiles and synonyms are editable **data** with
  deterministic A/B bucketing; query understanding extracts price intent, colour
  (inferred bias, never a hard filter) and one-way synonyms (`gulab`→rose); typo
  correction is against the store's own vocabulary and short tokens are never
  substituted. Zero-result queries relax (colour → price → tokens). A PII-free sampled
  query log feeds analytics. **`search-eval.mjs` is a gate: NDCG@10 0.996 vs 0.85.**

### 2.5 Marketplace, billing, platform

- **Store self-service**: public store registry, `POST /marketplace/tenants/register`
  → trial (14 days default) → plan subscription; subscription states
  `trial / active / past_due / overdue / no_plan` with grace days (7) and an
  overdue sweep; store branding (name/tagline/logo/banner/socials) drives the
  storefront theme.
- **Billing cycle**: idempotent invoice generation = subscription fee + commission on
  GMV; invoice pay/void; platform rollup analytics (GMV, net, commissions, MRR,
  by-plan, top tenants/vendors).
- **Vendor onboarding**: application → super-admin review; vendor product submissions
  → product review gate; per-vendor `commissionRateBps` (default 1%); vendor KYC +
  payout account (UPI/bank) with penny-drop verify and the 24 h freeze on change.
- **GST** (`tax.service` + `taxDocument.service` + `gstrExport.service`):
  effective-dated rates as data (TCS u/s 52, TDS u/s 194-O with notification refs);
  **one `TaxDocument` collection** for invoices *and* credit notes with gapless
  per-FY numbering (atomic `$inc`; cancelled, never deleted); **one invoice per
  selling entity** (multi-vendor orders produce several); tax is **reconstructed**
  from what the customer was actually charged (persisted on `orderitems`), only split
  into CGST/SGST/IGST by place of supply; nil-rated ≠ 0% taxable; s.170 round-off;
  GSTIN mod-36 checksum; IRN via `einvoiceProvider` (console/mock/gsp) with nightly
  retry; 7 filing-workpaper renderers (GSTR-1 b2b/b2cs/HSN/CDNR, GSTR-8 TCS,
  TDS-194O, sales register) on the existing `ExportJob` machinery (13 export types).
- **Nightly pipelines** (`maintenance.service`): per-tenant — forecast, analytics
  rollup, scheduled exports, event drain, notification worker, ledger backfill +
  drift check, payout eligibility sweep + in-flight reconciliation, e-invoice retry;
  platform — billing cycle, overdue sweep, platform rollup. Every step isolated
  (a failure in one never aborts the rest) and idempotent.
- **Notifications**: outbox + templates-as-data (CRUD in console), dedupe keys,
  channel abstraction (console/mock; FCM/APNs/SMTP/Twilio seams), device registry,
  catalog-event → notification mapping, admin send/process endpoints.
- **Domains**: `TenantDomain` with DNS-TXT verification gating resolution and TLS;
  `tls-check` hook; public `GET /domains/bootstrap` (branding + theme + canonical
  host from the Host alone); store-facing Domains page with copy-to-clipboard DNS.

### 2.6 Frontend patterns (shared across clients)

- **One shared core** (`packages/shared`): `createApiClient` (envelope handling,
  single-flight token refresh with retry, `raw`/`download` for CSV), `createEndpoints`
  (273 typed helpers, 1:1 with the route table — the invariants suite fails on drift),
  `createAuthStore` (zustand, injectable storage/persist key), money/date/format/status
  utils. **No raw `fetch` in page components — every call goes through `api.*`.**
- **Admin console**: 19 feature directories on a uniform pattern
  (`useApi` + `components/ui/*` + `TrendChart` + feature-local `*Meta.js` status maps
  with TAP tests covering every documented machine value); `FilterBar`, `useDownload`,
  `saveDownload` primitive; role-aware Sidebar (Platform / My store / Catalog / Vendor /
  Rider groups) + `RoleGuard` + `HomeRedirect`; destructive actions get confirm modals;
  money/ops-sensitive buttons are disabled by the *previous* server status (the UI
  never calls an invalid state transition).
- **Storefront**: boots from the single parameterless `GET /domains/bootstrap` — the
  bundle contains **no tenant id** and sends no `x-tenant-id` header (structurally
  incapable of addressing the wrong store); brand colours arrive as data and become CSS
  custom properties with on-brand text chosen by **computed WCAG luminance**; cart is
  server-side (client keeps a snapshot for instant badge/drawer); sessions namespaced
  per hostname (`fm-shop:{host}`) so two stores in two tabs can't share a cart;
  customers see **5 states, not 16** (a status-translation map).
- **Mobile**: Expo scaffold proving the shared core on React Native (login screen,
  in-memory storage shim, `EXPO_PUBLIC_API_URL` config).

---

## 3. Verified in this session (2026-09-06)

| Check | Result |
|---|---|
| `npm install` backend / frontend | ✅ 181 / 938 packages, clean |
| `scripts/money.test.js` | ✅ **60/60** (paise boundary, allocation fuzz, CGST+SGST proof, multi-vendor, wallet source) |
| `scripts/tax-calc.test.js` | ✅ **78/78** (inclusive/exclusive, 2×20k fuzz, GSTIN checksum, s.170) |
| `scripts/payout-calc.test.js` | ✅ **47/47** (worked example to the paisa, batch state machine incl. the missing edge) |
| `scripts/payout-provider.test.js` | ✅ **52/52** (3-outcome contract, rail selection, mock unhappy paths) |
| `scripts/hostname.test.js` | ✅ **55/55** (14 hostile hostnames, zero resolve to a store) |
| `scripts/ranking.test.js` | ✅ **79/79** (300-config in-stock floor, A/B stability, typo rules) |
| `scripts/search-eval.mjs` | ✅ **NDCG@10 0.996** vs 0.85 gate (12-query judgment set) |
| `scripts/invariants.test.js` | ✅ **8/8** (audit enum, import resolution, **273/273 client calls hit a route of 295**, ledger types, **82/82 env vars documented**, role guards) |
| `scripts/refund-calc.test.js` · `slot-forecast.test.js` | ✅ 6/6 · 4/4 (⚠ not wired into `smoke:all`) |
| DB-backed smoke × 13 (user, catalog, order, phase35, admin, ops, marketplace, media, ledger, GST, payouts, domains) | ⏭ written + wired; **cannot run here** — mongod binary download blocked (ECONNRESET); they skip loudly by design, no local `mongod` available |
| Frontend `npm run build` (web + storefront) | ✅ web 545/144 kB gzip (⚠ 500 kB chunk warning) · storefront 290/88 kB gzip |
| Storefront `npm test` | ✅ 7/7 (after-sales display invariants) |
| Admin console TAP suites × 11 | ✅ **40/40** (meta maps cover every documented machine value, download filename parsing) |
| Shared-client tests × 3 | ✅ **13/13** (client refresh/retry, endpoint↔route shape, status maps) |

---

## 4. Completed work

### 4.1 Backend — Phases 1–6, complete

| Phase | Status | What shipped |
|---|---|---|
| 1 — user domain | ✅ | OTP auth (provider seam), JWT 15 min + rotating hashed refresh 30 d, device sessions, profiles, addresses (serviceability stamps, exactly-one-default), RBAC, tenant scaffolding, rate limiters |
| 2a — catalogue | ✅ | Master/TenantProduct split, change-request approval, duplicate detection, optimistic locks, category tree + attribute schemas, brand registry, EAV, variants/images, merged public view, atomic inventory, price history, audit, event outbox, bulk CSV jobs |
| 2b+3 — order lifecycle | ✅ | slots engine (atomic locks, HELD TTL, sweep), cart (snapshots, 409 revalidation, coupon apply), saga orchestrator with compensations, Razorpay hardening (webhook replay, idempotency), fulfillment + POD, delivery retry (max 2), returns (pickup-QC + instant claim), wallet, idempotent component refunds |
| 3.5 — policies/rider/forecast | ✅ | delivery-fee/tax/coupon/refund policy engines (immutable charge breakdown), rider state machine (9 routes), slot forecasting (record/forecast/history), GSTIN-aware category tax lookup |
| 4 — admin dashboard API | ✅ | products/inventory/hubs/slots/orders/users CRUD+CSV, analytics (KPIs, top products, category/hub/slot performance, rebuild) |
| 4b — ops tooling | ✅ | notification outbox + templates-as-data + worker, scheduled/one-off exports (13 types) + artifacts, per-tenant + platform nightly pipeline |
| 5 — marketplace | ✅ | tenant self-service + trial, plans + billing cycle + overdue sweep, vendor applications + product review, per-vendor commission, platform analytics rollup, store branding |
| 6.0 — pre-flight | ✅ | catalog-tenant RBAC closed, media role-gate + per-tenant quota, audit-enum gate, host-aware CORS, latent 500 fixed |
| 6.1 — money core | ✅ | paise engine, double-entry ledger (balanced/idempotent/immutable/recomputable), posting service (sale/refund), backfill + verify sweeps, optional transactions |
| 6.2 + M3 — GST | ✅ | effective-dated rates, one-doc-per-supplier, gapless FY numbering, cancel-never-delete, reconstruction, IRN provider + retry queue, 7 GSTR/working-paper renderers |
| M4 — payout accrual | ✅ | pure financials, 11-state batch machine, two eligibility gates, refund reversal/clawback, carry-forward, dual approval, 24 h freeze, statements |
| M5 — disbursement | ✅ | 4-provider seam with 3-outcome contract, HMAC webhook (raw body), reconcile-in-flight, settlement ingest, rail selection, ledger + mirror reversal |
| M6 — payout console API | ✅ | vendor vs platform hard separation, read-only `/ledger` (5 routes, no posting endpoint by design) |
| P1 — domains | ✅ | Host-first fail-closed resolution, verified custom domains, negative cache, reserved slugs, TLS hook, host-aware CORS |
| P2 — storefront backend | ✅ | parameterless bootstrap, after-sales + wallet payment method, `POST /cart/quote` preflight |
| S1–S3 — search | ✅ | two-stage retrieval, pure scorer, A/B profiles, synonyms/typos, query understanding, zero-result relaxation, query log + analytics, NDCG gate |

**Route surface (295 endpoints / 20 mounts)**: `/auth` 8 · `/users` 19 · `/catalog` 5
· `/catalog/tenant` 20 · `/catalog/admin` 25 · `/cart` 12 · `/orders` 4 · `/returns` 5
· `/wallet` 3 · `/fulfillment` 20 · `/rider` 9 · `/policies` 10 · `/admin` 48 ·
`/marketplace` 39 · `/media` 6 · `/tax` 14 · `/payouts` 25 · `/ledger` 5 · `/domains` 8
· `/search` 9 · `/health` 1.

### 4.2 Admin web (`apps/web`) — all 12 phases of the plan shipped

| Plan phase | Status | Surface |
|---|---|---|
| 0 — client parity + downloads | ✅ | 273 typed `api.*` helpers (incl. every ops/payout/tax/domain surface), `raw`/`download` client primitive, `lib/download.js` + `useDownload`, zero raw `fetch` |
| 1 — fulfillment ops centre | ✅ | `ops/` — Picking / Delivery / Slots / Payments tabs, order ops drawer, POD modal, slot generator (overwrite off), utilization grid, forecast panel, payment reconcile (operator-triggered only) |
| 2 — returns, QC, manual refunds | ✅ | `aftersales/` — return list + detail drawer (instant-claim flagged at a glance), pickup confirm, QC pass/fail (note required on fail), refunds tab + guarded manual refund with idempotency key |
| 3 — rider workspace | ✅ | `rider/` — mobile-friendly delivery queue, status-driven action buttons, accept/reject/arrive-hub/depart/arrive/complete (POD)/fail, availability switch; rider role lands on `/rider` |
| 4 — policies & coupons | ✅ | `policies/` — delivery-fee card + modal, tax policy upsert (category picker), coupon CRUD + live preview, refund policy |
| 5 — search admin | ✅ | `search/` — ranking profile editor, synonyms, health card + reindex modal, analytics chart |
| 6 — GST/tax admin | ✅ | `tax/` — registration, documents (issue/cancel/credit-note/e-invoice retry), series audit, statutory rates; platform tax surface in `platform/` (rate policies super_admin-only) |
| 7 — users/staff/riders | ✅ | `users/` — directory with filters, detail drawer (addresses, wallet, order summary, returns), create staff (super_admin never offerable), status/role changes with self-change disabled, rider stats |
| 8 — inventory & hubs | ✅ | `inventory/` — summary cards, ledger drawer, adjust modal (reason required), CSV export; `hubs/` — hub CRUD, pincode editor with diff, slot capacity, slot grid with override/status |
| 9 — catalog depth | ✅ | `catalog/` — `CatalogOpsPage` with listings (price/status/stock, conflict surfacing), review queue (change requests), bulk upload (jobs, template download), audit panel, event console (drain/status) |
| 10 — platform lifecycle/KYC/ops | ✅ | `platform/PlatformLifecyclePage` — Lifecycle (read-only tenant/vendor/KYC risk board), KYC review modal (the console's main compliance action), Automation (nightly, billing, overdue, rollup, eligibility sweep, reconcile, event drain, due exports) |
| 11 — cross-cutting polish | ✅ | `FilterBar` everywhere, `EmptyState`/`Spinner` coverage, danger-variant destructive modals, download UX, 11 TAP meta-test suites (40 assertions), role-aware sidebar complete |

Plus the pre-plan surface (Phase 4–5 console): dashboard KPIs + trends, catalog
masters/categories/brands + media uploader, orders, store vendors + sync, store
billing, branding + domains, platform overview/stores/vendor-applications/vendors/
billing/plans/payouts/ledger, vendor profile/products/payouts/payout-account.

### 4.3 Storefront (`apps/storefront`) — the customer loop is complete

- **Boot & branding**: parameterless bootstrap; brand soft/strong colours → CSS
  variables; WCAG-computed text colour; document meta from store data; graceful
  STORE_NOT_FOUND vs unavailable screens.
- **Discovery**: category rail, sort, in-stock filter, product grid, debounced
  autocomplete (`/search/suggest`), relevance beacon (`/search/events`), zero-result
  recovery, product sheet (qty, add to cart).
- **Cart**: server-side; guest cart; inline steppers; coupon apply/remove; price-change
  revalidation surfaced; instant badge/drawer.
- **Auth**: phone OTP sheet (request/verify), per-hostname namespaced session, account
  menu.
- **Checkout**: address pick/add (inline), 3-day slot browse + atomic reserve, payment
  choice UPI / **wallet** (shown only when the wallet covers the exact
  `POST /cart/quote` grand total; auto-falls back to UPI if it stops covering),
  idempotent checkout, server-authorized totals.
- **Orders & after-sales**: order list, order detail (5-state translation, timeline,
  cancel with server eligibility), returns page + sheet (standard pickup-QC and
  instant claim, item-level qty capped at remaining returnable), wallet page (balance,
  transactions, refunds).

### 4.4 Shared core — complete for everything the two shipped clients need

Client (refresh/retry/raw), 273 typed endpoints (contract-verified), auth store,
money/date/format/status utils — 13/13 tests green, consumed by web, storefront and
the mobile scaffold.

---

## 5. Incomplete work (and why)

### 5.1 Backend

| # | Item | Severity | State / reason |
|---|---|---|---|
| B1 | **Tenant lifecycle mutations** — no `POST /marketplace/admin/tenants/:id/status` (suspend/activate, plan change) exists; `/marketplace/admin/tenants` is read-only | **High** (the one console blocker) | The admin LifecyclePanel is deliberately read-only because of this. Suspending a store, forcing a plan change or closing a tenant is impossible from the product today |
| B2 | **Inclusive-pricing checkout (M2b)** — the checkout pricing path (`pricingPolicyService.computeOrderCharges`) still prices **tax on top**; `TAX_PRICES_INCLUSIVE` exists and the GST engine handles both modes, but the customer-facing pipeline was never flipped | **High** (market-correct pricing) | Flipping changes what customers are charged → needs its own migration + comms; invoices are safe either way (they reconstruct) |
| B3 | **Dual money regimes** — orders/pricing/cart/wallet/analytics ride rupee-floats; ledger/payouts/GST docs are paise-native; bridged via `toPaise` + `rounding_difference` (≤₹1/order, asserted) | Medium | The ledger is exact while the rest of the product is a half-paise away; full integer-paise migration of the legacy pipeline is open |
| B4 | **PDF invoice / credit-note rendering** | Medium (presentation, not correctness) | Numbered, IRN-ready, exportable — just not printable; needs a rendering dependency |
| B5 | **Live provider wiring** — Razorpay keys, RazorpayX/Cashfree payout credentials, GSP e-invoice, FCM/APNs/SMTP/Twilio, msg91/Twilio/SES SMS+OTP, Atlas/OpenSearch search, S3 storage, real billing gateway | Expected pre-launch | All seams implemented with mock/console defaults and loud failures; a production deploy pointing at a mock provider is only caught at runtime (see B10) |
| B6 | **PSP settlement gate** (`requirePspSettlement`) and **non-Razorpay webhook verification** | Medium (money safety) | `ingestPspSettlements()` exists but the gate defaults to `false`; payout webhook verification is Razorpay-only |
| B7 | **Validation density** — `validate()` coverage: `/fulfillment` 3/20, `/returns` 2/5, `/orders` 2/4, `/cart` 6/12, `/search` 4/9, `/ledger` 2/5, `/domains` 4/8, `/policies` 6/10; Mongoose casting is the only backstop in places | Medium | Params/bodies reach services unchecked in places (worst: the ops surface) |
| B8 | **No CI / linter / formatter / test runner**; `smoke:all` omits `refund-calc` + `slot-forecast` (both green when run manually) | Medium | All 26 scripts are hand-rolled `node` files; nothing runs automatically |
| B9 | **Repo hygiene** — 11 runtime uploads tracked under `backend/storage/local` (~906 KB) despite `.env.example` saying keep out of git (`.gitignore` doesn't exclude `storage/`); stray root `package-lock.json` named `"bloomy"` | Low | One `git rm -r --cached` + ignore entry fixes it |
| B10 | **No boot-time provider sanity check** — a `NODE_ENV=production` deploy silently running `console`/`mock` payment/payout/billing/notification/search providers | Medium | Worth a `--check-config` assertion that aborts (or warns loudly) |
| B11 | **Customer notification inbox has no client path** — `GET /users/me/notifications` + mark-read exist, but the shared client has no helper and no UI renders them | Low | The notification *system* (outbox, templates, worker, admin send) is complete; the customer-facing read side is orphaned |
| B12 | **Mongo as replica set** — documented infra task so ledger transactions activate | Low (infra) | Fallback (journal-is-truth + nightly repair) is verified working |
| B13 | **Phase-7 candidates** — multi-currency, e-way bills, vendor credit lines, learning-to-rank, buyer-side ITC portal, real-time settlement | Out of scope (explicit non-goals) | Query log is already being collected as LTR training data |

### 5.2 Admin web

The plan is **12/12 complete**; the residue is:

| # | Item | Severity | State / reason |
|---|---|---|---|
| A1 | **Tenant lifecycle actions** | High | Blocked by B1 — the UI must not stage a button that 404s; the plan explicitly says wire once the backend lands |
| A2 | Vendor product **edit** | Low | `updateVendorProduct` is typed in the shared client but no UI invokes it (list + create + platform review exist) |
| A3 | Customer notification inbox | Low | Follows B11 |
| A4 | No per-page component tests | Low | 11 meta-map TAP suites (40 assertions) cover the machine-value maps; pages themselves are covered only by build + contract invariants |
| A5 | Build chunk > 500 kB | Low | Vite warns; dynamic imports exist for the lazy pages, but a `manualChunks` split (e.g. lucide/icons or charts) would clear it |

### 5.3 Storefront

The core loop is complete; the gaps are customer-surface depth:

| # | Item | Severity | State / reason |
|---|---|---|---|
| S1 | **No invoice/tax document access** | Medium | Backend `GET /tax/orders/:id/invoice` (customer-scoped) + `api.tax.orderInvoice` helper exist — the order detail page never links them. A customer cannot retrieve their GST invoice |
| S2 | **No address management** | Medium | Addresses can be added inline at checkout; `updateAddress` / `removeAddress` / `setDefaultAddress` are typed in the shared client but no UI uses them |
| S3 | **No notification inbox** | Low | Follows B11 (backend routes exist, no client helper, no UI) |
| S4 | **No pincode-aware entry** | Medium | The roadmap's RN mapping and the slots API are pincode-aware, but Home doesn't take a delivery pincode to gate the catalogue/service area before browsing |
| S5 | **No deep-linkable product route** | Low | Products open in a sheet only; no `/product/:id` URL (no shareable links) |
| S6 | **No dedicated search results page** | Low | Search is a query state on Home (works, but no `/search?q=` URL, no facets UI despite the backend supporting facets) |
| S7 | **No customer reviews/ratings** | Out of scope | No backend model exists; the ranking's "review score" signal is CTR-based only |
| S8 | **No guest checkout** | Low | Cart is anonymous; checkout requires OTP (a deliberate choice, not a bug) |

### 5.4 Mobile

| # | Item | State |
|---|---|---|
| M1 | Everything except login | Expo scaffold: shared client + auth store proven on RN, in-memory storage shim, hardcoded demo creds. No catalog/cart/checkout/orders/returns/wallet UI. The canonical screen→endpoint mapping is documented in `ROADMAP.md` for the build |

### 5.5 Repo

| # | Item | Fix |
|---|---|---|
| R1 | Tracked runtime uploads + "bloomy" lock | `git rm -r --cached backend/storage`, add `storage/` to `backend/.gitignore`, delete root lock |
| R2 | No CI | `mongo:7` service container + `node --check` sweep + all pure suites + all smoke suites + both vite builds + NDCG gate — would also retire the "can't run tests offline" problem |
| R3 | `docs/REPO_ANALYSIS.md` was a stale Phase-6 snapshot | Superseded by this document |

---

## 6. Findings & recommended next moves

**Immediate (one session)**
1. **B1 — tenant lifecycle API** (suspend/activate + forced plan change on
   `/marketplace/admin/tenants/:id/status`), then wire the console LifecyclePanel
   actions. It is the single highest-leverage backend gap: the console, the billing
   cycle and vendor management all already assume a tenant *state* they can't change.
2. **R1 — stop committing runtime uploads** (gitignore + untrack; delete the bloomy lock).
3. **B8/R2 — CI with a Mongo service**: it makes every "cannot run here" disappear and
   freezes the 450-invariant baseline.

**Short (days)**
4. **S1+S2 — storefront invoice link + address management** (both backend-complete,
   both shared-client-typed, both small UI wins that complete the customer loop).
5. **B10 — boot-time provider sanity check** for production (abort on
   `console`/`mock` payment/payout/billing/notification/search).
6. **B7 — close the `validate()` gaps** on `/fulfillment` (3/20) first, then
   `/returns`, `/orders`, `/cart`.
7. **S4 — pincode-aware storefront entry** (service-area gating before browsing).
8. **B3 — paise migration of the legacy order/pricing path** (helpers exist; the
   `rounding_difference` account already measures exactly how far off we are).

**Strategic (weeks)**
9. **B2 — MRP-inclusive checkout** (its own migration + comms; the invoice layer is
   already mode-agnostic).
10. **B4 — PDF invoices** (presentation dependency, unblocks the storefront invoice
    link's value).
11. **B5 — live provider rollout** in dependency order: storage (S3) → payments
    (Razorpay) → payouts (RazorpayX/Cashfree) → e-invoice (GSP) → notifications (FCM/
    SMTP) → search (Atlas/OpenSearch), each behind its env flag with the B10 check on.
12. **M1 — the real mobile shopping app** on the shared core (mapping documented).
13. **S3/B11 — customer notification inbox** (shared helper + a bell on the storefront,
    one console view).
14. **Phase-7 candidates when ready** — multi-currency, e-way bills, vendor credit
    lines, LTR from the query log, buyer-side ITC, real-time settlement (explicit
    non-goals of Phase 6, not regressions).

---

## 7. Codebase statistics (measured 2026-09-06)

| Area | Files | LOC |
|---|---:|---:|
| Backend `src/` | 228 | 29,461 |
| — services | 59 | largest: `payout.service.js` 1231 |
| — models | 79 | (incl. 3 plugins) |
| — controllers | 23 | |
| — routes | 20 (+index) | 295 endpoints |
| Backend `scripts/` | 26 | ~7k (pure + smoke + invariants + eval) |
| Admin web `src/` | ~95 | 15,622 (+495 test) |
| Storefront `src/` | 18 | 2,797 |
| Shared `src/` | 11 | 1,383 |
| Mobile | 6 | 194 |
| Spec docs `uploads/` | 10 | ~3.6k lines |

Largest backend files: `payout.service.js` (1231), `constants/enums.js` (1038),
`order.service.js` (779), `taxDocument.service.js` (765), `ledger.service.js` (588).
Largest frontend files: platform/ops/tax feature pages; storefront `Checkout.jsx` (381).
