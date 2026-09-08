# Flower Market — Platform Deep Dive

**Scope:** backend API, admin console (`apps/web`), storefront (`apps/storefront`), shared core (`packages/shared`).
**Method:** full read of the request pipeline, every money path, both front-ends, plus *running* the suites that can run here.
**Date:** 2026-09-08 · branch `arena/01a07fef-flowermarket` · base commit `84d5c3c` ("Wave 4 — florist brand kits, arrival promise, i18n chrome").

This document complements `REPO_ANALYSIS.md` (state-of-work) and `AUDIT_ARCHITECTURE.md` (money backbone). It is a *pattern and invariant* map: how the platform is built, what rules it enforces, where those rules live, and what I found when I went looking for places they leak.

---

## 0. Verification log — what I actually ran

Not assertions from reading. These were executed in this session:

| Check | Command | Result |
|---|---|---|
| Backend pure/unit matrix (14 suites) | `npm run test:unit` | ✅ **all pass** — money, tax, inclusive-MRP golden, payout calc, payout provider, hostname, ranking, search-eval, invariants, production-guard, invoice-pdf, refund-calc, slot-forecast, guestCart |
| Shared-core unit tests | `npm run test -w @flower-market/shared` | ✅ 16/16 |
| Admin-console unit tests | `npm run test -w @flower-market/web` | ✅ 53/53 |
| Storefront unit tests | `npm run test -w @flower-market/storefront` | ✅ 4/4 |
| Production builds (both apps) | `npm run build` | ✅ web 374 kB + charts 382 kB + react 182 kB; storefront entry 73 kB, all routes code-split |
| DB-backed smoke suites (34 files) | `npm run smoke` | ⛔ **cannot run in this sandbox** — see Finding F10 |
| Repo-wide static invariants | `node scripts/invariants.test.js` | ✅ **8/8** (detail below) |

Notable: `scripts/invariants.test.js` passes **8/8**, and its output is a precise cross-layer contract report:

```
1. audit actions are all declared in the AUDIT_ACTION enum                    ✅
2. no helper is used without being imported or defined                        ✅
3. the shared API client matches the Express route table
   ✅ all 314 shared-client calls hit a real route (334 routes)
4. every ledger account code has a declared type
   ✅ all 12 account builders produce a typed account
5. every env var read in code is documented in .env.example
   ✅ all 106 env vars read in code are documented (.env.example declares 106)
   ✅ no unquoted value contains a # (dotenv would truncate it)
6. financial write paths are role-guarded                                     ✅
```

That suite is a set of *repo-wide static gates*, each added because the bug it checks for was **actually found here** — the file header names them: 14 orphan audit actions including every billing event; `serializeList` used but never imported in `wallet.service.ledger()`; `adminInvoiceDetail` calling a route that did not exist; 25 of 51 env vars undocumented, so a deploy from `.env.example` silently ran on local-disk storage and default commission rates. Turning each discovered bug into a permanent class-of-bug gate is an unusually mature reflex, and it is the single best reason to trust the rest of the codebase.

---

## 1. Topology

```
                         ┌──────────────────────────────────────────────┐
   {slug}.flowermarket.in│  STOREFRONT  apps/storefront  (Vite+React)   │  one bundle,
   or verified custom    │  tenant-agnostic — learns identity from Host │  every store
                         └───────────────────┬──────────────────────────┘
                                             │ /api/v1 (proxied; no tenant header)
                         ┌───────────────────┴──────────────────────────┐
   console.<root>        │  ADMIN CONSOLE  apps/web  (Vite+React)       │  122 JSX files,
                         │  sends x-tenant-id from the session user     │  5 personas
                         └───────────────────┬──────────────────────────┘
                                             │
   ┌─────────────────────────────────────────▼───────────────────────────────────────┐
   │  API   backend/src/server.js → app.js → routes/index.js   (Express 4, ESM)      │
   │  334 API routes (+3 ops at app root) · 25 controllers · 65 services · 87 models  │
   │  /healthz /readyz /metrics mounted at APP ROOT, before auth+tenant+morgan        │
   └───────┬───────────────────────────────────────────────┬─────────────────────────┘
           │                                               │
   ┌───────▼────────┐                            ┌─────────▼──────────────────────────┐
   │ MongoDB (rs0)  │◄───── same models ─────────│ WORKER  backend/src/worker.js       │
   │ replica set →  │                            │ outbox consumer (leased claims)     │
   │ transactions   │                            │ + scheduler (single-flight jobs)    │
   └────────────────┘                            └────────────────────────────────────┘

   packages/shared  ── ApiClient, endpoints map, auth store, brand kits, formatters
   apps/mobile      ── Expo scaffold (153 LOC): proves the shared core on RN, not a product
```

Measured size:

| Area | LOC | Files |
|---|---|---|
| `backend/src` | 36,203 | 293 js |
| `backend/scripts` (tests/seed/tooling) | 11,786 | 40 |
| `frontend/apps/web/src` | 17,777 | 122 jsx + lib |
| `frontend/apps/storefront/src` | 4,837 | 24 jsx + lib |
| `frontend/packages/shared/src` | 1,898 | — |
| `frontend/apps/mobile` | 153 | scaffold |
| docs (`docs/` + `backend/docs/` + `uploads/`) | ~13,900 | 21 |

---

## 2. The request pipeline (exact order, and why each step is where it is)

`app.js` is an app factory; the ordering is deliberate and documented inline. Getting this order wrong breaks security, so it is worth stating precisely:

```
1  traceId            mints/adopts x-trace-id (validated: /^[A-Za-z0-9:_-]{8,64}$/)
                      → stamped on Order, Payment, LedgerJournal, DomainEvent, PayoutBatch
2  helmet             crossOriginResourcePolicy: cross-origin (storefront images)
3  metricsMiddleware  FIRST timed middleware → even 4xx/5xx are measured;
                      route label = MATCHED PATTERN (req.baseUrl+req.route.path) so
                      label cardinality can never explode with ids
4  opsRoutes          /healthz /readyz /metrics — before morgan (scrapes don't pollute
                      the access log), before auth/tenant (a monitor needs neither)
5  cors               host-aware origin policy (see §3)
6  express.raw        THREE webhook mounts, before express.json — HMAC is over the RAW
                      bytes; a JSON re-parse invalidates every signature
7  refreshLiveHosts   fire-and-forget, 60s throttle — keeps the verified-custom-domain
                      set warm for the synchronous CORS decision
8  express.json       1mb limit
9  compression
10 morgan             custom format ending in :trace → correlation id in every log line
11 /api/v1 router     tenantContext → rateLimiters.api → 22 route modules
12 express.static     only when STORAGE_PROVIDER=local
13 notFoundHandler    structured 404 (never an HTML stack)
14 errorHandler       the single place an error becomes HTTP
```

Inside the router, **`tenantContext` runs before everything** — so `req.tenantId` exists on every endpoint, including public ones.

`/healthz` is deliberately **DB-free** ("a Mongo outage must NOT make the container look dead"); `/readyz` is the one that gates on `mongoose.connection.readyState === 1`. That is the correct split and a lot of platforms get it backwards.

### Error and response contract

- `AppError { status, code, details, isOperational }` + factories (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `tooMany`).
- `errorHandler` normalizes four error families into the same envelope: Mongoose `ValidationError`→400 `VALIDATION_ERROR` (field→message map), `E11000`→409 `DUPLICATE_KEY` (with `keyValue`), `CastError`→400 `INVALID_ID`, `entity.too.large`→413. Stack traces are attached **only** when `isDev && status >= 500`.
- Envelope is always `{ success, message, data, meta }`. Pagination lives in `meta` (`page, limit, total, totalPages, hasMore`) so infinite lists never parse headers.
- `serializeList()` reconciles `.lean()` rows with `toJSON`-transformed docs so list and detail responses expose the same `id` shape. Its doc comment records a real regression it fixed (it used to overwrite `id` with `undefined`).

---

## 3. Multi-tenancy — Host is the identity

This is the platform's central architectural decision and the code treats it as a security boundary, not a convenience.

**Resolution order** (`middleware/tenantContext.js`):

1. **Host** — `{slug}.{PLATFORM_ROOT_DOMAIN}` or a *verified* custom domain
2. **Header** — `x-tenant-id`, only when the Host did not decide
3. **Default** — `DEFAULT_TENANT_ID`
4. **Fallback** — first active tenant (bootstrap only)

The reasoning is written into the file and it is correct: before this, *any* client could name *any* tenant with a header, and the only thing between that and a cross-tenant read was `authenticate` rejecting a token/tenant mismatch — which does nothing for the many public endpoints.

Three details that make it hold up:

- **A well-formed but unknown subdomain 404s** (`STORE_NOT_FOUND`) rather than falling through to the default tenant. The comment says it best: *"Silently serving the default store's catalogue at someone else's hostname is a leak that looks like a feature."*
- **Host beats a disagreeing header** unless `ALLOW_TENANT_HEADER_OVERRIDE` is on — which the production guard *rejects* (`assertProductionProviders`: "Host is the tenant").
- **`hostname.js` is pure and paranoid.** No DB, no config, no I/O, so `scripts/hostname.test.js` can exhaust the nasty cases. It rejects userinfo outright because `store.flowermarket.in:80@evil.com` would otherwise have `:80@evil.com` stripped as a port, leaving a valid store hostname. The comment records that this was *found by a fuzz case*, not imagined.

**The two clients sit on opposite sides of this by design:**

| | Admin console | Storefront |
|---|---|---|
| tenant header | sends `x-tenant-id` from the session user on **every** request | sends **none** — ever |
| why | one console administers any tenant; `tenantContext` runs *before* `authenticate`, so it never sees the JWT and a non-default tenant session would 401 `TENANT_MISMATCH` | *"nothing in this app knows a tenant id, which means nothing in this app can address the wrong tenant"* |
| session storage | `localStorage['fm-auth']` | `localStorage['fm-shop:'+hostname]` — two stores in two tabs never share a session or cart |

**CORS is host-aware** and the comment records the fix: the pre-6.4 rule allowed *every* origin when `isDev`, and `NODE_ENV` defaults to `development` — so a deploy with an unset `NODE_ENV` shipped an open CORS policy. Development now allows an *enumerated* set (localhost, `*.localhost`, 127.0.0.1, `*.e2b.app`) instead of everything.

**Token/tenant guard** (`authenticate`): a token minted for tenant A cannot touch tenant B — with one deliberate exception, `super_admin`, who is platform-scoped and must keep working after suspending the tenant their token was minted on.

**`requireActiveTenant`** closes the remaining gap: host resolution already 404s a suspended storefront, but the header/token path (admin, tests, in-flight sessions) needs an explicit guard so operators can still log in and refund while *new carts and checkouts cannot take money*.

