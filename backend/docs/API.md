# API Reference — v1

Base URL: `http://localhost:4000/api/v1`

Every response uses a uniform envelope:

```jsonc
// success
{ "success": true, "message": "…", "data": {…}, "meta": {…} }
// error
{ "success": false, "message": "…", "code": "OTP_INVALID", "details": {…} }
```

All endpoints run through `tenantContext` — a tenant is resolved from (in order)
`x-tenant-id` header, JWT tenant claim, `DEFAULT_TENANT_ID` env, first active tenant.

Auth header: `Authorization: Bearer <accessToken>`

---

## Health

### `GET /health`
```jsonc
200 { "success": true, "data": { "service": "flower-market-api", "tenantId": "…" } }
```

---

## Auth (`/auth`)

### `POST /auth/otp/request` — send OTP
Body:
```jsonc
{ "purpose": "signup", // login | signup | password_reset | phone_change | email_verify
  "channel": "phone",  // phone | email
  "phone": { "countryCode": "+91", "number": "9876543210" } }
```
Response: `200 { data: { otpId, expiresInSeconds, masked } }`
Errors: `429 OTP_RESEND_COOLDOWN` (too fast), `429 RATE_LIMITED` (5/10 min/IP).

### `POST /auth/otp/verify` — verify OTP / complete OTP login
Body:
```jsonc
{ "purpose": "login", "channel": "phone",
  "phone": { "number": "9876543210" },
  "code": "123456",
  "device": { "deviceId": "uuid", "deviceName": "Samsung A52", "platform": "android", "userAgent": "…" } }
```
Response: `200 { data: { user, tokens: { accessToken, refreshToken, tokenType, expiresIn }, isNewUser } }`

> `isNewUser: true` when the account was auto-created on first login (OTP-first signup).
> Non-login purposes return `{ verified: true }` (password_reset has its own route).

Errors: `400 OTP_INVALID`, `400 OTP_EXPIRED`, `400 OTP_ALREADY_USED`, `429 OTP_MAX_ATTEMPTS`.

### `POST /auth/register` — explicit signup (OTP verified)
```jsonc
{ "phone": { "countryCode": "+91", "number": "9876543210" },
  "email": "ravi@example.com", "otpCode": "123456",
  "profile": { "firstName": "Ravi", "lastName": "Kumar" },
  "source": "app" }
```
`201 { data: { user, tokens } }` · `409 ACCOUNT_EXISTS`

### `POST /auth/login` — email + password
```jsonc
{ "email": "ravi@example.com", "password": "…", "device": {…} }
```
`200 { data: { user, tokens } }` · `401 INVALID_CREDENTIALS` · `401 PASSWORD_NOT_SET`

Emails are globally unique, so the lookup is global and the account's tenant is
an output of login, never an input — no tenant header is needed (or consulted)
for password login. Wrong passwords and unknown emails return the same opaque
`INVALID_CREDENTIALS` (no account enumeration); an account created OTP-first
(no password set) returns `PASSWORD_NOT_SET` with a message pointing to OTP
sign-in / password reset. A correct password always yields a token bound to the
account's OWN tenant, whatever the request's header claimed.

### `POST /auth/refresh` — rotate refresh token
```jsonc
{ "refreshToken": "…", "device": {…} }
```
`200 { data: { user, tokens } }` — old token is revoked (rotation).
Reuse of an already-rotated token → `401 INVALID_REFRESH_TOKEN`.

### `POST /auth/logout`
```jsonc
{ "refreshToken": "…" }            // revoke this session
POST /auth/logout?all=true          // revoke every session of the user
```
`200 { data: { revoked: "current" | "all" } }`

### `POST /auth/password/change` — (authenticated)
```jsonc
{ "currentPassword": "…", "newPassword": "…" }
```
Revokes **all** sessions. `200` · `400 WRONG_PASSWORD`

### `POST /auth/password/reset` — OTP-based, no login
```jsonc
{ "channel": "phone", "phone": { "number": "9876543210" },
  "otpCode": "123456", "newPassword": "…" }

// or by email (globally resolved, mirroring login):
{ "channel": "email", "email": "ravi@example.com",
  "otpCode": "123456", "newPassword": "…" }
```
Request the code with `POST /auth/otp/request` (`purpose: "password_reset"`).
Email targets resolve globally — a store owner resets from the console without
naming a tenant; phone targets stay tenant-scoped. Errors: `400 OTP_INVALID`,
`400 OTP_EXPIRED`, `404 USER_NOT_FOUND`, `400 VALIDATION_ERROR`.

---

## Users (`/users` — all authenticated)

### `GET /users/me`
Full profile (identity, profile, preferences, marketing, location).

### `PATCH /users/me`
```jsonc
{ "profile": { "firstName": "Ravi" },
  "preferences": { "language": "te", "theme": "dark" },
  "marketing": { "optedIn": true } }
```
Only `profile / preferences / marketing` are user-mutable — identity is immutable
through this endpoint.

### `PUT /users/me/location` — BigBasket-style "set my area"
```jsonc
{ "location": { "cityId": "…", "areaId": "…", "pincode": "533001",
                "lastKnownCoordinates": [82.25, 16.99] } }
```
Drives slot availability & catalogue for that pincode.

### `DELETE /users/me` — self account-deletion (soft)
`200 { data: null }`

### Saved addresses

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users/me/addresses` | default first |
| POST | `/users/me/addresses` | auto-stamps serviceability; max 10 |
| GET | `/users/me/addresses/:id` | ownership-guarded (404 for others' addresses) |
| PATCH | `/users/me/addresses/:id` | re-checks serviceability when pincode changes |
| DELETE | `/users/me/addresses/:id` | promotes next default automatically |
| PATCH | `/users/me/addresses/:id/default` | exactly-one-default invariant |

```jsonc
// POST /users/me/addresses
{ "line1": "4-1-22, Temple Street", "line2": "", "landmark": "Near Ramalayam",
  "city": "Kakinada", "state": "AP", "pincode": "533001",
  "type": "home", "isDefault": true }
// 201
{ "success": true, "data": { "id": "…", "pincode": "533001",
  "serviceability": { "status": "serviceable", "message": "We deliver to 533001.", "checkedAt": "…" } } }
```

### Admin (`ADMIN` / `SUPER_ADMIN` only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users?page=1&limit=20&search=ravi&status=active&role=customer` | paginated |
| GET | `/users/:id` | |
| PATCH | `/users/:id/role` | `{ "role": "vendor" }` |
| PATCH | `/users/:id/status` | `{ "status": "blocked" }` |

Non-admin → `403 FORBIDDEN`; missing/invalid token → `401`; cross-tenant token → `401 TENANT_MISMATCH`.

---

---

## Catalog (`/catalog`)

### Customer (public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/catalog?search=&categoryId=&brandId=&type=&minPrice=&maxPrice=&inStock=&sort=relevance\|price_asc\|price_desc\|newest\|popularity&groupBy=master&page=&limit=` | merged view, ACTIVE only; `groupBy=master` returns one card per master with the full variant family |
| GET | `/catalog/categories` | active category tree |
| GET | `/catalog/brands` | verified brands |
| GET | `/catalog/products/:id?variantId=` | product + listing + stock + variant family; `?variantId=` preselects, unknown ids fall back to the default |
| GET | `/catalog/p/:slug?variantId=` | same by slug (PDP) |
| GET | `/catalog/products/:id/stock?variantId=` | quick availability, optionally per variant |

```jsonc
// GET /catalog?search=rose
{ "success": true, "data": [
    { "listingId": "…", "variantId": "…",
      "variant": { "id": "…", "label": "Red", "value": "red", "variantType": "color" },
      "price": { "mrp": 349, "sellingPrice": 299, "currency": "INR" },
      "stockQty": 120, "availability": { "status": "in_stock" },
      "product": { "id": "…", "title": "Red Roses (Bunch of 20)", "slug": "ros-red-bunch",
                   "skuGlobal": "ROS-RED-BUNCH", "type": "fresh_flower",
                   "imageUrl": "…", "imageSource": "variant|master", … } } ],
  "meta": { "page": 1, "limit": 20, "total": 3, "hasMore": false } }

// GET /catalog?search=polo&groupBy=master — one card per master
{ "success": true, "data": [
    { "masterId": "…", "product": { "id": "…", "title": "Classic Polo", … },
      "priceRange": { "min": 799, "max": 999 }, "variantCount": 5, "inStockCount": 4,
      "defaultListingId": "…",
      "variants": [
        { "listingId": "…", "variantId": "…", "label": "Red", "value": "red",
          "price": { "sellingPrice": 899, "mrp": 1099 }, "stockQty": 7,
          "imageUrl": "…", "imageSource": "variant", "isDefault": false },
        // … one entry per variant THIS tenant listed
      ] } ],
  "meta": { "page": 1, "limit": 20, "total": 1, "hasMore": false, "grouped": true } }
```

