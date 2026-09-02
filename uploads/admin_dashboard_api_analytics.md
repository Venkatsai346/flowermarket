# Phase 4 — Admin Dashboard API (products · inventory · slots · orders · users · analytics)

> Author: Arena.ai Agent Mode · Date: 2026-09-01 · Status: **design** → implementation
> Companion to: `order_lifecycle_cart_delivery_fulfillment_returns.md` (Phase 3),
> `tenant_charges_rider_endpoints_slot_forecasting_refund_fees.md` (Phase 3.5)

---

## 1. Root problem

Today the operations surface is scattered: order/returns/refunds/slots live under
`/fulfillment`, catalog CRUD under `/catalog/admin`, policies under `/policies`. There is
**no unified read-side for running the business** — no inventory health view, no admin
order detail, no staff/user management, no intraday slot override, no analytics, and no
CSV export. The admin dashboard API (Phase 4) fills exactly that gap.

Two traps this design must avoid:

1. **A write-heavy re-implementation.** All state transitions already exist behind
   battle-tested services (order saga, inventory service, slot service, catalog admin,
   refund/returns). The admin API must be **read-first, write-controlled** — it *composes*
   existing domain services and never bypasses their invariants.
2. **Analytics that can't be defended.** Every KPI in this doc is defined by an exact
   formula over indexed fields (`tenantId + status + createdAt`), so a dashboard number
   can be explained to a CFO. No magic.

## 2. Principles (standing constraints apply)

1. **Read-first**: every dashboard screen maps to exactly one endpoint; all lists are
   paginated, filterable, tenant-scoped, `serializeList`-consistent.
2. **Writes reuse the domain**: inventory adjusts go through the atomic inventory update;
   slot overrides go through the atomic capacity gate; staff changes go through
   `user.service` guards. The admin API adds *new* operations (adjustments, overrides,
   analytics) — it never re-implements existing ones.
3. **Multi-tenant**: every query carries `tenantId`; RBAC `ADMIN | SUPER_ADMIN` enforced
   at the router; cross-tenant access is structurally impossible.
4. **Auditability**: every admin write appends an audit row (`audit.service`) with
   actor + before/after; inventory adjustments are additionally append-only rows.
5. **Analytics = aggregation pipelines over orders/orderitems/payments/refunds**
   (indexed), with a nightly `analyticsdailies` rollup for consistent exports.
6. **CSV export** for the main lists, RFC-4180 escaped, UTF-8 BOM (Excel-safe).
7. **No embedded arrays** (bounded arrays only — e.g. rollup `topProducts` capped at 20).

## 3. Data models

### 3.1 `inventoryadjustments` (NEW — append-only stock ledger)

| field | type | notes |
| --- | --- | --- |
| `tenantId` | ObjectId | tenant scope |
| `inventoryId` | ObjectId | the inventory row adjusted |
| `tenantProductId` | ObjectId | listing (denormalized for fast joins) |
| `warehouseId` | ObjectId? | null = default store |
| `type` | enum | `restock` · `shrinkage` · `audit_correction` · `return_restock` |
| `qtyChange` | int ≠ 0 | signed |
| `qtyBefore` / `qtyAfter` | int ≥ 0 | snapshot for audit |
| `reason` | string (required) | human-readable |
| `note` | string? | extra context |
| `refType` / `refId` | string?/ObjectId? | e.g. `return` + returnRequestId |
| `actorId` / `actorType` | ObjectId?/string | who did it |

Indexes: `(tenantId, tenantProductId, createdAt)`, `(tenantId, inventoryId, createdAt)`.
Plugins: audit, soft-delete, toJSON. **Rows are never mutated/deleted.**

### 3.2 `analyticsdailies` (NEW — nightly rollup, unique `(tenantId, hubId, date)`; `hubId: null` = tenant-wide row)

| field | type | notes |
| --- | --- | --- |
| `date` | 'YYYY-MM-DD' | |
| `hubId` | ObjectId? | null = whole tenant |
| `ordersCreated` / `gmv` / `netRevenue` / `aov` | Number | see §5 formulas |
| `delivered` / `cancelled` / `returnRequests` / `newCustomers` / `repeatCustomers` | Number | |
| `byPaymentMethod` | object | `{upi: n, cod: n, …}` (bounded subdoc, not an array) |
| `bySlotType` | object | `{normal: n, express: n, …}` |
| `topProducts` | array ≤ 20 | `{tenantProductId, skuGlobal, title, qty, revenue}` (bounded) |
| `version` / `computedAt` | | idempotent upsert — rebuild is safe |

