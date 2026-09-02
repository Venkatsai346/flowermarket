# Phase 5 — Multi-tenant marketplace (blueprint)

> Owner: Platform team. Status: **plan** (source of truth for the build).
> Scope: tenant self-service (store + plan + branding), vendor onboarding + product
> routing, per-tenant billing (subscription + commission), cross-tenant analytics,
> marketplace mode flag. Follows the same discipline as Phases 4/4b: blueprints first,
> provider abstraction, outbox/idempotency everywhere money moves, templates/data-as-data,
> RBAC + tenant scoping, hand-verifiable KPIs, full regression.

## 1. Root problem

The platform runs ONE flower store. To become a marketplace it must let:

1. **Anyone** open a store (tenant self-service: name, slug, plan, branding, owner admin) —
   today tenants are only created by seed/admin.
2. **Vendors** join (apply → approve → sell). Today the `vendor` role exists but nothing
   uses it; ProductMaster is platform-owned with no vendor attribution.
3. **Stores bill per-tenant** (subscription fee + platform commission on GMV) with real,
   auditable invoices — today there is no billing at all (`plan` is a bare enum).
4. **The platform see across stores** — cross-tenant analytics (total GMV, MRR,
   commissions, tenant/vendor health) — today analytics are strictly tenant-scoped.
5. **Marketplace mode** stays a per-tenant flag (`Tenant.features.marketplaceEnabled`)
   that gates vendor product routing — single-brand stores keep working unchanged.

## 2. Principles (reused from prior phases)

- **Multi-tenancy is the root**: every new collection carries `tenantId` where it is
  tenant-scoped; platform-level entities (plans, vendors, platformdailies) are explicitly
  platform-wide (tenantId null) or carry their own scope (vendor.userId).
- **Data-as-data**: plans are a collection (admin-editable, like notification templates);
  pricing/commission are snapshotted onto invoices/subscriptions so history never mutates.
- **Idempotency everywhere money moves**: one active subscription per tenant; invoices
  unique per (tenant, period); billing cycle re-runs never duplicate; payments idempotent.
- **Provider abstraction**: billing payment = `console|mock` provider (like
  razorpay/notification adapters); real gateway slots behind `billingProvider.charge()`.
- **Writes audited**: every admin write appends an `auditLog` row (Phase 4 discipline).
- **Read-first, write-controlled**: discovery/storefront are public reads; mutations are
  owner (tenant admin) or platform admin (super_admin) gated; never mint super_admin.
- **Denormalize at write time**: `orderitems.vendorId` snapshot at checkout so vendor
  analytics need no joins; `subscription.planSnapshot`/`invoice.lineItems` freeze pricing.
- **RBAC**: public → none; store owner → tenant `admin`; vendor → role `vendor`; platform
  operator → `super_admin`. The vendor role is granted ONLY by an approved application.

## 3. Data model

### 3.1 `tenants` (EXTENDED — no new collection)
Add `store` subdocument: `tagline`, `description`, `bannerUrl`, `socialLinks {instagram,
facebook, website}`, `isPublished` (false until owner publishes), `onboardingStatus`
(`registered` → `active` when first publish). Existing `slug`/`theme`/`logoUrl`/`plan`/
`features.marketplaceEnabled` reused. Slug remains unique — it IS the store URL.

### 3.2 `plans` (NEW — platform-wide, admin-editable)
`code` (unique: free|pro|business), `name`, `priceMonthly`, `currency` (INR),
`commissionRateBps` (platform cut on GMV, e.g. 100 = 1%), `features {maxHubs, maxProducts,
maxStaff, marketplaceEnabled}`, `trialDays`, `isActive`, `sortOrder`, `version`.
Tenant.plan remains a quick enum read; pricing lives here (snapshot on subscription).

### 3.3 `subscriptions` (NEW — one active per tenant)
`tenantId` (unique), `planCode`, `planSnapshot {name, priceMonthly}`,
`commissionRateBps` (snapshot), `currency`, `status trial|active|past_due|cancelled`,
`periodStart`, `periodEnd`, `trialEndsAt`, `cancelAtPeriodEnd`, `pendingAdjustment
{amount, label}` (proration from a mid-period plan change — applied to the next invoice
then cleared), `changedAt`. Unique partial index: one row with status in
(trial, active, past_due) per tenant.