### Tenant portal (`/catalog/tenant` — authenticated)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/masters/propose` | propose new global SKU → PENDING_REVIEW + change request |
| GET | `/masters/:id/variants` | selection grid: every variant + this tenant's listing (or null) + resolved gallery |
| POST | `/listings` | create listing for an ACTIVE master (`{productMasterId, variantId?, price, stockQty, status}`) |
| POST | `/listings/bulk` | list one/some/all variants of ONE master (`{productMasterId, selections[]?, selectAll?, defaults?, onConflict: skip\|error}`) → `{created[], skipped[], warnings[]}` |
| GET | `/listings?status=&search=&categoryId=&productMasterId=` | tenant's listings (paginated), each row carries its `variant` |
| GET | `/listings/:id` | listing + master + images |
| PATCH | `/listings/:id/price` | `{price{mrp,sellingPrice}, reason, expectedVersion}` → 409 on stale version |
| PATCH | `/listings/:id/status` | `{status, expectedVersion}` |
| POST | `/listings/:id/deactivate` | deactivate listing |
| GET/PUT/PATCH | `/listings/:id/stock` | get / set / adjust stock |
| POST | `/listings/:id/stock/reserve` · `/release` | atomic `{qty, orderRef?}` → 409 INSUFFICIENT_STOCK |
| POST | `/change-requests` | submit `{type, productMasterId?, diff?, payload?, note?}` |
| GET | `/change-requests?status=` | my requests |
| POST | `/change-requests/:id/cancel` · `/revise` | cancel pending / revise needs_changes |
| POST | `/bulk/:kind` (`price`\|`stock`) | `?dryRun=true` validates; returns `{jobId}` |
| GET | `/bulk/jobs` · `/bulk/jobs/:jobId` | job list / poll status |
| GET | `/bulk/template/:kind` | CSV template download |

```jsonc
// POST /catalog/tenant/listings
{ "productMasterId": "…", "price": { "mrp": 349, "sellingPrice": 299 }, "stockQty": 50, "status": "active" }
// 201 { data: { id, price, stockQty, availability: {status:"in_stock"}, status:"active", version: 1 } }

// POST /catalog/tenant/listings/bulk — list "some" (per-variant prices)
{ "productMasterId": "…", "selections": [
    { "variantId": "…white", "price": { "mrp": 999, "sellingPrice": 799 }, "stockQty": 10, "status": "active" },
    { "variantId": "…red", "price": { "mrp": 1099, "sellingPrice": 899 }, "stockQty": 7, "status": "active" } ] }
// 201 { data: { created: [{ variantId, listingId, price }], skipped: [], warnings: [] } }

// POST /catalog/tenant/listings/bulk — list "all" with shared defaults
{ "productMasterId": "…", "selectAll": true,
  "defaults": { "price": { "mrp": 1299, "sellingPrice": 999 }, "stockQty": 3, "status": "active" } }
// already-listed variants land in skipped[] as { variantId, reason: "already_listed" }
```

### Central ops (`/catalog/admin` — ADMIN / SUPER_ADMIN)

| Method | Path | Notes |
| --- | --- | --- |
| POST/GET/PATCH/DELETE | `/categories`, `/categories/:id`, `/categories/tree` | taxonomy (admin-only writes) |
| POST/GET/PATCH | `/brands`, `/brands/:id` | brand registry |
| PATCH | `/brands/:id/verify` | `{verified, note?}` |
| POST/GET | `/masters`, `/masters/:id` | global masters (admin creates ACTIVE directly) |
| PATCH | `/masters/:id` | global fields + `expectedVersion` (409 on conflict) |
| POST | `/masters/:id/review` | `{decision: approve\|reject}` for PENDING_REVIEW masters |
| POST | `/masters/:id/deprecate` | soft-delete master → cascades listings to INACTIVE |
| POST | `/masters/:id/variants` | add variant (`{variantType, value, displayLabel?, sku?, isDefault?, images?[], expectedVersion}`) |
| PATCH | `/masters/:id/variants/:variantId` | edit label/SKU/order/default/status + `expectedVersion` |
| DELETE | `/masters/:id/variants/:variantId` | retire variant + its gallery (`{expectedVersion}`) |
| POST | `/masters/:id/variants/:variantId/images` | add a photo to one variant's gallery |
| POST | `/masters/:id/images` | add master photo, or variant photo via `{…, variantId}` |
| PATCH | `/masters/:id/images/:imageId/primary` | set primary within its scope (master OR that variant) |
| DELETE | `/masters/:id/images/:imageId` | remove photo (`{expectedVersion}`) |
| PUT | `/masters/:id/attributes` | replace attribute set |
| GET | `/change-requests?status=` | review queue |
| POST | `/change-requests/:id/review` | `{decision: approve\|reject\|needs_changes, note?}` — approve applies diff |
| GET | `/audit?entityType=&action=&from=&to=` | full audit trail |
| GET | `/events/status` · POST `/events/drain` | outbox stats / publish pending |

---

## Cart & checkout (`/cart` — authenticated)

Disposable draft: items snapshot price/stock at add-time; checkout **revalidates**
against live price/stock and refuses to proceed until the diff is explicitly
re-confirmed (`confirmPriceChanges: true`).

| Endpoint | Purpose |
| --- | --- |
| `GET /cart` | current ACTIVE cart + items (creates lazily) |
| `POST /cart/items` `{tenantProductId, qty}` | add / increment (snapshots price+stock, 50-item cap) |
| `PATCH /cart/items/:id` `{qty}` | change qty (capped at stock) |
| `DELETE /cart/items/:id` | remove line |
| `DELETE /cart` | clear cart |
| `POST /cart/revalidate` | refetch live price+stock per line → `{changed, diffs, total}` |
| `POST /cart/quote` `{slotReservationId, addressId, confirmPriceChanges}` | exact checkout preflight → `{itemSubtotal, deliveryFee, taxTotal, discountTotal, grandTotal, priceChanged}`; used by the storefront to gate wallet payment on whether the balance covers the true total |
| `POST /cart/checkout` `{slotReservationId, addressId, paymentMethod, confirmPriceChanges, idempotencyKey}` | **the saga**: charge → hard-commit inventory → confirm slot → queue picking → `CONFIRMED`; returns order + items + timeline. `paymentMethod: 'wallet'` debits `customer_wallet_liability` via the internal provider (no gateway) |

## Slotted delivery (`/cart/slots` — authenticated)

BigBasket-style windows with hard capacity (atomic lock — concurrent reserves cannot oversell).

| Endpoint | Purpose |
| --- | --- |
| `GET /cart/slots?pincode=&date=` | open/closed windows with `remaining`, cut-off, hub |
| `POST /cart/slots/:id/reserve` | atomically hold capacity (10-min TTL) → `HELD` reservation |
| (admin) `POST /fulfillment/slots/generate` | create windows for a date range |
| (admin) `GET /fulfillment/slots/utilization` | capacity utilization per hub+date |
| (admin) `POST /fulfillment/slots/sweep` | release expired HELD holds (TTL backup) |

## Orders (`/orders` — customer, authenticated)

| Endpoint | Purpose |
| --- | --- |
| `GET /orders` | my orders (paginated, filter by status) |
| `GET /orders/:id` | order + items + full timeline |
| `GET /orders/:id/timeline` | status history (`created → … → delivered`) |
| `POST /orders/:id/cancel` `{reason, reasonText}` | reverse saga: restore stock → release slot → refund |

## Fulfillment & delivery (`/fulfillment` — ADMIN / SUPER_ADMIN / PICKER / RIDER)

| Endpoint | Roles | Purpose |
| --- | --- | --- |
| `GET /fulfillment/orders` | ADMIN | all orders (ops view) |
| `POST /fulfillment/orders/:id/pick` | PICKER | `CONFIRMED → PICKING` |
| `POST /fulfillment/orders/:id/pack` | PICKER | `PICKING → PACKED` |
| `POST /fulfillment/orders/:id/dispatch` | RIDER | `PACKED → OUT_FOR_DELIVERY`, assign rider |
| `POST /fulfillment/orders/:id/deliver` `{podType: otp\|photo\|signature, podValue}` | RIDER | capture POD → `DELIVERED` (OTP stored hashed) |
| `POST /fulfillment/orders/:id/delivery-failed` | RIDER | retryable failure; cancels after max retries |
| `POST /fulfillment/orders/:id/retry-delivery` | RIDER | redispatch after failure |

## Returns (`/returns` — customer + ops)

