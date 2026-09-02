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

## 🟠 Phase 6 — Money, Identity & Discovery (IN PROGRESS — 6.0 ✅ · 6.1 ✅ · 6.2 ✅ · M3 ✅ · M4 ✅ · M5 ✅ · M6 ✅ · P1 ✅)

Vendor payouts (real disbursement) · GST invoicing · subdomain routing · search ranking.
Full blueprint: **`uploads/phase6_payouts_gst_subdomains_search.md`**.

Ordering is forced by the money: payouts are computed from tax-correct invoice lines, and both
are computed from values that must never drift — so the phase runs
**pre-flight → money core → GST → payouts**, with subdomains and search as two independent
parallel tracks.

- **✅ 6.0 Pre-flight (SHIPPED)** — fixed the latent 500 in `wallet.service.ledger()`
  (`serializeList` used but never imported), closed the `/catalog/tenant/*` RBAC hole (20
  price/stock routes were `authenticate`-only, so a `customer` token could change prices —
  now `authorize(ADMIN, SUPER_ADMIN, VENDOR)`), gated `/media` writes to the same roles and
  added a per-tenant storage quota (`MEDIA_TENANT_QUOTA_BYTES`, default 5 GB, enforced at
  presign). Two corrections to the plan's assumptions, both found while executing:
  `catalog.tenant.controller` was a **false positive** (it uses a dynamic
  `await import('../utils/ApiError.js')`; tidied to a static import anyway), and a **new,
  worse defect** surfaced — 14 audit action strings (`invoice_generated`, `invoice_paid`,
  `invoice_void`, `plan_change`, `subscribe`, `nightly`, all five rider actions…) were
  missing from the `AUDIT_ACTION` enum, so Mongoose rejected the write and every call site's
  `.catch(() => {})` swallowed it: **the entire billing audit trail was silently discarded.**
  Enum extended to 39 values and the whole class of bug is now a CI gate.
  Mongo-as-replica-set remains an infra task (`LEDGER_DISABLE_TRANSACTIONS` documents the
  fallback; the service probes the server at boot and logs which mode it is in).
- **✅ 6.1 Money core (SHIPPED)** — integer-**paise** arithmetic (`toPaise`, `fromPaise`,
  `sumPaise`, `applyBps`), `allocatePaise()` largest-remainder splitting (replaces the biased
  "last line absorbs the rounding") and `splitTaxPaise()` making `CGST + SGST === tax`
  structurally impossible to violate. Full **double-entry ledger**: `ledgeraccounts`,
  `ledgerjournals` (balanced-or-nothing, unique `idempotencyKey`, immutable, `reversedPaise`
  cap), `ledgerentries` (append-only source of truth), `accountbalances` (materialized view
  via atomic `$inc`, recomputable). `ledgerPosting.service` translates business events:
  `sale_captured` on order CONFIRMED and `refund_issued` as a **proportional reversal of the
  original sale journal** — a refund can never touch an account the order didn't, nor exceed
  what was captured. Transactions are used when the deployment is a replica set (probed once);
  otherwise journal-first + `verifyBalances({repair:true})` closes the crash window. Wired
  into the nightly pipeline: per-tenant `backfillSales()` (idempotent, so a non-strict post
  failure self-heals) and platform-wide `trialBalance()` + drift alarm.
  Verified: `scripts/money.test.js` **56/56** (incl. a 10 000-case allocation fuzz and an
  exhaustive CGST/SGST proof) and `scripts/invariants.test.js` **6/6**, both DB-free and
  green; `scripts/smoke-ledger.test.js` covers 10 DB-backed scenarios (idempotent replay,
  8-way concurrent race, over-reversal guard, injected-drift detection + repair, backfill)
  and runs against `MONGODB_URI` — it skips loudly rather than failing when no Mongo is
  reachable.