### 3.4 `invoices` (NEW — per-tenant billing)
`tenantId`, `number` (`INV-{YYMM}-{seq}` unique), `period {from,to}`, `dueAt`,
`lineItems [{type: subscription|commission|adjustment, label, qty, unitAmount, amount}]`
(frozen), `subtotal`, `total` (roundMoney), `status draft|open|paid|overdue|void`,
`paidAt`, `paymentRef`, `generatedBy`. Unique (tenantId, period.from, period.to) —
the billing cycle is idempotent per period. Commission line = `round(periodGMV ×
commissionRateBps / 10000)`. GMV source: `analyticsdailies` (tenant-wide, hubId null) sum
over the period (excludes cancelled by Phase-4 formula).

### 3.5 `vendorapplications` (NEW)
`userId` (unique), `businessName`, `slug` (unique, storefront handle), `contactPhone`,
`gstin?`, `categories[]`, `city`, `status submitted|under_review|approved|rejected`,
`reviewedBy/At`, `note`, `submittedAt`. One application per user (re-submit = update).

### 3.6 `vendors` (NEW — approved seller profiles)
`userId` (unique), `businessName`, `slug`, `gstin?`, `categories[]`, `city`,
`commissionRateBps` (platform cut on the vendor's sales; default from config,
platform-admin adjustable), `status active|suspended`, `payout {method: bank|upi, name,
maskedAccount}` (metadata only — no live disbursement this pass), `joinedAt`,
`counters {gmv, orders}` (refreshed by analytics). Created ONLY from an approved
application, which also flips `user.role` → `vendor`.

### 3.7 `productmasters` (EXTENDED)
`vendorId` (ref Vendor, nullable — null = platform-owned), `marketplaceListed` (bool,
default false), `marketplaceListedAt`. Review fields (`submittedAt/reviewedBy/
reviewedAt/note`, `status`) already exist — reuse: vendor-created products start
`pending` and need platform-admin approval before `marketplaceListed = true`.

### 3.8 `orderitems` (EXTENDED)
`vendorId` (ref Vendor, nullable) — **snapshot at checkout** from
`tenantProduct.productMasterId.vendorId`. Makes vendor GMV/orders computable with no
joins. (Set in `order.service.createOrderDoc` when building items.)

### 3.9 `platformdailies` (NEW — cross-tenant rollup)
`date` (unique), `orders`, `gmv`, `netRevenue`, `commissionsAccrued` (sum of open+paid
commission line items in period), `mrr` (sum of active subscriptions priceMonthly),
`activeTenants`, `newTenants`, `newVendors`, `byPlan {free: n, pro: n, business: n}`,
`computedAt`. Built by `POST /marketplace/admin/analytics/rebuild` (idempotent upsert) and
the nightly marketplace pass. Dashboard reads this rollup when present, else live-computes
from `analyticsdailies` + billing tables (small data — both paths fast).

## 4. API surface (`/api/v1/marketplace/*`)

### 4.1 Public (no auth)
| Endpoint | Purpose |
| --- | --- |
| `GET /marketplace/plans` | active plan catalog (pricing shown to would-be store owners) |
| `GET /marketplace/stores?search=&city=&page=&limit=` | store discovery (published stores only) |
| `GET /marketplace/stores/:slug` | storefront: branding + theme + vendor products (only if `marketplaceEnabled`) + vendor list |
| `POST /marketplace/tenants/register` `{name, slug, plan?, contactEmail, owner{firstName, lastName, email, password}}` | self-service store creation → tenant + owner admin + auth config + trial subscription + auto-login tokens. Slug unique → 409. |

### 4.2 Vendor (auth, role `vendor`)
| Endpoint | Purpose |
| --- | --- |
| `GET /marketplace/vendor/me` | profile + counters (gmv, orders) + commissionRateBps |
| `PATCH /marketplace/vendor/me` | update business info / payout details |
| `GET /marketplace/vendor/products` | my products |
| `POST /marketplace/vendor/products` `{title, type, categoryId, brandId?, skuGlobal, sellingPrice, mrp?, description?, ...}` | create → status `pending`, vendorId set |
| `PATCH /marketplace/vendor/products/:id` | update while `pending` |