Two flows (doc §6): `pickup_qc` (pickup → QC → refund) for non-perishables,
`instant_claim` (auto-approve + instant wallet refund, fraud-guarded) for perishables.

| Endpoint | Roles | Purpose |
| --- | --- | --- |
| `POST /returns` `{orderId, claimType, reason, items[]}` | customer | eligibility check + create (eligibility response when not eligible) |
| `GET /returns` / `GET /returns/:id` | customer | my returns / detail |
| `POST /returns/:id/pickup` | PICKER/ADMIN | `APPROVED → PICKED_UP` |
| `POST /returns/:id/qc` `{decision: pass\|fail}` | PICKER/ADMIN | QC decision → refund / reject |

## Wallet & refunds (`/wallet` — customer; `/fulfillment/refunds` — ADMIN)

| Endpoint | Purpose |
| --- | --- |
| `GET /wallet` | balance (wallet is the default instant refund destination) |
| `GET /wallet/transactions` | append-only ledger |
| `GET /wallet/refunds` | my refunds (destination, status) |
| `GET /fulfillment/refunds` (ADMIN) | all refunds |
| `POST /fulfillment/refunds` (ADMIN) `{orderId, amount, reason, destination}` | manual refund (idempotencyKey dedupes) |
| `POST /fulfillment/reconcile/payments` (ADMIN) | sweep stale PENDING gateway payments → FAILED (order compensated); wallet PENDING payments are first **healed** if their debit already exists, then cancelled only if truly unrecoverable |
| `GET /wallet/admin/reconcile` (SUPER_ADMIN) | **Phase 16** — wallet ledger reconciliation: `Σ Wallet.balance` vs the tenant's `customer_wallet_liability` entry sum → `{wallets, walletTotalPaise, ledgerPaise, differencePaise, balanced, repaired}` (read-only) |
| `POST /wallet/admin/reconcile/repair` (SUPER_ADMIN) | **Phase 16** — post **one** `wallet_backfill` journal for the difference (signed: wallet ahead → DR `gateway_clearing` / CR liability; behind → the reverse) + a `wallet_backfill` audit event, then re-report the post-repair state. No-op when balanced. The backfill amount is **not re-derivable** from any aggregate, so `replay` deliberately refuses to replay it (`WALLET_BACKFILL_NOT_REPLAYABLE`) — the audit event records what was backfilled and why |

**Phase 16 — the wallet IS a ledger account.** Before this phase the customer
wallet moved without a journal for top-ups (and goodwill credits), so the
books and the wallets could drift apart silently. Now every wallet movement
has exactly one journal owner:

- **topup** → event `wallet_topup` (key `wallet_topup:wallet_txn:{txnId}`) then
  `wallet_topup` journal — DR `gateway_clearing` / CR `customer_wallet_liability`,
  paise-exact from the `WalletTransaction`.
- **goodwill credit** → same kind, DR `wallet_goodwill_expense` / CR liability
  (no gateway money behind a goodwill credit).
- **refund credit** → journaled by `refund_issued` (`postRefund`), **no** new
  journal from the wallet service — no double count.
- **order payment debit** → journaled by the sale journal
  (`DR customer_wallet_liability`), unchanged.

The integrity report gained a **Wallet** check
(`checks.wallet`: `ok === balanced`); the ledger page shows the row plus a
deliberate *Backfill ledger from wallet balances* action when the two disagree.
A top-up that crashes between the event and the journal is healed by the
normal `replay` (the journal re-derives from the `WalletTransaction`).

## Phase 3.5 — policies, rider app, forecasting, payments webhooks

### Pricing & refund policies (`/policies` — ADMIN)

| Endpoint | Purpose |
| --- | --- |
| `GET /policies/delivery-fee` · `POST /policies/delivery-fee` · `PATCH /policies/delivery-fee/:id` | per-tenant delivery fee policy (baseFee, freeDeliveryThreshold, expressSurgeMultiplier, distanceFeePerKm; one active at a time) |
| `GET /policies/tax` · `POST /policies/tax` | per-CATEGORY GST policy `{categoryId, gstSlabPct, hsnCode}` (legal classification) |
| `GET /policies/coupons` · `POST /policies/coupons` | coupon CRUD `{code, discountType: flat\|percent, value, minCartValue, maxDiscountCap, usageLimitPerCustomer, isPlatformWide}` |
| `GET /policies/refund` · `PATCH /policies/refund` | `TenantRefundPolicy {refundDeliveryFeeWhen: never\|full_order_return_only\|always, refundFeePct}` |
| `GET /policies/coupons/preview?code=&cartSubtotal=` | customer-facing coupon validation (used by cart) |

### Rider app (`/rider` — RIDER role)

| Endpoint | Purpose |
| --- | --- |
| `GET /rider/deliveries?status=` | my assignments (filter by status) |
| `POST /rider/availability {status: available\|busy\|offline}` | rider availability toggle |
| `POST /rider/deliveries/:id/accept` | `PENDING_ACCEPT → ACCEPTED` (45 s TTL window) |
| `POST /rider/deliveries/:id/reject {reason}` | reassign immediately to next rider, rejecter excluded (capped → manual) |
| `POST /rider/deliveries/:id/arrive-hub` | `ACCEPTED → AT_HUB` |
| `POST /rider/deliveries/:id/depart {package_verified: true}` | `AT_HUB → IN_TRANSIT` + order `OUT_FOR_DELIVERY` (400 `PACKAGE_NOT_VERIFIED` without verification) |
| `POST /rider/deliveries/:id/arrive` | `IN_TRANSIT → ARRIVED` |
| `POST /rider/deliveries/:id/complete {pod_type, pod_reference}` | `ARRIVED → DELIVERED` (OTP stored hashed) |
| `POST /rider/deliveries/:id/fail {fail_reason}` | delivery failure → retry / auto-cancel after max retries |

### Slot forecasting (`/fulfillment` — ADMIN)

| Endpoint | Purpose |
| --- | --- |
| `POST /fulfillment/slots/generate {fromDate, toDate, forecast?: true}` | nightly batch: forecast capacity per hub/day/window (`forecast:true`), else flat capacity |
| `POST /fulfillment/forecast {hubId, date, pickerCount?, riderCount?, dryRun?}` | compute + (unless dryRun) persist one hub-day forecast |
| `GET /fulfillment/forecast/upcoming?days=7` | batch forecast next N days for all active hubs |
| `GET /fulfillment/forecast/history?hubId=` | fulfillment-time history (self-correction inputs) |
| `POST /fulfillment/assignments/sweep?limit=` | expire stale PENDING_ACCEPT rider assignments → auto-reassign |
| `GET /fulfillment/payments` · `GET /fulfillment/payments/:id` | payment reads (ADMIN) |
| `POST /fulfillment/payments/mock/force-pending` `{enabled}` | **dev-only** (400 outside `NODE_ENV=development`): flips the in-process mock gateway between sync and async (pending) charge modes at runtime — lets the awaiting-payment storefront flow (banner + 5s poll) be exercised on the live stack without `MOCK_PAYMENT_PENDING` or real keys (ADMIN) |

### Payment webhooks (raw body — no tenant header, signature-verified)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/payments/webhook/razorpay` | Razorpay events: `payment.captured`/`order.paid` → confirm payment + finalize order (inventory commit → CONFIRMED); `payment.failed` → mark failed + cancel pending order. HMAC-SHA256 of the RAW body verified against `x-razorpay-signature` (timing-safe) |
| `POST /api/v1/payments/webhook/mock` `{gatewayOrderId?}` | dev/test twin of the razorpay webhook (works without real keys) |

Async checkout contract: with razorpay configured (or mock `forcePending`), `POST /cart/checkout`
returns `{...order, paymentPending: true, gatewayOrderId, provider}` and the order stays
`PAYMENT_PENDING` until the gateway webhook confirms — inventory is committed only after capture.

## Phase 4 — Admin dashboard (`/admin` — ADMIN / SUPER_ADMIN)

Every admin write appends an audit row; all lists are paginated + tenant-scoped.
Catalog/write-heavy mutations stay on their Phase-2/3 surfaces; this is read-first +
write-controlled ops.

### Products

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/products?search=&categoryId=&status=&health=&lowStockThreshold=` | shared master catalog joined via tenant listings + inventory |
| `GET /admin/products/:masterId` | master + listings + per-listing inventory + price history |
| `GET /admin/products/export.csv` | same filters → RFC-4180 CSV (UTF-8 BOM) |

### Inventory

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/inventory/summary` | total SKUs · in/low/out of stock · reserved · on-hand value |
| `GET /admin/inventory?health=&search=&categoryId=` | filterable stock view + restock suggestion |
| `GET /admin/inventory/ledger/:listingId` | current state + append-only `inventoryadjustments` |
| `POST /admin/inventory/:listingId/adjust` `{type: restock\|shrinkage\|audit_correction\|return_restock, qtyChange≠0, reason}` | atomic version-locked adjust (qtyAfter ≥ 0 or 409) + ledger row + `TenantProduct.stockQty` refresh |
| `GET /admin/inventory/export.csv` | snapshot CSV |

