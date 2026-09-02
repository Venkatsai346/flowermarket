# Data Models — Design & Business Rules

This document is the **source of truth** for the data layer. It explains *why* each
collection exists, the business rules it enforces, and how the design scales to
products, slotted delivery, orders, payments and multi-tenancy.

---

## 1. Design principles

1. **No embedded models → no unbounded arrays.** MongoDB documents are capped at
   16 MB. Anything that can grow without limit (addresses, tokens, OTPs, cart items,
   order items, reviews, images) lives in its **own collection** referenced by id.
   The only arrays in use are bounded by design (`tags`, `attributes`, `pincodes`,
   `deliveryTypes`, `loginMethods`).
2. **Reference, don't duplicate.** Addresses reference canonical `Location` nodes;
   orders reference products, addresses and slots. Denormalized *snapshots* (e.g.
   product name/price on an order item) are allowed only where history matters.
3. **Tenant-scoped everywhere.** Every business collection carries `tenantId`.
   A single MongoDB deployment hosts many businesses without data bleed
   (multi-tenant readiness).
4. **Soft deletes everywhere.** Destructive `deleteOne` is banned; the soft-delete
   plugin (`isDeleted` + `deletedAt`) is applied to every model.
5. **Audit hygiene.** `createdAt`, `updatedAt`, `updatedBy` on every collection
   (audit plugin).
6. **Enums are centralized** in `src/constants/enums.js` — one place to evolve
   values without hunting magic strings.
7. **Indexes are explicit** and designed per query pattern; TTL indexes self-clean
   transient data (OTPs, tokens).

---

## 2. Multi-tenancy strategy

```text
Tenant (flower market, sister store, vendor marketplace...)
  ├── TenantAuthConfig      per-tenant auth & delivery policy
  ├── User *                every user scoped to a tenant
  │     └── Address *       (own collection)
  │     └── AuthToken *     refresh-token sessions (own collection)
  │     └── OtpVerification * (own collection, TTL-cleaned)
  ├── Location *            canonical geography (shared reference data)
  ├── ServiceablePincode *  "do we deliver here?" map per tenant
  ├── DeliveryZone *        pincode groups for slot/fee planning
  ├── DeliverySlot *        generated time windows per zone (Phase 2)
  ├── Product *             catalogue (Phase 2)
  └── Vendor *              seller entity (marketplace hook)
```

- **Identity is per-tenant.** The same person has one `User` record per tenant they
  belong to. There is deliberately **no global unique phone constraint** — login is
  always resolved as `tenantId + phone/email`.
- **Resolution order** for a request: `x-tenant-id` header → JWT `tenant` claim →
  `DEFAULT_TENANT_ID` config → first active tenant (bootstrap).
- **Tenant-scope guard**: if a JWT's tenant differs from the request tenant, the
  request is rejected with `TENANT_MISMATCH` (proven in the smoke test).

---

## 3. Collection-by-collection

### 3.1 `tenants`
The multi-tenant root. Holds branding, plan, feature flags and status.

| Field | Notes |
| --- | --- |
| `name`, `slug` | slug unique, used in URLs |
| `type` | `business` (you) / `vendor` (marketplace) / `platform` |
| `plan`, `planExpiresAt` | free/pro/enterprise |
| `features` | capability flags: `slotsEnabled`, `paymentsEnabled`, `marketplaceEnabled` |
| `supportedCurrencies`, `defaultCurrency`, `timezone` | `INR` / `Asia/Kolkata` default |
| `status` | active/inactive/blocked |

### 3.2 `tenantauthconfigs`
Per-tenant auth + delivery policy, read once per request by `tenantContext`:

- `allowedLoginMethods` — which login methods are enabled
- `requirePhoneVerification`, `requireEmailForCheckout`
- `otpLength`, `otpTtlSeconds`, `otpMaxAttempts`, `sessionTtlSeconds`
- `deliveryPolicy` — `minimumOrderValue`, `deliveryFeeType` (free/flat/distance),
  `flatDeliveryFee`, `freeDeliveryAbove`, `maxDistanceKm`

> Why: toggling "OTP login disabled for maintenance" or "free delivery above ₹999"
> is a data change, not a deploy.

### 3.3 `users` — BigBasket-style customer account
A normalized account document (no embedded arrays that can grow):