### 3.3 `deliveryslots` (EXTENDED — intraday ops override)

Add `manualCapacity` (Number?, null), `manualCapacityAt` (Date?), `manualCapacityBy`
(ObjectId?), `manualCapacityReason` (String?). **Effective capacity = `manualCapacity ?? totalCapacity`**
used by `reserve` (the atomic gate becomes
`$expr: { $lt: ['$reservedCapacity', { $ifNull: ['$manualCapacity', '$totalCapacity'] }] }`),
`listAvailable`, and `utilization`. Override can never shrink below `reservedCapacity` (409).
Forecast (`forecastCapacity`) remains advisory; manual override is the human override on top.

### 3.4 No changes needed to `orders` / `users` / `hubs`

Staff = `user.role`; rider profile = `user.rider` subdoc (Phase 3.5). Hubs already carry
`serviceablePincodes[]` (bounded curated list). Analytics reads `orders.slotSnapshot.hubId`.

## 4. API surface — all under `/api/v1/admin`, `authenticate` + `authorize(ADMIN, SUPER_ADMIN)`

### 4.1 Products & catalog (read-side dashboard; writes stay in `/catalog/admin`)

| endpoint | purpose |
| --- | --- |
| `GET /admin/products` | masters joined with listing + inventory: search, categoryId, status, low-stock filter, sort (updatedAt / revenue / stock), pagination |
| `GET /admin/products/:id` | master detail + listings + inventory + price history |
| `GET /admin/products/export.csv` | same filters → CSV |

### 4.2 Inventory

| endpoint | purpose |
| --- | --- |
| `GET /admin/inventory/summary` | total SKUs · in stock · low stock · out of stock · reserved units · on-hand value |
| `GET /admin/inventory` | filterable list (`status: in_stock\|low_stock\|out_of_stock`, search, categoryId) + restock suggestion (low stock × demand) |
| `GET /admin/inventory/ledger/:listingId` | current state + append-only adjustment rows |
| `POST /admin/inventory/:listingId/adjust` | `{type, qtyChange, reason, note?}` → atomic update (version lock, qtyAfter ≥ 0) + adjustment row + `TenantProduct.stockQty` refresh + audit |
| `GET /admin/inventory/export.csv` | inventory snapshot CSV |

### 4.3 Hubs & slots

| endpoint | purpose |
| --- | --- |
| `POST /admin/hubs` · `GET /admin/hubs` · `PATCH /admin/hubs/:id` | hub CRUD (existing fields) |
| `POST /admin/hubs/:id/pincodes` | `{add: [], remove: []}` serviceable pincodes (+ audit) |
| `POST /admin/hubs/:id/toggle` | activate / deactivate |
| `GET /admin/slots?hubId&from&to` | slot grid: effective capacity, reserved, remaining, status, forecast, override |
| `POST /admin/slots/:id/override` | `{manualCapacity, reason}` → intraday override (409 if < reserved) |
| `POST /admin/slots/:id/close` / `reopen` | `{reason}` status control |
| `GET /admin/slots/utilization?hubId&from&to` | per-slot + daily fill rate (reserved/effective) |

(Generation `POST /fulfillment/slots/generate` + forecasting already exist.)

### 4.4 Orders

| endpoint | purpose |
| --- | --- |
| `GET /admin/orders` | filters: status, from/to (createdAt), hubId, paymentMethod, min/max total, search (orderNumber) |
| `GET /admin/orders/:id` | full admin detail: order + items (+tax/discount) + charge breakdown + status history + payment + refunds + returns + delivery assignment |
| `GET /admin/orders/export.csv` | filtered orders CSV |

(Transitions already live: `/fulfillment/orders/:id/*`, `/orders/:id/cancel`, `/fulfillment/refunds`.)

### 4.5 Users & staff

| endpoint | purpose |
| --- | --- |
| `GET /admin/users` | role, status, search (phone/email/name), created range |
| `GET /admin/users/:id` | profile + addresses + order summary + wallet + returns count |
| `POST /admin/users/staff` | create staff `{role: picker\|rider\|admin, name, phone, email?, password?, hubId?}` — **cannot create super_admin** |
| `PATCH /admin/users/:id/status` | `{status: active\|blocked}` — cannot block self or a super_admin |
| `PATCH /admin/users/:id/role` | change role — cannot touch super_admin; cannot grant super_admin |
| `GET /admin/riders/stats?from&to` | per-rider: deliveries delivered, avg delivery seconds (fulfillmentTimeLogs), rejections, availability |
| `GET /admin/users/export.csv` | filtered users CSV |

### 4.6 Analytics