### Hubs & slots

| Endpoint | Purpose |
| --- | --- |
| `POST /admin/hubs` · `GET /admin/hubs` · `PATCH /admin/hubs/:id` | hub CRUD (code unique per tenant) |
| `POST /admin/hubs/:id/pincodes` `{add[], remove[]}` | serviceable pincode management (syncs `ServiceablePincode`) |
| `POST /admin/hubs/:id/toggle` `{isActive}` | activate / deactivate |
| `GET /admin/slots?hubId=&from=&to=` | slot grid: effective capacity (override-aware), reserved, remaining, status |
| `POST /admin/slots/:id/override` `{manualCapacity, reason}` | intraday override; atomic gate uses `$ifNull(manual, total)`; 409 if < reserved |
| `POST /admin/slots/:id/status` `{status: open\|closed, reason}` | close / reopen |
| `GET /admin/slots/utilization?hubId=&from=&to=` | daily fill-rate grid |

### Orders

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/orders?status=&from=&to=&hubId=&paymentMethod=&minTotal=&maxTotal=&search=` | admin order list (rich filters) |
| `GET /admin/orders/:id` | items (+tax/discount) · immutable charge breakdown · timeline · payments · refunds · returns · delivery assignment · fulfillment task |
| `GET /admin/orders/export.csv` | filtered CSV |

### Users & staff

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/users?role=&status=&search=&from=&to=` | users list (password hash stripped) |
| `GET /admin/users/:id` | profile + addresses + wallet + order summary + recent orders/returns |
| `POST /admin/users/staff` `{role: admin\|picker\|rider, firstName, phone\|email, password?, hubId?}` | create staff — **cannot create super_admin** |
| `PATCH /admin/users/:id/status` `{status}` | block/activate — no self-modify, cannot touch super_admin |
| `PATCH /admin/users/:id/role` `{role}` | role change — cannot grant/alter super_admin |
| `GET /admin/users/riders/stats?from=&to=&riderId=` | per-rider delivered, rejections, avg delivery seconds (from `fulfillmentTimeLogs`) |
| `GET /admin/users/export.csv` | users CSV |