| Area | Fields |
| --- | --- |
| Identity | `phone.{countryCode,number,verified,verifiedAt}`, `email.{address,verified,verifiedAt}` |
| Auth | `passwordHash` (bcrypt, optional — OTP login doesn't need it), `loginMethods[]` |
| Roles/status | `role` (customer/vendor/admin/super_admin), `status` (verification_pending/active/blocked/deleted) |
| Profile | `profile.{firstName,lastName,dob,gender,avatarUrl,bio}` |
| Preferences | `preferences.{language,currency,theme,defaultAddressId,notificationPrefs}` |
| Marketing | `marketing.{optedIn,consentVersion,consentedAt,revokedAt}` (consent-compliant) |
| Location | `location.{cityId,stateId,areaId,pincode,lastKnownCoordinates,updatedAt}` — drives slots & catalogue |
| Meta | `lastLoginAt`, `loginCount`, `defaultTenantId`, `accountMeta.source` |
| Audit | createdAt/updatedAt/updatedBy + soft delete |

**Business rules**
- Phone is the **primary login identity** (Indian e-commerce standard); email is
  optional and unique-when-present (partial unique index).
- Password is optional; when set it is bcrypt(12) hashed; `passwordHash` is
  `select: false` so it never leaks in JSON.
- Auto-promotion: `verification_pending → active` when the phone is verified.
- `location.pincode` is what the delivery engine keys on (BigBasket's "set your
  location" pattern).
- **Not embedded:** addresses, tokens, OTPs → separate collections below.

### 3.4 `addresses`
Saved delivery addresses — **own collection** (a power buyer can save dozens of
addresses without bloating `users`).

- Scoped by `tenantId + userId`; **ownership guard** on every read/write (proven: cross-user access → 404).
- `line1/line2/landmark/city/state/pincode` = what the user typed; `location.*` =
  canonical refs to `Location` nodes (geo/autocomplete); `coordinates` [lng,lat].
- **Serviceability stamp**: `serviceability.{status,checkedAt,message}` computed from
  `ServiceablePincode` on create/update → the app renders "deliverable" instantly.
- **Exactly one default per user**: partial unique index
  `{tenantId, userId, isDefault}` where `isDefault: true` + explicit promotion logic
  on delete.
- **Cap**: `MAX_ADDRESSES_PER_USER` (default 10).

### 3.5 `authtokens`
Stored, **hashed** (SHA-256) refresh tokens — session management.

- One row per device session: `deviceId`, `deviceName`, `platform`, `ipAddress`,
  `userAgent`, `lastUsedAt`.
- **Rotation**: each refresh revokes the old token and mints a new one (theft
  mitigation; proven: reused token → 401).
- **Revocation reasons**: logout / password_change / admin_block / rotation / expiry.
- TTL index cleans expired rows server-side.

### 3.6 `otpverifications`
OTP state machine — own collection, TTL-cleaned.

- Keyed by `tenantId + purpose (login/signup/password_reset/phone_change/email_verify) +
  channel (phone/email) + target`.
- **One live OTP per target**: requesting revokes previous ones.
- **Resend cooldown** enforced (default 60 s).
- Stored **hashed**; compared with constant-time `timingSafeEqual`.
- **One-shot consumption**: verifying marks `consumedAt` atomically — replay is impossible.
- **Brute-force bounded**: `maxAttempts` per OTP + HTTP rate limiters per endpoint.

### 3.7 `locations`
Canonical geography: country → state → city → area → pincode as **nodes in one
collection** with `parentId` references (no nested/embedded hierarchy, no unbounded
arrays). Pincode nodes carry `deliveryMeta` (delivery types, COD, same-day flags).
`2dsphere` index on coordinates for geo queries.

### 3.8 `serviceablepincodes`
The "**do we deliver here?**" map, per tenant:

- `pincode + isServiceable + deliveryTypes` (standard/express/same_day/scheduled)
- Cut-off times (`sameDayCutoff: '17:00'`), min/max delivery time
- `zoneId` → links to `DeliveryZone` for slot/fee planning
- **Unique index** `{tenantId, pincode}`.

### 3.9 `deliveryzones`
Groups of pincodes for delivery planning: `name, code, pincodes[], areaIds[],
deliveryFee, isActive`. Slots and fees operate at zone level.

### 3.10 `deliveryslots`
**BigBasket-style slotted delivery** (Phase 2 engine; model designed now):

- Generated per `tenant + zone + date (YYYY-MM-DD) + startTime/endTime`; unique index
  on that tuple.
- `windowType` (normal/express/same_day/next_day/scheduled), `displayLabel`
- **Capacity**: `totalCapacity / reservedCapacity / availableCapacity` — slots show
  "available / full"; reservations release on cart expiry or cancellation.
- **Cut-off**: `lastOrderTime` (e.g. same-day orders before 17:00).
- `version` for optimistic locking on capacity updates.

> Checkout query: `status=open AND lastOrderTime > now AND availableCapacity > 0`.

### 3.11 `products` — catalogue, scalable beyond flowers
Designed so today's `FRESH_FLOWER` and tomorrow's `GARDENING_TOOL` coexist without
migrations:

- `type` (product type enum) + `variant` subdoc with **bounded** type-specific keys
  (`stemLengthCm`, `packSize`, `shelfLifeDays`, `isPerishable`...)
- `attributes[]` = key/value/unit pairs — extensible without schema changes
- `price.{mrp, sellingPrice, currency, sellingUnit}` — florists price per **stem,
  bunch, box, kg**; unit is part of the price.
- `status / listingStatus / availability / stock` — inventory snapshot; the truth
  lives in `ProductVariant` + `InventoryLedger` (Phase 2, own collections).
- `searchText` precomputed + text index; `slug` unique per tenant; `vendorId` →
  marketplace hook.
- Images/videos → `assets` collection (Phase 2), not embedded.

### 3.12 `vendors` → implemented in Phase 5 (§10.4)
The Phase-1 placeholder ("seller entity for the marketplace roadmap") is now the real
approved-seller profile: see §10.4 below.

---

## 5. Catalog (Phase 2a) — the multi-tenant field-ownership pattern

This is the heart of "shared catalog + tenant overrides" (per the architecture doc):

```text
ProductMaster (GLOBAL — "what the product IS")        TenantProduct (TENANT — "is it sellable HERE?")
  skuGlobal, title, images*, category, brand,            tenantId, productMasterId, variantId
  barcode, attributes*, variants*, version               price{mrp, sellingPrice}, orderLimits
  status: PENDING_REVIEW → ACTIVE | REJECTED             stockQty (snapshot), availability
           ACTIVE → DEPRECATED (cascades)                status: DRAFT → ACTIVE → INACTIVE / OUT_OF_STOCK
  * in own collections (no unbounded arrays)             version (optimistic lock)
```

### Why the split is the core trick
If any tenant could edit `title`/`images` directly, 50 stores could silently fork one
SKU into 50 different products. So the **write path branches by field ownership**:
- **Tenant-scoped** (price, stock, listing status) → tenant writes directly, optimistic-locked.
- **Global** (title, images, category, brand, attributes) → tenant submits a
  `ProductChangeRequest` with a diff; **admin approves/rejects/needs-changes**.
  Approval applies the diff to the master and bumps its version.

### Collections added in Phase 2a

| Collection | Purpose | Key rules |
| --- | --- | --- |
| `categories` | Global taxonomy tree (parent refs) | Admin-only writes; `attributeSchema[]` (bounded) drives compliance validation |
| `brands` | Global brand registry | `verification.isVerified` lets verified brands skip approval steps |
| `productmasters` | Global product identity | unique `skuGlobal`/`slug`/`barcode`; `version`; status machine; `searchText` precomputed |
| `productvariants` | master → variant (10 stems, 1 kg...) | unique (master, variantType, value); partial-unique sku |
| `productimages` | master images | one primary per master |
| `productattributevalues` | EAV attributes per master | unique (master, key); validated vs category attributeSchema |
| `tenantproducts` | Sellable listing per tenant | unique (tenant, master, variant); price/stock/status owned by tenant; `version` |
| `pricehistories` | Append-only price audit | immutable by convention |
| `inventories` | Stock truth per listing | atomic reserve/release via guarded findOneAndUpdate; `qtyAvailable = onHand - reserved` |
| `productchangerequests` | Global-field approval queue | diff{before, after}; PENDING → APPROVED/REJECTED/NEEDS_CHANGES/CANCELLED |
| `auditlogs` | Immutable action trail | insert-only; non-admins read only their tenant's rows |
| `catalogevents` | Outbox for domain events | drain() → in-process handlers; row = durable record for future Kafka/Redis |

### Business rules enforced
1. **Tenants can never create categories/brands or edit master global fields directly.**
2. **New SKU proposal** → master created `PENDING_REVIEW` + `create_master` change
   request → admin approve → `ACTIVE` (+ version bump) → event `PRODUCT_CREATED`.
3. **Duplicate detection**: exact barcode/SKU → 409; fuzzy title (bigram + token
   similarity ≥ 0.8) → 409 `POSSIBLE_DUPLICATE` with the existing master id.
4. **Optimistic locking**: every master/listing mutation carries `expectedVersion`;
   a stale version → 409 `VERSION_CONFLICT` (client refetches & retries).
5. **Merged read view** (`GET /catalog`): only `TenantProduct.status=ACTIVE` AND
   `ProductMaster.status=ACTIVE` surface; inventory snapshot makes it one query.
6. **Deprecating a master** cascades all its tenant listings to INACTIVE (soft delete
   everywhere — no hard deletes).
7. **Reservations are atomic**: `$inc qtyReserved` guarded by
   `$expr qtyReserved + qty <= qtyOnHand` — concurrent carts can't over-reserve.
8. **Price changes** require `sellingPrice <= mrp` and always append a PriceHistory row.
9. **Listing status machine**: DRAFT→ACTIVE→INACTIVE↔ACTIVE→OUT_OF_STOCK→ACTIVE/INACTIVE;
   invalid transitions → 400.
10. **Bulk import** (CSV price/stock) runs as an async job (in-memory registry;
    queue-backed in prod) with per-row error reporting + `dryRun` validation.

### Why no 16MB blowup here
Attributes → EAV rows; images → rows; variants → rows; price history → rows;
change requests → rows; audit → rows; events → rows. Nothing that grows is embedded.

---

## 6. Order lifecycle (Phase 3) — cart, slots, orders, payments, returns

All collections below follow the same rules: tenant-scoped, separate collections with
references (never embedded arrays — keeps documents bounded), soft-delete, atomic
invariants. Design source: `uploads/order_lifecycle_cart_delivery_fulfillment_returns.md`.

### 6.1 `hubs` — dark stores
`tenantId`, `code` (unique per tenant), `zoneId`, address, coordinates, bounded
`serviceablePincodes[]`, `defaultSlotCapacity`, `isActive`. Slots belong to a hub;
`ServiceablePincode.hubId` (added in Phase 3) routes a pincode to its servicing hub.

### 6.2 `deliveryslots` — BigBasket-style windows (rewritten in Phase 3)
`tenantId + hubId + date + startTime` unique; `totalCapacity` (set by ops/forecasting),
`reservedCapacity` — **no stored availableCapacity** (it's a virtual: `total - reserved`).
Atomic reserve: `findOneAndUpdate({ $expr: { $lt: ['$reservedCapacity','$totalCapacity'] } }, { $inc: { reservedCapacity: 1 } })`
→ null ⇒ `SLOT_FULL` (concurrent reserves can never oversell). `lastOrderTime` cut-off,
`minOrderValue`, `codAllowed`, `status open|closed|full|cancelled`, `version`.

### 6.3 `slotreservations` — the hold
`status held|confirmed|expired|released`. HELD rows carry `expiresAt` (partial TTL 10 min
→ auto-deleted) + partial unique index `(slotId, userId)` only for HELD (one live hold per
user per slot). CONFIRMED ties the hold to the order (`orderId`). `releasedReason` for audit.

### 6.4 `carts` + `cartitems` — disposable draft
- `carts`: one ACTIVE per `(tenantId, userId)` (partial unique); `expiresAt` partial TTL
  (30 days); denormalized `itemCount/distinctItems/subtotal`; `lastCheckoutMeta`.
- `cartitems`: unique `(cartId, tenantProductId)`; **snapshots at add-time** —
  `priceSnapshot {mrp, sellingPrice, currency}`, `stockSnapshot {availableQty, checkedAt}`,
  `titleSnapshot`, `unitSnapshot`, `isReturnable`; `lineTotal`. Snapshot prices are never
  live-synced — checkout revalidates and requires explicit re-confirmation.

### 6.5 `orders` + `orderitems` + `orderstatushistory`
- `orders`: `orderNumber` (per-tenant daily `FM-YYMMDD-NNNNN` via atomic `counters`),
  `status` (full machine incl. return sub-states), totals (`itemsSubtotal/deliveryFee/
  discount/taxAmount/totalAmount`), `cartId`, `slotReservationId`, **denormalized
  `slotSnapshot` + `addressSnapshot`** (history stays correct after edits),
  `paymentSummary {paymentId, status, paidAt, refundedAmount}`, `cancellation` subdoc
  (reason/reasonText/by/at/refundStatus/refundTransactionId), `deliveryRetryCount`, `version`.
- `orderitems`: per-line `skuSnapshot`, `priceAtOrder`, `qty/lineTotal`, `isReturnable`,
  `returnedQty/cancelledQty` (partial-return tracking prevents over-returning).
- `orderstatushistory`: append-only `fromStatus → toStatus`, `actorType/actorId`, `note`,
  `createdAt` — the track-order timeline; every saga transition appends one row.

### 6.6 `payments` + `paymenttransactions`
`payments`: amount/method/provider, unique `idempotencyKey` (dedupe → no double charge),
`gatewayOrderId/gatewayPaymentId`, `refundedAmount`, `paidAt/failedAt/failureReason`;
reconciliation index `(status, createdAt)` for the stale-PENDING sweep.
`paymenttransactions`: CHARGE/REFUND legs, unique `idempotencyKey`, `gatewayRef`,
`rawGatewayResponse`.

### 6.7 `wallets` + `wallettransactions`
Unique `(tenantId, userId)`, `balance`, `version` (optimistic lock, retry-once on conflict).
Ledger is append-only: `type credit|debit`, `amount`, `balanceAfter`, `reason`,
`refType/refId`, `note`.

### 6.8 `refundtransactions`
Unique `idempotencyKey`; `destination wallet|original_method` (wallet default — instant;
gateway above threshold); `walletTxnId` when wallet, `gatewayRef` when gateway;
`returnRequestId`, status machine + `failureReason`.

### 6.9 `returnrequests` + `returnitems`
- `returnrequests`: `claimType pickup_qc|instant_claim`, status machine, `refundAmount`,
  `eligibility` subdoc (`windowExpired/nonReturnableItems/claimLimitReached/isEligible`),
  `autoApproved`, `review` subdoc, pickup/QC timestamps. Fraud guard: instant-claim
  monthly limit per user (3) → manual review.
- `returnitems`: per `orderItemId` qty + `qcStatus`, refund-amount share.

### 6.10 `fulfillmenttasks` + `deliveryassignments`
- `fulfillmenttasks`: unique `orderId`, `hubId`, `pickerId`, QUEUED→PICKING→PACKED/FAILED
  with timestamps.
- `deliveryassignments` (Phase 3.5 — explicit rider machine): unique `orderId`, `riderId`,
  `status PENDING_ACCEPT→ACCEPTED→AT_HUB→IN_TRANSIT→ARRIVED→DELIVERED|FAILED`, plus
  `pendingAcceptExpiresAt` (45 s accept TTL → background sweep auto-reassigns, no stuck
  orders), `rejectedRiderIds[]` (capped at `RIDER_REJECT_CAP`, rejecter excluded from the
  retry pool; cap hit → `needsManualAssignment`), `rejectCount`, `packageVerified`
  (gate for `depart`), `podType otp|photo|signature` + `podReference`
  (**OTP stored as SHA-256 hash**, media URL for photo/signature). Index
  `(tenantId, status, pendingAcceptExpiresAt)` drives the sweep.

## 7. Phase 3.5 — policies, breakdowns, forecasting (blueprint: `tenant_charges_rider_endpoints_slot_forecasting_refund_fees.md`)

The core fix: `deliveryFee = 49` was a hardcoded symptom — there was no persisted cost
breakdown. Phase 3.5 persists an **immutable charge breakdown at order time**; policy may
change later, but historical orders and refunds always reflect what the customer was
actually charged.

### 7.1 `deliveryfeepolicies`
Per tenant: `baseFee`, `freeDeliveryThreshold` (≥ ⇒ fee 0), `expressSurgeMultiplier`
(express window ×), `distanceFeePerKm`, `effectiveFrom/effectiveTo` versioning, `isActive`
**partial-unique** (one active per tenant), soft-delete/audit/toJSON plugins.

### 7.2 `taxpolicies` — per CATEGORY (GST is a legal classification, not a tenant choice)
`categoryId` + `gstSlabPct` + `hsnCode`, `isActive` partial-unique per category.
GST is computed on the **pre-discount** line total (standard practice).

### 7.3 `discountpolicies` (coupons)
`code` unique per tenant (or platform-wide `tenantId: null`), `discountType
flat|percent`, `value`, `minCartValue`, `maxDiscountCap`, `usageLimitPerCustomer`,
`validFrom/validTo`, `status`, `isActive`. `couponusages` rows (unique
`couponId+orderId`) dedupe and enforce per-customer caps.

### 7.4 `orderchargebreakdowns` — the immutable snapshot
One row per order at creation: `itemSubtotal`, `deliveryFee` (+ `deliveryFeePolicyId`),
`taxTotal`, `discountTotal` (+ `discountPolicyId`), `grandTotal`, per-line
`lineItems[]` (`tenantProductId`, `lineTotal`, `taxAmount`, `discountAllocated`,
`taxPolicyId`, `hsnCode`), `couponCode`, `createdBy`. Never mutated.

### 7.5 `orderitems` / `orders` extensions
`orderitems` gain **`taxAmount` + `discountAllocated`** (computed once, never
recalculated — the refund basis). `orders` gain `chargeBreakdownId`, `couponCode`;
`slotSnapshot.windowType` persists normal|express for surge honesty.

### 7.6 `tenantrefundpolicies` + `refundtransactions` components
- `tenantrefundpolicies`: `refundDeliveryFeeWhen never|full_order_return_only|always`
  + `refundFeePct` (partial splits). Fee refund is explicit policy — the delivery
  physically happened.
- `refundtransactions` store **`refundItemAmount` (net goods = price − discount) +
  `refundTaxAmount` (credit-note line) + `refundFeeAmount` + `totalRefund`** separately
  so GST credit notes and finance can reconcile line-by-line. Total never double-counts
  tax: `total = item + tax + fee`.

### 7.7 `fulfillmenttimelogs` + `deliveryslots` forecasting fields
`fulfillmenttimelogs`: one per delivered order (idempotent update-or-insert) — `hubId`,
`slotId`, `slotType`, `weekday`, `pickSeconds/packSeconds/deliverySeconds`. **Every
DELIVERED order feeds back** → the forecast self-corrects.
`deliveryslots` gain `forecastCapacity` + `forecastAt` (written by the nightly batch).
Forecast = `min(predicted demand × headroom, physical picker/rider limit)`; the slot's
`totalCapacity` remains the atomic counter — "forecasting sets the number; the atomic
lock enforces it."

### 7.8 `users.rider` subdocument
`availability available|busy|offline`, `currentHubId` (hub affinity for assignment),
`rating`, `lastSeenAt`, `activeDeliveryCount` — powers rider assignment + availability.

## 8. Phase 4 — admin dashboard (blueprint: `admin_dashboard_api_analytics.md`)

### 8.1 `inventoryadjustments` (NEW — append-only stock ledger)
One row per manual stock change (never mutated/deleted): `tenantId`, `inventoryId`,
`tenantProductId`, `warehouseId`, `type restock|shrinkage|audit_correction|return_restock`,
`qtyChange` (signed ≠ 0), `qtyBefore`/`qtyAfter` snapshots, `reason`, `note`, optional
`refType`/`refId`, `actorId`/`actorType`. Indexes `(tenantId, tenantProductId, createdAt)`,
`(tenantId, inventoryId, createdAt)`. Adjust is atomic: `findOneAndUpdate` guarded by
`qtyOnHand + qtyChange ≥ 0` + version lock (retry-once), then row + `TenantProduct.stockQty`
refresh + audit.

### 8.2 `analyticsdailies` (NEW — nightly rollup)
Unique `(tenantId, hubId, date)`; `hubId: null` = tenant-wide row. Fields: `ordersCreated`,
`gmv`, `netRevenue` (= gmv − refunds), `aov`, `delivered`, `cancelled`, `returnRequests`,
`newCustomers`, `repeatCustomers`, `byPaymentMethod`/`bySlotType` (bounded subdocs),
`topProducts` (bounded array ≤ 20), `version`, `computedAt`. Rebuilt idempotently by
`POST /admin/analytics/rebuild` (nightly job hook) — safe to re-run.

### 8.3 `deliveryslots` — intraday override (EXTENDED)
`forecastCapacity`/`forecastAt` (Phase 3.5) + **`manualCapacity`, `manualCapacityAt`,
`manualCapacityBy`, `manualCapacityReason`** (Phase 4). Effective capacity =
`manualCapacity ?? totalCapacity`, honored by the atomic reserve gate
(`$expr: reservedCapacity < $ifNull(manualCapacity, totalCapacity)`) — the human override
can raise capacity mid-day but can never oversell, and can never shrink below
already-reserved units (409).

### 8.4 No new collections for orders/users/hubs
Staff = `user.role`; rider profile = `user.rider`; hubs already carry their curated
`serviceablePincodes[]`. Analytics reads `orders.slotSnapshot.hubId` + `orderitems` +
`refundtransactions` + `fulfillmenttimelogs`.

## 9. Phase 4b — notifications & exports (blueprint: `ops_tooling_notifications_exports.md`)

### 9.1 `devices` (NEW)
Push registrations: `tenantId`, `userId`, `provider fcm|apns`, `platform android|ios|web`,
`pushToken`, `status active|disabled`, `lastSeenAt`, `metadata {appVersion, deviceModel,
locale}`. **Partial unique index** on active `(userId, provider, pushToken)` — re-registering
the same token refreshes the same row instead of duplicating; max 10 active per user
(`DEVICE_LIMIT_REACHED`). Removal is a soft disable (`status: disabled`).

### 9.2 `notificationtemplates` (NEW)
Template-as-data. `tenantId` **null = platform default**; unique `(tenantId, code)`. Fields:
`code`, `eventType` (auto-trigger hook), `channels [push|email|sms]`, per-channel `content`
(`push.subject/body`, `email.subject/body`, `sms.body`) with `{{placeholders}}`,
`priority`, `isActive`, `version` (bumped on every edit), `effectiveFrom/effectiveTo`.
Resolution: tenant-specific active row first, platform default fallback. Rendered bodies are
**snapshotted onto the notification at enqueue** — later template edits never mutate history.

### 9.3 `notifications` (NEW — outbox + inbox)
One row per (user × template × dedupeKey): `tenantId`, `userId`, `orderId?`, `templateCode`,
`templateVersion`, `dedupeKey` (**unique sparse** — e.g. `order_confirmed:{orderId}`),
`channels[]` (intersected with reachable), `priority`, rendered snapshot `title/subject/body`
+ `payload`, `status pending|sending|sent|failed|read`, per-channel `channelStatus`
(e.g. `{push: sent, email: failed}`), `attempts`, `lastError`, `sentAt`, `readAt`. The worker
(`notificationService.processPending`) marks `sending` → calls channel adapters
(`notificationProvider`) → all sent ⇒ `sent`; any failure ⇒ `failed` (retryable). Inbox =
customer-scoped reads on this collection; `read` flips status + `readAt`.

### 9.4 `exportjobs` (NEW — scheduled report requests)
`tenantId`, **`jobKey` unique** (`{type}:{from}:{to}(:{hubId})` — idempotent nightly
creation), `type analytics_daily|orders|inventory|products|users`, `params` snapshot
(from/to/hubId/query), `status pending|running|done|failed`, `attempts`, `lastError`,
`artifactId` → `exportartifacts`, `scheduledFor`, `requestedBy`, `completedAt`.

### 9.5 `exportartifacts` (NEW — rendered results)
`tenantId`, `type`, `params`, `csv` (RFC-4180, UTF-8 BOM prefixed), `rowCount`, `sizeBytes`,
`requestedBy`, `completedAt`. Rendered by reusing the Phase-4 admin `csv()` functions —
the export service never re-implements CSV. Download returns `text/csv; charset=utf-8`.

## 10. Phase 5 — multi-tenant marketplace (blueprint: `multi_tenant_marketplace.md`)

### 10.1 `tenants` (EXTENDED)
New `store` subdocument: `tagline`, `description`, `bannerUrl`, `socialLinks {instagram,
facebook, website}`, `isPublished`, `onboardingStatus registered|active` (publish flips
to active). Existing `slug` (unique = store URL), `theme`, `logoUrl`, `plan`,
`planExpiresAt`, `features.marketplaceEnabled`, `ownerUserId` reused as-is.

### 10.2 `plans` (NEW — platform-wide catalog, admin-editable)
`code` unique (free|pro|business seeded), `name`, `description`, `priceMonthly`,
`currency`, `commissionRateBps` (100 = 1%), `features {maxHubs, maxProducts, maxStaff,
marketplaceEnabled}`, `trialDays`, `isActive`, `sortOrder`, `version`. Pricing is
SNAPSHOTTED onto subscriptions/invoices — editing a plan never rewrites history.

### 10.3 `subscriptions` (NEW — one live per tenant)
Partial unique `(tenantId, status ∈ trial|active|past_due)`. Fields: `planCode`,
`planSnapshot {name, priceMonthly}`, `commissionRateBps`, `currency`,
`status trial|active|past_due|cancelled`, `periodStart/periodEnd`, `trialEndsAt`,
`cancelAtPeriodEnd`, `pendingAdjustment {amount, label}` (mid-period plan-change
proration, applied to the next invoice then cleared), `changedAt`.

### 10.4 `vendors` (NEW — the Phase-1 placeholder, now real)
Created ONLY from an approved `vendorapplications` row (which also grants `user.role =
vendor` — the only path to that role). `userId` unique, `businessName`, `slug` unique,
`gstin`, `categories[]`, `city`, `commissionRateBps` (platform cut, admin-adjustable),
`status active|suspended`, `payout {method, name, maskedAccount}` (metadata only — no
disbursement this pass), `joinedAt`, `counters {gmv, orders}`, `reviewedBy`.

### 10.5 `vendorapplications` (NEW)
`userId` unique (one per user; re-submit updates), `businessName`, `slug`, `contactPhone`,
`gstin`, `categories[]`, `city`, `status submitted|under_review|approved|rejected`,
`reviewedBy/At`, `note`, `submittedAt`.

### 10.6 `invoices` (NEW — per-tenant billing)
Unique `(tenantId, period.from, period.to)` → billing cycle is idempotent per period.
`number` unique `INV-{YYMM}-{seq}` (atomic `counters` collection). Frozen `lineItems
[{type: subscription|commission|adjustment, label, qty, unitAmount, amount}]`,
`subtotal`, `total`, `status draft|open|paid|overdue|void`, `paidAt`, `paymentRef`,
`dueAt`, `generatedBy`. Commission = `round(periodGMV × commissionRateBps / 10000)`;
periodGMV comes from `analyticsdailies` (hubId null) with an orders fallback.

### 10.7 `counters` (NEW — atomic sequences)
`key` unique (e.g. `invoice:2609`), `value` — incremented atomically via
`findOneAndUpdate($inc, upsert)` so human-friendly numbers never collide.

### 10.8 `platformdailies` (NEW — cross-tenant rollup)
`date` unique, `orders`, `gmv`, `netRevenue`, `commissionsAccrued`, `mrr` (Σ live
subscription snapshot prices), `activeTenants`, `newTenants`, `newVendors`, `byPlan`,
`computedAt`. Idempotent upsert rebuild (`POST /marketplace/admin/analytics/rebuild`) +
nightly marketplace pass; dashboard reads it when present, else live-computes.

### 10.9 `productmasters` / `orderitems` (EXTENDED)
`productmasters.vendorId` (ref Vendor, null = platform-owned) + `marketplaceListed` +
`marketplaceListedAt`; review fields reused (vendor products start `pending_review`).
`orderitems.vendorId` snapshotted at checkout from the listing's master → vendor
GMV/orders computable with no joins; `productmasters.searchText`/indexes unchanged.

## 11. Phase 6.1 — financial ledger (blueprint: `phase6_payouts_gst_subdomains_search.md`)

Double-entry general ledger. Introduced because vendor payouts and GST invoicing
both need a provable answer to "who is owed what", and summing order rows on
demand is how marketplaces pay twice.

| Collection | Purpose | Key invariants |
| --- | --- | --- |
| `ledgeraccounts` | chart of accounts | `code` unique; `type` fixes the natural balance side; scoped accounts (`vendor_payable:{id}`) created lazily on first post |
| `ledgerjournals` | one balanced financial event | `Σ debitPaise === Σ creditPaise` or nothing is written; `idempotencyKey` unique; **never updated or deleted** — corrections are reversing journals; `reversedPaise` caps partial reversals |
| `ledgerentries` | flattened journal lines | append-only; the **source of truth** for balances; indexed `accountCode + occurredAt` for statements |
| `accountbalances` | materialized running totals | a **derived view**, updated with atomic `$inc`; recomputable at any time by `ledgerService.verifyBalances()` |

**Money representation.** All ledger amounts are integer **paise** (`…Paise`
fields). Legacy rupee floats remain on orders/invoices and are converted at the
boundary with `toPaise()`. Splits use `allocatePaise()` (largest-remainder), so
a distribution always sums exactly to its total — the arithmetic gate lives in
`scripts/money.test.js`.

**Chart of accounts**

| Code | Type | Meaning |
| --- | --- | --- |
| `gateway_clearing` | asset | captured by the PSP, not yet settled to us |
| `bank` | asset | our settlement account |
| `vendor_payable:{vendorId}` | liability | owed to a vendor |
| `tenant_payable:{tenantId}` | liability | owed to a store (own inventory + delivery fees) |
| `gst_output_payable:{sellerId}` | liability | tax collected on a seller's supply |
| `platform_commission_income` | income | the platform's cut on vendor sales |
| `tcs_payable` / `tds_payable` | liability | statutory collections (Phase 6.3) |
| `customer_wallet_liability` | liability | mirrors `wallets` |
| `refund_clawback:{vendorId}` | asset | negative vendor balance carried forward |
| `rounding_difference` | expense | bounded legacy-float artefacts, kept visible |

**The sale journal** (posted by `ledgerPosting.postSaleCaptured()` when an order
reaches CONFIRMED, idempotent on the order id):

```text
DR  gateway_clearing                    order.totalAmount
    CR  vendor_payable:{vendorId}       line net − commission     (vendor lines)
    CR  platform_commission_income      commission                (vendor lines)
    CR  tenant_payable:{tenantId}       line net                  (store's own lines)
    CR  gst_output_payable:{sellerId}   line tax
    CR  tenant_payable:{tenantId}       delivery fee
```

`line net = lineTotal − discountAllocated`, read from the values the Phase 3.5
pricing engine **persisted** on `orderitems` — nothing is recomputed from
today's policy, so a journal is reproducible forever.

Store-owned lines deliberately accrue **no** commission here: those stores are
billed monthly by the Phase 5 billing cycle, and accruing per order as well
would double-count.

**Refunds reverse, they do not recompute.** `reverseProportional()` reads the
original sale journal and hands back a proportional slice of exactly what it
credited, so a refund can never touch an account the order didn't, and can
never exceed what was captured (`LEDGER_OVER_REVERSAL`).

**Consistency.** Journal + entries + balance commit in one transaction when the
deployment is a replica set (probed once at boot). On a standalone mongod the
journal is written first and the nightly
`verifyBalances({repair:true})` recomputes the view from the entries — drift is
always detectable and always fixable. `trialBalance()` asserts
`Σ debits === Σ credits` across the whole ledger every night.

---

## 12. Phase 6.2 — GST invoicing (blueprint: `phase6_payouts_gst_subdomains_search.md`)

The Phase 3.5 pricing engine computes *charges*; this layer produces the *legal
document*. It adds the four things a valid Indian tax invoice needs and the
pricing engine never had: a CGST/SGST vs IGST split, a place of supply, a
registered supplier identity, and gapless per-financial-year numbering.

| Collection | Purpose | Key invariants |
| --- | --- | --- |
| `taxregistrations` | who the supplier legally IS (platform / tenant / vendor) | unique per (ownerType, ownerId); GSTIN unique and **checksum-validated** on write; snapshotted onto every document |
| `taxpolicies` *(extended)* | GST classification per category | now carries `rateBps` (integer), `natureOfSupply`, `cessBps`; resolved **by supply date**, not by `isActive` |
| `statutoryrates` | TCS (s.52) and TDS (s.194-O) as data | effective-dated timeline with `notificationRef`; a rate change is a NEW row, never an edit |
| `taxdocumentseries` | the numbering authority | unique per (owner, docType, FY, series); advanced atomically with `$inc` |
| `taxdocuments` | invoices **and** credit notes | immutable once `issued`; `number` unique; one invoice per (order, vendor); cancelled documents keep their number |

**One model, two document types.** The blueprint specified separate
`TaxInvoice` and `CreditNote` collections; they share ~60 fields, the same
numbering machinery and the same GSTR queries, and a credit note is legally a
correction *to* an invoice. One collection discriminated by `docType` — with
series still keyed on `docType`, so numbering stays legally separate — removes
the duplication without weakening a single constraint.

**The central arithmetic** lives in `src/utils/gst.js`, which is pure and has no
database access, so `scripts/tax-calc.test.js` proves it exhaustively (78
assertions, including two 20 000-case fuzz runs) in milliseconds:

```text
inclusive:  taxable = round(net × 10000 / (10000 + rateBps))
            tax     = net − taxable        ← derived by SUBTRACTION, so the
                                             parts can never fail to reconcile
intra-state: cgst = floor(tax/2), sgst = tax − cgst    (sum is exact, always)
inter-state: igst = tax
```

**Reconstruction, not recomputation.** An invoice is built from the values the
pricing engine *persisted* on `orderitems`, with the charged tax passed as
`knownTaxPaise`. The engine then only *splits* it into heads. A slab change next
year therefore cannot re-price a two-year-old invoice — and that is also why
every `lines[].rateBps` is a stored value rather than a reference to
`taxpolicies`.

**Nil-rated is not "0% taxable".** A flower catalogue is full of exempt supplies
(fresh cut flowers, live plants) sold alongside taxable ones (planters, tools,
gift wrap). `natureOfSupply` is first-class so those values land in the right
GSTR-1 column, and a category with no policy at all defaults to `nil_rated`
rather than silently taxing at 0% under a "taxable" label.

**One document per selling entity.** A multi-vendor order is several supplies by
several suppliers, so `issueForOrder()` returns an array: one invoice per vendor
plus one for the store's own lines (which also carries the delivery fee).
Σ(invoice totals) === `order.totalAmount`, asserted in the smoke suite.

**No ledger journal on issue.** `sale_captured` already recognised this money
when the order was confirmed, and `refund_issued` already reversed it. A tax
document is legal evidence of a movement the ledger holds — posting again would
double-count. This is the one place the two subsystems deliberately do *not*
touch.

---

## 13. Phase 6.3 — vendor payouts (blueprint: `phase6_payouts_gst_subdomains_search.md`)

Turning "the vendor is owed money" into "the money left our bank, once".

| Collection | Purpose | Key invariants |
| --- | --- | --- |
| `payoutpolicies` | when and how much, as DATA | platform row + optional per-vendor override; return windows, floor, ceiling, dual-approval threshold |
| `vendorpayoutaccounts` | where the money goes | account number encrypted + `select:false`; API returns only `maskedAccount`; `fingerprint` detects a change and arms a 24h freeze |
| `payoutlineitems` | the eligibility ledger, one row per sold item | every deduction stored separately; unique per `orderItemId`; reversals carry NEGATIVE values |
| `payoutbatches` | one disbursement to one vendor for one cycle | unique on (vendor, cycle) AND on `idempotencyKey` — the same key given to the provider |
| `payoutstatushistories` | append-only state trail | one row per transition, with actor |
| `payoutadjustments` | penalties / goodwill / corrections | signed paise, reason-coded, pinned to the batch that consumed them |

**Two gates, both must be open.** A line becomes payable only after (1) the
customer's return window has closed, and (2) — when
`policy.requirePspSettlement` is on — the PSP has actually settled the cash
(a `psp_settled` journal for that order exists). Gate 1 stops us buying back
our own goods; gate 2 stops us lending vendors our own working capital.

**The arithmetic** is a pure function (`computeLineFinancials`), so the worked
example is asserted to the paisa in `scripts/payout-calc.test.js` with no
infrastructure:

```text
gross (customer paid)                    5900.00
  − commission 10% of taxable value       −500.00
  − GST on that commission @18%            −90.00
  − TCS u/s 52 @0.5% of taxable            −25.00
  − TDS u/s 194-O @0.1% of gross            −5.90
  = net payable to vendor                 5279.10
identity: net + commission + gstOnComm + tcs + tds === gross
```

**The payout journal** drains what `sale_captured` credited and books the
statutory liabilities:

```text
DR vendor_payable:{v}              taxable − commission     4500.00
DR gst_output_payable:{v}          the seller's own GST      900.00
    CR bank                        net payable              5279.10
    CR gst_output_payable:platform GST on our commission       90.00
    CR tcs_payable                                             25.00
    CR tds_payable                                              5.90
```

The seller's GST flows *to* the seller because the seller is the person who
must deposit it; only TCS is withheld and deposited by the platform.

**Disbursement (M5).** `payoutProvider` (console | mock | razorpayx | cashfree)
returns **three** outcomes, not two: success, clean failure, and **ambiguous**
(timeout / 5xx / socket reset). Every real double-payment incident starts with
treating the third as the second, so `payout()` never throws on a transport
error — it returns `{ ambiguous: true }`, the batch stays PROCESSING with
`needsReconciliation`, and only `reconcileInFlight()` (asking the provider what
actually happened, keyed on our own idempotency key) may resolve it.

The ledger journal is posted **at submission**, because the liability is
discharged the moment the instruction is accepted. A clean rejection or a bank
reversal posts the exact mirror journal (`payout_reversed`) and releases the
lines back to the eligible pool.

`ingestPspSettlements()` posts `psp_settled` (gateway_clearing → bank), which is
what closes eligibility gate 2. It is idempotent per order, so re-uploading the
same settlement report is a no-op.

**The state machine has one deliberate hole in it.** There is no
`PROCESSING → QUEUED` edge. A batch handed to the provider may or may not have
moved money, so it can only ever leave that state via reconciliation — never a
retry. Every other rail (KYC approved, bank verified, no active freeze,
destination fingerprint unchanged since approval, per-batch ceiling, distinct
dual approvers) is enforced in `assertPayable()` before a transition is allowed.

**Refunds.** Unpaid lines flip to `reversed` and never enter a batch. Already-paid
lines produce a NEGATIVE line that offsets the vendor's next cycle — and if that
drives the cycle negative, `negativeBalanceCarryForward` rolls it forward rather
than paying out.

---

## 14. Phase 6.4 — domain routing (blueprint: `phase6_payouts_gst_subdomains_search.md`)

`{slug}.flowermarket.in` and verified custom domains resolve a tenant from the
`Host` header, with no `x-tenant-id`.

| Collection | Purpose | Key invariants |
| --- | --- | --- |
| `tenantdomains` | a hostname that points at a tenant | `hostname` globally unique (one tenant per host); one `isPrimary` per tenant; **only `verified` + `active` rows ever resolve** |

**Resolution order** (`middleware/tenantContext.js`):
`Host` → `x-tenant-id` header → `DEFAULT_TENANT_ID` → first active tenant.

**Why Host wins, and why that is the security fix.** Before 6.4 any client
could name any tenant with a header, and the only thing between that and a
cross-tenant read was `authenticate` rejecting a token/tenant mismatch — which
does nothing on the many public endpoints. Public traffic is now bound to the
hostname it arrived on, and the header cannot override a Host that already
resolved (unless `ALLOW_TENANT_HEADER_OVERRIDE`, a development affordance that
defaults to off in production).

**Why an unknown store subdomain 404s.** `resolveByHost()` throws
`STORE_NOT_FOUND` for a well-formed subdomain with no matching store rather
than falling through to the default tenant. Silently serving the default
store's catalogue at someone else's hostname is a leak that looks like a
feature. Inactive tenants fail the same way.

**Why every existing client keeps working.** `localhost`, IP literals and the
sandbox preview host classify as *infrastructure* or *custom* and never resolve
implicitly, so the header path is untouched for the admin console, the mobile
app and every smoke test.

**Host parsing is treated as attacker input** (`utils/hostname.js`, pure, 55
assertions). It normalises case, ports, trailing dots, IPv6 brackets and
proxy-joined values, and rejects anything else outright. The fuzz case in
`scripts/hostname.test.js` found a real vulnerability during development:
`store.flowermarket.in:80@evil.com` had its `:80@evil.com` stripped as a
"port", leaving a valid store hostname — userinfo is now rejected and a port
must actually be digits.

**Verification is the boundary for custom domains.** A row exists as soon as an
owner claims a domain, but it resolves to nothing, and is refused a TLS
certificate, until a `_fm-verify.{host}` TXT record proves ownership. That
matters twice: an unverified domain could point someone else's traffic at your
store, and with on-demand TLS it could burn the platform's ACME quota. The
`GET /domains/tls-check` hook is what a terminator (Caddy `ask`, or an ALB
automation) consults before issuing.

**Caching.** Resolution runs on every request, so it is backed by a TTL+LRU
cache — including **negative** results, so an unknown host cannot hammer the
database. Measured: 1.06 µs per host classification, 50 000 in 53 ms.

**CORS is now host-aware.** The old rule allowed *every* origin whenever
`isDev` was true, and `NODE_ENV` defaults to `'development'` — so an unset
`NODE_ENV` in production shipped an open policy. It now allows the configured
allowlist, any `*.{root}` storefront, verified custom domains (refreshed
lazily, since a CORS decision must be synchronous), and in development an
enumerated set: localhost and the sandbox preview host.

---

## 15. Phase 6.5 — search ranking (blueprint: `phase6_payouts_gst_subdomains_search.md`)

| Collection | Purpose | Key invariants |
| --- | --- | --- |
| `searchdocuments` | one denormalized, rankable row per (tenant, listing) | `key = {tenantId}:{listingId}` unique, so re-indexing is an upsert; weighted text index; fed by the outbox |
| `rankingprofiles` | weights as DATA, per tenant | `trafficPct > 0` makes a profile an A/B arm; unique per (tenant, code) |
| `searchsynonyms` | vocabulary as DATA | `equivalent` expands both ways, `oneway` only from `from` |
| `searchquerylogs` | what people searched and did next | PII-free (hashed session), sampled, 90-day TTL |

**What was there before.** `/catalog` built a `$regex` `$or` inside an
aggregation — a collection scan per query — and its `sort=relevance` was
literally `{ 'master.searchText': -1 }`, i.e. **alphabetical**. Measured mean
NDCG@10 of that baseline: **0.569**.

**Two-stage retrieval.** Stage 1 pulls a bounded candidate set from the index
(cheap, indexed, capped at 400). Stage 2 ranks in-process with a pure scorer —
1 000 candidates in **2.4 ms**. The expensive part stays in the database where
the indexes are; the interesting part stays in JavaScript where it can be
unit-tested, explained and retuned from data. Pushing the blend into an
aggregation would make it fast and completely untestable.

**The blend** (each signal normalised to 0..1 *before* weighting, so weights
are directly comparable and the tuning UI is honest):

```text
text · popularity(log-damped) · ctr(Bayesian-smoothed) · availability
     · freshness(exponential decay) · discount · vendor rating · margin
     + promoted boost − return penalty
```

Three choices worth naming:
* **Popularity is log-damped** — 10 000 sales is not 100× better than 100.
* **CTR is Bayesian-smoothed** — otherwise 1 click on 1 impression outranks
  480 on 1 000. Asserted as a test.
* **Out-of-stock is DEMOTED, never filtered.** A sold-out item is compressed
  below every in-stock one but still shown, because a customer searching for
  something you briefly lack should still learn you sell it. The floor holds
  under **300 randomised weight configurations** — a merchandiser cannot
  accidentally break it from the tuner.

**Inferred intent biases; explicit filters constrain.** `white flowers`
initially returned red roses: the colour had been stripped from the text and
hard-filtered against an attribute almost nothing carried. A colour parsed out
of the query is now kept as a search *term* (colour words are reliably in
titles) and only *reported* as inferred; only a colour the client passes
explicitly narrows the set. Found by the evaluation harness, not by a user.

**Query understanding is deterministic, not a model** — search must be fast,
reproducible and debuggable. Price intent (`under 500`, `500-1000`), colour,
synonyms (`gulab`⇄`rose`, `mogra`⇄`jasmine`, seeded and operator-extendable
from the zero-result log), and Damerau-Levenshtein typo correction **against
the store's own vocabulary** rather than a dictionary — so a suggestion is
always something the store actually sells. Short tokens may only be corrected
by an insertion or deletion, never a substitution: `rse`→`rose` yes,
`pot`→`hot` never.

**Zero results are never shown.** A relaxation ladder progressively drops
colour, then price, then the last token, then falls back to popular items, and
the response says which step it took.

**Indexing rides the existing outbox.** `CatalogEvent` already emits
product/price/stock events with at-least-once delivery and retry; the indexer
registers on the same drain as the notification consumer. No new event
plumbing, and because re-indexing is an upsert on a stable key, at-least-once
delivery — which would corrupt a counter — is harmless here. A nightly
freshness sweep repairs anything a failed drain missed.

**The gate.** `scripts/search-eval.mjs` scores a 12-query judgment set and
fails the build below NDCG@10 of 0.85. Current: **0.996** (baseline 0.569).
`--baseline` re-scores the legacy ordering so the comparison stays honest.

---

## 4. Auth & session model (how it fits together)

```text
request OTP ──> otpverifications row (hashed code, TTL, cooldown)
verify OTP ──> atomic consume ──> user (auto-created on first login) ──> tokens
access token  = JWT (15 min, stateless, signed, tenant claim)
refresh token = opaque 256-bit, stored hashed in authtokens
refresh       = verify + rotate (old row revoked, new row created) + new JWT
logout        = revoke current row (or all rows for the user)
password change = revoke ALL sessions
```

Security layers: bcrypt(12) for passwords, SHA-256 at rest for OTPs/tokens,
`timingSafeEqual` for OTP compare, per-endpoint rate limiters, helmet + CORS
allowlist, no secrets in responses (`toJSON` plugin strips `passwordHash`).

---

## 5. Index summary

| Collection | Indexes (beyond `_id`) |
| --- | --- |
| users | phone(cc,num), email partial-unique, tenant+status, role+tenant, createdAt |
| addresses | tenant+user+isDefault partial-unique, tenant+user+pincode |
| authtokens | tokenHash, user, deviceId, revoked, expiresAt **TTL** |
| otpverifications | tenant+purpose+channel+target, expiresAt **TTL** |
| locations | 2dsphere, type+isServiceable+status, name+parentId |
| serviceablepincodes | tenant+pincode unique, tenant+isServiceable |
| deliveryzones | tenant+code unique |
| deliveryslots | tenant+date+status, tenant+zone+date+startTime unique, tenant+hub+date+startTime unique |
| inventoryadjustments | tenant+tenantProductId+createdAt, tenant+inventoryId+createdAt |
| analyticsdailies | tenant+hubId+date unique, tenant+date |
| products | tenant+slug partial-unique, tenant+category+listing+availability, text |
| vendors | tenant+slug partial-unique |
| ledgerjournals | idempotencyKey unique, kind+occurredAt, refType+refId, tenant+occurredAt |
| ledgerentries | accountCode+occurredAt, accountCode+journalId, refId |
| accountbalances | accountCode unique, tenantId, vendorId |
| ledgeraccounts | code unique, tenantId, vendorId |
| taxregistrations | (ownerType,ownerId) unique, gstin partial-unique |
| taxdocumentseries | (ownerType,ownerId,docType,fyLabel,seriesCode) unique |
| taxdocuments | number unique, (supplier,docType,fy,series,sequence) unique, (orderId,docType,vendorId) partial-unique, einvoice.status |
| statutoryrates | kind+effectiveFrom |
| payoutlineitems | orderItemId partial-unique, vendorId+state+eligibleAt, state+eligibleAt |
| payoutbatches | batchNumber unique, idempotencyKey unique, (vendorId,cycle) unique, state+submittedAt, needsReconciliation |
| vendorpayoutaccounts | vendorId+isDefault partial-unique, fingerprint |
| payoutpolicies | (scope,vendorId) partial-unique |
| tenantdomains | hostname unique, tenantId+isPrimary partial-unique, verification.status |
| searchdocuments | key unique, tenant+status+inStock+price, weighted text index, tenant+suggest, indexedAt |
| rankingprofiles | (tenantId,code) unique, isActive |
| searchquerylogs | queryId, tenant+normalizedQuery+at, zeroResult, at TTL 90d |
| taxpolicies | categoryId+effectiveFrom, categoryId+isActive partial-unique |