| endpoint | purpose |
| --- | --- |
| `GET /admin/analytics/dashboard?from&to&hubId` | KPIs + daily series + payment split + slot-type split |
| `GET /admin/analytics/products?from&to&limit` | top products (qty, revenue) |
| `GET /admin/analytics/categories?from&to` | category performance (qty, revenue) |
| `GET /admin/analytics/hubs?from&to` | hub performance (orders, gmv, delivered) |
| `GET /admin/analytics/slots?from&to&hubId` | slot fill-rate trend + overbooked count |
| `POST /admin/analytics/rebuild {from, to}` | (re)build `analyticsdailies` (idempotent upsert) — the nightly job hook |
| `GET /admin/analytics/export.csv` | daily series CSV (from rollups if built, else live) |

## 5. Business rules & formulas (the defensible numbers)

- **ordersCreated** = count of orders created in range (all statuses).
- **gmv** = Σ `totalAmount` of orders created in range whose status **∉ {cancelled, delivery_failed_cancelled}**.
- **netRevenue** = gmv − Σ `refundTransactions.amount` for refunds initiated in range (wallet + gateway).
- **aov** = gmv / (orders created in range excluding cancelled).
- **deliverySuccessRate** = delivered / orders that reached `out_for_delivery` or beyond.
- **cancellationRate** = cancelled / ordersCreated. **returnsRate** = returnRequests / delivered.
- **newCustomers** = users with role `customer` created in range; **repeatCustomers** = customers with ≥ 2 orders in range.
- **Top products**: aggregate `orderitems` (qty, `lineTotal − discountAllocated + taxAmount` = revenue share) joined to masters; excludes cancelled orders.
- **Slot fill rate** = Σ reservedCapacity / Σ effectiveCapacity over range (never > 100% thanks to the atomic gate).
- **Inventory status**: `qtyAvailable = qtyOnHand − qtyReserved`; `out_of_stock` = 0, `low_stock` = ≤ threshold (default 5, overridable), else `in_stock`.
- **Adjust**: `qtyChange ≠ 0`, `qtyAfter ≥ 0` (409 otherwise), version lock retry-once.
- **Override**: `manualCapacity ≥ 1` and `manualCapacity ≥ reservedCapacity` (409).
- **CSV**: RFC-4180 (quote fields containing `, " \n`; escape quotes by doubling); UTF-8 BOM.
- **RBAC guards**: staff create / role change cannot mint or touch `super_admin`; a user cannot block themselves.

## 6. Testing plan (`scripts/smoke-admin.test.js`)

1. Seed tenant + users (admin, customer, picker, rider) + category/master/listing/inventory + hub + slots + policies.
2. Full API checkout → confirm → pick/pack/dispatch → rider machine → DELIVERED (so analytics has real data).
3. Inventory: restock adjust (+n, qtyAfter correct, TenantProduct.stockQty refreshed); shrinkage to negative → 409; low-stock filter returns the SKU; ledger shows rows.
4. Slots: override to a larger capacity → effective in `listAvailable`; override below reserved → 409; close → hidden.
5. Users: create staff rider; block a customer → login 401/blocked; rider stats show deliveries; RBAC: customer token → 403 on `/admin/*`.
6. Orders: admin list filter by status; detail has items + breakdown + timeline.
7. Analytics: dashboard KPIs exactly match seeded order docs (gmv, ordersCreated, aov, delivered); top product = the ordered SKU; `rebuild` upserts `analyticsdailies`; `export.csv` returns text/csv with BOM.
8. Teardown: stop mongod before `process.exit` (standing discipline).

## 7. Acceptance criteria

- [ ] All 6 suites pass (`smoke.test`, `smoke-catalog.test`, `smoke-order.test`, `smoke-phase35.test`, `refund-calc.test`, `slot-forecast.test`) **plus** `smoke-admin.test.js`.
- [ ] Server boots with `/api/v1/admin/*` mounted; live-verifiable via curl.
- [ ] Every admin write is audited; every list is paginated + tenant-scoped + `serializeList`-consistent.
- [ ] Analytics numbers are reproducible by hand from the order docs in tests.
- [ ] README / docs/API / docs/DATA_MODELS / docs/ROADMAP updated.

---

## 8. Non-goals (explicit)

- No BI/OLAP store, no Kafka — aggregation pipelines over indexed Mongo collections (with the rollup hook for scale-out later).
- No new auth flows (staff login = existing email/password; customers = OTP).
- No push notifications / email templates (roadmap Phase 4+, separate track).
- No destructive deletes — everything is soft-delete + append-only ledger.