**Reserved slugs** are DNS labels, not just product names — the list includes `mail, smtp, imap, mx, ns1, ns2, cdn, status, pay, checkout, auth`. The comment explains: a store called "mail" would hijack MX-adjacent traffic.

---

## 4. Catalog architecture — the master/listing split

The core multi-tenant commerce model:

```
ProductMaster  (GLOBAL — central ops owns it)
  skuGlobal, type, title, slug, description, categoryId, brandId, tags
  isPerishable, requiresColdChain, defaultSellingUnit, min/maxOrderQty
  status: PENDING_REVIEW → ACTIVE | REJECTED ; ACTIVE → DEPRECATED (cascades)
  version  ← optimistic lock on concurrent admin edits
        │
        │  1 : N   (unique on tenantId + productMasterId + variantId)
        ▼
TenantProduct  (PER-STORE — the row that makes a master SELLABLE)
  price {mrp, sellingPrice, currency}, orderLimits, status
  stockQty + availability  ← DENORMALIZED snapshot; truth lives in Inventory
  version, lastPriceChangedAt / lastStockChangedAt / lastStatusChangedAt
        │
        ▼
Inventory  (tenantId, tenantProductId, warehouseId|null)
  qtyOnHand, qtyReserved     qtyAvailable = onHand − reserved (never negative)
```

A product appears for customers of tenant A **only** when `TenantProduct(A).status === ACTIVE`, even though the master is shared with 50 other tenants. A tenant can never create a global master directly — it files a `ProductChangeRequest` that goes through admin review. EAV attributes, variants and images are separate collections specifically to keep documents bounded.

**Cart discipline.** The cart is explicitly *"the disposable draft"*:
- price/stock are snapshotted at add/update time and **never trusted at checkout**;
- `revalidate()` refetches live price + available stock per line and returns a diff;
- checkout **refuses to proceed** until the client passes `confirmPriceChanges: true` (409 `PRICE_CHANGED` with the diffs) — this is the stale-cart problem solved as a contract, not a hope;
- `applyLivePrices()` then snaps the draft to reality, capping qty at stock and dropping dead lines;
- bounded: `CART_ITEM_LIMIT = 50` distinct items, `CART_TTL_SECONDS = 30 days`;
- items live in a **separate `CartItem` collection**, not an array on the cart — no unbounded document growth.

**Guest carts** are server-side. `guestCart.js` reads an httpOnly `fm_guest` cookie or an `x-guest-key` header (regex-guarded `^[A-Za-z0-9_-]{16,64}$`), and `mergeGuestCart()` folds the draft into the signed-in cart on login — summing qty per listing, capped at live stock — then marks the guest row `ABANDONED` so the unique guest index frees the key. `CartService.ensureIndexes()` actively *drops* the pre-guest unique index `{tenantId, userId, status}` which treated a missing `userId` as null and allowed only one guest cart per tenant. That is a real migration performed at runtime, idempotently.

---

## 5. Commerce core — the checkout saga

`order.service.js` is an explicit **central orchestrator**, not choreography. The header states why: with cart/inventory/payment/slot/fulfillment in play, an orchestrator is easier to debug. Every cross-service step has a named compensating action.

```
checkout()
 1  cart.revalidate()          → empty? 400 CART_EMPTY
                                → changed && !confirmPriceChanges? 409 PRICE_CHANGED {diffs}
    cart.applyLivePrices()     snap the draft to live truth
 2  findMyHold()               must be THIS user's live HELD hold, not expired
                                else 409 RESERVATION_INVALID
 3  Address.findOne({_id, tenantId, userId})   ← ownership in the query, not a check after
    slotService.assertServiceable({pincode})   ← PIN IS THE FRONT DOOR
 4  createOrderDoc()           orderNumber, snapshots, charge breakdown, coupon usage
 5  transition(PAYMENT_PENDING) then paymentService.charge()
      ├─ pending  → return checkoutClientPayload (Razorpay Checkout.js params)
      ├─ !success → COMPENSATION A: release slot, CANCELLED(payment_failed), throw 409
      └─ success  → finalizeOrderAfterPayment()

finalizeOrderAfterPayment()   ← shared by the sync path AND the webhook path
    if status === CONFIRMED → return (webhook replay is a no-op)
 6  inventoryService.commitForOrder()   HARD commit, atomic per line
      └─ any failure → COMPENSATION B:
           restoreForOrder(committed) → refundService.initiate(full components)
           → slotService.release() → markCancelled(stock_unavailable) → 409
 7  slotService.confirm()
 8  fulfillmentService.createTask()
 9  transition(CONFIRMED) ; cart.markCheckedOut()
10  domainEventService.append(SALE_CAPTURED)     ← the money FACT, first
11  ledgerPostingService.postSaleCaptured()      ← then the journal
12  payoutService.accrueForOrder()               ← vendor entitlement
13  auditService.record() + catalogEventService.publish()
14  taxDocumentService.issueForOrder()           best-effort; GET re-issues if empty
```

Steps 10–12 are wrapped in `safePost()`: in non-strict mode a failure is logged and left to the backfill sweep rather than blocking a confirmation on an order that is **already paid and stocked**. The ordering of 10 before 11 is the whole point — a crash between them is *visible* (event present, journal missing) and `integrity.replay()` re-posts exactly.

**Order state machine** (`utils/orderStateMachine.js`) — a frozen transition table, asserted *before* any saga step runs, with every successful transition writing an `OrderStatusHistory` row:

```
CREATED → PAYMENT_PENDING → CONFIRMED → PICKING → PACKED → OUT_FOR_DELIVERY → DELIVERED
                                   ↘ (each of CREATED…PACKED, DELIVERY_FAILED) → CANCELLED
OUT_FOR_DELIVERY → DELIVERY_FAILED → OUT_FOR_DELIVERY (retry) | CANCELLED (max retries)
DELIVERED → RETURN_REQUESTED → RETURN_APPROVED → RETURN_PICKED_UP → QC_PASSED → REFUND_INITIATED → REFUNDED
                             ↘ RETURN_REJECTED            ↘ QC_FAILED → REFUND_REJECTED
                             RETURN_APPROVED → REFUND_INITIATED (instant claim skips pickup)
terminal: CANCELLED, REFUNDED, REFUND_REJECTED
```

`transition()` also stamps `order.deliveredAt` **once**, on first arrival at `DELIVERED`. The model comment explains why it must be a top-level schema path: *"or mongoose strict mode silently drops it and every payout line's eligibleAt drifts to order.updatedAt."* (See Finding F2 — one caller does not honour this.)

**Slots** — BigBasket-style, with atomic capacity control. Reservation is a single guarded `findOneAndUpdate` (`$expr reservedCapacity < totalCapacity`), so concurrent attempts cannot oversell and there is no separate counter to desync. `SLOT_HOLD_TTL_SECONDS = 600` (the storefront copy says "held for 10 minutes"). Capacity comes from forecasting; the atomic lock only *enforces* it — "forecasting sets the number; the atomic lock enforces it."

**Inventory** — `reserve`/`release`/`commitForOrder` are all atomic `findOneAndUpdate` with the guard **in the filter**, and `reserve` distinguishes "no row" (`INVENTORY_NOT_FOUND`) from "insufficient" (`INSUFFICIENT_STOCK`) via an `exists()` follow-up rather than conflating them. Every mutation refreshes the denormalized `TenantProduct.stockQty`/`availability` and auto-flips an ACTIVE listing to `OUT_OF_STOCK` at zero.

**Rider flow** — a separate explicit machine (`PENDING_ACCEPT → ACCEPTED → AT_HUB → IN_TRANSIT → ARRIVED → DELIVERED`) with `RIDER_ACCEPT_TTL_SECONDS = 45` and `RIDER_REJECT_CAP = 10` before manual escalation. `MAX_DELIVERY_RETRIES = 2`, then the saga cancels with `DELIVERY_FAILED_MAX_RETRIES`. On completion it records real pick/pack/delivery durations into `FulfillmentTimeLog`, closing the loop back into slot forecasting.

---

## 6. Money architecture — two representations, on purpose

`utils/money.js` is the most opinionated file in the repo and its header is a design document:

1. **Rupee floats** (`roundMoney`, `moneySum`, `formatINR`) — the legacy representation for cart/order/invoice totals since Phase 3. Kept as-is: *"rewriting 76 models is not worth the risk, and every sum is already rounded at the boundary."*
2. **Integer paise** (`toPaise`, `fromPaise`, `sumPaise`, `allocatePaise`, `splitTaxPaise`, `applyBps`) — everything financial from Phase 6.1 on: the double-entry ledger, GST invoices, vendor payouts.

**The rule:** paise fields are the source of truth for new financial documents and are suffixed `Paise`; rupee values derived from them are display/legacy views produced with `fromPaise()` — never the other way around.

Rationale, quoted: a float is fine for "what does this cart cost"; it is *not* fine for "CGST + SGST must equal the tax exactly", "ten vendor payouts must equal the money we actually hold", or "commission = GMV × bps" compounded over a hundred thousand lines.

Three functions carry the weight:

- **`toPaise`** rounds the *scaled* value, because `19.99 * 100 === 1998.9999999999998`.
- **`allocatePaise`** is largest-remainder (Hamilton) allocation with four asserted properties: parts sum **exactly** to the total; every part has the same sign as the total (never mixed); it is **deterministic** (equal remainders break ties by index — critical for idempotent re-posting); zero/negative weights receive 0. It explicitly *replaces* "last line absorbs the rounding", which is biased and can hand a negative share to a zero-priced item.
- **`splitTaxPaise`** returns `[trunc(t/2), t - trunc(t/2)]` so `cgst + sgst === totalTaxPaise` **exactly**, even for an odd paisa (extra goes to SGST by convention). The comment names the payoff: this makes `CGST + SGST != tax` — *"the single most common cause of GSTR-1 mismatches"* — structurally impossible.

**Dual-write** (`attachPaise`, `ORDER_MONEY_KEYS`, `QUOTE_MONEY_KEYS`) adds `*Paise` siblings next to existing rupee fields on API views, flag-gated by `MONEY_DUAL_WRITE_PAISE`. The header is emphatic that this is *never a second arithmetic path* and never a stored-column rewrite.

**Where the algorithms diverge** → Finding F7.

---

## 7. Pricing, tax and invoicing

### 7.1 The pricing engine (`pricingPolicy.service.js`)

Per-tenant policy, replacing hardcoded fees. `computeOrderCharges()` returns a full breakdown where **each line** carries `{taxAmount, discountAllocated, taxPolicyId, hsnCode}` — those line numbers are persisted on `OrderItem`, **never recomputed**, and are the basis for correct per-item refunds.