- **✅ 6.2 GST invoicing (SHIPPED)** — pure engine in `utils/gst.js` (inclusive/exclusive
  modes, CGST/SGST/IGST by place of supply, nil-rated vs exempt, HSN summary, s.170 round-off,
  GSTIN **checksum** validation, 36 state codes with alias resolution, FY labelling) proven by
  `scripts/tax-calc.test.js` **78/78** including two 20 000-case fuzz runs. Persistence:
  `TaxRegistration`, effective-dated `TaxPolicy` (`rateBps`, `natureOfSupply`, `cessBps`),
  `StatutoryRate` (TCS/TDS as dated data with notification refs), `TaxDocumentSeries` and an
  immutable `TaxDocument` carrying both invoices and credit notes. `taxDocument.service`
  issues **one invoice per selling entity** (multi-vendor orders produce several), reconstructs
  tax from what was actually charged rather than today's rate table, credits refunds
  proportionally against the original document, keeps numbering gapless per FY, and registers
  IRNs through an `einvoiceProvider` abstraction (console/mock/gsp) with a nightly retry queue.
  15 new routes under `/tax`, split so that **rate policy is super_admin-only** — a store must
  never pick its own GST slab. `scripts/smoke-gst.test.js` covers 10 DB-backed areas (25-way
  concurrent numbering, FY rollover, idempotency, immutability, cancellation, unresolvable
  place of supply, IRN lifecycle).
  Original plan text: **6.2 GST invoicing (2.5 w)** — the current engine adds tax *on top* of the price and never
  splits it; India prices are MRP-**inclusive** and require CGST/SGST vs IGST by place of
  supply. Adds effective-dated rate data (`rateBps`, `natureOfSupply`, HSN), `TaxRegistration`
  (GSTIN per tenant/vendor), immutable `TaxInvoice` + `CreditNote` with gapless per-FY
  numbering, PDF through the existing media pipeline, e-invoice/IRN behind a provider
  abstraction, TCS u/s 52 + TDS u/s 194-O as data rows, and GSTR-1/GSTR-8/26Q exports reusing
  the Phase-4b `ExportJob` machinery. Fresh flowers are nil-rated and pots/tools are not, so
  multi-rate invoices with an HSN summary are the norm, not the exception.
- **✅ M3 GST filing exports (SHIPPED)** — seven new renderers plugged into the existing
  Phase-4b `ExportJob` machinery (no new export infrastructure): `gstr1_b2b` (invoice-wise,
  split by rate), `gstr1_b2cs` (consolidated by place of supply × rate), `gstr1_hsn`,
  `gstr1_cdnr` (credit notes against originals), `gstr8_tcs` (per-supplier TCS with the rate
  resolved from `statutoryrates` for the period, intra/inter split), `tds_194o` and a full
  `sales_register`. Computed from ISSUED documents only, never drafts or cancelled ones.
  These are working papers for an accountant, not a filing integration — stated plainly in
  the service header.
- **✅ M4 Payout accrual & cycles (SHIPPED)** — `computeLineFinancials()` is pure, so the
  blueprint's worked example (₹5900 → **₹5279.10**) is asserted to the paisa with no
  database, alongside a 20 000-case fuzz proving `net + commission + gstOnCommission + tcs +
  tds === gross` always. Six models (policy, payout account, line item, batch, status
  history, adjustment), an explicit batch state machine whose **missing** `processing →
  queued` edge is the whole safety design, two eligibility gates (return window + PSP cash),
  refund reversal that cancels unpaid lines and claws back paid ones, negative-balance
  carry-forward, distinct-approver dual approval, a 24h payout freeze on any bank-detail
  change, and the `payout_initiated` journal that drains exactly what `sale_captured`
  credited. 22 routes under `/payouts`, vendor and platform surfaces hard-separated.
  `scripts/payout-calc.test.js` **47/47**.
- **✅ M5 Disbursement, webhooks & reconciliation (SHIPPED)** — `payoutProvider` with four
  adapters (console/mock/razorpayx/cashfree) whose contract has **three** outcomes: success,
  clean failure, and **ambiguous**. Transport errors never throw and never fail the batch —
  they leave it PROCESSING for `reconcileInFlight()`, which asks the provider by our own
  idempotency key. Rail selection (UPI/IMPS/NEFT/RTGS by amount), HMAC-verified webhook on the
  raw-body pattern the Razorpay payment hook already uses (mounted before `express.json`),
  ledger posted at submission with a mirror `payout_reversed` journal on rejection or bank
  reversal, `ingestPspSettlements()` closing eligibility gate 2, payout statements as
  downloadable `ExportJob` artifacts (13 export types now), and reconciliation wired into the
  nightly pass. `scripts/payout-provider.test.js` **52/52** and
  `scripts/smoke-payouts.test.js` (11 DB-backed areas incl. the full ambiguous→reconcile
  path asserting no second journal is posted).