### 4.3 Store owner (auth, tenant `admin`/`super_admin` — token tenant = their store)
| Endpoint | Purpose |
| --- | --- |
| `GET /marketplace/store` | my store: branding + plan + subscription status |
| `PATCH /marketplace/store` `{tagline?, description?, bannerUrl?, theme?, socialLinks?, isPublished?}` | update branding / publish |
| `GET /marketplace/store/subscription` | active subscription + next period |
| `PATCH /marketplace/store/plan` `{planCode}` | change plan → new period boundary + prorated `pendingAdjustment` on next invoice |
| `GET /marketplace/store/invoices?status=&page=&limit=` | my invoices |
| `GET /marketplace/store/invoices/:id` | invoice detail (line items, frozen) |
| `GET /marketplace/store/vendors` | vendors whose products are synced into this store |
| `POST /marketplace/store/vendors/:vendorId/sync` | **(requires `features.marketplaceEnabled`)** create TenantProduct rows (idempotent on productMasterId) for the vendor's approved, marketplace-listed products; returns created/skipped counts |

### 4.4 Platform operator (auth, `super_admin`)
| Endpoint | Purpose |
| --- | --- |
| `GET /marketplace/admin/vendor-applications?status=` | application queue |
| `POST /marketplace/admin/vendor-applications/:id/review` `{decision: approve\|reject, note?}` | approve → vendor + role `vendor` (never super_admin); reject → keep user as-is |
| `GET /marketplace/admin/vendors` · `GET /marketplace/admin/vendors/:id` | vendor registry + detail (stats) |
| `PATCH /marketplace/admin/vendors/:id` `{commissionRateBps?, status?}` | adjust commission / suspend |
| `POST /marketplace/admin/vendor-products/:id/review` `{decision: approve\|reject, note?}` | approve → `marketplaceListed=true` (then tenant sync can route it) |
| `GET /marketplace/admin/tenants?plan=&status=&search=&page=&limit=` | every store + plan + subscription status |
| `GET /marketplace/admin/plans` · `POST /marketplace/admin/plans` · `PATCH /marketplace/admin/plans/:id` | plan catalog CRUD (pricing is data) |
| `GET /marketplace/admin/billing/invoices?status=&tenantId=&page=&limit=` | all invoices |
| `POST /marketplace/admin/billing/cycle` `{period?}` | run the billing cycle for all active tenants (idempotent per period) |
| `POST /marketplace/admin/billing/invoices/:id/pay` | mock payment (provider abstraction) → `paid` + paymentRef |
| `POST /marketplace/admin/billing/invoices/:id/void` | void a draft/open invoice |
| `GET /marketplace/admin/analytics/dashboard?from=&to=` | cross-tenant KPIs (exact formulas §5.6) |
| `POST /marketplace/admin/analytics/rebuild` | idempotent `platformdailies` upsert |
| `POST /marketplace/admin/nightly` | platform-wide marketplace nightly pass (§5.7) |

## 5. Business rules

- **Store registration**: `slug` unique + reserved-slug blocklist (admin, api, www, …).
  Creates Tenant (type business, plan from payload else free), owner User (role `admin`,
  NOT super_admin), TenantAuthConfig, subscription in `trial` (trialDays from plan),
  `onboardingStatus=registered`. Returns access+refresh tokens for the owner.
- **Branding**: public storefront only shows `isPublished` stores. Publish flips
  `onboardingStatus → active`. Non-owner cannot edit (token tenant must equal store tenant).
- **Vendor lifecycle**: apply (one per user, re-submit updates) → platform admin review →
  approve: create `vendors`, set `user.role=vendor`, audit; reject: status + note only.
  Suspension keeps the vendor record but hides products from sync/storefront.
