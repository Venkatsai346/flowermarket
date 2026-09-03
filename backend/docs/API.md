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
`200 { data: { user, tokens } }` · `401 INVALID_CREDENTIALS`

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
```

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
| GET | `/catalog?search=&categoryId=&brandId=&type=&minPrice=&maxPrice=&inStock=&sort=relevance\|price_asc\|price_desc\|newest\|popularity&page=&limit=` | merged view, ACTIVE only |
| GET | `/catalog/categories` | active category tree |
| GET | `/catalog/brands` | verified brands |
| GET | `/catalog/products/:id` | product + listing + stock |
| GET | `/catalog/products/:id/stock` | quick availability |

```jsonc
// GET /catalog?search=rose
{ "success": true, "data": [
    { "listingId": "…", "price": { "mrp": 349, "sellingPrice": 299, "currency": "INR" },
      "stockQty": 120, "availability": { "status": "in_stock" },
      "product": { "id": "…", "title": "Red Roses (Bunch of 20)", "slug": "ros-red-bunch",
                   "skuGlobal": "ROS-RED-BUNCH", "type": "fresh_flower", … } } ],
  "meta": { "page": 1, "limit": 20, "total": 3, "hasMore": false } }
```

### Tenant portal (`/catalog/tenant` — authenticated)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/masters/propose` | propose new global SKU → PENDING_REVIEW + change request |
| POST | `/listings` | create listing for an ACTIVE master (`{productMasterId, variantId?, price, stockQty, status}`) |
| GET | `/listings?status=&search=&categoryId=` | tenant's listings (paginated) |
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
| POST | `/masters/:id/variants` · `/images` · `PUT /masters/:id/attributes` | sub-resources |
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
| `POST /marketplace/tenants/register` `{name, slug, plan?, contactEmail?, owner{firstName, lastName, email, password}}` | create store → tenant + owner admin (never super_admin) + trial subscription + owner auto-login tokens; slug unique/reserved → 409 |

### Vendor (auth; role `vendor` — granted ONLY by an approved application)

| Endpoint | Purpose |
| --- | --- |
| `POST /marketplace/vendor/apply` `{businessName, slug?, contactPhone?, gstin?, categories[], city?}` | any authenticated user; one application per user (re-submit updates) |
| `GET /marketplace/vendor/me` | vendor profile + stats (gmv/orders from `orderitems.vendorId`) + commissionRateBps |
| `PATCH /marketplace/vendor/me` `{businessName?, city?, categories?, gstin?, payout{...}}` | update business info / payout metadata |
| `GET /marketplace/vendor/products?status=` | my products |
| `POST /marketplace/vendor/products` `{title, type, categoryId, brandId?, skuGlobal, description?, tags?, ...}` | create → status `pending_review`, vendorId attributed |
| `PATCH /marketplace/vendor/products/:id` | edit while `pending_review` (locked after review) |

### Store owner (auth; tenant `admin`/`super_admin`)

| Endpoint | Purpose |
| --- | --- |
| `GET /marketplace/store` | my store: branding + plan + subscription |
| `PATCH /marketplace/store` `{name?, logoUrl?, theme?, tagline?, description?, bannerUrl?, socialLinks?, isPublished?}` | update branding; publish flips onboarding → active |
| `GET /marketplace/store/subscription` | live subscription (trial/active/past_due) |
| `PATCH /marketplace/store/plan` `{planCode}` | change plan (creates subscription for existing stores); mid-period change → pro-rata `pendingAdjustment` on next invoice |
| `GET /marketplace/store/invoices?status=` · `GET /marketplace/store/invoices/:id` | my invoices (frozen line items) |
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