```
1  delivery fee  ← the ACTIVE DeliveryFeePolicy
                   freeDeliveryThreshold → 0; baseFee; × expressSurgeMultiplier
                   when windowType==='express'; + distanceFeePerKm × zoneDistanceKm
2  line tax      ← per-category TaxPolicy (batched lookup, one query for all cats)
3  discount      ← coupon RE-VALIDATED here (the cart validated at apply-time;
                   this is the money moment): validFrom/To, status, minCartValue,
                   usageLimitPerCustomer, maxDiscountCap; percent or flat
                   → allocated across lines by pre-discount price weight
4  GST per line  ← utils/gst.js integer-paise engine
```

The whole breakdown is persisted as an **immutable `OrderChargeBreakdown`** row. Rationale: *"historical orders must keep showing what the customer was ACTUALLY charged, even if the tenant's policy changes tomorrow."*

`quote()` exists as a pure preflight that mirrors the checkout revalidation contract exactly, so the storefront can gate the wallet option on **the same number the server will charge** — `canWalletPay` compares wallet balance to `quote.grandTotal`, and a `useEffect` snaps the payment method back to UPI if the wallet no longer covers it.

### 7.2 GST (`utils/gst.js`) — pure, exhaustive, legally-shaped

No DB, no config, no I/O. The central identity:

```
inclusive:  taxable = round(net × 10000 / (10000 + rateBps))
            tax     = net − taxable        ← exact BY CONSTRUCTION
exclusive:  taxable = net
            tax     = round(net × rateBps / 10000)
```

Deriving tax **by subtraction** in the inclusive case means the parts can never fail to reconcile with what the customer paid — there is no second rounding to disagree with the first. That is the correct way to do Indian MRP maths and most implementations get it wrong.

Also in this file:
- **GSTIN validation with mod-36 checksum** (alternating weights 1,2 over the first 14 chars) — not just the regex. Justification: a wrong GSTIN on an issued invoice can only be fixed by a credit note, so catching it at entry is worth 20 lines.
- **Free-text state → state code** resolution with a real alias table (`orissa→21`, `pondicherry→34`, `uttaranchal→05`, `new delhi/delhi ncr→07`, `j&k→01`, `ap→37`, `ts→36`). Returns `null` rather than guessing.
- **Indian FY** (`fyLabel`, `fyRange`, April start) — because invoice numbering must be consecutive *within* a financial year and restart each year, so the FY is part of the document number, not decoration.
- `natureOfSupply` handling: nil-rated/exempt lines still report their full net as taxable **value at 0%** — *"it must still be reported (in the nil-rated column of GSTR-1), not omitted."* The enum comment names the florist reality: fresh cut flowers and live plants are nil-rated while pots, tools and artificial flowers are taxable, **so rate-wise HSN summaries are mandatory, not optional.**

### 7.3 Invoicing (`taxDocument.service.js`)

- State machine `DRAFT → ISSUED → CANCELLED` with **deliberately no "edit" state**: an issued document is immutable and a mistake is corrected by a credit note. A cancelled document **keeps its number forever** — numbering must stay gapless.
- **Place of supply for GOODS is where the movement terminates** — the delivery address, snapshotted immutably at checkout. If it cannot be resolved the code **refuses** with `PLACE_OF_SUPPLY_UNRESOLVED` (422) rather than guessing: *"guessing picks the wrong tax heads, which is a filing error, not a cosmetic one."*
- Lines are **grouped by selling entity** (`vendorId | 'store'`) and one invoice is issued per supplier. The delivery fee is the *store's* supply so it rides on the store's document — and if an order is vendor-only, the fee becomes the store's own single-line invoice rather than being silently dropped.
- Numbering: `reserveNumber()` does an atomic `$inc` with upsert on `TaxDocumentSeries` keyed by `(ownerType, ownerId, docType, fyLabel, seriesCode)`, retrying the insert-vs-insert race, and `seriesGaps()` reports holes.
- Reconstruction path: `knownTaxPaise` lets the invoice layer split the **already-charged** tax rather than recompute it — so flipping `TAX_PRICES_INCLUSIVE` never rewrites history.
- PDF generation (`utils/invoicePdf.js`) is hand-rolled and tested: PDF 1.4 header/xref/EOF, splits GST heads, credit-note variant, and *never throws* on an empty document.

### 7.4 Refunds

- **Destination logic:** wallet by default (instant, low-risk, encourages repeat use); gateway `ORIGINAL_METHOD` above `GATEWAY_REFUND_THRESHOLD = ₹2000`. A **wallet payment can only come back through the wallet** — and the *payment row* is the source of truth for that, not `order.paymentMethod` which is "only a hint at this point".
- **Component-based:** `amount === refundItemAmount + refundTaxAmount + refundFeeAmount`, persisted so finance/credit notes work. `fullOrderRefundComponents()` handles the inclusive case by extracting tax off the shelf value so `item + tax + fee === grandTotal` either way.
- Idempotent on `idempotencyKey`.
- `refundCalculator` distinguishes partial vs full returns and applies the tenant's `REFUND_FEE_POLICY` (`FULL_ORDER_RETURN_ONLY` / `ALWAYS` / `NEVER` / percentage split) — all six scenarios are covered by `scripts/refund-calc.test.js`.

### 7.5 Returns

Two flows: **`PICKUP_QC`** (eligibility → APPROVED → pickup → QC → refund) and **`INSTANT_CLAIM`** (auto-approved perishable claim → instant wallet refund, no pickup). Constants: `RETURN_WINDOW_DAYS = 7`, `INSTANT_CLAIM_WINDOW_HOURS = 24`, and a fraud guard `INSTANT_CLAIM_MONTHLY_LIMIT = 3` auto-approved instant claims per customer per month. Eligibility checks item-level over-return (`qty > oi.qty - returnedQty`) and per-item `isReturnable`.

---

## 8. The financial ledger (Phase 6.1)

`ledger.service.js` opens with the reason it exists: *"Vendor payouts and GST invoicing both answer 'who is owed what, and can we prove it?'. Answering that by summing order rows on demand is how marketplaces end up paying twice."*

**Four rules, all enforced in code:**
1. Every journal balances — `Σ debitPaise === Σ creditPaise`, or nothing is written.
2. Every journal is idempotent on `{kind}:{refType}:{refId}` — replaying a webhook, retrying a saga step or re-running a backfill posts nothing new.
3. Journals are **immutable**. Corrections are reversing journals, never edits.
4. The journal is the truth; `accountbalances` is a **materialized view** that can always be recomputed (`verifyBalances`).

**Transactions are capability-probed, not assumed.** `transactionsSupported()` runs `hello: 1` once and caches: on a replica set, journal + entries + balances commit in one transaction; on a standalone mongod the same code runs session-less and the nightly `verifyBalances({repair:true})` closes the crash window. Boot logs which mode it got. `LEDGER_STRICT` defaults to strict **in production only**, lenient elsewhere so a dev DB without a replica set never blocks checkout.

**Chart of accounts** — account codes are built by `ledgerAccounts.*` helpers so *"the string format lives in exactly one place"*. Global accounts are seeded idempotently at boot; scoped accounts are created lazily on first post. Type (asset/expense = debit-positive, liability/income = credit-positive) is **inferred from the code prefix** via `TYPE_BY_PREFIX`, and `scripts/invariants.test.js` fails the build if any emittable code lacks a known type — otherwise `post()` throws at runtime instead of at boot.

16 journal kinds: `sale_captured, psp_settled, refund_issued, payout_initiated, payout_reversed, tds_deducted, commission_invoiced, adjustment, statutory_deposit, statutory_deposit_reverted` + five `*_backfill` kinds (wallet, vendor, statutory, gst, bank) for one-time reconciliation of pre-ledger balances.

---

## 9. Vendor payouts (Phase 6.3) — `payout.service.js`, 1,902 LOC

The largest service in the codebase, and the one place *"where money leaves the building"*.

**Two gates, both must be open before a line is payable:**
1. **RETURN RISK** — `deliveredAt + returnWindowDays` has passed. *"Paying before that means buying back your own goods."*
2. **CASH IN HAND** — the PSP has actually settled the money to us (a `psp_settled` ledger entry covering the order). *"Paying before that is lending the vendor our own working capital."* Production defaults this **ON** so a missing `PayoutPolicy` row cannot pay a vendor before cash arrives.

Line states: `ACCRUED` (earned, still at risk) → `ELIGIBLE` → paid; `HELD` when an operator or dispute stopped it.

**`computeLineFinancials()` is PURE** — numbers in, numbers out, no DB, no clock — so `scripts/payout-calc.test.js` can assert the worked example to the paisa with zero infrastructure. The documented example:

```
gross                        5900.00   what the customer paid (incl. the seller's GST)
− commission  10% of taxable  −500.00   (taxable value = 5000.00)
− GST on commission @18%       −90.00
− TCS u/s 52 on taxable        −25.00   (0.5%)
− TDS u/s 194-O on gross        −5.90   (0.1%)
= net payable                5279.10
```

And the ledger view of a payout — note that **the seller's GST flows TO the seller**, because the seller is the person who must deposit it; only TCS is withheld and deposited by the platform:

```
DR vendor_payable:{v}              4500.00   (taxable − commission)
DR gst_output_payable:{v}           900.00   (seller's GST)
    CR bank                                  5279.10
    CR gst_output_payable:platform             90.00   (GST on commission)
    CR tcs_payable                             25.00
    CR tds_payable                              5.90
   Σ debits 5400.00  =  Σ credits 5400.00  ✓
```

**Policy defaults** (`DEFAULT_POLICY`, used when no row exists): `weekly:wed`, min payout ₹500, `returnWindowDays: 7`, **`perishableReturnWindowDays: 1`** (the florist-specific one), commission GST 18%, `dualApprovalPaise: ₹100,000`, `maxBatchPaise: ₹500,000`, `holdOnDispute`, `negativeBalanceCarryForward`.

Batch state machine has **approval as a distinct, role-gated step**. Statutory rates are *effective-dated data, never constants* — `StatutoryRate` rows resolved `at: supplyDate`, seeded at boot with an explicit warning: *"VERIFY with a CA before go-live."*

The eligibility sweep is written as a **query rather than a loop over orders** so it stays O(eligible) instead of O(orders) as the platform grows.

---

## 10. The money audit backbone (Phases 10–11)

Three layers, each with a distinct job:

**1. Domain event store** — append-only, one row per money *fact*, unique on `idempotencyKey`. 20 event types. `append()` **never throws**: *"the audit store aids the ledger, it does not gate it"* — a failed append is logged and healed later by `replay()`. The payload is an **audit summary, not a copy of the journal lines**, so replay re-derives the journal from the aggregate (OrderItem / RefundTransaction / PayoutBatch) through the *same* idempotent post functions the live path uses — a rebuilt journal is byte-for-byte the live one.