- **Product routing** (`Product.vendorId`): vendor product = ProductMaster with
  `vendorId` + status `pending` → platform admin approve → `marketplaceListed=true`.
  A marketplace-enabled tenant calls sync → idempotent TenantProduct rows (price =
  vendor's listed selling price; tenant can override later via Phase-2 admin). Order item
  creation snapshots `vendorId` from the listing's master. Nothing else in checkout
  changes — Phase 1-4 flows work untouched.
- **Billing cycle** (idempotent): for each tenant with an active/trial subscription whose
  `periodEnd` ≤ today (or `period` given): generate invoice for the period — line items
  `subscription` (planSnapshot.priceMonthly), `commission` (period GMV × commissionRateBps
  / 10000, GMV from `analyticsdailies` hubId null, excl. cancelled), `adjustment` (the
  subscription's `pendingAdjustment`, then cleared). Then advance period (periodStart =
  old periodEnd, periodEnd += 1 month), trial → active rollover, `cancelAtPeriodEnd` →
  cancel after this period. Re-running the cycle for the same period creates nothing.
- **Plan change**: mid-period → subscription.planCode/planSnapshot update effective next
  period; `pendingAdjustment = (newPrice − oldPrice) × remainingDays/periodDays`
  (signed; credit when downgrading), label "plan change pro-rata". Applied on next invoice.
- **Payments**: `billingProvider.charge()` via `console|mock` (default) — marks invoice
  paid + paymentRef; real gateway (razorpay) slots behind the same call. Overdue sweep in
  nightly: invoice dueAt + graceDays < today & open → overdue; subscription → past_due
  when an invoice is overdue.
- **Cross-tenant formulas** (hand-verifiable, §6): `gmv = Σ analyticsdailies.gmv` over
  date range (all tenants, hubId null rows); `orders = Σ ordersCreated`; `netRevenue =
  Σ netRevenue`; `commissionsAccrued = Σ open+paid invoice commission lines`;
  `mrr = Σ active subscriptions priceMonthly` (as of today); `activeTenants = tenants
  status=active with subscription active/trial`; `newTenants/newVendors = created in
  range`; `byPlan` from subscriptions. Vendor stats: `Σ orderitems(vendorId).lineTotal`
  (lineTotal exists Phase 3) + count.
- **Nightly marketplace pass** (platform-wide, each step isolated + idempotent):
  1. subscription rollovers (trial→active, cancelAtPeriodEnd finalize, past_due sweep)
  2. billing cycle (due periods → invoices; overdue sweep)
  3. `platformdailies` rebuild
  4. drain + notifications (existing steps re-run — no duplicates)

## 6. Testing (`scripts/smoke-marketplace.test.js`)

1. Public: plans list (3 seeded); register tenant B → discovery shows it; duplicate slug
   409; owner login works (auto tokens).
2. Storefront: owner PATCH branding → `GET /marketplace/stores/:slug` shows branding;
   unpublished store hidden from discovery; publish flips onboarding active.
3. Vendor onboarding: customer applies → platform admin approves → role becomes `vendor`,
   vendor profile exists; second user applies → reject → no vendor row; duplicate apply
   409.
4. Vendor products + routing: approved vendor creates product (status pending) → platform
   admin approves → marketplaceListed; enable store B marketplace mode → sync → product
   appears in store B catalog (listing-first) → checkout → `orderitem.vendorId` set →
   vendor stats (gmv, orders) match hand-computed values.
5. Billing: run cycle → invoice = subscription fee + commission (GMV × bps, hand-verified
   from analyticsdailies); plan change mid-period → next invoice has pro-rata adjustment;
   pay → paid (mock); re-run cycle idempotent (no duplicate invoices); overdue sweep.
6. Cross-tenant analytics: platform dashboard totals = hand-summed across 2 tenants;
   `platformdailies` rebuild idempotent.
7. Nightly marketplace pass: runs, idempotent; full regression of all 8 prior suites.

## 7. Acceptance criteria

- Any visitor can register a store and log in as its owner; slug collisions are 409s.
- Owner sees/edits branding, plan, invoices; public storefront renders branding + vendor
  products when marketplace mode is on; single-brand stores unchanged.
- Vendor application → review → approve grants `vendor` role; vendor products route into
  marketplace-enabled stores via idempotent sync; order items carry vendor attribution.
- Billing invoices are auditable, hand-verifiable, per-period idempotent, plan changes
  prorate correctly, mock payments work, overdue states roll over.
- Cross-tenant dashboard numbers match hand computations; platformdailies rebuild is
  idempotent; nightly marketplace pass is isolated and safe to re-run.
- All 8 prior suites still pass (full regression).

## 8. Non-goals (this pass)

- No live payment gateway wiring (billing payment = mock/console; razorpay slots later).
- No actual vendor payout disbursement (payout metadata only, no money movement).
- No marketplace search ranking / recommendations; no vendor ratings/reviews UI.
- No per-order split-payment accounting (commission on GMV via period invoices only).
- No subdomain/DNS routing (slug-based URL, x-tenant-id/JWT remain the tenant resolution).
- No tax on invoices (GST invoicing is a legal/compliance phase of its own).