- **✅ M6 Payout console (SHIPPED)** — the money system now has a human interface.
  **Platform:** an approval queue that surfaces what needs a decision, a batch drawer with the
  full deduction waterfall and per-order lines, and — the important part — an in-flight batch
  offers **Reconcile and nothing else**, with no retry button anywhere on the screen. A ledger
  explorer with a live trial-balance banner, drift check and repair, and per-account
  statements. **Vendor:** their own payouts with an "eligible / still in the return window /
  on hold" summary that answers *why haven't I been paid* before they ask, a downloadable
  line-item statement, and a bank + KYC page with a three-item readiness checklist and an
  explicit explanation of the 24-hour hold after a bank change. Read-only `/ledger` API added
  (5 routes; deliberately no journal-posting endpoint — that would make the ledger
  unauditable). 276 routes, 124 shared-client calls, contract-drift check green.
- **6.3 Vendor payouts — original plan text: disbursement providers (razorpayx/cashfree),
  webhooks, the three reconciliation sweeps, payout statements as artifacts.** Original plan
  text: **(2.5 w)** — money moves only when **both** gates open: the return window
  has closed *and* the PSP has actually settled. `PayoutLineItem` eligibility ledger →
  `PayoutBatch` with an explicit state machine, maker-checker approval, KYC + penny-drop gate,
  24 h freeze on bank-detail change, `payoutProvider` abstraction (console/mock/razorpayx/
  cashfree) with **doubled idempotency** and never-blind-retry, plus three reconciliation
  sweeps and a line-item payout statement per batch.
- **✅ P1 Subdomain & custom-domain routing (SHIPPED)** — `Host` now resolves the tenant:
  `{slug}.{PLATFORM_ROOT_DOMAIN}` and verified custom domains, with the `x-tenant-id`
  override no longer able to beat a resolved Host in production. An unknown store subdomain
  **404s instead of falling back to the default tenant** — that fallback was the actual leak.
  `utils/hostname.js` is pure and treats Host as attacker input; its fuzz case found a real
  vulnerability during development (`store.root:80@evil.com` resolved to `store`, because the
  userinfo was stripped as a port). `TenantDomain` with DNS-TXT verification gating both
  resolution and TLS issuance, a TTL+LRU cache that also caches negatives (1.06 µs per
  classification), host-aware CORS replacing the allow-everything-in-dev rule, a public
  `GET /domains/bootstrap` that returns branding + theme + canonical host from the Host alone,
  a `tls-check` hook for on-demand certificates, and a store-facing Domains page with
  copy-to-clipboard DNS instructions. 43 reserved slugs (they are DNS labels now, so `mail`
  and `status` matter). `scripts/hostname.test.js` **55/55**, `scripts/smoke-domains.test.js`
  7 DB-backed areas.
- **6.4 Subdomain routing — original plan text (1 w, parallel)** — `{slug}.flowermarket.in` + verified custom
  domains resolve the tenant from `Host` with an LRU cache; the `x-tenant-id` override is
  **tightened** to super_admin/dev only (today any client can name any tenant and only the
  token stops them); unknown host fails closed rather than falling back to the default tenant.
  Unlocks `apps/storefront`, the first customer-facing surface.
- **6.5 Search ranking (2 w, parallel)** — today's `$regex` `$or` scan (whose `relevance` sort
  is alphabetical) becomes a `searchProvider` abstraction (mongo → atlas/opensearch) fed by the
  **CatalogEvent outbox that already exists**, with a real scoring function, ranking profiles as
  editable data + A/B, synonyms (gulab/rose), typo tolerance, facets, autocomplete, a sampled
  query log, and an **NDCG@10 gate** so a ranking change can't ship a regression.

Critical path ≈ 7 weeks; ≈ 8 weeks with the parallel tracks staffed.

## 🟡 Phase 7 — ideas (not planned yet)

- Multi-currency / international, e-way bills, vendor credit lines, learning-to-rank
  (the Phase-6 query log is its training data), buyer-side ITC portal, real-time settlement

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