**2. Hash chain (tamper evidence)** — per tenant, anchored in `auditchains`. Event N carries `prevHash` = hash of N−1; each `hash` covers canonical content (sorted-key JSON, so the hash cannot depend on key order) + `seq` + `prevHash`. Appends use **compare-and-set** on the tail anchor so API and worker can append to the same tenant concurrently without forking. Five break types are detected: tampering (`hash_mismatch`), deletion (`broken_link`), tail deletion (`tail_mismatch`), plus unanchored rows and gaps.

The **repair policy is the deliberate heart of it**: chain breaks are **NEVER auto-healed** — *"healing a break would bless the tamper"* — they are surfaced for a human. Unanchored rows *are* auto-repaired, because they are stored events awaiting a chain slot, not evidence issues. `CHAIN_REBUILT` exists as an explicit, manual, audited event for legitimate re-linking.

**3. Integrity report** — one structured, **read-only** answer composed of checks each subsystem already trusts: ledger trial balance + materialized-vs-entries + event↔journal coverage; search index freshness; slot over-reservation; webhook audit mismatches (*"the fraud signal"*); disbursed batches missing journals; notification outbox lag and dead letters; wallet, vendor, statutory, GST and bank checks. `replay()` is the only write path.

**Trace correlation** closes the async loops: the storefront's checkout mints the trace; the gateway webhook that captures the payment later is processed under the **payment's stored traceId**, so the capture lands on the same chain as the original tap. Payout webhooks adopt the batch's traceId the same way.

---

## 11. Async execution — outbox, leases, single-flight

**Outbox** (`catalogEvent.service.js`): `publish()` appends a durable row in the same request path (one insert, no I/O beyond it). Consumption is **leased**:

- `pending → publishing` via atomic `findOneAndUpdate` (status + availability guarded) carrying `claimedBy` / `leaseExpiresAt` → **N workers drain concurrently without double-claiming**;
- a worker that dies mid-handler leaves the row `publishing` only until the lease expires, when `reapExpired()` returns it to `pending` — *"no event can be stuck in publishing forever"*;
- failures back off **30s → 2m → 10m → 30m**, then dead-letter at `WORKER_MAX_ATTEMPTS = 5` retaining payload + lastError, re-queueable on purpose via an ops endpoint;
- completion is itself guarded (`status: PUBLISHING, claimedBy: workerId`) because a reaper could have recycled a very slow handler;
- **handlers must be idempotent** — at-least-once delivery.

The row remains the durable record: *"a future Kafka/Redis publisher can consume the same outbox without schema changes."* Two consumers ride it — notifications and the search indexer — so index freshness inherits the outbox's delivery guarantees with no new plumbing.

**Scheduler** (`workers/scheduler.js`): jobs are **code-defined with persisted state**. Single-flight across N workers/restarts by atomically advancing `nextRunAt` **with the expected current value** — only the claim-winner executes. If a worker dies mid-run the run is lost but the schedule has advanced, *"acceptable because every built-in job is idempotent."* Runs are fire-and-forget so a long nightly never starves the outbox poll.

Three built-in jobs: `tenant-nightly` (02:00, per active tenant), `marketplace-nightly` (02:05, platform-wide — ordered after the tenant pass because the billing cycle needs fresh rollups), `payment-reconcile` (every 5 min).

**The nightly is an 11-step self-healing pass**, every step individually try/caught so one tenant's error never aborts another's:

```
1 slot forecasting (persists capacities)      7 ledger backfill (post journals the saga couldn't)
2 analytics rollups                           8 e-invoice IRN retries
3 create analytics export jobs (idempotent)   9 search index freshness + backfill missing
4 run due export jobs                        10 INTEGRITY: report → replay → verifyBalances(repair)
5 drain catalog events                       11 fold unanchored audit rows into the hash chain
6 process pending notifications
```

Step 10 is the payoff: *"a crash between 'money fact' and 'journal' is detected and healed automatically, not discovered by an auditor."*

`payment-reconcile` closes the async-payment loop: stale PENDING payments are resolved against the **gateway** as the authoritative system of record (webhook-loss recovery), and in-flight gateway refunds are confirmed from the gateway. The mock provider keeps an in-process `mockGateway` Map precisely so "the webhook was lost, recover from the source of truth" is testable without real keys.

**Worker safety:** the worker calls `assertProductionProviders()` too — a worker running mock payouts in production is as dangerous as an API doing it. It also `init()`s every model from `config/models.js`, because it connects a bare mongoose instance the API never inits, and the unique `idempotencyKey` indexes on ledger/payout collections are *"the exactly-once backbone"* — they must be materialized in the worker context, not only the API.

---

## 12. Search and ranking (Phase 6.5)

A six-step pipeline, in this order, with the reason for step 6 stated plainly:

```
1 PARSE     "red gulab bouqet under 800" → filters + corrected, expanded tokens
2 RESOLVE   which ranking profile applies (tenant override, A/B bucket)
3 RETRIEVE  a bounded candidate set from the provider
4 RANK      in-process with the pure scorer, then apply editorial pins
5 RELAX     if nothing matched, progressively drop constraints rather than
            showing an empty page
6 LOG       sampled, PII-free — "a ranking system without a query log is a
            ranking system nobody can ever prove was improved"
```

`utils/ranking.js` is **pure** — no DB, no config, no clock beyond an injectable `now` — so `scripts/ranking.test.js` proves ordering properties exhaustively. The key design choice: relevance is a *scoring function*, not a sort key. Previously `sort=relevance` was literally `{ 'master.searchText': -1 }`, i.e. alphabetical.

**Every component is normalised to 0..1 BEFORE weighting, so a weight is directly comparable to every other weight — "which is what makes the tuning UI honest."** Nine signals, each with a stated justification:

| Signal | Treatment | Why |
|---|---|---|
| `text` | baseline match quality | — |
| `popularity` | **log-damped** 30-day sales | 10,000 sales is not 100× better than 100 |
| `ctr` | **Bayesian-smoothed** (prior 0.08, weight 50) | stops 1-click/1-impression outranking everything |
| `availability` | **gradient, not a filter** (1 / 0.75 / 0) | *"a customer searching for something you briefly lack should still see it exists"* |
| `freshness` | exponential decay, 72h half-life | decisive for cut flowers |
| `discount` | normalised vs a 40% "deep discount" reference | — |
| `vendor` | seller rating | so a bad seller cannot buy the top slot |
| `margin` | deliberately small | a business signal, *"always disclosed"* |
| `promoted` / `penalty` | time-boxed boost / recent-returns demotion | — |

Weights live in `RankingProfile` rows (tenant override or platform default), so **an operator can retune without a deploy**. The scorer returns `components` alongside `score` so the admin tuner can **explain** a ranking — *"why is this third? must have an answer."* `outOfStockFloor` guarantees an in-stock item always outranks an identical out-of-stock one.

Synonyms are seeded at boot with the vocabulary this market actually types: `gulab/rose`, `mogra/jasmine`. Profiles, synonyms and vocabulary are cached 60s per tenant. `scripts/search-eval.mjs` supports `--baseline` so ranking changes are measured, not vibes.

---

## 13. Observability