### Analytics (exact formulas — see `uploads/admin_dashboard_api_analytics.md` §5)

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/analytics/dashboard?from=&to=&hubId=` | KPIs (ordersCreated, gmv, netRevenue = gmv − refunds, aov, delivered, cancellationRate, returnsRate, new/repeat customers) + daily series + payment/slot splits |
| `GET /admin/analytics/products?from=&to=&limit=` | top products by qty/revenue (excl. cancelled) |
| `GET /admin/analytics/categories?from=&to=` | category performance |
| `GET /admin/analytics/hubs?from=&to=` | per-hub orders/gmv/delivered |
| `GET /admin/analytics/slots?from=&to=&hubId=` | fill-rate trend + overbooked count |
| `POST /admin/analytics/rebuild` `{from, to}` | idempotent nightly-rollup hook (upserts `analyticsdailies`) |
| `GET /admin/analytics/export.csv?from=&to=` | daily series (rollup-first) |

## Phase 4b — Notifications, exports & maintenance (blueprint: `uploads/ops_tooling_notifications_exports.md`)

**Provider abstraction**: default `notifications.provider = console` (logs + marks sent).
Real FCM / APNs / SMTP / Twilio slot in behind `notificationProvider.service.js`
(`sendPush` / `sendEmail` / `sendSms`) with env config — no live credentials wired in this pass.
All sends are **outbox**: one `notifications` row per (user × template × dedupeKey), queued
`pending` in the request path, actually sent by the worker (`processPending`). Templates are
**data**: bodies live in `notificationtemplates` with `{{placeholders}}`, admin-editable,
per-channel variants, platform-default fallback (`tenantId: null`).

### Customer devices + inbox (`/users/me/*` — authenticated)

| Endpoint | Purpose |
| --- | --- |
| `GET /users/me/devices` | push devices for this user |
| `POST /users/me/devices` `{provider: fcm\|apns, platform, pushToken, metadata?}` | register (duplicate token → refreshed, same row; max 10 active devices) |
| `DELETE /users/me/devices/:id` | soft-disable a device |
| `GET /users/me/notifications?status=&page=&limit=` | inbox (latest first) |
| `POST /users/me/notifications/:id/read` | mark read (`status → read`, `readAt` set) |

### Admin — templates, log, manual send, worker (`/admin` — ADMIN / SUPER_ADMIN)

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/notifications/templates?code=&isActive=` | tenant + platform-default templates |
| `POST /admin/notifications/templates` `{code, eventType?, channels[], content{push?,email?,sms?}, priority?, isActive?, effectiveFrom?, effectiveTo?}` | create (tenant code unique → 409) |
| `PATCH /admin/notifications/templates/:id` | update (bumps `version`; edits never rewrite history) |
| `DELETE /admin/notifications/templates/:id` | deactivate |
| `GET /admin/notifications?status=&userId=&from=&to=&page=&limit=` | notification log (admin view) |
| `POST /admin/notifications/send` `{templateCode, userId, orderId?, data{}, channels?, dedupeKey?}` | manual enqueue; dedupeKey duplicate → 200 + `meta.reason: duplicate` |
| `POST /admin/notifications/process` `{limit?}` | run the sending worker (pending → sending → sent/failed, per-channel `channelStatus`, attempts/lastError) |

**Event → notification consumer** (registered at boot in `createApp`): catalog outbox events
`order_confirmed`, `order_out_for_delivery`, `rider_arrived`, `order_delivered`,
`order_cancelled`, `payment_failed`, `refund_completed`, `return_refund_initiated` →
`dispatch()` with order-enriched payload (`firstName`, `orderNumber`, `total`, `slot`).
Channels intersect: template channels ∩ reachable channels (push needs an active device,
sms/email need verified phone/email). Missing template / no reachable channel → skip silently.

### Admin — scheduled CSV/BI exports

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/exports?status=&type=&page=&limit=` | export job list |
| `POST /admin/exports` `{type: analytics_daily\|orders\|inventory\|products\|users, params{from,to,hubId,query?}, scheduledFor?}` | create job — idempotent on `jobKey` (duplicate → 200, same job) |
| `GET /admin/exports/:id` | job + artifact metadata (rowCount, sizeBytes) |
| `POST /admin/exports/:id/run` | render now → artifact (reuses Phase-4 `csv()` renderers) |
| `GET /admin/exports/:id/download` | artifact as `text/csv` (UTF-8 BOM, RFC-4180) |
| `POST /admin/exports/run` `{limit?}` | run all due pending jobs |

### Admin — nightly maintenance pipeline

| Endpoint | Purpose |
| --- | --- |
| `POST /admin/maintenance/nightly` `{forecastDays?, analyticsDays?, exportLimit?, eventLimit?, notificationLimit?}` | step order: slot forecast → analytics rollups → create `analytics_daily` export jobs → run due exports → drain catalog events (notifications fire) → process pending notifications. Every step isolated + idempotent; `scripts/nightly-job.mjs` equivalent for cron. |

## Error codes (subset)

| Code | Meaning |
| --- | --- |
| `VALIDATION_ERROR` | Joi rejected the payload; `details` has field-level messages |
| `AUTH_REQUIRED` / `INVALID_TOKEN` / `TOKEN_EXPIRED` | access-token problems |
| `INVALID_REFRESH_TOKEN` / `REFRESH_TOKEN_EXPIRED` | refresh-token problems |
| `TENANT_MISMATCH` | token tenant ≠ request tenant |
| `ACCOUNT_BLOCKED` / `ACCOUNT_DELETED` | user cannot log in |
| `OTP_*` | OTP lifecycle errors |
| `ADDRESS_LIMIT_REACHED` / `ADDRESS_NOT_FOUND` | address errors |
| `DUPLICATE_KEY` | unique-index conflict (409) |
| `DUPLICATE_SKU` / `DUPLICATE_BARCODE` / `POSSIBLE_DUPLICATE` | master duplicate detection (409) |
| `VERSION_CONFLICT` / `VERSION_REQUIRED` | optimistic-lock violations (409) |
| `CATEGORY_ATTRIBUTE_ERROR` | attributeSchema compliance failed (400) |
| `INSUFFICIENT_STOCK` / `INSUFFICIENT_RESERVATION` | inventory reserve/release failures (409) |
| `LISTING_EXISTS` / `INVALID_STATUS_TRANSITION` | listing rules (409/400) |
| `REQUEST_ALREADY_REVIEWED` / `NOT_PENDING_REVIEW` | change-request state conflicts (409) |
| `PRICE_CHANGED` | cart revalidation diff not yet confirmed (409, `details.diffs`) |
| `CART_EMPTY` / `CART_ITEM_LIMIT` / `CART_ITEM_NOT_FOUND` | cart rules (400/409/404) |
| `RESERVATION_INVALID` / `RESERVATION_EXPIRED` / `RESERVATION_NOT_HELD` | slot-hold rules (409) |
| `SLOT_FULL` | atomic capacity lock hit (409) |
| `SLOT_CUTOFF_PASSED` / `SLOT_UNAVAILABLE` | slot ordering-window rules (409) |
| `PAYMENT_FAILED` | gateway declined (409, `details.orderId`) |
| `PAYMENT_NOT_FOUND` | webhook could not match gateway ref to a payment (400/404) |
| `WEBHOOK_SIGNATURE_INVALID` | razorpay HMAC-SHA256 verification failed (401) |
| `STOCK_UNAVAILABLE` | inventory lost the race post-payment → auto refund (409) |
| `INVALID_ORDER_TRANSITION` / `CANCELLATION_NOT_ALLOWED` | order state-machine violations (400/409) |
| `PACKAGE_NOT_VERIFIED` | rider `depart` without `package_verified: true` (400) |
| `ASSIGNMENT_EXPIRED` / `ASSIGNMENT_NOT_YOURS` | rider accept-window / wrong-rider (409/400) |
| `COUPON_*` | coupon validation (invalid / expired / min-cart not met / cap reached) |
| `POD_REQUIRED` / `POD_INVALID` | proof-of-delivery capture errors (400) |
| `INVALID_QTY_CHANGE` / `INVALID_ADJUSTMENT_TYPE` | inventory adjust payload (400) |
| `INVALID_QTY` | adjust would make stock negative / concurrent version conflict (409) |
| `CAPACITY_BELOW_RESERVED` | slot override below already-reserved units (409) |
| `DUPLICATE_HUB_CODE` | hub code collision (409) |
| `INVALID_STAFF_ROLE` / `SELF_MODIFICATION` / `FORBIDDEN` | staff create / self-edit / super_admin guards (400/403) |
| `RETURN_NOT_FOUND` / `INVALID_RETURN_TRANSITION` | return-request rules (404/409) |
| `REFUND_FAILED` / `REFUND_NOT_FOUND` | refund processing errors (409/404) |
| `ROUTE_NOT_FOUND` | unknown route (404) |
| `RATE_LIMITED` | too many requests (429) |

## Phase 5 — Multi-tenant marketplace (`/marketplace` — blueprint: `uploads/multi_tenant_marketplace.md`)

Tenant self-service + vendor onboarding + per-tenant billing + cross-tenant analytics.
Marketplace mode = the existing `Tenant.features.marketplaceEnabled` flag (pro/business
plans enable it; free does not). Store-owner routes resolve the tenant from the owner's
token when no `x-tenant-id` header is sent (the token IS the store).

### Public (no auth)

| Endpoint | Purpose |
| --- | --- |
| `GET /marketplace/plans` | active plan catalog (free/pro/business, price + commission bps + marketplace flag) |
| `GET /marketplace/stores?search=&page=&limit=` | store discovery (published stores only) |
| `GET /marketplace/stores/:slug` | storefront: branding + theme + vendor products (only when marketplace mode) + vendors |
| `POST /marketplace/tenants/register` `{name, slug, plan?, contactEmail?, owner{firstName, lastName, email, password}}` | create store → tenant + owner admin (never super_admin) + trial subscription + owner auto-login tokens; slug unique/reserved → 409; owner email starts UNVERIFIED (see verify-email); ALL-OR-NOTHING (one transaction on replica sets, compensating cleanup on standalone mongod — a failed attempt never orphans a tenant or wedges the slug) |

### Vendor (auth; role `vendor` — granted ONLY by an approved application)

| Endpoint | Purpose |
| --- | --- |
| `POST /marketplace/vendor/apply` `{businessName, slug?, contactPhone?, gstin?, categories[], city?}` | any authenticated user; one application per user (re-submit updates) |
| `GET /marketplace/vendor/my-application` | my application status (+ vendor profile once approved); nulls when never applied |
| `GET /marketplace/vendor/me` | vendor profile + stats (gmv/orders from `orderitems.vendorId`) + commissionRateBps |
| `PATCH /marketplace/vendor/me` `{businessName?, city?, categories?, gstin?, payout{...}}` | update business info / payout metadata |
| `GET /marketplace/vendor/products?status=` | my products |
| `POST /marketplace/vendor/products` `{title, type, categoryId, brandId?, skuGlobal, description?, tags?, ...}` | create → status `pending_review`, vendorId attributed |
| `PATCH /marketplace/vendor/products/:id` | edit while `pending_review` (locked after review) |

### Store owner (auth; tenant `admin`/`super_admin`)

| Endpoint | Purpose |
| --- | --- |
| `GET /marketplace/store` | my store: branding + plan + tenant subscription |
| `PATCH /marketplace/store` `{name?, logoUrl?, theme?, tagline?, description?, bannerUrl?, socialLinks?, isPublished?}` | update branding; publish flips onboarding → active, refused with `STORE_NOT_READY` while blockers (incl. unverified owner email) remain |
| `GET /marketplace/store/subscription` | live tenant subscription (trial/active/past_due) — the store's seat on its plan, NOT customer recurring orders |
| `PATCH /marketplace/store/plan` `{planCode}` | change plan (creates a tenant subscription for existing stores; inactive codes → 409 `PLAN_INACTIVE`); mid-period change → pro-rata `pendingAdjustment` on next invoice |
| `GET /marketplace/store/invoices?status=` · `GET /marketplace/store/invoices/:id` | my invoices (frozen line items) |
| `POST /marketplace/store/invoices/:id/pay` | owner self-pay (tenant-scoped: other stores' invoices 404); sync rail → `paid`, async rail → `pending` + gateway order, confirmed by webhook |
| `GET /marketplace/store/usage` | plan limits + live usage (hubs/listings/staff) for the billing-page meters |
| `POST /marketplace/store/verify-email/request` · `POST /marketplace/store/verify-email/confirm` `{code}` | owner-email OTP; publishing is blocked until verified |
| `GET /marketplace/store/vendors` | vendors whose products are synced into this store |
| `POST /marketplace/store/vendors/:vendorId/sync` | **(marketplace mode required)** idempotently create TenantProduct rows for the vendor's approved, marketplace-listed products |

### Platform operator (auth; `super_admin`)

| Endpoint | Purpose |
| --- | --- |
| `GET /marketplace/admin/vendor-applications?status=` | application queue |
| `POST /marketplace/admin/vendor-applications/:id/review` `{decision: approve\|reject, note?}` | approve → vendor profile + `vendor` role |
| `GET /marketplace/admin/vendors` · `GET /marketplace/admin/vendors/:id` | vendor registry + detail (stats, products) |
| `PATCH /marketplace/admin/vendors/:id` `{commissionRateBps?, status?}` | adjust commission / suspend |
| `POST /marketplace/admin/vendor-products/:id/review` `{decision, note?}` | approve → `marketplaceListed=true` (store sync can then route it) |
| `GET /marketplace/admin/tenants?plan=&status=&search=` | every store + plan + subscription status |
| `GET /marketplace/admin/plans` · `POST /marketplace/admin/plans` · `PATCH /marketplace/admin/plans/:id` | plan catalog CRUD (pricing is data) |
| `GET /marketplace/admin/billing/invoices?status=&tenantId=` | all invoices |
| `POST /marketplace/admin/billing/cycle` `{tenantId?, period?}` | billing cycle (idempotent per period) |
| `POST /marketplace/admin/billing/invoices/:id/pay` | mock payment (provider abstraction) → paid + paymentRef |
| `POST /marketplace/admin/billing/invoices/:id/void` | void draft/open invoice |
| `POST /marketplace/admin/billing/overdue-sweep` | overdue invoices → overdue; subscriptions → past_due |
| `GET /marketplace/admin/analytics/dashboard?from=&to=` | cross-tenant KPIs (gmv, orders, netRevenue, commissions, mrr, active/new tenants, new vendors, byPlan) |
| `GET /marketplace/admin/analytics/top-tenants?from=&to=` · `.../top-vendors` | bounded rankings |
| `POST /marketplace/admin/analytics/rebuild` `{from, to}` | idempotent `platformdailies` upsert |
| `POST /marketplace/admin/nightly` | platform-wide marketplace pass: billing → overdue sweep → rollup → drain → notify (idempotent) |

### Billing webhooks (no login; raw body + HMAC, mounted before `express.json()`)

| Endpoint | Purpose |
| --- | --- |
| `POST /marketplace/billing/webhook/razorpay` | async capture confirmations; verify-then-parse, idempotent + amount-checked via `billingService.applyBillingWebhook` (acks 200 except bad signature) |
| `POST /marketplace/billing/webhook/mock` | same pipeline for the mock rail (`{gatewayOrderId, amountPaise?}` + `x-mock-signature`) |

## Media uploads (`/media` — authenticated; blueprint: `uploads/media_upload.md`)

Presigned-upload pipeline: **presign → direct PUT → confirm**. The browser never sees storage credentials. Provider is pluggable: `local` (dev default; served at `/media/local`) or `s3` (`STORAGE_PROVIDER=s3`, presigned PUT to S3). All routes are tenant-scoped via the session tenant.

| Endpoint | Purpose |
| --- | --- |
| `POST /media/presign` `{filename, contentType, size, purpose}` | validate type+size allowlist → create `pending` asset + return `{asset, uploadUrl, method, headers, expiresIn}`. Local returns same-origin `/api/v1/media/upload?key=…`; S3 returns a presigned PUT (content-type only) |
| `PUT /media/upload?key=…` | **(local only)** raw-body store (route mounts `express.raw({limit:'300mb'})`); key prefix must match caller tenant |
| `POST /media/:id/confirm` | verify (S3 `HeadObject` / local size + magic bytes) → `ready`, else `failed` + `MEDIA_VERIFY_FAILED` |
| `GET /media?purpose=&type=&status=&page=&limit=` | tenant-scoped gallery `{items, meta:{page,limit,total,totalPages,hasMore}}` |
| `GET /media/:id` | single asset (tenant-scoped) |
| `DELETE /media/:id` | soft delete (`deletedAt`), removes blob fire-and-forget |

Media asset: `{id, tenantId, uploadedBy, purpose, type, mimeType, ext, sizeBytes, key, bucket, url, status: pending\|ready\|failed\|deleted, meta, createdAt}`. Key: `{tenantId}/{purpose}/{YYYYMM}/{uuid}.{ext}`.

**Purpose → type map:** `product_image|category_image|brand_logo|store_logo|store_banner → image`; `product_video → video`. **Limits:** images ≤ 10 MB, videos ≤ 250 MB; ext allowlists enforced at sign time, magic bytes (jpeg/png/gif/webp/avif/mp4/mov) sniffed at confirm time. **Errors:** `MEDIA_TYPE_NOT_ALLOWED`, `MEDIA_TOO_LARGE`, `BAD_MEDIA_PURPOSE`, `MEDIA_VERIFY_FAILED`, `MEDIA_NOT_FOUND`, `KEY_TENANT_MISMATCH`, `LOCAL_UPLOAD_DISABLED`.

**Config:** `STORAGE_PROVIDER`, `LOCAL_STORAGE_DIR` (default `backend/storage/local`), `MEDIA_PRESIGN_EXPIRY_SECONDS` (900), `S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_PUBLIC_BASE_URL`, `MEDIA_MAX_IMAGE_BYTES` (10485760), `MEDIA_MAX_VIDEO_BYTES` (262144000). Image/logo/banner fields across catalog + storefront accept relative URIs (`allowRelative`) so local-provider URLs (`/media/local/…`) persist; S3 returns absolute URLs.

## Phase 10 — money audit backbone (blueprint: "Follow the Money")

Trace + audit + integrity. Every money object (order, payment, journal, refund,
payout batch, webhook audit row) carries the request's `traceId`; a
request's inbound `x-trace-id` is adopted (regex-validated) or a new one is
minted and echoed in the `x-trace-id` response header. Full design:
`docs/AUDIT_ARCHITECTURE.md`.

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/ledger/integrity` | SUPER_ADMIN | read-only system integrity report; optional `?tenantId=` scopes the per-tenant checks |
| `POST` | `/ledger/integrity/replay` | SUPER_ADMIN | re-derive missing journals from the event store + restore missing audit rows; idempotent; body `{limit?}` (default 200) |
| `GET` | `/admin/integrity` | ADMIN | same report, always tenant-scoped to the caller's tenant |
| `GET` | `/wallet/admin/reconcile` | SUPER_ADMIN | **Phase 16** — wallet↔`customer_wallet_liability` reconciliation (read-only) |
| `POST` | `/wallet/admin/reconcile/repair` | SUPER_ADMIN | **Phase 16** — post a signed `wallet_backfill` journal for the difference (one journal, audited, not replayable) |
| `GET` | `/admin/traces/:traceId` | ADMIN | the full money chain for one trace, time-ordered (order facts, status history, payments, webhook audit rows, journals, payout transitions, domain events); 404 `TRACE_NOT_FOUND` when the id resolves to nothing |

**Integrity report shape:** `{ generatedAt, scope: 'platform'|tenantId, overall: 'ok'|'drift', checks: { ledger: { trial{balanced,differencePaise,entries}, balances{checked,drifted,ok}, eventJournalCoverage{eventsScanned,missingJournals,missingEvents,samples,ok}, ok }, searchIndex{indexedDocuments,listings,missing,error,ok}, slots{checked,overReserved,samples,ok}, payments{total,processed,duplicate,mismatch,ignored,mismatches,ok}, payouts{batchesChecked,missingJournals,ok}, events{total,byKind,newestOccurredAt,ok}, notifications{pending,oldestPendingAgeMs,deadLetters,ok} } }`.

**Replay response:** `{ scope, journalsReposted, eventsRestored, failed, errors[] }`.

**Trace chain row:** `{ kind: 'order.created'|'order.status.*'|'order.paid'|'payment.created'|'journal.*'|'event.*'|'payout.*', at, detail?, paise? }` plus `{ traceId, orderCount, events }`.

## Phase 11 — tamper-evident chain + fiscal period close

Every domain event is hash-chained per tenant
(`hash = sha256(prevHash|canonical-content)`, genesis `'0'×64`, tail anchor
in the separate `auditchains` collection). A content edit, a deleted row or a
lost tail all surface as a named break in the integrity report
(`hash_mismatch`, `broken_front`, `broken_link`, `tail_missing`,
`tail_mismatch`). **Breaks are never auto-healed** — the only re-link is a
deliberate, audited `rebuild-chain` that appends a `chain_rebuilt` fact
event. Full design: `docs/AUDIT_ARCHITECTURE.md` (Part 2).

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST` | `/ledger/integrity/replay-chain` | SUPER_ADMIN | anchor **unanchored** rows (crashed appends) in seq order; idempotent; body `{limit?}` (default 500) → `{ anchored, failed[] }` |
| `POST` | `/ledger/integrity/rebuild-chain` | SUPER_ADMIN | deliberate manual re-link: re-hash the whole chain in seq order (seqs preserved), reset the anchor, append a `chain_rebuilt` fact → `{ relinked, tailHash }`. Use after restoring rows from the source system |
| `GET` | `/ledger/periods` | SUPER_ADMIN | fiscal period list (all tenants; `?tenantId=` scopes) |
| `GET` | `/ledger/periods/:periodKey` | SUPER_ADMIN | **period report derived from the journal** for `YYYY-MM`: `{ periodKey, state, closedAt, reopenedAt, journals, grossCapturedPaise, refundsPaise, netCapturedPaise, payoutsInitiatedPaise, payoutsReversedPaise, byKind, periodBalanced }` |
| `POST` | `/ledger/periods/:periodKey/close` | SUPER_ADMIN | close the month (allowed mid-month — operator freeze); appends a chained `period_closed` event → `{ periodKey, state }` |
| `POST` | `/ledger/periods/:periodKey/reopen` | SUPER_ADMIN | reopen; appends a chained `period_reopened` event; unblocks posting → `{ periodKey, state }` |
| `GET` | `/admin/periods` | ADMIN | tenant-scoped period list |
| `GET` | `/admin/periods/:periodKey` | ADMIN | tenant-scoped period report (same shape) |

**Guard:** `ledger.post()` rejects any **new** journal whose `occurredAt`
falls inside a closed period with **409 `PERIOD_CLOSED`** (`details.periodKey`).
Idempotent re-posts (replay of an already-journaled event) pass, so
self-healing works across a closed boundary.

**Integrity report additions:** `checks.auditChain: { eventsVerified,
unanchored, breaks: [{ seq, type, idempotencyKey? }], ok }`.

## Phase 12 — the cash gate (PSP settlement)

Settlement is a first-class, **chained** money event: ingesting the PSP
report appends a `psp_settled:order:{id}` domain event *before* posting the
`psp_settled` journal (DR `bank` / CR `gateway_clearing`). It is covered by
the event↔journal drift check in both directions (a lost journal is
re-posted by replay from the event's exact amount; a lost event is restored
from the journal). Full design: `docs/AUDIT_ARCHITECTURE.md` (Part 3).

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/payouts/admin/settlements` | SUPER_ADMIN | cash-gate summary: `{ gatewayClearingPaise, bankPaise, settledOrders, settledPaise, lastSettledAt, paidOrders, unsettledOrders, unsettledPaise, unsettledSample[{orderNumber,totalPaise,paidAt}], policy{requirePspSettlement} }` |
| `POST` | `/payouts/admin/settlements/ingest` | SUPER_ADMIN | body `{ rows: [{ orderNumber | orderId, amount? | amountPaise?, utr?, settledAt? }], reference? }` → `{ rows, posted, skipped, unmatched: [{order, reason}] }`. Idempotent per order. Rows for cancelled/unpaid orders come back unmatched, never guessed |

**Gate:** with `PayoutPolicy.requirePspSettlement` true (toggle on the
Payouts console), the eligibility sweep only promotes a line to `eligible`
when its order has a `psp_settled` journal — vendors are paid for an order
only after the customer's cash has genuinely reached the platform's bank.
The sweep reports `blocked` for gated lines.

## Phase 13 — statutory deposits (TCS/TDS to the government)

The closing entry for the withholdings: payouts credit `tcs_payable` /
`tds_payable`; these endpoints pay the government (DR payable / CR bank).
Balance-guarded (you cannot deposit more than you withheld), UTR-mandatory,
event-first + chained, reverts journaled never deleted. Full design:
`docs/AUDIT_ARCHITECTURE.md` (Part 4).

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/payouts/admin/statutory` | SUPER_ADMIN | `{ tcs, tds: { payableBalancePaise, depositedPaise, netDepositedPaise, revertedPaise, deposits, outstandingPaise }, recentDeposits[{ id, statute, amountPaise, utr, status, createdAt, revertReason }] }` |
| `POST` | `/payouts/admin/statutory/deposit` | SUPER_ADMIN | body `{ statute: 'tcs'\|'tds', amount \| amountPaise, utr (min 3 chars), reference? }` → 201 the deposit. **409 `STATUTORY_OVER_DEPOSIT`** when the amount exceeds the payable balance (details quote it) |
| `POST` | `/payouts/admin/statutory/:id/revert` | SUPER_ADMIN | body `{ reason (min 3 chars) }` → posts the mirror journal (DR bank / CR payable), marks the deposit reverted with the reason. 409 `STATUTORY_ALREADY_REVERTED` |

Both journal kinds (`statutory_deposit`, `statutory_deposit_reverted`) are
chained and covered by the event↔journal drift check in both directions.

## Phase 14 — bank statement reconciliation (the egress truth)

The bank statement is the **independent source of truth for money out**: a
PAID payout can be returned by the bank days later (NSF, closed account) and
the provider will never say so. These endpoints ingest signed statement lines
and match them **UTR-exact only** — nothing is ever fuzzy-matched:

| bank line | batch with that UTR | result |
|---|---|---|
| debit (−) | PROCESSING | the money moved → `markPaid` (resolves an ambiguous submission) |
| debit (−) | PAID | `confirmed_paid` — the bank agrees (audit only, no state change) |
| credit (+) | PAID | **bank return** → `markReversed` (journal unwound, lines freed) |
| anything else | — | `unmatched` — queued, visible, never guessed |

Money moves only through the normal payout service methods (chained events,
balanced journals); the statement only *decides*. Re-ingesting the same
`{statementRef, lineNo}` is a no-op (unique index). Each ingestion appends one
chained `bank_statement_ingested` fact (not a journal kind). Full design:
`docs/AUDIT_ARCHITECTURE.md` (Part 5).

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/payouts/admin/statement` | SUPER_ADMIN | `{ total, confirmed, returned, unmatched, queued[{ statementRef, lineNo, utr, amountPaise, description, createdAt }], recentMatches[...] }` (`?limit=` caps the lists) |
| `POST` | `/payouts/admin/statement/ingest` | SUPER_ADMIN | body `{ statementRef (min 3), lines: [{ utr (min 3), amount \| amountPaise (non-zero, signed rupees/paise), description? }] }` → 201 `{ statementRef, lines, newLines, confirmed, returned, queued, failed: [{ lineNo, utr, reason }] }` |

**Errors:** 400 `STATEMENT_REF_REQUIRED` / `STATEMENT_NO_LINES` /
`STATEMENT_LINE_BAD` (missing UTR or zero amount). A line whose match throws
(locked batch, unexpected state) is kept `unmatched` with `matchError` set and
reported in `failed` — the ingest itself still succeeds for the other lines.

## Phase 15 — clawback settlement (refund debts recovered through the cycle)

A refund after a payout leaves the vendor in debt to the platform. The
refund journal already debits `vendor_payable` by the vendor's drained share;
the payout side carries the debt as a **negative line** (clawback) that
offsets the vendor's next cycle:

- `computeCycleForVendor` — when the cycle's raw net is negative (or below
  the payout floor) it creates a zero-net batch and records the residual as
  `carryForwardPaise`. **The carried debt moves into the new batch's opening
  and is cleared on the old batch** — a later cycle can never take the same
  debt a second time. `submitForApproval` refuses zero-net batches
  (`PAYOUT_NOTHING_TO_PAY`); with `negativeBalanceCarryForward: false` a
  negative cycle is refused outright (`PAYOUT_NEGATIVE_BALANCE`).
- `cancel` / `markFailed` release a batch's lines under one rule:
  - `carryForwardPaise !== 0` → the batch's net was recorded as carry-forward,
    so its lines are **consumed** (PAID, nothing moved for them) — releasing
    them back would double-charge (or double-pay) the same amounts.
  - `carryForwardPaise === 0` → nothing was carried, every line returns to
    the eligible pool (including negative clawback lines, whose offset is
    still pending — the refund journal already holds the debt).
- `markFailed` now releases its lines (a rejected payout moved no money — the
  next cycle pays the lines again; previously they were pinned to the failed
  batch until an operator cancelled it).
## Phase 17 — vendor ledger integrity (`vendor_payable` is a real ledger account)

The payout lines **are** the ledger for what is owed to vendors. Every
`vendor_payable:{vendor}` entry must equal the sum of the vendor's payout
lines' book views (gross − GST − commission, signed by line type), the
adjustments pinned to its batches, the book face of its carry-forward
batches, and the book openings of batches that have not yet settled:

    vendor_payable:{v}  =  Σ lineLedgerView(counted lines)
                         + Σ adjustments (counted)
                         + Σ carryLedgerViewPaise (carry batches, carry ≠ 0)
                         + Σ openingLedgerViewPaise (settled-out batches)

A **counted** line is any ACCRUED / ELIGIBLE / HELD line, plus a BATCHED line
whose batch journal is not live yet (not submitted / not paid) and which
carried nothing — a line is never counted twice, and a carried batch's lines
are **consumed** (PAID) at absorption so the debt is counted exactly once, in
the new batch's opening.

Carry-forward is **dual-face**: `carryForwardPaise` is the cash face (what the
next cycle's bank transfer nets) and `carryLedgerViewPaise` is the book face
(what the journals still owe). `cancel` / `markFailed` / `markReversed` on a
settling batch re-park **both** faces into the next cycle's opening; absorbing
a carry into a larger cycle clears **both** on the old batch.

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/payouts/admin/vendor-reconcile` | SUPER_ADMIN | platform reconcile: every vendor with lines/batches → `{ vendorsChecked, drifted, driftedSample, totalDifferencePaise, ok, vendors[{vendorId, expectedPaise, actualPaise, differencePaise, balanced}] }`. `?id={vendorId}` scopes to one vendor (full single-vendor report incl. `balanced`) |
| `POST` | `/payouts/admin/vendor-reconcile/repair` | SUPER_ADMIN | body `{ id: vendorId }` (required — a blind platform-wide repair would post an unknown number of journals): posts **one** signed `vendor_backfill` journal for the difference (books under-stated → DR `gateway_clearing` / CR `vendor_payable`; over-stated → the reverse) + a `vendor_backfill` audit event with the **same idempotency key as the journal**, then reports the post-repair state. No-op (200 `{repaired:null, balanced:true}`) when balanced. Without `id` while a vendor is drifted → 400 `VENDOR_RECONCILE_NEEDS_ID` |

The backfill amount is **not re-derivable** from any aggregate, so `replay`
refuses it with `VENDOR_BACKFILL_NOT_REPLAYABLE` — the audit event (keyed to
the journal) records exactly what was backfilled and by which repair.

The integrity report's new `checks.vendors` row (platform-scoped — vendors are
platform-global) feeds the platform **Ledger** page, which gained a
**Vendor payable** subsystem row: drift to the paise, the drifted vendor
sample, a per-vendor reconcile drill-down, and a repair action that posts the
signed backfill.

Pre-Phase-17 data: carry batches created before this phase carry no book face.
`scripts/seed-vendor-carry-views.mjs` is a one-off, idempotent migration that
recovers `carryLedgerViewPaise` from each such batch's consumed lines (book
view + opening face + pinned adjustments). Run `DRY_RUN=true` first.
## Phase 18 — statutory ledger integrity (`tcs_payable` / `tds_payable` are real accounts)

TCS (GST s.52) and TDS (IT s.194-O) are withheld from vendor payouts when the
batch journal is posted, credited to `tcs_payable` / `tds_payable`, and
discharged by deposits to the government (Phase 13). Phase 18 reconciles those
accounts against the domain facts that created them:

    {statute}_payable  =  withheld − net deposits

where **withheld** = Σ `batch.{tcs,tds}Paise` over batches whose payout
journal is live (state PROCESSING / PAID — the journal credits the payable at
submission), and **net deposits** = recorded deposits − reverts. A REVERSED
or FAILED batch booked the credit AND posted the mirror unwind, so it nets to
zero and is not withheld. The payable accounts are platform-global (no
tenant in the code), so the reconcile is platform-scoped.

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/payouts/admin/statutory-reconcile` | SUPER_ADMIN | both statutes → `{ statutes[{statute, accountCode, withheldPaise, netDepositedPaise, expectedPaise, booksPaise, differencePaise, balanced}], drifted, totalDifferencePaise, ok }`; `?statute=tcs\|tds` → the single statute row |
| `POST` | `/payouts/admin/statutory-reconcile/repair` | SUPER_ADMIN | body `{ statute }` (required — repair is per-statute by design): posts **one** signed `statutory_backfill` journal for the difference (under-stated → DR `bank` / CR `{statute}_payable`; over-stated → the mirror) + a `statutory_backfill` audit event with the **same idempotency key as the journal**, then reports the post-repair state. No-op (200 `{repaired:null, balanced:true}`) when balanced. Without `statute` while a statute is drifted → 400 `STATUTORY_RECONCILE_NEEDS_STATUTE`. Zero-difference backfills are refused (`STATUTORY_BACKFILL_EMPTY`) |

The backfill amount is the measured *difference* — not re-derivable — so
`replay` refuses it with `STATUTORY_BACKFILL_NOT_REPLAYABLE`, exactly like
the wallet and vendor backfills. The integrity report gained `checks.statutory`,
and the platform Ledger page gained a **Statutory payable (TCS/TDS)** row
(drift to the paise + per-statute backfill action; A38 now requires all
10 subsystems).

## Phase 19 — GST output payable integrity (seller + platform GST accounts are real accounts)

A vendor sale's GST is the *seller's* output liability: `buildSaleLines`
credits `gst_output_payable:{vendor}` the item's `taxAmount`, a SUCCESS refund
debits back the refunded slice, and a submitted payout batch drains the
batch's aggregated `sellerGstPaise` (the GST leaves the seller's obligation
when the platform remits it on their behalf). The platform itself also owes
GST on its commission — `gst_output_payable:platform` is credited the batch's
`gstOnCommissionPaise` when the payout journal posts. Phase 19 reconciles
every one of those accounts to the paise against the domain facts that
created them:

```
gst_output_payable:{vendor}  =  sale credits − refund debits − live payout drains
    sale credits     =  Σ item.taxAmount (paise) over the vendor's items on
                        PAID orders (the books were credited at sale time)
    refund debits    =  per SUCCESS refund, the vendor's share of
                        allocatePaise(toPaise(refund.amount), credit lines) —
                        the exact same allocation the refund journal used
    live drains      =  Σ max(0, batch.sellerGstPaise) over batches in
                        PROCESSING / PAID (the payout journal is live)

gst_output_payable:platform  =  Σ batch.gstOnCommissionPaise over the same
                        live batches (commission GST leaves with the payout)
```

A REVERSED batch is not live: its payout journal was unwound by the reversal
journal, so it drains nothing — the same subtlety as Phases 17 and 18. A
partial refund marks the whole original line reversed in the *view* but the
journal debited only the proportional slice; the invariant is on the journal
basis, which is what the books actually moved.

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/payouts/admin/gst-reconcile` | SUPER_ADMIN | all owners → `{ vendors[{vendorId, accountCode, saleCreditsPaise, refundDebitsPaise, payoutDrainsPaise, expectedPaise, booksPaise, differencePaise, balanced}], platform{…}, checked, drifted, driftedSample[≤5], totalDifferencePaise, ok }`; `?vendor=<id>` → the single vendor row |
| `POST` | `/payouts/admin/gst-reconcile/repair` | SUPER_ADMIN | body `{ owner }` (vendor id or `"platform"`; repair is per-owner by design): posts **one** signed `gst_backfill` journal for the difference (under-stated → DR `gateway_clearing` / CR `gst_output_payable:{owner}`; over-stated → the mirror) + a `gst_backfill` audit event with the **same idempotency key as the journal**, then reports the post-repair state. No-op (200 `{repaired:null, balanced:true}`) when balanced. Without `owner` while something is drifted → 400 `GST_RECONCILE_NEEDS_OWNER`. Zero-difference backfills are refused (`GST_BACKFILL_EMPTY`) |

The backfill amount is the measured *difference* — not re-derivable — so
`replay` refuses it with `GST_BACKFILL_NOT_REPLAYABLE`, exactly like the
wallet, vendor, and statutory backfills. The integrity report gained
`checks.gst`, and the platform Ledger page gained a **GST output payable**
row (drift to the paise + per-owner backfill action; A38 now requires all
11 subsystems).

## Phase 20 — bank cash position integrity (the settlement bank is a real account)

The settlement bank is where the money physically is: PSP settlements move
captured cash in (`psp_settled`: DR bank / CR gateway_clearing), live payout
batches move vendor cash out (the `payout_initiated` journal credits the
bank the batch's `netPaise` — net of commission, platform commission GST and
TCS/TDS), and statutory deposits leave for the government (CR bank). Phase
20 reconciles the bank's book balance to the paise against the domain facts
that moved it:

```
books(bank)  =  Σ psp_settled (signed — the PSP nets refunds in as negative
                settlement rows; final once posted)
             −  Σ batch.netPaise over LIVE batches (PROCESSING / PAID — the
                payout journal is live)
             −  Σ statutory deposits (recorded, not reverted)
             +  bank_backfill journals (self-corrections, excluded)
```

Refunds never touch the bank — they go back out through the gateway
(`gateway_clearing`), which is why a refund of a settled order leaves the
bank books exactly where they were. A REVERSED batch posted its credit AND
its unwind, so it nets to zero and is excluded, like every prior phase.

The bank statement (Phase 14) is the independent egress cross-check: an
UNMATCHED statement line is money the bank moved with no known batch UTR.
The check is `ok` only when the books balance AND the unmatched queue is
empty — unexplained egress keeps the platform red until it is explained.

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/payouts/admin/bank-reconcile` | SUPER_ADMIN | `{ expectedPaise, booksPaise, differencePaise, settlements{count, paise}, payouts{count, paise}, deposits{count, paise}, statement{unmatchedLines, unmatchedPaiseAbs}, balanced, ok }` |
| `POST` | `/payouts/admin/bank-reconcile/repair` | SUPER_ADMIN | body `{ note? }`: posts **one** signed `bank_backfill` journal for the difference (under-stated → DR `bank` / CR `gateway_clearing` — the unexplained-cash bucket absorbs the correction; over-stated → the mirror) + a `bank_backfill` audit event with the **same idempotency key as the journal**, then reports the post-repair state. No-op (200 `{repaired:null}`) when balanced |
| `DELETE` | `/payouts/admin/statement/lines/:ref/:lineNo` | SUPER_ADMIN | operator correction for a bad ingestion — deletes a statement line. Only **unmatched** lines may be deleted; matched lines already drove a money movement and are immutable (`STATEMENT_LINE_MATCHED`) |

The backfill amount is the measured *difference* — not re-derivable — so
`replay` refuses it with `BANK_BACKFILL_NOT_REPLAYABLE`, exactly like the
wallet, vendor, statutory, and GST backfills. Zero-difference backfills are
refused (`BANK_BACKFILL_EMPTY`). The integrity report gained `checks.bank`
(12th subsystem), and the platform Ledger page gained a **Bank cash
position** row (books vs facts + settlement/payout/deposit counts + the
unmatched statement count, with a single backfill action; A38 now requires
all 12 subsystems).