A **hand-rolled, dependency-free Prometheus registry** producing text exposition format 0.0.4 — counters, gauges, labelled histograms, proper label-value escaping (`\`→`\\`, `"`→`\"`, newline→`\n`), canonically sorted label names, monotonic buckets with `+Inf` last, non-finite gauge values dropped. In-memory and process-scoped, with **dynamic gauges recomputed per scrape**.

Instrumented: HTTP requests/duration (by matched route pattern), webhook events by provider and result, payment reconcile outcome, outbox depth by status + oldest-pending age + DLQ, worker heartbeat age and liveness (30s = 6 missed 5s ticks ⇒ down), scheduled-job next-run-in-seconds (negative = overdue) and last status, pending payments + oldest pending age + pending refunds, process uptime/heap/rss and **event-loop lag** (mean and max since last scrape).

`collectDynamic()` degrades gracefully: process metrics always render; if Mongo is down it sets `db_connected=0` and returns. A total collect failure still returns 200 — *"even a total collect failure must not 500 the scrape."* Partial metrics beat none.

Heartbeats: API beats every 10s (`api-{pid}`), worker beats every poll with lifetime counters (`ticks, eventsPublished, eventsFailed, leasesReclaimed, jobsStarted`).

---

## 14. Admin console (`apps/web`) — patterns

**Five personas in one bundle**, gated by role at the route level:

```
super_admin → /platform/*        stores, vendors, vendor applications, billing,
                                 plans, payouts, ledger, lifecycle & ops
admin       → /                  store dashboard, catalog, orders, fulfillment,
                                 returns, policies, search, tax, users, inventory,
                                 hubs, vendors, billing, storefront, domains
vendor      → /vendor/*          profile, products, payouts, payout account
rider       → /rider             delivery run sheet
customer    → /no-access
```

`HomeRedirect` sends each role to its own landing page. Guards are composable one-liners (`storeOnly`, `platformOnly`, `vendorOnly`, `riderAccess`) wrapping a single `RoleGuard`.

**RBAC is a tiny auditable list, not a runtime engine.** `rbac/routeMap.js` holds every route and its allowed roles; `App.jsx` remains the enforcement point, and `routeMap.test.js` is the smoke test that keeps the two from drifting silently. It asserts platform routes are `super_admin`-only, vendor/store/rider guards stay conservative, and **unknown paths resolve to no roles (fail closed)**.

**Feature-folder architecture** — 19 feature domains, 122 JSX components/pages, each feature owning its pages, drawers, modals, panels and *co-located tests*. Route-level code splitting via `lazy()` for the heavier pages (search, tax, users, inventory, hubs, catalog ops, platform lifecycle).

**Navigation has one source.** `lib/nav.js` feeds the sidebar, the ⌘K command palette and `g`-then-letter shortcuts (`g o` → orders, `g d` → dashboard, `g p` → platform) from a single `GROUPS` map with per-item search `keys`, so the three cannot drift. `commandsForRole` gates the palette per role and `filterCommands` matches label *and* keys.

**Data layer** is deliberately thin: `useApi(fn, deps, {toastOnError})` for reads — errors surface through the standard toast system by default *"so no page can silently swallow a failed load"*, with an opt-out for background polls that render their own state — and `useAction()` for mutations returning `{busy, error, run}`.

**UI kit** (`components/ui`): Badge, Button, Card, EmptyState, Field, FilterBar, Modal, PageHeader, Pagination, Spinner, Stat, Table, Toaster. One chart component (recharts `TrendChart`).

**Downloads never call `fetch`.** `lib/download.js` keeps every CSV/template export on the authenticated `api.*` path, parses `content-disposition` with **RFC 5987 preferred** over plain/quoted forms, and sanitizes filenames against directory traversal and control characters — all three behaviours tested.

**Uploads** (`lib/upload.js`) presign → direct PUT with XHR progress → confirm, and correctly branch on provider: local uploads are same-origin and get the session's `Authorization` + `x-tenant-id`; **S3 presigned URLs get ONLY `content-type`**, because the presigned URL *is* the credential and sending app headers would trigger a CORS preflight failure.

**Tenant header logic** is subtle and documented: `loginTenantId` is set only around the login call (store-owner accounts belong to their own tenant, so auth needs the header to *find* the user); afterwards the session user's `tenantId` is sent always, because `tenantContext` resolves before `authenticate` and never sees the JWT.

`PlatformPayoutsPage.jsx` (822 LOC) and `LedgerPage.jsx` (575 LOC) are the two heaviest surfaces — the money operator consoles.

---

## 15. Storefront (`apps/storefront`) — patterns

**One bundle serves every store on the platform.** The boot sequence is a single parameterless call:

```
GET /domains/bootstrap
  → the API works out which store this is from the Host the browser used
  → returns { store{name,slug,tagline,description,logoUrl,bannerUrl,socialLinks,
                      isPublished,gstin}, theme, features, routing{resolvedFrom,
                      host,canonicalHost,canonicalUrl} }
```

The app therefore contains **no tenant id, no slug in a config file, no build-time per-store anything**. And the shell renders *only after* bootstrap resolves — *"so a customer never sees a flash of the wrong brand colour."* Boot failure distinguishes `STORE_NOT_FOUND`/404 ("No store at this address") from a transport failure ("This store is unavailable").

**Runtime theming** (`theme.js`): the brand kit is written straight onto `:root` as CSS custom properties (`--brand`, `--brand-ink`, `--brand-soft`, `--brand-ring`, `--accent`, `--paper`) plus `meta[name=theme-color]`. `readableInk()` computes **WCAG relative luminance** to pick dark or light ink over the brand colour, so a merchant cannot create an unreadable button. Every hex is validated and falls back to the rose kit.

**Three florist brand kits**, not a raw hex picker: `rose` (#9F1239 velvet red / #C9A227), `marigold` (#C2410C saffron / #EAB308), `tropical` (#0F766E monstera / #65A30D) — each with a blurb ("Saffron garlands, brass, South-Indian courtyard gold") and a hero photograph. Merchant `bannerUrl` wins over the kit hero.

**Pincode is the front door.** Remembered per hostname in `localStorage`; on boot it resolves serviceability and then scans offsets `[0,1,2]` for the next open slot to render the arrival promise ("Arrives today 4–7 pm"). Unserviceable pins produce an **honest** empty state, not a fake catalogue.

**Timezone correctness:** `kolkataDate()` uses `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata'})` — *"never use UTC dates or a customer in IST sees 'today' flip at 5:30 am."* Tested.

**State is UI-only.** `store.js` keeps the cart as a *snapshot* for instant badge/drawer rendering; the cart itself lives on the server because *"price, stock and coupon validity are all things a client must not be trusted with, and the checkout saga re-validates them anyway."*

**Auth is interrupt-driven, not gate-driven.** `withAuthRetry(fn)` runs a mutation; on 401 it opens the OTP sheet and **retries the original call once the customer verifies** — so the add-to-cart they started is not lost. `optionalAuthenticate` on the server mirrors this: a *missing* token proceeds as guest, but a *present-but-invalid* token still 401s so a corrupted session cannot silently fall through to someone else's cart. Phone OTP only, two steps, no password.

**Status vocabulary is translated, not exposed.** `lib/status.js` maps the backend's 16 operational states onto ~6 customer outcomes — `"picking"` and `"packed"` both read as *"Being prepared"*, *"because the difference is ours to care about, not theirs"* — with a `step` index driving a 5-milestone tracker. `lib/afterSales.js` does the same for returns/refunds/wallet, with an explicit rule: **pure data and tiny display helpers only; the server remains the authority on eligibility, amounts and transitions.**

**i18n is chrome-only.** Telugu/English for shell copy (search, cart, pin, arrival, footer, auth). *"Catalogue titles stay merchant-authored"* — so a Hyderabad/Kakinada customer can use the shop in తెలుగు without a catalogue rewrite. Signed-in `preferences.language` beats localStorage; `document.documentElement.lang` follows.

**SEO/sharing:** OG tags and `rel=canonical` follow the *route*, so a shared PDP is the PDP, not Home — built from `routing.canonicalUrl` returned by bootstrap.

**Razorpay:** `lib/razorpay.js` loads Checkout.js once (deduped by `data-fm-razorpay`), and the comment states the trust model: *"the webhook is the source of truth; `onSuccess` just starts polling. Never send the key secret to the browser."* On `paymentPending`, checkout navigates to `/orders/:id?pay=1` which polls `paymentStatus` — an endpoint that deliberately returns **only safe fields** (no gateway tokens, no raw gateway payloads).

---

## 16. The shared core (`packages/shared`)

Framework-agnostic plain ESM, consumed by the console, the storefront and the RN scaffold. Four pieces:

**`ApiClient`** — one fetch wrapper:
- unwraps the `{success, data, meta, message, code}` envelope into `{data, meta, message, status}`;
- throws `ApiError {status, code, details, response}` for non-2xx **or** `success: false`;
- on 401: **single-flight refresh** (`if (!refreshing) refreshing = doRefresh().finally(...)`) so N concurrent 401s produce exactly one refresh, then retries the original request **once**; the session is cleared only when refresh *itself* fails;
- `raw: true` returns the untouched `Response` for downloads, and `parseErrorResponse()` reads error bodies **without assuming JSON** — because a raw CSV download can fail with the same envelope as a JSON endpoint;
- network failure becomes `ApiError{status:0, code:'NETWORK_ERROR'}` rather than an opaque throw;
- every collaborator is injectable (`getAccessToken`, `saveTokens`, `clearSession`, `onUnauthorized`, `extraHeaders`, **`fetchImpl`**) — which is what makes `client.test.js` able to test refresh rotation and retry without a server.

**`createAuthStore`** — persisted zustand session where **both the storage adapter and the persist key are injectable**: web uses `localStorage['fm-auth']`, mobile swaps in AsyncStorage, the storefront namespaces the key by hostname. It also detects which call style it was given (legacy adapter vs `{name, storage}`) so all three keep working.

**`createEndpoints(client)`** — 17 groups, one function per route, **1:1 with `backend/src/routes/*`**. This file is the contract, and `invariants.test.js` + `endpoints.test.js` fail the build when a client calls an endpoint no Express route serves (that check exists because `adminInvoiceDetail` → `GET /marketplace/admin/billing/invoices/:id` was once exactly that drift).

**Utils** — money/date/format/status helpers, `ROLE_META`, `BRAND_KITS`, `resolveBrandTheme`.

---

## 17. Cross-cutting conventions worth preserving

These are the habits that make the codebase coherent. They are worth writing down because they are the thing a new contributor would most easily break:

1. **Pure function for the arithmetic, service for the I/O.** `money.js`, `gst.js`, `ranking.js`, `hostname.js`, `orderStateMachine.js`, `payoutStateMachine.js`, `refundCalculator`, `computeLineFinancials`, `queryUnderstanding` — all pure, all unit-testable in milliseconds with no infrastructure. Every one says so in its header.
2. **Provider adapter behind a config switch.** `paymentProvider` (mock/razorpay), `payoutProvider` (console/mock/razorpayx/cashfree), `smsSender` (console/memory/msg91/twilio), `notificationProvider` (console/fcm/apns/smtp/twilio), `billingProvider`, `einvoiceProvider` (console/mock/gsp), `storageProvider` (local/s3), `searchProvider` (mongo/atlas/opensearch). *"The rest of the codebase only ever calls charge()/refund()/verifyWebhook() and never depends on which provider is configured."*
3. **Idempotency everywhere money moves** — unique index on the key, first-writer-wins, E11000 treated as a replay rather than an error. Webhook events dedupe on `(provider, eventId)` and a **replay never overwrites the terminal disposition** the first delivery wrote (*"that would hide the original outcome from the operator"*).
4. **Atomic guarded `findOneAndUpdate` instead of read-check-write** — inventory, slots, counters, outbox claims, scheduler single-flight, chain anchors.
5. **Snapshot at the moment of truth, never recompute later** — address, slot, price, charge breakdown, tax rates, commission rates, deduction policy. Historical documents must show what actually happened.
6. **Denormalize for reads, keep truth elsewhere** — `TenantProduct.stockQty` from `Inventory`; `accountbalances` from `ledgerentries`; `AnalyticsDaily`/`PlatformDaily` rollups; `searchDocuments` from the catalogue.
7. **Best-effort sidecars never gate the money path** — audit append, ledger post in non-strict mode, payout accrual, invoice issuance, timing capture. Each is wrapped, logged, and healed by the nightly.
8. **Enums frozen and centralized** — 123 `Object.freeze`d enums in `constants/enums.js`, 72 audit actions. Models, validators and docs stay in lock-step; select lists are safe to expose to clients.
9. **Comments explain *why*, and record the bug.** The best comments in this repo name the failure they prevent: the `@`-userinfo host spoof found by a fuzz case; the mongoose-strict `deliveredAt` drift; `serializeList` overwriting `id` with `undefined`; the Counter `value` field that would make every order number `…-undefined`; the open-CORS-when-NODE_ENV-unset deploy.
10. **Fail closed, fail loud.** Unknown route → no roles. Unknown subdomain → 404. Unresolvable place of supply → 422. Mock money in production → `exit(1)` before listen.

---

## 18. Findings

Ranked by impact. Each is verified against source, with the evidence named. I have deliberately excluded anything I could not confirm — including one hypothesis I chased and **disproved** (see the note at the end).

> **Status: all ten findings are fixed.** The write-ups below are preserved as the
> original analysis — the evidence and the reasoning are the useful part, and
> rewriting them into the past tense would lose it. §18.0 records what was
> actually built against each one, with the commit and the test that holds it.

### 18.0 Resolution log

| # | Sev | What was built | Commit | Held by |
|---|-----|----------------|--------|---------|
| **F1** | HIGH | Full COD lifecycle: `pending_collection` charge outcome, pre-flight cap enforcement *before* order creation, `cod_collected` / `cod_shortage` ledger kinds, rider collect-at-delivery step, cash exposure ops, integrity checks, storefront + console UI | `ff75533`, `8ad5f98` | `smoke-cod.test.js`, `cod-ledger.test.js` 23, invariants §8 (15 links) |
| **F2** | HIGH | `utils/returnWindow.js` — one delivery clock for returns *and* payout eligibility, replacing the `deliveredAt = paidAt` assignment | `ff75533`, `8ad5f98` | `return-window.test.js` 17, invariants §9 |
| **F3** | MED | OTP gets **two slots** (`OTP_PROVIDER` phone / `OTP_EMAIL_PROVIDER` email) routed by `providerForChannel()`; the guard checks both against `OTP_REQUIRED_CHANNELS`, which defaults to `phone,email` | `c302dce` | `production-guard.test.js` 20 |
| **F4** | MED | Real zero-dep adapters: `utils/smtpClient.js` (RFC 5321 + STARTTLS + AUTH + full MIME), `utils/fcmClient.js` (HTTP v1, RS256 assertion, token cache), per-channel notification routing. Guard now separates **dev doubles** from **declared seams**, and covers storage + search | `c302dce` | `provider-adapters.test.js` 40, `production-guard.test.js` 20 |
| **F5** | MED | `registerStore()` seeds a hub, slots and an explicit ₹0 fee policy; `utils/onboardingReadiness.js` decides readiness purely; `GET /marketplace/store/onboarding`; publishing refused with `STORE_NOT_READY`; hardcoded ₹49 removed and made observable | `8844bc0` | `onboarding-readiness.test.js` 26, invariants §13 |
| **F6** | LOW | `allocateDiscount()` routes through `allocatePaise` — the last instance of "the last line absorbs the rounding" is gone | `3c10fa1` | `discount-allocation.test.js` 25, invariants §11 |
| **F7** | LOW | Both brand-kit copies made field-identical with one precedence rule; `resolveBrandTheme` is now null-safe and idempotent | `0182092` | invariants §12 (imports **both** modules and compares behaviour over 15 inputs) |
| **F8** | LOW | Cart N+1s batched (~60 round trips → 3 for a 20-line cart); `eslint.rules.js` as one rule list consumed by both `eslint.config.js` and a zero-dep gate that runs in CI today; ratcheted baseline | `bdb0aff` | `lint.test.js` 28 checks, `lint-baseline.json` |
| **F9** | LOW | `.env.example` rewritten — the false "not implemented" claims corrected and 17 undocumented variables added | `c302dce` | invariants §5 |
| **F10** | INFO | `scripts/lib/hermeticMongo.js` — null-safe teardown plus a self-healing version pin that retries with the minimum the distro supports | `7a8d2ae` | `hermetic-bootstrap.test.js` 16, invariants §10 |

**Two bugs found while fixing, which the findings had not identified:**

- `bulkGetStock()` omitted the `warehouseId: null` filter that `getRow()` applies. Since `{tenantProductId, warehouseId}` is a **unique** index, a listing can hold one row per warehouse — the batched read collapsed them and the last row iterated silently won, reporting different stock from the one checkout enforces. It surfaced only because F8 went looking for a batched equivalent to use.
- `allocateDiscount()` assigned the last line's share **without rounding**, so what reached `OrderItem` was not `−0.01` but `−0.009999999999999787` — a sub-paisa float artifact, persisted, printed on invoices, and never reconcilable against the "paise are integers" view of the same line. F6 had predicted the negative share, not the unrounded one.

**Verification (all runnable without a database):**

```
invariants                 88 passed, 0 failed      (§1–§13; was 8)
lint                       28 checks passed         (new)
provider-adapters          40 scenarios passed      (new)
production-guard           20 passed                (was 10)
onboarding-readiness       26 scenarios passed      (new)
discount-allocation        25 scenarios passed      (new)
cod-ledger                 23 scenarios passed      (new)
return-window              17 scenarios passed      (new)
hermetic-bootstrap         16 scenarios passed      (new)
frontend                   4 tests, both apps build
```

The DB-backed suites still require a downloadable mongod binary; F10 is what makes
their failure legible when one is unavailable.

---

### F1 · HIGH — Cash on delivery is offered to customers but handled by nothing

**Evidence.** `cod` exists in exactly two places in the backend: `PAYMENT_METHOD.COD` (`enums.js:263`) and the order validator's allowed list (`order.validators.js:23`). A repo-wide grep for `cod|COD|cashOnDelivery` in `src/` returns **no other hit** — no branch in `payment.service.charge()`, no provider adapter, no collection-at-delivery step, no COD reconciliation, no COD ledger treatment.

Meanwhile the storefront offers it as a first-class option: `pages/Checkout.jsx` `PAYMENTS = [['upi',…],['card',…],['cod','Cash on delivery',Banknote]]`.

**Consequence.** `charge()` computes `isWallet = method === 'wallet'`; for `cod` that is false, so it falls through to `paymentProvider.charge()`:
- **mock provider (dev/CI):** returns synchronous success → the order confirms **as if prepaid**. Every COD smoke test would pass while testing nothing.
- **razorpay (production):** `isRazorpay` → creates a gateway order → returns `{success:false, pending:true}` → the saga leaves the order in `PAYMENT_PENDING` and hands the client a Checkout.js payload for an order the customer intended to pay for in cash. Nobody will ever capture it, so `payment-reconcile` (every 5 min, stale after 15) resolves it against the gateway and **cancels the order**.

So in production, **every COD order silently self-cancels ~15–20 minutes after placement**, and the customer sees a payment failure for an order they never tried to pay for online. COD is also the highest-value payment method for exactly the tier-2/tier-3 florist market the i18n and pincode work targets.

**Shape of a fix.** Treat `cod` as a distinct charge outcome (`{success:true, method:'cod', collectOnDelivery:true}`) that confirms the order with `paymentSummary.status = 'pending_collection'`; add a rider/ops "collect cash" step at delivery that closes it; add a `cod_collected` ledger kind (DR cash-on-hand / CR gateway-clearing-equivalent) and a COD reconciliation check to the integrity report. Alternatively, remove `cod` from the storefront `PAYMENTS` list and the validator until it exists — **silently offering a payment method that cancels orders is worse than not offering it.**

---

### F2 · HIGH — The return window is measured from payment, not delivery

**Evidence.**
```js
// services/returns.service.js:39
const deliveredAt = order.paymentSummary?.paidAt || order.updatedAt;
```
The variable is *named* `deliveredAt` but is assigned the **payment** time. Contrast:

```js
// models/order.model.js:129-134 — the documented contract
// Moment of actual delivery. Payout eligibility (deliveredAt + return
// window) and the return-time guard read this; it MUST be a top-level
// schema path or mongoose strict mode silently drops it and every payout
// line's eligibleAt drifts to order.updatedAt.
deliveredAt: { type: Date, default: null },
```
```js
// services/order.service.js:892 — stamped once, on first arrival at DELIVERED
if (toStatus === ORDER_STATUS.DELIVERED && !order.deliveredAt) order.deliveredAt = new Date();
```
```js
// services/payout.service.js:238 — the payout side DOES honour it
const deliveredAt = order.status === ORDER_STATUS.DELIVERED
  ? (order.deliveredAt || order.updatedAt || null) : null;
```

`returns.service.js` is the **only** place in `src/services` that uses `paidAt` as a delivery proxy, and the model comment explicitly says *"the return-time guard read[s] this"* — i.e. the contract was written and this caller never migrated to it.

**Consequence.** `RETURN_WINDOW_DAYS = 7` and `INSTANT_CLAIM_WINDOW_HOURS = 24` are both measured from `paidAt`:

- An order paid on Monday and delivered Thursday has burned 3 of its 7 return days before the customer has the flowers. A Saturday delivery (the peak for a florist) paid the previous weekend may have **no return window left at all**.
- The **instant-claim path is effectively dead** for any order paid more than 24h before delivery — which is the normal case for a slotted-delivery business. Instant claims exist precisely for perishables that arrive damaged, and they are the flow most likely to be exercised.
- For a COD order `paidAt` is null, so it falls back to `updatedAt`, which **drifts on any later save** — the exact failure mode the model comment warns about.
- **It desynchronizes the two sides of the same gate.** Payout eligibility uses `deliveredAt`; return eligibility uses `paidAt`. The platform can therefore mark a vendor line ELIGIBLE and pay it while the customer still has a live return window — the precise risk gate #1 exists to prevent (*"paying before that means buying back your own goods"*) — or, in the opposite skew, refuse a legitimate return on goods already paid out.

**Fix.** One line: `const deliveredAt = order.deliveredAt || order.paymentSummary?.paidAt || order.updatedAt;`. Then assert it — `refund-calc.test.js` covers components but nothing covers the *clock*, and a DB-backed returns suite would have caught this.

---

### F3 · MEDIUM — The production boot guard accepts an OTP provider that cannot run

**Evidence.** `assertProductionProviders` requires `LIVE_OTP = new Set(['msg91','twilio','ses'])`. But in `smsSender.service.js`:

```js
if (provider === 'msg91')  { if (channel !== 'phone') throw new Error('MSG91 delivers SMS only — use ses for email OTP'); … }
if (provider === 'twilio') { if (channel !== 'phone') throw new Error('Twilio SMS adapter is phone-only'); … }
throw new Error(`SMS provider "${provider}" is not implemented yet`);   // ← ses lands here
```

So `OTP_PROVIDER=ses` **passes the guard and then throws on every send.** And since msg91 and twilio both reject `channel: 'email'`, there is **no production-permitted provider that can deliver an email OTP at all.**

**Reachability.** `POST /auth/register` with an email identity is allowed by `user.validators.js` (`channel: Joi.string().valid('phone','email')`) and `auth.service.register()` calls `OtpService.verify({channel:'email'})`. So the surface exists and is reachable.

**Blast radius is currently small** — and this is why it is MEDIUM not HIGH: no shipped client uses it. The storefront `AuthSheet` is phone-OTP-only (*"Two steps, no password, no email"*), and the console `LoginPage` uses `api.auth.login({email, password})` which is the password path, not OTP. So today this is an **unshippable API surface plus a guard that gives false confidence**. It becomes HIGH the moment anyone enables email signup or email-based password reset.

**Fix.** Either implement SES/email OTP, or drop `'ses'` from `LIVE_OTP` so the guard cannot be satisfied by a provider that throws — and reject `channel:'email'` at the validator with a clear code until an email provider exists. A guard whose whole purpose is *"never listen half-configured"* should not accept a half-configured provider.

---

### F4 · MEDIUM — Three production-critical providers are outside the guard

`assertProductionProviders` covers payments, payouts, OTP, JWT secrets and the tenant-header override. It does **not** mention notifications, storage or search — verified by grep. All three default to the dev adapter:

| Setting | Default | Production consequence if untouched |
|---|---|---|
| `NOTIFICATION_PROVIDER` | `console` | Every order-confirmed / out-for-delivery / refund notification is **logged to stdout and marked SENT**. `fcm`, `apns` and `smtp` all `throw new Error('…adapter: configure credentials before use')`, so switching to them without wiring fails the notification (status → `FAILED`) rather than the request. Customers get **no transactional communication at all**, silently. |
| `STORAGE_PROVIDER` | `local` | Media writes to `backend/storage/local`. This survives only because the **dev** compose file bind-mounts `./backend:/app`; `docker-compose.prod.yml` adds no volume of its own, and `backend/storage/` is gitignored. Any containerized deploy that does not replicate that bind mount **loses every product image on redeploy**. `s3` is fully implemented (`@aws-sdk/client-s3` + presigner are real dependencies) — it is purely a config risk. |
| `SEARCH_PROVIDER` | `mongo` | Stays on the in-process ranked path. This is a *performance* ceiling rather than a correctness bug — but `SEARCH_RANKED_CATALOG` and the atlas/opensearch seams exist precisely so this is a decision, not an accident. |

Notifications are the sharpest of the three: the outbox, the templates, the device registry, the per-channel fan-out and the nightly `processPending` are all **fully built**, and in production they all run — into `console.log`. That is the definition of "launched and silently not working."

**Fix.** Extend `collectProductionViolations` to require a live notification provider and `STORAGE_PROVIDER=s3` (or an explicit, documented volume), exactly as it already does for payments. The pattern and the test harness (`production-guard.test.js`) both exist; this is adding cases to a working machine.

---

### F5 · MEDIUM — A self-registered store cannot sell anything

**Evidence.** `store.service.registerStore()` creates exactly four things: `Tenant`, `TenantAuthConfig`, the owner `User`, and `billingService.ensureSubscription()`. It creates **no** `Hub`, no `ServiceablePincode`, no `DeliverySlot`, no `DeliveryFeePolicy`, no `TaxPolicy`.

But checkout *requires* them: `slotService.assertServiceable({pincode})` → `resolveHub()` → and when a pin is given, an unmapped or unserviceable pin is a **hard miss**:

```js
if (pin) { …  throw badRequest(`We don't deliver to ${pin} yet`, 'PINCODE_UNSERVICEABLE'); }
```
The first-active-hub fallback is used *only* when the caller omitted a pin. So a brand-new store's storefront renders, shows catalogue, and **cannot check out** — correctly and honestly, but with no path forward that the operator is told about.

Compounding it, `computeDeliveryFee()` returns a **hardcoded ₹49** when no active `DeliveryFeePolicy` exists:
```js
if (!policy) return 49; // legacy fallback (no tenant policy configured)
```
— in the very file whose header says *"Replaces the hardcoded `deliveryFee = 49`"*. So the first fee a new merchant's customers pay is a magic number nobody chose and no admin surface surfaces.

`scripts/seed-default-tenant.js` **does** seed a hub, pincodes, a fee policy, a `WELCOME10` coupon and per-category tax policies — which is why the demo and every smoke test work. The gap is only on the self-service path.

**Fix.** Either seed a starter operational skeleton in `registerStore()` (default hub, an empty-but-present fee policy with `baseFee: 0` and a visible threshold, default tax policies per category), or add an explicit **onboarding checklist** to the store dashboard that blocks publishing until hub + pincodes + slots + fee policy exist. `store.isPublished` already exists as a flag — it should not be settable while the store is structurally unable to take an order.

---

### F6 · LOW — Two line-level allocation algorithms coexist

`utils/money.js` states that `allocatePaise` **"Replaces the previous 'last line absorbs the rounding' approach, which is biased toward one line and can hand a negative share to a zero-priced item."**

`pricingPolicy.allocateDiscount()` still implements exactly the replaced approach:
```js
const share = (idx === lineItems.length - 1)
  ? discountTotal - allocated   // last line absorbs rounding
  : roundMoney(discountTotal * (line.lineTotal / subtotal));
```

Meanwhile every *paise* split uses largest-remainder: `ledger.service:393`, `payout.service:329`, `payout.service:1687`, `taxDocument.service:492,523`.

**Impact is genuinely small and I want to be precise about it:** totals still reconcile, because the per-line `discountAllocated` is persisted onto `OrderItem` and the tax/invoice/payout layers **reconstruct from those persisted values** rather than re-deriving them. So no money is lost and no document disagrees with itself. The residual risk is that the *rupee* view of a line and a *paise* re-derivation of the same line can differ by a paisa, and that the last line of an order systematically absorbs the bias — which matters if anyone ever disputes a single-line partial refund against a ledger entry for that line.

**Fix.** Route `allocateDiscount` through `allocatePaise` (convert to paise, allocate, convert back). Low risk, removes the last instance of the algorithm the codebase already decided against, and makes the "one algorithm" claim in `money.js` true.

---

### F7 · LOW — Brand-kit definitions are duplicated and have already diverged

`backend/src/constants/brandKits.js` and `frontend/packages/shared/src/brand/kits.js` both define `BRAND_KITS` + `resolveBrandTheme`, joined only by the comment *"Keep in lockstep with backend/src/constants/brandKits.js."* They have drifted:

| | backend copy | shared copy |
|---|---|---|
| `blurb`, `paper` | absent | present |
| `resolveBrandTheme().heroUrl` | `kit.hero` (ignores `theme.heroUrl`) | `theme.heroUrl \|\| kit.hero` |
| covered by a test | no | yes (`kits.test.js`) |

**Why it is not currently a live bug** — I checked: `tenant.theme` has only `{kit, primaryColor, accentColor}`, so there is no `heroUrl` for the backend resolver to drop; the merchant hero path runs through `tenant.store.bannerUrl`, and both `Home.jsx:53` and `App.jsx:169` correctly prefer it (`store?.bannerUrl || resolved.heroUrl`).

**Why it is still worth fixing:** the two resolvers now encode *different* precedence rules for a field one of them accepts, and nothing tests that they agree. The moment `heroUrl` is added to `tenant.theme` — which the shared resolver already anticipates — the backend will silently discard it. The repo already has the right instrument for this: `invariants.test.js` check #3 exists precisely to catch cross-layer contract drift.

**Fix.** Add an invariant asserting the backend and shared kit definitions agree on `id`/`primaryColor`/`accentColor`/`hero` per kit, and on the resolver's precedence rules. Or better: make the backend the only source and have bootstrap return the fully-resolved theme (it already calls `resolveBrandTheme`), so the client stops re-resolving.

---

### F8 · LOW — No linter is configured, but the code is annotated for one

There is **no ESLint dependency, config file, or `lint` script anywhere** in the repo (checked `backend/package.json`, `frontend/package.json`, all workspace packages, and repo root — zero hits). Yet `backend/src` contains **80 `eslint-disable` comments**: 51 × `no-await-in-loop`, 27 × `no-console`, 2 × `no-unused-vars`. CI runs tests and builds; it never lints.

This is not a cosmetic complaint. `no-await-in-loop` is disabled 51 times, and in several of those loops the sequential await is **load-bearing** (saga compensation ordering, chain-anchor CAS). But in others it is incidental — `cart.service.revalidate()`, `applyLivePrices()`, `mergeGuestCart()` each issue 2–3 sequential queries *per cart item* where a batched lookup would do. `pricingPolicy` already shows the right pattern (one batched `TaxPolicy.find({categoryId: {$in: uniqueCats}})`), and `inventoryService.bulkGetStock()` exists but the cart path does not use it. Without a linter, nobody is told which is which.

**Fix.** Add `eslint` + a flat config matching the conventions the code already follows, wire `npm run lint` into the existing CI `backend` and `frontend` jobs, and land it with the current disables grandfathered. Then the annotations mean something and the N+1 carts become visible.

---

### F9 · LOW — Stale operator-facing documentation

`backend/.env.example` says:

> `console` = logs the code to server logs (dev). `memory` = same, kept in RAM.
> `msg91 | twilio | ses` are **declared adapter seams — NOT implemented yet** (see the TODO in `src/services/smsSender.service.js`).

Both claims are wrong today: `msg91` and `twilio` are **fully implemented** with real HTTP calls to `control.msg91.com/api/v5/otp` and `api.twilio.com`, and there is **no TODO** in that file. Only `ses` is unimplemented.

This matters because `.env.example` is the production runbook's front door, and `invariants.test.js` check #5 exists specifically because *"a deploy from .env.example silently ran on local-disk storage and default commission rates"* when 25 of 51 vars were undocumented. That check verifies every `process.env.X` is **mentioned**; nothing verifies the prose is **true**. An operator reading this would conclude production OTP is impossible and either ship `console` (blocked by the guard) or stall the launch.

**Fix.** Correct the comment. Consider extending the invariant to assert that each provider named in `.env.example` as available actually has a non-throwing branch in its adapter — the same class of drift check the repo already applies to endpoints and audit actions.

---

### F10 · INFO — The hermetic DB suites cannot run on modern base images (observed today)

CI pins `MONGOMS_VERSION: '6.0.6'` for all 17 hermetic suites. On this sandbox (Debian 12) that fails hard:

```
❌ KnownVersionIncompatibilityError: Requested Version "6.0.6" is not available for "Debian 12"!
   Available Versions: ">=7.0.3"
   Mongodb does not provide binaries for versions before 7.0.3 for Debian 12+
   and also cannot be mapped to a previous Debian release
```

Forcing a supported version then failed on **network egress** (`fastdl.mongodb.org` → `ECONNRESET`), so I could not complete a DB-backed run here at all. Two separate issues, both worth attention:

1. **CI fragility.** `ubuntu-latest` is Debian-12-derived. If `mongodb-memory-server`'s distro detection resolves it to Debian 12 rather than a mappable Ubuntu release, **every hermetic suite in the `backend` job breaks at once** — the pure suites would still pass, so the failure would look like an infrastructure flake rather than a pin problem. Worth confirming against a recent CI run and, if needed, bumping the pin to `>=7.0.3` (the compose stack separately uses `mongo:6.0` as a *service container*, which is unaffected — only the in-memory binary download is).
2. **A masked error.** When the download fails, the suite's top-level catch throws a *second* error:
```js
try { await main(); } catch (err) { console.error('❌', err); … await mongod.stop().catch(()=>{}); … }
//                                                              ^^^^^ TypeError: Cannot read properties of undefined
```
`mongod` is still `undefined` because the failure happened during `MongoMemoryServer.create()`. The real cause is printed above it, but the process exits on a `TypeError` — so any tooling that reads the *last* error sees the wrong thing. I hit this twice today. Guarding it (`await mongod?.stop()`) is a one-character-class fix across the suite family.

---

### A hypothesis I chased and **disproved**

For the record, because a false positive in a report like this is worse than no finding: I suspected that `tenant.theme`'s Mongoose defaults (`primaryColor: '#9F1239'`) would **shadow the kit colours** — i.e. a merchant switching `kit` to `tropical` without also sending colours would get the tropical hero painted rose-red, because `resolveBrandTheme` does `theme.primaryColor || kit.primaryColor` and the default is always truthy.

It does not happen. `store.service.updateStore()` re-derives both colours from the kit whenever a kit change arrives without explicit colours:

```js
if (payload.theme.kit && BRAND_KITS[payload.theme.kit]) {
  const kit = BRAND_KITS[payload.theme.kit];
  if (payload.theme.primaryColor === undefined) incoming.primaryColor = kit.primaryColor;
  if (payload.theme.accentColor  === undefined) incoming.accentColor  = kit.accentColor;
}
```

And the admin `BrandingPage` sends `theme: { kit: form.kit || 'rose' }` — colours `undefined`, so the write path fills them. The write path guards the read path's weakness. Correct behaviour; noting it here so the guard is not accidentally removed later.

---

## 19. Assessment

**This is not a prototype that grew.** It is a system that was architected, and the architecture is visible in the code rather than only in the docs. The things that are hardest to retrofit are already present and already load-bearing:

- **Money is treated as a distinct discipline** from the rest of the domain — integer paise, largest-remainder allocation, exact-by-construction tax subtraction, a balanced immutable double-entry ledger with a materialized balance view that can always be recomputed.
- **Idempotency is structural, not aspirational** — unique indexes on idempotency keys are called *"the exactly-once backbone"* and are deliberately materialized in the worker context as well as the API.
- **Crash windows are designed for, then closed automatically.** Event-before-journal ordering makes a crash *visible*; the nightly integrity pass *heals* it; the hash chain makes tampering detectable while refusing to auto-repair it, because *"healing a break would bless the tamper."* That last distinction is the mark of someone who has thought about audit rather than just implemented hashing.
- **Concurrency is handled at the database layer** with guarded atomic updates everywhere it matters — inventory, slots, counters, outbox leases, scheduler single-flight, chain anchors — rather than with application-level locks that do not survive a second process.
- **Tenancy is a security boundary**, resolved from the Host, with attacker-controlled input parsed by a pure paranoid module and fuzz-tested, and with the *absence* of a tenant header in the storefront treated as the guarantee.
- **The pure/impure split is applied consistently**, which is why 14 unit suites run in ~2 seconds and cover the arithmetic that actually matters — tax, payouts, refunds, ranking, hostname, forecasting, PDF, and the production guard.
- **Both front-ends are thin where they should be.** The storefront holds UI state only and treats the server as the authority on price, stock, eligibility and transitions. The console keeps one navigation source, one RBAC list, and never calls `fetch` directly.

The findings above are almost all at the **edges where the system meets the real world** — a payment method offered but unimplemented, a clock read from the wrong field, providers the guard does not check, an onboarding path that creates a store which cannot sell. That is a healthy failure profile: the *core* is sound and the defects are in the seams, where they are findable and fixable without redesign.

**The two I would fix before any real customer traffic are F1 and F2.** F1 because it silently cancels orders for the payment method the target market most wants; F2 because it quietly breaks a customer-facing promise *and* desynchronizes the return-risk gate that protects vendor payouts — a correctness bug in the one subsystem the codebase itself describes as *"the one place in the platform where money leaves the building."* Both are small diffs. F2 is one line.

**Sequencing I'd suggest:**

| # | Work | Effort | Why now |
|---|---|---|---|
| 1 | **F2** — return window reads `order.deliveredAt` + a test on the clock | ~1 line + test | one-line correctness fix in a money path |
| 2 | **F1** — decide COD: implement the collect-at-delivery flow, or remove it from the UI and validator | 1–3 days or 30 min | actively cancels production orders today |
| 3 | **F4** — extend `assertProductionProviders` to notifications + storage; add cases to `production-guard.test.js` | ~half day | the pattern and harness already exist |
| 4 | **F3** — drop `ses` from `LIVE_OTP` or implement it; reject email-channel OTP at the validator until then | ~1 hour | guard currently gives false confidence |
| 5 | **F9** — correct `.env.example`; **F10** — verify the CI mongod pin against a recent run, guard `mongod?.stop()` | ~1 hour | operator-facing truth + CI resilience |
| 6 | **F5** — onboarding skeleton or a publishing gate in `registerStore()` | 1–2 days | self-service signup currently dead-ends |
| 7 | **F8** — add ESLint + a `lint` CI job, grandfather current disables | ~half day | makes 80 existing annotations meaningful; surfaces the N+1 cart loops |
| 8 | **F6, F7** — one allocation algorithm; one brand-kit source (or an invariant that they agree) | ~half day | removes the last two "keep in lockstep by hand" comments |

---

## Appendix A — where each rule lives

| Rule | File |
|---|---|
| Tenant resolution order | `backend/src/middleware/tenantContext.js` |
| Host parsing (paranoid, pure) | `backend/src/utils/hostname.js` |
| Token↔tenant guard | `backend/src/middleware/authenticate.js` |
| Commerce writes blocked on non-active tenant | `backend/src/middleware/requireActiveTenant.js` |
| Order transitions | `backend/src/utils/orderStateMachine.js` |
| Payout batch transitions | `backend/src/utils/payoutStateMachine.js` |
| Checkout saga + compensations | `backend/src/services/order.service.js` |
| Cart revalidation / guest merge | `backend/src/services/cart.service.js` |
| Atomic inventory reserve/commit/restore | `backend/src/services/inventory.service.js` |
| Atomic slot capacity | `backend/src/services/slot.service.js` |
| Paise arithmetic + allocation | `backend/src/utils/money.js` |
| GST arithmetic, GSTIN checksum, FY, state codes | `backend/src/utils/gst.js` |
| Delivery fee / coupon / breakdown | `backend/src/services/pricingPolicy.service.js` |
| Invoice issuance, numbering, place of supply | `backend/src/services/taxDocument.service.js` |
| Ledger posting rules + chart of accounts | `backend/src/services/ledger.service.js` |
| Sale/refund/payout journal derivation | `backend/src/services/ledgerPosting.service.js` |
| Payout accrual, gates, line financials | `backend/src/services/payout.service.js` |
| Refund destination + components | `backend/src/services/refund.service.js`, `refundCalculator.service.js` |
| Return windows + fraud guard | `backend/src/services/returns.service.js` |
| Domain events + hash chain + CAS anchor | `backend/src/services/domainEvent.service.js` |
| Chain tail anchor | `backend/src/models/auditChain.model.js` |
| Integrity report + replay | `backend/src/services/integrity.service.js` |
| Outbox leases, backoff, DLQ | `backend/src/services/catalogEvent.service.js` |
| Scheduler single-flight | `backend/src/workers/scheduler.js` |
| Nightly 11-step self-heal | `backend/src/services/maintenance.service.js` |
| Production provider guard | `backend/src/utils/assertProductionProviders.js` |
| Ranking signals + weights | `backend/src/utils/ranking.js` |
| Search pipeline | `backend/src/services/search.service.js` |
| Prometheus registry | `backend/src/observability/metrics.js`, `registry.js` |
| Enum vocabulary (123 frozen) | `backend/src/constants/enums.js` |
| Static regression gates | `backend/scripts/invariants.test.js` |
| API client + single-flight refresh | `frontend/packages/shared/src/api/client.js` |
| Endpoint contract map | `frontend/packages/shared/src/api/endpoints.js` |
| Injectable auth store | `frontend/packages/shared/src/auth/store.js` |
| Console RBAC list | `frontend/apps/web/src/rbac/routeMap.js` |
| Console nav / palette / shortcuts | `frontend/apps/web/src/lib/nav.js` |
| Storefront boot + theme | `frontend/apps/storefront/src/App.jsx`, `theme.js` |
| Storefront state (UI only) | `frontend/apps/storefront/src/store.js` |
| Interrupt-driven auth retry | `frontend/apps/storefront/src/lib/withAuth.js` |
| Customer status vocabulary | `frontend/apps/storefront/src/lib/status.js`, `afterSales.js` |
| IST date correctness | `frontend/apps/storefront/src/lib/arrival.js` |

## Appendix B — business constants

| Constant | Value | Source |
|---|---|---|
| Slot hold TTL | 10 min | `SLOT_HOLD_TTL_SECONDS` |
| Cart item limit / TTL | 50 distinct / 30 days | `CART_ITEM_LIMIT`, `CART_TTL_SECONDS` |
| Max delivery retries | 2 | `order.service.MAX_DELIVERY_RETRIES` |
| Rider accept TTL / reject cap | 45 s / 10 | `RIDER_ACCEPT_TTL_SECONDS`, `RIDER_REJECT_CAP` |
| Return window / instant claim / monthly fraud cap | 7 d / 24 h / 3 | `returns.service` |
| Perishable return window | 1 d | `DEFAULT_POLICY.perishableReturnWindowDays` |
| Gateway refund threshold | ₹2,000 | `refund.service.GATEWAY_REFUND_THRESHOLD` |
| Min payout / dual approval / max batch | ₹500 / ₹100,000 / ₹500,000 | `DEFAULT_POLICY` |
| Payout schedule / commission GST | `weekly:wed` / 18% | `DEFAULT_POLICY` |
| Platform default commission | 1% (100 bps) | `config.marketplace.defaultCommissionBps` |
| Trial / invoice grace | 14 d / 7 d | `config.marketplace` |
| JWT access / refresh | 15 min / 30 d | `config.jwt` |
| OTP length / TTL / attempts / cooldown | 6 / 300 s / 5 / 60 s | `config.otp` |
| Outbox poll / batch / lease / max attempts | 5 s / 20 / 60 s / 5 | `config.worker` |
| Outbox backoff ladder | 30 s → 2 m → 10 m → 30 m | `catalogEvent.backoffMs` |
| Payment reconcile / stale threshold | every 5 min / 15 min | `config.payments` |
| Nightly / marketplace nightly | 02:00 / 02:05 | `workers/scheduler.js` |
| Worker considered down after | 30 s (6 missed beats) | `config.observability` |
| Media image / video / tenant quota / presign | 10 MB / 250 MB / 5 GB / 15 min | `config.storage.limits` |
| Ranking freshness half-life / CTR prior / weight | 72 h / 0.08 / 50 | `ranking.DEFAULT_TUNING` |
| API rate limit | 300 / 15 min | `rateLimiter.standard` |
| OTP send / verify, login limits (prod) | 5 / 10, 10 per 10 min | `rateLimiter` |
| Domain cache TTL | 5 min | `config.domains.cacheTtlMs` |
| Fallback delivery fee (no policy) | ₹49 — see F5 | `pricingPolicy.computeDeliveryFee` |
